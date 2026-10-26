/**
 * One deterministic tick of the simulation (source: `src/sim/step.ts`).
 *
 * Rules for everything called from step():
 *  - no math.random, clocks, or other non-deterministic sources (use rng.ts),
 *  - no trig (sin/cos/atan2 can differ between engines); + - * / and math.sqrt are IEEE-exact,
 *  - no reading render state, frame delta, or device state: the InputFrame is the only input,
 *  - iterate in a fixed order (arrays, not Map/Set of objects keyed by identity).
 */

import { EMPTY_INPUT, type InputFrame } from "./input";
import { clearEvents, type SimState } from "./state";
import { killPlayerState, stepPlayer } from "./player";
import { stepCombat } from "./combat/combat";
import { simWorldConfig, stepEndless, type EndlessConfig } from "./endless";
import type { EncounterConfig } from "./combat/actors/encounter";
import { clearScoreEvents, stepScore, type ScoringConfig } from "./score/score";
import { clearRunEvents, closeDraft, stepDraft, stepRun } from "./progression/progression";
import { SOLO_PLAYER, isDraftOpen } from "./progression/runMods";
import { hasLeftBit, markPlayerLeft, partySize, playerAt, weaponsAt, type PartyConfig } from "./party";
import { FORFEIT_BUTTON } from "./partyData";
import type { TutorialSimConfig } from "./tutorial/tutorial";
import { clearBreakableEvents, type BreakablesConfig } from "./breakables/breakables";
import type { SolidCells } from "shared/dungeon";

export { PLAYER_RADIUS, PLAYER_SPEED } from "./playerData";

export interface SimBounds {
	minX: number;
	maxX: number;
	minZ: number;
	maxZ: number;
}

/**
 * Resolves one tick of movement against the world: from (x, z), try to move by (dx, dz), return where the mover ends
 * up. MUST be pure and deterministic; it is part of the sim, so live play and replays must be given the same resolver.
 * The sim calls it with moves of length <= MAX_MOVE_STEP (0.1 world units): once per walking tick, and in equal
 * sub-steps when the player moves faster (the dodge roll covers ~0.18 per tick, so two calls).
 * Example: `(x, z, dx, dz) => moveCircle(dungeon, x, z, dx, dz, PLAYER_RADIUS)` (shared/dungeon, `circleMover`).
 * `solid` (docs/DECOR.md D4): the sim passes the intact breakables' cells (breakables/breakables.ts `solidCells`) when
 * the run has any, and they block like wall tiles; undefined otherwise (every fixture, M1, the tutorial), so the
 * resolver takes exactly its grid-only path. Same for ActorMover and BulletBlocker.
 */
export type MoveResolver = (
	x: number,
	z: number,
	dx: number,
	dz: number,
	solid?: SolidCells,
) => { x: number; z: number };

/**
 * Bullet vs world (E1.6): true when a bullet whose center is at world (x, z) has hit something solid and must be
 * consumed. Same purity rules as MoveResolver. Example: `bulletBlocker(dungeon)` (WALL or VOID tile).
 */
export type BulletBlocker = (x: number, z: number, solid?: SolidCells) => boolean;

/**
 * Moves a circle of `radius` (an actor's body) from (x, z) by (dx, dz) through the world (E1.8). Same purity rules and
 * call contract as MoveResolver, but radius-aware. Example: `actorMover(dungeon)`.
 */
export type ActorMover = (
	x: number,
	z: number,
	dx: number,
	dz: number,
	radius: number,
	solid?: SolidCells,
) => { x: number; z: number };

/** Stress mode (E1.6, `?stress=N`): keep about `bullets` enemy bullets alive, in rings from (x, z). */
export interface StressConfig {
	bullets: number;
	x: number;
	z: number;
}

/**
 * Everything that shapes a run besides the seed, the spawn and the input. Read once at run start (createSimState
 * builds combat state from it) and passed to every step(); live play and replays must use the same config.
 * Function members are callback PROPERTIES (called with `.`), so plain arrow functions plug in.
 */
export interface SimConfig {
	/** Rectangular arena clamp (the greybox fallback). Ignored when `moveResolver` is set. */
	bounds?: SimBounds;
	/** World collision (e.g. a dungeon floor). Replaces the `bounds` clamp when set. */
	moveResolver?: MoveResolver;
	/**
	 * Bullet vs world collision (E1.6). When set, bullets are consumed where it returns true and the bullet
	 * simulations' bounds culling is off; when absent, a +/-FALLBACK_BULLET_BOUNDS cube around the origin culls them.
	 */
	isBulletBlocked?: BulletBlocker;
	/** Actor movement through the world (E1.8). Without it actors use the `bounds` clamp, else move freely. */
	actorMover?: ActorMover;
	/**
	 * Steering movement (Roblox port): when set, the room enemies' steered walks (`walkToward(..., STEER)`: chasing,
	 * walking home, a sniper looking for a line) move with this instead of `actorMover`. Every other actor move keeps
	 * actorMover: lunges, strafes, separation, and the boss's charge and reposition (unsteered walkToward). Endless
	 * floors set it to `actorSteerMover(dungeon)` (rounds solid pillars, and wall ends the move already clips). Absent
	 * (M1, every golden fixture): actorMover everywhere, exactly as in the web build.
	 */
	actorSteerMover?: ActorMover;
	/** What stands where at run start, plus room geometry for AI (E1.8). Absent: no actors. */
	encounter?: EncounterConfig;
	/** Weapon id per weapon set (E1.8; undefined / "" = empty set). Absent: DEFAULT_LOADOUT. */
	loadout?: ReadonlyArray<string | undefined>;
	/** Stress mode: keeps about `stress.bullets` enemy bullets alive (harmless to the player). */
	stress?: StressConfig;
	/**
	 * Endless mode (Roblox port, endless.ts): the world changes per floor. When set, every tick runs with
	 * `endless.worldForFloor(state.endless.floor).config` instead of this config's own world fields, createSimState
	 * starts on floor 1, and stepEndless runs after stepCombat. Absent: everything as in the web build.
	 */
	endless?: EndlessConfig;
	/**
	 * Scoring (M2, score/score.ts). Absent: no score state, nothing extra hashed (every M1 golden run). Present:
	 * state.score is created, updated each tick and hashed as the "score" subsystem.
	 */
	scoring?: ScoringConfig;
	/**
	 * Co-op (M4, party.ts): `party.size` players (2..8) share the run; every tick then takes one InputFrame per player
	 * (stepParty). Absent or size 1: a solo run, exactly as before (no party state, nothing extra hashed).
	 */
	party?: PartyConfig;
	/**
	 * First-run tutorial (docs/TUTORIAL.md, tutorial/tutorial.ts): `harmless` hits land (events, post-hit
	 * invulnerability, combo cut, on-hit hooks) but never take armor or hearts or kill; `startHalfHearts` sets every
	 * player's start hearts. Absent: no tutorial state, nothing extra hashed (every fixture and run unchanged). Present:
	 * state.tutorial is created and hashed as the "tutorial" subsystem, after "party".
	 */
	tutorial?: TutorialSimConfig;
	/**
	 * Breakable barrels and crates (docs/DECOR.md D4, breakables/breakables.ts): the tunables (toughness, damage, the
	 * slam radius); the pieces come from each endless floor's world (EndlessFloorWorld.breakables), or from
	 * `breakables.pieces` without endless mode. Absent: no breakables state, nothing extra hashed, every mover and
	 * blocker takes its grid-only path (every fixture, M1, the tutorial). Present: state.breakables is created and
	 * hashed as the "breakables" subsystem, appended after every other group.
	 */
	breakables?: BreakablesConfig;
}

/** Matches the 16x16 greybox room: inner wall faces at +/-7.75, minus the 0.4 player half-width (rounded). */
export const DEFAULT_BOUNDS: Readonly<SimBounds> = table.freeze({
	minX: -7.25,
	maxX: 7.25,
	minZ: -7.25,
	maxZ: 7.25,
});

/** Greybox arena: bounds clamp, no move resolver. */
export const DEFAULT_SIM_CONFIG: Readonly<SimConfig & { bounds: Readonly<SimBounds> }> = table.freeze({
	bounds: DEFAULT_BOUNDS,
});

/** Scratch for the endless phase's per-player arguments (no allocation per tick). */
const soloInputs: Array<Readonly<InputFrame>> = [EMPTY_INPUT];
const soloPrev: number[] = [0];
const partyPrev: number[] = [];

/**
 * Advances `state` by exactly one tick of SIM_DT, in place. Solo runs only (a party state needs stepParty).
 *
 * Tick order (fixed; part of the determinism contract):
 *   1. clear per-tick events (and the score's, the breakables'); then FORFEIT_BUTTON ("Leave run") -> forfeitSoloRun:
 *      the player dies at this tick
 *   2. stepPlayer  (movement, facing, roll, hearts, flask, Ember)
 *   3. stepCombat   (Ember clear, actors act, the player's weapons, bullets step, hits, contact damage)
 *   4. stepEndless  (endless mode only: Depth, floor clear points + stairwell / next floor, deferred room spawns)
 *   5. stepRun      (endless mode only: a new floor opens the boon draft; Warding, relic pedestals, the curse shrine)
 *   6. stepScore    (only with config.scoring: hit cuts, combo timer, rooms; kills / grazes / guard score inside 3)
 *   7. tick += 1
 * While a boon draft is open (endless mode, progression/progression.ts) the world is frozen: after the event clears
 * only stepDraft runs (the stick selects, a FIRE press confirms), then tick += 1 (a forfeit on such a tick closes the
 * draft without a pick and the tick stays frozen, like a co-op leaver's).
 * In endless mode steps 2-3 run with the current floor's SimConfig (simWorldConfig). Scoring is read from the top-level
 * config (createSimState). Kills score inside 3, so a boss kill's points use the Depth from BEFORE stepEndless raises it.
 */
export function step(
	state: SimState,
	input: Readonly<InputFrame>,
	config: Readonly<SimConfig> = DEFAULT_SIM_CONFIG,
): void {
	if (state.party !== undefined) error(`step: a party of ${state.party.size} needs stepParty (one input each)`, 0);
	const world = simWorldConfig(state, config);
	soloPrev[0] = state.player.prevButtons;
	soloInputs[0] = input;
	clearEvents(state.events);
	const score = state.score;
	if (score !== undefined) clearScoreEvents(score);
	if (state.breakables !== undefined) clearBreakableEvents(state.breakables);
	const run = state.run;
	// Read before the forfeit, which closes an open draft: that tick stays a frozen draft tick.
	const frozen = run !== undefined && isDraftOpen(state);
	if (bit32.band(input.buttons, FORFEIT_BUTTON) !== 0) forfeitSoloRun(state);
	if (run !== undefined) {
		clearRunEvents(run);
		if (frozen) {
			stepDraft(state, soloInputs);
			state.tick += 1;
			return;
		}
	}
	stepPlayer(state, input, world);
	stepCombat(state, input, world);
	if (state.endless !== undefined) stepEndless(state, soloInputs, config, soloPrev);
	if (run !== undefined) stepRun(state, soloInputs, config, soloPrev);
	if (score !== undefined) stepScore(state);
	state.tick += 1;
}

/**
 * "Leave run" in a solo run (L6a; FORFEIT_BUTTON in the tick's input; step() calls it right after the event clears):
 * the player dies at this tick with exactly the bookkeeping of a lethal hit (killPlayerState, events.playerDied = 1),
 * so the run ends as a death everywhere a death is read (isPartyWiped, stepEndless / stepRun stop, LiveRun outcome,
 * telemetry, the server's summary `died`). It is not a hit: no playerHits, no armor, no Second Wind, no Hourglass. An
 * open boon draft is closed without a pick (the dead take nothing). Idempotent: a dead player stays dead and nothing
 * happens (no second event). Returns true when it killed the player. Never revives, scores or skips anything. No new
 * state: every field it writes is already hashed.
 */
export function forfeitSoloRun(state: SimState): boolean {
	const p = state.player;
	if (p.dead !== 0) return false;
	killPlayerState(p);
	state.events.playerDied = 1;
	const me = state.run?.players[SOLO_PLAYER];
	if (me !== undefined && me.draftOpen !== 0) closeDraft(me);
	return true;
}

/**
 * One co-op tick (M4): `inputs[i]` is player i's frame (exactly partySize(state) of them; the lockstep relay's
 * merged frame). Same order as step(), with every per-player phase looping players in index order:
 *   1. clear events (and score events, run events)
 *   2. per player: PARTY_LEFT_BUTTON -> marked left (dead, never revived)
 *   -  a boon draft is open for ANY player (endless): only stepDraft (each player picks with their own input; a player
 *      who left has theirs closed), then tick += 1: the world stays frozen until every player has confirmed
 *   3. per player: stepPlayer with its own state, weapons and player index
 *   4. stepCombat (actors target the nearest living player; each player's weapons; hits on any player)
 *   5. stepEndless (every living player in the stairwell; any player's debug skip; revive the dead on a new floor)
 *   6. stepRun (endless: a new floor opens every present player's draft; Warding, pedestals, the shrine per player)
 *   7. stepScore
 *   8. tick += 1
 * A solo state (no party) is stepped exactly as step(state, inputs[0], config) would.
 */
export function stepParty(
	state: SimState,
	inputs: ReadonlyArray<Readonly<InputFrame>>,
	config: Readonly<SimConfig> = DEFAULT_SIM_CONFIG,
): void {
	const n = partySize(state);
	if (inputs.size() !== n) error(`stepParty: ${inputs.size()} inputs for a party of ${n}`, 0);
	if (state.party === undefined) {
		step(state, inputs[0], config);
		return;
	}
	const world = simWorldConfig(state, config);
	for (let i = 0; i < n; i++) partyPrev[i] = playerAt(state, i).prevButtons;
	clearEvents(state.events);
	const score = state.score;
	if (score !== undefined) clearScoreEvents(score);
	if (state.breakables !== undefined) clearBreakableEvents(state.breakables);
	for (let i = 0; i < n; i++) if (hasLeftBit(inputs[i].buttons)) markPlayerLeft(state, i);
	const run = state.run;
	if (run !== undefined) {
		clearRunEvents(run);
		if (isDraftOpen(state)) {
			stepDraft(state, inputs);
			state.tick += 1;
			return;
		}
	}
	for (let i = 0; i < n; i++) stepPlayer(state, inputs[i], world, playerAt(state, i), weaponsAt(state, i), i);
	stepCombat(state, inputs[0], world, inputs);
	if (state.endless !== undefined) stepEndless(state, inputs, config, partyPrev);
	if (run !== undefined) stepRun(state, inputs, config, partyPrev);
	if (score !== undefined) stepScore(state);
	state.tick += 1;
}

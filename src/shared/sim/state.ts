/**
 * The live simulation state (source: `src/sim/state.ts`). Mutated in place by step(); never put it in UI state
 * (render reads it through the client's sim controller).
 *
 * Keep it plain data (numbers, nested plain objects, arrays of numbers). When you add a field, also append it to
 * writeHashFields() in replay.ts (or the module's write*Hash) so the determinism hash covers it. The ONE exception is
 * `combat`'s two bullet simulations: stateful pools created per run by createSimState and hashed through their own
 * writeStateHash (see combat/combat.ts).
 */

import { seedToState } from "./rng";
import { newPlayerState } from "./player";
import { cloneCombatState, createCombatState, startCombat, type CombatState } from "./combat/combat";
import type { SimConfig } from "./step";
import { cloneEndlessState, createEndlessState, type EndlessState } from "./endless";
import { ENDLESS_FIRST_FLOOR } from "shared/dungeon";
import { cloneScoreState, createScoreState, type ScoreState } from "./score/score";
import { cloneRunState, createRunState } from "./progression/progression";
import { refreshRunMods, type RunState } from "./progression/runMods";
import { cloneParty, createPartyState, partySize, playerAt, type PartyState } from "./party";
import {
	cloneTutorialState,
	createTutorialState,
	tutorialStartHalfHearts,
	type TutorialState,
} from "./tutorial/tutorial";
import { cloneBreakablesState, createBreakablesState, type BreakablesState } from "./breakables/breakables";

export interface PlayerState {
	x: number;
	z: number;
	/** Position at the start of the last tick, for render interpolation. */
	prevX: number;
	prevZ: number;
	/** Facing as a unit vector on the ground plane (no angles in the sim). */
	faceX: number;
	faceZ: number;

	// --- E1.5 player controller (player.ts, data in playerData.ts). Plain numbers only: 0/1 for flags, integer tick
	// counters for durations (counted down at the start of each stepPlayer).
	/** Health in HALF hearts (6 = 3 hearts). */
	hearts: number;
	heartsMax: number;
	/** Armor pips: each absorbs one whole hit before hearts. Refilled to armorMax at checkpoints. */
	armor: number;
	armorMax: number;
	/** Flask charges left / per checkpoint. */
	flask: number;
	flaskMax: number;
	/** Embers (bullet clears) left / per area. */
	embers: number;
	emberMax: number;
	/** Roll ticks remaining, including the current tick. > 0 = rolling. */
	rollTicks: number;
	/** Roll direction, a unit vector locked when the roll starts. */
	rollDirX: number;
	rollDirZ: number;
	/** Dodge i-frames remaining (roll start, Ember). > 0 = damagePlayer() ignores hits. */
	iframeTicks: number;
	/** Post-hit invulnerability remaining. > 0 = damagePlayer() ignores hits (render blinks). */
	hurtTicks: number;
	/** Flask drinking time remaining. > 0 = walking at FLASK_MOVE_MULTIPLIER. */
	flaskTicks: number;
	/** Last tick's InputFrame.buttons, for press edges that replay exactly. */
	prevButtons: number;
	/** 1 once hearts reach 0: no movement or actions until respawnPlayer(). */
	dead: number;
}

/**
 * Things that happened during the current tick, cleared at the start of every tick. Render / audio read them after a
 * tick and never write them. Not hashed.
 */
export interface SimEvents {
	/** 1 if the Ember (bullet clear) fired this tick. Set by stepPlayer, consumed by stepCombat. */
	emberUsed: number;
	/** Number of hits that landed on the player this tick. */
	playerHits: number;
	/** 1 if a dodge roll started this tick. */
	rollStarted: number;
	/** 1 if a flask charge was drunk this tick. */
	flaskUsed: number;
	/** 1 if the player died this tick. */
	playerDied: number;

	// --- E1.6 combat (set by stepCombat)
	/** Enemy bullets removed by this tick's Ember. */
	bulletsCleared: number;
	/** 1 if the player's weapon fired a volley this tick. */
	shotsFired: number;
	/** Player bullets that hit an enemy this tick. */
	enemyHits: number;
	/** Enemies killed this tick (same as actorsKilled; kept from E1.6). */
	enemiesKilled: number;

	// --- E1.8 actors and weapons
	/** Archetype index of the enemy that landed the last player hit this tick; -1 unknown / no hit. */
	lastHitSource: number;
	/** Actors that died this tick. */
	actorsKilled: number;
	/** Actors spawned this tick (runtime spawns). */
	actorsSpawned: number;
	/** A boss phase changed this tick: the new phase number, else 0. */
	bossPhase: number;
	/** Telegraphed attacks that started winding up this tick. */
	telegraphs: number;
	/** Melee swings this tick (sweepArc calls). */
	meleeSwings: number;
	/** Enemy bullets deleted by melee arcs this tick. */
	bulletsDeleted: number;
	/** 1 if the player swapped weapon sets this tick. */
	weaponSwapped: number;
	/** Hit points removed from actors this tick (after immunity and damage caps). */
	damageDealt: number;

	// --- E1.8 boss
	/** 1 on the tick a boss fight starts, else 0. */
	bossEngaged: number;
	/** 1 on the tick a boss dies, else 0. */
	bossDefeated: number;

	// --- Endless mode (Roblox port; set by stepEndless, always 0 outside endless runs). Not in SIM_EVENT_FIELDS.
	/** The new floor number on the tick the floor changed, else 0. */
	floorChanged: number;
	/** The new Depth on the tick it grew (a boss kill), else 0. */
	depthChanged: number;
	/** 1 on the tick a boss floor's stairwell opened, else 0. */
	stairwellOpened: number;
	/** Room id + 1 of the room the player entered for the first time this floor (its enemies spawned), else 0. */
	roomEntered: number;

	// --- Breakables (docs/DECOR.md D4; breakables/breakables.ts, always 0 without SimConfig.breakables). Not in
	// SIM_EVENT_FIELDS.
	/** Hits that landed on breakable pieces this tick (the breaking hit included). */
	breakableHits: number;
	/** Breakable pieces broken this tick. */
	breakablesBroken: number;
}

/**
 * The web build's SimEvents fields, in declaration order (telemetry and the parity tools: the run fixtures' events and
 * totals have exactly these). The port's endless fields are ENDLESS_EVENT_FIELDS; ALL_EVENT_FIELDS has both.
 */
export const SIM_EVENT_FIELDS = [
	"emberUsed",
	"playerHits",
	"rollStarted",
	"flaskUsed",
	"playerDied",
	"bulletsCleared",
	"shotsFired",
	"enemyHits",
	"enemiesKilled",
	"lastHitSource",
	"actorsKilled",
	"actorsSpawned",
	"bossPhase",
	"telegraphs",
	"meleeSwings",
	"bulletsDeleted",
	"weaponSwapped",
	"damageDealt",
	"bossEngaged",
	"bossDefeated",
] as const;

/** The endless-mode event fields (Roblox port), in declaration order. All default to 0. */
export const ENDLESS_EVENT_FIELDS = ["floorChanged", "depthChanged", "stairwellOpened", "roomEntered"] as const;

/** The breakables event fields (Roblox port, docs/DECOR.md D4), in declaration order. All default to 0. */
export const BREAKABLE_EVENT_FIELDS = ["breakableHits", "breakablesBroken"] as const;

/** Every SimEvents field: SIM_EVENT_FIELDS, then ENDLESS_EVENT_FIELDS, then BREAKABLE_EVENT_FIELDS. */
export const ALL_EVENT_FIELDS: ReadonlyArray<keyof SimEvents> = [
	...SIM_EVENT_FIELDS,
	...ENDLESS_EVENT_FIELDS,
	...BREAKABLE_EVENT_FIELDS,
];

/** Default value of an event field: 0, except lastHitSource (-1). */
export function eventDefault(field: keyof SimEvents): number {
	return field === "lastHitSource" ? -1 : 0;
}

export function clearEvents(e: SimEvents): void {
	for (const f of ALL_EVENT_FIELDS) e[f] = eventDefault(f);
}

function emptyEvents(): SimEvents {
	return {
		emberUsed: 0,
		playerHits: 0,
		rollStarted: 0,
		flaskUsed: 0,
		playerDied: 0,
		bulletsCleared: 0,
		shotsFired: 0,
		enemyHits: 0,
		enemiesKilled: 0,
		lastHitSource: -1,
		actorsKilled: 0,
		actorsSpawned: 0,
		bossPhase: 0,
		telegraphs: 0,
		meleeSwings: 0,
		bulletsDeleted: 0,
		weaponSwapped: 0,
		damageDealt: 0,
		bossEngaged: 0,
		bossDefeated: 0,
		floorChanged: 0,
		depthChanged: 0,
		stairwellOpened: 0,
		roomEntered: 0,
		breakableHits: 0,
		breakablesBroken: 0,
	};
}

export interface SimState {
	/** Number of ticks stepped so far. */
	tick: number;
	/** mulberry32 state word (uint32). */
	rngState: number;
	player: PlayerState;
	events: SimEvents;
	/** Bullets (two pools), actors, weapon sets, stress emitter. See combat/combat.ts. */
	combat: CombatState;
	/** Endless mode (floor, Depth, stairwell, rooms entered); undefined unless SimConfig.endless. See endless.ts. */
	endless?: EndlessState;
	/** Scoring (M2), only when the run's SimConfig.scoring is set; hashed as the "score" subsystem. See score/score.ts. */
	score?: ScoreState;
	/**
	 * In-run progression (M2: boons, relics, curse shrines), endless runs only; hashed as the "run" subsystem after
	 * "score". Per player (`run.players[i]`). See progression/progression.ts.
	 */
	run?: RunState;
	/**
	 * Co-op (M4), only when SimConfig.party.size > 1: every player by index ([0] is `player`), their weapons, who left.
	 * Hashed as the "party" subsystem, after every other group but "tutorial". See party.ts.
	 */
	party?: PartyState;
	/**
	 * First-run tutorial (docs/TUTORIAL.md), only when SimConfig.tutorial is set: the harmless flag and the harmless
	 * hit count. Hashed as the "tutorial" subsystem, appended after "party" (only "breakables" comes after it). See
	 * tutorial/tutorial.ts.
	 */
	tutorial?: TutorialState;
	/**
	 * Breakable barrels and crates (docs/DECOR.md D4), only when SimConfig.breakables is set: the current floor's pieces
	 * (kind, cell, hp, broken tick). Hashed as the "breakables" subsystem, appended after every other group (after
	 * "tutorial"). See breakables/breakables.ts.
	 */
	breakables?: BreakablesState;
}

/**
 * A fresh run. `config` is the run's SimConfig (the same one every step() and the replay get): combat state is built
 * from it (encounter spawns, loadout, stress mode, bullet culling), so live play and runReplay create identical worlds.
 * Omitted: an empty config (no actors, default loadout, bounds-culled bullets). With `config.endless`, combat state is
 * built from floor 1's world (`worldForFloor(ENDLESS_FIRST_FLOOR).config`) and `endless` state is created.
 * With `config.party` (size > 1) every party member starts at the spawn too (party.ts), before the encounter spawns.
 * With `config.tutorial`, `tutorial` state is created and every player starts with its `startHalfHearts` (if set).
 * With `config.breakables`, `breakables` state is created (floor 1's pieces in endless mode, else its `pieces`).
 */
export function createSimState(
	seed: number,
	spawnX: number,
	spawnZ: number,
	config: Readonly<SimConfig> = {},
): SimState {
	const firstFloor = config.endless !== undefined ? config.endless.worldForFloor(ENDLESS_FIRST_FLOOR) : undefined;
	const world = firstFloor !== undefined ? firstFloor.config : config;
	const state: SimState = {
		tick: 0,
		rngState: seedToState(seed),
		// Faces the camera (screen-down) until there is input.
		player: newPlayerState(spawnX, spawnZ),
		events: emptyEvents(),
		combat: createCombatState(world),
		endless: firstFloor !== undefined ? createEndlessState(firstFloor) : undefined,
	};
	// Co-op: the other players (and their player bullet emitter ids) exist before anything spawns. No rng.
	state.party = createPartyState(state, config.party, world.loadout, spawnX, spawnZ);
	// Tutorial: harmless hits and the wounded start (every player, max hearts unchanged). No rng.
	const tutorial = config.tutorial;
	if (tutorial !== undefined) {
		state.tutorial = createTutorialState(tutorial);
		const n = partySize(state);
		for (let i = 0; i < n; i++) {
			const p = playerAt(state, i);
			p.hearts = tutorialStartHalfHearts(tutorial, p.heartsMax);
		}
	}
	// Breakables (endless: floor 1's pieces; else config.breakables.pieces). No rng.
	const breakables = config.breakables;
	if (breakables !== undefined) {
		const list = firstFloor !== undefined ? firstFloor.breakables : breakables.pieces;
		state.breakables = createBreakablesState(breakables, list ?? []);
	}
	// Spawns the encounter (archetype init hooks may draw from the sim rng) and the stress emitter.
	startCombat(state, world);
	// After the spawns (scoring's room records read them; endless floors: the floor's deferred room spawns). No rng.
	if (config.scoring !== undefined) {
		state.score = createScoreState(state, config.scoring, world.encounter, firstFloor?.roomSpawns);
	}
	// Endless runs: boons, relics and curses (floor 1's pedestals and shrine). No rng.
	if (firstFloor !== undefined) state.run = createRunState(world.encounter, partySize(state));
	return state;
}

/**
 * An independent copy of `s`. LIMITED: the bullet pools can only be rebuilt while pristine (no bullet ever spawned in
 * this run); once any bullet has been spawned this THROWS. Re-simulate from the recording instead.
 */
function cloneRun(r: Readonly<RunState>): RunState {
	const out = cloneRunState(r);
	for (const p of out.players) refreshRunMods(p);
	return out;
}

export function cloneSimState(s: Readonly<SimState>): SimState {
	const clone: SimState = {
		tick: s.tick,
		rngState: s.rngState,
		player: { ...s.player },
		events: { ...s.events },
		combat: cloneCombatState(s.combat),
		endless: s.endless !== undefined ? cloneEndlessState(s.endless) : undefined,
		score: s.score !== undefined ? cloneScoreState(s.score) : undefined,
		run: s.run !== undefined ? cloneRun(s.run) : undefined,
		tutorial: s.tutorial !== undefined ? cloneTutorialState(s.tutorial) : undefined,
		breakables: s.breakables !== undefined ? cloneBreakablesState(s.breakables) : undefined,
	};
	if (s.party !== undefined) clone.party = cloneParty(s.party, clone);
	return clone;
}

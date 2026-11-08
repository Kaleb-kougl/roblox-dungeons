/**
 * Player simulation (E1.5; source: `src/sim/player.ts`): movement, facing, dodge roll, hearts and armor, flask, Ember,
 * death. Deterministic, no trig, no randomness outside rng.ts, input is the only input. Gameplay numbers live in
 * playerData.ts; every duration is an integer tick counter.
 *
 * stepPlayer order (fixed; part of the determinism contract):
 *   1. prevX/prevZ = x/z
 *   2. dead -> remember buttons, stop (no movement, no actions, no timers)
 *   3. count down timers: rollTicks, iframeTicks, hurtTicks, flaskTicks
 *   4. press edges (input.buttons vs prevButtons): ROLL, EMBER, FLASK
 *   5. movement: the roll (locked direction) or walking (halved while drinking), via config.moveResolver
 *   6. facing: aim, else movement (the roll direction while rolling), else unchanged
 *   7. DEBUG_HIT press edge -> damagePlayer(state, HIT_NORMAL) (last, like a hit from stepCombat)
 *   8. prevButtons = input.buttons
 */

import { jsMax, jsMin } from "shared/jsmath";
import { SQRT1_2 } from "./jsnum";
import { SIM_DT } from "./units";
import { solidCells } from "./breakables/cells";
import { AXIS_MAX, Button, type InputFrame } from "./input";
import {
	EMBERS_PER_AREA,
	EMBER_IFRAME_TICKS,
	FLASK_CHARGES,
	FLASK_HEAL_HALF_HEARTS,
	FLASK_MOVE_MULTIPLIER,
	FLASK_USE_TICKS,
	HIT_NORMAL,
	HURT_INVULN_TICKS,
	MAX_MOVE_STEP,
	PLAYER_SPEED,
	ROLL_DASH_TICKS,
	ROLL_IFRAME_TICKS,
	ROLL_RECOVERY_SPEED,
	ROLL_SPEED,
	ROLL_TICKS,
	START_ARMOR,
	START_ARMOR_MAX,
	START_HALF_HEARTS,
} from "./playerData";
import type { PlayerState, SimState } from "./state";
import type { SimConfig } from "./step";
import { weaponMoveMultiplier } from "./combat/weapons/weapons";
import { buildsOnArmorBreak } from "./builds/hooks";
import { buildsRollSmash } from "./builds/wrecker";
import { SOLO_PLAYER, rollIframeTicks, runOnPlayerHit, runSecondWind, scalePercent } from "./progression/runMods";
import { absorbWithAegis, boostWalkPercent, boostsOnPlayerDied } from "./drops/boostMods";
import type { WeaponsState } from "./combat/weapons/types";
import { tutorialStartHalfHearts } from "./tutorial/tutorial";
import { devBlocksHit } from "./dev/dev";

export { PLAYER_SPEED } from "./playerData";

/** Walk distance per tick (PLAYER_SPEED * SIM_DT; constants.json `derived`). */
export const WALK_STEP = PLAYER_SPEED * SIM_DT;
/** Roll dash distance per tick (ROLL_SPEED * SIM_DT). */
export const ROLL_DASH_STEP = ROLL_SPEED * SIM_DT;
/** Roll recovery distance per tick (ROLL_RECOVERY_SPEED * SIM_DT). */
export const ROLL_RECOVERY_STEP = ROLL_RECOVERY_SPEED * SIM_DT;
/** A walk tick (exactly MAX_MOVE_STEP up to rounding) stays one resolver call. */
export const STEP_TOLERANCE = MAX_MOVE_STEP * (1 + 1e-9);

function clamp(v: number, lo: number, hi: number): number {
	return v < lo ? lo : v > hi ? hi : v;
}

function pressed(prevButtons: number, buttons: number, bit: number): boolean {
	return bit32.band(buttons, bit) !== 0 && bit32.band(prevButtons, bit) === 0;
}

/**
 * A fresh player at (x, z): full hearts, armor, flask and Embers, facing the camera (screen-down) until there is input.
 * createSimState builds player 0 (state.player) and every co-op party member (party.ts) with it.
 */
export function newPlayerState(x: number, z: number): PlayerState {
	return {
		x,
		z,
		prevX: x,
		prevZ: z,
		faceX: SQRT1_2,
		faceZ: SQRT1_2,
		hearts: START_HALF_HEARTS,
		heartsMax: START_HALF_HEARTS,
		armor: START_ARMOR,
		armorMax: START_ARMOR_MAX,
		flask: FLASK_CHARGES,
		flaskMax: FLASK_CHARGES,
		embers: EMBERS_PER_AREA,
		emberMax: EMBERS_PER_AREA,
		rollTicks: 0,
		rollDirX: 0,
		rollDirZ: 0,
		iframeTicks: 0,
		hurtTicks: 0,
		flaskTicks: 0,
		prevButtons: 0,
		dead: 0,
	};
}

/**
 * Moves a player by (dx, dz) through the world: config.moveResolver in equal sub-steps of at most MAX_MOVE_STEP
 * (the roll moves ~0.18 per tick), else the bounds clamp, else free. Exported for weapons (the sword's lunge).
 * `p` defaults to player 0 (state.player); co-op weapons pass the acting player (ctx.player).
 */
export function movePlayer(
	state: SimState,
	dx: number,
	dz: number,
	config: Readonly<SimConfig>,
	p: PlayerState = state.player,
): void {
	if (dx === 0 && dz === 0) return;
	const resolver = config.moveResolver;
	const b = config.bounds;
	if (resolver !== undefined) {
		const len = math.sqrt(dx * dx + dz * dz);
		const n = len <= STEP_TOLERANCE ? 1 : math.ceil(len / MAX_MOVE_STEP);
		const sx = dx / n;
		const sz = dz / n;
		const solid = solidCells(state); // intact breakables (docs/DECOR.md D4); undefined: the grid-only path
		for (let i = 0; i < n; i++) {
			const r = resolver(p.x, p.z, sx, sz, solid);
			p.x = r.x;
			p.z = r.z;
		}
	} else if (b !== undefined) {
		p.x = clamp(p.x + dx, b.minX, b.maxX);
		p.z = clamp(p.z + dz, b.minZ, b.maxZ);
	} else {
		p.x += dx;
		p.z += dz;
	}
}

/**
 * One tick of player logic. Called by step() before stepCombat(). `p` / `weapons` default to player 0's (state.player,
 * state.combat.weapons); a co-op step (stepParty) calls it once per player, in player index order, with that player's
 * `playerIndex` (their M2 run modifiers: Slippery's i-frames, the Hourglass / Second Wind of a debug hit).
 */
export function stepPlayer(
	state: SimState,
	input: Readonly<InputFrame>,
	config: Readonly<SimConfig>,
	p: PlayerState = state.player,
	weapons: Readonly<WeaponsState> = state.combat.weapons,
	playerIndex: number = SOLO_PLAYER,
): void {
	p.prevX = p.x;
	p.prevZ = p.z;
	const buttons = input.buttons;
	const prevButtons = p.prevButtons;

	if (p.dead !== 0) {
		p.prevButtons = buttons;
		return;
	}

	// Timers: whole ticks, counted down first, so a value set during tick T covers T itself.
	if (p.rollTicks > 0) p.rollTicks--;
	if (p.iframeTicks > 0) p.iframeTicks--;
	if (p.hurtTicks > 0) p.hurtTicks--;
	if (p.flaskTicks > 0) p.flaskTicks--;

	// Move input: dequantize and clamp to unit length.
	let mx = input.moveX / AXIS_MAX;
	let mz = input.moveZ / AXIS_MAX;
	const moveLen2 = mx * mx + mz * mz;
	if (moveLen2 > 1) {
		const inv = 1 / math.sqrt(moveLen2);
		mx *= inv;
		mz *= inv;
	}

	// Dodge roll: press edge, not already rolling. Direction = move input, else facing; locked for the roll.
	if (pressed(prevButtons, buttons, Button.ROLL) && p.rollTicks === 0) {
		if (input.moveX !== 0 || input.moveZ !== 0) {
			const inv = 1 / math.sqrt(input.moveX * input.moveX + input.moveZ * input.moveZ);
			p.rollDirX = input.moveX * inv;
			p.rollDirZ = input.moveZ * inv;
		} else {
			p.rollDirX = p.faceX;
			p.rollDirZ = p.faceZ;
		}
		p.rollTicks = ROLL_TICKS;
		// M2 Slippery (endless runs): longer i-frames; ROLL_IFRAME_TICKS itself otherwise.
		const iframes = rollIframeTicks(state, playerIndex, ROLL_IFRAME_TICKS);
		if (p.iframeTicks < iframes) p.iframeTicks = iframes;
		state.events.rollStarted = 1;
	}

	// Ember: press edge, one left. stepCombat clears enemy bullets when it sees events.emberUsed.
	if (pressed(prevButtons, buttons, Button.EMBER) && p.embers > 0) {
		p.embers--;
		state.events.emberUsed = 1;
		if (p.iframeTicks < EMBER_IFRAME_TICKS) p.iframeTicks = EMBER_IFRAME_TICKS;
	}

	// Flask: press edge, a charge left, not at full health, not already drinking. Heals at once, then slows walking.
	if (pressed(prevButtons, buttons, Button.FLASK) && p.flask > 0 && p.hearts < p.heartsMax && p.flaskTicks === 0) {
		p.flask--;
		p.hearts = jsMin(p.heartsMax, p.hearts + FLASK_HEAL_HALF_HEARTS);
		p.flaskTicks = FLASK_USE_TICKS;
		state.events.flaskUsed = 1;
	}

	// Movement.
	if (p.rollTicks > 0) {
		const elapsed = ROLL_TICKS - p.rollTicks; // 0 on the tick the roll starts
		const dist = elapsed < ROLL_DASH_TICKS ? ROLL_DASH_STEP : ROLL_RECOVERY_STEP;
		// Builds v2 (BV5): Wrecker's roll smash breaks the pieces this step touches before the move (a leaf hook).
		if (state.builds !== undefined)
			buildsRollSmash(state, playerIndex, p.x, p.z, p.rollDirX * dist, p.rollDirZ * dist);
		movePlayer(state, p.rollDirX * dist, p.rollDirZ * dist, config, p);
	} else {
		// E1.8: the weapon in hand may slow walking (e.g. a bow while charging); 1 otherwise.
		const base = (p.flaskTicks > 0 ? WALK_STEP * FLASK_MOVE_MULTIPLIER : WALK_STEP) * weaponMoveMultiplier(weapons);
		// Quickstep (docs/BOOSTS.md): x 130 % (exactly `base` without it); movePlayer splits a longer walk tick into
		// equal sub-steps of at most MAX_MOVE_STEP.
		const walk = scalePercent(base, boostWalkPercent(state, playerIndex));
		movePlayer(state, mx * walk, mz * walk, config, p);
	}

	// Facing: aim wins, else movement (the locked roll direction while rolling), else keep the previous facing.
	if (input.aimX !== 0 || input.aimZ !== 0) {
		const inv = 1 / math.sqrt(input.aimX * input.aimX + input.aimZ * input.aimZ);
		p.faceX = input.aimX * inv;
		p.faceZ = input.aimZ * inv;
	} else if (p.rollTicks > 0) {
		p.faceX = p.rollDirX;
		p.faceZ = p.rollDirZ;
	} else if (input.moveX !== 0 || input.moveZ !== 0) {
		const inv = 1 / math.sqrt(input.moveX * input.moveX + input.moveZ * input.moveZ);
		p.faceX = input.moveX * inv;
		p.faceZ = input.moveZ * inv;
	}

	// Debug hit (K): goes through the sim input, so replays reproduce it. Handled last, like a stepCombat hit.
	if (pressed(prevButtons, buttons, Button.DEBUG_HIT)) damagePlayer(state, HIT_NORMAL, p, playerIndex);

	p.prevButtons = buttons;
}

/** True while damagePlayer() would ignore a hit: dead, dodge i-frames, or post-hit invulnerability. */
export function isPlayerInvulnerable(state: Readonly<SimState>, p: Readonly<PlayerState> = state.player): boolean {
	return p.dead !== 0 || p.iframeTicks > 0 || p.hurtTicks > 0;
}

/**
 * The ONE way anything damages the player (bullets, contact, hazards). Amount is in half hearts (HIT_NORMAL = 1,
 * HIT_HEAVY = 2; the caller decides).
 *
 * Ignored (returns false, changes nothing) while dead, during dodge i-frames (roll, Ember), during post-hit
 * invulnerability, or for a non-positive / NaN amount. Otherwise the hit lands (returns true):
 *  - an Aegis pip (boost drops, docs/BOOSTS.md), else one armor pip absorbs the whole hit if any are left, else
 *    `halfHearts` come off hearts (floored at 0),
 *  - events.playerHits += 1,
 *  - post-hit invulnerability starts (HURT_INVULN_TICKS),
 *  - at 0 hearts the player dies: dead = 1, roll/flask/i-frames end, events.playerDied = 1, their boosts end (M2
 *    Second Wind, endless runs: once per floor the player keeps SECOND_WIND_HALF_HEARTS instead),
 *  - M2 Hourglass (endless runs): the landed hit starts the enemy bullet slow.
 * Developer mode's god mode (SimConfig.dev, dev/dev.ts: state.dev.invulnerable): returns false and nothing changes but
 * dev.blockedHits += 1.
 * Tutorial harmless mode (SimConfig.tutorial.harmless, tutorial/tutorial.ts): a landed hit still counts in
 * events.playerHits, starts the post-hit invulnerability and runs the on-hit hooks (Hourglass; the score's combo cut
 * reads playerHits), and tutorial.harmlessHits += 1; armor, hearts, Second Wind and death are skipped. Returns true.
 * `p` defaults to player 0 (state.player). Co-op: every party member's hits come through here with their own state
 * (per-player armor, hearts, i-frames, post-hit invulnerability) and `playerIndex` (= p's index: whose Second Wind /
 * Hourglass); events count hits / deaths of the whole party.
 */
export function damagePlayer(
	state: SimState,
	halfHearts: number,
	p: PlayerState = state.player,
	playerIndex: number = SOLO_PLAYER,
): boolean {
	if (!(halfHearts > 0)) return false;
	if (isPlayerInvulnerable(state, p)) return false;
	// Developer mode's god mode (docs/DEV_MODE.md): the hit never lands (counted in dev.blockedHits).
	if (devBlocksHit(state)) return false;

	const tutorial = state.tutorial;
	if (tutorial !== undefined && tutorial.harmless !== 0) {
		state.events.playerHits += 1;
		p.hurtTicks = HURT_INVULN_TICKS;
		runOnPlayerHit(state, playerIndex);
		tutorial.harmlessHits += 1;
		return true;
	}

	// Aegis (docs/BOOSTS.md): its pip absorbs the whole hit before armor and hearts.
	if (!absorbWithAegis(state, playerIndex)) {
		if (p.armor > 0) {
			p.armor--;
			// Builds (docs/BUILDS.md BU5, opt-in): Bulwark's nova (released by stepBuilds).
			if (state.builds !== undefined) buildsOnArmorBreak(state, playerIndex);
		} else p.hearts = jsMax(0, p.hearts - halfHearts);
	}
	state.events.playerHits += 1;
	p.hurtTicks = HURT_INVULN_TICKS;
	runOnPlayerHit(state, playerIndex);

	if (p.hearts <= 0) {
		const kept = runSecondWind(state, playerIndex);
		if (kept > 0) {
			p.hearts = kept;
			return true;
		}
		killPlayerState(p);
		state.events.playerDied = 1;
		boostsOnPlayerDied(state, playerIndex);
	}
	return true;
}

/** Death bookkeeping (no event): hearts 0, dead = 1, roll / i-frames / drinking / invulnerability end. */
export function killPlayerState(p: PlayerState): void {
	p.hearts = 0;
	p.dead = 1;
	p.rollTicks = 0;
	p.iframeTicks = 0;
	p.flaskTicks = 0;
	p.hurtTicks = 0;
}

/**
 * Brings the player back at (x, z) (retry / checkpoint respawn; nothing calls it automatically): alive, full hearts,
 * armor / flask / Embers refilled, roll, i-frames, invulnerability and drinking cleared, facing reset to screen-down.
 * Keeps tick, rng, prevButtons and the maxima.
 */
export function respawnPlayer(state: SimState, x: number, z: number): void {
	const p = state.player;
	p.x = x;
	p.z = z;
	p.prevX = x;
	p.prevZ = z;
	p.faceX = SQRT1_2;
	p.faceZ = SQRT1_2;
	p.hearts = p.heartsMax;
	p.armor = p.armorMax;
	p.flask = p.flaskMax;
	p.embers = p.emberMax;
	p.rollTicks = 0;
	p.rollDirX = 0;
	p.rollDirZ = 0;
	p.iframeTicks = 0;
	p.hurtTicks = 0;
	p.flaskTicks = 0;
	p.dead = 0;
}

/**
 * Checkpoint refill: armor, flask and Embers to their maxima. Does not heal, revive, or touch position and timers.
 * `p` defaults to player 0 (state.player).
 */
export function refillAtCheckpoint(state: SimState, p: PlayerState = state.player): void {
	p.armor = p.armorMax;
	p.flask = p.flaskMax;
	p.embers = p.emberMax;
}

/** Hash fields for player state (player 0), in fixed order. Append only (and append to PLAYER_HASH_FIELDS with it). */
export function writePlayerHash(state: Readonly<SimState>, out: number[]): void {
	writePlayerStateHash(state.player, out);
}

/** writePlayerHash for any PlayerState (co-op party members are hashed with it in the "party" group). */
export function writePlayerStateHash(p: Readonly<PlayerState>, out: number[]): void {
	out.push(p.x, p.z, p.prevX, p.prevZ, p.faceX, p.faceZ);
	// E1.5
	out.push(
		p.hearts,
		p.heartsMax,
		p.armor,
		p.armorMax,
		p.flask,
		p.flaskMax,
		p.embers,
		p.emberMax,
		p.rollTicks,
		p.rollDirX,
		p.rollDirZ,
		p.iframeTicks,
		p.hurtTicks,
		p.flaskTicks,
		p.prevButtons,
		p.dead,
	);
}

/** PlayerState field names in writePlayerHash order (dumps use `player.<name>`). */
export const PLAYER_HASH_FIELDS = [
	"x",
	"z",
	"prevX",
	"prevZ",
	"faceX",
	"faceZ",
	"hearts",
	"heartsMax",
	"armor",
	"armorMax",
	"flask",
	"flaskMax",
	"embers",
	"emberMax",
	"rollTicks",
	"rollDirX",
	"rollDirZ",
	"iframeTicks",
	"hurtTicks",
	"flaskTicks",
	"prevButtons",
	"dead",
] as const;

/**
 * The half hearts every player starts a run of `config` with (what createSimState gives a fresh player):
 * START_HALF_HEARTS, or the tutorial's start (tutorialStartHalfHearts). RunTelemetry's baseline, so a wounded tutorial
 * start is not logged as hearts lost on tick 1.
 */
export function runStartHalfHearts(config: Readonly<SimConfig>): number {
	const t = config.tutorial;
	return t !== undefined ? tutorialStartHalfHearts(t, START_HALF_HEARTS) : START_HALF_HEARTS;
}

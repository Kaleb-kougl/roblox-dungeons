/**
 * The first-run tutorial's sim side (docs/TUTORIAL.md "Architecture §1"; a Roblox-port feature, no web source).
 * Opt-in: only a SimConfig with `tutorial` creates `SimState.tutorial`, and only then does the hash grow the appended
 * "tutorial" group (after "party"; only "breakables", which a tutorial run never has, comes after it). Without it
 * nothing changes: every golden fixture, every solo, endless and party hash is byte-identical.
 *
 * What it does (createSimState, player.ts damagePlayer):
 *   start hearts  with `startHalfHearts`, every player (solo, and every party member) starts with that many half
 *                 hearts, clamped to [TUTORIAL_MIN_START_HALF_HEARTS, heartsMax]; heartsMax is unchanged, so the
 *                 flask heals back up. Floor changes keep hearts (refillAtCheckpoint never heals).
 *   harmless      a hit that lands (after damagePlayer's amount and isPlayerInvulnerable checks) does everything a
 *                 real hit does (events.playerHits, post-hit invulnerability, runOnPlayerHit: Hourglass; the score's
 *                 combo cut reads playerHits) EXCEPT armor, hearts, Second Wind and death; `harmlessHits` counts it.
 *                 damagePlayer still returns true, so bullets are consumed exactly as in a real run.
 *   scaling       endless enemy hp and bullet speed scale as on floor TUTORIAL_SCALING_FLOOR whatever the floor
 *                 (tutorialScalingFloor: spawnActor, SimCtx.fireEnemy), so the floor-2 boss is Depth 1 / floor 1's.
 *
 * A leaf module: it imports only types and its data, so player.ts and state.ts can import it without a require cycle.
 * The tutorial SCRIPT (prompts, step completion) lives outside the sim, so rewording it never touches replays.
 */
import { jsMax, jsMin } from "shared/jsmath";
import { isIntegerNumber } from "../jsnum";
import type { SimState } from "../state";
import { TUTORIAL_MIN_START_HALF_HEARTS, TUTORIAL_SCALING_FLOOR } from "./tutorialData";

/** SimConfig.tutorial. */
export interface TutorialSimConfig {
	/** Hits land (events, hurtTicks, combo cut, on-hit hooks) but never remove armor or hearts, and never kill. */
	readonly harmless: boolean;
	/**
	 * Hearts at run start (half hearts) for every player, clamped to [TUTORIAL_MIN_START_HALF_HEARTS, heartsMax];
	 * absent: START_HALF_HEARTS (full). Lets the flask lesson work (TUTORIAL_START_HALF_HEARTS). An integer.
	 */
	readonly startHalfHearts?: number;
}

/** SimState.tutorial (only with SimConfig.tutorial). Plain numbers; hashed as the "tutorial" group. */
export interface TutorialState {
	/** 1 when hits are harmless (TutorialSimConfig.harmless), else 0. Fixed for the run. */
	harmless: number;
	/** Hits that landed harmlessly so far (any player). */
	harmlessHits: number;
}

/** Tutorial state at run start. Throws on a non-integer startHalfHearts. */
export function createTutorialState(config: Readonly<TutorialSimConfig>): TutorialState {
	const start = config.startHalfHearts;
	if (start !== undefined && !isIntegerNumber(start)) {
		error(`tutorial: startHalfHearts must be an integer, got ${tostring(start)}`, 0);
	}
	return { harmless: config.harmless ? 1 : 0, harmlessHits: 0 };
}

export function cloneTutorialState(t: Readonly<TutorialState>): TutorialState {
	return { ...t };
}

/**
 * The start hearts for a player with `heartsMax`: startHalfHearts clamped to [TUTORIAL_MIN_START_HALF_HEARTS,
 * heartsMax], or `heartsMax` without it.
 */
export function tutorialStartHalfHearts(config: Readonly<TutorialSimConfig>, heartsMax: number): number {
	const start = config.startHalfHearts;
	if (start === undefined) return heartsMax;
	return jsMin(heartsMax, jsMax(TUTORIAL_MIN_START_HALF_HEARTS, start));
}

/**
 * The floor endless scaling (enemy hp, enemy bullet speed) reads: TUTORIAL_SCALING_FLOOR in a tutorial run, else
 * `floor`. Reads only hashed state (state.tutorial exists for the whole run or never).
 */
export function tutorialScalingFloor(state: Readonly<SimState>, floor: number): number {
	return state.tutorial !== undefined ? TUTORIAL_SCALING_FLOOR : floor;
}

/** True when the run is a tutorial with harmless hits (damagePlayer's branch). */
export function isTutorialHarmless(state: Readonly<SimState>): boolean {
	const t = state.tutorial;
	return t !== undefined && t.harmless !== 0;
}

// ---------------------------------------------------------------------------------------------
// Hash: the "tutorial" group, appended LAST (after party) only when state.tutorial exists.

/** writeTutorialHash order (dump names `tutorial.<name>`). Append only. */
export const TUTORIAL_HASH_FIELDS = ["harmless", "harmlessHits"] as const;

export function writeTutorialHash(t: Readonly<TutorialState>, out: number[]): void {
	for (const f of TUTORIAL_HASH_FIELDS) out.push(t[f]);
}

/** Dump names for writeTutorialHash (`tutorial.harmless`, `tutorial.harmlessHits`). */
export function tutorialHashNames(out: string[]): void {
	for (const f of TUTORIAL_HASH_FIELDS) out.push(`tutorial.${f}`);
}

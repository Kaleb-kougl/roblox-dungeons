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
 *   boss hp       with `bossHpPercent`, a boss archetype (data.boss) spawns with that percent of the hp it would
 *                 have (tutorialBossHp: spawnActor, after the endless and party scaling), so the practice boss falls
 *                 fast. Phase marks are fractions of hpMax, so every phase still plays. Absent: 100 (no change).
 *   guard lock    with `guardLock` (the block lesson): the actors spawned when room `room` of floor `floor` is first
 *                 entered (endless.ts enterRoom -> tutorialOnRoomSpawned) are held at TUTORIAL_GUARD_HOLD_HP
 *                 (damageActor -> tutorialHeldDamage: the hit lands, flashes and calls onHit, only the hp stops) until
 *                 a sword guard erases an enemy bullet (sword.ts -> tutorialOnGuardCancels), so the room cannot be
 *                 cleared without a block. Absent: no lock (no change).
 *
 * A leaf module: it imports only types and its data, so player.ts and state.ts can import it without a require cycle.
 * The tutorial SCRIPT (prompts, step completion) lives outside the sim, so rewording it never touches replays.
 */
import { jsMax, jsMin } from "shared/jsmath";
import { isIntegerNumber } from "../jsnum";
import type { SimState } from "../state";
import type { ActorState } from "../combat/actors/types";
import {
	GUARD_LOCK_ARMED,
	GUARD_LOCK_RELEASED,
	GUARD_LOCK_WAITING,
	NO_GUARD_LOCK_FLOOR,
	NO_GUARD_LOCK_ROOM,
	TUTORIAL_FULL_BOSS_HP_PERCENT,
	TUTORIAL_GUARD_HOLD_HP,
	TUTORIAL_MIN_START_HALF_HEARTS,
	TUTORIAL_SCALING_FLOOR,
} from "./tutorialData";

/** SimConfig.tutorial. */
export interface TutorialSimConfig {
	/** Hits land (events, hurtTicks, combo cut, on-hit hooks) but never remove armor or hearts, and never kill. */
	readonly harmless: boolean;
	/**
	 * Hearts at run start (half hearts) for every player, clamped to [TUTORIAL_MIN_START_HALF_HEARTS, heartsMax];
	 * absent: START_HALF_HEARTS (full). Lets the flask lesson work (TUTORIAL_START_HALF_HEARTS). An integer.
	 */
	readonly startHalfHearts?: number;
	/**
	 * A boss's hp at spawn, percent of what it would have (TUTORIAL_FULL_BOSS_HP_PERCENT = 100 when absent); an integer
	 * >= 1. Only bosses (ArchetypeData.boss); every other actor is unchanged.
	 */
	readonly bossHpPercent?: number;
	/**
	 * The block lesson's room (floor, room id; integers, floor >= 1, room >= 0): its enemies cannot die until a player
	 * has blocked a bullet with the sword's guard. Absent: no lock.
	 */
	readonly guardLock?: TutorialGuardLock;
}

/** TutorialSimConfig.guardLock. */
export interface TutorialGuardLock {
	readonly floor: number;
	readonly room: number;
}

/** SimState.tutorial (only with SimConfig.tutorial). Plain numbers; hashed as the "tutorial" group. */
export interface TutorialState {
	/** 1 when hits are harmless (TutorialSimConfig.harmless), else 0. Fixed for the run. */
	harmless: number;
	/** Hits that landed harmlessly so far (any player). */
	harmlessHits: number;
	/** TutorialSimConfig.bossHpPercent (TUTORIAL_FULL_BOSS_HP_PERCENT when absent). Fixed for the run. */
	bossHpPercent: number;
	/** TutorialSimConfig.guardLock's floor (NO_GUARD_LOCK_FLOOR without one). Fixed for the run. */
	guardLockFloor: number;
	/** TutorialSimConfig.guardLock's room id (NO_GUARD_LOCK_ROOM without one). Fixed for the run. */
	guardLockRoom: number;
	/** GUARD_LOCK_WAITING / ARMED / RELEASED. */
	guardLock: number;
	/** The held actors: ids in [guardLockFirstId, guardLockEndId) (both 0 until armed; one spawn's ids are consecutive). */
	guardLockFirstId: number;
	guardLockEndId: number;
}

/** Tutorial state at run start. Throws on a non-integer startHalfHearts or a bossHpPercent that is not an integer >= 1. */
export function createTutorialState(config: Readonly<TutorialSimConfig>): TutorialState {
	const start = config.startHalfHearts;
	if (start !== undefined && !isIntegerNumber(start)) {
		error(`tutorial: startHalfHearts must be an integer, got ${tostring(start)}`, 0);
	}
	const bossHpPercent = config.bossHpPercent ?? TUTORIAL_FULL_BOSS_HP_PERCENT;
	if (!isIntegerNumber(bossHpPercent) || bossHpPercent < 1) {
		error(`tutorial: bossHpPercent must be an integer >= 1, got ${tostring(bossHpPercent)}`, 0);
	}
	const lock = config.guardLock;
	if (lock !== undefined) {
		if (!isIntegerNumber(lock.floor) || lock.floor < 1 || !isIntegerNumber(lock.room) || lock.room < 0) {
			error(
				`tutorial: guardLock needs an integer floor >= 1 and room >= 0, got ${tostring(
					lock.floor,
				)} / ${tostring(lock.room)}`,
				0,
			);
		}
	}
	return {
		harmless: config.harmless ? 1 : 0,
		harmlessHits: 0,
		bossHpPercent,
		guardLockFloor: lock !== undefined ? lock.floor : NO_GUARD_LOCK_FLOOR,
		guardLockRoom: lock !== undefined ? lock.room : NO_GUARD_LOCK_ROOM,
		guardLock: GUARD_LOCK_WAITING,
		guardLockFirstId: 0,
		guardLockEndId: 0,
	};
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

/**
 * A boss's spawn hp `hp` in this run: hp x bossHpPercent / 100 in a tutorial run with a bossHpPercent other than 100,
 * else `hp` exactly. Reads only hashed state.
 */
export function tutorialBossHp(state: Readonly<SimState>, hp: number): number {
	const t = state.tutorial;
	if (t === undefined || t.bossHpPercent === TUTORIAL_FULL_BOSS_HP_PERCENT) return hp;
	return (hp * t.bossHpPercent) / TUTORIAL_FULL_BOSS_HP_PERCENT;
}

// ---------------------------------------------------------------------------------------------
// Guard lock (the block lesson)

/**
 * endless.ts enterRoom, after the room's deferred spawns: on the lock's floor and room while WAITING, arms the lock on
 * `spawned` (their ids are consecutive: one spawnAll); a room that spawned nothing releases it (nothing to hold).
 */
export function tutorialOnRoomSpawned(
	state: SimState,
	floor: number,
	roomId: number,
	spawned: ReadonlyArray<ActorState>,
): void {
	const t = state.tutorial;
	if (t === undefined || t.guardLock !== GUARD_LOCK_WAITING || t.guardLockFloor === NO_GUARD_LOCK_FLOOR) return;
	if (floor !== t.guardLockFloor || roomId !== t.guardLockRoom) return;
	if (spawned.size() === 0) {
		t.guardLock = GUARD_LOCK_RELEASED;
		return;
	}
	let first = spawned[0].id;
	let last = first;
	for (const a of spawned) {
		if (a.id < first) first = a.id;
		if (a.id > last) last = a.id;
	}
	t.guardLock = GUARD_LOCK_ARMED;
	t.guardLockFirstId = first;
	t.guardLockEndId = last + 1;
}

/** sword.ts guard sweep: `n` enemy bullets erased this tick. Any block while ARMED releases the lock for good. */
export function tutorialOnGuardCancels(state: SimState, n: number): void {
	const t = state.tutorial;
	if (t !== undefined && n > 0 && t.guardLock === GUARD_LOCK_ARMED) t.guardLock = GUARD_LOCK_RELEASED;
}

function isHeld(t: Readonly<TutorialState>, a: Readonly<ActorState>): boolean {
	return t.guardLock === GUARD_LOCK_ARMED && a.id >= t.guardLockFirstId && a.id < t.guardLockEndId;
}

/**
 * damageActor: the hp a hit of `dmg` (> 0, already <= a.hp) may remove from `a`: `dmg` exactly, except for a held
 * actor (lock ARMED, one of the lock room's spawns), which keeps at least TUTORIAL_GUARD_HOLD_HP. Reads hashed state.
 */
export function tutorialHeldDamage(state: Readonly<SimState>, a: Readonly<ActorState>, dmg: number): number {
	const t = state.tutorial;
	if (t === undefined || !isHeld(t, a)) return dmg;
	const room = a.hp - TUTORIAL_GUARD_HOLD_HP;
	if (room <= 0) return 0;
	return dmg < room ? dmg : room;
}

/** True while some living held actor stands at (or below) TUTORIAL_GUARD_HOLD_HP: it waits for a block (the HUD). */
export function isTutorialGuardHolding(state: Readonly<SimState>): boolean {
	const t = state.tutorial;
	if (t === undefined || t.guardLock !== GUARD_LOCK_ARMED) return false;
	for (const a of state.combat.actors) {
		if (a.alive !== 0 && isHeld(t, a) && a.hp <= TUTORIAL_GUARD_HOLD_HP) return true;
	}
	return false;
}

/** True once the guard lock was released (a block landed, or the room spawned nothing). */
export function isTutorialGuardReleased(state: Readonly<SimState>): boolean {
	return state.tutorial?.guardLock === GUARD_LOCK_RELEASED;
}

/** True when the run is a tutorial with harmless hits (damagePlayer's branch). */
export function isTutorialHarmless(state: Readonly<SimState>): boolean {
	const t = state.tutorial;
	return t !== undefined && t.harmless !== 0;
}

// ---------------------------------------------------------------------------------------------
// Hash: the "tutorial" group, appended LAST (after party) only when state.tutorial exists.

/** writeTutorialHash order (dump names `tutorial.<name>`). Append only. */
export const TUTORIAL_HASH_FIELDS = [
	"harmless",
	"harmlessHits",
	"bossHpPercent",
	"guardLockFloor",
	"guardLockRoom",
	"guardLock",
	"guardLockFirstId",
	"guardLockEndId",
] as const;

export function writeTutorialHash(t: Readonly<TutorialState>, out: number[]): void {
	for (const f of TUTORIAL_HASH_FIELDS) out.push(t[f]);
}

/** Dump names for writeTutorialHash (`tutorial.<field>`, TUTORIAL_HASH_FIELDS order). */
export function tutorialHashNames(out: string[]): void {
	for (const f of TUTORIAL_HASH_FIELDS) out.push(`tutorial.${f}`);
}

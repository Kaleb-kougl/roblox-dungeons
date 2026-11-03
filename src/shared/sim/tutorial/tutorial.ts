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
 *   pellet lock   with `pelletLock` (the pellet lesson, docs/PELLETS.md PL12 / PD14): its twin. The actors spawned when
 *                 room `room` of floor `floor` is first entered are held at the same hold hp (TUTORIAL_GUARD_HOLD_HP,
 *                 the same tutorialHeldDamage path) while any regular pellet of that room is untaken; stepPellets
 *                 releases it on the room's last pickup (tutorialOnPelletsSwept). A room that spawned nothing, or whose
 *                 pellets are all taken (or that has none) when it spawns, releases it at once. stepCombat runs before
 *                 stepPellets, so on the tick of the last pickup a hit still stops at the hold hp and the kill comes on a
 *                 later tick: the room's clear always pays its Sweep. Absent: no lock (no change).
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
	NO_PELLET_LOCK_FLOOR,
	NO_PELLET_LOCK_ROOM,
	PELLET_LOCK_ARMED,
	PELLET_LOCK_RELEASED,
	PELLET_LOCK_WAITING,
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
	/**
	 * The pellet lesson's room (floor, room id; integers, floor >= 1, room >= 0): its enemies cannot die while any of the
	 * room's regular pellets is untaken (docs/PELLETS.md PL12). Needs SimConfig.pellets to hold anything (without pellets
	 * the room has none, and the lock releases when it spawns). Absent: no lock.
	 */
	readonly pelletLock?: TutorialPelletLock;
}

/** TutorialSimConfig.guardLock. */
export interface TutorialGuardLock {
	readonly floor: number;
	readonly room: number;
}

/** TutorialSimConfig.pelletLock. */
export interface TutorialPelletLock {
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
	/** TutorialSimConfig.pelletLock's floor (NO_PELLET_LOCK_FLOOR without one). Fixed for the run. */
	pelletLockFloor: number;
	/** TutorialSimConfig.pelletLock's room id (NO_PELLET_LOCK_ROOM without one). Fixed for the run. */
	pelletLockRoom: number;
	/** PELLET_LOCK_WAITING / ARMED / RELEASED. */
	pelletLock: number;
	/** The held actors: ids in [pelletLockFirstId, pelletLockEndId) (both 0 until armed). */
	pelletLockFirstId: number;
	pelletLockEndId: number;
}

/** Throws unless `lock` (a TutorialSimConfig room lock named `name`) has an integer floor >= 1 and room >= 0. */
function checkLock(name: string, lock: Readonly<TutorialGuardLock> | undefined): void {
	if (lock === undefined) return;
	if (!isIntegerNumber(lock.floor) || lock.floor < 1 || !isIntegerNumber(lock.room) || lock.room < 0) {
		error(
			`tutorial: ${name} needs an integer floor >= 1 and room >= 0, got ${tostring(lock.floor)} / ${tostring(
				lock.room,
			)}`,
			0,
		);
	}
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
	checkLock("guardLock", lock);
	const pellet = config.pelletLock;
	checkLock("pelletLock", pellet);
	return {
		harmless: config.harmless ? 1 : 0,
		harmlessHits: 0,
		bossHpPercent,
		guardLockFloor: lock !== undefined ? lock.floor : NO_GUARD_LOCK_FLOOR,
		guardLockRoom: lock !== undefined ? lock.room : NO_GUARD_LOCK_ROOM,
		guardLock: GUARD_LOCK_WAITING,
		guardLockFirstId: 0,
		guardLockEndId: 0,
		pelletLockFloor: pellet !== undefined ? pellet.floor : NO_PELLET_LOCK_FLOOR,
		pelletLockRoom: pellet !== undefined ? pellet.room : NO_PELLET_LOCK_ROOM,
		pelletLock: PELLET_LOCK_WAITING,
		pelletLockFirstId: 0,
		pelletLockEndId: 0,
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

/** The id range [first, end) of `spawned` (not empty; one spawnAll's ids are consecutive). */
function idRange(spawned: ReadonlyArray<ActorState>): [number, number] {
	let first = spawned[0].id;
	let last = first;
	for (const a of spawned) {
		if (a.id < first) first = a.id;
		if (a.id > last) last = a.id;
	}
	return [first, last + 1];
}

/**
 * endless.ts enterRoom, after the room's deferred spawns: on a lock's floor and room while it is WAITING, arms it on
 * `spawned`; a room that spawned nothing releases it (nothing to hold). The pellet lock also releases at once when the
 * room has no untaken regular pellet (none placed, or no pellets in the run).
 */
export function tutorialOnRoomSpawned(
	state: SimState,
	floor: number,
	roomId: number,
	spawned: ReadonlyArray<ActorState>,
): void {
	const t = state.tutorial;
	if (t === undefined) return;
	if (
		t.guardLock === GUARD_LOCK_WAITING &&
		t.guardLockFloor !== NO_GUARD_LOCK_FLOOR &&
		floor === t.guardLockFloor &&
		roomId === t.guardLockRoom
	) {
		if (spawned.size() === 0) {
			t.guardLock = GUARD_LOCK_RELEASED;
		} else {
			const [first, endId] = idRange(spawned);
			t.guardLock = GUARD_LOCK_ARMED;
			t.guardLockFirstId = first;
			t.guardLockEndId = endId;
		}
	}
	if (
		t.pelletLock === PELLET_LOCK_WAITING &&
		t.pelletLockFloor !== NO_PELLET_LOCK_FLOOR &&
		floor === t.pelletLockFloor &&
		roomId === t.pelletLockRoom
	) {
		if (spawned.size() === 0 || !roomPelletsLeft(state, roomId)) {
			t.pelletLock = PELLET_LOCK_RELEASED;
		} else {
			const [first, endId] = idRange(spawned);
			t.pelletLock = PELLET_LOCK_ARMED;
			t.pelletLockFirstId = first;
			t.pelletLockEndId = endId;
		}
	}
}

/** The score record index of room `roomId` on the current floor, or -1 (state types only). */
function scoreRecordOf(state: Readonly<SimState>, roomId: number): number {
	const records = state.score?.rooms;
	if (records === undefined) return -1;
	for (let k = 0; k < records.size(); k++) if (records[k].room === roomId) return k;
	return -1;
}

/** True while room `roomId` has an untaken regular pellet (state.pellets read through the state types only). */
function roomPelletsLeft(state: Readonly<SimState>, roomId: number): boolean {
	const p = state.pellets;
	const k = scoreRecordOf(state, roomId);
	if (p === undefined || k < 0) return false;
	const r = p.rooms[k];
	return r !== undefined && r.left > 0;
}

/**
 * stepPellets: the last regular pellet of score record `rec` was taken this tick. On the pellet lock's floor and room
 * while ARMED, releases it for good.
 */
export function tutorialOnPelletsSwept(state: SimState, rec: number): void {
	const t = state.tutorial;
	if (t === undefined || t.pelletLock !== PELLET_LOCK_ARMED) return;
	if ((state.endless?.floor ?? NO_PELLET_LOCK_FLOOR) !== t.pelletLockFloor) return;
	if (state.score?.rooms[rec]?.room !== t.pelletLockRoom) return;
	t.pelletLock = PELLET_LOCK_RELEASED;
}

/** sword.ts guard sweep: `n` enemy bullets erased this tick. Any block while ARMED releases the lock for good. */
export function tutorialOnGuardCancels(state: SimState, n: number): void {
	const t = state.tutorial;
	if (t !== undefined && n > 0 && t.guardLock === GUARD_LOCK_ARMED) t.guardLock = GUARD_LOCK_RELEASED;
}

function isGuardHeld(t: Readonly<TutorialState>, a: Readonly<ActorState>): boolean {
	return t.guardLock === GUARD_LOCK_ARMED && a.id >= t.guardLockFirstId && a.id < t.guardLockEndId;
}

function isPelletHeld(t: Readonly<TutorialState>, a: Readonly<ActorState>): boolean {
	return t.pelletLock === PELLET_LOCK_ARMED && a.id >= t.pelletLockFirstId && a.id < t.pelletLockEndId;
}

function isHeld(t: Readonly<TutorialState>, a: Readonly<ActorState>): boolean {
	return isGuardHeld(t, a) || isPelletHeld(t, a);
}

/**
 * damageActor: the hp a hit of `dmg` (> 0, already <= a.hp) may remove from `a`: `dmg` exactly, except for a held
 * actor (a lock ARMED, one of its room's spawns: the guard lock's or the pellet lock's), which keeps at least
 * TUTORIAL_GUARD_HOLD_HP. Reads hashed state.
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
		if (a.alive !== 0 && isGuardHeld(t, a) && a.hp <= TUTORIAL_GUARD_HOLD_HP) return true;
	}
	return false;
}

/**
 * True while some living actor held by the pellet lock stands at (or below) TUTORIAL_GUARD_HOLD_HP: it waits for the
 * room's last pellets (the HUD's `pelletsHold` prompt).
 */
export function isTutorialPelletHolding(state: Readonly<SimState>): boolean {
	const t = state.tutorial;
	if (t === undefined || t.pelletLock !== PELLET_LOCK_ARMED) return false;
	for (const a of state.combat.actors) {
		if (a.alive !== 0 && isPelletHeld(t, a) && a.hp <= TUTORIAL_GUARD_HOLD_HP) return true;
	}
	return false;
}

/** True once the pellet lock was released (the room's last pellet taken, or nothing to hold when it spawned). */
export function isTutorialPelletReleased(state: Readonly<SimState>): boolean {
	return state.tutorial?.pelletLock === PELLET_LOCK_RELEASED;
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
	// The pellet lock (docs/PELLETS.md PL12), appended.
	"pelletLockFloor",
	"pelletLockRoom",
	"pelletLock",
	"pelletLockFirstId",
	"pelletLockEndId",
] as const;

export function writeTutorialHash(t: Readonly<TutorialState>, out: number[]): void {
	for (const f of TUTORIAL_HASH_FIELDS) out.push(t[f]);
}

/** Dump names for writeTutorialHash (`tutorial.<field>`, TUTORIAL_HASH_FIELDS order). */
export function tutorialHashNames(out: string[]): void {
	for (const f of TUTORIAL_HASH_FIELDS) out.push(`tutorial.${f}`);
}

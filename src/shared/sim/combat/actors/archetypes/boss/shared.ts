/**
 * The boss fight skeleton every boss on it shares (Roblox port, docs/BOSS_DEMONLORD.md D3; moved out of
 * `boss/act1.ts`, source: `src/sim/actors/archetypes/boss/act1.ts` @ 42897e2). A pure move: Mother Mayhem's fight
 * runs exactly the code it ran before (same order of state writes and rng draws), so every golden boss run still
 * matches bit for bit. Parameterised only where a second boss needs it: its data (BossFightData), its phase-first
 * table and roar attack id (BossFightSpec), and its attacks (BossFightHooks).
 *
 * Fight flow (ActorState.aiState, BossFightState):
 *   DORMANT     on the boss room's center tile, immune, until a player is well inside the room (data.engageInset)
 *               -> events.bossEngaged = 1, phase 1 (events.bossPhase = 1), the arena seals (sealArena)
 *   TRANSITION  roar: immune, own bullets cleared, attack = spec.roarAttack (intro data.introTicks, phase changes
 *               data.transitionTicks); afterwards the phase's first attack (spec.phaseFirstAttack) is forced
 *   TELEGRAPH   ctx.telegraph(a, ticks, attack), started by hooks.startNext; when it runs out, ACTIVE
 *   ACTIVE      hooks.runAttack(t) every tick (t = 0 on the TELEGRAPH -> ACTIVE tick) until it returns true
 *   RECOVER     standing still and vulnerable (data.recoverTicks[phase], or hooks.recoverAfter(attack))
 *   REPOSITION  walks back toward the room center when RECOVER ends farther than data.homeRadius from it
 *   >= BOSS_CUSTOM_STATE  the boss's own states (hooks.stepOwnState)
 * Phases change at data.phaseHp[0] and [1] of hpMax. Damage never skips a phase: filterDamage stops it at the
 * threshold, the transition plays (immune), then the next phase's first attack is the one in spec.phaseFirstAttack.
 *
 * Slots the skeleton owns: ActorState.cooldown (the attack forced next, 0 = pick one), v[BOSS_V_MARK] (zeroed when a
 * transition starts), v[BOSS_V_LAST] / v[BOSS_V_REPEAT] (pickBossAttack / noteBossAttack: never the same attack more
 * than BOSS_MAX_REPEAT times in a row). Every other v[] slot is the boss's own.
 *
 * Deterministic: all state is in ActorState, randomness via ctx.random*, no trig.
 */

import { SIM_DT, TILE_SIZE } from "../../../../units";
import type { SimCtx } from "../../../ctx";
import { Button } from "../../../../input";
import { rotateDir, type Dir } from "../../../patterns";
import { PLAYER_RADIUS } from "../../../../playerData";
import type { EncounterRoom } from "../../encounter";
import { partySize, playerAt } from "../../../../party";
import type { PlayerState } from "../../../../state";
import { faceToward, moveActor, toPlayer, walkToward } from "../../helpers";
import { archetypeAt } from "../../registry";
import { AiState, NO_KIND, type ActorState, type ArchetypeData } from "../../types";
import { V_HOME_X, V_HOME_Z, engage, isRoomEnemyData } from "../enemyShared";
import { cellKey, gridToWorld, worldToGrid, type SolidCells } from "shared/dungeon";
import { solidCells } from "../../../../breakables/cells";

// ---------------------------------------------------------------------------------------------
// States, slots, rules

/** aiState values of the skeleton (AiState.TELEGRAPH = 1 is the shared wind-up state). Mother Mayhem's BossState. */
export const BossFightState = {
	TELEGRAPH: AiState.TELEGRAPH,
	DORMANT: AiState.CUSTOM,
	ACTIVE: AiState.CUSTOM + 1,
	RECOVER: AiState.CUSTOM + 2,
	TRANSITION: AiState.CUSTOM + 3,
	REPOSITION: AiState.CUSTOM + 4,
} as const;
/** First aiState value free for a boss's own states (hooks.stepOwnState). */
export const BOSS_CUSTOM_STATE = AiState.CUSTOM + 5;

/** ActorState.attack between attacks (RECOVER, REPOSITION, death). Every boss's attack id 0. */
export const BOSS_NO_ATTACK = 0;
/** The last phase: no threshold below it (phaseFloor 0). */
export const BOSS_LAST_PHASE = 3;
/** Never the same attack more than this many times in a row. */
export const BOSS_MAX_REPEAT = 2;

/** v[] slot zeroed when a phase transition starts (Mother Mayhem: the slam's impact mark). */
export const BOSS_V_MARK = 4;
/** A sealed player's body overlapping a blocked cell by at most this much is clear (collision.ts circleOverlapsWall's). */
export const SEAL_OVERLAP_TOLERANCE = 1e-6;

/** v[] slots: the last attack started, and how many times in a row. */
export const BOSS_V_LAST = 5;
export const BOSS_V_REPEAT = 6;

/** Without encounter rooms (unit tests), the boss wakes when the player comes this close. */
export const BOSS_ENGAGE_RANGE_NO_ROOM = 10;
/** REPOSITION gives up after this many ticks. */
export const BOSS_REPOSITION_MAX_TICKS = 120;
/** REPOSITION ends when the room center is this close (world units). */
export const BOSS_REPOSITION_DONE = 0.5;
/** While the player is dead the boss waits this long between checks (RECOVER). */
export const BOSS_PLAYER_DEAD_WAIT_TICKS = 30;
const HP_EPS = 1e-6;

/**
 * The web build's boss hp (Mother Mayhem, fixtures/constants.json). Every golden fixture was recorded with it, so the
 * parity specs replay under it (setBossHp), like the sword's WEB_SWORD_TIMINGS and WEB_SWARMER_HP.
 */
export const WEB_BOSS_HP = 540;

/** The port's boss hp, percent of WEB_BOSS_HP (CLAUDE.md decision log, 2026-11-06: halved). */
export const BOSS_HP_PERCENT = 50;

/** Every boss's base hp (Mother Mayhem and the Demon Lord), before the endless Depth, party and tutorial scaling. */
export const BOSS_HP = (WEB_BOSS_HP * BOSS_HP_PERCENT) / 100;

/** What every boss on the skeleton has on top of ArchetypeData. */
export interface BossFightData extends ArchetypeData {
	/** Phase 2 starts at hp <= phaseHp[0] * hpMax, phase 3 at hp <= phaseHp[1] * hpMax. */
	phaseHp: ReadonlyArray<number>;
	/** Intro roar after engaging, ticks (immune). */
	introTicks: number;
	/** Phase transition roar, ticks (immune; own bullets cleared). */
	transitionTicks: number;
	/** Vulnerable stand-still after an attack, ticks, per phase (index = phase). */
	recoverTicks: ReadonlyArray<number>;
	/** The fight starts when the player is this far inside the boss room's bounds, world units. */
	engageInset: number;
	/** Walk back toward the room center between attacks when farther from it than this, world units. */
	homeRadius: number;
	/** DEBUG_BOSS (J, debug builds only): fraction of hpMax taken off per press. */
	debugDamage: number;
}

/** The per-boss tables the skeleton reads. */
export interface BossFightSpec {
	/** The first attack of each phase (index = phase) after the intro / transition roar: the phase's new pattern. */
	readonly phaseFirstAttack: ReadonlyArray<number>;
	/** ActorState.attack while it roars (intro and transitions; not an attack, immune). */
	readonly roarAttack: number;
}

/**
 * A boss's own code, called by stepBossFight. Implement every hook with method syntax (roblox-ts calls them with `:`).
 */
export interface BossFightHooks<D extends BossFightData> {
	readonly spec: BossFightSpec;
	/**
	 * Picks (pickBossAttack) and starts the next attack: ctx.telegraph, or one of the boss's own states. The skeleton
	 * calls it only while the bound player is alive.
	 */
	startNext(ctx: SimCtx, a: ActorState, d: D, room: EncounterRoom | undefined): void;
	/** One tick of the running attack; `t` = ticks since its first ACTIVE tick (0). Returns true when it is over. */
	runAttack(ctx: SimCtx, a: ActorState, d: D, t: number): boolean;
	/** RECOVER length after `attack` ended (undefined: data.recoverTicks of the phase). */
	recoverAfter(d: D, attack: number): number | undefined;
	/** One tick of an aiState the skeleton does not own (>= BOSS_CUSTOM_STATE). False: unknown (it recovers). */
	stepOwnState(ctx: SimCtx, a: ActorState, d: D, room: EncounterRoom | undefined): boolean;
}

// ---------------------------------------------------------------------------------------------
// Helpers

const dirScratch: Dir = { x: 0, z: 1 };
/** Exact 120-degree turn (no trig): the summons' spacing. */
const COS120 = -0.5;
const SIN120 = math.sqrt(3) / 2;

function clamp(v: number, lo: number, hi: number): number {
	return v < lo ? lo : v > hi ? hi : v;
}

/** True when (x, z) lies inside the room's bounds shrunk by `inset` on every side. */
export function inRoom(room: EncounterRoom, x: number, z: number, inset: number): boolean {
	return x >= room.minX + inset && x <= room.maxX - inset && z >= room.minZ + inset && z <= room.maxZ - inset;
}

/** The boss's arena: the boss room when the boss stands in it, else whatever room it stands in (undefined: none). */
export function bossArena(ctx: SimCtx, a: Readonly<ActorState>): EncounterRoom | undefined {
	const r = ctx.bossRoom();
	if (r !== undefined && inRoom(r, a.x, a.z, 0)) return r;
	return ctx.roomAt(a.x, a.z);
}

/** hp the current phase may not go below (the next phase's threshold; 0 in the last phase). */
export function phaseFloor(d: BossFightData, a: Readonly<ActorState>): number {
	if (a.phase <= 1) return a.hpMax * d.phaseHp[0];
	if (a.phase === 2) return a.hpMax * d.phaseHp[1];
	return 0;
}

/** The fight is on (not DORMANT, not a fresh IDLE spawn). */
export function bossEngaged(a: Readonly<ActorState>): boolean {
	return a.aiState !== BossFightState.DORMANT && a.aiState !== AiState.IDLE;
}

function beginTransition(ctx: SimCtx, a: ActorState, spec: BossFightSpec, d: BossFightData): void {
	ctx.setPhase(a, a.phase + 1);
	a.aiState = BossFightState.TRANSITION;
	a.aiTicks = d.transitionTicks;
	a.attack = spec.roarAttack;
	a.cooldown = spec.phaseFirstAttack[a.phase] ?? 0;
	a.v[BOSS_V_MARK] = 0;
	// Pillar 2: the slate is wiped while it roars, so the new phase starts readable.
	ctx.combat.enemyBullets.clear(a.emitterId);
}

/** After hp changed: at the phase floor, start the transition (hp snapped onto the threshold). */
export function checkBossPhase(ctx: SimCtx, a: ActorState, spec: BossFightSpec, d: BossFightData): void {
	if (a.alive === 0 || a.phase >= BOSS_LAST_PHASE || a.aiState === BossFightState.TRANSITION || !bossEngaged(a)) {
		return;
	}
	const floor = phaseFloor(d, a);
	if (a.hp <= floor + HP_EPS) {
		a.hp = floor;
		beginTransition(ctx, a, spec, d);
	}
}

/**
 * The room seal: while the fight is on, the player cannot leave the arena's bounds (clamped back inside them, minus
 * the player's radius, every tick). The bounds are the box around the room's FLOOR tiles, and that box can hold walls:
 * on endless floors the throne's dais, candle stands, door braziers, solid pillars and ragged room edges sit on it. A
 * player held at the seal from inside stays clear (the mover keeps the body off walls), but a straggler pulled in from
 * outside can be clamped into one, so a clamp that leaves the body overlapping a blocked cell puts the player on the
 * centre of the nearest open cell of the room instead (sealSpot). A clamp that lands clear is kept exactly (every
 * fixture's boss run).
 */
export function sealArena(ctx: SimCtx, room: EncounterRoom | undefined): void {
	if (room === undefined) return;
	// Co-op (M4): every player is sealed in, in index order (a straggler is pulled onto the arena floor).
	const n = partySize(ctx.state);
	for (let i = 0; i < n; i++) sealPlayer(ctx, playerAt(ctx.state, i), room);
}

/** Clamps one player inside the room's bounds (minus the player's radius), off any wall the clamp put it in. */
export function sealPlayer(ctx: SimCtx, p: PlayerState, room: EncounterRoom): void {
	const r = PLAYER_RADIUS;
	const x = clamp(p.x, room.minX + r, room.maxX - r);
	const z = clamp(p.z, room.minZ + r, room.maxZ - r);
	if (x === p.x && z === p.z) return; // inside: the mover keeps the body clear
	const solid = solidCells(ctx.state);
	if (bodyOverlapsBlocked(ctx, x, z, r, solid)) {
		sealSpot(ctx, room, x, z, solid);
		p.x = sealScratch.x;
		p.z = sealScratch.z;
		return;
	}
	p.x = x;
	p.z = z;
}

/** True when the cell blocks a body: a wall, void or pool tile (ctx.isBodyBlocked) or an intact breakable. */
function sealCellBlocked(ctx: SimCtx, gx: number, gz: number, solid: SolidCells | undefined): boolean {
	if (ctx.isBodyBlocked(gridToWorld(gx), gridToWorld(gz))) return true;
	return solid !== undefined && solid.has(cellKey(gx, gz));
}

/** True when a body of radius r at (x, z) overlaps a blocked cell (collision.ts circleOverlapsWall's test). */
function bodyOverlapsBlocked(ctx: SimCtx, x: number, z: number, r: number, solid: SolidCells | undefined): boolean {
	const half = TILE_SIZE / 2;
	const rr = (r - SEAL_OVERLAP_TOLERANCE) * (r - SEAL_OVERLAP_TOLERANCE);
	const gz1 = worldToGrid(z + r);
	const gx1 = worldToGrid(x + r);
	for (let gz = worldToGrid(z - r); gz <= gz1; gz++)
		for (let gx = worldToGrid(x - r); gx <= gx1; gx++) {
			if (!sealCellBlocked(ctx, gx, gz, solid)) continue;
			const cx = gridToWorld(gx);
			const cz = gridToWorld(gz);
			const dx = x - clamp(x, cx - half, cx + half);
			const dz = z - clamp(z, cz - half, cz + half);
			if (dx * dx + dz * dz < rr) return true;
		}
	return false;
}

const sealScratch = { x: 0, z: 0 };

/**
 * Writes into sealScratch the centre of the open cell of `room` nearest (x, z): a cell inside the room's bounds, not
 * blocked, and in the room by the exact cell rule when the world has one (config.roomIdAt; a corridor pocket inside the
 * box is not the arena). A body at a cell centre never touches a neighbouring cell (PLAYER_RADIUS < TILE_SIZE / 2).
 * Rings outward from (x, z)'s cell, the first nearest in scan order wins (deterministic); none: the room's centre tile.
 */
function sealSpot(ctx: SimCtx, room: EncounterRoom, x: number, z: number, solid: SolidCells | undefined): void {
	const exact = ctx.config.roomIdAt !== undefined;
	const cgx = worldToGrid(x);
	const cgz = worldToGrid(z);
	const maxRing = math.ceil(math.max(room.maxX - room.minX, room.maxZ - room.minZ) / TILE_SIZE) + 1;
	let best = math.huge;
	sealScratch.x = room.cx;
	sealScratch.z = room.cz;
	for (let k = 0; k <= maxRing; k++) {
		// Every cell centre on ring k is at least (k - 1/2) tiles from (x, z), which lies in the centre cell.
		const near = (k - 0.5) * TILE_SIZE;
		if (k > 0 && near * near > best) return;
		for (let oz = -k; oz <= k; oz++)
			for (let ox = -k; ox <= k; ox++) {
				if (math.max(math.abs(ox), math.abs(oz)) !== k) continue;
				const gx = cgx + ox;
				const gz = cgz + oz;
				const cx = gridToWorld(gx);
				const cz = gridToWorld(gz);
				if (!inRoom(room, cx, cz, 0)) continue;
				if (sealCellBlocked(ctx, gx, gz, solid)) continue;
				if (exact && ctx.roomIdAt(cx, cz) !== room.id) continue;
				const dx = cx - x;
				const dz = cz - z;
				const d2 = dx * dx + dz * dz;
				if (d2 < best) {
					best = d2;
					sealScratch.x = cx;
					sealScratch.z = cz;
				}
			}
	}
}

/** True when the bound player wakes the boss: inside the room by data.engageInset (no room: within range). */
export function playerEngages(ctx: SimCtx, a: ActorState, d: BossFightData, room: EncounterRoom | undefined): boolean {
	const p = ctx.player;
	if (p.dead !== 0) return false;
	if (room !== undefined) return inRoom(room, p.x, p.z, d.engageInset);
	return toPlayer(ctx, a).dist <= BOSS_ENGAGE_RANGE_NO_ROOM;
}

/**
 * The next attack: the forced one (ActorState.cooldown, set by a roar) or a deterministic rng pick over `attacks`
 * (the phase's table), never a third repeat in a row (v[BOSS_V_LAST] / v[BOSS_V_REPEAT]). One rng draw when picking.
 */
export function pickBossAttack(ctx: SimCtx, a: ActorState, attacks: ReadonlyArray<number>): number {
	const forced = a.cooldown;
	a.cooldown = 0;
	if (forced > 0) return forced;
	const banned = a.v[BOSS_V_REPEAT] >= BOSS_MAX_REPEAT ? a.v[BOSS_V_LAST] : -1;
	let n = 0;
	for (let i = 0; i < attacks.size(); i++) if (attacks[i] !== banned) n++;
	let k = ctx.randomInt(0, n - 1);
	for (let i = 0; i < attacks.size(); i++) {
		if (attacks[i] === banned) continue;
		if (k === 0) return attacks[i];
		k--;
	}
	return attacks[0];
}

/** Books `attack` as started (the repeat counter pickBossAttack reads). */
export function noteBossAttack(a: ActorState, attack: number): void {
	if (a.v[BOSS_V_LAST] === attack) a.v[BOSS_V_REPEAT] += 1;
	else {
		a.v[BOSS_V_LAST] = attack;
		a.v[BOSS_V_REPEAT] = 1;
	}
}

/** Who a boss summons, and how many. */
export interface BossSummonSpec {
	/** Archetype id of the adds. */
	readonly kind: string;
	/** Adds per summon. */
	readonly count: number;
	/** Never more than this many of `kind` alive in the arena. */
	readonly maxAlive: number;
	/** Each add is pushed this far out from the boss's center, world units. */
	readonly radius: number;
	/**
	 * The arena the cap counts in is the room's bounds grown by this much, world units (default 0: the bounds). A boss
	 * that summons away from the room's centre sets it to `radius`, so an add pushed through a doorway still counts.
	 */
	readonly arenaMargin?: number;
}

/**
 * Live actors of `spec.kind` in the boss's arena (grown by spec.arenaMargin; no arena: within BOSS_ENGAGE_RANGE_NO_ROOM
 * of the boss).
 */
export function summonedAlive(ctx: SimCtx, a: ActorState, spec: BossSummonSpec): number {
	const kind = ctx.kindOf(spec.kind);
	const room = bossArena(ctx, a);
	const margin = spec.arenaMargin ?? 0;
	let alive = 0;
	const actors = ctx.actors;
	const r2 = BOSS_ENGAGE_RANGE_NO_ROOM * BOSS_ENGAGE_RANGE_NO_ROOM;
	for (let i = 0; i < actors.size(); i++) {
		const o = actors[i];
		if (o.kind !== kind || o.alive === 0) continue;
		const near =
			room !== undefined
				? inRoom(room, o.x, o.z, margin === 0 ? 0 : -margin)
				: (o.x - a.x) * (o.x - a.x) + (o.z - a.z) * (o.z - a.z) <= r2;
		if (near) alive++;
	}
	return alive;
}

/**
 * Up to spec.count adds around the boss, never more than spec.maxAlive of them alive in the arena (room adds
 * elsewhere on the floor do not count), and never past MAX_ACTORS (spawnActor drops the rest). Each one spawns on the
 * boss's center (always floor) and is pushed spec.radius out through the world (moveActor: walls and pits stop it, so
 * it never lands in one), 120 degrees apart starting along (dirX, dirZ). Room enemies (data.roomEnemy) come out
 * engaged, homed where they land. Returns how many spawned.
 */
export function summonAdds(ctx: SimCtx, a: ActorState, spec: BossSummonSpec, dirX: number, dirZ: number): number {
	const alive = summonedAlive(ctx, a, spec);
	const n = math.min(spec.count, spec.maxAlive - alive);
	let x = dirX;
	let z = dirZ;
	for (let i = 0; i < n; i++) {
		const s = ctx.spawnActor(spec.kind, a.x, a.z);
		if (s === undefined) return i; // the actor pool is full
		moveActor(ctx, s, x * spec.radius, z * spec.radius); // prevX / prevZ stay on the boss: drawn bursting out
		if (isRoomEnemyData(ctx.data(s))) {
			s.v[V_HOME_X] = s.x;
			s.v[V_HOME_Z] = s.z;
			engage(s);
		}
		rotateDir(x, z, COS120, SIN120, dirScratch); // 120 degrees
		x = dirScratch.x;
		z = dirScratch.z;
	}
	return n > 0 ? n : 0;
}

/** RECOVER for `ticks` (default: the phase's data.recoverTicks). */
export function bossRecover(a: ActorState, d: BossFightData, ticks?: number): void {
	a.aiState = BossFightState.RECOVER;
	a.aiTicks = ticks ?? d.recoverTicks[a.phase] ?? d.recoverTicks[1];
	a.attack = BOSS_NO_ATTACK;
}

/** Starts the next attack (or keeps waiting while the player is dead). The source's `next`. */
function nextAttack<D extends BossFightData>(
	ctx: SimCtx,
	a: ActorState,
	d: D,
	room: EncounterRoom | undefined,
	hooks: BossFightHooks<D>,
): void {
	if (ctx.player.dead !== 0) {
		bossRecover(a, d, BOSS_PLAYER_DEAD_WAIT_TICKS);
		return;
	}
	hooks.startNext(ctx, a, d, room);
}

/** J (DEBUG_BOSS, debug builds only): data.debugDamage of max hp off, bypassing the cap, never past a threshold. */
function debugHit(ctx: SimCtx, a: ActorState, spec: BossFightSpec, d: BossFightData): void {
	if (!bossEngaged(a) || a.aiState === BossFightState.TRANSITION) return;
	const floor = phaseFloor(d, a);
	const hp = a.hp - a.hpMax * d.debugDamage;
	a.hp = floor > hp ? floor : hp;
	if (a.hp > floor + HP_EPS) return;
	if (floor <= 0) ctx.killActor(a);
	else checkBossPhase(ctx, a, spec, d);
}

// ---------------------------------------------------------------------------------------------
// The archetype hooks (call them from the boss's own def)

/** ArchetypeDef.init: dormant. */
export function initBossFight(a: ActorState): void {
	a.aiState = BossFightState.DORMANT;
}

/** ArchetypeDef.step: one tick of the fight (see the file comment). */
export function stepBossFight<D extends BossFightData>(ctx: SimCtx, a: ActorState, hooks: BossFightHooks<D>): void {
	const d = ctx.data<D>(a);
	const spec = hooks.spec;
	const room = bossArena(ctx, a);

	// Debug cheat (an input bit, so replays reproduce it). Edge against last tick's buttons (weapons update them later).
	const b = ctx.input.buttons;
	if (bit32.band(b, Button.DEBUG_BOSS) !== 0 && bit32.band(ctx.combat.weapons.prevButtons, Button.DEBUG_BOSS) === 0) {
		debugHit(ctx, a, spec, d);
		if (a.alive === 0) return;
	}

	if (!bossEngaged(a)) {
		a.aiState = BossFightState.DORMANT;
		if (!playerEngages(ctx, a, d, room)) return;
		ctx.events.bossEngaged = 1;
		ctx.setPhase(a, 1);
		a.aiState = BossFightState.TRANSITION;
		a.aiTicks = d.introTicks;
		a.attack = spec.roarAttack;
		a.cooldown = spec.phaseFirstAttack[1];
	}

	sealArena(ctx, room);

	switch (a.aiState) {
		case BossFightState.TRANSITION:
			a.aiTicks -= 1;
			if (a.aiTicks <= 0) nextAttack(ctx, a, d, room, hooks);
			return;
		case BossFightState.RECOVER: {
			const tp = toPlayer(ctx, a);
			faceToward(a, tp.dx, tp.dz);
			a.aiTicks -= 1;
			if (a.aiTicks > 0) return;
			if (room !== undefined && ctx.player.dead === 0) {
				const hx = room.cx - a.x;
				const hz = room.cz - a.z;
				if (hx * hx + hz * hz > d.homeRadius * d.homeRadius) {
					a.aiState = BossFightState.REPOSITION;
					a.aiTicks = BOSS_REPOSITION_MAX_TICKS;
					return;
				}
			}
			nextAttack(ctx, a, d, room, hooks);
			return;
		}
		case BossFightState.REPOSITION: {
			// The plain mover (no steering), like the charge.
			const left = room !== undefined ? walkToward(ctx, a, room.cx, room.cz, d.speed * SIM_DT, false) : 0;
			if (left <= BOSS_REPOSITION_DONE) {
				nextAttack(ctx, a, d, room, hooks);
				return;
			}
			a.aiTicks -= 1;
			if (a.aiTicks <= 0) nextAttack(ctx, a, d, room, hooks);
			return;
		}
		case BossFightState.TELEGRAPH: {
			a.aiTicks -= 1;
			if (a.aiTicks > 0) return;
			a.aiState = BossFightState.ACTIVE;
			a.aiTicks = 0;
			const attack = a.attack;
			if (hooks.runAttack(ctx, a, d, 0)) bossRecover(a, d, hooks.recoverAfter(d, attack));
			return;
		}
		case BossFightState.ACTIVE: {
			a.aiTicks += 1;
			const attack = a.attack;
			if (hooks.runAttack(ctx, a, d, a.aiTicks)) bossRecover(a, d, hooks.recoverAfter(d, attack));
			return;
		}
		default:
			if (!hooks.stepOwnState(ctx, a, d, room)) bossRecover(a, d);
	}
}

/** ArchetypeDef.filterDamage: immune while dormant or roaring; never below the phase floor. */
export function filterBossDamage(ctx: SimCtx, a: ActorState, damage: number): number {
	if (!bossEngaged(a) || a.aiState === BossFightState.TRANSITION) return 0;
	const floor = phaseFloor(ctx.data<BossFightData>(a), a);
	return a.hp - damage < floor ? a.hp - floor : damage;
}

/** ArchetypeDef.onHit: the phase check. */
export function onBossHit(ctx: SimCtx, a: ActorState, spec: BossFightSpec): void {
	checkBossPhase(ctx, a, spec, ctx.data<BossFightData>(a));
}

/** ArchetypeDef.onDeath: bossDefeated, own bullets cleared, and every non-boss actor still alive in the arena dies. */
export function onBossDeath(ctx: SimCtx, a: ActorState): void {
	ctx.events.bossDefeated = 1;
	a.attack = BOSS_NO_ATTACK;
	ctx.combat.enemyBullets.clear(a.emitterId);
	// The adds wither: actors still alive in the arena die with the boss.
	const room = bossArena(ctx, a);
	if (room === undefined) return;
	const actors = ctx.actors;
	for (let i = 0; i < actors.size(); i++) {
		const o = actors[i];
		if (o === a || o.kind === NO_KIND || o.alive === 0 || archetypeAt(o.kind).data.boss === true) continue;
		if (inRoom(room, o.x, o.z, 0)) ctx.killActor(o);
	}
}

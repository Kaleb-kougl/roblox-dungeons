/**
 * Shared rules of the E1.8 room enemies (swarmer, sniper, bruiser; source: `src/sim/actors/archetypes/enemyShared.ts`):
 * aggro (range + line of sight, or being hit), pack alerts, leashing back home, and the presentation hints the actor
 * view reads. Each archetype is its own file; this module only holds what all three do the same way. Everything here
 * runs inside the deterministic sim: no trig, no allocation, no module-level mutable state (all state lives in
 * ActorState.v / aiState / aiTicks / cooldown).
 *
 * v[] slots 0..2 mean the same thing for every archetype that sets `data.roomEnemy` (pack alerts read them across
 * archetypes); slots 3..7 are each archetype's own.
 */

import { SIM_DT } from "../../../units";
import type { SimCtx } from "../../ctx";
import { toPlayer, walkToward } from "../helpers";
import { AiState, NO_KIND, type ActorState, type ArchetypeData } from "../types";

/** v[0]: 1 while the actor is engaged (chasing / fighting), 0 idle or walking home. */
export const V_AGGRO = 0;
/** v[1], v[2]: where it was placed (spawn position); it walks back here when it leashes. */
export const V_HOME_X = 1;
export const V_HOME_Z = 2;

/** Engaged (chasing / keeping range): every room enemy's first own state, so alerts can engage any of them. */
export const STATE_ENGAGED = AiState.CUSTOM;
/** Walking home (leashed). */
export const STATE_RETURN = AiState.CUSTOM + 7;

/**
 * walkToward's `steer` for every room enemy's walking (chase, home, a sniper looking for a line): config.actorSteerMover
 * when the floor has one (endless floors), so they round solid pillars. The boss never steers (boss/act1.ts).
 */
export const STEER = true;

/** Within this distance of home it counts as back (world units). */
const HOME_EPS = 0.15;
/** While walking home it re-engages only when this close to home (so it doesn't ping-pong on the leash edge). */
const REAGGRO_HOME_DIST = 3;
/** Idle actors keep facing the player within aggroRange x this factor, squared (1.5 x range). */
const WATCH_RANGE2_FACTOR = 2.25;

/**
 * Presentation hints (the actor view reads them; the sim never does). Indices are ActorState.v slots.
 *   aimLine     a thin warning line from the actor while aiState === AiState.TELEGRAPH, along the unit direction
 *               (v[dirX], v[dirZ]), v[lenSlot] long (or `length` when there is no slot); drawn bold once
 *               aiTicks <= boldTicks (the aim is locked).
 *   shockwave   a flat ring on the floor expanding from the actor while aiState === state:
 *               age = startTicks - aiTicks ticks, radius = radius + speed * age / 60, shown for showTicks ticks,
 *               with a gap of gapHalfAngle radians either side of the unit direction (v[gapX], v[gapZ]).
 */
export interface ActorFxHints {
	readonly aimLine?: {
		readonly dirX: number;
		readonly dirZ: number;
		readonly lenSlot?: number;
		readonly length?: number;
		readonly boldTicks: number;
	};
	readonly shockwave?: {
		readonly state: number;
		readonly startTicks: number;
		readonly showTicks: number;
		readonly radius: number;
		readonly speed: number;
		readonly gapX: number;
		readonly gapZ: number;
		readonly gapHalfAngle: number;
	};
}

/** Data every room enemy has on top of ArchetypeData. */
export interface RoomEnemyData extends ArchetypeData {
	/** Marks the shared v[0..2] layout (pack alerts only look at actors that have it). */
	readonly roomEnemy: true;
	/** Engages when the living player is this close AND in line of sight (world units). */
	readonly aggroRange: number;
	/** Gives up and walks home when it is farther than this from home (world units). */
	readonly leashRange: number;
	/** Ticks without line of sight before it gives up and walks home. */
	readonly lostTicks: number;
	/** Idle actors within this distance of an engaged room enemy engage too (0 = never alerted by others). */
	readonly alertRange: number;
	/** Render hints (the actor view). */
	readonly fx?: ActorFxHints;
}

/** True when the archetype data marks a room enemy (data.roomEnemy). */
export function isRoomEnemyData(d: ArchetypeData): boolean {
	return (d as Partial<RoomEnemyData>).roomEnemy === true;
}

/** Records the spawn position as home and starts idle. Call from init. */
export function initRoomEnemy(a: ActorState): void {
	a.v[V_HOME_X] = a.x;
	a.v[V_HOME_Z] = a.z;
	a.v[V_AGGRO] = 0;
	a.aiState = AiState.IDLE;
}

/** True when the living player is within `range` and in line of sight. Distance first (LOS costs a tile walk). */
export function seesPlayer(ctx: SimCtx, a: Readonly<ActorState>, range: number): boolean {
	const p = ctx.player;
	if (p.dead !== 0) return false;
	const dx = p.x - a.x;
	const dz = p.z - a.z;
	if (dx * dx + dz * dz > range * range) return false;
	return ctx.lineOfSight(a.x, a.z, p.x, p.z);
}

/** True when an engaged room enemy (any archetype with data.roomEnemy) stands within `range` of `a`, in its line of sight. */
export function alertedByNeighbour(ctx: SimCtx, a: Readonly<ActorState>, range: number): boolean {
	if (range <= 0) return false;
	const actors = ctx.actors;
	const r2 = range * range;
	for (let i = 0; i < actors.size(); i++) {
		const o = actors[i];
		if (o === a || o.kind === NO_KIND || o.alive === 0 || o.v[V_AGGRO] === 0) continue;
		if (!isRoomEnemyData(ctx.data(o))) continue;
		const dx = o.x - a.x;
		const dz = o.z - a.z;
		if (dx * dx + dz * dz <= r2 && ctx.lineOfSight(a.x, a.z, o.x, o.z)) return true;
	}
	return false;
}

/** Distance squared from home. */
export function homeDist2(a: Readonly<ActorState>): number {
	const dx = a.x - a.v[V_HOME_X];
	const dz = a.z - a.v[V_HOME_Z];
	return dx * dx + dz * dz;
}

/** Engages: aggro on, STATE_ENGAGED. */
export function engage(a: ActorState): void {
	a.v[V_AGGRO] = 1;
	a.aiState = STATE_ENGAGED;
	a.aiTicks = 0;
}

/** Leashes: aggro off, walk home. */
export function leash(a: ActorState): void {
	a.v[V_AGGRO] = 0;
	a.aiState = STATE_RETURN;
	a.aiTicks = 0;
	a.attack = 0;
}

/**
 * The idle / walking-home part of every room enemy's step. Returns true when it handled the tick (the actor stays
 * idle or walks home); false when the actor is engaged and the archetype's own states should run. Engages (into
 * STATE_ENGAGED) when it sees the player within aggroRange, or an engaged room enemy is within alertRange.
 */
export function stepCalm(ctx: SimCtx, a: ActorState): boolean {
	const d = ctx.data<RoomEnemyData>(a);
	if (a.aiState === AiState.IDLE) {
		if (seesPlayer(ctx, a, d.aggroRange) || (ctx.player.dead === 0 && alertedByNeighbour(ctx, a, d.alertRange))) {
			engage(a);
			return false;
		}
		const tp = toPlayer(ctx, a);
		// Idle actors keep facing the player when they are near (reads as "watching"); no movement.
		if (tp.dist2 < d.aggroRange * d.aggroRange * WATCH_RANGE2_FACTOR) {
			a.faceX = tp.dirX;
			a.faceZ = tp.dirZ;
		}
		return true;
	}
	if (a.aiState === STATE_RETURN) {
		const near = homeDist2(a) <= REAGGRO_HOME_DIST * REAGGRO_HOME_DIST;
		if (near && seesPlayer(ctx, a, d.aggroRange)) {
			engage(a);
			return false;
		}
		const left = walkToward(ctx, a, a.v[V_HOME_X], a.v[V_HOME_Z], d.speed * SIM_DT, STEER);
		if (left <= HOME_EPS) {
			a.aiState = AiState.IDLE;
			a.aiTicks = 0;
		}
		return true;
	}
	return false;
}

/** Whether an engaged actor should give up: the player is dead, or it strayed past leashRange from home. */
export function shouldLeash(ctx: SimCtx, a: Readonly<ActorState>): boolean {
	if (ctx.player.dead !== 0) return true;
	const r = ctx.data<RoomEnemyData>(a).leashRange;
	return homeDist2(a) > r * r;
}

/** onHit of every room enemy: a hit engages it (even from out of range) unless it already is. */
export function engageOnHit(_ctx: SimCtx, a: ActorState): void {
	if (a.v[V_AGGRO] === 0) engage(a);
}

/**
 * onDeath of every room enemy: calm room enemies within its alertRange that can see it engage (a pack reacts when
 * the player picks one off from outside their aggro range).
 */
export function alertOnDeath(ctx: SimCtx, a: ActorState): void {
	const range = ctx.data<RoomEnemyData>(a).alertRange;
	if (range <= 0 || ctx.player.dead !== 0) return;
	const actors = ctx.actors;
	const r2 = range * range;
	for (let i = 0; i < actors.size(); i++) {
		const o = actors[i];
		if (o === a || o.kind === NO_KIND || o.alive === 0 || o.v[V_AGGRO] !== 0) continue;
		if (!isRoomEnemyData(ctx.data(o))) continue;
		const dx = o.x - a.x;
		const dz = o.z - a.z;
		if (dx * dx + dz * dz <= r2 && ctx.lineOfSight(a.x, a.z, o.x, o.z)) engage(o);
	}
}

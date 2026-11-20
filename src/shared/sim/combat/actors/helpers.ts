/**
 * Deterministic helpers for archetype code (E1.8; source: `src/sim/actors/helpers.ts`): where is the player, turn to
 * face, walk through the world, line of sight. Pure functions of their arguments plus the ctx; no trig, no allocation
 * (results go into module scratch objects: copy the numbers you need before the next call).
 *
 * `lineOfSight` (the tile DDA) is the one in `shared/dungeon` (collision.ts), ported from this same source file; it is
 * re-exported here so archetype code finds every helper in one place.
 *
 * @module
 */

import { MAX_MOVE_STEP } from "../../playerData";
import { solidCells } from "../../breakables/cells";
import type { SimCtx } from "../ctx";
import type { ActorState } from "./types";

export { lineOfSight } from "shared/dungeon";

/** Result of toPlayer (scratch, overwritten by the next call). */
export interface ToPlayer {
	/** Player minus actor. */
	dx: number;
	dz: number;
	dist2: number;
	dist: number;
	/** Unit direction actor -> player; the actor's facing when they coincide. */
	dirX: number;
	dirZ: number;
}

const toPlayerScratch: ToPlayer = { dx: 0, dz: 0, dist2: 0, dist: 0, dirX: 0, dirZ: 1 };

/** Vector, distance and unit direction from `actor` to the player. Returns a shared scratch object. */
export function toPlayer(ctx: SimCtx, actor: Readonly<ActorState>): Readonly<ToPlayer> {
	const p = ctx.player;
	const o = toPlayerScratch;
	o.dx = p.x - actor.x;
	o.dz = p.z - actor.z;
	o.dist2 = o.dx * o.dx + o.dz * o.dz;
	o.dist = math.sqrt(o.dist2);
	if (o.dist2 > 1e-12) {
		o.dirX = o.dx / o.dist;
		o.dirZ = o.dz / o.dist;
	} else {
		o.dirX = actor.faceX;
		o.dirZ = actor.faceZ;
	}
	return o;
}

/** Sets the actor's facing to the direction of (dx, dz) (normalized); leaves it unchanged for a zero vector. */
export function faceToward(actor: ActorState, dx: number, dz: number): void {
	const d2 = dx * dx + dz * dz;
	if (d2 <= 1e-12) return;
	const inv = 1 / math.sqrt(d2);
	actor.faceX = dx * inv;
	actor.faceZ = dz * inv;
}

/** A walk tick at exactly MAX_MOVE_STEP stays one mover call. */
const STEP_TOLERANCE = MAX_MOVE_STEP * (1 + 1e-9);

function clamp(v: number, lo: number, hi: number): number {
	return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Moves `actor` by (dx, dz) through the world, like the player moves: config.actorMover (circle of actor.radius vs
 * the tile grid, walls slide) in equal sub-steps of at most MAX_MOVE_STEP (0.1); without a mover, the config.bounds
 * clamp; without bounds, freely. A walking actor moves speed * SIM_DT per tick (data.speed 6 -> 0.1).
 * `steer` (walkToward's): config.actorSteerMover instead of actorMover when the config has one.
 */
export function moveActor(ctx: SimCtx, actor: ActorState, dx: number, dz: number, steer = false): void {
	if (dx === 0 && dz === 0) return;
	const config = ctx.config;
	const mover = (steer ? config.actorSteerMover : undefined) ?? config.actorMover;
	if (mover !== undefined) {
		const len = math.sqrt(dx * dx + dz * dz);
		const n = len <= STEP_TOLERANCE ? 1 : math.ceil(len / MAX_MOVE_STEP);
		const sx = dx / n;
		const sz = dz / n;
		const solid = solidCells(ctx.state); // intact breakables (docs/DECOR.md D4); undefined: the grid-only path
		for (let i = 0; i < n; i++) {
			const r = mover(actor.x, actor.z, sx, sz, actor.radius, solid);
			actor.x = r.x;
			actor.z = r.z;
		}
	} else if (config.bounds !== undefined) {
		const b = config.bounds;
		actor.x = clamp(actor.x + dx, b.minX, b.maxX);
		actor.z = clamp(actor.z + dz, b.minZ, b.maxZ);
	} else {
		actor.x += dx;
		actor.z += dz;
	}
}

/**
 * Walks `actor` toward (tx, tz) by at most `step` world units this tick (moveActor, so walls slide) and faces that way.
 * Returns the distance that was left BEFORE moving. Typical step: data.speed * SIM_DT.
 * `steer`: move with config.actorSteerMover when the config has one (endless floors: rounds pillars and wall ends).
 * Only the regular room enemies' walking passes it (chasing, walking home, a sniper looking for a line of sight); the
 * boss's charge and reposition do not (a charge must stop at a wall, and r 1.2 needs no pillar steering in its arena).
 */
export function walkToward(
	ctx: SimCtx,
	actor: ActorState,
	tx: number,
	tz: number,
	step: number,
	steer = false,
): number {
	const dx = tx - actor.x;
	const dz = tz - actor.z;
	const d2 = dx * dx + dz * dz;
	if (d2 <= 1e-12) return 0;
	const d = math.sqrt(d2);
	const k = (d < step ? d : step) / d;
	faceToward(actor, dx, dz);
	moveActor(ctx, actor, dx * k, dz * k, steer);
	return d;
}

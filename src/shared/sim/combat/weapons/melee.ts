/**
 * Melee arcs (E1.8, GDD: melee swings delete enemy bullets inside their arc; source: `src/sim/weapons/melee.ts`).
 * Trig-free: the arc is a direction (unit vector), a reach and the COSINE of its half-angle (0.5 = 120-degree swing).
 *
 * @module
 */

import type { SimCtx } from "../ctx";
import type { Vec3 } from "../bullets";
import { NO_KIND, type ActorState } from "../actors/types";
import { BulletKind, BulletPayload, fireBurstRaw, packPayload } from "../patterns";
import { MIRROR_BULLET_DAMAGE, MIRROR_BULLET_LIFE } from "../../progression/progressionData";
import { meleeHitBreakables } from "../../breakables/breakables";

/** Called for each live actor inside the arc (slot order). Usually: ctx.damageActor(actor, damage). */
export type ArcActorHit = (ctx: SimCtx, actor: ActorState) => void;

const arc = {
	x: 0,
	z: 0,
	dirX: 0,
	dirZ: 1,
	r2: 0,
	halfCos: 1,
	deleted: 0,
	reflectPayload: -1,
	eraseGoo: false,
	gooErased: 0,
};
/** The swing's ctx while its bullet walk runs (sweepArc is synchronous and never re-entered). */
let arcCtx: SimCtx | undefined;

/**
 * Where sweepArc reports the enemy bullets it erases (docs/GRAZE_PARRY.md GP1, presentation only): one x / z pair per
 * erased bullet, its position at the erase, pushed in the walk's order. Never hashed, never read by the sim.
 */
export interface ArcEraseSink {
	/** World x of each erased bullet at the erase, appended in the walk's order (the sweep never clears it). */
	x: number[];
	/** World z of each erased bullet, same index as `x`. */
	z: number[];
}

/** The sweep's erase sink while its bullet walk runs (cleared after it, like arcCtx). */
let arcSink: ArcEraseSink | undefined;

/** M2 Mirror Cloak: the erased enemy bullet at `pos` comes back as a player bullet, opposite way, same speed. */
function reflect(ctx: SimCtx, i: number, pos: Readonly<Vec3>): void {
	const c = ctx.combat;
	const v = c.enemyBullets.velocityAt(i);
	const speed = math.sqrt(v.x * v.x + v.z * v.z);
	if (!(speed > 0)) return;
	const n = fireBurstRaw(
		c.playerBullets,
		ctx.weapons.emitterId, // the guarding player's: the reflected bullet is theirs
		pos.x,
		pos.z,
		-v.x / speed,
		-v.z / speed,
		1,
		0,
		speed,
		MIRROR_BULLET_LIFE,
		arc.reflectPayload,
	);
	c.playerSpawned += n;
	c.dropped += 1 - n;
}

/** True when the point at offset (dx, dz) from the arc origin is inside the cone (any distance). */
function inCone(dx: number, dz: number, dist: number): boolean {
	const dot = dx * arc.dirX + dz * arc.dirZ;
	return dot >= arc.halfCos * dist;
}

function bulletInArc(i: number, pos: Readonly<Vec3>, payload: number): boolean {
	// Goo (docs/ENEMY_VARIANTS.md EVD14): an ordinary swing leaves it on the floor; a guard erases it quietly (not in
	// `deleted`, so no events.bulletsDeleted, no guard points, no erase sink entry, never reflected).
	const kind = BulletPayload.get(payload, "kind");
	// Strikes (docs/NEW_ENEMIES.md NED7): no sweep erases them, the guard included.
	if (kind === BulletKind.STRIKE) return false;
	const goo = kind === BulletKind.GOO;
	if (goo && !arc.eraseGoo) return false;
	const dx = pos.x - arc.x;
	const dz = pos.z - arc.z;
	const d2 = dx * dx + dz * dz;
	if (d2 > arc.r2) return false;
	if (!inCone(dx, dz, math.sqrt(d2))) return false;
	if (goo) {
		arc.gooErased++;
		return true; // consume
	}
	arc.deleted++;
	if (arcSink !== undefined) {
		arcSink.x.push(pos.x);
		arcSink.z.push(pos.z);
	}
	if (arc.reflectPayload >= 0 && arcCtx !== undefined) reflect(arcCtx, i, pos);
	return true; // consume
}

/**
 * One melee swing from (x, z) toward the unit direction (dirX, dirZ), reaching `radius` world units, covering every
 * direction within the half-angle whose cosine is `halfAngleCos`.
 *  - Live actors (slot order) whose body circle reaches into the arc get `onActor(ctx, actor)`.
 *  - With `deleteEnemyBullets`, every enemy bullet whose center is inside the arc is consumed (events.bulletsDeleted).
 *  - With `reflectSource` (M2 Mirror Cloak: the payload source, weapon index + 1), every erased enemy bullet comes back
 *    as a player bullet (one bullet, count 1 / spread 0, at its own speed, the opposite way, MIRROR_BULLET_DAMAGE).
 *  - events.meleeSwings += 1 and the swing is recorded in the acting player's weapons (ctx.weapons), unless `record` is false.
 *  - With `breakableDamage` (the sword's swings; docs/DECOR.md D4) and a run with breakables, a pass AFTER the actors:
 *    every intact piece the arc reaches takes that damage (meleeHitBreakables: the actors' arc test on the piece's
 *    circle). Not an enemy hit (no events.enemyHits, no damageDealt, no combo) and not counted in the result.
 *  - With `eraseSink` (and `deleteEnemyBullets`), each erased enemy bullet's position at the erase is pushed into it
 *    (docs/GRAZE_PARRY.md GP1: the sword's guard feeds ScoreEvents.guardX / guardZ). Presentation only: it changes
 *    nothing the sim reads, hashes or draws.
 *  - Goo puddles (BulletKind.GOO, docs/ENEMY_VARIANTS.md EVD14) are erased only with `eraseGoo` (the sword's guard):
 *    then quietly, outside events.bulletsDeleted and the erase sink, never reflected (sweepGooErased counts them).
 *    Without it a sweep leaves them on the floor.
 *  - Strikes (BulletKind.STRIKE, docs/NEW_ENEMIES.md NED7) are never erased: every sweep, the guard included, leaves them.
 *  - `finisher` (docs/SECRET_ROOMS.md SR3): the sword's third hit only; a secret's cracked wall the breakables pass reaches
 *    opens instead of knocking. Absent or false (every other sweep): exactly as before.
 * Returns the number of actors hit.
 */
export function sweepArc(
	ctx: SimCtx,
	x: number,
	z: number,
	dirX: number,
	dirZ: number,
	radius: number,
	halfAngleCos: number,
	onActor: ArcActorHit | undefined,
	deleteEnemyBullets: boolean,
	record = true,
	reflectSource?: number,
	breakableDamage?: number,
	eraseSink?: ArcEraseSink,
	eraseGoo = false,
	finisher = false,
): number {
	arc.x = x;
	arc.z = z;
	arc.dirX = dirX;
	arc.dirZ = dirZ;
	arc.r2 = radius * radius;
	arc.halfCos = halfAngleCos;
	arc.deleted = 0;
	arc.eraseGoo = eraseGoo;
	arc.gooErased = 0;
	arc.reflectPayload =
		reflectSource !== undefined ? packPayload(MIRROR_BULLET_DAMAGE, BulletKind.PLAYER, reflectSource) : -1;

	let hits = 0;
	if (onActor !== undefined) {
		for (const a of ctx.combat.actors) {
			if (a.kind === NO_KIND || a.alive === 0) continue;
			const dx = a.x - x;
			const dz = a.z - z;
			const d2 = dx * dx + dz * dz;
			const reach = radius + a.radius;
			if (d2 > reach * reach) continue;
			const d = math.sqrt(d2);
			if (d > a.radius && !inCone(dx, dz, d)) continue;
			onActor(ctx, a);
			hits++;
		}
	}
	if (breakableDamage !== undefined && ctx.state.breakables !== undefined) {
		// Builds v2 (BV5): the swinging player owns the breaks (Wrecker's splinters), generation 0.
		// docs/SECRET_ROOMS.md SR3: only the sword's finisher passes `finisher` (a crack in its arc opens).
		meleeHitBreakables(
			ctx.state,
			x,
			z,
			dirX,
			dirZ,
			radius,
			halfAngleCos,
			breakableDamage,
			ctx.playerIndex,
			finisher,
		);
	}
	if (deleteEnemyBullets) {
		arcCtx = ctx;
		arcSink = eraseSink;
		ctx.combat.enemyBullets.forEachActive(bulletInArc);
		arcCtx = undefined;
		arcSink = undefined;
		ctx.events.bulletsDeleted += arc.deleted;
	}

	if (!record) return hits;
	const w = ctx.weapons;
	w.swingTick = ctx.tick;
	w.swingX = x;
	w.swingZ = z;
	w.swingDirX = dirX;
	w.swingDirZ = dirZ;
	w.swingRadius = radius;
	w.swingHalfCos = halfAngleCos;
	ctx.events.meleeSwings += 1;
	return hits;
}

/** Goo puddles the last sweepArc erased (its `eraseGoo`; 0 after a sweep without it). Not in events.bulletsDeleted. */
export function sweepGooErased(): number {
	return arc.gooErased;
}

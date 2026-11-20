/**
 * Bullet patterns shared by enemies, bosses and player weapons (E1.8; source: `src/sim/patterns.ts`).
 *
 * Everything here is trig-free on our side: a burst is built by the library's flat gen.arc around heading 0 (+Z) and
 * turned onto a UNIT DIRECTION VECTOR with multiply-adds. Directions are always (x, z) unit vectors, never angles.
 *
 * Conventions:
 *   heading h <-> direction (sin h, cos h): h = 0 is +Z, h = PI/2 is +X (the library's convention).
 *   rotate (x, z) by an angle a given as (c, s) = (cos a, sin a):  x' = x*c + z*s,  z' = z*c - x*s
 *
 * gen.arc's sin / cos are V8's, from the generated arc table (./projectilePatterns.ts, ./arcTable.ts): a burst shape
 * the table does not hold errors ("arc table miss") instead of calling Luau's libm.
 *
 * @module
 */

import { jsMax } from "shared/jsmath";
import {
	BULLET_Y,
	ENEMY_BULLET_RADIUS,
	GOO_BULLET_RADIUS,
	STRIKE_BULLET_RADIUS,
	TURN_COS,
	TURN_SIN,
} from "./combatData";
import { BulletPayload } from "./payload";
import { compose, gen } from "./projectilePatterns";
import { releaseSpawnData, type BulletModifier, type BulletSimulation, type BulletSpawnData } from "./bullets";

export { BulletPayload } from "./payload";

/** BulletPayload `kind` values. Append new kinds when the renderer / audio need to tell bullets apart. */
export const BulletKind = {
	PLAYER: 0,
	SPRAYER: 1,
	SNIPER: 2,
	CASTER: 3,
	STRESS: 4,
	/** Generic enemy bullet (archetypes that have no look of their own yet). */
	ENEMY: 5,
	/** Boss bullets. */
	BOSS: 6,
	/**
	 * A goo puddle (Roblox port, docs/ENEMY_VARIANTS.md EVD5 / EVD13 / EVD14): a stationary enemy bullet the Ooze
	 * leaves on the floor. It hurts like any enemy bullet (with its own hit radius, enemyBulletHitRadius) and walls
	 * consume it, but it never grazes, ignores breakables (neither hurts nor is stopped by them), is not erased by an
	 * ordinary sword swing, and a sword guard erases it without guard points, the parry feed or events.bulletsDeleted.
	 * It counts in events.gooSpawned (the enemy-shoot sound skips it).
	 */
	GOO: 7,
	/**
	 * Builds (Roblox port, docs/BUILDS.md BU1): player effect bullets. Only their look and audio differ (the payload's
	 * `source` says which effect and generation, sim/builds BUILD_SOURCE_BASE): BURST Volatile's ring of bolts, SHARD
	 * Soul Shards, EMBER a stationary floor flame (Fire Arrows / Blazing Trail), SPARK_BOLT the bolts of Flurry and
	 * Thrill Seeker.
	 */
	BURST: 8,
	SHARD: 9,
	EMBER: 10,
	SPARK_BOLT: 11,
	/**
	 * A lightning strike (Roblox port, docs/NEW_ENEMIES.md NE1 / NE5, NED7): the Stormcaller's stationary enemy bullet,
	 * one per marked point, with a short life and a wide hit radius (enemyBulletHitRadius, STRIKE_BULLET_RADIUS). NE1
	 * only reserves the kind and its radius; NE5 adds its rules (GOO's exclusions: no grazes, no shoot cue, but the
	 * sword guard does NOT erase it).
	 */
	STRIKE: 12,
	/**
	 * A chain hook (Roblox port, docs/NEW_ENEMIES_2.md NX1 / NX3, NXD8): the Chainhook's thrown hook, an enemy bullet
	 * that latches on instead of hurting. NX1 only reserves the kind (no rules yet: it hits at ENEMY_BULLET_RADIUS and,
	 * fired with 0 damage, passes through like any 0-damage bullet); NX3 adds the latch in the enemy-bullet loops. Walls,
	 * pieces, rolls, the guard (a parry), the power pellet and the Hourglass treat it as an ordinary enemy bullet.
	 * 14..15 stay free.
	 */
	HOOK: 13,
} as const;

/**
 * Enemy bullet hit radius by BulletKind where it differs from ENEMY_BULLET_RADIUS (docs/ENEMY_VARIANTS.md EVD13; the
 * Stormcaller's STRIKE, docs/NEW_ENEMIES.md NE1).
 * Every kind without a row (every web kind) hits at ENEMY_BULLET_RADIUS exactly.
 */
const ENEMY_BULLET_KIND_RADIUS: ReadonlyMap<number, number> = new Map([
	[BulletKind.GOO, GOO_BULLET_RADIUS],
	[BulletKind.STRIKE, STRIKE_BULLET_RADIUS],
]);

/** The hit radius of an enemy bullet of kind `kind` (BulletKind), world units. */
export function enemyBulletHitRadius(kind: number): number {
	return ENEMY_BULLET_KIND_RADIUS.get(kind) ?? ENEMY_BULLET_RADIUS;
}

const packScratch = { damage: 0, kind: 0, source: 0, pierce: 0, lastHit: 0 };

/**
 * Packs a payload without allocating (fields must be integers in range: damage 0..63, kind 0..15, source 0..255,
 * pierce 0..7). lastHit starts at 0.
 */
export function packPayload(damage: number, kind: number, source: number, pierce = 0): number {
	packScratch.damage = damage;
	packScratch.kind = kind;
	packScratch.source = source;
	packScratch.pierce = pierce;
	return BulletPayload.pack(packScratch);
}

/** A full circle for `spread`: gen.arc closes into an evenly spaced ring (no doubled bullet). */
export const FULL_RING = math.pi * 2;

/**
 * One burst, as data. Keep specs as module-level constants in the archetype / weapon file (no allocation per shot).
 *   count   bullets in the burst (odd for aimed fans: one bullet flies exactly down the direction)
 *   spread  cone width, radians, edge to edge (>= FULL_RING: a ring). Handed to gen.arc only.
 *   speed   world units per second
 *   life    seconds (range = speed x life; walls cull earlier)
 *   damage  enemy bullets: half hearts (HIT_NORMAL 1, HIT_HEAVY 2); player bullets: enemy hit points
 *   kind    BulletKind (looks / audio)
 *   radius  optional spawn offset from the origin along each bullet's direction, world units (default 0)
 *   pierce  optional (player bullets): actors the bullet passes through before the next hit consumes it (0..7)
 *   scale   optional: drawn size multiplier (render only, never collision)
 */
export interface BurstSpec {
	readonly count: number;
	readonly spread: number;
	readonly speed: number;
	readonly life: number;
	readonly damage: number;
	readonly kind: number;
	readonly radius?: number;
	readonly pierce?: number;
	readonly scale?: number;
}

// gen.arc builds the shape around heading 0 (+Z); finishBurst turns it onto a unit direction with multiply-adds (no
// angle, no trig on our side) and stamps life, payload and an untinted color (the renderer supplies the theme color).
// Module-level scratch keeps a burst at the library's per-burst allocations.
// `limit` (fireBurstLimited only; math.huge otherwise, so every other burst is untouched): spawns past it are dropped
// before the pool sees them (the first `limit` of the arc's order are kept) and go back to the spawn data pool.
const burst = {
	count: 0,
	spread: 0,
	speed: 0,
	radius: 0,
	dirX: 0,
	dirZ: 1,
	life: 0,
	payload: 0,
	scale: 1,
	limit: math.huge,
};
const origin = { x: 0, y: BULLET_Y, z: 0 };
const WHITE = 0xffffff;
const cut: BulletSpawnData[] = [];

/**
 * Rotates the arc (built around +Z) onto (burst.dirX, burst.dirZ) and stamps life / payload / color / scale; past
 * burst.limit the spawns are cut off.
 */
const finishBurst: BulletModifier = (spawns: BulletSpawnData[]) => {
	if (spawns.size() > burst.limit) {
		while (spawns.size() > burst.limit) cut.push(spawns.pop()!);
		releaseSpawnData(cut);
		cut.clear();
	}
	// Direction at heading h is (sin h, cos h); rotating (vx, vz) by h: x' = vx*cos + vz*sin, z' = vz*cos - vx*sin.
	const cos = burst.dirZ;
	const sin = burst.dirX;
	for (const s of spawns) {
		const v = s.velocity;
		const vx = v.x;
		const vz = v.z;
		v.x = vx * cos + vz * sin;
		v.z = vz * cos - vx * sin;
		const o = s.offset;
		const ox = o.x;
		const oz = o.z;
		o.x = ox * cos + oz * sin;
		o.z = oz * cos - ox * sin;
		s.life = burst.life;
		s.payload = burst.payload;
		s.color = WHITE;
		s.scale = burst.scale;
	}
	return spawns;
};

const burstPattern = (): BulletSpawnData[] =>
	compose(gen.arc(burst.count, burst.spread, burst.speed, 0, burst.radius), finishBurst);

/**
 * Low-level: fires one burst into `sim` from (x, z) (at BULLET_Y) toward the unit direction (dirX, dirZ) with an
 * already packed payload. Returns how many bullets spawned (fewer than `count` when the pool is full).
 */
export function fireBurstRaw(
	sim: BulletSimulation,
	emitterId: number,
	x: number,
	z: number,
	dirX: number,
	dirZ: number,
	count: number,
	spread: number,
	speed: number,
	life: number,
	payload: number,
	radius = 0,
	scale = 1,
): number {
	burst.count = count;
	burst.spread = spread;
	burst.speed = speed;
	burst.radius = radius;
	burst.dirX = dirX;
	burst.dirZ = dirZ;
	burst.life = life;
	burst.payload = payload;
	burst.scale = scale;
	origin.x = x;
	origin.z = z;
	return sim.fireAt(origin, burstPattern, emitterId);
}

/**
 * Fires `spec` into `sim` toward the unit direction (dirX, dirZ); `source` goes into the payload. Returns spawned.
 * `speedScale` (endless mode's enemy bullet speed scaling) multiplies spec.speed only: the burst's SHAPE (count,
 * spread) never changes, so no arc-table entry is needed. 1 leaves spec.speed untouched.
 */
export function fireBurst(
	sim: BulletSimulation,
	emitterId: number,
	x: number,
	z: number,
	dirX: number,
	dirZ: number,
	spec: BurstSpec,
	source = 0,
	speedScale = 1,
): number {
	return fireBurstRaw(
		sim,
		emitterId,
		x,
		z,
		dirX,
		dirZ,
		spec.count,
		spec.spread,
		speedScale === 1 ? spec.speed : spec.speed * speedScale,
		spec.life,
		packPayload(spec.damage, spec.kind, source, spec.pierce ?? 0),
		spec.radius ?? 0,
		spec.scale ?? 1,
	);
}

/**
 * Restores fireBurst's limit (stepCombat calls it first every tick): a tick that threw inside fireBurstLimited must not
 * leave every later burst in this VM cut short (a replay validator may run several runs in one VM under pcall).
 */
export function resetBurstLimit(): void {
	burst.limit = math.huge;
}

/**
 * fireBurst that spawns at most `limit` of the burst's bullets (the first ones of the arc's order: a ring is cut short,
 * not re-spaced, so the shape stays an arc-table row). Builds' effect budget (sim/builds effects.ts fireEffect).
 * Returns how many spawned (also fewer when the pool is full).
 */
export function fireBurstLimited(
	sim: BulletSimulation,
	emitterId: number,
	x: number,
	z: number,
	dirX: number,
	dirZ: number,
	spec: BurstSpec,
	source: number,
	limit: number,
): number {
	if (limit <= 0) return 0;
	if (limit >= spec.count) return fireBurst(sim, emitterId, x, z, dirX, dirZ, spec, source);
	burst.limit = limit;
	const n = fireBurst(sim, emitterId, x, z, dirX, dirZ, spec, source);
	burst.limit = math.huge;
	return n;
}

// ---------------------------------------------------------------------------------------------
// Directions (unit vectors, no angles)

/** A writable 2D vector on the ground plane. Helpers write their result into one (no allocation). */
export interface Dir {
	x: number;
	z: number;
}

/**
 * Rotates the unit vector (x, z) by the angle whose cosine / sine are (cos, sin), re-normalizes with sqrt (so rounding
 * never makes it drift off unit length), and writes it to `out`. Positive sin turns from +Z toward +X.
 */
export function rotateDir(x: number, z: number, cos: number, sin: number, out: Dir): Dir {
	const nx = x * cos + z * sin;
	const nz = z * cos - x * sin;
	const inv = 1 / math.sqrt(nx * nx + nz * nz);
	out.x = nx * inv;
	out.z = nz * inv;
	return out;
}

/** Turns (x, z) by the shared spiral step (TURN_COS, TURN_SIN; ~14.25 degrees) into `out`. */
export function turnDir(x: number, z: number, out: Dir): Dir {
	return rotateDir(x, z, TURN_COS, TURN_SIN, out);
}

/**
 * The rotation by HALF the angle of (cos, sin), for 0 <= angle <= PI, using only sqrt (IEEE-exact):
 * cos(a/2) = sqrt((1 + cos a) / 2), sin(a/2) = sqrt((1 - cos a) / 2). Writes { x: cos, z: sin } into `out`.
 */
export function halfRotation(cos: number, out: Dir): Dir {
	out.x = math.sqrt((1 + cos) / 2);
	out.z = math.sqrt(jsMax(0, (1 - cos) / 2));
	return out;
}

/**
 * Unit direction from (fromX, fromZ) toward (toX, toZ) into `out`. When the points coincide (closer than 1e-6) it
 * writes (fallbackX, fallbackZ) instead and returns false.
 */
export function aimAt(
	fromX: number,
	fromZ: number,
	toX: number,
	toZ: number,
	out: Dir,
	fallbackX = 0,
	fallbackZ = 1,
): boolean {
	const dx = toX - fromX;
	const dz = toZ - fromZ;
	const d2 = dx * dx + dz * dz;
	if (d2 <= 1e-12) {
		out.x = fallbackX;
		out.z = fallbackZ;
		return false;
	}
	const inv = 1 / math.sqrt(d2);
	out.x = dx * inv;
	out.z = dz * inv;
	return true;
}

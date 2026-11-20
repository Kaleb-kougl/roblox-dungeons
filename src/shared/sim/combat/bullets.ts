/**
 * Portions ported from @k9kbdev/r3f-projectiles 0.6.0 (`dist/chunk-7SBM6O5V.js`: `SimulationCore`,
 * `createBulletSimulation`; `dist/chunk-OVREUSTD.js`: the spawn-data pool).
 * Copyright (c) Kaleb Kougl. License: the package.json and README declare MIT, but the package's LICENSE file
 * contains GPLv3; unresolved, see THIRD_PARTY_NOTICES.md.
 *
 * The bullet pool (E1.6): a headless, deterministic r3f-projectiles `BulletSimulation`. The web build steps two of
 * them (`enemyBullets`, `playerBullets`) from combat.ts; this is a line-for-line port of the parts the sim and its
 * renderer use, with IDENTICAL arithmetic order and iteration order (fixtures/hashed-fields.md "r3f-projectiles
 * BulletSimulation internals"):
 *
 *   - sparse set: `free` is a LIFO stack initialised so the first acquired slot is 0, then 1, 2, ...; `dense` holds
 *     live slots, removal is swap-remove; `slotToDense[slot]` is -1 for a free slot;
 *   - `step`, `forEachActive` and `clear` walk `dense` BACKWARDS (d = count - 1 .. 0), so collision callbacks see
 *     bullets in the library's order; releasing during the walk is safe (the element swapped in was already visited);
 *   - `step` per bullet: prev = pos; vel += acc * dt; pos += vel * dt (per component, two roundings each, never fused);
 *     life -= dt; release when life <= 0 or (bounds culling on) |p| > limit on any axis;
 *   - `writeStateHash`: 10 numbers per live slot in ASCENDING slot order.
 *
 * Port notes: positions / velocities / accelerations are per-slot `{ x, y, z }` tables (three.js `Vector3` holds plain
 * doubles), so `forEachActive` hands out the live position and `velocityAt` / `positionAt` the live vectors, as the
 * library does: read them, never keep them. Getters became a field (`activeCount`, kept equal to the dense count) and
 * methods (`highWater()`, `capacity`). Not ported (render-only, no effect on the sim): the render sink, dirty-range /
 * sync-generation bookkeeping, `boundsCenter`, easing curves other than linear, the reduced-motion spawn cap. Colors
 * are kept as the 24-bit hex the pattern set (the library converts to linear RGB floats for its shader).
 * All loops are `while` loops: their bounds change inside the body (swap-remove) or must be re-read like JS does.
 *
 * @module
 */

/** Plain 3D vector (three.js `Vector3` in the source; doubles). */
export interface Vec3 {
	x: number;
	y: number;
	z: number;
}

/** One bullet to spawn, as the library's pattern generators produce it (`gen.arc` + modifiers). */
export interface BulletSpawnData {
	/** Added to the fire origin. */
	offset: Vec3;
	velocity: Vec3;
	acceleration: Vec3;
	/** Seconds before the bullet starts moving / colliding (always 0 in the sim). */
	delay: number;
	/** 24-bit color, or undefined for the library default (0xff3333). Render only. */
	color: number | undefined;
	/** Seconds to live. */
	life: number;
	payload: number;
	/** Drawn size multiplier. Render only. */
	scale: number;
}

/** A pattern: produces the spawn list for one `fireAt` call (array order = slot acquisition order). */
export type BulletPattern = () => BulletSpawnData[];

/** A modifier: edits a spawn list in place and returns it (the library's `Modifier`). */
export type BulletModifier = (spawns: BulletSpawnData[]) => BulletSpawnData[];

/**
 * `forEachActive` callback: return true to release slot `i` now. `pos` is the live position (read it, never keep it).
 */
export type BulletVisitor = (i: number, pos: Readonly<Vec3>, payload: number, emitter: number) => boolean | void;

/** Called by `fireAt` when the pool could not hold the whole burst. */
export type PoolExhaustedCallback = (
	emitterId: number,
	requested: number,
	spawned: number,
	reason: "pool-full",
) => void;

export interface BulletSimulationOptions {
	/** Slot count (fixed at creation; default 2000). Must be a non-negative integer. */
	readonly maxBullets?: number;
	/** Half-extent of the culling cube around the origin (default 25); `math.huge` turns culling off. */
	readonly boundsLimit?: number;
	/** Keep start-of-step positions for render interpolation (`previousPositionAt`). Default false. */
	readonly interpolation?: boolean;
	/** Seconds over which `fadeAt` shrinks a bullet at the end of its life (render only; default 1). */
	readonly fadeTime?: number;
	readonly onPoolExhausted?: PoolExhaustedCallback;
}

/** What the sim (and the renderer) use of a bullet pool. Plain fields instead of the library's getters. */
export interface BulletSimulation {
	readonly capacity: number;
	readonly boundsLimit: number;
	readonly interpolation: boolean;
	readonly fadeTime: number;
	/** Live bullets (the library's `activeCount` getter = `_denseCount`). Read only. */
	activeCount: number;
	/** `step()` calls that advanced the pool (the library's `stepCount` getter). Read only. */
	stepCount: number;
	/** Next emitter id (ids from 1, never reset). */
	acquireEmitter(): number;
	/** Only raises the emitter counter if needed (the library's behaviour). */
	releaseEmitter(id: number): void;
	/** Advances every live bullet by `dt` (backward dense walk), releasing expired / out-of-bounds ones. */
	step(dt: number): void;
	/** Releases every live bullet (or only `emitterId`'s); returns how many. */
	clear(emitterId?: number): number;
	/** Live bullets fired by `emitterId`. */
	activeCountFor(emitterId: number): number;
	/** Visits live, visible bullets (backward dense walk); a `true` return releases that slot immediately. */
	forEachActive(visit: BulletVisitor): void;
	/** Appends 10 numbers per live bullet in ascending slot order (slot, pos, vel, life, payload, emitter). */
	writeStateHash(out: number[]): void;
	/** Sets a live bullet's payload (no-op for a free slot). */
	setPayload(i: number, payload: number): void;
	/**
	 * Roblox port (docs/BUILDS.md BU5, Soul Swarm's steering): sets a live bullet's x / z velocity (y kept; no-op for a
	 * free slot). Velocity is already hashed (writeStateHash), so the hash layout is unchanged.
	 */
	setVelocity(i: number, x: number, z: number): void;
	/** Spawns `pattern()` at `origin`; returns how many spawned (a full pool drops the rest). */
	fireAt(origin: Readonly<Vec3>, pattern: BulletPattern, emitterId?: number): number;
	/** One past the highest slot used since the pool was last empty (0 when empty). For renderers. */
	highWater(): number;
	isLive(i: number): boolean;
	isVisible(i: number): boolean;
	/** Live position / velocity of slot `i` (read them, never keep them). */
	positionAt(i: number): Readonly<Vec3>;
	velocityAt(i: number): Readonly<Vec3>;
	/** Start-of-step position (the current one without `interpolation`), written into `out`. */
	previousPositionAt(i: number, out: Vec3): Vec3;
	lifeAt(i: number): number;
	delayAt(i: number): number;
	payloadAt(i: number): number;
	emitterIdAt(i: number): number;
	scaleAt(i: number): number;
	/** 24-bit color of slot `i`. */
	colorAt(i: number): number;
	/** End-of-life shrink factor in [0, 1] (linear over `fadeTime`). Render only. */
	fadeAt(i: number): number;
}

// ---------------------------------------------------------------------------------------------
// Spawn data pool (chunk-OVREUSTD.js `acquire` / `releaseSpawnData`): every field is reset on reuse, so pooling has
// no effect on values; it only keeps a burst at one array allocation.

const MAX_SPAWN_POOL_SIZE = 2e4;
const spawnPool: BulletSpawnData[] = [];
const pooled = new Set<BulletSpawnData>();

/** A spawn record with the library defaults (zero vectors, delay 0, life 5, payload 0, scale 1, no color). */
export function acquireSpawnData(): BulletSpawnData {
	const p = spawnPool.pop();
	if (p !== undefined) {
		pooled.delete(p);
		const o = p.offset;
		o.x = 0;
		o.y = 0;
		o.z = 0;
		const v = p.velocity;
		v.x = 0;
		v.y = 0;
		v.z = 0;
		const a = p.acceleration;
		a.x = 0;
		a.y = 0;
		a.z = 0;
		p.delay = 0;
		p.color = undefined;
		p.life = 5;
		p.payload = 0;
		p.scale = 1;
		return p;
	}
	return {
		offset: { x: 0, y: 0, z: 0 },
		velocity: { x: 0, y: 0, z: 0 },
		acceleration: { x: 0, y: 0, z: 0 },
		delay: 0,
		color: undefined,
		life: 5,
		payload: 0,
		scale: 1,
	};
}

/** Returns a spent spawn list's records to the pool (fireAt does this after spawning). */
export function releaseSpawnData(spawns: ReadonlyArray<BulletSpawnData> | undefined): void {
	if (spawns === undefined) return;
	for (const item of spawns) {
		if (spawnPool.size() < MAX_SPAWN_POOL_SIZE && !pooled.has(item)) {
			pooled.add(item);
			spawnPool.push(item);
		}
	}
}

// ---------------------------------------------------------------------------------------------
// The pool

const DEFAULT_MAX_BULLETS = 2e3;
const DEFAULT_BOUNDS_LIMIT = 25;
const DEFAULT_FADE_TIME = 1;
/** The library's spawn color when a pattern sets none. */
const DEFAULT_COLOR = 0xff3333;

/** `fadeScale(life, fadeTime, linear)` from the library. */
function fadeScale(life: number, fadeTime: number): number {
	if (!(fadeTime > 0)) return 1;
	if (life >= fadeTime) return 1;
	const p = 1 - life / fadeTime;
	const s = 1 - p;
	return s === s && s !== math.huge && s !== -math.huge ? math.max(0, s) : 1;
}

class SimulationCore implements BulletSimulation {
	readonly capacity: number;
	readonly boundsLimit: number;
	readonly interpolation: boolean;
	readonly fadeTime: number;
	activeCount = 0;
	stepCount = 0;
	private readonly onPoolExhausted: PoolExhaustedCallback | undefined;

	// Per-slot state.
	private readonly pos: Vec3[];
	private readonly vel: Vec3[];
	private readonly acc: Vec3[];
	private readonly delay: number[];
	private readonly life: number[];
	private readonly payload: number[];
	private readonly emitter: number[];
	private readonly scale: number[];
	private readonly color: number[];
	/** Start-of-step positions, 3 per slot (only with interpolation). */
	private readonly prev: number[] | undefined;

	// Sparse set.
	private readonly dense: number[];
	private readonly slotToDense: number[];
	private readonly free: number[];
	private freeTop = 0;
	private highWaterMark = 0;

	/** Next emitter id. Monotonic from 1; 0 is never issued. */
	private nextEmitterId = 1;

	constructor(capacity: number, options: BulletSimulationOptions) {
		this.boundsLimit = options.boundsLimit ?? DEFAULT_BOUNDS_LIMIT;
		this.fadeTime = options.fadeTime ?? DEFAULT_FADE_TIME;
		this.onPoolExhausted = options.onPoolExhausted;
		this.interpolation = options.interpolation === true;
		this.capacity = capacity;
		const pos = table.create<Vec3>(capacity);
		const vel = table.create<Vec3>(capacity);
		const acc = table.create<Vec3>(capacity);
		let i = 0;
		while (i < capacity) {
			pos.push({ x: 0, y: 0, z: 0 });
			vel.push({ x: 0, y: 0, z: 0 });
			acc.push({ x: 0, y: 0, z: 0 });
			i++;
		}
		this.pos = pos;
		this.vel = vel;
		this.acc = acc;
		this.delay = table.create(capacity, 0);
		this.life = table.create(capacity, 0);
		this.payload = table.create(capacity, 0);
		this.emitter = table.create(capacity, 0);
		this.scale = table.create(capacity, 1);
		this.color = table.create(capacity, 0);
		this.prev = this.interpolation ? table.create(capacity * 3, 0) : undefined;
		this.dense = table.create(capacity, 0);
		this.slotToDense = table.create(capacity, -1);
		// _reset(capacity): free[i] = capacity - 1 - i, so the first acquired slot is 0.
		const free = table.create<number>(capacity, 0);
		i = 0;
		while (i < capacity) {
			free[i] = capacity - 1 - i;
			i++;
		}
		this.free = free;
		this.freeTop = capacity;
	}

	/** Pops a free slot and appends it to `dense`; -1 when full. */
	private acquireSlot(): number {
		if (this.freeTop === 0) return -1;
		this.freeTop -= 1;
		const slot = this.free[this.freeTop];
		const d = this.activeCount;
		this.activeCount = d + 1;
		this.dense[d] = slot;
		this.slotToDense[slot] = d;
		if (slot >= this.highWaterMark) this.highWaterMark = slot + 1;
		return slot;
	}

	/** Swap-removes `slot` from `dense` and pushes it on the free stack. */
	private releaseSlot(slot: number): void {
		const d = this.slotToDense[slot];
		if (d < 0) return;
		this.activeCount -= 1;
		const last = this.dense[this.activeCount];
		this.dense[d] = last;
		this.slotToDense[last] = d;
		this.slotToDense[slot] = -1;
		this.free[this.freeTop] = slot;
		this.freeTop += 1;
	}

	// ---- Spawning ----------------------------------------------------------------------------------

	fireAt(origin: Readonly<Vec3>, pattern: BulletPattern, emitterId = 0): number {
		if (emitterId >= this.nextEmitterId) this.nextEmitterId = emitterId + 1;
		const spawnData = pattern();
		const requested = spawnData.size();
		const ox = origin.x;
		const oy = origin.y;
		const oz = origin.z;
		const prev = this.prev;
		let spawned = 0;
		let d = 0;
		while (d < requested) {
			const slot = this.acquireSlot();
			if (slot === -1) break;
			const data = spawnData[d];
			const p = this.pos[slot];
			const off = data.offset;
			// p.copy(origin).add(offset)
			p.x = ox + off.x;
			p.y = oy + off.y;
			p.z = oz + off.z;
			this.delay[slot] = data.delay;
			this.life[slot] = data.life;
			this.payload[slot] = data.payload;
			this.emitter[slot] = emitterId;
			this.scale[slot] = data.scale;
			const v = this.vel[slot];
			const dv = data.velocity;
			v.x = dv.x;
			v.y = dv.y;
			v.z = dv.z;
			const a = this.acc[slot];
			const da = data.acceleration;
			a.x = da.x;
			a.y = da.y;
			a.z = da.z;
			this.color[slot] = data.color ?? DEFAULT_COLOR;
			if (prev !== undefined) {
				const c = slot * 3;
				prev[c] = p.x;
				prev[c + 1] = p.y;
				prev[c + 2] = p.z;
			}
			spawned++;
			d++;
		}
		releaseSpawnData(spawnData);
		const cb = this.onPoolExhausted;
		if (cb !== undefined && spawned < requested) cb(emitterId, requested, spawned, "pool-full");
		return spawned;
	}

	acquireEmitter(): number {
		const id = this.nextEmitterId;
		this.nextEmitterId = id + 1;
		return id;
	}

	releaseEmitter(id: number): void {
		if (id >= this.nextEmitterId) this.nextEmitterId = id + 1;
	}

	// ---- Stepping ----------------------------------------------------------------------------------

	step(dt: number): void {
		// Ignored unless 0 < dt < Infinity (the library warns in dev builds; NaN fails both tests).
		if (!(dt > 0 && dt < math.huge)) return;
		const prev = this.prev;
		const limit = this.boundsLimit;
		const cullBounds = limit !== math.huge;
		const pos = this.pos;
		const vel = this.vel;
		const acc = this.acc;
		const delay = this.delay;
		const life = this.life;
		const dense = this.dense;
		let d = this.activeCount - 1;
		while (d >= 0) {
			const i = dense[d];
			d--;
			if (delay[i] > 0) {
				delay[i] -= dt;
				if (delay[i] > 0) continue;
			}
			const p = pos[i];
			const v = vel[i];
			const px = p.x;
			const py = p.y;
			const pz = p.z;
			if (prev !== undefined) {
				const o = i * 3;
				prev[o] = px;
				prev[o + 1] = py;
				prev[o + 2] = pz;
			}
			// v.addScaledVector(acc, dt); p.addScaledVector(v, dt): x += a.x * dt, per component (two roundings each).
			const a = acc[i];
			const vx = v.x + a.x * dt;
			const vy = v.y + a.y * dt;
			const vz = v.z + a.z * dt;
			v.x = vx;
			v.y = vy;
			v.z = vz;
			const nx = px + vx * dt;
			const ny = py + vy * dt;
			const nz = pz + vz * dt;
			p.x = nx;
			p.y = ny;
			p.z = nz;
			const left = life[i] - dt;
			life[i] = left;
			// boundsCenter is (0, 0, 0) in the sim, so the library's |p - 0| > limit is |p| > limit, written without a
			// call: x > limit || x < -limit is the same test for every double (NaN fails both, -0 like 0).
			if (
				left <= 0 ||
				(cullBounds && (nx > limit || nx < -limit || ny > limit || ny < -limit || nz > limit || nz < -limit))
			) {
				this.releaseSlot(i);
			}
		}
		this.stepCount += 1;
	}

	// ---- Consuming and clearing --------------------------------------------------------------------

	clear(emitterId?: number): number {
		const fieldWide = emitterId === undefined;
		const dense = this.dense;
		let released = 0;
		let d = this.activeCount - 1;
		while (d >= 0) {
			const i = dense[d];
			d--;
			if (!fieldWide && this.emitter[i] !== emitterId) continue;
			this.releaseSlot(i);
			released++;
		}
		return released;
	}

	activeCountFor(emitterId: number): number {
		const dense = this.dense;
		const emitter = this.emitter;
		let n = 0;
		let d = this.activeCount - 1;
		while (d >= 0) {
			if (emitter[dense[d]] === emitterId) n++;
			d--;
		}
		return n;
	}

	forEachActive(visit: BulletVisitor): void {
		const dense = this.dense;
		const delay = this.delay;
		const pos = this.pos;
		const payload = this.payload;
		const emitter = this.emitter;
		let d = this.activeCount - 1;
		while (d >= 0) {
			const i = dense[d];
			d--;
			if (delay[i] > 0) continue;
			if (visit(i, pos[i], payload[i], emitter[i]) === true) this.releaseSlot(i);
		}
	}

	setPayload(i: number, payload: number): void {
		if (!(this.slotToDense[i] >= 0)) return;
		this.payload[i] = payload;
	}

	setVelocity(i: number, x: number, z: number): void {
		if (!(this.slotToDense[i] >= 0)) return;
		const v = this.vel[i];
		v.x = x;
		v.z = z;
	}

	// ---- Hashing -----------------------------------------------------------------------------------

	writeStateHash(out: number[]): void {
		if (this.activeCount === 0) return;
		const s2d = this.slotToDense;
		const n = this.highWaterMark;
		let i = 0;
		while (i < n) {
			if (s2d[i] >= 0) {
				const p = this.pos[i];
				const v = this.vel[i];
				out.push(i, p.x, p.y, p.z, v.x, v.y, v.z, this.life[i], this.payload[i], this.emitter[i]);
			}
			i++;
		}
	}

	// ---- Read access -------------------------------------------------------------------------------

	highWater(): number {
		if (this.activeCount === 0) this.highWaterMark = 0;
		return this.highWaterMark;
	}
	isLive(i: number): boolean {
		return this.slotToDense[i] >= 0;
	}
	isVisible(i: number): boolean {
		return this.slotToDense[i] >= 0 && !(this.delay[i] > 0);
	}
	positionAt(i: number): Readonly<Vec3> {
		return this.pos[i];
	}
	velocityAt(i: number): Readonly<Vec3> {
		return this.vel[i];
	}
	previousPositionAt(i: number, out: Vec3): Vec3 {
		const prev = this.prev;
		if (prev === undefined) {
			const p = this.pos[i];
			out.x = p.x;
			out.y = p.y;
			out.z = p.z;
			return out;
		}
		const o = i * 3;
		out.x = prev[o];
		out.y = prev[o + 1];
		out.z = prev[o + 2];
		return out;
	}
	lifeAt(i: number): number {
		return this.life[i];
	}
	delayAt(i: number): number {
		return this.delay[i];
	}
	payloadAt(i: number): number {
		return this.payload[i];
	}
	emitterIdAt(i: number): number {
		return this.emitter[i];
	}
	scaleAt(i: number): number {
		return this.scale[i];
	}
	colorAt(i: number): number {
		return this.color[i];
	}
	fadeAt(i: number): number {
		return fadeScale(this.life[i], this.fadeTime);
	}
}

/**
 * A new, empty bullet pool (`createBulletSimulation` from r3f-projectiles/core). Throws the library's RangeError
 * message when `maxBullets` is not a non-negative integer.
 */
export function createBulletSimulation(options: BulletSimulationOptions = {}): BulletSimulation {
	const maxBullets = options.maxBullets ?? DEFAULT_MAX_BULLETS;
	if (!(maxBullets === maxBullets && maxBullets >= 0 && maxBullets % 1 === 0 && maxBullets !== math.huge)) {
		error(`[r3f-projectiles] maxBullets must be a non-negative integer; got ${maxBullets}.`, 0);
	}
	return new SimulationCore(maxBullets, options);
}

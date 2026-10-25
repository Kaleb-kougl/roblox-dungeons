/**
 * Death particle bursts: the pure half (port of project-kaleb-vale src/fx/particles/particles.ts @ 42897e2).
 *
 *   ParticlePool   fixed SoA pool (capacity 512): spawn (recycles the most-faded particle when the live limit is
 *                  reached), step (exponential drag, hop with gravity + one small bounce, lifetime), no allocation.
 *   RingPool       small pool of expanding 1 px ground rings (RING_SEGMENTS dots each) for the kill-spot flash.
 *   BurstQueue     delayed bursts (the boss death's three waves).
 *   DeathParticleSystem   the event -> burst rules (counts per enemy size / settings, colours, reducedMotion) and
 *                  draw(writer) of every ring dot and particle.
 *
 * Units: ground motion in SIM units (x, z, velocities per second) on the floor plane; the hop height `h` is in RENDER
 * PIXELS (screen-up). The client turns h into a world height (ParticleController); the web build instead shifted the
 * floor anchor up the screen so its depth-tested quads stayed behind bullets. Roblox bullets are opaque Parts drawn in
 * the same pass, so a lifted part is fine.
 *
 * Presentation only: the PRNG is render-side (seeded per burst from the actor id), nothing here touches the sim.
 *
 * Port changes: typed arrays -> plain arrays (Float32 storage rounding is gone, irrelevant for presentation); the
 * QuadBatch writer became ParticleWriter (anchor, hop px, size px, palette index, alpha); trig tables via math.cos/sin.
 */
import type { JuiceSettings, ParticlesLevel } from "shared/settings";
import { COLOR_ROLES, type ColorRole } from "shared/theme";
import { effectiveParticles, particleBudget } from "./juiceRules";
import { RenderRng } from "./rng";

// ---------------------------------------------------------------------------------------------
// Tuning constants

/** Pool capacity: the web README hard cap (512 live particles). The live limit is particleBudget(settings) <= this. */
export const PARTICLE_POOL_CAPACITY = 512;
/** Concurrent ring flashes. */
export const RING_CAPACITY = 16;
/** Dots per ring; big (boss) rings use BIG_RING_SEGMENTS so they stay a ring. */
export const RING_SEGMENTS = 16;
export const BIG_RING_SEGMENTS = 32;
/** Most drawn quads: every particle + every ring dot. */
export const PARTICLE_QUAD_CAPACITY = PARTICLE_POOL_CAPACITY + RING_CAPACITY * BIG_RING_SEGMENTS;

/** Density multiplier per (effective) particle level. */
export const LEVEL_SCALE: Readonly<Record<ParticlesLevel, number>> = { off: 0, low: 0.5, normal: 1, high: 1.5 };

/** Regular kill at 'normal': this many particles (before the elite / level multipliers). */
export const BURST_MIN = 12;
export const BURST_MAX = 20;
/** Elite kills: count multiplier and spark share. */
export const ELITE_MULT = 1.5;
export const SPARK_FRACTION = 0.25;
export const ELITE_SPARK_FRACTION = 0.35;
/** "Big" enemies (hpMax >= BIG_HP or spriteScale >= BIG_SCALE) add CHUNKS 3x3 chunks (part of the count). */
export const BIG_HP = 8;
export const BIG_SCALE = 1.2;
export const CHUNKS = 3;

/** Particle kinds. */
export const KIND_BODY = 0;
export const KIND_SPARK = 1;
export const KIND_CHUNK = 2;

/** Per-kind motion: speed range (world units/s), drag (1/s, exponential), life (s), hop launch range (px/s). */
export interface KindTuning {
	readonly speedMin: number;
	readonly speedMax: number;
	readonly drag: number;
	readonly life: number;
	readonly hopMin: number;
	readonly hopMax: number;
	/** Fraction of life spent fully opaque before the linear fade. */
	readonly hold: number;
}

export const TUNING: ReadonlyArray<KindTuning> = [
	/* body  */ { speedMin: 4, speedMax: 11, drag: 9, life: 0.4, hopMin: 30, hopMax: 70, hold: 0.45 },
	/* spark */ { speedMin: 7, speedMax: 15, drag: 11, life: 0.24, hopMin: 40, hopMax: 90, hold: 0.3 },
	/* chunk */ { speedMin: 2, speedMax: 5, drag: 7, life: 0.6, hopMin: 20, hopMax: 40, hold: 0.6 },
];
/** Lifetime jitter: life * (1 +- LIFE_JITTER). */
export const LIFE_JITTER = 0.2;
/** Hop gravity, render px/s^2, and the bounce (a landing particle keeps this share of its fall speed, once). */
export const HOP_GRAVITY = 420;
export const HOP_BOUNCE = 0.3;
/** Bounces slower than this stop (px/s). */
export const HOP_MIN_BOUNCE = 12;
/** Spawn spread around the kill spot, world units. */
export const SPAWN_RADIUS = 0.2;
/** Particles start at the sprite's body (px above the feet): [START_H_MIN, START_H_MAX * spriteScale]. */
export const START_H_MIN = 3;
export const START_H_MAX = 10;
/** In the last SHRINK_AT share of its life a particle drops one pixel size (2x2 -> 1x1, 3x3 -> 2x2). */
export const SHRINK_AT = 0.65;
/** Particle pixel sizes: chunks, big bits / sparks, small bits. */
const CHUNK_PX = 3;
const BIG_PX = 2;
const SMALL_PX = 1;
/** Chance of a 2 px spark. */
const BIG_SPARK_CHANCE = 0.25;
/** Chance of a 2 px body bit (big enemies / regular / boss waves). */
const BIG_BIT_CHANCE_BIG = 0.65;
const BIG_BIT_CHANCE = 0.5;
const BIG_BIT_CHANCE_BOSS = 0.7;
/** Elites fly faster. */
const ELITE_SPEED = 1.2;
/** Angular jitter of a burst's golden-angle spiral, radians. */
const ANGLE_JITTER = 0.3;
/** Smallest life (s) a particle / ring may have. */
const MIN_LIFE = 0.001;

/** reducedMotion: slower, shorter, no hop, rings flash in place (counts drop one level via effectiveParticles). */
export const REDUCED_SPEED = 0.5;
export const REDUCED_LIFE = 0.7;

/** Kill-spot ring flash: radius r0 -> r1 (world units, ease-out) over life seconds; 1 px dots. */
export const RING_LIFE = 0.15;
export const RING_R0 = 0.15;
export const RING_R1 = 0.75;
export const ELITE_RING_R1 = 1.05;
/** reducedMotion: the ring shows at this share of r1 without expanding. */
export const REDUCED_RING_AT = 0.7;

/** Boss death: three waves (seconds after 'bossDefeated'), each a burst + ring. */
export interface BossWave {
	readonly delay: number;
	readonly count: number;
	readonly chunks: number;
	readonly speedMult: number;
	readonly ringR1: number;
}
export const BOSS_WAVES: ReadonlyArray<BossWave> = [
	{ delay: 0, count: 36, chunks: 4, speedMult: 1.5, ringR1: 2.2 },
	{ delay: 0.2, count: 28, chunks: 2, speedMult: 1.2, ringR1: 1.6 },
	{ delay: 0.4, count: 44, chunks: 8, speedMult: 1.8, ringR1: 2.8 },
];
/** Boss bursts start higher (the sprite is ~60 px tall) and wider (its body radius is 1.2): px / world units. */
export const BOSS_START_H_MAX = 40;
export const BOSS_SPAWN_RADIUS = 0.9;
export const BOSS_RING_LIFE = 0.3;
export const BOSS_SPARK_FRACTION = 0.35;

/** Boss phase change (roar): sparks only + a ring. Phases <= 1 (fight start) are skipped. */
export const ROAR_SPARKS = 16;
export const ROAR_SPEED_MULT = 1.4;
export const ROAR_RING_R1 = 2.4;

/** Hit sparks: a couple of tiny sparks on every 'hit' (set false to disable). */
export const HIT_SPARKS_ENABLED = true;
export const HIT_SPARKS = 2;
export const HIT_SPARKS_HEAVY = 3;
export const HIT_SPARK_LIFE = 0.14;
export const HIT_SPARK_SPEED_MIN = 4;
export const HIT_SPARK_SPEED_MAX = 9;
/** Hit sparks never recycle: they spawn only while the pool is below this share of the live limit (deaths first). */
export const HIT_SPARK_MAX_FILL = 0.5;
/** ... and only at these (effective) levels. */
export const HIT_SPARK_LEVELS: ReadonlyArray<ParticlesLevel> = ["normal", "high"];

/** Golden angle (radians): burst directions spread evenly for any particle count. */
export const GOLDEN_ANGLE = math.pi * (3 - math.sqrt(5));
const TAU = 2 * math.pi;
/** Spread of each wave's seed (the web build's 0x2545f491 step). */
const WAVE_SEED_STEP = 0x2545f491;
const UINT32 = 4294967296;

/** Palette indices every palette starts with; archetype colours follow at PALETTE_KIND_BASE + kind. */
export const PAL_WHITE = 0;
export const PAL_SPARK = 1;
export const PAL_ELITE = 2;
export const PAL_BOSS = 3;
export const PALETTE_KIND_BASE = 4;

/**
 * The colour role of an archetype's particles: 'boss' for bosses, else its sprite id when that is a colour role
 * (enemy.swarmer, enemy.sniper, ...; turrets use enemy.sprayer / sniper / caster), else particleSpark.
 */
export function particleColorRole(data: { readonly spriteId: string; readonly boss?: boolean }): ColorRole {
	if (data.boss === true) return "boss";
	return (COLOR_ROLES as ReadonlyArray<string>).includes(data.spriteId)
		? (data.spriteId as ColorRole)
		: "particleSpark";
}

// ---------------------------------------------------------------------------------------------
// Particle pool

function filled(n: number, v: number): number[] {
	const out: number[] = [];
	for (let i = 0; i < n; i++) out.push(v);
	return out;
}

/** Fixed SoA particle pool. Live particles are packed in [0, count) (swap-remove on death). */
export class ParticlePool {
	readonly capacity: number;
	readonly x: number[];
	readonly z: number[];
	readonly vx: number[];
	readonly vz: number[];
	/** Hop height above the floor (render px) and its vertical speed (px/s, up). */
	readonly h: number[];
	readonly vh: number[];
	readonly age: number[];
	readonly life: number[];
	readonly drag: number[];
	readonly size: number[];
	readonly color: number[];
	readonly kind: number[];
	/** Bounces left (1 at spawn). */
	readonly bounces: number[];
	count = 0;
	/** Live particles replaced because the limit was reached (since creation). */
	recycled = 0;
	/** Particles spawned since creation. */
	spawned = 0;

	constructor(capacity = PARTICLE_POOL_CAPACITY) {
		this.capacity = capacity;
		this.x = filled(capacity, 0);
		this.z = filled(capacity, 0);
		this.vx = filled(capacity, 0);
		this.vz = filled(capacity, 0);
		this.h = filled(capacity, 0);
		this.vh = filled(capacity, 0);
		this.age = filled(capacity, 0);
		this.life = filled(capacity, 1);
		this.drag = filled(capacity, 0);
		this.size = filled(capacity, 1);
		this.color = filled(capacity, 0);
		this.kind = filled(capacity, 0);
		this.bounces = filled(capacity, 0);
	}

	clear(): void {
		this.count = 0;
	}

	/**
	 * Index for a new particle under `limit` live particles (clamped to capacity): the next free index, or, when full,
	 * the oldest one (highest age / life: the most faded, least visible), which is recycled. -1 when limit <= 0.
	 */
	private slot(limit: number): number {
		const lim = limit < this.capacity ? limit : this.capacity;
		if (lim <= 0) return -1;
		if (this.count < lim) {
			const i = this.count;
			this.count++;
			return i;
		}
		let best = 0;
		let bestT = -1;
		// Over the limit (it shrank): recycle among the first `lim` only; the rest die out on their own.
		for (let i = 0; i < lim; i++) {
			const t = this.age[i] / this.life[i];
			if (t > bestT) {
				bestT = t;
				best = i;
			}
		}
		this.recycled++;
		return best;
	}

	/** Spawn one particle (recycling the oldest when `limit` is reached). Returns its index or -1. */
	spawn(
		limit: number,
		x: number,
		z: number,
		vx: number,
		vz: number,
		h: number,
		vh: number,
		life: number,
		drag: number,
		size: number,
		color: number,
		kind: number,
	): number {
		const i = this.slot(limit);
		if (i < 0) return -1;
		this.x[i] = x;
		this.z[i] = z;
		this.vx[i] = vx;
		this.vz[i] = vz;
		this.h[i] = h;
		this.vh[i] = vh;
		this.age[i] = 0;
		this.life[i] = life > MIN_LIFE ? life : MIN_LIFE;
		this.drag[i] = drag;
		this.size[i] = size;
		this.color[i] = color;
		this.kind[i] = kind;
		this.bounces[i] = 1;
		this.spawned++;
		return i;
	}

	/** Remove particle i (swap with the last live one). */
	private remove(i: number): void {
		this.count--;
		const j = this.count;
		if (i === j) return;
		this.x[i] = this.x[j];
		this.z[i] = this.z[j];
		this.vx[i] = this.vx[j];
		this.vz[i] = this.vz[j];
		this.h[i] = this.h[j];
		this.vh[i] = this.vh[j];
		this.age[i] = this.age[j];
		this.life[i] = this.life[j];
		this.drag[i] = this.drag[j];
		this.size[i] = this.size[j];
		this.color[i] = this.color[j];
		this.kind[i] = this.kind[j];
		this.bounces[i] = this.bounces[j];
	}

	/**
	 * Advance every particle by dt seconds: exact exponential drag on the ground velocity (frame-rate independent:
	 * travel to rest = v0 / drag), hop under HOP_GRAVITY with one HOP_BOUNCE, age; expired particles are removed.
	 */
	step(dt: number): void {
		if (!(dt > 0)) return;
		let i = 0;
		while (i < this.count) {
			const a = this.age[i] + dt;
			if (a >= this.life[i]) {
				this.remove(i);
				continue; // the swapped-in particle is at i now
			}
			this.age[i] = a;
			const k = this.drag[i];
			const d = math.exp(-k * dt);
			const f = k > 0 ? (1 - d) / k : dt;
			this.x[i] += this.vx[i] * f;
			this.z[i] += this.vz[i] * f;
			this.vx[i] *= d;
			this.vz[i] *= d;
			let h = this.h[i];
			let vh = this.vh[i];
			if (h > 0 || vh > 0) {
				h += vh * dt - 0.5 * HOP_GRAVITY * dt * dt;
				vh -= HOP_GRAVITY * dt;
				if (h <= 0) {
					h = 0;
					const up = -vh * HOP_BOUNCE;
					if (this.bounces[i] > 0 && up >= HOP_MIN_BOUNCE) {
						vh = up;
						this.bounces[i]--;
					} else vh = 0;
				}
				this.h[i] = h;
				this.vh[i] = vh;
			}
			i++;
		}
	}
}

/** Opacity of a particle: 1 for the first `hold` share of its life, then linear to 0. */
export function particleAlpha(age: number, life: number, kind: number): number {
	const t = age / life;
	const tuning = TUNING[kind];
	const hold = tuning !== undefined ? tuning.hold : 0.5;
	if (t <= hold) return 1;
	if (t >= 1) return 0;
	return (1 - t) / (1 - hold);
}

/** Drawn size (px): one pixel smaller in the last SHRINK_AT share of life (never below 1). */
export function particleSize(size: number, age: number, life: number): number {
	return size > 1 && age > life * SHRINK_AT ? size - 1 : size;
}

// ---------------------------------------------------------------------------------------------
// Rings

/** Unit circle table for the ring dots. */
const RING_COS: number[] = [];
const RING_SIN: number[] = [];
for (let k = 0; k < BIG_RING_SEGMENTS; k++) {
	RING_COS.push(math.cos((k / BIG_RING_SEGMENTS) * TAU));
	RING_SIN.push(math.sin((k / BIG_RING_SEGMENTS) * TAU));
}

/** Expanding ground rings (oldest replaced when full). */
export class RingPool {
	readonly capacity: number;
	readonly x: number[];
	readonly z: number[];
	readonly age: number[];
	readonly life: number[];
	readonly r0: number[];
	readonly r1: number[];
	readonly color: number[];
	/** 1 = expand r0 -> r1; 0 = fixed radius (reducedMotion). */
	readonly expand: number[];
	/** Dots drawn: RING_SEGMENTS or BIG_RING_SEGMENTS. */
	readonly segments: number[];
	count = 0;

	constructor(capacity = RING_CAPACITY) {
		this.capacity = capacity;
		this.x = filled(capacity, 0);
		this.z = filled(capacity, 0);
		this.age = filled(capacity, 0);
		this.life = filled(capacity, 1);
		this.r0 = filled(capacity, 0);
		this.r1 = filled(capacity, 0);
		this.color = filled(capacity, 0);
		this.expand = filled(capacity, 0);
		this.segments = filled(capacity, RING_SEGMENTS);
	}

	clear(): void {
		this.count = 0;
	}

	spawn(
		x: number,
		z: number,
		r0: number,
		r1: number,
		life: number,
		color: number,
		expand: boolean,
		segments = RING_SEGMENTS,
	): number {
		let i: number;
		if (this.count < this.capacity) {
			i = this.count;
			this.count++;
		} else {
			i = 0;
			for (let k = 1; k < this.count; k++) if (this.age[k] / this.life[k] > this.age[i] / this.life[i]) i = k;
		}
		this.x[i] = x;
		this.z[i] = z;
		this.age[i] = 0;
		this.life[i] = life > MIN_LIFE ? life : MIN_LIFE;
		this.r0[i] = r0;
		this.r1[i] = r1;
		this.color[i] = color;
		this.expand[i] = expand ? 1 : 0;
		this.segments[i] = segments >= BIG_RING_SEGMENTS ? BIG_RING_SEGMENTS : RING_SEGMENTS;
		return i;
	}

	step(dt: number): void {
		if (!(dt > 0)) return;
		let i = 0;
		while (i < this.count) {
			const a = this.age[i] + dt;
			if (a >= this.life[i]) {
				this.count--;
				const j = this.count;
				if (i !== j) {
					this.x[i] = this.x[j];
					this.z[i] = this.z[j];
					this.age[i] = this.age[j];
					this.life[i] = this.life[j];
					this.r0[i] = this.r0[j];
					this.r1[i] = this.r1[j];
					this.color[i] = this.color[j];
					this.expand[i] = this.expand[j];
					this.segments[i] = this.segments[j];
				}
				continue;
			}
			this.age[i] = a;
			i++;
		}
	}

	/** Radius of ring i now (ease-out quad), world units. */
	radius(i: number): number {
		const t = this.age[i] / this.life[i];
		if (this.expand[i] === 0) return this.r1[i] * REDUCED_RING_AT;
		const e = 1 - (1 - t) * (1 - t);
		return this.r0[i] + (this.r1[i] - this.r0[i]) * e;
	}

	/** Opacity of ring i now (linear fade). */
	alpha(i: number): number {
		const t = this.age[i] / this.life[i];
		return t >= 1 ? 0 : 1 - t;
	}
}

// ---------------------------------------------------------------------------------------------
// Delayed bursts (boss waves)

/** Pending burst types. */
export const PENDING_BOSS_WAVE = 0;
const BURST_QUEUE_CAPACITY = 16;

export type BurstFire = (burstType: number, arg: number, x: number, z: number, seed: number) => void;

/** Fixed queue of delayed bursts; due ones are handed to `fire` (oldest first) by advance(). */
export class BurstQueue {
	readonly capacity: number;
	readonly delay: number[];
	readonly x: number[];
	readonly z: number[];
	readonly burstType: number[];
	/** Type-specific argument (boss wave index). */
	readonly arg: number[];
	readonly seed: number[];
	count = 0;
	dropped = 0;

	constructor(capacity = BURST_QUEUE_CAPACITY) {
		this.capacity = capacity;
		this.delay = filled(capacity, 0);
		this.x = filled(capacity, 0);
		this.z = filled(capacity, 0);
		this.burstType = filled(capacity, 0);
		this.arg = filled(capacity, 0);
		this.seed = filled(capacity, 0);
	}

	clear(): void {
		this.count = 0;
	}

	/** Queue a burst `delay` seconds from now. False (and counted) when full. */
	schedule(delay: number, x: number, z: number, burstType: number, arg: number, seed: number): boolean {
		if (this.count >= this.capacity) {
			this.dropped++;
			return false;
		}
		const i = this.count;
		this.count++;
		this.delay[i] = delay;
		this.x[i] = x;
		this.z[i] = z;
		this.burstType[i] = burstType;
		this.arg[i] = arg;
		this.seed[i] = seed;
		return true;
	}

	/** Spend dt seconds; every entry whose delay ran out is passed to fire(...) and removed (order kept). */
	advance(dt: number, fire: BurstFire): void {
		let w = 0;
		const n = this.count;
		for (let i = 0; i < n; i++) {
			const d = this.delay[i] - (dt > 0 ? dt : 0);
			if (d <= 0) {
				fire(this.burstType[i], this.arg[i], this.x[i], this.z[i], this.seed[i]);
				continue;
			}
			this.delay[w] = d;
			this.x[w] = this.x[i];
			this.z[w] = this.z[i];
			this.burstType[w] = this.burstType[i];
			this.arg[w] = this.arg[i];
			this.seed[w] = this.seed[i];
			w++;
		}
		// fire() only spawns (never schedules), so entries never move under us.
		this.count = w;
	}
}

// ---------------------------------------------------------------------------------------------
// Counts

/** Particles of one regular kill at 'normal': 12..20 by size, before elite / level multipliers. */
export function baseBurstCount(hpMax: number, spriteScale: number): number {
	const hp = hpMax > 1 ? hpMax : 1;
	const scale = spriteScale > 1 ? spriteScale : 1;
	const n = math.round(10 + 2 * (math.log(hp) / math.log(2)) + 8 * (scale - 1));
	return n < BURST_MIN ? BURST_MIN : n > BURST_MAX ? BURST_MAX : n;
}

export function isBigEnemy(hpMax: number, spriteScale: number): boolean {
	return hpMax >= BIG_HP || spriteScale >= BIG_SCALE;
}

/** Out-parameter of burstCounts (preallocate one; no allocation). */
export interface BurstCounts {
	total: number;
	sparks: number;
	chunks: number;
	body: number;
}

export function emptyCounts(): BurstCounts {
	return { total: 0, sparks: 0, chunks: 0, body: 0 };
}

/** How many particles a kill spawns, split into sparks / 3x3 chunks / body bits, for these settings. */
export function burstCounts(
	hpMax: number,
	spriteScale: number,
	elite: boolean,
	settings: Readonly<JuiceSettings>,
	out: BurstCounts,
): BurstCounts {
	const level = effectiveParticles(settings);
	const m = LEVEL_SCALE[level];
	const base = baseBurstCount(hpMax, spriteScale) * (elite ? ELITE_MULT : 1);
	const total = m > 0 ? math.max(1, math.round(base * m)) : 0;
	const chunkBase = isBigEnemy(hpMax, spriteScale) ? CHUNKS + (elite ? 1 : 0) : elite ? 1 : 0;
	let chunks = total > 0 && chunkBase > 0 ? math.max(1, math.round(chunkBase * m)) : 0;
	let sparks = math.round(total * (elite ? ELITE_SPARK_FRACTION : SPARK_FRACTION));
	if (chunks + sparks > total) chunks = math.max(0, total - sparks);
	if (chunks + sparks > total) sparks = total - chunks;
	out.total = total;
	out.sparks = sparks;
	out.chunks = chunks;
	out.body = total - sparks - chunks;
	return out;
}

/** Particles of boss wave `wave` (index into BOSS_WAVES) for these settings. */
export function bossWaveCount(wave: number, settings: Readonly<JuiceSettings>): number {
	const w = BOSS_WAVES[wave];
	if (w === undefined) return 0;
	const m = LEVEL_SCALE[effectiveParticles(settings)];
	return m > 0 ? math.max(1, math.round(w.count * m)) : 0;
}

// ---------------------------------------------------------------------------------------------
// The system

/** Where the system draws: one call per ring dot / particle (sim x / z, hop height px, size px, palette, alpha). */
export interface ParticleWriter {
	push(x: number, z: number, hopPx: number, sizePx: number, color: number, alpha: number): void;
}

/** Parameters of one radial burst (a reused object; no allocation). */
interface BurstSpec {
	x: number;
	z: number;
	body: number;
	sparks: number;
	chunks: number;
	bodyColor: number;
	sparkColorA: number;
	sparkColorB: number;
	/** Multiplies every speed. */
	speed: number;
	/** Start height range max (px). */
	startH: number;
	/** Chance of 2x2 (vs 1x1) for body bits. */
	big: number;
	/** Spawn spread around the centre, world units. */
	radius: number;
}

/**
 * Bursts from FX events, stepped and drawn every frame. Settings are passed in on every call (the live settings), so
 * a change applies to the next burst.
 */
export class DeathParticleSystem {
	readonly pool: ParticlePool;
	readonly rings: RingPool;
	readonly queue: BurstQueue;
	readonly rng = new RenderRng(1);
	private readonly counts = emptyCounts();
	private readonly spec: BurstSpec = {
		x: 0,
		z: 0,
		body: 0,
		sparks: 0,
		chunks: 0,
		bodyColor: 0,
		sparkColorA: 0,
		sparkColorB: 0,
		speed: 1,
		startH: START_H_MAX,
		big: BIG_BIT_CHANCE,
		radius: SPAWN_RADIUS,
	};
	/** Settings of the current update (read by the queue callback). */
	private settings: Readonly<JuiceSettings> | undefined;
	/** Bound once: the queue's fire callback (no closure per frame). */
	private readonly fire: BurstFire = (burstType, arg, x, z, seed) => {
		const s = this.settings;
		if (burstType === PENDING_BOSS_WAVE && s !== undefined) this.bossWave(arg, x, z, seed, s);
	};

	constructor(capacity = PARTICLE_POOL_CAPACITY) {
		this.pool = new ParticlePool(capacity);
		this.rings = new RingPool();
		this.queue = new BurstQueue();
	}

	/** Drop everything (run reset, particles off). */
	clear(): void {
		this.pool.clear();
		this.rings.clear();
		this.queue.clear();
	}

	/** Live limit for these settings (particleBudget, clamped to the pool). */
	limit(settings: Readonly<JuiceSettings>): number {
		const b = particleBudget(settings);
		return b < this.pool.capacity ? b : this.pool.capacity;
	}

	/** A regular (non-boss) kill. `color` = palette index of the archetype's colour role. */
	killed(
		x: number,
		z: number,
		hpMax: number,
		spriteScale: number,
		color: number,
		elite: boolean,
		seed: number,
		settings: Readonly<JuiceSettings>,
	): void {
		const c = burstCounts(hpMax, spriteScale, elite, settings, this.counts);
		if (c.total <= 0) return;
		this.rng.seed(seed);
		const s = this.spec;
		s.x = x;
		s.z = z;
		s.body = c.body;
		s.sparks = c.sparks;
		s.chunks = c.chunks;
		s.bodyColor = color;
		s.sparkColorA = elite ? PAL_ELITE : PAL_WHITE;
		s.sparkColorB = elite ? PAL_ELITE : PAL_SPARK;
		s.speed = elite ? ELITE_SPEED : 1;
		s.startH = START_H_MAX * (spriteScale > 1 ? spriteScale : 1);
		s.big = isBigEnemy(hpMax, spriteScale) ? BIG_BIT_CHANCE_BIG : BIG_BIT_CHANCE;
		s.radius = SPAWN_RADIUS;
		this.burst(s, settings);
		this.ring(x, z, elite ? ELITE_RING_R1 : RING_R1, RING_LIFE, elite ? PAL_ELITE : PAL_SPARK, settings);
	}

	/** The boss died: queue BOSS_WAVES (wave 0 fires on the next update, before drawing). */
	bossDefeated(x: number, z: number, seed: number, settings: Readonly<JuiceSettings>): void {
		if (LEVEL_SCALE[effectiveParticles(settings)] <= 0) return;
		for (let w = 0; w < BOSS_WAVES.size(); w++) {
			this.queue.schedule(BOSS_WAVES[w].delay, x, z, PENDING_BOSS_WAVE, w, (seed + w * WAVE_SEED_STEP) % UINT32);
		}
	}

	/** A boss phase change (roar): ring + sparks. Phase <= 1 (the fight starting) does nothing. */
	bossPhase(x: number, z: number, phase: number, seed: number, settings: Readonly<JuiceSettings>): void {
		if (phase <= 1) return;
		const m = LEVEL_SCALE[effectiveParticles(settings)];
		if (m <= 0) return;
		this.rng.seed(seed);
		const s = this.spec;
		s.x = x;
		s.z = z;
		s.body = 0;
		s.chunks = 0;
		s.sparks = math.max(1, math.round(ROAR_SPARKS * m));
		s.bodyColor = PAL_BOSS;
		s.sparkColorA = PAL_BOSS;
		s.sparkColorB = PAL_SPARK;
		s.speed = ROAR_SPEED_MULT;
		s.startH = BOSS_START_H_MAX;
		s.big = BIG_BIT_CHANCE;
		s.radius = BOSS_SPAWN_RADIUS;
		this.burst(s, settings);
		this.ring(x, z, ROAR_RING_R1, BOSS_RING_LIFE, PAL_BOSS, settings, BIG_RING_SEGMENTS);
	}

	/** A few tiny sparks on a hit (HIT_SPARKS_ENABLED, normal / high only, never recycling death particles). */
	hit(x: number, z: number, heavy: boolean, seed: number, settings: Readonly<JuiceSettings>): void {
		if (!HIT_SPARKS_ENABLED) return;
		if (!HIT_SPARK_LEVELS.includes(effectiveParticles(settings))) return;
		const limit = this.limit(settings);
		const n = heavy ? HIT_SPARKS_HEAVY : HIT_SPARKS;
		if (this.pool.count + n > limit * HIT_SPARK_MAX_FILL) return;
		this.rng.seed(seed);
		const reduced = settings.reducedMotion;
		const sp = reduced ? REDUCED_SPEED : 1;
		const life = HIT_SPARK_LIFE * (reduced ? REDUCED_LIFE : 1);
		const t = TUNING[KIND_SPARK];
		const a0 = this.rng.next() * TAU;
		for (let i = 0; i < n; i++) {
			const a = a0 + ((i + this.rng.range(-ANGLE_JITTER, ANGLE_JITTER)) / n) * TAU;
			const v = this.rng.range(HIT_SPARK_SPEED_MIN, HIT_SPARK_SPEED_MAX) * sp;
			const h = this.rng.range(START_H_MIN, START_H_MAX);
			const color = i % 2 === 0 ? PAL_WHITE : PAL_SPARK;
			this.pool.spawn(limit, x, z, math.cos(a) * v, math.sin(a) * v, h, 0, life, t.drag, 1, color, KIND_SPARK);
		}
	}

	/** Advance by dt seconds (already time-scaled): due boss waves fire, particles and rings move / age. */
	update(dt: number, settings: Readonly<JuiceSettings>): void {
		if (LEVEL_SCALE[effectiveParticles(settings)] <= 0) {
			this.clear();
			return;
		}
		this.settings = settings;
		// Wave bursts spawn before the step: a wave at delay 0 is drawn this frame at its start position.
		this.queue.advance(dt, this.fire);
		this.settings = undefined;
		this.pool.step(dt);
		this.rings.step(dt);
	}

	/** Every ring dot and particle (rings first, so particles sit on top). Returns the number of pushes. */
	draw(writer: ParticleWriter): number {
		let n = 0;
		const r = this.rings;
		for (let i = 0; i < r.count; i++) {
			const rad = r.radius(i);
			const alpha = r.alpha(i);
			const stride = BIG_RING_SEGMENTS / r.segments[i];
			for (let k = 0; k < BIG_RING_SEGMENTS; k += stride) {
				writer.push(r.x[i] + RING_COS[k] * rad, r.z[i] + RING_SIN[k] * rad, 0, SMALL_PX, r.color[i], alpha);
				n++;
			}
		}
		const p = this.pool;
		for (let i = 0; i < p.count; i++) {
			const age = p.age[i];
			const life = p.life[i];
			const s = particleSize(p.size[i], age, life);
			writer.push(p.x[i], p.z[i], p.h[i], s, p.color[i], particleAlpha(age, life, p.kind[i]));
			n++;
		}
		return n;
	}

	// --- internals

	private bossWave(wave: number, x: number, z: number, seed: number, settings: Readonly<JuiceSettings>): void {
		const w = BOSS_WAVES[wave];
		const total = bossWaveCount(wave, settings);
		if (w === undefined || total <= 0) return;
		const m = LEVEL_SCALE[effectiveParticles(settings)];
		this.rng.seed(seed);
		const s = this.spec;
		s.x = x;
		s.z = z;
		s.chunks = math.min(total, math.max(1, math.round(w.chunks * m)));
		s.sparks = math.min(total - s.chunks, math.round(total * BOSS_SPARK_FRACTION));
		s.body = total - s.chunks - s.sparks;
		s.bodyColor = PAL_BOSS;
		s.sparkColorA = PAL_WHITE;
		s.sparkColorB = PAL_SPARK;
		s.speed = w.speedMult;
		s.startH = BOSS_START_H_MAX;
		s.big = BIG_BIT_CHANCE_BOSS;
		s.radius = BOSS_SPAWN_RADIUS;
		this.burst(s, settings);
		const ringColor = wave === 1 ? PAL_SPARK : PAL_BOSS;
		this.ring(x, z, w.ringR1, BOSS_RING_LIFE, ringColor, settings, BIG_RING_SEGMENTS);
	}

	private ring(
		x: number,
		z: number,
		r1: number,
		life: number,
		color: number,
		settings: Readonly<JuiceSettings>,
		segments = RING_SEGMENTS,
	): void {
		const reduced = settings.reducedMotion;
		this.rings.spawn(x, z, RING_R0, r1, life * (reduced ? REDUCED_LIFE : 1), color, !reduced, segments);
	}

	/** Spawn one radial burst: chunks first (they matter most), then body bits, then sparks; angles stratified. */
	private burst(s: BurstSpec, settings: Readonly<JuiceSettings>): void {
		const limit = this.limit(settings);
		if (limit <= 0) return;
		const reduced = settings.reducedMotion;
		const n = s.chunks + s.body + s.sparks;
		const a0 = this.rng.next() * TAU;
		for (let i = 0; i < n; i++) {
			const kind = i < s.chunks ? KIND_CHUNK : i < s.chunks + s.body ? KIND_BODY : KIND_SPARK;
			const t = TUNING[kind];
			// Golden-angle spiral with jitter: every prefix (the chunks, the body bits, the sparks) spreads evenly.
			const a = a0 + i * GOLDEN_ANGLE + this.rng.range(-ANGLE_JITTER, ANGLE_JITTER);
			const v = this.rng.range(t.speedMin, t.speedMax) * s.speed * (reduced ? REDUCED_SPEED : 1);
			const ca = math.cos(a);
			const sa = math.sin(a);
			const r = this.rng.next() * s.radius;
			const life = t.life * (1 + this.rng.range(-LIFE_JITTER, LIFE_JITTER)) * (reduced ? REDUCED_LIFE : 1);
			const h = this.rng.range(START_H_MIN, s.startH);
			const vh = reduced ? 0 : this.rng.range(t.hopMin, t.hopMax);
			let size: number;
			let color: number;
			if (kind === KIND_CHUNK) {
				size = CHUNK_PX;
				color = s.bodyColor;
			} else if (kind === KIND_BODY) {
				size = this.rng.next() < s.big ? BIG_PX : SMALL_PX;
				color = s.bodyColor;
			} else {
				size = this.rng.next() < BIG_SPARK_CHANCE ? BIG_PX : SMALL_PX;
				color = i % 2 === 0 ? s.sparkColorA : s.sparkColorB;
			}
			this.pool.spawn(limit, s.x + ca * r, s.z + sa * r, ca * v, sa * v, h, vh, life, t.drag, size, color, kind);
		}
	}
}

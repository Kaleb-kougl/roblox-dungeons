// Death particles and the shared juice rules (port of project-kaleb-vale src/fx/particles/particles.test.ts and the
// rule half of src/fx/settings.test.ts @ 42897e2).
import { describe, expect, it } from "@rbxts/jest-globals";
import { defaultJuiceSettings, type JuiceSettings, type ParticlesLevel } from "shared/settings";
import { archetypeAt, archetypeIds } from "shared/sim";
import { PLACEHOLDER_MANIFEST } from "shared/theme";
import { effectiveParticles, freezeFrameOn, motionScale, particleBudget, screenShakeOn } from "./juiceRules";
import {
	BIG_RING_SEGMENTS,
	BOSS_WAVES,
	BURST_MAX,
	BURST_MIN,
	BurstQueue,
	DeathParticleSystem,
	HOP_GRAVITY,
	KIND_BODY,
	KIND_CHUNK,
	KIND_SPARK,
	LIFE_JITTER,
	PALETTE_KIND_BASE,
	PAL_ELITE,
	PARTICLE_POOL_CAPACITY,
	PARTICLE_QUAD_CAPACITY,
	ParticlePool,
	REDUCED_LIFE,
	REDUCED_RING_AT,
	REDUCED_SPEED,
	RING_SEGMENTS,
	ROAR_SPARKS,
	RingPool,
	TUNING,
	baseBurstCount,
	bossWaveCount,
	burstCounts,
	emptyCounts,
	particleAlpha,
	particleColorRole,
	particleSize,
	type ParticleWriter,
} from "./particles";
import { RenderRng, burstSeed } from "./rng";

const settings = (particles: ParticlesLevel = "normal", reducedMotion = false): JuiceSettings => ({
	...defaultJuiceSettings(false),
	particles,
	reducedMotion,
});

const SWARMER = { hp: 2, scale: 1 };
const SNIPER = { hp: 4, scale: 1 };
const BRUISER = { hp: 10, scale: 1.35 };
const TURRET = { hp: 12, scale: 1 };

/** Records every push. */
class RecordingWriter implements ParticleWriter {
	readonly pushes: Array<{ x: number; z: number; hop: number; size: number; color: number; alpha: number }> = [];
	push(x: number, z: number, hopPx: number, sizePx: number, color: number, alpha: number): void {
		this.pushes.push({ x, z, hop: hopPx, size: sizePx, color, alpha });
	}
}

describe("juice rules", () => {
	it("reducedMotion lowers particles one level, turns off freeze and shake, and zeroes decorative motion", () => {
		expect(effectiveParticles(settings("high", true))).toBe("normal");
		expect(effectiveParticles(settings("normal", true))).toBe("low");
		expect(effectiveParticles(settings("low", true))).toBe("low");
		expect(effectiveParticles(settings("off", true))).toBe("off");
		expect([particleBudget(settings("off")), particleBudget(settings("low"))]).toEqual([0, 128]);
		expect([particleBudget(settings("normal")), particleBudget(settings("high"))]).toEqual([320, 512]);
		expect(particleBudget(settings("high", true))).toBe(320);
		expect(freezeFrameOn(settings())).toBe(true);
		expect(freezeFrameOn({ ...settings(), freezeFrame: false })).toBe(false);
		expect(freezeFrameOn(settings("normal", true))).toBe(false);
		expect(screenShakeOn(settings())).toBe(true);
		expect(screenShakeOn(settings("normal", true))).toBe(false);
		// port (docs/FEEL.md J8): the screenShake setting of its own; reducedMotion still wins
		expect(screenShakeOn({ ...settings(), screenShake: false })).toBe(false);
		expect(screenShakeOn({ ...settings("normal", true), screenShake: true })).toBe(false);
		expect(motionScale(settings())).toBe(1);
		expect(motionScale(settings("normal", true))).toBe(0);
	});
});

describe("burst counts", () => {
	it("scales 12..20 with enemy size (hpMax, spriteScale)", () => {
		expect(baseBurstCount(SWARMER.hp, SWARMER.scale)).toBe(12);
		expect(baseBurstCount(SNIPER.hp, SNIPER.scale)).toBe(14);
		expect(baseBurstCount(TURRET.hp, TURRET.scale)).toBe(17);
		expect(baseBurstCount(BRUISER.hp, BRUISER.scale)).toBe(19);
		expect(baseBurstCount(1, 1)).toBe(BURST_MIN);
		expect(baseBurstCount(480, 1.25)).toBe(BURST_MAX);
		expect(baseBurstCount(0, 0)).toBe(BURST_MIN);
	});

	it("splits into ~25% sparks, 3x3 chunks only for big enemies; elites are bigger with more sparks", () => {
		expect(burstCounts(SWARMER.hp, SWARMER.scale, false, settings(), emptyCounts())).toEqual({
			total: 12,
			sparks: 3,
			chunks: 0,
			body: 9,
		});
		expect(burstCounts(BRUISER.hp, BRUISER.scale, false, settings(), emptyCounts())).toEqual({
			total: 19,
			sparks: 5,
			chunks: 3,
			body: 11,
		});
		const c = burstCounts(SWARMER.hp, SWARMER.scale, true, settings(), emptyCounts());
		expect([c.total, c.sparks, c.chunks]).toEqual([18, 6, 1]);
	});

	it("follows the particles setting and reducedMotion (one level lower)", () => {
		const total = (level: ParticlesLevel, reduced = false) =>
			burstCounts(SNIPER.hp, SNIPER.scale, false, settings(level, reduced), emptyCounts()).total;
		expect([total("off"), total("low"), total("normal"), total("high")]).toEqual([0, 7, 14, 21]);
		expect([total("high", true), total("normal", true), total("low", true), total("off", true)]).toEqual([
			14, 7, 7, 0,
		]);
	});

	it("parts always add up and never go negative; boss waves scale with the setting", () => {
		for (const level of ["off", "low", "normal", "high"] as const) {
			for (const [hp, scale] of [
				[1, 1],
				[2, 1],
				[10, 1.35],
				[480, 1.25],
			]) {
				for (const elite of [false, true]) {
					const c = burstCounts(hp, scale, elite, settings(level), emptyCounts());
					expect(c.sparks + c.chunks + c.body).toBe(c.total);
					expect(math.min(c.sparks, c.chunks, c.body) >= 0).toBe(true);
				}
			}
		}
		expect(bossWaveCount(0, settings())).toBe(BOSS_WAVES[0].count);
		expect(bossWaveCount(2, settings("high"))).toBe(math.round(BOSS_WAVES[2].count * 1.5));
		expect(bossWaveCount(1, settings("off"))).toBe(0);
		expect(bossWaveCount(9, settings())).toBe(0);
	});
});

describe("colour roles", () => {
	it("maps every registered archetype to a colour role of the placeholder pack", () => {
		const colors = PLACEHOLDER_MANIFEST.colors as unknown as Record<string, string>;
		const ids = archetypeIds();
		for (let k = 0; k < ids.size(); k++) {
			const data = archetypeAt(k).data;
			const role = particleColorRole(data);
			expect([ids[k], colors[role] !== undefined]).toEqual([ids[k], true]);
			if (data.boss === true) expect(role).toBe("boss");
		}
		expect(particleColorRole({ spriteId: "enemy.unknown" })).toBe("particleSpark");
	});
});

describe("ParticlePool", () => {
	const spawn = (p: ParticlePool, limit: number, life = 1, vx = 0, drag = 0) =>
		p.spawn(limit, 0, 0, vx, 0, 0, 0, life, drag, 1, 0, KIND_BODY);

	it("respects the live limit and the fixed capacity", () => {
		const p = new ParticlePool(8);
		for (let i = 0; i < 20; i++) spawn(p, 100);
		expect(p.count).toBe(8);
		expect(spawn(new ParticlePool(8), 0)).toBe(-1);
	});

	it("recycles the oldest (most faded) particle when full", () => {
		const p = new ParticlePool(16);
		spawn(p, 4, 1);
		spawn(p, 4, 1);
		spawn(p, 4, 1);
		p.step(0.5);
		spawn(p, 4, 0.6);
		p.age[1] = 0.9;
		const i = p.spawn(4, 7, 7, 0, 0, 0, 0, 1, 0, 2, 3, KIND_SPARK);
		expect(i).toBe(1);
		expect(p.count).toBe(4);
		expect(p.recycled).toBe(1);
		expect(p.x[1]).toBe(7);
		expect(p.age[1]).toBe(0);
		expect(p.kind[1]).toBe(KIND_SPARK);
	});

	it("applies exponential drag, frame-rate independent, and comes to rest at v0 / drag", () => {
		const a = new ParticlePool(1);
		const b = new ParticlePool(1);
		spawn(a, 1, 10, 9, 9);
		spawn(b, 1, 10, 9, 9);
		a.step(0.1);
		for (let i = 0; i < 10; i++) b.step(0.01);
		const expected = 1 - math.exp(-0.9);
		expect(a.x[0]).toBeCloseTo(expected, 5);
		expect(b.x[0]).toBeCloseTo(expected, 5);
		for (let i = 0; i < 60; i++) a.step(0.05);
		expect(a.x[0]).toBeCloseTo(1, 3);
		expect(math.abs(a.vx[0])).toBeLessThan(0.01);
	});

	it("hops up, lands, bounces once and settles on the floor (never below)", () => {
		const p = new ParticlePool(1);
		p.spawn(1, 0, 0, 0, 0, 4, 60, 5, 0, 1, 0, KIND_BODY);
		let peak = 0;
		let landings = 0;
		let prev = p.h[0];
		for (let i = 0; i < 200; i++) {
			p.step(1 / 120);
			const h = p.h[0];
			expect(h >= 0).toBe(true);
			if (h > peak) peak = h;
			if (h === 0 && prev > 0) landings++;
			prev = h;
		}
		expect(peak).toBeGreaterThan(4 + (60 * 60) / (2 * HOP_GRAVITY) - 0.5);
		expect(landings).toBe(2);
		expect(p.h[0]).toBe(0);
		expect(p.vh[0]).toBe(0);
	});

	it("removes particles at the end of their life and keeps the others (swap-remove)", () => {
		const p = new ParticlePool(8);
		p.spawn(8, 1, 0, 0, 0, 0, 0, 0.1, 0, 1, 0, KIND_BODY);
		p.spawn(8, 2, 0, 0, 0, 0, 0, 0.5, 0, 1, 0, KIND_BODY);
		p.spawn(8, 3, 0, 0, 0, 0, 0, 0.2, 0, 1, 0, KIND_BODY);
		p.step(0.15);
		expect(p.count).toBe(2);
		expect(p.x[0] + p.x[1]).toBe(5);
		p.step(0.1);
		expect(p.count).toBe(1);
		expect(p.x[0]).toBe(2);
		p.step(1);
		expect(p.count).toBe(0);
		p.step(0 / 0);
		expect(p.count).toBe(0);
	});

	it("fades after holding, and drops one pixel size near the end", () => {
		const hold = TUNING[KIND_BODY].hold;
		expect(particleAlpha(0, 1, KIND_BODY)).toBe(1);
		expect(particleAlpha(hold, 1, KIND_BODY)).toBe(1);
		expect(particleAlpha((1 + hold) / 2, 1, KIND_BODY)).toBeCloseTo(0.5, 5);
		expect(particleAlpha(1, 1, KIND_BODY)).toBe(0);
		expect([particleSize(3, 0.1, 1), particleSize(3, 0.9, 1), particleSize(2, 0.9, 1)]).toEqual([3, 2, 1]);
		expect(particleSize(1, 0.9, 1)).toBe(1);
	});
});

describe("RingPool and BurstQueue", () => {
	it("rings expand with ease-out and fade; the most faded is replaced when full; reducedMotion holds still", () => {
		const r = new RingPool(4);
		r.spawn(0, 0, 0.2, 1, 0.2, 1, true);
		expect(r.radius(0)).toBeCloseTo(0.2, 5);
		r.step(0.1);
		expect(r.radius(0)).toBeCloseTo(0.2 + 0.8 * 0.75, 5);
		expect(r.alpha(0)).toBeCloseTo(0.5, 5);
		r.step(0.11);
		expect(r.count).toBe(0);
		const full = new RingPool(2);
		full.spawn(1, 0, 0, 1, 1, 0, true);
		full.spawn(2, 0, 0, 1, 1, 0, true);
		full.age[0] = 0.8;
		full.spawn(3, 0, 0, 1, 1, 0, true);
		expect(full.x[0]).toBe(3);
		const still = new RingPool(1);
		still.spawn(0, 0, 0.2, 1, 0.2, 0, false);
		const a = still.radius(0);
		still.step(0.1);
		expect(still.radius(0)).toBe(a);
		expect(a).toBeCloseTo(REDUCED_RING_AT, 5);
	});

	it("the queue fires due entries in order, keeps the rest, and drops beyond its capacity", () => {
		const q = new BurstQueue(4);
		const fired: number[] = [];
		const fire = (_t: number, arg: number) => {
			fired.push(arg);
		};
		q.schedule(0, 0, 0, 0, 0, 1);
		q.schedule(0.2, 0, 0, 0, 1, 1);
		q.schedule(0.4, 0, 0, 0, 2, 1);
		q.advance(0, fire);
		expect(fired).toEqual([0]);
		q.advance(0.15, fire);
		expect(fired).toEqual([0]);
		q.advance(0.06, fire);
		expect(fired).toEqual([0, 1]);
		q.advance(0.3, fire);
		expect(fired).toEqual([0, 1, 2]);
		const small = new BurstQueue(2);
		small.schedule(1, 0, 0, 0, 0, 0);
		small.schedule(1, 0, 0, 0, 0, 0);
		expect(small.schedule(1, 0, 0, 0, 0, 0)).toBe(false);
		expect(small.dropped).toBe(1);
	});
});

describe("DeathParticleSystem", () => {
	it("spawns a kill burst plus a ring, and the burst dies out within ~0.75 s", () => {
		const sys = new DeathParticleSystem();
		const s = settings();
		sys.killed(5, 5, SWARMER.hp, SWARMER.scale, PALETTE_KIND_BASE + 3, false, burstSeed(7, 100), s);
		expect(sys.pool.count).toBe(12);
		expect(sys.rings.count).toBe(1);
		let sparks = 0;
		for (let i = 0; i < sys.pool.count; i++) {
			if (sys.pool.kind[i] === KIND_SPARK) sparks++;
			else expect(sys.pool.color[i]).toBe(PALETTE_KIND_BASE + 3);
			expect(sys.pool.size[i]).toBeLessThanOrEqual(2);
		}
		expect(sparks).toBe(3);
		sys.update(0.2, s);
		expect(sys.rings.count).toBe(0);
		for (let i = 0; i < sys.pool.count; i++) {
			expect(math.sqrt((sys.pool.x[i] - 5) ** 2 + (sys.pool.z[i] - 5) ** 2)).toBeGreaterThan(0.1);
		}
		for (let k = 0; k < 8; k++) sys.update(0.05, s);
		expect(sys.pool.count).toBe(0);
	});

	it("big enemies get 3x3 chunks that linger longer than sparks; elite sparks are gold", () => {
		const sys = new DeathParticleSystem();
		sys.killed(0, 0, BRUISER.hp, BRUISER.scale, PALETTE_KIND_BASE, false, 1, settings());
		let chunks = 0;
		let maxSpark = 0;
		let minChunk = math.huge;
		for (let i = 0; i < sys.pool.count; i++) {
			if (sys.pool.kind[i] === KIND_CHUNK) {
				chunks++;
				expect(sys.pool.size[i]).toBe(3);
				minChunk = math.min(minChunk, sys.pool.life[i]);
			}
			if (sys.pool.kind[i] === KIND_SPARK) maxSpark = math.max(maxSpark, sys.pool.life[i]);
		}
		expect(chunks).toBe(3);
		expect(minChunk).toBeGreaterThan(maxSpark);
		const elite = new DeathParticleSystem();
		elite.killed(0, 0, SWARMER.hp, SWARMER.scale, PALETTE_KIND_BASE, true, 1, settings());
		for (let i = 0; i < elite.pool.count; i++) {
			if (elite.pool.kind[i] === KIND_SPARK) expect(elite.pool.color[i]).toBe(PAL_ELITE);
		}
	});

	it("is deterministic per seed", () => {
		const a = new DeathParticleSystem();
		const b = new DeathParticleSystem();
		const c = new DeathParticleSystem();
		a.killed(0, 0, 4, 1, 4, false, burstSeed(3, 50), settings());
		b.killed(0, 0, 4, 1, 4, false, burstSeed(3, 50), settings());
		c.killed(0, 0, 4, 1, 4, false, burstSeed(4, 50), settings());
		let same = true;
		let differs = false;
		for (let i = 0; i < a.pool.count; i++) {
			if (a.pool.vx[i] !== b.pool.vx[i]) same = false;
			if (a.pool.vx[i] !== c.pool.vx[i]) differs = true;
		}
		expect(same).toBe(true);
		expect(differs).toBe(true);
		const r = new RenderRng(42);
		const first = r.next();
		r.seed(42);
		expect(r.next()).toBe(first);
	});

	it("never exceeds the setting budget: many kills recycle the oldest particles", () => {
		for (const level of ["low", "normal", "high"] as const) {
			const sys = new DeathParticleSystem();
			const s = settings(level);
			for (let k = 0; k < 60; k++) {
				sys.killed(k, 0, BRUISER.hp, BRUISER.scale, 4, true, k, s);
				sys.update(0.01, s);
			}
			expect(sys.pool.count).toBe(particleBudget(s));
			expect(sys.pool.count).toBeLessThanOrEqual(PARTICLE_POOL_CAPACITY);
			expect(sys.pool.recycled).toBeGreaterThan(0);
		}
	});

	it("'off' spawns nothing and clears what is live", () => {
		const sys = new DeathParticleSystem();
		sys.killed(0, 0, 4, 1, 4, false, 1, settings());
		sys.bossDefeated(0, 0, 1, settings());
		sys.killed(0, 0, 4, 1, 4, false, 1, settings("off"));
		sys.update(0.01, settings("off"));
		expect(sys.pool.count + sys.rings.count + sys.queue.count).toBe(0);
		sys.bossDefeated(0, 0, 1, settings("off"));
		sys.bossPhase(0, 0, 2, 1, settings("off"));
		sys.hit(0, 0, true, 1, settings("off"));
		expect(sys.pool.count + sys.rings.count + sys.queue.count).toBe(0);
	});

	it("reducedMotion: fewer, slower, shorter, no hop, rings in place", () => {
		const normal = new DeathParticleSystem();
		const reduced = new DeathParticleSystem();
		normal.killed(0, 0, BRUISER.hp, BRUISER.scale, 4, false, 9, settings("normal"));
		reduced.killed(0, 0, BRUISER.hp, BRUISER.scale, 4, false, 9, settings("normal", true));
		expect(reduced.pool.count).toBeLessThan(normal.pool.count);
		for (let i = 0; i < normal.pool.count; i++) expect(normal.pool.vh[i]).toBeGreaterThan(0);
		const p = reduced.pool;
		for (let i = 0; i < p.count; i++) {
			const t = TUNING[p.kind[i]];
			expect(p.vh[i]).toBe(0);
			expect(math.sqrt(p.vx[i] * p.vx[i] + p.vz[i] * p.vz[i])).toBeLessThanOrEqual(
				t.speedMax * REDUCED_SPEED + 1e-4,
			);
			expect(p.life[i]).toBeLessThanOrEqual(t.life * (1 + LIFE_JITTER) * REDUCED_LIFE + 1e-4);
		}
		expect(reduced.rings.expand[0]).toBe(0);
		expect(normal.rings.expand[0]).toBe(1);
	});

	it("boss death: three waves over ~0.6 s, the first one immediately; a 0 time scale holds them", () => {
		const sys = new DeathParticleSystem();
		const s = settings();
		sys.bossDefeated(10, 10, 5, s);
		expect(sys.queue.count).toBe(3);
		sys.update(0, s);
		expect(sys.pool.spawned).toBe(bossWaveCount(0, s));
		expect(sys.rings.count).toBe(1);
		for (let i = 0; i < 10; i++) sys.update(0, s); // frozen frames
		expect(sys.queue.count).toBe(2);
		sys.update(0.1, s);
		expect(sys.pool.spawned).toBe(bossWaveCount(0, s));
		sys.update(0.11, s);
		expect(sys.pool.spawned).toBe(bossWaveCount(0, s) + bossWaveCount(1, s));
		sys.update(0.2, s);
		expect(sys.pool.spawned).toBe(bossWaveCount(0, s) + bossWaveCount(1, s) + bossWaveCount(2, s));
		expect(sys.queue.count).toBe(0);
		for (let i = 0; i < 40; i++) sys.update(0.05, s);
		expect(sys.pool.count + sys.rings.count).toBe(0);
	});

	it("roar bursts on phases 2+, not the fight start; hit sparks only at normal / high and below half the budget", () => {
		const sys = new DeathParticleSystem();
		sys.bossPhase(0, 0, 1, 1, settings());
		expect(sys.pool.count).toBe(0);
		sys.bossPhase(0, 0, 2, 1, settings());
		expect(sys.pool.count).toBe(ROAR_SPARKS);
		expect(sys.rings.count).toBe(1);
		sys.clear();
		sys.hit(0, 0, false, 1, settings());
		expect(sys.pool.count).toBe(2);
		sys.hit(0, 0, true, 2, settings());
		expect(sys.pool.count).toBe(5);
		sys.clear();
		sys.hit(0, 0, false, 1, settings("low"));
		sys.hit(0, 0, false, 1, settings("normal", true));
		expect(sys.pool.count).toBe(0);
		const s = settings("normal");
		for (let k = 0; k < 20; k++) sys.killed(k, 0, 2, 1, 4, false, k, s);
		const live = sys.pool.count;
		expect(live).toBeGreaterThan(particleBudget(s) / 2);
		const before = sys.pool.recycled;
		for (let k = 0; k < 10; k++) sys.hit(0, 0, true, k, s);
		expect(sys.pool.count).toBe(live);
		expect(sys.pool.recycled).toBe(before);
	});

	it("draws ring dots then particles; boss rings use more dots; the worst case fits the quad budget", () => {
		const sys = new DeathParticleSystem();
		const s = settings();
		sys.killed(3, 4, SWARMER.hp, SWARMER.scale, PALETTE_KIND_BASE, false, 11, s);
		sys.update(0.03, s);
		const w = new RecordingWriter();
		expect(sys.draw(w)).toBe(RING_SEGMENTS + sys.pool.count);
		for (let i = 0; i < RING_SEGMENTS; i++) expect(w.pushes[i].hop).toBe(0);
		let hopping = 0;
		for (let i = 0; i < sys.pool.count; i++) {
			const q = w.pushes[RING_SEGMENTS + i];
			expect(q.size >= 1 && q.size <= 3).toBe(true);
			if (q.hop > 0) hopping++;
		}
		expect(hopping).toBeGreaterThan(0);
		const boss = new DeathParticleSystem();
		boss.bossDefeated(0, 0, 1, s);
		boss.update(0, s);
		expect(boss.draw(new RecordingWriter())).toBe(BIG_RING_SEGMENTS + boss.pool.count);
		const worst = new DeathParticleSystem();
		const high = settings("high");
		for (let k = 0; k < 80; k++) worst.killed(k, 0, 10, 1.35, 4, true, k, high);
		expect(worst.draw(new RecordingWriter())).toBeLessThanOrEqual(PARTICLE_QUAD_CAPACITY);
	});
});

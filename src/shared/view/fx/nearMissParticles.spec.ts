// Graze sparks and parry bursts in the death particle system (docs/GRAZE_PARRY.md GP5): counts per level, off,
// reduced motion, colours, no hop / no ring for grazes, the parry ring, the live budget, direction of travel.
import { describe, expect, it } from "@rbxts/jest-globals";
import { PIXELS_PER_TILE } from "shared/config";
import { defaultJuiceSettings, type JuiceSettings, type ParticlesLevel } from "shared/settings";
import { COLOR_ROLES } from "shared/theme";
import { particleBudget } from "./juiceRules";
import { NEAR_MISS_VIEW } from "./nearMissConfig";
import {
	DeathParticleSystem,
	KIND_GRAZE,
	KIND_PARRY,
	LEVEL_SCALE,
	REDUCED_LIFE,
	REDUCED_SPEED,
	RING_SEGMENTS,
	TUNING,
	grazeSparkCount,
	particleAlpha,
	parrySparkCount,
	type ParticleWriter,
} from "./particles";
import { burstSeed } from "./rng";

const G = NEAR_MISS_VIEW.graze;
const P = NEAR_MISS_VIEW.parry;
/** Palette indices the client appends for the two roles (any index works: the system only passes it through). */
const GRAZE_COLOR = 40;
const PARRY_COLOR = 41;
const EPS = 1e-9;

const settings = (particles: ParticlesLevel = "normal", reducedMotion = false): JuiceSettings => ({
	...defaultJuiceSettings(false),
	particles,
	reducedMotion,
});

class RecordingWriter implements ParticleWriter {
	readonly pushes: Array<{ x: number; z: number; hop: number; size: number; color: number; alpha: number }> = [];
	push(x: number, z: number, hopPx: number, sizePx: number, color: number, alpha: number): void {
		this.pushes.push({ x, z, hop: hopPx, size: sizePx, color, alpha });
	}
}

/** Angle (radians, absolute) between a particle's ground velocity and the unit direction (ux, uz). */
function angleFrom(vx: number, vz: number, ux: number, uz: number): number {
	const v = math.sqrt(vx * vx + vz * vz);
	const c = (vx * ux + vz * uz) / v;
	return math.acos(math.clamp(c, -1, 1));
}

describe("near-miss particle counts", () => {
	it("graze sparks scale by level like the death bursts: off none, low / normal / high", () => {
		expect(grazeSparkCount(settings("off"))).toBe(0);
		expect(grazeSparkCount(settings("low"))).toBe(math.round(G.sparkCount * LEVEL_SCALE.low));
		expect(grazeSparkCount(settings("normal"))).toBe(G.sparkCount);
		expect(grazeSparkCount(settings("high"))).toBe(math.round(G.sparkCount * LEVEL_SCALE.high));
		expect(grazeSparkCount(settings("low"))).toBeLessThan(grazeSparkCount(settings("normal")));
		expect(grazeSparkCount(settings("high"))).toBeGreaterThan(grazeSparkCount(settings("normal")));
		// Reduced motion drops one level (effectiveParticles).
		expect(grazeSparkCount(settings("normal", true))).toBe(grazeSparkCount(settings("low")));
	});

	it("parry sparks scale by level; merged erases add a capped few", () => {
		expect(parrySparkCount(1, settings("off"))).toBe(0);
		expect(parrySparkCount(1, settings("normal"))).toBe(P.sparkCount);
		expect(parrySparkCount(1, settings("low"))).toBe(math.round(P.sparkCount * LEVEL_SCALE.low));
		expect(parrySparkCount(1, settings("high"))).toBe(math.round(P.sparkCount * LEVEL_SCALE.high));
		expect(parrySparkCount(3, settings("normal"))).toBe(P.sparkCount + 2 * P.sparksPerMerged);
		const capped = P.sparkCount + P.maxMergedSparks;
		expect(parrySparkCount(100, settings("normal"))).toBe(capped);
		expect(parrySparkCount(100, settings("high"))).toBe(math.round(capped * LEVEL_SCALE.high));
		expect(parrySparkCount(1, settings("high", true))).toBe(P.sparkCount);
	});

	it("the two colour roles exist in the theme", () => {
		expect((COLOR_ROLES as ReadonlyArray<string>).includes("nearMiss.graze")).toBe(true);
		expect((COLOR_ROLES as ReadonlyArray<string>).includes("nearMiss.parry")).toBe(true);
	});
});

describe("graze sparks", () => {
	it("spawn sparkCount sparks plus the streak on the floor plane, in the graze colour, with no ring", () => {
		const sys = new DeathParticleSystem();
		const s = settings();
		const n = sys.graze(3, 4, 1, 0, GRAZE_COLOR, burstSeed(0, 50, G.seedSalt), s);
		expect(n).toBe(G.sparkCount + G.streakDots);
		expect(sys.pool.count).toBe(n);
		expect(sys.rings.count).toBe(0);
		let streak = 0;
		for (let i = 0; i < sys.pool.count; i++) {
			expect(sys.pool.kind[i]).toBe(KIND_GRAZE);
			expect(sys.pool.color[i]).toBe(GRAZE_COLOR);
			expect(sys.pool.h[i]).toBe(0);
			expect(sys.pool.vh[i]).toBe(0);
			expect(sys.pool.life[i]).toBe(G.lifeSec);
			expect(sys.pool.size[i] >= G.sparkMinPx && sys.pool.size[i] <= G.sparkMaxPx).toBe(true);
			if (i >= G.sparkCount) {
				streak++;
				expect(sys.pool.size[i]).toBe(G.streakPx);
			}
		}
		expect(streak).toBe(G.streakDots);
		// Never a hop: every frame of its life stays at h = 0.
		for (let k = 0; k < 4; k++) {
			sys.update(0.03, s);
			const w = new RecordingWriter();
			sys.draw(w);
			for (const q of w.pushes) expect(q.hop).toBe(0);
		}
		sys.update(G.lifeSec, s);
		expect(sys.pool.count).toBe(0);
	});

	it("spray along the bullet's direction within the spread; the streak is a rigid line along the path", () => {
		const sys = new DeathParticleSystem();
		const s = settings("high");
		const ux = 0.6;
		const uz = -0.8;
		const n = sys.graze(0, 0, ux, uz, GRAZE_COLOR, 99, s);
		const sparks = grazeSparkCount(s);
		expect(n).toBe(sparks + G.streakDots);
		for (let i = 0; i < sys.pool.count; i++) {
			expect(angleFrom(sys.pool.vx[i], sys.pool.vz[i], ux, uz)).toBeLessThanOrEqual(G.spreadRad + EPS);
			const v = math.sqrt(sys.pool.vx[i] ** 2 + sys.pool.vz[i] ** 2);
			if (i < sparks) expect(v >= G.sparkSpeedMin - EPS && v <= G.sparkSpeedMax + EPS).toBe(true);
			else expect(v).toBeCloseTo(G.streakSpeed, 9);
		}
		// Streak dots one pixel apart along the path, centred on the skim point.
		const a = sparks;
		const b = sparks + G.streakDots - 1;
		const dx = sys.pool.x[b] - sys.pool.x[a];
		const dz = sys.pool.z[b] - sys.pool.z[a];
		expect(math.sqrt(dx * dx + dz * dz)).toBeCloseTo((G.streakDots - 1) / PIXELS_PER_TILE, 9);
		expect(angleFrom(dx, dz, ux, uz)).toBeLessThan(1e-6);
		sys.update(0.05, s);
		for (let i = 0; i < sys.pool.count; i++) {
			// Moved forward along the direction.
			expect(sys.pool.x[i] * ux + sys.pool.z[i] * uz).toBeGreaterThan(0);
		}
	});

	it("is deterministic per seed and differs across seeds", () => {
		const a = new DeathParticleSystem();
		const b = new DeathParticleSystem();
		const c = new DeathParticleSystem();
		a.graze(1, 1, 0, 1, GRAZE_COLOR, 7, settings());
		b.graze(1, 1, 0, 1, GRAZE_COLOR, 7, settings());
		c.graze(1, 1, 0, 1, GRAZE_COLOR, 8, settings());
		let differs = false;
		for (let i = 0; i < a.pool.count; i++) {
			expect(a.pool.vx[i]).toBe(b.pool.vx[i]);
			expect(a.pool.vz[i]).toBe(b.pool.vz[i]);
			if (a.pool.vx[i] !== c.pool.vx[i]) differs = true;
		}
		expect(differs).toBe(true);
	});

	it("a zero direction falls back to +x instead of NaN", () => {
		const sys = new DeathParticleSystem();
		sys.graze(0, 0, 0, 0, GRAZE_COLOR, 3, settings());
		for (let i = 0; i < sys.pool.count; i++) {
			expect(sys.pool.vx[i] === sys.pool.vx[i]).toBe(true);
			expect(sys.pool.vx[i]).toBeGreaterThan(0);
		}
	});

	it("particles off: nothing; reduced motion: slower and shorter, still no hop", () => {
		const off = new DeathParticleSystem();
		expect(off.graze(0, 0, 1, 0, GRAZE_COLOR, 1, settings("off"))).toBe(0);
		expect(off.pool.count).toBe(0);
		const sys = new DeathParticleSystem();
		const s = settings("normal", true);
		const n = sys.graze(0, 0, 1, 0, GRAZE_COLOR, 1, s);
		expect(n).toBe(grazeSparkCount(s) + G.streakDots);
		for (let i = 0; i < sys.pool.count; i++) {
			expect(sys.pool.life[i]).toBeCloseTo(G.lifeSec * REDUCED_LIFE, 9);
			const v = math.sqrt(sys.pool.vx[i] ** 2 + sys.pool.vz[i] ** 2);
			expect(v).toBeLessThanOrEqual(math.max(G.sparkSpeedMax, G.streakSpeed) * REDUCED_SPEED + EPS);
			expect(sys.pool.vh[i]).toBe(0);
		}
	});

	it("never recycles: no graze once the pool holds graze.maxFill of the live limit", () => {
		const sys = new DeathParticleSystem();
		const s = settings("low");
		const limit = particleBudget(s);
		let seed = 1;
		while (sys.graze(0, 0, 1, 0, GRAZE_COLOR, seed, s) > 0) seed++;
		expect(sys.pool.count).toBeLessThanOrEqual(limit * G.maxFill);
		expect(sys.pool.recycled).toBe(0);
		const live = sys.pool.count;
		expect(sys.graze(0, 0, 1, 0, GRAZE_COLOR, seed + 1, s)).toBe(0);
		expect(sys.pool.count).toBe(live);
	});

	it("fades after graze.hold of its life", () => {
		expect(particleAlpha(G.lifeSec * G.hold * 0.5, G.lifeSec, KIND_GRAZE)).toBe(1);
		expect(particleAlpha(G.lifeSec * 0.9, G.lifeSec, KIND_GRAZE)).toBeLessThan(1);
		expect(TUNING[KIND_GRAZE].hopMax).toBe(0);
	});
});

describe("parry bursts", () => {
	it("throw sparkCount sparks in the parry colour plus one ring of RING_SEGMENTS 1 px dots", () => {
		const sys = new DeathParticleSystem();
		const s = settings();
		const n = sys.parry(2, 2, 0, 1, 1, PARRY_COLOR, burstSeed(0, 10, P.seedSalt), s);
		expect(n).toBe(P.sparkCount);
		expect(sys.pool.count).toBe(P.sparkCount);
		expect(sys.rings.count).toBe(1);
		expect(sys.rings.color[0]).toBe(PARRY_COLOR);
		expect(sys.rings.r0[0]).toBe(P.ringR0Tiles);
		expect(sys.rings.r1[0]).toBe(P.ringR1Tiles);
		expect(sys.rings.life[0]).toBe(P.lifeSec);
		expect(sys.rings.expand[0]).toBe(1);
		for (let i = 0; i < sys.pool.count; i++) {
			expect(sys.pool.kind[i]).toBe(KIND_PARRY);
			expect(sys.pool.color[i]).toBe(PARRY_COLOR);
			expect(sys.pool.life[i]).toBe(P.lifeSec);
			expect(sys.pool.size[i] >= P.sparkMinPx && sys.pool.size[i] <= P.sparkMaxPx).toBe(true);
		}
		const w = new RecordingWriter();
		expect(sys.draw(w)).toBe(RING_SEGMENTS + P.sparkCount);
		for (let k = 0; k < RING_SEGMENTS; k++) {
			expect(w.pushes[k].size).toBe(P.ringPx);
			expect(w.pushes[k].color).toBe(PARRY_COLOR);
			expect(w.pushes[k].hop).toBe(0);
		}
		sys.update(P.lifeSec, s);
		expect(sys.pool.count).toBe(0);
		expect(sys.rings.count).toBe(0);
	});

	it("sparks fly away from the guard (along the burst direction) within the fan, spread across it", () => {
		const sys = new DeathParticleSystem();
		const s = settings("high");
		const n = sys.parry(0, 0, -1, 0, 1, PARRY_COLOR, 5, s);
		let left = 0;
		let right = 0;
		for (let i = 0; i < n; i++) {
			expect(sys.pool.vx[i]).toBeLessThan(0);
			expect(angleFrom(sys.pool.vx[i], sys.pool.vz[i], -1, 0)).toBeLessThanOrEqual(P.fanRad + EPS);
			if (sys.pool.vz[i] > 0) left++;
			else right++;
		}
		expect(left).toBeGreaterThan(0);
		expect(right).toBeGreaterThan(0);
		sys.update(0.05, s);
		for (let i = 0; i < sys.pool.count; i++) expect(sys.pool.x[i]).toBeLessThan(0);
	});

	it("a merged burst adds a capped few sparks", () => {
		const sys = new DeathParticleSystem();
		expect(sys.parry(0, 0, 1, 0, 4, PARRY_COLOR, 1, settings())).toBe(parrySparkCount(4, settings()));
		expect(parrySparkCount(4, settings())).toBeGreaterThan(P.sparkCount);
		expect(sys.rings.count).toBe(1);
	});

	it("particles off: nothing, no ring; reduced motion: no hop, a fixed ring, slower and shorter", () => {
		const off = new DeathParticleSystem();
		expect(off.parry(0, 0, 1, 0, 1, PARRY_COLOR, 1, settings("off"))).toBe(0);
		expect(off.pool.count).toBe(0);
		expect(off.rings.count).toBe(0);
		const sys = new DeathParticleSystem();
		const s = settings("normal", true);
		const n = sys.parry(0, 0, 1, 0, 1, PARRY_COLOR, 1, s);
		expect(n).toBe(parrySparkCount(1, s));
		for (let i = 0; i < n; i++) {
			expect(sys.pool.vh[i]).toBe(0);
			expect(sys.pool.life[i]).toBeCloseTo(P.lifeSec * REDUCED_LIFE, 9);
			const v = math.sqrt(sys.pool.vx[i] ** 2 + sys.pool.vz[i] ** 2);
			expect(v).toBeLessThanOrEqual(P.sparkSpeedMax * REDUCED_SPEED + EPS);
		}
		expect(sys.rings.expand[0]).toBe(0);
		expect(sys.rings.life[0]).toBeCloseTo(P.lifeSec * REDUCED_LIFE, 9);
	});

	it("respects the live budget: at the limit it recycles instead of growing", () => {
		const sys = new DeathParticleSystem();
		const s = settings("low");
		const limit = particleBudget(s);
		for (let k = 0; k < 100; k++) sys.parry(k, 0, 1, 0, 8, PARRY_COLOR, k, s);
		expect(sys.pool.count).toBe(limit);
		expect(sys.pool.recycled).toBeGreaterThan(0);
		// A full pool of parry sparks leaves no room for grazes (they never recycle).
		expect(sys.graze(0, 0, 1, 0, GRAZE_COLOR, 1, s)).toBe(0);
	});

	it("parry sparks hop a little (normal motion); clear() drops them with the run", () => {
		const sys = new DeathParticleSystem();
		const s = settings();
		sys.parry(0, 0, 1, 0, 1, PARRY_COLOR, 2, s);
		sys.graze(0, 0, 1, 0, GRAZE_COLOR, 2, s);
		for (let i = 0; i < P.sparkCount; i++) {
			expect(sys.pool.vh[i] >= P.hopMinPx && sys.pool.vh[i] <= P.hopMaxPx).toBe(true);
		}
		sys.clear();
		expect(sys.pool.count).toBe(0);
		expect(sys.rings.count).toBe(0);
	});
});

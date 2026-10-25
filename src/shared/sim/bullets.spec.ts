// The ported r3f-projectiles core (combat/bullets.ts) and patterns (combat/projectilePatterns.ts, combat/patterns.ts):
// the sparse-set order the hash and the collision callbacks depend on (fixtures/hashed-fields.md), step arithmetic,
// culling, emitters, and gen.arc against V8's sin / cos (fixtures/arc-table.json, bit for bit).
import { describe, expect, it } from "@rbxts/jest-globals";
import arcTable from "shared/fixtures-generated/arc-table";
import {
	ARC_SHAPES,
	BULLET_Y,
	FULL_RING,
	acquireSpawnData,
	arcTrig,
	compose,
	createBulletSimulation,
	definePayload,
	fireBurstRaw,
	float64FromHex,
	float64Hex,
	gen,
	mod,
	releaseSpawnData,
	type BulletPattern,
	type BulletSpawnData,
	type BulletSimulation,
	type Vec3,
} from "shared/sim";

const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

/** A pattern of `n` motionless bullets with payloads base, base + 1, ... (life `life`). */
function still(n: number, base = 0, life = 5): BulletPattern {
	return () => {
		const out: BulletSpawnData[] = [];
		for (let i = 0; i < n; i++) {
			const p = acquireSpawnData();
			p.payload = base + i;
			p.life = life;
			out.push(p);
		}
		return out;
	};
}

/** One bullet with an explicit velocity / acceleration. */
function moving(vx: number, vy: number, vz: number, life = 5, ax = 0, ay = 0, az = 0): BulletPattern {
	return () => {
		const p = acquireSpawnData();
		p.velocity.x = vx;
		p.velocity.y = vy;
		p.velocity.z = vz;
		p.acceleration.x = ax;
		p.acceleration.y = ay;
		p.acceleration.z = az;
		p.life = life;
		return [p];
	};
}

/** Slots in forEachActive visiting order (no release). */
function visitOrder(sim: BulletSimulation): number[] {
	const out: number[] = [];
	sim.forEachActive((i) => {
		out.push(i);
	});
	return out;
}

/** Slots as writeStateHash lists them. */
function hashSlots(sim: BulletSimulation): number[] {
	const out: number[] = [];
	sim.writeStateHash(out);
	const slots: number[] = [];
	for (let k = 0; k < out.size(); k += 10) slots.push(out[k]);
	return slots;
}

describe("BulletSimulation: the sparse set", () => {
	it("hands out slots 0, 1, 2, ... and visits them backwards (dense order reversed)", () => {
		const sim = createBulletSimulation({ maxBullets: 8 });
		expect(sim.fireAt(ORIGIN, still(5), 1)).toBe(5);
		expect(sim.activeCount).toBe(5);
		expect(visitOrder(sim)).toEqual([4, 3, 2, 1, 0]);
		expect(hashSlots(sim)).toEqual([0, 1, 2, 3, 4]);
		expect(sim.highWater()).toBe(5);
	});

	it("swap-removes on release and reuses freed slots LIFO", () => {
		const sim = createBulletSimulation({ maxBullets: 8 });
		sim.fireAt(ORIGIN, still(5), 1); // dense [0 1 2 3 4]
		sim.forEachActive((i) => i === 1 || i === 3); // backward: 4, 3 (release: dense [0 1 2 4]), 2, 1 (release)
		// dense after: release 3 -> [0 1 2 4]; release 1 -> [0 4 2]
		expect(visitOrder(sim)).toEqual([2, 4, 0]);
		expect(hashSlots(sim)).toEqual([0, 2, 4]);
		// Free stack top: 1 (released last), then 3, then 5, 6, 7.
		sim.fireAt(ORIGIN, still(3, 100), 1);
		expect(hashSlots(sim)).toEqual([0, 1, 2, 3, 4, 5]);
		expect(visitOrder(sim)).toEqual([5, 3, 1, 2, 4, 0]);
		const payloads: number[] = [];
		for (const slot of [1, 3, 5]) payloads.push(sim.payloadAt(slot));
		expect(payloads).toEqual([100, 101, 102]);
	});

	it("drops the rest of a burst when full, and reports it", () => {
		const reports: number[][] = [];
		const sim = createBulletSimulation({
			maxBullets: 4,
			onPoolExhausted: (emitter, requested, spawned) => reports.push([emitter, requested, spawned]),
		});
		expect(sim.fireAt(ORIGIN, still(3), 2)).toBe(3);
		expect(sim.fireAt(ORIGIN, still(3), 2)).toBe(1);
		expect(sim.activeCount).toBe(4);
		expect(reports).toEqual([[2, 3, 1]]);
		expect(sim.fireAt(ORIGIN, still(1), 2)).toBe(0);
	});

	it("clear() releases everything (or one emitter's bullets) and returns how many", () => {
		const sim = createBulletSimulation({ maxBullets: 16 });
		sim.fireAt(ORIGIN, still(3), 1);
		sim.fireAt(ORIGIN, still(4), 2);
		sim.fireAt(ORIGIN, still(2), 1);
		expect(sim.activeCountFor(1)).toBe(5);
		expect(sim.clear(2)).toBe(4);
		expect(sim.activeCount).toBe(5);
		expect(sim.activeCountFor(2)).toBe(0);
		expect(sim.clear(7)).toBe(0);
		expect(sim.clear()).toBe(5);
		expect(sim.activeCount).toBe(0);
		expect(sim.clear()).toBe(0);
		// Freed in backward dense order: the next spawns reuse them LIFO (the last released slot first).
		sim.fireAt(ORIGIN, still(1), 1);
		expect(hashSlots(sim)).toEqual([0]);
	});

	it("setPayload writes only live slots; highWater resets lazily once empty", () => {
		const sim = createBulletSimulation({ maxBullets: 4 });
		sim.fireAt(ORIGIN, still(2, 7), 1);
		sim.setPayload(1, 42);
		sim.setPayload(3, 42);
		expect([sim.payloadAt(1), sim.payloadAt(3), sim.isLive(1), sim.isLive(3)]).toEqual([42, 0, true, false]);
		sim.clear();
		expect(sim.highWater()).toBe(0);
	});

	it("emitter ids start at 1, fireAt and releaseEmitter only raise the counter", () => {
		const sim = createBulletSimulation({ maxBullets: 4 });
		expect(sim.acquireEmitter()).toBe(1);
		expect(sim.acquireEmitter()).toBe(2);
		sim.releaseEmitter(1);
		expect(sim.acquireEmitter()).toBe(3);
		sim.fireAt(ORIGIN, still(1), 9);
		expect(sim.acquireEmitter()).toBe(10);
		sim.releaseEmitter(20);
		expect(sim.acquireEmitter()).toBe(21);
		expect(sim.emitterIdAt(0)).toBe(9);
	});

	it("validates maxBullets with the library's message", () => {
		expect(() => createBulletSimulation({ maxBullets: 1.5 })).toThrow(
			"[r3f-projectiles] maxBullets must be a non-negative integer; got 1.5.",
		);
		expect(() => createBulletSimulation({ maxBullets: -1 })).toThrow("non-negative integer");
		expect(createBulletSimulation({ maxBullets: 0 }).fireAt(ORIGIN, still(1))).toBe(0);
		expect(createBulletSimulation().capacity).toBe(2000);
		expect(createBulletSimulation().boundsLimit).toBe(25);
	});
});

describe("BulletSimulation: step", () => {
	it("prev = pos; vel += acc * dt; pos += vel * dt (two roundings each); life -= dt", () => {
		const sim = createBulletSimulation({ maxBullets: 2, interpolation: true });
		const dt = 1 / 60;
		sim.fireAt({ x: 0.1, y: 0.5, z: -0.3 }, moving(3.7, 0, -1.1, 2, 0.3, 0, 0.7), 1);
		sim.step(dt);
		const p = sim.positionAt(0);
		const v = sim.velocityAt(0);
		const vx = 3.7 + 0.3 * dt;
		const vz = -1.1 + 0.7 * dt;
		expect([v.x, v.y, v.z]).toEqual([vx, 0, vz]);
		expect([p.x, p.y, p.z]).toEqual([0.1 + vx * dt, 0.5, -0.3 + vz * dt]);
		expect(sim.lifeAt(0)).toBe(2 - dt);
		const prev = sim.previousPositionAt(0, { x: 0, y: 0, z: 0 });
		expect([prev.x, prev.y, prev.z]).toEqual([0.1, 0.5, -0.3]);
		expect(sim.stepCount).toBe(1);
	});

	it("adds the (zero) acceleration even so: a -0 velocity component becomes +0, as in the library", () => {
		const sim = createBulletSimulation({ maxBullets: 1 });
		sim.fireAt(ORIGIN, moving(-0, -0, 1), 1);
		expect(float64Hex(sim.velocityAt(0).x)).toBe("8000000000000000"); // check-asset-ids: allow (float64 bit pattern, not an asset id)
		sim.step(1 / 60);
		expect(float64Hex(sim.velocityAt(0).x)).toBe("0000000000000000"); // check-asset-ids: allow (float64 bit pattern, not an asset id)
		expect(float64Hex(sim.velocityAt(0).y)).toBe("0000000000000000"); // check-asset-ids: allow (float64 bit pattern, not an asset id)
	});

	it("releases a bullet on the step its life reaches 0 or it leaves the bounds cube", () => {
		const sim = createBulletSimulation({ maxBullets: 4, boundsLimit: 1 });
		sim.fireAt(ORIGIN, moving(0, 0, 0, 0.04), 1); // expires on step 3 (0.04 - 3 / 60 <= 0)
		sim.fireAt({ x: 0.9, y: 0, z: 0 }, moving(12, 0, 0), 1); // 0.9 + 0.2 > 1: out on step 1
		sim.fireAt({ x: 0, y: 0, z: -0.9 }, moving(0, 0, -4.8), 1); // -0.98, then -1.06: out on step 2
		sim.step(1 / 60);
		expect(hashSlots(sim)).toEqual([0, 2]);
		sim.step(1 / 60);
		expect(hashSlots(sim)).toEqual([0]);
		sim.step(1 / 60);
		expect(sim.activeCount).toBe(0);
	});

	it("never culls with boundsLimit = math.huge; ignores dt <= 0, NaN and Infinity", () => {
		const sim = createBulletSimulation({ maxBullets: 1, boundsLimit: math.huge });
		sim.fireAt(ORIGIN, moving(1e6, 0, 0, 100), 1);
		for (let i = 0; i < 10; i++) sim.step(1);
		expect(sim.activeCount).toBe(1);
		sim.step(0);
		sim.step(-1);
		sim.step(0 / 0);
		sim.step(math.huge);
		expect(sim.stepCount).toBe(10);
		expect(sim.positionAt(0).x).toBe(1e7);
	});

	it("skips delayed bullets (delay counts down, they neither move nor collide)", () => {
		const sim = createBulletSimulation({ maxBullets: 1 });
		sim.fireAt(
			ORIGIN,
			() => {
				const p = acquireSpawnData();
				p.delay = 0.03;
				p.velocity.x = 60;
				return [p];
			},
			1,
		);
		expect(sim.isVisible(0)).toBe(false);
		expect(visitOrder(sim)).toEqual([]);
		sim.step(1 / 60); // 0.03 - 1/60 > 0: still waiting
		expect(sim.positionAt(0).x).toBe(0);
		sim.step(1 / 60); // delay <= 0: moves this step
		expect(sim.positionAt(0).x).toBe(0 + 60 * (1 / 60));
		expect(visitOrder(sim)).toEqual([0]);
	});

	it("collision walks may release freely: a backward walk sees each live bullet exactly once", () => {
		const sim = createBulletSimulation({ maxBullets: 64 });
		sim.fireAt(ORIGIN, still(40), 1);
		const seen: number[] = [];
		sim.forEachActive((i) => {
			seen.push(i);
			return i % 3 === 0;
		});
		expect(seen.size()).toBe(40);
		expect(sim.activeCount).toBe(40 - 14);
		const again: number[] = [];
		sim.forEachActive((i) => {
			again.push(i);
		});
		expect(again.size()).toBe(26);
	});
});

describe("gen.arc and the arc table (V8's sin / cos, bit for bit)", () => {
	const shapes = arcTable.shapes;

	it("the checked-in table equals fixtures/arc-table.json bit for bit, shape by shape", () => {
		expect(ARC_SHAPES.size()).toBe(shapes.size());
		shapes.forEach((f, k) => {
			const t = ARC_SHAPES[k];
			expect([t.count, float64Hex(t.spread), t.full]).toEqual([f.count, f.spreadHex, f.full]);
			expect(t.sin.map(float64Hex)).toEqual([...f.sinHex]);
			expect(t.cos.map(float64Hex)).toEqual([...f.cosHex]);
		});
	});

	it("the shape key is sound: gen.arc's angle formula gives exactly the fixture's angles", () => {
		const TAU = math.pi * 2;
		for (const f of shapes) {
			const full = f.spread >= TAU - 1e-9;
			expect(full).toBe(f.full);
			const angles: string[] = [];
			for (let i = 0; i < f.count; i++) {
				const a = full ? 0 + (i / f.count) * TAU : f.count === 1 ? 0 : 0 + (i / (f.count - 1) - 0.5) * f.spread;
				angles.push(float64Hex(a));
			}
			expect(angles).toEqual([...f.angleHex]);
		}
	});

	it("builds offsets and velocities from the table: (sin * r, 0, cos * r), (sin * speed, 0 * speed, cos * speed)", () => {
		for (const f of shapes) {
			const spawns = gen.arc(f.count, f.spread, 7.3, 0, 0.45);
			expect(spawns.size()).toBe(f.count);
			spawns.forEach((s, i) => {
				const sin = float64FromHex(f.sinHex[i]);
				const cos = float64FromHex(f.cosHex[i]);
				expect([s.offset.x, s.offset.y, s.offset.z]).toEqual([sin * 0.45, 0, cos * 0.45]);
				expect([s.velocity.x, s.velocity.y, s.velocity.z]).toEqual([sin * 7.3, 0, cos * 7.3]);
				expect([s.life, s.payload, s.scale, s.delay]).toEqual([5, 0, 1, 0]);
			});
			releaseSpawnData(spawns);
		}
	});

	it("full rings match by count whatever the spread; one bullet ignores the spread", () => {
		expect(arcTrig(48, FULL_RING)).toBe(arcTrig(48, 100));
		expect(arcTrig(1, 0.7)).toBe(arcTrig(1, 0));
		expect(gen.arc(0, 0.123).size()).toBe(0); // no bullet: no lookup
	});

	it("errors loudly on a shape or heading the table does not hold", () => {
		expect(() => gen.arc(7, 0.5)).toThrow("arc table miss");
		expect(() => gen.arc(5, 0.50000000000001)).toThrow("arc table miss");
		expect(() => gen.arc(49, FULL_RING)).toThrow("arc table miss");
		expect(() => gen.arc(1, 0, 2, 0.5)).toThrow("arc table miss: gen.arc heading");
	});

	it("compose applies modifiers in order; mod.payload / color / scale stamp every bullet", () => {
		const spawns = compose(gen.arc(3, FULL_RING, 1), mod.payload(5), mod.color(0x00ff00), undefined, mod.scale(2));
		for (const s of spawns) expect([s.payload, s.color, s.scale]).toEqual([5, 0x00ff00, 2]);
	});
});

describe("fireBurstRaw (patterns.ts finishBurst)", () => {
	it("turns the heading-0 arc onto the direction with multiply-adds and stamps life / payload / scale / color", () => {
		const sim = createBulletSimulation({ maxBullets: 8 });
		const dirX = 0.6;
		const dirZ = -0.8;
		const n = fireBurstRaw(sim, 3, 1.25, -2, dirX, dirZ, 5, 0.5, 9, 0.75, 1234, 0.3, 1.5);
		expect(n).toBe(5);
		const shape = arcTrig(5, 0.5);
		for (let i = 0; i < 5; i++) {
			const sin = shape.sin[i];
			const cos = shape.cos[i];
			const vx = sin * 9;
			const vz = cos * 9;
			const ox = sin * 0.3;
			const oz = cos * 0.3;
			const v = sim.velocityAt(i);
			const p = sim.positionAt(i);
			expect([v.x, v.y, v.z]).toEqual([vx * dirZ + vz * dirX, 0, vz * dirZ - vx * dirX]);
			expect([p.x, p.y, p.z]).toEqual([
				1.25 + (ox * dirZ + oz * dirX),
				BULLET_Y + 0,
				-2 + (oz * dirZ - ox * dirX),
			]);
			expect([sim.lifeAt(i), sim.payloadAt(i), sim.scaleAt(i), sim.colorAt(i), sim.emitterIdAt(i)]).toEqual([
				0.75, 1234, 1.5, 0xffffff, 3,
			]);
		}
	});

	it("the middle bullet of an odd fan flies exactly down the direction", () => {
		const sim = createBulletSimulation({ maxBullets: 8 });
		fireBurstRaw(sim, 1, 0, 0, 0.6, -0.8, 3, 0.12, 15, 1, 0);
		const v = sim.velocityAt(1);
		expect([v.x, v.z]).toEqual([0.6 * 15, -0.8 * 15]);
	});
});

describe("definePayload", () => {
	it("lays fields out lowest bits first and validates like the library", () => {
		const layout = definePayload([
			["a", 3],
			["b", 5],
		]);
		expect([layout.bits, [...layout.fields], layout.max("a"), layout.max("b"), layout.shift("b")]).toEqual([
			8,
			["a", "b"],
			7,
			31,
			3,
		]);
		const p = layout.pack({ a: 5, b: 17 });
		expect(p).toBe(5 + 17 * 8);
		expect([layout.get(p, "a"), layout.get(p, "b")]).toEqual([5, 17]);
		expect(layout.with(p, "a", 2)).toBe(2 + 17 * 8);
		expect(() => definePayload([])).toThrow("the schema has no fields");
		expect(() => definePayload([["7", 3]])).toThrow("is integer-like");
		expect(() => definePayload([["x", 0]])).toThrow("widths must be positive integers");
		expect(() =>
			definePayload([
				["x", 16],
				["y", 16],
			]),
		).toThrow("fields total 32 bits; a payload holds at most 31.");
		expect(() => layout.get(0, "c" as "a")).toThrow('payload field "c" is not in this layout (a, b).');
	});
});

// The port-only burst shapes (combat/arcTablePort.ts, docs/BOSS_DEMONLORD.md D4): gen.arc's angles, the Forge's
// deterministic dsin / dcos of them, merged into the arc lookup without touching the web build's table.
import { describe, expect, it } from "@rbxts/jest-globals";
import arcTable from "shared/fixtures-generated/arc-table";
import { dcos, dsin } from "shared/dungeon";
import {
	ARC_SHAPES,
	BALLISTA_FAN_SPREAD,
	BALLISTA_FANS,
	BALLISTA_RINGS,
	CLEAVE,
	FULL_RING,
	HELLFIRE_ARC,
	IMP,
	IMP_FAN_COUNT,
	IMP_FAN_SPREAD,
	PORT_ARC_SHAPES,
	SOUL_SHARD,
	THRILL_SEEKER_RING,
	VOLATILE_BURSTS,
	PORT_ARC_SOURCES,
	arcAngle,
	arcTrig,
	float64Hex,
	gen,
} from "shared/sim";

describe("port arc shapes (combat/arcTablePort.ts)", () => {
	it("one shape per source row, with dsin / dcos of gen.arc's own angles, bit for bit", () => {
		expect(PORT_ARC_SHAPES.size()).toBe(PORT_ARC_SOURCES.size());
		PORT_ARC_SOURCES.forEach((src, k) => {
			const s = PORT_ARC_SHAPES[k];
			expect([s.count, float64Hex(s.spread), s.full]).toEqual([
				src.count,
				float64Hex(src.spread),
				src.spread >= FULL_RING - 1e-9,
			]);
			for (let i = 0; i < src.count; i++) {
				const a = arcAngle(src.count, src.spread, i);
				expect([i, float64Hex(s.sin[i]), float64Hex(s.cos[i])]).toEqual([
					i,
					float64Hex(dsin(a)),
					float64Hex(dcos(a)),
				]);
				// Sanity against the platform's libm (specs only; never on the sim path): within 2 ulps.
				expect(math.abs(s.sin[i] - math.sin(a))).toBeLessThanOrEqual(4.5e-16);
				expect(math.abs(s.cos[i] - math.cos(a))).toBeLessThanOrEqual(4.5e-16);
			}
		});
	});

	it("arcAngle is gen.arc's formula: it reproduces the web fixture's angles", () => {
		for (const f of arcTable.shapes) {
			for (let i = 0; i < f.count; i++) expect(float64Hex(arcAngle(f.count, f.spread, i))).toBe(f.angleHex[i]);
		}
	});

	it("leaves the web table alone and never shadows one of its shapes", () => {
		expect(ARC_SHAPES.size()).toBe(arcTable.shapes.size());
		for (const s of PORT_ARC_SHAPES) {
			for (const w of ARC_SHAPES) {
				const same = s.full && w.full ? s.count === w.count : s.count === w.count && s.spread === w.spread;
				expect(same).toBe(false);
			}
			expect(arcTrig(s.count, s.spread)).toBe(s);
		}
	});

	it("the Demon Lord's cleave and hellfire arcs resolve to these shapes and fire", () => {
		expect(arcTrig(CLEAVE.count, CLEAVE.spread)).toBe(PORT_ARC_SHAPES[0]);
		expect(arcTrig(HELLFIRE_ARC.count, HELLFIRE_ARC.spread)).toBe(PORT_ARC_SHAPES[1]);
		expect(gen.arc(CLEAVE.count, CLEAVE.spread, 2).size()).toBe(CLEAVE.count);
		// A near-miss still misses.
		expect(() => gen.arc(CLEAVE.count, CLEAVE.spread + 1e-12)).toThrow("arc table miss");
	});

	it("the imp's fan (5 @ 0.7 rad, docs/ENEMY_VARIANTS.md EV2) resolves to its port shape and fires", () => {
		const fan = IMP.data.fan;
		expect([fan.count, float64Hex(fan.spread)]).toEqual([IMP_FAN_COUNT, float64Hex(IMP_FAN_SPREAD)]);
		expect([fan.count, float64Hex(fan.spread)]).toEqual([5, float64Hex(0.7)]);
		expect(arcTrig(fan.count, fan.spread)).toBe(PORT_ARC_SHAPES[2]);
		expect(gen.arc(fan.count, fan.spread, 2).size()).toBe(fan.count);
		// The middle bullet flies straight down the aim; the outer two are half the spread either side.
		const s = PORT_ARC_SHAPES[2];
		expect([float64Hex(s.sin[2]), float64Hex(s.cos[2])]).toEqual([float64Hex(0), float64Hex(1)]);
		expect(s.sin[0]).toBeCloseTo(math.sin(-IMP_FAN_SPREAD / 2), 15);
		expect(() => gen.arc(fan.count, fan.spread + 1e-12)).toThrow("arc table miss");
	});

	it("the builds rings (8 and 12 @ FULL_RING, docs/BUILDS.md BU1) resolve to their port shapes and fire", () => {
		// Volatile I / II and Thrill Seeker; Volatile III (16) and a single shard (1 @ 0) are web rows.
		const eight = PORT_ARC_SHAPES[3];
		const twelve = PORT_ARC_SHAPES[4];
		expect([eight.count, eight.full, twelve.count, twelve.full]).toEqual([8, true, 12, true]);
		expect(arcTrig(VOLATILE_BURSTS[0].count, VOLATILE_BURSTS[0].spread)).toBe(eight);
		expect(arcTrig(THRILL_SEEKER_RING.count, THRILL_SEEKER_RING.spread)).toBe(eight);
		expect(arcTrig(VOLATILE_BURSTS[1].count, VOLATILE_BURSTS[1].spread)).toBe(twelve);
		expect(arcTrig(VOLATILE_BURSTS[2].count, VOLATILE_BURSTS[2].spread).count).toBe(16);
		expect(PORT_ARC_SHAPES.includes(arcTrig(VOLATILE_BURSTS[2].count, VOLATILE_BURSTS[2].spread))).toBe(false);
		expect(arcTrig(SOUL_SHARD.count, SOUL_SHARD.spread).count).toBe(1);
		for (const spec of VOLATILE_BURSTS) expect(gen.arc(spec.count, spec.spread, 2).size()).toBe(spec.count);
		// Evenly spaced: bullet 0 straight down +Z, bullet count/4 at a quarter turn (sin 1, cos 0 to the ulp).
		for (const s of [eight, twelve]) {
			expect([float64Hex(s.sin[0]), float64Hex(s.cos[0])]).toEqual([float64Hex(0), float64Hex(1)]);
			expect(s.sin[s.count / 4]).toBeCloseTo(1, 15);
			expect(s.cos[s.count / 4]).toBeCloseTo(0, 15);
		}
		// Any spread at or past the full-ring threshold is the same ring.
		expect(arcTrig(8, FULL_RING + 1)).toBe(eight);
	});

	it("Ballista's bolts (6 / 10 @ FULL_RING and @ BALLISTA_FAN_SPREAD, docs/BUILDS_V2.md BV1) resolve and fire", () => {
		const six = PORT_ARC_SHAPES[5];
		const ten = PORT_ARC_SHAPES[6];
		const fan6 = PORT_ARC_SHAPES[7];
		const fan10 = PORT_ARC_SHAPES[8];
		expect([six.count, six.full, ten.count, ten.full]).toEqual([6, true, 10, true]);
		expect([fan6.count, fan6.full, fan10.count, fan10.full]).toEqual([6, false, 10, false]);
		expect([float64Hex(fan6.spread), float64Hex(fan10.spread)]).toEqual([
			float64Hex(BALLISTA_FAN_SPREAD),
			float64Hex(BALLISTA_FAN_SPREAD),
		]);
		expect(BALLISTA_FAN_SPREAD).toBe(1.6);
		// Every level's ring and fan is a row (no "arc table miss"), the right one, and fires its count.
		const rings = [six, ten, ten];
		const fans = [fan6, fan10, fan10];
		for (let l = 0; l < 3; l++) {
			const ring = BALLISTA_RINGS[l];
			const fan = BALLISTA_FANS[l];
			expect([
				l,
				arcTrig(ring.count, ring.spread) === rings[l],
				arcTrig(fan.count, fan.spread) === fans[l],
			]).toEqual([l, true, true]);
			expect(gen.arc(ring.count, ring.spread, 2).size()).toBe(ring.count);
			expect(gen.arc(fan.count, fan.spread, 2).size()).toBe(fan.count);
		}
		// The rings start straight down +Z; a fan is symmetric about the aim (its ends half the spread either side).
		for (const s of [six, ten])
			expect([float64Hex(s.sin[0]), float64Hex(s.cos[0])]).toEqual([float64Hex(0), float64Hex(1)]);
		for (const s of [fan6, fan10]) {
			expect(s.sin[0]).toBeCloseTo(math.sin(-BALLISTA_FAN_SPREAD / 2), 15);
			expect(s.sin[s.count - 1]).toBeCloseTo(math.sin(BALLISTA_FAN_SPREAD / 2), 15);
		}
		expect(() => gen.arc(6, BALLISTA_FAN_SPREAD + 1e-12)).toThrow("arc table miss");
	});
});

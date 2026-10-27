// The port-only burst shapes (combat/arcTablePort.ts, docs/BOSS_DEMONLORD.md D4): gen.arc's angles, the Forge's
// deterministic dsin / dcos of them, merged into the arc lookup without touching the web build's table.
import { describe, expect, it } from "@rbxts/jest-globals";
import arcTable from "shared/fixtures-generated/arc-table";
import { dcos, dsin } from "shared/dungeon";
import {
	ARC_SHAPES,
	CLEAVE,
	FULL_RING,
	HELLFIRE_ARC,
	PORT_ARC_SHAPES,
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
});

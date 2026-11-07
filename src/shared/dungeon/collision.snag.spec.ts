/**
 * Snag scenarios (docs/WALL_SLIDE.md WS0, the "Measured" table, cases A-F): today's mover (moveCircle) is printed for
 * the record, the player's slide mover (slideCircle, PLAYER_SLIDE) is asserted. A 60 Hz walk: 0.1 per tick, the
 * player's radius 0.35, on small synthetic grids (a WALL border; open floor elsewhere unless the case says).
 */
import { describe, expect, it } from "@rbxts/jest-globals";
import { moveCircle, slideCircle, type Dungeon, type SolidCells } from "shared/dungeon";
import { sceneGrid, ticksTo, walk, type SceneMover } from "shared/dungeon/testing";

const R = 0.35;
const STEP = 0.1;
const SQRT1_2 = math.sqrt(0.5);

const today: SceneMover = moveCircle;
const slide: SceneMover = (d, x, z, dx, dz, r, solid?: SolidCells) => slideCircle(d, x, z, dx, dz, r, solid);

function dirOf(deg: number): [number, number] {
	const a = (deg * math.pi) / 180;
	return [math.cos(a) * STEP, math.sin(a) * STEP];
}

function marks(results: ReadonlyArray<number>): string {
	let s = "";
	for (const t of results) s += t < 0 ? "." : "Y";
	return s;
}

function list(results: ReadonlyArray<number>): string {
	return results.map((t) => tostring(t)).join(" ");
}

describe("snag scenarios (WALL_SLIDE.md WS0)", () => {
	// A. A world-axis walk (+X) at a 1x1 pillar, lateral offset 0.0 .. 0.9.
	const pillarA = sceneGrid(30, 21, (gx, gy) => gx === 12 && gy === 10);
	const openA = sceneGrid(30, 21, () => false);
	const pastA = (x: number) => x >= 13.95;
	it("A. a world-axis walk at a 1x1 pillar: every offset gets past within 10 ticks of open floor", () => {
		const open = ticksTo(slide, openA, 6, 10, STEP, 0, R, pastA, 400);
		const old: number[] = [];
		const neu: number[] = [];
		for (let i = 0; i <= 9; i++) {
			old.push(ticksTo(today, pillarA, 6, 10 + i / 10, STEP, 0, R, pastA, 400));
			neu.push(ticksTo(slide, pillarA, 6, 10 + i / 10, STEP, 0, R, pastA, 400));
		}
		print(`[snag A] open floor ${open} ticks; offsets 0.0..0.9 today ${marks(old)} (${list(old)})`);
		print(`[snag A] slide ${marks(neu)} (${list(neu)})`);
		expect(open).toBe(80);
		for (const t of neu) {
			expect(t).toBeGreaterThan(0);
			expect(t - open).toBeLessThanOrEqual(10);
		}
	});

	// B. The screen-up key (a world diagonal) at the pillar's corner, offset -0.9 .. 0.9 across the corner line.
	const pillarB = sceneGrid(25, 25, (gx, gy) => gx === 12 && gy === 12);
	const openB = sceneGrid(25, 25, () => false);
	const pastB = (x: number, z: number) => x + z <= 22.7;
	const sB = STEP * SQRT1_2;
	it("B. a diagonal walk at the pillar's corner: every offset gets past, the exact tie within 100 ticks", () => {
		const open = ticksTo(slide, openB, 17.5, 17.5, -sB, -sB, R, pastB, 400);
		const old: number[] = [];
		const neu: number[] = [];
		for (let i = -9; i <= 9; i++) {
			const o = (i / 10) * SQRT1_2;
			old.push(ticksTo(today, pillarB, 17.5 + o, 17.5 - o, -sB, -sB, R, pastB, 400));
			neu.push(ticksTo(slide, pillarB, 17.5 + o, 17.5 - o, -sB, -sB, R, pastB, 400));
		}
		print(`[snag B] open floor ${open} ticks; offsets -0.9..0.9 today ${marks(old)} (${list(old)})`);
		print(`[snag B] slide ${marks(neu)} (${list(neu)})`);
		expect(open).toBe(87);
		neu.forEach((t, i) => {
			expect([i, t > 0]).toEqual([i, true]);
			// Measured: the exact tie 100 (the plan's prototype 101), the rest at most 10 ticks slower than open floor.
			expect(t).toBeLessThanOrEqual(i === 9 ? 100 : open + 10);
		});
	});

	// C. A 1:1 stepped wall (oct / ellipse rooms): blocked where gy >= gx + 3, walked along (1, 1).
	const stair = sceneGrid(40, 40, (gx, gy) => gy >= gx + 3);
	function stairShare(mover: SceneMover, deg: number): number {
		const [dx, dz] = dirOf(deg);
		const w = walk(mover, stair, 5, 6.5, dx, dz, R, 120);
		return ((w.x + w.z - 11.5) * SQRT1_2) / (120 * STEP);
	}
	it("C. a 1:1 stepped wall: the slide keeps at least today's share of walk speed at every push-in angle", () => {
		const old: string[] = [];
		const neu: string[] = [];
		for (const deg of [45, 50, 60, 70]) {
			const a = stairShare(today, deg);
			const b = stairShare(slide, deg);
			old.push(string.format("%.2f", a));
			neu.push(string.format("%.2f", b));
			expect(b).toBeGreaterThanOrEqual(a - 1e-9);
		}
		print(`[snag C] push-in 0/5/15/25 deg: today ${old.join(" ")}; slide ${neu.join(" ")}`);
	});

	// D. A flat wall (blocked gy >= 3, the prototype's row), walked along +X pushing in by 0 / 10 / 45 degrees.
	const flat = sceneGrid(20, 6, (_gx, gy) => gy >= 3);
	it("D. a flat wall: the slide is moveCircle, tick for tick (within 1e-9)", () => {
		const old: string[] = [];
		for (const deg of [0, 10, 45]) {
			const [dx, dz] = dirOf(deg);
			let ax = 2,
				az = 1.5,
				bx = 2,
				bz = 1.5;
			let worst = 0;
			for (let t = 0; t < 120; t++) {
				const a = today(flat, ax, az, dx, dz, R);
				const b = slide(flat, bx, bz, dx, dz, R);
				ax = a.x;
				az = a.z;
				bx = b.x;
				bz = b.z;
				worst = math.max(worst, math.abs(ax - bx), math.abs(az - bz));
			}
			old.push(string.format("%.2f", (ax - 2) / (120 * STEP)));
			expect([deg, worst <= 1e-9]).toEqual([deg, true]);
		}
		print(`[snag D] push-in 0/10/45 deg: today ${old.join(" ")}; slide identical`);
	});

	// D'. The same walk along walls in other rows. moveCircle rests at edge - r, and on some rows that rounds a hair
	// inside r of the wall's face (fl((g - 0.5) - 0.35) and the like): its next X sweep then meets every cell seam of the
	// wall with a reach of ~1e-8 and stops dead there. The slide's overlap test has moveCircle's 1e-9 tolerance.
	it("D'. flat walls in rows 3..40, on both sides: the slide never stops on a cell seam (moveCircle does on some rows)", () => {
		const [dx, dz] = dirOf(10);
		let snagged = 0;
		let rows = 0;
		let worst = 1;
		for (let g = 3; g <= 40; g++)
			for (const side of [1, -1]) {
				// side 1: the wall above (gy >= g, walked into +Z); -1: below (gy <= g, walked into -Z).
				const d = sceneGrid(20, g + 4, (_gx, gy) => (side > 0 ? gy >= g : gy <= g));
				const z0 = side > 0 ? g - 1.5 : g + 1.5;
				const a = walk(today, d, 2, z0, dx, side * dz, R, 120);
				const b = walk(slide, d, 2, z0, dx, side * dz, R, 120);
				rows++;
				if ((a.x - 2) / (120 * STEP) < 0.9) snagged++;
				worst = math.min(worst, (b.x - 2) / (120 * STEP));
			}
		print(
			`[snag D'] 10 deg along a wall: moveCircle stops on a cell seam in ${snagged} of ${rows} walls; slide's worst share ${string.format(
				"%.4f",
				worst,
			)}`,
		);
		expect(worst).toBeGreaterThan(0.98);
	});

	// E. The screen-up key (45 degrees) sliding along a wall into a 1 / 2 / 3-wide doorway, then pressing +X: open
	// room at px < 5, wall at px >= 5 except the corridor rows 0 <= pz < w (grid = proto + (3, 8)).
	function doorway(w: number): Dungeon {
		return sceneGrid(15, 8 + w + 7, (gx, gy) => gx - 3 >= 5 && !(gy - 8 >= 0 && gy - 8 < w));
	}
	function through(mover: SceneMover, d: Dungeon, i: number): boolean {
		const [dx, dz] = dirOf(45);
		const a = walk(mover, d, 3 + -0.5 + i * 0.25, 8 - 4, dx, dz, R, 60);
		const b = walk(mover, d, a.x, a.z, STEP, 0, R, 60);
		return b.x - 3 > 7;
	}
	for (const w of [1, 2, 3])
		it(`E. a ${w}-wide doorway: all 16 starts go through`, () => {
			const d = doorway(w);
			let old = "";
			let neu = "";
			let passed = 0;
			for (let i = 0; i < 16; i++) {
				old += through(today, d, i) ? "Y" : ".";
				const ok = through(slide, d, i);
				neu += ok ? "Y" : ".";
				if (ok) passed++;
			}
			print(`[snag E] ${w}-wide: today ${old}; slide ${neu}`);
			expect(passed).toBe(16);
		});

	// F. Pressing diagonally into a square room corner (blocked px >= 5 or pz >= 5, grid = proto + (2, 2)).
	const corner = sceneGrid(10, 10, (gx, gy) => gx >= 7 || gy >= 7);
	it("F. a square room corner: the slide rests still where moveCircle rests", () => {
		const [dx, dz] = dirOf(45);
		const a = walk(today, corner, 3, 3, dx, dz, R, 100);
		const b = walk(slide, corner, 3, 3, dx, dz, R, 100);
		print(
			`[snag F] today ${a.still ? "still" : "JITTER"} at (${a.x}, ${a.z}); slide ${
				b.still ? "still" : "JITTER"
			} at (${b.x}, ${b.z})`,
		);
		expect(b.still).toBe(true);
		expect([b.x, b.z]).toEqual([a.x, a.z]);
	});
});

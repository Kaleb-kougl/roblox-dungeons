// Greedy rectangle meshing: exact cover (every matching cell once, nothing else) and the part budget on seed 1337.
import { describe, expect, it } from "@rbxts/jest-globals";
import { TileType } from "shared/dungeon";
import { dungeonForSeed } from "shared/run";
import { greedyRects, greedyRectsOf, type TileRect } from "shared/view";

/** Every matching cell covered exactly once, every rect cell matching. */
function expectExactCover(grid: ReadonlyArray<number>, W: number, H: number, value: number, rects: TileRect[]): void {
	const hits = table.create<number>(W * H, 0);
	for (const r of rects) {
		expect(r.w).toBeGreaterThan(0);
		expect(r.h).toBeGreaterThan(0);
		for (let y = r.y; y < r.y + r.h; y++) {
			for (let x = r.x; x < r.x + r.w; x++) {
				expect(grid[y * W + x]).toBe(value);
				hits[y * W + x] += 1;
			}
		}
	}
	for (let c = 0; c < W * H; c++) expect(hits[c]).toBe(grid[c] === value ? 1 : 0);
}

/** A small deterministic LCG, so the random grids are the same on every run. */
function lcgGrid(W: number, H: number, seed: number, kinds: number): number[] {
	const out = new Array<number>();
	let s = seed;
	for (let i = 0; i < W * H; i++) {
		s = (s * 1103515245 + 12345) % 2147483648;
		out.push(math.floor((s / 2147483648) * kinds));
	}
	return out;
}

describe("greedyRects", () => {
	it("one rectangle for a full grid, none for an empty one", () => {
		expect(greedyRects(5, 3, () => true)).toEqual([{ x: 0, y: 0, w: 5, h: 3 }]);
		expect(greedyRects(5, 3, () => false)).toEqual([]);
	});

	it("an L shape takes two rectangles", () => {
		// ##.
		// ##.
		// ###
		const grid = [1, 1, 0, 1, 1, 0, 1, 1, 1];
		const rects = greedyRectsOf(grid, 3, 3, 1);
		expect(rects.size()).toBe(2);
		expectExactCover(grid, 3, 3, 1, rects);
	});

	it("covers random grids exactly, for every tile kind", () => {
		for (const seed of [1, 2, 3, 99]) {
			const W = 17;
			const H = 11;
			const grid = lcgGrid(W, H, seed, 3);
			for (const v of [0, 1, 2]) expectExactCover(grid, W, H, v, greedyRectsOf(grid, W, H, v));
		}
	});
});

describe("the seed 1337 floor (WorldController's part budget)", () => {
	it("covers floors, walls and pools exactly with far fewer parts than tiles", () => {
		const d = dungeonForSeed(1337);
		let tiles = 0;
		let parts = 0;
		const counts = new Array<string>();
		for (const [name, value] of [
			["floor", TileType.FLOOR],
			["wall", TileType.WALL],
			["pool", TileType.POOL],
		] as const) {
			const rects = greedyRectsOf(d.grid, d.W, d.H, value);
			expectExactCover(d.grid, d.W, d.H, value, rects);
			let n = 0;
			for (const c of d.grid) if (c === value) n++;
			tiles += n;
			parts += rects.size();
			counts.push(`${name} ${n} tiles -> ${rects.size()} parts`);
		}
		print(`[tileMerge] seed 1337 (${d.W}x${d.H}): ${counts.join(", ")}; total ${tiles} tiles -> ${parts} parts`);
		expect(parts).toBeLessThan(tiles / 4);
	});
});

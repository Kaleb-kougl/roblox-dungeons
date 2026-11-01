// The void field (docs/VOID_DECOR.md VD2): Chebyshev distance to the nearest non-void cell and enclosed pockets, on
// small hand-made grids.
import { describe, expect, it } from "@rbxts/jest-globals";
import { TileType, endlessFloorParams, generateDungeon, type Dungeon } from "shared/dungeon";
import { voidField } from ".";

/** A synthetic Dungeon from rows of characters: '.' void, '#' wall, 'f' floor, '~' pool. */
function dungeonOf(rows: ReadonlyArray<string>): Dungeon {
	const H = rows.size();
	const W = rows[0].size();
	const grid: number[] = [];
	for (const row of rows)
		for (let x = 1; x <= W; x++) {
			const ch = string.sub(row, x, x);
			grid.push(
				ch === "#" ? TileType.WALL : ch === "f" ? TileType.FLOOR : ch === "~" ? TileType.POOL : TileType.VOID,
			);
		}
	return { W, H, grid, seed: 1, params: { themeKey: "ancient" } } as unknown as Dungeon;
}

describe("voidField", () => {
	it("measures the Chebyshev distance to the nearest non-void cell (0 on non-void)", () => {
		const d = dungeonOf([
			".......", //
			".......",
			"...#...",
			".......",
			".......",
		]);
		const f = voidField(d);
		expect(f.W).toBe(7);
		expect(f.H).toBe(5);
		const at = (x: number, y: number) => f.dist[y * f.W + x];
		expect(at(3, 2)).toBe(0);
		expect(at(2, 1)).toBe(1);
		expect(at(4, 3)).toBe(1);
		expect(at(1, 0)).toBe(2);
		expect(at(5, 4)).toBe(2);
		expect(at(0, 0)).toBe(3);
		expect(at(6, 4)).toBe(3);
		expect(f.maxDist).toBe(3);
	});

	it("finds enclosed pockets (4-connected, off the grid edge) and their deepest cell", () => {
		const d = dungeonOf([
			"..........",
			".#######..",
			".#.....#..",
			".#.....#..",
			".#######..",
			"......#.#.",
			".......#..",
		]);
		const f = voidField(d);
		const at = (x: number, y: number) => f.pocket[y * f.W + x];
		// two pockets, numbered in scan order: the room-shaped one, then the single cell at (7, 5) (walled on four
		// sides, its corners open: 4-connected it is closed); walls and the open outside are -1
		expect(f.pocketCount).toBe(2);
		for (let y = 2; y <= 3; y++) for (let x = 2; x <= 6; x++) expect(at(x, y)).toBe(0);
		expect(f.pocketMaxDist[0]).toBe(1);
		expect(at(7, 5)).toBe(1);
		expect(f.pocketMaxDist[1]).toBe(1);
		expect(at(0, 0)).toBe(-1);
		expect(at(1, 1)).toBe(-1);
		expect(at(9, 6)).toBe(-1);
	});

	it("matches a multi-source 8-connected BFS on endless floors", () => {
		for (const [run, floor] of [
			[1, 1],
			[2, 5],
			[3, 15],
		]) {
			const d = generateDungeon(endlessFloorParams(run, floor));
			const f = voidField(d);
			const n = d.W * d.H;
			const ref = new Array<number>(n, -1);
			const queue: number[] = [];
			for (let c = 0; c < n; c++)
				if (d.grid[c] !== TileType.VOID) {
					ref[c] = 0;
					queue.push(c);
				}
			let head = 0;
			while (head < queue.size()) {
				const c = queue[head];
				head++;
				const x = c % d.W;
				const y = (c - x) / d.W;
				for (let ny = y - 1; ny <= y + 1; ny++)
					for (let nx = x - 1; nx <= x + 1; nx++) {
						if (nx < 0 || ny < 0 || nx >= d.W || ny >= d.H) continue;
						const j = ny * d.W + nx;
						if (ref[j] >= 0) continue;
						ref[j] = ref[c] + 1;
						queue.push(j);
					}
			}
			let diff = 0;
			let max = 0;
			for (let c = 0; c < n; c++) {
				if (f.dist[c] !== ref[c]) diff++;
				max = math.max(max, ref[c]);
			}
			expect(diff).toBe(0);
			expect(f.maxDist).toBe(max);
		}
	});
});

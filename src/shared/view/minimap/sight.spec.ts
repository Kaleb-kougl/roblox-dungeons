// Minimap sight (docs/MINIMAP.md M2): an open field lights a disc of the radius; a wall blocks what is behind it (and
// is lit itself); a 1-wide doorway shows a cone; symmetry (A sees B iff B sees A) over seeded random grids; no light
// through diagonal wall corners; pools and breakables do not block, solid pillars do; radius 0; no allocation growth.
import { describe, expect, it } from "@rbxts/jest-globals";
import { endlessFloorParams, generateDungeon } from "shared/dungeon";
import { endlessRunFloor } from "shared/run";
import { MapTile, Shadowcaster, blocksSight, minimapTiles, shadowcast, type MinimapTiles } from "shared/view";
import { specDungeon, specField } from "./testing";

/** The lit cells of one cast, as a set (fails on a repeated visit). */
function litSet(t: MinimapTiles, x: number, y: number, r: number, caster?: Shadowcaster): Set<number> {
	const seen = new Set<number>();
	const visit = (c: number) => {
		if (seen.has(c)) error(`cell ${c} visited twice`);
		seen.add(c);
	};
	const n = caster !== undefined ? caster.cast(t, x, y, r, visit) : shadowcast(t, x, y, r, visit);
	expect(n).toBe(seen.size());
	return seen;
}

function at(t: MinimapTiles, x: number, y: number): number {
	return y * t.W + x;
}

/** A small deterministic LCG (no math.random in specs either: fixed grids). */
function lcg(seed: number): () => number {
	let s = seed;
	return () => {
		s = (s * 1103515245 + 12345) % 2147483648;
		return s / 2147483648;
	};
}

describe("shadowcast", () => {
	it("an open field: exactly the disc dx^2 + dy^2 <= r^2 (317 cells at r = 10)", () => {
		const t = minimapTiles(specField(41, 41));
		const lit = litSet(t, 20, 20, 10);
		let want = 0;
		for (let y = 0; y < 41; y++)
			for (let x = 0; x < 41; x++) {
				const inside = (x - 20) * (x - 20) + (y - 20) * (y - 20) <= 100;
				if (inside) want++;
				if (inside !== lit.has(at(t, x, y))) error(`(${x}, ${y}): lit ${lit.has(at(t, x, y))}`);
			}
		expect(want).toBe(317);
		expect(lit.size()).toBe(317);
	});

	it("radius 0 lights the origin only; an origin off the grid lights nothing", () => {
		const t = minimapTiles(specField(9, 9));
		const lit = litSet(t, 4, 4, 0);
		expect(lit.size()).toBe(1);
		expect(lit.has(at(t, 4, 4))).toBe(true);
		expect(litSet(t, -1, 4, 5).size()).toBe(0);
		expect(litSet(t, 4, 9, 5).size()).toBe(0);
	});

	it("a wall blocks what is behind it and is lit itself", () => {
		// prettier-ignore
		const t = minimapTiles(specDungeon([
			"###########",
			"#.........#",
			"#.........#",
			"#....#....#",
			"#.........#",
			"#.........#",
			"#.........#",
			"###########",
		], 0, -1));
		const lit = litSet(t, 5, 6, 10);
		expect(lit.has(at(t, 5, 3))).toBe(true); // the wall
		expect(lit.has(at(t, 5, 2))).toBe(false); // right behind it
		expect(lit.has(at(t, 5, 1))).toBe(false);
		expect(lit.has(at(t, 3, 1))).toBe(true); // off to the side
		expect(lit.has(at(t, 0, 0))).toBe(true); // the border walls
	});

	it("a 1-wide doorway shows a cone that widens with distance", () => {
		const rows: string[] = [];
		const W = 31;
		for (let y = 0; y < 16; y++) {
			let row = "";
			for (let x = 0; x < W; x++) {
				const border = x === 0 || x === W - 1 || y === 0 || y === 15;
				row += border || (y === 12 && x !== 15) ? "#" : ".";
			}
			rows.push(row);
		}
		const t = minimapTiles(specDungeon(rows, 0, -1));
		const lit = litSet(t, 15, 13, 12);
		let lastWidth = 0;
		// rows 11..5 (up to 8 beyond the origin): the disc (r = 12) is wider than the cone there
		for (let y = 11; y >= 5; y--) {
			let width = 0;
			let minX = W;
			let maxX = -1;
			for (let x = 1; x < W - 1; x++)
				if (lit.has(at(t, x, y))) {
					width++;
					minX = math.min(minX, x);
					maxX = math.max(maxX, x);
				}
			// one contiguous run, centred on the door, never narrower than the row before
			expect(maxX - minX + 1).toBe(width);
			expect(minX + maxX).toBe(30);
			expect(width >= lastWidth).toBe(true);
			lastWidth = width;
		}
		expect(lit.has(at(t, 15, 4))).toBe(true);
		expect(lit.has(at(t, 10, 11))).toBe(false); // beside the door, behind the wall
		expect(lastWidth > 1).toBe(true);
	});

	it("symmetric: A sees B iff B sees A, over seeded random grids (walls, pools, void)", () => {
		const N = 15;
		const R = 8;
		const caster = new Shadowcaster();
		let pairCount = 0;
		let seenPairs = 0;
		for (let g = 1; g <= 24; g++) {
			const rnd = lcg(g * 7919);
			const rows: string[] = [];
			for (let y = 0; y < N; y++) {
				let row = "";
				for (let x = 0; x < N; x++) {
					const v = rnd();
					row += v < 0.22 ? "#" : v < 0.27 ? "~" : v < 0.29 ? " " : ".";
				}
				rows.push(row);
			}
			const t = minimapTiles(specDungeon(rows, 0, -1));
			const sets: Array<Set<number> | undefined> = [];
			const open: number[] = [];
			for (let c = 0; c < N * N; c++) {
				const tile = t.tile[c];
				if (tile === MapTile.FLOOR || tile === MapTile.POOL) {
					open.push(c);
					sets[c] = litSet(t, c % N, math.floor(c / N), R, caster);
				}
			}
			for (const a of open)
				for (const b of open) {
					if (a >= b) continue;
					pairCount++;
					const ab = sets[a]!.has(b);
					const ba = sets[b]!.has(a);
					if (ab) seenPairs++;
					if (ab !== ba)
						error(
							`grid ${g}: (${a % N}, ${math.floor(a / N)}) -> (${b % N}, ${math.floor(
								b / N,
							)}) ${ab}, back ${ba}`,
						);
				}
		}
		print(`[minimap] symmetry: ${pairCount} open pairs over 24 grids, ${seenPairs} see each other`);
		expect(seenPairs > 0).toBe(true);
	});

	it("no light through diagonal wall corners: a diagonal wall line hides everything beyond it", () => {
		// walls on x + y = 12 (touching only at corners), floor on both sides
		const N = 17;
		const rows: string[] = [];
		for (let y = 0; y < N; y++) {
			let row = "";
			for (let x = 0; x < N; x++) row += x + y === 12 ? "#" : ".";
			rows.push(row);
		}
		const t = minimapTiles(specDungeon(rows, 0, -1));
		for (const [ox, oy] of [
			[4, 4],
			[2, 7],
			[8, 1],
			[5, 6],
		] as const) {
			const lit = litSet(t, ox, oy, 12);
			for (const c of lit) {
				const x = c % N;
				const y = math.floor(c / N);
				if (x + y > 12) error(`from (${ox}, ${oy}): (${x}, ${y}) beyond the diagonal is lit`);
			}
			expect(lit.has(at(t, ox + 1, oy))).toBe(true);
		}
	});

	it("two pillars touching at the origin's corner hide the diagonal cell and the wedge behind it", () => {
		// prettier-ignore
		const t = minimapTiles(specDungeon([
			".........",
			".........",
			".........",
			"....#....",
			".....#...",
			".........",
			".........",
		], 0, -1));
		const lit = litSet(t, 4, 4, 6);
		expect(lit.has(at(t, 5, 3))).toBe(false);
		expect(lit.has(at(t, 6, 2))).toBe(false);
		expect(lit.has(at(t, 7, 1))).toBe(false);
		expect(lit.has(at(t, 4, 3))).toBe(true);
		expect(lit.has(at(t, 5, 4))).toBe(true);
		expect(lit.has(at(t, 3, 3))).toBe(true);
		expect(lit.has(at(t, 5, 5))).toBe(true);
	});

	it("pools do not block; solid pillars (WALL) do", () => {
		// prettier-ignore
		const t = minimapTiles(specDungeon([
			"#########",
			"#.......#",
			"#~~~~~~~#",
			"#.......#",
			"#...#...#",
			"#.......#",
			"#.......#",
			"#########",
		], 0, -1));
		const lit = litSet(t, 4, 6, 10);
		expect(lit.has(at(t, 1, 1))).toBe(true); // past the pool row
		expect(lit.has(at(t, 4, 2))).toBe(false); // behind the pillar
		expect(blocksSight(MapTile.POOL)).toBe(false);
		expect(blocksSight(MapTile.FLOOR)).toBe(false);
		expect(blocksSight(MapTile.WALL)).toBe(true);
		expect(blocksSight(MapTile.NONE)).toBe(true);
	});

	it("a real endless floor: breakable cells are FLOOR (transparent), solid pillar cells WALL (blocking)", () => {
		const floor = endlessRunFloor(1337, 1);
		const t = minimapTiles(floor.dungeon, floor.layout.stairwell);
		const pieces = floor.layout.breakables ?? [];
		expect(pieces.size() > 0).toBe(true);
		for (const b of pieces) expect(t.tile[b.y * t.W + b.x]).toBe(MapTile.FLOOR);
		const d = generateDungeon(endlessFloorParams(1337, 1));
		let pillars = 0;
		for (const p of d.props) {
			if (p.kind !== "pillar") continue;
			pillars++;
			expect(blocksSight(t.tile[math.floor(p.y) * t.W + math.floor(p.x)])).toBe(true);
		}
		print(`[minimap] endless 1337 / 1: ${pieces.size()} breakables, ${pillars} pillars`);
	});

	it("a reused caster gives the same cells every call", () => {
		const t = minimapTiles(specField(30, 30));
		const caster = new Shadowcaster();
		const a = litSet(t, 10, 12, 9, caster);
		litSet(t, 20, 20, 5, caster);
		const b = litSet(t, 10, 12, 9, caster);
		expect(a.size()).toBe(b.size());
		for (const c of a) expect(b.has(c)).toBe(true);
	});
});

// BFS path fields (docs/TUTORIAL_ARROW.md A1) on small hand-made grids: a straight corridor, an L bend, a solid
// pillar in a room, a target in a wall snapping to floor, an unreachable pocket, the avoided point, walking the field
// downhill (pathStep / pathAhead) and the three-line body test (clearWalk).
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	PATH_AVOID_RADIUS,
	PATH_SNAP_TILES,
	TileType,
	bulletBlocker,
	clearWalk,
	pathAhead,
	pathDistance,
	pathField,
	pathStep,
	walkBlocker,
	type Dungeon,
} from "shared/dungeon";

const PLAYER_RADIUS = 0.35;

/** A bare grid from rows (row = grid y = world z): '#' WALL, '.' FLOOR, '~' POOL, anything else VOID. */
function grid(rows: ReadonlyArray<string>): Dungeon {
	const H = rows.size();
	const W = rows[0].size();
	const cells: number[] = [];
	for (const row of rows)
		for (let x = 1; x <= W; x++) {
			const c = string.sub(row, x, x);
			cells.push(
				c === "#" ? TileType.WALL : c === "." ? TileType.FLOOR : c === "~" ? TileType.POOL : TileType.VOID,
			);
		}
	return { W, H, grid: cells } as unknown as Dungeon;
}

const CORRIDOR = grid(["##########", "#........#", "##########"]);

// An L: a corridor east along row 1, then south down column 8.
// prettier-ignore
const L_BEND = grid([
	"##########",
	"#........#",
	"#######..#",
	"#######..#",
	"#######..#",
	"##########",
]);

// A 9 x 7 room with a 3 x 3 solid pillar in the middle (cells x 4-6, y 3-5).
const PILLAR_ROOM = grid([
	"###########",
	"#.........#",
	"#.........#",
	"#...###...#",
	"#...###...#",
	"#...###...#",
	"#.........#",
	"#.........#",
	"###########",
]);

// The same room without the pillar.
const OPEN_ROOM = grid([
	"###########",
	"#.........#",
	"#.........#",
	"#.........#",
	"#.........#",
	"#.........#",
	"#.........#",
	"#.........#",
	"###########",
]);

// Two rooms with no way between them (the right one is a sealed pocket).
const POCKET = grid(["#########", "#...#...#", "#...#...#", "#########"]);

describe("pathField", () => {
	it("a straight corridor: distance is the tile count to the target; walking steps straight along it", () => {
		const f = pathField(CORRIDOR, 8, 1);
		expect([f.gx, f.gy, f.tx, f.tz]).toEqual([8, 1, 8, 1]);
		for (let x = 1; x <= 8; x++) expect([x, pathDistance(f, x, 1)]).toEqual([x, 8 - x]);
		// Walls and off-grid points are unreachable.
		expect(pathDistance(f, 0, 1)).toBe(math.huge);
		expect(pathDistance(f, 3, 0)).toBe(math.huge);
		expect(pathDistance(f, -5, 1)).toBe(math.huge);
		expect(pathDistance(f, 3, 99)).toBe(math.huge);
		const out: number[] = [];
		expect(pathAhead(f, 1.2, 1.1, 4, out)).toBe(4);
		expect(out).toEqual([2, 1, 3, 1, 4, 1, 5, 1]);
		// Short of the target the walk stops on its tile; on the target there is no step.
		expect(pathAhead(f, 6, 1, 10, out)).toBe(2);
		expect([out[0], out[1], out[2], out[3]]).toEqual([7, 1, 8, 1]);
		expect(pathAhead(f, 8, 1, 10, out)).toBe(0);
		expect(pathStep(f, 8, 1)).toBe(-1);
	});

	it("an L bend: the distance follows the corridor round the corner, and the walk cuts the open corner diagonally", () => {
		const f = pathField(L_BEND, 8, 4);
		// From the far end of the top row: 7 tiles east, 3 south.
		expect(pathDistance(f, 1, 1)).toBe(7 + 3);
		// The walk: east along the top row, then the open corner cut diagonally (7, 1) -> (8, 2), then south.
		const out: number[] = [];
		const n = pathAhead(f, 1, 1, 20, out);
		expect(n).toBe(9);
		expect(out).toEqual([2, 1, 3, 1, 4, 1, 5, 1, 6, 1, 7, 1, 8, 2, 8, 3, 8, 4]);
		// A diagonal past a wall corner is refused: from (6, 1) the lower (7, 2) is skipped ((6, 2) is wall).
		expect(pathStep(f, 6, 1)).toBe(1 * L_BEND.W + 7);
		expect(pathStep(f, 7, 1)).toBe(2 * L_BEND.W + 8);
	});

	it("a solid pillar: the field rounds it (no tile of it is reachable) and the walk goes round, not through", () => {
		const f = pathField(PILLAR_ROOM, 5, 7);
		for (let y = 3; y <= 5; y++) for (let x = 4; x <= 6; x++) expect(pathDistance(f, x, y)).toBe(math.huge);
		// Straight above the pillar: 2 tiles across to its side, 6 down, 2 back.
		expect(pathDistance(f, 5, 1)).toBe(2 + 6 + 2);
		const out: number[] = [];
		const n = pathAhead(f, 5, 2, 20, out);
		expect([out[2 * (n - 1)], out[2 * (n - 1) + 1]]).toEqual([5, 7]);
		for (let k = 0; k < n; k++) {
			const x = out[2 * k];
			const z = out[2 * k + 1];
			expect(PILLAR_ROOM.grid[z * PILLAR_ROOM.W + x]).toBe(TileType.FLOOR);
		}
	});

	it("a target on a WALL tile (or off the grid) snaps to the nearest FLOOR tile within PATH_SNAP_TILES", () => {
		// The pillar's middle cell (5, 4) is 2 tiles from floor on every side; the first nearest in row order is (5, 2).
		const f = pathField(PILLAR_ROOM, 5, 4);
		expect([f.gx, f.gy, f.tx, f.tz]).toEqual([5, 2, 5, 4]);
		expect(pathDistance(f, 5, 2)).toBe(0);
		expect(pathDistance(f, 1, 1)).toBe(5);
		// The corridor's end wall (9, 1) snaps to (8, 1); a point just off the grid's edge too.
		expect([pathField(CORRIDOR, 9, 1).gx, pathField(CORRIDOR, 9, 1).gy]).toEqual([8, 1]);
		expect([pathField(CORRIDOR, 10, 1).gx, pathField(CORRIDOR, 10, 1).gy]).toEqual([8, 1]);
		// Farther than PATH_SNAP_TILES from any floor: nothing is reachable.
		const far = pathField(CORRIDOR, 8 + PATH_SNAP_TILES + 1, 1);
		expect([far.gx, far.gy]).toEqual([-1, -1]);
		expect(pathDistance(far, 8, 1)).toBe(math.huge);
		expect(pathAhead(far, 3, 1, 5, [])).toBe(0);
	});

	it("an unreachable pocket is math.huge, and so is everything from inside it", () => {
		const f = pathField(POCKET, 1, 1);
		expect(pathDistance(f, 3, 2)).toBe(1 + 2);
		for (let y = 1; y <= 2; y++) for (let x = 5; x <= 7; x++) expect(pathDistance(f, x, y)).toBe(math.huge);
		expect(pathStep(f, 6, 1)).toBe(-1);
		expect(pathAhead(f, 6, 1, 8, [])).toBe(0);
	});

	it("leaves out tiles within PATH_AVOID_RADIUS of `avoid` (the seed itself stays), so walks route round it", () => {
		const avoid: [number, number] = [5, 4];
		const f = pathField(OPEN_ROOM, 1, 4, avoid);
		for (let y = 1; y <= 7; y++)
			for (let x = 1; x <= 9; x++) {
				const dx = x - avoid[0];
				const dz = y - avoid[1];
				const inside = dx * dx + dz * dz <= PATH_AVOID_RADIUS * PATH_AVOID_RADIUS;
				expect([x, y, pathDistance(f, x, y) === math.huge]).toEqual([x, y, inside]);
			}
		const seeded = pathField(CORRIDOR, 4, 1, [4, 1]);
		expect(pathDistance(seeded, 4, 1)).toBe(0);
		expect(pathDistance(seeded, 1, 1)).toBe(math.huge); // the corridor is cut on both sides of the seed
	});

	it("is deterministic: the same inputs give the same field", () => {
		const a = pathField(PILLAR_ROOM, 2, 6);
		const b = pathField(PILLAR_ROOM, 2, 6);
		expect(a.dist).toEqual(b.dist);
	});
});

describe("clearWalk", () => {
	it("three parallel lines a radius apart: clear in an open room, blocked when a side line clips the pillar", () => {
		const blocked = bulletBlocker(PILLAR_ROOM);
		expect(clearWalk(blocked, 1, 1, 9, 1, PLAYER_RADIUS)).toBe(true);
		expect(clearWalk(blocked, 2, 1, 2, 7, PLAYER_RADIUS)).toBe(true);
		// Straight through the pillar.
		expect(clearWalk(blocked, 5, 1, 5, 7, PLAYER_RADIUS)).toBe(false);
		// The centre line just misses the pillar's west face (x 3.4: tiles x <= 3), the body's right side does not.
		expect(clearWalk(blocked, 3.4, 1, 3.4, 7, 0)).toBe(true);
		expect(clearWalk(blocked, 3.4, 1, 3.4, 7, PLAYER_RADIUS)).toBe(false);
		// Zero length: the body's own tile only.
		expect(clearWalk(blocked, 2, 2, 2, 2, PLAYER_RADIUS)).toBe(true);
	});

	it("bulletBlocker sees across pits; walkBlocker stops at them (and at the grid's edge)", () => {
		const d = grid(["#######", "#..~..#", "#######"]);
		expect(clearWalk(bulletBlocker(d), 1, 1, 5, 1, 0)).toBe(true);
		expect(clearWalk(walkBlocker(d), 1, 1, 5, 1, 0)).toBe(false);
		expect(clearWalk(walkBlocker(d), 1, 1, 2, 1, 0)).toBe(true);
		expect(walkBlocker(d)(-3, 1)).toBe(true);
	});
});

// Minimap tiles (docs/MINIMAP.md M1): hand-made dungeons (a rect room, a pillar, a pool, a corridor, two rooms sharing
// a wall, the stairwell cell) and a census of real floors (the three M1 fixture seeds, endless run seeds 1-60 x floors
// 1-20, both tutorial floors): the largest W x H (<= MINIMAP_VIEW.maxImageSide per side), the most cells per room, and
// every FLOOR cell with roomId >= 0 in exactly one roomCells list (its own), walls only where they touch floor.
import { describe, expect, it } from "@rbxts/jest-globals";
import { TUTORIAL } from "shared/config";
import {
	ENDLESS_FIRST_FLOOR,
	KALEB_VALE_MVP_PARAMS,
	TileType,
	endlessFloorParams,
	generateDungeon,
	roomIdAt,
	type Dungeon,
} from "shared/dungeon";
import { endlessDungeon, endlessRunFloor, tutorialDungeon } from "shared/run";
import { MAP_NO_CELL, MINIMAP_VIEW, MapTile, minimapTiles, type MinimapTiles } from "shared/view";
import { specDungeon } from "./testing";

const NEIGHBOURS_8: ReadonlyArray<readonly [number, number]> = [
	[-1, -1],
	[0, -1],
	[1, -1],
	[-1, 0],
	[1, 0],
	[-1, 1],
	[0, 1],
	[1, 1],
];

function isOpen(t: number | undefined): boolean {
	return t === TileType.FLOOR || t === TileType.POOL;
}

interface FloorStats {
	readonly W: number;
	readonly H: number;
	readonly maxRoomCells: number;
	readonly walls: number;
}

/** Every MinimapTiles invariant of `t` on `d` (fails naming `label`), and the floor's numbers. */
function checkFloor(d: Dungeon, t: MinimapTiles, label: string): FloorStats {
	const W = d.W;
	const H = d.H;
	expect([t.W, t.H]).toEqual([W, H]);
	expect(t.tile.size()).toBe(W * H);
	expect(t.room.size()).toBe(W * H);
	expect(t.roomCells.size()).toBe(d.rooms.size());
	expect(t.roomType.size()).toBe(d.rooms.size());
	expect(t.bossRoom).toBe(d.boss);
	let walls = 0;
	for (let gy = 0; gy < H; gy++)
		for (let gx = 0; gx < W; gx++) {
			const i = gy * W + gx;
			const g = d.grid[i];
			let touches = false;
			for (const [dx, dy] of NEIGHBOURS_8) {
				const x = gx + dx;
				const y = gy + dy;
				if (x >= 0 && y >= 0 && x < W && y < H && isOpen(d.grid[y * W + x])) touches = true;
			}
			const want =
				g === TileType.FLOOR
					? MapTile.FLOOR
					: g === TileType.POOL
					? MapTile.POOL
					: g === TileType.WALL && touches
					? MapTile.WALL
					: MapTile.NONE;
			if (t.tile[i] !== want) error(`${label}: cell (${gx}, ${gy}) is ${t.tile[i]}, want ${want}`);
			if (want === MapTile.WALL) walls++;
			if (t.room[i] !== roomIdAt(d, gx, gy)) error(`${label}: room of (${gx}, ${gy}) differs from roomIdAt`);
		}
	// membership: each list ascending, every member open with that roomId or a WALL touching one of them
	const listedIn = new Map<number, number>();
	let maxRoomCells = 0;
	for (let r = 0; r < t.roomCells.size(); r++) {
		const list = t.roomCells[r];
		maxRoomCells = math.max(maxRoomCells, list.size());
		for (let k = 0; k < list.size(); k++) {
			const c = list[k];
			if (k > 0 && list[k - 1] >= c) error(`${label}: room ${r} cells out of order at ${k}`);
			const tile = t.tile[c];
			if (tile === MapTile.WALL) {
				const gx = c % W;
				const gy = math.floor(c / W);
				let ok = false;
				for (const [dx, dy] of NEIGHBOURS_8) {
					const x = gx + dx;
					const y = gy + dy;
					if (x < 0 || y < 0 || x >= W || y >= H) continue;
					const j = y * W + x;
					if (isOpen(d.grid[j]) && d.roomId[j] === r) ok = true;
				}
				if (!ok) error(`${label}: wall ${c} in room ${r} touches none of its cells`);
			} else if ((tile === MapTile.FLOOR || tile === MapTile.POOL) && d.roomId[c] === r) {
				listedIn.set(c, (listedIn.get(c) ?? 0) + 1);
			} else error(`${label}: cell ${c} (tile ${tile}) listed in room ${r}`);
		}
	}
	// every room FLOOR cell (the roomIdAt test) in exactly one list
	for (let i = 0; i < W * H; i++) {
		if (t.room[i] === MAP_NO_CELL) continue;
		const count = listedIn.get(i) ?? 0;
		if (count !== 1) error(`${label}: room floor cell ${i} listed ${count} times`);
	}
	return { W, H, maxRoomCells, walls };
}

describe("minimapTiles: hand-made dungeons", () => {
	it("a rect room: walls only where they touch floor (8-neighbour), the room's cells include its wall ring", () => {
		// prettier-ignore
		const d = specDungeon([
			"#######",
			"#######",
			"##AAA##",
			"##AAA##",
			"#######",
			"#######",
		]);
		const t = minimapTiles(d);
		checkFloor(d, t, "rect");
		// prettier-ignore
		expect(t.tile).toEqual([
			0, 0, 0, 0, 0, 0, 0,
			0, 2, 2, 2, 2, 2, 0,
			0, 2, 1, 1, 1, 2, 0,
			0, 2, 1, 1, 1, 2, 0,
			0, 2, 2, 2, 2, 2, 0,
			0, 0, 0, 0, 0, 0, 0,
		]);
		// 6 floor cells + the 14-cell ring, ascending
		expect(t.roomCells[0]).toEqual([8, 9, 10, 11, 12, 15, 16, 17, 18, 19, 22, 23, 24, 25, 26, 29, 30, 31, 32, 33]);
		expect(t.room[16]).toBe(0);
		expect(t.room[8]).toBe(MAP_NO_CELL);
		expect(t.roomType).toEqual(["boss"]);
		expect(t.stairCell).toBe(MAP_NO_CELL);
	});

	it("a solid pillar inside a room is a WALL in the room's list; a room pool is POOL, listed, not a roomIdAt cell", () => {
		// prettier-ignore
		const d = specDungeon([
			"#######",
			"#AAAAA#",
			"#A#AaA#",
			"#AAAAA#",
			"#######",
		]);
		const t = minimapTiles(d);
		checkFloor(d, t, "pillar");
		const pillar = 2 * 7 + 2;
		const pool = 2 * 7 + 4;
		expect(t.tile[pillar]).toBe(MapTile.WALL);
		expect(t.roomCells[0].includes(pillar)).toBe(true);
		expect(t.tile[pool]).toBe(MapTile.POOL);
		expect(t.roomCells[0].includes(pool)).toBe(true);
		expect(t.room[pool]).toBe(MAP_NO_CELL);
		// every cell is floor, pool or a wall touching one
		expect(t.roomCells[0].size()).toBe(7 * 5);
	});

	it("a corridor: its floor and walls are drawn but belong to no room; a corridor pool is POOL", () => {
		// prettier-ignore
		const d = specDungeon([
			"#####    ",
			"#AA######",
			"#AA...~..",
			"#AA######",
			"#####    ",
		]);
		const t = minimapTiles(d);
		checkFloor(d, t, "corridor");
		const W = 9;
		expect(t.tile[2 * W + 4]).toBe(MapTile.FLOOR);
		expect(t.tile[2 * W + 6]).toBe(MapTile.POOL);
		expect(t.tile[1 * W + 6]).toBe(MapTile.WALL);
		expect(t.tile[0 * W + 6]).toBe(MapTile.NONE);
		expect(t.room[2 * W + 4]).toBe(MAP_NO_CELL);
		// the corridor walls past the room's ring are not in the room
		expect(t.roomCells[0].includes(1 * W + 4)).toBe(false);
		expect(t.roomCells[0].includes(1 * W + 3)).toBe(true);
	});

	it("two rooms sharing a wall: the wall is in both lists", () => {
		// prettier-ignore
		const d = specDungeon([
			"#######",
			"#AA#BB#",
			"#AA#BB#",
			"#######",
		]);
		const t = minimapTiles(d);
		checkFloor(d, t, "shared wall");
		const shared = 1 * 7 + 3;
		expect(t.roomCells[0].includes(shared)).toBe(true);
		expect(t.roomCells[1].includes(shared)).toBe(true);
		expect(t.roomType).toEqual(["boss", "combat"]);
	});

	it("the stairwell's cell, from its world point; off the grid -> MAP_NO_CELL", () => {
		// prettier-ignore
		const d = specDungeon([
			"#####",
			"#AAA#",
			"#AAA#",
			"#####",
		]);
		expect(minimapTiles(d, { x: 2, z: 2 }).stairCell).toBe(2 * 5 + 2);
		expect(minimapTiles(d, { x: 2.4, z: 0.6 }).stairCell).toBe(1 * 5 + 2);
		expect(minimapTiles(d, { x: 9, z: 1 }).stairCell).toBe(MAP_NO_CELL);
		expect(minimapTiles(d, { x: -0.6, z: 1 }).stairCell).toBe(MAP_NO_CELL);
	});
});

describe("minimapTiles: real floors", () => {
	const fmt = (s: FloorStats) => `${s.W} x ${s.H}, max ${s.maxRoomCells} cells per room, ${s.walls} walls`;
	const side = MINIMAP_VIEW.maxImageSide;

	it("the M1 fixture seeds (1337, 42, 7)", () => {
		for (const seed of [1337, 42, 7]) {
			const d = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed });
			const s = checkFloor(d, minimapTiles(d), `M1 ${seed}`);
			print(`[minimap] M1 seed ${seed}: ${fmt(s)}`);
			expect(s.W <= side && s.H <= side).toBe(true);
		}
	});

	it("both tutorial floors", () => {
		for (const floor of [ENDLESS_FIRST_FLOOR, TUTORIAL.lastFloor]) {
			const d = tutorialDungeon(floor);
			const s = checkFloor(d, minimapTiles(d), `tutorial ${floor}`);
			print(`[minimap] tutorial floor ${floor}: ${fmt(s)}`);
			expect(s.W <= side && s.H <= side).toBe(true);
		}
	});

	const RUNS = 60;
	const FLOORS = 20;
	it(`endless run seeds 1-${RUNS} x floors 1-${FLOORS}: invariants, W x H <= ${side}, the stairwell on its room`, () => {
		const started = os.clock();
		let floors = 0;
		let maxW = 0;
		let maxH = 0;
		let maxArea = 0;
		let worstArea = "";
		let maxRoom = 0;
		let worstRoom = "";
		for (let r = 1; r <= RUNS; r++)
			for (let floor = 1; floor <= FLOORS; floor++) {
				const d = endlessDungeon(endlessFloorParams(r, floor));
				const label = `endless ${r} / ${floor}`;
				// run 1: through the full floor build, so the stairwell is the layout's own
				const stairwell = r === 1 ? endlessRunFloor(r, floor).layout.stairwell : undefined;
				const t = minimapTiles(d, stairwell);
				const s = checkFloor(d, t, label);
				if (stairwell !== undefined) {
					if (t.stairCell === MAP_NO_CELL || t.tile[t.stairCell] !== MapTile.FLOOR)
						error(`${label}: stairwell cell ${t.stairCell} is not floor`);
					if (t.room[t.stairCell] !== d.boss) error(`${label}: stairwell outside the boss room`);
				}
				floors++;
				maxW = math.max(maxW, s.W);
				maxH = math.max(maxH, s.H);
				if (s.W * s.H > maxArea) {
					maxArea = s.W * s.H;
					worstArea = `${s.W} x ${s.H} (${label})`;
				}
				if (s.maxRoomCells > maxRoom) {
					maxRoom = s.maxRoomCells;
					worstRoom = label;
				}
				if (s.W > side || s.H > side) error(`${label}: ${s.W} x ${s.H} exceeds ${side}`);
			}
		print(
			`[minimap] endless census: ${floors} floors, max W ${maxW}, max H ${maxH}, largest area ${worstArea}, ` +
				`max ${maxRoom} cells per room (${worstRoom}); ${string.format("%.1f", os.clock() - started)} s`,
		);
		expect(floors).toBe(RUNS * FLOORS);
	});
});

// Minimap tiles (docs/MINIMAP.md M1): hand-made dungeons (a rect room, a pillar, a pool, a corridor, two rooms sharing
// a wall, the stairwell cell) and real floors (the three M1 fixture seeds, both tutorial floors): the largest W x H
// (<= MINIMAP_VIEW.maxImageSide per side), the most cells per room, and every FLOOR cell with roomId >= 0 in exactly one
// roomCells list (its own), walls only where they touch floor. The endless census (run seeds 1-60 x floors 1-20) is
// split over tiles.endless.<n>.spec.ts (testing/census.ts), each shard its own process.
import { describe, expect, it } from "@rbxts/jest-globals";
import { TUTORIAL } from "shared/config";
import { ENDLESS_FIRST_FLOOR, KALEB_VALE_MVP_PARAMS, generateDungeon } from "shared/dungeon";
import { tutorialDungeon } from "shared/run";
import { MAP_NO_CELL, MINIMAP_VIEW, MapTile, minimapTiles } from "shared/view";
import { checkMinimapFloor, specDungeon, type MinimapFloorStats } from "./testing";

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
		checkMinimapFloor(d, t, "rect");
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
		checkMinimapFloor(d, t, "pillar");
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
		checkMinimapFloor(d, t, "corridor");
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
		checkMinimapFloor(d, t, "shared wall");
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
	const fmt = (s: MinimapFloorStats) => `${s.W} x ${s.H}, max ${s.maxRoomCells} cells per room, ${s.walls} walls`;
	const side = MINIMAP_VIEW.maxImageSide;

	it("the M1 fixture seeds (1337, 42, 7)", () => {
		for (const seed of [1337, 42, 7]) {
			const d = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed });
			const s = checkMinimapFloor(d, minimapTiles(d), `M1 ${seed}`);
			print(`[minimap] M1 seed ${seed}: ${fmt(s)}`);
			expect(s.W <= side && s.H <= side).toBe(true);
		}
	});

	it("both tutorial floors", () => {
		for (const floor of [ENDLESS_FIRST_FLOOR, TUTORIAL.lastFloor]) {
			const d = tutorialDungeon(floor);
			const s = checkMinimapFloor(d, minimapTiles(d), `tutorial ${floor}`);
			print(`[minimap] tutorial floor ${floor}: ${fmt(s)}`);
			expect(s.W <= side && s.H <= side).toBe(true);
		}
	});
});

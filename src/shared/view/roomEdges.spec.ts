// Room edge geometry (docs/ROOM_EDGES.md RE1): hand-made grids (a rect room's 3-wide corridor mouth, a stepped
// ellipse-like mouth, a corridor along a room's flank, a one-tile corridor between two rooms, a room-to-room contact,
// pools / walls / void next to floor) and real floors (the three M1 fixture seeds, both tutorial floors): trigger parity
// with roomIdAt, completeness (every room-floor / other-floor neighbour pair covered by exactly one run unit), and the
// dash budget per floor. The endless census (run seeds 1-60 x floors 1-20) is split over roomEdges.endless.<n>.spec.ts
// (testing/roomEdgesCensus.ts), each shard its own process.
import { describe, expect, it } from "@rbxts/jest-globals";
import { TUTORIAL } from "shared/config";
import { ENDLESS_FIRST_FLOOR, KALEB_VALE_MVP_PARAMS, TileType, generateDungeon, type Dungeon } from "shared/dungeon";
import { tutorialDungeon } from "shared/run";
import {
	ROOM_EDGE_VIEW,
	roomEdgeInsetTiles,
	roomEdgeLine,
	roomEdges,
	type RoomEdgeRun,
	type RoomEdges,
} from "shared/view";
import { checkRoomEdgesFloor, type RoomEdgesFloorStats } from "./testing";

const LETTERS = "ABCDEFGHIJ";

/**
 * A bare grid from rows (row = grid y = world z, column = grid x = world x): 'A'.. room floor (room 0..), '.' corridor
 * floor, '#' WALL, '~' POOL, anything else VOID. `roomCount` rooms (default: the highest letter used + 1).
 */
function grid(rows: ReadonlyArray<string>, roomCount?: number): Dungeon {
	const H = rows.size();
	const W = rows[0].size();
	const cells: number[] = [];
	const ids: number[] = [];
	let rooms = 0;
	for (const row of rows)
		for (let x = 1; x <= W; x++) {
			const c = string.sub(row, x, x);
			const [room] = string.find(LETTERS, c, 1, true);
			if (room !== undefined) {
				cells.push(TileType.FLOOR);
				ids.push(room - 1);
				rooms = math.max(rooms, room);
			} else {
				cells.push(
					c === "#" ? TileType.WALL : c === "." ? TileType.FLOOR : c === "~" ? TileType.POOL : TileType.VOID,
				);
				ids.push(-1);
			}
		}
	const roomList: object[] = [];
	for (let i = 0; i < (roomCount ?? rooms); i++) roomList.push({});
	return { W, H, grid: cells, roomId: ids, rooms: roomList } as unknown as Dungeon;
}

function run(room: number, x0: number, z0: number, x1: number, z1: number, nx: number, nz: number): RoomEdgeRun {
	return { room, x0, z0, x1, z1, nx, nz };
}

function edgesOf(d: Dungeon, label: string): RoomEdges {
	const e = roomEdges(d);
	checkRoomEdgesFloor(d, e, label);
	return e;
}

describe("roomEdges: hand-made grids", () => {
	it("a rect room and a straight 3-wide corridor: one 3-tile run on the boundary, normal into the corridor", () => {
		// prettier-ignore
		const d = grid([
			"##########",
			"#AAAA#####",
			"#AAAA.....",
			"#AAAA.....",
			"#AAAA.....",
			"#AAAA#####",
			"##########",
		]);
		const e = edgesOf(d, "rect");
		expect(e.runs).toEqual([run(0, 4.5, 1.5, 4.5, 4.5, 1, 0)]);
		expect(e.byRoom).toEqual([[0]]);
		expect(e.unitEdges).toBe(3);
	});

	it("a stepped (ellipse-like) mouth: one run per step, in room / axis / line / start order", () => {
		// prettier-ignore
		const d = grid([
			"#########",
			"#AAAAAAA#",
			"#.AAAAA.#",
			"#..AAA..#",
			"#.......#",
			"#########",
		]);
		const e = edgesOf(d, "stepped");
		expect(e.runs).toEqual([
			// lines of constant x
			run(0, 1.5, 1.5, 1.5, 2.5, -1, 0),
			run(0, 2.5, 2.5, 2.5, 3.5, -1, 0),
			run(0, 5.5, 2.5, 5.5, 3.5, 1, 0),
			run(0, 6.5, 1.5, 6.5, 2.5, 1, 0),
			// lines of constant z
			run(0, 0.5, 1.5, 1.5, 1.5, 0, 1),
			run(0, 6.5, 1.5, 7.5, 1.5, 0, 1),
			run(0, 1.5, 2.5, 2.5, 2.5, 0, 1),
			run(0, 5.5, 2.5, 6.5, 2.5, 0, 1),
			run(0, 2.5, 3.5, 5.5, 3.5, 0, 1),
		]);
		expect(e.unitEdges).toBe(11);
	});

	it("a corridor along a room's flank: one long run", () => {
		// prettier-ignore
		const d = grid([
			"#########",
			"#AAAAAAA#",
			"#AAAAAAA#",
			"#.......#",
			"#########",
		]);
		const e = edgesOf(d, "flank");
		expect(e.runs).toEqual([run(0, 0.5, 2.5, 7.5, 2.5, 0, 1)]);
		expect(e.unitEdges).toBe(7);
	});

	it("a one-tile corridor between two rooms: two runs, one per room, opposite normals", () => {
		// prettier-ignore
		const d = grid([
			"#########",
			"#AAA#BBB#",
			"#AAA.BBB#",
			"#AAA#BBB#",
			"#########",
		]);
		const e = edgesOf(d, "one-tile");
		expect(e.runs).toEqual([run(0, 3.5, 1.5, 3.5, 2.5, 1, 0), run(1, 4.5, 1.5, 4.5, 2.5, -1, 0)]);
		expect(e.byRoom).toEqual([[0], [1]]);
		const line = [0, 0, 0, 0];
		roomEdgeLine(e.runs[1], roomEdgeInsetTiles(), line);
		expect(line).toEqual([4.5 - roomEdgeInsetTiles(), 1.5, 4.5 - roomEdgeInsetTiles(), 2.5]);
		roomEdgeLine(e.runs[0], 0.25, line);
		expect(line).toEqual([3.75, 1.5, 3.75, 2.5]);
	});

	it("a room-to-room contact: one run per room on the same line, each normal out of its own room", () => {
		// prettier-ignore
		const d = grid([
			"########",
			"#AAABBB#",
			"#AAABBB#",
			"########",
		]);
		const e = edgesOf(d, "contact");
		expect(e.runs).toEqual([run(0, 3.5, 0.5, 3.5, 2.5, 1, 0), run(1, 3.5, 0.5, 3.5, 2.5, -1, 0)]);
		expect(checkRoomEdgesFloor(d, e, "contact").contacts).toBe(4);
	});

	it("pools, walls and void next to a room or corridor make no edge; rooms without one get an empty list", () => {
		// prettier-ignore
		const d = grid([
			"#######",
			"#AAA~.#",
			"#AAA#.#",
			"#AAA ..",
			"#######",
		], 3);
		const e = edgesOf(d, "pit");
		expect(e.runs).toEqual([]);
		expect(e.byRoom).toEqual([[], [], []]);
		expect(e.unitEdges).toBe(0);
	});

	it("an out-of-range room id counts as corridor floor, like roomIdAt", () => {
		// prettier-ignore
		const d = grid([
			"#####",
			"#AAB#",
			"#####",
		], 1);
		const e = edgesOf(d, "range");
		expect(e.runs).toEqual([run(0, 2.5, 0.5, 2.5, 1.5, 1, 0)]);
	});
});

describe("roomEdges: real floors", () => {
	const fmt = (s: RoomEdgesFloorStats) => `${s.runs} runs, ${s.unitEdges} unit edges, ${s.dashes} dashes`;

	it("the M1 fixture seeds (1337, 42, 7): the plan's measured runs / unit edges, no room-to-room contact", () => {
		// [seed, runs, unit edges] as measured for docs/ROOM_EDGES.md (M1 layouts are fixture-locked)
		const CASES: ReadonlyArray<[number, number, number]> = [
			[1337, 45, 98],
			[42, 49, 84],
			[7, 61, 95],
		];
		for (const [seed, runs, unitEdges] of CASES) {
			const d = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed });
			const s = checkRoomEdgesFloor(d, roomEdges(d), `M1 ${seed}`);
			print(`[roomEdges] M1 seed ${seed}: ${fmt(s)}, ${s.contacts} room-to-room`);
			expect(s.dashes <= ROOM_EDGE_VIEW.maxDashes).toBe(true);
			expect([s.runs, s.unitEdges, s.contacts]).toEqual([runs, unitEdges, 0]);
		}
	});

	it("both tutorial floors", () => {
		for (const floor of [ENDLESS_FIRST_FLOOR, TUTORIAL.lastFloor]) {
			const d = tutorialDungeon(floor);
			const s = checkRoomEdgesFloor(d, roomEdges(d), `tutorial ${floor}`);
			print(`[roomEdges] tutorial floor ${floor}: ${fmt(s)}, ${s.contacts} room-to-room`);
			expect(s.dashes <= ROOM_EDGE_VIEW.maxDashes).toBe(true);
			expect(s.unitEdges > 0).toBe(true);
		}
	});
});

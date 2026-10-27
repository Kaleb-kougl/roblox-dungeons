// Room edge geometry (docs/ROOM_EDGES.md RE1): hand-made grids (a rect room's 3-wide corridor mouth, a stepped
// ellipse-like mouth, a corridor along a room's flank, a one-tile corridor between two rooms, a room-to-room contact,
// pools / walls / void next to floor) and a census of real floors (the three M1 fixture seeds, endless run seeds
// 1-60 x floors 1-20, both tutorial floors): trigger parity with roomIdAt, completeness (every room-floor /
// other-floor neighbour pair covered by exactly one run unit), and the dash budget per floor.
import { describe, expect, it } from "@rbxts/jest-globals";
import { STUDS_PER_TILE, TUTORIAL } from "shared/config";
import {
	ENDLESS_FIRST_FLOOR,
	KALEB_VALE_MVP_PARAMS,
	TileType,
	endlessFloorParams,
	generateDungeon,
	isBossFloor,
	roomIdAt,
	tileAt,
	worldToGrid,
	type Dungeon,
} from "shared/dungeon";
import { tutorialDungeon } from "shared/run";
import {
	ROOM_EDGE_VIEW,
	dashLayout,
	roomEdgeInsetTiles,
	roomEdgeLine,
	roomEdges,
	type RoomEdgeRun,
	type RoomEdges,
} from "shared/view";

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

const EPS = 0.01;

/** Unit (one tile) count of a run. */
function units(r: RoomEdgeRun): number {
	return math.abs(r.x1 - r.x0) + math.abs(r.z1 - r.z0);
}

interface FloorStats {
	readonly runs: number;
	readonly unitEdges: number;
	readonly dashes: number;
	/** Unit edges where the other side is another room's floor. */
	readonly contacts: number;
}

/**
 * Trigger parity and completeness of `e` on `d` (fails the spec on a miss, naming `label`), and the floor's numbers.
 */
function checkFloor(d: Dungeon, e: RoomEdges, label: string): FloorStats {
	// byRoom: one list per room, indices in order, each run listed under its own room
	expect(e.byRoom.size()).toBe(d.rooms.size());
	let listed = 0;
	for (let r = 0; r < e.byRoom.size(); r++)
		for (const i of e.byRoom[r]) {
			if (e.runs[i].room !== r) error(`${label}: run ${i} listed under room ${r}`);
			if (i !== listed) error(`${label}: byRoom out of order at run ${i}`);
			listed++;
		}
	expect(listed).toBe(e.runs.size());

	const covered = new Map<number, number>();
	let total = 0;
	let dashes = 0;
	const dash = ROOM_EDGE_VIEW.dash;
	for (let i = 0; i < e.runs.size(); i++) {
		const r = e.runs[i];
		const n = units(r);
		const dx = (r.x1 - r.x0) / n;
		const dz = (r.z1 - r.z0) / n;
		if (!(n >= 1 && n % 1 === 0 && math.abs(r.nx) + math.abs(r.nz) === 1 && r.nx * dx + r.nz * dz === 0))
			error(`${label}: run ${i} is not a whole number of tiles across its normal`);
		dashes += dashLayout(n * STUDS_PER_TILE, dash.length, dash.gap).count;
		total += n;
		// the run's midpoint, then every unit's centre
		const probes: Array<[number, number]> = [[(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2]];
		for (let k = 0; k < n; k++) probes.push([r.x0 + dx * (k + 0.5), r.z0 + dz * (k + 0.5)]);
		for (const [px, pz] of probes) {
			const inside = roomIdAt(d, px - r.nx * EPS, pz - r.nz * EPS);
			const outside = roomIdAt(d, px + r.nx * EPS, pz + r.nz * EPS);
			if (inside !== r.room || outside === r.room)
				error(`${label}: run ${i} at (${px}, ${pz}): inside ${inside}, outside ${outside}, room ${r.room}`);
		}
		for (let k = 0; k < n; k++) {
			const gx = worldToGrid(r.x0 + dx * (k + 0.5) - r.nx * 0.5);
			const gy = worldToGrid(r.z0 + dz * (k + 0.5) - r.nz * 0.5);
			const dir = r.nx > 0 ? 0 : r.nx < 0 ? 1 : r.nz > 0 ? 2 : 3;
			const key = (gy * d.W + gx) * 4 + dir;
			covered.set(key, (covered.get(key) ?? 0) + 1);
		}
	}
	expect(total).toBe(e.unitEdges);

	// every room-floor / other-floor neighbour pair, found independently through roomIdAt at cell centres
	const DIRS: ReadonlyArray<[number, number]> = [
		[1, 0],
		[-1, 0],
		[0, 1],
		[0, -1],
	];
	let pairCount = 0;
	let contacts = 0;
	for (let gy = 0; gy < d.H; gy++)
		for (let gx = 0; gx < d.W; gx++) {
			const room = roomIdAt(d, gx, gy);
			if (room < 0) continue;
			for (let dir = 0; dir < 4; dir++) {
				const [ox, oy] = DIRS[dir];
				if (tileAt(d, gx + ox, gy + oy) !== TileType.FLOOR) continue;
				const other = roomIdAt(d, gx + ox, gy + oy);
				if (other === room) continue;
				pairCount++;
				if (other >= 0) contacts++;
				const count = covered.get((gy * d.W + gx) * 4 + dir) ?? 0;
				if (count !== 1) error(`${label}: edge of cell (${gx}, ${gy}) dir ${dir} covered ${count} times`);
			}
		}
	expect(pairCount).toBe(e.unitEdges);
	return { runs: e.runs.size(), unitEdges: e.unitEdges, dashes, contacts };
}

function edgesOf(d: Dungeon, label: string): RoomEdges {
	const e = roomEdges(d);
	checkFloor(d, e, label);
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
		expect(checkFloor(d, e, "contact").contacts).toBe(4);
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
	const fmt = (s: FloorStats) => `${s.runs} runs, ${s.unitEdges} unit edges, ${s.dashes} dashes`;

	it("the M1 fixture seeds (1337, 42, 7): the plan's measured runs / unit edges, no room-to-room contact", () => {
		// [seed, runs, unit edges] as measured for docs/ROOM_EDGES.md (M1 layouts are fixture-locked)
		const CASES: ReadonlyArray<[number, number, number]> = [
			[1337, 45, 98],
			[42, 49, 84],
			[7, 61, 95],
		];
		for (const [seed, runs, unitEdges] of CASES) {
			const d = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed });
			const s = checkFloor(d, roomEdges(d), `M1 ${seed}`);
			print(`[roomEdges] M1 seed ${seed}: ${fmt(s)}, ${s.contacts} room-to-room`);
			expect(s.dashes <= ROOM_EDGE_VIEW.maxDashes).toBe(true);
			expect([s.runs, s.unitEdges, s.contacts]).toEqual([runs, unitEdges, 0]);
		}
	});

	it("both tutorial floors", () => {
		for (const floor of [ENDLESS_FIRST_FLOOR, TUTORIAL.lastFloor]) {
			const d = tutorialDungeon(floor);
			const s = checkFloor(d, roomEdges(d), `tutorial ${floor}`);
			print(`[roomEdges] tutorial floor ${floor}: ${fmt(s)}, ${s.contacts} room-to-room`);
			expect(s.dashes <= ROOM_EDGE_VIEW.maxDashes).toBe(true);
			expect(s.unitEdges > 0).toBe(true);
		}
	});

	const RUNS = 60;
	const FLOORS = 20;
	it(`endless run seeds 1-${RUNS} x floors 1-${FLOORS}: parity, completeness, dashes <= maxDashes`, () => {
		const started = os.clock();
		let floors = 0;
		let bossFloors = 0;
		let maxDashes = 0;
		let maxRuns = 0;
		let maxUnits = 0;
		let worst = "";
		let contactFloors = 0;
		let contacts = 0;
		for (let r = 1; r <= RUNS; r++)
			for (let floor = 1; floor <= FLOORS; floor++) {
				const d = generateDungeon(endlessFloorParams(r, floor));
				const s = checkFloor(d, roomEdges(d), `endless ${r} / ${floor}`);
				floors++;
				if (isBossFloor(floor)) bossFloors++;
				if (s.dashes > maxDashes) {
					maxDashes = s.dashes;
					worst = `run ${r} floor ${floor}`;
				}
				maxRuns = math.max(maxRuns, s.runs);
				maxUnits = math.max(maxUnits, s.unitEdges);
				if (s.contacts > 0) {
					contactFloors++;
					contacts += s.contacts;
				}
				if (s.dashes > ROOM_EDGE_VIEW.maxDashes) error(`endless ${r} / ${floor}: ${s.dashes} dashes`);
			}
		print(
			`[roomEdges] endless census: ${floors} floors (${bossFloors} boss), max ${maxDashes} dashes (${worst}), ` +
				`max ${maxRuns} runs, max ${maxUnits} unit edges; room-to-room contacts on ${contactFloors} floors ` +
				`(${contacts} unit edges); ${string.format("%.1f", os.clock() - started)} s`,
		);
		expect(floors).toBe(RUNS * FLOORS);
	});
});

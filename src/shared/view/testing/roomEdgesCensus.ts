/**
 * The room edges census (docs/ROOM_EDGES.md RE1), shared by roomEdges.spec.ts and its endless shards
 * (roomEdges.endless.<n>.spec.ts): checkRoomEdgesFloor checks one floor's edges (trigger parity with roomIdAt,
 * completeness: every room-floor / other-floor neighbour pair covered by exactly one run unit) and counts its dashes;
 * roomEdgesCensus runs it over endless run seeds x floors 1..ROOM_EDGES_CENSUS.floors. Test support only.
 */
import { STUDS_PER_TILE } from "shared/config";
import {
	TileType,
	endlessFloorParams,
	generateDungeon,
	isBossFloor,
	roomIdAt,
	tileAt,
	worldToGrid,
	type Dungeon,
} from "shared/dungeon";
import { ROOM_EDGE_VIEW, dashLayout, type RoomEdgeRun, type RoomEdges, roomEdges } from "shared/view";

export const ROOM_EDGES_CENSUS = { runs: 60, floors: 20, shards: 4 } as const;

const EPS = 0.01;

/** Unit (one tile) count of a run. */
function units(r: RoomEdgeRun): number {
	return math.abs(r.x1 - r.x0) + math.abs(r.z1 - r.z0);
}

export interface RoomEdgesFloorStats {
	readonly runs: number;
	readonly unitEdges: number;
	readonly dashes: number;
	/** Unit edges where the other side is another room's floor. */
	readonly contacts: number;
}

/**
 * Trigger parity and completeness of `e` on `d` (fails with error() on a miss, naming `label`), and the floor's
 * numbers.
 */
export function checkRoomEdgesFloor(d: Dungeon, e: RoomEdges, label: string): RoomEdgesFloorStats {
	// byRoom: one list per room, indices in order, each run listed under its own room
	if (e.byRoom.size() !== d.rooms.size())
		error(`${label}: ${e.byRoom.size()} room lists for ${d.rooms.size()} rooms`);
	let listed = 0;
	for (let r = 0; r < e.byRoom.size(); r++)
		for (const i of e.byRoom[r]) {
			if (e.runs[i].room !== r) error(`${label}: run ${i} listed under room ${r}`);
			if (i !== listed) error(`${label}: byRoom out of order at run ${i}`);
			listed++;
		}
	if (listed !== e.runs.size()) error(`${label}: ${listed} runs listed of ${e.runs.size()}`);

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
	if (total !== e.unitEdges) error(`${label}: runs hold ${total} unit edges, unitEdges ${e.unitEdges}`);

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
	if (pairCount !== e.unitEdges) error(`${label}: ${pairCount} room-floor edges, unitEdges ${e.unitEdges}`);
	return { runs: e.runs.size(), unitEdges: e.unitEdges, dashes, contacts };
}

export interface RoomEdgesCensus {
	readonly floors: number;
	readonly bossFloors: number;
	readonly maxDashes: number;
	/** Where maxDashes was reached. */
	readonly worst: string;
	readonly maxRuns: number;
	readonly maxUnits: number;
	readonly contactFloors: number;
	readonly contacts: number;
}

/**
 * Every endless floor of run seeds firstRun..lastRun x floors 1..ROOM_EDGES_CENSUS.floors through checkRoomEdgesFloor;
 * fails with error() on a floor past ROOM_EDGE_VIEW.maxDashes.
 */
export function roomEdgesCensus(firstRun: number, lastRun: number): RoomEdgesCensus {
	let floors = 0;
	let bossFloors = 0;
	let maxDashes = 0;
	let maxRuns = 0;
	let maxUnits = 0;
	let worst = "";
	let contactFloors = 0;
	let contacts = 0;
	for (let r = firstRun; r <= lastRun; r++)
		for (let floor = 1; floor <= ROOM_EDGES_CENSUS.floors; floor++) {
			const d = generateDungeon(endlessFloorParams(r, floor));
			const s = checkRoomEdgesFloor(d, roomEdges(d), `endless ${r} / ${floor}`);
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
	return { floors, bossFloors, maxDashes, worst, maxRuns, maxUnits, contactFloors, contacts };
}

/** The census's printed line. */
export function roomEdgesCensusLine(c: RoomEdgesCensus, seconds: number): string {
	return (
		`[roomEdges] endless census: ${c.floors} floors (${c.bossFloors} boss), max ${c.maxDashes} dashes (${c.worst}), ` +
		`max ${c.maxRuns} runs, max ${c.maxUnits} unit edges; room-to-room contacts on ${c.contactFloors} floors ` +
		`(${c.contacts} unit edges); ${string.format("%.1f", seconds)} s`
	);
}

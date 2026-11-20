/**
 * Breakable clutter placement (docs/DECOR.md Phase 2 part 4, decisions B1 / B6, task R11; a Roblox-port feature, no
 * web source): barrels and crates in an endless floor's rooms. A PURE function of the floor, like the rest of
 * ./endless.ts, so live play, every co-op client and the server's replay place the same pieces.
 *
 *   stream   its own: new EncounterRng(breakableSeed(floor seed)) = mulberry32 from (seed ^ BREAKABLE.salt). It runs
 *            after the Forge and never draws from the Forge's (or any room encounter's) stream, so layouts, digests,
 *            props and spawns stay exactly as they are.
 *   rooms    BREAKABLE.roomTypes (combat, elite, treasure), in room id order.
 *   count    per room: rng.int(band.min, band.max) for the floor's depth band (kept / worn / ruined / abyss), x the
 *            room's floor tiles / BREAKABLE.referenceRoomTiles, rounded down, at most BREAKABLE.maxPerRoom.
 *   where    a candidate cell is a FLOOR cell of the room (not corridor, not doorway), at least doorClearTiles from
 *            every doorway cell, spawnClearTiles from every deferred spawn of the floor, entranceClearTiles from the
 *            entrance spawn, stairwellClearTiles from the stairwell, pedestalClearTiles from each treasure room's
 *            pedestal, shrineClearTiles from each shrine room's shrine, and more than poolClearTiles (Chebyshev) from
 *            any POOL cell. A placed piece must also keep
 *              - the gap rule: against every solid (non-FLOOR cell or placed piece) within reach, the two tile squares
 *                either touch (8-neighbours) or leave at least minGapTiles of free space between them; a solid that is
 *                part of the same obstacle (a solid 8-neighbour of both) is exempt (that space is a nook, not a pass);
 *              - reachability: the free cells among its 8 neighbours stay one 4-connected group around it, so every
 *                path through the cell can go round it and no floor cell the floor's BFS reached is cut off. (A local
 *                test that is sufficient for it; the spec checks the full BFS over the census floors.)
 *   shape    combat rooms whose floor spans >= loneMinRoomSide both ways may first get ONE lone mid-room piece
 *            (chance loneChance, on a cell >= loneWallClearTiles from any non-FLOOR cell); the rest are clusters of
 *            clusterMin..clusterMax pieces hugging a wall: a seed cell 4-adjacent to a WALL, then each next piece
 *            4-adjacent to the cluster (preferring cells that hug a wall too). No piece is an 8-neighbour of another
 *            group's (clusters never merge). A room stops after seedTries rejected seed draws.
 *   store    a storeroom (the Forge's room theme "store", docs/DECOR.md "Room themes") gets count x store.countScale
 *            + store.countExtra pieces (at most maxPerRoom), no lone piece, and clusters of store.clusterMin..Max
 *            seeded in its corners first (inCorner: a wall along X and along Z; store.cornerTries rejected corner
 *            seeds, then any wall-hugging cell).
 *   mess     a mess hall (theme "mess", docs/KENNEY_DECOR.md KN7) gets count x mess.countScale pieces, rounded down
 *            (at most maxPerRoom); otherwise as any room.
 *   kind     one draw per piece: crate with crateShare, else barrel.
 *
 * Output order is placement order (rooms by id). Tile coordinates (grid x, y; world x = x, z = y).
 *
 * @module
 */
import { u32 } from "shared/jsmath";
import { TileType, type Dungeon } from "./forge";
import { gridToWorld, tileAt, worldToGrid, type WorldXZ } from "./collision";
import { EncounterRng, type TileXZ } from "./encounter";
import type { ActorSpawn, EncounterConfig, EncounterRoom } from "./encounterTypes";
import {
	BREAKABLE,
	BREAKABLE_KINDS,
	type BreakableBand,
	type BreakableKindName,
	type BreakablePieceKindName,
} from "./breakablesData";

/**
 * One placed piece: tile coordinates and kind. placeBreakables only lays the clutter kinds (BREAKABLE_KINDS); a vault
 * floor's list ends with its chest (kind `chest`, ./vault.ts).
 */
export interface BreakablePlacement {
	readonly x: number;
	readonly y: number;
	readonly kind: BreakablePieceKindName;
}

/** What placement reads of a built floor (EndlessFloorLayout has all of it). */
export interface BreakableFloorInput {
	/** The floor seed (floorSeed(runSeed, floor)). */
	readonly seed: number;
	readonly dungeon: Dungeon;
	readonly encounter: EncounterConfig;
	/** Deferred enemies per room id. */
	readonly roomSpawns: ReadonlyArray<ReadonlyArray<ActorSpawn>>;
	/** The entrance spawn and the stairwell (world). */
	readonly spawn: WorldXZ;
	readonly stairwell: WorldXZ;
}

/** Seed of the placement stream: the floor seed with BREAKABLE.salt mixed in (uint32). */
export function breakableSeed(floorSeed: number): number {
	return bit32.bxor(u32(floorSeed), BREAKABLE.salt);
}

/** The depth band of `floor` (the last band whose fromFloor <= floor). */
export function breakableBand(floor: number): BreakableBand {
	const bands = BREAKABLE.bands;
	let out = bands[0];
	for (const b of bands) if (floor >= b.fromFloor) out = b;
	return out;
}

/** Pieces a room of `floorTiles` gets for the band draw `draw` (before placement can fall short). */
export function breakableRoomCount(draw: number, floorTiles: number): number {
	return math.min(BREAKABLE.maxPerRoom, math.floor((draw * floorTiles) / BREAKABLE.referenceRoomTiles));
}

const DIRS4: ReadonlyArray<readonly [number, number]> = [
	[1, 0],
	[-1, 0],
	[0, 1],
	[0, -1],
];
/** The 8 neighbours in ring order (each 4-adjacent to the next, wrapping): the reachability test walks it. */
const RING: ReadonlyArray<readonly [number, number]> = [
	[-1, -1],
	[0, -1],
	[1, -1],
	[1, 0],
	[1, 1],
	[0, 1],
	[-1, 1],
	[-1, 0],
];

function dist2(ax: number, az: number, bx: number, bz: number): number {
	const dx = ax - bx;
	const dz = az - bz;
	return dx * dx + dz * dz;
}

/** Placement state of one floor: the dungeon plus the pieces placed so far. */
class Placer {
	/** cell index -> group id (a cluster, or the lone piece) of every placed piece. */
	readonly taken = new Map<number, number>();
	/** Id of the next group. */
	nextGroup = 1;
	readonly out: BreakablePlacement[] = [];

	constructor(readonly d: Dungeon, readonly rng: EncounterRng) {}

	/** A solid: off the grid, any non-FLOOR tile, or a placed piece. */
	solid(gx: number, gy: number): boolean {
		if (tileAt(this.d, gx, gy) !== TileType.FLOOR) return true;
		return this.taken.has(gy * this.d.W + gx);
	}

	/** The gap rule (file comment) for a piece at (gx, gy). */
	gapOk(gx: number, gy: number): boolean {
		const minGap = BREAKABLE.minGapTiles;
		const reach = math.ceil(minGap);
		for (let oy = -reach; oy <= reach; oy++)
			for (let ox = -reach; ox <= reach; ox++) {
				const ax = math.abs(ox);
				const ay = math.abs(oy);
				if (ax <= 1 && ay <= 1) continue; // touching (or the cell itself)
				const sx = gx + ox;
				const sy = gy + oy;
				if (!this.solid(sx, sy)) continue;
				const gapX = ax - 1;
				const gapY = ay - 1;
				const gx2 = gapX > 0 ? gapX * gapX : 0;
				const gy2 = gapY > 0 ? gapY * gapY : 0;
				if (gx2 + gy2 >= minGap * minGap) continue;
				if (!this.sameObstacle(gx, gy, sx, sy)) return false;
			}
		return true;
	}

	/** Some solid cell is an 8-neighbour of both (gx, gy) and (sx, sy). */
	private sameObstacle(gx: number, gy: number, sx: number, sy: number): boolean {
		for (const [ox, oy] of RING) {
			const tx = gx + ox;
			const ty = gy + oy;
			if (math.abs(tx - sx) <= 1 && math.abs(ty - sy) <= 1 && this.solid(tx, ty)) return true;
		}
		return false;
	}

	/**
	 * The reachability test (file comment). RING lists the 8 neighbours so that consecutive entries (wrapping) are
	 * 4-adjacent; a path through the cell enters and leaves by its free 4-neighbours (the ring's edge cells), so it can
	 * go round the cell when every free edge cell lies on ONE run of consecutive free ring cells. A run of a lone free
	 * corner is ignored (no 4-path reaches the cell's centre through it).
	 */
	ringOk(gx: number, gy: number): boolean {
		const n = RING.size();
		const free: boolean[] = [];
		let freeCount = 0;
		for (const [ox, oy] of RING) {
			const f = !this.solid(gx + ox, gy + oy);
			free.push(f);
			if (f) freeCount++;
		}
		if (freeCount === n) return true;
		let edgeRuns = 0;
		for (let i = 0; i < n; i++) {
			if (!free[i] || free[(i + n - 1) % n]) continue; // not the start of a run
			let hasEdge = false;
			let k = i;
			while (free[k]) {
				const [ox, oy] = RING[k];
				if (ox === 0 || oy === 0) hasEdge = true;
				k = (k + 1) % n;
			}
			if (hasEdge) edgeRuns++;
		}
		return edgeRuns === 1;
	}

	/** A piece of another group than `group` is an 8-neighbour (groups never merge into one bigger clump). */
	touchesOtherGroup(gx: number, gy: number, group: number): boolean {
		for (const [ox, oy] of RING) {
			const g = this.taken.get((gy + oy) * this.d.W + gx + ox);
			if (g !== undefined && g !== group && tileAt(this.d, gx + ox, gy + oy) === TileType.FLOOR) return true;
		}
		return false;
	}

	/** Every rule a piece of `group` at (gx, gy) must keep (file comment). */
	valid(gx: number, gy: number, group: number): boolean {
		return (
			!this.solid(gx, gy) && !this.touchesOtherGroup(gx, gy, group) && this.gapOk(gx, gy) && this.ringOk(gx, gy)
		);
	}

	place(gx: number, gy: number, group: number): void {
		this.taken.set(gy * this.d.W + gx, group);
		const kind: BreakableKindName =
			this.rng.next() < BREAKABLE.crateShare ? BREAKABLE_KINDS[1] : BREAKABLE_KINDS[0];
		this.out.push({ x: gx, y: gy, kind });
	}

	hugsWall(gx: number, gy: number): boolean {
		for (const [ox, oy] of DIRS4) if (tileAt(this.d, gx + ox, gy + oy) === TileType.WALL) return true;
		return false;
	}

	/** A WALL on one side along X and one along Z (a room corner, or beside a set piece's corner). */
	inCorner(gx: number, gy: number): boolean {
		const wall = (x: number, y: number) => tileAt(this.d, x, y) === TileType.WALL;
		return (wall(gx + 1, gy) || wall(gx - 1, gy)) && (wall(gx, gy + 1) || wall(gx, gy - 1));
	}

	/** No non-FLOOR cell within Chebyshev distance `r`. */
	clearOfWalls(gx: number, gy: number, r: number): boolean {
		for (let oy = -r; oy <= r; oy++)
			for (let ox = -r; ox <= r; ox++) if (tileAt(this.d, gx + ox, gy + oy) !== TileType.FLOOR) return false;
		return true;
	}

	nearPool(gx: number, gy: number): boolean {
		const r = BREAKABLE.poolClearTiles;
		for (let oy = -r; oy <= r; oy++)
			for (let ox = -r; ox <= r; ox++) if (tileAt(this.d, gx + ox, gy + oy) === TileType.POOL) return true;
		return false;
	}
}

/** A point to keep clear (world) and its radius. */
interface Zone {
	readonly x: number;
	readonly z: number;
	readonly r: number;
}

/**
 * The zones every piece of the floor keeps clear of (file comment, "where"), doorways and the deferred room spawns
 * excluded (those stand in their own room: candidatesOf checks them per room).
 */
function floorZones(input: BreakableFloorInput): Zone[] {
	const zones: Zone[] = [];
	for (const s of input.encounter.spawns) zones.push({ x: s.x, z: s.z, r: BREAKABLE.spawnClearTiles });
	zones.push({ x: input.spawn.x, z: input.spawn.z, r: BREAKABLE.entranceClearTiles });
	zones.push({ x: input.stairwell.x, z: input.stairwell.z, r: BREAKABLE.stairwellClearTiles });
	for (const room of input.encounter.rooms) {
		if (room.type === "treasure") zones.push({ x: room.cx, z: room.cz, r: BREAKABLE.pedestalClearTiles });
		else if (room.type === "shrine") zones.push({ x: room.cx, z: room.cz, r: BREAKABLE.shrineClearTiles });
	}
	return zones;
}

/** Doorway cells per room id (a doorway cell 4-adjacent to the room's cells), grid coordinates. One grid pass. */
function doorwaysByRoom(d: Dungeon): TileXZ[][] {
	const out: TileXZ[][] = [];
	for (let i = 0; i < d.rooms.size(); i++) out.push([]);
	for (let gy = 0; gy < d.H; gy++)
		for (let gx = 0; gx < d.W; gx++) {
			if (d.doorway[gy * d.W + gx] === 0) continue;
			let last = -1;
			for (const [ox, oy] of DIRS4) {
				const nx = gx + ox;
				const ny = gy + oy;
				if (nx < 0 || ny < 0 || nx >= d.W || ny >= d.H) continue;
				const id = d.roomId[ny * d.W + nx];
				if (id < 0 || id >= out.size() || id === last) continue;
				if (out[id].size() > 0) {
					const t = out[id][out[id].size() - 1];
					if (t.x === gx && t.z === gy) continue;
				}
				out[id].push({ x: gx, z: gy });
				last = id;
			}
		}
	return out;
}

/** Everything placement precomputes per floor. */
interface FloorPrep {
	readonly zones: ReadonlyArray<Zone>;
	readonly doors: ReadonlyArray<ReadonlyArray<TileXZ>>;
}

function prepFloor(input: BreakableFloorInput): FloorPrep {
	return { zones: floorZones(input), doors: doorwaysByRoom(input.dungeon) };
}

/**
 * The static candidate cells of `room` (row order): every rule of the file comment's "where" that does not depend on
 * the pieces placed so far.
 */
export function breakableCandidates(input: BreakableFloorInput, room: EncounterRoom): TileXZ[] {
	return candidatesOf(input, room, prepFloor(input));
}

/** breakableCandidates for many rooms of one floor: the floor's zones and doorways are computed once. Pure. */
export function breakableCandidateFinder(input: BreakableFloorInput): (room: EncounterRoom) => TileXZ[] {
	const prep = prepFloor(input);
	return (room) => candidatesOf(input, room, prep);
}

function candidatesOf(input: BreakableFloorInput, room: EncounterRoom, prep: FloorPrep): TileXZ[] {
	const d = input.dungeon;
	const z: Zone[] = [...prep.zones];
	// every deferred spawn of the floor that could reach the room: its own, and a touching room's (two rooms may share
	// open floor with no wall between them)
	const sr = BREAKABLE.spawnClearTiles;
	for (let rid = 0; rid < input.roomSpawns.size(); rid++)
		for (const sp of input.roomSpawns[rid] ?? [])
			if (sp.x >= room.minX - sr && sp.x <= room.maxX + sr && sp.z >= room.minZ - sr && sp.z <= room.maxZ + sr)
				z.push({ x: sp.x, z: sp.z, r: sr });
	const doors = prep.doors[room.id] ?? [];
	const door2 = BREAKABLE.doorClearTiles * BREAKABLE.doorClearTiles;
	const probe = new Placer(d, new EncounterRng(0));
	const out: TileXZ[] = [];
	const gx0 = worldToGrid(room.minX);
	const gx1 = worldToGrid(room.maxX);
	const gy0 = worldToGrid(room.minZ);
	const gy1 = worldToGrid(room.maxZ);
	for (let gy = gy0; gy <= gy1; gy++)
		for (let gx = gx0; gx <= gx1; gx++) {
			if (tileAt(d, gx, gy) !== TileType.FLOOR) continue;
			const i = gy * d.W + gx;
			if (d.roomId[i] !== room.id || d.corridor[i] !== 0 || d.doorway[i] !== 0) continue;
			const wx = gridToWorld(gx);
			const wz = gridToWorld(gy);
			let ok = true;
			for (const door of doors) {
				if (dist2(wx, wz, gridToWorld(door.x), gridToWorld(door.z)) < door2) {
					ok = false;
					break;
				}
			}
			if (!ok) continue;
			for (const zone of z) {
				if (dist2(wx, wz, zone.x, zone.z) < zone.r * zone.r) {
					ok = false;
					break;
				}
			}
			if (!ok || probe.nearPool(gx, gy)) continue;
			out.push({ x: gx, z: gy });
		}
	return out;
}

function isPlacedRoom(room: EncounterRoom): boolean {
	return BREAKABLE.roomTypes.includes(room.type);
}

/** Picks a cell of `cells` with one rng draw (undefined when empty: no draw). */
function pick(rng: EncounterRng, cells: ReadonlyArray<TileXZ>): TileXZ | undefined {
	if (cells.size() === 0) return undefined;
	return cells[math.floor(rng.next() * cells.size())];
}

function placeRoom(p: Placer, input: BreakableFloorInput, room: EncounterRoom, floor: number, prep: FloorPrep): void {
	const rng = p.rng;
	const band = breakableBand(floor);
	const S = BREAKABLE.store;
	const theme = (input.dungeon.roomThemes ?? [])[room.id];
	const store = theme === "store";
	const drawn = breakableRoomCount(rng.int(band.min, band.max), room.floorTiles);
	const count = store
		? math.min(BREAKABLE.maxPerRoom, drawn * S.countScale + S.countExtra)
		: theme === "mess"
		? math.min(BREAKABLE.maxPerRoom, math.floor(drawn * BREAKABLE.mess.countScale))
		: drawn;
	if (count <= 0) return;
	const cands = candidatesOf(input, room, prep);
	if (cands.size() === 0) return;
	const W = p.d.W;
	const isCand = new Map<number, number>();
	for (const c of cands) isCand.set(c.z * W + c.x, 1);
	let placed = 0;
	let failures = 0;

	// The one optional lone mid-room piece (combat rooms that are large enough both ways).
	const sideX = room.maxX - room.minX;
	const sideZ = room.maxZ - room.minZ;
	if (!store && room.type === "combat" && sideX >= BREAKABLE.loneMinRoomSide && sideZ >= BREAKABLE.loneMinRoomSide) {
		if (rng.next() < BREAKABLE.loneChance) {
			const mids = cands.filter((c) => p.clearOfWalls(c.x, c.z, BREAKABLE.loneWallClearTiles));
			const group = p.nextGroup++;
			while (failures < BREAKABLE.seedTries) {
				const c = pick(rng, mids);
				if (c === undefined) break;
				if (p.valid(c.x, c.z, group)) {
					p.place(c.x, c.z, group);
					placed++;
					break;
				}
				failures++;
			}
		}
	}

	// Wall clusters (a storeroom's from its corners first).
	const hugs = cands.filter((c) => p.hugsWall(c.x, c.z));
	const corners = store ? cands.filter((c) => p.inCorner(c.x, c.z)) : [];
	let cornerFails = 0;
	while (placed < count && failures < BREAKABLE.seedTries) {
		const fromCorner = store && cornerFails < S.cornerTries && corners.size() > 0;
		const seedCell = pick(rng, fromCorner ? corners : hugs);
		if (seedCell === undefined) break;
		const group = p.nextGroup;
		if (!p.valid(seedCell.x, seedCell.z, group)) {
			if (fromCorner) cornerFails++;
			else failures++;
			continue;
		}
		p.nextGroup++;
		const left = count - placed;
		const want = math.min(
			store ? rng.int(S.clusterMin, S.clusterMax) : rng.int(BREAKABLE.clusterMin, BREAKABLE.clusterMax),
			left,
		);
		const members: TileXZ[] = [seedCell];
		p.place(seedCell.x, seedCell.z, group);
		placed++;
		while (members.size() < want) {
			const wallSide: TileXZ[] = [];
			const other: TileXZ[] = [];
			const seen = new Map<number, number>();
			for (const m of members)
				for (const [ox, oy] of DIRS4) {
					const nx = m.x + ox;
					const ny = m.z + oy;
					const key = ny * W + nx;
					if (seen.has(key) || !isCand.has(key)) continue;
					seen.set(key, 1);
					if (!p.valid(nx, ny, group)) continue;
					if (p.hugsWall(nx, ny)) wallSide.push({ x: nx, z: ny });
					else other.push({ x: nx, z: ny });
				}
			const grow = pick(rng, wallSide.size() > 0 ? wallSide : other);
			if (grow === undefined) break;
			p.place(grow.x, grow.z, group);
			members.push(grow);
			placed++;
		}
	}
}

/**
 * Every breakable piece of a built endless floor (see the file comment). Pure and deterministic: the same floor always
 * gets the same pieces, in the same order.
 */
export function placeBreakables(input: BreakableFloorInput, floor: number): BreakablePlacement[] {
	const p = new Placer(input.dungeon, new EncounterRng(breakableSeed(input.seed)));
	const prep = prepFloor(input);
	for (const room of input.encounter.rooms) {
		if (!isPlacedRoom(room) || room.id === input.dungeon.entrance || room.id === input.dungeon.boss) continue;
		placeRoom(p, input, room, floor, prep);
	}
	return p.out;
}

/**
 * True when one more piece at grid (gx, gy) keeps every placement rule against the floor's `pieces` (the file comment's
 * gap rule and reachability test, on a FLOOR cell no piece stands on, not an 8-neighbour of any piece): what a piece
 * appended after placeBreakables (a vault's chest, ./vault.ts) must pass. The static "where" rules are
 * breakableCandidates'. Pure; draws nothing.
 */
export function pieceFitsAt(d: Dungeon, pieces: ReadonlyArray<BreakablePlacement>, gx: number, gy: number): boolean {
	return pieceFitter(d, pieces)(gx, gy);
}

/** pieceFitsAt for many cells of one floor: the pieces are indexed once. Pure; draws nothing. */
export function pieceFitter(
	d: Dungeon,
	pieces: ReadonlyArray<BreakablePlacement>,
): (gx: number, gy: number) => boolean {
	const p = new Placer(d, new EncounterRng(0));
	for (const b of pieces) p.taken.set(b.y * d.W + b.x, p.nextGroup++);
	const group = p.nextGroup;
	return (gx, gy) => p.valid(gx, gy, group);
}

/**
 * `tiles` per room without the cells a piece stands on (world tile centers; the order of what is left is kept), so a
 * spawn moved by the sim's safe-spawn rule never lands inside a piece.
 */
export function withoutBreakableCells(
	tiles: ReadonlyArray<ReadonlyArray<TileXZ>>,
	pieces: ReadonlyArray<BreakablePlacement>,
): TileXZ[][] {
	const taken = new Set<string>();
	for (const b of pieces) taken.add(`${gridToWorld(b.x)},${gridToWorld(b.y)}`);
	const out: TileXZ[][] = [];
	for (const room of tiles) out.push(room.filter((t) => !taken.has(`${t.x},${t.z}`)));
	return out;
}

/**
 * The Goldling's floor roll and its flee field (docs/FORTUNE.md GE1, Design §1 golden half, decisions FD10 / FD13;
 * docs/GOLDLING_RUMOURS.md GR1, RD10 / RD11 / RD15: its own barrel or crate; a Roblox-port feature, no web source). The
 * roll is decided when the floor is built, a PURE function of the floor like the rest of ./endless.ts, so live play,
 * every co-op client, the server's replay and a daily seed agree on it.
 *
 *   stream   its own: new EncounterRng(goldenSeed(floor seed)) = mulberry32 from (seed ^ GOLDEN_PLACE.salt), run LAST in
 *            the floor build (after the vault and the pact altars); it only reads the layout, the room spawns, the
 *            entrance, the stairwell, the floor's pieces so far (the vault's chest included), the pellets and the vault,
 *            so the layout, digest, props, spawns, every other piece and its slot, affixes, loot, pellets, the vault,
 *            the altars and the boss pick never move.
 *   chance   floors below GOLDEN_PLACE.fromFloor draw nothing. From it, ONE draw rng.int(0, percentRange - 1) <
 *            goldenChancePercent(floor) (the depth band's percent, FD13).
 *   rooms    eligible (goldenRooms, id order): goldenRoomOpen (a combat / elite room, roomWeights, with planned spawns
 *            and at least minRoomTiles FLOOR cells of its own, never the boss room) AND at least one piece cell
 *            (goldenPieceCells), tested before the room draw like the vault's chest cells, so a picked room always holds
 *            its piece. None eligible: no Goldling and no more draws.
 *   room     ONE draw rng.int(0, total weight - 1) walks the eligible list by weight.
 *   cell     ONE draw rng.int(0, cells - 1) over the room's piece cells in row order. A piece cell is a
 *            breakableCandidates cell of the room (the clutter's static rules: doorways, spawns, entrance, stairwell,
 *            pedestal, shrine, pools) that passes pieceFitter against every piece so far, the vault's chest included
 *            (the gap rule and the ring reachability test, off every piece and its 8 neighbours), is no pellet's cell,
 *            and is outside the vault chest's front box (the chest's cell row and the VAULT.wallClearTiles rows in front
 *            of it, VAULT.sideClearTiles cells to each side: the cells the vault kept FLOOR and free of pieces, so the
 *            chest stays reachable and its boosts land on open floor).
 *   kind     ONE draw rng.next() < BREAKABLE.crateShare: a crate, else a barrel (the clutter's own kind rule).
 *   draws    0 below fromFloor; 1 on a miss or with no eligible room; 4 on a hit (chance, room, cell, kind).
 *   certain  (GoldenForce, docs/FLOOR_MODIFIERS.md FM2: the Gilded floor) the chance draw is still made and its result
 *            ignored, so the room draw is the very draw a natural hit makes: a forced floor whose natural roll hit gets
 *            the natural Goldling (its piece included). Absent: the floor exactly as before.
 *
 * Output: FloorGolden (EndlessFloorLayout / EndlessFloorWorld.golden): the room, what the sim needs to keep the Goldling
 * inside it without a Dungeon (the room's floor rectangle, roomGridRect, and a walk mask over it: 1 = a FLOOR cell of
 * THAT room; pillars, solid decor, pits, walls, corridors and other rooms' cells are 0), and its piece: the cell, the
 * kind and `piece`, the slot it takes when buildEndlessFloor appends it (goldenPiece) after every other piece (the
 * clutter, then the vault's chest), before the room spawn tiles are computed (only they lose its cell). Loot is
 * assigned before it exists, so the piece never holds a boost (RD15).
 *
 * The flee field (fleeField, docs/FORTUNE.md "Moves"): allocation-free over a box of w x h cells, given the open mask
 * (the walk mask minus the intact breakables' cells, built by the caller), the source cells (living players' cells) and
 * reusable scratch:
 *   1. a 4-neighbour multi-source BFS from the sources over open cells: D (steps to the nearest player)
 *   2. seeds S = -factor x D (GOLDEN_FLEE.factor 1.2) on every reached cell
 *   3. the re-relax: out = min over reached cells s of (S[s] + steps from s), an exact unit-step Dijkstra (seeds taken in
 *      ascending order, merged with a FIFO of relaxed values). Without it the far corner is the lowest cell and a
 *      chased Goldling walks into it; with it, running past the player to the far side beats the corner.
 * Walking it downhill (fleeStep) moves away from the players along the room. Unreached open cells (no source in their
 * component) and closed cells are math.huge, so a Goldling with no player in its room stands still.
 */
import { u32 } from "shared/jsmath";
import type { Dungeon } from "./forge";
import { TileType } from "./forge";
import { cellKey, tileAt, worldToGrid } from "./collision";
import { EncounterRng, type TileXZ } from "./encounter";
import type { EncounterRoom } from "./encounterTypes";
import { roomGridRect, type FloorPellets } from "./pellets";
import { breakableCandidateFinder, pieceFitter, type BreakableFloorInput, type BreakablePlacement } from "./breakables";
import { BREAKABLE, BREAKABLE_KINDS, type BreakableKindName } from "./breakablesData";
import { vaultFrontCells, type VaultPlan } from "./vault";
import { GOLDEN_FLEE, GOLDEN_PLACE } from "./goldenData";

/** A room's floor rectangle and walk mask (goldenRoomMask): FloorGolden without its piece. Never mutated. */
export interface GoldenRoomMask {
	/** Encounter room id. */
	readonly room: number;
	/** The room's floor rectangle (roomGridRect): grid x0 .. x0 + w - 1 by y0 .. y0 + h - 1. */
	readonly x0: number;
	readonly y0: number;
	readonly w: number;
	readonly h: number;
	/** Per box cell, row-major ((gy - y0) * w + (gx - x0)): 1 for a FLOOR cell of the room, else 0. */
	readonly walk: ReadonlyArray<number>;
}

/** The Goldling's room on a floor and its hiding place (EndlessFloorLayout / EndlessFloorWorld.golden). Never mutated. */
export interface FloorGolden extends GoldenRoomMask {
	/**
	 * Its piece's slot in the floor's breakables (EndlessFloorLayout.breakables[piece]): the last one, after the clutter
	 * and the vault's chest (= the number of pieces before it).
	 */
	readonly piece: number;
	/** The piece's cell (grid; world centre gridToWorld(pieceX), gridToWorld(pieceY)), inside the walk mask. */
	readonly pieceX: number;
	readonly pieceY: number;
	/** A barrel or a crate (never a chest). */
	readonly pieceKind: BreakableKindName;
}

/** What placeGolden reads of a built floor: the clutter's input plus everything placed before it. */
export interface GoldenFloorInput extends BreakableFloorInput {
	/** Every piece of the floor so far, in slot order: the clutter, then the vault's chest when there is one. */
	readonly pieces: ReadonlyArray<BreakablePlacement>;
	/** The floor's pellets (the piece never stands on one). Absent: none. */
	readonly pellets?: FloorPellets;
	/** The floor's vault (the piece keeps out of its chest's front box). Absent: none. */
	readonly vault?: VaultPlan;
}

/** An eligible Goldling room and its piece cells (goldenPieceCells order). */
export interface GoldenRoom {
	readonly room: EncounterRoom;
	readonly cells: ReadonlyArray<TileXZ>;
}

/** Seed of the Goldling's floor stream: the floor seed with GOLDEN_PLACE.salt mixed in (uint32). */
export function goldenSeed(floorSeed: number): number {
	return bit32.bxor(u32(floorSeed), GOLDEN_PLACE.salt);
}

/** The per-floor chance (percent) on `floor`: 0 below fromFloor, else its depth band's (FD13). */
export function goldenChancePercent(floor: number): number {
	if (floor < GOLDEN_PLACE.fromFloor) return 0;
	let percent = 0;
	for (const b of GOLDEN_PLACE.bands) if (floor >= b.fromFloor) percent = b.chancePercent;
	return percent;
}

/** The weight of room type `roomType` in the room pick (0: never). */
export function goldenRoomWeight(roomType: string): number {
	for (const w of GOLDEN_PLACE.roomWeights) if (w.type === roomType) return w.weight;
	return 0;
}

/**
 * `room` may hold the floor's Goldling before its piece cells are looked at: a weighted type (combat / elite), planned
 * spawns, at least minRoomTiles FLOOR cells of its own, never the boss room (the Dungeon's or the encounter's). Pure.
 */
export function goldenRoomOpen(input: BreakableFloorInput, room: EncounterRoom): boolean {
	const d = input.dungeon;
	if (room.id === d.boss || room.id === input.encounter.bossRoom) return false;
	if (goldenRoomWeight(room.type) <= 0 || room.floorTiles < GOLDEN_PLACE.minRoomTiles) return false;
	const spawns = input.roomSpawns[room.id];
	return spawns !== undefined && spawns.size() > 0;
}

/** What the piece cell rules read once per floor. */
interface PiecePrep {
	readonly fits: (gx: number, gy: number) => boolean;
	readonly candidates: (room: EncounterRoom) => ReadonlyArray<TileXZ>;
	readonly pelletCells: ReadonlySet<number>;
	readonly chestFront: ReadonlySet<number>;
}

/** The vault chest's front box (file comment, "cell"): cellKeys, empty without a vault (./vault.ts vaultFrontCells). */
function chestFrontCells(vault: VaultPlan | undefined): Set<number> {
	return vault === undefined ? new Set<number>() : vaultFrontCells(vault);
}

function prepPiece(input: GoldenFloorInput): PiecePrep {
	const pelletCells = new Set<number>();
	for (const t of input.pellets?.tiles ?? []) pelletCells.add(cellKey(worldToGrid(t.x), worldToGrid(t.z)));
	return {
		fits: pieceFitter(input.dungeon, input.pieces),
		candidates: breakableCandidateFinder(input),
		pelletCells,
		chestFront: chestFrontCells(input.vault),
	};
}

function pieceCellsOf(room: EncounterRoom, prep: PiecePrep): TileXZ[] {
	const out: TileXZ[] = [];
	for (const c of prep.candidates(room)) {
		const key = cellKey(c.x, c.z);
		if (prep.pelletCells.has(key) || prep.chestFront.has(key)) continue;
		if (!prep.fits(c.x, c.z)) continue;
		out.push(c);
	}
	return out;
}

/**
 * The cells of `room` the Goldling's piece may stand on (the file comment's "cell"), row order, grid coordinates. Empty
 * for a room goldenRoomOpen refuses. Pure; draws nothing.
 */
export function goldenPieceCells(input: GoldenFloorInput, room: EncounterRoom): TileXZ[] {
	if (!goldenRoomOpen(input, room)) return [];
	return pieceCellsOf(room, prepPiece(input));
}

/** Every eligible Goldling room of the floor (open with at least one piece cell), room id order. Pure; no draw. */
export function goldenRooms(input: GoldenFloorInput): GoldenRoom[] {
	const prep = prepPiece(input);
	const out: GoldenRoom[] = [];
	for (const room of input.encounter.rooms) {
		if (!goldenRoomOpen(input, room)) continue;
		const cells = pieceCellsOf(room, prep);
		if (cells.size() > 0) out.push({ room, cells });
	}
	return out;
}

/** The rooms a Goldling can hide in on a built floor (goldenRooms' rooms), in id order. Pure; no draw. */
export function goldenEligibleRooms(input: GoldenFloorInput): EncounterRoom[] {
	return goldenRooms(input).map((r) => r.room);
}

/** `room`'s floor rectangle and walk mask (see GoldenRoomMask). Pure. */
export function goldenRoomMask(d: Dungeon, room: Readonly<EncounterRoom>): GoldenRoomMask {
	const [x0, y0, x1, y1] = roomGridRect(room);
	const w = x1 - x0 + 1;
	const h = y1 - y0 + 1;
	const walk: number[] = [];
	for (let ly = 0; ly < h; ly++)
		for (let lx = 0; lx < w; lx++) {
			const gx = x0 + lx;
			const gy = y0 + ly;
			const own = tileAt(d, gx, gy) === TileType.FLOOR && d.roomId[gy * d.W + gx] === room.id;
			walk.push(own ? 1 : 0);
		}
	return { room: room.id, x0, y0, w, h, walk };
}

/** placeGolden's force flag (docs/FLOOR_MODIFIERS.md FM2). Absent or empty: the natural roll. */
export interface GoldenForce {
	/** The chance draw always hits (it is still made: the room draw stays the natural hit's). Gilded floors. */
	readonly certain?: boolean;
}

/**
 * The Goldling of the built endless floor `input` (floor `floor`), or undefined: see the file comment. Pure and
 * deterministic: the same floor always gets the same answer. `force.certain`: the Gilded floor (file comment).
 */
export function placeGolden(input: GoldenFloorInput, floor: number, force?: GoldenForce): FloorGolden | undefined {
	if (floor < GOLDEN_PLACE.fromFloor) return undefined;
	const rng = new EncounterRng(goldenSeed(input.seed));
	const hit = rng.int(0, GOLDEN_PLACE.percentRange - 1) < goldenChancePercent(floor);
	if (!hit && force?.certain !== true) return undefined;
	const rooms = goldenRooms(input);
	if (rooms.size() === 0) return undefined;
	let total = 0;
	for (const r of rooms) total += goldenRoomWeight(r.room.type);
	let roll = rng.int(0, total - 1);
	let pick = rooms[rooms.size() - 1]; // replaced below: the roll is below the total
	for (const r of rooms) {
		const w = goldenRoomWeight(r.room.type);
		if (roll < w) {
			pick = r;
			break;
		}
		roll -= w;
	}
	const cell = pick.cells[rng.int(0, pick.cells.size() - 1)];
	const pieceKind: BreakableKindName = rng.next() < BREAKABLE.crateShare ? BREAKABLE_KINDS[1] : BREAKABLE_KINDS[0];
	const mask = goldenRoomMask(input.dungeon, pick.room);
	return {
		room: mask.room,
		x0: mask.x0,
		y0: mask.y0,
		w: mask.w,
		h: mask.h,
		walk: mask.walk,
		piece: input.pieces.size(),
		pieceX: cell.x,
		pieceY: cell.z,
		pieceKind,
	};
}

/** The Goldling's piece of `g` (appended to the floor's breakables at g.piece, after every other piece). */
export function goldenPiece(g: FloorGolden): BreakablePlacement {
	return { x: g.pieceX, y: g.pieceY, kind: g.pieceKind };
}

// ---------------------------------------------------------------------------------------------
// The flee field

/** Reusable buffers of fleeField for a box of up to `cells` cells (newFleeScratch). */
export interface FleeScratch {
	/** Per cell: BFS steps to the nearest source (math.huge: unreached). */
	readonly dist: number[];
	/** BFS order (reached cells, nondecreasing D). */
	readonly order: number[];
	/** The re-relax FIFO: cells and their values (at most 4 pushes per cell). */
	readonly queue: number[];
	readonly queueValue: number[];
	/** Per cell: 1 once its re-relaxed value is final. */
	readonly done: number[];
}

/** Relaxed pushes per cell at most (one per 4-neighbour). */
const PUSHES_PER_CELL = 4;

/** Scratch for fleeField over a box of `cells` cells (allocate once per room; fleeField never allocates). */
export function newFleeScratch(cells: number): FleeScratch {
	const dist = new Array<number>(cells, math.huge);
	const order = new Array<number>(cells, 0);
	const queue = new Array<number>(cells * PUSHES_PER_CELL, 0);
	const queueValue = new Array<number>(cells * PUSHES_PER_CELL, 0);
	const done = new Array<number>(cells, 0);
	return { dist, order, queue, queueValue, done };
}

/** 4-neighbour offsets (BFS and re-relax order). */
const DX4: ReadonlyArray<number> = [1, -1, 0, 0];
const DY4: ReadonlyArray<number> = [0, 0, 1, -1];
/** 8-neighbour offsets (fleeStep: straight first, then diagonals; also the tie-break). */
const DX8: ReadonlyArray<number> = [1, -1, 0, 0, 1, 1, -1, -1];
const DY8: ReadonlyArray<number> = [0, 0, 1, -1, 1, -1, 1, -1];

/**
 * The flee field over a box of `w` x `h` cells (see the file comment). `open[i]` (row-major, i = ly * w + lx) is 1 for a
 * cell the Goldling can stand on; `sources[0 .. sourceCount - 1]` are box cell indices (an index out of the box or on
 * a closed cell is ignored; repeats are fine); `out[0 .. w h - 1]` receives the field; `scratch` comes from
 * newFleeScratch(>= w h). Allocates nothing. Deterministic: fixed scan orders, IEEE + - x only.
 */
export function fleeField(
	open: ReadonlyArray<number>,
	w: number,
	h: number,
	sources: ReadonlyArray<number>,
	sourceCount: number,
	out: number[],
	scratch: FleeScratch,
	factor: number = GOLDEN_FLEE.factor,
): void {
	const n = w * h;
	const dist = scratch.dist;
	const order = scratch.order;
	const done = scratch.done;
	for (let i = 0; i < n; i++) {
		dist[i] = math.huge;
		done[i] = 0;
		out[i] = math.huge;
	}
	// 1. Multi-source BFS.
	let tail = 0;
	for (let k = 0; k < sourceCount; k++) {
		const s = sources[k];
		if (!(s >= 0 && s < n) || open[s] !== 1 || dist[s] === 0) continue;
		dist[s] = 0;
		order[tail++] = s;
	}
	let head = 0;
	while (head < tail) {
		const c = order[head++];
		const cx = c % w;
		const cy = (c - cx) / w;
		const nd = dist[c] + 1;
		for (let k = 0; k < 4; k++) {
			const nx = cx + DX4[k];
			const ny = cy + DY4[k];
			if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
			const j = ny * w + nx;
			if (open[j] !== 1 || dist[j] <= nd) continue;
			dist[j] = nd;
			order[tail++] = j;
		}
	}
	// 2 + 3. Seeds -factor x D in ascending order (the BFS order backwards), merged with the relaxed FIFO.
	const queue = scratch.queue;
	const queueValue = scratch.queueValue;
	let seedAt = tail - 1;
	let qHead = 0;
	let qTail = 0;
	while (seedAt >= 0 || qHead < qTail) {
		let c: number;
		let v: number;
		const seedValue = seedAt >= 0 ? -factor * dist[order[seedAt]] : math.huge;
		if (qHead < qTail && queueValue[qHead] < seedValue) {
			c = queue[qHead];
			v = queueValue[qHead];
			qHead++;
		} else {
			c = order[seedAt];
			v = seedValue;
			seedAt--;
		}
		if (done[c] !== 0) continue;
		done[c] = 1;
		out[c] = v;
		const cx = c % w;
		const cy = (c - cx) / w;
		const nv = v + 1;
		for (let k = 0; k < 4; k++) {
			const nx = cx + DX4[k];
			const ny = cy + DY4[k];
			if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
			const j = ny * w + nx;
			if (done[j] !== 0 || dist[j] === math.huge) continue;
			queue[qTail] = j;
			queueValue[qTail] = nv;
			qTail++;
		}
	}
}

/**
 * One step downhill on a flee field from box cell (lx, ly): the box cell index of the 8-neighbour open cell with the
 * lowest value strictly below this cell's (diagonals only past two open corners; ties to the first in DX8 / DY8
 * order), or -1 where no neighbour is lower (a safe spot, or nothing reached). Allocates nothing.
 */
export function fleeStep(
	open: ReadonlyArray<number>,
	w: number,
	h: number,
	field: ReadonlyArray<number>,
	lx: number,
	ly: number,
): number {
	if (lx < 0 || ly < 0 || lx >= w || ly >= h) return -1;
	let best = field[ly * w + lx];
	let pick = -1;
	for (let k = 0; k < 8; k++) {
		const ox = DX8[k];
		const oy = DY8[k];
		const nx = lx + ox;
		const ny = ly + oy;
		if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
		const j = ny * w + nx;
		if (open[j] !== 1) continue;
		if (ox !== 0 && oy !== 0 && (open[ly * w + nx] !== 1 || open[ny * w + lx] !== 1)) continue;
		if (field[j] < best) {
			best = field[j];
			pick = j;
		}
	}
	return pick;
}

/**
 * Secret rooms (docs/SECRET_ROOMS.md Design 1, Rules, SR1; decisions SRD1 / SRD6 / SRD10; a Roblox-port feature, no web
 * source): which endless floor hides a cracked far wall, in which combat or elite room, where along it, how large the
 * chamber dug into the void behind it is, and its chest's tier. Decided when the floor is built, a PURE function of the
 * floor like the rest of ./endless.ts, so live play, every co-op client, the server's replay and a daily seed agree.
 *
 *   stream   its own: new EncounterRng(secretSeed(floor seed)) = mulberry32 from (seed ^ SECRET.salt), run LAST in the
 *            floor build (after the Goldling's piece is appended); it only reads the layout, the room spawns, the
 *            entrance, the stairwell, every piece (the vault's chest and the Goldling's included), the vault and the
 *            pact altars, so every earlier output, digest and piece slot is the floor's without it.
 *   draws    below SECRET.fromFloor: none. Else ONE chance draw rng.int(0, percentRange - 1) < chancePercent (an
 *            override's `every` still makes it, and ignores it). On a hit with at least one candidate: ONE uniform pick
 *            rng.int(0, candidates - 1) and ONE tier draw rng.int(0, total weight - 1) walked in SECRET.tierWeights order
 *            (an override's tier replaces the drawn one, which is still drawn). No candidate: no secret. So 0, 1 or 3.
 *   rooms    SECRET.roomTypes (combat, elite), never the entrance or boss room, in room id order. No planned spawns are
 *            needed (a quiet room may hide one too).
 *   crack    SECRET.crackCells cells c0, c0 + a side by side on one FAR wall of the room (facing f = (1, 0) or (0, 1):
 *            the room's FLOOR at +f, as view/decor's farWalls; a = (fz, fx) along the wall). Each crack cell is an outer
 *            WALL (roomId -1, no solid decor), with FLOOR of the room right in front (+f, not corridor) and VOID right
 *            behind (-f); no doorway cell within doorClearTiles (arches frame doorway cells, so they are covered); no
 *            Forge torch and no Forge prop on a wall cell within wallPropClearTiles; no POOL within poolClearTiles.
 *   front    the front box: every cell c + k f (k = 1 .. frontDepth) of every crack cell is FLOOR of the room, holds no
 *            piece (clutter, loot, the vault's chest, the Goldling's), is outside the vault chest's front box, and keeps
 *            the clutter's clearances (BREAKABLE.entranceClearTiles from the entrance, stairwellClearTiles from the
 *            stairwell, pedestal / shrine clearances, shrineClearTiles from each pact altar). Pellets may lie there.
 *   chamber  a rectangle of `along` x `depth` cells (SECRET.chambers, largest first; the first that fits is the crack
 *            position's) straight behind the crack, starting floor((along - crackCells) / 2) cells before c0 along the
 *            wall: cells s + i a - k f (i = 0 .. along - 1, k = 1 .. depth). Every chamber cell VOID and inside the grid;
 *            its ring (i = -1 .. along, k = 0 .. depth + 1, minus the chamber) inside the grid, the k = 0 row the parent's
 *            own wall line (outer WALL cells, the crack among them) and every other ring cell VOID; one more cell round
 *            the ring (i = -2 .. along + 1, k = 0 .. depth + 2) holds no FLOOR, POOL, corridor or doorway cell, and the
 *            row in front of the wall line (k = -1, i = -1 .. along) no corridor or doorway cell and, over the chamber's
 *            columns, no solid decor (a bookcase's back must never stand over a floor). So the chamber touches no other
 *            room or corridor and has one way in: the crack.
 *   pick     every candidate (room id, then the crack's first cell in row order, then f in the order (1, 0), (0, 1)),
 *            one per crack position with its largest chamber; ONE uniform draw.
 *   chest    on the chamber's back row (k = depth), along index floor((along - 1) / 2), facing f (toward the crack).
 *
 * Output: a FloorSecret (EndlessFloorLayout / EndlessFloorWorld.secret): the crack, the chamber, the chest, their piece
 * slots (buildEndlessFloor appends the crack pieces, kind `crackedWall` in crack order, then the chest, kind `chest`,
 * after every other piece: secretPieces) and `dungeon`, the carved copy the sim moves and blocks on (carveSecret).
 */
import { u32 } from "shared/jsmath";
import { TileType, type Dungeon } from "./forge";
import { cellKey, gridToWorld, tileAt, worldToGrid } from "./collision";
import { EncounterRng } from "./encounter";
import type { EncounterRoom } from "./encounterTypes";
import type { BreakableFloorInput, BreakablePlacement } from "./breakables";
import { BREAKABLE } from "./breakablesData";
import { vaultFrontCells, type VaultPlan } from "./vault";
import { CHEST_KIND } from "./vaultData";
import type { FloorPacts } from "./pacts";
import { CRACKED_WALL_KIND, SECRET } from "./secretsData";

/** A floor's secret room (EndlessFloorLayout / EndlessFloorWorld.secret). Grid coordinates. Never mutated. */
export interface FloorSecret {
	/** The crack's encounter room id. */
	readonly room: number;
	/** The crack's first cell (grid); the others follow along (ax, az). */
	readonly x: number;
	readonly y: number;
	/** Facing into the room (the room's FLOOR is at +f): (1, 0) or (0, 1), far walls only. */
	readonly fx: number;
	readonly fz: number;
	/** Along the wall: (fz, fx). */
	readonly ax: number;
	readonly az: number;
	/** SECRET.crackCells. */
	readonly cells: number;
	/** The chamber's floor rectangle (grid x0 .. x0 + w - 1 by y0 .. y0 + h - 1); its ring is the rectangle grown by 1. */
	readonly x0: number;
	readonly y0: number;
	readonly w: number;
	readonly h: number;
	/** The chamber's size along the wall and deep behind it (SECRET.chambers). */
	readonly along: number;
	readonly depth: number;
	/** The chest's cell (grid; world centre gridToWorld(chestX), gridToWorld(chestY)); it faces (fx, fz). */
	readonly chestX: number;
	readonly chestY: number;
	/** VaultTier: RARE or LEGENDARY. */
	readonly tier: number;
	/** The first crack piece's slot in the floor's breakables (the crack's `cells` pieces, then the chest). */
	readonly crackSlot: number;
	/** The chest's slot (crackSlot + cells). */
	readonly chestSlot: number;
	/**
	 * The carved copy of the floor's Dungeon the sim moves, blocks and sees on (shared/run endlessFloorWorld): a new
	 * `grid` (the chamber FLOOR, its ring WALL, the crack cells FLOOR, blocked by their pieces while intact); every
	 * other field shared with the Forge's dungeon. `roomId` stays -1 on the chamber and crack (no room, no score
	 * record); `bfs`, `maxBfs`, `stats` and `valid` describe the UNCARVED grid (nothing outside the Forge reads them).
	 * The view draws the Forge's dungeon (EndlessFloorLayout.dungeon) until the open.
	 */
	readonly dungeon: Dungeon;
}

/** One candidate: a room, a crack position and facing, and its largest chamber. */
export interface SecretCandidate {
	readonly room: number;
	readonly x: number;
	readonly y: number;
	readonly fx: number;
	readonly fz: number;
	readonly along: number;
	readonly depth: number;
}

/** What placeSecret reads of a built floor: the clutter's input plus everything placed before it. */
export interface SecretFloorInput extends BreakableFloorInput {
	/** Every piece of the floor so far, in slot order (the clutter, the vault's chest, the Goldling's piece). */
	readonly pieces: ReadonlyArray<BreakablePlacement>;
	/** The floor's vault (the front box keeps out of its chest's front box). Absent: none. */
	readonly vault?: VaultPlan;
	/** The shrine room's pact altars (their clearance). Absent: none. */
	readonly pactAltars?: FloorPacts;
}

/**
 * Dev world only (docs/SECRET_ROOMS.md Design 5, KV_SecretDebug): `every` makes every floor from SECRET.fromFloor a
 * secret floor (when a candidate exists), `tier` replaces the drawn one. Every draw is still made. Never reaches the
 * server (the dev world is server-refused).
 */
export interface SecretOverride {
	readonly every?: boolean;
	readonly tier?: number;
}

/** Far-wall facings, in candidate order. */
const FACINGS: ReadonlyArray<readonly [number, number]> = [
	[1, 0],
	[0, 1],
];

/** Seed of the secret's stream: the floor seed with SECRET.salt mixed in (uint32). */
export function secretSeed(floorSeed: number): number {
	return bit32.bxor(u32(floorSeed), SECRET.salt);
}

/** A point to keep the front box clear of (world) and its radius. */
interface Zone {
	readonly x: number;
	readonly z: number;
	readonly r: number;
}

/** What the rules read once per floor. */
interface SecretPrep {
	readonly d: Dungeon;
	readonly pieceCells: ReadonlySet<number>;
	readonly decorCells: ReadonlySet<number>;
	readonly wallProps: ReadonlySet<number>;
	readonly vaultFront: ReadonlySet<number>;
	readonly zones: ReadonlyArray<Zone>;
}

function prepSecret(input: SecretFloorInput): SecretPrep {
	const d = input.dungeon;
	const pieceCells = new Set<number>();
	for (const p of input.pieces) pieceCells.add(cellKey(p.x, p.y));
	const decorCells = new Set<number>();
	for (const p of d.solidDecor ?? [])
		for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) decorCells.add(cellKey(x, y));
	const wallProps = new Set<number>();
	for (const t of d.torches) wallProps.add(cellKey(t.x, t.y));
	for (const p of d.props) {
		const gx = math.round(p.x);
		const gy = math.round(p.y);
		if (gx === p.x && gy === p.y && tileAt(d, gx, gy) === TileType.WALL && d.roomId[gy * d.W + gx] < 0)
			wallProps.add(cellKey(gx, gy));
	}
	const zones: Zone[] = [];
	zones.push({ x: input.spawn.x, z: input.spawn.z, r: BREAKABLE.entranceClearTiles });
	zones.push({ x: input.stairwell.x, z: input.stairwell.z, r: BREAKABLE.stairwellClearTiles });
	for (const room of input.encounter.rooms) {
		if (room.type === "treasure") zones.push({ x: room.cx, z: room.cz, r: BREAKABLE.pedestalClearTiles });
		else if (room.type === "shrine") zones.push({ x: room.cx, z: room.cz, r: BREAKABLE.shrineClearTiles });
	}
	for (const a of input.pactAltars?.altars ?? []) zones.push({ x: a.x, z: a.z, r: BREAKABLE.shrineClearTiles });
	return {
		d,
		pieceCells,
		decorCells,
		wallProps,
		vaultFront: input.vault !== undefined ? vaultFrontCells(input.vault) : new Set<number>(),
		zones,
	};
}

/** An outer wall cell: WALL, in no room, no solid decor. */
function outerWall(prep: SecretPrep, gx: number, gy: number): boolean {
	const d = prep.d;
	if (tileAt(d, gx, gy) !== TileType.WALL || d.roomId[gy * d.W + gx] >= 0) return false;
	return !prep.decorCells.has(cellKey(gx, gy));
}

/** (gx, gy) is FLOOR of room `id` (so neither corridor nor doorway: those cells are in no room). */
function roomFloor(d: Dungeon, id: number, gx: number, gy: number): boolean {
	if (tileAt(d, gx, gy) !== TileType.FLOOR) return false;
	const i = gy * d.W + gx;
	return d.roomId[i] === id && d.corridor[i] === 0 && d.doorway[i] === 0;
}

/** A corridor or doorway cell (inside the grid). */
function passage(d: Dungeon, gx: number, gy: number): boolean {
	if (gx < 0 || gy < 0 || gx >= d.W || gy >= d.H) return false;
	const i = gy * d.W + gx;
	return d.corridor[i] !== 0 || d.doorway[i] !== 0;
}

function inGrid(d: Dungeon, gx: number, gy: number): boolean {
	return gx >= 0 && gy >= 0 && gx < d.W && gy < d.H;
}

/** Some cell within Chebyshev `r` of (gx, gy) passes `test`. */
function anyNear(r: number, gx: number, gy: number, test: (x: number, y: number) => boolean): boolean {
	for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) if (test(gx + ox, gy + oy)) return true;
	return false;
}

/** The crack-cell rules of the file comment ("crack") for cell (gx, gy) of room `id`, facing (fx, fz). */
function crackCellOk(prep: SecretPrep, id: number, gx: number, gy: number, fx: number, fz: number): boolean {
	const d = prep.d;
	if (!outerWall(prep, gx, gy)) return false;
	if (!roomFloor(d, id, gx + fx, gy + fz)) return false;
	if (!inGrid(d, gx - fx, gy - fz) || tileAt(d, gx - fx, gy - fz) !== TileType.VOID) return false;
	if (anyNear(SECRET.doorClearTiles, gx, gy, (x, y) => inGrid(d, x, y) && d.doorway[y * d.W + x] !== 0)) return false;
	if (anyNear(SECRET.wallPropClearTiles, gx, gy, (x, y) => prep.wallProps.has(cellKey(x, y)))) return false;
	return !anyNear(SECRET.poolClearTiles, gx, gy, (x, y) => tileAt(d, x, y) === TileType.POOL);
}

/** The front box rules ("front") for crack cell (gx, gy) of room `id`. */
function frontOk(prep: SecretPrep, id: number, gx: number, gy: number, fx: number, fz: number): boolean {
	const d = prep.d;
	for (let k = 1; k <= SECRET.frontDepth; k++) {
		const x = gx + fx * k;
		const y = gy + fz * k;
		if (!roomFloor(d, id, x, y)) return false;
		const key = cellKey(x, y);
		if (prep.pieceCells.has(key) || prep.vaultFront.has(key)) return false;
		const wx = gridToWorld(x);
		const wz = gridToWorld(y);
		for (const z of prep.zones) {
			const dx = wx - z.x;
			const dz = wz - z.z;
			if (dx * dx + dz * dz < z.r * z.r) return false;
		}
	}
	return true;
}

/** The chamber rules ("chamber") for `along` x `depth` behind the crack at (gx, gy), facing (fx, fz). */
function chamberOk(
	prep: SecretPrep,
	gx: number,
	gy: number,
	fx: number,
	fz: number,
	along: number,
	depth: number,
): boolean {
	const d = prep.d;
	const ax = fz;
	const az = fx;
	const lead = math.floor((along - SECRET.crackCells) / 2);
	// The cell at along index i, depth k (k = 0: the wall line, k > 0 behind it, k < 0 in front).
	const sx = gx - ax * lead;
	const sy = gy - az * lead;
	for (let k = 0; k <= depth + 2; k++)
		for (let i = -2; i <= along + 1; i++) {
			const x = sx + ax * i - fx * k;
			const y = sy + az * i - fz * k;
			const chamber = i >= 0 && i < along && k >= 1 && k <= depth;
			const ring = !chamber && i >= -1 && i <= along && k <= depth + 1;
			if (chamber || ring) {
				if (!inGrid(d, x, y)) return false;
				if (k === 0) {
					if (!outerWall(prep, x, y)) return false;
				} else if (tileAt(d, x, y) !== TileType.VOID) return false;
				continue;
			}
			// The halo: no floor, pool or passage.
			const t = tileAt(d, x, y);
			if (t === TileType.FLOOR || t === TileType.POOL || passage(d, x, y)) return false;
		}
	// The row in front of the wall line: no passage; over the chamber's columns no solid decor.
	for (let i = -1; i <= along; i++) {
		const x = sx + ax * i + fx;
		const y = sy + az * i + fz;
		if (passage(d, x, y)) return false;
		if (i >= 0 && i < along && prep.decorCells.has(cellKey(x, y))) return false;
	}
	return true;
}

/** The room may hold a crack by type (SECRET.roomTypes), never the entrance or the boss room. */
export function secretRoomOpen(input: BreakableFloorInput, room: EncounterRoom): boolean {
	const d = input.dungeon;
	if (room.id === d.entrance || room.id === d.boss || room.id === input.encounter.bossRoom) return false;
	return SECRET.roomTypes.includes(room.type);
}

/** Every candidate of the floor (the file comment's "pick" order). Pure; draws nothing. */
export function secretCandidates(input: SecretFloorInput): SecretCandidate[] {
	const prep = prepSecret(input);
	const d = input.dungeon;
	const out: SecretCandidate[] = [];
	for (const room of input.encounter.rooms) {
		if (!secretRoomOpen(input, room)) continue;
		const id = room.id;
		// Wall cells of the room's far walls lie one cell outside its floor box on -x / -z.
		const gx0 = worldToGrid(room.minX) - 1;
		const gx1 = worldToGrid(room.maxX);
		const gy0 = worldToGrid(room.minZ) - 1;
		const gy1 = worldToGrid(room.maxZ);
		for (let gy = gy0; gy <= gy1; gy++)
			for (let gx = gx0; gx <= gx1; gx++)
				for (const [fx, fz] of FACINGS) {
					const ax = fz;
					const az = fx;
					let ok = true;
					for (let c = 0; c < SECRET.crackCells && ok; c++) {
						const x = gx + ax * c;
						const y = gy + az * c;
						ok = crackCellOk(prep, id, x, y, fx, fz) && frontOk(prep, id, x, y, fx, fz);
					}
					if (!ok) continue;
					for (const size of SECRET.chambers) {
						if (!chamberOk(prep, gx, gy, fx, fz, size.along, size.depth)) continue;
						out.push({ room: id, x: gx, y: gy, fx, fz, along: size.along, depth: size.depth });
						break;
					}
				}
	}
	return out;
}

/** One weighted pick over SECRET.tierWeights: ONE rng.int(0, total - 1). */
function pickTier(rng: EncounterRng): number {
	const weights = SECRET.tierWeights;
	let total = 0;
	for (const w of weights) total += w.weight;
	let roll = rng.int(0, total - 1);
	for (const w of weights) {
		if (roll < w.weight) return w.tier;
		roll -= w.weight;
	}
	return weights[weights.size() - 1].tier;
}

/** The plan of candidate `c` with `tier`, its slots after `pieceCount` pieces and the carved dungeon of `d`. */
function secretOf(d: Dungeon, c: SecretCandidate, tier: number, pieceCount: number): FloorSecret {
	const ax = c.fz;
	const az = c.fx;
	const lead = math.floor((c.along - SECRET.crackCells) / 2);
	const sx = c.x - ax * lead;
	const sy = c.y - az * lead;
	// The chamber's far corner cells: i = 0, k = 1 and i = along - 1, k = depth.
	const ax0 = sx - c.fx;
	const ay0 = sy - c.fz;
	const ax1 = sx + ax * (c.along - 1) - c.fx * c.depth;
	const ay1 = sy + az * (c.along - 1) - c.fz * c.depth;
	const x0 = math.min(ax0, ax1);
	const y0 = math.min(ay0, ay1);
	const chestAlong = math.floor((c.along - 1) / 2);
	const plan = {
		room: c.room,
		x: c.x,
		y: c.y,
		fx: c.fx,
		fz: c.fz,
		ax,
		az,
		cells: SECRET.crackCells,
		x0,
		y0,
		w: math.max(ax0, ax1) - x0 + 1,
		h: math.max(ay0, ay1) - y0 + 1,
		along: c.along,
		depth: c.depth,
		chestX: sx + ax * chestAlong - c.fx * c.depth,
		chestY: sy + az * chestAlong - c.fz * c.depth,
		tier,
		crackSlot: pieceCount,
		chestSlot: pieceCount + SECRET.crackCells,
	};
	return { ...plan, dungeon: carveSecret(d, plan) };
}

/** The geometry carveSecret reads (a FloorSecret without its dungeon). */
export type SecretGeometry = Omit<FloorSecret, "dungeon">;

/**
 * The carved copy of `d` for `plan` (FloorSecret.dungeon): a shallow copy with a new grid, the chamber FLOOR, its ring
 * WALL but on the wall line, the crack cells FLOOR. `d` is never mutated. Pure.
 */
export function carveSecret(d: Dungeon, plan: SecretGeometry): Dungeon {
	const grid = [...d.grid];
	for (let y = plan.y0 - 1; y <= plan.y0 + plan.h; y++)
		for (let x = plan.x0 - 1; x <= plan.x0 + plan.w; x++) {
			if (!inGrid(d, x, y)) continue;
			const inside = x >= plan.x0 && x < plan.x0 + plan.w && y >= plan.y0 && y < plan.y0 + plan.h;
			const i = y * d.W + x;
			if (inside) grid[i] = TileType.FLOOR;
			else if (grid[i] === TileType.VOID) grid[i] = TileType.WALL;
		}
	for (let c = 0; c < plan.cells; c++) grid[(plan.y + plan.az * c) * d.W + plan.x + plan.ax * c] = TileType.FLOOR;
	return { ...d, grid };
}

/**
 * The secret of the built endless floor `input` (floor `floor`, every piece so far in `input.pieces`), or undefined:
 * see the file comment. Pure and deterministic: the same floor always gets the same secret.
 */
export function placeSecret(
	input: SecretFloorInput,
	floor: number,
	override?: SecretOverride,
): FloorSecret | undefined {
	if (floor < SECRET.fromFloor) return undefined;
	const rng = new EncounterRng(secretSeed(input.seed));
	const hit = rng.int(0, SECRET.percentRange - 1) < SECRET.chancePercent;
	if (!hit && override?.every !== true) return undefined;
	const candidates = secretCandidates(input);
	if (candidates.size() === 0) return undefined;
	const pick = candidates[rng.int(0, candidates.size() - 1)];
	const tier = pickTier(rng);
	return secretOf(input.dungeon, pick, override?.tier ?? tier, input.pieces.size());
}

/** The pieces of `plan`, appended to the floor's breakables at plan.crackSlot: the crack cells in order, then the chest. */
export function secretPieces(plan: SecretGeometry): BreakablePlacement[] {
	const out: BreakablePlacement[] = [];
	for (let c = 0; c < plan.cells; c++)
		out.push({ x: plan.x + plan.ax * c, y: plan.y + plan.az * c, kind: CRACKED_WALL_KIND });
	out.push({ x: plan.chestX, y: plan.chestY, kind: CHEST_KIND });
	return out;
}

/** The crack's cells (grid), in order. */
export function secretCrackCells(plan: SecretGeometry): Array<{ x: number; y: number }> {
	const out: Array<{ x: number; y: number }> = [];
	for (let c = 0; c < plan.cells; c++) out.push({ x: plan.x + plan.ax * c, y: plan.y + plan.az * c });
	return out;
}

/** The chest's world centre. */
export function secretChestCentre(plan: SecretGeometry): { x: number; z: number } {
	return { x: gridToWorld(plan.chestX), z: gridToWorld(plan.chestY) };
}

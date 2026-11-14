/**
 * Vaults (docs/TREASURE.md Design §1, TR0 corrections 1 / 2 / 9-12, decisions TRD2 / TRD3 / TRD4 / TRD6; a Roblox-port
 * feature, no web source): which endless floor holds a vault, in which combat or elite room its caged chest stands,
 * where (against a wall, facing into the room), its starting tier and its lock. Decided when the floor is built, a PURE
 * function of the floor like the rest of ./endless.ts, so live play, every co-op client, the server's replay and a
 * daily seed see the same vault and the sim draws no rng for it.
 *
 *   stream   its own: new EncounterRng(vaultSeed(floor seed)) = mulberry32 from (seed ^ VAULT.salt), run LAST in the
 *            floor build (after the pellets); it only reads the layout, the room spawns, the entrance, the stairwell,
 *            the placed breakables and the pellets, so the layout, digest, props, spawns, pieces, affixes, loot,
 *            pellets and boss pick never move. The chest is appended to the breakables list after all of them.
 *   draws    below VAULT.fromFloor: none, no vault. Else ONE chance draw rng.int(0, 99) < vaultChancePercent(floor)
 *            (an override's `every` still makes it, and ignores it). On a hit, when some room is eligible: ONE weighted
 *            room pick (VAULT.roomWeight by type: rng.int(0, total - 1) walked in room id order), ONE tier draw
 *            rng.int(0, 99) < legendaryPercent(floor) (Legendary, else Rare) and ONE weighted lock draw
 *            (VAULT.lockWeights: rng.int(0, total - 1) walked in VaultLock order); an override's tier / lock replace
 *            the drawn ones, which are still drawn. A hit with no eligible room: no vault (1 draw). So 0, 1 or 4.
 *   rooms    eligible (vaultRoomOpen): type combat or elite (a VAULT.roomWeight entry), not the entrance or boss room,
 *            planned spawns (roomSpawns[id] not empty: only those rooms get a score record, so only they arm), at
 *            least VAULT.minRoomTiles floor tiles, AND at least one valid chest cell (vaultCandidates), so a picked
 *            room always holds its vault.
 *   cell     a valid cell (vaultCandidates) is a breakableCandidates cell of the room (the clutter's static rules:
 *            doorways, spawns, entrance, stairwell, pedestal, shrine, pools) that no piece or pellet stands on, at least
 *            doorFarTiles from every doorway of the room (./enemyRooms.ts roomDoorways), with a facing (fx, fz) into the room such that
 *              - its back row (the three cells behind it, across the facing) is WALL, none of it solid decor;
 *              - no solid-decor cell lies within decorClearTiles (Chebyshev): never in front of a tomb or a candle;
 *              - its wallClearTiles cells in front and its sideClearTiles cells on each side along the wall are FLOOR
 *                of the room and free of pieces;
 *              - pieceFitsAt (./breakables.ts): the clutter's gap rule and reachability test against the pieces.
 *            Facings are tried in the order (1, 0), (0, 1) (the far walls at -x / -z, seen front-on from the camera,
 *            the Forge's own convention in forge/solidDecor.ts), then (-1, 0), (0, -1); a cell keeps its first valid
 *            one. The cells are ordered far wall first, then farthest from the room's nearest doorway, then row order;
 *            the vault's chest takes the first.
 *
 * Output: a VaultPlan (or undefined), grid coordinates; EndlessFloorLayout.vault and the chest appended to its
 * breakables (vaultChest) at index plan.slot.
 */
import { u32 } from "shared/jsmath";
import { TileType, type Dungeon } from "./forge";
import { cellKey, gridToWorld, tileAt, worldToGrid } from "./collision";
import { EncounterRng, type TileXZ } from "./encounter";
import type { EncounterRoom } from "./encounterTypes";
import { breakableCandidateFinder, pieceFitter, type BreakableFloorInput, type BreakablePlacement } from "./breakables";
import { roomDoorways } from "./enemyRooms";
import type { FloorPellets } from "./pellets";
import { CHEST_KIND, VAULT, VAULT_PERCENT_RANGE, VaultTier, legendaryPercent, vaultChancePercent } from "./vaultData";

/** A floor's vault: where its chest stands and what it holds (EndlessFloorLayout / EndlessFloorWorld.vault). */
export interface VaultPlan {
	/** The vault room's encounter room id. */
	readonly room: number;
	/** The chest's cell (grid; world centre gridToWorld(x), gridToWorld(y)). */
	readonly x: number;
	readonly y: number;
	/** Facing into the room: (1, 0) / (0, 1) on far walls, (-1, 0) / (0, -1) on near walls. */
	readonly fx: number;
	readonly fz: number;
	/** The chest's index in the floor's breakables (the pieces before it). */
	readonly slot: number;
	/** VaultLock. */
	readonly lock: number;
	/** VaultTier: RARE or LEGENDARY. */
	readonly tier: number;
}

/**
 * Dev world only (docs/TREASURE.md correction 12, KV_TreasureDebug): `every` makes every floor from VAULT.fromFloor a
 * vault floor (when a room is eligible), `tier` / `lock` replace the drawn ones. Every draw is still made, so the
 * stream keeps its positions. Never reaches the server (the dev world is server-refused).
 */
export interface VaultOverride {
	readonly every?: boolean;
	readonly tier?: number;
	readonly lock?: number;
}

/** A valid chest cell of a room and its facing (grid). */
export interface VaultCell {
	readonly x: number;
	readonly y: number;
	readonly fx: number;
	readonly fz: number;
}

/** An eligible vault room and its valid cells (vaultCandidates order). */
export interface VaultRoom {
	readonly room: EncounterRoom;
	readonly cells: ReadonlyArray<VaultCell>;
}

/** The facings a chest tries, in order: the far walls first (file comment). */
const FACINGS: ReadonlyArray<readonly [number, number]> = [
	[1, 0],
	[0, 1],
	[-1, 0],
	[0, -1],
];

/** Seed of the vault stream: the floor seed with VAULT.salt mixed in (uint32). */
export function vaultSeed(floorSeed: number): number {
	return bit32.bxor(u32(floorSeed), VAULT.salt);
}

/** A facing on a far wall ((1, 0) or (0, 1)). */
export function isFarWallFacing(fx: number, fz: number): boolean {
	return fx > 0 || fz > 0;
}

/** The weight of `room` in the room pick (0: never a vault room by type). */
function roomWeightOf(room: EncounterRoom): number {
	return VAULT.roomWeight[room.type] ?? 0;
}

/**
 * `room` may hold the floor's vault before its cells are looked at (file comment, "rooms"): a weighted type, not the
 * entrance or boss room, planned spawns, at least VAULT.minRoomTiles floor tiles. Pure.
 */
export function vaultRoomOpen(input: BreakableFloorInput, room: EncounterRoom): boolean {
	const d = input.dungeon;
	if (roomWeightOf(room) <= 0 || room.id === d.entrance || room.id === d.boss) return false;
	if ((input.roomSpawns[room.id] ?? []).size() === 0) return false;
	return room.floorTiles >= VAULT.minRoomTiles;
}

/** Every solid-decor cell of the dungeon (cellKey). */
function solidDecorCells(d: Dungeon): Set<number> {
	const out = new Set<number>();
	for (const p of d.solidDecor ?? [])
		for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) out.add(cellKey(x, y));
	return out;
}

/** What the cell rules read once per floor. */
interface VaultPrep {
	readonly fits: (gx: number, gy: number) => boolean;
	readonly candidates: (room: EncounterRoom) => ReadonlyArray<TileXZ>;
	readonly pieceCells: ReadonlySet<number>;
	readonly pelletCells: ReadonlySet<number>;
	readonly decor: ReadonlySet<number>;
}

function prepVault(
	input: BreakableFloorInput,
	pieces: ReadonlyArray<BreakablePlacement>,
	pellets: FloorPellets | undefined,
): VaultPrep {
	const pieceCells = new Set<number>();
	for (const b of pieces) pieceCells.add(cellKey(b.x, b.y));
	const pelletCells = new Set<number>();
	for (const t of pellets?.tiles ?? []) pelletCells.add(cellKey(worldToGrid(t.x), worldToGrid(t.z)));
	return {
		fits: pieceFitter(input.dungeon, pieces),
		candidates: breakableCandidateFinder(input),
		pieceCells,
		pelletCells,
		decor: solidDecorCells(input.dungeon),
	};
}

/** (gx, gy) is FLOOR of room `id` and no piece stands on it. */
function openFloorOf(d: Dungeon, prep: VaultPrep, id: number, gx: number, gy: number): boolean {
	if (tileAt(d, gx, gy) !== TileType.FLOOR || d.roomId[gy * d.W + gx] !== id) return false;
	return !prep.pieceCells.has(cellKey(gx, gy));
}

/** The facing rules of the file comment ("cell": back row, decor, front, sides) for a chest at (gx, gy). */
function facingOk(d: Dungeon, prep: VaultPrep, id: number, gx: number, gy: number, fx: number, fz: number): boolean {
	// Across the facing: (1, 0) -> (0, 1), (0, 1) -> (1, 0).
	const px = math.abs(fz);
	const pz = math.abs(fx);
	for (let k = -1; k <= 1; k++) {
		const bx = gx - fx + k * px;
		const by = gy - fz + k * pz;
		if (tileAt(d, bx, by) !== TileType.WALL || prep.decor.has(cellKey(bx, by))) return false;
	}
	for (let k = 1; k <= VAULT.wallClearTiles; k++)
		if (!openFloorOf(d, prep, id, gx + fx * k, gy + fz * k)) return false;
	for (let k = 1; k <= VAULT.sideClearTiles; k++) {
		if (!openFloorOf(d, prep, id, gx + px * k, gy + pz * k)) return false;
		if (!openFloorOf(d, prep, id, gx - px * k, gy - pz * k)) return false;
	}
	return true;
}

/** No solid-decor cell within VAULT.decorClearTiles (Chebyshev) of (gx, gy). */
function clearOfDecor(prep: VaultPrep, gx: number, gy: number): boolean {
	const r = VAULT.decorClearTiles;
	for (let oy = -r; oy <= r; oy++)
		for (let ox = -r; ox <= r; ox++) if (prep.decor.has(cellKey(gx + ox, gy + oy))) return false;
	return true;
}

function candidatesOf(input: BreakableFloorInput, room: EncounterRoom, prep: VaultPrep): VaultCell[] {
	const d = input.dungeon;
	const doors = roomDoorways(d, room.id);
	const far2 = VAULT.doorFarTiles * VAULT.doorFarTiles;
	const cells: VaultCell[] = [];
	const doorDist2 = new Map<VaultCell, number>();
	for (const c of prep.candidates(room)) {
		const key = cellKey(c.x, c.z);
		if (prep.pieceCells.has(key) || prep.pelletCells.has(key)) continue;
		let nearest = math.huge;
		for (const door of doors) {
			const dx = c.x - door.x;
			const dz = c.z - door.z;
			nearest = math.min(nearest, dx * dx + dz * dz);
		}
		if (nearest < far2 || !clearOfDecor(prep, c.x, c.z)) continue;
		let facing: readonly [number, number] | undefined;
		for (const f of FACINGS) {
			if (facingOk(d, prep, room.id, c.x, c.z, f[0], f[1])) {
				facing = f;
				break;
			}
		}
		if (facing === undefined || !prep.fits(c.x, c.z)) continue;
		const cell: VaultCell = { x: c.x, y: c.z, fx: facing[0], fz: facing[1] };
		cells.push(cell);
		doorDist2.set(cell, nearest);
	}
	// A total order (row order breaks every tie: one entry per cell), so the sort is deterministic.
	cells.sort((a, b) => {
		const fa = isFarWallFacing(a.fx, a.fz);
		const fb = isFarWallFacing(b.fx, b.fz);
		if (fa !== fb) return fa;
		const da = doorDist2.get(a)!;
		const db = doorDist2.get(b)!;
		if (da !== db) return da > db;
		if (a.y !== b.y) return a.y < b.y;
		return a.x < b.x;
	});
	return cells;
}

/**
 * The valid chest cells of `room` on the floor `input` with its placed `pieces` and `pellets`, in pick order (the file
 * comment's "cell"). Empty for a room vaultRoomOpen refuses. Pure; draws nothing.
 */
export function vaultCandidates(
	input: BreakableFloorInput,
	room: EncounterRoom,
	pieces: ReadonlyArray<BreakablePlacement>,
	pellets?: FloorPellets,
): VaultCell[] {
	if (!vaultRoomOpen(input, room)) return [];
	return candidatesOf(input, room, prepVault(input, pieces, pellets));
}

/** Every eligible vault room of the floor (open with at least one valid cell), room id order. Pure; draws nothing. */
export function vaultRooms(
	input: BreakableFloorInput,
	pieces: ReadonlyArray<BreakablePlacement>,
	pellets?: FloorPellets,
): VaultRoom[] {
	const prep = prepVault(input, pieces, pellets);
	const out: VaultRoom[] = [];
	for (const room of input.encounter.rooms) {
		if (!vaultRoomOpen(input, room)) continue;
		const cells = candidatesOf(input, room, prep);
		if (cells.size() > 0) out.push({ room, cells });
	}
	return out;
}

/** One weighted pick over `weights` (index order): ONE rng.int(0, total - 1). */
function pickWeighted(rng: EncounterRng, weights: ReadonlyArray<number>): number {
	let total = 0;
	for (const w of weights) total += w;
	let roll = rng.int(0, total - 1);
	for (let i = 0; i < weights.size(); i++) {
		if (roll < weights[i]) return i;
		roll -= weights[i];
	}
	return weights.size() - 1;
}

/**
 * The vault of the built endless floor `input` (floor `floor`, its placed breakables `pieces` and `pellets`), or
 * undefined: see the file comment. Pure and deterministic: the same floor always gets the same vault.
 */
export function placeVault(
	input: BreakableFloorInput,
	floor: number,
	pieces: ReadonlyArray<BreakablePlacement>,
	pellets?: FloorPellets,
	override?: VaultOverride,
): VaultPlan | undefined {
	if (floor < VAULT.fromFloor) return undefined;
	const rng = new EncounterRng(vaultSeed(input.seed));
	const hit = rng.int(0, VAULT_PERCENT_RANGE - 1) < vaultChancePercent(floor);
	if (!hit && override?.every !== true) return undefined;
	const rooms = vaultRooms(input, pieces, pellets);
	if (rooms.size() === 0) return undefined;
	const weights = rooms.map((r) => roomWeightOf(r.room));
	const pick = rooms[pickWeighted(rng, weights)];
	const legendary = rng.int(0, VAULT_PERCENT_RANGE - 1) < legendaryPercent(floor);
	const lock = pickWeighted(rng, VAULT.lockWeights);
	const cell = pick.cells[0];
	return {
		room: pick.room.id,
		x: cell.x,
		y: cell.y,
		fx: cell.fx,
		fz: cell.fz,
		slot: pieces.size(),
		lock: override?.lock ?? lock,
		tier: override?.tier ?? (legendary ? VaultTier.LEGENDARY : VaultTier.RARE),
	};
}

/** The chest piece of `plan` (appended to the floor's breakables at plan.slot). */
export function vaultChest(plan: VaultPlan): BreakablePlacement {
	return { x: plan.x, y: plan.y, kind: CHEST_KIND };
}

/** The chest's world centre (tile centre of its cell). */
export function vaultCentre(plan: VaultPlan): { x: number; z: number } {
	return { x: gridToWorld(plan.x), z: gridToWorld(plan.y) };
}

/**
 * The chest's front box (cellKeys): its cell row and the VAULT.wallClearTiles rows in front of it, VAULT.sideClearTiles
 * cells to each side (the cells the vault kept FLOOR and free of pieces). The Goldling's piece (./golden.ts) and a
 * secret's front box (./secrets.ts) keep out of it. Pure.
 */
export function vaultFrontCells(plan: VaultPlan): Set<number> {
	const out = new Set<number>();
	// Across the facing: (1, 0) -> (0, 1), (0, 1) -> (1, 0) (facingOk).
	const px = math.abs(plan.fz);
	const pz = math.abs(plan.fx);
	for (let a = 0; a <= VAULT.wallClearTiles; a++)
		for (let b = -VAULT.sideClearTiles; b <= VAULT.sideClearTiles; b++)
			out.add(cellKey(plan.x + plan.fx * a + px * b, plan.y + plan.fz * a + pz * b));
	return out;
}

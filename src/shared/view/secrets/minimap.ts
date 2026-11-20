/**
 * A secret room on the minimap (docs/SECRET_ROOMS.md SR8, Design 8). Before the open the map's tiles are the Forge
 * grid's (shared/view/minimap minimapTiles of EndlessFloorLayout.dungeon: the crack a wall, the chamber void), exactly
 * as on any floor: nothing gives the secret away. At the open (the frame SecretViewTracker reports the open, or the
 * first frame a late view finds it open):
 *
 *   secretMapChange       the cells whose map tile changes, from the carved grid (FloorSecret.dungeon): the crack and
 *                         the chamber become FLOOR, the ring WALL; and the reveal set (every chamber, ring and crack
 *                         cell the map now draws) for the shared party fog (FogOfWar.revealCells)
 *   applySecretMapChange  writes the new tiles into the floor's MinimapTiles in place (the fog and the painter read that
 *                         one object; the map's sight then sees into the chamber), returns the changed cells to repaint
 *   secretMarkStyle       the chest's mark, like the vault's (vaultMarkStyle): none before the open (no map mark,
 *                         SRD4), filled in its tier's floor role once open, hollow once taken
 *
 * MinimapController calls them (Track V2). Pure, tested headlessly (minimap.spec.ts): after the change the tiles equal
 * minimapTiles of the carved grid everywhere.
 *
 * @module
 */
import { TileType, type Dungeon, type FloorSecret } from "shared/dungeon";
import { SecretStatus } from "shared/sim";
import { treasureFloorRole } from "shared/theme";
import { MapTile, type MinimapTiles } from "../minimap/tiles";
import type { VaultMarkStyle } from "../treasure/minimap";
import { secretRingRect } from "./geometry";

/** The tile changes and the reveal set of a secret's open. */
export interface SecretMapChange {
	/** Cell indices (y * W + x) whose MapTile changes, ascending, and their new values (same order). */
	readonly cells: ReadonlyArray<number>;
	readonly tiles: ReadonlyArray<number>;
	/** Every chamber / ring / crack cell the map draws after the open (MapTile not NONE), ascending. */
	readonly reveal: ReadonlyArray<number>;
}

function isOpen(t: number): boolean {
	return t === TileType.FLOOR || t === TileType.POOL;
}

/** The map tile of cell (gx, gy) of `d` by minimapTiles' rule (a WALL counts only when it touches FLOOR / POOL). */
export function mapTileOf(d: Dungeon, gx: number, gy: number): number {
	const W = d.W;
	const H = d.H;
	if (gx < 0 || gy < 0 || gx >= W || gy >= H) return MapTile.NONE;
	const t = d.grid[gy * W + gx];
	if (t === TileType.FLOOR) return MapTile.FLOOR;
	if (t === TileType.POOL) return MapTile.POOL;
	if (t !== TileType.WALL) return MapTile.NONE;
	for (let dy = -1; dy <= 1; dy++)
		for (let dx = -1; dx <= 1; dx++) {
			if (dx === 0 && dy === 0) continue;
			const x = gx + dx;
			const y = gy + dy;
			if (x < 0 || y < 0 || x >= W || y >= H) continue;
			if (isOpen(d.grid[y * W + x])) return MapTile.WALL;
		}
	return MapTile.NONE;
}

/**
 * The map change of `plan`'s open on the floor's map `tiles` (built from the Forge grid). Every cell whose carved tile
 * differs from the Forge's lies in the chamber's ring; the cells one past it can only change by touching it, so the
 * scan covers the ring grown by one.
 */
export function secretMapChange(tiles: MinimapTiles, plan: Readonly<FloorSecret>): SecretMapChange {
	const d = plan.dungeon;
	const ring = secretRingRect(plan);
	const cells: number[] = [];
	const values: number[] = [];
	const reveal: number[] = [];
	const W = tiles.W;
	for (let gy = ring.y0 - 1; gy <= ring.y1 + 1; gy++)
		for (let gx = ring.x0 - 1; gx <= ring.x1 + 1; gx++) {
			if (gx < 0 || gy < 0 || gx >= W || gy >= tiles.H) continue;
			const c = gy * W + gx;
			const now = mapTileOf(d, gx, gy);
			if (now !== tiles.tile[c]) {
				cells.push(c);
				values.push(now);
			}
			const inRing = gx >= ring.x0 && gx <= ring.x1 && gy >= ring.y0 && gy <= ring.y1;
			if (inRing && now !== MapTile.NONE) reveal.push(c);
		}
	return { cells, tiles: values, reveal };
}

/**
 * Writes `change` into `tiles` in place (its `tile` array is the floor's one copy: the fog's sight and the painter read
 * it) and returns the changed cells (repaint them). Applying it twice changes nothing more.
 */
export function applySecretMapChange(tiles: MinimapTiles, change: Readonly<SecretMapChange>): ReadonlyArray<number> {
	const tile = tiles.tile as number[];
	for (let i = 0; i < change.cells.size(); i++) tile[change.cells[i]] = change.tiles[i];
	return change.cells;
}

/**
 * The chest's mark for a secret with `status` (shared/sim SecretStatus) and `tier` (VaultTier): undefined while there
 * is none or it is still HIDDEN (no mark before the open: the open reveals the chamber whole on the shared map), filled
 * in treasureFloorRole(tier) once OPEN, hollow once TAKEN (MINIMAP_VIEW.markers.vault's look, at the chest's cell).
 */
export function secretMarkStyle(status: number, tier: number): VaultMarkStyle | undefined {
	if (status !== SecretStatus.OPEN && status !== SecretStatus.TAKEN) return undefined;
	return { role: treasureFloorRole(tier), style: status === SecretStatus.TAKEN ? "hollow" : "fill" };
}

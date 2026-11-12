/**
 * Test support (docs/GOLDLING_RUMOURS.md GR1): the Goldling's barrel or crate is appended to a floor's breakables after
 * every other piece (the clutter, then the vault's chest), and only roomSpawnTiles loses its cell. Specs of the floor
 * outputs placed before it (the clutter, loot, pellets, the vault, the altars) compare against the floor without it.
 */
import type { BreakablePlacement } from "../breakables";
import { withoutBreakableCells } from "../breakables";
import { endlessRoomSpawnTiles, type EndlessFloorLayout } from "../endless";

/** The floor's pieces before the Goldling's (all of them on a floor without a Goldling), slot order. */
export function piecesBeforeGolden(l: EndlessFloorLayout): BreakablePlacement[] {
	const all = l.breakables ?? [];
	const n = l.golden !== undefined ? l.golden.piece : all.size();
	const out: BreakablePlacement[] = [];
	for (let i = 0; i < n; i++) out.push(all[i]);
	return out;
}

/**
 * `l` as it was before the Goldling brought its own piece: the pieces before it, roomSpawnTiles with its cell back
 * (recomputed from the room spawns and those pieces) and no Goldling. Every other field is `l`'s. Pure.
 */
export function withoutGoldenPiece(l: EndlessFloorLayout): EndlessFloorLayout {
	const pieces = piecesBeforeGolden(l);
	return {
		...l,
		breakables: l.breakables !== undefined ? pieces : undefined,
		roomSpawnTiles: withoutBreakableCells(endlessRoomSpawnTiles(l.dungeon, l.roomSpawns), pieces),
		golden: undefined,
	};
}

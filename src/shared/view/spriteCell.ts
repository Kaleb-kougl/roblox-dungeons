/**
 * Per-sheet cells (docs/DEMON_ART.md DD4, sprite contract v2 SpriteSheetImage.frameW / frameH / pivot): a sprite set
 * whose sheets are trimmed to their own animations draws each sheet's frames in a billboard of that sheet's cell size,
 * with that sheet's pivot on the feet. Every sheet's pivot marks the same point of the art, so the feet stay planted
 * when the drawn sheet changes. Plain numbers (no Roblox types); the actor SpriteView applies it.
 *
 * @module
 */
import type { Pivot } from "shared/theme";
import type { SpriteLayout } from "./sprites";

/** A sprite set's own cell: the set-level frameW / frameH / pivot. */
export type SpriteSetCell = Pick<SpriteLayout, "frameW" | "frameH" | "pivot">;

/**
 * The billboard layout for one sheet's cell (`cellW` x `cellH`, feet at `cellPivot`) of a set whose own cell is `set`,
 * drawn through `layout` (the set itself, or a caller's adjusted copy: another pixelsPerTile, a moved pivot). The cell
 * takes the sheet's size; the pivot is `layout.pivot` moved by the sheet pivot's offset from the set's, so a caller's
 * pivot adjustment carries over; pixelsPerTile is `layout`'s (texel density is per set). A sheet in the set's own cell
 * returns `layout` itself, so a set without per-sheet cells draws exactly as before.
 */
export function sheetSpriteLayout(
	layout: SpriteLayout,
	set: SpriteSetCell,
	cellW: number,
	cellH: number,
	cellPivot: Readonly<Pivot>,
): SpriteLayout {
	if (cellW === set.frameW && cellH === set.frameH && cellPivot.x === set.pivot.x && cellPivot.y === set.pivot.y) {
		return layout;
	}
	return {
		frameW: cellW,
		frameH: cellH,
		pivot: { x: layout.pivot.x + cellPivot.x - set.pivot.x, y: layout.pivot.y + cellPivot.y - set.pivot.y },
		pixelsPerTile: layout.pixelsPerTile,
	};
}

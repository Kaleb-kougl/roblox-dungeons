/**
 * The `vale` pack's projectile sprites (`bullet.*`, docs/PROJECTILE_ART.md PA6), built from the generated
 * bulletLayout.ts. Like every vale entry, the art switches on only once the PNG it needs has an ID in assetIds.ts:
 * a bullet needs the bullet atlas (VALE_BULLET_SHEET, `bullets.png`), or, for a layout with `sheet`, that sheet of its
 * own (VALE_BULLET_OWN_SHEETS: the flame and the hook in `bullets-2.png`, docs/NEW_ENEMIES_2.md NX8, so bullets.png
 * never repacks for them). A bullet whose sheet has no ID stays the placeholder pack's neon part.
 *
 * Each layout entry becomes a one-facing `sprites` set (contract.ts BULLET: the `fly` loop, art pointing screen-up)
 * at the layout's own texel density, carrying the pipeline's `meanColor` for the bullet colour rules
 * (bulletArt.ts `bulletArtReport`). The floor decals (goo, strike, ember) have no layout entry and keep their
 * placeholders.
 *
 * @module
 */
import { BULLET_ART } from "../../contract";
import type { SpriteSetAsset } from "../../types";
import { sortedKeys } from "../../util";
import {
	VALE_BULLET_FX_LAYOUTS,
	VALE_BULLET_LAYOUTS,
	VALE_BULLET_OWN_SHEETS,
	VALE_BULLET_SHEET,
	type ValeBulletLayout,
} from "./bulletLayout";
import type { ValeFxLayout } from "./fxLayout";
import type { ValeSheetFile } from "./layout";

type AssetIds = Readonly<Record<string, string>>;

/**
 * The bullet atlas and its layouts (VALE_BULLET_SHEET / VALE_BULLET_LAYOUTS; specs pass synthetic ones). `fx`: the
 * effects packed into the same sheet (VALE_BULLET_FX_LAYOUTS, docs/PROJECTILE_ART.md PA7; fx.ts draws them, absent:
 * none).
 */
export interface ValeBulletSource {
	readonly sheet: Readonly<ValeSheetFile>;
	readonly layouts: Readonly<Record<string, Readonly<ValeBulletLayout>>>;
	readonly fx?: Readonly<Record<string, Readonly<ValeFxLayout>>>;
	/** The sheets of their own a layout's `sheet` names, by file (VALE_BULLET_OWN_SHEETS; absent: none). */
	readonly ownSheets?: Readonly<Record<string, Readonly<ValeSheetFile>>>;
}

/** The generated source. */
export const VALE_BULLET_SOURCE: ValeBulletSource = {
	sheet: VALE_BULLET_SHEET,
	layouts: VALE_BULLET_LAYOUTS,
	fx: VALE_BULLET_FX_LAYOUTS,
	ownSheets: VALE_BULLET_OWN_SHEETS,
};

/**
 * The bullet.* sprite sets for `ids`: one per entry of `source.layouts` (keyed by bullet ID) whose sheet has an ID
 * (`source.sheet`, or the own sheet its `sheet` names), else none for that entry (the manifest keeps its placeholder).
 * Pure: fresh tables every call.
 */
export function valeBulletAssets(
	ids: AssetIds,
	source: ValeBulletSource = VALE_BULLET_SOURCE,
): Record<string, SpriteSetAsset> {
	const out: Record<string, SpriteSetAsset> = {};
	for (const id of sortedKeys(source.layouts)) {
		const l = source.layouts[id];
		const sheet = l.sheet === undefined ? source.sheet : source.ownSheets?.[l.sheet];
		const assetId = sheet !== undefined ? ids[sheet.file] : undefined;
		if (sheet === undefined || assetId === undefined) {
			continue;
		}
		out[id] = {
			kind: "sprites",
			frameW: l.frameW,
			frameH: l.frameH,
			pivot: { x: l.pivot.x, y: l.pivot.y },
			pixelsPerTile: l.pixelsPerTile,
			resample: "Pixelated",
			facings: { count: 1, zeroDeg: 0, ccw: true },
			sheets: [
				{
					assetId: assetId as SpriteSetAsset["sheets"][number]["assetId"],
					w: sheet.w,
					h: sheet.h,
				},
			],
			animations: {
				[BULLET_ART.animation]: { sheet: 0, start: l.start, frames: l.frames, fps: l.fps, loop: true },
			},
			meanColor: l.meanColor,
		};
	}
	return out;
}

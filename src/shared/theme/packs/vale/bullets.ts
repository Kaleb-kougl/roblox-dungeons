/**
 * The `vale` pack's projectile sprites (`bullet.*`, docs/PROJECTILE_ART.md PA6), built from the generated
 * bulletLayout.ts. Like every vale entry, the art switches on only once the PNG it needs has an ID in assetIds.ts:
 * every bullet needs the one bullet atlas (VALE_BULLET_SHEET, `bullets.png`). With no ID nothing here applies and
 * every `bullet.*` stays the placeholder pack's neon part.
 *
 * Each layout entry becomes a one-facing `sprites` set (contract.ts BULLET: the `fly` loop, art pointing screen-up)
 * at the layout's own texel density, carrying the pipeline's `meanColor` for the bullet colour rules
 * (bulletArt.ts `bulletArtReport`). The floor decals (goo, strike, ember) have no layout entry and keep their
 * placeholders.
 */
import { BULLET_ART } from "../../contract";
import type { SpriteSetAsset } from "../../types";
import { sortedKeys } from "../../util";
import { VALE_BULLET_FX_LAYOUTS, VALE_BULLET_LAYOUTS, VALE_BULLET_SHEET, type ValeBulletLayout } from "./bulletLayout";
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
}

/** The generated source. */
export const VALE_BULLET_SOURCE: ValeBulletSource = {
	sheet: VALE_BULLET_SHEET,
	layouts: VALE_BULLET_LAYOUTS,
	fx: VALE_BULLET_FX_LAYOUTS,
};

/**
 * The bullet.* sprite sets for `ids`: one per entry of `source.layouts` (keyed by bullet ID) once `source.sheet` has
 * an ID, else none (the manifest keeps the placeholders). Pure: fresh tables every call.
 */
export function valeBulletAssets(
	ids: AssetIds,
	source: ValeBulletSource = VALE_BULLET_SOURCE,
): Record<string, SpriteSetAsset> {
	const out: Record<string, SpriteSetAsset> = {};
	const assetId = ids[source.sheet.file];
	if (assetId === undefined) {
		return out;
	}
	for (const id of sortedKeys(source.layouts)) {
		const l = source.layouts[id];
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
					w: source.sheet.w,
					h: source.sheet.h,
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

/**
 * The `vale` pack's goo puddle floor sprite (`bullet.enemy.goo`, docs/GOO_ART.md GA2), built from the generated
 * gooLayout.ts. Like every vale entry, the art switches on only once the PNG it needs has an ID in assetIds.ts (the goo
 * sheet VALE_GOO_SHEET, `goo.png`). With no ID nothing here applies and the goo stays the placeholder pack's neon disc.
 *
 * The layout becomes a one-facing `sprites` set (contract.ts BULLET_ART floor sprite: `land` one cell, `hold` the
 * variants, never turned) at the layout's own texel density, carrying the pipeline's `meanColor` and the hold frame's
 * lit box `lit` for the goo rules (gooArt.ts `gooArtReport`) and the renderer's cover-the-hit size.
 *
 * @module
 */
import { BULLET_ART } from "../../contract";
import type { SpriteSetAsset } from "../../types";
import { VALE_GOO_LAYOUT, VALE_GOO_SHEET, type ValeGooLayout } from "./gooLayout";
import type { ValeSheetFile } from "./layout";

type AssetIds = Readonly<Record<string, string>>;

/** The goo's ID (BULLET_ART.floorSpriteIds: the one floor sprite). */
const GOO_ID = BULLET_ART.floorSpriteIds[0];

/**
 * The `fps` the set's two animations carry (the validator needs one in (0, MAX_ANIMATION_FPS]); never played: the
 * renderer picks the land cell, then a hold variant per puddle (shared/view gooSpriteLook).
 */
const STILL_FPS = 1;

/** The goo sheet and its layout (VALE_GOO_SHEET / VALE_GOO_LAYOUT; specs pass synthetic ones). */
export interface ValeGooSource {
	readonly sheet: Readonly<ValeSheetFile>;
	readonly layout: Readonly<ValeGooLayout>;
}

/** The generated source. */
export const VALE_GOO_SOURCE: ValeGooSource = { sheet: VALE_GOO_SHEET, layout: VALE_GOO_LAYOUT };

/**
 * The `bullet.enemy.goo` floor sprite set for `ids` once `source.sheet` has an ID, else none (the manifest keeps the
 * placeholder disc). Pure: fresh tables every call.
 */
export function valeGooAsset(ids: AssetIds, source: ValeGooSource = VALE_GOO_SOURCE): Record<string, SpriteSetAsset> {
	const out: Record<string, SpriteSetAsset> = {};
	const assetId = ids[source.sheet.file];
	if (assetId === undefined) {
		return out;
	}
	const l = source.layout;
	out[GOO_ID] = {
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
			[BULLET_ART.land]: { sheet: 0, start: l.land, frames: BULLET_ART.landFrames, fps: STILL_FPS, loop: false },
			[BULLET_ART.hold]: { sheet: 0, start: l.hold, frames: l.holdFrames, fps: STILL_FPS, loop: false },
		},
		meanColor: l.meanColor,
		lit: { w: l.litW, h: l.litH },
	};
	return out;
}

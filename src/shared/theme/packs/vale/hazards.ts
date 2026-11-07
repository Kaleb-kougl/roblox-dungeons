/**
 * The `vale` pack's floor hazard sprites (`bullet.enemy.strike`, `bullet.player.ember`, docs/HAZARD_ART.md HA3), built
 * from the generated hazardLayout.ts: original greyscale art (scripts/art/gen-hazard-art.js) in its own sheet
 * VALE_HAZARD_SHEET, `hazards.png`. Like every vale entry, the art switches on only once that PNG has an ID in
 * assetIds.ts; with no ID nothing here applies and both hazards stay the placeholder pack's neon discs.
 *
 * Each layout becomes a one-facing Pixelated `sprites` set (contract.ts BULLET_ART hazard sprite: the strike's `flash`
 * / `scorch`, the ember's `burn`) at the layout's own texel density, carrying the pipeline's grey `meanColor` and the
 * strike's hit rim `rimPx` or the ember's patch `lit` for hazardArt.ts `hazardArtReport` and the renderer's size.
 */
import type { SpriteSetAsset } from "../../types";
import { sortedKeys } from "../../util";
import { VALE_HAZARD_LAYOUTS, VALE_HAZARD_SHEET, type ValeHazardLayout } from "./hazardLayout";
import type { ValeSheetFile } from "./layout";

type AssetIds = Readonly<Record<string, string>>;

/** The hazard sheet and its layouts (VALE_HAZARD_SHEET / VALE_HAZARD_LAYOUTS; specs pass synthetic ones). */
export interface ValeHazardSource {
	readonly sheet: Readonly<ValeSheetFile>;
	readonly layouts: Readonly<Record<string, ValeHazardLayout>>;
}

/** The generated source. */
export const VALE_HAZARD_SOURCE: ValeHazardSource = { sheet: VALE_HAZARD_SHEET, layouts: VALE_HAZARD_LAYOUTS };

/**
 * The hazard sprite sets for `ids` once `source.sheet` has an ID, else none (the manifest keeps the placeholder discs).
 * Pure: fresh tables every call.
 */
export function valeHazardAssets(
	ids: AssetIds,
	source: ValeHazardSource = VALE_HAZARD_SOURCE,
): Record<string, SpriteSetAsset> {
	const out: Record<string, SpriteSetAsset> = {};
	const assetId = ids[source.sheet.file];
	if (assetId === undefined) {
		return out;
	}
	for (const id of sortedKeys(source.layouts)) {
		const l = source.layouts[id];
		const animations: SpriteSetAsset["animations"] = {};
		for (const name of sortedKeys(l.animations)) {
			const a = l.animations[name];
			animations[name] = { sheet: 0, start: a.start, frames: a.frames, fps: a.fps, loop: a.loop };
		}
		const set: SpriteSetAsset = {
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
			animations,
			meanColor: l.meanColor,
		};
		if (l.rimPx !== undefined) set.rimPx = l.rimPx;
		if (l.lit !== undefined) set.lit = { w: l.lit.w, h: l.lit.h };
		out[id] = set;
	}
	return out;
}

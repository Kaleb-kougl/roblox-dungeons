/**
 * The `vale` pack's boost auras (`fx.boost.aura.<kind>`, docs/BOOST_ART.md BAD3), built from the generated
 * boostAuraLayout.ts: original pixel-art rings (scripts/art/gen-boost-auras.js) in their own sheet
 * VALE_BOOST_AURA_SHEET, `boost-auras.png`. Like every vale entry, the art switches on only once that PNG has an ID in
 * assetIds.ts; with none, the pack has no aura entry (the fx slot is optional) and BoostAuraController draws the
 * placeholder pack's Neon discs.
 *
 * Each layout becomes a one-facing fx `sprites` set (contract FX rules) carrying every stack rank (boostAuraArt.ts):
 * `play` is rank 0's loop, `rank.<r>` rank r's (cells start + r * frames), `ringPx` each rank's ring radius in art px
 * from the pivot, tinted by the kind's own role `boost.<kind>` (the greyscale art's white = the role), additive (a
 * self-lit glow like the disc), at the art's own pixelsPerTile (the renderer sizes each rank from its ring instead).
 *
 * @module
 */
import { boostAuraKindOf, boostAuraRankAnimation } from "../../boostAuraArt";
import { BOOST_KINDS, boostAuraFxId, boostId, type BoostFxId } from "../../contract";
import type { SpriteSetAsset } from "../../types";
import { sortedKeys } from "../../util";
import { VALE_BOOST_AURA_LAYOUTS, VALE_BOOST_AURA_SHEET, type ValeBoostAuraLayout } from "./boostAuraLayout";
import type { ValeSheetFile } from "./layout";

type AssetIds = Readonly<Record<string, string>>;

/** The aura IDs vale draws from boostAuras.ts, in BOOST_KINDS order (every kind's). */
export const VALE_BOOST_AURA_IDS: ReadonlyArray<BoostFxId> = BOOST_KINDS.map((k) => boostAuraFxId(k));

/** The aura sheet and its layouts (VALE_BOOST_AURA_SHEET / VALE_BOOST_AURA_LAYOUTS; specs pass synthetic ones). */
export interface ValeBoostAuraSource {
	readonly sheet: Readonly<ValeSheetFile>;
	readonly layouts: Readonly<Record<string, Readonly<ValeBoostAuraLayout>>>;
}

/** The generated source. */
export const VALE_BOOST_AURA_SOURCE: ValeBoostAuraSource = {
	sheet: VALE_BOOST_AURA_SHEET,
	layouts: VALE_BOOST_AURA_LAYOUTS,
};

/**
 * The fx.boost.aura.<kind> sprite sets for `ids` once `source.sheet` has an ID, else none. A layout whose ID is not an
 * aura ID is skipped. Pure: fresh tables every call.
 */
export function valeBoostAuraAssets(
	ids: AssetIds,
	source: ValeBoostAuraSource = VALE_BOOST_AURA_SOURCE,
): Record<string, SpriteSetAsset> {
	const out: Record<string, SpriteSetAsset> = {};
	const assetId = ids[source.sheet.file];
	if (assetId === undefined) {
		return out;
	}
	for (const id of sortedKeys(source.layouts)) {
		const kind = boostAuraKindOf(id);
		if (kind === undefined) {
			continue;
		}
		const l = source.layouts[id];
		const animations: SpriteSetAsset["animations"] = {};
		for (let r = 0; r < l.ringPx.size(); r++) {
			animations[boostAuraRankAnimation(r)] = {
				sheet: 0,
				start: l.start + r * l.frames,
				frames: l.frames,
				fps: l.fps,
				loop: true,
			};
		}
		const ringPx = new Array<number>();
		for (const px of l.ringPx) ringPx.push(px);
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
			animations,
			tint: boostId(kind),
			additive: true,
			ringPx,
		};
	}
	return out;
}

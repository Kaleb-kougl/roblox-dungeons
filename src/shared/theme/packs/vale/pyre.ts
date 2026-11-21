/**
 * The Pyre-keeper's brazier (`enemy.pyre`, docs/NEW_ENEMIES_2.md NX0 correction 6, NX8) in the `vale` pack: the decor
 * brazier's own cells in decor-atlas.png (layout.ts VALE_WORLD_LAYOUTS `brazier`, a one-facing `sprites` set) aliased
 * into the enemy slot's required animations. No new pixels and no repack: idle / move / attack / hit are the brazier's
 * 8 `lit` cells (the burning bowl; a pyre never moves or attacks, its hit flash keeps the flame), death its one `idle`
 * cell (the unlit bowl, the corpse). The decor-only fields (`glow` / `glowAt`, `outlines`, `layer`) are left out: the
 * flame's glow and light pool are the view's (NX7). No rim: decor-atlas.png has no outline sheet, so the pyre draws
 * rimless like the decor brazier. Like every vale entry it switches on only once the sheet has an ID (decor-atlas.png,
 * uploaded with the decor), else the placeholder stays.
 *
 * @module
 */
import { ENEMY } from "../../contract";
import type { SpriteAnimationDef, SpriteSetAsset, SpriteSheetImage } from "../../types";
import { deepClone } from "../../util";
import { VALE_WORLD_LAYOUTS, type ValeWorldLayout } from "./layout";

type AssetIds = Readonly<Record<string, string>>;

/** Which world art fills `enemy.pyre`, and which of its animations stand for the lit and the unlit brazier. */
export const VALE_PYRE_ART = {
	id: `${ENEMY.prefix}pyre`,
	/** A VALE_WORLD_LAYOUTS name (a one-facing `sprites` set). */
	art: "brazier",
	/** Its burning loop: idle / move / attack / hit. */
	lit: "lit",
	/** Its unlit cell: death (the corpse). */
	unlit: "idle",
} as const;

/** One animation of `layout` as a fresh def with `loop` (the cells, fps and sheet are the brazier's). */
function aliasOf(layout: ValeWorldLayout, name: string, loop: boolean): SpriteAnimationDef {
	if (layout.kind !== "sprites") error(`vale: ${VALE_PYRE_ART.art} is not a sprites set`, 0);
	const def = layout.animations[name];
	if (def === undefined) error(`vale: ${VALE_PYRE_ART.art} has no animation ${name}`, 0);
	const out = deepClone(def);
	out.loop = loop;
	return out;
}

/**
 * The `enemy.pyre` sprite set over the brazier's cells for `ids`, or undefined (the placeholder stays) while its sheet
 * has no ID. `layout`: specs pass a synthetic one. Pure: a fresh table every call.
 */
export function valePyreAsset(
	ids: AssetIds,
	layout: ValeWorldLayout | undefined = VALE_WORLD_LAYOUTS[VALE_PYRE_ART.art],
): SpriteSetAsset | undefined {
	if (layout === undefined || layout.kind !== "sprites") return undefined;
	const sheets = new Array<SpriteSheetImage>();
	for (const sheet of layout.sheets) {
		const assetId = ids[sheet.file];
		if (assetId === undefined) return undefined;
		sheets.push({ assetId: assetId as SpriteSheetImage["assetId"], w: sheet.w, h: sheet.h });
	}
	return {
		kind: "sprites",
		frameW: layout.frameW,
		frameH: layout.frameH,
		pivot: { x: layout.pivot.x, y: layout.pivot.y },
		pixelsPerTile: layout.pixelsPerTile,
		resample: layout.resample,
		facings: { count: layout.facings.count, zeroDeg: layout.facings.zeroDeg, ccw: layout.facings.ccw },
		sheets,
		animations: {
			idle: aliasOf(layout, VALE_PYRE_ART.lit, true),
			move: aliasOf(layout, VALE_PYRE_ART.lit, true),
			attack: aliasOf(layout, VALE_PYRE_ART.lit, true),
			hit: aliasOf(layout, VALE_PYRE_ART.lit, false),
			death: aliasOf(layout, VALE_PYRE_ART.unlit, false),
		},
	};
}

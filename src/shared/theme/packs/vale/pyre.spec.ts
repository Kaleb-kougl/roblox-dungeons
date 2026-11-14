// The Pyre-keeper's brazier in the vale pack (docs/NEW_ENEMIES_2.md NX0 correction 6, NX8): `enemy.pyre` is the decor
// brazier's own cells in decor-atlas.png, every required enemy animation aliased (lit loop / unlit corpse), no new
// pixels; the placeholder until that sheet has an ID.
import { describe, expect, it } from "@rbxts/jest-globals";
import { ENEMY, requiredBaseAnimations } from "../../contract";
import { ThemePack } from "../../pack";
import { PLACEHOLDER_MANIFEST } from "../placeholder";
import type { SpriteSetAsset } from "../../types";
import { sortedKeys } from "../../util";
import { validateManifest } from "../../validate";
import { VALE_ASSET_IDS } from "./assetIds";
import { VALE_WORLD_LAYOUTS, type ValeWorldLayout } from "./layout";
import { VALE_MANIFEST, buildValeManifest } from "./manifest";
import { VALE_PYRE_ART, valePyreAsset } from "./pyre";

const quiet = () => undefined;
/** A fake upload (test vector) for the decor atlas. */
const DECOR_ID = "rbxassetid://7400";

function brazier(): ValeWorldLayout & { kind: "sprites" } {
	const l = VALE_WORLD_LAYOUTS[VALE_PYRE_ART.art];
	expect(l !== undefined && l.kind === "sprites").toBe(true);
	return l as ValeWorldLayout & { kind: "sprites" };
}

describe("vale enemy.pyre (docs/NEW_ENEMIES_2.md NX8)", () => {
	it("names the enemy slot's pyre and the brazier's lit loop and unlit cell", () => {
		expect(VALE_PYRE_ART.id).toBe("enemy.pyre");
		expect(PLACEHOLDER_MANIFEST.assets[VALE_PYRE_ART.id]).never.toBe(undefined);
		const l = brazier();
		expect(l.animations[VALE_PYRE_ART.lit] !== undefined).toBe(true);
		expect(l.animations[VALE_PYRE_ART.unlit] !== undefined).toBe(true);
	});

	it("is the placeholder until the brazier's sheet has an ID", () => {
		const file = brazier().sheets[0].file;
		const without: Record<string, string> = {};
		for (const f of sortedKeys(VALE_ASSET_IDS)) {
			if (f !== file) without[f] = VALE_ASSET_IDS[f];
		}
		expect(valePyreAsset({})).toBe(undefined);
		expect(buildValeManifest(without).assets[VALE_PYRE_ART.id]).toEqual(
			PLACEHOLDER_MANIFEST.assets[VALE_PYRE_ART.id],
		);
	});

	it("aliases every required enemy animation onto the brazier's own cells: no new pixels", () => {
		const l = brazier();
		const set = valePyreAsset({ [l.sheets[0].file]: DECOR_ID })!;
		expect(set.kind).toBe("sprites");
		expect(sortedKeys(set.animations)).toEqual([...requiredBaseAnimations(ENEMY)].sort());
		const lit = l.animations[VALE_PYRE_ART.lit];
		const unlit = l.animations[VALE_PYRE_ART.unlit];
		for (const name of ["idle", "move", "attack", "hit"]) {
			const a = set.animations[name];
			expect([name, a.sheet, a.start, a.frames, a.fps]).toEqual([
				name,
				lit.sheet,
				lit.start,
				lit.frames,
				lit.fps,
			]);
		}
		expect([set.animations.idle.loop, set.animations.hit.loop, set.animations.death.loop]).toEqual([
			true,
			false,
			false,
		]);
		const d = set.animations.death;
		expect([d.sheet, d.start, d.frames]).toEqual([unlit.sheet, unlit.start, unlit.frames]);
		// the brazier's sheet, cell, pivot, density and facing exactly; no decor-only fields
		expect(set.sheets).toEqual([{ assetId: DECOR_ID, w: l.sheets[0].w, h: l.sheets[0].h }]);
		expect([set.frameW, set.frameH, set.pivot, set.pixelsPerTile, set.facings.count]).toEqual([
			l.frameW,
			l.frameH,
			l.pivot,
			l.pixelsPerTile,
			1,
		]);
		expect([set.glow, set.glowAt, set.outlines, set.layer]).toEqual([undefined, undefined, undefined, undefined]);
		// fresh tables every call
		expect(valePyreAsset({ [l.sheets[0].file]: DECOR_ID })).never.toBe(set);
	});

	it("validates in the vale manifest and draws (decor-atlas.png is uploaded, so the bundled pack has it)", () => {
		const l = brazier();
		const m = buildValeManifest({ ...VALE_ASSET_IDS, [l.sheets[0].file]: DECOR_ID });
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		expect((m.assets[VALE_PYRE_ART.id] as SpriteSetAsset).kind).toBe("sprites");
		const pack = new ThemePack(m, { warn: quiet });
		expect(pack.sprites(VALE_PYRE_ART.id) !== undefined).toBe(true);
		if (VALE_ASSET_IDS[l.sheets[0].file] !== undefined) {
			expect((VALE_MANIFEST.assets[VALE_PYRE_ART.id] as SpriteSetAsset).kind).toBe("sprites");
		}
	});
});

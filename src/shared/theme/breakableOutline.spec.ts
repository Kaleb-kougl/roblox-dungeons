// Roblox port: the breakable outline (breakableOutline.ts), the yellow rim round every intact barrel and crate: its
// colour role and rules (breakableOutlineReport in variantColors.ts), the view's role, and the vale pack's rim sheet
// (art/atlases.json worldArt `rim` -> decor-atlas-outline.png), which a breakable's sheets carry only once uploaded.
import { describe, expect, it } from "@rbxts/jest-globals";
import { BREAKABLE_KINDS, breakableId } from "./contract";
import { BREAKABLE_OUTLINE_ROLE } from "./breakableOutline";
import { THEME_PACKS } from "./packs";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { VALE_ASSET_IDS, VALE_WORLD_LAYOUTS, buildValeManifest } from "./packs/vale";
import { COLOR_ROLES, type SpriteSetAsset } from "./types";
import { deepClone, sortedKeys, type Obj } from "./util";
import { validateManifest } from "./validate";
import { BREAKABLE_OUTLINE_COLOR_RULES, breakableOutlineReport } from "./variantColors";

const RIM_FILE = "decor-atlas-outline.png";

describe("breakable outline", () => {
	it("is a colour role every pack fills", () => {
		expect(BREAKABLE_OUTLINE_ROLE).toBe("breakableOutline");
		expect(COLOR_ROLES.includes(BREAKABLE_OUTLINE_ROLE)).toBe(true);
		expect([...BREAKABLE_OUTLINE_COLOR_RULES.roles]).toEqual([BREAKABLE_OUTLINE_ROLE]);
		for (const id of sortedKeys(THEME_PACKS)) {
			const pack = THEME_PACKS[id];
			expect([id, typeIs(pack.colors[BREAKABLE_OUTLINE_ROLE], "string")]).toEqual([id, true]);
		}
	});

	it("passes its rules in every pack: >= 3:1 on every biome floor, >= 40 CIE76 from danger and the player rim", () => {
		const entries = breakableOutlineReport(PLACEHOLDER_MANIFEST);
		expect(entries.size()).toBeGreaterThan(0);
		expect(entries.filter((e) => !e.ok)).toEqual([]);
		const against = new Set(entries.filter((e) => e.check === "difference").map((e) => e.against));
		for (const role of ["enemyBullet", "telegraph", "enemyOutline", "playerOutline"]) {
			expect([role, against.has(role)]).toEqual([role, true]);
		}
		for (const id of sortedKeys(THEME_PACKS)) {
			const pack = THEME_PACKS[id];
			expect([id, validateManifest(pack, { packId: id })]).toEqual([id, []]);
		}
	});

	it("rejects an outline that reads as the telegraph", () => {
		const m = deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
		const colors = m.colors as Obj;
		colors[BREAKABLE_OUTLINE_ROLE] = colors.telegraph;
		const errors = validateManifest(m).filter((e) => e.find(BREAKABLE_OUTLINE_ROLE, 1, true)[0] !== undefined);
		expect(errors.size()).toBeGreaterThan(0);
		expect(errors.some((e) => e.find("must never read as danger", 1, true)[0] !== undefined)).toBe(true);
	});

	it("vale: the barrel and crate layouts name the rim sheet; their sheets carry it only once it has an ID", () => {
		for (const kind of BREAKABLE_KINDS) {
			const layout = VALE_WORLD_LAYOUTS[kind];
			expect(layout.kind).toBe("sprites");
			if (layout.kind !== "sprites") continue;
			expect(layout.sheets.map((s) => s.outlineFile)).toEqual([RIM_FILE]);
		}
		const ids: Record<string, string> = {};
		for (const file of sortedKeys(VALE_ASSET_IDS)) if (file !== RIM_FILE) ids[file] = VALE_ASSET_IDS[file];
		const without = buildValeManifest(ids as typeof VALE_ASSET_IDS);
		ids[RIM_FILE] = "rbxassetid://424242";
		const withRim = buildValeManifest(ids as typeof VALE_ASSET_IDS);
		for (const kind of BREAKABLE_KINDS) {
			const before = without.assets[breakableId(kind)] as SpriteSetAsset;
			const after = withRim.assets[breakableId(kind)] as SpriteSetAsset;
			expect(before.sheets.map((s) => s.outlineAssetId)).toEqual([undefined]);
			expect(after.sheets.map((s) => s.outlineAssetId)).toEqual(["rbxassetid://424242"]);
			// the body sheet is unchanged: the rim never moves the decor atlas
			expect(after.sheets.map((s) => s.assetId)).toEqual(before.sheets.map((s) => s.assetId));
		}
		// no other world piece takes the rim (decor keeps its own sheets)
		for (const id of sortedKeys(withRim.assets)) {
			if (BREAKABLE_KINDS.some((k) => breakableId(k) === id)) continue;
			const a = withRim.assets[id] as unknown as Obj;
			if (a.kind !== "sprites") continue;
			for (const s of (a as unknown as SpriteSetAsset).sheets) {
				if (s.outlineAssetId === "rbxassetid://424242") expect(id).toBe("(no other asset)");
			}
		}
		expect(validateManifest(withRim, { packId: "vale" })).toEqual([]);
	});
});

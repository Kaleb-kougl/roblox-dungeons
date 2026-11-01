// Roblox port (docs/DRAFT_REVEAL.md DR3, DRD3): the boon draft's rarity colour roles (bone, blood red, candle gold),
// their validator rules (each on uiPanel, each apart from the rarity below it) and the bundled packs' values.
import { describe, expect, it } from "@rbxts/jest-globals";
import { colorDifference, contrastRatio } from "./color";
import { BOON_RARITY_COLOR_RULES, BOON_RARITY_ROLES } from "./contract";
import { BOON_BUILD_ROLES } from "./builds";
import { THEME_PACKS } from "./packs";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { COLOR_ROLES, type ColorRole } from "./types";
import { deepClone, sortedKeys, type Obj } from "./util";
import { boonRarityReport, validateManifest } from "./validate";

const clone = (): Obj => deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
const colorsOf = (m: Obj) => m.colors as Obj;
const PLACEHOLDER_BOON: ReadonlyArray<[ColorRole, string]> = [
	["boon.common", "#d7d0c0"],
	["boon.rare", "#f46669"],
	["boon.legendary", "#f1bd44"],
];
const fixed1 = (n: number) => "%.1f".format(n);
const fixed2 = (n: number) => "%.2f".format(n);
const RULES = BOON_RARITY_COLOR_RULES;
/** validateManifest on the placeholder with one colour changed. */
const errorsWith = (role: string, hex: string) => {
	const m = clone();
	colorsOf(m)[role] = hex;
	return validateManifest(m);
};

describe("boon rarity: colour roles", () => {
	it("are colour roles in rarity order, with the plan's bars", () => {
		expect([...BOON_RARITY_ROLES]).toEqual(["boon.common", "boon.rare", "boon.legendary"]);
		for (const r of BOON_RARITY_ROLES) {
			expect([r, (COLOR_ROLES as ReadonlyArray<string>).includes(r)]).toEqual([r, true]);
		}
		// The ladder, then docs/BUILDS.md's evolution and duo frames on top of it.
		expect([...RULES.roles]).toEqual([...BOON_RARITY_ROLES, ...BOON_BUILD_ROLES]);
		expect([RULES.panel, RULES.minPanelContrast, RULES.minStepDifference]).toEqual(["uiPanel", 3, 25]);
	});

	it("the placeholder holds the sheet's colours and every bundled pack carries them (vale inherits)", () => {
		for (const [role, hex] of PLACEHOLDER_BOON)
			expect([role, PLACEHOLDER_MANIFEST.colors[role]]).toEqual([role, hex]);
		for (const id of sortedKeys(THEME_PACKS)) {
			for (const [role, hex] of PLACEHOLDER_BOON) {
				expect([id, role, THEME_PACKS[id].colors[role]]).toEqual([id, role, hex]);
			}
		}
	});

	it("are not the loot rarity roles", () => {
		expect(BOON_RARITY_ROLES.some((r) => r.sub(1, 7) === "rarity.")).toBe(false);
	});
});

describe("boon rarity: validator", () => {
	it("the bundled packs validate clean, every rule in the report (numbers printed)", () => {
		const n = RULES.roles.size();
		for (const id of sortedKeys(THEME_PACKS)) {
			const manifest = THEME_PACKS[id];
			expect([id, validateManifest(manifest, { packId: id })]).toEqual([id, []]);
			const report = boonRarityReport(manifest);
			const count = (check: string) => report.filter((e) => e.check === check).size();
			expect([id, count("panel"), count("step")]).toEqual([id, n, n - 1]);
			const colors = manifest.colors as unknown as Record<string, string>;
			for (const e of report) {
				expect([id, e.role, e.check, e.against, e.ok]).toEqual([id, e.role, e.check, e.against, true]);
				if (e.check === "panel") {
					expect(e.value).toBe(contrastRatio(e.color, colors[RULES.panel]));
					expect(e.limit).toBe(RULES.minPanelContrast);
				} else {
					expect(e.value).toBe(colorDifference(e.color, colors[e.against]));
					expect(e.limit).toBe(RULES.minStepDifference);
				}
				print(
					`[boon] ${id} ${e.role} ${e.check} vs ${e.against}: ${
						e.check === "panel" ? `${fixed2(e.value)}:1` : fixed1(e.value)
					}`,
				);
			}
		}
	});

	it("the step rule pairs each rarity with the one below it", () => {
		const steps = boonRarityReport(PLACEHOLDER_MANIFEST).filter((e) => e.check === "step");
		expect(steps.map((e) => [e.role, e.against])).toEqual([
			["boon.rare", "boon.common"],
			["boon.legendary", "boon.rare"],
			["boon.evolved", "boon.legendary"],
			["boon.duo", "boon.evolved"],
		]);
	});

	it("a rarity too dark for the panel fails the panel rule", () => {
		const panel = PLACEHOLDER_MANIFEST.colors.uiPanel;
		expect(errorsWith("boon.rare", "#601818")).toEqual([
			`colors["boon.rare"]: contrast: boon.rare #601818 on uiPanel ${panel} is ${fixed2(
				contrastRatio("#601818", panel),
			)}:1, needs >= 3.0:1: a boon rarity must read on the draft card`,
		]);
	});

	it("a rarity that repeats the one below it fails the step rule", () => {
		expect(errorsWith("boon.legendary", "#f46669")).toEqual([
			'colors["boon.legendary"]: colour difference: boon.legendary #f46669 vs boon.rare #f46669 is 0.0 (CIE76), ' +
				"needs >= 25.0: each boon rarity must read as a new colour after the one below it",
		]);
		const errors = errorsWith("boon.rare", "#d7d0c0");
		expect(errors).toContain(
			'colors["boon.rare"]: colour difference: boon.rare #d7d0c0 vs boon.common #d7d0c0 is 0.0 (CIE76), ' +
				"needs >= 25.0: each boon rarity must read as a new colour after the one below it",
		);
		expect(errors.size()).toBe(1);
	});

	it("requires the roles like every other", () => {
		for (const role of BOON_RARITY_ROLES) {
			const m = clone();
			colorsOf(m)[role] = undefined;
			const errors = validateManifest(m);
			expect([role, errors.size()]).toEqual([role, 1]);
			expect([role, errors[0].find(role, 1, true)[0] !== undefined]).toEqual([role, true]);
			expect(boonRarityReport(m).some((e) => e.role === role)).toBe(false);
		}
	});
});

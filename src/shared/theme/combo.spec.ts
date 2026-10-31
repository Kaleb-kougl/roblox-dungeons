// Roblox port (docs/COMBO.md CB3): the combo's colour roles (one per named tier, then the broken grey), their validator
// rules (every tier, ember too, on uiPanel and apart step to step; the named tiers away from the enemy bullets and the
// telegraph, since the floor shout lies under bullets; combo.broken a low-chroma grey apart from every tier), the
// bundled packs' values, and the combo's strings and audio IDs.
import { describe, expect, it } from "@rbxts/jest-globals";
import { colorDifference, contrastRatio, labChroma } from "./color";
import {
	COMBO_COLOR_RULES,
	COMBO_ROLES,
	COMBO_STRING_KEYS,
	COMBO_TIER_ROLES,
	ENEMY_BULLET_ROLES,
	PORT_AUDIO_EVENTS,
	REQUIRED_ASSET_IDS,
	REQUIRED_STRING_KEYS,
	slotFor,
} from "./contract";
import { ThemePack } from "./pack";
import { THEME_PACKS } from "./packs";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { COLOR_ROLES, type ColorRole } from "./types";
import { deepClone, sortedKeys, startsWith, type Obj } from "./util";
import { comboReport, validateManifest } from "./validate";

const clone = (): Obj => deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
const colorsOf = (m: Obj) => m.colors as Obj;
const PLACEHOLDER_COMBO: ReadonlyArray<[ColorRole, string]> = [
	["combo.rampage", "#f88088"],
	["combo.carnage", "#ff2050"],
	["combo.dominating", "#c850e8"],
	["combo.unstoppable", "#b98cff"],
	["combo.broken", "#6b6a70"],
];
const fixed1 = (n: number) => "%.1f".format(n);
const fixed2 = (n: number) => "%.2f".format(n);
const RULES = COMBO_COLOR_RULES;
/** validateManifest on the placeholder with one colour changed. */
const errorsWith = (role: string, hex: string) => {
	const m = clone();
	colorsOf(m)[role] = hex;
	return validateManifest(m);
};

describe("combo: colour roles", () => {
	it("are colour roles in tier order with ember below x2, and the plan's bars", () => {
		expect([...COMBO_ROLES]).toEqual([
			"combo.rampage",
			"combo.carnage",
			"combo.dominating",
			"combo.unstoppable",
			"combo.broken",
		]);
		for (const r of COMBO_ROLES) expect([r, (COLOR_ROLES as ReadonlyArray<string>).includes(r)]).toEqual([r, true]);
		expect([...COMBO_TIER_ROLES]).toEqual([
			"ember",
			"combo.rampage",
			"combo.carnage",
			"combo.dominating",
			"combo.unstoppable",
		]);
		expect(RULES.tiers).toBe(COMBO_TIER_ROLES);
		expect([...RULES.shouted]).toEqual(["combo.rampage", "combo.carnage", "combo.dominating", "combo.unstoppable"]);
		expect([RULES.broken, RULES.panel]).toEqual(["combo.broken", "uiPanel"]);
		expect([...RULES.shoutAgainst]).toEqual([...ENEMY_BULLET_ROLES, "telegraph"]);
		expect([
			RULES.minPanelContrast,
			RULES.minStepDifference,
			RULES.minShoutDifference,
			RULES.maxBrokenChroma,
			RULES.minBrokenDifference,
		]).toEqual([3, 25, 40, 10, 40]);
	});

	it("the placeholder fills the ladder and every bundled pack carries the roles", () => {
		for (const [role, hex] of PLACEHOLDER_COMBO)
			expect([role, PLACEHOLDER_MANIFEST.colors[role]]).toEqual([role, hex]);
		for (const id of sortedKeys(THEME_PACKS)) {
			for (const [role, hex] of PLACEHOLDER_COMBO) {
				expect([id, role, THEME_PACKS[id].colors[role]]).toEqual([id, role, hex]);
			}
		}
	});
});

describe("combo: validator", () => {
	it("the bundled packs validate clean, every rule in the report (numbers printed)", () => {
		const tiers = RULES.tiers.size();
		const shouts = RULES.shouted.size();
		for (const id of sortedKeys(THEME_PACKS)) {
			const manifest = THEME_PACKS[id];
			expect([id, validateManifest(manifest, { packId: id })]).toEqual([id, []]);
			const report = comboReport(manifest);
			const count = (check: string) => report.filter((e) => e.check === check).size();
			expect([id, count("panel"), count("step"), count("shout"), count("chroma"), count("broken")]).toEqual([
				id,
				tiers,
				tiers - 1,
				shouts * RULES.shoutAgainst.size(),
				1,
				tiers,
			]);
			const colors = manifest.colors as unknown as Record<string, string>;
			for (const e of report) {
				expect([id, e.role, e.check, e.against, e.ok]).toEqual([id, e.role, e.check, e.against, true]);
				if (e.check === "panel") {
					expect(e.value).toBe(contrastRatio(e.color, colors[RULES.panel]));
					expect(e.limit).toBe(RULES.minPanelContrast);
				} else if (e.check === "chroma") {
					expect(e.value).toBe(labChroma(e.color));
					expect(e.limit).toBe(RULES.maxBrokenChroma);
				} else {
					expect(e.value).toBe(colorDifference(e.color, colors[e.against]));
				}
			}
			for (const e of report) {
				print(
					`[combo] ${id} ${e.role} ${e.check} vs ${e.against}: ${
						e.check === "panel" ? `${fixed2(e.value)}:1` : fixed1(e.value)
					}`,
				);
			}
		}
	});

	it("the step rule pairs each tier with the one below it, ember first", () => {
		const steps = comboReport(PLACEHOLDER_MANIFEST).filter((e) => e.check === "step");
		expect(steps.map((e) => [e.role, e.against])).toEqual([
			["combo.rampage", "ember"],
			["combo.carnage", "combo.rampage"],
			["combo.dominating", "combo.carnage"],
			["combo.unstoppable", "combo.dominating"],
		]);
	});

	it("the plan's starting coral, crimson and magenta fail the shout rule (why the placeholder moved them)", () => {
		const telegraph = PLACEHOLDER_MANIFEST.colors.telegraph;
		const bullet = PLACEHOLDER_MANIFEST.colors.enemyBullet;
		expect(colorDifference("#ff7a59", telegraph)).toBeLessThan(RULES.minShoutDifference);
		expect(colorDifference("#ff3b6b", bullet)).toBeLessThan(RULES.minShoutDifference);
		expect(colorDifference("#e04bd6", bullet)).toBeLessThan(RULES.minShoutDifference);
		// the violet and the grey pass as planned
		expect(PLACEHOLDER_MANIFEST.colors["combo.unstoppable"]).toBe("#b98cff");
		expect(PLACEHOLDER_MANIFEST.colors["combo.broken"]).toBe("#6b6a70");
	});

	it("a tier too dark for the score panel fails the panel rule", () => {
		const panel = PLACEHOLDER_MANIFEST.colors.uiPanel;
		expect(errorsWith("combo.dominating", "#5020a0")).toEqual([
			`colors["combo.dominating"]: contrast: combo.dominating #5020a0 on uiPanel ${panel} is ${fixed2(
				contrastRatio("#5020a0", panel),
			)}:1, needs >= 3.0:1: a combo tier must read on the score panel`,
		]);
	});

	it("ember is a tier too: a dark ember fails the panel rule (and sits too close to the grey)", () => {
		const errors = errorsWith("ember", "#605030");
		expect(errors).toContain(
			`colors.ember: contrast: ember #605030 on uiPanel ${PLACEHOLDER_MANIFEST.colors.uiPanel} is ${fixed2(
				contrastRatio("#605030", PLACEHOLDER_MANIFEST.colors.uiPanel),
			)}:1, needs >= 3.0:1: a combo tier must read on the score panel`,
		);
		expect(errors).toContain(
			`colors["combo.broken"]: colour difference: combo.broken #6b6a70 vs ember #605030 is ${fixed1(
				colorDifference("#6b6a70", "#605030"),
			)} (CIE76), needs >= 40.0: a broken combo must never read as a live tier`,
		);
		expect(errors.size()).toBe(2);
	});

	it("a tier that repeats the one below it fails the step rule", () => {
		expect(errorsWith("combo.carnage", "#f88088")).toEqual([
			'colors["combo.carnage"]: colour difference: combo.carnage #f88088 vs combo.rampage #f88088 is 0.0 (CIE76), ' +
				"needs >= 25.0: each combo tier must read as a new colour after the one below it",
		]);
		expect(errorsWith("ember", "#f88088")).toEqual([
			'colors["combo.rampage"]: colour difference: combo.rampage #f88088 vs ember #f88088 is 0.0 (CIE76), ' +
				"needs >= 25.0: each combo tier must read as a new colour after the one below it",
		]);
	});

	it("a tier near the telegraph or the bullet fails the shout rule", () => {
		const telegraph = PLACEHOLDER_MANIFEST.colors.telegraph;
		expect(errorsWith("combo.rampage", "#ff7a59")).toEqual([
			`colors["combo.rampage"]: colour difference: combo.rampage #ff7a59 vs telegraph ${telegraph} is ${fixed1(
				colorDifference("#ff7a59", telegraph),
			)} (CIE76), needs >= 40.0: a combo tier must never read as an enemy bullet or a telegraph (the floor shout ` +
				"lies under bullets)",
		]);
		const bullet = PLACEHOLDER_MANIFEST.colors.enemyBullet;
		const errors = errorsWith("combo.dominating", bullet);
		expect(errors).toContain(
			`colors["combo.dominating"]: colour difference: combo.dominating ${bullet} vs enemyBullet ${bullet} is 0.0 ` +
				"(CIE76), needs >= 40.0: a combo tier must never read as an enemy bullet or a telegraph (the floor shout " +
				"lies under bullets)",
		);
		for (const e of errors) expect([e, startsWith(e, 'colors["combo.')]).toEqual([e, true]);
	});

	it("ember is not held to the shout rule (only the named tiers are shouted)", () => {
		expect(colorDifference(PLACEHOLDER_MANIFEST.colors.ember, PLACEHOLDER_MANIFEST.colors.telegraph)).toBeLessThan(
			RULES.minShoutDifference,
		);
		expect(comboReport(PLACEHOLDER_MANIFEST).some((e) => e.role === "ember" && e.check === "shout")).toBe(false);
	});

	it("a tinted grey fails the chroma rule", () => {
		expect(errorsWith("combo.broken", "#6b6a90")).toEqual([
			`colors["combo.broken"]: chroma: combo.broken #6b6a90 has C* ${fixed1(
				labChroma("#6b6a90"),
			)} (CIE LCh), needs <= 10.0: a broken combo must read as grey`,
		]);
	});

	it("a tier that turns grey fails the broken rule", () => {
		expect(errorsWith("combo.unstoppable", "#7b7a80")).toEqual([
			`colors["combo.broken"]: colour difference: combo.broken #6b6a70 vs combo.unstoppable #7b7a80 is ${fixed1(
				colorDifference("#6b6a70", "#7b7a80"),
			)} (CIE76), needs >= 40.0: a broken combo must never read as a live tier`,
		]);
	});

	it("requires the roles like every other", () => {
		for (const role of COMBO_ROLES) {
			const m = clone();
			colorsOf(m)[role] = undefined;
			const errors = validateManifest(m);
			expect([role, errors.size()]).toEqual([role, 1]);
			expect([role, errors[0].find(role, 1, true)[0] !== undefined]).toEqual([role, true]);
			expect(comboReport(m).some((e) => e.role === role)).toBe(false);
		}
	});
});

describe("combo: strings and audio IDs", () => {
	const quiet = (): void => {};

	it("requires the tier names, COMBO LOST and BEST x{combo}, filled in every bundled pack", () => {
		expect([...COMBO_STRING_KEYS]).toEqual([
			"hud.combo.rampage",
			"hud.combo.carnage",
			"hud.combo.dominating",
			"hud.combo.unstoppable",
			"hud.combo.lost",
			"hud.combo.best",
		]);
		for (const key of COMBO_STRING_KEYS) expect([key, REQUIRED_STRING_KEYS.includes(key)]).toEqual([key, true]);
		for (const id of sortedKeys(THEME_PACKS)) {
			const pack = new ThemePack(THEME_PACKS[id], { warn: quiet });
			for (const key of COMBO_STRING_KEYS) expect([id, key, pack.hasString(key)]).toEqual([id, key, true]);
		}
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });
		expect(COMBO_STRING_KEYS.map((k) => pack.str(k))).toEqual([
			"RAMPAGE",
			"CARNAGE",
			"DOMINATING",
			"UNSTOPPABLE",
			"COMBO LOST",
			"BEST x{combo}",
		]);
		// the same placeholder as the multiplier's x{combo}
		expect(pack.str("hud.combo.best", { combo: "3.4" })).toBe("BEST x3.4");
		expect(pack.str("hud.score.combo", { combo: "3.4" })).toBe("x3.4");
	});

	it("appends the tier sting and the break to the port's audio IDs, silent in the placeholder", () => {
		// appended after the room clear's three (docs/GRAZE_PARRY.md GP3's two came after them, then
		// docs/DRAFT_REVEAL.md DR4's five)
		const i = (PORT_AUDIO_EVENTS as ReadonlyArray<string>).indexOf("sfx.combo.tier");
		expect([PORT_AUDIO_EVENTS[i - 1], PORT_AUDIO_EVENTS[i], PORT_AUDIO_EVENTS[i + 1]]).toEqual([
			"sfx.score.land",
			"sfx.combo.tier",
			"sfx.combo.break",
		]);
		const assets = PLACEHOLDER_MANIFEST.assets as unknown as Obj;
		for (const id of ["sfx.combo.tier", "sfx.combo.break"]) {
			expect([id, slotFor(id)?.soundGroup, REQUIRED_ASSET_IDS.includes(id), (assets[id] as Obj).kind]).toEqual([
				id,
				"sfx",
				true,
				"silent",
			]);
		}
	});
});

// Roblox port (docs/NEW_BEST.md NB4): the new-best gold (`newBest`), its validator rules (on uiPanel, apart from ember
// and every combo tier, away from the enemy bullets and the telegraph since the floor shout lies under bullets), the
// bundled packs' value, and the celebration's strings and audio IDs.
import { describe, expect, it } from "@rbxts/jest-globals";
import { colorDifference, contrastRatio } from "./color";
import {
	COMBO_TIER_ROLES,
	ENEMY_BULLET_ROLES,
	PORT_AUDIO_EVENTS,
	REQUIRED_ASSET_IDS,
	REQUIRED_STRING_KEYS,
	slotFor,
} from "./contract";
import { NEW_BEST_STRING_KEYS } from "./newBest";
import { NEW_BEST_COLOR_RULES, newBestColorProblems, newBestReport } from "./newBestColors";
import { ThemePack } from "./pack";
import { THEME_PACKS } from "./packs";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { COLOR_ROLES } from "./types";
import { deepClone, sortedKeys, type Obj } from "./util";
import { validateManifest } from "./validate";

const clone = (): Obj => deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
const colorsOf = (m: Obj) => m.colors as Obj;
const fixed1 = (n: number) => "%.1f".format(n);
const fixed2 = (n: number) => "%.2f".format(n);
const RULES = NEW_BEST_COLOR_RULES;
const GOLD = "#ffd700";
/** validateManifest on the placeholder with one colour changed. */
const errorsWith = (role: string, hex: string) => {
	const m = clone();
	colorsOf(m)[role] = hex;
	return validateManifest(m);
};

describe("new best: colour role", () => {
	it("is a colour role with the plan's bars", () => {
		expect((COLOR_ROLES as ReadonlyArray<string>).includes("newBest")).toBe(true);
		expect([RULES.role, RULES.panel]).toEqual(["newBest", "uiPanel"]);
		expect(RULES.apartFrom).toBe(COMBO_TIER_ROLES);
		expect([...RULES.against]).toEqual([...ENEMY_BULLET_ROLES, "telegraph"]);
		expect([RULES.minPanelContrast, RULES.minApart, RULES.minDifference]).toEqual([3, 25, 40]);
	});

	it("the placeholder's gold, carried by every bundled pack", () => {
		expect(PLACEHOLDER_MANIFEST.colors.newBest).toBe(GOLD);
		for (const id of sortedKeys(THEME_PACKS)) expect([id, THEME_PACKS[id].colors.newBest]).toEqual([id, GOLD]);
	});
});

describe("new best: validator", () => {
	it("the bundled packs validate clean, every rule in the report (numbers printed)", () => {
		for (const id of sortedKeys(THEME_PACKS)) {
			const manifest = THEME_PACKS[id];
			expect([id, validateManifest(manifest, { packId: id })]).toEqual([id, []]);
			expect([id, newBestColorProblems(manifest)]).toEqual([id, []]);
			const report = newBestReport(manifest);
			const count = (check: string) => report.filter((e) => e.check === check).size();
			expect([id, count("panel"), count("apart"), count("difference")]).toEqual([
				id,
				1,
				RULES.apartFrom.size(),
				RULES.against.size(),
			]);
			const colors = manifest.colors as unknown as Record<string, string>;
			for (const e of report) {
				expect([id, e.role, e.check, e.against, e.ok]).toEqual([id, "newBest", e.check, e.against, true]);
				expect(e.againstColor).toBe(colors[e.against]);
				if (e.check === "panel") {
					expect([e.value, e.min]).toEqual([
						contrastRatio(e.color, colors[RULES.panel]),
						RULES.minPanelContrast,
					]);
				} else {
					expect(e.value).toBe(colorDifference(e.color, colors[e.against]));
					expect(e.min).toBe(e.check === "apart" ? RULES.minApart : RULES.minDifference);
				}
				print(
					`[newBest] ${id} ${e.check} vs ${e.against}: ${
						e.check === "panel" ? `${fixed2(e.value)}:1` : fixed1(e.value)
					}`,
				);
			}
		}
	});

	it("the plan's starting gold #ffd75e sits too close to ember (why the placeholder moved it)", () => {
		const ember = PLACEHOLDER_MANIFEST.colors.ember;
		expect(colorDifference("#ffd75e", ember)).toBeLessThan(RULES.minApart);
		expect(errorsWith("newBest", "#ffd75e")).toEqual([
			`colors.newBest: colour difference: newBest #ffd75e vs ember ${ember} is ${fixed1(
				colorDifference("#ffd75e", ember),
			)} (CIE76), needs >= 25.0: the new-best gold must read apart from ember and every combo tier`,
		]);
	});

	it("a gold too dark for the score panel fails the panel rule", () => {
		const panel = PLACEHOLDER_MANIFEST.colors.uiPanel;
		const errors = errorsWith("newBest", "#3a3000");
		expect(errors).toContain(
			`colors.newBest: contrast: newBest #3a3000 on uiPanel ${panel} is ${fixed2(
				contrastRatio("#3a3000", panel),
			)}:1, needs >= 3.0:1: the new-best gold must read on the score panel`,
		);
	});

	it("a gold equal to a combo tier fails the apart rule; one near the telegraph or the bullet the difference rule", () => {
		const rampage = PLACEHOLDER_MANIFEST.colors["combo.rampage"];
		expect(errorsWith("newBest", rampage)).toContain(
			`colors.newBest: colour difference: newBest ${rampage} vs combo.rampage ${rampage} is 0.0 (CIE76), ` +
				"needs >= 25.0: the new-best gold must read apart from ember and every combo tier",
		);
		const telegraph = PLACEHOLDER_MANIFEST.colors.telegraph;
		expect(errorsWith("newBest", telegraph)).toContain(
			`colors.newBest: colour difference: newBest ${telegraph} vs telegraph ${telegraph} is 0.0 (CIE76), ` +
				"needs >= 40.0: the new-best gold must never read as an enemy bullet or a telegraph (the floor shout " +
				"lies under bullets)",
		);
		const bullet = PLACEHOLDER_MANIFEST.colors.enemyBullet;
		expect(errorsWith("newBest", bullet)).toContain(
			`colors.newBest: colour difference: newBest ${bullet} vs enemyBullet ${bullet} is 0.0 (CIE76), ` +
				"needs >= 40.0: the new-best gold must never read as an enemy bullet or a telegraph (the floor shout " +
				"lies under bullets)",
		);
	});

	it("a pack that moves ember onto the gold fails the gold's apart rule", () => {
		const errors = errorsWith("ember", GOLD);
		expect(errors).toContain(
			`colors.newBest: colour difference: newBest ${GOLD} vs ember ${GOLD} is 0.0 (CIE76), needs >= 25.0: the ` +
				"new-best gold must read apart from ember and every combo tier",
		);
	});

	it("is required like every role (a missing one: one error, no report)", () => {
		const m = clone();
		colorsOf(m).newBest = undefined;
		const errors = validateManifest(m);
		expect(errors.size()).toBe(1);
		expect(errors[0].find("newBest", 1, true)[0] !== undefined).toBe(true);
		expect(newBestReport(m)).toEqual([]);
		expect(newBestReport(undefined)).toEqual([]);
	});
});

describe("new best: strings and audio IDs", () => {
	const quiet = (): void => {};

	it("requires the eighteen strings, filled in every bundled pack", () => {
		expect([...NEW_BEST_STRING_KEYS]).toEqual([
			"hud.best.toGo",
			"hud.best.toGoShort",
			"hud.best.new",
			"hud.best.over",
			"hud.best.shout",
			"stage.best.toGo",
			"stage.best.oneToGo",
			"stage.best.recordFloor",
			"stage.best.newDeepest",
			"stage.best.deeperYet",
			"run.best.ribbon",
			"run.best.first",
			"run.best.score",
			"run.best.floor",
			"run.best.saved",
			"run.best.unsaved",
			"run.best.target",
			"menu.best",
		]);
		for (const key of NEW_BEST_STRING_KEYS) expect([key, REQUIRED_STRING_KEYS.includes(key)]).toEqual([key, true]);
		for (const id of sortedKeys(THEME_PACKS)) {
			const pack = new ThemePack(THEME_PACKS[id], { warn: quiet });
			for (const key of NEW_BEST_STRING_KEYS) expect([id, key, pack.hasString(key)]).toEqual([id, key, true]);
		}
	});

	it("the placeholder's text and placeholders", () => {
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });
		expect(pack.str("hud.best.toGo", { points: 12340 })).toBe("12340 TO BEST");
		expect(pack.str("hud.best.toGoShort", { points: 12340 })).toBe("-12340");
		expect(pack.str("hud.best.over", { points: 3120 })).toBe("NEW BEST +3120");
		expect([pack.str("hud.best.new"), pack.str("hud.best.shout")]).toEqual(["NEW BEST", "NEW BEST!"]);
		expect(pack.str("stage.best.toGo", { floor: 9, n: 2 })).toBe("Deepest: floor 9 · 2 to go");
		expect(pack.str("stage.best.oneToGo", { floor: 9 })).toBe("Deepest: floor 9 · 1 to go");
		expect([
			pack.str("stage.best.recordFloor"),
			pack.str("stage.best.newDeepest"),
			pack.str("stage.best.deeperYet"),
		]).toEqual(["Record floor", "NEW DEEPEST", "Deepest yet"]);
		expect([pack.str("run.best.ribbon"), pack.str("run.best.first")]).toEqual(["NEW BEST!", "FIRST RECORD"]);
		expect(pack.str("run.best.score", { old: 48210, new: 61930, delta: 13720 })).toBe(
			"Score 48210 -> 61930 (+13720)",
		);
		expect(pack.str("run.best.floor", { old: 9, new: 11, delta: 2 })).toBe("Deepest floor 9 -> 11 (+2)");
		expect([pack.str("run.best.saved"), pack.str("run.best.unsaved")]).toEqual([
			"Saved",
			"Not saved: run not verified",
		]);
		expect(pack.str("run.best.target", { score: 48210, floor: 9 })).toBe("Best 48210 · floor 9");
		expect(pack.str("menu.best", { score: 48210, floor: 9 })).toBe("Best 48210 · floor 9");
	});

	it("appends the in-run fanfare and the record fanfare to the port's audio IDs, silent in the placeholder", () => {
		// right after the enemy variants' block (only docs/BUILDS.md's sounds and docs/DAILY.md DS10's rank layer two come
		// after them)
		const n = (PORT_AUDIO_EVENTS as ReadonlyArray<string>).indexOf("sfx.jingle.record") + 1;
		expect([PORT_AUDIO_EVENTS[n - 3], PORT_AUDIO_EVENTS[n - 2], PORT_AUDIO_EVENTS[n - 1]]).toEqual([
			"sfx.affix.vengeful",
			"sfx.best.new",
			"sfx.jingle.record",
		]);
		const assets = PLACEHOLDER_MANIFEST.assets as unknown as Obj;
		for (const id of ["sfx.best.new", "sfx.jingle.record"]) {
			expect([id, slotFor(id)?.soundGroup, REQUIRED_ASSET_IDS.includes(id), (assets[id] as Obj).kind]).toEqual([
				id,
				"sfx",
				true,
				"silent",
			]);
			// every bundled pack carries them (vale: the placeholder's SILENT until audio:build lists them and their clips
			// are uploaded, NB10; then a sound)
			for (const pack of sortedKeys(THEME_PACKS)) {
				const asset = (THEME_PACKS[pack].assets as unknown as Obj)[id] as Obj;
				expect([pack, id, asset.kind === "silent" || asset.kind === "sound"]).toEqual([pack, id, true]);
			}
		}
	});
});

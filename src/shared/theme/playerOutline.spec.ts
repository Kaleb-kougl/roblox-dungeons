// Roblox port (player outline, step 1): the `playerOutline` colour role and its validator rules (WCAG contrast on every
// biome floor and wall, CIE76 distance from the threat and boost colours, PLAYER_OUTLINE_DIFFERENCE_ROLES). The
// darkest-band half of the contrast rule is in shared/view/decor/profile.spec.ts (the depth bands live there).
import { describe, expect, it } from "@rbxts/jest-globals";
import { colorDifference, contrastRatio } from "./color";
import {
	BIOMES,
	BOOST_ROLES,
	ENEMY_BULLET_ROLES,
	MIN_PLAYER_OUTLINE_CONTRAST,
	MIN_PLAYER_OUTLINE_DIFFERENCE,
	PLAYER_OUTLINE_DIFFERENCE_ROLES,
} from "./contract";
import { THEME_PACKS } from "./packs";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { COLOR_ROLES } from "./types";
import { deepClone, sortedKeys, startsWith, type Obj } from "./util";
import { playerOutlineReport, validateManifest } from "./validate";

const clone = (): Obj => deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
const colorsOf = (m: Obj) => m.colors as Obj;
const OUTLINE = "#f4f1ea";

describe("playerOutline: colour role", () => {
	it("is a colour role, filled in the placeholder pack and inherited by every bundled pack", () => {
		expect((COLOR_ROLES as ReadonlyArray<string>).includes("playerOutline")).toBe(true);
		expect(PLACEHOLDER_MANIFEST.colors.playerOutline).toBe(OUTLINE);
		for (const id of sortedKeys(THEME_PACKS)) {
			expect([id, THEME_PACKS[id].colors.playerOutline]).toEqual([id, OUTLINE]);
		}
		expect(MIN_PLAYER_OUTLINE_CONTRAST).toBe(3);
		expect(MIN_PLAYER_OUTLINE_DIFFERENCE).toBe(40);
	});

	it("is the minimap's 'you' colour, never the enemy rim", () => {
		expect(PLACEHOLDER_MANIFEST.colors.playerOutline).toBe(PLACEHOLDER_MANIFEST.colors["minimap.self"]);
		expect(PLACEHOLDER_MANIFEST.colors.playerOutline).never.toBe(PLACEHOLDER_MANIFEST.colors.enemyOutline);
	});

	it("is kept from the enemy bullets, the telegraph, the enemy rim and every boost colour", () => {
		expect([...PLAYER_OUTLINE_DIFFERENCE_ROLES]).toEqual([
			...ENEMY_BULLET_ROLES,
			"telegraph",
			"enemyOutline",
			...BOOST_ROLES,
		]);
	});
});

describe("playerOutline: validator", () => {
	it("the bundled packs validate clean, every floor / wall and difference role in the report", () => {
		for (const id of sortedKeys(THEME_PACKS)) {
			const manifest = THEME_PACKS[id];
			expect([id, validateManifest(manifest, { packId: id })]).toEqual([id, []]);
			const report = playerOutlineReport(manifest);
			const surfaces = report.filter((e) => e.check === "surface");
			const differences = report.filter((e) => e.check === "difference");
			expect([id, surfaces.size()]).toEqual([id, BIOMES.size() * 2]);
			expect(differences.map((e) => e.against)).toEqual([...PLAYER_OUTLINE_DIFFERENCE_ROLES]);
			for (const e of surfaces) {
				expect([id, e.against, e.surface, e.ok]).toEqual([id, e.against, e.surface, true]);
				expect(e.value).toBe(contrastRatio(OUTLINE, e.againstColor));
				expect(e.min).toBe(MIN_PLAYER_OUTLINE_CONTRAST);
			}
			for (const e of differences) {
				expect([id, e.against, e.ok]).toEqual([id, e.against, true]);
				expect(e.value).toBe(colorDifference(OUTLINE, e.againstColor));
				expect(e.min).toBe(MIN_PLAYER_OUTLINE_DIFFERENCE);
			}
		}
	});

	it("reports an outline in a floor's own colour, per biome surface", () => {
		const m = clone();
		const floor = PLACEHOLDER_MANIFEST.biomes["biome.1"].floor;
		colorsOf(m).playerOutline = floor;
		const errors = validateManifest(m);
		expect(errors.size()).toBeGreaterThan(0);
		for (const e of errors) expect([e, startsWith(e, "colors.playerOutline: ")]).toEqual([e, true]);
		expect(errors).toContain(
			`colors.playerOutline: contrast: playerOutline ${floor} on biome.1 (ancient) floor ${floor} is 1.00:1, needs >= 3.0:1`,
		);
	});

	it("reports an outline in the enemy rim's colour", () => {
		const m = clone();
		const red = PLACEHOLDER_MANIFEST.colors.enemyOutline;
		colorsOf(m).playerOutline = red;
		const errors = validateManifest(m);
		expect(errors).toContain(
			`colors.playerOutline: colour difference: playerOutline ${red} vs enemyOutline ${red} is 0.0 (CIE76), needs >= 40.0: the player's outline must never read as a threat or a boost`,
		);
		for (const e of errors) expect([e, startsWith(e, "colors.playerOutline: ")]).toEqual([e, true]);
	});

	it("reports an outline too close to a boost colour", () => {
		const m = clone();
		const fury = PLACEHOLDER_MANIFEST.colors["boost.fury"];
		colorsOf(m).playerOutline = fury;
		expect(validateManifest(m)).toContain(
			`colors.playerOutline: colour difference: playerOutline ${fury} vs boost.fury ${fury} is 0.0 (CIE76), needs >= 40.0: the player's outline must never read as a threat or a boost`,
		);
	});

	it("requires the role like every other", () => {
		const m = clone();
		colorsOf(m).playerOutline = undefined;
		const errors = validateManifest(m);
		expect(errors.size()).toBe(1);
		expect(errors[0].find("playerOutline", 1, true)[0] !== undefined).toBe(true);
		expect(playerOutlineReport(m)).toEqual([]);
	});
});

// Roblox port (enemy outline plan O1): the `enemyOutline` colour role, its validator rules (WCAG contrast on every
// biome floor and wall, CIE76 distance from the enemy-bullet roles) and which placeholder visuals carry it. The
// darkest-band half of the contrast rule is in shared/view/decor/profile.spec.ts (the depth bands live there).
import { describe, expect, it } from "@rbxts/jest-globals";
import { colorDifference, contrastRatio } from "./color";
import {
	BIOMES,
	BOSS_IDS,
	CLASS_IDS,
	ENDLESS_BOSS_IDS,
	ENEMY_ARCHETYPES,
	ENEMY_BULLET_ROLES,
	MIN_ENEMY_OUTLINE_BULLET_DIFFERENCE,
	MIN_ENEMY_OUTLINE_CONTRAST,
} from "./contract";
import { THEME_PACKS } from "./packs";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { PLACEHOLDER_PREFIX_DEFAULTS, PLACEHOLDER_VISUALS } from "./placeholders";
import { COLOR_ROLES } from "./types";
import { deepClone, sortedKeys, startsWith, type Obj } from "./util";
import { enemyOutlineReport, validateManifest } from "./validate";

const clone = (): Obj => deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
const colorsOf = (m: Obj) => m.colors as Obj;
const OUTLINE = "#ff3b30";

describe("enemyOutline: colour role", () => {
	it("is a colour role, filled in the placeholder pack and inherited by every bundled pack", () => {
		expect((COLOR_ROLES as ReadonlyArray<string>).includes("enemyOutline")).toBe(true);
		expect(PLACEHOLDER_MANIFEST.colors.enemyOutline).toBe(OUTLINE);
		for (const id of sortedKeys(THEME_PACKS)) {
			expect([id, THEME_PACKS[id].colors.enemyOutline]).toEqual([id, OUTLINE]);
		}
		expect(MIN_ENEMY_OUTLINE_CONTRAST).toBe(3);
		expect(MIN_ENEMY_OUTLINE_BULLET_DIFFERENCE).toBe(40);
	});
});

describe("enemyOutline: validator", () => {
	it("the bundled packs validate clean, every floor / wall and bullet role in the report", () => {
		for (const id of sortedKeys(THEME_PACKS)) {
			const manifest = THEME_PACKS[id];
			expect([id, validateManifest(manifest, { packId: id })]).toEqual([id, []]);
			const report = enemyOutlineReport(manifest);
			const surfaces = report.filter((e) => e.check === "surface");
			const bullets = report.filter((e) => e.check === "bullet");
			expect([id, surfaces.size()]).toEqual([id, BIOMES.size() * 2]);
			expect(bullets.map((e) => e.against)).toEqual([...ENEMY_BULLET_ROLES]);
			for (const e of surfaces) {
				expect([id, e.against, e.surface, e.ok]).toEqual([id, e.against, e.surface, true]);
				expect(e.value).toBe(contrastRatio(OUTLINE, e.againstColor));
				expect(e.min).toBe(MIN_ENEMY_OUTLINE_CONTRAST);
			}
			for (const e of bullets) {
				expect([id, e.against, e.ok]).toEqual([id, e.against, true]);
				expect(e.value).toBe(colorDifference(OUTLINE, e.againstColor));
				expect(e.min).toBe(MIN_ENEMY_OUTLINE_BULLET_DIFFERENCE);
			}
		}
	});

	it("reports an outline in a floor's own colour, per biome surface", () => {
		const m = clone();
		const floor = PLACEHOLDER_MANIFEST.biomes["biome.1"].floor;
		colorsOf(m).enemyOutline = floor;
		const errors = validateManifest(m);
		expect(errors.size()).toBeGreaterThan(0);
		for (const e of errors) expect([e, startsWith(e, "colors.enemyOutline: ")]).toEqual([e, true]);
		expect(errors).toContain(
			`colors.enemyOutline: contrast: enemyOutline ${floor} on biome.1 (ancient) floor ${floor} is 1.00:1, needs >= 3.0:1`,
		);
	});

	it("reports an outline too close to the enemy bullet", () => {
		const m = clone();
		colorsOf(m).enemyOutline = "#ff3fa0";
		const d = colorDifference("#ff3fa0", "#ff3fa4");
		expect(d).toBeLessThan(MIN_ENEMY_OUTLINE_BULLET_DIFFERENCE);
		expect(validateManifest(m)).toEqual([
			`colors.enemyOutline: colour difference: enemyOutline #ff3fa0 vs enemyBullet #ff3fa4 is ${"%.1f".format(
				d,
			)} (CIE76), needs >= 40.0: an enemy outline must never read as an enemy bullet`,
		]);
	});

	it("requires the role like every other", () => {
		const m = clone();
		colorsOf(m).enemyOutline = undefined;
		const errors = validateManifest(m);
		expect(errors.size()).toBe(1);
		expect(errors[0].find("enemyOutline", 1, true)[0] !== undefined).toBe(true);
		expect(enemyOutlineReport(m)).toEqual([]);
	});
});

describe("enemyOutline: placeholder visuals", () => {
	it("every enemy archetype and boss carries it; bullets keep theirs; classes have none", () => {
		for (const a of ENEMY_ARCHETYPES) {
			expect([a, PLACEHOLDER_VISUALS[`enemy.${a}`].outline]).toEqual([a, "enemyOutline"]);
		}
		for (const b of [...BOSS_IDS, ...ENDLESS_BOSS_IDS]) {
			expect([b, PLACEHOLDER_VISUALS[b].outline]).toEqual([b, "enemyOutline"]);
		}
		for (const [prefix, v] of PLACEHOLDER_PREFIX_DEFAULTS) {
			if (prefix === "enemy." || prefix === "boss.")
				expect([prefix, v.outline]).toEqual([prefix, "enemyOutline"]);
		}
		for (const id of ["bullet.enemy.small", "bullet.enemy.medium", "bullet.enemy.large", "bullet.enemy.needle"]) {
			expect([id, PLACEHOLDER_VISUALS[id].outline]).toEqual([id, "enemyBulletOutline"]);
		}
		for (const id of ["bullet.player.basic", "bullet.player.heavy"]) {
			expect([id, PLACEHOLDER_VISUALS[id].outline]).toEqual([id, "playerBulletOutline"]);
		}
		for (const c of CLASS_IDS) {
			expect([c, PLACEHOLDER_VISUALS[`class.${c}`].outline === undefined]).toEqual([c, true]);
		}
		for (const id of sortedKeys(PLACEHOLDER_VISUALS)) {
			const enemyLike = startsWith(id, "enemy.") || startsWith(id, "boss.");
			if (!enemyLike) expect([id, PLACEHOLDER_VISUALS[id].outline === "enemyOutline"]).toEqual([id, false]);
		}
	});
});

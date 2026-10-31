// Roblox port (docs/GRAZE_PARRY.md GP3): the near misses' colour roles (the graze spark, the parry's sparks and PARRY!
// floor text), their validator rules (WCAG contrast on every biome floor; CIE76 distance from the enemy-bullet roles and
// telegraph, since the sparks fly among bullets and the text lies under them), the bundled packs' values, and the
// parry flash's strings and the two audio IDs.
import { describe, expect, it } from "@rbxts/jest-globals";
import { colorDifference, contrastRatio } from "./color";
import {
	BIOMES,
	ENEMY_BULLET_ROLES,
	NEAR_MISS_COLOR_RULES,
	NEAR_MISS_ROLES,
	NEAR_MISS_STRING_KEYS,
	PORT_AUDIO_EVENTS,
	REQUIRED_ASSET_IDS,
	REQUIRED_STRING_KEYS,
	slotFor,
} from "./contract";
import { ThemePack } from "./pack";
import { THEME_PACKS } from "./packs";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { VALE_FLOOR_HEX } from "./packs/vale";
import { COLOR_ROLES, type ColorRole } from "./types";
import { deepClone, sortedKeys, startsWith, type Obj } from "./util";
import { nearMissReport, validateManifest } from "./validate";

const clone = (): Obj => deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
const colorsOf = (m: Obj) => m.colors as Obj;
const PLACEHOLDER_NEAR_MISS: ReadonlyArray<[ColorRole, string]> = [
	["nearMiss.graze", "#c8f4ff"],
	["nearMiss.parry", "#ffe9a8"],
];
const fixed1 = (n: number) => "%.1f".format(n);
const fixed2 = (n: number) => "%.2f".format(n);
const RULES = NEAR_MISS_COLOR_RULES;
/** validateManifest on the placeholder with one colour changed. */
const errorsWith = (role: string, hex: string) => {
	const m = clone();
	colorsOf(m)[role] = hex;
	return validateManifest(m);
};
const WHY_DIFFERENCE =
	"a near miss must never read as an enemy bullet or a telegraph (its sparks fly among bullets, the PARRY! text lies " +
	"under them)";

describe("nearMiss: colour roles", () => {
	it("are colour roles (graze, then parry) with the plan's bars", () => {
		expect([...NEAR_MISS_ROLES]).toEqual(["nearMiss.graze", "nearMiss.parry"]);
		for (const r of NEAR_MISS_ROLES)
			expect([r, (COLOR_ROLES as ReadonlyArray<string>).includes(r)]).toEqual([r, true]);
		expect(RULES.roles).toBe(NEAR_MISS_ROLES);
		expect([...RULES.against]).toEqual([...ENEMY_BULLET_ROLES, "telegraph"]);
		expect([RULES.minFloorContrast, RULES.minDifference]).toEqual([3, 40]);
	});

	it("the placeholder fills them and every bundled pack carries the roles", () => {
		for (const [role, hex] of PLACEHOLDER_NEAR_MISS)
			expect([role, PLACEHOLDER_MANIFEST.colors[role]]).toEqual([role, hex]);
		for (const id of sortedKeys(THEME_PACKS)) {
			for (const [role, hex] of PLACEHOLDER_NEAR_MISS) {
				expect([id, role, THEME_PACKS[id].colors[role]]).toEqual([id, role, hex]);
			}
		}
	});
});

describe("nearMiss: validator", () => {
	it("the bundled packs validate clean, every floor and difference in the report (numbers printed)", () => {
		for (const id of sortedKeys(THEME_PACKS)) {
			const manifest = THEME_PACKS[id];
			expect([id, validateManifest(manifest, { packId: id })]).toEqual([id, []]);
			const report = nearMissReport(manifest);
			const floors = report.filter((e) => e.check === "floor");
			const diffs = report.filter((e) => e.check === "difference");
			expect([id, floors.size()]).toEqual([id, NEAR_MISS_ROLES.size() * BIOMES.size()]);
			expect([id, diffs.size()]).toEqual([id, NEAR_MISS_ROLES.size() * RULES.against.size()]);
			for (const e of report) {
				expect([id, e.role, e.check, e.against, e.ok]).toEqual([id, e.role, e.check, e.against, true]);
				if (e.check === "floor") {
					expect(e.value).toBe(contrastRatio(e.color, e.againstColor));
					expect(e.min).toBe(RULES.minFloorContrast);
				} else {
					expect(e.value).toBe(colorDifference(e.color, e.againstColor));
					expect(e.min).toBe(RULES.minDifference);
				}
			}
			for (const role of NEAR_MISS_ROLES) {
				let minContrast = math.huge;
				let minDiff = math.huge;
				let closest = "";
				for (const e of report) {
					if (e.role !== role) continue;
					if (e.check === "floor") minContrast = math.min(minContrast, e.value);
					else if (e.value < minDiff) {
						minDiff = e.value;
						closest = e.against;
					}
				}
				print(
					`[nearMiss] ${id} ${role}: min floor contrast ${fixed2(minContrast)}:1, min CIE76 ${fixed1(
						minDiff,
					)} (${closest})`,
				);
			}
		}
	});

	it("the placeholder values as measured, and vale's darker floor texture colour passes too", () => {
		const report = nearMissReport(PLACEHOLDER_MANIFEST);
		const minOf = (role: string, check: string) => {
			let m = math.huge;
			for (const e of report) if (e.role === role && e.check === check) m = math.min(m, e.value);
			return m;
		};
		expect(fixed2(minOf("nearMiss.graze", "floor"))).toBe("12.44");
		expect(fixed2(minOf("nearMiss.parry", "floor"))).toBe("12.18");
		expect(fixed1(minOf("nearMiss.graze", "difference"))).toBe("88.8");
		expect(fixed1(minOf("nearMiss.parry", "difference"))).toBe("52.9");
		for (const role of NEAR_MISS_ROLES) {
			const hex = PLACEHOLDER_MANIFEST.colors[role];
			expect([role, contrastRatio(hex, VALE_FLOOR_HEX) >= RULES.minFloorContrast]).toEqual([role, true]);
		}
	});

	it("a gold parry too near the telegraph orange fails the difference rule", () => {
		const telegraph = PLACEHOLDER_MANIFEST.colors.telegraph;
		const gold = "#ffc040";
		expect(colorDifference(gold, telegraph)).toBeLessThan(RULES.minDifference);
		expect(errorsWith("nearMiss.parry", gold)).toEqual([
			`colors["nearMiss.parry"]: colour difference: nearMiss.parry ${gold} vs telegraph ${telegraph} is ${fixed1(
				colorDifference(gold, telegraph),
			)} (CIE76), needs >= 40.0: ${WHY_DIFFERENCE}`,
		]);
	});

	it("a graze in the bullet's pink fails the difference rule", () => {
		const bullet = PLACEHOLDER_MANIFEST.colors.enemyBullet;
		const errors = errorsWith("nearMiss.graze", bullet);
		expect(errors).toContain(
			`colors["nearMiss.graze"]: colour difference: nearMiss.graze ${bullet} vs enemyBullet ${bullet} is 0.0 ` +
				`(CIE76), needs >= 40.0: ${WHY_DIFFERENCE}`,
		);
		for (const e of errors) expect([e, startsWith(e, 'colors["nearMiss.graze"]: ')]).toEqual([e, true]);
	});

	it("a dark spark fails the contrast rule, per biome floor", () => {
		const dark = "#2060a0"; // a deep blue: far enough from the bullets (and their dark outline), too dark for the floors
		for (const b of BIOMES) {
			const floor = PLACEHOLDER_MANIFEST.biomes[b.id].floor;
			expect([b.id, contrastRatio(dark, floor) < RULES.minFloorContrast]).toEqual([b.id, true]);
		}
		const errors = errorsWith("nearMiss.graze", dark);
		expect(errors.size()).toBe(BIOMES.size());
		for (const e of errors) {
			expect([e, startsWith(e, `colors["nearMiss.graze"]: contrast: nearMiss.graze ${dark} on `)]).toEqual([
				e,
				true,
			]);
		}
		const floor = PLACEHOLDER_MANIFEST.biomes["biome.1"].floor;
		expect(errors).toContain(
			`colors["nearMiss.graze"]: contrast: nearMiss.graze ${dark} on biome.1 (ancient) floor ${floor} is ${fixed2(
				contrastRatio(dark, floor),
			)}:1, needs >= 3.0:1: a near miss must read on the floor`,
		);
	});

	it("requires the roles like every other", () => {
		for (const role of NEAR_MISS_ROLES) {
			const m = clone();
			colorsOf(m)[role] = undefined;
			const errors = validateManifest(m);
			expect([role, errors.size()]).toEqual([role, 1]);
			expect([role, errors[0].find(role, 1, true)[0] !== undefined]).toEqual([role, true]);
			expect(nearMissReport(m).some((e) => e.role === role)).toBe(false);
		}
	});
});

describe("nearMiss: strings and audio IDs", () => {
	const quiet = (): void => {};

	it("requires PARRY! and its x{n} count, filled in every bundled pack", () => {
		expect([...NEAR_MISS_STRING_KEYS]).toEqual(["fx.parry.text", "fx.parry.count"]);
		for (const key of NEAR_MISS_STRING_KEYS) expect([key, REQUIRED_STRING_KEYS.includes(key)]).toEqual([key, true]);
		for (const id of sortedKeys(THEME_PACKS)) {
			const pack = new ThemePack(THEME_PACKS[id], { warn: quiet });
			for (const key of NEAR_MISS_STRING_KEYS) expect([id, key, pack.hasString(key)]).toEqual([id, key, true]);
		}
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });
		expect(NEAR_MISS_STRING_KEYS.map((k) => pack.str(k))).toEqual(["PARRY!", "x{n}"]);
		expect(`${pack.str("fx.parry.text")} ${pack.str("fx.parry.count", { n: 5 })}`).toBe("PARRY! x5");
	});

	it("appends the graze and the parry to the port's audio IDs, silent in the placeholder", () => {
		const n = PORT_AUDIO_EVENTS.size();
		expect([PORT_AUDIO_EVENTS[n - 2], PORT_AUDIO_EVENTS[n - 1]]).toEqual(["sfx.player.graze", "sfx.player.parry"]);
		const assets = PLACEHOLDER_MANIFEST.assets as unknown as Obj;
		for (const id of ["sfx.player.graze", "sfx.player.parry"]) {
			expect([id, slotFor(id)?.soundGroup, REQUIRED_ASSET_IDS.includes(id), (assets[id] as Obj).kind]).toEqual([
				id,
				"sfx",
				true,
				"silent",
			]);
		}
		// the vale pack plays them: built and uploaded 2026-10-30 (docs/GRAZE_PARRY.md GP10)
		const vale = THEME_PACKS.vale.assets as unknown as Obj;
		for (const id of ["sfx.player.graze", "sfx.player.parry"]) {
			expect([id, (vale[id] as Obj).kind]).toEqual([id, "sound"]);
		}
	});
});

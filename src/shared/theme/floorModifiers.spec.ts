// Roblox port (docs/FLOOR_MODIFIERS.md FM7): the floor modifiers' theme keys (the eleven strings, the five colour roles,
// the five stings, the optional icon ids) are in the contract's lists in shared/dungeon MODIFIERS.kinds' order, every
// bundled pack fills them, and floorModifierReport holds the colours to the plan's bars (text on background and
// uiPanel, the twist apart from every boon), every check printed. contract.ts names the IDs inline (its compiled Luau
// sits near the 200-locals limit), so these specs are what keeps floorModifiers.ts and contract.ts in step.
import { describe, expect, it } from "@rbxts/jest-globals";
import { SILVER_AUDIO_IDS, SILVER_ROLES, SILVER_STRING_KEYS } from "./silver";
import { SILVER_SHOP_STRING_KEYS } from "./silverShop";
import { COSMETIC_STRING_KEYS } from "./cosmetics";
import { FloorModifierClass, MODIFIERS } from "shared/dungeon";
import { CODEX_AUDIO_IDS, CODEX_STRING_KEYS } from "./codex";
import { SECRET_AUDIO_IDS, SECRET_ROLES, SECRET_STRING_KEYS } from "./secrets";
import { NEW_ENEMY_2_AUDIO_IDS } from "./newEnemies2";
import { NEW_ENEMY_3_AUDIO_IDS } from "./newEnemies3";
import { colorDifference, contrastRatio } from "./color";
import { PORT_AUDIO_EVENTS, REQUIRED_ASSET_IDS, REQUIRED_STRING_KEYS, slotFor } from "./contract";
import {
	FLOOR_MODIFIER_AUDIO_IDS,
	FLOOR_MODIFIER_AUDIO_PREFIX,
	FLOOR_MODIFIER_BOON_ROLES,
	FLOOR_MODIFIER_ICON_PREFIX,
	FLOOR_MODIFIER_KEYS,
	FLOOR_MODIFIER_PAUSE_KEY,
	FLOOR_MODIFIER_ROLES,
	FLOOR_MODIFIER_STRING_KEYS,
	FLOOR_MODIFIER_TWIST_KEYS,
	FLOOR_MODIFIER_TWIST_ROLES,
	floorModifierAudioId,
	floorModifierIconId,
	floorModifierLineKey,
	floorModifierNameKey,
	floorModifierRole,
} from "./floorModifiers";
import {
	FLOOR_MODIFIER_COLOR_RULES,
	MIN_FLOOR_MODIFIER_TWIST_DIFFERENCE,
	floorModifierReport,
} from "./floorModifierColors";
import { GOLDEN_RUMOUR_AUDIO_IDS, GOLDEN_RUMOUR_STRING_KEYS } from "./fortune";
import { ThemePack } from "./pack";
import { THEME_PACKS } from "./packs";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { COLOR_ROLES } from "./types";
import { deepClone, sortedKeys, type Obj } from "./util";
import { isStringKey, validateManifest } from "./validate";

const fixed1 = (n: number) => "%.1f".format(n);
const fixed2 = (n: number) => "%.2f".format(n);
const quiet = () => {};
const has = (list: ReadonlyArray<string>, id: string) => list.includes(id);
const clone = () => deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;

/** The last `n` entries of `list` before its last `skip` (later features' entries), in order. */
function tail(list: ReadonlyArray<string>, n: number, skip = 0): string[] {
	const out = new Array<string>();
	const last = list.size() - skip;
	for (let i = last - n; i < last; i++) out.push(list[i]);
	return out;
}

/**
 * What comes after the floor modifiers' entries: docs/GOLDLING_RUMOURS.md GR6 / GR7's two sounds and two strings, then
 * claude/codex-plan.md CX5's sound and strings (codex.spec.ts), then docs/SECRET_ROOMS.md SR10's sounds, strings and
 * colour role (secrets.spec.ts).
 */
const LATER_AFTER = {
	audio:
		GOLDEN_RUMOUR_AUDIO_IDS.size() +
		CODEX_AUDIO_IDS.size() +
		SECRET_AUDIO_IDS.size() +
		SILVER_AUDIO_IDS.size() +
		NEW_ENEMY_2_AUDIO_IDS.size() +
		NEW_ENEMY_3_AUDIO_IDS.size(),
	strings:
		GOLDEN_RUMOUR_STRING_KEYS.size() +
		CODEX_STRING_KEYS.size() +
		SECRET_STRING_KEYS.size() +
		SILVER_STRING_KEYS.size() +
		SILVER_SHOP_STRING_KEYS.size() + COSMETIC_STRING_KEYS.size(),
	roles: SECRET_ROLES.size() + SILVER_ROLES.size(),
} as const;

describe("floor modifiers: theme keys", () => {
	it("the keys are shared/dungeon MODIFIERS.kinds' keys, in order; the twists are its TWIST class", () => {
		expect([...FLOOR_MODIFIER_KEYS]).toEqual(MODIFIERS.kinds.map((k) => k.key));
		expect([...FLOOR_MODIFIER_KEYS]).toEqual(["gilded", "hoard", "feast", "plunder", "bloodMoon"]);
		const twists = MODIFIERS.kinds.filter((k) => k.class === FloorModifierClass.TWIST).map((k) => k.key);
		expect([...FLOOR_MODIFIER_TWIST_KEYS]).toEqual(twists);
		expect(FLOOR_MODIFIER_KEYS.map((k) => floorModifierRole(k))).toEqual([...FLOOR_MODIFIER_ROLES]);
		expect([...FLOOR_MODIFIER_TWIST_ROLES]).toEqual(FLOOR_MODIFIER_TWIST_KEYS.map((k) => floorModifierRole(k)!));
		expect([...FLOOR_MODIFIER_BOON_ROLES]).toEqual(
			FLOOR_MODIFIER_ROLES.filter((r) => !FLOOR_MODIFIER_TWIST_ROLES.includes(r)),
		);
		expect([floorModifierRole("none"), floorModifierRole(""), floorModifierRole("Gilded")]).toEqual([
			undefined,
			undefined,
			undefined,
		]);
	});

	it("the strings: REQUIRED_STRING_KEYS' eleven before the Goldling rumours' and the Codex's (name and line per kind, the pause line), every pack fills them", () => {
		const keys = new Array<string>();
		for (const k of FLOOR_MODIFIER_KEYS) keys.push(floorModifierNameKey(k), floorModifierLineKey(k));
		keys.push(FLOOR_MODIFIER_PAUSE_KEY);
		expect(keys).toEqual([...FLOOR_MODIFIER_STRING_KEYS]);
		expect(tail(REQUIRED_STRING_KEYS, FLOOR_MODIFIER_STRING_KEYS.size(), LATER_AFTER.strings)).toEqual([
			...FLOOR_MODIFIER_STRING_KEYS,
		]);
		expect(new Set(REQUIRED_STRING_KEYS).size()).toBe(REQUIRED_STRING_KEYS.size());
		// a string key's first segment is lowercase (`floormod.`), unlike the colour role (`floorMod.`)
		for (const k of FLOOR_MODIFIER_STRING_KEYS) expect([k, isStringKey(k)]).toEqual([k, true]);
		expect(isStringKey("floorMod.gilded.name")).toBe(false);
		for (const id of sortedKeys(THEME_PACKS)) {
			const strings = THEME_PACKS[id].strings;
			for (const k of FLOOR_MODIFIER_STRING_KEYS)
				expect([id, k, typeIs(strings[k], "string")]).toEqual([id, k, true]);
		}
		const s = PLACEHOLDER_MANIFEST.strings;
		expect(FLOOR_MODIFIER_STRING_KEYS.map((k) => s[k])).toEqual([
			"Gilded",
			"A Goldling is certain",
			"Hoard",
			"A treasure vault is certain",
			"Feast",
			"A power pellet is certain",
			"Plunder",
			"A boost hides in every room's barrels",
			"Blood Moon",
			"Twice the elites",
			"{name} · {line}",
		]);
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });
		expect(
			pack.str(FLOOR_MODIFIER_PAUSE_KEY, {
				name: pack.str(floorModifierNameKey("gilded")),
				line: pack.str(floorModifierLineKey("gilded")),
			}),
		).toBe("Gilded · A Goldling is certain");
	});

	it("the colour roles are COLOR_ROLES' last five; the boons reuse what they promise, the twist is a new red", () => {
		expect([...FLOOR_MODIFIER_ROLES]).toEqual([
			"floorMod.gilded",
			"floorMod.hoard",
			"floorMod.feast",
			"floorMod.plunder",
			"floorMod.bloodMoon",
		]);
		expect(
			tail(COLOR_ROLES as unknown as ReadonlyArray<string>, FLOOR_MODIFIER_ROLES.size(), LATER_AFTER.roles),
		).toEqual([...FLOOR_MODIFIER_ROLES]);
		for (const id of sortedKeys(THEME_PACKS)) {
			const c = THEME_PACKS[id].colors as unknown as Obj;
			expect([id, c["floorMod.gilded"], c["floorMod.hoard"], c["floorMod.feast"], c["floorMod.plunder"]]).toEqual(
				[id, c["golden.coin"], c["treasure.legendary"], c["pellet.power"], c["boost.frenzy"]],
			);
			expect([id, c["floorMod.bloodMoon"]]).toEqual([id, "#ff3348"]);
		}
	});

	it("appends the five stings to PORT_AUDIO_EVENTS before the Goldling rumours' (lowercase: bloodmoon): required, sfx; SILENT in the placeholder, uploaded in vale (FM10, 2026-11-13)", () => {
		expect(FLOOR_MODIFIER_KEYS.map((k) => floorModifierAudioId(k))).toEqual([...FLOOR_MODIFIER_AUDIO_IDS]);
		expect([...FLOOR_MODIFIER_AUDIO_IDS]).toEqual([
			"sfx.floor.modifier.gilded",
			"sfx.floor.modifier.hoard",
			"sfx.floor.modifier.feast",
			"sfx.floor.modifier.plunder",
			"sfx.floor.modifier.bloodmoon",
		]);
		expect(FLOOR_MODIFIER_AUDIO_PREFIX).toBe("sfx.floor.modifier.");
		expect(tail(PORT_AUDIO_EVENTS, FLOOR_MODIFIER_AUDIO_IDS.size(), LATER_AFTER.audio)).toEqual([
			...FLOOR_MODIFIER_AUDIO_IDS,
		]);
		for (const id of FLOOR_MODIFIER_AUDIO_IDS) {
			expect([id, has(REQUIRED_ASSET_IDS, id), slotFor(id)?.soundGroup]).toEqual([id, true, "sfx"]);
			for (const p of sortedKeys(THEME_PACKS))
				expect([p, id, THEME_PACKS[p].assets[id].kind]).toEqual([p, id, p === "vale" ? "sound" : "silent"]);
		}
		// a missing sting fails like any required sound
		const m = clone();
		(m.assets as Obj)["sfx.floor.modifier.feast"] = undefined;
		expect(
			validateManifest(m).some(
				(e) => e.find('missing required asset "sfx.floor.modifier.feast"', 1, true)[0] !== undefined,
			),
		).toBe(true);
	});

	it("the icons are optional ui ids (`ui.floormod.<key>`, lowercase): no bundled pack has them, a pack may draw all five", () => {
		expect(FLOOR_MODIFIER_KEYS.map((k) => floorModifierIconId(k))).toEqual([
			"ui.floormod.gilded",
			"ui.floormod.hoard",
			"ui.floormod.feast",
			"ui.floormod.plunder",
			"ui.floormod.bloodmoon",
		]);
		expect(FLOOR_MODIFIER_ICON_PREFIX.sub(1, 3)).toBe("ui.");
		for (const k of FLOOR_MODIFIER_KEYS) {
			const icon = floorModifierIconId(k);
			expect([icon, has(REQUIRED_ASSET_IDS, icon), slotFor(icon)?.slot]).toEqual([icon, false, "ui"]);
			for (const p of sortedKeys(THEME_PACKS))
				expect([p, icon, THEME_PACKS[p].assets[icon]]).toEqual([p, icon, undefined]);
		}
		const m = clone();
		FLOOR_MODIFIER_KEYS.forEach((k, i) => {
			(m.assets as Obj)[floorModifierIconId(k)] = {
				kind: "image",
				assetId: "rbxassetid://7001",
				w: 80,
				h: 16,
				rect: { x: 16 * i, y: 0, w: 16, h: 16 },
			};
		});
		expect(validateManifest(m)).toEqual([]);
		const pack = new ThemePack(m as never, { warn: quiet });
		for (const k of FLOOR_MODIFIER_KEYS)
			expect([k, pack.contentIds(floorModifierIconId(k))]).toEqual([
				k,
				[{ contentId: "rbxassetid://7001", media: "image" }],
			]);
		// the key's case is the string's and the role's, never an asset ID's
		const upper = clone();
		(upper.assets as Obj)["ui.floorMod.gilded"] = { kind: "image", assetId: "rbxassetid://7001", w: 16, h: 16 };
		expect(validateManifest(upper).some((e) => e.find("bad asset ID", 1, true)[0] !== undefined)).toBe(true);
	});
});

describe("floor modifiers: colours (floorModifierReport)", () => {
	it("passes for every bundled pack, every check in the report (numbers printed)", () => {
		const rules = FLOOR_MODIFIER_COLOR_RULES;
		expect([rules.minPanelContrast, rules.minTwistDifference, MIN_FLOOR_MODIFIER_TWIST_DIFFERENCE]).toEqual([
			4.5, 40, 40,
		]);
		expect([...rules.panels]).toEqual(["background", "uiPanel"]);
		for (const id of sortedKeys(THEME_PACKS)) {
			const manifest = THEME_PACKS[id] as unknown;
			const report = floorModifierReport(manifest);
			const count = (check: string) => report.filter((e) => e.check === check).size();
			expect([id, count("panel"), count("apart")]).toEqual([
				id,
				rules.roles.size() * rules.panels.size(),
				rules.twists.size() * rules.boons.size(),
			]);
			for (const e of report) {
				expect([id, e.role, e.check, e.against, e.ok]).toEqual([id, e.role, e.check, e.against, true]);
				const value =
					e.check === "panel"
						? contrastRatio(e.color, e.againstColor)
						: colorDifference(e.color, e.againstColor);
				expect(e.value).toBe(value);
				print(
					`[floorMod] ${id} ${e.role} ${e.color} ${e.check} vs ${e.against}: ${
						e.check === "panel" ? `${fixed2(e.value)}:1` : fixed1(e.value)
					}`,
				);
			}
			expect([id, validateManifest(manifest, { packId: id })]).toEqual([id, []]);
		}
	});

	it("a name that does not read as text, or a twist that reads as a boon, fails validation", () => {
		for (const role of FLOOR_MODIFIER_ROLES) {
			const dark = clone();
			(dark.colors as Obj)[role] = "#3a3a46";
			const errors = validateManifest(dark);
			expect([role, errors.size() > 0]).toEqual([role, true]);
			for (const e of errors) expect([role, e.find(role, 1, true)[0] !== undefined]).toEqual([role, true]);
			expect([
				role,
				errors.some(
					(e) =>
						e.find("on uiPanel #1c1c24 is", 1, true)[0] !== undefined &&
						e.find("must read as text on the floor card and the HUD panel", 1, true)[0] !== undefined,
				),
			]).toEqual([role, true]);
		}
		// pure red: under the text bar on uiPanel (why the twist is a lifted crimson)
		const red = clone();
		(red.colors as Obj)["floorMod.bloodMoon"] = "#ff0000";
		expect(validateManifest(red)).toEqual([
			'colors["floorMod.bloodMoon"]: contrast: floorMod.bloodMoon #ff0000 on uiPanel #1c1c24 is 4.23:1, needs >= ' +
				"4.5:1: a floor modifier's name must read as text on the floor card and the HUD panel",
		]);
		// a gold twist: reads as a boon
		const gold = clone();
		(gold.colors as Obj)["floorMod.bloodMoon"] = "#ffdc5a";
		const errors = validateManifest(gold);
		expect(
			errors.some(
				(e) =>
					e.find(
						'colors["floorMod.bloodMoon"]: colour difference: floorMod.bloodMoon #ffdc5a vs floorMod.gilded #ffdc5a is 0.0 (CIE76), needs >= 40.0',
						1,
						true,
					)[0] !== undefined,
			),
		).toBe(true);
		for (const e of errors)
			expect([e, e.find("a twist's colour must never read as a boon's", 1, true)[0] !== undefined]).toEqual([
				e,
				true,
			]);
		// a missing role is the colour-role check's, not the report's
		const missing = clone();
		(missing.colors as Obj)["floorMod.hoard"] = undefined;
		expect(floorModifierReport(missing).some((e) => e.role === "floorMod.hoard")).toBe(false);
		expect(validateManifest(missing).size() > 0).toBe(true);
	});
});

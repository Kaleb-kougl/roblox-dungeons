// Roblox port (docs/ENEMY_VARIANTS.md EV1): the enemy variants' theme contract: the Imp and Ooze archetype slots
// (assets, colour roles, names, placeholder cone and dome), the goo puddle's bullet visual and colour, the affix colour
// roles and shield colour, their validator rules (affixReport, gooReport), the affix and bestiary strings and the five
// port audio IDs; every one required and filled by the placeholder and vale packs.
import { describe, expect, it } from "@rbxts/jest-globals";
import { colorDifference, contrastRatio } from "./color";
import {
	BIOMES,
	BOOST_ROLES,
	BULLET_IDS,
	DECOR_FX_ROLES,
	ENEMY_ARCHETYPES,
	ENEMY_BULLET_ROLES,
	PORT_AUDIO_EVENTS,
	REQUIRED_ASSET_IDS,
	REQUIRED_STRING_KEYS,
	slotFor,
} from "./contract";
import { THEME_PACKS } from "./packs";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { VALE_FLOOR_HEX, buildValeManifest } from "./packs/vale";
import { PLACEHOLDER_PROPORTIONS, PLACEHOLDER_SHAPES, PLACEHOLDER_VISUALS, pxToStuds } from "./placeholders";
import { COLOR_ROLES, type ColorRole } from "./types";
import { deepClone, sortedKeys, type Obj } from "./util";
import { validateManifest } from "./validate";
import {
	AFFIX_COLOR_RULES,
	GOO_COLOR_RULES,
	affixReport,
	gooReport,
	type VariantColorEntry,
	type VariantColorRules,
} from "./variantColors";
import {
	AFFIX_IDS,
	AFFIX_ROLES,
	AFFIX_STRING_KEYS,
	BESTIARY_ARCHETYPES,
	BESTIARY_STRING_KEYS,
	ENEMY_GOO_ROLE,
	ENEMY_SHIELD_ROLE,
	ENEMY_VARIANT_STRING_KEYS,
	GOO_BULLET_ID,
	affixNameKey,
	affixRole,
	bestiaryAffixKey,
	bestiaryArchetypeKey,
} from "./variants";

const clone = (): Obj => deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
const colorsOf = (m: Obj) => m.colors as Obj;
const fixed1 = (n: number) => "%.1f".format(n);
const fixed2 = (n: number) => "%.2f".format(n);
const has = (list: ReadonlyArray<string>, id: string) => list.includes(id);

const NEW_ARCHETYPES = ["imp", "slime"];
const VARIANT_AUDIO = [
	"sfx.enemy.blink",
	"sfx.enemy.summon",
	"sfx.enemy.split",
	"sfx.affix.shieldbreak",
	"sfx.affix.vengeful",
];
const PLACEHOLDER_COLORS: ReadonlyArray<[ColorRole, string]> = [
	["enemy.imp", "#e098b8"],
	["enemy.slime", "#3080a0"],
	["enemyGoo", "#f000f0"],
	["affix.hulking", "#ffe470"],
	["affix.swift", "#3ce0a0"],
	["affix.shielded", "#00a0f0"],
	["affix.vengeful", "#9070f0"],
	["enemyShield", "#d8ecff"],
];
const PLACEHOLDER_STRINGS: ReadonlyArray<[string, string]> = [
	["enemy.imp.name", "Imp"],
	["enemy.slime.name", "Ooze"],
	["affix.hulking.name", "Hulking"],
	["affix.swift.name", "Swift"],
	["affix.shielded.name", "Shielded"],
	["affix.vengeful.name", "Vengeful"],
];

/** Every bundled pack, plus vale with its biome.1 floor texture uploaded (its darker mean colour as the floor). */
function packsToCheck(): Array<[string, Obj]> {
	const out = new Array<[string, Obj]>();
	for (const id of sortedKeys(THEME_PACKS)) out.push([id, THEME_PACKS[id] as unknown as Obj]);
	const textured = buildValeManifest() as unknown as Obj;
	const biomes = textured.biomes as Obj;
	for (const b of sortedKeys(biomes)) (biomes[b] as Obj).floor = VALE_FLOOR_HEX;
	out.push(["vale (textured floors)", textured]);
	return out;
}

/** Checks a report's shape against its rules: counts per check, values recomputed, bars, all ok; prints the margins. */
function checkReport(id: string, name: string, report: ReadonlyArray<VariantColorEntry>, rules: VariantColorRules) {
	const roles = rules.roles.size();
	const count = (check: string) => report.filter((e) => e.check === check).size();
	expect([id, name, count("floor")]).toEqual([id, name, roles * BIOMES.size()]);
	expect([id, name, count("difference")]).toEqual([id, name, roles * rules.against.size()]);
	expect([id, name, count("apart")]).toEqual([id, name, rules.minApart > 0 ? (roles * (roles - 1)) / 2 : 0]);
	for (const e of report) {
		expect([id, e.role, e.check, e.against, e.ok]).toEqual([id, e.role, e.check, e.against, true]);
		if (e.check === "floor") {
			expect(e.value).toBe(contrastRatio(e.color, e.againstColor));
			expect(e.min).toBe(rules.minFloorContrast);
		} else {
			expect(e.value).toBe(colorDifference(e.color, e.againstColor));
			expect(e.min).toBe(e.check === "apart" ? rules.minApart : rules.minDifference);
		}
	}
	for (const role of rules.roles) {
		let floor = math.huge;
		let diff = math.huge;
		let diffAgainst = "";
		let apart = math.huge;
		let apartAgainst = "";
		for (const e of report) {
			const mine = e.role === role || (e.check === "apart" && e.against === role);
			if (!mine) continue;
			if (e.check === "floor") floor = math.min(floor, e.value);
			else if (e.check === "difference" && e.value < diff) {
				diff = e.value;
				diffAgainst = e.against;
			} else if (e.check === "apart" && e.value < apart) {
				apart = e.value;
				apartAgainst = e.role === role ? e.against : e.role;
			}
		}
		const apartText = apart < math.huge ? `, min apart ${fixed1(apart)} (${apartAgainst})` : "";
		print(
			`[${name}] ${id} ${role}: min floor contrast ${fixed2(floor)}:1, min CIE76 ${fixed1(
				diff,
			)} (${diffAgainst})${apartText}`,
		);
	}
}

describe("enemy variants: contract", () => {
	it("appends imp and slime to ENEMY_ARCHETYPES (existing order kept), each a required asset, role and name", () => {
		expect([...ENEMY_ARCHETYPES]).toEqual([
			"swarmer",
			"sprayer",
			"sniper",
			"bruiser",
			"caster",
			"summoner",
			"dummy",
			"imp",
			"slime",
		]);
		for (const a of NEW_ARCHETYPES) {
			expect([a, has(REQUIRED_ASSET_IDS, `enemy.${a}`), slotFor(`enemy.${a}`)?.slot]).toEqual([a, true, "enemy"]);
			expect([a, has(REQUIRED_STRING_KEYS, `enemy.${a}.name`)]).toEqual([a, true]);
			expect([a, has(COLOR_ROLES, `enemy.${a}`)]).toEqual([a, true]);
		}
	});

	it("adds the goo puddle: a required bullet visual and the enemyGoo colour role", () => {
		expect(GOO_BULLET_ID).toBe("bullet.enemy.goo");
		expect(BULLET_IDS[BULLET_IDS.size() - 1]).toBe(GOO_BULLET_ID);
		expect([has(REQUIRED_ASSET_IDS, GOO_BULLET_ID), slotFor(GOO_BULLET_ID)?.slot]).toEqual([true, "bullet"]);
		expect([ENEMY_GOO_ROLE, has(COLOR_ROLES, ENEMY_GOO_ROLE)]).toEqual(["enemyGoo", true]);
	});

	it("adds the affix colour roles (AFFIX_IDS order) and enemyShield", () => {
		expect([...AFFIX_IDS]).toEqual(["hulking", "swift", "shielded", "vengeful"]);
		expect([...AFFIX_ROLES]).toEqual(["affix.hulking", "affix.swift", "affix.shielded", "affix.vengeful"]);
		expect(AFFIX_IDS.map((a) => affixRole(a))).toEqual([...AFFIX_ROLES]);
		expect(ENEMY_SHIELD_ROLE).toBe("enemyShield");
		for (const r of [...AFFIX_ROLES, ENEMY_SHIELD_ROLE]) expect([r, has(COLOR_ROLES, r)]).toEqual([r, true]);
	});

	it("requires the affix names and the first-sighting lines", () => {
		expect([...AFFIX_STRING_KEYS]).toEqual(AFFIX_IDS.map((a) => affixNameKey(a)));
		expect([...AFFIX_STRING_KEYS]).toEqual([
			"affix.hulking.name",
			"affix.swift.name",
			"affix.shielded.name",
			"affix.vengeful.name",
		]);
		expect([...BESTIARY_ARCHETYPES]).toEqual(["imp", "slime", "summoner"]);
		expect([...BESTIARY_STRING_KEYS]).toEqual([
			...BESTIARY_ARCHETYPES.map((a) => bestiaryArchetypeKey(a)),
			...AFFIX_IDS.map((a) => bestiaryAffixKey(a)),
		]);
		expect([...BESTIARY_STRING_KEYS]).toEqual([
			"bestiary.imp",
			"bestiary.slime",
			"bestiary.summoner",
			"bestiary.affix.hulking",
			"bestiary.affix.swift",
			"bestiary.affix.shielded",
			"bestiary.affix.vengeful",
		]);
		expect([...ENEMY_VARIANT_STRING_KEYS]).toEqual([...AFFIX_STRING_KEYS, ...BESTIARY_STRING_KEYS]);
		for (const k of ENEMY_VARIANT_STRING_KEYS) expect([k, has(REQUIRED_STRING_KEYS, k)]).toEqual([k, true]);
		expect(new Set(REQUIRED_STRING_KEYS).size()).toBe(REQUIRED_STRING_KEYS.size());
	});

	it("appends the five port audio IDs (lowercase segments: shieldbreak), required, sfx", () => {
		const n = PORT_AUDIO_EVENTS.size();
		const tail = new Array<string>();
		for (let i = n - VARIANT_AUDIO.size(); i < n; i++) tail.push(PORT_AUDIO_EVENTS[i]);
		expect(tail).toEqual(VARIANT_AUDIO);
		for (const id of VARIANT_AUDIO) {
			expect([id, has(REQUIRED_ASSET_IDS, id), slotFor(id)?.soundGroup]).toEqual([id, true, "sfx"]);
		}
	});
});

describe("enemy variants: placeholder visuals", () => {
	const s = (px: number) => pxToStuds(px);

	it("the Imp is a small cone and the Ooze a low dome, both rimmed like every enemy", () => {
		expect(PLACEHOLDER_SHAPES.includes("Cone")).toBe(true);
		expect(PLACEHOLDER_SHAPES.includes("Dome")).toBe(true);
		const imp = PLACEHOLDER_VISUALS["enemy.imp"];
		const slime = PLACEHOLDER_VISUALS["enemy.slime"];
		expect(imp).toMatchObject({
			shape: "Cone",
			color: { kind: "role", role: "enemy.imp" },
			outline: "enemyOutline",
			faces: true,
			anchor: "base",
		});
		expect(imp.size).toEqual([s(8), s(10), s(8)]);
		expect(slime).toMatchObject({
			shape: "Dome",
			color: { kind: "role", role: "enemy.slime" },
			outline: "enemyOutline",
			anchor: "base",
		});
		expect(slime.size).toEqual([s(14), s(7), s(14)]);
		// "small" and "low": the imp is the swarmer's width, the dome half as tall as it is wide
		expect(PLACEHOLDER_PROPORTIONS.imp[0]).toBe(PLACEHOLDER_PROPORTIONS.swarmer[0]);
		expect(slime.size[1] * 2).toBe(slime.size[0]);
	});

	it("the goo puddle is a flat neon disc on the floor in enemyGoo, with the bullets' dark outline", () => {
		const goo = PLACEHOLDER_VISUALS[GOO_BULLET_ID];
		expect(goo).toMatchObject({
			shape: "Cylinder",
			color: { kind: "role", role: "enemyGoo" },
			material: "Neon",
			outline: "enemyBulletOutline",
			faces: false,
			anchor: "base",
		});
		expect(goo.size).toEqual([s(8), s(1), s(8)]);
	});
});

describe("enemy variants: bundled packs", () => {
	it("the placeholder fills every new slot, role and string; vale (and every bundled pack) carries them", () => {
		for (const [role, hex] of PLACEHOLDER_COLORS)
			expect([role, PLACEHOLDER_MANIFEST.colors[role]]).toEqual([role, hex]);
		for (const [key, text] of PLACEHOLDER_STRINGS)
			expect([key, PLACEHOLDER_MANIFEST.strings[key]]).toEqual([key, text]);
		for (const id of sortedKeys(THEME_PACKS)) {
			const pack = THEME_PACKS[id];
			for (const a of NEW_ARCHETYPES)
				expect([id, a, pack.assets[`enemy.${a}`]]).toEqual([id, a, { kind: "placeholder" }]);
			expect([id, pack.assets[GOO_BULLET_ID]]).toEqual([id, { kind: "placeholder" }]);
			for (const sfx of VARIANT_AUDIO) expect([id, sfx, pack.assets[sfx]]).toEqual([id, sfx, { kind: "silent" }]);
			for (const [role, hex] of PLACEHOLDER_COLORS)
				expect([id, role, pack.colors[role]]).toEqual([id, role, hex]);
			for (const key of ENEMY_VARIANT_STRING_KEYS) {
				const text = pack.strings[key];
				expect([id, key, typeIs(text, "string") && text.size() > 0]).toEqual([id, key, true]);
			}
			expect([id, validateManifest(pack, { packId: id })]).toEqual([id, []]);
		}
		expect(PLACEHOLDER_MANIFEST.strings["bestiary.imp"]).toBe("Imp: watch the ring where it lands");
	});

	it("a pack missing any of them fails validation", () => {
		const m = clone();
		(m.assets as Obj)["enemy.imp"] = undefined;
		(m.assets as Obj)[GOO_BULLET_ID] = undefined;
		(m.assets as Obj)["sfx.affix.shieldbreak"] = undefined;
		colorsOf(m)["affix.swift"] = undefined;
		colorsOf(m).enemyGoo = undefined;
		(m.strings as Obj)["enemy.slime.name"] = undefined;
		(m.strings as Obj)["bestiary.affix.vengeful"] = undefined;
		const errors = validateManifest(m);
		for (const needle of [
			"enemy.imp",
			GOO_BULLET_ID,
			"sfx.affix.shieldbreak",
			"affix.swift",
			"enemyGoo",
			"enemy.slime.name",
			"bestiary.affix.vengeful",
		]) {
			const found = errors.some((e) => e.find(needle, 1, true)[0] !== undefined);
			expect([needle, found]).toEqual([needle, true]);
		}
		expect(errors.size()).toBe(7);
		// a missing role is skipped by the reports (the colour-role check reports it)
		expect(affixReport(m).some((e) => e.role === "affix.swift" || e.against === "affix.swift")).toBe(false);
		expect(gooReport(m)).toEqual([]);
	});
});

describe("enemy variants: affixReport", () => {
	it("holds the affix rings and the shield to the plan's bars", () => {
		expect([...AFFIX_COLOR_RULES.roles]).toEqual([...AFFIX_ROLES, "enemyShield"]);
		expect([...AFFIX_COLOR_RULES.against]).toEqual([...ENEMY_BULLET_ROLES, "telegraph", "enemyOutline"]);
		expect([
			AFFIX_COLOR_RULES.minFloorContrast,
			AFFIX_COLOR_RULES.minDifference,
			AFFIX_COLOR_RULES.minApart,
		]).toEqual([3, 40, 40]);
	});

	it("passes for every bundled pack (and vale's textured floor), every check in the report (numbers printed)", () => {
		for (const [id, manifest] of packsToCheck()) checkReport(id, "affix", affixReport(manifest), AFFIX_COLOR_RULES);
	});

	it("the placeholder values as measured", () => {
		const report = affixReport(PLACEHOLDER_MANIFEST);
		const minOf = (check: string) => {
			let m = math.huge;
			for (const e of report) if (e.check === check) m = math.min(m, e.value);
			return m;
		};
		expect(fixed2(minOf("floor"))).toBe("4.02");
		expect(fixed1(minOf("difference"))).toBe("48.5");
		expect(fixed1(minOf("apart"))).toBe("48.5");
	});

	it("rejects a ring too dark for a floor, one near a threat colour, and two affixes alike", () => {
		const m = clone();
		colorsOf(m)["affix.hulking"] = "#ff9a40"; // the telegraph's orange family
		colorsOf(m)["affix.shielded"] = "#3848a8"; // too dark for the floors
		colorsOf(m)["affix.vengeful"] = "#3ce0a8"; // swift's jade
		const errors = validateManifest(m);
		const at = (role: string) => errors.filter((e) => e.find(`colors["${role}"]:`, 1, true)[0] !== undefined);
		expect(at("affix.hulking").size()).toBeGreaterThan(0);
		expect(at("affix.hulking")[0].find("telegraph", 1, true)[0] !== undefined).toBe(true);
		expect(at("affix.hulking")[0].find("must never read as an enemy bullet", 1, true)[0] !== undefined).toBe(true);
		expect(at("affix.shielded").size()).toBe(BIOMES.size());
		expect(at("affix.shielded")[0].find("an affix ring must read on the floor", 1, true)[0] !== undefined).toBe(
			true,
		);
		// the pair is reported once, on the earlier role (swift before vengeful)
		const apart = at("affix.swift");
		expect(apart.size()).toBe(1);
		expect(apart[0].find("vs affix.vengeful #3ce0a8", 1, true)[0] !== undefined).toBe(true);
		expect(apart[0].find("each affix colour must read apart from the others", 1, true)[0] !== undefined).toBe(true);
		expect(at("affix.vengeful").size()).toBe(0);
	});
});

describe("enemy variants: gooReport", () => {
	it("holds goo to the plan's bars: floors, and away from every decor fx and boost colour", () => {
		expect([...GOO_COLOR_RULES.roles]).toEqual(["enemyGoo"]);
		expect([...GOO_COLOR_RULES.against]).toEqual([...DECOR_FX_ROLES, ...BOOST_ROLES]);
		expect([GOO_COLOR_RULES.minFloorContrast, GOO_COLOR_RULES.minDifference, GOO_COLOR_RULES.minApart]).toEqual([
			3, 40, 0,
		]);
	});

	it("passes for every bundled pack (and vale's textured floor), every check in the report (numbers printed)", () => {
		for (const [id, manifest] of packsToCheck()) checkReport(id, "goo", gooReport(manifest), GOO_COLOR_RULES);
	});

	it("the placeholder values as measured", () => {
		const report = gooReport(PLACEHOLDER_MANIFEST);
		let floor = math.huge;
		let diff = math.huge;
		for (const e of report) {
			if (e.check === "floor") floor = math.min(floor, e.value);
			else diff = math.min(diff, e.value);
		}
		expect([fixed2(floor), fixed1(diff)]).toEqual(["4.16", "69.9"]);
	});

	it("rejects goo that reads as decor (a biome mote's green) or that a floor swallows", () => {
		const green = clone();
		colorsOf(green).enemyGoo = "#9fe66a";
		const errors = validateManifest(green).filter((e) => e.find("colors.enemyGoo:", 1, true)[0] !== undefined);
		expect(errors.size()).toBeGreaterThan(0);
		expect(errors.some((e) => e.find("vs decor.fx.ambient.b4", 1, true)[0] !== undefined)).toBe(true);
		expect(
			errors[0].find("goo must read as danger, never as decor or a boost drop", 1, true)[0] !== undefined,
		).toBe(true);
		const dark = clone();
		colorsOf(dark).enemyGoo = "#401030";
		const floors = validateManifest(dark).filter((e) => e.find("colors.enemyGoo:", 1, true)[0] !== undefined);
		expect(floors.size()).toBe(BIOMES.size());
		expect(floors[0].find("goo must read on the floor", 1, true)[0] !== undefined).toBe(true);
	});
});

// Roblox port (docs/NEW_ENEMIES_3.md NT1): the fourth endless set's theme contract: three archetype slots (assets,
// colour roles, names, placeholder shapes), the Mender's heal colour role `enemyHeal` and its rules (healReport), the six
// port audio IDs (SILENT in every bundled pack, PORT_AUDIO_EVENTS' last) and the three first-sighting lines; every one
// required and filled by every bundled pack. No new bullet visual (NTD12).
import { describe, expect, it } from "@rbxts/jest-globals";
import { SIGHTING_IDS } from "shared/onboarding";
import { BESTIARY_ARCHETYPES, BESTIARY_STRING_KEYS, ENEMY_AURA_ROLE, bestiaryArchetypeKey } from "./variants";
import {
	BIOMES,
	BOOST_ROLES,
	ENEMY_ARCHETYPES,
	ENEMY_BULLET_ROLES,
	PORT_AUDIO_EVENTS,
	REQUIRED_ASSET_IDS,
	REQUIRED_STRING_KEYS,
	slotFor,
} from "./contract";
import { ENEMY_GUARD_ROLE } from "./newEnemies2";
import { ENEMY_HEAL_ROLE, NEW_ENEMY_3_ARCHETYPES, NEW_ENEMY_3_AUDIO_IDS } from "./newEnemies3";
import { THEME_PACKS } from "./packs";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { VALE_FLOOR_HEX, buildValeManifest } from "./packs/vale";
import { PLACEHOLDER_VISUALS } from "./placeholders";
import { COLOR_ROLES } from "./types";
import { deepClone, sortedKeys, type Obj } from "./util";
import { validateManifest } from "./validate";
import { HEAL_COLOR_RULES, healReport } from "./variantColors";

const SHAPES: ReadonlyArray<[string, string]> = [
	["mortar", "Cylinder"],
	["mender", "Capsule"],
	["jackal", "Wedge"],
];
const NAMES: ReadonlyArray<[string, string]> = [
	["mortar", "Mortar"],
	["mender", "Mender"],
	["jackal", "Jackal"],
];
const fixed1 = (n: number) => "%.1f".format(n);
const fixed2 = (n: number) => "%.2f".format(n);
/** The placeholder heal's lowest floor contrast, nearest colour and its CIE76 difference, as measured. */
const MEASURED = { floor: "3.66", diff: "40.3", nearest: "enemyGuard" } as const;

/** The last `n` entries of `list`. */
function tail(list: ReadonlyArray<string>, n: number): string[] {
	const out = new Array<string>();
	for (let i = list.size() - n; i < list.size(); i++) out.push(list[i]);
	return out;
}

function packsToCheck(): Array<[string, Obj]> {
	const out = new Array<[string, Obj]>();
	for (const id of sortedKeys(THEME_PACKS)) out.push([id, THEME_PACKS[id] as unknown as Obj]);
	const textured = buildValeManifest() as unknown as Obj;
	const biomes = textured.biomes as Obj;
	for (const b of sortedKeys(biomes)) (biomes[b] as Obj).floor = VALE_FLOOR_HEX;
	out.push(["vale (textured floors)", textured]);
	return out;
}

describe("new enemies 3: contract", () => {
	it("appends the three to ENEMY_ARCHETYPES after the brazier (existing order kept), each a required asset, role and name", () => {
		expect([...NEW_ENEMY_3_ARCHETYPES]).toEqual(["mortar", "mender", "jackal"]);
		expect(tail(ENEMY_ARCHETYPES, NEW_ENEMY_3_ARCHETYPES.size())).toEqual([...NEW_ENEMY_3_ARCHETYPES]);
		expect(ENEMY_ARCHETYPES[ENEMY_ARCHETYPES.size() - 1 - NEW_ENEMY_3_ARCHETYPES.size()]).toBe("pyre");
		for (const a of NEW_ENEMY_3_ARCHETYPES) {
			expect([a, REQUIRED_ASSET_IDS.includes(`enemy.${a}`), slotFor(`enemy.${a}`)?.slot]).toEqual([
				a,
				true,
				"enemy",
			]);
			expect([a, REQUIRED_STRING_KEYS.includes(`enemy.${a}.name`)]).toEqual([a, true]);
			expect([a, (COLOR_ROLES as ReadonlyArray<string>).includes(`enemy.${a}`)]).toEqual([a, true]);
		}
	});

	it("the heal role is its own (not the player's fx.heal, the guard or the aura)", () => {
		expect(ENEMY_HEAL_ROLE).toBe("enemyHeal");
		for (const other of ["fx.heal", ENEMY_GUARD_ROLE, ENEMY_AURA_ROLE, "build.counter"])
			expect([other, ENEMY_HEAL_ROLE === other]).toEqual([other, false]);
		expect((COLOR_ROLES as ReadonlyArray<string>).includes(ENEMY_HEAL_ROLE)).toBe(true);
	});

	it("the six sounds are PORT_AUDIO_EVENTS' last (after the Pyre-keeper's light), required, sfx", () => {
		expect([...NEW_ENEMY_3_AUDIO_IDS]).toEqual([
			"sfx.enemy.lob",
			"sfx.enemy.shell",
			"sfx.enemy.heal",
			"sfx.enemy.healcut",
			"sfx.enemy.lunge",
			"sfx.enemy.spooked",
		]);
		expect(tail(PORT_AUDIO_EVENTS, NEW_ENEMY_3_AUDIO_IDS.size())).toEqual([...NEW_ENEMY_3_AUDIO_IDS]);
		expect(PORT_AUDIO_EVENTS[PORT_AUDIO_EVENTS.size() - 1 - NEW_ENEMY_3_AUDIO_IDS.size()]).toBe(
			"sfx.enemy.pyrelight",
		);
		for (const id of NEW_ENEMY_3_AUDIO_IDS)
			expect([id, REQUIRED_ASSET_IDS.includes(id), slotFor(id)?.soundGroup]).toEqual([id, true, "sfx"]);
	});

	it("three first-sighting lines and sighting ids, the archetypes' block's last, right before the affixes", () => {
		expect(tail(BESTIARY_ARCHETYPES, NEW_ENEMY_3_ARCHETYPES.size())).toEqual([...NEW_ENEMY_3_ARCHETYPES]);
		const firstAffix = BESTIARY_STRING_KEYS.indexOf("bestiary.affix.hulking");
		const firstAffixSighting = SIGHTING_IDS.indexOf("affix.hulking");
		for (let k = 0; k < NEW_ENEMY_3_ARCHETYPES.size(); k++) {
			const a = NEW_ENEMY_3_ARCHETYPES[k];
			const back = NEW_ENEMY_3_ARCHETYPES.size() - k;
			expect([a, BESTIARY_STRING_KEYS[firstAffix - back]]).toEqual([a, bestiaryArchetypeKey(a)]);
			expect([a, SIGHTING_IDS[firstAffixSighting - back]]).toEqual([a, a]);
			expect([a, REQUIRED_STRING_KEYS.includes(`bestiary.${a}`)]).toEqual([a, true]);
		}
	});

	it("placeholder shapes: a thin post, a short robe, a low wedge", () => {
		for (const [a, shape] of SHAPES) {
			const v = PLACEHOLDER_VISUALS[`enemy.${a}`];
			expect([a, v.shape, v.color, v.outline]).toEqual([
				a,
				shape,
				{ kind: "role", role: `enemy.${a}` },
				"enemyOutline",
			]);
		}
		const post = PLACEHOLDER_VISUALS["enemy.mortar"].size;
		expect(post[1] > 2 * post[0]).toBe(true); // a thin post
		const robe = PLACEHOLDER_VISUALS["enemy.mender"].size;
		expect(robe[1] < PLACEHOLDER_VISUALS["enemy.pyrekeeper"].size[1]).toBe(true); // shorter than the Pyre-keeper
		const wedge = PLACEHOLDER_VISUALS["enemy.jackal"].size;
		expect(wedge[1] < wedge[0] && wedge[2] > wedge[0]).toBe(true); // low, longer than wide
		expect(wedge[2] < PLACEHOLDER_VISUALS["enemy.charger"].size[2]).toBe(true); // smaller than the Charger's
	});
});

describe("new enemies 3: bundled packs", () => {
	it("every bundled pack fills every new slot (placeholders, silent sounds) and validates", () => {
		for (const id of sortedKeys(THEME_PACKS)) {
			const pack = THEME_PACKS[id];
			const colors = pack.colors as unknown as Obj;
			// No art and no clips yet (NT8 / NT10): every pack, vale included, draws the placeholders and stays silent
			for (const [a, name] of NAMES) {
				expect([id, a, pack.assets[`enemy.${a}`].kind]).toEqual([id, a, "placeholder"]);
				expect([id, a, typeIs(colors[`enemy.${a}`], "string")]).toEqual([id, a, true]);
				expect([id, a, pack.strings[`enemy.${a}.name`]]).toEqual([id, a, name]);
				const line = pack.strings[`bestiary.${a}`];
				expect([id, a, typeIs(line, "string")]).toEqual([id, a, true]);
				// "Name: tip" (l10n/context.json): the toast's name is the name string
				expect([id, a, (line as string).sub(1, name.size() + 1)]).toEqual([id, a, `${name}:`]);
			}
			for (const sfx of NEW_ENEMY_3_AUDIO_IDS)
				expect([id, sfx, pack.assets[sfx].kind]).toEqual([id, sfx, "silent"]);
			expect([id, typeIs(pack.colors[ENEMY_HEAL_ROLE], "string")]).toEqual([id, true]);
			expect([id, validateManifest(pack, { packId: id })]).toEqual([id, []]);
		}
	});

	it("a pack missing any of them fails validation", () => {
		const m = deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
		(m.assets as Obj)["enemy.mortar"] = undefined;
		(m.assets as Obj)["sfx.enemy.lunge"] = undefined;
		(m.colors as Obj).enemyHeal = undefined;
		(m.strings as Obj)["enemy.mender.name"] = undefined;
		(m.strings as Obj)["bestiary.jackal"] = undefined;
		const errors = validateManifest(m);
		for (const needle of ["enemy.mortar", "sfx.enemy.lunge", "enemyHeal", "enemy.mender.name", "bestiary.jackal"]) {
			expect([needle, errors.some((e) => e.find(needle, 1, true)[0] !== undefined)]).toEqual([needle, true]);
		}
		expect(errors.size()).toBe(5);
		expect(healReport(m)).toEqual([]); // a missing role is skipped (the colour-role check reports it)
	});
});

describe("new enemies 3: healReport", () => {
	it("holds the heal to its bars: floors, >= 40 CIE76 from bullets, telegraph, the rim, aura, guard, the player's heal, the counter-wave and boosts", () => {
		expect([...HEAL_COLOR_RULES.roles]).toEqual(["enemyHeal"]);
		expect([...HEAL_COLOR_RULES.against]).toEqual([
			...ENEMY_BULLET_ROLES,
			"telegraph",
			"enemyOutline",
			ENEMY_AURA_ROLE,
			ENEMY_GUARD_ROLE,
			"fx.heal",
			"build.counter",
			...BOOST_ROLES,
		]);
		expect([HEAL_COLOR_RULES.minFloorContrast, HEAL_COLOR_RULES.minDifference, HEAL_COLOR_RULES.minApart]).toEqual([
			3, 40, 0,
		]);
	});

	it("passes for every bundled pack (and vale's textured floor), every check in the report", () => {
		for (const [id, manifest] of packsToCheck()) {
			const report = healReport(manifest);
			expect([id, report.filter((e) => e.check === "floor").size()]).toEqual([id, BIOMES.size()]);
			expect([id, report.filter((e) => e.check === "difference").size()]).toEqual([
				id,
				HEAL_COLOR_RULES.against.size(),
			]);
			for (const e of report) expect([id, e.check, e.against, e.ok]).toEqual([id, e.check, e.against, true]);
		}
	});

	it("the placeholder values as measured", () => {
		const report = healReport(PLACEHOLDER_MANIFEST);
		let floor = math.huge;
		let diff = math.huge;
		let nearest = "";
		for (const e of report) {
			if (e.check === "floor") floor = math.min(floor, e.value);
			if (e.check === "difference" && e.value < diff) {
				diff = e.value;
				nearest = e.against;
			}
		}
		expect([fixed2(floor), fixed1(diff), nearest]).toEqual([MEASURED.floor, MEASURED.diff, MEASURED.nearest]);
	});

	it("rejects a heal in the player's heal family", () => {
		const m = deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
		(m.colors as Obj).enemyHeal = (m.colors as Obj)["fx.heal"];
		const errors = validateManifest(m).filter(
			(e) =>
				e.find(`colors.enemyHeal`, 1, true)[0] !== undefined ||
				e.find(`colors["enemyHeal"]`, 1, true)[0] !== undefined,
		);
		expect(errors.size()).toBeGreaterThan(0);
		expect(errors.some((e) => e.find("the player's heal", 1, true)[0] !== undefined)).toBe(true);
	});
});

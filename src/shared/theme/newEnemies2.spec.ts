// Roblox port (docs/NEW_ENEMIES_2.md NX1): the third endless set's theme contract: five archetype slots (assets, colour
// roles, names, placeholder shapes; the brazier `pyre` among them), the hook and flame bullet visuals, the Bulwark's
// guard colour role `enemyGuard` and its rules (guardReport), the eight port audio IDs (SILENT in every bundled pack,
// PORT_AUDIO_EVENTS' last) and the four first-sighting lines; every one required and filled by every bundled pack.
import { describe, expect, it } from "@rbxts/jest-globals";
import { SIGHTING_IDS } from "shared/onboarding";
import {
	AFFIX_ROLES,
	BESTIARY_ARCHETYPES,
	BESTIARY_STRING_KEYS,
	ENEMY_GOO_ROLE,
	ENEMY_SHIELD_ROLE,
	STRIKE_BULLET_ID,
	bestiaryArchetypeKey,
} from "./variants";
import {
	BIOMES,
	BOOST_ROLES,
	BULLET_IDS,
	ENEMY_ARCHETYPES,
	ENEMY_BULLET_ROLES,
	PORT_AUDIO_EVENTS,
	REQUIRED_ASSET_IDS,
	REQUIRED_STRING_KEYS,
	slotFor,
} from "./contract";
import {
	ENEMY_GUARD_ROLE,
	FLAME_BULLET_ID,
	HOOK_BULLET_ID,
	NEW_ENEMY_2_ARCHETYPES,
	NEW_ENEMY_2_AUDIO_IDS,
	NEW_ENEMY_2_BESTIARY,
	NEW_ENEMY_2_BULLET_IDS,
} from "./newEnemies2";
import { THEME_PACKS } from "./packs";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { VALE_FLOOR_HEX, buildValeManifest } from "./packs/vale";
import { PLACEHOLDER_VISUALS } from "./placeholders";
import { COLOR_ROLES } from "./types";
import { deepClone, sortedKeys, type Obj } from "./util";
import { validateManifest } from "./validate";
import { GUARD_COLOR_RULES, guardReport } from "./variantColors";

const SHAPES: ReadonlyArray<[string, string]> = [
	["bulwark", "Block"],
	["chainhook", "Cylinder"],
	["snatcher", "Cone"],
	["pyrekeeper", "Capsule"],
	["pyre", "Cylinder"],
];
const NAMES: ReadonlyArray<[string, string]> = [
	["bulwark", "Bulwark"],
	["chainhook", "Chainhook"],
	["snatcher", "Snatcher"],
	["pyrekeeper", "Pyre-keeper"],
	["pyre", "Brazier"],
];
const fixed1 = (n: number) => "%.1f".format(n);
const fixed2 = (n: number) => "%.2f".format(n);
/** The placeholder guard's lowest floor contrast, nearest colour and its CIE76 difference, as measured. */
const MEASURED = { floor: "5.04", diff: "45.2", nearest: "affix.hulking" } as const;

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

describe("new enemies 2: contract", () => {
	it("appends the five to ENEMY_ARCHETYPES (existing order kept), each a required asset, role and name", () => {
		expect([...NEW_ENEMY_2_ARCHETYPES]).toEqual(["bulwark", "chainhook", "snatcher", "pyrekeeper", "pyre"]);
		expect(tail(ENEMY_ARCHETYPES, NEW_ENEMY_2_ARCHETYPES.size())).toEqual([...NEW_ENEMY_2_ARCHETYPES]);
		expect(ENEMY_ARCHETYPES[ENEMY_ARCHETYPES.size() - 1 - NEW_ENEMY_2_ARCHETYPES.size()]).toBe("golden");
		for (const a of NEW_ENEMY_2_ARCHETYPES) {
			expect([a, REQUIRED_ASSET_IDS.includes(`enemy.${a}`), slotFor(`enemy.${a}`)?.slot]).toEqual([
				a,
				true,
				"enemy",
			]);
			expect([a, REQUIRED_STRING_KEYS.includes(`enemy.${a}.name`)]).toEqual([a, true]);
			expect([a, (COLOR_ROLES as ReadonlyArray<string>).includes(`enemy.${a}`)]).toEqual([a, true]);
		}
	});

	it("the hook and flame bullet visuals sit right after the strike, required", () => {
		expect([...NEW_ENEMY_2_BULLET_IDS]).toEqual(["bullet.enemy.hook", "bullet.enemy.flame"]);
		const at = (BULLET_IDS as ReadonlyArray<string>).indexOf(STRIKE_BULLET_ID);
		expect([BULLET_IDS[at + 1], BULLET_IDS[at + 2]]).toEqual([HOOK_BULLET_ID, FLAME_BULLET_ID]);
		for (const id of NEW_ENEMY_2_BULLET_IDS) expect([id, REQUIRED_ASSET_IDS.includes(id)]).toEqual([id, true]);
	});

	it("the guard role is its own (not the Shielded affix's enemyShield)", () => {
		expect(ENEMY_GUARD_ROLE).toBe("enemyGuard");
		expect(ENEMY_GUARD_ROLE === ENEMY_SHIELD_ROLE).toBe(false);
		expect((COLOR_ROLES as ReadonlyArray<string>).includes(ENEMY_GUARD_ROLE)).toBe(true);
	});

	it("the eight sounds are PORT_AUDIO_EVENTS' last, required, sfx", () => {
		expect([...NEW_ENEMY_2_AUDIO_IDS]).toEqual([
			"sfx.enemy.block",
			"sfx.enemy.guardbreak",
			"sfx.enemy.hook",
			"sfx.enemy.hooklatch",
			"sfx.enemy.snatch",
			"sfx.enemy.swallow",
			"sfx.pellet.return",
			"sfx.enemy.pyrelight",
		]);
		expect(tail(PORT_AUDIO_EVENTS, NEW_ENEMY_2_AUDIO_IDS.size())).toEqual([...NEW_ENEMY_2_AUDIO_IDS]);
		for (const id of NEW_ENEMY_2_AUDIO_IDS)
			expect([id, REQUIRED_ASSET_IDS.includes(id), slotFor(id)?.soundGroup]).toEqual([id, true, "sfx"]);
	});

	it("four first-sighting lines and sighting ids, in the archetypes' block before the affixes; none for the brazier", () => {
		expect([...NEW_ENEMY_2_BESTIARY]).toEqual(["bulwark", "chainhook", "snatcher", "pyrekeeper"]);
		expect(tail(BESTIARY_ARCHETYPES, NEW_ENEMY_2_BESTIARY.size())).toEqual([...NEW_ENEMY_2_BESTIARY]);
		const firstAffix = BESTIARY_STRING_KEYS.indexOf("bestiary.affix.hulking");
		const firstAffixSighting = SIGHTING_IDS.indexOf("affix.hulking");
		for (let k = 0; k < NEW_ENEMY_2_BESTIARY.size(); k++) {
			const a = NEW_ENEMY_2_BESTIARY[k];
			const back = NEW_ENEMY_2_BESTIARY.size() - k;
			expect([a, BESTIARY_STRING_KEYS[firstAffix - back]]).toEqual([a, bestiaryArchetypeKey(a)]);
			expect([a, SIGHTING_IDS[firstAffixSighting - back]]).toEqual([a, a]);
			expect([a, REQUIRED_STRING_KEYS.includes(`bestiary.${a}`)]).toEqual([a, true]);
		}
		expect(BESTIARY_STRING_KEYS.includes("bestiary.pyre")).toBe(false);
		expect(SIGHTING_IDS.includes("pyre")).toBe(false);
	});

	it("placeholder shapes: a broad slab, a squat drum, the smallest cone, a slim robe, a low bowl; the hook a wedge", () => {
		for (const [a, shape] of SHAPES) {
			const v = PLACEHOLDER_VISUALS[`enemy.${a}`];
			expect([a, v.shape, v.color, v.outline]).toEqual([
				a,
				shape,
				{ kind: "role", role: `enemy.${a}` },
				"enemyOutline",
			]);
		}
		const slab = PLACEHOLDER_VISUALS["enemy.bulwark"].size;
		expect(slab[0] > slab[2]).toBe(true); // wider than deep: a shield turned to its target
		const smallest = PLACEHOLDER_VISUALS["enemy.snatcher"].size;
		expect(smallest[0] < PLACEHOLDER_VISUALS["enemy.bomber"].size[0]).toBe(true);
		const bowl = PLACEHOLDER_VISUALS["enemy.pyre"].size;
		expect(bowl[1] < bowl[0]).toBe(true);
		expect(PLACEHOLDER_VISUALS[HOOK_BULLET_ID]).toMatchObject({
			shape: "Wedge",
			color: { kind: "role", role: "enemyBullet" },
			material: "Neon",
		});
		expect(PLACEHOLDER_VISUALS[FLAME_BULLET_ID]).toMatchObject({
			shape: "Ball",
			color: { kind: "role", role: "enemyBullet" },
			material: "Neon",
		});
	});
});

describe("new enemies 2: bundled packs", () => {
	it("every bundled pack fills every new slot (placeholders, silent sounds) and validates", () => {
		for (const id of sortedKeys(THEME_PACKS)) {
			const pack = THEME_PACKS[id];
			const colors = pack.colors as unknown as Obj;
			for (const [a, name] of NAMES) {
				expect([id, a, pack.assets[`enemy.${a}`].kind]).toEqual([id, a, "placeholder"]);
				expect([id, a, typeIs(colors[`enemy.${a}`], "string")]).toEqual([id, a, true]);
				expect([id, a, pack.strings[`enemy.${a}.name`]]).toEqual([id, a, name]);
			}
			for (const a of NEW_ENEMY_2_BESTIARY) {
				const name = pack.strings[`enemy.${a}.name`] as string;
				const line = pack.strings[`bestiary.${a}`];
				expect([id, a, typeIs(line, "string")]).toEqual([id, a, true]);
				// "Name: tip" (l10n/context.json): the toast's name is the name string
				expect([id, a, (line as string).sub(1, name.size() + 1)]).toEqual([id, a, `${name}:`]);
			}
			for (const b of NEW_ENEMY_2_BULLET_IDS)
				expect([id, b, pack.assets[b].kind]).toEqual([id, b, "placeholder"]);
			for (const sfx of NEW_ENEMY_2_AUDIO_IDS)
				expect([id, sfx, pack.assets[sfx].kind]).toEqual([id, sfx, "silent"]);
			expect([id, typeIs(pack.colors[ENEMY_GUARD_ROLE], "string")]).toEqual([id, true]);
			expect([id, validateManifest(pack, { packId: id })]).toEqual([id, []]);
		}
	});

	it("a pack missing any of them fails validation", () => {
		const m = deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
		(m.assets as Obj)["enemy.pyre"] = undefined;
		(m.assets as Obj)[HOOK_BULLET_ID] = undefined;
		(m.assets as Obj)["sfx.enemy.hooklatch"] = undefined;
		(m.colors as Obj).enemyGuard = undefined;
		(m.strings as Obj)["enemy.pyrekeeper.name"] = undefined;
		(m.strings as Obj)["bestiary.snatcher"] = undefined;
		const errors = validateManifest(m);
		for (const needle of [
			"enemy.pyre",
			HOOK_BULLET_ID,
			"sfx.enemy.hooklatch",
			"enemyGuard",
			"enemy.pyrekeeper.name",
			"bestiary.snatcher",
		]) {
			expect([needle, errors.some((e) => e.find(needle, 1, true)[0] !== undefined)]).toEqual([needle, true]);
		}
		expect(errors.size()).toBe(6);
		expect(guardReport(m)).toEqual([]); // a missing role is skipped (the colour-role check reports it)
	});
});

describe("new enemies 2: guardReport", () => {
	it("holds the guard to its bars: floors, >= 40 CIE76 from bullets, goo, telegraph, the rim, affixes and boosts", () => {
		expect([...GUARD_COLOR_RULES.roles]).toEqual(["enemyGuard"]);
		expect([...GUARD_COLOR_RULES.against]).toEqual([
			...ENEMY_BULLET_ROLES,
			ENEMY_GOO_ROLE,
			"telegraph",
			"enemyOutline",
			...AFFIX_ROLES,
			ENEMY_SHIELD_ROLE,
			...BOOST_ROLES,
		]);
		expect([
			GUARD_COLOR_RULES.minFloorContrast,
			GUARD_COLOR_RULES.minDifference,
			GUARD_COLOR_RULES.minApart,
		]).toEqual([3, 40, 0]);
	});

	it("passes for every bundled pack (and vale's textured floor), every check in the report", () => {
		for (const [id, manifest] of packsToCheck()) {
			const report = guardReport(manifest);
			expect([id, report.filter((e) => e.check === "floor").size()]).toEqual([id, BIOMES.size()]);
			expect([id, report.filter((e) => e.check === "difference").size()]).toEqual([
				id,
				GUARD_COLOR_RULES.against.size(),
			]);
			for (const e of report) expect([id, e.check, e.against, e.ok]).toEqual([id, e.check, e.against, true]);
		}
	});

	it("the placeholder values as measured", () => {
		const report = guardReport(PLACEHOLDER_MANIFEST);
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

	it("rejects a guard in the Shielded affix's family", () => {
		const m = deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
		(m.colors as Obj).enemyGuard = (m.colors as Obj).enemyShield;
		const errors = validateManifest(m).filter(
			(e) =>
				e.find(`colors.enemyGuard`, 1, true)[0] !== undefined ||
				e.find(`colors["enemyGuard"]`, 1, true)[0] !== undefined,
		);
		expect(errors.size()).toBeGreaterThan(0);
		expect(errors.some((e) => e.find("must never read as an enemy bullet, goo", 1, true)[0] !== undefined)).toBe(
			true,
		);
	});
});

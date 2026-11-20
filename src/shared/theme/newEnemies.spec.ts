// Roblox port (docs/NEW_ENEMIES.md NE1): the second endless set's theme contract: five archetype slots (assets, colour
// roles, names, placeholder shapes), the Stormcaller's strike bullet visual, the Warbanner's aura colour role and its
// rules (auraReport), the six port audio IDs (SILENT in the placeholder) and the first-sighting lines; every one
// required and filled by every bundled pack.
import { describe, expect, it } from "@rbxts/jest-globals";
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
import { THEME_PACKS } from "./packs";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { VALE_FLOOR_HEX, buildValeManifest } from "./packs/vale";
import { VALE_ASSET_IDS } from "./packs/vale/assetIds";
import { PLACEHOLDER_VISUALS } from "./placeholders";
import { runOf } from "./testing";
import { COLOR_ROLES } from "./types";
import { deepClone, sortedKeys, type Obj } from "./util";
import { validateManifest } from "./validate";
import { AURA_COLOR_RULES, auraReport } from "./variantColors";
import {
	AFFIX_ROLES,
	BESTIARY_ARCHETYPES,
	BESTIARY_STRING_KEYS,
	ENEMY_AURA_ROLE,
	ENEMY_SHIELD_ROLE,
	STRIKE_BULLET_ID,
	bestiaryArchetypeKey,
} from "./variants";

const NEW = ["bomber", "charger", "stormcaller", "warbanner", "reaper"] as const;
const AUDIO = [
	"sfx.enemy.fuse",
	"sfx.enemy.blast",
	"sfx.enemy.charge",
	"sfx.enemy.stun",
	"sfx.enemy.strike",
	"sfx.enemy.spin",
];
// Uploaded 2026-11-03 (packs/vale/assetIds.ts; the warbanner and stormcaller ids added 2026-11-04).
const VALE_UPLOADED_SETS: ReadonlyArray<string> = ["bomber", "charger", "reaper", "stormcaller", "warbanner"];
const VALE_UPLOADED_AUDIO: ReadonlyArray<string> = [
	"sfx.enemy.fuse",
	"sfx.enemy.blast",
	"sfx.enemy.charge",
	"sfx.enemy.stun",
	"sfx.enemy.spin",
	"sfx.enemy.strike",
];
const SHAPES: ReadonlyArray<[string, string]> = [
	["bomber", "Cone"],
	["charger", "Wedge"],
	["stormcaller", "Cylinder"],
	["warbanner", "Cylinder"],
	["reaper", "Cylinder"],
];
const fixed1 = (n: number) => "%.1f".format(n);
const fixed2 = (n: number) => "%.2f".format(n);

function packsToCheck(): Array<[string, Obj]> {
	const out = new Array<[string, Obj]>();
	for (const id of sortedKeys(THEME_PACKS)) out.push([id, THEME_PACKS[id] as unknown as Obj]);
	const textured = buildValeManifest() as unknown as Obj;
	const biomes = textured.biomes as Obj;
	for (const b of sortedKeys(biomes)) (biomes[b] as Obj).floor = VALE_FLOOR_HEX;
	out.push(["vale (textured floors)", textured]);
	return out;
}

describe("new enemies: contract", () => {
	it("appends the five to ENEMY_ARCHETYPES (existing order kept), each a required asset, role and name", () => {
		// docs/FORTUNE.md FD9's Goldling (`golden`) comes right after them; later sets follow it.
		const run = [...NEW, "golden"];
		expect(runOf(ENEMY_ARCHETYPES, run)).toEqual(run);
		for (const a of NEW) {
			expect([a, REQUIRED_ASSET_IDS.includes(`enemy.${a}`), slotFor(`enemy.${a}`)?.slot]).toEqual([
				a,
				true,
				"enemy",
			]);
			expect([a, REQUIRED_STRING_KEYS.includes(`enemy.${a}.name`)]).toEqual([a, true]);
			expect([a, (COLOR_ROLES as ReadonlyArray<string>).includes(`enemy.${a}`)]).toEqual([a, true]);
		}
	});

	it("the strike bullet visual, the aura role, the six sounds and the first-sighting lines", () => {
		expect(STRIKE_BULLET_ID).toBe("bullet.enemy.strike");
		expect((BULLET_IDS as ReadonlyArray<string>).includes(STRIKE_BULLET_ID)).toBe(true);
		expect(REQUIRED_ASSET_IDS.includes(STRIKE_BULLET_ID)).toBe(true);
		expect(ENEMY_AURA_ROLE).toBe("enemyAura");
		expect((COLOR_ROLES as ReadonlyArray<string>).includes(ENEMY_AURA_ROLE)).toBe(true);
		// the six end the new enemies' block (docs/PELLETS.md PL6's three come after it)
		const blockEnd = (PORT_AUDIO_EVENTS as ReadonlyArray<string>).indexOf("sfx.enemy.spin") + 1;
		const tail: string[] = [];
		for (let i = blockEnd - AUDIO.size(); i < blockEnd; i++) tail.push(PORT_AUDIO_EVENTS[i]);
		expect(tail).toEqual(AUDIO);
		for (const id of AUDIO)
			expect([id, REQUIRED_ASSET_IDS.includes(id), slotFor(id)?.soundGroup]).toEqual([id, true, "sfx"]);
		for (const a of NEW) {
			expect([a, (BESTIARY_ARCHETYPES as ReadonlyArray<string>).includes(a)]).toEqual([a, true]);
			expect([a, BESTIARY_STRING_KEYS.includes(bestiaryArchetypeKey(a))]).toEqual([a, true]);
			expect([a, REQUIRED_STRING_KEYS.includes(`bestiary.${a}`)]).toEqual([a, true]);
		}
	});

	it("placeholder shapes: a small cone, a wedge, a tall drum, a thin post, a flat disc; the strike a flat neon disc", () => {
		for (const [a, shape] of SHAPES) {
			const v = PLACEHOLDER_VISUALS[`enemy.${a}`];
			expect([a, v.shape, v.color, v.outline]).toEqual([
				a,
				shape,
				{ kind: "role", role: `enemy.${a}` },
				"enemyOutline",
			]);
		}
		const imp = PLACEHOLDER_VISUALS["enemy.imp"];
		expect(PLACEHOLDER_VISUALS["enemy.bomber"].size[0] < imp.size[0]).toBe(true);
		const storm = PLACEHOLDER_VISUALS["enemy.stormcaller"].size;
		const post = PLACEHOLDER_VISUALS["enemy.warbanner"].size;
		const disc = PLACEHOLDER_VISUALS["enemy.reaper"].size;
		expect(storm[1] > storm[0] && post[1] > post[0] && post[0] < storm[0] && disc[1] < disc[0]).toBe(true);
		expect(PLACEHOLDER_VISUALS[STRIKE_BULLET_ID]).toMatchObject({
			shape: "Cylinder",
			color: { kind: "role", role: "enemyBullet" },
			material: "Neon",
			anchor: "base",
		});
	});
});

describe("new enemies: bundled packs", () => {
	it("every bundled pack fills every new slot and validates (vale: the uploaded sets and sounds are on)", () => {
		for (const id of sortedKeys(THEME_PACKS)) {
			const pack = THEME_PACKS[id];
			for (const a of NEW) {
				const kind = id === "vale" && VALE_UPLOADED_SETS.includes(a) ? "sprites" : "placeholder";
				expect([id, a, pack.assets[`enemy.${a}`].kind]).toEqual([id, a, kind]);
				expect([id, a, typeIs(pack.colors[`enemy.${a}`], "string")]).toEqual([id, a, true]);
				const name = pack.strings[`enemy.${a}.name`];
				const line = pack.strings[`bestiary.${a}`];
				expect([id, a, typeIs(name, "string") && typeIs(line, "string")]).toEqual([id, a, true]);
				// "Name: tip" (l10n/context.json): the toast's name is the name string
				expect([id, a, (line as string).sub(1, (name as string).size() + 1)]).toEqual([id, a, `${name}:`]);
			}
			// docs/HAZARD_ART.md HA7: vale draws the strike as a hazard sprite once hazards.png has an ID
			const strikeKind = id === "vale" && VALE_ASSET_IDS["hazards.png"] !== undefined ? "sprites" : "placeholder";
			expect([id, pack.assets[STRIKE_BULLET_ID].kind]).toEqual([id, strikeKind]);
			for (const sfx of AUDIO) {
				const kind = id === "vale" && VALE_UPLOADED_AUDIO.includes(sfx) ? "sound" : "silent";
				expect([id, sfx, pack.assets[sfx].kind]).toEqual([id, sfx, kind]);
			}
			expect([id, validateManifest(pack, { packId: id })]).toEqual([id, []]);
		}
	});

	it("a pack missing any of them fails validation", () => {
		const m = deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
		(m.assets as Obj)["enemy.charger"] = undefined;
		(m.assets as Obj)[STRIKE_BULLET_ID] = undefined;
		(m.assets as Obj)["sfx.enemy.spin"] = undefined;
		(m.colors as Obj).enemyAura = undefined;
		(m.strings as Obj)["enemy.reaper.name"] = undefined;
		(m.strings as Obj)["bestiary.warbanner"] = undefined;
		const errors = validateManifest(m);
		for (const needle of [
			"enemy.charger",
			STRIKE_BULLET_ID,
			"sfx.enemy.spin",
			"enemyAura",
			"enemy.reaper.name",
			"bestiary.warbanner",
		]) {
			expect([needle, errors.some((e) => e.find(needle, 1, true)[0] !== undefined)]).toEqual([needle, true]);
		}
		expect(errors.size()).toBe(6);
		expect(auraReport(m)).toEqual([]); // a missing role is skipped (the colour-role check reports it)
	});
});

describe("new enemies: auraReport", () => {
	it("holds the aura to the plan's bars: floors, >= 40 CIE76 from bullets, telegraph, boosts and affixes", () => {
		expect([...AURA_COLOR_RULES.roles]).toEqual(["enemyAura"]);
		expect([...AURA_COLOR_RULES.against]).toEqual([
			...ENEMY_BULLET_ROLES,
			"telegraph",
			...BOOST_ROLES,
			...AFFIX_ROLES,
			ENEMY_SHIELD_ROLE,
		]);
		expect([AURA_COLOR_RULES.minFloorContrast, AURA_COLOR_RULES.minDifference, AURA_COLOR_RULES.minApart]).toEqual([
			3, 40, 0,
		]);
	});

	it("passes for every bundled pack (and vale's textured floor), every check in the report", () => {
		for (const [id, manifest] of packsToCheck()) {
			const report = auraReport(manifest);
			expect([id, report.filter((e) => e.check === "floor").size()]).toEqual([id, BIOMES.size()]);
			expect([id, report.filter((e) => e.check === "difference").size()]).toEqual([
				id,
				AURA_COLOR_RULES.against.size(),
			]);
			for (const e of report) expect([id, e.check, e.against, e.ok]).toEqual([id, e.check, e.against, true]);
		}
	});

	it("the placeholder values as measured", () => {
		const report = auraReport(PLACEHOLDER_MANIFEST);
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
		expect([fixed2(floor), fixed1(diff), nearest]).toEqual(["3.21", "46.5", "boost.aegis"]);
	});

	it("rejects an aura in a threat's or a pickup's colour family", () => {
		const m = deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
		(m.colors as Obj).enemyAura = "#ff9a40"; // the telegraph's orange
		const errors = validateManifest(m).filter(
			(e) =>
				e.find(`colors.enemyAura`, 1, true)[0] !== undefined ||
				e.find(`colors["enemyAura"]`, 1, true)[0] !== undefined,
		);
		expect(errors.size()).toBeGreaterThan(0);
		expect(
			errors.some((e) => e.find("must never read as an enemy bullet, a telegraph", 1, true)[0] !== undefined),
		).toBe(true);
	});
});

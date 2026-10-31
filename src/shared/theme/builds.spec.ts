// Roblox port (docs/BUILDS.md BU1, "Theme contract"): the builds keys (strings, card and effect roles, effect bullet
// visuals, sounds) are in the contract's lists, every bundled pack fills them, and buildReport holds the effect colours
// to BUD12 (every check printed). contract.ts names the IDs inline (its compiled Luau sits at the 200-locals limit), so
// these specs are what keeps builds.ts and contract.ts in step.
import { describe, expect, it } from "@rbxts/jest-globals";
import { colorDifference, contrastRatio } from "./color";
import {
	BIOMES,
	BOON_RARITY_COLOR_RULES,
	BOOST_ROLES,
	BULLET_IDS,
	ENEMY_BULLET_ROLES,
	PORT_AUDIO_EVENTS,
	REQUIRED_ASSET_IDS,
	REQUIRED_STRING_KEYS,
	slotFor,
} from "./contract";
import { THEME_PACKS } from "./packs";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { VALE_FLOOR_HEX, buildValeManifest } from "./packs/vale";
import { PLACEHOLDER_VISUALS } from "./placeholders";
import { COLOR_ROLES } from "./types";
import { deepClone, sortedKeys, type Obj } from "./util";
import { validateManifest } from "./validate";
import { BUILD_COLOR_RULES, buildReport } from "./buildColors";
import {
	BOON_BUILD_ROLES,
	BUILD_AUDIO_IDS,
	BUILD_BULLET_IDS,
	BUILD_BULLET_ROLES,
	BUILD_EFFECT_ROLES,
	BUILD_STRING_KEYS,
} from "./builds";

const has = (list: ReadonlyArray<string>, id: string) => list.includes(id);
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

describe("builds: contract", () => {
	it("requires the build strings (BUILD_STRING_KEYS, written out in REQUIRED_STRING_KEYS)", () => {
		expect([...BUILD_STRING_KEYS]).toEqual([
			"hud.draft.level",
			"hud.draft.evolve",
			"hud.draft.duo",
			"hud.draft.again",
			"hud.toast.evolved",
			"hud.toast.duo",
			"hud.build.title",
		]);
		for (const k of BUILD_STRING_KEYS) expect([k, has(REQUIRED_STRING_KEYS, k)]).toEqual([k, true]);
		expect(new Set(REQUIRED_STRING_KEYS).size()).toBe(REQUIRED_STRING_KEYS.size());
	});

	it("adds the card and effect colour roles; the card frames climb the rarity ladder in boonRarityReport", () => {
		for (const r of [...BOON_BUILD_ROLES, ...BUILD_EFFECT_ROLES])
			expect([r, has(COLOR_ROLES, r)]).toEqual([r, true]);
		const n = BOON_RARITY_COLOR_RULES.roles.size();
		expect([BOON_RARITY_COLOR_RULES.roles[n - 2], BOON_RARITY_COLOR_RULES.roles[n - 1]]).toEqual([
			...BOON_BUILD_ROLES,
		]);
	});

	it("appends the four effect bullet visuals (required, placeholder neon in their effect colours; the ember a disc)", () => {
		const n = BULLET_IDS.size();
		const tail = new Array<string>();
		for (let i = n - BUILD_BULLET_IDS.size(); i < n; i++) tail.push(BULLET_IDS[i]);
		expect(tail).toEqual([...BUILD_BULLET_IDS]);
		BUILD_BULLET_IDS.forEach((id, k) => {
			expect([id, has(REQUIRED_ASSET_IDS, id)]).toEqual([id, true]);
			const v = PLACEHOLDER_VISUALS[id];
			expect([id, v.color, v.material]).toEqual([id, { kind: "role", role: BUILD_BULLET_ROLES[k] }, "Neon"]);
		});
		expect(PLACEHOLDER_VISUALS["bullet.player.ember"].shape).toBe("Cylinder");
		expect(PLACEHOLDER_VISUALS["bullet.player.burst"].shape).toBe("Block");
	});

	it("appends the nine build sounds to PORT_AUDIO_EVENTS: required, sfx, SILENT in the placeholder", () => {
		const n = PORT_AUDIO_EVENTS.size();
		const tail = new Array<string>();
		for (let i = n - BUILD_AUDIO_IDS.size(); i < n; i++) tail.push(PORT_AUDIO_EVENTS[i]);
		expect(tail).toEqual([...BUILD_AUDIO_IDS]);
		const assets = PLACEHOLDER_MANIFEST.assets as unknown as Record<string, { kind: string }>;
		for (const id of BUILD_AUDIO_IDS) {
			expect([id, has(REQUIRED_ASSET_IDS, id), slotFor(id)?.soundGroup, assets[id].kind]).toEqual([
				id,
				true,
				"sfx",
				"silent",
			]);
		}
	});
});

describe("builds: buildReport (BUD12)", () => {
	it("holds every effect colour to the plan's bars", () => {
		expect([...BUILD_COLOR_RULES.roles]).toEqual([...BUILD_EFFECT_ROLES]);
		expect([...BUILD_COLOR_RULES.against]).toEqual([
			...ENEMY_BULLET_ROLES,
			"telegraph",
			"enemyGoo",
			"enemyOutline",
			...BOOST_ROLES,
		]);
		expect([BUILD_COLOR_RULES.minFloorContrast, BUILD_COLOR_RULES.minDifference]).toEqual([3, 40]);
	});

	it("passes for every bundled pack (and vale's textured floor), every check in the report (numbers printed)", () => {
		const rules = BUILD_COLOR_RULES;
		for (const [id, manifest] of packsToCheck()) {
			const report = buildReport(manifest);
			const count = (check: string) => report.filter((e) => e.check === check).size();
			expect([id, count("floor"), count("difference")]).toEqual([
				id,
				rules.roles.size() * BIOMES.size(),
				rules.roles.size() * rules.against.size(),
			]);
			for (const e of report) {
				expect([id, e.role, e.check, e.against, e.ok]).toEqual([id, e.role, e.check, e.against, true]);
				const value =
					e.check === "floor"
						? contrastRatio(e.color, e.againstColor)
						: colorDifference(e.color, e.againstColor);
				expect(e.value).toBe(value);
				print(
					`[build] ${id} ${e.role} ${e.check} vs ${e.against}: ${
						e.check === "floor" ? `${fixed2(e.value)}:1` : fixed1(e.value)
					}`,
				);
			}
			if (id !== "vale (textured floors)")
				expect([id, validateManifest(manifest, { packId: id })]).toEqual([id, []]);
		}
	});

	it("an effect colour that reads as danger or vanishes on a floor fails validateManifest", () => {
		const m = deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
		const colors = m.colors as Obj;
		colors["build.burst"] = colors.telegraph;
		const errors = validateManifest(m);
		expect(errors.size() > 0).toBe(true);
		for (const e of errors) expect(e.find("build.burst", 1, true)[0] !== undefined).toBe(true);
		expect(errors.some((e) => e.find("vs telegraph", 1, true)[0] !== undefined)).toBe(true);
		const dark = deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
		(dark.colors as Obj)["build.ember"] = "#202020";
		expect(validateManifest(dark).some((e) => e.find("must read on the floor", 1, true)[0] !== undefined)).toBe(
			true,
		);
	});
});

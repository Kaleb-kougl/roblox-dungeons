// Floor inputs of the stage asset manifest (docs/STAGE_ASSETS.md SA3): the forecast is a superset of the exact input
// (and so its vale manifest of the exact one's) over endless floors, the tutorial's floors and M1 read exactly, the
// forecast forges nothing, the first-floor guess covers every floor-1 roster, the biome rule.
//
// Seeds 1-12 x floors 1-10 (120 forged floors), not the plan's 1-60 x 1-20: a floor costs about 110 ms to forge, so
// 1,200 would take minutes. Floors 15 and 20 (boss floors deep in the run) are checked on two seeds. The daily and dev
// worlds build the same floors (buildEndlessRunConfig; dev from its start floor), so they need no rows of their own.
import { describe, expect, it } from "@rbxts/jest-globals";
import { TUTORIAL } from "shared/config";
import { BOSS_ACT1_KIND, ENDLESS_FIRST_FLOOR, THEME_KEYS, endlessRoster } from "shared/dungeon";
import { DEFAULT_SIM_CONFIG } from "shared/sim";
import { ThemePack } from "shared/theme";
import { VALE_MANIFEST } from "shared/theme/packs/vale";
import { STAGE_ASSETS, STAGE_CHARACTERS, STAGE_FEATURES, stageAssets, type StageAssetInput } from "shared/view";
import {
	TUTORIAL_WORLD_KIND,
	biomeIndexForTheme,
	biomeIndexOf,
	buildRunConfig,
	buildTutorialRunConfig,
	cachedEndlessDungeonKeys,
	endlessRunFloor,
	forecastFirstFloor,
	forecastStageInput,
	stageInputOf,
	stageInputOfLayout,
} from "shared/run";

const quiet = () => undefined;
const vale = new ThemePack(VALE_MANIFEST, { warn: quiet });

/** Every field of `exact` is covered by `forecast`: kinds, boss, biome, features. */
function expectCovers(label: string, forecast: StageAssetInput, exact: StageAssetInput): void {
	for (const k of exact.actorKinds) expect([label, k, forecast.actorKinds.includes(k)]).toEqual([label, k, true]);
	expect([label, "boss", forecast.bossKind]).toEqual([label, "boss", exact.bossKind]);
	expect([label, "biome", forecast.biome]).toEqual([label, "biome", exact.biome]);
	for (const f of STAGE_FEATURES) {
		expect([label, f, !exact.features[f] || forecast.features[f]]).toEqual([label, f, true]);
	}
}

/** Every id of the exact input's vale manifest is in the forecast's. */
function expectManifestCovers(label: string, forecast: StageAssetInput, exact: StageAssetInput): void {
	const f = stageAssets(vale, forecast).must;
	for (const id of stageAssets(vale, exact).must) expect([label, id, f.includes(id)]).toEqual([label, id, true]);
}

describe("stage floor inputs (docs/STAGE_ASSETS.md SA3)", () => {
	it("forecast covers the exact input over seeds 1-12 x floors 1-10", () => {
		for (let seed = 1; seed <= 12; seed++) {
			for (let floor = 1; floor <= 10; floor++) {
				const label = `${seed}/${floor}`;
				const exact = stageInputOfLayout("endless", endlessRunFloor(seed, floor).layout, STAGE_CHARACTERS);
				const forecast = forecastStageInput(seed, floor, STAGE_CHARACTERS);
				expectCovers(label, forecast, exact);
				if (floor === 1 || floor === 5 || floor === 10) expectManifestCovers(label, forecast, exact);
			}
		}
	});

	it("forecast covers the exact input on deep boss floors", () => {
		for (const seed of [3, 1337]) {
			for (const floor of [15, 20]) {
				const exact = stageInputOfLayout("endless", endlessRunFloor(seed, floor).layout, STAGE_CHARACTERS);
				expect(exact.bossKind).toBeDefined();
				expectCovers(`${seed}/${floor}`, forecastStageInput(seed, floor, STAGE_CHARACTERS), exact);
			}
		}
	});

	it("an exact endless input lists the floor's spawns once each, the boss among them, and its features", () => {
		const layout = endlessRunFloor(7, 5).layout;
		const exact = stageInputOfLayout("endless", layout, STAGE_CHARACTERS, true);
		expect(exact.runStart).toBe(true);
		expect(exact.floor).toBe(5);
		expect(exact.bossKind).toBe(layout.bossKind);
		expect(exact.actorKinds.includes(layout.bossKind!)).toBe(true);
		const kinds = new Set<string>();
		for (const room of layout.roomSpawns) for (const s of room) kinds.add(s.kind);
		for (const s of layout.encounter.spawns) kinds.add(s.kind);
		expect(exact.actorKinds.size()).toBe(kinds.size());
		for (const k of exact.actorKinds) expect(kinds.has(k)).toBe(true);
		expect(exact.biome).toBe(biomeIndexOf(layout.dungeon));
		expect(exact.features.breakables).toBe((layout.breakables?.size() ?? 0) > 0);
		expect(exact.features.vault).toBe(layout.vault !== undefined);
		expect(exact.features.golden).toBe(layout.golden !== undefined);
	});

	it("stageInputOf reads an endless run's floor through its endlessFloor", () => {
		let calls = 0;
		const floorOf = (f: number) => {
			calls += 1;
			return endlessRunFloor(9, f);
		};
		const src = { world: "endless", dungeon: undefined, config: DEFAULT_SIM_CONFIG, endlessFloor: floorOf };
		const viaRun = stageInputOf(src, 2, STAGE_CHARACTERS);
		expect(calls).toBe(1);
		expect(viaRun).toEqual(stageInputOfLayout("endless", endlessRunFloor(9, 2).layout, STAGE_CHARACTERS));
	});

	it("the tutorial's floors read exactly; its world extras are keyed by its world kind", () => {
		const setup = buildTutorialRunConfig();
		const src = {
			world: TUTORIAL_WORLD_KIND,
			dungeon: setup.dungeon,
			config: setup.config,
			endlessFloor: setup.endlessFloor,
		};
		const first = stageInputOf(src, ENDLESS_FIRST_FLOOR, STAGE_CHARACTERS, true);
		expect(first.actorKinds.includes("dummy")).toBe(true);
		// docs/ARCHER.md AR6: combat E (the turret sniper) left floor 1; combat G keeps its ordinary sniper.
		expect(first.actorKinds.includes("turret.sniper")).toBe(false);
		expect(first.actorKinds.includes("sniper")).toBe(true);
		expect(first.features.pellets).toBe(true);
		expect(first.features.breakables).toBe(false);
		expect(first.bossKind).toBeUndefined();
		const last = stageInputOf(src, TUTORIAL.lastFloor, STAGE_CHARACTERS);
		expect(last.bossKind).toBe(BOSS_ACT1_KIND);
		expect(STAGE_ASSETS.worlds[TUTORIAL_WORLD_KIND]).toBeDefined();
		const must = stageAssets(vale, first).must;
		for (const id of ["enemy.dummy", "enemy.sniper", "music.tutorial", "class.vanguard", "pellet.normal"]) {
			expect([id, must.includes(id)]).toEqual([id, true]);
		}
		const lastMust = stageAssets(vale, last).must;
		expect(lastMust.includes("boss.act1")).toBe(true);
		expect(lastMust.includes("music.boss")).toBe(true);
	});

	it("M1 reads its encounter: every initial spawn kind, Mother Mayhem as the boss, no endless features", () => {
		const setup = buildRunConfig(42);
		const src = { world: "game", dungeon: setup.dungeon, config: setup.config, endlessFloor: undefined };
		const exact = stageInputOf(src, 1, STAGE_CHARACTERS);
		const kinds = new Set<string>();
		for (const s of setup.config.encounter!.spawns) kinds.add(s.kind);
		expect(exact.actorKinds.size()).toBe(kinds.size());
		expect(exact.bossKind).toBe(BOSS_ACT1_KIND);
		expect(exact.biome).toBe(biomeIndexOf(setup.dungeon));
		expect(exact.features.breakables).toBe(false);
		expect(exact.features.vault).toBe(false);
		expect(stageAssets(vale, exact).must.includes("boss.act1")).toBe(true);
	});

	it("the forecast forges nothing", () => {
		const before = cachedEndlessDungeonKeys();
		for (let floor = 1; floor <= 20; floor++) {
			forecastStageInput(987654, floor, STAGE_CHARACTERS);
			forecastStageInput(987654, floor, STAGE_CHARACTERS, "daily");
		}
		expect(cachedEndlessDungeonKeys()).toEqual(before);
	});

	it("the first-floor guess covers every run's floor-1 roster", () => {
		const guess = forecastFirstFloor(STAGE_CHARACTERS);
		expect(guess.biome).toBe(1);
		expect(guess.runStart).toBe(true);
		for (let seed = 1; seed <= 60; seed++) {
			for (const k of endlessRoster(seed, ENDLESS_FIRST_FLOOR)) {
				expect([seed, k, guess.actorKinds.includes(k)]).toEqual([seed, k, true]);
			}
		}
		expect(forecastFirstFloor(STAGE_CHARACTERS, 3).biome).toBe(3);
	});

	it("the biome rule: each Forge theme is its BIOMES index, anything else 0", () => {
		for (let i = 0; i < THEME_KEYS.size(); i++) expect(biomeIndexForTheme(THEME_KEYS[i]) > 0).toBe(true);
		expect(biomeIndexForTheme("ancient")).toBe(1);
		expect(biomeIndexForTheme("verdant")).toBe(5);
		expect(biomeIndexForTheme("nope")).toBe(0);
		expect(biomeIndexOf(undefined)).toBe(0);
	});
});

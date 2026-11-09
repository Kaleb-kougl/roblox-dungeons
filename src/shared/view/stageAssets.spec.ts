// The stage asset manifest (docs/STAGE_ASSETS.md SA2): children expand (a summoner floor holds swarmers, an Ooze floor
// its slimelets, a boss floor its adds and music.boss), the run kit only on a run start, the front-lane order, the
// `soon` split, content refs deduped, an empty manifest for the placeholder pack, the audit diff.
import { describe, expect, it } from "@rbxts/jest-globals";
import { PLACEHOLDER_MANIFEST, ThemePack, type ContentRef, type RobloxAssetId } from "shared/theme";
import { VALE_MANIFEST } from "shared/theme/packs/vale";
import {
	ALL_STAGE_FEATURES,
	NO_STAGE_FEATURES,
	STAGE_ASSETS,
	STAGE_CHARACTERS,
	STAGE_GROUPS,
	stageAssetGroups,
	stageAssets,
	stageAssetsInOrder,
	stageAuditMisses,
	stageContentRefs,
	stageKindsWithChildren,
	type PreloadSource,
	type StageAssetInput,
} from "shared/view";

const quiet = () => undefined;
const vale = new ThemePack(VALE_MANIFEST, { warn: quiet });
const placeholder = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });
const startsWith = (s: string, prefix: string) => s.sub(1, prefix.size()) === prefix;

function input(over: Partial<StageAssetInput> = {}): StageAssetInput {
	return {
		world: "endless",
		floor: 3,
		biome: 1,
		characters: STAGE_CHARACTERS,
		actorKinds: ["swarmer"],
		features: NO_STAGE_FEATURES,
		runStart: false,
		...over,
	};
}

/** A hand-built source: logical id -> refs, biome key -> refs. */
const fakeId = (n: number) => `test://${n}` as unknown as RobloxAssetId;
const image = (n: number): ContentRef => ({ contentId: fakeId(n), media: "image" });
function fakeSource(assets: Record<string, ContentRef[]>, biomes: Record<string, ContentRef[]>): PreloadSource {
	const sorted = (t: Record<string, ContentRef[]>) => {
		const keys = new Array<string>();
		for (const [k] of t as unknown as ReadonlyMap<string, ContentRef[]>) keys.push(k);
		keys.sort();
		return keys;
	};
	return {
		assetIdList() {
			return sorted(assets);
		},
		contentIds(id) {
			return assets[id] ?? [];
		},
		biomeKeys() {
			return sorted(biomes);
		},
		biomeContentIds(b) {
			return biomes[b] ?? [];
		},
	};
}

describe("stage asset manifest (docs/STAGE_ASSETS.md SA2)", () => {
	it("a summoner floor holds swarmers; an Ooze floor its slimelets; a boss floor its adds and music.boss", () => {
		const summoner = stageAssets(vale, input({ actorKinds: ["summoner"] })).must;
		expect(summoner.includes("enemy.summoner")).toBe(true);
		expect(summoner.includes("enemy.swarmer")).toBe(true);
		expect(stageKindsWithChildren(["slime"])).toEqual(["slime", "slime.small"]);
		expect(stageAssets(vale, input({ actorKinds: ["slime"] })).must.includes("enemy.slime")).toBe(true);
		const boss = stageAssets(vale, input({ actorKinds: [], bossKind: "boss.demonlord", floor: 5 })).must;
		expect(boss.includes("boss.demonlord")).toBe(true);
		expect(boss.includes("enemy.swarmer")).toBe(true);
		expect(boss.includes("music.boss")).toBe(true);
		expect(stageAssets(vale, input()).must.includes("music.boss")).toBe(false);
	});

	it("the run kit joins on a run start only", () => {
		const start = stageAssets(vale, input({ runStart: true })).must;
		const change = stageAssets(vale, input()).must;
		expect(start.includes("sfx.player.swing")).toBe(true);
		expect(start.includes("ui.heart.full")).toBe(true);
		expect(start.includes("boost.fury")).toBe(true);
		expect(change.includes("sfx.player.swing")).toBe(false);
		expect(change.includes("ui.heart.full")).toBe(false);
		// bullets are their own group, on every stage
		expect(change.includes("bullet.enemy.small")).toBe(true);
	});

	it("orders characters, bullets, actors, biome, features, run kit, audio; each id once", () => {
		const groups = stageAssetGroups(
			vale,
			input({ actorKinds: ["sniper", "swarmer"], features: ALL_STAGE_FEATURES, runStart: true }),
		);
		expect(groups.map((g) => g.group)).toEqual([...STAGE_GROUPS]);
		expect(groups[0].ids).toEqual(["class.vanguard"]);
		expect(groups[1].ids.every((id) => startsWith(id, "bullet."))).toBe(true);
		expect(groups[2].ids).toEqual(["enemy.sniper", "enemy.swarmer"]);
		expect(groups[3].ids[0]).toBe("biome:biome.1");
		expect(groups[4].ids.includes("pact.altar")).toBe(true);
		expect(groups[5].ids.includes("bullet.enemy.small")).toBe(false); // already in bullets
		expect(groups[6].ids).toEqual(["music.biome.1", "amb.b1"]);
		const all = stageAssetsInOrder(
			vale,
			input({ actorKinds: ["sniper"], features: ALL_STAGE_FEATURES, runStart: true }),
		);
		const seen = new Set<string>();
		for (const id of all) {
			expect([id, seen.has(id)]).toEqual([id, false]);
			seen.add(id);
		}
	});

	it("the tutorial world adds the dummy and its track; biome-free decor needs a biome", () => {
		const t = stageAssets(vale, input({ world: "tutorial", actorKinds: [] })).must;
		expect(t.includes("enemy.dummy")).toBe(true);
		expect(t.includes("music.tutorial")).toBe(true);
		expect(stageAssets(vale, input()).must.includes("music.tutorial")).toBe(false);
		expect(stageAssets(vale, input()).must.includes("decor.fx.torch")).toBe(true);
		expect(stageAssets(vale, input({ biome: 0 })).must.includes("decor.fx.torch")).toBe(false);
	});

	it("splits ids matching STAGE_ASSETS.soon into soon, keeping the order", () => {
		const cfg = { ...STAGE_ASSETS, soon: ["music."] };
		const set = stageAssets(vale, input({ bossKind: "boss.act1" }), cfg);
		expect(set.soon).toEqual(["music.biome.1", "music.boss"]);
		expect(set.must.some((id) => startsWith(id, "music."))).toBe(false);
		expect(stageAssets(vale, input()).soon).toEqual([]);
	});

	it("content refs: must then soon, each content id once (a shared id stays in must), biomes resolved", () => {
		const src = fakeSource(
			{ "enemy.swarmer": [image(1), image(2)], "music.biome.1": [image(2), image(3)] },
			{ "biome.1": [image(4), image(1)] },
		);
		const set = { must: ["enemy.swarmer", "biome:biome.1"], soon: ["music.biome.1"] };
		const refs = stageContentRefs(src, set);
		expect(refs.must).toEqual([image(1), image(2), image(4)]);
		expect(refs.soon).toEqual([image(3)]);
	});

	it("vale content refs are deduped and every one is a content id of the pack", () => {
		const set = stageAssets(vale, input({ features: ALL_STAGE_FEATURES, runStart: true, bossKind: "boss.act1" }));
		const refs = stageContentRefs(vale, set);
		expect(refs.must.size()).toBeGreaterThan(0);
		const seen = new Set<string>();
		for (const r of refs.must) {
			expect([r.contentId, seen.has(r.contentId)]).toEqual([r.contentId, false]);
			seen.add(r.contentId);
		}
	});

	it("placeholder: the manifest and its refs are empty", () => {
		const full = input({
			world: "tutorial",
			actorKinds: ["swarmer", "summoner", "slime"],
			bossKind: "boss.act1",
			features: ALL_STAGE_FEATURES,
			runStart: true,
		});
		for (let biome = 0; biome <= 5; biome++) {
			const set = stageAssets(placeholder, { ...full, biome });
			expect([biome, set.must, set.soon]).toEqual([biome, [], []]);
			const refs = stageContentRefs(placeholder, set);
			expect([biome, refs.must, refs.soon]).toEqual([biome, [], []]);
		}
	});

	it("the audit diff lists used ids the manifest lacks, sorted, once", () => {
		expect(stageAuditMisses(["a", "b"], ["b", "d", "c", "d", "a"])).toEqual(["c", "d"]);
		expect(stageAuditMisses([], [])).toEqual([]);
		const set = stageAssets(vale, input({ actorKinds: ["summoner"] }));
		expect(stageAuditMisses([...set.must, ...set.soon], ["enemy.swarmer", "enemy.slime"])).toEqual(["enemy.slime"]);
	});
});

// Theme groups of the stage manifest (docs/STAGE_ASSETS.md SA1): actor kind -> its drawn id, children to a fixed point,
// a biome's art and beds, biome-free decor, features; the vale pack's biome 2 holds its tiles and decor; every group of
// the placeholder pack is empty; the music / ambience ids agree with the audio layer's.
import { describe, expect, it } from "@rbxts/jest-globals";
import { AMBIENCE_IDS, PLACEHOLDER_MANIFEST, ThemePack } from "shared/theme";
import { VALE_MANIFEST } from "shared/theme/packs/vale";
import { archetypeAt, archetypeIds, archetypeIndex, hasArchetype } from "shared/sim";
import {
	STAGE_ASSETS,
	STAGE_CHARACTERS,
	STAGE_FEATURES,
	stageActorGroup,
	stageActorVisualId,
	stageBiomeAudio,
	stageBiomeGroup,
	stageCharacterGroup,
	stageDecorBiome,
	stageEntryMatches,
	stageExpand,
	stageFeatureGroup,
	stageFreeDecorGroup,
	stageKindsWithChildren,
} from "shared/view";
import { MUSIC, biomeAmbience, biomeMusic, BIOME_MUSIC_COUNT } from "shared/view/audio";

const quiet = () => undefined;
const startsWith = (s: string, prefix: string) => s.sub(1, prefix.size()) === prefix;
const vale = new ThemePack(VALE_MANIFEST, { warn: quiet });
const placeholder = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });

describe("stage groups (docs/STAGE_ASSETS.md SA1)", () => {
	it("matches an entry ending in '.' as a prefix, any other entry exactly", () => {
		expect(stageEntryMatches("sfx.", "sfx.ui.click")).toBe(true);
		expect(stageEntryMatches("sfx.", "sfxx.a")).toBe(false);
		expect(stageEntryMatches("music.biome.1", "music.biome.1")).toBe(true);
		expect(stageEntryMatches("music.biome.1", "music.biome.10")).toBe(false);
		expect(stageEntryMatches("biome:biome.1", "biome:biome.1")).toBe(true);
	});

	it("maps an actor kind to the id its archetype draws (data.spriteId), else a boss id or enemy.<kind>", () => {
		expect(stageActorVisualId("swarmer")).toBe("enemy.swarmer");
		expect(stageActorVisualId("turret.sniper")).toBe("enemy.sniper");
		expect(stageActorVisualId("turret.sprayer")).toBe("enemy.sprayer");
		expect(stageActorVisualId("slime.small")).toBe("enemy.slime");
		expect(stageActorVisualId("boss.act1")).toBe("boss.act1");
		expect(stageActorVisualId("boss.demonlord")).toBe("boss.demonlord");
		expect(stageActorVisualId("dummy")).toBe("enemy.dummy");
		expect(stageActorVisualId("golden")).toBe("enemy.golden");
		expect(stageActorVisualId("no.such.kind")).toBe("enemy.no.such.kind");
		for (const id of archetypeIds()) {
			expect([id, stageActorVisualId(id)]).toEqual([id, archetypeAt(archetypeIndex(id)).data.spriteId]);
		}
	});

	it("expands runtime children to a fixed point, each kind once, each followed by its children", () => {
		expect(stageKindsWithChildren(["summoner"])).toEqual(["summoner", "swarmer"]);
		expect(stageKindsWithChildren(["slime", "swarmer"])).toEqual(["slime", "slime.small", "swarmer"]);
		expect(stageKindsWithChildren(["boss.demonlord", "boss.act1"])).toEqual([
			"boss.demonlord",
			"swarmer",
			"boss.act1",
		]);
		// a cycle stops at the fixed point
		const cyclic = { ...STAGE_ASSETS, children: { a: ["b"], b: ["a", "c"] } };
		expect(stageKindsWithChildren(["a"], cyclic)).toEqual(["a", "b", "c"]);
	});

	it("children name registered archetypes and match the sim's own spawn kinds", () => {
		const children = STAGE_ASSETS.children as unknown as ReadonlyMap<string, ReadonlyArray<string>>;
		for (const [parent, kids] of children) {
			expect([parent, hasArchetype(parent)]).toEqual([parent, true]);
			for (const k of kids) expect([k, hasArchetype(k)]).toEqual([k, true]);
		}
		const summoner = archetypeAt(archetypeIndex("summoner")).data as unknown as { summonKind: string };
		expect(STAGE_ASSETS.children.summoner).toEqual([summoner.summonKind]);
		const slime = archetypeAt(archetypeIndex("slime")).data as unknown as { splitKind: string };
		expect(STAGE_ASSETS.children.slime).toEqual([slime.splitKind]);
	});

	it("vale: actor and character groups list the drawn ids once", () => {
		expect(stageActorGroup(vale, ["summoner", "turret.sniper", "sniper"])).toEqual([
			"enemy.summoner",
			"enemy.swarmer",
			"enemy.sniper",
		]);
		expect(stageCharacterGroup(vale, STAGE_CHARACTERS)).toEqual(["class.vanguard"]);
	});

	it("vale: biome 2 holds its own content, its tiles and its decor, nothing of another biome", () => {
		const g = stageBiomeGroup(vale, 2);
		expect(g.includes("biome:biome.2")).toBe(true);
		expect(g.includes("tile.biome.2.floor")).toBe(true);
		expect(g.includes("tile.biome.2.wall")).toBe(true);
		expect(g.some((id) => startsWith(id, "decor.delve.b2."))).toBe(true);
		expect(g.some((id) => startsWith(id, "decor.void.b2."))).toBe(true);
		expect(g.includes("decor.fx.ambient.b2")).toBe(true);
		for (const id of g) {
			const own = id === "biome:biome.2" || stageDecorBiome(id) === 2 || startsWith(id, "tile.biome.2.");
			expect([id, own]).toEqual([id, true]);
		}
		expect(stageBiomeGroup(vale, 0)).toEqual([]);
		expect(stageBiomeGroup(vale, 6)).toEqual([]);
	});

	it("vale: biome beds are the biome's music and ambience when the pack has them", () => {
		expect(stageBiomeAudio(vale, 1)).toEqual(["music.biome.1", "amb.b1"]);
		for (let n = 1; n <= BIOME_MUSIC_COUNT; n++) {
			for (const id of stageBiomeAudio(vale, n)) {
				expect([n, id === biomeMusic(n) || id === biomeAmbience(n)]).toEqual([n, true]);
			}
		}
		expect(stageBiomeAudio(vale, 0)).toEqual([]);
	});

	it("the decor rule: a b<n> segment scopes an id to biome n; the rest is biome-free", () => {
		expect(stageDecorBiome("decor.delve.b3.torch.2")).toBe(3);
		expect(stageDecorBiome("decor.void.b5.cage.1")).toBe(5);
		expect(stageDecorBiome("decor.fx.ambient.b4")).toBe(4);
		expect(stageDecorBiome("decor.fx.torch")).toBe(0);
		expect(stageDecorBiome("enemy.b2")).toBe(0);
		const free = stageFreeDecorGroup(vale);
		expect(free.includes("decor.fx.torch")).toBe(true);
		expect(free.includes("decor.fx.glint")).toBe(false); // claimed by breakableLoot
		expect(free.includes("decor.fx.ambient.b1")).toBe(false);
	});

	it("vale: features list their art", () => {
		expect(stageFeatureGroup(vale, "vault")).toEqual([
			"treasure.cage",
			"treasure.chest",
			"treasure.chestopen",
			"fx.treasure.column",
		]);
		expect(stageFeatureGroup(vale, "pacts")).toEqual(["pact.altar"]);
		expect(stageFeatureGroup(vale, "golden")).toEqual(["enemy.golden", "fx.golden.coin"]);
		expect(stageFeatureGroup(vale, "powerPellet")).toEqual(["pellet.power"]);
	});

	it("placeholder: every group is empty", () => {
		expect(stageActorGroup(placeholder, archetypeIds())).toEqual([]);
		expect(stageCharacterGroup(placeholder, STAGE_CHARACTERS)).toEqual([]);
		for (let n = 1; n <= BIOME_MUSIC_COUNT; n++) {
			expect(stageBiomeGroup(placeholder, n)).toEqual([]);
			expect(stageBiomeAudio(placeholder, n)).toEqual([]);
		}
		expect(stageFreeDecorGroup(placeholder)).toEqual([]);
		for (const f of STAGE_FEATURES) expect([f, stageFeatureGroup(placeholder, f)]).toEqual([f, []]);
		expect(stageExpand(placeholder, STAGE_ASSETS.runKit)).toEqual([]);
	});

	it("the config's music and ambience ids are the audio layer's", () => {
		for (let n = 1; n <= BIOME_MUSIC_COUNT; n++) {
			expect(`${STAGE_ASSETS.biomeMusicPrefix}${n}`).toBe(biomeMusic(n));
			expect(AMBIENCE_IDS[n - 1] as string).toBe(biomeAmbience(n));
		}
		expect(STAGE_ASSETS.bossAudio).toEqual([MUSIC.boss]);
		expect(STAGE_ASSETS.worlds.tutorial?.audio).toEqual([MUSIC.tutorial]);
		expect(STAGE_ASSETS.notStaged.includes(MUSIC.menu)).toBe(true);
		expect(STAGE_ASSETS.notStaged.includes(MUSIC.lobby)).toBe(true);
	});
});

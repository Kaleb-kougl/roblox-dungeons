// Roblox port (docs/FX_AUDIO.md A2): the audio half of the theme contract. Sound variants, pitch jitter and per-clip
// minimum intervals, the port's audio IDs (PORT_AUDIO_EVENTS), the ambience slot (amb.b<n>), the validator's checks
// and ThemeCore.sound's resolution.
import { describe, expect, it } from "@rbxts/jest-globals";
import { PORT_SFX, allAudioIds } from "shared/view/audio";
import {
	AMBIENCE,
	AMBIENCE_IDS,
	AUDIO_EVENTS,
	BIOMES,
	BREAKABLE_AUDIO_EVENTS,
	DECOR_BIOME_KEYS,
	PORT_AUDIO_EVENTS,
	REQUIRED_ASSET_IDS,
	SLOTS,
	SOUND_PITCH_LIMITS,
	SOUND_PRESENTATION_KEYS,
	ambienceId,
	isAmbienceId,
	slotFor,
} from "./contract";
import { ThemeCore } from "./core";
import { ThemePack } from "./pack";
import { THEME_PACKS } from "./packs";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { deepClone, sortedKeys, type Obj } from "./util";
import { isGameplayKey, validateManifest } from "./validate";

const clone = (): Obj => deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
const assetsOf = (m: Obj) => m.assets as Obj;

/** Validator errors for the placeholder pack plus `assets`. */
function withAssets(assets: Obj): Array<string> {
	const m = clone();
	for (const id of sortedKeys(assets)) {
		assetsOf(m)[id] = assets[id];
	}
	return validateManifest(m);
}

/** A sound with every extra: three clips, a pitch range and its own minimum interval. */
function hitSound(overrides: Obj = {}): Obj {
	const out: Obj = {
		kind: "sound",
		assetId: "rbxassetid://6001",
		volume: 0.7,
		variants: ["rbxassetid://6002", "rbxassetid://6003"],
		pitch: [0.9, 1.1],
		minInterval: 0.05,
	};
	for (const k of sortedKeys(overrides)) {
		out[k] = overrides[k];
	}
	return out;
}

const sink = () => {
	const messages = new Array<string>();
	return { messages, warn: (m: string) => messages.push(m) };
};

describe("audio contract: port IDs and ambience", () => {
	it("lists the port's audio IDs apart from the web build's AUDIO_EVENTS, every one required", () => {
		expect(PORT_AUDIO_EVENTS).toEqual([
			"sfx.player.swing",
			"sfx.player.flask",
			"sfx.player.swap",
			"sfx.player.deflect",
			"sfx.enemy.telegraph",
			"sfx.boss.death",
			"sfx.victory",
			"sfx.ui.back",
			"sfx.ui.move",
			"sfx.player.finisher",
			"sfx.player.charged",
			"sfx.room.clear",
			"sfx.relic.take",
			"sfx.shrine.use",
			"sfx.stairwell.open",
			"sfx.floor.enter",
			"sfx.depth.up",
			"sfx.jingle.gameover",
			"music.tutorial",
			"music.lobby",
			"sfx.boss.taunt",
			"sfx.boost.drop",
			"sfx.boost.collect",
			"sfx.boost.expire",
			"sfx.boost.aegisbreak",
			// docs/ROOM_CLEAR.md RC4
			"sfx.room.perfect",
			"sfx.score.tick",
			"sfx.score.land",
			// docs/COMBO.md CB3
			"sfx.combo.tier",
			"sfx.combo.break",
			// docs/GRAZE_PARRY.md GP3
			"sfx.player.graze",
			"sfx.player.parry",
			// docs/DRAFT_REVEAL.md DR4
			"sfx.draft.flip",
			"sfx.draft.rare",
			"sfx.draft.charge",
			"sfx.draft.legendary",
			"sfx.draft.pick",
			// docs/ENEMY_VARIANTS.md EV1
			"sfx.enemy.blink",
			"sfx.enemy.summon",
			"sfx.enemy.split",
			"sfx.affix.shieldbreak",
			"sfx.affix.vengeful",
			// docs/NEW_BEST.md NB4
			"sfx.best.new",
			"sfx.jingle.record",
			// docs/BUILDS.md BU1
			"sfx.build.spark",
			"sfx.build.burst",
			"sfx.build.shard",
			"sfx.build.ember",
			"sfx.build.nova",
			"sfx.build.execute",
			"sfx.build.evolve",
			"sfx.build.duo",
			"sfx.build.jackpot",
			// docs/DAILY.md DS10
			"sfx.rank.up",
			"sfx.friend.passed",
			// docs/BREAKABLE_DROPS.md BL5
			"sfx.breakable.loot",
			// docs/NEW_ENEMIES.md NE1
			"sfx.enemy.fuse",
			"sfx.enemy.blast",
			"sfx.enemy.charge",
			"sfx.enemy.stun",
			"sfx.enemy.strike",
			"sfx.enemy.spin",
		]);
		const web = new Set<string>([...AUDIO_EVENTS, ...BREAKABLE_AUDIO_EVENTS]);
		for (const id of PORT_AUDIO_EVENTS) {
			expect([id, web.has(id), REQUIRED_ASSET_IDS.includes(id)]).toEqual([id, false, true]);
		}
		expect(AUDIO_EVENTS.size()).toBe(20);
		expect(slotFor("music.tutorial")?.soundGroup).toBe("music");
		expect(slotFor("music.lobby")?.soundGroup).toBe("music");
		expect(slotFor("sfx.jingle.gameover")?.soundGroup).toBe("sfx");
	});

	it("knows every ID the audio layer plays (shared/view/audio), the port's PORT_SFX among them", () => {
		for (const id of allAudioIds()) {
			expect([id, REQUIRED_ASSET_IDS.includes(id)]).toEqual([id, true]);
		}
		for (const id of PORT_SFX) {
			expect([id, (PORT_AUDIO_EVENTS as ReadonlyArray<string>).includes(id)]).toEqual([id, true]);
		}
	});

	it("adds the ambience slot: amb.b1..b5, required, sound or silent, through the sfx SoundGroup", () => {
		expect([AMBIENCE.prefix, AMBIENCE.kinds, AMBIENCE.soundGroup, AMBIENCE.facings]).toEqual([
			"amb.",
			["sound", "silent"],
			"sfx",
			[],
		]);
		expect(SLOTS.includes(AMBIENCE)).toBe(true);
		expect(AMBIENCE_IDS).toEqual(DECOR_BIOME_KEYS.map((k) => `amb.${k}`));
		BIOMES.forEach((b, i) => {
			expect([b.id, ambienceId(b.id)]).toEqual([b.id, AMBIENCE_IDS[i]]);
		});
		for (const id of AMBIENCE_IDS) {
			expect([id, slotFor(id), REQUIRED_ASSET_IDS.includes(id), isAmbienceId(id)]).toEqual([
				id,
				AMBIENCE,
				true,
				true,
			]);
		}
		expect([isAmbienceId("amb.b6"), isAmbienceId("amb.wind"), isAmbienceId("amb")]).toEqual([false, false, false]);
	});

	it("bounds pitch jitter, and exempts only minInterval on sounds from the gameplay-key scan", () => {
		expect(SOUND_PITCH_LIMITS).toEqual({ min: 0.5, max: 2 });
		expect(SOUND_PRESENTATION_KEYS).toEqual(["minInterval"]);
		// Still a gameplay-looking word: only a sound asset may carry it.
		expect(isGameplayKey("minInterval")).toBe(true);
		for (const k of ["variants", "pitch"]) {
			expect([k, isGameplayKey(k)]).toEqual([k, false]);
		}
	});
});

describe("validateManifest: sound extras and ambience", () => {
	it("the bundled packs fill every port audio ID and ambience bed, and validate clean", () => {
		for (const id of sortedKeys(THEME_PACKS)) {
			const assets = THEME_PACKS[id].assets as unknown as Obj;
			for (const audio of [...PORT_AUDIO_EVENTS, ...AMBIENCE_IDS]) {
				// the placeholder is silent everywhere; a pack with uploads (vale) may already play some
				const kind = (assets[audio] as Obj | undefined)?.kind;
				const ok = id === "placeholder" ? kind === "silent" : kind === "silent" || kind === "sound";
				expect([id, audio, kind, ok]).toEqual([id, audio, kind, true]);
			}
			expect([id, validateManifest(THEME_PACKS[id], { packId: id })]).toEqual([id, []]);
		}
	});

	it("accepts variants, a pitch range and a minimum interval (each optional, empty variants too)", () => {
		expect(
			withAssets({
				"sfx.enemy.hurt": hitSound(),
				"sfx.player.shoot": { kind: "sound", assetId: "rbxassetid://6004", variants: [] },
				"sfx.ui.move": { kind: "sound", assetId: "rbxassetid://6005", pitch: [0.5, 2], minInterval: 0 },
				"music.tutorial": { kind: "sound", assetId: "rbxassetid://6006", minInterval: 0 },
				"amb.b3": { kind: "sound", assetId: "rbxassetid://6007", volume: 0.3 },
			}),
		).toEqual([]);
	});

	it("rejects variants and pitch on looped slots (music.*, amb.*): their channel plays one clip at speed 1", () => {
		expect(
			withAssets({
				"music.boss": { kind: "sound", assetId: "rbxassetid://6006", variants: ["rbxassetid://6009"] },
				"music.tutorial": { kind: "sound", assetId: "rbxassetid://6006", pitch: [1, 1] },
				"amb.b3": { kind: "sound", assetId: "rbxassetid://6007", variants: [], pitch: [0.9, 1.1] },
			}),
		).toEqual([
			'assets["amb.b3"].variants: amb.* is looped (one clip at PlaybackSpeed 1): no variants, put the one clip in assetId',
			'assets["amb.b3"].pitch: amb.* is looped (one clip at PlaybackSpeed 1): no pitch jitter',
			'assets["music.boss"].variants: music.* is looped (one clip at PlaybackSpeed 1): no variants, put the one clip in assetId',
			'assets["music.tutorial"].pitch: music.* is looped (one clip at PlaybackSpeed 1): no pitch jitter',
		]);
		// a malformed pitch on a looped slot is one error, not two
		expect(withAssets({ "music.menu": { kind: "sound", assetId: "rbxassetid://6006", pitch: 3 } })).toEqual([
			'assets["music.menu"].pitch: music.* is looped (one clip at PlaybackSpeed 1): no pitch jitter',
		]);
	});

	it("rejects variants that are not uploaded asset IDs", () => {
		expect(withAssets({ "sfx.enemy.hurt": hitSound({ variants: "rbxassetid://6002" }) })).toEqual([
			'assets["sfx.enemy.hurt"].variants: must be an array of "rbxassetid://<digits>" (extra clips), got "rbxassetid://6002"',
		]);
		expect(withAssets({ "sfx.enemy.hurt": hitSound({ variants: ["rbxassetid://6002", "hit2.ogg"] }) })).toEqual([
			'assets["sfx.enemy.hurt"].variants[1]: "hit2.ogg" must be "rbxassetid://<digits>" (upload with Asphalt or the Studio Asset Manager)',
		]);
	});

	it("rejects a pitch outside SOUND_PITCH_LIMITS, reversed or malformed", () => {
		const msg = "must be [min, max] with 0.5 <= min <= max <= 2 (PlaybackSpeed), got";
		const cases: Array<[unknown, string]> = [
			[[0.4, 1], "[0.4, 1]"],
			[[1, 2.5], "[1, 2.5]"],
			[[1.2, 0.9], "[1.2, 0.9]"],
			[[1], "[1]"],
			[[0.9, 1, 1.1], "[0.9,1,1.1]"],
			[["0.9", 1], '["0.9",1]'],
			[1.1, "1.1"],
		];
		for (const [pitch, shown] of cases) {
			expect(withAssets({ "sfx.enemy.hurt": hitSound({ pitch }) })).toEqual([
				`assets["sfx.enemy.hurt"].pitch: ${msg} ${shown}`,
			]);
		}
	});

	it("rejects a negative or non-number minInterval", () => {
		expect(withAssets({ "sfx.enemy.hurt": hitSound({ minInterval: -0.1 }) })).toEqual([
			'assets["sfx.enemy.hurt"].minInterval: must be a number of seconds >= 0, got -0.1',
		]);
		expect(withAssets({ "sfx.enemy.hurt": hitSound({ minInterval: "0.1" }) })).toEqual([
			'assets["sfx.enemy.hurt"].minInterval: must be a number of seconds >= 0, got "0.1"',
		]);
	});

	it("still flags minInterval as gameplay data anywhere but on a sound", () => {
		const errors = withAssets({ "sfx.enemy.hurt": { kind: "silent", minInterval: 0.1 } });
		expect(errors).toEqual([
			'assets["sfx.enemy.hurt"].minInterval: looks like gameplay data; hitboxes, radii, speeds, damage and timings belong in gameplay data, not the theme pack',
		]);
	});

	it("rejects extra keys and the extras on silent events", () => {
		expect(withAssets({ "sfx.enemy.hurt": hitSound({ loop: true }) })).toEqual([
			'assets["sfx.enemy.hurt"].loop: unknown key (allowed: kind, assetId, volume, variants, pitch, minInterval)',
		]);
		expect(withAssets({ "amb.b1": { kind: "silent", variants: [] } })).toEqual([
			'assets["amb.b1"].variants: unknown key (allowed: kind)',
		]);
	});

	it("requires every ambience bed and rejects unknown amb.* IDs and visual kinds there", () => {
		const m = clone();
		assetsOf(m)["amb.b2"] = undefined;
		expect(validateManifest(m)).toEqual(['assets: missing required asset "amb.b2" (slot ambience)']);
		expect(
			withAssets({
				"amb.b6": { kind: "silent" },
				"amb.wind": { kind: "silent" },
				"amb.b1": { kind: "placeholder" },
			}),
		).toEqual([
			'assets["amb.b1"].kind: slot "ambience" accepts kind "sound" | "silent", got "placeholder"',
			'assets["amb.b6"]: unknown ambience ID (known: amb.b1, amb.b2, amb.b3, amb.b4, amb.b5)',
			'assets["amb.wind"]: unknown ambience ID (known: amb.b1, amb.b2, amb.b3, amb.b4, amb.b5)',
		]);
	});
});

describe("ThemeCore.sound: variants, pitch, minimum interval", () => {
	it("resolves a sound's extras, cached per ID", () => {
		const m = clone();
		assetsOf(m)["sfx.enemy.hurt"] = hitSound();
		assetsOf(m)["amb.b4"] = { kind: "sound", assetId: "rbxassetid://6008" };
		const w = sink();
		const core = new ThemeCore(m, { warn: w.warn });
		const ref = core.sound("sfx.enemy.hurt");
		expect(ref).toEqual({
			assetId: "rbxassetid://6001",
			volume: 0.7,
			group: "sfx",
			variants: ["rbxassetid://6002", "rbxassetid://6003"],
			pitch: [0.9, 1.1],
			minInterval: 0.05,
		});
		expect(core.sound("sfx.enemy.hurt")).toBe(ref);
		expect(core.sound("amb.b4")).toEqual({ assetId: "rbxassetid://6008", volume: 1, group: "sfx", variants: [] });
		expect(w.messages).toEqual([]);
	});

	it("drops malformed extras (warned once) and clamps the pitch to SOUND_PITCH_LIMITS", () => {
		const m = clone();
		assetsOf(m)["sfx.enemy.hurt"] = hitSound({ variants: ["rbxassetid://6002", 7], pitch: [0.1, 9] });
		assetsOf(m)["sfx.enemy.death"] = hitSound({ pitch: [1.2, 0.8], minInterval: -1 });
		const w = sink();
		const pack = new ThemePack(m, { warn: w.warn });
		const hurt = pack.sound("sfx.enemy.hurt");
		expect([hurt.variants, hurt.pitch, hurt.minInterval]).toEqual([["rbxassetid://6002"], [0.5, 2], 0.05]);
		const death = pack.sound("sfx.enemy.death");
		expect([death.assetId, death.pitch, death.minInterval]).toEqual(["rbxassetid://6001", undefined, undefined]);
		pack.sound("sfx.enemy.death");
		expect(w.messages).toEqual([
			'[theme:placeholder] sound "sfx.enemy.hurt" drops a variant that is not an asset ID',
			'[theme:placeholder] sound "sfx.enemy.death" has pitch [1.2,0.8], playing without jitter',
			'[theme:placeholder] sound "sfx.enemy.death" has minInterval -1, using the default',
		]);
	});

	it("the placeholder pack resolves every port audio ID and ambience bed silently, in its SoundGroup", () => {
		const w = sink();
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: w.warn });
		for (const id of [...PORT_AUDIO_EVENTS, ...AMBIENCE_IDS]) {
			const ref = pack.sound(id);
			const silent = ref.assetId === undefined && ref.pitch === undefined && ref.minInterval === undefined;
			expect([id, silent, ref.volume, ref.group, ref.variants.size()]).toEqual([
				id,
				true,
				0,
				slotFor(id)?.soundGroup,
				0,
			]);
		}
		expect(w.messages).toEqual([]);
	});
});

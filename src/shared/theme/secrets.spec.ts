// Roblox port (docs/SECRET_ROOMS.md SR10): the secret rooms' theme keys (the strings, the three sounds, the dust's colour
// role, the optional `secret` world art slot and the optional dust effect) are in the contract's lists, every bundled
// pack fills the required ones, the optional ones are optional, the audio falls back one step while silent, and
// secretReport / secretArtProblems hold the dust colour and the art to their bars. contract.ts names the keys inline
// (its compiled Luau sits near the 200-locals limit), so these specs are what keeps secrets.ts and contract.ts in step.
import { describe, expect, it } from "@rbxts/jest-globals";
import { SILVER_AUDIO_IDS, SILVER_ROLES, SILVER_STRING_KEYS } from "./silver";
import { SILVER_SHOP_STRING_KEYS } from "./silverShop";
import { SFX, SFX_FALLBACK, SFX_PRIORITY, ALL_SFX, PORT_SFX, JINGLE_SFX, DUCKING_SFX } from "shared/view/audio";
import { CHARACTER_OVERRIDE_KEYS, THEME_CHARACTER_IDS, characterOverrideKey } from "./characters";
import { colorDifference } from "./color";
import {
	ENEMY_BULLET_ROLES,
	FX,
	FX_IDS,
	MIN_DECOR_FX_BULLET_DIFFERENCE,
	PORT_AUDIO_EVENTS,
	REQUIRED_ASSET_IDS,
	REQUIRED_STRING_KEYS,
	SLOTS,
	WORLD_ART_SLOTS,
	isFxId,
	requiredBaseAnimations,
	slotFor,
} from "./contract";
import { ThemePack } from "./pack";
import { THEME_PACKS } from "./packs";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { secretArtProblems } from "./secretArt";
import { SECRET_COLOR_RULES, secretReport } from "./secretColors";
import {
	SECRET_ART_IDS,
	SECRET_ART_PREFIX,
	SECRET_AUDIO_IDS,
	SECRET_BESTIARY_ARCHER_KEY,
	SECRET_BESTIARY_KEY,
	SECRET_CACHE_TITLE_KEY,
	SECRET_CODEX_NAME_KEY,
	SECRET_CRACK_ID,
	SECRET_DUST_FX_ID,
	SECRET_DUST_ROLE,
	SECRET_JINGLE_SOUND,
	SECRET_KNOCK_SOUND,
	SECRET_OPEN_SOUND,
	SECRET_RECAP_KEY,
	SECRET_ROLES,
	SECRET_RUBBLE_ID,
	SECRET_SCORE_SOURCE_KEY,
	SECRET_SHOUT_KEY,
	SECRET_STRING_KEYS,
	SECRET_TOAST_KEY,
	isSecretArtId,
} from "./secrets";
import { NEW_ENEMY_2_AUDIO_IDS } from "./newEnemies2";
import { NEW_ENEMY_3_AUDIO_IDS } from "./newEnemies3";
import { COLOR_ROLES } from "./types";
import { deepClone, sortedKeys, type Obj } from "./util";
import { validateManifest } from "./validate";
import { BESTIARY_STRING_KEYS } from "./variants";

const has = (list: ReadonlyArray<string>, id: string) => list.includes(id);
const fixed1 = (n: number) => "%.1f".format(n);
const quiet = () => {};
const clone = () => deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;

/** The last `n` entries of `list` before its last `skip` (later features' entries), in order. */
function tail(list: ReadonlyArray<string>, n: number, skip = 0): string[] {
	const out = new Array<string>();
	const last = list.size() - skip;
	for (let i = last - n; i < last; i++) out.push(list[i]);
	return out;
}

/** A one-facing world sprite set (an `idle` of `frames` cells) for the validator. */
function spriteSet(frames: number, facings = 1): Obj {
	return {
		kind: "sprites",
		frameW: 60,
		frameH: 40,
		pivot: { x: 30, y: 40 },
		pixelsPerTile: 29.6,
		resample: "Pixelated",
		facings: { count: facings, zeroDeg: 0, ccw: true },
		sheets: [{ assetId: "rbxassetid://7001", w: 180, h: 40 * facings }],
		animations: { idle: { sheet: 0, start: 0, frames, fps: 1, loop: true } },
	};
}

describe("secret rooms: strings", () => {
	it("are REQUIRED_STRING_KEYS' last ones, distinct, in every bundled pack", () => {
		expect([...SECRET_STRING_KEYS]).toEqual([
			"fx.secret.text",
			"hud.toast.secret",
			"treasure.secret.title",
			"run.recap.hl.secrets",
			"secret.room.name",
		]);
		expect([
			SECRET_SHOUT_KEY,
			SECRET_TOAST_KEY,
			SECRET_CACHE_TITLE_KEY,
			SECRET_RECAP_KEY,
			SECRET_CODEX_NAME_KEY,
		]).toEqual([...SECRET_STRING_KEYS]);
		expect(
			tail(
				REQUIRED_STRING_KEYS,
				SECRET_STRING_KEYS.size(),
				SILVER_STRING_KEYS.size() + SILVER_SHOP_STRING_KEYS.size(),
			),
		).toEqual([...SECRET_STRING_KEYS]);
		expect(new Set(REQUIRED_STRING_KEYS).size()).toBe(REQUIRED_STRING_KEYS.size());
		for (const p of sortedKeys(THEME_PACKS))
			for (const key of SECRET_STRING_KEYS)
				expect([p, key, typeIs(THEME_PACKS[p].strings[key], "string")]).toEqual([p, key, true]);
	});

	it("the placeholder English: SECRET!, the co-op toast with the opener's {name}, the cache title, the recap label", () => {
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });
		expect(pack.str(SECRET_SHOUT_KEY)).toBe("SECRET!");
		expect(pack.str(SECRET_TOAST_KEY, { name: "Kaleb" })).toBe("Secret found by Kaleb");
		expect(pack.str(SECRET_CACHE_TITLE_KEY)).toBe("Secret cache");
		// like every run.recap.hl.* label: the count is drawn beside it
		expect(pack.str(SECRET_RECAP_KEY)).toBe("Secrets found");
		expect(pack.str(SECRET_CODEX_NAME_KEY)).toBe("Secret rooms");
		expect(pack.str(SECRET_SCORE_SOURCE_KEY)).toBe("Secrets");
	});

	it("the first-knock card: BESTIARY_STRING_KEYS' last (required), the Archer's override optional (SRD5)", () => {
		expect(SECRET_BESTIARY_KEY).toBe("bestiary.secret.crack");
		expect(BESTIARY_STRING_KEYS[BESTIARY_STRING_KEYS.size() - 1]).toBe(SECRET_BESTIARY_KEY);
		expect(has(REQUIRED_STRING_KEYS, SECRET_BESTIARY_KEY)).toBe(true);
		expect(has(THEME_CHARACTER_IDS, "archer")).toBe(true);
		expect(characterOverrideKey(SECRET_BESTIARY_KEY, "archer")).toBe(SECRET_BESTIARY_ARCHER_KEY);
		expect(CHARACTER_OVERRIDE_KEYS[CHARACTER_OVERRIDE_KEYS.size() - 1]).toBe(SECRET_BESTIARY_ARCHER_KEY);
		expect(has(REQUIRED_STRING_KEYS, SECRET_BESTIARY_ARCHER_KEY)).toBe(false);
		const s = PLACEHOLDER_MANIFEST.strings;
		expect(s[SECRET_BESTIARY_KEY]).toBe(
			"A hollow wall. A finishing blow, a Charger's charge or a Wrecker roll could break through.",
		);
		expect(s[SECRET_BESTIARY_ARCHER_KEY]).toBe(
			"A hollow wall. A charged arrow, a Charger's charge or a Wrecker roll could break through.",
		);
		// the Knight reads the base line (no Knight override)
		expect(s[characterOverrideKey(SECRET_BESTIARY_KEY, "knight")]).toBe(undefined);
		// both name the Charger and Wrecker by their own names
		expect(s[SECRET_BESTIARY_KEY].find(s["enemy.charger.name"], 1, true)[0] !== undefined).toBe(true);
		expect(s[SECRET_BESTIARY_KEY].find(s["boon.wrecker.name"], 1, true)[0] !== undefined).toBe(true);
		for (const p of sortedKeys(THEME_PACKS)) {
			const pack = new ThemePack(THEME_PACKS[p], { warn: quiet });
			expect([p, pack.hasString(SECRET_BESTIARY_KEY), pack.hasString(SECRET_BESTIARY_ARCHER_KEY)]).toEqual([
				p,
				true,
				true,
			]);
		}
	});

	it("the run-over source row is a score-source string (not required; the view's SCORE_SOURCE_KEYS lists it)", () => {
		expect(SECRET_SCORE_SOURCE_KEY).toBe("score.source.secret");
		expect(has(REQUIRED_STRING_KEYS, SECRET_SCORE_SOURCE_KEY)).toBe(false);
		for (const p of sortedKeys(THEME_PACKS))
			expect([p, typeIs(THEME_PACKS[p].strings[SECRET_SCORE_SOURCE_KEY], "string")]).toEqual([p, true]);
	});

	it("a pack missing a secret string fails validation", () => {
		for (const key of [...SECRET_STRING_KEYS, SECRET_BESTIARY_KEY]) {
			const m = clone();
			(m.strings as Obj)[key] = undefined;
			expect([key, validateManifest(m)]).toEqual([key, [`strings: missing required string "${key}"`]]);
		}
	});
});

describe("secret rooms: sounds", () => {
	it("are PORT_AUDIO_EVENTS' last three: required, sfx; SILENT in the placeholder, uploaded in vale (SR14, 2026-11-13)", () => {
		expect([...SECRET_AUDIO_IDS]).toEqual(["sfx.secret.knock", "sfx.secret.open", "sfx.jingle.secret"]);
		expect([SECRET_KNOCK_SOUND, SECRET_OPEN_SOUND, SECRET_JINGLE_SOUND]).toEqual([...SECRET_AUDIO_IDS]);
		// docs/SILVER.md SV7's four, then docs/NEW_ENEMIES_2.md NX1's eight come after them (silver.spec.ts,
		// newEnemies2.spec.ts)
		expect(
			tail(
				PORT_AUDIO_EVENTS,
				SECRET_AUDIO_IDS.size(),
				SILVER_AUDIO_IDS.size() + NEW_ENEMY_2_AUDIO_IDS.size() + NEW_ENEMY_3_AUDIO_IDS.size(),
			),
		).toEqual([...SECRET_AUDIO_IDS]);
		for (const id of SECRET_AUDIO_IDS) {
			expect([id, has(REQUIRED_ASSET_IDS, id), slotFor(id)?.soundGroup]).toEqual([id, true, "sfx"]);
			for (const p of sortedKeys(THEME_PACKS))
				expect([p, id, THEME_PACKS[p].assets[id].kind]).toEqual([p, id, p === "vale" ? "sound" : "silent"]);
		}
		const m = clone();
		(m.assets as Obj)[SECRET_OPEN_SOUND] = undefined;
		expect(
			validateManifest(m).some(
				(e) => e.find(`missing required asset "${SECRET_OPEN_SOUND}"`, 1, true)[0] !== undefined,
			),
		).toBe(true);
	});

	it("the cue tables (shared/view/audio): listed, one-step fallbacks, ranks, the jingle a ducking jingle", () => {
		expect([SFX.secretKnock, SFX.secretOpen, SFX.jingleSecret]).toEqual([...SECRET_AUDIO_IDS]);
		const fallback = SFX_FALLBACK as unknown as ReadonlyMap<string, string>;
		const rank = SFX_PRIORITY as unknown as ReadonlyMap<string, number>;
		for (const id of SECRET_AUDIO_IDS) {
			expect([id, ALL_SFX.includes(id as never), PORT_SFX.includes(id as never)]).toEqual([id, true, true]);
		}
		expect([fallback.get(SFX.secretKnock), fallback.get(SFX.secretOpen), fallback.get(SFX.jingleSecret)]).toEqual([
			"sfx.breakable.hit",
			"sfx.breakable.break",
			"sfx.jingle.treasure",
		]);
		// one step: no fallback is itself a secret sound
		for (const id of SECRET_AUDIO_IDS) expect(has(SECRET_AUDIO_IDS, fallback.get(id)!)).toBe(false);
		// the knock just over the breakable hit and under the enemy death; the crumble over the breakable break and
		// under the player's swing; the jingle one under a Legendary chest's
		const r = (id: string) => rank.get(id)!;
		expect(r(SFX.secretKnock)).toBe(r(SFX.breakableHit) + 1);
		expect(r(SFX.secretKnock) < r(SFX.enemyDeath)).toBe(true);
		expect(r(SFX.secretOpen) > r(SFX.breakableBreak)).toBe(true);
		expect(r(SFX.secretOpen) < r(SFX.playerSwing)).toBe(true);
		expect(r(SFX.jingleSecret)).toBe(r(SFX.jingleTreasure) - 1);
		expect([r(SFX.secretKnock), r(SFX.secretOpen), r(SFX.jingleSecret)]).toEqual([31, 48, 72]);
		expect([JINGLE_SFX.includes(SFX.jingleSecret), DUCKING_SFX.includes(SFX.jingleSecret)]).toEqual([true, true]);
		for (const id of [SFX.secretKnock, SFX.secretOpen])
			expect([id, JINGLE_SFX.includes(id), DUCKING_SFX.includes(id)]).toEqual([id, false, false]);
	});
});

describe("secret rooms: the dust's colour role", () => {
	it("is COLOR_ROLES' last, in every bundled pack, a pale dusty stone in the placeholder", () => {
		expect([...SECRET_ROLES]).toEqual([SECRET_DUST_ROLE]);
		expect(SECRET_DUST_ROLE).toBe("secret.dust");
		expect(tail(COLOR_ROLES as unknown as ReadonlyArray<string>, SECRET_ROLES.size(), SILVER_ROLES.size())).toEqual(
			[...SECRET_ROLES],
		);
		expect(PLACEHOLDER_MANIFEST.colors[SECRET_DUST_ROLE]).toBe("#c8bfae");
		for (const p of sortedKeys(THEME_PACKS))
			expect([p, typeIs(THEME_PACKS[p].colors[SECRET_DUST_ROLE], "string")]).toEqual([p, true]);
	});

	it("passes secretReport in every bundled pack: >= 40 CIE76 from the enemy-bullet roles and telegraph (printed)", () => {
		expect([...SECRET_COLOR_RULES.against]).toEqual([...ENEMY_BULLET_ROLES, "telegraph"]);
		expect(SECRET_COLOR_RULES.minDifference).toBe(MIN_DECOR_FX_BULLET_DIFFERENCE);
		for (const p of sortedKeys(THEME_PACKS)) {
			const report = secretReport(THEME_PACKS[p]);
			expect([p, report.size()]).toEqual([p, SECRET_ROLES.size() * SECRET_COLOR_RULES.against.size()]);
			for (const e of report) {
				expect([p, e.role, e.check, e.against, e.ok]).toEqual([p, e.role, "difference", e.against, true]);
				expect(e.value).toBe(colorDifference(e.color, e.againstColor));
				print(`[secret] ${p} ${e.role} ${e.color} vs ${e.against} ${e.againstColor}: ${fixed1(e.value)}`);
			}
			expect([p, validateManifest(THEME_PACKS[p], { packId: p })]).toEqual([p, []]);
		}
	});

	it("a dust that reads as a bullet or a telegraph fails; a pack missing the role fails", () => {
		for (const against of [...ENEMY_BULLET_ROLES, "telegraph"]) {
			const m = clone();
			(m.colors as Obj)[SECRET_DUST_ROLE] = (m.colors as Obj)[against];
			const errors = validateManifest(m);
			expect([against, errors.size() > 0]).toEqual([against, true]);
			expect([
				against,
				errors.some(
					(e) =>
						e.find(`vs ${against}`, 1, true)[0] !== undefined &&
						e.find("a secret room's dust must never read as an enemy bullet or a telegraph", 1, true)[0] !==
							undefined,
				),
			]).toEqual([against, true]);
		}
		const none = clone();
		(none.colors as Obj)[SECRET_DUST_ROLE] = undefined;
		expect(
			validateManifest(none).some(
				(e) => e.find(`missing color role "${SECRET_DUST_ROLE}"`, 1, true)[0] !== undefined,
			),
		).toBe(true);
	});
});

describe("secret rooms: optional art", () => {
	it("the SECRET slot: optional free-size world art (image / sprites with idle, no placeholder), two IDs", () => {
		const slot = slotFor(SECRET_CRACK_ID)!;
		expect([slot.slot, slot.prefix, slot.kinds, slot.cell, slot.facings]).toEqual([
			"secret",
			SECRET_ART_PREFIX,
			["image", "sprites"],
			undefined,
			[],
		]);
		expect(slotFor(SECRET_RUBBLE_ID)).toBe(slot);
		expect(SLOTS[SLOTS.size() - 1]).toBe(slot);
		expect(WORLD_ART_SLOTS[WORLD_ART_SLOTS.size() - 1]).toBe(slot);
		expect(requiredBaseAnimations(slot)).toEqual(["idle"]);
		expect([...SECRET_ART_IDS]).toEqual(["secret.crack", "secret.rubble"]);
		expect([isSecretArtId("secret.crack"), isSecretArtId("secret.rubble"), isSecretArtId("secret.dust")]).toEqual([
			true,
			true,
			false,
		]);
		for (const id of SECRET_ART_IDS) {
			expect([id, has(REQUIRED_ASSET_IDS, id)]).toEqual([id, false]);
			// the placeholder has none (the view's fallback); vale only once secret.png has an ID (SR11)
			expect([id, PLACEHOLDER_MANIFEST.assets[id]]).toEqual([id, undefined]);
		}
		// the strings and the role share the prefix only: `secret.room.name` and `secret.dust` are no assets
		expect(has(REQUIRED_ASSET_IDS, "secret.dust")).toBe(false);
	});

	it("the dust trickle is an optional fx ID (FX_IDS' last), tinted by secret.dust under the fx rule", () => {
		expect(SECRET_DUST_FX_ID).toBe("fx.secret.dust");
		expect([isFxId(SECRET_DUST_FX_ID), slotFor(SECRET_DUST_FX_ID), FX_IDS[FX_IDS.size() - 2]]).toEqual([
			true,
			FX,
			SECRET_DUST_FX_ID,
		]);
		expect(has(REQUIRED_ASSET_IDS, SECRET_DUST_FX_ID)).toBe(false);
		expect(PLACEHOLDER_MANIFEST.assets[SECRET_DUST_FX_ID]).toBe(undefined);
		const m = clone();
		const dust = spriteSet(6);
		dust.sheets = [{ assetId: "rbxassetid://7003", w: 360, h: 40 }];
		dust.animations = { play: { sheet: 0, start: 0, frames: 6, fps: 12, loop: false } };
		dust.sizeTiles = 1;
		dust.tint = SECRET_DUST_ROLE;
		dust.additive = false;
		(m.assets as Obj)[SECRET_DUST_FX_ID] = dust;
		expect(validateManifest(m)).toEqual([]);
	});

	it("the validator accepts one-facing art (an image with pixelsPerTile, an idle sprite set of variants)", () => {
		const m = clone();
		(m.assets as Obj)[SECRET_CRACK_ID] = spriteSet(3);
		(m.assets as Obj)[SECRET_RUBBLE_ID] = {
			kind: "image",
			assetId: "rbxassetid://7002",
			w: 60,
			h: 30,
			pivot: { x: 30, y: 15 },
			pixelsPerTile: 29.6,
		};
		expect(validateManifest(m)).toEqual([]);
		expect(secretArtProblems(m)).toEqual([]);
	});

	it("refuses a turned set, a placeholder (no placeholder kind) and any other secret. ID", () => {
		const turned = clone();
		(turned.assets as Obj)[SECRET_CRACK_ID] = spriteSet(3, 4);
		expect(validateManifest(turned)).toEqual([
			`assets["secret.crack"].facings: a secret room's art has one facing (count 1), got 4: the view lays it on the wall's own axes`,
		]);
		const placeholder = clone();
		(placeholder.assets as Obj)[SECRET_RUBBLE_ID] = { kind: "placeholder" };
		expect(validateManifest(placeholder).size() > 0).toBe(true);
		const unknown = clone();
		(unknown.assets as Obj)["secret.chest"] = spriteSet(1);
		expect(validateManifest(unknown)).toEqual([
			'assets["secret.chest"]: unknown secret ID (known: secret.crack, secret.rubble)',
		]);
	});
});

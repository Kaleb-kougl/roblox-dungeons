// HUD helpers, every HUD / settings / tutorial string key in the placeholder pack, and the audio mapping (sim events ->
// theme sound IDs, cooldowns, music choice; every ID it can play exists in the placeholder pack).
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	KBM_ACTIONS,
	KBM_KEY_NAMES,
	KBM_MOUSE_NAMES,
	PAD_ACTIONS,
	PAD_BUTTON_NAMES,
	REBIND,
	inputLabel,
} from "shared/play";
import { HEALTH_BARS_MODES, HUD_SCALE_PERCENTS, PARTICLES_LEVELS, defaultAudioSettings } from "shared/settings";
import { SIM_EVENT_FIELDS, eventDefault, type SimEvents } from "shared/sim";
import { AUDIO_EVENTS, PLACEHOLDER_MANIFEST, ThemePack, slotFor } from "shared/theme";
import { tutorialStringKeys } from "shared/tutorial";
import {
	ALL_SFX,
	AUDIO_VIEW,
	AudioCueMapper,
	MUSIC,
	PORT_SFX,
	SFX,
	SIM_EVENT_SOUNDS,
	allAudioIds,
	musicFor,
	soundGroupVolume,
	type FxEventSource,
} from "../audio";
import { FxEventBuffer, type FxEventType } from "../fx/events";
import {
	BINDING_REFUSALS,
	ENDING_KEYS,
	HUD_STRINGS,
	HUD_VIEW,
	OPTIONS_DEVICES,
	OPTIONS_LABEL_MAX_CHARS,
	OPTIONS_STRINGS,
	OPTIONS_TABS,
	actionNameKey,
	optionsStringKeys,
	refusalKey,
	SCORE_SOURCE_KEYS,
	LEADERBOARD_POST_STATUSES,
	LEADERBOARD_STRINGS,
	SETTINGS_STRINGS,
	VERDICT_KEYS,
	bossFraction,
	progressionStringKeys,
	comboFraction,
	computeHudScale,
	endingKey,
	formatClock,
	formatCombo,
	heartFills,
	leaderboardPostKey,
	romanPhase,
	shortHash,
	verdictKey,
} from ".";
import { LOBBY_NAMES, LOBBY_VISIBILITIES } from "shared/lobby";
import { LOBBY_REFUSALS, LOBBY_STRINGS, MENU_STRINGS, lobbyNameKey, menuStringKeys } from "../menu";

function quietPack(warnings: string[]): ThemePack {
	return new ThemePack(PLACEHOLDER_MANIFEST, { warn: (m) => warnings.push(m) });
}

describe("HUD helpers", () => {
	it("scales from the 1280x720 reference, clamped, larger on a ten-foot screen", () => {
		expect(computeHudScale(1280, 720, false)).toBe(1);
		expect(computeHudScale(2560, 1440, false)).toBe(1.75);
		expect(computeHudScale(1920, 1080, false)).toBe(1.5);
		expect(computeHudScale(1920, 1080, true)).toBe(HUD_VIEW.maxScale);
		expect(computeHudScale(1280, 720, true)).toBe(HUD_VIEW.tenFootBoost);
		expect(computeHudScale(667, 375, false)).toBe(HUD_VIEW.minScale); // a phone in landscape
		expect(computeHudScale(0, 720, false)).toBe(1);
	});

	it("multiplies the player's HUD scale setting in after the clamp", () => {
		expect(computeHudScale(1280, 720, false, 125)).toBe(1.25);
		expect(computeHudScale(2560, 1440, false, 80)).toBe(HUD_VIEW.maxScale * 0.8);
		expect(computeHudScale(667, 375, false, 80)).toBe(HUD_VIEW.minScale * 0.8);
		expect(computeHudScale(1280, 720, false, 100)).toBe(computeHudScale(1280, 720, false));
		expect(computeHudScale(1280, 720, false, 0)).toBe(1);
		for (const p of HUD_SCALE_PERCENTS) expect(computeHudScale(1280, 720, false, p)).toBe(p / 100);
	});

	it("splits half hearts per heart (web heartFills)", () => {
		expect(heartFills(6, 6)).toEqual([2, 2, 2]);
		expect(heartFills(5, 6)).toEqual([2, 2, 1]);
		expect(heartFills(2, 6)).toEqual([2, 0, 0]);
		expect(heartFills(0, 6)).toEqual([0, 0, 0]);
		expect(heartFills(3, 5)).toEqual([2, 1, 0]);
	});

	it("formats m:ss, phases in Roman numerals, verdict and ending keys, short hashes, bar fractions", () => {
		expect([formatClock(0), formatClock(59.9), formatClock(61), formatClock(-3)]).toEqual([
			"0:00",
			"0:59",
			"1:01",
			"0:00",
		]);
		expect([romanPhase(1), romanPhase(2), romanPhase(3), romanPhase(7)]).toEqual(["I", "II", "III", "7"]);
		expect([verdictKey("pending"), verdictKey("accepted"), verdictKey("none")]).toEqual([
			"hud.verdict.pending",
			"hud.verdict.accepted",
			"",
		]);
		expect([endingKey("death"), endingKey("victory"), endingKey("ended"), endingKey(undefined)]).toEqual([
			"hud.ending.death",
			"hud.ending.victory",
			"hud.ending.ended",
			"hud.ending.abandoned",
		]);
		expect([shortHash("abcdef0123456789"), shortHash(undefined)]).toEqual(["abcdef01", ""]);
		expect([bossFraction(50, 100), bossFraction(150, 100), bossFraction(5, 0)]).toEqual([0.5, 1, 0]);
	});

	it("every HUD and settings string key exists in the placeholder pack (no warnings)", () => {
		const warnings: string[] = [];
		const pack = quietPack(warnings);
		const keys: string[] = [...ENDING_KEYS, ...VERDICT_KEYS, ...SCORE_SOURCE_KEYS, ...progressionStringKeys()];
		for (const [, key] of pairs(HUD_STRINGS as unknown as Map<string, string>)) keys.push(key);
		for (const [name, key] of pairs(SETTINGS_STRINGS as unknown as Map<string, string>)) {
			if (name !== "healthBarsPrefix" && name !== "particlesPrefix") keys.push(key);
		}
		for (const m of HEALTH_BARS_MODES) keys.push(`${SETTINGS_STRINGS.healthBarsPrefix}${m}`);
		for (const l of PARTICLES_LEVELS) keys.push(`${SETTINGS_STRINGS.particlesPrefix}${l}`);
		// The tutorial's prompts (every device), callouts and panels (shared/tutorial TUTORIAL_STRINGS).
		for (const key of tutorialStringKeys()) keys.push(key);
		for (const key of keys) expect([key, pack.hasString(key)]).toEqual([key, true]);
		expect(pack.str(HUD_STRINGS.seed, { seed: 1337 })).toBe("seed 1337");
		expect(pack.str(VERDICT_KEYS[1], { run: 2, ending: "victory", hash: "abcd1234" })).toBe(
			"Run 2 (victory): verified by the server (abcd1234)",
		);
		expect(SCORE_SOURCE_KEYS.size()).toBe(8);
		expect(pack.str(HUD_STRINGS.combo, { combo: "1.3" })).toBe("x1.3");
		expect(warnings).toEqual([]);
	});

	it("every Options screen string exists: tabs, devices, every action's name, every refusal note", () => {
		const warnings: string[] = [];
		const pack = quietPack(warnings);
		const keys = optionsStringKeys(KBM_ACTIONS);
		expect(keys.size()).toBe(
			BINDING_REFUSALS.size() + KBM_ACTIONS.size() + OPTIONS_TABS.size() + OPTIONS_DEVICES.size() + 26,
		);
		for (const key of keys) expect([key, pack.hasString(key)]).toEqual([key, true]);
		// Every pad action is a keyboard action too (one name table).
		for (const action of PAD_ACTIONS) expect(KBM_ACTIONS.includes(action)).toBe(true);
		expect(actionNameKey("swap")).toBe("options.action.swap");
		expect(refusalKey("reserved")).toBe("options.refused.reserved");
		expect(pack.str(OPTIONS_STRINGS.captureKey, { seconds: REBIND.captureTimeoutSeconds })).toBe(
			"Press a key... (5)",
		);
		expect(
			pack.str(OPTIONS_STRINGS.conflict, { input: inputLabel("Q"), action: pack.str(actionNameKey("ember")) }),
		).toBe("Q is already used by Ember.");
		expect(pack.str(refusalKey("reserved"), { input: inputLabel("Escape") })).toBe(
			"Esc is reserved and cannot be bound",
		);
		expect(pack.str(HUD_STRINGS.settings)).toBe("Options");
		expect(warnings).toEqual([]);
	});

	it("key tables: every bindable input has a short label; the defaults label as the old hints did", () => {
		const names: string[] = [...KBM_KEY_NAMES, ...KBM_MOUSE_NAMES, ...PAD_BUTTON_NAMES];
		for (const name of names) {
			const label = inputLabel(name);
			expect([name, label.size() > 0 && label.size() <= OPTIONS_LABEL_MAX_CHARS]).toEqual([name, true]);
		}
		// Every label names one input (no two inputs of a device read the same).
		const kbmLabels = new Set<string>();
		for (const name of [...KBM_KEY_NAMES, ...KBM_MOUSE_NAMES]) kbmLabels.add(inputLabel(name));
		expect(kbmLabels.size()).toBe(KBM_KEY_NAMES.size() + KBM_MOUSE_NAMES.size());
		const padLabels = new Set<string>();
		for (const name of PAD_BUTTON_NAMES) padLabels.add(inputLabel(name));
		expect(padLabels.size()).toBe(PAD_BUTTON_NAMES.size());
		expect([inputLabel("MouseButton1"), inputLabel("One"), inputLabel("ButtonR2"), inputLabel("Q")]).toEqual([
			"Click",
			"1",
			"RT",
			"Q",
		]);
	});

	it("formats the combo with one decimal and the combo meter fraction", () => {
		expect([formatCombo(10), formatCombo(13), formatCombo(50)]).toEqual(["1.0", "1.3", "5.0"]);
		expect([comboFraction(180, 180), comboFraction(90, 180), comboFraction(0, 180), comboFraction(5, 0)]).toEqual([
			1, 0.5, 0, 0,
		]);
	});

	it("every leaderboard string key exists, and verdict leaderboard statuses map to their keys", () => {
		const warnings: string[] = [];
		const pack = quietPack(warnings);
		const keys: string[] = [];
		for (const [name, key] of pairs(LEADERBOARD_STRINGS as unknown as Map<string, string>)) {
			if (name !== "postedPrefix") keys.push(key);
		}
		for (const s of LEADERBOARD_POST_STATUSES) keys.push(`${LEADERBOARD_STRINGS.postedPrefix}${s}`);
		for (const key of keys) expect([key, pack.hasString(key)]).toEqual([key, true]);
		expect([
			leaderboardPostKey("queued"),
			leaderboardPostKey("ineligible:studio"),
			leaderboardPostKey("failed"),
			leaderboardPostKey("weird"),
			leaderboardPostKey(undefined),
		]).toEqual([
			"hud.leaderboard.posted.queued",
			"hud.leaderboard.posted.ineligible",
			"hud.leaderboard.posted.failed",
			undefined,
			undefined,
		]);
		expect(pack.str(LEADERBOARD_STRINGS.mineRanked, { score: 120, floor: 3, rank: 7 })).toBe(
			"Your best: 120 (floor 3), rank #7",
		);
		expect(warnings).toEqual([]);
	});
});

describe("menu and lobby strings (L3 / L5 / L6)", () => {
	it("every menu.* / lobby.* key the menu shell and the lobby screens read exists in the placeholder pack", () => {
		const warnings: string[] = [];
		const pack = quietPack(warnings);
		const keys = menuStringKeys();
		// Every preset name, visibility and refusal code has its own line, each listed once.
		expect(new Set(keys).size()).toBe(keys.size());
		for (const id of LOBBY_NAMES) expect(keys.includes(lobbyNameKey(id))).toBe(true);
		for (const v of LOBBY_VISIBILITIES) expect(keys.includes(`lobby.visibility.${v}`)).toBe(true);
		for (const c of LOBBY_REFUSALS) expect(keys.includes(`lobby.err.${c}`)).toBe(true);
		for (const key of keys) expect([key, pack.hasString(key)]).toEqual([key, true]);
		expect(pack.str(lobbyNameKey("hostDescent"), { host: "Ann" })).toBe("Ann's descent");
		expect(pack.str(LOBBY_STRINGS.count, { count: 2, max: 8 })).toBe("2/8");
		expect(pack.str(MENU_STRINGS.leaveConfirm)).toBe(
			"Leaving ends your run. It counts as a death and your score is submitted.",
		);
		expect(pack.hasString("hud.party.invited")).toBe(false); // the old invite prompt is gone (L7 client)
		expect(warnings).toEqual([]);
	});
});

function noEvents(): SimEvents {
	const e = {} as SimEvents;
	for (const f of SIM_EVENT_FIELDS) e[f] = eventDefault(f);
	return e;
}

function fxOf(types: Array<[FxEventType, boolean?, number?]>): FxEventSource {
	const buf = new FxEventBuffer(16);
	for (const [t, boss, phase] of types) {
		const e = buf.emit(t, 0)!;
		e.boss = boss === true;
		e.phase = phase ?? 0;
	}
	return buf;
}

const NO_FX = fxOf([]);

describe("audio: sim events -> sound IDs", () => {
	it("maps every sim event in the table when its frame total is > 0", () => {
		for (const [field, id] of SIM_EVENT_SOUNDS) {
			const m = new AudioCueMapper();
			const e = noEvents();
			e[field] = 2;
			expect([field, m.frame(0, e, NO_FX, 0, [])]).toEqual([field, [id]]);
		}
		expect(new AudioCueMapper().frame(0, noEvents(), NO_FX, 0, [])).toEqual([]);
	});

	it("maps tracker events: hits, non-boss kills, boss phases 2+, the boss death", () => {
		const m = new AudioCueMapper();
		const fx = fxOf([["hit"], ["killed"], ["killed", true], ["bossPhase", true, 1], ["bossDefeated", true]]);
		expect(m.frame(0, noEvents(), fx, 0, [])).toEqual([SFX.enemyHurt, SFX.enemyDeath, SFX.bossDeath]);
		expect(new AudioCueMapper().frame(0, noEvents(), fxOf([["bossPhase", true, 2]]), 0, [])).toEqual([
			SFX.bossRoar,
		]);
	});

	it("plays each sound once per frame and respects its minimum interval", () => {
		const m = new AudioCueMapper();
		const fx = fxOf([["hit"], ["hit"], ["hit"]]);
		expect(m.frame(0, noEvents(), fx, 0, [])).toEqual([SFX.enemyHurt]);
		expect(m.frame(0.02, noEvents(), fx, 0, [])).toEqual([]); // inside the 0.05 s gap
		expect(m.frame(0.06, noEvents(), fx, 0, [])).toEqual([SFX.enemyHurt]);
		const e = noEvents();
		e.emberUsed = 1;
		expect(m.frame(0.07, e, NO_FX, 0, [])).toEqual([SFX.ember]);
		expect(m.frame(0.071, e, NO_FX, 0, [])).toEqual([SFX.ember]); // no interval: every frame it happens
	});

	it("enemy shots come from the spawn counter's growth (never on the first frame or after a reset)", () => {
		const m = new AudioCueMapper();
		expect(m.frame(0, noEvents(), NO_FX, 40, [])).toEqual([]);
		expect(m.frame(1, noEvents(), NO_FX, 40, [])).toEqual([]);
		expect(m.frame(2, noEvents(), NO_FX, 52, [])).toEqual([SFX.enemyShoot]);
		expect(m.frame(3, noEvents(), fxOf([["reset"]]), 0, [])).toEqual([]);
		expect(m.frame(4, noEvents(), NO_FX, 3, [])).toEqual([SFX.enemyShoot]);
	});

	it("the audio settings scale the SoundGroups (master x group, whole percents)", () => {
		const full = defaultAudioSettings();
		expect(soundGroupVolume("sfx", full)).toBe(AUDIO_VIEW.groupVolume.sfx * AUDIO_VIEW.masterVolume);
		expect(soundGroupVolume("music", full)).toBe(AUDIO_VIEW.groupVolume.music * AUDIO_VIEW.masterVolume);
		expect(soundGroupVolume("music", { master: 50, music: 50, sfx: 100 })).toBe(
			(AUDIO_VIEW.groupVolume.music * AUDIO_VIEW.masterVolume * 50 * 50) / 10000,
		);
		expect(soundGroupVolume("sfx", { master: 100, music: 0, sfx: 30 })).toBe(
			(AUDIO_VIEW.groupVolume.sfx * AUDIO_VIEW.masterVolume * 30) / 100,
		);
		expect(soundGroupVolume("sfx", { master: 0, music: 100, sfx: 100 })).toBe(0);
	});

	it("music: the floor's biome, the boss track during the fight, silence after a death", () => {
		expect(musicFor({ outcome: "playing", bossVisible: false, biome: 1 })).toBe("music.biome.1");
		expect(musicFor({ outcome: "playing", bossVisible: true, biome: 1 })).toBe(MUSIC.boss);
		expect(musicFor({ outcome: "victory", bossVisible: false, biome: 3 })).toBe("music.biome.3");
		expect(musicFor({ outcome: "dead", bossVisible: true, biome: 1 })).toBe(undefined);
		expect(musicFor({ outcome: "playing", bossVisible: false, biome: 0 })).toBe(undefined);
	});

	it("every sound ID the audio layer uses exists in the placeholder pack, in the right SoundGroup, silent today", () => {
		const warnings: string[] = [];
		const pack = quietPack(warnings);
		const ids = allAudioIds();
		expect(ids.size()).toBe(ALL_SFX.size() + 2 + 5);
		for (const id of ids) {
			expect([id, pack.has(id)]).toEqual([id, true]);
			const ref = pack.sound(id);
			expect([id, ref.group]).toEqual([id, slotFor(id)!.soundGroup]);
			expect([id, ref.assetId]).toEqual([id, undefined]);
		}
		// The contract's own audio events are all played except loot (no loot in M1).
		const contract = new Set<string>(AUDIO_EVENTS);
		for (const id of PORT_SFX) expect([id, contract.has(id)]).toEqual([id, false]);
		const unused = AUDIO_EVENTS.filter((id) => !ids.includes(id));
		expect(unused).toEqual(["sfx.loot.drop", "sfx.loot.rare"]);
		expect(warnings).toEqual([]);
	});
});

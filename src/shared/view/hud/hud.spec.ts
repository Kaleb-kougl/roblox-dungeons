// HUD helpers, and every HUD / settings / tutorial string key in the placeholder pack. (The audio mapping's specs live in
// shared/view/audio/audio.spec.ts.)
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	KBM_ACTIONS,
	KBM_KEY_NAMES,
	KBM_MOUSE_NAMES,
	PAD_ACTIONS,
	PAD_BUTTON_NAMES,
	REBIND,
	inputLabel,
	mapHint,
} from "shared/play";
import { HEALTH_BARS_MODES, HUD_SCALE_PERCENTS, PARTICLES_LEVELS } from "shared/settings";
import { BOON_RARITY_ROLES, PLACEHOLDER_MANIFEST, ThemePack } from "shared/theme";
import { tutorialStringKeys } from "shared/tutorial";
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
	PROGRESSION_STRINGS,
	RARITY_COLOR_ROLES,
	rarityColorRole,
	toastFor,
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
import { ARRIVAL_TOAST } from "shared/invite";
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

	it("on touch the floor is HUD_VIEW.touchMinScale; a big screen is unchanged", () => {
		expect(computeHudScale(844, 390, false, 100, true)).toBe(0.75);
		expect(computeHudScale(844, 390, false)).toBe(HUD_VIEW.minScale);
		expect(computeHudScale(1920, 1080, false, 100, true)).toBe(computeHudScale(1920, 1080, false));
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
		expect(SCORE_SOURCE_KEYS.size()).toBe(9); // ... breakables (docs/DECOR.md D4) appended last
		expect(pack.str(HUD_STRINGS.combo, { combo: "1.3" })).toBe("x1.3");
		expect(warnings).toEqual([]);
	});

	it("boon cards and icons take the boon rarity roles, not the loot ones (docs/DRAFT_REVEAL.md DR3)", () => {
		expect(RARITY_COLOR_ROLES).toBe(BOON_RARITY_ROLES);
		expect([rarityColorRole(0), rarityColorRole(1), rarityColorRole(2)]).toEqual([
			"boon.common",
			"boon.rare",
			"boon.legendary",
		]);
		expect(rarityColorRole(7)).toBe("boon.common");
	});

	it("a boost pickup's toast is `{name}: {desc}` of its kind (docs/BOOSTS.md B7), its keys in the pack", () => {
		const warnings: string[] = [];
		const pack = quietPack(warnings);
		const keys = progressionStringKeys();
		for (const key of ["hud.toast.boost", "boost.fury.name", "boost.aegis.desc", "boost.frenzy.icon"]) {
			expect([key, keys.includes(key)]).toEqual([key, true]);
		}
		expect(PROGRESSION_STRINGS.toastBoost).toBe("hud.toast.boost");
		const t = toastFor("boost", 3);
		expect(t).toEqual({ key: "hud.toast.boost", nameKey: "boost.aegis.name", descKey: "boost.aegis.desc" });
		expect(pack.str(t.key, { name: pack.str(t.nameKey!), desc: pack.str(t.descKey!) })).toBe(
			"Aegis: +1 armor pip for 45 s or one hit",
		);
		expect(toastFor("boost", 0).nameKey).toBe("boost.fury.name");
		expect(warnings).toEqual([]);
	});

	it("every Options screen string exists: tabs, devices, every action's name, every refusal note", () => {
		const warnings: string[] = [];
		const pack = quietPack(warnings);
		const keys = optionsStringKeys(KBM_ACTIONS);
		expect(keys.size()).toBe(
			BINDING_REFUSALS.size() + KBM_ACTIONS.size() + OPTIONS_TABS.size() + OPTIONS_DEVICES.size() + 37,
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
		expect(pack.str(OPTIONS_STRINGS.roomEdges)).toBe("Room edges"); // docs/ROOM_EDGES.md RE6
		expect(pack.str(OPTIONS_STRINGS.hudFade)).toBe("HUD fade"); // docs/HUD_LAYOUT.md H7
		expect(pack.str(OPTIONS_STRINGS.minimap)).toBe("Minimap"); // docs/MINIMAP.md M10
		expect(pack.str(OPTIONS_STRINGS.playerOutline)).toBe("Player outline"); // docs/PLAYER_OUTLINE.md P4
		expect(pack.str(OPTIONS_STRINGS.buildFx)).toBe("Build effects"); // docs/BUILDS.md BUD13
		expect(pack.str(OPTIONS_STRINGS.buildFxReduced)).toBe("Reduced");
		expect(pack.str(actionNameKey("map"))).toBe("Map"); // docs/MINIMAP.md M9
		expect(pack.str(HUD_STRINGS.mapTitle)).toBe("Map");
		expect(pack.str(HUD_STRINGS.mapHint, { key: mapHint().keyboard })).toBe("M map");
		expect(pack.str(HUD_STRINGS.mapHint, { key: mapHint().gamepad })).toBe("D-pad left map");
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
		// Roblox invites (docs/INVITES.md I5): every arrival toast the server may send, and the new lines.
		for (const [, k] of pairs(ARRIVAL_TOAST as unknown as Map<string, string>)) expect(keys.includes(k)).toBe(true);
		for (const k of ["lobby.err.inviteGone", "lobby.err.partyFull", "lobby.notice.inviteArrived"]) {
			expect(keys.includes(k)).toBe(true);
		}
		expect(pack.str("lobby.notice.inviteArrived", { name: "Ann" })).toBe("Ann joined from your invite");
		expect(pack.str("lobby.notice.partyLobby", { lobby: "Chill run" })).toBe(
			"Your Roblox party is together in Chill run",
		);
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

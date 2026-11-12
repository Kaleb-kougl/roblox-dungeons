// Which frame art each menu / overlay screen draws and which icons sit beside which labels (docs/UI_ART.md UA7 / UA8).
import { describe, expect, it } from "@rbxts/jest-globals";
import { uiIconIds } from "shared/theme";
import { UI_ART } from "shared/view/hud";
import {
	MENU_STRINGS,
	UI_SCREEN_SKINS,
	pauseItemIcon,
	runOverExitIcon,
	runOverIcon,
	screenDividers,
	screenOrnament,
	screenSkin,
	type PauseItem,
	type UiScreen,
} from "shared/view/menu";

const MENU_SCREENS: ReadonlyArray<UiScreen> = [
	"mainMenu",
	"lobbyBrowser",
	"credits",
	"codex",
	"character",
	"lobbyRoom",
	"options",
	"optionsPrompt",
	"pause",
	"runOver",
	"tutorialOutro",
	"objectiveCard",
	"leaderboard",
];
/** The table as a map view (iterating a Record with pairs() trips roblox-ts/no-array-pairs). */
const SCREENS = UI_SCREEN_SKINS as unknown as ReadonlyMap<UiScreen, unknown>;
const HUD_SCREENS: ReadonlyArray<UiScreen> = [
	"inviteToast",
	"inviteBadge",
	"notices",
	"toast",
	"tutorialPrompt",
	"spectate",
	"info",
];

describe("screen skins (UA7)", () => {
	it("menus and the modal overlays shown during a run are red-rimmed; notes over the play are the run's frame", () => {
		for (const s of MENU_SCREENS) expect([s, screenSkin(s)]).toEqual([s, "menu"]);
		for (const s of HUD_SCREENS) expect([s, screenSkin(s)]).toEqual([s, "hud"]);
		expect(screenSkin("lobbyInvites")).toBe("list");
	});

	it("every screen is listed exactly once above", () => {
		let n = 0;
		for (const [screen] of SCREENS) {
			n++;
			const listed = MENU_SCREENS.includes(screen) || HUD_SCREENS.includes(screen) || screen === "lobbyInvites";
			expect([screen, listed]).toEqual([screen, true]);
		}
		expect(n).toBe(MENU_SCREENS.size() + HUD_SCREENS.size() + 1);
	});

	it("the ornament only on the main menu and pause panels (UAD8), both menu-skinned", () => {
		const withOrnament = new Array<UiScreen>();
		for (const [screen] of SCREENS) if (screenOrnament(screen)) withOrnament.push(screen);
		withOrnament.sort();
		expect(withOrnament).toEqual(["mainMenu", "pause"]);
		for (const s of withOrnament) expect([s, screenSkin(s)]).toEqual([s, "menu"]);
	});

	it("dividers in Options and the pause panel only", () => {
		const withDividers = new Array<UiScreen>();
		for (const [screen] of SCREENS) if (screenDividers(screen)) withDividers.push(screen);
		withDividers.sort();
		expect(withDividers).toEqual(["options", "pause"]);
	});
});

describe("screen icons (UA8)", () => {
	it("pause items: Options -> gear; Leave run and Skip tutorial -> home; the rest none", () => {
		const items: ReadonlyArray<PauseItem> = [
			"resume",
			"restart",
			"leave",
			"settings",
			"leaderboards",
			"restartTutorial",
			"skipTutorial",
			"map",
		];
		expect(items.map((i) => pauseItemIcon(i) ?? "")).toEqual([
			"",
			"",
			UI_ART.ids.iconHome,
			UI_ART.ids.iconGear,
			"",
			"",
			UI_ART.ids.iconHome,
			"",
		]);
	});

	it("run over: the skull for a solo death, the RIP stone for a party's end, nothing for a victory", () => {
		expect(runOverIcon(false, false)).toBe(UI_ART.ids.iconSkull);
		expect(runOverIcon(false, true)).toBe(UI_ART.ids.iconRip);
		expect(runOverIcon(true, false)).toBe(undefined);
		expect(runOverIcon(true, true)).toBe(undefined);
	});

	it("run over exit: home for Main menu, none for Back to lobby", () => {
		expect(runOverExitIcon(MENU_STRINGS.mainMenu)).toBe(UI_ART.ids.iconHome);
		expect(runOverExitIcon(MENU_STRINGS.backToLobby)).toBe(undefined);
	});

	it("every icon chosen is an icon-atlas id", () => {
		const ids = uiIconIds();
		const chosen = [
			pauseItemIcon("settings"),
			pauseItemIcon("leave"),
			runOverIcon(false, false),
			runOverIcon(false, true),
			runOverExitIcon(MENU_STRINGS.mainMenu),
		];
		for (const id of chosen) expect([id, ids.includes(id!)]).toEqual([id, true]);
	});
});

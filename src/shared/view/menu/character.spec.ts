// The character screen and the run-over Character button (shared/view/menu character.ts; docs/ARCHER.md AR7 / AR8),
// the lobby room's member picks and the pick sent when the room opens (lobby.ts).
import { describe, expect, it } from "@rbxts/jest-globals";
import { CHARACTER_IDS, DEFAULT_CHARACTER } from "shared/characters";
import type { LobbyView } from "shared/network";
import { CHARACTER_SCREEN_STRINGS, PLACEHOLDER_MANIFEST, characterLineKey, type SpriteFacings } from "shared/theme";
import {
	HUD_VIEW,
	RECAP_UI,
	UI_ART,
	computeHudScale,
	skinPadding,
	snappedSliceScale,
	uniformPadding,
} from "shared/view/hud";
import {
	CHARACTER_SCREEN_KEYS,
	CHARACTER_SCREEN_ORIGINS,
	CHARACTER_VIEW,
	LOBBY_BROWSER_PATH,
	LOBBY_ROOM_PATH,
	LOBBY_STRINGS,
	MAIN_MENU_PATH,
	MENU_FIT,
	NO_MENU,
	PAD_SURFACES,
	UI_SCREEN_SKINS,
	characterArrangement,
	characterBackAction,
	characterCards,
	characterConfirmKey,
	characterConfirmPlan,
	characterContentHeight,
	characterFocusIndex,
	characterFocusStep,
	characterInitialFocus,
	characterKeyAction,
	characterLayout,
	characterPreviewFacing,
	characterPreviewFrame,
	characterPreviewSize,
	fitMenu,
	lobbyChangePath,
	lobbyPickToSend,
	lobbyRoomModel,
	menuArea,
	menuCompact,
	menuFitOn,
	menuNarrow,
	menuNavReduce,
	menuPadAction,
	menuSafeShare,
	runOverCharacterShown,
	runOverExitButtons,
	runOverExitRowWidth,
	runOverExitLayout,
	runOverExitsRowWidth,
	type CharacterArrangement,
	type MenuInsets,
	type MenuNav,
} from ".";

const STRINGS = PLACEHOLDER_MANIFEST.strings as unknown as Record<string, string | undefined>;

describe("the character screen's cards (AR7)", () => {
	it("one card per character in CHARACTER_IDS order, each with its visual, name and two summary lines", () => {
		const cards = characterCards();
		expect(cards.map((c) => c.id)).toEqual([...CHARACTER_IDS]);
		expect(cards.map((c) => c.visualId)).toEqual(["class.vanguard", "class.ranger"]);
		expect(cards.map((c) => c.role)).toEqual(["class.vanguard", "class.ranger"]);
		expect(cards.map((c) => c.nameKey)).toEqual(["class.vanguard.name", "class.ranger.name"]);
		expect(cards[0].lineKeys).toEqual([characterLineKey("knight", 1), characterLineKey("knight", 2)]);
		expect(cards[1].lineKeys).toEqual(["character.archer.line.1", "character.archer.line.2"]);
	});

	it("every string the screen and the Character button read is in the placeholder pack", () => {
		const keys: string[] = [
			CHARACTER_SCREEN_STRINGS.title,
			CHARACTER_SCREEN_STRINGS.start,
			CHARACTER_SCREEN_STRINGS.runOverCharacter,
			LOBBY_STRINGS.readyUp,
		];
		for (const c of characterCards()) {
			keys.push(c.nameKey);
			for (const k of c.lineKeys) keys.push(k);
		}
		for (const k of keys) expect([k, typeIs(STRINGS[k], "string")]).toEqual([k, true]);
		expect(STRINGS["class.vanguard.name"]).toBe("Knight");
		expect(STRINGS["class.ranger.name"]).toBe("Archer");
	});

	it("the confirm reads Ready in a lobby, Start everywhere else", () => {
		for (const o of CHARACTER_SCREEN_ORIGINS) {
			expect([o, characterConfirmKey(o)]).toEqual([
				o,
				o === "lobby" ? LOBBY_STRINGS.readyUp : CHARACTER_SCREEN_STRINGS.start,
			]);
		}
	});
});

describe("focus: the last pick, the order, the keys (AR7)", () => {
	it("opens on the last pick; anything that is no character id opens on the Knight", () => {
		expect(characterInitialFocus("archer")).toBe("archer");
		expect(characterInitialFocus("knight")).toBe("knight");
		for (const junk of [undefined, "", "Archer", "ranger", 3, true]) {
			expect(characterInitialFocus(junk)).toBe(DEFAULT_CHARACTER);
		}
	});

	it("focus order is left to right (top to bottom in portrait), held at the ends", () => {
		expect(characterFocusIndex("knight")).toBe(0);
		expect(characterFocusIndex("archer")).toBe(1);
		expect(characterFocusIndex("nobody")).toBe(0);
		expect(characterFocusStep("knight", 1)).toBe("archer");
		expect(characterFocusStep("archer", 1)).toBe("archer");
		expect(characterFocusStep("archer", -1)).toBe("knight");
		expect(characterFocusStep("knight", -1)).toBe("knight");
		expect(characterFocusStep("archer", 0)).toBe("archer");
		// A big step is one card (a key press is one move).
		expect(characterFocusStep("knight", 5)).toBe("archer");
	});

	it("arrows and A / D (and W / S) move, Enter / Space confirm, nothing else is the screen's", () => {
		for (const k of ["Left", "A", "Up", "W"]) expect([k, characterKeyAction(k)]).toEqual([k, "prev"]);
		for (const k of ["Right", "D", "Down", "S"]) expect([k, characterKeyAction(k)]).toEqual([k, "next"]);
		for (const k of ["Return", "KeypadEnter", "Space"]) expect([k, characterKeyAction(k)]).toEqual([k, "confirm"]);
		for (const k of ["Backspace", "ButtonB", "ButtonA", "E", "R", "Escape"]) {
			expect([k, characterKeyAction(k)]).toEqual([k, undefined]);
		}
		expect(CHARACTER_SCREEN_KEYS.confirm.size()).toBe(3);
	});

	it("the pad: a `screen` scope, A selects (the card it is on confirms), B goes back, no shortcuts", () => {
		const def = PAD_SURFACES.character;
		expect([def.layer, def.select, def.back, def.rows.size()]).toEqual(["screen", true, "back", 0]);
		expect(menuPadAction("character", "ButtonB", {}).kind).toBe("back");
		expect(menuPadAction("character", "ButtonX", {}).kind).toBe("none");
		expect(UI_SCREEN_SKINS.character.skin).toBe("menu");
	});
});

/** The nav after opening the character screen over `path` (none: from no menu). */
function openedOver(path: ReadonlyArray<"main" | "lobbies" | "lobby">): MenuNav {
	const under = path.size() > 0 ? menuNavReduce(NO_MENU, { kind: "reset", path }) : NO_MENU;
	return menuNavReduce(under, { kind: "open", screen: "character" });
}

describe("what opens it, what Confirm starts and where Back goes (AR7 / AR8)", () => {
	it("Confirm per origin: solo / daily / outro / dev start a run and close the menu, a lobby readies and goes back", () => {
		expect(characterConfirmPlan("solo")).toEqual({ start: "solo", closeOutro: false, after: "close" });
		expect(characterConfirmPlan("daily")).toEqual({ start: "daily", closeOutro: false, after: "close" });
		expect(characterConfirmPlan("outro")).toEqual({ start: "solo", closeOutro: true, after: "close" });
		expect(characterConfirmPlan("dev")).toEqual({ start: "dev", closeOutro: false, after: "close" });
		expect(characterConfirmPlan("lobby")).toEqual({ start: "ready", closeOutro: false, after: "back" });
		expect(characterConfirmPlan("runOver")).toEqual({ start: "restart", closeOutro: false, after: "close" });
	});

	it("Back from Play solo / the Daily / a dev Go on the menu: the main menu", () => {
		const nav = openedOver(MAIN_MENU_PATH as ReadonlyArray<"main">);
		expect(nav).toEqual({ screen: "character", stack: ["main"] });
		expect(characterBackAction(nav)).toBe("back");
		expect(menuNavReduce(nav, { kind: "back" })).toEqual({ screen: "main", stack: [] });
	});

	it("Back from a lobby member's Ready: the lobby room (still not ready); Confirm goes there too", () => {
		const nav = openedOver(LOBBY_ROOM_PATH as ReadonlyArray<"main" | "lobbies" | "lobby">);
		expect(nav).toEqual({ screen: "character", stack: ["main", "lobbies", "lobby"] });
		expect(characterBackAction(nav)).toBe("back");
		expect(menuNavReduce(nav, { kind: "back" })).toEqual({ screen: "lobby", stack: ["main", "lobbies"] });
	});

	it("Back from the run-over Character, the outro's Start my first run, a dev Go in a run: the menu closes", () => {
		const nav = openedOver([]);
		expect(nav).toEqual({ screen: "character", stack: [] });
		expect(characterBackAction(nav)).toBe("close");
		expect(menuNavReduce(nav, { kind: "close" })).toEqual(NO_MENU);
	});

	it("a lobby change under the screen: over the lobby room a lost lobby goes to the browser; over no menu nothing moves", () => {
		const overRoom = ["main", "lobbies", "lobby"] as const;
		expect(lobbyChangePath("character", undefined, "L1", overRoom)).toEqual(LOBBY_BROWSER_PATH);
		expect(lobbyChangePath("character", "L2", "L1", overRoom)).toEqual(LOBBY_ROOM_PATH);
		expect(lobbyChangePath("character", "L1", "L1", overRoom)).toBe(undefined);
		// Over the main menu: an invite into a lobby opens its room, as from the main menu.
		expect(lobbyChangePath("character", "L1", undefined, ["main"])).toEqual(LOBBY_ROOM_PATH);
		expect(lobbyChangePath("character", undefined, "L1", ["main"])).toBe(undefined);
		// Over a finished run / the outro / a dev run: nothing moves, like the run under it.
		expect(lobbyChangePath("character", "L1", undefined, [])).toBe(undefined);
		expect(lobbyChangePath("character", undefined, "L1")).toBe(undefined);
	});
});

function lobby(over: Partial<LobbyView>): LobbyView {
	return {
		lobbyId: "L1",
		nameId: "hostDescent",
		hostId: 1,
		visibility: "open",
		worldKind: "endless",
		phase: "forming",
		members: [1, 2, 3],
		ready: [],
		characters: ["knight", "archer", "knight"],
		looks: [],
		invited: [],
		invitedSources: [],
		...over,
	};
}

describe("the lobby room's picks (AR8)", () => {
	it("each member row carries the member's pick from LobbyView.characters, by index", () => {
		const m = lobbyRoomModel(lobby({}), 2, (id) => `P${id}`, 0);
		expect(m.members.map((r) => [r.userId, r.character])).toEqual([
			[1, "knight"],
			[2, "archer"],
			[3, "knight"],
		]);
		// A missing or unknown entry draws no icon.
		const short = lobbyRoomModel(lobby({ characters: ["archer", "wizard" as never] }), 1, (id) => `P${id}`, 0);
		expect(short.members.map((r) => r.character)).toEqual(["archer", undefined, undefined]);
	});

	it("the room opening sends the remembered pick with an un-ready only when it differs and the member is not ready", () => {
		// Shown as the Knight (the server's default until a first pick), remembered the Archer: send it.
		expect(lobbyPickToSend(lobby({}), 1, "archer")).toBe("archer");
		// Already shown: nothing.
		expect(lobbyPickToSend(lobby({}), 2, "archer")).toBe(undefined);
		expect(lobbyPickToSend(lobby({}), 1, "knight")).toBe(undefined);
		// A ready member keeps the pick they readied with (an un-ready would un-ready them).
		expect(lobbyPickToSend(lobby({ ready: [1] }), 1, "archer")).toBe(undefined);
		// Not forming (counting down, in a run), or not a member: nothing.
		expect(lobbyPickToSend(lobby({ phase: "countdown" }), 1, "archer")).toBe(undefined);
		expect(lobbyPickToSend(lobby({ phase: "inRun" }), 1, "archer")).toBe(undefined);
		expect(lobbyPickToSend(lobby({}), 9, "archer")).toBe(undefined);
		// No entry for me yet (an older view): send.
		expect(lobbyPickToSend(lobby({ characters: [] }), 1, "knight")).toBe("knight");
	});
});

describe("the run-over Character button (AR7, owner answer 8)", () => {
	it("solo runs played as a character with the recap's exits; never a party run (Back to lobby only)", () => {
		expect(runOverCharacterShown(false, true, true, "archer")).toBe(true);
		expect(runOverCharacterShown(false, true, true, "knight")).toBe(true);
		expect(runOverCharacterShown(true, false, true, "archer")).toBe(false);
		expect(runOverCharacterShown(true, true, true, "archer")).toBe(false);
		expect(runOverCharacterShown(false, false, true, "archer")).toBe(false);
		// M1's two weapons (RunInfo.character ""), the panel's first frame before the recap.
		expect(runOverCharacterShown(false, true, true, "")).toBe(false);
		expect(runOverCharacterShown(false, true, false, "archer")).toBe(false);
	});

	it("the exits: Again first, Character beside it, then the exit and Details", () => {
		expect(runOverExitButtons(true, true, true)).toEqual(["again", "character", "exit", "details"]);
		expect(runOverExitButtons(true, true, false)).toEqual(["again", "character", "exit"]);
		expect(runOverExitButtons(true, false, true)).toEqual(["again", "exit", "details"]);
		expect(runOverExitButtons(false, true, true)).toEqual(["exit", "details"]);
		expect(runOverExitButtons(false, false, false)).toEqual(["exit"]);
	});

	it("without Character every layout keeps today's single row; with it Again keeps its place and Character stands beside it", () => {
		for (const layout of ["wide", "compact", "narrow"] as const) {
			for (const details of [false, true]) {
				const today = runOverExitButtons(true, false, details);
				expect([layout, details, runOverExitLayout(today, layout, HUD_VIEW.gap)]).toEqual([
					layout,
					details,
					{ rows: [today], detailsAside: false },
				]);
				const exits = runOverExitLayout(runOverExitButtons(true, true, details), layout, HUD_VIEW.gap);
				const rows = exits.rows;
				expect([layout, details, rows[0][0], rows[0][1]]).toEqual([layout, details, "again", "character"]);
				for (const row of rows) {
					const w = runOverExitsRowWidth(row, layout, HUD_VIEW.gap);
					expect([layout, details, w <= runOverExitRowWidth(layout)]).toEqual([layout, details, true]);
				}
				// Three buttons fit one row everywhere. The fourth (Details): compact, aside in the right column (a
				// second row would cost the smallest phone its fit); wide and narrow, a second row with the exit.
				const aside = details && layout === "compact";
				expect([layout, details, rows.size(), exits.detailsAside]).toEqual([
					layout,
					details,
					details && !aside ? 2 : 1,
					aside,
				]);
			}
		}
		expect(runOverExitLayout(["again", "character", "exit", "details"], "wide", HUD_VIEW.gap)).toEqual({
			rows: [
				["again", "character"],
				["exit", "details"],
			],
			detailsAside: false,
		});
		expect(runOverExitLayout(["again", "character", "exit", "details"], "compact", HUD_VIEW.gap)).toEqual({
			rows: [["again", "character", "exit"]],
			detailsAside: true,
		});
		// No right column (an unscored run): a second row instead.
		expect(runOverExitLayout(["again", "character", "exit", "details"], "compact", HUD_VIEW.gap, false)).toEqual({
			rows: [
				["again", "character"],
				["exit", "details"],
			],
			detailsAside: false,
		});
		// A party run (no Again, no Character): Back to lobby and Details, one row as today.
		expect(runOverExitLayout(runOverExitButtons(false, false, true), "compact", HUD_VIEW.gap)).toEqual({
			rows: [["exit", "details"]],
			detailsAside: false,
		});
		// Again stays the largest button (RECAP_UI.exits; Character takes an `other` size).
		expect(runOverExitsRowWidth(["character"], "wide", 0)).toBe(RECAP_UI.exits.wide.other.x);
		expect(RECAP_UI.exits.compact.again.x).toBeGreaterThan(RECAP_UI.exits.compact.other.x);
	});
});

describe("the idle preview (AR7)", () => {
	const EIGHT: SpriteFacings = { count: 8, zeroDeg: 0, ccw: true };

	it("faces the camera: the S row of the pipeline's 8 facings (E NE N NW W SW S SE), row 0 of a one-facing set", () => {
		expect(characterPreviewFacing(EIGHT)).toBe(6);
		expect(characterPreviewFacing({ count: 4, zeroDeg: 0, ccw: true })).toBe(3);
		expect(characterPreviewFacing({ count: 1, zeroDeg: 0, ccw: true })).toBe(0);
	});

	it("loops the idle at its fps; reduced motion and a one-frame set hold the first frame", () => {
		expect(characterPreviewFrame(0, 7, 8, false)).toBe(0);
		expect(characterPreviewFrame(0.5, 7, 8, false)).toBe(3);
		expect(characterPreviewFrame(8 / 7 + 0.01, 7, 8, false)).toBe(0);
		expect(characterPreviewFrame(2, 7, 8, true)).toBe(0);
		expect(characterPreviewFrame(2, 7, 1, false)).toBe(0);
		expect(characterPreviewFrame(2, 0, 8, false)).toBe(0);
		expect(characterPreviewFrame(-1, 7, 8, false)).toBe(0);
	});

	it("fits the cell into the preview square, aspect kept, whole px", () => {
		// The Archer's 121 x 97 cell, the knight's 128 x 128.
		expect(characterPreviewSize(121, 97, 128)).toEqual({ w: 128, h: 102 });
		expect(characterPreviewSize(128, 128, 96)).toEqual({ w: 96, h: 96 });
		expect(characterPreviewSize(50, 100, 72)).toEqual({ w: 36, h: 72 });
		expect(characterPreviewSize(0, 100, 72)).toEqual({ w: 0, h: 0 });
	});
});

// ---- fit (docs/UI_ART.md "Phones", docs/PORTRAIT.md, docs/GAMEPAD_MENUS.md GM12) ---------------------------------

const TOP = 58;

interface Screen {
	readonly name: string;
	readonly x: number;
	readonly y: number;
	readonly insets: MenuInsets;
}

/** fit.spec.ts's phones: the reference landscape phones, the owner's (the smallest, 693 x 320), portrait phones. */
const PHONES: ReadonlyArray<Screen> = [
	{ name: "844x390", x: 844, y: 390, insets: { top: TOP, left: 47, right: 47, bottom: 21 } },
	{ name: "667x375", x: 667, y: 375, insets: { top: TOP, left: 0, right: 0, bottom: 0 } },
	{ name: "693x320", x: 693, y: 320, insets: { top: TOP, left: 49, right: 49, bottom: 0 } },
];
const PORTRAITS: ReadonlyArray<Screen> = [
	{ name: "390x844", x: 390, y: 844, insets: { top: TOP, left: 0, right: 0, bottom: 34 } },
	{ name: "375x667", x: 375, y: 667, insets: { top: TOP, left: 0, right: 0, bottom: 0 } },
	{ name: "430x932", x: 430, y: 932, insets: { top: TOP, left: 0, right: 0, bottom: 34 } },
];
const DESKTOPS: ReadonlyArray<Screen> = [
	{ name: "1280x720", x: 1280, y: 720, insets: { top: TOP, left: 0, right: 0, bottom: 0 } },
	{ name: "1920x1080", x: 1920, y: 1080, insets: { top: TOP, left: 0, right: 0, bottom: 0 } },
];
/** Consoles (ten-foot): the top bar is hidden in a console's game view, so no inset. */
const TVS: ReadonlyArray<Screen> = [
	{ name: "TV 1920x1080", x: 1920, y: 1080, insets: { top: 0, left: 0, right: 0, bottom: 0 } },
	{ name: "TV 1280x720", x: 1280, y: 720, insets: { top: 0, left: 0, right: 0, bottom: 0 } },
	{ name: "TV 3840x2160", x: 3840, y: 2160, insets: { top: 0, left: 0, right: 0, bottom: 0 } },
];

/** The panel as drawn at HUD scale `u`: its content and the menu frame's padding (snapped slice insets). */
function panelSize(arrangement: CharacterArrangement, u: number, hintLine: boolean): { w: number; h: number } {
	const p = skinPadding(
		uniformPadding(CHARACTER_VIEW.panelPad),
		UI_ART.contentInsets["ui.panel.menu"],
		snappedSliceScale(u, UI_ART.refPerArt),
	);
	const l = characterLayout(arrangement);
	return {
		w: l.panelW - 2 * CHARACTER_VIEW.panelPad + p.left + p.right,
		h: characterContentHeight(arrangement, hintLine) + p.top + p.bottom,
	};
}

/** Fits the panel on `s` (touch: compact / narrow from the area; ten-foot: the TV-safe area, the full row). */
function fitOn(s: Screen, u: number, touch: boolean, tenFoot: boolean, hintLine: boolean) {
	const raw = menuArea(s.x, s.y, s.insets, u);
	const safe = menuSafeShare(tenFoot);
	const area = { w: raw.w * (1 - 2 * safe.x), h: raw.h * (1 - 2 * safe.y) };
	const arrangement = characterArrangement(menuCompact(area.h, touch), menuNarrow(area.w, area.h, touch));
	const size = panelSize(arrangement, u, hintLine);
	const narrow = menuNarrow(area.w, area.h, touch);
	const fit = fitMenu({
		w: size.w,
		h: size.h,
		areaW: area.w,
		areaH: area.h,
		uiScale: u,
		touch: menuFitOn(touch, tenFoot),
		narrow,
		ornament: false,
		ornamentArtH: 0,
	});
	return { arrangement, fit, size, area };
}

describe("the character screen fits (AR7)", () => {
	it("the layouts: two cards side by side (a column in portrait), the cards filling the panel's inner width", () => {
		const row = characterLayout("row");
		const v = CHARACTER_VIEW;
		expect(row.panelW).toBe(2 * v.cardWidth.row + v.cardGap + 2 * v.panelPad);
		expect(characterLayout("column").panelW).toBe(v.cardWidth.column + 2 * v.panelPad);
		expect(characterLayout("compact").cardH).toBeLessThan(row.cardH);
		expect(characterArrangement(false, false)).toBe("row");
		expect(characterArrangement(true, false)).toBe("compact");
		expect(characterArrangement(true, true)).toBe("column");
		expect(characterArrangement(false, true)).toBe("column");
		// Start is the largest button, Back the menus' small one; both fit one row in the narrowest (column) panel.
		const buttons = v.startButton.x + HUD_VIEW.gap + v.backButton.x;
		expect(buttons).toBeLessThanOrEqual(characterLayout("column").panelW - 2 * v.panelPad);
	});

	it("every landscape phone (the smallest, 693 x 320, included) at 70-125 %: compact, no overflow, above the floor", () => {
		for (const s of PHONES) {
			for (const percent of [70, 100, 125]) {
				const u = computeHudScale(s.x, s.y, false, percent, true);
				const r = fitOn(s, u, true, false, false);
				expect([s.name, percent, r.arrangement, r.fit.overflow]).toEqual([s.name, percent, "compact", false]);
				expect(u * r.fit.factor).toBeGreaterThanOrEqual(math.min(u, MENU_FIT.minScale) - 1e-9);
			}
		}
		// The reference phones at the touch scale: full size.
		for (const s of [PHONES[0], PHONES[1]]) {
			const u = computeHudScale(s.x, s.y, false, 100, true);
			expect([s.name, fitOn(s, u, true, false, false).fit.factor]).toEqual([s.name, 1]);
		}
	});

	it("every portrait phone: the column, no overflow, at no less than the full floor", () => {
		for (const s of PORTRAITS) {
			for (const percent of [70, 100, 125]) {
				const u = computeHudScale(s.x, s.y, false, percent, true);
				const r = fitOn(s, u, true, false, false);
				expect([s.name, percent, r.arrangement, r.fit.overflow]).toEqual([s.name, percent, "column", false]);
				expect(u * r.fit.factor).toBeGreaterThanOrEqual(math.min(u, MENU_FIT.minScale) - 1e-9);
			}
		}
	});

	it("a console (ten-foot): the full row inside the TV-safe area, with the hint bar, at full size", () => {
		for (const s of TVS) {
			const u = computeHudScale(s.x, s.y, true);
			const r = fitOn(s, u, false, true, true);
			expect([s.name, r.arrangement, r.fit.overflow, r.fit.factor]).toEqual([s.name, "row", false, 1]);
		}
	});

	it("desktops: the full row, never fitted (factor 1) and inside the window", () => {
		for (const s of DESKTOPS) {
			const u = computeHudScale(s.x, s.y, false);
			const r = fitOn(s, u, false, false, true);
			expect([s.name, r.arrangement, r.fit.factor]).toEqual([s.name, "row", 1]);
			expect(r.size.w).toBeLessThanOrEqual(r.area.w - 2 * MENU_FIT.margin);
			expect(r.size.h).toBeLessThanOrEqual(r.area.h - 2 * MENU_FIT.margin);
		}
	});
});

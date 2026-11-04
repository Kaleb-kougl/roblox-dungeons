// Fitting the menu screens into the safe area on phones (shared/view/menu fit.ts, docs/UI_ART.md "Phones").
import { describe, expect, it } from "@rbxts/jest-globals";
import { PORTRAIT } from "shared/view";
import {
	DAILY_RANK,
	HUD_VIEW,
	LEADERBOARD_VIEW,
	RECAP_UI,
	OPTIONS_VIEW,
	TUTORIAL_VIEW,
	UI_ART,
	artDensityBox,
	computeHudScale,
	recapExitsWidth,
	recapGridSize,
	skinPadding,
	snappedSliceScale,
	uniformPadding,
} from "shared/view/hud";
import {
	DAILY_MENU,
	MENU_FIT,
	MENU_VIEW,
	fitMenu,
	lobbyRoomParts,
	menuArea,
	menuCompact,
	menuFitDevice,
	menuNarrow,
	pausePanelArea,
	ornamentOverhang,
	type MenuFitInput,
	type MenuFitResult,
	type MenuInsets,
} from "shared/view/menu";

/** The Roblox top bar under CoreUISafeInsets (pt): 58 on the owner's phone and on desktop (footprint HUD_TEST_TOP_INSET). */
const TOP = 58;

interface Screen {
	readonly name: string;
	readonly x: number;
	readonly y: number;
	readonly insets: MenuInsets;
}

/**
 * Landscape phones (pt): the two reference phones (docs/MOBILE_IMPL.md; 844 x 390 with its notch and home indicator
 * insets) and the owner's (screenshots 2026-10-30: 2079 x 960 px at 3 px per pt, the top bar's bottom at 58 pt, the
 * safe area 49 pt in from each side).
 */
const PHONES: ReadonlyArray<Screen> = [
	{ name: "844x390", x: 844, y: 390, insets: { top: TOP, left: 47, right: 47, bottom: 21 } },
	{ name: "667x375", x: 667, y: 375, insets: { top: TOP, left: 0, right: 0, bottom: 0 } },
	{ name: "693x320", x: 693, y: 320, insets: { top: TOP, left: 49, right: 49, bottom: 0 } },
];
const DESKTOPS: ReadonlyArray<Screen> = [
	{ name: "1280x720", x: 1280, y: 720, insets: { top: TOP, left: 0, right: 0, bottom: 0 } },
	{ name: "1920x1080", x: 1920, y: 1080, insets: { top: TOP, left: 0, right: 0, bottom: 0 } },
	{ name: "2560x1440", x: 2560, y: 1440, insets: { top: TOP, left: 0, right: 0, bottom: 0 } },
];

/** The bone ornament's art height (ui.ornament.bones, 89 x 13, packs/vale uiIconLayout). */
const ORNAMENT_ART_H = 13;

// ---- Estimated panel sizes (reference px), from the layout constants: one line of text is size + 4 (Text), a
// wrapped two-line small text 40, a list gap HUD_VIEW.gap, and the menu frame's padding (skinPadding over
// ui.panel.menu's content insets at the snapped slice scale). The client measures the real panels; these check the
// rules against the screens as built.

const LINE = (size: number) => size + 4;
const TWO_SMALL_LINES = 40;
const BUTTON = HUD_VIEW.buttonSize.y;

function menuPad(pad: number, uiScale: number) {
	return skinPadding(
		uniformPadding(pad),
		UI_ART.contentInsets["ui.panel.menu"],
		snappedSliceScale(uiScale, UI_ART.refPerArt),
	);
}

/** A vertical menu panel's height: its rows, a gap between each, its padding. */
function column(rows: ReadonlyArray<number>, pad: number, uiScale: number): number {
	let h = 0;
	for (const r of rows) h += r;
	const p = menuPad(pad, uiScale);
	return h + HUD_VIEW.gap * (rows.size() - 1) + p.top + p.bottom;
}

interface Estimate {
	readonly w: number;
	readonly h: number;
	readonly ornament: boolean;
	readonly flex?: { readonly min: number; readonly max: number };
}

const SCORE_LINES = 11; // the score, 9 sources, the best combo
const BIG = 16; // HUD_VIEW.pad * 2, the menus' padding

function divider(uiScale: number): number {
	return artDensityBox(48, 3, uiScale, UI_ART.refPerArt).h;
}

/** The screens as drawn on touch, compact (a phone) or not. */
function estimates(uiScale: number, compact: boolean): ReadonlyMap<string, Estimate> {
	const out = new Map<string, Estimate>();
	const title = LINE(HUD_VIEW.titleText);
	const big = LINE(HUD_VIEW.bigText);
	out.set("mainMenu", {
		w: compact ? MENU_FIT.mainCompactWidth : MENU_VIEW.mainWidth,
		h: compact
			? column([big, BUTTON, BUTTON, BUTTON, TWO_SMALL_LINES], BIG, uiScale) // Credits beside the invite reason
			: column([big, BUTTON, BUTTON, BUTTON, TWO_SMALL_LINES, BUTTON, BUTTON, BUTTON, BUTTON], BIG, uiScale),
		ornament: true,
	});
	// Solo pause on touch: title, five buttons, the divider, the info line (two lines); no key hints.
	out.set("pause", {
		w: HUD_VIEW.panelWidth,
		h: column([big, BUTTON, BUTTON, BUTTON, BUTTON, BUTTON, divider(uiScale), TWO_SMALL_LINES], BIG, uiScale),
		ornament: true,
	});
	// A scored run's end on touch (no restart-key line), verdict and info line.
	const header = UI_ART.iconBox.header;
	const breakdownW = HUD_VIEW.breakdownLabelWidth + HUD_VIEW.gap + HUD_VIEW.breakdownValueWidth;
	const lineH = LINE(HUD_VIEW.textSize);
	if (compact) {
		const left =
			header +
			2 * HUD_VIEW.titleText +
			4 +
			(3 * lineH + 2 * HUD_VIEW.gap) +
			MENU_FIT.runOverButton.y +
			LINE(HUD_VIEW.smallText) +
			TWO_SMALL_LINES +
			5 * HUD_VIEW.gap;
		const right = SCORE_LINES * lineH + (SCORE_LINES - 1) * MENU_FIT.runOverLineGap;
		const p = menuPad(HUD_VIEW.pad, uiScale);
		out.set("runOver", {
			w: MENU_FIT.runOverLeftWidth + HUD_VIEW.gap + breakdownW + HUD_VIEW.pad * 4,
			h: math.max(left, right) + p.top + p.bottom,
			ornament: false,
		});
	} else {
		const stat = HUD_VIEW.pad * 2 + LINE(HUD_VIEW.smallText) + HUD_VIEW.gap + title;
		const breakdown = SCORE_LINES * lineH + (SCORE_LINES - 1) * HUD_VIEW.gap + HUD_VIEW.pad * 2;
		out.set("runOver", {
			w: HUD_VIEW.panelWidth * 2,
			h: column(
				[header, title, stat, breakdown, LINE(HUD_VIEW.smallText), TWO_SMALL_LINES, BUTTON],
				HUD_VIEW.pad,
				uiScale,
			),
			ornament: false,
		});
	}
	// Options, the Display tab on touch (nine rows of 30): compact, the tab body scrolls (the flexible list).
	const rows = 9 * OPTIONS_VIEW.rowHeight + 8 * HUD_VIEW.gap;
	const chrome = [title, OPTIONS_VIEW.tabSize.y, divider(uiScale), divider(uiScale), BUTTON];
	out.set("options", {
		w: compact ? MENU_FIT.optionsWidth : OPTIONS_VIEW.width,
		h: column([...chrome, compact ? math.min(rows, MENU_FIT.optionsBodyMax) : rows], BIG, uiScale),
		ornament: false,
		flex: compact ? { min: MENU_FIT.listMin, max: math.min(rows, MENU_FIT.optionsBodyMax) } : undefined,
	});
	const small = MENU_VIEW.smallButton.y;
	out.set("lobbyBrowser", {
		w: MENU_VIEW.screenWidth,
		h: column([title, small, MENU_VIEW.listHeight, small], BIG, uiScale),
		ornament: false,
		flex: { min: MENU_FIT.listMin, max: MENU_VIEW.listHeight },
	});
	// The host's lobby room: title, status, members line, members, host controls, buttons.
	out.set("lobbyRoom", {
		w: MENU_VIEW.screenWidth,
		h: column([title, lineH, LINE(HUD_VIEW.smallText), MENU_VIEW.listHeight, small, small], BIG, uiScale),
		ornament: false,
		flex: { min: MENU_FIT.listMin, max: MENU_VIEW.listHeight },
	});
	// Inviting: compact, the invite panel replaces the member list and the host controls (lobbyRoomParts); its list
	// (in a tall-framed panel: 10 / 7 art px borders at the snapped scale, 2 gaps) is the flexible one.
	const slice = snappedSliceScale(uiScale, UI_ART.refPerArt);
	const invitePanel = (list: number) => lineH + small + list + 2 * HUD_VIEW.gap + 17 * slice;
	const parts = lobbyRoomParts(compact, true);
	const inviteRows = [title, lineH, LINE(HUD_VIEW.smallText)];
	if (parts.members) inviteRows.push(MENU_VIEW.listHeight);
	if (parts.hostControls) inviteRows.push(small);
	inviteRows.push(small, invitePanel(parts.members ? MENU_VIEW.inviteListHeight : MENU_VIEW.listHeight));
	out.set("lobbyRoomInviting", {
		w: MENU_VIEW.screenWidth,
		h: column(inviteRows, BIG, uiScale),
		ornament: false,
		flex: { min: MENU_FIT.listMin, max: MENU_VIEW.listHeight },
	});
	// Four lines of body text.
	out.set("tutorialOutro", {
		w: TUTORIAL_VIEW.outroWidth,
		h: column([big, 4 * HUD_VIEW.titleText + 4, BUTTON, BUTTON], BIG, uiScale),
		ornament: false,
	});
	out.set("objectiveCard", {
		w: TUTORIAL_VIEW.cardWidth,
		h: column([big, 4 * HUD_VIEW.titleText + 4, LINE(HUD_VIEW.smallText)], BIG, uiScale),
		ornament: false,
	});
	// Ten rows on the board.
	const board = math.min(LEADERBOARD_VIEW.listHeight, 10 * (LEADERBOARD_VIEW.rowHeight + HUD_VIEW.gap));
	// Credits: title, the list, Back, the back hint (none on touch).
	out.set("credits", {
		w: MENU_VIEW.creditsWidth,
		h: column([title, MENU_VIEW.listHeight, MENU_VIEW.smallButton.y], BIG, uiScale),
		ornament: false,
		flex: { min: MENU_FIT.listMin, max: MENU_VIEW.listHeight },
	});
	out.set("leaderboard", {
		w: LEADERBOARD_VIEW.width,
		h: column([title, BUTTON, LINE(HUD_VIEW.smallText), board, LINE(HUD_VIEW.smallText), BUTTON], BIG, uiScale),
		ornament: false,
		flex: { min: MENU_FIT.listMin, max: board },
	});
	return out;
}

function touchScale(s: Screen, percent = 100): number {
	return computeHudScale(s.x, s.y, false, percent, true);
}

function fitOn(s: Screen, e: Estimate, uiScale: number, touch: boolean): MenuFitResult {
	const area = menuArea(s.x, s.y, s.insets, uiScale);
	const input: MenuFitInput = {
		w: e.w,
		h: e.h,
		areaW: area.w,
		areaH: area.h,
		uiScale,
		touch,
		ornament: e.ornament,
		ornamentArtH: ORNAMENT_ART_H,
		flex: e.flex !== undefined ? { current: e.flex.max, min: e.flex.min, max: e.flex.max } : undefined,
	};
	return fitMenu(input);
}

/** The panel's drawn height after the fit (the flexible list at its fitted height). */
function fittedHeight(e: Estimate, fit: MenuFitResult): number {
	return e.h + (e.flex !== undefined && fit.flex !== undefined ? fit.flex - e.flex.max : 0);
}

/** The fitted panel (and its ornament) lies inside the area, MENU_FIT.margin in from every edge. */
function expectInside(s: Screen, e: Estimate, fit: MenuFitResult, uiScale: number) {
	const area = menuArea(s.x, s.y, s.insets, uiScale);
	const f = fit.factor;
	const h = fittedHeight(e, fit) * f;
	const w = e.w * f;
	const slack = 1e-6;
	expect(w).toBeLessThanOrEqual(area.w - 2 * MENU_FIT.margin + slack);
	const centreY = area.h / 2 + fit.offsetY;
	const over = fit.ornament ? ornamentOverhang(ORNAMENT_ART_H, uiScale * f) * f : 0;
	expect(centreY - h / 2 - over).toBeGreaterThanOrEqual(MENU_FIT.margin - slack);
	expect(centreY + h / 2).toBeLessThanOrEqual(area.h - MENU_FIT.margin + slack);
}

const SCREENS = [
	"mainMenu",
	"pause",
	"runOver",
	"options",
	"lobbyBrowser",
	"credits",
	"lobbyRoom",
	"lobbyRoomInviting",
	"tutorialOutro",
	"objectiveCard",
	"leaderboard",
];

describe("menu fit on phones (docs/UI_ART.md Phones)", () => {
	it("every landscape phone is compact at the touch scale, at every HUD scale step", () => {
		for (const s of PHONES) {
			// 70 % on the 844 x 390 phone: 592; 80 % and up everywhere.
			for (const percent of [70, 80, 90, 100, 110, 125]) {
				const u = touchScale(s, percent);
				expect([s.name, percent, menuCompact(menuArea(s.x, s.y, s.insets, u).h, true)]).toEqual([
					s.name,
					percent,
					true,
				]);
			}
		}
	});

	it("every screen fits inside the safe area, at no less than the floor", () => {
		for (const s of PHONES) {
			const u = touchScale(s);
			expect(u).toBe(HUD_VIEW.touchMinScale);
			const all = estimates(u, true);
			for (const name of SCREENS) {
				const e = all.get(name)!;
				const fit = fitOn(s, e, u, true);
				expect([s.name, name, fit.overflow]).toEqual([s.name, name, false]);
				// A HUD scale already under the floor (70 %) is never shrunk: the floor is the lower of the two.
				expect(u * fit.factor).toBeGreaterThanOrEqual(math.min(u, MENU_FIT.minScale) - 1e-9);
				expectInside(s, e, fit, u);
			}
		}
	});

	it("the reference phones draw every screen at the full touch scale", () => {
		for (const s of [PHONES[0], PHONES[1]]) {
			const u = touchScale(s);
			const all = estimates(u, true);
			for (const name of SCREENS) {
				expect([s.name, name, fitOn(s, all.get(name)!, u, true).factor]).toEqual([s.name, name, 1]);
			}
		}
	});

	it("the owner's 693 x 320 phone: the main menu, lobbies, Options and outro at full scale, the rest above 0.65", () => {
		const s = PHONES[2];
		const u = touchScale(s);
		const all = estimates(u, true);
		for (const name of ["mainMenu", "options", "lobbyBrowser", "lobbyRoom", "tutorialOutro", "leaderboard"]) {
			expect([name, fitOn(s, all.get(name)!, u, true).factor]).toEqual([name, 1]);
		}
		for (const name of ["pause", "runOver", "lobbyRoomInviting"]) {
			expect(u * fitOn(s, all.get(name)!, u, true).factor).toBeGreaterThan(0.65);
		}
	});

	it("the main menu keeps its ornament on every phone; it never costs the panel any size", () => {
		for (const s of PHONES) {
			const u = touchScale(s);
			const e = estimates(u, true).get("mainMenu")!;
			const fit = fitOn(s, e, u, true);
			expect([s.name, fit.ornament, fit.factor]).toEqual([s.name, true, 1]);
			const bare = fitOn(s, { ...e, ornament: false }, u, true);
			expect(bare.factor).toBe(fit.factor);
		}
		// The pause panel on the 693 x 320 phone has no room above it: the ornament is skipped, not squeezed in.
		const s = PHONES[2];
		const u = touchScale(s);
		const e = estimates(u, true).get("pause")!;
		const fit = fitOn(s, e, u, true);
		expect(fit.ornament).toBe(false);
		expect(fit.factor).toBe(fitOn(s, { ...e, ornament: false }, u, true).factor);
	});

	it("without the compact layouts the main menu and run over would not fit the 693 x 320 phone", () => {
		const s = PHONES[2];
		const u = touchScale(s);
		const all = estimates(u, false);
		expect(fitOn(s, all.get("runOver")!, u, true).overflow).toBe(true);
		const main = fitOn(s, all.get("mainMenu")!, u, true);
		expect(main.ornament).toBe(false);
		expect(u * main.factor).toBeLessThan(0.66);
	});
});

/**
 * Portrait phones (pt; the top bar plus the notch under CoreUISafeInsets, the home indicator at the bottom): phones turn
 * either way (Sensor, docs/PORTRAIT.md PD1).
 */
const PORTRAITS: ReadonlyArray<Screen> = [
	{ name: "390x844", x: 390, y: 844, insets: { top: TOP, left: 0, right: 0, bottom: 34 } },
	{ name: "375x667", x: 375, y: 667, insets: { top: TOP, left: 0, right: 0, bottom: 0 } },
	{ name: "430x932", x: 430, y: 932, insets: { top: TOP, left: 0, right: 0, bottom: 34 } },
];

/** The screens as drawn in portrait: the main menu's stacked layout, the run over's one column, the rest full. */
function narrowEstimates(uiScale: number): ReadonlyMap<string, Estimate> {
	const out = new Map<string, Estimate>();
	const full = estimates(uiScale, false);
	for (const name of SCREENS) out.set(name, full.get(name)!);
	const compactMain = estimates(uiScale, true).get("mainMenu")!;
	// The stacked main menu with the Daily card and podium under Play solo's row (generously 240 tall).
	out.set("mainMenu", { ...compactMain, h: compactMain.h + 240 });
	const lineH = LINE(HUD_VIEW.textSize);
	const breakdown = SCORE_LINES * lineH + (SCORE_LINES - 1) * HUD_VIEW.gap + HUD_VIEW.pad * 2;
	out.set("runOver", {
		w: MENU_FIT.runOverNarrowWidth,
		h: column(
			[
				UI_ART.iconBox.header,
				2 * LINE(HUD_VIEW.titleText),
				3 * lineH + 2 * HUD_VIEW.gap,
				breakdown,
				MENU_FIT.runOverButton.y,
				TWO_SMALL_LINES,
				TWO_SMALL_LINES,
			],
			HUD_VIEW.pad,
			uiScale,
		),
		ornament: false,
	});
	return out;
}

function narrowFit(s: Screen, e: Estimate, uiScale: number): MenuFitResult {
	const area = menuArea(s.x, s.y, s.insets, uiScale);
	return fitMenu({
		w: e.w,
		h: e.h,
		areaW: area.w,
		areaH: area.h,
		uiScale,
		touch: true,
		narrow: menuNarrow(area.w, area.h, true),
		ornament: e.ornament,
		ornamentArtH: ORNAMENT_ART_H,
		flex: e.flex !== undefined ? { current: e.flex.max, min: e.flex.min, max: e.flex.max } : undefined,
	});
}

describe("menu fit on a touchscreen and in portrait", () => {
	it("a touchscreen fits whatever was pressed last; a desktop without one never does", () => {
		expect(menuFitDevice(true, true)).toBe(true);
		expect(menuFitDevice(false, true)).toBe(true);
		expect(menuFitDevice(true, false)).toBe(true);
		expect(menuFitDevice(false, false)).toBe(false);
	});

	it("a phone driven by a keyboard (the desktop HUD scale) is still compact in landscape", () => {
		for (const s of PHONES) {
			const u = computeHudScale(s.x, s.y, false);
			expect([s.name, menuCompact(menuArea(s.x, s.y, s.insets, u).h, menuFitDevice(false, true))]).toEqual([
				s.name,
				true,
			]);
		}
	});

	it("portrait is narrow; landscape phones, desktops and a landscape tablet never are", () => {
		for (const s of PORTRAITS) {
			for (const touch of [true, false]) {
				for (const percent of [70, 100, 125]) {
					const u = computeHudScale(s.x, s.y, false, percent, touch);
					const a = menuArea(s.x, s.y, s.insets, u);
					expect([s.name, touch, percent, menuNarrow(a.w, a.h, true)]).toEqual([
						s.name,
						touch,
						percent,
						true,
					]);
				}
			}
		}
		for (const s of [...PHONES, ...DESKTOPS]) {
			for (const percent of [70, 100, 125]) {
				const u = computeHudScale(s.x, s.y, false, percent, true);
				const a = menuArea(s.x, s.y, s.insets, u);
				expect([s.name, percent, menuNarrow(a.w, a.h, true)]).toEqual([s.name, percent, false]);
			}
		}
		const u = computeHudScale(1024, 768, false, 100, true);
		const a = menuArea(1024, 768, { top: TOP, left: 0, right: 0, bottom: 20 }, u);
		expect(menuNarrow(a.w, a.h, true)).toBe(false);
		// Not a touch device: never narrow.
		expect(menuNarrow(400, 900, false)).toBe(false);
	});

	it("every screen fits inside a portrait phone, at no less than the narrow floor", () => {
		for (const s of PORTRAITS) {
			// The touch scale, and the desktop floor (Studio's emulator driven by a keyboard).
			for (const touch of [true, false]) {
				const u = computeHudScale(s.x, s.y, false, 100, touch);
				const all = narrowEstimates(u);
				for (const name of SCREENS) {
					const e = all.get(name)!;
					const fit = narrowFit(s, e, u);
					expect([s.name, touch, name, fit.overflow]).toEqual([s.name, touch, name, false]);
					expect(u * fit.factor).toBeGreaterThanOrEqual(MENU_FIT.narrowMinScale - 1e-9);
					expectInside(s, e, fit, u);
				}
			}
		}
	});

	it("the portrait main menu and run over keep the full floor (only the widest screens use the narrow one)", () => {
		for (const s of PORTRAITS) {
			const u = computeHudScale(s.x, s.y, false, 100, true);
			const all = narrowEstimates(u);
			for (const name of ["mainMenu", "runOver", "pause", "leaderboard", "tutorialOutro"]) {
				expect([s.name, name, u * narrowFit(s, all.get(name)!, u).factor >= MENU_FIT.minScale]).toEqual([
					s.name,
					name,
					true,
				]);
			}
		}
	});

	it("without the narrow layouts the main menu and run over would not fit a portrait phone", () => {
		const s = PORTRAITS[0];
		const u = computeHudScale(s.x, s.y, false, 100, true);
		const full = estimates(u, false);
		const main = {
			...full.get("mainMenu")!,
			w: MENU_VIEW.mainWidth + HUD_VIEW.gap + DAILY_MENU.cardWidth + 4 * HUD_VIEW.pad,
		};
		expect(fitOn(s, main, u, true).overflow).toBe(true);
		expect(fitOn(s, full.get("runOver")!, u, true).overflow).toBe(true);
	});
});

describe("menu fit on desktop: no change (docs/UI_ART.md Phones)", () => {
	it("mouse / keyboard / gamepad: factor 1, no offset, the ornament as asked, every list at its max", () => {
		for (const s of [...DESKTOPS, ...PHONES]) {
			const u = computeHudScale(s.x, s.y, false);
			for (const compact of [false, true]) {
				const all = estimates(u, compact);
				for (const name of SCREENS) {
					const e = all.get(name)!;
					const fit = fitOn(s, e, u, false);
					expect([s.name, name, fit.factor, fit.offsetY, fit.ornament, fit.overflow]).toEqual([
						s.name,
						name,
						1,
						0,
						e.ornament,
						false,
					]);
					expect(fit.flex).toBe(e.flex?.max);
				}
			}
		}
	});

	it("never compact without touch, nor on a desktop-sized touch screen", () => {
		for (const s of DESKTOPS) {
			const u = computeHudScale(s.x, s.y, false);
			const area = menuArea(s.x, s.y, s.insets, u);
			expect(menuCompact(area.h, false)).toBe(false);
			expect(menuCompact(area.h, true)).toBe(false);
		}
		for (const s of PHONES) expect(menuCompact(menuArea(s.x, s.y, s.insets, 0.75).h, false)).toBe(false);
		// A tablet in landscape (1024 x 768, touch): the full layouts.
		const u = computeHudScale(1024, 768, false, 100, true);
		expect(menuCompact(menuArea(1024, 768, { top: TOP, left: 0, right: 0, bottom: 20 }, u).h, true)).toBe(false);
	});

	it("touch at desktop sizes leaves the screens (nearly) as they are", () => {
		for (const s of DESKTOPS) {
			const u = computeHudScale(s.x, s.y, false, 100, true);
			const all = estimates(u, false);
			for (const name of ["mainMenu", "pause", "lobbyBrowser", "lobbyRoom", "tutorialOutro", "objectiveCard"]) {
				const e = all.get(name)!;
				const fit = fitOn(s, e, u, true);
				expect([s.name, name, fit.factor, fit.offsetY, fit.ornament]).toEqual([s.name, name, 1, 0, e.ornament]);
			}
			// A scored run's end is a hair over 720 p's room with the margins: 1-2 % smaller on a 720 p touch screen.
			expect(fitOn(s, all.get("runOver")!, u, true).factor).toBeGreaterThan(0.98);
		}
	});
});

describe("fitMenu rules", () => {
	const base: MenuFitInput = {
		w: 400,
		h: 300,
		areaW: 800,
		areaH: 400,
		uiScale: 0.75,
		touch: true,
		ornament: true,
		ornamentArtH: ORNAMENT_ART_H,
	};
	const over = ornamentOverhang(ORNAMENT_ART_H, 0.75);

	it("ornament overhang: half its art height at the menus' whole-px density", () => {
		// 13 art px at round(0.75 x 2) = 2 screen px each = 26 pt = 34.67 reference px; half above the edge.
		expect(over).toBeCloseTo((13 * 2) / 0.75 / 2, 6);
		expect(ornamentOverhang(ORNAMENT_ART_H, 1)).toBe(13);
	});

	it("room for the ornament on both sides: centred, no offset", () => {
		const fit = fitMenu({ ...base, h: 400 - 2 * MENU_FIT.margin - 2 * over });
		expect([fit.factor, fit.ornament, fit.offsetY]).toEqual([1, true, 0]);
	});

	it("room above only once moved down: moved down by half the overhang", () => {
		const fit = fitMenu({ ...base, h: 400 - 2 * MENU_FIT.margin - over });
		expect([fit.factor, fit.ornament]).toEqual([1, true]);
		expect(fit.offsetY).toBeCloseTo(over / 2, 9);
	});

	it("no room: the ornament is skipped and the panel keeps its size", () => {
		const fit = fitMenu({ ...base, h: 400 - 2 * MENU_FIT.margin - over + 1 });
		expect([fit.factor, fit.ornament, fit.offsetY]).toEqual([1, false, 0]);
	});

	it("too tall or too wide: scaled to the room, never below the floor", () => {
		const tall = fitMenu({ ...base, ornament: false, h: 2 * (400 - 2 * MENU_FIT.margin) });
		expect(tall.factor).toBeCloseTo(MENU_FIT.minScale / 0.75, 9); // 0.5 would be under the 0.6 floor
		expect(tall.overflow).toBe(true);
		const wide = fitMenu({ ...base, ornament: false, w: (800 - 2 * MENU_FIT.margin) / 0.9 });
		expect(wide.factor).toBeCloseTo(0.9, 9);
		expect(wide.overflow).toBe(false);
		// A HUD scale already under the floor (a phone at the 70 % setting) is never shrunk.
		expect(fitMenu({ ...base, uiScale: 0.525, h: 1000 }).factor).toBe(1);
	});

	it("the flexible list shrinks first, within its range", () => {
		const flex = { current: 300, min: MENU_FIT.listMin, max: 300 };
		const room = 400 - 2 * MENU_FIT.margin;
		const fit = fitMenu({ ...base, ornament: false, h: room + 100, flex });
		expect([fit.factor, fit.flex]).toEqual([1, 200]);
		const floored = fitMenu({ ...base, ornament: false, h: room + 250, flex });
		expect(floored.flex).toBe(MENU_FIT.listMin);
		expect(floored.factor).toBeCloseTo(room / (room + 250 - (300 - MENU_FIT.listMin)), 9);
		// Room to spare: back up to its max, never past it.
		expect(fitMenu({ ...base, ornament: false, h: 200, flex: { ...flex, current: 150 } }).flex).toBe(300);
	});

	it("menuArea: the safe area over the HUD scale", () => {
		const a = menuArea(844, 390, PHONES[0].insets, 0.75);
		expect(a.w).toBeCloseTo((844 - 94) / 0.75, 9);
		expect(a.h).toBeCloseTo((390 - 79) / 0.75, 9);
	});

	it("the lobby room's compact invite view replaces the members and the host controls", () => {
		expect(lobbyRoomParts(true, true)).toEqual({ members: false, hostControls: false });
		expect(lobbyRoomParts(true, false)).toEqual({ members: true, hostControls: true });
		expect(lobbyRoomParts(false, true)).toEqual({ members: true, hostControls: true });
	});
});

describe("the upright pause (docs/PORTRAIT.md PT6)", () => {
	it("the pause panel fits under the map on every portrait phone, at no less than the narrow floor", () => {
		for (const s of PORTRAITS) {
			for (const percent of [70, 100, 125]) {
				const u = computeHudScale(s.x, s.y, false, percent, true);
				const e = narrowEstimates(u).get("pause")!;
				const area = pausePanelArea(menuArea(s.x, s.y, s.insets, u), HUD_VIEW.gap);
				const fit = fitMenu({
					w: e.w,
					h: e.h,
					areaW: area.w,
					areaH: area.h,
					uiScale: u,
					touch: true,
					narrow: true,
					ornament: e.ornament,
					ornamentArtH: ORNAMENT_ART_H,
					flex: undefined,
				});
				expect([s.name, percent, fit.overflow]).toEqual([s.name, percent, false]);
				expect([s.name, percent, u * fit.factor >= MENU_FIT.narrowMinScale - 1e-9]).toEqual([
					s.name,
					percent,
					true,
				]);
			}
		}
	});

	it("leaves the panel the area under the map", () => {
		const area = { w: 500, h: 1000 };
		const under = pausePanelArea(area, 10);
		expect(under.w).toBe(500);
		expect(under.h).toBeCloseTo(1000 * (1 - PORTRAIT.pauseMapShare) - 10, 9);
		expect(pausePanelArea({ w: 10, h: 0 }, 10).h).toBe(0);
	});
});

/**
 * docs/RUN_RECAP.md RR5: the run-over recap's worst case, a record daily run with highlights (the ribbon, the main line
 * on two lines, the stats, the record row and the dim near-miss sub-line under it, four highlights, the daily block and
 * the friends passed, the verdict and info lines, the exits with Again, Main menu and Details), still fits the smallest
 * landscape phone, every portrait phone and the HUD 70 % step (Details shows the breakdown and Build list in the
 * highlights' place: the panel as before). A run without a record draws the plain near-miss line under the main line
 * instead of the ribbon (compact: the taller of the two is counted in the left column).
 */
function recapWorst(uiScale: number, layout: "compact" | "narrow" | "wide"): Estimate {
	const title = LINE(HUD_VIEW.titleText);
	const small = LINE(HUD_VIEW.smallText);
	const lineH = LINE(HUD_VIEW.textSize);
	const header = UI_ART.iconBox.header;
	const nearMiss = RECAP_UI.nearMiss.height;
	const dim = RECAP_UI.nearMiss.dimHeight;
	const grid = recapGridSize(4, HUD_VIEW.gap).h;
	// DailyResultBlock: its title / countdown row, the standing, best today, the save chip; DailyPassedRow: the label
	// and the headshot cells.
	const dailyRows = [small, title, small, small];
	const passed = small + DAILY_RANK.passedHeadshotPx + small;
	const stats = 3 * lineH + 2 * HUD_VIEW.gap;
	const main = 2 * HUD_VIEW.titleText + 4;
	const button = RECAP_UI.exits[layout].again.y;
	if (layout === "compact") {
		const leftRows = [header, math.max(title, nearMiss), main, stats, button, small, TWO_SMALL_LINES];
		let left = 0;
		for (const r of leftRows) left += r;
		left += (leftRows.size() - 1) * HUD_VIEW.gap;
		const rightRows = [...dailyRows, passed, lineH, dim, grid];
		let right = 0;
		for (const r of rightRows) right += r;
		right += (rightRows.size() - 1) * MENU_FIT.runOverLineGap;
		const breakdownW = HUD_VIEW.breakdownLabelWidth + HUD_VIEW.gap + HUD_VIEW.breakdownValueWidth;
		const p = menuPad(HUD_VIEW.pad, uiScale);
		return {
			w: MENU_FIT.runOverLeftWidth + HUD_VIEW.gap + breakdownW + HUD_VIEW.pad * 4,
			h: math.max(left, right) + p.top + p.bottom,
			ornament: false,
		};
	}
	const rows = [header, title, main, stats, lineH, dim, grid, ...dailyRows, passed, small, TWO_SMALL_LINES];
	rows.push(button);
	return {
		w: layout === "narrow" ? MENU_FIT.runOverNarrowWidth : HUD_VIEW.panelWidth * 2,
		h: column(rows, HUD_VIEW.pad, uiScale),
		ornament: false,
	};
}

describe("run-over recap fit (docs/RUN_RECAP.md RR5)", () => {
	it("the highlight grid takes the breakdown's width, and the exits row fits every layout's column", () => {
		const breakdownW = HUD_VIEW.breakdownLabelWidth + HUD_VIEW.gap + HUD_VIEW.breakdownValueWidth;
		expect(recapGridSize(4, HUD_VIEW.gap).w).toBe(breakdownW);
		expect(recapGridSize(2, HUD_VIEW.gap).h).toBe(RECAP_UI.cellHeight);
		const inner = HUD_VIEW.pad * 4; // the run-over panel's padding, both sides
		expect(recapExitsWidth("compact", 3, HUD_VIEW.gap)).toBeLessThanOrEqual(MENU_FIT.runOverLeftWidth);
		expect(recapExitsWidth("narrow", 3, HUD_VIEW.gap)).toBeLessThanOrEqual(MENU_FIT.runOverNarrowWidth - inner);
		expect(recapExitsWidth("wide", 3, HUD_VIEW.gap)).toBeLessThanOrEqual(HUD_VIEW.panelWidth * 2 - inner);
		for (const layout of ["wide", "compact", "narrow"] as const) {
			const e = RECAP_UI.exits[layout];
			// Again is the largest button (RR7: touch's first target).
			expect([layout, e.again.x > e.other.x, e.again.y >= e.other.y]).toEqual([layout, true, true]);
			expect(e.otherTextSize).toBeLessThanOrEqual(HUD_VIEW.textSize);
		}
	});

	it("a record daily run with highlights fits the landscape phones (compact) at 100 % and 70 %", () => {
		for (const s of PHONES) {
			for (const percent of [70, 100]) {
				const u = touchScale(s, percent);
				const e = recapWorst(u, "compact");
				const fit = fitOn(s, e, u, true);
				expect([s.name, percent, fit.overflow]).toEqual([s.name, percent, false]);
				// A HUD scale already under the floor (70 %) is never shrunk: the floor is the lower of the two.
				expect(u * fit.factor).toBeGreaterThanOrEqual(math.min(u, MENU_FIT.minScale) - 1e-9);
				expectInside(s, e, fit, u);
			}
		}
	});

	it("... and every portrait phone (narrow) at 100 % and 70 %, at no less than the full floor", () => {
		for (const s of PORTRAITS) {
			for (const percent of [70, 100]) {
				const u = computeHudScale(s.x, s.y, false, percent, true);
				const e = recapWorst(u, "narrow");
				const fit = narrowFit(s, e, u);
				expect([s.name, percent, fit.overflow]).toEqual([s.name, percent, false]);
				// A HUD scale already under the floor (70 %) is never shrunk: the floor is the lower of the two.
				expect(u * fit.factor).toBeGreaterThanOrEqual(math.min(u, MENU_FIT.minScale) - 1e-9);
				expectInside(s, e, fit, u);
			}
		}
	});

	it("... and on desktop is no taller than today's record daily run with its breakdown (never fitted there)", () => {
		for (const s of DESKTOPS) {
			const u = computeHudScale(s.x, s.y, false);
			const worst = recapWorst(u, "wide");
			// Today's panel for the same run: the breakdown, plus the record row and the daily block it already draws.
			const small = LINE(HUD_VIEW.smallText);
			const daily = small + LINE(HUD_VIEW.titleText) + 2 * small + small + DAILY_RANK.passedHeadshotPx + small;
			const today = estimates(u, false).get("runOver")!.h + LINE(HUD_VIEW.textSize) + daily + 3 * HUD_VIEW.gap;
			expect([s.name, worst.h <= today]).toEqual([s.name, true]);
		}
	});

	it("a plain endless run's recap (near-miss line, four highlights) fits every desktop at full size", () => {
		for (const s of DESKTOPS) {
			const u = computeHudScale(s.x, s.y, false);
			const rows = [
				UI_ART.iconBox.header,
				2 * HUD_VIEW.titleText + 4,
				LINE(HUD_VIEW.smallText),
				RECAP_UI.nearMiss.height,
				HUD_VIEW.pad * 2 + LINE(HUD_VIEW.smallText) + HUD_VIEW.gap + LINE(HUD_VIEW.titleText),
				recapGridSize(4, HUD_VIEW.gap).h,
				LINE(HUD_VIEW.smallText),
				TWO_SMALL_LINES,
				RECAP_UI.exits.wide.again.y,
			];
			const room = menuArea(s.x, s.y, s.insets, u).h - 2 * MENU_FIT.margin;
			expect([s.name, column(rows, HUD_VIEW.pad, u) <= room]).toEqual([s.name, true]);
		}
	});
});

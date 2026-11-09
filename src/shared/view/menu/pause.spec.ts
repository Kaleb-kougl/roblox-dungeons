// The pause overlay / pause button visibility, its top bar slot and the Roblox menu's close rule (pause.ts).
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	PAUSE_BUTTON_VIEW,
	afterRobloxMenuClosed,
	pauseButtonShown,
	pauseButtonSlot,
	pauseOverlayShown,
	robloxButtonsEnd,
	type PauseView,
} from ".";

const RUNNING: PauseView = {
	active: true,
	coop: false,
	playing: true,
	paused: false,
	coopOverlay: false,
	panelOpen: false,
	menuScreen: false,
	robloxMenuOpen: false,
	tutorialEnded: false,
};

function view(over: Partial<PauseView>): PauseView {
	return { ...RUNNING, ...over };
}

describe("pause overlay", () => {
	it("shows for a paused solo run and the open party overlay", () => {
		expect(pauseOverlayShown(RUNNING)).toBe(false);
		expect(pauseOverlayShown(view({ paused: true }))).toBe(true);
		expect(pauseOverlayShown(view({ coop: true, coopOverlay: true }))).toBe(true);
		expect(pauseOverlayShown(view({ coop: true, paused: true }))).toBe(false); // a party run never pauses
	});

	it("hides under the Roblox menu, under a panel and once the run is over", () => {
		expect(pauseOverlayShown(view({ paused: true, robloxMenuOpen: true }))).toBe(false);
		expect(pauseOverlayShown(view({ coop: true, coopOverlay: true, robloxMenuOpen: true }))).toBe(false);
		expect(pauseOverlayShown(view({ paused: true, panelOpen: true }))).toBe(false);
		expect(pauseOverlayShown(view({ paused: true, playing: false }))).toBe(false);
		// docs/ARCHER.md AR7: a menu screen over a paused run (the dev panel's character screen) hides it too.
		expect(pauseOverlayShown(view({ paused: true, menuScreen: true }))).toBe(false);
	});
});

describe("pause button", () => {
	it("shows while a run is being played", () => {
		expect(pauseButtonShown(RUNNING)).toBe(true);
		expect(pauseButtonShown(view({ coop: true }))).toBe(true);
	});

	it("hides while paused, covered or over", () => {
		const hidden: ReadonlyArray<Partial<PauseView>> = [
			{ active: false },
			{ playing: false },
			{ paused: true },
			{ coop: true, coopOverlay: true },
			{ panelOpen: true },
			{ menuScreen: true },
			{ robloxMenuOpen: true },
			{ tutorialEnded: true },
		];
		for (const over of hidden) expect(pauseButtonShown(view(over))).toBe(false);
	});
});

/** TopbarInset on the owner's phone (693 x 320, 2026-10-31): Min.X ~208 pt, the bar 58 pt tall. */
const TOPBAR = { x: 208, y: 0, w: 436, h: 58 };
/** Steps (pt) the spec moves the end of Roblox's pill through. */
const PILL_STEPS = 13;

describe("pause button slot", () => {
	it("on desktop sits exactly where it did: TopbarInset.Min.X + gap, centred in the bar", () => {
		const v = PAUSE_BUTTON_VIEW;
		const slot = pauseButtonSlot(TOPBAR, false);
		expect(slot.x).toBe(TOPBAR.x + v.gap);
		expect(slot.size).toBe(math.min(v.size, TOPBAR.h));
		expect(slot.y).toBe((TOPBAR.h - slot.size) / 2);
		expect(slot.reserveLeft).toBe(v.gap + slot.size);
		expect(robloxButtonsEnd(TOPBAR.x, false)).toBe(TOPBAR.x);
	});

	it("on touch keeps the gap from Roblox's pill wherever it ends, Min.X to one Roblox button (and its gap) past it", () => {
		const v = PAUSE_BUTTON_VIEW;
		const slot = pauseButtonSlot(TOPBAR, true);
		const furthest = TOPBAR.x + v.robloxButton + v.robloxButtonGap;
		for (let i = 0; i <= PILL_STEPS; i++) {
			const pillEnd = TOPBAR.x + ((furthest - TOPBAR.x) * i) / PILL_STEPS;
			expect([pillEnd, slot.x - pillEnd >= v.gap]).toEqual([pillEnd, true]);
		}
		// The owner's screenshot: the voice button ended 49 pt past Min.X, under the old button (Min.X + 8).
		expect(TOPBAR.x + v.gap < TOPBAR.x + 49).toBe(true);
		expect(slot.x - (TOPBAR.x + 49) >= v.gap).toBe(true);
		expect(slot.reserveLeft).toBe(slot.x + slot.size - TOPBAR.x);
		expect(slot.y).toBe(pauseButtonSlot(TOPBAR, false).y);
	});

	it("falls back to the screen's top left without a top bar, touch or not", () => {
		const v = PAUSE_BUTTON_VIEW;
		for (const touch of [false, true]) {
			const slot = pauseButtonSlot({ x: 0, y: 0, w: 0, h: 0 }, touch);
			expect(slot.x).toBe(v.fallbackMargin);
			expect(slot.y).toBe(v.fallbackMargin);
			expect(slot.reserveLeft).toBe(v.fallbackMargin + v.size);
		}
	});
});

describe("closing the Roblox menu", () => {
	it("keeps a run it paused paused, resumes a finished or frozen one", () => {
		expect(afterRobloxMenuClosed(true, true, false)).toBe("stayPaused");
		expect(afterRobloxMenuClosed(true, false, false)).toBe("resume");
		expect(afterRobloxMenuClosed(true, true, true)).toBe("resume");
	});

	it("leaves a run it did not pause alone", () => {
		expect(afterRobloxMenuClosed(false, true, false)).toBe("unchanged");
		expect(afterRobloxMenuClosed(false, false, false)).toBe("unchanged");
	});
});

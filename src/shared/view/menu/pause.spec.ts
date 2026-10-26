// The pause overlay / pause button visibility and the Roblox menu's close rule (pause.ts).
import { describe, expect, it } from "@rbxts/jest-globals";
import { afterRobloxMenuClosed, pauseButtonShown, pauseOverlayShown, type PauseView } from ".";

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

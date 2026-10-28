// Headless spec for the touch visibility rule (docs/MOBILE_IMPL.md MB6): touch only, in a live run only, hidden under
// every overlay (even while spectating); spectating shows the two spectate buttons.
import { describe, expect, it } from "@rbxts/jest-globals";
import { touchMode, type TouchModeInput } from "./mode";

const PLAYING: TouchModeInput = {
	device: "touch",
	gameActive: true,
	menuOpen: false,
	robloxMenuOpen: false,
	mapOpen: false,
	frozen: false,
	draftOpen: false,
	spectating: false,
};

describe("touchMode", () => {
	it("shows the play controls on a touch device in a live run", () => {
		expect(touchMode(PLAYING)).toBe("play");
	});

	it("shows the spectate controls while spectating", () => {
		expect(touchMode({ ...PLAYING, spectating: true })).toBe("spectate");
	});

	it("is hidden off touch and outside a live run", () => {
		expect(touchMode({ ...PLAYING, device: "keyboard" })).toBe("hidden");
		expect(touchMode({ ...PLAYING, device: "gamepad" })).toBe("hidden");
		expect(touchMode({ ...PLAYING, gameActive: false })).toBe("hidden");
	});

	const overlays: Array<[string, Partial<TouchModeInput>]> = [
		["a menu is open", { menuOpen: true }],
		["the Roblox menu is open", { robloxMenuOpen: true }],
		["the full map is open", { mapOpen: true }],
		["the finished tutorial run is frozen", { frozen: true }],
		["the boon draft is open", { draftOpen: true }],
	];
	for (const [name, over] of overlays) {
		it(`is hidden while ${name}, even when spectating`, () => {
			expect(touchMode({ ...PLAYING, spectating: true, ...over })).toBe("hidden");
		});
	}
});

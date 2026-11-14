// The menu shell's pointer sink under a panel (pointer.ts): a panel's non-Active dim let mouse / touch through to the
// main menu under an open Options screen.
import { describe, expect, it } from "@rbxts/jest-globals";
import { HUD_VIEW } from "shared/view/hud";
import { MENU_VIEW, menuPointerSinkShown, menuScreenTakesPointer, type MenuScreen } from ".";

// A Record so a new MenuScreen fails to compile until it is listed here (and so covered by the sink rule).
const SCREENS: Record<MenuScreen, true> = {
	none: true,
	main: true,
	lobbies: true,
	lobby: true,
	credits: true,
	codex: true,
	armory: true,
	character: true,
};

function menuScreens(): ReadonlyArray<MenuScreen> {
	const out: Array<MenuScreen> = [];
	for (const [screen] of pairs(SCREENS as unknown as Map<MenuScreen, true>)) if (screen !== "none") out.push(screen);
	return out;
}

/** The ZIndex a GuiObject keeps when it sets none: the shell's screen body and invite toasts. */
const DEFAULT_ZINDEX = 1;

describe("menu pointer sink", () => {
	it("covers every menu screen while a panel is open over it", () => {
		const screens = menuScreens();
		expect(screens.size()).toBe(7);
		for (const screen of screens) {
			expect(menuPointerSinkShown({ screen, panelOpen: true })).toBe(true);
			expect(menuScreenTakesPointer({ screen, panelOpen: true })).toBe(false);
		}
	});

	it("leaves a menu screen clickable with no panel open", () => {
		for (const screen of menuScreens()) {
			expect(menuPointerSinkShown({ screen, panelOpen: false })).toBe(false);
			expect(menuScreenTakesPointer({ screen, panelOpen: false })).toBe(true);
		}
	});

	it("never shows without a menu screen (a run: Options over the pause overlay is not the shell's)", () => {
		expect(menuPointerSinkShown({ screen: "none", panelOpen: true })).toBe(false);
		expect(menuPointerSinkShown({ screen: "none", panelOpen: false })).toBe(false);
		expect(menuScreenTakesPointer({ screen: "none", panelOpen: false })).toBe(false);
	});

	it("the main menu under Options: the reported case", () => {
		expect(menuScreenTakesPointer({ screen: "main", panelOpen: false })).toBe(true);
		expect(menuScreenTakesPointer({ screen: "main", panelOpen: true })).toBe(false);
	});

	it("sits under the panels' layers, so the panel itself stays clickable", () => {
		// The sink lives in the menu shell's ScreenGui; the panels' dims and the panels draw in higher ones.
		expect(MENU_VIEW.displayOrder).toBeLessThan(HUD_VIEW.menuDimDisplayOrder);
		expect(HUD_VIEW.menuDimDisplayOrder).toBeLessThan(HUD_VIEW.menuDisplayOrder);
		// ...and over the HUD and the backdrop under the shell.
		expect(MENU_VIEW.backdropDisplayOrder).toBeLessThan(MENU_VIEW.displayOrder);
		expect(HUD_VIEW.hudDisplayOrder).toBeLessThan(MENU_VIEW.displayOrder);
	});

	it("draws over the shell screen's children (Sibling ZIndex)", () => {
		expect(MENU_VIEW.pointerSinkZIndex).toBeGreaterThan(DEFAULT_ZINDEX);
	});
});

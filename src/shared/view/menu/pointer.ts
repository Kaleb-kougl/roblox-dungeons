/**
 * Whether the menu shell blocks pointer input (mouse / touch) to its screen. A panel (Options, the leaderboards) draws
 * in the pause / settings layer (shared/view/hud HUD_VIEW.menuDisplayOrder) over the menu shell
 * (MENU_VIEW.displayOrder), but its full-screen dim and root are non-Active Frames, which Roblox lets clicks and
 * hovers through: the main menu (or lobby room, ...) under an open Options screen stayed clickable. The pad and the
 * keyboard were already safe (the panel's focus scope outranks the screen's; MenuController ignores keys under a
 * panel). So while a panel is open over a menu screen, client/ui/menu MenuLayer mounts a pointer sink over the
 * screen (MENU_VIEW.pointerSinkZIndex). Pure, headlessly tested (pointer.spec.ts).
 */
import type { MenuScreen } from "./nav";

/** What the menu shell's pointer sink reads. */
export interface MenuPointerView {
	/** The menu shell's screen ("none": no menu screen, a run or the wait for one). */
	readonly screen: MenuScreen;
	/** A panel is open (Options or the leaderboards: client/store selectAnyPanelOpen). */
	readonly panelOpen: boolean;
}

/** The sink covers the menu screen: a panel is open over a menu screen. */
export function menuPointerSinkShown(v: MenuPointerView): boolean {
	return v.screen !== "none" && v.panelOpen;
}

/** The menu screen takes mouse / touch input: a menu screen is up and no panel covers it. */
export function menuScreenTakesPointer(v: MenuPointerView): boolean {
	return v.screen !== "none" && !menuPointerSinkShown(v);
}

/**
 * Which frame art each menu and overlay screen draws, and which icons sit beside which labels (docs/UI_ART.md UA7 /
 * UA8; decisions UAD2 / UAD8 / UAD9). Pure: client/ui reads these and passes them to the HUD primitives (Panel `skin`
 * / `ornament`, MenuButton `icon`), which draw art only when the pack has it (shared/view/hud skin.ts), so without the
 * art every screen is exactly today's flat look. Headlessly tested (skin.spec.ts).
 */
import { UI_ART, type PanelSkin } from "shared/view/hud";
import type { PauseItem } from "./lobby";
import { MENU_STRINGS } from "./strings";

/** Every screen / overlay panel the menus and the in-run overlays draw. */
export type UiScreen =
	| "mainMenu"
	| "lobbyBrowser"
	| "credits"
	| "character"
	| "lobbyRoom"
	| "lobbyInvites"
	| "inviteToast"
	| "inviteBadge"
	| "notices"
	| "options"
	| "optionsPrompt"
	| "pause"
	| "runOver"
	| "tutorialOutro"
	| "objectiveCard"
	| "leaderboard"
	| "toast"
	| "tutorialPrompt"
	| "spectate"
	| "info";

/** One screen's frame: its panel skin, the bone ornament on top (UAD8), dividers between its sections. */
export interface UiScreenSkin {
	readonly skin: PanelSkin;
	readonly ornament: boolean;
	readonly dividers: boolean;
}

const MENU: UiScreenSkin = { skin: "menu", ornament: false, dividers: false };
const HUD: UiScreenSkin = { skin: "hud", ornament: false, dividers: false };

/**
 * The menus are red-rimmed (`menu`), the pause overlay, Options, run over, the tutorial outro and objective card and
 * the leaderboards too although they show during a run (they are modal screens over a paused or ended run); small
 * notes over the play (toasts, notices, the invite badge, the tutorial prompt, the spectate bar, the info panel) are
 * the run's dark frame (`hud`: red keeps meaning danger, UAD2); the lobby room's invite list is the tall list frame.
 * Ornament on the main menu and pause panels only (UAD8); dividers in Options and the pause panel.
 */
export const UI_SCREEN_SKINS: Readonly<Record<UiScreen, UiScreenSkin>> = {
	mainMenu: { skin: "menu", ornament: true, dividers: false },
	lobbyBrowser: MENU,
	credits: MENU,
	character: MENU,
	lobbyRoom: MENU,
	lobbyInvites: { skin: "list", ornament: false, dividers: false },
	inviteToast: HUD,
	inviteBadge: HUD,
	notices: HUD,
	options: { skin: "menu", ornament: false, dividers: true },
	optionsPrompt: MENU,
	pause: { skin: "menu", ornament: true, dividers: true },
	runOver: MENU,
	tutorialOutro: MENU,
	objectiveCard: MENU,
	leaderboard: MENU,
	toast: HUD,
	tutorialPrompt: HUD,
	spectate: HUD,
	info: HUD,
};

/** The panel skin `screen` draws (Panel `skin`). */
export function screenSkin(screen: UiScreen): PanelSkin {
	return UI_SCREEN_SKINS[screen].skin;
}

/** Whether `screen`'s panel asks for the bone ornament (Panel `ornament`; drawn only on menu art). */
export function screenOrnament(screen: UiScreen): boolean {
	return UI_SCREEN_SKINS[screen].ornament;
}

/** Whether `screen` draws dividers between its sections (only on its art; nothing in the flat look). */
export function screenDividers(screen: UiScreen): boolean {
	return UI_SCREEN_SKINS[screen].dividers;
}

/** The icon beside a pause overlay item's label: Options -> gear, the items that go home (Leave run, Skip tutorial). */
export function pauseItemIcon(item: PauseItem): string | undefined {
	switch (item) {
		case "settings":
			return UI_ART.ids.iconGear;
		case "leave":
		case "skipTutorial":
			return UI_ART.ids.iconHome;
		default:
			return undefined;
	}
}

/**
 * The run-over header's icon: none for a victory, the RIP stone for a party's end (the party is down, or the server
 * ended it), the red-eyed skull for a solo death.
 */
export function runOverIcon(victory: boolean, coop: boolean): string | undefined {
	if (victory) return undefined;
	return coop ? UI_ART.ids.iconRip : UI_ART.ids.iconSkull;
}

/** The icon beside the run-over exit: home for "Main menu"; none for "Back to lobby" (it is not the main menu). */
export function runOverExitIcon(exitKey: string): string | undefined {
	return exitKey === MENU_STRINGS.mainMenu ? UI_ART.ids.iconHome : undefined;
}

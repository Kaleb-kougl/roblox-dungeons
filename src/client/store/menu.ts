import { createProducer } from "@rbxts/reflex";
import type { CharacterId } from "shared/characters";
import { NO_MENU, menuNavReduce, type CharacterScreenOrigin, type MenuNav, type MenuNavAction } from "shared/view/menu";

/**
 * The character screen while it is up (docs/ARCHER.md AR7): what opened it (shared/view/menu CharacterScreenOrigin:
 * what Confirm starts) and the focused card (the last pick when it opened; arrows, taps and the pad's selection move
 * it; Confirm takes it).
 */
export interface CharacterScreenState {
	readonly origin: CharacterScreenOrigin;
	readonly focus: CharacterId;
}

/**
 * Client-local Reflex slice for the menu shell (task L3) and the pause overlay's Leave run (task L6): the current
 * menu screen with its back stack (the pure reducer is shared/view/menu `menuNavReduce`), whether the Leave run
 * confirm is showing, whether the co-op (non-pausing) overlay is open, whether the join still waits for the
 * first-run gate, whether the Roblox menu is open, and the character screen's origin and focused card (docs/ARCHER.md
 * AR7). MenuController dispatches; the views read.
 */
export interface MenuState {
	readonly nav: MenuNav;
	/** The pause / party overlay shows the "Leaving ends your run..." confirm instead of its buttons. */
	readonly leaveConfirm: boolean;
	/** Co-op runs never pause: the pause key opens this overlay (Resume closes it, Leave run) over the running run. */
	readonly coopOverlay: boolean;
	/**
	 * The join waits for the first-run gate (TutorialController: a first-time player goes straight into the
	 * tutorial): no menu yet, only the menu shell's backdrop. MenuController clears it once the gate decided.
	 */
	readonly awaitingFirstRun: boolean;
	/**
	 * The Roblox menu (Escape / Start) is open (SimController: GuiService.MenuOpened / MenuClosed). The pause overlay
	 * and the pause button hide under it (shared/view/menu pause.ts).
	 */
	readonly robloxMenuOpen: boolean;
	/** The character screen's origin and focused card; undefined while it is not up (MenuController sets it). */
	readonly character: CharacterScreenState | undefined;
}

const initialState: MenuState = {
	nav: NO_MENU,
	leaveConfirm: false,
	coopOverlay: false,
	awaitingFirstRun: true,
	robloxMenuOpen: false,
	character: undefined,
};

/**
 * The menu shell's slice (state: `MenuState`). MenuController dispatches the navigation actions (reduced by
 * shared/view/menu `menuNavReduce`), the Leave run confirm, the co-op overlay, the first-run gate and the character
 * screen; SimController reports the Roblox menu. It starts with no menu and `awaitingFirstRun` true.
 */
export const menuSlice = createProducer(initialState, {
	menuNav: (state, action: MenuNavAction) => {
		const nav = menuNavReduce(state.nav, action);
		return nav === state.nav ? state : { ...state, nav };
	},
	setLeaveConfirm: (state, leaveConfirm: boolean) =>
		state.leaveConfirm === leaveConfirm ? state : { ...state, leaveConfirm },
	setAwaitingFirstRun: (state, awaitingFirstRun: boolean) =>
		state.awaitingFirstRun === awaitingFirstRun ? state : { ...state, awaitingFirstRun },
	setRobloxMenuOpen: (state, robloxMenuOpen: boolean) =>
		state.robloxMenuOpen === robloxMenuOpen ? state : { ...state, robloxMenuOpen },
	setCharacterScreen: (state, character: CharacterScreenState | undefined) =>
		state.character === character ? state : { ...state, character },
	setCharacterFocus: (state, focus: CharacterId) =>
		state.character === undefined || state.character.focus === focus
			? state
			: { ...state, character: { ...state.character, focus } },
	/** Closing the party overlay also drops its Leave run confirm. */
	setCoopOverlay: (state, coopOverlay: boolean) => {
		const leaveConfirm = coopOverlay && state.leaveConfirm;
		return state.coopOverlay === coopOverlay && state.leaveConfirm === leaveConfirm
			? state
			: { ...state, coopOverlay, leaveConfirm };
	},
});

/**
 * The menu's current screen with its back stack (the screens under it, root first; empty at the root and with no menu).
 */
export const selectMenuNav = (state: { menu: MenuState }) => state.menu.nav;
/**
 * The menu screen showing: "none" during play and before the first-run gate decided, else "main", "lobbies", "lobby",
 * "credits", "codex", "armory" or "character". HUD overlays read it to step aside while a menu is up.
 */
export const selectMenuScreen = (state: { menu: MenuState }) => state.menu.nav.screen;
/**
 * The pause or party overlay shows its "Leaving ends your run..." confirm instead of its buttons. False by default, and
 * dropped whenever the party overlay closes.
 */
export const selectLeaveConfirm = (state: { menu: MenuState }) => state.menu.leaveConfirm;
/**
 * The co-op party overlay is open: a co-op run never pauses, so the pause key opens this over the running run instead.
 * False in solo runs and while it is closed.
 */
export const selectCoopOverlay = (state: { menu: MenuState }) => state.menu.coopOverlay;
/**
 * The join still waits for the first-run gate (a first-time player goes straight into the tutorial): true from join,
 * false once MenuController saw the gate decide. While true the menu layer shows only its backdrop.
 */
export const selectAwaitingFirstRun = (state: { menu: MenuState }) => state.menu.awaitingFirstRun;
/**
 * The character screen's state while it is up: what opened it (which decides what Confirm starts) and the focused card.
 * Undefined while the screen is not showing.
 */
export const selectCharacterScreen = (state: { menu: MenuState }) => state.menu.character;
/**
 * The Roblox menu (Escape / Start) is open. The pause overlay and the pause button hide under it, and menu focus leaves
 * it alone.
 */
export const selectRobloxMenuOpen = (state: { menu: MenuState }) => state.menu.robloxMenuOpen;

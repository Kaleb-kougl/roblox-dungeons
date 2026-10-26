import { createProducer } from "@rbxts/reflex";
import { NO_MENU, menuNavReduce, type MenuNav, type MenuNavAction } from "shared/view/menu";

/**
 * Client-local Reflex slice for the menu shell (task L3) and the pause overlay's Leave run (task L6): the current
 * menu screen with its back stack (the pure reducer is shared/view/menu `menuNavReduce`), whether the Leave run
 * confirm is showing, whether the co-op (non-pausing) overlay is open, whether the join still waits for the
 * first-run gate, and whether the Roblox menu is open. MenuController dispatches; the views read.
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
}

const initialState: MenuState = {
	nav: NO_MENU,
	leaveConfirm: false,
	coopOverlay: false,
	awaitingFirstRun: true,
	robloxMenuOpen: false,
};

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
	/** Closing the party overlay also drops its Leave run confirm. */
	setCoopOverlay: (state, coopOverlay: boolean) => {
		const leaveConfirm = coopOverlay && state.leaveConfirm;
		return state.coopOverlay === coopOverlay && state.leaveConfirm === leaveConfirm
			? state
			: { ...state, coopOverlay, leaveConfirm };
	},
});

export const selectMenuNav = (state: { menu: MenuState }) => state.menu.nav;
export const selectMenuScreen = (state: { menu: MenuState }) => state.menu.nav.screen;
export const selectLeaveConfirm = (state: { menu: MenuState }) => state.menu.leaveConfirm;
export const selectCoopOverlay = (state: { menu: MenuState }) => state.menu.coopOverlay;
export const selectAwaitingFirstRun = (state: { menu: MenuState }) => state.menu.awaitingFirstRun;
export const selectRobloxMenuOpen = (state: { menu: MenuState }) => state.menu.robloxMenuOpen;

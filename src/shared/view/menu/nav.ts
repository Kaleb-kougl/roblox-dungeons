/**
 * The menu shell's screen + back stack (task L3), as a pure reducer: the client's Reflex `menu` slice wraps it and
 * MenuController dispatches into it. "none" is no menu (a run, or the wait for one).
 *
 *   open     go to `screen`, pushing the current one (from "none": a fresh root). Opening a screen already on the
 *            stack pops back to it, so the stack never loops (lobby -> lobbies -> lobby is just "back").
 *   back     pop one screen; at the root (or with no menu) nothing changes
 *   replace  swap the current screen, keeping the stack (kicked from the lobby room -> the browser)
 *   reset    a whole path, root first (["main", "lobbies", "lobby"]: the lobby room with back -> browser -> main)
 *   close    no menu
 */
export type MenuScreen = "none" | "main" | "lobbies" | "lobby";

export interface MenuNav {
	readonly screen: MenuScreen;
	/** Screens under the current one, root first. Empty at the root and with no menu. */
	readonly stack: ReadonlyArray<MenuScreen>;
}

export type MenuNavAction =
	| { readonly kind: "open"; readonly screen: MenuScreen }
	| { readonly kind: "back" }
	| { readonly kind: "replace"; readonly screen: MenuScreen }
	| { readonly kind: "reset"; readonly path: ReadonlyArray<MenuScreen> }
	| { readonly kind: "close" };

export const NO_MENU: MenuNav = { screen: "none", stack: [] };

/** The path to the lobby room (back goes to the browser, then the main menu). */
export const LOBBY_ROOM_PATH: ReadonlyArray<MenuScreen> = ["main", "lobbies", "lobby"];
export const MAIN_MENU_PATH: ReadonlyArray<MenuScreen> = ["main"];

function fromPath(path: ReadonlyArray<MenuScreen>): MenuNav {
	const stack: MenuScreen[] = [];
	let screen: MenuScreen = "none";
	for (const s of path) {
		if (s === "none") continue;
		if (screen !== "none") stack.push(screen);
		screen = s;
	}
	return screen === "none" ? NO_MENU : { screen, stack };
}

export function menuNavReduce(nav: MenuNav, action: MenuNavAction): MenuNav {
	switch (action.kind) {
		case "open": {
			if (action.screen === "none") return NO_MENU;
			if (action.screen === nav.screen) return nav;
			if (nav.screen === "none") return { screen: action.screen, stack: [] };
			const at = nav.stack.indexOf(action.screen);
			if (at >= 0) {
				const stack: MenuScreen[] = [];
				for (let i = 0; i < at; i++) stack.push(nav.stack[i]);
				return { screen: action.screen, stack };
			}
			return { screen: action.screen, stack: [...nav.stack, nav.screen] };
		}
		case "back": {
			const n = nav.stack.size();
			if (n === 0) return nav;
			const stack: MenuScreen[] = [];
			for (let i = 0; i < n - 1; i++) stack.push(nav.stack[i]);
			return { screen: nav.stack[n - 1], stack };
		}
		case "replace":
			if (action.screen === "none") return NO_MENU;
			return action.screen === nav.screen ? nav : { screen: action.screen, stack: nav.stack };
		case "reset":
			return fromPath(action.path);
		case "close":
			return NO_MENU;
	}
}

/** Back (pad B / Backspace) does something on this screen. */
export function canGoBack(nav: MenuNav): boolean {
	return nav.screen !== "none" && nav.stack.size() > 0;
}

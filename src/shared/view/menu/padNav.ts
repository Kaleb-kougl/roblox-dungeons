/**
 * Gamepad menus (docs/GAMEPAD_MENUS.md section 3, GM4): the pure half of the menu pad input path. InputController
 * reports MENU_PAD_INPUT_KEYS and the right stick (PadStickRepeat) while a menu owns the pad; FocusController turns
 * them into menuPadAction actions for the owning scope; the scopes step their tabs with stepTab.
 *
 * Tabs clamp at their ends (no wrap): LB on the first tab and RB on the last do nothing and make no sound, so a held
 * bumper never cycles past where the player meant to stop.
 *
 * @module
 */
import { PAD_KEYS, type MenuPadAction } from "./padActions";

/**
 * The pad buttons InputController reports to the menus (onMenuPadInput) while a menu owns the pad: the bumpers, the
 * triggers, X and Y (Enum.KeyCode names). A and B are not here (A presses the selected button in the engine; B goes
 * through FocusController's own InputBegan), and neither is Start (the pause toggle keeps its own path).
 */
export const MENU_PAD_INPUT_KEYS: ReadonlyArray<string> = [
	PAD_KEYS.lb,
	PAD_KEYS.rb,
	PAD_KEYS.lt,
	PAD_KEYS.rt,
	PAD_KEYS.x,
	PAD_KEYS.y,
];

/**
 * One menu pad input (InputController.onMenuPadInput): a MENU_PAD_INPUT_KEYS press (axes 0), or a right-stick scroll
 * step (`keyName` PAD_KEYS.rightStick, the stick's axes: x right, y up, each -1..1).
 */
export interface MenuPadInput {
	readonly keyName: string;
	readonly x: number;
	readonly y: number;
}

/** `keyName` is one of MENU_PAD_INPUT_KEYS. */
export function isMenuPadInputKey(keyName: string): boolean {
	return MENU_PAD_INPUT_KEYS.includes(keyName);
}

/**
 * The tab `dir` steps from `current` (-1 previous, +1 next), clamped: undefined at either end, for a zero step, or
 * with no tabs. A `current` that is not a tab steps to the first tab.
 */
export function stepTab<T extends defined>(tabs: ReadonlyArray<T>, current: T, dir: number): T | undefined {
	if (tabs.size() === 0 || dir === 0) return undefined;
	const i = tabs.indexOf(current);
	if (i < 0) return tabs[0];
	const j = i + (dir < 0 ? -1 : 1);
	if (j < 0 || j >= tabs.size()) return undefined;
	return tabs[j];
}

/** A tab action's step: tabPrev -1, tabNext +1, anything else 0. */
export function tabStep(action: MenuPadAction): number {
	if (action.kind === "tabPrev") return -1;
	if (action.kind === "tabNext") return 1;
	return 0;
}

/** A sub-tab action's step: subTabPrev -1, subTabNext +1, anything else 0. */
export function subTabStep(action: MenuPadAction): number {
	if (action.kind === "subTabPrev") return -1;
	if (action.kind === "subTabNext") return 1;
	return 0;
}

/**
 * The right stick's scroll repeat (GAMEPAD_MENU stickDeadZone / scrollRepeatSec): a step fires on the frame the stick
 * leaves the dead zone, then every `repeatSec` while it stays out; back inside the dead zone it rearms.
 */
export class PadStickRepeat {
	private out = false;
	private sinceSec = 0;

	/** One frame: the stick's axes, the frame's seconds. True: a scroll step fires this frame. */
	step(x: number, y: number, dtSec: number, deadZone: number, repeatSec: number): boolean {
		if (x * x + y * y <= deadZone * deadZone) {
			this.reset();
			return false;
		}
		if (!this.out) {
			this.out = true;
			this.sinceSec = 0;
			return true;
		}
		this.sinceSec += math.max(0, dtSec);
		if (this.sinceSec < repeatSec) return false;
		this.sinceSec -= repeatSec;
		// A long frame never fires a burst: at most one step per frame, the rest of the wait dropped.
		if (this.sinceSec >= repeatSec) this.sinceSec = 0;
		return true;
	}

	/** Back to rest (the menu closed, a capture began): the next push past the dead zone fires at once. */
	reset(): void {
		this.out = false;
		this.sinceSec = 0;
	}
}

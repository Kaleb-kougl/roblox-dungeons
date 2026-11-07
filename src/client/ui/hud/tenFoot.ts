import { GuiService } from "@rbxts/services";

let cached: boolean | undefined;

/**
 * Whether this client is a ten-foot interface (a console on a TV; docs/GAMEPAD_MENUS.md GM12): GuiService's answer,
 * read once (it does not change during a session) behind pcall (false when the call fails). MenuFit's TV-safe inset
 * and the console chat rule (FocusController) read it.
 */
export function isTenFootInterface(): boolean {
	if (cached === undefined) {
		const [ok, tenFoot] = pcall(() => GuiService.IsTenFootInterface());
		cached = ok && tenFoot === true;
	}
	return cached;
}

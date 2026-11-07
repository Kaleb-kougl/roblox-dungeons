/**
 * Roblox port (docs/GAMEPAD_MENUS.md GM7 / GM9): the gamepad menus' strings. Pure data with no runtime import.
 * contract.ts writes the list out inside REQUIRED_STRING_KEYS (an import would be one more top-level local in
 * contract.luau, which sits near Luau's 200-locals-per-function limit); padHints.spec.ts checks they stay the same.
 */

/**
 * The hint bar's labels (`pad.hint.*`, shared/view/menu PAD_HINT_STRINGS repeats them), all REQUIRED: A Select; B
 * Back / Close / Resume / Cancel, or Hold: Exit on the run-over panel; LB / RB Tabs, LT / RT Sub-tabs; the right
 * stick Scroll; the X / Y shortcuts Details, Refresh, Create, Ready, Invite (the Roblox prompt), Invites (jump to the
 * invite toasts), Reset (this Options tab, asks first). Each sits beside a button glyph: keep them short.
 */
export const PAD_HINT_STRING_KEYS: ReadonlyArray<string> = [
	"pad.hint.select",
	"pad.hint.back",
	"pad.hint.close",
	"pad.hint.resume",
	"pad.hint.cancel",
	"pad.hint.tabs",
	"pad.hint.subTabs",
	"pad.hint.scroll",
	"pad.hint.holdExit",
	"pad.hint.details",
	"pad.hint.refresh",
	"pad.hint.create",
	"pad.hint.ready",
	"pad.hint.invite",
	"pad.hint.invites",
	"pad.hint.reset",
];

/** Options > Controls > Gamepad: the menu vibration row (GM9, DisplaySettings.padVibration; On / Off labels shared). */
export const PAD_VIBRATION_STRING_KEY = "options.controls.vibration";

/** Every gamepad menu string, in REQUIRED_STRING_KEYS' order: the hint labels, then the vibration row. */
export const GAMEPAD_MENU_STRING_KEYS: ReadonlyArray<string> = [...PAD_HINT_STRING_KEYS, PAD_VIBRATION_STRING_KEY];

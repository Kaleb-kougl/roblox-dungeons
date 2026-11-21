/**
 * Roblox port (docs/LOCALIZATION.md L1): the input label strings. Pure data with no runtime import, so contract.ts takes
 * its string list (INPUT_KEY_STRING_KEYS) for REQUIRED_STRING_KEYS with one import: its compiled Luau sits near Luau's
 * 200-locals-per-function limit.
 *
 * The contract lists named above:
 * {@link shared/theme/contract/strings!REQUIRED_STRING_KEYS | REQUIRED_STRING_KEYS}.
 *
 * @module
 */

/**
 * Every input label string, all REQUIRED: `input.key.<name>` for each named key whose label is a word (shared/play
 * INPUT_KEY_STRING_NAMES, same order; English: its INPUT_LABELS text or the name), then `input.separator` (" / ",
 * between key names in a list: the tutorial's move keys). The theme imports nothing outside shared/theme, so the list
 * is repeated here.
 */
export const INPUT_KEY_STRING_KEYS: ReadonlyArray<string> = [
	"input.key.MouseButton1",
	"input.key.MouseButton2",
	"input.key.MouseButton3",
	"input.key.Space",
	"input.key.Return",
	"input.key.Backspace",
	"input.key.Tab",
	"input.key.CapsLock",
	"input.key.LeftShift",
	"input.key.RightShift",
	"input.key.LeftControl",
	"input.key.RightControl",
	"input.key.LeftAlt",
	"input.key.RightAlt",
	"input.key.Up",
	"input.key.Down",
	"input.key.Left",
	"input.key.Right",
	"input.key.Insert",
	"input.key.Delete",
	"input.key.Home",
	"input.key.End",
	"input.key.PageUp",
	"input.key.PageDown",
	"input.key.Escape",
	"input.key.KeypadZero",
	"input.key.KeypadOne",
	"input.key.KeypadTwo",
	"input.key.KeypadThree",
	"input.key.KeypadFour",
	"input.key.KeypadFive",
	"input.key.KeypadSix",
	"input.key.KeypadSeven",
	"input.key.KeypadEight",
	"input.key.KeypadNine",
	"input.key.KeypadPeriod",
	"input.key.KeypadDivide",
	"input.key.KeypadMultiply",
	"input.key.KeypadMinus",
	"input.key.KeypadPlus",
	"input.key.KeypadEnter",
	"input.key.DPadUp",
	"input.key.DPadDown",
	"input.key.DPadLeft",
	"input.key.DPadRight",
	"input.key.ButtonStart",
	"input.key.ButtonSelect",
	"input.key.Thumbstick1",
	"input.key.Thumbstick2",
	"input.key.StickLeft",
	"input.key.StickRight",
	"input.separator",
];

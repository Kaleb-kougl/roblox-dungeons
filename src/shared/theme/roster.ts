/**
 * Roblox port (docs/DAILY.md DS2, section 9): the seeded roster's theme keys. Pure data with no runtime import, so
 * contract.ts takes its string list (ROSTER_STRING_KEYS) for REQUIRED_STRING_KEYS with one import: its compiled Luau sits
 * near Luau's 200-locals-per-function limit.
 *
 * The contract lists named above:
 * {@link shared/theme/contract/strings!REQUIRED_STRING_KEYS | REQUIRED_STRING_KEYS}.
 *
 * @module
 */

/**
 * Every roster string (shared/view/hud ROSTER_STRINGS, same order), all REQUIRED: the stage card's run-start line
 * (`roster.line`, "{names}": every kind of floor 1's roster), the line of a floor where kinds join (`roster.new`,
 * "New: {names}") and the separator between two names (`roster.separator`, " · "; docs/LOCALIZATION.md L1).
 * `{names}` is the kinds' `enemy.<id>.name` strings joined by the view. The theme imports nothing outside
 * shared/theme, so the list is repeated here.
 */
export const ROSTER_STRING_KEYS: ReadonlyArray<string> = ["roster.line", "roster.new", "roster.separator"];

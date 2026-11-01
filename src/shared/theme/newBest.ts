/**
 * Roblox port (docs/NEW_BEST.md NB4): the new-best celebration's theme keys. Pure data with no runtime import, so
 * contract.ts takes its string list (NEW_BEST_STRING_KEYS) for REQUIRED_STRING_KEYS with one import: its compiled Luau
 * sits near Luau's 200-locals-per-function limit. The colour rules and their report (`newBestReport`) are in
 * newBestColors.ts, which validate.ts imports one name from (`newBestColorProblems`) for the same reason; the two sounds
 * are in contract.ts PORT_AUDIO_EVENTS (`sfx.best.new`, `sfx.jingle.record`) and the role in types.ts COLOR_ROLES.
 */

/**
 * Every new-best string (shared/view/hud NEW_BEST_STRINGS, same order), all REQUIRED: the score panel's target row
 * (`hud.best.toGo` "{points} TO BEST", compact `hud.best.toGoShort` "-{points}", `hud.best.new` "NEW BEST",
 * `hud.best.over` "NEW BEST +{points}"), the floor shout (`hud.best.shout`), the stairwell card's second line
 * (`stage.best.toGo` with `{floor}` / `{n}` floors to go, `stage.best.recordFloor`,
 * `stage.best.newDeepest`, `stage.best.deeperYet`), the run-over panel (`run.best.ribbon`, `run.best.first`, the record
 * rows `run.best.score` / `run.best.floor` with `{old}` / `{new}` / `{delta}`, the save chip `run.best.saved` /
 * `run.best.unsaved`, the dim target `run.best.target` with `{score}` / `{floor}`, also the pause overlay's) and the main
 * menu's `menu.best` (`{score}` / `{floor}`). The theme imports nothing outside shared/theme, so the list is repeated
 * here.
 */
export const NEW_BEST_STRING_KEYS: ReadonlyArray<string> = [
	"hud.best.toGo",
	"hud.best.toGoShort",
	"hud.best.new",
	"hud.best.over",
	"hud.best.shout",
	"stage.best.toGo",
	"stage.best.recordFloor",
	"stage.best.newDeepest",
	"stage.best.deeperYet",
	"run.best.ribbon",
	"run.best.first",
	"run.best.score",
	"run.best.floor",
	"run.best.saved",
	"run.best.unsaved",
	"run.best.target",
	"menu.best",
];

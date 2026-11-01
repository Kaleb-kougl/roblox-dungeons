/**
 * The new-best celebration's strings (docs/NEW_BEST.md NB4): the score panel's target row (`{points}`: the gap or the
 * margin, formatted by the caller), the floor shout, the stairwell card's second line (`{floor}`: the record floor,
 * `{n}`: floors to go), the run-over panel's ribbon, record rows (`{old}` / `{new}` / `{delta}`), save chip and the
 * dim target line (`{score}`, `{floor}`), and the main menu's best line. All REQUIRED (theme contract
 * NEW_BEST_STRING_KEYS, same order), so no slot ever shows a raw key.
 */
export const NEW_BEST_STRINGS = {
	toGo: "hud.best.toGo",
	toGoShort: "hud.best.toGoShort",
	newBest: "hud.best.new",
	over: "hud.best.over",
	shout: "hud.best.shout",
	stageToGo: "stage.best.toGo",
	stageRecordFloor: "stage.best.recordFloor",
	stageNewDeepest: "stage.best.newDeepest",
	stageDeeperYet: "stage.best.deeperYet",
	ribbon: "run.best.ribbon",
	first: "run.best.first",
	scoreRow: "run.best.score",
	floorRow: "run.best.floor",
	saved: "run.best.saved",
	unsaved: "run.best.unsaved",
	target: "run.best.target",
	menu: "menu.best",
} as const;

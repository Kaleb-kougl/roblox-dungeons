import { createProducer } from "@rbxts/reflex";
import type { NewBestLineText } from "shared/view/hud";

/**
 * Client-local Reflex slice for the stage loader's cover (docs/STAGE_LOADER.md SL5): whether it is up, what it says,
 * the run-start bar. StageController dispatches (on the cut, on a label / bar change, at the reveal and at the end,
 * never per frame). What is drawn when is NOT this slice: the ScreenGui's Enabled, the fade and whether the label rows
 * show are React bindings StageController sets synchronously (this slice reaches React only after the frame's render,
 * on Reflex's Heartbeat flush). StageCard (client/ui/loading) reads the text from here, and selectMenuOpen treats a
 * cover, its fade included, as a menu owning the input (no blind draft confirm, no pause, co-op sends neutral input,
 * no gamepad selection under it).
 */
export interface StageCoverState {
	/** A cover is up: opaque, or fading out during the reveal. */
	readonly shown: boolean;
	/** The reveal started: the cover fades out (the input stays blocked until it is gone: hideStage). */
	readonly revealing: boolean;
	/** One per stage load: the cover's commit report names it, so a stale report never counts for a newer load. */
	readonly serial: number;
	/** The floor-change card (title, biome line, boss line; no bar) instead of the run-start label and bar. */
	readonly card: boolean;
	/** The label's theme string key (shared/view STAGE_STRINGS) and its `{floor}`. */
	readonly labelKey: string;
	readonly floor: number;
	/** The card's biome line: the floor's `biome.<n>.name` key ("" for none). */
	readonly biomeKey: string;
	/** The card's "Boss floor" line. */
	readonly boss: boolean;
	/**
	 * The cover's second line (shared/view/hud stageCardLine, docs/DAILY.md DSD13): on the floor card new best's line
	 * (docs/NEW_BEST.md NB8: `Deepest: floor 9 · 2 to go`, `NEW DEEPEST` in gold, ...) or the seeded roster's (`New:
	 * Imp`), whichever wins; under a run start's bar floor 1's roster (`Swarmer · Bruiser`, set once the run is built:
	 * setStageLine). Undefined: none.
	 */
	readonly line: NewBestLineText | undefined;
	/** The run-start bar in [0, 1] (StageLoad.fraction). */
	readonly fraction: number;
}

/** What StageController shows at the cut. */
export interface StageCoverView {
	readonly serial: number;
	readonly card: boolean;
	readonly labelKey: string;
	readonly floor: number;
	readonly biomeKey: string;
	readonly boss: boolean;
	readonly line: NewBestLineText | undefined;
	readonly fraction: number;
}

const initialState: StageCoverState = {
	shown: false,
	revealing: false,
	serial: 0,
	card: false,
	labelKey: "",
	floor: 0,
	biomeKey: "",
	boss: false,
	line: undefined,
	fraction: 0,
};

export const stageSlice = createProducer(initialState, {
	showStage: (_state, v: StageCoverView) => ({ ...v, shown: true, revealing: false }),
	/** The label or bar changed (only on a change: the run start's steps). */
	setStageProgress: (state, labelKey: string, floor: number, fraction: number) =>
		state.labelKey === labelKey && state.floor === floor && state.fraction === fraction
			? state
			: { ...state, labelKey, floor, fraction },
	/** The second line became known after the cut (a run start's roster, once the run is built). */
	setStageLine: (state, line: NewBestLineText | undefined) => (state.shown ? { ...state, line } : state),
	setStageRevealing: (state) => (state.revealing || !state.shown ? state : { ...state, revealing: true }),
	hideStage: (state) => (state.shown ? { ...state, shown: false, revealing: false } : state),
});

export const selectStageCover = (state: { stage: StageCoverState }) => state.stage;
/** A cover is up (its fade included): it owns the input. */
export const selectStageCovered = (state: { stage: StageCoverState }) => state.stage.shown;

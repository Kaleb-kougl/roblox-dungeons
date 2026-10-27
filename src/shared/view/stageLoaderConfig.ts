/**
 * Tunables of the stage loader (docs/STAGE_LOADER.md: the cover while a floor generates and loads at run start and at
 * every floor change; logic in stageLoader.ts, the driver in the client's StageController, the cover in client/ui/loading
 * StageCard). Presentation only: nothing here reaches the sim, the lockstep wire or a hash. Roblox-port choices, no web
 * source.
 */

/** One step of a stage load, for the run-start bar's weights (StageLoad.fraction). */
export type StageStep = "server" | "forge" | "build" | "pregen" | "assets" | "settle";

export interface StageLoaderConfig {
	/** The floor-change card shows at least this long, seconds from the cut (SD3; solo and co-op). */
	readonly minCardSec: number;
	/** A run start's cover shows at least this long, seconds after the server answered (SD3: none, lift when ready). */
	readonly minStartSec: number;
	/** Wait at most this long for the floor's front-lane assets (its music / ambience, a boss floor's sheets), seconds (SD4). */
	readonly assetCapSec: number;
	/**
	 * Hard cap on any cover, seconds (SD5 edge cases), counted from the server's answer on a ranked run start (a slow
	 * server never trips it early) and from the cut otherwise: past it every wait is skipped and the cover lifts once
	 * the work that must run (forge, view rebuild) has run.
	 */
	readonly maxCoverSec: number;
	/** Rendered frames under the cover after the views were rebuilt (textures drawn once, the camera snapped). */
	readonly settleFrames: number;
	/** The reveal's fade-out, seconds (a cut under reduced motion). */
	readonly fadeSec: number;
	/**
	 * Frames (StageLoad.frame calls) after the cover was reported on screen (StageLoad.coverShown) before covered work
	 * runs. The cover is shown through React bindings set synchronously (no Reflex flush, which lands after the render),
	 * and the report means "drawn by the coming render", so one frame puts at least one drawn cover before the stall.
	 */
	readonly coverDrawFrames: number;
	/** If the cover never reports its commit (no UI mounted), covered work runs anyway after this long, seconds. */
	readonly coverAckCapSec: number;
	/** Pre-generation during a floor's draft starts once the draft has been open this many rendered frames (SD1). */
	readonly pregenAfterDraftFrames: number;
	/** The run-start bar: each step's share of the bar (sum 1); a step that does not apply counts as done. */
	readonly weights: Readonly<Record<StageStep, number>>;
}

export const STAGE_LOADER: StageLoaderConfig = {
	minCardSec: 0.6,
	minStartSec: 0,
	assetCapSec: 3,
	maxCoverSec: 8,
	settleFrames: 2,
	fadeSec: 0.25,
	coverDrawFrames: 1,
	coverAckCapSec: 0.5,
	pregenAfterDraftFrames: 1,
	weights: { server: 0.1, forge: 0.4, build: 0.25, pregen: 0.1, assets: 0.1, settle: 0.05 },
};

/**
 * The stage cover (client/ui/loading StageCard), in the HUD's 1280x720 reference pixels under the same UIScale, on the
 * join loading screen's ScreenGui order (LOADING_VIEW.displayOrder: the two never overlap, a run only starts after the
 * join screen released). Colours are theme roles: the opaque `background`, the label in `uiAccent`, the card's biome and
 * boss lines in `uiText` / `uiTextDim`, the bar's `uiTextDim` track and `uiAccent` fill (as the join screen).
 */
export const STAGE_VIEW = {
	/** Width of the centre column. */
	width: 420,
	/** The run-start bar's height (slimmer than the join screen's). */
	barHeight: 4,
	/** Vertical gap between the column's rows. */
	gap: 10,
} as const;

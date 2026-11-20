/**
 * Tunables of the stage loader (docs/STAGE_LOADER.md: the cover while a floor generates and loads at run start and at
 * every floor change; logic in stageLoader.ts, the driver in the client's StageController, the cover in client/ui/loading
 * StageCard). Presentation only: nothing here reaches the sim, the lockstep wire or a hash. Roblox-port choices, no web
 * source.
 *
 * @module
 */
import { STAGE_ASSETS, type StageAssetWaitConfig } from "./stageAssetsConfig";

/** One step of a stage load, for the run-start bar's weights (StageLoad.fraction). */
export type StageStep = "server" | "forge" | "build" | "pregen" | "assets" | "settle";

/**
 * The shape of `STAGE_LOADER`: the cover's minimum and maximum times (seconds of real time), its frame counts (rendered
 * frames), the asset wait and the run-start bar's weights. StageLoad takes one (specs pass their own).
 */
export interface StageLoaderConfig {
	/** The floor-change card shows at least this long, seconds from the cut (SD3; solo and co-op). */
	readonly minCardSec: number;
	/** A run start's cover shows at least this long, seconds after the server answered (SD3: none, lift when ready). */
	readonly minStartSec: number;
	/**
	 * A run start whose cover shows floor 1's roster line (docs/DAILY.md DS2: "Swarmer · Bruiser") shows at least this
	 * long, seconds after the server answered, so the line can be read (StageLoad.holdAtLeast; the floor change's card
	 * already has minCardSec).
	 */
	readonly rosterStartSec: number;
	/**
	 * A solo run start's wait for its stage manifest (docs/STAGE_ASSETS.md SA5 / SA19: the soft wait; STAGE_ASSETS.wait).
	 * Floor changes and co-op covers never wait for assets (SAD4 / SAD8). Replaces STAGE_LOADER.md's `assetCapSec`.
	 */
	readonly assets: StageAssetWaitConfig;
	/**
	 * Hard cap on any cover, seconds (SD5 edge cases), counted from the server's answer on a ranked run start (a slow
	 * server never trips it early) and from the cut otherwise, NOT counting the assets phase (docs/STAGE_ASSETS.md SA5:
	 * it bounds forge, build and settle; the asset wait has its own caps): past it every wait is skipped and the cover
	 * lifts once the work that must run (forge, view rebuild) has run.
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
	/** The reveal's `[Stage]` line names at most this many of the floor's missing logical ids (the rest counted). */
	readonly logMissingIds: number;
	/** The run-start bar: each step's share of the bar (sum 1); a step that does not apply counts as done. */
	readonly weights: Readonly<Record<StageStep, number>>;
}

/**
 * The stage loader in play: a floor-change card shows at least 0.6 s, a run start lifts as soon as it is ready (1 s at
 * least when it shows the roster line), no cover outlasts 8 s plus its asset wait, the views get 2 frames under the
 * cover and the reveal fades over 0.25 s. Raising a minimum makes every load feel slower; lowering `settleFrames` risks
 * showing a floor before its textures have drawn.
 */
export const STAGE_LOADER: StageLoaderConfig = {
	minCardSec: 0.6,
	minStartSec: 0,
	rosterStartSec: 1,
	assets: STAGE_ASSETS.wait,
	maxCoverSec: 8,
	settleFrames: 2,
	fadeSec: 0.25,
	coverDrawFrames: 1,
	coverAckCapSec: 0.5,
	pregenAfterDraftFrames: 1,
	logMissingIds: 5,
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

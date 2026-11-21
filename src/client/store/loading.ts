import { createProducer } from "@rbxts/reflex";

/**
 * Client-local Reflex slice for the join loading screen (docs/PRELOAD.md P4): whether it released, and the core
 * tier's progress for the bar and the count. PreloadController dispatches (once per Heartbeat while the screen is up,
 * only on a change); LoadingScreen (client/ui/loading) reads it, and HudController hands the gamepad to the GUI while
 * it is up (its Skip button).
 */
export interface LoadingState {
	/** The screen released (core done, Skip, the timeout or KV_SkipLoading): it fades out and unmounts. */
	readonly released: boolean;
	/** Core entries resolved / total, in [0, 1] (1 when there is nothing to load). */
	readonly fraction: number;
	/** Core entries resolved (ok or failed). */
	readonly done: number;
	/** Core entries in all. */
	readonly total: number;
	/** The Skip button shows (shared/view skipVisible). */
	readonly skipVisible: boolean;
}

/** The progress fields PreloadController pushes. */
export interface LoadingProgress {
	readonly fraction: number;
	readonly done: number;
	readonly total: number;
	readonly skipVisible: boolean;
}

const initialState: LoadingState = {
	released: false,
	fraction: 0,
	done: 0,
	total: 0,
	skipVisible: false,
};

/**
 * The join loading screen's slice (state: `LoadingState`). PreloadController pushes the core tier's progress (only on a
 * change) and releases the screen once; released never goes back to false.
 */
export const loadingSlice = createProducer(initialState, {
	setLoadingProgress: (state, p: LoadingProgress) =>
		state.fraction === p.fraction &&
		state.done === p.done &&
		state.total === p.total &&
		state.skipVisible === p.skipVisible
			? state
			: { ...state, fraction: p.fraction, done: p.done, total: p.total, skipVisible: p.skipVisible },
	setLoadingReleased: (state) => (state.released ? state : { ...state, released: true }),
});

/**
 * The join loading screen's whole state: released or not, the core tier's fraction and resolved / total counts, and
 * whether Skip shows. LoadingScreen draws from it.
 */
export const selectLoading = (state: { loading: LoadingState }) => state.loading;
/**
 * The join loading screen was released (core tier done, Skip, the timeout or KV_SkipLoading): it fades out and
 * unmounts. False from join until then, true for the rest of the session.
 */
export const selectLoadingReleased = (state: { loading: LoadingState }) => state.loading.released;
/**
 * The share of the core tier's entries resolved so far, in [0, 1] (0 before the first progress push; 1 when there is
 * nothing to load). The loading bar's fill.
 */
export const selectLoadingFraction = (state: { loading: LoadingState }) => state.loading.fraction;
/**
 * The loading screen's Skip button shows (false at first; PreloadController turns it on by shared/view `skipVisible`).
 */
export const selectLoadingSkipVisible = (state: { loading: LoadingState }) => state.loading.skipVisible;

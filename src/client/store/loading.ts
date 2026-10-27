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

export const selectLoading = (state: { loading: LoadingState }) => state.loading;
export const selectLoadingReleased = (state: { loading: LoadingState }) => state.loading.released;
export const selectLoadingFraction = (state: { loading: LoadingState }) => state.loading.fraction;
export const selectLoadingSkipVisible = (state: { loading: LoadingState }) => state.loading.skipVisible;

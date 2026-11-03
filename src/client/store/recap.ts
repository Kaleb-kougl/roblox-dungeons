import { createProducer } from "@rbxts/reflex";
import type { RecapHighlight, RecapNearMiss } from "shared/view/hud";

/**
 * Client-local Reflex slice for the run-over recap (docs/RUN_RECAP.md RR5 / RR6): what the run-over panel's recap
 * blocks draw, set by RecapController when the panel opens and again when a verdict changes the numbers (never per
 * frame: the counted values, fades and texts are RECAP_UI bindings, client/ui/hud recapUi.ts). `run` is the RunInfo.run
 * the recap belongs to (the panel draws nothing for another run's). `details`: the Details toggle shows the score
 * breakdown and the Build list in the highlights' place (RRD5); closed on every new recap. `armed`: confirm / FIRE now
 * retry (RRD6; Again's focus brightens).
 */
export interface RecapState {
	readonly run: number;
	/** The near-miss line (undefined: none; a record run's is `dim`). */
	readonly nearMiss: RecapNearMiss | undefined;
	/** The highlight cells, in order (empty: none, e.g. an unscored run). */
	readonly highlights: ReadonlyArray<RecapHighlight>;
	readonly details: boolean;
	readonly armed: boolean;
}

const NONE: ReadonlyArray<RecapHighlight> = [];

const initialState: RecapState = { run: 0, nearMiss: undefined, highlights: NONE, details: false, armed: false };

export const recapSlice = createProducer(initialState, {
	/** A new recap (the panel opened): Details closed, not armed yet. */
	showRecap: (
		_state,
		run: number,
		nearMiss: RecapNearMiss | undefined,
		highlights: ReadonlyArray<RecapHighlight>,
		armed: boolean,
	) => ({ run, nearMiss, highlights, details: false, armed }),
	/** The verdict changed the numbers: the same recap re-derived (Details and the arm as they were). */
	updateRecap: (state, nearMiss: RecapNearMiss | undefined, highlights: ReadonlyArray<RecapHighlight>) => ({
		...state,
		nearMiss,
		highlights,
	}),
	setRecapArmed: (state, armed: boolean) => (state.armed === armed ? state : { ...state, armed }),
	toggleRecapDetails: (state) => ({ ...state, details: !state.details }),
	clearRecap: (state) => (state.run === 0 ? state : initialState),
});

export const selectRecap = (state: { recap: RecapState }) => state.recap;

import { createProducer, createSelector } from "@rbxts/reflex";
import {
	EMPTY_TUTORIAL_HUD,
	tutorialDeviceFor,
	tutorialHudEqual,
	tutorialPromptKey,
	type TutorialHighlight,
	type TutorialHudState,
	type TutorialMarkerKind,
} from "shared/tutorial";
import type { InputDeviceKind } from "shared/play";

/**
 * Client-local Reflex slice for the first-run tutorial (docs/TUTORIAL.md §4): fed by the TutorialController from the
 * TutorialDirector's view (a copy, pushed only when its revision moved and the copy changed), plus the outro card, the
 * pause overlay's skip confirm and the ghost half heart's pulse token. The director and the sim never live here.
 */
export interface TutorialState {
	/** A tutorial run is the current run (from its start until another run starts; the outro included). */
	readonly active: boolean;
	readonly stepIndex: number;
	readonly stepCount: number;
	readonly stepsDone: number;
	/** The prompt id ("" none); selectTutorialPromptKey resolves it for the last-used device. */
	readonly prompt: string;
	/** The objective card is up (Continue = FIRE). */
	readonly card: "objective" | undefined;
	/** The HUD element to ring. */
	readonly highlight: TutorialHighlight | undefined;
	/** What the world marker points at (undefined: none). */
	readonly markerKind: TutorialMarkerKind | undefined;
	/** The tutorial finished: the run is frozen, the panel and the draft are hidden, the outro follows. */
	readonly ended: boolean;
	/** The outro card is up (a menu: gamepad selection on). */
	readonly outroOpen: boolean;
	/** The pause overlay asks "Skip the tutorial?". */
	readonly skipConfirmOpen: boolean;
	/** Grows by one per ghost half-heart flash (StatusPanel remounts the flash on change); 0 = none yet. */
	readonly ghostHeart: number;
}

const initialState: TutorialState = {
	active: false,
	stepIndex: EMPTY_TUTORIAL_HUD.stepIndex,
	stepCount: EMPTY_TUTORIAL_HUD.stepCount,
	stepsDone: EMPTY_TUTORIAL_HUD.stepsDone,
	prompt: EMPTY_TUTORIAL_HUD.prompt,
	card: EMPTY_TUTORIAL_HUD.card,
	highlight: EMPTY_TUTORIAL_HUD.highlight,
	markerKind: EMPTY_TUTORIAL_HUD.markerKind,
	ended: false,
	outroOpen: false,
	skipConfirmOpen: false,
	ghostHeart: 0,
};

function hudOf(state: TutorialState): TutorialHudState {
	return {
		stepIndex: state.stepIndex,
		stepCount: state.stepCount,
		stepsDone: state.stepsDone,
		prompt: state.prompt,
		card: state.card,
		highlight: state.highlight,
		markerKind: state.markerKind,
		finished: state.ended,
	};
}

export const tutorialSlice = createProducer(initialState, {
	/** A tutorial run started (first join, Restart tutorial, a replay): everything fresh, the first step's HUD. */
	beginTutorial: (_state, hud: TutorialHudState) => ({
		...initialState,
		active: true,
		stepIndex: hud.stepIndex,
		stepCount: hud.stepCount,
		stepsDone: hud.stepsDone,
		prompt: hud.prompt,
		card: hud.card,
		highlight: hud.highlight,
		markerKind: hud.markerKind,
	}),
	/** The director's view changed (no new state when the copy is the same). */
	setTutorialHud: (state, hud: TutorialHudState) =>
		!state.active || tutorialHudEqual(hudOf(state), { ...hud, finished: state.ended })
			? state
			: {
					...state,
					stepIndex: hud.stepIndex,
					stepCount: hud.stepCount,
					stepsDone: hud.stepsDone,
					prompt: hud.prompt,
					card: hud.card,
					highlight: hud.highlight,
					markerKind: hud.markerKind,
			  },
	/** The tutorial finished: prompt, card, highlight and marker go; the outro follows. */
	endTutorial: (state) =>
		state.ended
			? state
			: {
					...state,
					ended: true,
					prompt: "",
					card: undefined,
					highlight: undefined,
					markerKind: undefined,
					skipConfirmOpen: false,
			  },
	setTutorialOutroOpen: (state, outroOpen: boolean) =>
		state.outroOpen === outroOpen ? state : { ...state, outroOpen },
	setTutorialSkipConfirm: (state, skipConfirmOpen: boolean) =>
		state.skipConfirmOpen === skipConfirmOpen ? state : { ...state, skipConfirmOpen },
	pulseGhostHeart: (state) => ({ ...state, ghostHeart: state.ghostHeart + 1 }),
	/** Another kind of run started (ranked, unranked, co-op): no tutorial on screen. */
	clearTutorial: (state) => (state === initialState ? state : initialState),
});

export const selectTutorial = (state: { tutorial: TutorialState }) => state.tutorial;
export const selectTutorialActive = (state: { tutorial: TutorialState }) => state.tutorial.active;
export const selectTutorialHighlight = (state: { tutorial: TutorialState }) => state.tutorial.highlight;
export const selectTutorialEnded = (state: { tutorial: TutorialState }) => state.tutorial.ended;
export const selectTutorialOutroOpen = (state: { tutorial: TutorialState }) => state.tutorial.outroOpen;
export const selectTutorialSkipConfirm = (state: { tutorial: TutorialState }) => state.tutorial.skipConfirmOpen;
export const selectGhostHeart = (state: { tutorial: TutorialState }) => state.tutorial.ghostHeart;

/** What selectTutorialPromptKey reads: this slice and the game slice's last-used device. */
interface PromptKeyState {
	readonly tutorial: TutorialState;
	readonly game: { readonly inputDevice: InputDeviceKind };
}

/** The current prompt's theme key for the HUD's last-used device ("" when no prompt shows). */
export const selectTutorialPromptKey = createSelector(
	[(state: PromptKeyState) => state.tutorial.prompt, (state: PromptKeyState) => state.game.inputDevice] as const,
	(prompt, device) => (prompt === "" ? "" : tutorialPromptKey(prompt, tutorialDeviceFor(device))),
);

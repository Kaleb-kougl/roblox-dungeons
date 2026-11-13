import { createProducer } from "@rbxts/reflex";
import type { BindingDevice, BindingRef, BindingRefusal, Bindings, CaptureTarget, GameAction } from "shared/play";
import type { OptionsControlsDevice, OptionsTab } from "shared/view/hud";

/**
 * Client-local Reflex slice for the Options screen's own state (task L4 / L4b client): the open tab, the Controls
 * sub-tab, and the rebinding flow (RebindController drives it): the capture overlay with its countdown, the swap
 * prompt, the refusal note, the reset confirmation, and the input test strip. Whether the screen is open is
 * `settings.panelOpen` (unchanged, so every existing open / close path keeps working).
 */
export interface CaptureState extends CaptureTarget {
	/** Whole seconds left (shared/play captureSecondsLeft). */
	readonly secondsLeft: number;
}

/** "X is already used by Y. [Swap] [Cancel]": Swap applies `bindings`. */
export interface ConflictState {
	readonly target: CaptureTarget;
	readonly input: string;
	readonly holder: BindingRef;
	readonly bindings: Bindings;
}

/** Why the last captured input was not bound (shown under the list until the next capture or tab change). */
export interface RebindNotice {
	readonly reason: BindingRefusal;
	readonly input: string;
	readonly action: GameAction;
}

export interface OptionsState {
	readonly tab: OptionsTab;
	/** The Controls sub-tab (Touch: the phone's Vibration row, docs/HAPTICS.md HP5). */
	readonly controlsDevice: OptionsControlsDevice;
	readonly capture: CaptureState | undefined;
	readonly conflict: ConflictState | undefined;
	readonly notice: RebindNotice | undefined;
	/** The device whose "Reset" asks for confirmation. */
	readonly confirmReset: BindingDevice | undefined;
	/**
	 * Input belongs to the capture: from its start until the frame after it ends. Gameplay, the menu keys (O, the pad's
	 * B close, the leaderboard key) and driver keys (restart) ignore input meanwhile.
	 */
	readonly inputCaptured: boolean;
	/** The test strip: the actions whose inputs are held on `controlsDevice`. */
	readonly pressed: ReadonlyArray<GameAction>;
}

const initialState: OptionsState = {
	tab: "juice",
	controlsDevice: "kbm",
	capture: undefined,
	conflict: undefined,
	notice: undefined,
	confirmReset: undefined,
	inputCaptured: false,
	pressed: [],
};

function samePressed(a: ReadonlyArray<GameAction>, b: ReadonlyArray<GameAction>): boolean {
	if (a.size() !== b.size()) return false;
	for (let i = 0; i < a.size(); i++) if (a[i] !== b[i]) return false;
	return true;
}

export const optionsSlice = createProducer(initialState, {
	setOptionsTab: (state, tab: OptionsTab) =>
		state.tab === tab ? state : { ...state, tab, notice: undefined, confirmReset: undefined, pressed: [] },
	setControlsDevice: (state, controlsDevice: OptionsControlsDevice) =>
		state.controlsDevice === controlsDevice
			? state
			: { ...state, controlsDevice, notice: undefined, confirmReset: undefined, pressed: [] },
	setCapture: (state, capture: CaptureState | undefined) => ({ ...state, capture }),
	setCaptureSeconds: (state, secondsLeft: number) =>
		state.capture === undefined || state.capture.secondsLeft === secondsLeft
			? state
			: { ...state, capture: { ...state.capture, secondsLeft } },
	setConflict: (state, conflict: ConflictState | undefined) => ({ ...state, conflict }),
	setRebindNotice: (state, notice: RebindNotice | undefined) => ({ ...state, notice }),
	setConfirmReset: (state, confirmReset: BindingDevice | undefined) => ({ ...state, confirmReset }),
	setInputCaptured: (state, inputCaptured: boolean) =>
		state.inputCaptured === inputCaptured ? state : { ...state, inputCaptured },
	setPressed: (state, pressed: ReadonlyArray<GameAction>) =>
		samePressed(state.pressed, pressed) ? state : { ...state, pressed },
	/** The screen closed: drop every transient prompt (the tab is remembered for the session). */
	clearRebindUi: (state) => ({
		...state,
		capture: undefined,
		conflict: undefined,
		notice: undefined,
		confirmReset: undefined,
		pressed: [],
	}),
});

export const selectOptions = (state: { options: OptionsState }) => state.options;
export const selectInputCaptured = (state: { options: OptionsState }) => state.options.inputCaptured;
/** A prompt over the Options screen is up (capture, swap prompt, reset confirmation): the rows are not selectable. */
export const selectOptionsModal = (state: { options: OptionsState }) =>
	state.options.capture !== undefined ||
	state.options.conflict !== undefined ||
	state.options.confirmReset !== undefined;

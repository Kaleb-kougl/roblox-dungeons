/**
 * The client's tutorial flow as pure logic (docs/TUTORIAL.md "Architecture §4", docs/CLIENT.md "The tutorial run"; a
 * Roblox-port feature, no web source): the first-run gate (does the join start the tutorial or the normal flow?), the
 * TutorialView -> HUD state mapping the Reflex slice stores, and the beat between the tutorial's end and its outro
 * card. The TutorialController wraps these with remotes, Workspace attributes and the render step; everything here is
 * headlessly tested (flow.spec.ts).
 */
import { TUTORIAL } from "shared/config";
import type { OnboardingStatus } from "shared/onboarding";
import type { TutorialView } from "./director";
import type { TutorialDevice, TutorialHighlight, TutorialMarkerKind } from "./steps";

// ---------------------------------------------------------------------------------------------
// The first-run gate

/**
 * What the join starts: the tutorial, the normal flow (the main menu, or KV_SkipMenu's solo run), or nothing yet
 * (still waiting for the server).
 */
export type FirstRunChoice = "tutorial" | "normal" | "wait";

/** A decided first-run choice. */
export type FirstRunDecision = Exclude<FirstRunChoice, "wait">;

export interface FirstRunInputs {
	/** Workspace KV_Tutorial: true forces the tutorial, false skips it, undefined lets the server decide. */
	readonly forced: boolean | undefined;
	/** The server's `onboardingStatus`, once it arrived. */
	readonly status: Readonly<OnboardingStatus> | undefined;
	/** Real seconds the client has waited for it. */
	readonly waitedSeconds: number;
	/** Default TUTORIAL.statusTimeoutSeconds. */
	readonly timeoutSeconds?: number;
}

/**
 * The first-run rule: KV_Tutorial wins when set; otherwise the tutorial only when the server LOADED the player's
 * onboarding doc and it says not done. A failed load (`loaded: false`) or no answer within the timeout plays the
 * normal flow (the main menu's Tutorial still replays it).
 */
export function firstRunChoice(inputs: FirstRunInputs): FirstRunChoice {
	if (inputs.forced === true) return "tutorial";
	if (inputs.forced === false) return "normal";
	const status = inputs.status;
	if (status !== undefined) return status.loaded && !status.tutorialDone ? "tutorial" : "normal";
	const timeout = inputs.timeoutSeconds ?? TUTORIAL.statusTimeoutSeconds;
	return inputs.waitedSeconds >= timeout ? "normal" : "wait";
}

/** KV_Tutorial's raw attribute value as the gate reads it: a boolean, else undefined (unset or the wrong type). */
export function tutorialAttribute(raw: unknown): boolean | undefined {
	return typeIs(raw, "boolean") ? raw : undefined;
}

/**
 * The gate over time: `receive` the server's status whenever it arrives, `poll` once per frame with the frame's real
 * delta. The first answer other than "wait" is latched: later polls return it again and `decided()` reports it.
 */
export class FirstRunGate {
	private waited = 0;
	private status: OnboardingStatus | undefined;
	private choice: FirstRunDecision | undefined;

	constructor(private readonly timeoutSeconds: number = TUTORIAL.statusTimeoutSeconds) {}

	receive(status: Readonly<OnboardingStatus>): void {
		this.status = { loaded: status.loaded, tutorialDone: status.tutorialDone };
	}

	poll(dt: number, forced: boolean | undefined): FirstRunChoice {
		if (this.choice !== undefined) return this.choice;
		if (dt > 0) this.waited += dt;
		const c = firstRunChoice({
			forced,
			status: this.status,
			waitedSeconds: this.waited,
			timeoutSeconds: this.timeoutSeconds,
		});
		if (c !== "wait") this.choice = c;
		return c;
	}

	decided(): FirstRunDecision | undefined {
		return this.choice;
	}

	/** Seconds waited so far (frozen once decided). */
	waitedSeconds(): number {
		return this.waited;
	}
}

// ---------------------------------------------------------------------------------------------
// TutorialView -> HUD state (what the Reflex `tutorial` slice keeps)

/** The parts of a TutorialView the HUD draws (a copy: the view itself is reused every frame). */
export interface TutorialHudState {
	/** The current step, 0-based (stepCount once finished). */
	readonly stepIndex: number;
	readonly stepCount: number;
	/** Steps done (the panel's progress "{step} / {count}"). */
	readonly stepsDone: number;
	/** The prompt id ("" none); the panel resolves its key per device with tutorialPromptKey. */
	readonly prompt: string;
	readonly card: "objective" | undefined;
	readonly highlight: TutorialHighlight | undefined;
	/** What the world marker points at (undefined: no marker). Its position is the marker controller's, per frame. */
	readonly markerKind: TutorialMarkerKind | undefined;
	/** The director reported the floor lastFloor -> lastFloor + 1 change. */
	readonly finished: boolean;
}

export const EMPTY_TUTORIAL_HUD: TutorialHudState = table.freeze({
	stepIndex: 0,
	stepCount: 0,
	stepsDone: 0,
	prompt: "",
	card: undefined,
	highlight: undefined,
	markerKind: undefined,
	finished: false,
});

/** A copy of what the HUD shows of `view`. */
export function tutorialHudFrom(view: Readonly<TutorialView>): TutorialHudState {
	return {
		stepIndex: view.stepIndex,
		stepCount: view.stepCount,
		stepsDone: view.stepsDone,
		prompt: view.prompt,
		card: view.card,
		highlight: view.highlight,
		markerKind: view.marker?.kind,
		finished: view.finished,
	};
}

export function tutorialHudEqual(a: Readonly<TutorialHudState>, b: Readonly<TutorialHudState>): boolean {
	return (
		a.stepIndex === b.stepIndex &&
		a.stepCount === b.stepCount &&
		a.stepsDone === b.stepsDone &&
		a.prompt === b.prompt &&
		a.card === b.card &&
		a.highlight === b.highlight &&
		a.markerKind === b.markerKind &&
		a.finished === b.finished
	);
}

/** The prompt variant for the HUD's last-used device (shared/play InputDeviceKind; touch has no controls yet). */
export function tutorialDeviceFor(device: "keyboard" | "gamepad"): TutorialDevice {
	return device === "gamepad" ? "gamepad" : "keyboard";
}

/** The panel's progress numbers: steps done (capped at the count) over the step count. */
export function tutorialProgress(hud: Readonly<TutorialHudState>): { step: number; count: number } {
	return { step: math.min(hud.stepsDone, hud.stepCount), count: hud.stepCount };
}

// ---------------------------------------------------------------------------------------------
// The outro beat

/**
 * Real time from the tutorial's end (the run frozen) to its outro card: `update(dt)` returns true exactly once, on the
 * first frame the total reaches `delaySeconds` (TUTORIAL.outroDelaySeconds); `due()` stays true from then on.
 */
export class TutorialOutroBeat {
	private elapsed = 0;
	private fired = false;

	constructor(private readonly delaySeconds: number = TUTORIAL.outroDelaySeconds) {}

	update(dt: number): boolean {
		if (this.fired) return false;
		if (dt > 0) this.elapsed += dt;
		if (this.elapsed < this.delaySeconds) return false;
		this.fired = true;
		return true;
	}

	due(): boolean {
		return this.fired;
	}
}

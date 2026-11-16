/**
 * The tutorial's highlight ring on touch (docs/TUTORIAL.md "Highlight ring"): each prompt whose touch text names an
 * on-screen control rings that control while the prompt shows. Pure: TouchControlsController draws the buttons' and
 * the move stick's rings from TouchRingTracker's frame; PauseButton rings itself with pauseButtonRinged.
 */
import type { TouchButtonId } from "./touchLayout";
import { highlightRingLook, type RingLook } from "./tutorial";

/** What the tutorial can ring on touch: a button, the move stick's idle ring, or the top bar's pause button. */
export type TouchTutorialRing = TouchButtonId | "move" | "pause";

/**
 * The control each tutorial prompt's touch text names (placeholder pack `tutorial.prompt.<id>.touch`): the tutorial
 * rings it while that prompt shows. A prompt naming no control (follow, hits, boost, pellets, relic, stairwell, boss,
 * finish) or a whole screen (draft: "tap a card") is absent.
 */
export const TOUCH_TUTORIAL_RINGS: Readonly<Record<string, TouchTutorialRing>> = {
	objective: "attack",
	move: "move",
	flask: "flask",
	attack: "attack",
	roll: "roll",
	guard: "alt",
	guardHold: "alt",
	ember: "ember",
	map: "pause",
	curse: "shrine",
};

/** The touch control the tutorial rings for prompt id `prompt` ("" none), or undefined: none (TOUCH_TUTORIAL_RINGS). */
export function touchTutorialRing(prompt: string): TouchTutorialRing | undefined {
	return prompt !== "" ? TOUCH_TUTORIAL_RINGS[prompt] : undefined;
}

/** The top bar's pause button wears the ring: the prompt names it and the player is on touch. */
export function pauseButtonRinged(prompt: string, touch: boolean): boolean {
	return touch && touchTutorialRing(prompt) === "pause";
}

/** One frame of the ring: the control it goes round and how it looks. */
export interface TouchRingFrame {
	readonly target: TouchTutorialRing;
	readonly look: RingLook;
}

/**
 * The ring's clock: the pulse starts when the ringed control changes (a new prompt naming another control, or a ring
 * after none) and runs on while successive prompts name the same control (guard -> guardHold keeps Alt's pulse).
 * `now` is any clock in seconds (the client passes os.clock()).
 */
export class TouchRingTracker {
	private target: TouchTutorialRing | undefined;
	private start = 0;

	/** The ring for prompt `prompt` at `now` under the juice motionScale `motion`, or undefined: no ring. */
	frame(prompt: string, now: number, motion: number): TouchRingFrame | undefined {
		const target = touchTutorialRing(prompt);
		if (target !== this.target) {
			this.target = target;
			this.start = now;
		}
		if (target === undefined) return undefined;
		return { target, look: highlightRingLook(now - this.start, motion) };
	}
}

/** The ring's look on `control` this frame, or undefined: `control` is not ringed. */
export function touchRingLookFor(frame: TouchRingFrame | undefined, control: TouchTutorialRing): RingLook | undefined {
	return frame !== undefined && frame.target === control ? frame.look : undefined;
}

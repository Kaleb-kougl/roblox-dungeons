/**
 * Gamepad menus (docs/GAMEPAD_MENUS.md section 5, GM5): the pure half of the right stick's list scroll and of the
 * list end's haptic tick. FocusController moves a scope's main list (its `scrollRef`) by padScrollStep per
 * PadStickRepeat step, and ticks MENU_HAPTICS.listEnd once each time a push reaches an end (ScrollEndLatch).
 * Canvas units throughout (the list's CanvasPosition); scrollToShow (focus.ts) is the follow-the-selection half.
 */

/** Which end of a list a scroll position sits at (undefined: neither, or the list does not scroll). */
export type ScrollEnd = "start" | "end";

/** One right-stick scroll step's result. */
export interface PadScrollResult {
	/** The new canvas Y (clamped to 0..maxY). */
	readonly y: number;
	/** It differs from the old canvas Y. */
	readonly moved: boolean;
	/** The end the push went toward and now sits at (the push is into that end), else undefined. */
	readonly pushedEnd: ScrollEnd | undefined;
}

/** The furthest a list scrolls: its canvas height less its window height, never below 0. */
export function scrollMaxY(canvasHeight: number, viewHeight: number): number {
	return math.max(0, canvasHeight - viewHeight);
}

/**
 * One scroll step: the stick's `stickY` (up positive, -1..1; only its sign counts) moves the canvas `stepPx` toward
 * the list's start (up) or end (down), clamped to 0..maxY. A zero stick moves nothing and pushes no end.
 */
export function padScrollStep(canvasY: number, maxY: number, stickY: number, stepPx: number): PadScrollResult {
	const max = math.max(0, maxY);
	const from = math.clamp(canvasY, 0, max);
	if (stickY === 0) return { y: from, moved: false, pushedEnd: undefined };
	const toward: ScrollEnd = stickY > 0 ? "start" : "end";
	const y = math.clamp(toward === "start" ? from - stepPx : from + stepPx, 0, max);
	const atEnd = toward === "start" ? y <= 0 : y >= max;
	return { y, moved: y !== canvasY, pushedEnd: atEnd ? toward : undefined };
}

/**
 * The list end's haptic tick, once per arrival: a push that reaches (or keeps pressing into) an end ticks the first
 * time only; the latch for that end rearms once a step leaves it (a push the other way, or a step that moved without
 * reaching it). One latch per list scope (FocusController resets it when the owner changes).
 */
export class ScrollEndLatch {
	private atStart = false;
	private atEnd = false;

	/** One scroll step's result: true when it arrives at an end (tick now). */
	step(result: PadScrollResult): boolean {
		const pushed = result.pushedEnd;
		if (pushed !== "start") this.atStart = false;
		if (pushed !== "end") this.atEnd = false;
		if (pushed === "start") {
			if (this.atStart) return false;
			this.atStart = true;
			return true;
		}
		if (pushed === "end") {
			if (this.atEnd) return false;
			this.atEnd = true;
			return true;
		}
		return false;
	}

	/** Forget both ends (a new list, the owner changed). */
	reset(): void {
		this.atStart = false;
		this.atEnd = false;
	}
}

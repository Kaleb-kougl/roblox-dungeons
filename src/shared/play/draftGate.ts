/**
 * The boon draft reveal's confirm gate (docs/DRAFT_REVEAL.md DR2, DRD2 / DRD6): the client, not the sim, holds back the
 * draft's confirm button while its own reveal plays, so the sim simply sees the press later (no sim, hash or replay
 * change). Call `apply` on every sampled input frame (after the stage cover's gate), with `revealing` =
 * `draftConfirmHeld` (below: the reveal is active and not settled, or the open draft's reveal has not begun yet):
 *   - while revealing, DRAFT_CONFIRM_BUTTON is masked; a press EDGE of it is a skip (`apply` returns true, and
 *     `consumeSkip` reports it once to whoever drives the reveal);
 *   - a confirm still held when the reveal settles stays masked until it is released (a held or mashed attack never
 *     picks a card the player has not seen), like CoopMenuInputGate's held buttons;
 *   - every other button, the move stick and the aim pass untouched; once released, a fresh press passes on its first
 *     frame (a sim press edge).
 *
 * @module
 */
import { TUTORIAL } from "shared/config";
import { DRAFT_CONFIRM_BUTTON, type InputFrame } from "shared/sim";

/** What `draftConfirmHeld` judges, read each input frame (the client's DraftRevealController). */
export interface DraftConfirmFacts {
	/** The local player's draft is open now (the sim's `draftOpen`, read fresh from the run state). */
	readonly draftOpen: boolean;
	/** A reveal was begun for THIS open draft (same floor), whether or not it has settled since. */
	readonly revealBegun: boolean;
	/** The reveal is playing: active and not settled (DraftReveal frame `active && !settled`). */
	readonly revealing: boolean;
	/** This draft is never revealed (`draftNeverRevealed`: the tutorial's end), so nothing waits for its reveal. */
	readonly neverRevealed: boolean;
}

/**
 * The draft's confirm is held back this input frame (DraftRevealGate's `revealing`; docs/DRAFT_REVEAL.md DRD2): while
 * the reveal plays, and while the local draft is open but its reveal has not begun yet (the frames between the stage
 * cover's end and the reveal's begin: under reduced motion the cover ends at the start of the render step, the reveal
 * begins in the FX step after it, and a press edge in between would confirm a card nobody has seen). It cannot stall:
 * it is false once the reveal has begun and settled, once the draft is closed, and for a draft that is never revealed.
 * The caller passes false while the run is paused (the reveal is frozen then, and so is the sim).
 */
export function draftConfirmHeld(f: DraftConfirmFacts): boolean {
	if (f.revealing) return true;
	return f.draftOpen && !f.revealBegun && !f.neverRevealed;
}

/**
 * A draft that is never revealed (its overlay is never shown): once the tutorial ended, and in a tutorial run on a
 * floor past TUTORIAL.lastFloor (the finished tutorial's floor 3 draft opens on the floor change, a frame before the
 * tutorial marks itself ended).
 */
export function draftNeverRevealed(tutorialRun: boolean, floor: number, tutorialEnded: boolean): boolean {
	return tutorialEnded || (tutorialRun && floor > TUTORIAL.lastFloor);
}

/**
 * A mouse click on a draft card belongs to the card (the overlay's button picks it through the tap path, on Activated),
 * so while the local draft is open, the polled mouse buttons whose press began over a GUI (`guiPressed`, by input
 * name) are dropped from `mouse` in place: the press never reaches the sim as the confirm, which would take the card
 * under the stick before the click's column push. A click on the world (not over a GUI) and every press while the
 * draft is closed pass untouched.
 */
export function dropDraftGuiMouse(mouse: Set<string>, guiPressed: ReadonlySet<string>, draftOpen: boolean): void {
	if (!draftOpen) return;
	for (const name of guiPressed) mouse.delete(name);
}

export class DraftRevealGate {
	/** The confirm was down on the last frame (press edges are judged on the raw input). */
	private wasDown = false;
	/** The confirm is held through the reveal: masked until released. */
	private held = false;
	private pendingSkip = false;

	/** Changes `frame` in place; true when this frame's press is a skip of the reveal. */
	apply(frame: InputFrame, revealing: boolean): boolean {
		const down = bit32.btest(frame.buttons, DRAFT_CONFIRM_BUTTON);
		const edge = down && !this.wasDown;
		this.wasDown = down;
		let skip = false;
		if (revealing) {
			if (edge) {
				skip = true;
				this.pendingSkip = true;
			}
			if (down) this.held = true;
		}
		if (this.held && !down) this.held = false;
		if (this.held) frame.buttons = bit32.band(frame.buttons, bit32.bnot(DRAFT_CONFIRM_BUTTON));
		return skip;
	}

	/** True once per skip press since the last call (the reveal controller calls `skip()` on it). */
	consumeSkip(): boolean {
		const s = this.pendingSkip;
		this.pendingSkip = false;
		return s;
	}

	/** Forget everything (a new run, leave run). */
	reset(): void {
		this.wasDown = false;
		this.held = false;
		this.pendingSkip = false;
	}
}

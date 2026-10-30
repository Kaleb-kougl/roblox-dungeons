/**
 * The boon draft reveal's confirm gate (docs/DRAFT_REVEAL.md DR2, DRD2 / DRD6): the client, not the sim, holds back the
 * draft's confirm button while its own reveal plays, so the sim simply sees the press later (no sim, hash or replay
 * change). Call `apply` on every sampled input frame (after the stage cover's gate), with `revealing` = the reveal is
 * active and not settled (shared/view/hud DraftReveal frame: `active && !settled`):
 *   - while revealing, DRAFT_CONFIRM_BUTTON is masked; a press EDGE of it is a skip (`apply` returns true, and
 *     `consumeSkip` reports it once to whoever drives the reveal);
 *   - a confirm still held when the reveal settles stays masked until it is released (a held or mashed attack never
 *     picks a card the player has not seen), like CoopMenuInputGate's held buttons;
 *   - every other button, the move stick and the aim pass untouched; once released, a fresh press passes on its first
 *     frame (a sim press edge).
 */
import { DRAFT_CONFIRM_BUTTON, type InputFrame } from "shared/sim";

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

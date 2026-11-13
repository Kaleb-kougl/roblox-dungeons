/**
 * The draft card's NEW tag (claude/codex-plan.md "In-run NEW", CX8, decision R14): a card whose Codex entry is not yet
 * found (CodexController.showsNewTag at the deal: never in the tutorial, never before the doc loaded) wears a small
 * `hud.codex.tag` pill in its top corner (uiAccent), drawn only once that card's flip has settled (its raw `textAlpha`
 * reached 1: shared/view/hud DraftReveal), so the reveal's beats and timings are untouched. From then on it follows
 * the card's drawn text alpha (the deal, the pick's exit fade) and pops in like the NEW! chip (codexChipScale); under
 * Reduced motion it simply appears. Pure: DraftRevealController keeps one, DraftOverlay draws it (draftUi `newTagT` /
 * `newTagScale`).
 */
import { DRAFT_OFFER_COUNT } from "shared/sim";
import { codexChipScale } from "./toasts";

/** The tag's look (reference px). */
export const DRAFT_NEW_TAG = {
	/** From the card body's top-right corner. */
	inset: 8,
	padX: 4,
	padY: 1,
	textSize: 14,
} as const;

/** One card's tag this frame. */
export interface DraftTagLook {
	/** Opacity 0..1 (0: hidden). */
	alpha: number;
	scale: number;
}

const NOT_YET = -1;

/** The tags of one deal (by offer index). */
export class DraftNewTags {
	private readonly armed: boolean[] = [];
	/** The reveal's elapsed time when each card's flip settled, or NOT_YET. */
	private readonly settledAt: number[] = [];
	private readonly out: DraftTagLook = { alpha: 0, scale: 1 };

	constructor() {
		this.clear();
	}

	/** A deal (or a re-deal): which cards wear the tag (by offer index; missing = no tag). */
	begin(flags: ReadonlyArray<boolean>): void {
		for (let i = 0; i < DRAFT_OFFER_COUNT; i++) {
			this.armed[i] = flags[i] === true;
			this.settledAt[i] = NOT_YET;
		}
	}

	/** No deal: no tags. */
	clear(): void {
		for (let i = 0; i < DRAFT_OFFER_COUNT; i++) {
			this.armed[i] = false;
			this.settledAt[i] = NOT_YET;
		}
	}

	/** Card `i` wears a tag on this deal (shown once its flip settles). */
	isArmed(i: number): boolean {
		return this.armed[i] === true;
	}

	/**
	 * Card `i`'s tag this frame: `rawTextAlpha` the reveal frame's card textAlpha (1 once the flip settled), `drawnAlpha`
	 * the card's drawn text opacity (draftCardLook: the deal and the exit fade), `elapsed` the reveal's time. Hidden
	 * until settled; then the drawn alpha and the pop. The returned object is reused.
	 */
	look(i: number, rawTextAlpha: number, drawnAlpha: number, elapsed: number, reducedMotion: boolean): DraftTagLook {
		const out = this.out;
		out.alpha = 0;
		out.scale = 1;
		if (this.armed[i] !== true) return out;
		if (this.settledAt[i] === NOT_YET && rawTextAlpha >= 1) this.settledAt[i] = elapsed;
		const at = this.settledAt[i];
		if (at === NOT_YET) return out;
		out.alpha = math.clamp(drawnAlpha, 0, 1);
		out.scale = codexChipScale(elapsed - at, reducedMotion);
		return out;
	}
}

// The draft card's NEW tag (claude/codex-plan.md CX8, R14): only on armed cards, only once that card's flip settled
// (the reveal's own textAlpha reaches 1), then the drawn text alpha and a pop like the NEW! chip (none under Reduced
// motion); a re-deal re-arms; the tag reads the reveal and never steps it.
import { describe, expect, it } from "@rbxts/jest-globals";
import { DraftBeat, DraftReveal } from "shared/view/hud";
import { CODEX_CHIP, DraftNewTags } from ".";

const STEP = 1 / 60;

describe("draft NEW tag", () => {
	it("appears on an armed card only after its flip settled; unarmed cards never", () => {
		const reveal = new DraftReveal();
		reveal.begin([DraftBeat.COMMON, DraftBeat.RARE, DraftBeat.LEGENDARY], false);
		const tags = new DraftNewTags();
		tags.begin([true, false, true]);
		const firstShown = [-1, -1, -1];
		const firstSettled = [-1, -1, -1];
		for (let n = 0; n < 600 && !reveal.frame.settled; n++) {
			const f = reveal.step(STEP);
			for (let i = 0; i < 3; i++) {
				const c = f.cards[i];
				const look = tags.look(i, c.textAlpha, c.textAlpha, f.elapsed, false);
				if (c.textAlpha >= 1 && firstSettled[i] < 0) firstSettled[i] = f.elapsed;
				if (look.alpha > 0 && firstShown[i] < 0) firstShown[i] = f.elapsed;
				if (c.textAlpha < 1) expect([i, look.alpha]).toEqual([i, 0]);
			}
		}
		expect(reveal.frame.settled).toBe(true);
		expect(firstShown[0]).toBe(firstSettled[0]);
		expect(firstShown[2]).toBe(firstSettled[2]);
		expect(firstShown[1]).toBe(-1);
		expect(tags.isArmed(1)).toBe(false);
	});

	it("pops in from the chip's scale, settles to 1; Reduced motion never pops", () => {
		const tags = new DraftNewTags();
		tags.begin([true]);
		expect(tags.look(0, 0.5, 0.5, 1, false).alpha).toBe(0);
		const first = tags.look(0, 1, 1, 2, false);
		expect([first.alpha, first.scale]).toEqual([1, CODEX_CHIP.popScale]);
		expect(tags.look(0, 1, 1, 2 + CODEX_CHIP.popSeconds, false).scale).toBe(1);
		// The exit fade: the drawn alpha, clamped.
		expect(tags.look(0, 1, 0.25, 5, false).alpha).toBe(0.25);
		const still = new DraftNewTags();
		still.begin([true]);
		expect(still.look(0, 1, 1, 0, true).scale).toBe(1);
	});

	it("a re-deal re-arms and waits for the new flip; clear removes every tag", () => {
		const tags = new DraftNewTags();
		tags.begin([true, true]);
		expect(tags.look(1, 1, 1, 1, false).alpha).toBe(1);
		tags.begin([false, true]);
		expect(tags.look(1, 0, 0, 0, false).alpha).toBe(0);
		expect(tags.look(0, 1, 1, 1, false).alpha).toBe(0);
		tags.clear();
		expect(tags.look(1, 1, 1, 2, false).alpha).toBe(0);
	});
});

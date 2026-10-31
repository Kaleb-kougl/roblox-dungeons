// docs/DRAFT_REVEAL.md DR2: the client's confirm gate during the draft reveal.
import { describe, expect, it } from "@rbxts/jest-globals";
import { TUTORIAL } from "shared/config";
import { Button, DRAFT_CONFIRM_BUTTON, type InputFrame } from "shared/sim";
import { DraftRevealGate, draftConfirmHeld, draftNeverRevealed, type DraftConfirmFacts } from "./draftGate";

const CONFIRM = DRAFT_CONFIRM_BUTTON;

function frame(buttons: number, moveX = 0, moveZ = 0, aimX = 0, aimZ = 0): InputFrame {
	return { moveX, moveZ, aimX, aimZ, buttons };
}

describe("DraftRevealGate", () => {
	it("confirm is FIRE", () => {
		expect(CONFIRM).toBe(Button.FIRE);
	});

	it("masks the confirm while the reveal plays; the press edge is one skip", () => {
		const gate = new DraftRevealGate();
		const skips: boolean[] = [];
		for (let i = 0; i < 5; i++) {
			const f = frame(CONFIRM);
			skips.push(gate.apply(f, true));
			expect(f.buttons).toBe(0);
		}
		expect(skips).toEqual([true, false, false, false, false]);
		expect(gate.consumeSkip()).toBe(true);
		expect(gate.consumeSkip()).toBe(false);
	});

	it("a mashed confirm during the reveal is a skip per press, all masked", () => {
		const gate = new DraftRevealGate();
		let skips = 0;
		const pattern = [CONFIRM, 0, CONFIRM, CONFIRM, 0, CONFIRM];
		for (const b of pattern) {
			const f = frame(b);
			if (gate.apply(f, true)) skips++;
			expect(f.buttons).toBe(0);
		}
		expect(skips).toBe(3);
	});

	it("a press held through the settle stays masked until released", () => {
		const gate = new DraftRevealGate();
		gate.apply(frame(CONFIRM), true);
		for (let i = 0; i < 10; i++) {
			const f = frame(CONFIRM);
			expect(gate.apply(f, false)).toBe(false);
			expect(f.buttons).toBe(0);
		}
		const released = frame(0);
		gate.apply(released, false);
		expect(released.buttons).toBe(0);
		const fresh = frame(CONFIRM);
		expect(gate.apply(fresh, false)).toBe(false);
		expect(fresh.buttons).toBe(CONFIRM); // passes on its first frame: the sim sees the edge
	});

	it("a press held from before the reveal is masked but is not a skip", () => {
		const gate = new DraftRevealGate();
		gate.apply(frame(CONFIRM), false);
		const f = frame(CONFIRM);
		expect(gate.apply(f, true)).toBe(false);
		expect(f.buttons).toBe(0);
		const after = frame(CONFIRM);
		gate.apply(after, false);
		expect(after.buttons).toBe(0);
		expect(gate.consumeSkip()).toBe(false);
	});

	it("every other button and the stick pass untouched, during the reveal and after", () => {
		const gate = new DraftRevealGate();
		const others = bit32.bor(Button.ALT, Button.ROLL, Button.FLASK, Button.PAUSE);
		const during = frame(bit32.bor(others, CONFIRM), 700, -300, 1000, 0);
		gate.apply(during, true);
		expect(during).toEqual(frame(others, 700, -300, 1000, 0));
		const after = frame(bit32.bor(others, CONFIRM), -1000, 0, 0, 1000);
		gate.apply(after, false);
		expect(after).toEqual(frame(others, -1000, 0, 0, 1000));
		const free = frame(others, 5, 6, 7, 8);
		gate.apply(free, true);
		expect(free).toEqual(frame(others, 5, 6, 7, 8));
	});

	it("never masks anything when no reveal plays and nothing is held", () => {
		const gate = new DraftRevealGate();
		const pattern = [CONFIRM, CONFIRM, 0, CONFIRM, 0];
		for (const b of pattern) {
			const f = frame(bit32.bor(b, Button.ALT));
			expect(gate.apply(f, false)).toBe(false);
			expect(f.buttons).toBe(bit32.bor(b, Button.ALT));
		}
		expect(gate.consumeSkip()).toBe(false);
	});

	it("reset forgets a held press and a pending skip", () => {
		const gate = new DraftRevealGate();
		gate.apply(frame(CONFIRM), true);
		gate.reset();
		expect(gate.consumeSkip()).toBe(false);
		const f = frame(CONFIRM);
		gate.apply(f, false);
		expect(f.buttons).toBe(CONFIRM);
	});
});

function facts(over: Partial<DraftConfirmFacts>): DraftConfirmFacts {
	return { draftOpen: true, revealBegun: false, revealing: false, neverRevealed: false, ...over };
}

describe("draftConfirmHeld", () => {
	it("holds while the reveal plays", () => {
		expect(draftConfirmHeld(facts({ revealBegun: true, revealing: true }))).toBe(true);
	});

	it("holds an open draft whose reveal has not begun (the frame the cover ends under reduced motion)", () => {
		expect(draftConfirmHeld(facts({}))).toBe(true);
	});

	it("lets the confirm through once the reveal has begun and settled", () => {
		expect(draftConfirmHeld(facts({ revealBegun: true, revealing: false }))).toBe(false);
	});

	it("never holds a closed draft or a draft that is never revealed", () => {
		expect(draftConfirmHeld(facts({ draftOpen: false }))).toBe(false);
		expect(draftConfirmHeld(facts({ neverRevealed: true }))).toBe(false);
	});

	it("a press on the pre-begin frame is masked, and a fresh press after the settle passes", () => {
		const gate = new DraftRevealGate();
		const pre = frame(CONFIRM);
		gate.apply(pre, draftConfirmHeld(facts({})));
		expect(pre.buttons).toBe(0);
		gate.apply(frame(0), draftConfirmHeld(facts({ revealBegun: true, revealing: true })));
		const settled = facts({ revealBegun: true });
		gate.apply(frame(0), draftConfirmHeld(settled));
		const fresh = frame(CONFIRM);
		gate.apply(fresh, draftConfirmHeld(settled));
		expect(fresh.buttons).toBe(CONFIRM);
	});
});

describe("draftNeverRevealed", () => {
	it("the tutorial's end, and a tutorial floor past its last", () => {
		expect(draftNeverRevealed(false, 9, true)).toBe(true);
		expect(draftNeverRevealed(true, TUTORIAL.lastFloor + 1, false)).toBe(true);
		expect(draftNeverRevealed(true, TUTORIAL.lastFloor, false)).toBe(false);
		expect(draftNeverRevealed(false, TUTORIAL.lastFloor + 1, false)).toBe(false);
	});
});

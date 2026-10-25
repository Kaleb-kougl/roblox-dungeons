// Co-op input under a menu (CoopMenuInputGate): a party run never pauses, so while a menu owns the controls the sim
// gets no move, no buttons and no aim, and a button held through the menu's close stays masked until released.
import { describe, expect, it } from "@rbxts/jest-globals";
import { Button, EMPTY_INPUT, type InputFrame } from "shared/sim";
import { CoopMenuInputGate } from "shared/lockstep";

function frame(buttons: number, moveX = 500, aimX = 1000): InputFrame {
	return { moveX, moveZ: -300, aimX, aimZ: 200, buttons };
}

describe("CoopMenuInputGate", () => {
	it("passes input through unchanged while no menu is open", () => {
		const gate = new CoopMenuInputGate();
		const f = frame(Button.FIRE);
		expect(gate.apply(f, false)).toBe(f);
		expect(f).toEqual(frame(Button.FIRE));
	});

	it("sends neutral input (no move, no buttons, no aim) while a menu is open", () => {
		const gate = new CoopMenuInputGate();
		const f = frame(bit32.bor(Button.FIRE, Button.ROLL));
		expect(gate.apply(f, true)).toBe(f); // in place
		expect(f).toEqual({ ...EMPTY_INPUT });
	});

	it("masks a button held through the menu's close until it is released; others pass at once", () => {
		const gate = new CoopMenuInputGate();
		gate.apply(frame(Button.FIRE), true); // A on the menu's Close button
		// Still held after the close: masked; the stick and a new button get through.
		expect(gate.apply(frame(bit32.bor(Button.FIRE, Button.ROLL)), false)).toEqual(frame(Button.ROLL));
		expect(gate.apply(frame(Button.FIRE), false)).toEqual(frame(0));
		// Released, then pressed again: a real press.
		expect(gate.apply(frame(0), false)).toEqual(frame(0));
		expect(gate.apply(frame(Button.FIRE), false)).toEqual(frame(Button.FIRE));
	});

	it("a menu opened again re-arms the mask with what is held at its close", () => {
		const gate = new CoopMenuInputGate();
		gate.apply(frame(Button.ROLL), true);
		gate.apply(frame(0), true);
		expect(gate.apply(frame(Button.ROLL), false)).toEqual(frame(Button.ROLL)); // released inside the menu
	});
});

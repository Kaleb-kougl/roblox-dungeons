/**
 * The local input a co-op client sends while a menu owns the controls (docs/CLIENT.md "Co-op input under a menu").
 * A party run never pauses, so whatever the pad / keys do on the party overlay, Options (a rebind capture included),
 * the leaderboards or the Roblox menu would otherwise reach the sim: D-pad up drinks the flask, A on a button casts a
 * skill, the stick walks the character. While `menuOpen` the frame is EMPTY_INPUT: no move, no buttons and no aim (a
 * pointer moving over the menu would turn the character to it; with no move and no aim the sim keeps the facing).
 * Buttons still held when the menu closes (the A that pressed "Close") stay masked until they are released, so the
 * closing press never reaches the sim either. Solo runs do not use it: they pause under a menu.
 *
 * @module
 */
import { EMPTY_INPUT, copyInput, type InputFrame } from "shared/sim";

export class CoopMenuInputGate {
	/** Buttons held through the end of the last menu: masked until released. */
	private held = 0;

	/** `frame` (the sampled input, changed in place and returned) as the sim may see it. */
	apply(frame: InputFrame, menuOpen: boolean): InputFrame {
		if (menuOpen) {
			this.held = frame.buttons;
			return copyInput(EMPTY_INPUT, frame);
		}
		if (this.held !== 0) {
			this.held = bit32.band(this.held, frame.buttons); // a released button is free again
			frame.buttons = bit32.band(frame.buttons, bit32.bnot(this.held));
		}
		return frame;
	}
}

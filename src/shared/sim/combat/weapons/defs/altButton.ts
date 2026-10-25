/**
 * ALT (right click / LT) edges for weapons (E1.8; source: `src/sim/weapons/defs/altButton.ts`). Read from this tick's
 * input against the acting player's weapons.prevButtons (last tick's buttons). Not a weapon file: defs/index.ts does not import it.
 */

import { Button } from "../../../input";
import type { SimCtx } from "../../ctx";

/** ALT is held this tick. */
export function altHeld(ctx: SimCtx): boolean {
	return bit32.band(ctx.input.buttons, Button.ALT) !== 0;
}

/** ALT was pressed this tick (edge against last tick). */
export function altPressed(ctx: SimCtx): boolean {
	return bit32.band(ctx.input.buttons, Button.ALT) !== 0 && bit32.band(ctx.weapons.prevButtons, Button.ALT) === 0;
}

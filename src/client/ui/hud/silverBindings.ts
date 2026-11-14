import { RoomClearValue } from "./roomClearBindings";

/**
 * The live Silver counter's per-frame values (docs/SILVER.md SV8): React bindings SilverHudController writes, only on
 * change (RoomClearValue), and ScorePanel's row 5 binds to (no re-render per frame). `target` is the counter's icon
 * frame (ScorePanel registers it while mounted): the crate burst's coins fly to its centre.
 */
export const SILVER_UI = {
	/** The run's Silver so far (the tracker's total), as text. */
	text: new RoomClearValue("0"),
	/** The `+N` beside the counter and its transparency (1: hidden). */
	chipText: new RoomClearValue(""),
	chipTransparency: new RoomClearValue(1),
	/** The counter's width (silverRowFit's counterW), reference px: the floor line takes the rest of row 5. */
	counterW: new RoomClearValue(0),
};

let target: GuiObject | undefined;

/** The counter's icon, for the coins' flight (undefined while the counter is not shown). */
export function silverCounterTarget(): GuiObject | undefined {
	return target !== undefined && target.Parent !== undefined ? target : undefined;
}

/** ScorePanel's row 5 registers its icon frame (and undefined on unmount). */
export function setSilverCounterTarget(g: GuiObject | undefined): void {
	target = g;
}

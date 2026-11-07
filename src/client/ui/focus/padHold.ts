import React from "@rbxts/react";

const [progress, setProgress] = React.createBinding(0);

/**
 * Hold B to exit on the run-over panel (docs/GAMEPAD_MENUS.md section 3, GMD13, GM9): the hold's fill, 0..1, as a
 * React binding. FocusController writes it every frame the run-over scope owns the pad (shared/view/menu PadHoldGate's
 * progress) and the Exit button draws it (MenuButton `fill`), so the fill moves without re-rendering the panel.
 */
export const PAD_HOLD_UI = {
	progress,
	/** Writes the fill (FocusController only); a value equal to the current one changes nothing. */
	set(value: number): void {
		if (progress.getValue() !== value) setProgress(value);
	},
} as const;

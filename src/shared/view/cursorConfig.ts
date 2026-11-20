/**
 * Tunables of the gauntlet cursor (docs/CURSOR.md section 3; logic in cursor.ts, the client's CursorController draws
 * it). Presentation only: nothing here reaches the sim, the lockstep wire or a hash. Roblox-port choices, no web
 * source.
 *
 * @module
 */
import type { CursorSize } from "shared/settings";

export const CURSOR_VIEW = {
	/**
	 * The cursor ScreenGui's DisplayOrder: above every game layer (menus 15, pause / settings 20, tooltips 25, the
	 * loading screen and stage card 30, spikes up to 101). CoreGui still draws above it.
	 */
	displayOrder: 200,
	/** The theme's logical ids: the gauntlet, and the one over a button (optional in a pack; falls back to visualId). */
	visualId: "ui.cursor",
	hoverVisualId: "ui.cursor.hover",
	/** Whole-number scale of the art at a referenceHeight tall viewport (Normal size): the hand about 54 px at 1080. */
	baseScale: 2,
	/** The viewport height, px, at which Normal draws at baseScale; the scale follows the height in whole steps. */
	referenceHeight: 1080,
	/** Integer scales only, so the pixels stay square; maxScale keeps Large a step above Normal at 2160 px. */
	minScale: 1,
	maxScale: 5,
	/** Whole scale steps each Cursor size adds to Normal's (docs/CURSOR.md D2). */
	sizeSteps: { small: -1, normal: 0, large: 1 } as Readonly<Record<CursorSize, number>>,
	/** The click squeeze (D5): down to pressScale at pressSec / 2 and back by pressSec, about the fingertip. */
	pressScale: 0.85,
	pressSec: 0.09,
	/** How often the over-button test runs, per second (GetGuiObjectsAtPosition allocates; menus only). */
	hoverPollHz: 20,
} as const;

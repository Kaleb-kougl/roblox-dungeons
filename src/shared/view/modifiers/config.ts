/**
 * Presentation tunables of the floor modifiers (docs/FLOOR_MODIFIERS.md Player experience, Design §4-§6; logic in
 * modifiers.ts / payoff.ts, drawing in the client's StageCard banner and FloorModifierChip, FM5 / FM6). Presentation
 * only: which floor gets which modifier is shared/dungeon MODIFIERS', so nothing here can change a replay.
 *
 * @module
 */
import type { ColorRole } from "shared/theme";

/** The banner's stamp (the name and line scale down onto the card as they fade in). */
export interface FloorModifierStampView {
	/** Seconds from the stamp's start (bannerDelaySec into the card) to rest. */
	readonly durationSec: number;
	/** The stamp's starting scale (it eases out to 1). */
	readonly fromScale: number;
}

/** The status chip's one pulse when the promise pays off (FM6). */
export interface FloorModifierChipPulseView {
	/** Seconds of the whole pulse (up and back). */
	readonly durationSec: number;
	/** Extra scale at the pulse's peak (1 + amplitude). */
	readonly amplitude: number;
	/** The pulse highlight's transparency at the peak (1 = invisible at rest). */
	readonly peakTransparency: number;
}

/**
 * The status chip (FM6, client FloorModifierChip): the floor's modifier named in its colour role on a dark panel, in
 * the status corner's boost row (beside the Horde chip) and at the head of the touch strip's chip line. Reference px.
 */
export interface FloorModifierChipView {
	/** Text size cap (TextScaled into the chip's box) in the status corner. */
	readonly textSize: number;
	/** Touch strip: the chip's width and text cap (its height is the strip's chip cell). */
	readonly touchWidth: number;
	readonly touchTextSize: number;
	/** Horizontal padding inside the chip and between its icon and name. */
	readonly pad: number;
	/** The chip's panel fill (a dark backing so the role colour reads). */
	readonly fillRole: ColorRole;
}

export interface FloorModifierViewTunables {
	/** Seconds after the floor card appears before the banner stamps in (the title and biome read first). */
	readonly bannerDelaySec: number;
	/** The floor card's minimum hold on a modifier floor (FMD8: StageLoad.holdAtLeast, only while the world is frozen). */
	readonly modifierCardSec: number;
	readonly stamp: FloorModifierStampView;
	readonly chipPulse: FloorModifierChipPulseView;
	readonly chip: FloorModifierChipView;
}

export const FLOOR_MODIFIER_VIEW: FloorModifierViewTunables = {
	bannerDelaySec: 0.3,
	modifierCardSec: 1.8,
	stamp: { durationSec: 0.2, fromScale: 1.6 },
	chipPulse: { durationSec: 0.6, amplitude: 0.1, peakTransparency: 0.35 },
	chip: { textSize: 16, touchWidth: 96, touchTextSize: 12, pad: 3, fillRole: "uiPanel" },
};

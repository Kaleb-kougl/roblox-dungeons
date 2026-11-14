/**
 * The Silver counter's place on the score panel (docs/SILVER.md SV8, SV0: "the counter goes on row 5, the floor and
 * Depth line, left of the text"). Row 5 is the panel's inner width (HUD_VIEW.scoreWidth less its padding); the counter
 * (icon, number) takes what its number needs and the floor / Depth line scales into the rest (TextScaled, capped at
 * HUD_VIEW.smallText). The counter's `+N` floats left of the panel (outside the row), so it never costs the row room.
 * Pure; fit spec in silver.spec.ts / counter.spec.ts.
 */
import { SILVER_COUNTER } from "./config";

export interface SilverRowFit {
	/** The counter's width (icon, gap, number), reference px. */
	readonly counterW: number;
	/** The room left for the floor line. */
	readonly textW: number;
	/** The floor line's text size there (<= maxText). */
	readonly textSize: number;
}

/** The estimated width of `text` at `size` (bytes x glyphAspect x size). */
export function silverTextWidth(text: string, size: number): number {
	return text.size() * SILVER_COUNTER.glyphAspect * size;
}

/** The counter's width for a number of `digits` digits. */
export function silverCounterWidth(digits: number): number {
	const c = SILVER_COUNTER;
	return c.iconPx + c.gap + math.max(1, digits) * c.glyphAspect * c.numberText;
}

/** The row's split: the counter for `silver`, the floor line `floorText` in what is left of `innerW`. */
export function silverRowFit(innerW: number, floorText: string, silver: number, maxText: number): SilverRowFit {
	const digits = tostring(math.max(0, math.floor(silver))).size();
	const counterW = math.ceil(silverCounterWidth(digits));
	const textW = math.max(0, innerW - counterW - SILVER_COUNTER.gap);
	const need = silverTextWidth(floorText, maxText);
	const textSize = need <= textW || need <= 0 ? maxText : (maxText * textW) / need;
	return { counterW, textW, textSize };
}

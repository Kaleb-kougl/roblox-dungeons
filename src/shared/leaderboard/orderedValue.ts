/**
 * The integer a leaderboard entry is ranked by in its OrderedDataStore (higher ranks first):
 *
 *   value = (score * 2^F + floor) * 2^T + (2^T - 1 - timeSlot)
 *
 * with F = floorBits, T = timeBits (config.ts ORDERED_VALUE_LAYOUT) and timeSlot = floor((at - epoch) / slot
 * seconds). So a higher score always ranks first; equal scores rank by the deeper floor; equal score and floor rank
 * the EARLIER submission first (its inverted time is larger). Same slot: the store's own order (by key).
 *
 * Every component is clamped to its field (score to [0, 2^S), floor to [0, 2^F), the slot to [0, 2^T)), so the value
 * is always an integer in [0, 2^(S+F+T)) <= 2^53: exact in a double, valid for OrderedDataStore. Plain arithmetic
 * (no bit32: the value is wider than 32 bits).
 *
 * @module
 */
import { ORDERED_VALUE_LAYOUT, ORDERED_VALUE_MAX_BITS, type OrderedValueLayout } from "./config";

export interface OrderedValueParts {
	readonly score: number;
	readonly floor: number;
	/** Unix seconds of the submission. */
	readonly at: number;
}

export interface DecodedOrderedValue {
	readonly score: number;
	readonly floor: number;
	/** Submission time slot (0 = the layout's epoch). */
	readonly timeSlot: number;
}

/** 2^n for a small non-negative integer n (exact). */
export function pow2(n: number): number {
	let v = 1;
	for (let i = 0; i < n; i++) v *= 2;
	return v;
}

function clampInt(v: number, lo: number, hi: number): number {
	if (v !== v) return lo; // NaN
	return math.clamp(math.floor(v), lo, hi);
}

/** The layout fits in an exact double (S + F + T <= 53) and every field has at least one bit. */
export function isValidLayout(layout: OrderedValueLayout): boolean {
	const bits = layout.scoreBits + layout.floorBits + layout.timeBits;
	return layout.scoreBits > 0 && layout.floorBits > 0 && layout.timeBits > 0 && bits <= ORDERED_VALUE_MAX_BITS;
}

/** Largest score the layout stores (higher scores clamp to it). */
export function maxEncodableScore(layout: OrderedValueLayout = ORDERED_VALUE_LAYOUT): number {
	return pow2(layout.scoreBits) - 1;
}

/** The submission time slot of unix time `at` (clamped to the layout's range). */
export function timeSlotOf(at: number, layout: OrderedValueLayout = ORDERED_VALUE_LAYOUT): number {
	return clampInt((at - layout.epochSeconds) / layout.timeSlotSeconds, 0, pow2(layout.timeBits) - 1);
}

/** The ordered value of an entry (see the file comment). */
export function encodeOrderedValue(
	parts: OrderedValueParts,
	layout: OrderedValueLayout = ORDERED_VALUE_LAYOUT,
): number {
	const floorSpan = pow2(layout.floorBits);
	const timeSpan = pow2(layout.timeBits);
	const score = clampInt(parts.score, 0, pow2(layout.scoreBits) - 1);
	const floor = clampInt(parts.floor, 0, floorSpan - 1);
	const inverted = timeSpan - 1 - timeSlotOf(parts.at, layout);
	return (score * floorSpan + floor) * timeSpan + inverted;
}

/** The parts of an ordered value (inverse of encodeOrderedValue for in-range parts). */
export function decodeOrderedValue(
	value: number,
	layout: OrderedValueLayout = ORDERED_VALUE_LAYOUT,
): DecodedOrderedValue {
	const floorSpan = pow2(layout.floorBits);
	const timeSpan = pow2(layout.timeBits);
	const v = clampInt(value, 0, pow2(layout.scoreBits + layout.floorBits + layout.timeBits) - 1);
	const inverted = v % timeSpan;
	const rest = (v - inverted) / timeSpan;
	const floor = rest % floorSpan;
	const score = (rest - floor) / floorSpan;
	return { score, floor, timeSlot: timeSpan - 1 - inverted };
}

/** An OrderedDataStore value read back: a finite non-negative integer, else undefined. */
export function asOrderedValue(raw: unknown): number | undefined {
	if (!typeIs(raw, "number") || raw !== raw || raw < 0 || raw === math.huge || math.floor(raw) !== raw) {
		return undefined;
	}
	return raw;
}

/**
 * Seeded PRNG for the simulation: mulberry32 (source: `src/sim/rng.ts`).
 *
 * The whole generator state is one uint32, so it lives in SimState.rngState and is covered by the state hash. Replays
 * restore it from the recording's seed. Never use math.random in sim code (the headless runner makes it throw).
 *
 * Luau port: every intermediate is a uint32 in [0, 2^32) (bit32 semantics). JS's signed `| 0` views differ only in the
 * sign of the representation, never in the bits, so the outputs are identical (fixtures/rng.json).
 */

import { imul, jsMax, jsMin, u32 } from "shared/jsmath";

const INCREMENT = 0x6d2b79f5;
const TWO_POW_32 = 4294967296;

/** Anything that carries a mulberry32 state word (SimState does). */
export interface RngHolder {
	rngState: number;
}

/** Normalizes any number to a uint32 seed: `(isFinite(seed) ? trunc(seed) : 0) >>> 0` (NaN and fractions too). */
export function seedToState(seed: number): number {
	return u32(seed); // ToUint32: non-finite -> 0, truncate, wrap modulo 2^32
}

/** Advances `h.rngState` and returns a float in [0, 1) (exactly `u32 / 2^32`). */
export function rngNext(h: RngHolder): number {
	// (state + INCREMENT) | 0, kept as its uint32 bit pattern (the sum is < 2^33, exact).
	const s = u32(h.rngState + INCREMENT);
	h.rngState = s;
	let t = imul(bit32.bxor(s, bit32.rshift(s, 15)), bit32.bor(s, 1));
	// t ^= t + imul(...): the sum of two uint32s is exact (< 2^33); reduce it mod 2^32 before the XOR.
	t = bit32.bxor(t, u32(t + imul(bit32.bxor(t, bit32.rshift(t, 7)), bit32.bor(t, 61))));
	return bit32.bxor(t, bit32.rshift(t, 14)) / TWO_POW_32;
}

/** Advances `h.rngState` and returns an integer in [min, max] (both inclusive; bounds may be reversed or fractional). */
export function rngInt(h: RngHolder, min: number, max: number): number {
	const lo = math.ceil(jsMin(min, max));
	const hi = math.floor(jsMax(min, max));
	return lo + math.floor(rngNext(h) * (hi - lo + 1));
}

/**
 * Standalone generator with its own state, for code that is not inside SimState (tests, tools, content generation
 * that runs before the sim starts). The source's `state` getter / setter are `getState()` / `setState()` here.
 */
export class Rng implements RngHolder {
	rngState: number;

	constructor(seed: number) {
		this.rngState = seedToState(seed);
	}

	/** Current uint32 state, serializable. */
	getState(): number {
		return this.rngState;
	}

	/** Restores a state (`value >>> 0`). */
	setState(value: number): void {
		this.rngState = u32(value);
	}

	/** Float in [0, 1). */
	next(): number {
		return rngNext(this);
	}

	/** Integer in [min, max], both inclusive. */
	int(min: number, max: number): number {
		return rngInt(this, min, max);
	}
}

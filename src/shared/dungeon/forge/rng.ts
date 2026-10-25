/*
 * Ported from Dungeon Forge (https://github.com/majidmanzarpour/threejs-procedural-dungeon), src/main.js.
 * MIT License. Copyright (c) 2026 Majid Manzarpour.
 * Full license text: THIRD_PARTY_NOTICES.md at the repository root.
 *
 * Roblox port of project-kaleb-vale src/dungeon/forge/rng.ts @ 42897e2. Every intermediate is a uint32 in
 * [0, 2^32) (bit32 + the split-16-bit imul from shared/jsmath); the bit patterns equal JS's int32 ones.
 */
import { imul, u32 } from "shared/jsmath";

const INCREMENT = 0x6d2b79f5;
const TWO_32 = 4294967296;

/** One mulberry32 stream: returns floats in [0, 1). Arithmetic is byte-for-byte the original's. */
export type RandomFn = () => number;

/** One mulberry32 step from uint32 state `a`: the new state and the output in [0, 1). */
export function mulberry32Step(a: number): LuaTuple<[number, number]> {
	const s = (a + INCREMENT) % TWO_32;
	let t = imul(bit32.bxor(s, bit32.rshift(s, 15)), bit32.bor(s, 1));
	t = bit32.bxor((t + imul(bit32.bxor(t, bit32.rshift(t, 7)), bit32.bor(t, 61))) % TWO_32, t);
	return $tuple(s, bit32.bxor(t, bit32.rshift(t, 14)) / TWO_32);
}

export function mulberry32(seed: number): RandomFn {
	let a = u32(seed);
	return () => {
		const [s, out] = mulberry32Step(a);
		a = s;
		return out;
	};
}

export interface Rng {
	/** Float in [a, b). One draw. */
	f: (a: number, b: number) => number;
	/** Integer in [a, b], inclusive. One draw. */
	i: (a: number, b: number) => number;
	/** Uniform element. One draw. */
	pick: <T>(arr: ReadonlyArray<T>) => T;
	/** True with probability p. Always one draw, even for p = 0 (seed parity depends on it). */
	chance: (p: number) => boolean;
	raw: RandomFn;
	// The original's gauss() (Box-Muller: Math.log / Math.cos) is not ported: the generator never calls it, and
	// platform libm calls would not be deterministic across Roblox clients.
}

export function makeRng(seed: number): Rng {
	const r = mulberry32(seed);
	return {
		f: (a, b) => a + r() * (b - a),
		i: (a, b) => a + math.floor(r() * (b - a + 1)),
		pick: <T>(arr: ReadonlyArray<T>) => arr[math.floor(r() * arr.size())],
		chance: (p) => r() < p,
		raw: r,
	};
}

/**
 * Deterministic sin / cos for the Dungeon Forge port (room scatter angles, boss braziers).
 *
 * Why not math.sin / math.cos: Luau calls the platform C library, so the last bit differs between machines (Roblox
 * clients on Windows / macOS / Android / iOS and the Linux servers that re-run replays). A floor generated on two
 * machines must be identical, so this module computes sin / cos with plain IEEE double arithmetic (+ - * / and
 * floor only, no FMA), which every Luau VM evaluates the same way.
 *
 * Accuracy: the argument is reduced by pi/2 with a 4-part Cody-Waite split of pi/2 (exact while the quadrant number
 * is below MAX_QUADRANT), then the Taylor series is summed in double-double (~106-bit) arithmetic and rounded once, so
 * the result is the correctly rounded sin / cos except in astronomically rare hard cases. (Checked offline against a
 * 400-bit BigInt reference: 0 differences in 20,000 random arguments.)
 *
 * Parity with the web build: V8's Math.sin / Math.cos (glibc-derived) are NOT correctly rounded; they differ from the
 * correctly rounded value by 1 ulp in ~3 % of arguments. Fixture calls that differ: 2 of the 36 dungeon calls
 * (dungeon:42 cos(3.7216813944428426), dungeon:7 cos(0.46821096892335323), both absorbed by `* radius + offset`, so the
 * three dungeon fixtures match bit for bit) and 6 of the 276 arc-table values (the sim hard-codes those). Measured in
 * Node on the web build itself with V8's trig swapped for this algorithm, over 20,000 MVP + 3,000 demo-preset seeds:
 * ~20 % get a 1-ulp different raw scatter position sx0 / sy0 (display only), and 2 MVP seeds (706 and 10186) a
 * different LAYOUT (the ulp flips a tie in the room separation); no demo-preset seed changed layout. So the Roblox floor equals the web
 * floor for ~99.99 % of seeds; bit-exact V8 trig for all seeds would need a port of V8's glibc sin / cos (LGPL).
 * Platform math.sin / math.cos would not fix that either (macOS libm differs from V8 on 4 of the 36 dungeon calls) and
 * would differ between Roblox machines.
 *
 * @module
 */

/** 2^27 + 1: Dekker's splitter for exact products without FMA. */
const SPLITTER = 134217729;
/** pi/2 in four parts (fdlibm's pio2_1, pio2_2, pio2_3: 33 bits each, then the tail pio2_3t). */
const PIO2_1 = 1.57079632673412561417;
const PIO2_2 = 6.0771005063039659766e-11;
const PIO2_3 = 2.0222662487111664558e-21;
const PIO2_3T = 8.47842766036889956997e-32;
const INV_PIO2 = 6.36619772367581382433e-1;
/** Products n * PIO2_k stay exact while n < 2^19 (33 + 19 bits <= 53). */
const MAX_QUADRANT = 524288;
/** Stop the series once a term is below this (far under 2^-106 relative to a result >= ~0.7). */
const SERIES_EPS = 1e-40;
const MAX_TERMS = 30;

// Double-double helpers. Results go to module-level scratch registers (no allocation, no tuples).
let rh = 0;
let rl = 0;

function twoSum(a: number, b: number): void {
	const s = a + b;
	const bb = s - a;
	rh = s;
	rl = a - (s - bb) + (b - bb);
}

function quickTwoSum(a: number, b: number): void {
	const s = a + b;
	rh = s;
	rl = b - (s - a);
}

function twoProd(a: number, b: number): void {
	const p = a * b;
	const ca = SPLITTER * a;
	const ah = ca - (ca - a);
	const al = a - ah;
	const cb = SPLITTER * b;
	const bh = cb - (cb - b);
	const bl = b - bh;
	rh = p;
	rl = ah * bh - p + ah * bl + al * bh + al * bl;
}

function ddAdd(ah: number, al: number, bh: number, bl: number): void {
	twoSum(ah, bh);
	const s = rh;
	const e = rl + (al + bl);
	quickTwoSum(s, e);
}

function ddMul(ah: number, al: number, bh: number, bl: number): void {
	twoProd(ah, bh);
	const p = rh;
	const e = rl + (ah * bl + al * bh);
	quickTwoSum(p, e);
}

function ddDivNum(ah: number, al: number, b: number): void {
	const q1 = ah / b;
	twoProd(q1, b);
	const ph = rh;
	const pl = rl;
	twoSum(ah, -ph);
	const rem = rh + (rl - pl) + al;
	quickTwoSum(q1, rem / b);
}

/** sin (start 1) or cos (start 0) of the double-double r = (h, l), |r| <= pi/4, rounded to a double. */
function series(h: number, l: number, start: 0 | 1): number {
	ddMul(h, l, h, l);
	const r2h = rh;
	const r2l = rl;
	let th = start === 1 ? h : 1;
	let tl = start === 1 ? l : 0;
	let sh = th;
	let sl = tl;
	for (let k = 1; k < MAX_TERMS; k++) {
		ddMul(th, tl, r2h, r2l);
		const k2 = 2 * k;
		// sin: term_k = term_{k-1} * r^2 / -((2k)(2k + 1)); cos: / -((2k - 1)(2k))
		ddDivNum(rh, rl, start === 1 ? -(k2 * (k2 + 1)) : -((k2 - 1) * k2));
		th = rh;
		tl = rl;
		ddAdd(sh, sl, th, tl);
		sh = rh;
		sl = rl;
		if (math.abs(th) < SERIES_EPS) break;
	}
	return sh + sl;
}

/** Quadrant of x and the reduced argument x - n * pi/2 (double-double, in rh / rl). */
function reduce(x: number): number {
	const n = math.floor(x * INV_PIO2 + 0.5);
	if (math.abs(n) >= MAX_QUADRANT) error(`dungeon trig: |x| too large for exact reduction (${x})`);
	const t1 = x - n * PIO2_1; // exact (Sterbenz)
	twoSum(t1, -(n * PIO2_2));
	ddAdd(rh, rl, -(n * PIO2_3), -(n * PIO2_3T));
	return ((n % 4) + 4) % 4;
}

function isFiniteNumber(x: number): boolean {
	return x === x && x !== math.huge && x !== -math.huge;
}

/** Deterministic, correctly rounded sin(x) for |x| < 2^19 * pi/2. sin(-0) is -0; NaN / Infinity give NaN. */
export function dsin(x: number): number {
	if (!isFiniteNumber(x)) return 0 / 0;
	if (x === 0) return x;
	const q = reduce(x);
	const h = rh;
	const l = rl;
	if (q === 0) return series(h, l, 1);
	if (q === 1) return series(h, l, 0);
	if (q === 2) return -series(h, l, 1);
	return -series(h, l, 0);
}

/** Deterministic, correctly rounded cos(x) for |x| < 2^19 * pi/2. NaN / Infinity give NaN. */
export function dcos(x: number): number {
	if (!isFiniteNumber(x)) return 0 / 0;
	const q = reduce(x);
	const h = rh;
	const l = rl;
	if (q === 0) return series(h, l, 0);
	if (q === 1) return -series(h, l, 1);
	if (q === 2) return -series(h, l, 0);
	return series(h, l, 1);
}

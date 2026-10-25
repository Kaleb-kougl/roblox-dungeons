/**
 * JavaScript number semantics in Luau, for bit-exact parity with the web build (fixtures/README.md, "Porting notes").
 * roblox-ts compiles `%` to Luau's floored `%` and bitwise operators to `bit32` (uint32 results), and Luau's
 * `math.round` / `table.sort` differ from V8's. The sim and the dungeon generator use these helpers instead.
 */

const TWO_32 = 4294967296;
const TWO_31 = 2147483648;
const TWO_16 = 65536;

function isNaNNumber(x: number): boolean {
	return x !== x;
}

/** JS ToUint32: NaN and +/-Infinity -> 0, truncate toward zero, wrap into [0, 2^32). */
export function u32(x: number): number {
	if (isNaNNumber(x) || x === math.huge || x === -math.huge) return 0;
	const t = x < 0 ? math.ceil(x) : math.floor(x);
	const m = t % TWO_32; // Luau's floored % lands in [0, 2^32)
	return m === 0 ? 0 : m; // drop -0
}

/** JS ToInt32 (`x | 0`): the signed view of `u32(x)`. */
export function i32(x: number): number {
	const u = u32(x);
	return u >= TWO_31 ? u - TWO_32 : u;
}

/** `Math.imul(a, b) >>> 0`: the low 32 bits of the product, as a uint32. Split into 16-bit halves so it stays exact. */
export function imul(a: number, b: number): number {
	const ua = u32(a);
	const ub = u32(b);
	const ah = math.floor(ua / TWO_16);
	const al = ua % TWO_16;
	const bh = math.floor(ub / TWO_16);
	const bl = ub % TWO_16;
	const cross = ((ah * bl + al * bh) % TWO_16) * TWO_16;
	return (al * bl + cross) % TWO_32;
}

/** `Math.round`: halves round toward +Infinity (Luau's math.round rounds them away from zero); keeps JS's -0. */
export function jsRound(x: number): number {
	if (isNaNNumber(x) || x === math.huge || x === -math.huge) return x;
	let r = math.floor(x);
	if (x - r >= 0.5) r += 1;
	if (r === 0 && (x < 0 || 1 / x < 0)) return -0; // Math.round(-0.4) and Math.round(-0) are -0
	return r;
}

/** JS `a % b` (truncated remainder, sign of the dividend). Luau's `%` is floored; `math.fmod` is truncated. */
export function jsRem(a: number, b: number): number {
	return math.fmod(a, b);
}

/** `Math.max(a, b)`: NaN wins, and +0 beats -0. */
export function jsMax(a: number, b: number): number {
	if (isNaNNumber(a) || isNaNNumber(b)) return 0 / 0;
	if (a === 0 && b === 0) return 1 / a < 0 ? b : a;
	return a > b ? a : b;
}

/** `Math.min(a, b)`: NaN wins, and -0 beats +0. */
export function jsMin(a: number, b: number): number {
	if (isNaNNumber(a) || isNaNNumber(b)) return 0 / 0;
	if (a === 0 && b === 0) return 1 / a < 0 ? a : b;
	return a < b ? a : b;
}

/**
 * `Math.hypot(...args)` exactly as V8 computes it (max-normalised Kahan sum), not `sqrt(x*x + y*y)`: the two differ in
 * the last bit often enough to break ties between equal MST edges (fixtures/README.md porting note 2).
 */
export function hypot(args: ReadonlyArray<number>): number {
	let max = 0;
	let sawNaN = false;
	for (const v of args) {
		const a = math.abs(v);
		if (a === math.huge) return math.huge;
		if (isNaNNumber(a)) sawNaN = true;
		else if (a > max) max = a;
	}
	if (sawNaN) return 0 / 0;
	if (max === 0) return 0;
	let sum = 0;
	let comp = 0;
	for (const v of args) {
		const n = math.abs(v) / max;
		const summand = n * n - comp;
		const pre = sum + summand;
		comp = pre - sum - summand;
		sum = pre;
	}
	return math.sqrt(sum) * max;
}

/** Two-argument `Math.hypot`. */
export function hypot2(x: number, y: number): number {
	return hypot([x, y]);
}

/**
 * Stable in-place sort with a JS-style comparator (negative: a first), like V8's `Array.prototype.sort`.
 * Luau's `table.sort` is not stable, and `generate.ts` depends on stability (porting note 4). Returns `arr`.
 */
export function stableSort<T extends defined>(arr: T[], compare: (a: T, b: T) => number): T[] {
	const n = arr.size();
	if (n < 2) return arr;
	let src = [...arr];
	let dst = [...arr];
	for (let width = 1; width < n; width *= 2) {
		for (let lo = 0; lo < n; lo += width * 2) {
			const mid = math.min(lo + width, n);
			const hi = math.min(lo + width * 2, n);
			let i = lo;
			let j = mid;
			let k = lo;
			while (i < mid && j < hi) {
				// take from the right run only when strictly smaller, so equal keys keep their order
				if (compare(src[j], src[i]) < 0) {
					dst[k] = src[j];
					j++;
				} else {
					dst[k] = src[i];
					i++;
				}
				k++;
			}
			while (i < mid) dst[k++] = src[i++];
			while (j < hi) dst[k++] = src[j++];
		}
		const swap = src;
		src = dst;
		dst = swap;
	}
	for (let i = 0; i < n; i++) arr[i] = src[i];
	return arr;
}

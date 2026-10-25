/**
 * JavaScript `Number` helpers the sim needs beyond `shared/jsmath`: `Number.isFinite` / `Number.isInteger` (they take
 * any value and are false for non-numbers) and `Number.prototype.toString()` (shortest round-trip decimal, JS layout),
 * which `JSON.stringify` uses for recordings and template strings use in error messages.
 */

/** `Math.SQRT1_2` (bits 3fe6a09e667f3bcd): the starting facing component (screen-down). */
export const SQRT1_2 = 0.7071067811865476;

const MAX_SIGNIFICANT_DIGITS = 17;
/** JS prints plain decimals for 1e-7 < |v| < 1e21 (exponent n in (-6, 21]); exponent form outside. */
const PLAIN_MAX_EXPONENT = 21;
const PLAIN_MIN_EXPONENT = -6;

/** `Number.isFinite(v)`: a number that is not NaN or +/-Infinity. */
export function isFiniteNumber(v: unknown): v is number {
	return typeIs(v, "number") && v === v && v !== math.huge && v !== -math.huge;
}

/** `Number.isInteger(v)`: a finite number with no fractional part (`-0` counts). */
export function isIntegerNumber(v: unknown): v is number {
	return isFiniteNumber(v) && math.floor(v) === v;
}

/** `Math.trunc(x)` (keeps -0 for small negatives, like JS: `Math.trunc(-0.5)` is -0). */
export function jsTrunc(x: number): number {
	return x < 0 ? math.ceil(x) : math.floor(x);
}

/**
 * Shortest significant digits (no trailing zeros) and decimal exponent of a positive finite number, such that
 * `0.d1d2d3... x 10^(exp + 1)` reads back as the same double. Tries 1..17 digits with C's correctly rounded `%e`.
 */
function shortestDigits(a: number): LuaTuple<[string, number]> {
	let digits = "";
	let exp = 0;
	for (let p = 1; p <= MAX_SIGNIFICANT_DIGITS; p++) {
		const s = string.format(`%.${p - 1}e`, a);
		const [ePos] = string.find(s, "e", 1, true);
		if (ePos === undefined) break; // unreachable for finite input
		digits = string.gsub(string.sub(s, 1, ePos - 1), "%.", "")[0];
		exp = tonumber(string.sub(s, ePos + 1)) ?? 0;
		if (tonumber(s) === a) break;
	}
	while (digits.size() > 1 && string.sub(digits, -1) === "0") digits = string.sub(digits, 1, -2);
	return $tuple(digits, exp);
}

/** `String(v)` for a number, exactly as JavaScript prints it (`0.1`, `-1e-7`, `1.5e+21`, `-0` -> `0`). */
export function numberToJsString(v: number): string {
	if (v !== v) return "NaN";
	if (v === math.huge) return "Infinity";
	if (v === -math.huge) return "-Infinity";
	if (v === 0) return "0";
	const neg = v < 0;
	const [digits, exp] = shortestDigits(neg ? -v : v);
	const k = digits.size();
	const n = exp + 1;
	let body: string;
	if (k <= n && n <= PLAIN_MAX_EXPONENT) {
		body = digits + string.rep("0", n - k);
	} else if (0 < n && n <= PLAIN_MAX_EXPONENT) {
		body = string.sub(digits, 1, n) + "." + string.sub(digits, n + 1);
	} else if (PLAIN_MIN_EXPONENT < n && n <= 0) {
		body = "0." + string.rep("0", -n) + digits;
	} else {
		const e = n - 1;
		const mantissa = k === 1 ? digits : string.sub(digits, 1, 1) + "." + string.sub(digits, 2);
		body = mantissa + "e" + (e < 0 ? "-" : "+") + tostring(math.abs(e));
	}
	return neg ? "-" + body : body;
}

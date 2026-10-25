/**
 * Spec helpers for the dungeon parity checks (not exported from the barrel): float64 <-> fixture hex, and a recursive
 * comparer that reports the first differing path (e.g. `rooms[3].x`).
 */
import { stableSort } from "shared/jsmath";

const HEX_DIGITS = 16;
const HEX_SUFFIX = "Hex";

/** IEEE-754 bits of x as 16 hex digits, most significant first (the fixtures' `*Hex` format). */
export function f64Hex(x: number): string {
	const bytes = string.pack(">d", x);
	let out = "";
	for (let i = 1; i <= 8; i++) {
		const [b] = string.byte(bytes, i, i);
		out += string.format("%02x", b);
	}
	return out;
}

/** The double whose bits are the 16 hex digits `h` (most significant first). */
export function hexF64(h: string): number {
	assert(h.size() === HEX_DIGITS, `bad hex ${h}`);
	let bytes = "";
	for (let i = 0; i < 8; i++) bytes += string.char(tonumber(string.sub(h, 2 * i + 1, 2 * i + 2), 16)!);
	const [v] = string.unpack(">d", bytes);
	return v as number;
}

/** Signed distance in ulps between two doubles given as hex (exact while the high words are close). */
export function ulpDistanceHex(a: string, b: string): number {
	const ahi = tonumber(string.sub(a, 1, 8), 16)!;
	const alo = tonumber(string.sub(a, 9, 16), 16)!;
	const bhi = tonumber(string.sub(b, 1, 8), 16)!;
	const blo = tonumber(string.sub(b, 9, 16), 16)!;
	return (ahi - bhi) * 4294967296 + (alo - blo);
}

function isNegZero(x: number): boolean {
	return x === 0 && 1 / x < 0;
}

export interface DiffOptions {
	/** Paths to skip entirely (exporter metadata). */
	ignore?: (path: string) => boolean;
	/** Number paths (and their `*Hex` twins) where a 1-ulp difference is tolerated and recorded. */
	tolerate1Ulp?: (path: string) => boolean;
	/** Filled with every tolerated path. */
	tolerated?: string[];
	/** Object keys compared first, in this order (pipeline order finds the root cause); the rest follow sorted. */
	keyOrder?: ReadonlyArray<string>;
}

function sortedKeys(t: Record<string, unknown>, first: ReadonlyArray<string> = []): string[] {
	const rank = (k: string) => {
		const i = first.indexOf(k);
		return i < 0 ? first.size() : i;
	};
	const keys: string[] = [];
	// a plain table viewed as a map: iterates every key (order fixed by the sort below)
	for (const [k] of t as unknown as ReadonlyMap<string, unknown>) keys.push(tostring(k));
	return stableSort(keys, (a, b) => (rank(a) !== rank(b) ? rank(a) - rank(b) : a < b ? -1 : a > b ? 1 : 0));
}

function isArrayLike(t: object): boolean {
	return (
		(t as unknown as Array<unknown>)[0] !== undefined ||
		next(t as unknown as Record<string, unknown>)[0] === undefined
	);
}

function show(v: unknown): string {
	if (typeIs(v, "number")) return `${string.format("%.17g", v)} (${f64Hex(v)})`;
	if (typeIs(v, "string")) return `"${v}"`;
	return tostring(v);
}

/**
 * First difference between a fixture value and the port's value, as `path: expected X, got Y`, or undefined.
 * Numbers compare exactly (a fixture -0 must be -0; a fixture 0 also accepts -0 since JSON.stringify drops the sign).
 * A fixture key `fooHex` is checked as f64Hex(actual.foo). Keys present only in the port's value are reported too.
 */
export function firstDiff(expected: unknown, actual: unknown, path = "", opts: DiffOptions = {}): string | undefined {
	if (opts.ignore && opts.ignore(path)) return undefined;
	if (typeIs(expected, "number")) {
		if (!typeIs(actual, "number")) return `${path}: expected ${show(expected)}, got ${show(actual)}`;
		if (expected === actual && (!isNegZero(expected) || isNegZero(actual))) return undefined;
		if (
			opts.tolerate1Ulp &&
			opts.tolerate1Ulp(path) &&
			math.abs(ulpDistanceHex(f64Hex(expected), f64Hex(actual))) <= 1
		) {
			opts.tolerated?.push(path);
			return undefined;
		}
		return `${path}: expected ${show(expected)}, got ${show(actual)}`;
	}
	if (!typeIs(expected, "table")) {
		return expected === actual ? undefined : `${path}: expected ${show(expected)}, got ${show(actual)}`;
	}
	if (!typeIs(actual, "table")) return `${path}: expected a table, got ${show(actual)}`;
	if (isArrayLike(expected)) {
		const e = expected as unknown as ReadonlyArray<unknown>;
		const a = actual as unknown as ReadonlyArray<unknown>;
		if (e.size() !== a.size()) return `${path}: expected ${e.size()} entries, got ${a.size()}`;
		for (let i = 0; i < e.size(); i++) {
			const d = firstDiff(e[i], a[i], `${path}[${i}]`, opts);
			if (d !== undefined) return d;
		}
		return undefined;
	}
	const e = expected as unknown as Record<string, unknown>;
	const a = actual as unknown as Record<string, unknown>;
	const prefix = path === "" ? "" : `${path}.`;
	for (const k of sortedKeys(e, opts.keyOrder)) {
		const keyPath = prefix + k;
		const base =
			k.size() > HEX_SUFFIX.size() && string.sub(k, -HEX_SUFFIX.size()) === HEX_SUFFIX
				? string.sub(k, 1, -HEX_SUFFIX.size() - 1)
				: undefined;
		if (base !== undefined && e[base] !== undefined) {
			if (opts.ignore && opts.ignore(keyPath)) continue;
			const v = a[base];
			if (!typeIs(v, "number")) return `${keyPath}: expected a number at ${prefix}${base}, got ${show(v)}`;
			const got = f64Hex(v);
			if (got === e[k]) continue;
			if (
				opts.tolerate1Ulp &&
				opts.tolerate1Ulp(prefix + base) &&
				math.abs(ulpDistanceHex(e[k] as string, got)) <= 1
			)
				continue;
			return `${keyPath}: expected ${tostring(e[k])}, got ${got}`;
		}
		const d = firstDiff(e[k], a[k], keyPath, opts);
		if (d !== undefined) return d;
	}
	for (const k of sortedKeys(a)) {
		if (e[k] === undefined && !(opts.ignore && opts.ignore(prefix + k)))
			return `${prefix}${k}: not in the fixture, got ${show(a[k])}`;
	}
	return undefined;
}

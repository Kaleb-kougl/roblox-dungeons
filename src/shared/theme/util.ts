/**
 * Small pure helpers the theme layer needs because Luau has no JSON, RegExp or ordered object
 * keys. No Roblox types; runs headlessly.
 *
 * @module
 */

/** A JSON-style object: string keys, values not yet checked. */
export type Obj = Record<string, unknown>;

/** A table with an element at index 0 (Luau index 1): a JSON-style array. */
export function isArrayLike(v: unknown): v is ReadonlyArray<defined> {
	return typeIs(v, "table") && (v as ReadonlyArray<unknown>)[0] !== undefined;
}

/**
 * A JSON-style object. Luau cannot tell `{}` from `[]`, so an empty table counts as an object
 * (the source's `[]`-is-not-an-object check has no Luau equivalent).
 */
export function isObj(v: unknown): v is Obj {
	return typeIs(v, "table") && !isArrayLike(v);
}

/**
 * True for a whole, finite number (no NaN, no infinities; `-0` and negatives pass). The validator's base test for pixel
 * sizes, frame counts and indices read from a manifest.
 */
export function isInteger(v: unknown): v is number {
	return typeIs(v, "number") && v === v && v % 1 === 0 && v !== math.huge && v !== -math.huge;
}

/**
 * Entries of a table sorted by key. Luau's `pairs` order is unspecified; sorting keeps every
 * validator message and fallback deterministic (the source relied on JS insertion order).
 */
export function sortedEntries(o: object): Array<[string, unknown]> {
	const out = new Array<[string, unknown]>();
	// Viewed as a Map so `pairs` yields raw keys (no array index shift).
	for (const [k, v] of pairs(o as ReadonlyMap<unknown, unknown>)) {
		out.push([tostring(k), v]);
	}
	out.sort((a, b) => a[0] < b[0]);
	return out;
}

/**
 * The keys of a table as strings, sorted ascending (`sortedEntries` without the values), so callers list or compare
 * keys in a stable order.
 */
export function sortedKeys(o: object): Array<string> {
	return sortedEntries(o).map((e) => e[0]);
}

/**
 * True when `o` holds a value under `key`. Luau cannot tell an absent key from one set to `undefined`, so both count as
 * missing.
 */
export function hasKey(o: Obj, key: string): boolean {
	return o[key] !== undefined;
}

/**
 * True when `s` begins with `prefix`, compared as plain text (no Lua patterns). How an asset ID is matched to its slot
 * prefix.
 */
export function startsWith(s: string, prefix: string): boolean {
	return s.sub(1, prefix.size()) === prefix;
}

/** Plain substring test (no Lua patterns). */
export function contains(s: string, sub: string): boolean {
	return s.find(sub, 1, true)[0] !== undefined;
}

/** Whole-string Lua pattern match. `pattern` must be anchored with ^ and $. */
export function matches(s: string, pattern: string): boolean {
	return s.match(pattern)[0] !== undefined;
}

/** JSON.stringify for a string: double quotes, with `"` and `\` escaped. */
export function quote(s: string): string {
	const [escaped] = s.gsub('[\\"]', (c: string) => `\\${c}`);
	return `"${escaped}"`;
}

/** JSON.stringify-like rendering of any value, for messages. */
export function describeValue(v: unknown): string {
	if (v === undefined) {
		return "undefined";
	}
	if (typeIs(v, "string")) {
		return quote(v);
	}
	if (typeIs(v, "number") || typeIs(v, "boolean")) {
		return tostring(v);
	}
	if (isArrayLike(v)) {
		return `[${v.map((e) => describeValue(e)).join(",")}]`;
	}
	if (typeIs(v, "table")) {
		return `{${sortedEntries(v)
			.map(([k, e]) => `${quote(k)}:${describeValue(e)}`)
			.join(",")}}`;
	}
	return tostring(v);
}

/** Deep copy of plain data tables (manifests). Shares nothing with the input. */
export function deepClone<T>(v: T): T {
	if (!typeIs(v, "table")) {
		return v;
	}
	const out = new Map<unknown, unknown>();
	for (const [k, e] of pairs(v as unknown as ReadonlyMap<unknown, unknown>)) {
		out.set(k, deepClone(e));
	}
	return out as unknown as T;
}

/** `[...path, seg]` without a preceding spread (roblox-ts lint). */
export function append(path: ReadonlyArray<string>, ...segs: Array<string>): Array<string> {
	const out = [...path];
	for (const s of segs) {
		out.push(s);
	}
	return out;
}

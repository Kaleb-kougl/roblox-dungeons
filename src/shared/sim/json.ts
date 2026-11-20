/**
 * A small, strict JSON reader for recordings (the web build uses `JSON.parse`). Pure Luau: the sim may not use
 * HttpService, and serde-style parsers can round floats 1 ulp off (CLAUDE.md). Numbers go through Luau's `tonumber`,
 * which is correctly rounded like V8's parser, so every recording number reads back bit-exact.
 *
 * Values keep JSON's shape without Lua's nil holes: `null` is the `JSON_NULL` sentinel, arrays and objects are tagged.
 * Duplicate object keys: the last one wins (as in `JSON.parse`). Syntax errors throw `JSON.parse: <what> at <pos>`
 * (V8's SyntaxError wording is not reproduced; recordings never contain bad JSON from a real run).
 *
 * @module
 */

import { numberToJsString } from "./jsnum";

/** JSON `null`, as a tagged table so it never becomes a Lua nil hole. The only instance is `JSON_NULL`. */
export interface JsonNull {
	/** Tag that tells the three table-shaped values apart. */
	readonly kind: "null";
}
/** A JSON array, tagged so an empty one is distinguishable from an empty object. */
export interface JsonArray {
	/** Tag that tells the three table-shaped values apart. */
	readonly kind: "array";
	/** The elements in source order; a `null` element is `JSON_NULL`, so the array has no holes. */
	readonly items: JsonValue[];
}
/** A JSON object, tagged so an empty one is distinguishable from an empty array. */
export interface JsonObject {
	/** Tag that tells the three table-shaped values apart. */
	readonly kind: "object";
	/** The members by key (a duplicate key keeps its last value). Source key order is not kept. */
	readonly fields: Map<string, JsonValue>;
}
/** Any value `parseJson` can return: numbers, strings and booleans as themselves, the rest as tagged tables. */
export type JsonValue = number | string | boolean | JsonNull | JsonArray | JsonObject;

/** The one frozen `null` sentinel; compare with `===` or by `kind`. */
export const JSON_NULL: JsonNull = table.freeze({ kind: "null" });

const BYTE = {
	TAB: 9,
	LF: 10,
	CR: 13,
	SPACE: 32,
	QUOTE: 34,
	PLUS: 43,
	COMMA: 44,
	MINUS: 45,
	DOT: 46,
	SLASH: 47,
	ZERO: 48,
	NINE: 57,
	COLON: 58,
	UPPER_E: 69,
	LBRACKET: 91,
	BACKSLASH: 92,
	RBRACKET: 93,
	LOWER_E: 101,
	LBRACE: 123,
	RBRACE: 125,
	CONTROL_END: 0x20,
} as const;

const ESCAPES = new Map<string, string>([
	['"', '"'],
	["\\", "\\"],
	["/", "/"],
	["b", "\b"],
	["f", "\f"],
	["n", "\n"],
	["r", "\r"],
	["t", "\t"],
]);

const HIGH_SURROGATE_MIN = 0xd800;
const LOW_SURROGATE_MIN = 0xdc00;
const LOW_SURROGATE_MAX = 0xdfff;
const SURROGATE_BASE = 0x10000;
const SURROGATE_SHIFT = 0x400;
const HEX_DIGITS = 4;

class Reader {
	pos = 1;
	constructor(readonly text: string) {}

	fail(what: string): never {
		return error(`JSON.parse: ${what} at ${this.pos - 1}`, 0);
	}

	peek(): number | undefined {
		return string.byte(this.text, this.pos)[0];
	}

	skipWhitespace(): void {
		for (;;) {
			const b = this.peek();
			if (b === BYTE.SPACE || b === BYTE.TAB || b === BYTE.LF || b === BYTE.CR) this.pos++;
			else return;
		}
	}

	expectLiteral(word: string, value: JsonValue): JsonValue {
		if (string.sub(this.text, this.pos, this.pos + word.size() - 1) !== word) this.fail("unexpected token");
		this.pos += word.size();
		return value;
	}

	digits(): number {
		const start = this.pos;
		for (;;) {
			const b = this.peek();
			if (b !== undefined && b >= BYTE.ZERO && b <= BYTE.NINE) this.pos++;
			else break;
		}
		return this.pos - start;
	}

	number(): number {
		const start = this.pos;
		if (this.peek() === BYTE.MINUS) this.pos++;
		if (this.peek() === BYTE.ZERO) this.pos++;
		else if (this.digits() === 0) this.fail("bad number");
		if (this.peek() === BYTE.DOT) {
			this.pos++;
			if (this.digits() === 0) this.fail("bad number");
		}
		const e = this.peek();
		if (e === BYTE.LOWER_E || e === BYTE.UPPER_E) {
			this.pos++;
			const sign = this.peek();
			if (sign === BYTE.PLUS || sign === BYTE.MINUS) this.pos++;
			if (this.digits() === 0) this.fail("bad number");
		}
		const value = tonumber(string.sub(this.text, start, this.pos - 1));
		if (value === undefined) return this.fail("bad number");
		return value;
	}

	hex4(): number {
		const s = string.sub(this.text, this.pos, this.pos + HEX_DIGITS - 1);
		const [ok] = string.find(s, "^%x%x%x%x$");
		if (ok === undefined) this.fail("bad unicode escape");
		this.pos += HEX_DIGITS;
		return tonumber(s, 16) ?? 0;
	}

	str(): string {
		this.pos++; // opening quote
		const parts: string[] = [];
		for (;;) {
			const b = this.peek();
			if (b === undefined) this.fail("unterminated string");
			if (b === BYTE.QUOTE) {
				this.pos++;
				return parts.join("");
			}
			if (b < BYTE.CONTROL_END) this.fail("bad control character in string");
			if (b === BYTE.BACKSLASH) {
				const c = string.sub(this.text, this.pos + 1, this.pos + 1);
				this.pos += 2;
				const simple = ESCAPES.get(c);
				if (simple !== undefined) {
					parts.push(simple);
				} else if (c === "u") {
					let code = this.hex4();
					if (
						code >= HIGH_SURROGATE_MIN &&
						code < LOW_SURROGATE_MIN &&
						string.sub(this.text, this.pos, this.pos + 1) === "\\u"
					) {
						const save = this.pos;
						this.pos += 2;
						const low = this.hex4();
						if (low >= LOW_SURROGATE_MIN && low <= LOW_SURROGATE_MAX) {
							code =
								SURROGATE_BASE +
								(code - HIGH_SURROGATE_MIN) * SURROGATE_SHIFT +
								(low - LOW_SURROGATE_MIN);
						} else {
							this.pos = save;
						}
					}
					parts.push(utf8.char(code));
				} else {
					this.fail("bad escape");
				}
			} else {
				parts.push(string.sub(this.text, this.pos, this.pos));
				this.pos++;
			}
		}
	}

	value(): JsonValue {
		this.skipWhitespace();
		const b = this.peek();
		if (b === undefined) return this.fail("unexpected end of input");
		if (b === BYTE.LBRACE) return this.object();
		if (b === BYTE.LBRACKET) return this.array();
		if (b === BYTE.QUOTE) return this.str();
		if (b === BYTE.MINUS || (b >= BYTE.ZERO && b <= BYTE.NINE)) return this.number();
		if (string.sub(this.text, this.pos, this.pos) === "t") return this.expectLiteral("true", true);
		if (string.sub(this.text, this.pos, this.pos) === "f") return this.expectLiteral("false", false);
		if (string.sub(this.text, this.pos, this.pos) === "n") return this.expectLiteral("null", JSON_NULL);
		return this.fail("unexpected token");
	}

	array(): JsonArray {
		this.pos++;
		const items: JsonValue[] = [];
		this.skipWhitespace();
		if (this.peek() === BYTE.RBRACKET) {
			this.pos++;
			return { kind: "array", items };
		}
		for (;;) {
			items.push(this.value());
			this.skipWhitespace();
			const b = this.peek();
			this.pos++;
			if (b === BYTE.RBRACKET) return { kind: "array", items };
			if (b !== BYTE.COMMA) this.fail("expected ',' or ']'");
		}
	}

	object(): JsonObject {
		this.pos++;
		const fields = new Map<string, JsonValue>();
		this.skipWhitespace();
		if (this.peek() === BYTE.RBRACE) {
			this.pos++;
			return { kind: "object", fields };
		}
		for (;;) {
			this.skipWhitespace();
			if (this.peek() !== BYTE.QUOTE) this.fail("expected a string key");
			const key = this.str();
			this.skipWhitespace();
			if (this.peek() !== BYTE.COLON) this.fail("expected ':'");
			this.pos++;
			fields.set(key, this.value());
			this.skipWhitespace();
			const b = this.peek();
			this.pos++;
			if (b === BYTE.RBRACE) return { kind: "object", fields };
			if (b !== BYTE.COMMA) this.fail("expected ',' or '}'");
		}
	}
}

/** `JSON.parse(text)`. Throws on malformed input or trailing garbage. */
export function parseJson(text: string): JsonValue {
	const r = new Reader(text);
	const v = r.value();
	r.skipWhitespace();
	if (r.peek() !== undefined) r.fail("unexpected trailing input");
	return v;
}

/** True when `v` is a parsed JSON array (not undefined, a primitive, null or an object). */
export function isJsonArray(v: JsonValue | undefined): v is JsonArray {
	return typeIs(v, "table") && v.kind === "array";
}

/** True when `v` is a parsed JSON object (not undefined, a primitive, null or an array). */
export function isJsonObject(v: JsonValue | undefined): v is JsonObject {
	return typeIs(v, "table") && v.kind === "object";
}

/** `String(v)` of a parsed JSON value (or undefined), as a JS template string would print it in an error message. */
export function jsonToJsString(v: JsonValue | undefined): string {
	if (v === undefined) return "undefined";
	if (typeIs(v, "number")) return numberToJsString(v);
	if (typeIs(v, "string")) return v;
	if (typeIs(v, "boolean")) return v ? "true" : "false";
	if (v.kind === "null") return "null";
	if (v.kind === "object") return "[object Object]";
	// Array.prototype.toString: elements joined by ",", null / undefined as "".
	const parts: string[] = [];
	for (const item of v.items) parts.push(typeIs(item, "table") && item.kind === "null" ? "" : jsonToJsString(item));
	return parts.join(",");
}

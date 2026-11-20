/**
 * The generated locale tables' validator (docs/LOCALIZATION.md design 2, L3), in its own module: validate.ts sits at
 * Luau's 200 top-level locals. For each entry of a table (key -> [text, srcHash]):
 *   - the key is in the English table and is translatable (shared/l10n isTranslatableStringKey: not developer-only,
 *     LD10, and not in UNTRANSLATED_STRING_KEYS; the pipeline never exports either);
 *   - the entry is a [string, uint32] pair;
 *   - the text is valid UTF-8 and its braces are well formed (templateProblem);
 *   - the placeholder multiset equals the English one (placeholderMismatch);
 *   - for Latin and Cyrillic scripts, a translation of an all-caps English string has no lowercase letters
 *     (translators supply the caps form: code never upper-cases translated text; breaksAllCaps).
 * A stale entry (srcHash is not sourceHash of the current English) is expected: the pipeline writes the hash of the
 * Source it was translated from, and ThemeCore shows English instead. Its placeholders and caps are checked against
 * that old Source on import, so here they are not compared with the current English.
 *
 * The all-caps rule is shared with the node pipeline (scripts/l10n lib.js capsProblem reads LOWERCASE_RANGES from
 * this file), so a table the import accepts always passes this validator.
 *
 * @module
 */
import {
	isDevOnlyStringKey,
	isTranslatableStringKey,
	sourceHash,
	type LocaleScript,
	type LocaleTable,
} from "shared/l10n";
import { placeholderMismatch, templateProblem } from "./strings";
import { hasKey, isInteger, sortedEntries, type Obj } from "./util";

/** One problem with one entry of a locale table. */
export interface LocaleTableProblem {
	readonly key: string;
	readonly message: string;
}

/** Scripts with letter case: the all-caps rule applies to them. */
export const CASED_SCRIPTS: ReadonlyArray<LocaleScript> = ["latin", "cyrillic"];

/** A source hash is an unsigned 32-bit integer. */
const UINT32_MAX = 0xffffffff;

/** How a range of code points is cased: every one lower case, none, or the odd / even ones (upper / lower pairs). */
export type CaseRule = "lower" | "none" | "odd" | "even";

/**
 * Lowercase letters among the code points Latin and Cyrillic translations use (Unicode data; the first range that
 * holds a code point decides). ß and ĸ have no traditional capital, so they pass in caps text; a code point no range
 * holds (Latin Extended-B, Cyrillic Supplement, ...) is not lowercase (lenient). The node pipeline parses this literal
 * (scripts/l10n lib.js lowercaseRanges): keep it a plain array of [number, number, "rule"] literals.
 */
export const LOWERCASE_RANGES: ReadonlyArray<readonly [from: number, to: number, rule: CaseRule]> = [
	[0x61, 0x7a, "lower"], // a-z
	[0xdf, 0xdf, "none"], // ß
	[0xf7, 0xf7, "none"], // ÷
	[0xe0, 0xff, "lower"], // à-ÿ
	[0x131, 0x131, "lower"], // ı
	[0x138, 0x138, "none"], // ĸ
	[0x149, 0x149, "lower"], // ŉ
	[0x17f, 0x17f, "lower"], // ſ
	[0x139, 0x148, "even"], // Ĺ ĺ ... Ň ň
	[0x179, 0x17e, "even"], // Ź ź ... Ž ž
	[0x100, 0x17f, "odd"], // Ā ā ... (Latin Extended-A)
	[0x1a0, 0x1a1, "odd"], // Ơ ơ (Vietnamese)
	[0x1af, 0x1b0, "even"], // Ư ư (Vietnamese)
	[0x218, 0x21b, "odd"], // Ș ș Ț ț
	[0x430, 0x45f, "lower"], // а-я, ѐ-џ
	[0x460, 0x481, "odd"], // Ѡ ѡ ...
	[0x48a, 0x4bf, "odd"], // Ҋ ҋ ...
	[0x1e96, 0x1e9d, "lower"], // ẖ ... ẝ
	[0x1e9e, 0x1e9e, "none"], // ẞ
	[0x1e00, 0x1eff, "odd"], // Ḁ ḁ ... Ạ ạ ... (Latin Extended Additional, Vietnamese)
];

const PARITY = 2;

/** Is code point `cp` a lowercase letter (LOWERCASE_RANGES)? */
export function isLowercaseCodepoint(cp: number): boolean {
	for (const [from, to, rule] of LOWERCASE_RANGES) {
		if (cp < from || cp > to) continue;
		if (rule === "lower") return true;
		if (rule === "none") return false;
		return rule === "odd" ? cp % PARITY === 1 : cp % PARITY === 0;
	}
	return false;
}

/** `text` with its `{name}` placeholders removed (their names are lower case by convention). */
function withoutPlaceholders(text: string): string {
	const [out] = text.gsub("{[%w_]+}", "");
	return out;
}

/** An English string with an ASCII capital and no ASCII lowercase letter, placeholders aside ("NEW BEST +{points}"). */
export function isAllCaps(english: string): boolean {
	const bare = withoutPlaceholders(english);
	return bare.find("%u")[0] !== undefined && bare.find("%l")[0] === undefined;
}

/** Is `text` valid UTF-8? (`utf8.len` returns nil and the bad byte's position otherwise.) */
export function isValidUtf8(text: string): boolean {
	return typeIs(utf8.len(text)[0], "number");
}

/** Does `text` hold a lowercase letter, placeholders aside? Invalid UTF-8 counts as none (reported separately). */
export function hasLowercase(text: string): boolean {
	const bare = withoutPlaceholders(text);
	if (!isValidUtf8(bare)) return false;
	for (const [, cp] of utf8.codes(bare)) if (isLowercaseCodepoint(cp)) return true;
	return false;
}

/**
 * The all-caps rule (the same as scripts/l10n lib.js capsProblem): in a cased script (CASED_SCRIPTS), a translation
 * of an all-caps English string (isAllCaps) must hold no lowercase letter (hasLowercase), placeholders aside.
 */
export function breaksAllCaps(english: string, text: string, writing: LocaleScript): boolean {
	return CASED_SCRIPTS.includes(writing) && isAllCaps(english) && hasLowercase(text);
}

/**
 * The problems of one translation of `english` (UTF-8, braces, placeholders, caps); empty when it is fine. `stale`:
 * the entry was translated from other English, so only the checks that don't compare with it run (UTF-8, braces).
 */
export function localeTextProblems(english: string, text: string, writing: LocaleScript, stale = false): string[] {
	const out: string[] = [];
	if (!isValidUtf8(text)) out.push("is not valid UTF-8");
	const braces = templateProblem(text);
	if (braces !== undefined) out.push(braces);
	if (stale) return out;
	const mismatch = placeholderMismatch(english, text);
	if (mismatch !== undefined) out.push(mismatch);
	if (breaksAllCaps(english, text, writing)) out.push("translates an all-caps English string with lowercase letters");
	return out;
}

/**
 * Every problem of a generated locale table against the English table it translates (a pack's `strings`), sorted by
 * key. `writing`: the locale's LocaleDef.script (the caps rule).
 */
export function validateLocaleTable(
	english: Readonly<Record<string, unknown>>,
	entries: LocaleTable,
	writing: LocaleScript,
): LocaleTableProblem[] {
	const out: LocaleTableProblem[] = [];
	const source = english as Obj;
	for (const [key, entry] of sortedEntries(entries)) {
		const push = (message: string) => out.push({ key, message });
		if (isDevOnlyStringKey(key)) push("is a developer-only key (never translated)");
		else if (!isTranslatableStringKey(key))
			push("is an untranslated key (UNTRANSLATED_STRING_KEYS: always English)");
		const text = typeIs(entry, "table") ? (entry as unknown as ReadonlyArray<unknown>)[0] : undefined;
		const hash = typeIs(entry, "table") ? (entry as unknown as ReadonlyArray<unknown>)[1] : undefined;
		if (!typeIs(text, "string") || !isInteger(hash) || hash < 0 || hash > UINT32_MAX) {
			push("must be [text, srcHash] (a string and an unsigned 32-bit integer)");
			continue;
		}
		const englishText = source[key];
		if (!hasKey(source, key) || !typeIs(englishText, "string")) {
			push("not in the English string table");
			continue;
		}
		const stale = hash !== sourceHash(englishText);
		for (const message of localeTextProblems(englishText, text, writing, stale)) push(message);
	}
	return out;
}

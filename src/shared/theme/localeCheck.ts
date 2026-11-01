/**
 * The generated locale tables' validator (docs/LOCALIZATION.md design 2, L3), in its own module: validate.ts sits at
 * Luau's 200 top-level locals. For each entry of a table (key -> [text, srcHash]):
 *   - the key is in the English table and is not developer-only (LD10: never exported);
 *   - the entry is a [string, uint32] pair;
 *   - the braces are well formed (templateProblem);
 *   - the placeholder multiset equals the English one (placeholderMismatch);
 *   - for Latin and Cyrillic scripts, a translation of an all-caps English string has no lowercase letters
 *     (translators supply the caps form: code never upper-cases translated text).
 * A stale srcHash is not a problem here (the English moved on; ThemeCore falls back and reports it).
 */
import { isDevOnlyStringKey, type LocaleScript, type LocaleTable } from "shared/l10n";
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
type CaseRule = "lower" | "none" | "odd" | "even";

/**
 * Lowercase letters among the code points Latin and Cyrillic translations use (Unicode data; the first range that
 * holds a code point decides). ß and ĸ have no traditional capital, so they pass in caps text.
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

/** The problems of one translation of `english` (braces, placeholders, caps, UTF-8); empty when it is fine. */
export function localeTextProblems(english: string, text: string, writing: LocaleScript): string[] {
	const out: string[] = [];
	if (!isValidUtf8(text)) out.push("is not valid UTF-8");
	const braces = templateProblem(text);
	if (braces !== undefined) out.push(braces);
	const mismatch = placeholderMismatch(english, text);
	if (mismatch !== undefined) out.push(mismatch);
	if (CASED_SCRIPTS.includes(writing) && isAllCaps(english) && hasLowercase(text))
		out.push("translates an all-caps English string with lowercase letters");
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
		for (const message of localeTextProblems(englishText, text, writing)) push(message);
	}
	return out;
}

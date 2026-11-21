/**
 * The pseudo-locale (docs/LOCALIZATION.md L8, PSEUDO_LOCALE "en-XA"): English with every ASCII letter accented, about
 * 40 % longer and wrapped in ⟦ ⟧, so text that bypassed `str` (plain English on screen) and slots too tight for a
 * longer translation stand out. `{placeholder}` tokens stay byte for byte, so interpolation still works. UTF-8 safe:
 * bytes that are not ASCII letters (multi-byte characters included) are copied as they are.
 *
 * @module
 */

/** Each ASCII letter's accented stand-in (case kept, so an all-caps string stays all caps). */
export const PSEUDO_LETTERS: ReadonlyMap<string, string> = new Map<string, string>([
	["a", "á"],
	["b", "ƀ"],
	["c", "ç"],
	["d", "ð"],
	["e", "é"],
	["f", "ƒ"],
	["g", "ĝ"],
	["h", "ĥ"],
	["i", "í"],
	["j", "ĵ"],
	["k", "ķ"],
	["l", "ĺ"],
	["m", "ɱ"],
	["n", "ñ"],
	["o", "ó"],
	["p", "þ"],
	["q", "ǫ"],
	["r", "ŕ"],
	["s", "š"],
	["t", "ţ"],
	["u", "ú"],
	["v", "ṽ"],
	["w", "ŵ"],
	["x", "ẋ"],
	["y", "ý"],
	["z", "ž"],
	["A", "Á"],
	["B", "Ɓ"],
	["C", "Ç"],
	["D", "Ð"],
	["E", "É"],
	["F", "Ƒ"],
	["G", "Ĝ"],
	["H", "Ĥ"],
	["I", "Í"],
	["J", "Ĵ"],
	["K", "Ķ"],
	["L", "Ĺ"],
	["M", "Ṁ"],
	["N", "Ñ"],
	["O", "Ó"],
	["P", "Þ"],
	["Q", "Ǫ"],
	["R", "Ŕ"],
	["S", "Š"],
	["T", "Ţ"],
	["U", "Ú"],
	["V", "Ṽ"],
	["W", "Ŵ"],
	["X", "Ẋ"],
	["Y", "Ý"],
	["Z", "Ž"],
]);

/** How a pseudo string is built. */
export const PSEUDO = {
	open: "⟦",
	close: "⟧",
	/** Padding added, as a fraction of the English length in characters (rounded up). */
	padRatio: 0.4,
	/** The padding character (ASCII, so every font draws it). */
	pad: "~",
} as const;

/** A placeholder token at the start of the rest of a string (the theme's `{name}` syntax: letters, digits, _). */
const PLACEHOLDER_AT = "^{[%w_]+}";
const OPEN_BRACE = 0x7b;
/** UTF-8 continuation bytes (0x80-0xBF) don't start a character. */
const CONTINUATION_MIN = 0x80;
const CONTINUATION_MAX = 0xbf;

/** Characters (UTF-8 code points) in `text`: bytes that are not continuation bytes. */
export function charCount(text: string): number {
	let n = 0;
	const size = text.size();
	for (let i = 1; i <= size; i++) {
		const [b] = string.byte(text, i);
		if (b < CONTINUATION_MIN || b > CONTINUATION_MAX) n++;
	}
	return n;
}

/** `text` in the pseudo-locale: letters accented, placeholders intact, padded about 40 %, wrapped in ⟦ ⟧. */
export function pseudoLocalize(text: string): string {
	const parts: string[] = [];
	const size = text.size();
	let i = 1;
	while (i <= size) {
		const [b] = string.byte(text, i);
		if (b === OPEN_BRACE) {
			const [s, e] = string.find(text, PLACEHOLDER_AT, i);
			if (s !== undefined && e !== undefined) {
				parts.push(string.sub(text, s, e));
				i = e + 1;
				continue;
			}
		}
		const ch = string.sub(text, i, i);
		parts.push(PSEUDO_LETTERS.get(ch) ?? ch);
		i++;
	}
	const pad = string.rep(PSEUDO.pad, math.ceil(charCount(text) * PSEUDO.padRatio));
	return `${PSEUDO.open}${parts.join("")}${pad}${PSEUDO.close}`;
}

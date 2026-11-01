/**
 * Locale-aware number text (docs/LOCALIZATION.md design 1, LD9): grouped thousands and decimals with the locale's
 * separators (LocaleDef.number), ASCII digits in every locale. Clocks and countdowns (`m:ss`, `h:mm:ss`) don't change.
 *
 * The number locale is presentation-only module state, so callers keep their signatures: the theme pack's
 * `setLocale` sets it (shared/theme ThemeCore), every helper reads it unless handed a locale code. Specs that set it
 * reset it to SOURCE_LOCALE afterwards. An unknown code formats like the source locale.
 */
import { SOURCE_LOCALE, localeDef, type LocaleNumberFormat } from "./locales";

/** How numbers are grouped and split. */
export const NUMBER_FORMAT = {
	/** Digits per group ("1,240,000"). */
	groupDigits: 3,
	/** Tenths per whole (formatTenths: 13 -> "1.3"). */
	tenthsPerUnit: 10,
} as const;

const SOURCE_FORMAT: LocaleNumberFormat = (localeDef(SOURCE_LOCALE) as NonNullable<ReturnType<typeof localeDef>>)
	.number;

let currentCode = SOURCE_LOCALE;
let currentFormat = SOURCE_FORMAT;

function formatOf(code: string): LocaleNumberFormat {
	return localeDef(code)?.number ?? SOURCE_FORMAT;
}

/** Set the locale numbers are written in (ThemeCore.setLocale calls it). */
export function setNumberLocale(code: string): void {
	currentCode = code;
	currentFormat = formatOf(code);
}

/** The locale numbers are written in (default SOURCE_LOCALE). */
export function numberLocale(): string {
	return currentCode;
}

/** The separators for `locale`, or the current number locale's. */
export function numberFormatFor(locale?: string): LocaleNumberFormat {
	return locale === undefined ? currentFormat : formatOf(locale);
}

/** Digits with `group` every NUMBER_FORMAT.groupDigits from the right ("1240" -> "1,240"). */
function groupDigits(digits: string, group: string): string {
	const size = digits.size();
	let out = "";
	for (let i = 1; i <= size; i++) {
		out += string.sub(digits, i, i);
		const left = size - i;
		if (left > 0 && left % NUMBER_FORMAT.groupDigits === 0) out += group;
	}
	return out;
}

/**
 * A whole number with the locale's group separator ("1,240" / "1.240" / "1 240" with a no-break space; negatives keep
 * their sign; fractions are floored toward zero).
 */
export function formatThousands(n: number, locale?: string): string {
	const whole = math.floor(math.abs(n));
	const out = groupDigits(string.format("%d", whole), numberFormatFor(locale).group);
	return n < 0 && whole > 0 ? `-${out}` : out;
}

/**
 * `value` with `places` decimals (rounded like `%.<places>f`) and the locale's decimal separator ("1.5" / "1,5").
 * Not grouped: for small values (damage numbers, timings). `places` 0 prints no separator.
 */
export function formatDecimal(value: number, places: number, locale?: string): string {
	const text = string.format(`%.${math.max(0, math.floor(places))}f`, value);
	const [out] = text.gsub("%.", numberFormatFor(locale).decimal);
	return out;
}

/** Whole tenths as one decimal ("13" -> "1.3" / "1,3"): exact, no float rounding (the combo multiplier). */
export function formatTenths(tenths: number, locale?: string): string {
	const whole = math.floor(tenths / NUMBER_FORMAT.tenthsPerUnit);
	const tenth = tenths % NUMBER_FORMAT.tenthsPerUnit;
	return `${whole}${numberFormatFor(locale).decimal}${tenth}`;
}

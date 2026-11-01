import { afterEach, describe, expect, it } from "@rbxts/jest-globals";
import {
	SOURCE_LOCALE,
	formatDecimal,
	formatTenths,
	formatThousands,
	numberFormatFor,
	numberLocale,
	setNumberLocale,
} from "shared/l10n";

const NBSP = string.char(0xc2, 0xa0);

describe("number formatting", () => {
	afterEach(() => setNumberLocale(SOURCE_LOCALE));

	it("groups thousands per locale (a no-break space never wraps a number)", () => {
		expect(numberFormatFor("fr").group).toBe(NBSP);
		expect(formatThousands(1240, "en")).toBe("1,240");
		expect(formatThousands(1240, "de")).toBe("1.240");
		expect(formatThousands(1240, "fr")).toBe(`1${NBSP}240`);
		expect(formatThousands(1234567, "ru")).toBe(`1${NBSP}234${NBSP}567`);
		expect(formatThousands(999, "de")).toBe("999");
		expect(formatThousands(0, "en")).toBe("0");
	});
	it("keeps signs, floors fractions toward zero and never writes -0", () => {
		expect(formatThousands(-1240, "en")).toBe("-1,240");
		expect(formatThousands(-1240.7, "de")).toBe("-1.240");
		expect(formatThousands(23410.9, "en")).toBe("23,410");
		expect(formatThousands(-0.5, "en")).toBe("0");
	});
	it("writes decimals with the locale's separator, ungrouped", () => {
		expect(formatDecimal(12.26, 1, "en")).toBe("12.3");
		expect(formatDecimal(12.5, 1, "de")).toBe("12,5");
		expect(formatDecimal(1234.5, 1, "fr")).toBe("1234,5");
		expect(formatDecimal(-3.5, 1, "pt-BR")).toBe("-3,5");
		expect(formatDecimal(7, 0, "de")).toBe("7");
	});
	it("writes tenths exactly", () => {
		expect(formatTenths(13, "en")).toBe("1.3");
		expect(formatTenths(10, "de")).toBe("1,0");
		expect(formatTenths(345, "ru")).toBe("34,5");
	});
	it("follows the number locale when no locale is passed, and unknown codes read like the source", () => {
		expect(numberLocale()).toBe(SOURCE_LOCALE);
		expect(formatThousands(1240)).toBe("1,240");
		setNumberLocale("de");
		expect(numberLocale()).toBe("de");
		expect(formatThousands(1240)).toBe("1.240");
		expect(formatTenths(13)).toBe("1,3");
		expect(formatDecimal(1.5, 1)).toBe("1,5");
		expect(formatThousands(1240, "en")).toBe("1,240");
		setNumberLocale("xx");
		expect(formatThousands(1240)).toBe("1,240");
		expect(numberFormatFor("xx")).toEqual(numberFormatFor(SOURCE_LOCALE));
	});
	it("writes ASCII digits in every locale (LD9)", () => {
		expect(formatThousands(9876543, "ar")).toBe("9,876,543");
		expect(formatThousands(9876543, "hi")).toBe("9,876,543");
	});
});

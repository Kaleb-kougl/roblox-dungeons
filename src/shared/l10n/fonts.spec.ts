import { describe, expect, it } from "@rbxts/jest-globals";
import { L10N_FONTS, LOCALES, PSEUDO_LOCALE, fontsFor, scaledTextSize } from "shared/l10n";

describe("L10N_FONTS / fontsFor", () => {
	it("gives every locale a full font set", () => {
		for (const l of LOCALES) {
			const f = fontsFor(l.code);
			expect(f).toBe(L10N_FONTS[l.script]);
			expect(f.text.size() > 0 && f.mono.size() > 0 && f.name.size() > 0).toBe(true);
			expect(f.sizeScale > 0).toBe(true);
		}
	});
	it("keeps today's HUD fonts for Latin (provisional until L0) and falls back to the source locale's", () => {
		expect(fontsFor("en")).toEqual({ text: "Arcade", mono: "Code", name: "BuilderSans", sizeScale: 1 });
		expect(fontsFor(PSEUDO_LOCALE)).toBe(L10N_FONTS.latin);
		expect(fontsFor("xx")).toBe(L10N_FONTS.latin);
		expect(fontsFor("ja").text).toBe("BuilderSans");
	});
	it("names real Enum.Font items", () => {
		const names = new Set<string>();
		for (const item of Enum.Font.GetEnumItems()) names.add(item.Name);
		for (const l of LOCALES) {
			const f = fontsFor(l.code);
			expect(names.has(f.text)).toBe(true);
			expect(names.has(f.mono)).toBe(true);
			expect(names.has(f.name)).toBe(true);
		}
	});
});

describe("scaledTextSize", () => {
	it("keeps the size at scale 1 and rounds to whole px otherwise", () => {
		expect(scaledTextSize(16, 1)).toBe(16);
		expect(scaledTextSize(15.5, 1)).toBe(15.5);
		expect(scaledTextSize(16, 1.15)).toBe(18);
		expect(scaledTextSize(20, 1.1)).toBe(22);
		expect(scaledTextSize(1, 0.1)).toBe(1);
	});
});

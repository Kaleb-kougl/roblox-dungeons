// The client's locale state (docs/LOCALIZATION.md L6) and the fit audit's rules (L9).
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	FitAuditLog,
	PSEUDO_LOCALE,
	SOURCE_LOCALE,
	SOURCE_LOCALE_STATE,
	fitAuditLine,
	isTextMisfit,
	localeReportLines,
	localeStateOf,
	resolveLocaleState,
	sameLocaleState,
} from "shared/l10n";

describe("locale state", () => {
	it("starts as English, automatic, Latin, left to right", () => {
		expect(SOURCE_LOCALE_STATE).toEqual({ code: SOURCE_LOCALE, auto: true, script: "latin", rtl: false });
	});
	it("carries the picked code's script and direction", () => {
		expect(localeStateOf({ code: "ar", auto: false })).toEqual({
			code: "ar",
			auto: false,
			script: "arabic",
			rtl: true,
		});
		expect(localeStateOf({ code: "ja", auto: true }).script).toBe("cjk");
		expect(localeStateOf({ code: "xx", auto: true })).toEqual({
			code: "xx",
			auto: true,
			script: "latin",
			rtl: false,
		});
	});
	it("resolves like pickLocale: hidden locales only as a developer's explicit pick", () => {
		expect(resolveLocaleState(["de-de"], undefined)).toEqual(SOURCE_LOCALE_STATE);
		// The automatic pick stays live-only, developers included.
		expect(resolveLocaleState(["de-de"], undefined, { allowHidden: true })).toEqual(SOURCE_LOCALE_STATE);
		expect(resolveLocaleState(["de-de"], "de", { allowHidden: true }).code).toBe("de");
		expect(resolveLocaleState([], PSEUDO_LOCALE)).toEqual(SOURCE_LOCALE_STATE);
		const pseudo = resolveLocaleState([], PSEUDO_LOCALE, { allowHidden: true });
		expect(pseudo).toEqual({ code: PSEUDO_LOCALE, auto: false, script: "latin", rtl: false });
	});
	it("compares by value", () => {
		expect(sameLocaleState(SOURCE_LOCALE_STATE, localeStateOf({ code: SOURCE_LOCALE, auto: true }))).toBe(true);
		expect(sameLocaleState(SOURCE_LOCALE_STATE, localeStateOf({ code: SOURCE_LOCALE, auto: false }))).toBe(false);
	});
});

describe("fit audit rules", () => {
	const misfit = { visible: true, fits: false, scaled: false, truncated: false, text: "Weiterspielen" };
	it("reports a visible text that does not fit", () => {
		expect(isTextMisfit(misfit)).toBe(true);
	});
	it("skips hidden, fitting, scaled, truncated and blank text", () => {
		expect(isTextMisfit({ ...misfit, visible: false })).toBe(false);
		expect(isTextMisfit({ ...misfit, fits: true })).toBe(false);
		expect(isTextMisfit({ ...misfit, scaled: true })).toBe(false);
		expect(isTextMisfit({ ...misfit, truncated: true })).toBe(false);
		expect(isTextMisfit({ ...misfit, text: " \n\t" })).toBe(false);
		expect(isTextMisfit({ ...misfit, text: "" })).toBe(false);
	});
	it("logs each instance path and text once per locale", () => {
		const log = new FitAuditLog();
		expect(log.report("de", "PlayerGui.Hud.Label", "a")).toBe(true);
		expect(log.report("de", "PlayerGui.Hud.Label", "a")).toBe(false);
		expect(log.report("de", "PlayerGui.Hud.Label", "b")).toBe(true);
		expect(log.report("ru", "PlayerGui.Hud.Label", "a")).toBe(true);
		log.clear();
		expect(log.report("de", "PlayerGui.Hud.Label", "a")).toBe(true);
	});
	it("names the locale, the path and the text", () => {
		expect(fitAuditLine("PlayerGui.Hud.Label", "de", "Weiter")).toBe(
			'[LocaleAudit] misfit [de] PlayerGui.Hud.Label: "Weiter"',
		);
	});
});

describe("localeReportLines", () => {
	it("summarizes, then lists only the non-empty groups", () => {
		expect(localeReportLines("de", { stale: [], mismatched: [], unknown: [] })).toEqual([
			"[LocaleAudit] locale de: 0 stale, 0 mismatched, 0 unknown",
		]);
		expect(localeReportLines("de", { stale: ["a", "b"], mismatched: [], unknown: ["z"] })).toEqual([
			"[LocaleAudit] locale de: 2 stale, 0 mismatched, 1 unknown",
			"[LocaleAudit]   stale: a, b",
			"[LocaleAudit]   unknown: z",
		]);
	});
});

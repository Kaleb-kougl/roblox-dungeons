import { describe, expect, it } from "@rbxts/jest-globals";
import { isDevOnlyStringKey, LOCALES, localeDef, PSEUDO_LOCALE, SOURCE_LOCALE, sourceHash } from "shared/l10n";

describe("sourceHash", () => {
	it("is FNV-1a 32 over UTF-8 bytes (published vectors)", () => {
		expect(sourceHash("")).toBe(0x811c9dc5);
		expect(sourceHash("a")).toBe(0xe40c292c);
		expect(sourceHash("foobar")).toBe(0xbf9cf968);
	});
	it("hashes multi-byte text by its bytes", () => {
		expect(sourceHash("é")).toBe(sourceHash("é"));
		expect(sourceHash("é")).never.toBe(sourceHash("e"));
	});
});

describe("LOCALES", () => {
	it("has unique codes and unique Roblox ids, the source first and live", () => {
		const codes = new Set<string>();
		const ids = new Set<string>();
		for (const l of LOCALES) {
			expect(codes.has(l.code)).toBe(false);
			codes.add(l.code);
			for (const id of l.roblox) {
				expect(ids.has(id)).toBe(false);
				ids.add(id);
			}
		}
		expect(LOCALES[0].code).toBe(SOURCE_LOCALE);
		expect(LOCALES[0].status).toBe("live");
		expect(localeDef(PSEUDO_LOCALE)?.pseudo).toBe(true);
		expect(localeDef(PSEUDO_LOCALE)?.status).toBe("hidden");
	});
	it("covers the 17 auto-translate languages plus English and the pseudo-locale", () => {
		expect(LOCALES.size()).toBe(19);
	});
});

describe("isDevOnlyStringKey", () => {
	it("matches the playtest overlay and debug lines only", () => {
		expect(isDevOnlyStringKey("playtest.badge")).toBe(true);
		expect(isDevOnlyStringKey("hud.debug.net")).toBe(true);
		expect(isDevOnlyStringKey("hud.score")).toBe(false);
	});
	it("lets players read the run-over panel's playtest.run.* labels", () => {
		expect(isDevOnlyStringKey("playtest.run.over")).toBe(false);
		expect(isDevOnlyStringKey("playtest.run.kills")).toBe(false);
		expect(isDevOnlyStringKey("playtest.run.attempt")).toBe(true);
	});
});

// docs/LOCALIZATION.md L3: the theme's locale lookup (pack override > generated table with a matching source hash and
// placeholders > English), setLocale, the pseudo-locale, developer keys, the generated tables' validator and the
// committed tables (shared/theme/locales).
import { afterEach, describe, expect, it } from "@rbxts/jest-globals";
import {
	LOCALES,
	PSEUDO_LOCALE,
	SOURCE_LOCALE,
	formatThousands,
	localeDef,
	numberLocale,
	pseudoLocalize,
	setNumberLocale,
	sourceHash,
	type LocaleTable,
} from "shared/l10n";
import {
	LOCALE_TABLES,
	PLACEHOLDER_MANIFEST,
	ThemeCore,
	ThemePack,
	THEME_PACKS,
	breaksAllCaps,
	hasLowercase,
	isAllCaps,
	isLowercaseCodepoint,
	loadThemePack,
	validateLocaleTable,
} from "shared/theme";
import { deepClone, sortedKeys, type Obj } from "./util";

const quiet = (): void => {};
const EN = PLACEHOLDER_MANIFEST.strings as unknown as Readonly<Record<string, string>>;
const entry = (key: string, text: string) => [text, sourceHash(EN[key])] as const;

/** A synthetic German table: one good entry per case, plus the broken ones. */
const DE: LocaleTable = {
	"menu.play": entry("menu.play", "Spielen"),
	"hud.level": entry("hud.level", "Stufe {level}"),
	// stale: translated from other English
	"hud.paused": ["Pausiert", sourceHash("Pause")],
	// mismatched: drops {key}
	"hud.dead": entry("hud.dead", "Du bist gestorben"),
	// mismatched: malformed braces
	"hud.weaponSet": entry("hud.weaponSet", "Satz {n"),
	// developer-only: never used
	"playtest.badge": entry("playtest.badge", "Testversion {version} · {key}"),
	// untranslated (the digit font has no other letters): never used
	"fx.cap": entry("fx.cap", "KAPP"),
	// not in the English table
	"no.such.key": ["x", 1],
};
const TABLES: ReadonlyMap<string, LocaleTable> = new Map<string, LocaleTable>([["de", DE]]);

function pack(locale?: string, manifest: unknown = PLACEHOLDER_MANIFEST): ThemePack {
	return new ThemePack(manifest, { locale, localeTables: TABLES, warn: quiet });
}

describe("theme locale lookup", () => {
	afterEach(() => setNumberLocale(SOURCE_LOCALE));

	it("uses a generated entry whose source hash and placeholders match", () => {
		const p = pack("de");
		expect(p.str("menu.play")).toBe("Spielen");
		expect(p.str("hud.level", { level: 3 })).toBe("Stufe 3");
		expect(p.str("game.title")).toBe(EN["game.title"]);
	});

	it("falls back to English for a stale entry and records it", () => {
		const p = pack("de");
		expect(p.str("hud.paused")).toBe(EN["hud.paused"]);
		expect(p.localeReport().stale).toEqual(["hud.paused"]);
	});

	it("falls back to English for a placeholder or brace mismatch and records it, silently", () => {
		const warnings: string[] = [];
		const p = new ThemePack(PLACEHOLDER_MANIFEST, {
			locale: "de",
			localeTables: TABLES,
			warn: (m) => warnings.push(m),
		});
		expect(p.str("hud.dead", { key: "R" })).toBe("You died — press R to retry");
		expect(p.str("hud.weaponSet", { n: 2 })).toBe("Set 2");
		expect(p.localeReport().mismatched).toEqual(["hud.dead", "hud.weaponSet"]);
		expect(p.localeReport().unknown).toEqual(["no.such.key"]);
		expect(warnings).toEqual([]);
	});

	it("keeps developer-only keys English", () => {
		expect(pack("de").str("playtest.badge")).toBe(EN["playtest.badge"]);
		expect(pack(PSEUDO_LOCALE).str("hud.debug.replayHint")).toBe(EN["hud.debug.replayHint"]);
	});

	it("keeps untranslated keys English: no table entry, manifest override or pseudo-locale", () => {
		expect(pack("de").str("fx.cap")).toBe("CAP");
		expect(pack(PSEUDO_LOCALE).str("fx.cap")).toBe("CAP");
		const m = deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
		m.locales = { de: { "fx.cap": "KAPP" } };
		expect(pack("de", m).str("fx.cap")).toBe("CAP");
	});

	it("lets the pack's own manifest locales override the generated table", () => {
		const m = deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
		m.locales = { de: { "menu.play": "Los!", "hud.paused": "Angehalten", "playtest.badge": "nie" } };
		const p = pack("de", m);
		expect(p.str("menu.play")).toBe("Los!");
		expect(p.str("hud.paused")).toBe("Angehalten");
		expect(p.str("hud.level", { level: 1 })).toBe("Stufe 1");
		expect(p.str("playtest.badge")).toBe(EN["playtest.badge"]);
	});

	it("reads the pseudo-locale as accented, padded English with placeholders intact", () => {
		const p = pack(PSEUDO_LOCALE);
		expect(p.str("hud.level")).toBe(pseudoLocalize(EN["hud.level"]));
		expect(p.str("hud.level", { level: 7 }).find("7", 1, true)[0]).never.toBe(undefined);
		expect(p.str("hud.level", { level: 7 }).find("{", 1, true)[0]).toBe(undefined);
		for (const key of sortedKeys(EN)) expect([key, p.hasString(key)]).toEqual([key, true]);
	});

	it("round-trips setLocale, moving the number locale with it", () => {
		const p = pack();
		expect([p.locale, p.str("menu.play")]).toEqual([undefined, "Play"]);
		expect(numberLocale()).toBe(SOURCE_LOCALE);
		p.setLocale("de");
		expect([p.locale, p.core.locale, p.str("menu.play")]).toEqual(["de", "de", "Spielen"]);
		expect(numberLocale()).toBe("de");
		expect(formatThousands(1240)).toBe("1.240");
		p.setLocale(SOURCE_LOCALE);
		expect([p.locale, p.str("menu.play")]).toEqual([SOURCE_LOCALE, "Play"]);
		expect(p.localeReport()).toEqual({ stale: [], mismatched: [], unknown: [] });
		expect(numberLocale()).toBe(SOURCE_LOCALE);
		p.setLocale("de");
		p.setLocale(undefined);
		expect([p.locale, p.str("menu.play"), numberLocale()]).toEqual([undefined, "Play", SOURCE_LOCALE]);
	});

	it("loadThemePack's locale takes the same path; a pack built without one leaves the number locale alone", () => {
		const p = loadThemePack("placeholder", { locale: "de", localeTables: TABLES, warn: quiet });
		expect([p.locale, p.str("menu.play"), numberLocale()]).toEqual(["de", "Spielen", "de"]);
		new ThemeCore(PLACEHOLDER_MANIFEST, { warn: quiet });
		expect(numberLocale()).toBe("de");
	});

	it("an unknown locale or one without a table reads English", () => {
		expect(pack("fr").str("menu.play")).toBe("Play");
		expect(pack("xx").str("menu.play")).toBe("Play");
	});

	it("every bundled pack loads with the committed tables in every locale without a warning", () => {
		for (const id of sortedKeys(THEME_PACKS)) {
			const warnings: string[] = [];
			const p = new ThemePack(THEME_PACKS[id], { warn: (m) => warnings.push(m) });
			for (const l of LOCALES) {
				p.setLocale(l.code);
				expect([id, l.code, p.str("game.title").size() > 0]).toEqual([id, l.code, true]);
			}
			expect([id, warnings]).toEqual([id, []]);
		}
	});
});

describe("validateLocaleTable", () => {
	it("reports unknown and developer keys, bad entries, braces and placeholder multisets", () => {
		const problems = validateLocaleTable(EN, DE, "latin");
		expect(problems.map((p) => `${p.key}: ${p.message}`)).toEqual([
			"fx.cap: is an untranslated key (UNTRANSLATED_STRING_KEYS: always English)",
			"hud.dead: placeholders none differ from the English {key}",
			"hud.weaponSet: has a malformed placeholder (use {name} with letters, digits or _)",
			"hud.weaponSet: placeholders none differ from the English {n}",
			"no.such.key: not in the English string table",
			"playtest.badge: is a developer-only key (never translated)",
		]);
		const bad = { "menu.play": ["Spielen"] } as unknown as LocaleTable;
		expect(validateLocaleTable(EN, bad, "latin").map((p) => p.message)).toEqual([
			"must be [text, srcHash] (a string and an unsigned 32-bit integer)",
		]);
		expect(validateLocaleTable(EN, { "menu.play": ["Spielen", -1] }, "latin").size()).toBe(1);
		expect(validateLocaleTable(EN, { "hud.level": entry("hud.level", "{level} {level}") }, "cjk").size()).toBe(1);
	});

	it("does not treat a stale hash as a problem", () => {
		expect(validateLocaleTable(EN, { "hud.paused": ["Pausiert", 0] }, "latin")).toEqual([]);
	});

	it("skips the placeholder and caps checks of a stale entry, still flagging unknown keys and malformed entries", () => {
		// Stale: translated from older English (the pipeline writes the hash of the CSV's Source).
		const old = (text: string) => sourceHash(text);
		const stale: LocaleTable = {
			"hud.level": ["Niveau {lvl}", old("Level {lvl}")],
			"hud.combo.rampage": ["Randale", old("Rampage")],
			"hud.paused": ["Pausiert", old("Pause")],
		};
		expect(validateLocaleTable(EN, stale, "latin")).toEqual([]);
		// The same texts translated from the current English are problems.
		const current: LocaleTable = {
			"hud.level": entry("hud.level", "Niveau {lvl}"),
			"hud.combo.rampage": entry("hud.combo.rampage", "Randale"),
		};
		expect(validateLocaleTable(EN, current, "latin").map((p) => p.key)).toEqual(["hud.combo.rampage", "hud.level"]);
		// Braces, UTF-8, unknown and developer keys, and the entry's shape are checked whatever the hash.
		const bad = {
			"hud.weaponSet": ["Satz {n", old("Weapon set {n}")],
			"menu.play": [string.char(0xff), old("Go")],
			"no.such.key": ["x", old("x")],
			"playtest.badge": ["Test", old("Playtest")],
			"hud.score": ["Punkte"],
		} as unknown as LocaleTable;
		expect(validateLocaleTable(EN, bad, "latin").map((p) => `${p.key}: ${p.message}`)).toEqual([
			"hud.score: must be [text, srcHash] (a string and an unsigned 32-bit integer)",
			"hud.weaponSet: has a malformed placeholder (use {name} with letters, digits or _)",
			"menu.play: is not valid UTF-8",
			"no.such.key: not in the English string table",
			"playtest.badge: is a developer-only key (never translated)",
		]);
	});

	it("keeps all-caps English all caps in Latin and Cyrillic, placeholders aside", () => {
		const rampage = EN["hud.combo.rampage"];
		expect(isAllCaps(rampage)).toBe(true);
		expect(isAllCaps("NEW BEST +{points}")).toBe(true);
		expect(isAllCaps("Run over")).toBe(false);
		const t = (text: string, writing: "latin" | "cyrillic" | "cjk") =>
			validateLocaleTable(EN, { "hud.combo.rampage": [text, sourceHash(rampage)] }, writing).size();
		expect(t("RANDALE", "latin")).toBe(0);
		expect(t("Randale", "latin")).toBe(1);
		expect(t("DÉCHAÎNÉ", "latin")).toBe(0);
		expect(t("DÉCHAÎNé", "latin")).toBe(1);
		expect(t("BUỔI SÁNG", "latin")).toBe(0);
		expect(t("buổi", "latin")).toBe(1);
		expect(t("GROß", "latin")).toBe(0);
		expect(t("ŁÓDŹ", "latin")).toBe(0);
		expect(t("łódź", "latin")).toBe(1);
		expect(t("БОЙНЯ", "cyrillic")).toBe(0);
		expect(t("Бойня", "cyrillic")).toBe(1);
		expect(t("暴れ", "cjk")).toBe(0);
		expect(
			validateLocaleTable(EN, { "hud.best.over": entry("hud.best.over", "NOUVEAU RECORD +{points}") }, "latin"),
		).toEqual([]);
		expect(hasLowercase("ABC {points}")).toBe(false);
		expect(isLowercaseCodepoint(0x131)).toBe(true); // ı
		expect(isLowercaseCodepoint(0x130)).toBe(false); // İ
	});

	it("applies the all-caps rule shared with the node pipeline (scripts/l10n lib.test.js CAPS_VECTORS)", () => {
		// [English, translation, script, accepted]. Keep this list identical to lib.test.js CAPS_VECTORS.
		const CAPS_VECTORS: ReadonlyArray<readonly [string, string, "latin" | "cyrillic" | "cjk", boolean]> = [
			["NEW BEST", "NEUER REKORD", "latin", true],
			["BIG", "GROẞ", "latin", true],
			["STREET", "STRAßE", "latin", true],
			["NEW", "Neuer", "latin", false],
			["STAGE", "ÉTAPE", "latin", true],
			["STAGE", "étape", "latin", false],
			["STAGE", "ÉTAPe", "latin", false],
			["CITY", "İSTANBUL", "latin", true],
			["CITY", "ıSTANBUL", "latin", false],
			["MORNING", "BUỔI SÁNG", "latin", true],
			["MORNING", "BUỔI SÁNg", "latin", false],
			["RECORD", "РЕКОРД", "cyrillic", true],
			["RECORD", "Рекорд", "cyrillic", false],
			["NEW BEST +{points}", "NOUVEAU RECORD +{points}", "latin", true],
			["CLEAR {n}/{total}!", "ЗАЧИЩЕНО {n}/{total}!", "cyrillic", true],
			["3 KILLS - 100%", "3 ABATES — 100 %", "latin", true],
			["3 KILLS", "3 abates", "latin", false],
			["KRA", "ĸRA", "latin", true],
			["BIG", "ƀIG", "latin", true],
			["Run over", "partie finie", "latin", true],
			["RECORD", "记录 record", "cjk", true],
		];
		for (const [english, text, writing, accepted] of CAPS_VECTORS) {
			expect([english, text, breaksAllCaps(english, text, writing)]).toEqual([english, text, !accepted]);
		}
	});

	it("flags invalid UTF-8", () => {
		const broken = string.char(0xff, 0x41);
		expect(validateLocaleTable(EN, { "menu.play": [broken, 0] }, "latin").map((p) => p.message)).toEqual([
			"is not valid UTF-8",
		]);
	});
});

describe("committed locale tables (shared/theme/locales)", () => {
	it("are for known, translatable locales and pass the validator against the placeholder pack's English", () => {
		for (const [code, entries] of LOCALE_TABLES) {
			const def = localeDef(code);
			expect([code, def !== undefined, code !== SOURCE_LOCALE, def?.pseudo]).toEqual([
				code,
				true,
				true,
				undefined,
			]);
			if (def === undefined) continue;
			const problems = validateLocaleTable(EN, entries, def.script).map((p) => `${code} ${p.key}: ${p.message}`);
			expect(problems).toEqual([]);
		}
	});
});

// Specs for the l10n pipeline helpers (docs/LOCALIZATION.md task L10, npm run test:l10n). Fixture data only.
"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const lib = require("./lib.js");

const LOCALES = [
	{ code: "en", roblox: ["en-us"], script: "latin", pseudo: false },
	{ code: "es", roblox: ["es-es", "es-mx"], script: "latin", pseudo: false },
	{ code: "pt-BR", roblox: ["pt-br", "pt-pt"], script: "latin", pseudo: false },
	{ code: "zh-CN", roblox: ["zh-cn"], script: "cjk", pseudo: false },
	{ code: "zh-TW", roblox: ["zh-tw", "zh-hk"], script: "cjk", pseudo: false },
	{ code: "en-XA", roblox: [], script: "latin", pseudo: true },
];

describe("sourceHash", () => {
	it("is FNV-1a 32, unsigned (published vectors, the same as shared/l10n hash.ts)", () => {
		assert.equal(lib.sourceHash(""), 0x811c9dc5);
		assert.equal(lib.sourceHash("a"), 0xe40c292c);
		assert.equal(lib.sourceHash("foobar"), 0xbf9cf968);
	});

	it("hashes UTF-8 bytes, not UTF-16 units", () => {
		// "é" is c3 a9 in UTF-8: fold both bytes by hand
		let h = 0x811c9dc5;
		for (const b of [0xc3, 0xa9]) h = Math.imul(h ^ b, 0x01000193) >>> 0;
		assert.equal(lib.sourceHash("é"), h);
		assert.notEqual(lib.sourceHash("é"), lib.sourceHash("e"));
		assert.ok(lib.sourceHash("😀 你好") >= 0);
	});
});

describe("CSV", () => {
	const nasty = [
		["Key", "Source", "Context", "es"],
		["a.quote", 'He said "hi"', 'a "quoted" · note', '"'],
		["a.comma", "one, two, three", ",", ",,"],
		["a.newline", "line 1\nline 2", "crlf\r\ninside", "\r"],
		["a.emoji", "Score 😀 {score}", "🔥🔥", "👍🏽 family 👨‍👩‍👧"],
		["a.arabic", "العربية {n}", "نص", "مرحبا، {n}"],
		["a.cjk", "日本語の文字", "中文，标点", "한국어"],
		["a.space", " leading", "trailing ", ""],
		["a.empty", "", "", ""],
	];

	it("round-trips quotes, commas, line breaks, emoji, Arabic and CJK cells exactly", () => {
		const text = lib.writeCsv(nasty);
		assert.deepEqual(lib.parseCsv(text), nasty);
		assert.ok(text.endsWith("\r\n"));
		assert.ok(text.includes('"He said ""hi"""'));
	});

	it("tolerates a BOM, LF or CR record ends and a missing final line end", () => {
		assert.deepEqual(lib.parseCsv("﻿Key,Source\nk,v"), [
			["Key", "Source"],
			["k", "v"],
		]);
		assert.deepEqual(lib.parseCsv("a,b\rc,d\r"), [
			["a", "b"],
			["c", "d"],
		]);
		assert.deepEqual(lib.parseCsv('a,"x\r\ny"\r\n,\r\n'), [
			["a", "x\r\ny"],
			["", ""],
		]);
		assert.deepEqual(lib.parseCsv(""), []);
	});

	it("rejects an unterminated quoted cell", () => {
		assert.throws(() => lib.parseCsv('a,"open\nb'), /unterminated/);
	});
});

describe("placeholders", () => {
	it("is a multiset of {name} tokens", () => {
		assert.deepEqual(lib.placeholders("{b} {a} {b} {not a token} {x-y}"), ["a", "b", "b"]);
		assert.ok(lib.samePlaceholders("{a} of {b}", "{b} de {a}"));
		assert.ok(!lib.samePlaceholders("{a}{a}{b}", "{a}{b}{b}"));
		assert.ok(!lib.samePlaceholders("Score {score}", "Puntos"));
	});

	it("reports malformed braces, dropped tokens and lowercase in all-caps Latin text", () => {
		assert.equal(lib.braceProblem("ok {name}"), undefined);
		assert.match(lib.braceProblem("{name"), /malformed/);
		assert.match(lib.translationProblems("Score {score}", "Puntos", "latin")[0], /\(none\) differ.*\{score\}/);
		assert.match(lib.translationProblems("PERFECT", "Perfecto", "latin")[0], /all caps/);
		assert.deepEqual(lib.translationProblems("PERFECT", "PERFEKT", "latin"), []);
		assert.deepEqual(lib.translationProblems("CLEAR {n}", "ОЧИЩЕНО {n}", "cyrillic"), []);
		assert.deepEqual(lib.translationProblems("PERFECT", "完美", "cjk"), []);
	});

	it("fills an Example from example values, leaving unknown names", () => {
		assert.equal(lib.fillPlaceholders("{a} + {b}", { a: 1 }), "1 + {b}");
		assert.equal(lib.exampleCell("Floor {floor}", { note: "x", example: { floor: 7 } }), "Floor 7");
		assert.equal(lib.exampleCell("Floor", { note: "x", example: { floor: 7 } }), "");
		assert.equal(lib.exampleCell("Floor {floor}", { note: "x" }), "");
	});
});

describe("context cell", () => {
	const glossary = {
		terms: [
			{ term: "Dungeons", meaning: "the game", translate: false },
			{ term: "Ember", meaning: "currency", translate: false, keys: ["ember.name"] },
			{ term: "Boon", meaning: "upgrade", translate: true },
		],
	};

	it("is key · note · max · do not translate, leaving out absent parts", () => {
		assert.equal(
			lib.contextCell("game.title", "Roblox Dungeons", { note: "Title", max: 24 }, glossary),
			"game.title · Title · max 24 chars · do not translate: Dungeons",
		);
		assert.equal(lib.contextCell("menu.back", "Main menu", undefined, glossary), "menu.back");
		// a term limited to keys applies only there
		assert.equal(lib.contextCell("x", "Ember", { note: "n" }, glossary), "x · n");
		assert.equal(
			lib.contextCell("ember.name", "Ember", { note: "n" }, glossary),
			"ember.name · n · do not translate: Ember",
		);
	});
});

describe("translatable keys", () => {
	// The dump's flags (shared/l10n isDevOnlyStringKey / isTranslatableStringKey), never a node re-implementation.
	const source = {
		strings: { "b.k": "B", "playtest.x": "P", "playtest.run.over": "Run over", "fx.cap": "CAP", "a.k": "A" },
		devOnlyKeys: ["playtest.x"],
		untranslatedKeys: ["fx.cap"],
	};

	it("drops the dump's developer and untranslated keys and sorts", () => {
		assert.deepEqual(lib.translatableKeys(source), ["a.k", "b.k", "playtest.run.over"]);
	});

	it("names why a key is not translated", () => {
		assert.equal(lib.keyKind(source, "playtest.x"), "dev");
		assert.equal(lib.keyKind(source, "fx.cap"), "untranslated");
		assert.equal(lib.keyKind(source, "playtest.run.over"), "translatable");
		assert.equal(lib.keyKind(source, "gone"), undefined);
	});
});

describe("all-caps rule", () => {
	// [English, translation, script, accepted]. Keep this list identical to CAPS_VECTORS in
	// src/shared/theme/locale.spec.ts (the game's validator runs the same vectors).
	const CAPS_VECTORS = [
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

	it("accepts and rejects exactly what the game's validator does", () => {
		for (const [english, text, script, accepted] of CAPS_VECTORS) {
			assert.equal(lib.capsProblem(english, text, script) === undefined, accepted, `${english} -> ${text}`);
		}
	});

	it("reads LOWERCASE_RANGES from shared/theme localeCheck.ts", () => {
		const ranges = lib.lowercaseRanges();
		assert.deepEqual(ranges[0], [0x61, 0x7a, "lower"]);
		assert.ok(ranges.some(([from, to, rule]) => from === 0xdf && to === 0xdf && rule === "none")); // ß
		assert.equal(lib.isLowercaseCodepoint(0x131), true); // ı
		assert.equal(lib.isLowercaseCodepoint(0x130), false); // İ
		assert.equal(lib.isLowercaseCodepoint(0x1e9e), false); // ẞ
		assert.equal(lib.isLowercaseCodepoint(0x430), true); // а
	});

	it("is as lenient as the game for letters LOWERCASE_RANGES doesn't list (not Unicode toUpperCase)", () => {
		// "ß".toUpperCase() is "SS" and "ǆ" (Latin Extended-B) has a capital, but the game passes both.
		assert.equal(lib.capsProblem("STREET", "STRAßE", "latin"), undefined);
		assert.equal(lib.capsProblem("DZ", "ǆ", "latin"), undefined);
		assert.equal(lib.hasLowercase("ABC {points}"), false);
		assert.equal(lib.isAllCaps("NEW BEST +{points}"), true);
		assert.equal(lib.isAllCaps("x{n} RAMPAGE"), false);
	});
});

describe("locale columns", () => {
	const columns = { pt: "pt-BR", "Chinese (Simplified)": "zh-CN" };

	it("maps a header through columns.json, then codes, then Roblox ids, then a unique language", () => {
		assert.equal(lib.localeForHeader("PT", columns, LOCALES), "pt-BR");
		assert.equal(lib.localeForHeader("chinese (simplified)", columns, LOCALES), "zh-CN");
		assert.equal(lib.localeForHeader("es", columns, LOCALES), "es");
		assert.equal(lib.localeForHeader("pt-br", columns, LOCALES), "pt-BR");
		assert.equal(lib.localeForHeader("es-mx", columns, LOCALES), "es");
		assert.equal(lib.localeForHeader("zh-hk", columns, LOCALES), "zh-TW");
		assert.equal(lib.localeForHeader("es-ar", columns, LOCALES), "es");
		assert.equal(lib.localeForHeader("pt-ao", {}, LOCALES), "pt-BR");
		assert.equal(lib.localeForHeader("zh-sg", columns, LOCALES), undefined); // two zh locales: ambiguous
		assert.equal(lib.localeForHeader("Klingon", columns, LOCALES), undefined);
	});

	it("exports the first header naming each locale, else the code", () => {
		assert.deepEqual(lib.exportHeaders(columns, LOCALES.slice(1, 4)), ["es", "pt", "Chinese (Simplified)"]);
	});
});

describe("generated files", () => {
	it("index.ts with zero tables is exactly the committed empty index", () => {
		assert.equal(
			lib.renderIndex([]),
			[
				"// Generated by `npm run l10n:import` (scripts/l10n) from the Roblox cloud localization table. Do not edit.",
				'import type { LocaleTable } from "shared/l10n";',
				"",
				"/** Generated locale tables by locale code (docs/LOCALIZATION.md design 2). */",
				"export const LOCALE_TABLES: ReadonlyMap<string, LocaleTable> = new Map<string, LocaleTable>([]);",
				"",
			].join("\n"),
		);
	});

	it("index.ts imports each table by its file name and lists it by code, sorted", () => {
		const text = lib.renderIndex(["zh-TW", "pt-BR", "es"]);
		assert.match(text, /import \{ LOCALE_TABLE as pt_br \} from "\.\/pt_br";/);
		assert.ok(text.indexOf('["es", es]') < text.indexOf('["pt-BR", pt_br]'));
		assert.ok(text.indexOf('["pt-BR", pt_br]') < text.indexOf('["zh-TW", zh_tw]'));
		assert.equal(lib.formatTs(text), text); // already prettier-formatted
	});

	it("a table writes sorted keys and reads back exactly, whatever the text", () => {
		const entries = new Map([
			["z.last", ['Il a dit "salut", {name}', 1]],
			["a.first", ["مرحبا\n😀 {n}", 4294967295]],
			["m.long", ["日本語".repeat(60), 12345]],
			["single", ["it's", 0]],
		]);
		const text = lib.renderTable(entries);
		assert.ok(text.startsWith(lib.GENERATED_HEADER + "\n"));
		assert.ok(text.indexOf('"a.first"') < text.indexOf('"m.long"'));
		assert.equal(lib.formatTs(text), text);
		assert.deepEqual(lib.parseTable(text), new Map([...entries].sort(([a], [b]) => lib.compareKeys(a, b))));
	});

	it("refuses a table it cannot read structurally", () => {
		assert.throws(() => lib.parseTable("export const LOCALE_TABLE = {"), /syntax error/);
		assert.throws(() => lib.parseTable('export const LOCALE_TABLE = { "a": "b" };'), /expected \[text, hash\]/);
		assert.throws(
			() => lib.parseTable('export const LOCALE_TABLE = { "a": ["b", "1"] };'),
			/expected \["text", number\]/,
		);
		assert.throws(
			() => lib.parseTable('export const LOCALE_TABLE = { "a": ["b", 1], "a": ["c", 2] };'),
			/duplicate/,
		);
		assert.throws(() => lib.parseTable("export const OTHER = {};"), /no `LOCALE_TABLE/);
	});
});

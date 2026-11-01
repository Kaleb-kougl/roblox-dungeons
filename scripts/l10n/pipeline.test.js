// Specs for l10n:export / l10n:import / l10n:check end to end (docs/LOCALIZATION.md task L10, npm run test:l10n).
// Fixture data in a temp folder under the home directory; never the real dump, never src/.
"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { after, describe, it } = require("node:test");
const lib = require("./lib.js");
const { runExport } = require("./export.js");
const { runImport } = require("./import.js");
const { runCheck } = require("./check.js");

const TEMP_ROOTS = [];
after(() => {
	for (const dir of TEMP_ROOTS) fs.rmSync(dir, { recursive: true, force: true });
});

const LOCALES = [
	{ code: "en", roblox: ["en-us"], script: "latin", pseudo: false },
	{ code: "es", roblox: ["es-es", "es-mx"], script: "latin", pseudo: false },
	{ code: "ja", roblox: ["ja-jp"], script: "cjk", pseudo: false },
	{ code: "pt-BR", roblox: ["pt-br"], script: "latin", pseudo: false },
	{ code: "ar", roblox: ["ar-001"], script: "arabic", pseudo: false },
	{ code: "en-XA", roblox: [], script: "latin", pseudo: true },
];

const STRINGS = {
	"game.title": "Project Kaleb-Vale",
	"hud.score": "Score {score}",
	"hud.saved": "Saved",
	"options.saved": "Saved",
	"pause.menu": "Main menu",
	"runover.menu": "Main menu",
	"hud.combo": "x{n} {name}!",
	"room.perfect": "PERFECT",
	"tutorial.multi": 'Press "{key}",\nthen roll.',
	"playtest.badge": "PLAYTEST",
	"hud.debug": "fps {fps}",
	"hud.debug.net": "ping {ms}",
};

const CONTEXT = {
	"game.title": { note: "Game title on the menu", max: 24 },
	"hud.score": { note: "Score panel; {score} is a number", max: 14, example: { score: 1240 } },
	"hud.saved": { note: "Toast after saving settings" },
	"options.saved": { note: "Options footer status" },
	"pause.menu": { note: "Pause menu button" },
	"runover.menu": { note: "Run over button" },
	"hud.combo": { note: "Combo shout; {n} tier number, {name} tier name", example: { n: 3, name: "Carnage" } },
	"room.perfect": { note: "Room clear stamp", max: 10 },
	"tutorial.multi": { note: "Tutorial prompt; {key} is a key name", example: { key: "Space" } },
};

const GLOSSARY = { terms: [{ term: "Kaleb-Vale", meaning: "the game's name", translate: false }] };

const COLUMNS = { _note: "test", columns: { es: "es", ja: "ja", pt: "pt-BR", ar: "ar" } };

/** A temp repo root with the fixture source dump, context, glossary and columns. */
function makeRoot(strings = STRINGS, extra = {}) {
	const root = fs.mkdtempSync(path.join(os.homedir(), "l10n-pipeline-test-"));
	TEMP_ROOTS.push(root);
	const paths = lib.defaultPaths(root);
	writeSource(paths, strings);
	if (extra.context !== null) fs.writeFileSync(paths.context, JSON.stringify(extra.context || CONTEXT));
	fs.writeFileSync(paths.glossary, JSON.stringify(GLOSSARY));
	fs.writeFileSync(paths.columns, JSON.stringify(COLUMNS));
	return paths;
}

function writeSource(paths, strings) {
	fs.mkdirSync(path.dirname(paths.source), { recursive: true });
	const srcHashes = Object.fromEntries(Object.entries(strings).map(([k, v]) => [k, lib.sourceHash(v)]));
	const doc = { strings, srcHashes, devOnlyPrefixes: ["playtest.", "hud.debug"], locales: LOCALES };
	fs.writeFileSync(paths.source, JSON.stringify(doc));
}

const quiet = { warn: () => {} };
const readCsv = (file) => lib.parseCsv(fs.readFileSync(file, "utf8"));

/** Translations a translator might type, nasty on purpose. */
const FILL = {
	es: {
		"game.title": "Proyecto Kaleb-Vale",
		"hud.score": "Puntos {score}",
		"hud.saved": "Guardado",
		"options.saved": "Guardada",
		"pause.menu": "Menú principal",
		"runover.menu": "Menú, principal",
		"hud.combo": "¡x{n} {name}!",
		"room.perfect": "PERFECTO",
		"tutorial.multi": 'Pulsa "{key}",\nluego rueda.',
	},
	ja: {
		"hud.score": "スコア {score}",
		"pause.menu": "メインメニュー",
		"tutorial.multi": "「{key}」を押して\n転がる。😀",
	},
	ar: { "hud.score": "النقاط {score}", "hud.combo": "x{n} {name}!" },
};

/** Fill the locale columns of an exported CSV (by header), as the Creator Hub would. */
function fillCsv(rows, fill) {
	const header = rows[0];
	return rows.map((row, r) => {
		if (r === 0) return row;
		const out = [...row];
		for (const [col, values] of Object.entries(fill)) {
			const i = header.indexOf(col);
			if (values[row[0]] !== undefined) out[i] = values[row[0]];
		}
		return out;
	});
}

function snapshot(dir) {
	return Object.fromEntries(
		fs
			.readdirSync(dir)
			.sort()
			.map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8")]),
	);
}

describe("l10n:export", () => {
	it("writes Key, Source, Context, Example and the locale columns; no developer key, no source or pseudo column", () => {
		const paths = makeRoot();
		const r = runExport({ paths, ...quiet });
		assert.deepEqual(r.files, [path.join(paths.outDir, "kv-strings.csv")]);
		const rows = readCsv(r.files[0]);
		assert.deepEqual(rows[0], ["Key", "Source", "Context", "Example", "es", "ja", "pt", "ar"]);
		const keys = rows.slice(1).map((row) => row[0]);
		assert.deepEqual(keys, [...keys].sort());
		assert.equal(keys.length, 9);
		for (const k of keys) assert.ok(!k.startsWith("playtest.") && !k.startsWith("hud.debug"), k);
		const byKey = Object.fromEntries(rows.slice(1).map((row) => [row[0], row]));
		assert.deepEqual(byKey["hud.score"].slice(1, 4), [
			"Score {score}",
			"hud.score · Score panel; {score} is a number · max 14 chars",
			"Score 1240",
		]);
		assert.equal(
			byKey["game.title"][2],
			"game.title · Game title on the menu · max 24 chars · do not translate: Kaleb-Vale",
		);
		assert.equal(byKey["tutorial.multi"][3], 'Press "Space",\nthen roll.');
		assert.equal(byKey["room.perfect"][3], "");
	});

	it("keeps Source+Context unique even when Sources repeat", () => {
		const paths = makeRoot();
		const rows = readCsv(runExport({ paths, ...quiet }).files[0]).slice(1);
		const sources = rows.map((row) => row[1]);
		assert.ok(
			sources.filter((s) => s === "Saved").length === 2 && sources.filter((s) => s === "Main menu").length === 2,
		);
		const pairs = new Set(rows.map((row) => `${row[1]}\u0000${row[2]}`));
		assert.equal(pairs.size, rows.length);
		assert.equal(new Set(rows.map((row) => row[0])).size, rows.length);
	});

	it("works without context and glossary files (a warning each), Context = the key", () => {
		const paths = makeRoot(STRINGS, { context: null });
		fs.unlinkSync(paths.glossary);
		const warnings = [];
		const rows = readCsv(runExport({ paths, warn: (m) => warnings.push(m) }).files[0]);
		assert.equal(warnings.length, 2);
		assert.equal(rows[1][2], rows[1][0]);
	});

	it("splits into batches of at most 1,000 rows and removes batches left from a bigger export", () => {
		const many = {};
		for (let i = 0; i < 2345; i++) many[`gen.k${String(i).padStart(4, "0")}`] = `Text ${i}`;
		const paths = makeRoot(many, { context: {} });
		const r = runExport({ paths, ...quiet });
		assert.deepEqual(
			r.files.map((f) => path.basename(f)),
			["kv-strings.csv", "kv-strings-2.csv", "kv-strings-3.csv"],
		);
		assert.deepEqual(
			r.files.map((f) => readCsv(f).length - 1),
			[1000, 1000, 345],
		);
		for (const f of r.files) assert.equal(readCsv(f)[0][0], "Key");
		assert.equal(readCsv(r.files[1])[1][0], "gen.k1000");

		const fewer = Object.fromEntries(Object.entries(many).slice(0, 1500));
		writeSource(paths, fewer);
		const r2 = runExport({ paths, ...quiet });
		assert.equal(r2.files.length, 2);
		assert.ok(!fs.existsSync(path.join(paths.outDir, "kv-strings-3.csv")));
	});
});

describe("export -> edited CSV -> import -> export round trip", () => {
	it("is stable: the re-export equals the edited CSV and a re-import writes byte-identical tables", () => {
		const paths = makeRoot();
		const csv = runExport({ paths, ...quiet }).files[0];
		const edited = lib.writeCsv(fillCsv(readCsv(csv), FILL));
		const editedFile = path.join(paths.root, "l10n", "in", "table.csv");
		fs.mkdirSync(path.dirname(editedFile), { recursive: true });
		fs.writeFileSync(editedFile, edited);

		const r1 = runImport([editedFile], { paths, ...quiet });
		assert.deepEqual(r1.written, ["ar", "es", "ja"]);
		const tables1 = snapshot(paths.localesDir);
		assert.deepEqual(Object.keys(tables1), ["ar.ts", "es.ts", "index.ts", "ja.ts"]);
		assert.ok(tables1["index.ts"].includes('["ja", ja]'));
		const es = lib.parseTable(tables1["es.ts"]);
		assert.deepEqual(es.get("hud.score"), ["Puntos {score}", lib.sourceHash("Score {score}")]);
		assert.equal(es.get("tutorial.multi")[0], 'Pulsa "{key}",\nluego rueda.');
		assert.equal(es.size, 9);

		const reexport = runExport({ paths, ...quiet }).files[0];
		assert.equal(fs.readFileSync(reexport, "utf8"), edited);

		runImport([reexport], { paths, ...quiet });
		assert.deepEqual(snapshot(paths.localesDir), tables1);
		assert.equal(runCheck({ paths }).errors.length, 0);
	});

	it("reads a spreadsheet's CSV: BOM, CRLF line breaks in cells, headers in any case, Roblox ids as headers", () => {
		const paths = makeRoot();
		const text =
			"﻿KEY,source,CONTEXT,Example,ES-MX,pt-br\r\n" +
			"hud.score,Score {score},x,,Puntos {score},Pontos {score}\r\n" +
			'tutorial.multi,"Press ""{key}"",\r\nthen roll.",x,,"Pulsa ""{key}"",\r\nluego rueda.",\r\n';
		const file = path.join(paths.root, "dl.csv");
		fs.writeFileSync(file, text);
		const r = runImport([file], { paths, ...quiet });
		assert.deepEqual(r.written, ["es", "pt-BR"]);
		const es = lib.parseTable(fs.readFileSync(lib.tableFile(paths.localesDir, "es"), "utf8"));
		assert.deepEqual(es.get("tutorial.multi"), [
			'Pulsa "{key}",\nluego rueda.',
			lib.sourceHash(STRINGS["tutorial.multi"]),
		]);
		assert.equal(r.stats.get("es").stale.length, 0);
	});
});

describe("l10n:import", () => {
	function importRows(paths, rows) {
		const file = path.join(paths.root, `in-${Math.random().toString(36).slice(2)}.csv`);
		fs.writeFileSync(file, lib.writeCsv(rows));
		return runImport([file], { paths, ...quiet });
	}
	const HEADER = ["Key", "Source", "Context", "Example", "es", "pt"];

	it("rejects a cell that drops {score}, breaks a brace or lowercases an all-caps string; reports why", () => {
		const paths = makeRoot();
		const r = importRows(paths, [
			HEADER,
			["hud.score", "Score {score}", "", "", "Puntos", "Pontos {score}"],
			["hud.combo", "x{n} {name}!", "", "", "x{n} {name!", "x{n} {n}!"],
			["room.perfect", "PERFECT", "", "", "Perfecto", "PERFEITO"],
			["hud.saved", "Saved", "", "", "Guardado", ""],
		]);
		const es = lib.parseTable(fs.readFileSync(lib.tableFile(paths.localesDir, "es"), "utf8"));
		assert.deepEqual([...es.keys()], ["hud.saved"]);
		const pt = lib.parseTable(fs.readFileSync(lib.tableFile(paths.localesDir, "pt-BR"), "utf8"));
		assert.deepEqual([...pt.keys()], ["hud.score", "room.perfect"]);
		assert.deepEqual(
			r.stats.get("es").rejected.map((x) => x.key),
			["hud.score", "hud.combo", "room.perfect"],
		);
		const report = fs.readFileSync(paths.report, "utf8");
		assert.match(report, /`hud\.score`: placeholders \(none\) differ from the English \{score\}/);
		assert.match(report, /`hud\.combo`: placeholders \{n\} \{n\} differ/);
		assert.match(report, /`room\.perfect`: English is all caps/);
	});

	it("writes a row whose Source is not the current English with that Source's hash, and reports it stale", () => {
		const paths = makeRoot();
		const r = importRows(paths, [HEADER, ["hud.saved", "Saved!", "", "", "¡Guardado!", ""]]);
		const es = lib.parseTable(fs.readFileSync(lib.tableFile(paths.localesDir, "es"), "utf8"));
		assert.deepEqual(es.get("hud.saved"), ["¡Guardado!", lib.sourceHash("Saved!")]);
		assert.deepEqual(r.stats.get("es").stale, ["hud.saved"]);
		assert.match(
			fs.readFileSync(paths.report, "utf8"),
			/Stale \(1, Source differs from the current English\): `hud\.saved`/,
		);
		// a stale translation is not exported back (the cloud re-translates the new English)
		const rows = readCsv(runExport({ paths, ...quiet }).files[0]);
		assert.equal(rows.find((row) => row[0] === "hud.saved")[4], "");
		assert.deepEqual(runCheck({ paths }).locales.find((l) => l.code === "es").stale, ["hud.saved"]);
	});

	it("skips unknown and developer keys and unmapped columns, and reports them", () => {
		const paths = makeRoot();
		const r = importRows(paths, [
			[...HEADER, "Klingon", "en"],
			["gone.key", "Old", "", "", "Viejo", "", "x", "Old"],
			["playtest.badge", "PLAYTEST", "", "", "PRUEBA", "", "", ""],
			["", "captured text", "", "", "texto", "", "", ""],
		]);
		assert.deepEqual(r.written, []);
		assert.deepEqual(r.stats.get("es").unknown, ["gone.key", "playtest.badge"]);
		const report = fs.readFileSync(paths.report, "utf8");
		assert.match(report, /## Unknown keys[\s\S]*`gone\.key`, `playtest\.badge`/);
		assert.match(report, /unmapped columns.*"Klingon"/);
		assert.match(report, /ignored columns.*"en" \(en\)/);
		assert.match(report, /1 row\(s\) without a Key/);
		assert.equal(fs.readFileSync(path.join(paths.localesDir, "index.ts"), "utf8"), lib.renderIndex([]));
	});

	it("merges batch files, removes a table whose column came back empty, and leaves locales with no column alone", () => {
		const paths = makeRoot();
		importRows(paths, [HEADER, ["hud.saved", "Saved", "", "", "Guardado", "Salvo"]]);
		assert.ok(fs.existsSync(lib.tableFile(paths.localesDir, "pt-BR")));
		const a = path.join(paths.root, "a.csv");
		const b = path.join(paths.root, "b.csv");
		fs.writeFileSync(
			a,
			lib.writeCsv([
				["Key", "Source", "es"],
				["hud.saved", "Saved", "Guardado"],
			]),
		);
		fs.writeFileSync(
			b,
			lib.writeCsv([
				["Key", "Source", "es"],
				["pause.menu", "Main menu", "Menú principal"],
			]),
		);
		const r = runImport([a, b], { paths, ...quiet });
		const es = lib.parseTable(fs.readFileSync(lib.tableFile(paths.localesDir, "es"), "utf8"));
		assert.deepEqual([...es.keys()], ["hud.saved", "pause.menu"]);
		assert.ok(fs.existsSync(lib.tableFile(paths.localesDir, "pt-BR"))); // no pt column: untouched
		assert.deepEqual(r.index, ["es", "pt-BR"]);
		importRows(paths, [HEADER, ["hud.saved", "Saved", "", "", "Guardado", ""]]);
		assert.ok(!fs.existsSync(lib.tableFile(paths.localesDir, "pt-BR")));
		assert.equal(runCheck({ paths }).errors.length, 0);
	});
});

describe("l10n:export --changed", () => {
	it("exports only keys whose English changed since the import, or that no table has", () => {
		const paths = makeRoot();
		const csv = runExport({ paths, ...quiet }).files[0];
		const file = path.join(paths.root, "filled.csv");
		fs.writeFileSync(file, lib.writeCsv(fillCsv(readCsv(csv), { es: FILL.es })));
		runImport([file], { paths, ...quiet });
		assert.deepEqual(runExport({ paths, changed: true, ...quiet }).keys, []);

		writeSource(paths, { ...STRINGS, "hud.saved": "Settings saved", "new.key": "Brand new" });
		const r = runExport({ paths, changed: true, ...quiet });
		assert.deepEqual(r.keys, ["hud.saved", "new.key"]);
		const rows = readCsv(r.files[0]);
		assert.equal(rows.length, 3);
		assert.equal(rows[1][4], ""); // the stale Spanish is not sent back
	});
});

describe("l10n:check", () => {
	function writeTable(paths, code, entries) {
		fs.mkdirSync(paths.localesDir, { recursive: true });
		fs.writeFileSync(lib.tableFile(paths.localesDir, code), lib.renderTable(new Map(Object.entries(entries))));
		const present = LOCALES.map((l) => l.code).filter((c) => fs.existsSync(lib.tableFile(paths.localesDir, c)));
		fs.writeFileSync(path.join(paths.localesDir, "index.ts"), lib.renderIndex(present));
	}
	const h = (k) => lib.sourceHash(STRINGS[k]);

	it("warns on coverage, stale, placeholders, budgets and glossary terms without failing", () => {
		const paths = makeRoot();
		writeTable(paths, "es", {
			"game.title": ["Proyecto Kaleb Vale", h("game.title")],
			"hud.score": ["Puntuación total {score}", h("hud.score")],
			"hud.combo": ["x{n}!", h("hud.combo")],
			"hud.saved": ["Guardado", 1],
		});
		const r = runCheck({ paths });
		assert.deepEqual(r.errors, []);
		const es = r.locales.find((l) => l.code === "es");
		assert.equal(es.current, 3);
		assert.deepEqual(es.stale, ["hud.saved"]);
		assert.deepEqual(es.overBudget, ["hud.score: 24 > 14 chars"]);
		assert.deepEqual(es.glossary, ['game.title: "Kaleb-Vale" missing']);
		assert.equal(es.problems.length, 1);
		assert.match(es.problems[0], /^hud\.combo: placeholders/);
	});

	it("fails on an unknown key, a developer key, an unparseable table or an out-of-date index", () => {
		const paths = makeRoot();
		writeTable(paths, "es", { "gone.key": ["x", 1], "playtest.badge": ["PRUEBA", 2] });
		writeTable(paths, "ja", { "hud.saved": ["保存", h("hud.saved")] });
		fs.writeFileSync(lib.tableFile(paths.localesDir, "ar"), "export const LOCALE_TABLE = {");
		const errors = runCheck({ paths }).errors.join("\n");
		assert.match(errors, /es: unknown key "gone\.key"/);
		assert.match(errors, /es: unknown key "playtest\.badge" in the table \(a developer key\)/);
		assert.match(errors, /unparseable table: .*ar\.ts/);
		assert.match(errors, /index\.ts does not list exactly the table files/);
	});

	it("fails on a player-facing key with no context once context.json exists; warns before that", () => {
		const partial = { ...CONTEXT };
		delete partial["hud.saved"];
		partial["gone.key"] = { note: "stale context" };
		const paths = makeRoot(STRINGS, { context: partial });
		const r = runCheck({ paths });
		assert.equal(r.errors.length, 1);
		assert.match(r.errors[0], /1 player-facing key\(s\) without a context entry: hud\.saved/);
		assert.ok(r.warnings.some((w) => /context entr\(ies\) for unknown or developer keys: gone\.key/.test(w)));

		const none = makeRoot(STRINGS, { context: null });
		const r2 = runCheck({ paths: none });
		assert.deepEqual(r2.errors, []);
		assert.ok(r2.warnings.some((w) => /no l10n\/context\.json yet/.test(w)));
	});
});

// Shared helpers for the cloud localization pipeline (docs/LOCALIZATION.md design 2-4, task L10): CSV, the source
// hash, placeholders, the all-caps rule, the translatable key filter, the Roblox column -> locale code map and the
// generated locale tables (src/shared/theme/locales). Plain Node plus the repo's own typescript (to read tables) and prettier (to write
// them). Used by export.js, import.js and check.js; specs in lib.test.js / pipeline.test.js (npm run test:l10n).
"use strict";

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");

/** Where everything lives by default, relative to a repo root (the specs pass a temp root). */
function defaultPaths(root = REPO) {
	return {
		root,
		source: path.join(root, "l10n", "build", "source.json"),
		context: path.join(root, "l10n", "context.json"),
		glossary: path.join(root, "l10n", "glossary.json"),
		columns: path.join(root, "l10n", "columns.json"),
		localesDir: path.join(root, "src", "shared", "theme", "locales"),
		outDir: path.join(root, "l10n", "out"),
		report: path.join(root, "l10n", "report.md"),
		prettierrc: path.join(REPO, ".prettierrc"),
		localeCheck: path.join(REPO, "src", "shared", "theme", "localeCheck.ts"),
	};
}

// --- CSV (RFC 4180) ------------------------------------------------------------------------------------------------

/**
 * Parse CSV text into rows of cells. Tolerates a UTF-8 BOM, CRLF / LF / CR record ends, quoted cells with commas,
 * doubled quotes and line breaks (kept exactly as written), and a missing final line end. A trailing empty line is
 * not a row.
 */
function parseCsv(text) {
	if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
	const rows = [];
	let row = [];
	let cell = "";
	let quoted = false;
	let i = 0;
	const n = text.length;
	let sawAny = false; // anything since the last record end
	while (i < n) {
		const c = text[i];
		if (quoted) {
			if (c === '"') {
				if (text[i + 1] === '"') {
					cell += '"';
					i += 2;
					continue;
				}
				quoted = false;
				i++;
				continue;
			}
			cell += c;
			i++;
			continue;
		}
		if (c === '"' && cell === "") {
			quoted = true;
			sawAny = true;
			i++;
		} else if (c === ",") {
			row.push(cell);
			cell = "";
			sawAny = true;
			i++;
		} else if (c === "\r" || c === "\n") {
			row.push(cell);
			rows.push(row);
			row = [];
			cell = "";
			sawAny = false;
			i += c === "\r" && text[i + 1] === "\n" ? 2 : 1;
		} else {
			cell += c;
			sawAny = true;
			i++;
		}
	}
	if (quoted) throw new Error("CSV: unterminated quoted cell");
	if (sawAny) {
		row.push(cell);
		rows.push(row);
	}
	return rows;
}

function csvCell(value) {
	const s = value === undefined || value === null ? "" : String(value);
	return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows of cells -> CSV text: CRLF record ends (RFC 4180), cells quoted only when needed, no BOM. */
function writeCsv(rows) {
	return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

// --- source hash ----------------------------------------------------------------------------------------------------

/** FNV-1a 32 over the UTF-8 bytes, unsigned: the same value as shared/l10n sourceHash (hash.ts). */
function sourceHash(text) {
	let h = 0x811c9dc5;
	for (const b of Buffer.from(text, "utf8")) h = Math.imul(h ^ b, 0x01000193);
	return h >>> 0;
}

// --- placeholders ---------------------------------------------------------------------------------------------------

const PLACEHOLDER_RE = /\{([A-Za-z0-9_]+)\}/g;

/** The `{name}` placeholder names of a template, sorted (a multiset: repeats kept). */
function placeholders(text) {
	const out = [];
	for (const m of text.matchAll(PLACEHOLDER_RE)) out.push(m[1]);
	return out.sort();
}

/** True when both templates use the same placeholders the same number of times. */
function samePlaceholders(a, b) {
	const x = placeholders(a);
	const y = placeholders(b);
	return x.length === y.length && x.every((v, i) => v === y[i]);
}

/** Like shared/theme templateProblem: a stray brace outside a `{name}` token. */
function braceProblem(text) {
	const stripped = text.replace(PLACEHOLDER_RE, "");
	return /[{}]/.test(stripped) ? "malformed braces (use {name} with letters, digits or _)" : undefined;
}

/** Fill `{name}` tokens from vars; unknown names stay as written. */
function fillPlaceholders(text, vars) {
	return text.replace(PLACEHOLDER_RE, (whole, name) =>
		vars && Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
	);
}

/** "{a} x {b}" placeholders as a readable list for reports: "{a} {b}" or "(none)". */
function placeholderList(text) {
	const p = placeholders(text);
	return p.length === 0 ? "(none)" : p.map((n) => `{${n}}`).join(" ");
}

// --- the all-caps rule (the same as shared/theme localeCheck.ts breaksAllCaps) -------------------------------------

/** Scripts with letter case: the all-caps rule applies to them (shared/theme CASED_SCRIPTS). */
const CASED_SCRIPTS = ["latin", "cyrillic"];

let lowercaseRangeCache;
/**
 * shared/theme localeCheck.ts LOWERCASE_RANGES, read from the source with the TypeScript parser (never evaluated), so
 * node and the game classify every code point the same way: [[from, to, "lower" | "none" | "odd" | "even"], ...].
 */
function lowercaseRanges(file = defaultPaths().localeCheck) {
	if (lowercaseRangeCache && lowercaseRangeCache.file === file) return lowercaseRangeCache.ranges;
	const ts = require("typescript");
	const sf = ts.createSourceFile(
		file,
		fs.readFileSync(file, "utf8"),
		ts.ScriptTarget.Latest,
		false,
		ts.ScriptKind.TS,
	);
	let literal;
	for (const st of sf.statements) {
		if (!ts.isVariableStatement(st)) continue;
		for (const d of st.declarationList.declarations) {
			if (ts.isIdentifier(d.name) && d.name.text === "LOWERCASE_RANGES") literal = d.initializer;
		}
	}
	if (!literal || !ts.isArrayLiteralExpression(literal)) throw new Error(`${file}: no LOWERCASE_RANGES = [ ... ]`);
	const ranges = literal.elements.map((e) => {
		const ok =
			ts.isArrayLiteralExpression(e) &&
			e.elements.length === 3 &&
			ts.isNumericLiteral(e.elements[0]) &&
			ts.isNumericLiteral(e.elements[1]) &&
			ts.isStringLiteral(e.elements[2]) &&
			["lower", "none", "odd", "even"].includes(e.elements[2].text);
		if (!ok) throw new Error(`${file}: LOWERCASE_RANGES entries must be [number, number, "rule"] literals`);
		return [Number(e.elements[0].text), Number(e.elements[1].text), e.elements[2].text];
	});
	lowercaseRangeCache = { file, ranges };
	return ranges;
}

/** Is code point `cp` a lowercase letter? (shared/theme isLowercaseCodepoint: the first range holding it decides.) */
function isLowercaseCodepoint(cp) {
	for (const [from, to, rule] of lowercaseRanges()) {
		if (cp < from || cp > to) continue;
		if (rule === "lower") return true;
		if (rule === "none") return false;
		return rule === "odd" ? cp % 2 === 1 : cp % 2 === 0;
	}
	return false;
}

/** An English string with an ASCII capital and no ASCII lowercase letter, placeholders aside (shared/theme isAllCaps). */
function isAllCaps(english) {
	const bare = english.replace(PLACEHOLDER_RE, "");
	return /[A-Z]/.test(bare) && !/[a-z]/.test(bare);
}

/** Does `text` hold a lowercase letter, placeholders aside? (shared/theme hasLowercase.) */
function hasLowercase(text) {
	for (const ch of text.replace(PLACEHOLDER_RE, "")) if (isLowercaseCodepoint(ch.codePointAt(0))) return true;
	return false;
}

/**
 * The all-caps rule of the locale validator (docs/LOCALIZATION.md design 2; shared/theme breaksAllCaps): for Latin
 * and Cyrillic locales, a translation of an all-caps English string (placeholders aside) must have no lowercase
 * letters, as classified by LOWERCASE_RANGES (a letter it doesn't list passes, in the game too).
 */
function capsProblem(english, translation, script) {
	if (!CASED_SCRIPTS.includes(script) || !isAllCaps(english) || !hasLowercase(translation)) return undefined;
	return "English is all caps but the translation has lowercase letters";
}

/** Every problem that makes a translation unusable (the game would drop it), or [] when it is fine. */
function translationProblems(english, translation, script) {
	const out = [];
	if (!samePlaceholders(english, translation)) {
		out.push(`placeholders ${placeholderList(translation)} differ from the English ${placeholderList(english)}`);
	}
	const brace = braceProblem(translation);
	if (brace) out.push(brace);
	const caps = capsProblem(english, translation, script);
	if (caps) out.push(caps);
	return out;
}

// --- keys -----------------------------------------------------------------------------------------------------------

/**
 * Why a key of a source dump is or isn't translated: "dev" (shared/l10n isDevOnlyStringKey), "untranslated"
 * (UNTRANSLATED_STRING_KEYS), "translatable", or undefined when the English has no such key. The flags come from the
 * dump, computed by the game's own predicates, so node never re-implements the rule.
 */
function keyKind(source, key) {
	if (!Object.prototype.hasOwnProperty.call(source.strings, key)) return undefined;
	if (source.devOnlyKeys.includes(key)) return "dev";
	if (source.untranslatedKeys.includes(key)) return "untranslated";
	return "translatable";
}

/** The translatable keys of a source dump (shared/l10n isTranslatableStringKey: what is exported), sorted. */
function translatableKeys(source) {
	const skip = new Set([...source.devOnlyKeys, ...source.untranslatedKeys]);
	return Object.keys(source.strings)
		.filter((k) => !skip.has(k))
		.sort(compareKeys);
}

/** Plain code-unit order (keys are ASCII): the order of every generated file and CSV. */
function compareKeys(a, b) {
	return a < b ? -1 : a > b ? 1 : 0;
}

/** The locales that get a table and a CSV column: neither the source (first) nor the pseudo-locale. */
function targetLocales(source) {
	return source.locales.filter((l, i) => i !== 0 && l.code !== "en" && !l.pseudo);
}

// --- context and glossary (l10n/context.json, l10n/glossary.json; written by L7) ------------------------------------

/**
 * The glossary terms a key must keep verbatim: `translate: false` terms that appear in its English, limited to the
 * term's `keys` when it lists any.
 */
function doNotTranslateTerms(key, english, glossary) {
	const terms = (glossary && glossary.terms) || [];
	return terms
		.filter((t) => t && t.translate === false && typeof t.term === "string" && t.term !== "")
		.filter((t) => (!Array.isArray(t.keys) || t.keys.includes(key)) && english.includes(t.term))
		.map((t) => t.term);
}

/** The CSV Context cell: "<key> · <note> · max <n> chars · do not translate: <terms>" (absent parts left out). */
function contextCell(key, english, entry, glossary) {
	const parts = [key];
	if (entry && typeof entry.note === "string" && entry.note.trim() !== "") parts.push(entry.note.trim());
	if (entry && typeof entry.max === "number") parts.push(`max ${entry.max} chars`);
	const terms = doNotTranslateTerms(key, english, glossary);
	if (terms.length > 0) parts.push(`do not translate: ${terms.join(", ")}`);
	return parts.join(" · ");
}

/** The CSV Example cell: the English with its placeholders filled from the context entry's `example`, or "". */
function exampleCell(english, entry) {
	if (placeholders(english).length === 0 || !entry || !entry.example) return "";
	const filled = fillPlaceholders(english, entry.example);
	return filled === english ? "" : filled;
}

// --- files ----------------------------------------------------------------------------------------------------------

function readJson(file) {
	return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** A JSON file, or `fallback` (with a warning) when it does not exist. */
function readJsonOptional(file, fallback, warn, what) {
	if (!fs.existsSync(file)) {
		if (warn) warn(`${what || path.basename(file)} not found (${file}); continuing without it`);
		return fallback;
	}
	return readJson(file);
}

function readSource(file) {
	if (!fs.existsSync(file)) {
		throw new Error(`${file} not found: run \`npm run l10n:dump\` (after \`npm run build\`) first`);
	}
	const source = readJson(file);
	if (!source || typeof source.strings !== "object" || !Array.isArray(source.locales)) {
		throw new Error(`${file} is not an l10n source dump`);
	}
	for (const field of ["devOnlyKeys", "untranslatedKeys"]) {
		const list = source[field];
		if (!Array.isArray(list) || !list.every((k) => typeof k === "string")) {
			throw new Error(`${file} has no ${field} list (an older dump?): run \`npm run l10n:dump\` again`);
		}
	}
	// The game hashed every English string itself: the node hash must agree, or every srcHash we write is wrong.
	for (const [key, n] of Object.entries(source.srcHashes || {})) {
		const text = source.strings[key];
		if (text !== undefined && sourceHash(text) !== n) {
			throw new Error(`sourceHash mismatch for "${key}": node ${sourceHash(text)}, game ${n}`);
		}
	}
	return source;
}

function writeFileIfChanged(file, text) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === text) return false;
	fs.writeFileSync(file, text);
	return true;
}

/** Delete a file if it exists; returns a warning string instead of throwing when the delete is not allowed. */
function removeFile(file) {
	if (!fs.existsSync(file)) return undefined;
	try {
		fs.unlinkSync(file);
		return undefined;
	} catch (e) {
		return `could not delete ${file} (${e.code || e.message}); delete it by hand`;
	}
}

// --- Roblox CSV columns ---------------------------------------------------------------------------------------------

/**
 * Header -> locale code guesses, used when l10n/columns.json is missing (keep in step with that file). The real
 * header of a Creator Hub download is unconfirmed until spike L0 (f).
 */
const DEFAULT_COLUMNS = {
	es: "es",
	pt: "pt-BR",
	fr: "fr",
	de: "de",
	it: "it",
	pl: "pl",
	tr: "tr",
	id: "id",
	vi: "vi",
	ru: "ru",
	ja: "ja",
	ko: "ko",
	"zh-cn": "zh-CN",
	"zh-tw": "zh-TW",
	th: "th",
	hi: "hi",
	ar: "ar",
};

/** The fixed (non-locale) columns, by lowercase header. */
const FIXED_COLUMNS = ["key", "source", "context", "example"];

function loadColumns(file, warn) {
	const doc = readJsonOptional(file, null, warn, "l10n/columns.json");
	const columns = doc && doc.columns ? doc.columns : DEFAULT_COLUMNS;
	return columns;
}

/** The CSV header to write for each target locale: the first columns.json header naming it, else the code. */
function exportHeaders(columns, locales) {
	return locales.map((l) => {
		const entry = Object.entries(columns).find(([, code]) => code === l.code);
		return entry ? entry[0] : l.code;
	});
}

/**
 * The locale code a CSV column header stands for, or undefined: columns.json (case-insensitive), then a LOCALES code,
 * then a LOCALES Roblox id, then a language-only match ("es-mx" -> "es", "pt-pt" -> "pt-BR") when exactly one target
 * locale has that language.
 */
function localeForHeader(header, columns, locales) {
	const h = header.trim().toLowerCase();
	if (h === "") return undefined;
	for (const [name, code] of Object.entries(columns)) {
		if (name.toLowerCase() === h) return code;
	}
	const byCode = locales.find((l) => l.code.toLowerCase() === h);
	if (byCode) return byCode.code;
	const byId = locales.find((l) => (l.roblox || []).some((id) => id.toLowerCase() === h));
	if (byId) return byId.code;
	const lang = h.split(/[-_]/)[0];
	const byLang = locales.filter((l) => l.code.toLowerCase().split("-")[0] === lang);
	return byLang.length === 1 ? byLang[0].code : undefined;
}

// --- generated locale tables ----------------------------------------------------------------------------------------

const GENERATED_HEADER =
	"// Generated by `npm run l10n:import` (scripts/l10n) from the Roblox cloud localization table. Do not edit.";

/** "pt-BR" -> "pt_br": the table's file name (without .ts) and its import identifier in index.ts. */
function tableIdent(code) {
	return code.toLowerCase().replace(/-/g, "_");
}

function tableFile(dir, code) {
	return path.join(dir, `${tableIdent(code)}.ts`);
}

let prettierOptions;
function formatTs(text, prettierrc = defaultPaths().prettierrc) {
	const prettier = require("prettier");
	if (!prettierOptions) prettierOptions = JSON.parse(fs.readFileSync(prettierrc, "utf8"));
	return prettier.format(text, { ...prettierOptions, parser: "typescript" });
}

/** A table module's text. `entries`: Map or object key -> [text, srcHash]; written with sorted keys. */
function renderTable(entries) {
	const map = entries instanceof Map ? entries : new Map(Object.entries(entries));
	const keys = [...map.keys()].sort(compareKeys);
	const lines = keys.map((k) => {
		const [text, hash] = map.get(k);
		return `\t${JSON.stringify(k)}: [${JSON.stringify(text)}, ${hash >>> 0}],`;
	});
	return formatTs(
		[
			GENERATED_HEADER,
			'import type { LocaleTable } from "shared/l10n";',
			"",
			"export const LOCALE_TABLE: LocaleTable = {",
			...lines,
			"};",
			"",
		].join("\n"),
	);
}

/** index.ts's text for these locale codes (sorted). */
function renderIndex(codes) {
	const sorted = [...codes].sort(compareKeys);
	const imports = sorted.map((c) => `import { LOCALE_TABLE as ${tableIdent(c)} } from "./${tableIdent(c)}";`);
	const entries = sorted.map((c) => `\t[${JSON.stringify(c)}, ${tableIdent(c)}],`);
	const map =
		sorted.length === 0
			? "new Map<string, LocaleTable>([]);"
			: ["new Map<string, LocaleTable>([", ...entries, "]);"].join("\n");
	return formatTs(
		[
			GENERATED_HEADER,
			'import type { LocaleTable } from "shared/l10n";',
			...imports,
			"",
			"/** Generated locale tables by locale code (docs/LOCALIZATION.md design 2). */",
			`export const LOCALE_TABLES: ReadonlyMap<string, LocaleTable> = ${map}`,
			"",
		].join("\n"),
	);
}

/**
 * Read a generated table module back: Map key -> [text, srcHash]. Parsed with the TypeScript parser (never
 * evaluated); throws on anything but `export const LOCALE_TABLE: LocaleTable = { "<key>": ["<text>", <n>], ... }`.
 */
function parseTable(text, file = "table") {
	const ts = require("typescript");
	const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
	const fail = (why, node) => {
		const pos = node ? sf.getLineAndCharacterOfPosition(node.getStart(sf)) : undefined;
		throw new Error(`${file}${pos ? `:${pos.line + 1}` : ""}: ${why}`);
	};
	if (sf.parseDiagnostics && sf.parseDiagnostics.length > 0) {
		fail(`syntax error: ${ts.flattenDiagnosticMessageText(sf.parseDiagnostics[0].messageText, " ")}`);
	}
	let literal;
	for (const st of sf.statements) {
		if (!ts.isVariableStatement(st)) continue;
		for (const d of st.declarationList.declarations) {
			if (ts.isIdentifier(d.name) && d.name.text === "LOCALE_TABLE") literal = d.initializer;
		}
	}
	if (!literal || !ts.isObjectLiteralExpression(literal)) fail("no `LOCALE_TABLE = { ... }` object literal");
	const isStr = (n) => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n);
	const out = new Map();
	for (const p of literal.properties) {
		if (!ts.isPropertyAssignment(p)) fail("not a `key: [text, hash]` entry", p);
		const key = isStr(p.name) || ts.isIdentifier(p.name) ? p.name.text : fail("unsupported key", p);
		const v = p.initializer;
		if (!ts.isArrayLiteralExpression(v) || v.elements.length !== 2) fail(`"${key}": expected [text, hash]`, p);
		const [t, h] = v.elements;
		if (!isStr(t) || !ts.isNumericLiteral(h)) fail(`"${key}": expected ["text", number]`, p);
		if (out.has(key)) fail(`duplicate key "${key}"`, p);
		out.set(key, [t.text, Number(h.text)]);
	}
	return out;
}

/**
 * The existing generated tables in `dir` for these locales: { tables: Map code -> Map key -> [text, hash],
 * errors: [file: message] } (a table that does not parse is an error, not an empty table).
 */
function readTables(dir, locales) {
	const tables = new Map();
	const errors = [];
	for (const l of locales) {
		const file = tableFile(dir, l.code);
		if (!fs.existsSync(file)) continue;
		try {
			tables.set(l.code, parseTable(fs.readFileSync(file, "utf8"), path.relative(process.cwd(), file)));
		} catch (e) {
			errors.push(e.message);
		}
	}
	return { tables, errors };
}

/** Code points, not UTF-16 units (an emoji is one character of a budget). */
function charLength(text) {
	return Array.from(text).length;
}

module.exports = {
	REPO,
	defaultPaths,
	parseCsv,
	writeCsv,
	sourceHash,
	placeholders,
	samePlaceholders,
	braceProblem,
	CASED_SCRIPTS,
	lowercaseRanges,
	isLowercaseCodepoint,
	isAllCaps,
	hasLowercase,
	capsProblem,
	translationProblems,
	fillPlaceholders,
	placeholderList,
	doNotTranslateTerms,
	contextCell,
	exampleCell,
	keyKind,
	translatableKeys,
	compareKeys,
	targetLocales,
	readJson,
	readJsonOptional,
	readSource,
	writeFileIfChanged,
	removeFile,
	DEFAULT_COLUMNS,
	FIXED_COLUMNS,
	loadColumns,
	exportHeaders,
	localeForHeader,
	GENERATED_HEADER,
	tableIdent,
	tableFile,
	formatTs,
	renderTable,
	renderIndex,
	parseTable,
	readTables,
	charLength,
};

#!/usr/bin/env node
// English -> Roblox cloud localization table CSV (docs/LOCALIZATION.md design 4, task L10).
//
//   npm run l10n:export [-- --changed]
//
// `npm run l10n:export` runs `l10n:dump` first, which NEEDS A BUILD (`npm run build`): the English comes from the
// compiled game (l10n/build/source.json), not from the TypeScript source. Reads l10n/context.json and
// l10n/glossary.json (L7; missing ones are a warning), l10n/columns.json (locale column headers) and the generated
// tables in src/shared/theme/locales. Writes l10n/out/kv-strings.csv, then kv-strings-2.csv, -3, ... (at most 1,000
// rows each: Roblox's per-upload limit). Columns: Key, Source, Context, Example, then one per target locale holding
// the current (non-stale) translation, so a re-upload never wipes the cloud's translations. Developer keys
// (DEV_ONLY_STRING_PREFIXES) are never exported. --changed: only keys whose English changed since the last import
// (a table's srcHash differs) or that no table has yet.
//
// Upload the files in the Creator Hub: Localization -> Table Management (docs/LOCALIZATION.md design 4).
"use strict";

const path = require("path");
const lib = require("./lib.js");

const BATCH_SIZE = 1000;

function batchFileName(i) {
	return i === 0 ? "kv-strings.csv" : `kv-strings-${i + 1}.csv`;
}

/**
 * Build and write the export. opts: { paths?, changed?, batchSize?, warn? }. Returns { files, rows, keys, warnings }.
 */
function runExport(opts = {}) {
	const paths = { ...lib.defaultPaths(), ...(opts.paths || {}) };
	const warnings = [];
	const warn = opts.warn || ((m) => warnings.push(m));
	const batchSize = opts.batchSize || BATCH_SIZE;

	const source = lib.readSource(paths.source);
	const context = lib.readJsonOptional(paths.context, {}, warn, "l10n/context.json");
	const glossary = lib.readJsonOptional(paths.glossary, { terms: [] }, warn, "l10n/glossary.json");
	const columns = lib.loadColumns(paths.columns, warn);
	const locales = lib.targetLocales(source);
	const { tables, errors } = lib.readTables(paths.localesDir, locales);
	if (errors.length > 0) throw new Error(`unreadable locale table(s):\n  ${errors.join("\n  ")}`);

	let keys = lib.playerFacingKeys(source);
	if (opts.changed) {
		keys = keys.filter((key) => {
			const hash = lib.sourceHash(source.strings[key]);
			let seen = false;
			for (const table of tables.values()) {
				const entry = table.get(key);
				if (entry === undefined) continue;
				seen = true;
				if (entry[1] !== hash) return true;
			}
			return !seen;
		});
	}

	const header = ["Key", "Source", "Context", "Example", ...lib.exportHeaders(columns, locales)];
	const rows = keys.map((key) => {
		const english = source.strings[key];
		const hash = lib.sourceHash(english);
		const entry = context[key];
		return [
			key,
			english,
			lib.contextCell(key, english, entry, glossary),
			lib.exampleCell(english, entry),
			...locales.map((l) => {
				const t = tables.get(l.code) && tables.get(l.code).get(key);
				return t && t[1] === hash ? t[0] : "";
			}),
		];
	});

	const files = [];
	const batches = Math.max(1, Math.ceil(rows.length / batchSize));
	for (let i = 0; i < batches; i++) {
		const file = path.join(paths.outDir, batchFileName(i));
		lib.writeFileIfChanged(file, lib.writeCsv([header, ...rows.slice(i * batchSize, (i + 1) * batchSize)]));
		files.push(file);
	}
	// Batches left over from a bigger export would be uploaded by mistake.
	for (let i = batches; i < batches + 50; i++) {
		const w = lib.removeFile(path.join(paths.outDir, batchFileName(i)));
		if (w) warn(w);
	}
	return { files, rows: rows.length, keys, warnings };
}

function main(argv) {
	const opts = { changed: false };
	for (const a of argv) {
		if (a === "--changed") opts.changed = true;
		else {
			console.error(`l10n:export: unknown argument ${a} (usage: export.js [--changed])`);
			return 2;
		}
	}
	try {
		const r = runExport({ ...opts, warn: (m) => console.warn(`l10n:export: warning: ${m}`) });
		const rel = r.files.map((f) => path.relative(process.cwd(), f)).join(", ");
		console.log(`l10n:export: ${r.rows} row(s)${opts.changed ? " (changed only)" : ""} -> ${rel}`);
		return 0;
	} catch (e) {
		console.error(`l10n:export: ${e.message}`);
		return 1;
	}
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { runExport, batchFileName, BATCH_SIZE };

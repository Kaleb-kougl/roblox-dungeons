#!/usr/bin/env node
// Roblox cloud localization table CSV -> generated locale tables (docs/LOCALIZATION.md design 2 and 4, task L10).
//
//   npm run l10n:import -- l10n/in/table.csv [more.csv ...]
//
// `npm run l10n:import` runs `l10n:dump` first, which NEEDS A BUILD (`npm run build`): the current English comes
// from l10n/build/source.json. Columns are
// found by header name, case-insensitively: Key, Source (required), then locale columns mapped through
// l10n/columns.json, LOCALES codes, LOCALES Roblox ids, then the language alone. Several files (export batches) merge;
// a later file wins a duplicate cell. For every locale with a column it rewrites src/shared/theme/locales/<code>.ts
// (sorted keys, entry = [text, sourceHash(the row's Source)], empty cells skipped; a locale with no usable cell gets
// no table), then regenerates index.ts and writes l10n/report.md. A locale with no column is left as it is.
// Rejected (never written): a cell whose {placeholders} differ from its Source's, malformed braces, lowercase in an
// all-caps Latin / Cyrillic string (the game's own rule: lib.js capsProblem), and keys the game does not have or does
// not translate (developer keys, `fx.cap`). A row whose Source is not the current English is written but stale: the
// game shows English until the cloud is re-translated.
"use strict";

const fs = require("fs");
const path = require("path");
const lib = require("./lib.js");

/** CRLF inside a cell (a spreadsheet's line break) reads as the game's "\n". */
function cellText(value) {
	return (value || "").replace(/\r\n?/g, "\n");
}

function headerIndex(header, name) {
	return header.findIndex((h) => h.trim().toLowerCase() === name);
}

/**
 * Import CSV files. opts: { paths?, warn? }. Returns { stats: Map code -> stats, written, removed, index, report,
 * warnings }.
 */
function runImport(csvFiles, opts = {}) {
	if (!csvFiles || csvFiles.length === 0) throw new Error("no CSV files given (usage: import.js <csv...>)");
	const paths = { ...lib.defaultPaths(), ...(opts.paths || {}) };
	const warnings = [];
	const warn = opts.warn || ((m) => warnings.push(m));

	const source = lib.readSource(paths.source);
	const columns = lib.loadColumns(paths.columns, warn);
	const targets = lib.targetLocales(source);
	const targetCodes = new Set(targets.map((l) => l.code));
	const scriptOf = new Map(source.locales.map((l) => [l.code, l.script]));
	const translatable = new Set(lib.translatableKeys(source));

	// code -> Map key -> { text, src }
	const cells = new Map();
	const stats = new Map();
	const statFor = (code, header) => {
		if (!stats.has(code)) {
			stats.set(code, { code, headers: new Set(), rows: 0, filled: 0, rejected: [], stale: [], unknown: [] });
		}
		const s = stats.get(code);
		if (header) s.headers.add(header);
		return s;
	};
	const ignoredColumns = [];
	const unknownColumns = [];
	const unknownKeys = new Set();
	let keylessRows = 0;
	const inputs = [];

	for (const file of csvFiles) {
		inputs.push(path.basename(file));
		const rows = lib.parseCsv(fs.readFileSync(file, "utf8"));
		if (rows.length === 0) {
			warn(`${file}: empty`);
			continue;
		}
		const header = rows[0];
		const iKey = headerIndex(header, "key");
		const iSource = headerIndex(header, "source");
		if (iKey < 0 || iSource < 0)
			throw new Error(`${file}: no Key / Source column in the header (${header.join(", ")})`);
		const localeCols = [];
		header.forEach((h, i) => {
			if (lib.FIXED_COLUMNS.includes(h.trim().toLowerCase())) return;
			const code = lib.localeForHeader(h, columns, source.locales);
			if (code === undefined) {
				if (h.trim() !== "") unknownColumns.push(`${path.basename(file)}: "${h}"`);
			} else if (!targetCodes.has(code)) {
				ignoredColumns.push(`${path.basename(file)}: "${h}" (${code})`);
			} else {
				localeCols.push({ i, code, header: h });
				statFor(code, h);
			}
		});
		for (let r = 1; r < rows.length; r++) {
			const row = rows[r];
			if (row.every((c) => c.trim() === "")) continue;
			const key = (row[iKey] || "").trim();
			if (key === "") {
				keylessRows++;
				continue;
			}
			const src = cellText(row[iSource]);
			const known = translatable.has(key);
			if (!known) unknownKeys.add(key);
			for (const col of localeCols) {
				const s = statFor(col.code);
				s.rows++;
				const text = cellText(row[col.i]);
				if (text.trim() === "") continue;
				s.filled++;
				if (!known) {
					s.unknown.push(key);
					continue;
				}
				const problems = lib.translationProblems(src, text, scriptOf.get(col.code));
				if (problems.length > 0) {
					s.rejected.push({ key, reasons: problems });
					continue;
				}
				if (!cells.has(col.code)) cells.set(col.code, new Map());
				const prev = cells.get(col.code).get(key);
				if (prev && (prev.text !== text || prev.src !== src)) {
					warn(`${col.code} "${key}": a later file overrides an earlier cell`);
				}
				cells.get(col.code).set(key, { text, src });
			}
		}
	}

	const written = [];
	const removed = [];
	for (const code of [...stats.keys()].sort(lib.compareKeys)) {
		const s = stats.get(code);
		const entries = cells.get(code) || new Map();
		const table = new Map();
		for (const [key, { text, src }] of entries) {
			table.set(key, [text, lib.sourceHash(src)]);
			if (src !== source.strings[key]) s.stale.push(key);
		}
		s.accepted = table.size;
		const file = lib.tableFile(paths.localesDir, code);
		if (table.size === 0) {
			if (fs.existsSync(file)) {
				const w = lib.removeFile(file);
				if (w) warn(w);
				else removed.push(code);
			}
			continue;
		}
		lib.writeFileIfChanged(file, lib.renderTable(table));
		written.push(code);
	}

	const present = targets.map((l) => l.code).filter((c) => fs.existsSync(lib.tableFile(paths.localesDir, c)));
	lib.writeFileIfChanged(path.join(paths.localesDir, "index.ts"), lib.renderIndex(present));

	const report = renderReport({
		inputs,
		stats,
		targets,
		playerKeyCount: translatable.size,
		unknownKeys,
		unknownColumns,
		ignoredColumns,
		keylessRows,
		warnings,
	});
	lib.writeFileIfChanged(paths.report, report);
	return { stats, written, removed, index: present, report, warnings };
}

function renderReport(r) {
	const pct = (n, d) => (d === 0 ? "0%" : `${Math.floor((1000 * n) / d) / 10}%`);
	const codeList = (keys) => keys.map((k) => `\`${k}\``).join(", ");
	const lines = [
		"# Localization import report",
		"",
		`Generated by \`npm run l10n:import\` (scripts/l10n/import.js) from ${r.inputs.join(", ")}. Do not edit.`,
		"",
		`English: ${r.playerKeyCount} translatable keys. Coverage counts current (non-stale) translations.`,
		"",
		"| Locale | Column | Rows | Filled | Written | Rejected | Stale | Unknown keys | Coverage |",
		"|---|---|---|---|---|---|---|---|---|",
	];
	const codes = r.targets.map((l) => l.code).filter((c) => r.stats.has(c));
	for (const code of codes) {
		const s = r.stats.get(code);
		lines.push(
			`| ${code} | ${[...s.headers].join(", ")} | ${s.rows} | ${s.filled} | ${s.accepted} | ${
				s.rejected.length
			} | ` + `${s.stale.length} | ${s.unknown.length} | ${pct(s.accepted - s.stale.length, r.playerKeyCount)} |`,
		);
	}
	const missing = r.targets.map((l) => l.code).filter((c) => !r.stats.has(c));
	if (missing.length > 0) lines.push("", `No column (tables left as they were): ${missing.join(", ")}.`);
	for (const code of codes) {
		const s = r.stats.get(code);
		if (s.rejected.length + s.stale.length + s.unknown.length === 0) continue;
		lines.push("", `## ${code}`);
		if (s.rejected.length > 0) {
			lines.push("", `Rejected (${s.rejected.length}, English shows instead):`, "");
			for (const x of s.rejected) lines.push(`- \`${x.key}\`: ${x.reasons.join("; ")}`);
		}
		if (s.stale.length > 0) {
			lines.push(
				"",
				`Stale (${s.stale.length}, Source differs from the current English): ${codeList(s.stale.sort())}`,
			);
		}
		if (s.unknown.length > 0) lines.push("", `Unknown keys (${s.unknown.length}, skipped): ${codeList(s.unknown)}`);
	}
	if (r.unknownKeys.size > 0) {
		lines.push(
			"",
			`## Unknown keys`,
			"",
			`Rows whose Key is not a translatable key of the current English (removed, renamed, developer-only or untranslated), ` +
				`skipped: ${codeList([...r.unknownKeys].sort())}`,
		);
	}
	const notes = [];
	if (r.keylessRows > 0) notes.push(`${r.keylessRows} row(s) without a Key skipped (captured text?)`);
	if (r.unknownColumns.length > 0)
		notes.push(`unmapped columns (add them to l10n/columns.json?): ${r.unknownColumns.join(", ")}`);
	if (r.ignoredColumns.length > 0)
		notes.push(`ignored columns (source / pseudo-locale): ${r.ignoredColumns.join(", ")}`);
	for (const w of r.warnings) notes.push(w);
	if (notes.length > 0) {
		lines.push("", "## Notes", "");
		for (const n of notes) lines.push(`- ${n}`);
	}
	return lines.join("\n") + "\n";
}

function main(argv) {
	if (argv.length === 0) {
		console.error("usage: npm run l10n:import -- <table.csv> [more.csv ...]");
		return 2;
	}
	try {
		const r = runImport(argv, { warn: (m) => console.warn(`l10n:import: warning: ${m}`) });
		for (const code of [...r.stats.keys()].sort(lib.compareKeys)) {
			const s = r.stats.get(code);
			console.log(
				`l10n:import: ${code}: ${s.accepted} written, ${s.rejected.length} rejected, ${s.stale.length} stale, ` +
					`${s.unknown.length} unknown`,
			);
		}
		if (r.removed.length > 0) console.log(`l10n:import: removed empty tables: ${r.removed.join(", ")}`);
		console.log(`l10n:import: index.ts lists ${r.index.length} table(s); report in l10n/report.md`);
		return 0;
	} catch (e) {
		console.error(`l10n:import: ${e.message}`);
		return 1;
	}
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { runImport };

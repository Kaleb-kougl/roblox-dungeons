#!/usr/bin/env node
// Localization health check (docs/LOCALIZATION.md design 2-4, task L10).
//
//   npm run l10n:check [-- --verbose]
//
// `npm run l10n:check` runs `l10n:dump` first, which NEEDS A BUILD (`npm run build`). Compares the generated tables
// (src/shared/theme/locales) and l10n/context.json / l10n/glossary.json with the current English
// (l10n/build/source.json) and prints, per locale: coverage, stale entries (English changed since translating),
// placeholder / brace / caps problems, over-budget translations (context `max`, in characters), and glossary
// `translate: false` terms missing verbatim; plus player-facing keys with no context entry and context entries for
// unknown keys.
//
// Exit 1 only on a structural problem: an unparseable table, an unknown key in a table, index.ts out of step with the
// table files, or (once l10n/context.json exists) a player-facing key without a context entry. Coverage, stale,
// problems and budgets are warnings: translation progress never blocks a build.
"use strict";

const fs = require("fs");
const path = require("path");
const lib = require("./lib.js");

/** opts: { paths? }. Returns { errors, warnings, locales: [{ code, current, stale, problems, overBudget, glossary }] }. */
function runCheck(opts = {}) {
	const paths = { ...lib.defaultPaths(), ...(opts.paths || {}) };
	const errors = [];
	const warnings = [];

	const source = lib.readSource(paths.source);
	const hasContext = fs.existsSync(paths.context);
	const context = lib.readJsonOptional(paths.context, {}, (m) => warnings.push(m), "l10n/context.json");
	const glossary = lib.readJsonOptional(paths.glossary, { terms: [] }, (m) => warnings.push(m), "l10n/glossary.json");
	const targets = lib.targetLocales(source);
	const keys = lib.playerFacingKeys(source);
	const playerKeys = new Set(keys);

	const { tables, errors: parseErrors } = lib.readTables(paths.localesDir, targets);
	for (const e of parseErrors) errors.push(`unparseable table: ${e}`);

	// index.ts must list exactly the table files.
	const indexFile = path.join(paths.localesDir, "index.ts");
	const present = targets.map((l) => l.code).filter((c) => fs.existsSync(lib.tableFile(paths.localesDir, c)));
	if (fs.existsSync(indexFile)) {
		if (fs.readFileSync(indexFile, "utf8") !== lib.renderIndex(present)) {
			errors.push(
				`index.ts does not list exactly the table files (${present.join(", ") || "none"}): run l10n:import`,
			);
		}
	} else if (present.length > 0) {
		errors.push(`index.ts is missing but tables exist (${present.join(", ")}): run l10n:import`);
	}
	if (fs.existsSync(paths.localesDir)) {
		const known = new Set(["index.ts", ...targets.map((l) => `${lib.tableIdent(l.code)}.ts`)]);
		for (const f of fs.readdirSync(paths.localesDir)) {
			if (f.endsWith(".ts") && !known.has(f)) warnings.push(`unexpected file in the locales folder: ${f}`);
		}
	}

	const locales = [];
	for (const l of targets) {
		const table = tables.get(l.code);
		const r = { code: l.code, current: 0, stale: [], problems: [], overBudget: [], glossary: [] };
		locales.push(r);
		if (!table) continue;
		for (const [key, [text, hash]] of table) {
			if (!playerKeys.has(key)) {
				const why = key in source.strings ? "a developer key" : "not in the English";
				errors.push(`${l.code}: unknown key "${key}" in the table (${why}): re-import`);
				continue;
			}
			const english = source.strings[key];
			if (hash !== lib.sourceHash(english)) {
				r.stale.push(key);
				continue;
			}
			r.current++;
			for (const p of lib.translationProblems(english, text, l.script)) r.problems.push(`${key}: ${p}`);
			const max = context[key] && context[key].max;
			if (typeof max === "number" && lib.charLength(text) > max) {
				r.overBudget.push(`${key}: ${lib.charLength(text)} > ${max} chars`);
			}
			for (const term of lib.doNotTranslateTerms(key, english, glossary)) {
				if (!text.includes(term)) r.glossary.push(`${key}: "${term}" missing`);
			}
		}
	}

	const noContext = keys.filter((k) => !context[k]);
	if (noContext.length > 0) {
		const msg = `${noContext.length} player-facing key(s) without a context entry: ${noContext.join(", ")}`;
		if (hasContext) errors.push(msg);
		else warnings.push(`(no l10n/context.json yet) ${msg}`);
	}
	const strayContext = Object.keys(context).filter((k) => !playerKeys.has(k));
	if (strayContext.length > 0) {
		warnings.push(
			`${strayContext.length} context entr(ies) for unknown or developer keys: ${strayContext.join(", ")}`,
		);
	}
	return { errors, warnings, locales, keyCount: keys.length };
}

function main(argv) {
	const verbose = argv.includes("--verbose");
	const unknown = argv.filter((a) => a !== "--verbose");
	if (unknown.length > 0) {
		console.error(`l10n:check: unknown argument ${unknown[0]} (usage: check.js [--verbose])`);
		return 2;
	}
	let r;
	try {
		r = runCheck();
	} catch (e) {
		console.error(`l10n:check: ${e.message}`);
		return 1;
	}
	const LIMIT = 10;
	const list = (items) =>
		verbose || items.length <= LIMIT
			? items
			: [...items.slice(0, LIMIT), `... ${items.length - LIMIT} more (--verbose)`];
	console.log(`l10n:check: ${r.keyCount} player-facing keys`);
	for (const l of r.locales) {
		const pct = Math.floor((1000 * l.current) / Math.max(1, r.keyCount)) / 10;
		console.log(
			`  ${l.code.padEnd(6)} ${String(pct).padStart(5)}%  current ${l.current}, stale ${l.stale.length}, ` +
				`problems ${l.problems.length}, over budget ${l.overBudget.length}, glossary ${l.glossary.length}`,
		);
		for (const [label, items] of [
			["problem", l.problems],
			["over budget", l.overBudget],
			["glossary", l.glossary],
		]) {
			for (const x of list(items)) console.log(`      ${label}: ${x}`);
		}
		if (verbose && l.stale.length > 0) console.log(`      stale: ${l.stale.join(", ")}`);
	}
	for (const w of r.warnings)
		console.warn(`l10n:check: warning: ${verbose || w.length < 400 ? w : `${w.slice(0, 400)}... (--verbose)`}`);
	for (const e of r.errors) console.error(`l10n:check: error: ${e}`);
	console.log(`l10n:check: ${r.errors.length} error(s), ${r.warnings.length} warning(s)`);
	return r.errors.length > 0 ? 1 : 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { runCheck };

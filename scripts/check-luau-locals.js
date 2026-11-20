// Luau allows at most 200 local variables in one function, and a module's top level is one function: a compiled
// module with more fails to load with "Out of local registers ...: exceeded limit 200" (measured on Lune 0.11.0:
// 200 load, 201 do not; locals the compiler folds as constants are not charged, so the count here is an upper
// bound). This check (npm run
// check:locals, part of verify, after build) counts the top-level local NAMES of every compiled module under out/
// and fails with the module's name before Luau does (docs/CODEBASE_SCALE.md DX1, DXD2).
//
//   node scripts/check-luau-locals.js [--json] [outDir]
//
// A top-level local is a line that starts at column 0 with `local `: `local function f` is one name,
// `local a, b = f()` is two. Spec modules are skipped (they are never near the limit and are not shipped).
"use strict";

const fs = require("node:fs");
const path = require("node:path");

/** Luau's limit on local variables in one function (a module's top level). */
const LIMIT = 200;
/** A module at or above this is listed on every run: split it before the next feature lands in it. */
const WARN = 185;

/** The number of top-level local names in a Luau source. */
function countTopLevelLocals(source) {
	let count = 0;
	let inBlockComment = false;
	for (const line of source.split("\n")) {
		if (inBlockComment) {
			if (line.includes("]]")) inBlockComment = false;
			continue;
		}
		if (line.startsWith("--[[") && !line.includes("]]")) {
			inBlockComment = true;
			continue;
		}
		if (!line.startsWith("local ")) continue;
		const rest = line.slice("local ".length);
		if (rest.startsWith("function ") || rest.startsWith("function\t")) {
			count += 1;
			continue;
		}
		// `local a, b: T<X, Y> = ...`: names are the comma-separated parts before `=`, outside any type brackets.
		const eq = rest.indexOf("=");
		const names = eq === -1 ? rest : rest.slice(0, eq);
		let depth = 0;
		let n = 1;
		for (let i = 0; i < names.length; i++) {
			const ch = names[i];
			if (ch === "<" || ch === "(" || ch === "{") depth += 1;
			else if (ch === ">" && names[i - 1] === "-") continue; // a function type's arrow
			else if (ch === ">" || ch === ")" || ch === "}") depth -= 1;
			else if (ch === "," && depth === 0) n += 1;
		}
		count += n;
	}
	return count;
}

function isSpecModule(file) {
	return /\.spec\.luau$/.test(file);
}

/** Every non-spec .luau file under dir, sorted. */
function listModules(dir) {
	const found = [];
	const walk = (d) => {
		for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
			const full = path.join(d, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.isFile() && entry.name.endsWith(".luau") && !isSpecModule(entry.name)) found.push(full);
		}
	};
	walk(dir);
	return found.sort();
}

/** { file, locals } for every module under outDir, most locals first (ties by path). */
function measure(outDir) {
	return listModules(outDir)
		.map((file) => ({
			file: path.relative(outDir, file).split(path.sep).join("/"),
			locals: countTopLevelLocals(fs.readFileSync(file, "utf8")),
		}))
		.sort((a, b) => b.locals - a.locals || (a.file < b.file ? -1 : 1));
}

/** The check's verdict over measured modules. */
function judge(modules, limit = LIMIT, warn = WARN) {
	return {
		over: modules.filter((m) => m.locals > limit),
		near: modules.filter((m) => m.locals >= warn && m.locals <= limit),
	};
}

function main(argv) {
	const json = argv.includes("--json");
	const outDir = argv.find((a) => !a.startsWith("--")) ?? "out";
	if (!fs.existsSync(outDir)) {
		console.error(`check-luau-locals: ${outDir} does not exist. Run \`npm run build\` first.`);
		return 1;
	}
	const modules = measure(outDir);
	const { over, near } = judge(modules);
	if (json) {
		console.log(JSON.stringify({ limit: LIMIT, warn: WARN, modules: modules.filter((m) => m.locals >= WARN) }));
		return over.length > 0 ? 1 : 0;
	}
	for (const m of near) {
		console.log(`check-luau-locals: warning: ${outDir}/${m.file} has ${m.locals} top-level locals (limit ${LIMIT})`);
	}
	for (const m of over) {
		console.error(
			`check-luau-locals: ${outDir}/${m.file} has ${m.locals} top-level locals; Luau allows ${LIMIT}. ` +
				"Move constants into another module, or group them inside a function or an object.",
		);
	}
	if (over.length > 0) return 1;
	console.log(`check-luau-locals: ${modules.length} modules, none over ${LIMIT} (${near.length} at or above ${WARN})`);
	return 0;
}

module.exports = { LIMIT, WARN, countTopLevelLocals, isSpecModule, listModules, measure, judge };

if (require.main === module) process.exit(main(process.argv.slice(2)));

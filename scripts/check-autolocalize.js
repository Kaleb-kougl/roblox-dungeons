#!/usr/bin/env node
/*
 * Guard: Roblox's automatic translation never touches our GUIs, and code never upper-cases text
 * (docs/LOCALIZATION.md design 5 and "Edge cases", task L5).
 *
 * Scans the .ts / .tsx files under src/ (except src/shared/fixtures-generated/**). Fails (exit 1) on:
 *
 *   1. a bare `new Instance("ScreenGui" | "SurfaceGui" | "BillboardGui")` anywhere outside
 *      src/client/ui/gui.ts: use createKvScreenGui / createKvSurfaceGui / createKvBillboardGui from client/ui,
 *      which set AutoLocalize = false;
 *   2. a `<screengui` / `<surfacegui` / `<billboardgui` JSX element whose opening tag lacks `AutoLocalize={false}`;
 *   3. `.upper(` (`str.upper()`, `string.upper(...)`) in src/client/** and src/shared/view/**: Luau's upper is ASCII
 *      only, so translated text must arrive in its final case (translators supply the caps form).
 *
 * Comments and string contents are ignored. A justified case opts out with `// check-autolocalize: allow (reason)`
 * (or `{/* check-autolocalize: allow (reason) *\/}` in JSX) on the flagged line or the line above it.
 *
 * Usage: node scripts/check-autolocalize.js [--root <dir>]   (default: the repo's src/)
 * Plain Node, no dependencies. `checkSource(relPath, source)` is exported for the specs.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const EXEMPT = ["shared/fixtures-generated/"];
/** The one file that may construct root GUIs (it sets AutoLocalize = false). */
const HELPER = "client/ui/gui.ts";
/** Where `.upper(` is banned (UI and view code: anything that may hold translated text). */
const UPPER_SCOPES = ["client/", "shared/view/"];
const SCANNED_EXTENSIONS = new Set([".ts", ".tsx"]);
const ALLOW = "check-autolocalize: allow";

const BARE_GUI = /\bnew\s+Instance\s*\(\s*(["'`])(ScreenGui|SurfaceGui|BillboardGui)\1\s*\)/g;
const JSX_GUI = /<(screengui|surfacegui|billboardgui)(?![\w-])/g;
const AUTOLOCALIZE_OFF = /\bAutoLocalize\s*=\s*\{\s*false\s*\}/;
const UPPER = /\.\s*upper\s*\(/g;

/**
 * The source with comments blanked (newlines kept, so offsets and lines still match). `keepStrings` false also blanks
 * string and template contents (quotes kept). A small tokenizer: regex literals are not recognised.
 */
function strip(source, keepStrings) {
	let out = "";
	let i = 0;
	const n = source.length;
	const blank = (text) => text.replace(/[^\n]/g, " ");
	while (i < n) {
		const c = source[i];
		const next = source[i + 1];
		if (c === "/" && next === "/") {
			let j = i;
			while (j < n && source[j] !== "\n") j++;
			out += blank(source.slice(i, j));
			i = j;
		} else if (c === "/" && next === "*") {
			let j = source.indexOf("*/", i + 2);
			j = j < 0 ? n : j + 2;
			out += blank(source.slice(i, j));
			i = j;
		} else if (c === '"' || c === "'" || c === "`") {
			let j = i + 1;
			while (j < n && source[j] !== c) {
				if (source[j] === "\\") j++;
				else if (source[j] === "\n" && c !== "`") break;
				j++;
			}
			const end = source[j] === c ? j + 1 : j;
			const body = source.slice(i + 1, end - (source[j] === c ? 1 : 0));
			out += c + (keepStrings ? body : blank(body)) + (source[j] === c ? c : "");
			i = end;
		} else {
			out += c;
			i++;
		}
	}
	return out;
}

function lineAt(text, offset) {
	let line = 1;
	for (let k = 0; k < offset; k++) if (text.charCodeAt(k) === 10) line++;
	return line;
}

/** The opening tag starting at `start` (a `<`), up to its `>` outside any `{...}` expression. */
function openingTag(code, start) {
	let depth = 0;
	for (let k = start + 1; k < code.length; k++) {
		const c = code[k];
		if (c === "{") depth++;
		else if (c === "}") depth--;
		else if (c === ">" && depth === 0) return code.slice(start, k + 1);
	}
	return code.slice(start);
}

/** Hits `{ line, why, text }` for one file; `rel` is its path under src/ with forward slashes. */
function checkSource(rel, source) {
	const rawLines = source.split("\n");
	const allowed = (line) => [line, line - 1].some((l) => (rawLines[l - 1] || "").includes(ALLOW));
	const withStrings = strip(source, true);
	const noStrings = strip(source, false);
	const hits = [];
	if (rel !== HELPER) {
		for (const m of withStrings.matchAll(BARE_GUI)) {
			const line = lineAt(withStrings, m.index);
			if (!allowed(line)) {
				hits.push({ line, why: `bare ${m[2]}: use createKv${m[2]} from client/ui`, text: m[0] });
			}
		}
	}
	if (rel.endsWith(".tsx")) {
		for (const m of noStrings.matchAll(JSX_GUI)) {
			const line = lineAt(noStrings, m.index);
			if (allowed(line)) continue;
			const tag = openingTag(withStrings, m.index);
			if (!AUTOLOCALIZE_OFF.test(tag)) {
				hits.push({ line, why: `<${m[1]}> without AutoLocalize={false}`, text: `<${m[1]}` });
			}
		}
	}
	if (UPPER_SCOPES.some((p) => rel.startsWith(p))) {
		for (const m of noStrings.matchAll(UPPER)) {
			const line = lineAt(noStrings, m.index);
			if (!allowed(line)) {
				hits.push({
					line,
					why: "upper() on text (Luau's upper is ASCII only)",
					text: rawLines[line - 1].trim(),
				});
			}
		}
	}
	return hits.sort((a, b) => a.line - b.line);
}

function walk(dir, out) {
	let entries;
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const e of entries) {
		const full = path.join(dir, e.name);
		if (e.isDirectory()) walk(full, out);
		else if (e.isFile() && SCANNED_EXTENSIONS.has(path.extname(e.name).toLowerCase())) out.push(full);
	}
	return out;
}

function main() {
	const i = process.argv.indexOf("--root");
	const root = i >= 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : path.join(REPO, "src");
	if (!fs.existsSync(root)) {
		console.error(`check-autolocalize: ${root} does not exist`);
		process.exit(2);
	}
	const files = walk(root, [])
		.map((f) => ({ f, rel: path.relative(root, f).split(path.sep).join("/") }))
		.filter(({ rel }) => !EXEMPT.some((p) => rel.startsWith(p)));
	const offenders = [];
	for (const { f, rel } of files) {
		for (const h of checkSource(rel, fs.readFileSync(f, "utf8"))) {
			offenders.push(`  ${path.relative(REPO, f)}:${h.line}  ${h.why}: ${JSON.stringify(h.text)}`);
		}
	}
	if (offenders.length > 0) {
		console.error(`check-autolocalize: ${offenders.length} problem(s):`);
		console.error(offenders.join("\n"));
		console.error(
			"Roblox must never auto-translate our GUIs (docs/LOCALIZATION.md design 5). Justified exceptions: " +
				"`// check-autolocalize: allow (reason)` on the line or the line above.",
		);
		process.exit(1);
	}
	console.log(`check-autolocalize: ${files.length} file(s), every root GUI has AutoLocalize off, no upper()`);
}

module.exports = { checkSource, strip };

if (require.main === module) main();

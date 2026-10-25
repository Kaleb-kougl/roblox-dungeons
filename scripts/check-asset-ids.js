#!/usr/bin/env node
/*
 * Guard: no hard-coded Roblox assets outside the theme layer (PLAN.md "Assets: placeholder now,
 * replaced later"; CLAUDE.md "Every visual and audio asset goes through logical IDs").
 *
 * Scans every source file under src/ EXCEPT src/shared/theme/** (the only place asset IDs may live)
 * and src/shared/fixtures-generated/** (generated data). Fails (exit 1) on:
 *
 *   1. a string or template literal containing an asset URL: rbxassetid://, rbxasset://, rbxthumb://
 *      or roblox.com/asset (the legacy "http://www.roblox.com/asset/?id=" form);
 *   2. a string literal that is only 7+ digits (an asset id written as a string, e.g. "1234567890");
 *   3. a bare 7+ digit integer literal on a line that also names an asset-ish thing (Image, Texture,
 *      SoundId, Mesh, Animation, Decal, Asset, Content, Icon, Thumbnail, Audio, Music, Sfx, Font), e.g.
 *      `sound.SoundId = ...1234567890` or `Content.fromAssetId(1234567890)`.
 *
 * Comments are ignored for .ts/.tsx/.js (prose may mention rbxassetid://). Rule 3 is a heuristic, so a
 * line can opt out with a trailing `// check-asset-ids: allow` comment. Rule 2 can be silenced the same way,
 * because parity tests legitimately hold digit strings (float64 hex bits, number-formatting vectors); say why
 * in the comment. Rule 1 cannot be silenced: put the asset in the theme manifest instead. Large constants that are not asset IDs
 * (4294967295, hash primes) pass because their lines name no asset-ish thing.
 *
 * Usage: node scripts/check-asset-ids.js [--root <dir>]   (default: the repo's src/)
 * Plain Node, no dependencies.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");

function argValue(flag, fallback) {
	const i = process.argv.indexOf(flag);
	return i >= 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : fallback;
}

const ROOT = argValue("--root", path.join(REPO, "src"));
/** Paths (relative to ROOT, forward slashes) that may contain asset IDs or are generated. */
const EXEMPT = ["shared/theme/", "shared/fixtures-generated/"];
const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".lua", ".luau", ".json", ".toml", ".txt"]);
const TOKENIZED_EXTENSIONS = new Set([".ts", ".tsx", ".js"]);

const ASSET_URL = /rbxassetid:\/\/|rbxasset:\/\/|rbxthumb:\/\/|roblox\.com\/asset/i;
const DIGITS_ONLY = /^\s*\d{7,}\s*$/;
const BARE_ID = /(?<![\w.$])\d{7,}(?![\w.])/g;
const ASSETISH = /(image|texture|sound|mesh|animation|decal|asset|content|icon|thumbnail|audio|music|sfx|font)/i;
const ALLOW = "check-asset-ids: allow";

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

/**
 * Split TS/JS source into string literals (with their line) and code with comments and strings
 * blanked out (newlines kept, so line numbers still match). A small tokenizer: regex literals are
 * not recognised, so one containing a quote could confuse it.
 */
function tokenize(source) {
	const strings = [];
	let code = "";
	let i = 0;
	let line = 1;
	const n = source.length;
	const blank = (text) => text.replace(/[^\n]/g, " ");
	while (i < n) {
		const c = source[i];
		const next = source[i + 1];
		if (c === "/" && next === "/") {
			let j = i;
			while (j < n && source[j] !== "\n") j++;
			code += blank(source.slice(i, j));
			i = j;
		} else if (c === "/" && next === "*") {
			let j = source.indexOf("*/", i + 2);
			j = j < 0 ? n : j + 2;
			const text = source.slice(i, j);
			line += (text.match(/\n/g) || []).length;
			code += blank(text);
			i = j;
		} else if (c === '"' || c === "'" || c === "`") {
			const startLine = line;
			let j = i + 1;
			let text = "";
			while (j < n && source[j] !== c) {
				if (source[j] === "\\") {
					text += source[j + 1] ?? "";
					j += 2;
					continue;
				}
				if (source[j] === "\n") {
					if (c !== "`") break; // unterminated quote: stop at the line end
					line++;
				}
				text += source[j];
				j++;
			}
			strings.push({ line: startLine, text });
			// Closed: consume the quote. Unterminated: stop before the newline so it is counted.
			const end = source[j] === c ? j + 1 : j;
			code += blank(source.slice(i, end));
			i = end;
		} else {
			if (c === "\n") line++;
			code += c;
			i++;
		}
	}
	return { strings, code };
}

/** Luau / data files: drop `--` comments (roughly) and treat the rest as both code and text. */
function plainText(source, ext) {
	const lines = source.split("\n");
	const stripped = ext === ".lua" || ext === ".luau" ? lines.map((l) => l.replace(/--.*$/, "")) : lines;
	const strings = stripped.map((text, k) => ({ line: k + 1, text }));
	return { strings, code: stripped.join("\n") };
}

function check(file) {
	const source = fs.readFileSync(file, "utf8");
	const ext = path.extname(file).toLowerCase();
	const { strings, code } = TOKENIZED_EXTENSIONS.has(ext) ? tokenize(source) : plainText(source, ext);
	const rawLines = source.split("\n");
	const hits = [];
	for (const s of strings) {
		if (ASSET_URL.test(s.text)) hits.push({ line: s.line, why: "asset URL in a literal", text: s.text });
		else if (TOKENIZED_EXTENSIONS.has(ext) && DIGITS_ONLY.test(s.text) && !rawLines[s.line - 1].includes(ALLOW)) {
			hits.push({ line: s.line, why: "numeric asset id in a string", text: s.text });
		}
	}
	code.split("\n").forEach((codeLine, k) => {
		if (!ASSETISH.test(codeLine)) return;
		if ((rawLines[k] || "").includes(ALLOW)) return;
		for (const m of codeLine.matchAll(BARE_ID)) {
			hits.push({ line: k + 1, why: "bare numeric asset id", text: m[0] });
		}
	});
	return hits;
}

function main() {
	if (!fs.existsSync(ROOT)) {
		console.error(`check-asset-ids: ${ROOT} does not exist`);
		process.exit(2);
	}
	const files = walk(ROOT, []).filter((f) => {
		const rel = path.relative(ROOT, f).split(path.sep).join("/");
		return !EXEMPT.some((p) => rel.startsWith(p));
	});
	const offenders = [];
	for (const f of files) {
		for (const h of check(f)) {
			offenders.push(`  ${path.relative(REPO, f)}:${h.line}  ${h.why}: ${JSON.stringify(h.text.trim())}`);
		}
	}
	if (offenders.length > 0) {
		console.error(`check-asset-ids: ${offenders.length} hard-coded asset reference(s) outside src/shared/theme:`);
		console.error(offenders.join("\n"));
		console.error(
			"Use a logical ID and put the asset in the theme manifest (src/shared/theme/packs/<pack>/manifest.ts).",
		);
		process.exit(1);
	}
	console.log(`check-asset-ids: ${files.length} file(s) outside src/shared/theme, no hard-coded asset IDs`);
}

main();

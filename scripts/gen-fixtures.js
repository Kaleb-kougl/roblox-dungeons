#!/usr/bin/env node
/*
 * Golden fixtures -> roblox-ts importable modules.
 *
 *   fixtures/<path>.json  ->  src/shared/fixtures-generated/<path>.luau   (the data, as a Luau table)
 *                             src/shared/fixtures-generated/<path>.d.ts   (its inferred type)
 *                             src/shared/fixtures-generated/index.ts      (FIXTURE_NAMES)
 *
 * Specs import a fixture with a default import, the same way in Studio and under Lune:
 *
 *   import rng from "shared/fixtures-generated/rng";
 *
 * Why Luau and not JSON modules: a JSON module is turned into a table by Rojo (and by Lune's
 * serde in the headless runner), both via serde_json, whose default float parsing is only
 * "best effort" and can be one ULP off. Golden fixtures must be bit-exact, so this script writes
 * every number as JavaScript's shortest round-trip decimal (Number -> String), which Luau's
 * correctly rounded parser reads back to the identical double. -0 is preserved.
 *
 * Large values are split into chunk functions (each well under Luau's per-function constant
 * and register limits) and stitched back together at require time, so fixture size is not
 * limited by the compiler.
 *
 * The output folder is generated (gitignored) and rewritten only where content changed, so
 * `rbxtsc -w` does not rebuild for nothing. Missing or empty fixtures/ is fine.
 *
 * Rollback spike captures (docs/ROLLBACK_SPIKE.md R2 / R4): when the gitignored `captures/` folder holds captured runs
 * (`captures/<runId>.json` = { runId, meta, chunks, receivedAt }, written by scripts/rollback/receive-captures.js),
 * each also becomes `src/shared/fixtures-generated/captures/<runId>.luau` / `.d.ts` = { runId, meta, chunks } (the
 * same exact emitter; the chunks are plain base64 strings), which the rollback sweep finds at run time and decodes with
 * shared/spikes decodeCapture. They are not in FIXTURE_NAMES. No captures (the default): nothing changes.
 *
 * Usage: node scripts/gen-fixtures.js [--in fixtures] [--out src/shared/fixtures-generated] [--captures captures]
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function argValue(flag, fallback) {
	const i = process.argv.indexOf(flag);
	return i >= 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : fallback;
}

const IN_DIR = argValue("--in", path.join(ROOT, "fixtures"));
const OUT_DIR = argValue("--out", path.join(ROOT, "src", "shared", "fixtures-generated"));
const CAPTURES_DIR = argValue("--captures", path.join(ROOT, "captures"));
/** Output sub-folder of the capture modules. */
const CAPTURES_OUT = "captures";

/** Max emitted characters inlined into one table literal before it is moved into a chunk function. */
const CHUNK_CHARS = 32 * 1024;
/** Max entries per chunk function, whatever their size. */
const CHUNK_ENTRIES = 1024;
/** Above this many distinct shapes a union type collapses to `unknown`. */
const MAX_UNION = 6;

const LUAU_KEYWORDS = new Set([
	"and", "break", "do", "else", "elseif", "end", "false", "for", "function", "if", "in", "local",
	"nil", "not", "or", "repeat", "return", "then", "true", "until", "while", "continue", "export", "type",
]);
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

// ---------------------------------------------------------------------------------------------
// Luau emitter

function luauNumber(n) {
	if (!Number.isFinite(n)) throw new Error(`non-finite number ${n} cannot appear in JSON`);
	if (Object.is(n, -0)) return "-0";
	return String(n); // shortest round-trip representation
}

function luauString(s) {
	let out = '"';
	for (const ch of s) {
		const code = ch.codePointAt(0);
		if (ch === "\\") out += "\\\\";
		else if (ch === '"') out += '\\"';
		else if (ch === "\n") out += "\\n";
		else if (ch === "\r") out += "\\r";
		else if (ch === "\t") out += "\\t";
		else if (code < 0x20 || code === 0x7f) out += "\\" + String(code).padStart(3, "0");
		else out += ch;
	}
	return out + '"';
}

function luauKey(k) {
	return IDENT.test(k) && !LUAU_KEYWORDS.has(k) ? k : `[${luauString(k)}]`;
}

class Emitter {
	constructor(fileLabel) {
		this.chunks = [];
		this.fileLabel = fileLabel;
		this.warnedNull = false;
	}

	/** A null array element becomes a hole, which breaks `.size()` and iteration in Luau: warn. */
	warnNullInArray(where) {
		if (!this.warnedNull) {
			console.warn(`gen-fixtures: ${this.fileLabel}: null at ${where} becomes a nil hole in a Luau array`);
			this.warnedNull = true;
		}
	}

	chunk(body) {
		this.chunks.push(body);
		return this.chunks.length; // 1-based, matches C[i]
	}

	/** Groups entry strings into chunk functions when they are too large to inline. */
	group(entries, combiner) {
		const total = entries.reduce((sum, e) => sum + e.length + 2, 0);
		if (total <= CHUNK_CHARS && entries.length <= CHUNK_ENTRIES) {
			return `{${entries.join(", ")}}`;
		}
		const ids = [];
		let current = [];
		let size = 0;
		for (const entry of entries) {
			if (current.length > 0 && (size + entry.length > CHUNK_CHARS || current.length >= CHUNK_ENTRIES)) {
				ids.push(this.chunk(`{${current.join(", ")}}`));
				current = [];
				size = 0;
			}
			current.push(entry);
			size += entry.length + 2;
		}
		if (current.length > 0) ids.push(this.chunk(`{${current.join(", ")}}`));
		return `${combiner}({${ids.map((id) => `C[${id}]()`).join(", ")}})`;
	}

	value(v, where) {
		if (v === null) {
			this.warnNullInArray(where);
			return "nil";
		}
		switch (typeof v) {
			case "number":
				return luauNumber(v);
			case "string":
				return luauString(v);
			case "boolean":
				return v ? "true" : "false";
			case "object":
				if (Array.isArray(v)) {
					return this.group(
						v.map((item, i) => this.value(item, `${where}[${i}]`)),
						"concat",
					);
				}
				return this.group(
					// A null field is simply absent in Luau (undefined in roblox-ts; typed optional).
					Object.keys(v)
						.filter((k) => v[k] !== null)
						.map((k) => `${luauKey(k)} = ${this.value(v[k], `${where}.${k}`)}`),
					"merge",
				);
			default:
				throw new Error(`unsupported JSON value at ${where}`);
		}
	}

	module(data, sourceLabel) {
		const root = this.value(data, "$");
		const lines = [
			"--!nolint",
			`-- GENERATED by scripts/gen-fixtures.js from ${sourceLabel}. Do not edit; edit the fixture and re-run.`,
		];
		if (this.chunks.length > 0) {
			lines.push(
				"local C = {}",
				"local function concat(parts)",
				"\tlocal out = {}",
				"\tfor _, part in parts do",
				"\t\ttable.move(part, 1, #part, #out + 1, out)",
				"\tend",
				"\treturn out",
				"end",
				"local function merge(parts)",
				"\tlocal out = {}",
				"\tfor _, part in parts do",
				"\t\tfor k, v in part do",
				"\t\t\tout[k] = v",
				"\t\tend",
				"\tend",
				"\treturn out",
				"end",
			);
			this.chunks.forEach((body, i) => lines.push(`C[${i + 1}] = function()\n\treturn ${body}\nend`));
		}
		lines.push(`return { default = ${root} }`, "");
		return lines.join("\n");
	}
}

// ---------------------------------------------------------------------------------------------
// Type inference for the .d.ts

function infer(v) {
	if (v === null) return { k: "undefined" };
	if (Array.isArray(v)) {
		let el = null;
		for (const item of v) el = el === null ? infer(item) : unify(el, infer(item));
		return { k: "array", el };
	}
	if (typeof v === "object") {
		const fields = new Map();
		for (const key of Object.keys(v)) fields.set(key, { t: infer(v[key]), optional: v[key] === null });
		return { k: "object", fields };
	}
	return { k: typeof v };
}

function members(t) {
	return t.k === "union" ? t.members : [t];
}

function unify(a, b) {
	if (a.k === "unknown" || b.k === "unknown") return { k: "unknown" };
	if (a.k === "array" && b.k === "array") {
		return { k: "array", el: a.el === null ? b.el : b.el === null ? a.el : unify(a.el, b.el) };
	}
	if (a.k === "object" && b.k === "object") {
		const fields = new Map();
		for (const [key, fa] of a.fields) {
			const fb = b.fields.get(key);
			fields.set(key, fb ? { t: unify(fa.t, fb.t), optional: fa.optional || fb.optional } : { t: fa.t, optional: true });
		}
		for (const [key, fb] of b.fields) if (!a.fields.has(key)) fields.set(key, { t: fb.t, optional: true });
		return { k: "object", fields };
	}
	if (a.k === b.k && a.k !== "union") return a;
	// union: merge members of the same kind
	const out = [...members(a)];
	for (const m of members(b)) {
		const i = out.findIndex((o) => o.k === m.k);
		if (i >= 0) out[i] = unify(out[i], m);
		else out.push(m);
	}
	return out.length > MAX_UNION ? { k: "unknown" } : { k: "union", members: out };
}

function render(t, depth) {
	const pad = "\t".repeat(depth);
	switch (t.k) {
		case "array":
			return `ReadonlyArray<${t.el === null ? "unknown" : render(t.el, depth)}>`;
		case "object": {
			if (t.fields.size === 0) return "{}";
			const lines = [...t.fields].map(
				([key, f]) => `${pad}\treadonly ${JSON.stringify(key)}${f.optional ? "?" : ""}: ${render(f.t, depth + 1)};`,
			);
			return `{\n${lines.join("\n")}\n${pad}}`;
		}
		case "union":
			return t.members.map((m) => (m.k === "union" ? `(${render(m, depth)})` : render(m, depth))).join(" | ");
		default:
			return t.k; // number | string | boolean | undefined | unknown
	}
}

// ---------------------------------------------------------------------------------------------
// Files

function listJson(dir, rel = "") {
	if (!fs.existsSync(dir)) return [];
	const out = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
		if (entry.name.startsWith(".")) continue;
		const relPath = rel ? `${rel}/${entry.name}` : entry.name;
		if (entry.isDirectory()) out.push(...listJson(path.join(dir, entry.name), relPath));
		else if (entry.isFile() && entry.name.endsWith(".json")) out.push(relPath);
	}
	return out;
}

/** fixtures/dungeon/seed-1337.v2.json -> dungeon/seed-1337_v2 (Rojo-safe: one extension dot only). */
function moduleName(relPath) {
	return relPath
		.replace(/\.json$/, "")
		.split("/")
		.map((segment, i, all) => {
			const clean = segment.replace(/[^A-Za-z0-9_-]/g, "_");
			return i === all.length - 1 && (clean === "index" || clean === "init") ? `${clean}_` : clean;
		})
		.join("/");
}

const written = new Set();
let changed = 0;

function writeIfChanged(file, content) {
	written.add(path.resolve(file));
	if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === content) return;
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
	changed++;
}

function removeStale(dir) {
	if (!fs.existsSync(dir)) return;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.resolve(dir, entry.name);
		if (entry.isDirectory()) {
			removeStale(full);
			if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
		} else if (!written.has(full)) {
			fs.unlinkSync(full);
			changed++;
		}
	}
}

function writeModule(name, data, label) {
	const emitter = new Emitter(label);
	writeIfChanged(path.join(OUT_DIR, `${name}.luau`), emitter.module(data, label));
	writeIfChanged(
		path.join(OUT_DIR, `${name}.d.ts`),
		[
			`// GENERATED by scripts/gen-fixtures.js from ${label}. Do not edit.`,
			`declare const fixture: ${render(infer(data), 0)};`,
			"export default fixture;",
			"",
		].join("\n"),
	);
}

/** captures/*.json (top level only) -> fixtures-generated/captures/<name> modules; returns how many. */
function writeCaptures(seen) {
	if (!fs.existsSync(CAPTURES_DIR) || !fs.statSync(CAPTURES_DIR).isDirectory()) return 0;
	let n = 0;
	const entries = fs.readdirSync(CAPTURES_DIR, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
	for (const entry of entries) {
		if (!entry.isFile() || entry.name.startsWith(".") || !entry.name.endsWith(".json")) continue;
		const label = `captures/${entry.name}`;
		let raw;
		try {
			raw = JSON.parse(fs.readFileSync(path.join(CAPTURES_DIR, entry.name), "utf8"));
		} catch (err) {
			console.warn(`gen-fixtures: ${label}: not JSON (${err.message}), skipped`);
			continue;
		}
		if (raw === null || typeof raw !== "object" || typeof raw.meta !== "object" || !Array.isArray(raw.chunks)) {
			console.warn(`gen-fixtures: ${label}: no meta / chunks, skipped`);
			continue;
		}
		const name = `${CAPTURES_OUT}/${moduleName(entry.name)}`;
		if (seen.has(name)) throw new Error(`gen-fixtures: ${label} and ${seen.get(name)} map to the same module "${name}"`);
		seen.set(name, label);
		const data = { runId: typeof raw.runId === "string" ? raw.runId : entry.name.replace(/\.json$/, ""), meta: raw.meta, chunks: raw.chunks };
		writeModule(name, data, label);
		n++;
	}
	return n;
}

function main() {
	const files = listJson(IN_DIR);
	const names = [];
	const seen = new Map();

	for (const rel of files) {
		const name = moduleName(rel);
		if (seen.has(name)) throw new Error(`gen-fixtures: ${rel} and ${seen.get(name)} map to the same module "${name}"`);
		seen.set(name, rel);
		names.push(name);

		const label = `fixtures/${rel}`;
		const data = JSON.parse(fs.readFileSync(path.join(IN_DIR, rel), "utf8"));
		writeModule(name, data, label);
	}
	const captures = writeCaptures(seen);

	writeIfChanged(
		path.join(OUT_DIR, "index.ts"),
		[
			"// GENERATED by scripts/gen-fixtures.js. Do not edit.",
			"//",
			"// One module per fixtures/**/*.json. Import a fixture by its module path, e.g.",
			'//   import rng from "shared/fixtures-generated/rng";',
			"// (not through this barrel: each fixture is loaded only by the specs that need it).",
			"",
			`export const FIXTURE_NAMES: ReadonlyArray<string> = [${names.map((n) => JSON.stringify(n)).join(", ")}];`,
			"",
		].join("\n"),
	);

	removeStale(OUT_DIR);
	const where = path.relative(ROOT, IN_DIR) || IN_DIR;
	const capturesNote = captures > 0 ? `, ${captures} rollback capture(s)` : "";
	console.log(
		`gen-fixtures: ${files.length} fixture(s) from ${where}${files.length === 0 ? " (none yet)" : ""}${capturesNote}, ${changed} file(s) updated`,
	);
}

main();

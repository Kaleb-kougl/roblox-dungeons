#!/usr/bin/env node
/*
 * Guard: every `KV_*` name the game uses is in the registry scripts/kv-names.json, and docs/DEBUG_SWITCHES.md is the
 * registry's table (task SE17).
 *
 * `KV_*` is the prefix of everything the game names at runtime: the Workspace / Player attributes a developer sets
 * as debug switches, DataStore names, the folders and ScreenGuis it creates, its render steps and input actions.
 * The names are string literals spread over about a hundred modules; the registry is the one list of them.
 *
 * Scans the string literals (templates and JSX text too; comments and identifiers are not names) of the .ts / .tsx
 * files under src/ (except src/shared/fixtures-generated/**). Fails (exit 1) when:
 *
 *   1. a `KV_*` literal is not in the registry (add its entry: kind, where, a one-line description);
 *   2. a registry name is no longer a literal in non-spec code (delete the entry), or a `spec` entry is used outside
 *      the specs;
 *   3. an entry's `where` (the module that declares the name, relative to src/) no longer holds the literal, or its
 *      `doc` does not exist or does not mention the name;
 *   4. an entry is malformed (see ENTRY below) or the names are not sorted;
 *   5. docs/DEBUG_SWITCHES.md differs from the table rendered from the registry (run with --write).
 *
 * An entry:
 *   kind         switch     an attribute a developer (or the spec runner) sets by hand
 *                attribute  an attribute the game's own code sets
 *                datastore  a DataStore name
 *                instance   the Name of a Folder / ScreenGui / other Instance the game creates
 *                binding    a render step, ContextActionService action or profiler label
 *                spec       a made-up name only spec files use
 *   also         (optional) the other kinds the same string is used as (the description says which)
 *   value        (switch) the attribute's value type
 *   side         (switch) who reads it: client, server, both, specs
 *   gate         (switch) what the reading code requires before it honours the value: see GATES
 *   where        the declaring module, relative to src/
 *   doc          (optional) the plan doc that explains it, relative to the repo
 *   description  one line, ending with a full stop
 *
 * Usage: node scripts/check-kv-names.js [--write]   (--write also rewrites docs/DEBUG_SWITCHES.md)
 * Needs only the `typescript` package (its parser; no type check, no build).
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const REPO = path.resolve(__dirname, "..");
const REGISTRY_PATH = "scripts/kv-names.json";
const DOC_PATH = "docs/DEBUG_SWITCHES.md";
const EXEMPT = ["shared/fixtures-generated/"];
const NAME = /\bKV_[A-Za-z0-9_]+/g;
const SPEC_FILE = /\.spec\.tsx?$/;

/** The kinds, in the order the doc lists them, with each section's title and lead. */
const KINDS = {
	switch: {
		title: "Debug switches",
		lead: 'Attributes a developer sets by hand (Explorer -> Workspace -> Attributes, or the command bar: `workspace:SetAttribute("KV_Debug", true)`). All are off / unset by default.',
	},
	attribute: { title: "Attributes the game sets", lead: "Attributes written by the game's own code." },
	datastore: {
		title: "DataStores",
		lead: "Renaming one orphans every player's saved doc: a new schema takes a new `_v<n>` name.",
	},
	instance: {
		title: "Instance names",
		lead: "Folders, ScreenGuis and other Instances the client creates, by `Name` (what to look for in the Explorer).",
	},
	binding: {
		title: "Render steps and input actions",
		lead: "Names passed to `BindToRenderStep` / `ContextActionService:BindAction` (they show in the MicroProfiler).",
	},
	spec: { title: "Spec-only names", lead: "Made-up names in spec files; nothing at runtime has them." },
};
/** What the reading code requires before it honours a switch (the doc's Honoured column). */
const GATES = {
	studio: "Studio only",
	"studio-or-debug": "Studio, or with `KV_Debug`",
	"needs-debug": "with `KV_Debug`",
	"dev-mode": "developer mode (`KV_DevAllowed`)",
	"studio-or-test-place": "Studio, or a place in `SPIKE_TEST_PLACES`",
	runner: "headless spec runner",
	none: "wherever it is set",
};
const SIDES = ["client", "server", "both", "specs"];

let tsModule;
/** The TypeScript compiler API, loaded on first use (only its parser is used). */
function ts() {
	if (tsModule === undefined) tsModule = require("typescript");
	return tsModule;
}

/** The distinct `KV_*` names inside the string literals, template parts and JSX text of one source file. */
function namesInSource(relPath, source) {
	const found = new Set();
	if (!source.includes("KV_")) return found;
	const t = ts();
	const kind = relPath.endsWith(".tsx") ? t.ScriptKind.TSX : t.ScriptKind.TS;
	const file = t.createSourceFile(relPath, source, t.ScriptTarget.Latest, false, kind);
	const K = t.SyntaxKind;
	const visit = (node) => {
		const literal =
			t.isStringLiteralLike(node) ||
			node.kind === K.TemplateHead ||
			node.kind === K.TemplateMiddle ||
			node.kind === K.TemplateTail ||
			node.kind === K.JsxText;
		if (literal) for (const m of node.text.matchAll(NAME)) found.add(m[0]);
		t.forEachChild(node, visit);
	};
	visit(file);
	return found;
}

/** Every .ts / .tsx file under `root` (absolute), as paths relative to it with forward slashes, sorted. */
function sourceFiles(root) {
	const out = [];
	const walk = (dir) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const abs = path.join(dir, entry.name);
			const rel = path.relative(root, abs).split(path.sep).join("/");
			if (entry.isDirectory()) {
				if (!EXEMPT.some((e) => `${rel}/`.startsWith(e))) walk(abs);
			} else if (/\.tsx?$/.test(entry.name)) out.push(rel);
		}
	};
	walk(root);
	return out.sort();
}

/** name -> { code: [files], spec: [files] } over the tree at `root` (relative paths, sorted). */
function scan(root) {
	const uses = new Map();
	for (const rel of sourceFiles(root)) {
		const names = namesInSource(rel, fs.readFileSync(path.join(root, rel), "utf8"));
		for (const name of names) {
			if (!uses.has(name)) uses.set(name, { code: [], spec: [] });
			uses.get(name)[SPEC_FILE.test(rel) ? "spec" : "code"].push(rel);
		}
	}
	return uses;
}

/** The shape problems of one entry (no file system). */
function entryProblems(name, entry) {
	const problems = [];
	const bad = (text) => problems.push(`${name}: ${text}`);
	if (entry === null || typeof entry !== "object") return [`${name}: not an object`];
	if (!Object.hasOwn(KINDS, entry.kind)) bad(`unknown kind ${JSON.stringify(entry.kind)}`);
	if (entry.also !== undefined) {
		const ok = Array.isArray(entry.also) && entry.also.length > 0;
		if (!ok || entry.also.some((k) => !Object.hasOwn(KINDS, k) || k === entry.kind)) bad("bad `also`");
	}
	if (typeof entry.where !== "string" || entry.where === "") bad("no `where`");
	if (entry.doc !== undefined && !/^docs\/[A-Z0-9_]+\.md$/.test(entry.doc))
		bad(`bad doc ${JSON.stringify(entry.doc)}`);
	const d = entry.description;
	if (typeof d !== "string" || d.length < 12 || !d.endsWith(".") || /[\n|]/.test(d)) {
		bad("description must be one line ending with a full stop (no `|`)");
	}
	const isSwitch = entry.kind === "switch";
	for (const field of ["value", "side", "gate"]) {
		if (isSwitch && typeof entry[field] !== "string") bad(`a switch needs \`${field}\``);
		if (!isSwitch && entry[field] !== undefined) bad(`only a switch has \`${field}\``);
	}
	if (isSwitch && typeof entry.side === "string" && !SIDES.includes(entry.side)) bad(`unknown side ${entry.side}`);
	if (isSwitch && typeof entry.gate === "string" && !Object.hasOwn(GATES, entry.gate))
		bad(`unknown gate ${entry.gate}`);
	return problems;
}

/**
 * Every problem between the registry and the scanned uses. `readDoc(path)` returns a doc's text or undefined when it
 * does not exist.
 */
function check(registry, uses, readDoc) {
	const problems = [];
	const names = Object.keys(registry.names ?? {});
	const sorted = [...names].sort();
	if (names.some((n, i) => n !== sorted[i])) problems.push(`${REGISTRY_PATH}: the names are not sorted`);
	for (const [name, use] of uses) {
		if (!Object.hasOwn(registry.names, name)) {
			const at = use.code[0] ?? use.spec[0];
			problems.push(`${name} (src/${at}) is not in ${REGISTRY_PATH}: add its entry`);
		}
	}
	for (const name of names) {
		const entry = registry.names[name];
		const shape = entryProblems(name, entry);
		problems.push(...shape);
		if (shape.length > 0) continue;
		const use = uses.get(name) ?? { code: [], spec: [] };
		if (entry.kind === "spec") {
			if (use.spec.length === 0) problems.push(`${name}: no spec uses it any more: delete its entry`);
			if (use.code.length > 0) problems.push(`${name}: kind spec, but src/${use.code[0]} uses it`);
			if (!use.spec.includes(entry.where) && use.spec.length > 0)
				problems.push(`${name}: not in src/${entry.where}`);
		} else if (use.code.length === 0) {
			problems.push(`${name}: no code uses it any more: delete its entry`);
		} else if (!use.code.includes(entry.where)) {
			problems.push(`${name}: src/${entry.where} does not hold it (it is in src/${use.code[0]})`);
		}
		if (entry.doc !== undefined) {
			const text = readDoc(entry.doc);
			if (text === undefined) problems.push(`${name}: ${entry.doc} does not exist`);
			else if (!new RegExp(`\\b${name}\\b`).test(text))
				problems.push(`${name}: ${entry.doc} does not mention it`);
		}
	}
	return problems;
}

/** docs/DEBUG_SWITCHES.md's whole text from the registry (pure). */
function render(registry) {
	const entries = Object.keys(registry.names)
		.sort()
		.map((name) => ({ name, ...registry.names[name] }));
	const where = (e) => `\`${e.where}\``;
	const doc = (e) => e.doc ?? "";
	const text = (e) => e.description;
	const lines = [
		"# Debug switches and stored names",
		"",
		`Generated by \`npm run check:kvnames -- --write\` from \`${REGISTRY_PATH}\`. **Never edit by hand**: \`npm run verify\``,
		"fails when this file is stale, when the code holds a `KV_*` string the registry lacks, or when a registry entry is",
		"no longer used (`scripts/check-kv-names.js`). To add a name: use it in the code, add its entry to the registry, run",
		"the command above.",
		"",
		`${entries.length} names: ${Object.keys(KINDS)
			.map((k) => `${KINDS[k].title.toLowerCase()} ${entries.filter((e) => e.kind === k).length}`)
			.join(", ")}.`,
		"",
		"What a switch can reach: a Workspace attribute set on the server (Studio's Explorer or command bar, a server",
		"script) replicates to every client; one set by a client stays on that client. The server reads only its own copy,",
		"so no client can flip a server switch. A client-read switch changes only that client's own view, which run it",
		"starts or its own saved bindings; ranked runs use the server's seed and are replayed by the server",
		"(docs/SERVER.md).",
		"",
	];
	for (const kind of Object.keys(KINDS)) {
		const rows = entries.filter((e) => e.kind === kind);
		if (rows.length === 0) continue;
		lines.push(`## ${KINDS[kind].title}`, "", KINDS[kind].lead, "");
		if (kind === "switch") {
			lines.push(
				"| Name | Value | Read by | Honoured | What it does | Declared in | Doc |",
				"|---|---|---|---|---|---|---|",
			);
			for (const e of rows) {
				lines.push(
					`| \`${e.name}\` | ${e.value} | ${e.side} | ${GATES[e.gate]} | ${text(e)} | ${where(e)} | ${doc(
						e,
					)} |`,
				);
			}
		} else {
			lines.push("| Name | What it is | Declared in | Doc |", "|---|---|---|---|");
			for (const e of rows) lines.push(`| \`${e.name}\` | ${text(e)} | ${where(e)} | ${doc(e)} |`);
		}
		lines.push("");
	}
	return lines.join("\n");
}

function main(argv) {
	const registry = JSON.parse(fs.readFileSync(path.join(REPO, REGISTRY_PATH), "utf8"));
	const readDoc = (rel) => {
		const abs = path.join(REPO, rel);
		return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : undefined;
	};
	const problems = check(registry, scan(path.join(REPO, "src")), readDoc);
	if (problems.length > 0) {
		for (const p of problems) console.error(`check-kv-names: ${p}`);
		console.error(`check-kv-names: ${problems.length} problem(s)`);
		return 1;
	}
	const text = render(registry);
	const docAbs = path.join(REPO, DOC_PATH);
	if (argv.includes("--write")) {
		fs.writeFileSync(docAbs, text);
		console.log(`check-kv-names: wrote ${DOC_PATH}`);
	} else if (readDoc(DOC_PATH) !== text) {
		console.error(`check-kv-names: ${DOC_PATH} is stale. Run \`npm run check:kvnames -- --write\` and commit it.`);
		return 1;
	}
	console.log(`check-kv-names: ${Object.keys(registry.names).length} KV_* names, all registered and in use`);
	return 0;
}

module.exports = { GATES, KINDS, check, entryProblems, namesInSource, render, scan };

if (require.main === module) process.exit(main(process.argv.slice(2)));

// Specs for scripts/check-kv-names.js (npm run test:checks): the literal scan, the registry rules and the rendered
// doc, on synthetic sources. The last case holds the real tree to its registry.
"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { GATES, check, entryProblems, namesInSource, render, scan } = require("./check-kv-names.js");
const path = require("node:path");
const fs = require("node:fs");

const names = (source, file = "client/a.ts") => [...namesInSource(file, source)].sort();
const SWITCH = {
	kind: "switch",
	value: "boolean",
	side: "client",
	gate: "none",
	where: "shared/play/config.ts",
	description: "Turns the thing on.",
};
const FOLDER = { kind: "instance", where: "client/a.ts", description: "Folder of the things." };
const uses = (map) => new Map(Object.entries(map).map(([k, v]) => [k, { code: v.code ?? [], spec: v.spec ?? [] }]));
const noDocs = () => undefined;

describe("namesInSource", () => {
	it("finds names in strings, templates and JSX, whole or inside a sentence", () => {
		assert.deepEqual(names('const a = "KV_One"; const b = `x ${a} (KV_Two) ${a} KV_Three`;'), [
			"KV_One",
			"KV_Three",
			"KV_Two",
		]);
		assert.deepEqual(names('const e = <screengui key="KV_Gui">KV_Text</screengui>;', "client/a.tsx"), [
			"KV_Gui",
			"KV_Text",
		]);
		assert.deepEqual(names("print(`${LOG} KV_Head: tail`)"), ["KV_Head"]);
	});

	it("ignores comments, identifiers and other prefixes", () => {
		const source = [
			"// KV_Comment",
			"/** KV_Doc */",
			"export const KV_EPOCH_UNIX_SECONDS = 1;",
			'const a = "XKV_NotAName"; const b = "kv_lower";',
		].join("\n");
		assert.deepEqual(names(source), []);
	});
});

describe("entryProblems", () => {
	it("accepts a switch and a plain entry", () => {
		assert.deepEqual(entryProblems("KV_A", SWITCH), []);
		assert.deepEqual(entryProblems("KV_B", { ...FOLDER, also: ["binding"], doc: "docs/CLIENT.md" }), []);
	});

	it("rejects unknown kinds, gates and sides, missing or misplaced switch fields, bad text", () => {
		assert.match(entryProblems("KV_A", { ...FOLDER, kind: "folder" })[0], /unknown kind/);
		assert.match(entryProblems("KV_A", { ...SWITCH, gate: "studio only" })[0], /unknown gate/);
		assert.match(entryProblems("KV_A", { ...SWITCH, side: "everyone" })[0], /unknown side/);
		assert.match(entryProblems("KV_A", { ...SWITCH, value: undefined })[0], /needs `value`/);
		assert.match(entryProblems("KV_A", { ...FOLDER, gate: "none" })[0], /only a switch/);
		assert.match(entryProblems("KV_A", { ...FOLDER, description: "No full stop" })[0], /full stop/);
		assert.match(entryProblems("KV_A", { ...FOLDER, description: "A | breaks the table." })[0], /full stop/);
		assert.match(entryProblems("KV_A", { ...FOLDER, also: ["instance"] })[0], /also/);
		assert.match(entryProblems("KV_A", { ...FOLDER, doc: "CLIENT.md" })[0], /bad doc/);
		assert.match(entryProblems("KV_A", { ...FOLDER, where: "" })[0], /where/);
	});
});

describe("check", () => {
	const registry = { names: { KV_A: SWITCH, KV_B: FOLDER } };
	const used = {
		KV_A: { code: ["shared/play/config.ts"] },
		KV_B: { code: ["client/a.ts"], spec: ["shared/a.spec.ts"] },
	};

	it("passes when every literal is registered and every entry is used where it says", () => {
		assert.deepEqual(check(registry, uses(used), noDocs), []);
	});

	it("fails on a literal the registry lacks, in code or in a spec", () => {
		const problems = check(registry, uses({ ...used, KV_New: { spec: ["shared/b.spec.ts"] } }), noDocs);
		assert.equal(problems.length, 1);
		assert.match(problems[0], /KV_New \(src\/shared\/b\.spec\.ts\) is not in/);
	});

	it("fails on an entry nothing uses, or that only a spec still uses", () => {
		assert.match(check(registry, uses({ KV_A: used.KV_A }), noDocs)[0], /KV_B: no code uses it any more/);
		const specOnly = uses({ ...used, KV_B: { spec: ["shared/a.spec.ts"] } });
		assert.match(check(registry, specOnly, noDocs)[0], /KV_B: no code uses it any more/);
	});

	it("fails when `where` no longer holds the name", () => {
		const moved = uses({ ...used, KV_B: { code: ["client/b.ts"] } });
		assert.match(
			check(registry, moved, noDocs)[0],
			/KV_B: src\/client\/a\.ts does not hold it \(it is in src\/client\/b\.ts\)/,
		);
	});

	it("holds a spec entry to the specs", () => {
		const reg = { names: { KV_S: { kind: "spec", where: "shared/a.spec.ts", description: "A made-up name." } } };
		assert.deepEqual(check(reg, uses({ KV_S: { spec: ["shared/a.spec.ts"] } }), noDocs), []);
		assert.match(
			check(reg, uses({ KV_S: { code: ["client/a.ts"], spec: ["shared/a.spec.ts"] } }), noDocs)[0],
			/kind spec, but/,
		);
		assert.match(check(reg, uses({}), noDocs)[0], /no spec uses it/);
	});

	it("checks the doc exists and mentions the name as a whole word", () => {
		const reg = { names: { KV_B: { ...FOLDER, doc: "docs/CLIENT.md" } } };
		const u = uses({ KV_B: used.KV_B });
		assert.match(check(reg, u, noDocs)[0], /docs\/CLIENT\.md does not exist/);
		assert.match(check(reg, u, () => "folder KV_Bullets")[0], /does not mention it/);
		assert.deepEqual(
			check(reg, u, () => "folder `KV_B`."),
			[],
		);
	});

	it("wants the names sorted", () => {
		const reg = { names: { KV_B: FOLDER, KV_A: SWITCH } };
		assert.match(check(reg, uses(used), noDocs)[0], /not sorted/);
	});
});

describe("render", () => {
	const registry = {
		names: {
			KV_Zed: { ...SWITCH, gate: "studio", doc: "docs/SERVER.md" },
			KV_Able: { ...SWITCH, also: ["instance"] },
			KV_Store_v1: { kind: "datastore", where: "shared/x/config.ts", description: "DataStore of things." },
			KV_Folder: FOLDER,
		},
	};

	it("is stable, groups by kind with the switches first, and sorts by name", () => {
		const text = render(registry);
		assert.equal(text, render(registry));
		const order = ["## Debug switches", "| `KV_Able` |", "| `KV_Zed` |", "## DataStores", "## Instance names"];
		const at = order.map((s) => text.indexOf(s));
		assert.ok(
			at.every((p, i) => p >= 0 && (i === 0 || p > at[i - 1])),
			`order ${at}`,
		);
		assert.ok(!text.includes("## Spec-only names"), "an empty kind has no section");
		assert.match(text, /4 names: debug switches 2, /);
	});

	it("shows a switch's value, reader and gate", () => {
		const text = render(registry);
		assert.ok(text.includes(`| \`KV_Zed\` | boolean | client | ${GATES.studio} | Turns the thing on. |`));
		assert.ok(text.includes("| `KV_Store_v1` | DataStore of things. | `shared/x/config.ts` |  |"));
	});
});

describe("the tree", () => {
	it("matches scripts/kv-names.json and docs/DEBUG_SWITCHES.md", () => {
		const repo = path.resolve(__dirname, "..");
		const registry = JSON.parse(fs.readFileSync(path.join(repo, "scripts/kv-names.json"), "utf8"));
		const readDoc = (rel) =>
			fs.existsSync(path.join(repo, rel)) ? fs.readFileSync(path.join(repo, rel), "utf8") : undefined;
		assert.deepEqual(check(registry, scan(path.join(repo, "src")), readDoc), []);
		assert.equal(readDoc("docs/DEBUG_SWITCHES.md"), render(registry));
	});
});

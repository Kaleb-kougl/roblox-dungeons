// node:test spec of scripts/gen-fixtures.js's rollback capture path (docs/ROLLBACK_SPIKE.md R2 / R4): every
// top-level `captures/<runId>.json` with meta and chunks becomes `fixtures-generated/captures/<name>.luau` / `.d.ts`
// (not in FIXTURE_NAMES), malformed files are skipped with a warning, the probe folder is ignored, and a capture
// removed from captures/ loses its module on the next run. No captures folder: nothing about captures is written.
"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { test } = require("node:test");

const SCRIPT = path.resolve(__dirname, "..", "gen-fixtures.js");

function run(args) {
	return execFileSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function tmpTree() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "kv-genfix-"));
	const dirs = { root, in: path.join(root, "fixtures"), out: path.join(root, "out"), captures: path.join(root, "captures") };
	fs.mkdirSync(dirs.in);
	fs.writeFileSync(path.join(dirs.in, "small.json"), JSON.stringify({ a: 1, b: [0.1, -0] }));
	return dirs;
}

const CAPTURE = {
	runId: "{AB-12}",
	meta: { v: 1, ticks: 3, encoding: "base64" },
	chunks: ["AAEC", "AwQF"],
	receivedAt: 1,
};

test("a capture becomes a module under captures/, outside FIXTURE_NAMES; a removed one is cleaned up", () => {
	const d = tmpTree();
	try {
		fs.mkdirSync(d.captures);
		fs.mkdirSync(path.join(d.captures, "probe"));
		fs.writeFileSync(path.join(d.captures, "probe", "live.jsonl"), "{}\n");
		fs.writeFileSync(path.join(d.captures, "{AB-12}.json"), JSON.stringify(CAPTURE));
		fs.writeFileSync(path.join(d.captures, "broken.json"), "{ not json");
		fs.writeFileSync(path.join(d.captures, "nochunks.json"), JSON.stringify({ meta: {} }));
		const args = ["--in", d.in, "--out", d.out, "--captures", d.captures];
		const log = run(args);
		assert.match(log, /1 rollback capture\(s\)/);
		const luau = fs.readFileSync(path.join(d.out, "captures", "_AB-12_.luau"), "utf8");
		assert.match(luau, /return \{ default = /);
		assert.match(luau, /"AAEC"/);
		assert.match(luau, /"\{AB-12\}"/);
		assert.ok(!luau.includes("receivedAt"), "only runId, meta and chunks are kept");
		const dts = fs.readFileSync(path.join(d.out, "captures", "_AB-12_.d.ts"), "utf8");
		assert.match(dts, /"chunks": ReadonlyArray<string>/);
		assert.deepEqual(fs.readdirSync(path.join(d.out, "captures")).sort(), ["_AB-12_.d.ts", "_AB-12_.luau"]);
		const index = fs.readFileSync(path.join(d.out, "index.ts"), "utf8");
		assert.match(index, /FIXTURE_NAMES: ReadonlyArray<string> = \["small"\]/);
		assert.ok(fs.existsSync(path.join(d.out, "small.luau")));

		fs.unlinkSync(path.join(d.captures, "{AB-12}.json"));
		const again = run(args);
		assert.doesNotMatch(again, /rollback capture/);
		assert.ok(!fs.existsSync(path.join(d.out, "captures")), "the empty captures folder is removed");
		assert.ok(fs.existsSync(path.join(d.out, "small.luau")));
	} finally {
		fs.rmSync(d.root, { recursive: true, force: true });
	}
});

test("no captures folder: only the fixtures are written", () => {
	const d = tmpTree();
	try {
		const log = run(["--in", d.in, "--out", d.out, "--captures", d.captures]);
		assert.doesNotMatch(log, /rollback capture/);
		assert.deepEqual(fs.readdirSync(d.out).sort(), ["index.ts", "small.d.ts", "small.luau"]);
	} finally {
		fs.rmSync(d.root, { recursive: true, force: true });
	}
});

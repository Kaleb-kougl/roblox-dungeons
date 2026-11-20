// Specs for scripts/out-digest.js (npm run test:checks; named check-* so that glob finds it): comments never change
// a module's digest, code and strings always do. Synthetic sources only.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it } = require("node:test");
const { digestOf, digestTree, stripComments } = require("./out-digest.js");

describe("stripComments", () => {
	it("drops line comments, doc comments and block comments, and the blank lines they leave", () => {
		const src = [
			"-- Compiled with roblox-ts v3.0.0",
			"--[[",
			"\t*",
			"\t * A header.",
			"\t ",
			"]]",
			"local a = 1 -- trailing",
			"",
			"--* A doc line. ",
			"local function f()",
			"\t-- inside",
			"\treturn a",
			"end",
			"--[==[ a level-2 block ]] still inside ]==]",
			"return f",
		].join("\n");
		assert.equal(stripComments(src), ["local a = 1", "local function f()", "\treturn a", "end", "return f"].join("\n"));
	});

	it("keeps strings byte for byte, whatever they hold", () => {
		const lines = [
			'local a = "not -- a comment"',
			"local b = 'nor --[[ this ]]'",
			'local c = "an escaped \\" quote -- still a string"',
			"local d = `interpolated -- {a}`",
			"local e = [[long -- string]]",
			"local f = [==[long ]] -- string]==]",
			"local g = t[t2[1]]",
		];
		assert.equal(stripComments(lines.join("\n")), lines.join("\n"));
	});

	it("keeps code after a block comment on the same line, and indentation", () => {
		assert.equal(stripComments("local a = --[[ why ]] 1"), "local a =  1");
		assert.equal(stripComments("do\n\tlocal a = 1\nend"), "do\n\tlocal a = 1\nend");
	});

	it("survives an unterminated comment or string", () => {
		assert.equal(stripComments("local a = 1\n--[[ never closed"), "local a = 1");
		assert.equal(stripComments('local a = "open\nlocal b = 2'), 'local a = "open\nlocal b = 2');
	});
});

describe("digestOf", () => {
	const base = "local a = 1\nreturn a\n";

	it("is the same for any change of comments or blank lines", () => {
		assert.equal(digestOf("--[[\n\t * New header.\n]]\n\nlocal a = 1 -- note\n\nreturn a\n"), digestOf(base));
	});

	it("changes with a literal, a name, a string or the indentation", () => {
		assert.notEqual(digestOf("local a = 2\nreturn a\n"), digestOf(base));
		assert.notEqual(digestOf("local b = 1\nreturn b\n"), digestOf(base));
		assert.notEqual(digestOf('local a = "--"\nreturn a\n'), digestOf('local a = "-"\nreturn a\n'));
		assert.notEqual(digestOf("\tlocal a = 1\nreturn a\n"), digestOf(base));
	});
});

describe("digestTree", () => {
	it("lists every .luau file, sorted, one line each; only the edited module's line moves", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "kv-out-digest-"));
		fs.mkdirSync(path.join(root, "shared", "sim"), { recursive: true });
		fs.writeFileSync(path.join(root, "shared", "sim", "rng.luau"), "local a = 1\nreturn a\n");
		fs.writeFileSync(path.join(root, "shared", "sim", "rng.spec.luau"), "return 1\n");
		fs.writeFileSync(path.join(root, "runtime.luau"), "return 2\n");
		fs.writeFileSync(path.join(root, "notes.txt"), "not code\n");
		const before = digestTree(root).split("\n");
		assert.deepEqual(
			before.map((line) => line.slice(66)),
			["runtime.luau", "shared/sim/rng.luau", "shared/sim/rng.spec.luau", ""],
		);
		fs.writeFileSync(path.join(root, "shared", "sim", "rng.luau"), "-- a comment\nlocal a = 1\nreturn a\n");
		assert.deepEqual(digestTree(root).split("\n"), before);
		fs.writeFileSync(path.join(root, "shared", "sim", "rng.luau"), "local a = 3\nreturn a\n");
		const after = digestTree(root).split("\n");
		assert.deepEqual(
			after.map((line, i) => line === before[i]),
			[true, false, true, true],
		);
	});
});

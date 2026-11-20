// Specs for scripts/check-luau-locals.js (npm run test:checks): what counts as a top-level local, which files are
// measured, and the verdict at the limit. Synthetic sources only.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it } = require("node:test");
const { LIMIT, WARN, countTopLevelLocals, judge, measure } = require("./check-luau-locals.js");

describe("countTopLevelLocals", () => {
	it("counts names, not lines: functions are one, a multiple declaration one per name", () => {
		const src = [
			"-- Compiled with roblox-ts",
			"local TS = _G[script]",
			"local a, b = f()",
			"local validateAsset, validateBiomeMaterials",
			"local function helper(x, y)",
			"\tlocal inner = 1",
			"\treturn inner",
			"end",
			"local t = { 1, 2, 3 }",
			"return { a = a }",
		].join("\n");
		// TS, a, b, validateAsset, validateBiomeMaterials, helper, t
		assert.equal(countTopLevelLocals(src), 7);
	});

	it("ignores indented locals, comments, strings on other lines and block comments", () => {
		const src = [
			"--[[",
			"local notReal = 1",
			"]]",
			"-- local alsoNot = 2",
			"do",
			"\tlocal scoped = 3",
			"end",
			'local s = "local x, y = 1"',
			"localized = 4",
		].join("\n");
		assert.equal(countTopLevelLocals(src), 1);
	});

	it("does not split names on commas inside a type annotation or after the =", () => {
		assert.equal(countTopLevelLocals("local m: Map<string, number> = {}"), 1);
		assert.equal(countTopLevelLocals("local f: (a: number, b: number) -> number, g = nil, nil"), 2);
		assert.equal(countTopLevelLocals("local x = f(1, 2, 3)"), 1);
	});
});

describe("measure and judge", () => {
	const locals = (n) => Array.from({ length: n }, (_, i) => `local v${i} = ${i}`).join("\n");

	it("measures every non-spec module under the folder, most locals first", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kv-locals-"));
		fs.mkdirSync(path.join(dir, "shared", "theme"), { recursive: true });
		fs.writeFileSync(path.join(dir, "shared", "theme", "small.luau"), locals(3));
		fs.writeFileSync(path.join(dir, "shared", "theme", "big.luau"), locals(LIMIT + 1));
		fs.writeFileSync(path.join(dir, "shared", "theme", "big.spec.luau"), locals(LIMIT + 50));
		fs.writeFileSync(path.join(dir, "shared", "notes.txt"), locals(LIMIT + 50));
		const modules = measure(dir);
		assert.deepEqual(modules, [
			{ file: "shared/theme/big.luau", locals: LIMIT + 1 },
			{ file: "shared/theme/small.luau", locals: 3 },
		]);
		const verdict = judge(modules);
		assert.deepEqual(verdict.over.map((m) => m.file), ["shared/theme/big.luau"]);
		assert.deepEqual(verdict.near, []);
	});

	it("passes a module exactly at the limit and lists it as near; warns from WARN up", () => {
		const verdict = judge([
			{ file: "a.luau", locals: LIMIT },
			{ file: "b.luau", locals: WARN },
			{ file: "c.luau", locals: WARN - 1 },
		]);
		assert.deepEqual(verdict.over, []);
		assert.deepEqual(verdict.near.map((m) => m.file), ["a.luau", "b.luau"]);
	});
});

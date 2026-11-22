// gen-all.js: the generator list matches the gen-*.js files on disk, the order is the one art:build always ran, and
// --lock reaches the atlas step only. The real pipeline is never run here (the art packs are not in the repo).
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { GENERATORS, ATLAS_STEP, plan, runAll } = require("./gen-all");

/** The order of the `&&` chain art:build / art:lock spelled out before gen-all.js. */
const RECORDED_ORDER = [
	"gen-loot-glint.js",
	"gen-pellet.js",
	"gen-treasure-art.js",
	"gen-boost-auras.js",
	"gen-hazard-art.js",
	"gen-fortune-art.js",
	"gen-boon-icons.js",
	"gen-item-icons.js",
	"gen-boost-icons.js",
	"gen-pip-icons.js",
	"gen-heart-halfmax.js",
	"gen-duo-icons.js",
	"gen-grave-art.js",
	"gen-secret-art.js",
	"gen-silver-art.js",
];

test("the generators are the recorded fifteen, in the recorded order", () => {
	assert.deepEqual(GENERATORS, RECORDED_ORDER);
});

test("every gen-*.js on disk is in the list, and every listed script exists", () => {
	const onDisk = fs
		.readdirSync(__dirname)
		.filter((name) => /^gen-.*\.js$/.test(name) && !name.endsWith(".test.js") && name !== "gen-all.js")
		.sort();
	assert.deepEqual([...GENERATORS].sort(), onDisk);
	assert.ok(fs.existsSync(path.join(__dirname, ATLAS_STEP)));
});

test("the atlas step runs last and is the only one given --lock", () => {
	const steps = plan(["--lock"]);
	assert.equal(steps.length, GENERATORS.length + 1);
	assert.deepEqual(steps[steps.length - 1], [ATLAS_STEP, ["--lock"]]);
	for (const [script, args] of steps.slice(0, -1)) assert.deepEqual(args, [], script);
	assert.deepEqual(plan([])[GENERATORS.length], [ATLAS_STEP, []]);
});

test("runAll runs each step once in order with inherited stdio, and stops at the first failure", () => {
	const calls = [];
	const ok = (exe, argv, options) => {
		calls.push([exe, path.basename(argv[0]), argv.slice(1), options.stdio]);
		return { status: 0 };
	};
	assert.equal(runAll(["--lock"], ok), 0);
	assert.deepEqual(
		calls.map((c) => c[1]),
		[...GENERATORS, ATLAS_STEP],
	);
	assert.ok(calls.every((c) => c[0] === process.execPath && c[3] === "inherit"));
	assert.deepEqual(calls[calls.length - 1][2], ["--lock"]);

	const ran = [];
	const failThird = (exe, argv) => {
		ran.push(path.basename(argv[0]));
		return { status: ran.length === 3 ? 7 : 0 };
	};
	assert.equal(runAll([], failThird), 7);
	assert.deepEqual(ran, GENERATORS.slice(0, 3));
	assert.equal(runAll([], () => ({ status: null })), 1);
});

test("package.json's art:build and art:lock call gen-all.js", () => {
	const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8"));
	assert.equal(pkg.scripts["art:build"], "node scripts/art/gen-all.js");
	assert.equal(pkg.scripts["art:lock"], "node scripts/art/gen-all.js --lock");
});

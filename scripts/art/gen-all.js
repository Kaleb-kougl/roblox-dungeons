#!/usr/bin/env node
/**
 * The whole art pipeline in one command: every `gen-*.js` generator (the original art drawn by code), in the order
 * the atlas build expects, then `build-atlases.js`.
 *
 *   node scripts/art/gen-all.js           (npm run art:build)
 *   node scripts/art/gen-all.js --lock    (npm run art:lock: also rewrites art/vendor.lock.json)
 *
 * Each step is its own node process with this one's stdio, and the first step that fails stops the run with its exit
 * code: the same as the `a && b && ...` chain these two npm scripts used to spell out. Arguments go to the atlas step
 * only; the generators take none (each writes to its default folder).
 */
"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

/** The generators, in run order. A new generator is appended here (gen-all.test.js fails until it is). */
const GENERATORS = [
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

/** The last step: packs art/vendor into art/build and the generated layouts. */
const ATLAS_STEP = "build-atlases.js";

/** The steps of one run: `[script, args]` pairs, the generators without arguments, then the atlas step with `args`. */
function plan(args) {
	const steps = GENERATORS.map((script) => [script, []]);
	steps.push([ATLAS_STEP, [...args]]);
	return steps;
}

/**
 * Runs the steps in order and returns the exit code: 0 when all passed, otherwise the first failing step's code
 * (1 when it was killed by a signal or could not start). `run` is spawnSync by default (the test passes a fake).
 */
function runAll(args, run = spawnSync) {
	for (const [script, stepArgs] of plan(args)) {
		const result = run(process.execPath, [path.join(__dirname, script), ...stepArgs], { stdio: "inherit" });
		if (result.error) {
			console.error(`gen-all: ${script}: ${result.error.message}`);
			return 1;
		}
		if (result.status !== 0) return result.status === null ? 1 : result.status;
	}
	return 0;
}

module.exports = { GENERATORS, ATLAS_STEP, plan, runAll };

if (require.main === module) process.exit(runAll(process.argv.slice(2)));

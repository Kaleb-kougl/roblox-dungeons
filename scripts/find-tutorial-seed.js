#!/usr/bin/env node
/**
 * Tutorial seed search (docs/TUTORIAL.md T2): builds (rbxtsc, unless --no-build) and runs
 * scripts/lune/find-tutorial-seed.luau over the compiled shared/run: floor 1 lists the seeds (theme and decoration)
 * the lesson chain works with (checkTutorialChain, lesson E's cover), floor 2 scores small boss floors by the walk.
 * Every other argument is passed through, e.g.
 *
 *   node scripts/find-tutorial-seed.js --floor 1 --from 7500 --to 7700 --top 10
 *   node scripts/find-tutorial-seed.js --no-build --floor 2 --rooms 2,3,4 --to 3000
 *
 * A one-off: the chosen seeds are recorded in src/shared/config/tutorial.ts with the reason, and
 * src/shared/run/tutorial.spec.ts locks the layout.
 */
const { spawnSync } = require("child_process");
const path = require("path");

const root = path.join(__dirname, "..");
const args = process.argv.slice(2);
const noBuild = args.includes("--no-build");
const pass = args.filter((a) => a !== "--no-build");

function run(cmd, cmdArgs) {
	const r = spawnSync(cmd, cmdArgs, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
	if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!noBuild) run("npm", ["run", "build"]);
run("lune", ["run", "scripts/lune/find-tutorial-seed.luau", ...pass]);

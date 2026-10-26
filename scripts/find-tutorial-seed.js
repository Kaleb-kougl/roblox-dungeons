#!/usr/bin/env node
/**
 * Tutorial seed search (docs/TUTORIAL.md T2): builds (rbxtsc, unless --no-build) and runs
 * scripts/lune/find-tutorial-seed.luau, which scores Dungeon Forge layouts with the compiled
 * shared/run analyzeTutorialLayout. Every other argument is passed through, e.g.
 *
 *   node scripts/find-tutorial-seed.js --floor 1 --from 0 --to 3000 --rooms 10,11 --top 10
 *   node scripts/find-tutorial-seed.js --no-build --floor 2 --rooms 3,4 --to 500
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

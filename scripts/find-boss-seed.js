#!/usr/bin/env node
/**
 * Endless boss seed finder (docs/BOSS_DEMONLORD.md D5): builds (rbxtsc, unless --no-build) and runs
 * scripts/lune/find-boss-seed.luau over the compiled shared/dungeon: per endless boss, the run seeds whose boss floor
 * holds it (bossKindFor, the game's own seeded pick). Every other argument is passed through, e.g.
 *
 *   node scripts/find-boss-seed.js                         # floor 5, run seeds 1..1000, first 10 of each boss
 *   node scripts/find-boss-seed.js --no-build --floor 10 --from 1000 --to 2000 --top 5
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
run("lune", ["run", "scripts/lune/find-boss-seed.luau", ...pass]);

// Guard (docs/SILVER_SHOP.md SHD5, owner OC3; npm run test:checks): the Get Silver panel opens from exactly two places,
// the `+` beside the Silver balance in the Armory's header and on the main menu. Nothing else may open it: no prompt
// in a run, at run over, in the draft, on a lock card, on the character screen, in a lobby or the tutorial. Scans the
// real src/ tree (comments stripped): who calls the menu action `openSilverShop(...)` and SilverShopController's
// `open(...)`, and which screens draw a SilverBalance (the `+`).
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");

const SRC = path.resolve(__dirname, "..", "src");

function walk(dir, out) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) {
			if (e.name !== "fixtures-generated") walk(p, out);
		} else if (/\.(ts|tsx)$/.test(e.name) && !/\.spec\.tsx?$/.test(e.name)) out.push(p);
	}
	return out;
}

/** Source without comments (line and block), so prose may name the action. */
function code(src) {
	return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const FILES = walk(SRC, []).map((p) => ({ rel: path.relative(SRC, p).split(path.sep).join("/"), src: code(fs.readFileSync(p, "utf8")) }));

function filesMatching(re) {
	return FILES.filter((f) => re.test(f.src))
		.map((f) => f.rel)
		.sort();
}

describe("the Silver shop's entry points", () => {
	it("only SilverBalance calls the menu action openSilverShop(...)", () => {
		assert.deepEqual(filesMatching(/\.openSilverShop\s*\(/), ["client/ui/menu/SilverBalance.tsx"]);
	});

	it("only HudController's menu action calls SilverShopController.open(...)", () => {
		assert.deepEqual(filesMatching(/silverShop\.open\s*\(/), ["client/controllers/ui/HudController.tsx"]);
	});

	it("only the main menu and the Armory draw a SilverBalance (the `+`)", () => {
		assert.deepEqual(filesMatching(/<SilverBalance\b/), ["client/ui/menu/ArmoryScreen.tsx", "client/ui/menu/MainMenu.tsx"]);
	});

	it("only the menu shell mounts the Get Silver panel", () => {
		assert.deepEqual(filesMatching(/<GetSilverPanel\b/), ["client/ui/menu/MenuLayer.tsx"]);
	});
});

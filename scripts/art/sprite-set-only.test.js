// Specs for one sprite set built on its own (docs/ARCHER.md AR12, `--only <set id>`): argv, the scoped lock, the
// pixelsPerTileFrom chain, the layout.ts merge (byte for byte a full layoutModule) and the SmallScaleInt per-frame
// naming of a `frames` source. Synthetic rasters only, no art/vendor files.
"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const A = require("./build-atlases.js");

/** A 16 x 16 frame: a lit 6 x 8 body standing on row 13 (shifted by `dx`), a shadow under it. */
function frame(dx) {
	const img = A.raster(16, 16);
	for (let y = 6; y <= 13; y++) for (let x = 5 + dx; x <= 10 + dx; x++) img.data.set([200, 180, 160, 255], (y * 16 + x) * 4);
	for (let x = 4 + dx; x <= 11 + dx; x++) img.data.set([0, 0, 0, 120], (14 * 16 + x) * 4);
	return img;
}

/** A one-facing grid set over a synthetic 32 x 16 sheet (two frames). */
function gridSet(name, extra) {
	const sheet = A.raster(32, 16);
	for (let f = 0; f < 2; f++) A.blit(frame(f), 0, 0, 16, 16, sheet, f * 16, 0, 0);
	A.sourceCache.set(`only/${name}.png`, sheet);
	return {
		source: { type: "grid", dir: "only", frameW: 16, frameH: 16 },
		facingCount: 1,
		rowForFacing: [0],
		noiseAlpha: 2,
		pad: 1,
		pivot: { measure: { animation: "idle", facing: 0, frame: 0 }, bodyAlpha: 64, bodyMinRgb: 8, footBand: 2 },
		bodyTiles: 1,
		resample: "Default",
		animations: { idle: { file: `${name}.png`, frames: [0, 1], fps: 8, loop: true } },
		sheets: [{ name: `${name}-idle`, animations: ["idle"] }],
		...extra,
	};
}

/** A 4-facing per-frame set with SmallScaleInt naming: <dir>/<Anim>/<facing>/<Anim>_<angle>_<2 f + 1, 3 digits>.png. */
function smallscaleSet(dir, extra) {
	const dirs = ["E", "N", "W", "S"];
	for (let d = 0; d < 4; d++) {
		for (const f of [0, 1, 2]) A.sourceCache.set(`${dir}/Idle/${dirs[d]}/Idle_${d * 90}_${String(2 * f + 1).padStart(3, "0")}.png`, frame(f === 2 ? 1 : 0));
	}
	return {
		source: { type: "frames", dir, naming: "smallscale", frameW: 16, frameH: 16 },
		facingCount: 4,
		facingDirs: dirs,
		noiseAlpha: 2,
		pad: 0,
		pivot: { measure: { animation: "idle", facing: 3, frame: 0 }, bodyAlpha: 64, bodyMinRgb: 8, footBand: 2 },
		outline: { widthPx: 1, clipAtCellEdge: true },
		resample: "Default",
		animations: { idle: { folder: "Idle", frames: [0, 2], fps: 7, loop: true } },
		sheets: [{ name: `${dir}-idle`, animations: ["idle"] }],
		...extra,
	};
}

describe("source.naming (per-frame sources)", () => {
	it("smallscale: <Anim>_<integer angle>_<2 f + 1 in 3 digits>; the Lords of Pain default is unchanged", () => {
		const files = A.sourceFiles({ spriteSets: { "class.s": smallscaleSet("ss/a", {}) }, images: {} });
		assert.deepEqual(files, [
			"ss/a/Idle/E/Idle_0_001.png",
			"ss/a/Idle/E/Idle_0_005.png",
			"ss/a/Idle/N/Idle_90_001.png",
			"ss/a/Idle/N/Idle_90_005.png",
			"ss/a/Idle/S/Idle_270_001.png",
			"ss/a/Idle/S/Idle_270_005.png",
			"ss/a/Idle/W/Idle_180_001.png",
			"ss/a/Idle/W/Idle_180_005.png",
		]);
		const lop = { source: { type: "frames", dir: "p" }, facingCount: 4, facingDirs: ["E", "N", "W", "S"], animations: { m: { folder: "m", frames: [3] } } };
		assert.deepEqual(A.spriteSetSourceFiles({ x: lop }, "x"), ["p/m/E/m_E_0.0_3.png", "p/m/N/m_N_90.0_3.png", "p/m/S/m_S_270.0_3.png", "p/m/W/m_W_180.0_3.png"]);
		assert.equal(A.frameNaming({ dir: "p" }), "lordsOfPain");
	});

	it("refuses an unknown naming and a fractional angle", () => {
		assert.throws(() => A.frameNaming({ dir: "p", naming: "knight" }), /source\.naming must be one of lordsOfPain, smallscale/);
		const sixteen = { source: { type: "frames", dir: "p", naming: "smallscale" }, facingCount: 16, facingDirs: new Array(16).fill("E"), animations: { m: { folder: "m", frames: [0] } } };
		assert.throws(() => A.spriteSetSourceFiles({ x: sixteen }, "x"), /needs whole-degree facings, facing 1 of 16 is 22\.5/);
	});

	it("builds a set from the cached frames (the cell, pivot and outline as for a grid source)", () => {
		const s = A.buildSpriteSet("class.s", smallscaleSet("ss/b", { bodyTiles: 1 }));
		assert.equal(s.layout.sheets.length, 1);
		assert.equal(s.sheets[0].cells, 8);
		assert.equal(s.sheets[0].outlineFile, "ss/b-idle-outline.png");
		assert.deepEqual(s.layout.facings, { count: 4, zeroDeg: 0, ccw: true });
		assert.equal(s.layout.pixelsPerTile, 8); // body rows 6..13
	});
});

describe("--only <sprite set id>", () => {
	const sets = { "class.a": gridSet("a", {}), "class.b": gridSet("b", { pixelsPerTileFrom: "class.a", bodyTiles: undefined }), "enemy.c": gridSet("c", { bodyTiles: 2 }) };

	it("onlyGroup takes a sprite set id of the config (and still every group)", () => {
		assert.equal(A.onlyGroup(["node", "x", "--only", "class.b"], sets), "class.b");
		assert.equal(A.onlyGroup(["node", "x", "--lock", "--only", "class.b"], sets), "class.b");
		assert.equal(A.onlyGroup(["node", "x", "--only", "bullets"], sets), "bullets");
		assert.equal(A.onlyGroup(["node", "x"], sets), undefined);
		assert.equal(A.isOnlySpriteSet("class.b"), true);
		assert.equal(A.isOnlySpriteSet("kenney"), false);
		assert.equal(A.isOnlySpriteSet(undefined), false);
	});

	it("the scoped lock re-hashes only the set's own files, not its pixelsPerTileFrom set's", () => {
		const config = { spriteSets: sets };
		assert.deepEqual(A.onlyGroupSourceFiles(config, "class.b"), ["only/b.png"]);
		assert.deepEqual(A.spriteSetSourceFiles(sets, "class.a"), ["only/a.png"]);
		assert.throws(() => A.spriteSetSourceFiles(sets, "class.z"), /no sprite set class\.z/);
	});

	it("builds the set after its pixelsPerTileFrom chain and nothing else", () => {
		assert.deepEqual(A.spriteSetChain(sets, "class.b"), ["class.a", "class.b"]);
		assert.deepEqual(A.spriteSetChain(sets, "enemy.c"), ["enemy.c"]);
		const { set, chain } = A.buildOneSpriteSet(sets, "class.b");
		assert.deepEqual(chain, ["class.a", "class.b"]);
		const full = A.buildSpriteSets(sets).find((s) => s.id === "class.b");
		assert.deepEqual(set.layout, full.layout);
		assert.equal(set.layout.pixelsPerTile, A.buildSpriteSets(sets)[0].layout.pixelsPerTile);
		const outs = A.spriteSetOutputs(set);
		assert.deepEqual(outs.map((o) => `${o.dir}/${o.name}`), ["build/b-idle.png", "contact/class.b.png"]);
		const fullOuts = A.buildOutputs(A.buildSpriteSets(sets), []).filter((o) => o.name.startsWith("b-") || o.name === "class.b.png");
		for (let i = 0; i < outs.length; i++) assert.equal(Buffer.compare(A.encodePng(outs[i].img), A.encodePng(fullOuts[i].img)), 0, outs[i].name);
	});

	it("mergeSpriteLayout writes exactly the full build's layout.ts: inserted, replaced, first, last, alone", () => {
		const built = A.buildSpriteSets(sets);
		const [a, b, c] = built;
		const full = A.layoutModule(built, [], "#123456");
		assert.equal(A.mergeSpriteLayout(A.layoutModule([a, c], [], "#123456"), "class.b", b.layout), full); // inserted in the middle
		assert.equal(A.mergeSpriteLayout(A.layoutModule([b, c], [], "#123456"), "class.a", a.layout), full); // first
		assert.equal(A.mergeSpriteLayout(A.layoutModule([a, b], [], "#123456"), "enemy.c", c.layout), full); // last
		assert.equal(A.mergeSpriteLayout(A.layoutModule([], [], "#123456"), "class.a", a.layout), A.layoutModule([a], [], "#123456"));
		// replaced: an older entry for the same id is swapped, every other byte kept
		const stale = { ...b, layout: { ...b.layout, pixelsPerTile: 99 } };
		const old = A.layoutModule([a, stale, c], [], "#123456");
		assert.notEqual(old, full);
		assert.equal(A.mergeSpriteLayout(old, "class.b", b.layout), full);
		assert.equal(A.mergeSpriteLayout(full, "class.b", b.layout), full);
	});

	it("mergeSpriteLayout keeps world art and images, and refuses text it did not write", () => {
		const built = A.buildSpriteSets(sets);
		const withImage = (s) => A.layoutModule(s, [{ id: "tile.x", layout: { file: "x.png", w: 4, h: 4 }, meanHex: "#010203" }], "#010203");
		assert.equal(A.mergeSpriteLayout(withImage([built[0], built[2]]), "class.b", built[1].layout), withImage(built));
		assert.throws(() => A.mergeSpriteLayout("export const X = 1;\n", "class.b", built[1].layout), /no VALE_SPRITE_LAYOUTS/);
		const unsorted = A.layoutModule([built[0], built[1]], [], "#000000").replace('"class.a"', '"class.z"');
		assert.throws(() => A.mergeSpriteLayout(unsorted, "enemy.c", built[2].layout), /not sorted by id/);
		const per = { ...built[1].layout, sheets: built[1].layout.sheets.map((s) => ({ ...s, frameW: 3, frameH: 3, pivot: { x: 1, y: 1 } })) };
		assert.throws(() => A.mergeSpriteLayout(A.layoutModule([built[0]], [], "#000000"), "class.b", per), /per-sheet cells need/);
	});
});

describe("class.ranger with the real packs on disk (docs/ARCHER.md AR12)", () => {
	const fs = require("fs");
	const path = require("path");
	const root = path.resolve(__dirname, "..", "..");
	const here = fs.existsSync(path.join(root, "art/vendor/smallscale-archer/Idle")) && fs.existsSync(path.join(root, "art/vendor/smallscale-knight"));
	it("the committed layout.ts entry is what `--only class.ranger` builds", { skip: here ? false : "art/vendor has no SmallScaleInt Archer / Knight" }, () => {
		const config = JSON.parse(fs.readFileSync(path.join(root, "art/atlases.json"), "utf8"));
		const { set, chain } = A.buildOneSpriteSet(config.spriteSets, "class.ranger");
		assert.deepEqual(chain, ["class.vanguard", "class.ranger"]);
		const text = fs.readFileSync(path.join(root, "src/shared/theme/packs/vale/layout.ts"), "utf8");
		assert.equal(A.mergeSpriteLayout(text, "class.ranger", set.layout), text);
		const knight = A.buildOneSpriteSet(config.spriteSets, "class.vanguard").set;
		assert.equal(A.mergeSpriteLayout(text, "class.vanguard", knight.layout), text);
		assert.equal(set.layout.pixelsPerTile, knight.layout.pixelsPerTile);
	});
});

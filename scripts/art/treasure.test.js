// Specs for the atlas pipeline's treasure group (docs/TREASURE.md TR9; npm run test:art): the cage as a world sprite set
// alone in its sheet (one row of facings, the given pivot, its resample), the column as an effect strip alone in its
// sheet, the source files the lock hashes, the generated treasureLayout.ts, and (when art/vendor holds the generated
// frames) that the committed treasureLayout.ts is what the build writes. Synthetic PNGs through the pipeline's cache.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");
const { PNG } = require("pngjs");
const A = require("./build-atlases.js");

const ROOT = path.join(__dirname, "..", "..");
const LAYOUT_FILE = path.join(ROOT, "src", "shared", "theme", "packs", "vale", "treasureLayout.ts");
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "art", "atlases.json"), "utf8"));

function syntheticPng(rel, w, h, paint) {
	const png = new PNG({ width: w, height: h });
	for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) png.data.set(paint(x, y) || [0, 0, 0, 0], (y * w + x) * 4);
	const back = PNG.sync.read(PNG.sync.write(png));
	A.sourceCache.set(rel, { w: back.width, h: back.height, data: new Uint8Array(back.data) });
}

const IRON = [168, 173, 181, 255];
const WORLD = { noiseAlpha: 2, shadowRgb: 4, pad: 2, footBand: 3, atlas: { name: "decor-atlas", maxSize: 1024 }, pieces: {} };
const DIRS = [
	["NE", "45.0"],
	["NW", "135.0"],
	["SW", "225.0"],
	["SE", "315.0"],
];

/** A group over synthetic frames: facing d a 3 x 4 block at x 4 + d, y 2 (pivot 6, 8), a 3-frame 5 x 12 strip. */
function group() {
	DIRS.forEach(([dir, angle], d) =>
		syntheticPng(`t/cage/${dir}/cage_${dir}_${angle}_0.png`, 12, 10, (x, y) => (x >= 4 + d && x < 7 + d && y >= 2 && y < 6 ? IRON : null)),
	);
	syntheticPng("t/column.png", 15, 12, (x, y) => (x % 5 >= 1 && x % 5 <= 3 && y >= 1 ? [255, 255, 255, 40 + 60 * Math.floor(x / 5)] : null));
	return {
		pixelsPerTile: 29.6,
		cage: {
			facings: { count: 4, zeroDeg: 45 },
			animations: { idle: { file: "t/cage/{dir}/cage_{dir}_{angle}_{f}.png", frames: [0], fps: 1, loop: true } },
			pivot: DIRS.map((_, d) => [6 + d, 8]),
			own: "t-cage",
			resample: "Pixelated",
		},
		column: { atlas: "t-column", pad: 1, file: "t/column.png", frameW: 5, frames: 3, fps: 12, loop: true, grey: true },
	};
}

describe("treasure group", () => {
	it("cuts the cage's facings on their pivots into one row of its own sheet", () => {
		const t = A.buildTreasure(group(), WORLD, undefined);
		const l = t.cage.layout;
		assert.equal(t.cage.file, "t-cage.png");
		assert.deepEqual(l.sheets, [{ file: "t-cage.png", w: 4 * l.frameW, h: l.frameH }]);
		assert.deepEqual([t.cage.img.w, t.cage.img.h], [4 * l.frameW, l.frameH]);
		// every facing's block sits at the same place relative to its pivot: one cell 3 x 4 + pad, pivot (2 + 2, 6 + 2)
		assert.deepEqual([l.frameW, l.frameH, l.pivot], [3 + 4, 4 + 4, { x: 4, y: 8 }]);
		assert.deepEqual(l.facings, { count: 4, zeroDeg: 45, ccw: true });
		assert.deepEqual(l.animations, { idle: { sheet: 0, start: 0, frames: 1, fps: 1, loop: true } });
		assert.equal(l.resample, "Pixelated");
		assert.equal(l.pixelsPerTile, 29.6);
	});

	it("packs the column strip alone in its sheet, greyed, cells by the fx formula", () => {
		const t = A.buildTreasure(group(), WORLD, undefined);
		const l = t.column.layout;
		assert.equal(t.column.sheet.file, "t-column.png");
		assert.deepEqual([l.frames, l.fps, l.loop, l.grey, l.start], [3, 12, true, true, 0]);
		assert.deepEqual([t.column.sheet.w, t.column.sheet.h], [t.column.packed.w, t.column.packed.h]);
		assert.ok(t.column.sheet.w % l.frameW === 0);
	});

	it("rejects unknown keys and a shared sheet name", () => {
		const g = group();
		g.cage.extra = 1;
		assert.throws(() => A.buildTreasure(g, WORLD, undefined), /unknown key extra/);
		const h = group();
		h.column.atlas = "t-cage";
		assert.throws(() => A.buildTreasure(h, WORLD, undefined), /cannot share/);
	});

	it("lists every frame the lock hashes", () => {
		assert.deepEqual(A.treasureSourceFiles(group()), [
			"t/cage/NE/cage_NE_45.0_0.png",
			"t/cage/NW/cage_NW_135.0_0.png",
			"t/cage/SE/cage_SE_315.0_0.png",
			"t/cage/SW/cage_SW_225.0_0.png",
			"t/column.png",
		]);
		assert.deepEqual(A.treasureSourceFiles(undefined), []);
	});

	it("writes treasureLayout.ts with the cage layout and the column's sheet", () => {
		const text = A.treasureLayoutModule(A.buildTreasure(group(), WORLD, undefined));
		assert.match(text, /export const VALE_TREASURE_CAGE_LAYOUT: ValeWorldSpriteLayout = \{/);
		assert.match(text, /file: "t-cage\.png"/);
		assert.match(text, /export const VALE_TREASURE_FX_SHEET: ValeSheetFile = \{/);
		assert.match(text, /"fx\.treasure\.column": \{/);
	});

	it("the committed treasureLayout.ts is what the build writes from art/vendor (skipped without the frames)", (t) => {
		const files = A.treasureSourceFiles(CONFIG.treasure);
		if (!files.every((f) => fs.existsSync(path.join(ROOT, "art", "vendor", f)))) return t.skip("art/vendor has no generated treasure frames");
		for (const f of files) A.sourceCache.delete(f);
		const built = A.buildTreasure(CONFIG.treasure, CONFIG.worldArt, undefined);
		assert.equal(fs.readFileSync(LAYOUT_FILE, "utf8"), A.treasureLayoutModule(built));
	});
});

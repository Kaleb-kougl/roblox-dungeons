// Specs for the atlas pipeline's fortune group (docs/FORTUNE.md FO10; npm run test:art): the altar as a one-facing world
// sprite set alone in its sheet (the given pivot, its resample), the coin burst as an effect strip alone in its sheet,
// the source files the lock hashes, the generated fortuneLayout.ts, and (when art/vendor holds the generated frames)
// that the committed fortuneLayout.ts is what the build writes. Synthetic PNGs through the pipeline's cache.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");
const { PNG } = require("pngjs");
const A = require("./build-atlases.js");

const ROOT = path.join(__dirname, "..", "..");
const LAYOUT_FILE = path.join(ROOT, "src", "shared", "theme", "packs", "vale", "fortuneLayout.ts");
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "art", "atlases.json"), "utf8"));

function syntheticPng(rel, w, h, paint) {
	const png = new PNG({ width: w, height: h });
	for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) png.data.set(paint(x, y) || [0, 0, 0, 0], (y * w + x) * 4);
	const back = PNG.sync.read(PNG.sync.write(png));
	A.sourceCache.set(rel, { w: back.width, h: back.height, data: new Uint8Array(back.data) });
}

const STONE = [114, 108, 117, 255];
const WORLD = {
	noiseAlpha: 2,
	shadowRgb: 4,
	pad: 2,
	footBand: 3,
	atlas: { name: "decor-atlas", maxSize: 1024 },
	pieces: {},
};

/** A group over synthetic frames: the altar a 5 x 6 block at (4, 2) (pivot 6, 7), a 4-frame 6 x 10 strip. */
function group() {
	syntheticPng("f/altar/altar_0.png", 14, 12, (x, y) => (x >= 4 && x < 9 && y >= 2 && y < 8 ? STONE : null));
	syntheticPng("f/coin.png", 24, 10, (x, y) =>
		x % 6 >= 1 && x % 6 <= 3 && y >= 2 && y < 8 ? [206, 206, 206, 255] : null,
	);
	return {
		pixelsPerTile: 29.6,
		altar: {
			animations: { idle: { file: "f/altar/altar_{f}.png", frames: [0], fps: 1, loop: true } },
			pivot: [[6, 7]],
			own: "f-altar",
			resample: "Pixelated",
		},
		coin: { atlas: "f-coin", pad: 1, file: "f/coin.png", frameW: 6, frames: 4, fps: 20, loop: false, grey: true },
	};
}

describe("fortune group", () => {
	it("cuts the altar's one facing on its pivot into its own sheet", () => {
		const t = A.buildFortune(group(), WORLD, undefined);
		const l = t.altar.layout;
		assert.equal(t.altar.file, "f-altar.png");
		assert.deepEqual(l.sheets, [{ file: "f-altar.png", w: l.frameW, h: l.frameH }]);
		assert.deepEqual([t.altar.img.w, t.altar.img.h], [l.frameW, l.frameH]);
		// one cell 5 x 6 + pad, pivot (2 + 2, 5 + 2)
		assert.deepEqual([l.frameW, l.frameH, l.pivot], [5 + 4, 6 + 4, { x: 4, y: 7 }]);
		assert.equal(l.facings.count, 1);
		assert.deepEqual(l.animations, { idle: { sheet: 0, start: 0, frames: 1, fps: 1, loop: true } });
		assert.equal(l.resample, "Pixelated");
		assert.equal(l.pixelsPerTile, 29.6);
	});

	it("packs the coin strip alone in its sheet, greyed, a one-shot, cells by the fx formula", () => {
		const t = A.buildFortune(group(), WORLD, undefined);
		const l = t.coin.layout;
		assert.equal(t.coin.sheet.file, "f-coin.png");
		assert.deepEqual([l.frames, l.fps, l.loop, l.grey, l.start], [4, 20, false, true, 0]);
		assert.deepEqual([t.coin.sheet.w, t.coin.sheet.h], [t.coin.packed.w, t.coin.packed.h]);
		assert.ok(t.coin.sheet.w % l.frameW === 0);
	});

	it("rejects unknown keys and a shared sheet name", () => {
		const g = group();
		g.altar.extra = 1;
		assert.throws(() => A.buildFortune(g, WORLD, undefined), /unknown key extra/);
		const h = group();
		h.coin.atlas = "f-altar";
		assert.throws(() => A.buildFortune(h, WORLD, undefined), /cannot share/);
		const k = group();
		k.extra = 1;
		assert.throws(() => A.buildFortune(k, WORLD, undefined), /fortune: unknown key extra/);
	});

	it("lists every frame the lock hashes", () => {
		assert.deepEqual(A.fortuneSourceFiles(group()), ["f/altar/altar_0.png", "f/coin.png"]);
		assert.deepEqual(A.fortuneSourceFiles(undefined), []);
	});

	it("writes fortuneLayout.ts with the altar layout and the coin burst's sheet", () => {
		const text = A.fortuneLayoutModule(A.buildFortune(group(), WORLD, undefined));
		assert.match(text, /export const VALE_PACT_ALTAR_LAYOUT: ValeWorldSpriteLayout = \{/);
		assert.match(text, /file: "f-altar\.png"/);
		assert.match(text, /export const VALE_FORTUNE_FX_SHEET: ValeSheetFile = \{/);
		assert.match(text, /"fx\.golden\.coin": \{/);
	});

	it("the committed fortuneLayout.ts is what the build writes from art/vendor (skipped without the frames)", (t) => {
		const files = A.fortuneSourceFiles(CONFIG.fortune);
		if (!files.every((f) => fs.existsSync(path.join(ROOT, "art", "vendor", f))))
			return t.skip("art/vendor has no generated fortune frames");
		for (const f of files) A.sourceCache.delete(f);
		const built = A.buildFortune(CONFIG.fortune, CONFIG.worldArt, undefined);
		assert.equal(fs.readFileSync(LAYOUT_FILE, "utf8"), A.fortuneLayoutModule(built));
	});
});

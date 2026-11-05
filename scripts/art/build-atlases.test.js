// Specs for the atlas pipeline's pure helpers (npm run test:art): outline sheets (enemy outline plan O3), their
// config, the layout they add to layout.ts, and determinism. Synthetic rasters only, no art/vendor files.
"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { PNG } = require("pngjs");
const A = require("./build-atlases.js");

/** Sets pixel (x, y) of a raster to rgba. */
function put(img, x, y, rgba) {
	img.data.set(rgba, (y * img.w + x) * 4);
}

/** Pixel coordinates "x,y" where mask is set, sorted. */
function setPixels(mask, w) {
	const out = [];
	for (let i = 0; i < mask.length; i++) if (mask[i]) out.push(`${i % w},${Math.floor(i / w)}`);
	return out.sort();
}

function coords(list) {
	return list.map(([x, y]) => `${x},${y}`).sort();
}

const alphaAt = (img, x, y) => img.data[(y * img.w + x) * 4 + 3];

const LIT = [200, 180, 160, 255];
const SHADOW = [0, 0, 0, 120];

describe("discOffsets", () => {
	it("radius 1 is the 4-neighbourhood plus the centre; radius 2 is the 13-pixel disc", () => {
		assert.deepEqual(coords(A.discOffsets(1)), coords([[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]));
		assert.equal(A.discOffsets(2).length, 13);
		assert.equal(A.discOffsets(3).length, 29);
		for (const [dx, dy] of A.discOffsets(4)) assert.ok(dx * dx + dy * dy <= 16);
	});
});

describe("dilateCells", () => {
	const w = 11;
	const h = 11;
	const single = () => {
		const m = new Uint8Array(w * h);
		m[5 * w + 5] = 1;
		return m;
	};

	it("dilates a single pixel by radius 1 to exactly the plus shape", () => {
		const out = A.dilateCells(single(), w, h, w, h, 1);
		assert.deepEqual(setPixels(out, w), coords([[5, 5], [4, 5], [6, 5], [5, 4], [5, 6]]));
	});

	it("dilates a single pixel by radius 2 to exactly the Euclidean disc (no corners at distance sqrt 8)", () => {
		const out = A.dilateCells(single(), w, h, w, h, 2);
		const expected = [];
		for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (dx * dx + dy * dy <= 4) expected.push([5 + dx, 5 + dy]);
		assert.equal(expected.length, 13);
		assert.deepEqual(setPixels(out, w), coords(expected));
		assert.equal(out[3 * w + 3], 0); // (-2, -2)
		assert.equal(out[4 * w + 3], 0); // (-2, -1): 5 > 4
	});

	it("never bleeds across a cell edge, horizontally or vertically", () => {
		// 2 x 2 cells of 4 x 4; a body pixel in the bottom-right corner of cell 0
		const cw = 4;
		const ch = 4;
		const m = new Uint8Array(8 * 8);
		m[3 * 8 + 3] = 1;
		const out = A.dilateCells(m, 8, 8, cw, ch, 2);
		assert.deepEqual(setPixels(out, 8), coords([[3, 3], [2, 3], [1, 3], [3, 2], [3, 1], [2, 2]]));
		for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (x >= 4 || y >= 4) assert.equal(out[y * 8 + x], 0, `${x},${y}`);
	});

	it("clips at the raster edge", () => {
		const m = new Uint8Array(3 * 3);
		m[0] = 1;
		assert.deepEqual(setPixels(A.dilateCells(m, 3, 3, 3, 3, 1), 3), coords([[0, 0], [1, 0], [0, 1]]));
	});
});

describe("bodyMask", () => {
	it("keeps lit pixels above bodyAlpha; drops the black shadow, dark pixels and low alpha", () => {
		const img = A.raster(7, 1);
		put(img, 0, 0, [200, 200, 200, 255]); // body
		put(img, 1, 0, [0, 0, 0, 255]); // opaque black shadow
		put(img, 2, 0, [0, 0, 0, 120]); // soft black shadow
		put(img, 3, 0, [200, 200, 200, 64]); // alpha == bodyAlpha: not body
		put(img, 4, 0, [200, 200, 200, 65]); // just above
		put(img, 5, 0, [8, 8, 8, 255]); // max RGB == bodyMinRgb: not body
		put(img, 6, 0, [9, 0, 0, 255]); // just above, on one channel
		assert.deepEqual([...A.bodyMask(img, 64, 8)], [1, 0, 0, 0, 1, 0, 1]);
	});
});

describe("outlineSheet", () => {
	// 9 x 9, one cell; an opaque lit body pixel at (4, 4), a black shadow pixel under it, a half-alpha lit pixel
	const img = A.raster(9, 9);
	put(img, 4, 4, LIT);
	put(img, 4, 5, [0, 0, 0, 128]);
	put(img, 2, 4, [200, 180, 160, 128]);
	const out = A.outlineSheet(img, 9, 9, 1, 64, 8);

	it("has the atlas's size and is white everywhere", () => {
		assert.equal(out.w, 9);
		assert.equal(out.h, 9);
		for (let i = 0; i < 81; i++) assert.deepEqual([...out.data.subarray(i * 4, i * 4 + 3)], [255, 255, 255]);
	});

	it("alpha = 255 - sprite alpha inside the dilated mask, 0 outside", () => {
		assert.equal(alphaAt(out, 4, 4), 0); // opaque body pixel
		assert.equal(alphaAt(out, 5, 4), 255); // transparent pixel next to the body
		assert.equal(alphaAt(out, 4, 3), 255);
		assert.equal(alphaAt(out, 4, 5), 127); // half-alpha shadow next to the body: about half
		assert.equal(alphaAt(out, 2, 4), 127); // half-alpha lit pixel is body itself (128 > 64)
		assert.equal(alphaAt(out, 1, 4), 255); // next to it
		assert.equal(alphaAt(out, 5, 5), 0); // diagonal: outside the radius-1 disc
		assert.equal(alphaAt(out, 4, 6), 0); // the shadow is not body, so it is not dilated
		assert.equal(alphaAt(out, 8, 8), 0);
	});

	it("matches round(255 * dilated * (1 - a / 255)) for every alpha", () => {
		const strip = A.raster(256, 3);
		for (let a = 0; a < 256; a++) {
			put(strip, a, 0, LIT); // body row
			put(strip, a, 1, [0, 0, 0, a]); // probed row, right under the body
		}
		const o = A.outlineSheet(strip, 256, 3, 1, 64, 8);
		for (let a = 0; a < 256; a++) assert.equal(alphaAt(o, a, 1), Math.round(255 * (1 - a / 255)));
	});

	it("leaves an empty cell empty and keeps a body in one cell out of the next", () => {
		const two = A.raster(8, 4);
		put(two, 3, 1, LIT); // right edge of cell 0 (cells 4 x 4)
		const o = A.outlineSheet(two, 4, 4, 2, 64, 8);
		for (let y = 0; y < 4; y++) for (let x = 4; x < 8; x++) assert.equal(alphaAt(o, x, y), 0);
		assert.equal(alphaAt(o, 1, 1), 255);
	});
});

describe("outlineConfig", () => {
	const set = (outline, pad = 3) => ({ pad, outline, pivot: { bodyAlpha: 64, bodyMinRgb: 8 } });

	it("is null without an outline, { widthPx } with one", () => {
		assert.equal(A.outlineConfig("s", set(undefined)), null);
		assert.deepEqual(A.outlineConfig("s", set({ widthPx: 2 })), { widthPx: 2 });
		assert.deepEqual(A.outlineConfig("s", set({ widthPx: 4 }, 5)), { widthPx: 4 });
		assert.deepEqual(A.outlineConfig("s", set({ widthPx: 1, $comment: "x" }, 2)), { widthPx: 1 });
	});

	it("rejects a pad smaller than widthPx + 1", () => {
		assert.throws(() => A.outlineConfig("enemy.x", set({ widthPx: 2 }, 2)), /enemy\.x: pad 2 is too small for outline\.widthPx 2: pad must be >= widthPx \+ 1 = 3/);
		assert.throws(() => A.outlineConfig("enemy.x", set({ widthPx: 1 }, 0)), /pad must be >= widthPx \+ 1 = 2/);
	});

	it("rejects widthPx outside the integers 1..4", () => {
		for (const bad of [0, 5, -1, 1.5, "2", null, undefined]) {
			assert.throws(() => A.outlineConfig("s", set({ widthPx: bad }, 9)), /outline\.widthPx must be an integer in \[1, 4\]/, String(bad));
		}
	});

	it("rejects a malformed outline and unknown keys", () => {
		assert.throws(() => A.outlineConfig("s", set(2)), /outline must be an object/);
		assert.throws(() => A.outlineConfig("s", set({ widthPx: 2, colour: "red" })), /outline\.colour: unknown key/);
	});

	it("clipAtCellEdge lifts the pad rule (any pad >= 0) and is carried in the config", () => {
		assert.deepEqual(A.outlineConfig("class.x", set({ widthPx: 1, clipAtCellEdge: true }, 0)), { widthPx: 1, clipAtCellEdge: true });
		assert.deepEqual(A.outlineConfig("class.x", set({ widthPx: 3, clipAtCellEdge: true }, 1)), { widthPx: 3, clipAtCellEdge: true });
		assert.throws(() => A.outlineConfig("class.x", set({ widthPx: 1 }, 0)), /or set outline\.clipAtCellEdge/);
		for (const bad of [false, 1, "yes", null]) {
			assert.throws(() => A.outlineConfig("s", set({ widthPx: 1, clipAtCellEdge: bad }, 0)), /clipAtCellEdge must be true or absent/, String(bad));
		}
		assert.throws(() => A.outlineConfig("s", set({ widthPx: 1, clipAtCellEdge: true }, -1)), /pad must be a non-negative integer/);
	});
});

describe("rimClip", () => {
	it("counts the cells and body pixels closer than widthPx to their cell's edge", () => {
		const img = A.raster(8, 4); // two 4 x 4 cells
		put(img, 1, 1, LIT); // cell 0, one px in from the edge: clipped at r 2, not at r 1
		put(img, 7, 2, LIT); // cell 1, on its right edge
		put(img, 4, 0, LIT); // cell 1, its top-left corner
		assert.deepEqual(A.rimClip(img, 4, 4, 1, 64, 8), { cells: 1, pixels: 2 });
		assert.deepEqual(A.rimClip(img, 4, 4, 2, 64, 8), { cells: 2, pixels: 3 });
	});

	it("ignores the shadow (not body) and an empty raster", () => {
		const img = A.raster(4, 4);
		assert.deepEqual(A.rimClip(img, 4, 4, 1, 64, 8), { cells: 0, pixels: 0 });
		put(img, 0, 0, [0, 0, 0, 216]); // baked black shadow at the edge
		assert.deepEqual(A.rimClip(img, 4, 4, 1, 64, 8), { cells: 0, pixels: 0 });
	});
});

// ---------------------------------------------------------------------------------------------
// Whole sprite sets, from synthetic sources put in the source cache (no files read)

/** A 2-frame 32 x 16 grid source: a lit 4 x 8 body with a black soft shadow under it. */
function primeSource(rel) {
	const img = A.raster(32, 16);
	for (let f = 0; f < 2; f++) {
		const ox = f * 16;
		for (let y = 4; y <= 11; y++) for (let x = 6; x <= 9; x++) put(img, ox + x, y, LIT);
		for (let y = 12; y <= 13; y++) for (let x = 3; x <= 12; x++) put(img, ox + x, y, SHADOW);
		put(img, ox + 6 + f, 3, LIT); // the frames differ
	}
	A.sourceCache.set(rel, img);
}

function syntheticSet(name, extra) {
	const rel = `synthetic/${name}.png`;
	primeSource(rel);
	return {
		source: { type: "grid", dir: "synthetic", frameW: 16, frameH: 16 },
		facingCount: 1,
		rowForFacing: [0],
		noiseAlpha: 2,
		pad: 3,
		pivot: { measure: { animation: "move", facing: 0, frame: 0 }, bodyAlpha: 64, bodyMinRgb: 8, footBand: 2 },
		bodyTiles: 1,
		resample: "Default",
		animations: { move: { file: `${name}.png`, frames: [0, 1], fps: 10, loop: true } },
		sheets: [{ name: `${name}-move`, animations: ["move"] }],
		...extra,
	};
}

describe("buildSpriteSet with a cell-clipped outline (clipAtCellEdge)", () => {
	const tight = A.buildSpriteSet("class.tight", syntheticSet("tight", { pad: 0, outline: { widthPx: 1, clipAtCellEdge: true } }));
	const loose = A.buildSpriteSet("class.loose", syntheticSet("loose", { pad: 0 }));

	it("builds at pad 0, the body sheet byte-identical to the rimless set's, and reports the clip", () => {
		const [sheet] = tight.sheets;
		assert.equal(sheet.outlineFile, "tight-move-outline.png");
		assert.deepEqual([tight.layout.frameW, tight.layout.frameH], [loose.layout.frameW, loose.layout.frameH]);
		assert.deepEqual(sheet.img.data, loose.sheets[0].img.data);
		assert.deepEqual(tight.outline, { widthPx: 1, clipAtCellEdge: true });
		const expected = A.rimClip(sheet.img, tight.layout.frameW, tight.layout.frameH, 1, 64, 8);
		assert.deepEqual(sheet.rimClip, expected);
		assert.ok(expected.pixels > 0, "pad 0: the body reaches the cell edge");
	});
});

describe("buildSpriteSet with an outline", () => {
	const outlined = A.buildSpriteSet("enemy.test", syntheticSet("enemy", { outline: { widthPx: 2 } }));
	const plain = A.buildSpriteSet("class.test", syntheticSet("player", {}));

	it("crops to the union box plus pad and writes an outline sheet of the same size per sheet", () => {
		// union box x 3..12, y 3..13 -> 10 x 11, + 2 * 3 pad
		assert.equal(outlined.layout.frameW, 16);
		assert.equal(outlined.layout.frameH, 17);
		const [sheet] = outlined.sheets;
		assert.equal(sheet.outlineFile, "enemy-move-outline.png");
		assert.equal(sheet.outlineImg.w, sheet.img.w);
		assert.equal(sheet.outlineImg.h, sheet.img.h);
		assert.deepEqual(outlined.layout.sheets, [{ file: "enemy-move.png", w: sheet.img.w, h: sheet.img.h, outlineFile: "enemy-move-outline.png" }]);
		assert.deepEqual(outlined.outline, { widthPx: 2 });
	});

	it("traces the body, not the shadow; nothing inside the opaque body; nothing on the cell border", () => {
		const { img, outlineImg } = outlined.sheets[0];
		const lw = outlined.layout.frameW;
		const lh = outlined.layout.frameH;
		// cell coords = source coords - (box origin - pad) = source - (0, 0)
		assert.equal(alphaAt(outlineImg, 7, 7), 0); // body
		assert.equal(alphaAt(outlineImg, 5, 7), 255); // 1 left of the body
		assert.equal(alphaAt(outlineImg, 4, 7), 255); // 2 left
		assert.equal(alphaAt(outlineImg, 3, 7), 0); // 3 left
		assert.equal(alphaAt(outlineImg, 7, 12), 255 - 120); // the shadow right under the feet
		assert.equal(alphaAt(outlineImg, 3, 13), 0); // shadow far from the body
		let rim = 0;
		for (let y = 0; y < outlineImg.h; y++) {
			for (let x = 0; x < outlineImg.w; x++) {
				const a = alphaAt(outlineImg, x, y);
				if (alphaAt(img, x, y) === 255) assert.equal(a, 0);
				const cx = x % lw;
				const cy = y % lh;
				if (cx === 0 || cy === 0 || cx === lw - 1 || cy === lh - 1) assert.equal(a, 0, `border ${x},${y}`);
				if (a > 0 && alphaAt(img, x, y) === 0) rim++;
			}
		}
		assert.ok(rim > 0);
	});

	it("a set without an outline has no outline sheet", () => {
		assert.equal(plain.outline, null);
		assert.equal(plain.sheets[0].outlineImg, undefined);
		assert.deepEqual(Object.keys(plain.layout.sheets[0]), ["file", "w", "h"]);
	});

	it("refuses an outline the pad cannot hold", () => {
		assert.throws(() => A.buildSpriteSet("enemy.tight", syntheticSet("tight", { pad: 1, outline: { widthPx: 2 } })), /pad 1 is too small/);
	});

	it("layout.ts names outline files only for outlined sets", () => {
		const text = A.layoutModule([plain, outlined], [], "#000000");
		assert.match(text, /export interface ValeSpriteSheetFile extends ValeSheetFile \{\n\toutlineFile\?: string;\n\}/);
		assert.match(text, /sheets: Array<ValeSpriteSheetFile>;/);
		const at = text.indexOf('"enemy.test"');
		const pt = text.indexOf('"class.test"');
		assert.ok(pt >= 0 && at > pt);
		assert.equal(text.slice(pt, at).includes("outlineFile:"), false);
		assert.equal((text.match(/outlineFile: "enemy-move-outline\.png"/g) || []).length, 1);
		assert.match(text, /\{ file: "enemy-move\.png", w: \d+, h: \d+, outlineFile: "enemy-move-outline\.png" \}/);
	});

	it("contact sheets preview the rim in the role red only for outlined sets", () => {
		const count = (img) => {
			let n = 0;
			const [r, g, b] = A.OUTLINE_PREVIEW_RGB;
			for (let i = 0; i < img.w * img.h; i++) if (img.data[i * 4] === r && img.data[i * 4 + 1] === g && img.data[i * 4 + 2] === b) n++;
			return n;
		};
		assert.deepEqual(A.OUTLINE_PREVIEW_RGB, [0xff, 0x3b, 0x30]);
		assert.ok(count(A.contactSheet(outlined)) > 0);
		assert.equal(count(A.contactSheet(plain)), 0);
	});
});

describe("outputs and stale-file cleanup", () => {
	const outlined = A.buildSpriteSet("enemy.out", syntheticSet("out", { outline: { widthPx: 2 } }));
	const plain = A.buildSpriteSet("class.out", syntheticSet("plainout", {}));
	const outputs = A.buildOutputs([plain, outlined], []);

	it("writes each outline sheet right after its sheet, and none for sets without an outline", () => {
		assert.deepEqual(
			outputs.map((o) => `${o.dir}/${o.name}`),
			["build/plainout-move.png", "contact/class.out.png", "build/out-move.png", "build/out-move-outline.png", "contact/enemy.out.png"],
		);
		assert.equal(outputs[3].img, outlined.sheets[0].outlineImg);
	});

	it("removeStale keeps the outline sheets and removes what the build no longer writes", (t) => {
		const fs = require("node:fs");
		const os = require("node:os");
		const path = require("node:path");
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "art-build-test-"));
		t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
		const keep = new Set(outputs.filter((o) => o.dir === "build").map((o) => o.name));
		for (const name of [...keep, "old-sheet.png", "out-move-outline-old.png"]) fs.writeFileSync(path.join(dir, name), "x");
		fs.writeFileSync(path.join(dir, "notes.txt"), "x");
		const log = console.log;
		console.log = () => undefined;
		try {
			A.removeStale(dir, keep);
		} finally {
			console.log = log;
		}
		assert.deepEqual(fs.readdirSync(dir).sort(), ["notes.txt", "out-move-outline.png", "out-move.png", "plainout-move.png"]);
	});
});

describe("determinism", () => {
	it("the same PNG bytes give byte-identical outline sheets", () => {
		const src = A.raster(12, 10);
		for (let y = 2; y < 8; y++) for (let x = 3; x < 9; x++) put(src, x, y, [(x * 37) & 255, (y * 53) & 255, 99, x === 3 ? 90 : 255]);
		put(src, 5, 8, SHADOW);
		const bytes = A.encodePng(src);
		const run = () => {
			const png = PNG.sync.read(bytes);
			const img = { w: png.width, h: png.height, data: new Uint8Array(png.data) };
			return A.encodePng(A.outlineSheet(img, 6, 5, 2, 64, 8));
		};
		const a = run();
		const b = run();
		assert.ok(Buffer.isBuffer(a));
		assert.equal(Buffer.compare(a, b), 0);
	});

	it("building a set twice gives identical sheets, outline sheets and layout text", () => {
		const one = A.buildSpriteSet("enemy.det", syntheticSet("det", { outline: { widthPx: 3 }, pad: 4 }));
		const two = A.buildSpriteSet("enemy.det", syntheticSet("det", { outline: { widthPx: 3 }, pad: 4 }));
		assert.equal(Buffer.compare(A.encodePng(one.sheets[0].img), A.encodePng(two.sheets[0].img)), 0);
		assert.equal(Buffer.compare(A.encodePng(one.sheets[0].outlineImg), A.encodePng(two.sheets[0].outlineImg)), 0);
		assert.equal(Buffer.compare(A.encodePng(A.contactSheet(one)), A.encodePng(A.contactSheet(two))), 0);
		assert.equal(A.layoutModule([one], [], "#000000"), A.layoutModule([two], [], "#000000"));
	});
});

// ---------------------------------------------------------------------------------------------
// Sprite-set downscale (docs/BOSS_DEMONLORD.md D1): the world-art box filter applied to a whole set

/**
 * A 2-frame 64 x 32 grid source (32 px frames): a lit 8 x 16 body at x 9..16, y 5..20 with a soft lit pixel (alpha
 * 100) at (8, 12), a black soft shadow at y 21..22, x 6..19, and a noise pixel (alpha 2) at (18, 6), alone in its
 * 2 x 2 block. Frame 1 adds a pixel on the head, so the frames differ.
 */
function primeScaledSource(rel) {
	const img = A.raster(64, 32);
	for (let f = 0; f < 2; f++) {
		const ox = f * 32;
		for (let y = 5; y <= 20; y++) for (let x = 9; x <= 16; x++) put(img, ox + x, y, LIT);
		put(img, ox + 8, 12, [LIT[0], LIT[1], LIT[2], 100]);
		for (let y = 21; y <= 22; y++) for (let x = 6; x <= 19; x++) put(img, ox + x, y, SHADOW);
		put(img, ox + 18, 6, [255, 255, 255, 2]);
	}
	put(img, 32 + 12, 5, [10, 200, 10, 255]);
	A.sourceCache.set(rel, img);
}

function scaledSet(name, extra) {
	primeScaledSource(`synthetic/${name}.png`);
	return {
		source: { type: "grid", dir: "synthetic", frameW: 32, frameH: 32 },
		facingCount: 1,
		rowForFacing: [0],
		noiseAlpha: 2,
		pad: 3,
		pivot: { measure: { animation: "move", facing: 0, frame: 0 }, bodyAlpha: 64, bodyMinRgb: 8, footBand: 2 },
		bodyTiles: 1,
		resample: "Default",
		outline: { widthPx: 2 },
		animations: {
			move: { file: `${name}.png`, frames: [0, 1], fps: 10, loop: true },
			hit: { cellsOf: "move", frames: 1, fps: 1, loop: false },
		},
		sheets: [{ name: `${name}-move`, animations: ["move"] }],
		...extra,
	};
}

/** RGBA of pixel (x, y). */
const rgbaAt = (img, x, y) => [...img.data.subarray((y * img.w + x) * 4, (y * img.w + x) * 4 + 4)];

describe("buildSpriteSet with downscale", () => {
	// Full resolution: union box (alpha > 2) x 6..19, y 5..22, + pad 3 -> 20 x 24; origin (3, 2). Body (lit, alpha >
	// 64) x 8..16, y 5..20; feet (rows 19..20) x 9..16 -> feet x 13, bottom edge 21; height 16.
	const full = A.buildSpriteSet("enemy.full", scaledSet("full", {}));
	// downscale 2: the box grows to whole 2 x 2 blocks, x 6..19 -> blocks 3..9, y 5..22 -> blocks 2..11: 7 x 10,
	// + pad 3 (atlas pixels) -> 13 x 16; origin (3 - 3, 2 - 3) = (0, -1) in downscaled pixels.
	const half = A.buildSpriteSet("enemy.half", scaledSet("half", { downscale: 2 }));

	it("an absent downscale and downscale 1 build the same set (the old path)", () => {
		const one = A.buildSpriteSet("enemy.full", scaledSet("full", { downscale: 1 }));
		assert.deepEqual(one.layout, full.layout);
		assert.equal(Buffer.compare(A.encodePng(one.sheets[0].img), A.encodePng(full.sheets[0].img)), 0);
		assert.equal(Buffer.compare(A.encodePng(one.sheets[0].outlineImg), A.encodePng(full.sheets[0].outlineImg)), 0);
		assert.equal(full.downscale, 1);
		assert.deepEqual([full.layout.frameW, full.layout.frameH, full.layout.pivot, full.layout.pixelsPerTile], [20, 24, { x: 10, y: 19 }, 16]);
	});

	it("crops to the block-aligned box / k plus the pad (in atlas pixels)", () => {
		assert.equal(half.downscale, 2);
		assert.deepEqual(half.box, [6, 5, 19, 22]); // the source box, for the build log
		assert.equal(half.layout.frameW, 13);
		assert.equal(half.layout.frameH, 16);
		const [sheet] = half.sheets;
		assert.equal(sheet.img.w % 13, 0);
		assert.equal(sheet.img.h % 16, 0);
		assert.equal(sheet.cells, 2);
		assert.deepEqual(half.layout.animations.hit, { sheet: 0, start: 0, frames: 1, fps: 1, loop: false, stride: 2 });
	});

	it("keeps the feet pivot: full-res (13, 21) / 2 -> x round(6.5) = 7, y ceil(10.5) = 11, minus the origin (0, -1)", () => {
		assert.deepEqual(half.layout.pivot, { x: 7, y: 12 });
		// the pivot's row is the bottom edge of the downscaled row holding the lowest body row (full-res row 20)
		const cellRowOfFeet = Math.floor(20 / 2) - -1;
		assert.equal(half.layout.pivot.y, cellRowOfFeet + 1);
		// the full-res and half-res pivots name the same source point
		assert.deepEqual([(full.layout.pivot.x + 3) / 2, (full.layout.pivot.y + 2) / 2], [6.5, 10.5]);
		assert.deepEqual([half.layout.pivot.x + 0, half.layout.pivot.y - 1], [7, 11]);
	});

	it("divides pixelsPerTile by k (body height in atlas pixels / bodyTiles)", () => {
		assert.equal(half.bodyHeight, 8);
		assert.equal(half.layout.pixelsPerTile, 8);
		const tiles = A.buildSpriteSet("enemy.tiles", scaledSet("tiles", { downscale: 2, bodyTiles: 3 }));
		assert.equal(tiles.layout.pixelsPerTile, 2.7); // 16 / 2 / 3, rounded to 0.1
	});

	it("box-filters each 2 x 2 block with premultiplied alpha, after the noise cut", () => {
		const { img } = half.sheets[0];
		// cell (x, y) = downscaled source pixel (x + 0, y - 1) of frame 0 (cell 0 at the sheet's top-left)
		assert.deepEqual(rgbaAt(img, 6, 7), LIT); // block x 12..13, y 12..13: all body
		// block x 8..9, y 12..13: alpha 100, 255, 0, 255 -> mean 152.5, rounded half up; colour all LIT
		assert.deepEqual(rgbaAt(img, 4, 7), [LIT[0], LIT[1], LIT[2], 153]);
		// block x 18..19, y 6..7 holds only the alpha-2 noise pixel: cleared before the filter, so 0 (not round(2 / 4) = 1)
		assert.equal(alphaAt(img, 9, 4), 0);
		// block x 14..15, y 20..21: two body pixels over two shadow pixels -> alpha (255 + 255 + 120 + 120) / 4,
		// colour the alpha-weighted mean of LIT and black
		const mixed = rgbaAt(img, 7, 11);
		assert.equal(mixed[3], Math.floor((2 * 750 + 4) / 8));
		assert.equal(mixed[0], Math.floor((2 * (LIT[0] * 510) + 750) / (2 * 750)));
		// frame 1's extra head pixel at (12, 5) lands in its own cell only
		const perRow = img.w / 13;
		const cell1 = { x: (1 % perRow) * 13, y: Math.floor(1 / perRow) * 16 };
		assert.equal(rgbaAt(img, cell1.x + 6, cell1.y + 3)[1] > rgbaAt(img, 6, 3)[1], true);
	});

	it("writes the outline sheet at the downscaled size; the pad rule is in atlas pixels", () => {
		const [sheet] = half.sheets;
		assert.equal(sheet.outlineImg.w, sheet.img.w);
		assert.equal(sheet.outlineImg.h, sheet.img.h);
		assert.equal(alphaAt(sheet.outlineImg, 6, 7), 0); // inside the opaque body
		assert.equal(alphaAt(sheet.outlineImg, 3, 7), 255 - alphaAt(sheet.img, 3, 7)); // 1 px left of the soft edge
		for (let y = 0; y < 16; y++) for (let x = 0; x < 13; x++) if (x === 0 || y === 0 || x === 12 || y === 15) assert.equal(alphaAt(sheet.outlineImg, x, y), 0);
		assert.throws(() => A.buildSpriteSet("enemy.tight", scaledSet("tight", { downscale: 2, pad: 2 })), /pad 2 is too small/);
	});

	it("rejects a downscale that is not an integer >= 1", () => {
		for (const bad of [0, -2, 1.5, "2", null]) {
			assert.throws(() => A.buildSpriteSet("enemy.bad", scaledSet("bad", { downscale: bad })), /enemy\.bad: downscale must be an integer >= 1/, String(bad));
		}
	});

	it("is deterministic", () => {
		const again = A.buildSpriteSet("enemy.half", scaledSet("half", { downscale: 2 }));
		assert.equal(Buffer.compare(A.encodePng(again.sheets[0].img), A.encodePng(half.sheets[0].img)), 0);
		assert.equal(Buffer.compare(A.encodePng(again.sheets[0].outlineImg), A.encodePng(half.sheets[0].outlineImg)), 0);
		assert.equal(A.layoutModule([again], [], "#000000"), A.layoutModule([half], [], "#000000"));
	});
});

describe("chooseGrid: the Demon Lord's cells (docs/BOSS_DEMONLORD.md D1)", () => {
	it("128 cells (16 facings x 8 frames) of 98 x 78 fit one atlas: 10 x 13 = 130, 980 x 1014", () => {
		const g = A.chooseGrid(128, 98, 78, "boss");
		assert.deepEqual([g.cols, g.rows], [10, 13]);
		assert.ok(g.cols * 98 <= A.MAX_ATLAS && g.rows * 78 <= A.MAX_ATLAS);
	});

	it("one more pixel of cell height (79) leaves 10 x 12 = 120 cells and refuses", () => {
		assert.throws(() => A.chooseGrid(128, 98, 79, "boss"), /128 cells of 98x79 do not fit one 1024x1024 atlas \(max 120\)/);
	});
});

describe("pixelsPerTileFrom (sprite sets drawn at another set's scale)", () => {
	// The synthetic body is 9 px tall (y 3..11): bodyTiles 7 -> 9 / 7 = 1.2857.. -> 1.3 px/tile.
	const base = () => syntheticSet("ppt-base", { bodyTiles: 7 });
	// sorts BEFORE its source, so the build must reorder; a different pad moves its own pivot
	const user = () => syntheticSet("ppt-user", { bodyTiles: undefined, pixelsPerTileFrom: "z.base", pad: 5 });

	it("takes the named set's pixelsPerTile exactly; the pivot is still measured on its own frame", () => {
		const sets = A.buildSpriteSets({ "a.user": user(), "z.base": base() });
		assert.deepEqual(
			sets.map((s) => s.id),
			["a.user", "z.base"],
		);
		const [u, b] = sets;
		assert.equal(b.layout.pixelsPerTile, 1.3);
		assert.equal(u.layout.pixelsPerTile, b.layout.pixelsPerTile);
		assert.equal(u.pixelsPerTileFrom, "z.base");
		assert.equal(b.pixelsPerTileFrom, undefined);
		// pad 5 vs 3: the same feet sit 2 px further into the cell on each axis
		assert.deepEqual(u.layout.pivot, { x: b.layout.pivot.x + 2, y: b.layout.pivot.y + 2 });
	});

	it("builds each set's source just before it, otherwise in id order", () => {
		assert.deepEqual(A.spriteSetOrder({ "a.user": user(), "z.base": base(), "m.other": base() }), ["z.base", "a.user", "m.other"]);
		assert.deepEqual(
			A.spriteSetOrder({
				"a.top": { pixelsPerTileFrom: "b.mid" },
				"b.mid": { pixelsPerTileFrom: "c.root" },
				"c.root": { bodyTiles: 1 },
			}),
			["c.root", "b.mid", "a.top"],
		);
	});

	it("a set that others take their scale from builds exactly as it does alone", () => {
		const alone = A.buildSpriteSets({ "z.base": base() })[0];
		const shared = A.buildSpriteSets({ "a.user": user(), "z.base": base() })[1];
		assert.equal(A.layoutModule([alone], [], "#000000"), A.layoutModule([shared], [], "#000000"));
		assert.equal(Buffer.compare(A.encodePng(alone.sheets[0].img), A.encodePng(shared.sheets[0].img)), 0);
	});

	it("fails on a missing reference, a cycle, or a set with both or neither density source", () => {
		assert.throws(() => A.buildSpriteSets({ "a.user": user() }), /a\.user: pixelsPerTileFrom names no sprite set z\.base/);
		assert.throws(
			() => A.spriteSetOrder({ "a.x": { pixelsPerTileFrom: "b.y" }, "b.y": { pixelsPerTileFrom: "a.x" } }),
			/pixelsPerTileFrom cycle: a\.x -> b\.y -> a\.x/,
		);
		assert.throws(() => A.spriteSetOrder({ "a.self": { pixelsPerTileFrom: "a.self" } }), /cycle: a\.self -> a\.self/);
		assert.throws(
			() => A.buildSpriteSets({ "a.both": syntheticSet("ppt-both", { pixelsPerTileFrom: "z.base" }), "z.base": base() }),
			/a\.both: give exactly one of bodyTiles and pixelsPerTileFrom/,
		);
		assert.throws(() => A.buildSpriteSets({ "a.none": syntheticSet("ppt-none", { bodyTiles: undefined }) }), /a\.none: give exactly one/);
		// buildSpriteSet alone has no built sets to read from
		assert.throws(() => A.buildSpriteSet("a.user", user()), /a\.user: pixelsPerTileFrom z\.base is not a built sprite set/);
	});

	it("is only defined between two full-resolution sets (no downscale on either side)", () => {
		const downUser = syntheticSet("ppt-down-user", { bodyTiles: undefined, pixelsPerTileFrom: "z.base", downscale: 2 });
		assert.throws(() => A.buildSpriteSets({ "a.user": downUser, "z.base": base() }), /a\.user: pixelsPerTileFrom z\.base needs two sets without downscale/);
		const downBase = syntheticSet("ppt-down-base", { bodyTiles: 7, downscale: 2 });
		assert.throws(() => A.buildSpriteSets({ "a.user": user(), "z.base": downBase }), /a\.user: pixelsPerTileFrom z\.base needs two sets without downscale/);
		// downscale 1 is the full-resolution path
		const oneUser = syntheticSet("ppt-one-user", { bodyTiles: undefined, pixelsPerTileFrom: "z.base", pad: 5, downscale: 1 });
		assert.equal(A.buildSpriteSets({ "a.user": oneUser, "z.base": base() })[0].layout.pixelsPerTile, 1.3);
	});
});

describe("images with pixelsPerTileFrom (world art drawn at a sprite set's scale, docs/BOOST_ART.md)", () => {
	// A 6 x 4 visible blob in a 20 x 20 source: crop alpha + pad 3 -> 12 x 10, pivot centre (6, 5).
	const blob = () => {
		const img = A.raster(20, 20);
		for (let y = 8; y < 12; y++) for (let x = 7; x < 13; x++) put(img, x, y, LIT);
		A.sourceCache.set("synthetic/blob.png", img);
		return { file: "synthetic/blob.png", name: "blob", crop: "alpha", noiseAlpha: 2, pad: 3, pivot: "center" };
	};
	const base = () => syntheticSet("img-base", { bodyTiles: 7 });

	it("copies the named set's pixelsPerTile exactly into the layout; the pixels and pivot are unchanged", () => {
		const sets = A.buildSpriteSets({ "z.base": base() });
		const [drop, plain] = A.buildImages({ "boost.test": { ...blob(), pixelsPerTileFrom: "z.base" }, "ui.test": blob() }, sets);
		assert.equal(drop.id, "boost.test");
		assert.deepEqual(drop.layout, { file: "blob.png", w: 12, h: 10, pivot: { x: 6, y: 5 }, pixelsPerTile: sets[0].layout.pixelsPerTile });
		assert.equal(sets[0].layout.pixelsPerTile, 1.3);
		// without it the layout has no pixelsPerTile key (ui images, the floor texture)
		assert.deepEqual(plain.layout, { file: "blob.png", w: 12, h: 10, pivot: { x: 6, y: 5 } });
		assert.equal(Buffer.compare(A.encodePng(drop.img), A.encodePng(plain.img)), 0);
		assert.match(A.layoutModule(sets, [drop], "#000000"), /"boost\.test": \{[^}]*\}[^}]*pixelsPerTile: 1\.3,/);
		assert.match(A.layoutModule(sets, [drop], "#000000"), /\tpixelsPerTile\?: number;/);
	});

	it("fails when the named sprite set was not built", () => {
		assert.throws(() => A.buildImages({ "boost.test": { ...blob(), pixelsPerTileFrom: "z.none" } }, []), /boost\.test: pixelsPerTileFrom z\.none is not a built sprite set/);
	});
});

describe("sourceFiles and lockAlso", () => {
	const frames = (extra) => ({
		spriteSets: {
			"enemy.x": {
				source: { type: "frames", dir: "pack/x", frameW: 8, frameH: 8 },
				facingCount: 4,
				facingDirs: ["E", "N", "W", "S"],
				animations: {
					idle: { folder: "x_a", frames: [0, 2] },
					move: { cellsOf: "idle", frames: 1 },
				},
				...extra,
			},
		},
		images: {},
	});

	it("lists every facing x kept frame of the real animations, and nothing for a stand-in", () => {
		const files = A.sourceFiles(frames({}));
		assert.equal(files.length, 8);
		assert.ok(files.includes("pack/x/x_a/N/x_a_N_90.0_2.png"));
		assert.ok(files.includes("pack/x/x_a/S/x_a_S_270.0_0.png"));
		assert.equal(files.includes("pack/x/x_a/E/x_a_E_0.0_1.png"), false);
	});

	it("lockAlso adds its frames to the lock (deduplicated), though no sheet reads them", () => {
		const files = A.sourceFiles(
			frames({ lockAlso: { all: { folder: "x_a", frames: [0, 1, 2, 3] }, later: { folder: "x_b", frames: [0] } } }),
		);
		assert.equal(files.length, 4 * 4 + 4);
		assert.ok(files.includes("pack/x/x_a/E/x_a_E_0.0_1.png"));
		assert.ok(files.includes("pack/x/x_b/W/x_b_W_180.0_0.png"));
		assert.deepEqual(files, [...files].sort());
		assert.throws(() => A.sourceFiles(frames({ lockAlso: { bad: { frames: [0] } } })), /enemy\.x: lockAlso\.bad needs a frames source, a folder and frames/);
	});
});

// ---------------------------------------------------------------------------------------------
// Layered grid sources (docs/DEMON_ART.md DA2 / DD3): `source.layers`, bottom to top, "" = source.dir itself

const px = (img, x, y) => [...img.data.subarray((y * img.w + x) * 4, (y * img.w + x) * 4 + 4)];

describe("layered grid sources", () => {
	const BLUE = [0, 0, 255, 255];
	const HALF_RED = [255, 0, 0, 128];
	/** Two 4 x 1 layers under layer/<sub>/: (0) both set, (1) bottom only, (2) top only, (3) neither. */
	const prime = (dir, file) => {
		const bottom = A.raster(4, 1);
		const top = A.raster(4, 1);
		put(bottom, 0, 0, BLUE);
		put(bottom, 1, 0, BLUE);
		put(top, 0, 0, HALF_RED);
		put(top, 2, 0, HALF_RED);
		A.sourceCache.set(`${dir}/Shadows/${file}`, bottom);
		A.sourceCache.set(`${dir}/${file}`, top);
	};

	it("composites bottom to top with premultiplied integer 'over' (the first entry is the bottom)", () => {
		prime("layer/order", "a.png");
		const src = { type: "grid", dir: "layer/order", frameW: 4, frameH: 1 };
		const up = A.gridSheet("t", { ...src, layers: ["Shadows", ""] }, "a.png");
		// half red over opaque blue: a = 128 + round(255 * 127 / 255) = 255; r = 255 * 128 / 255 = 128; b = 255 * 127 / 255
		assert.deepEqual(px(up, 0, 0), [128, 0, 127, 255]);
		assert.deepEqual(px(up, 1, 0), BLUE); // bottom only
		assert.deepEqual(px(up, 2, 0), HALF_RED); // top only, over nothing: unchanged
		assert.deepEqual(px(up, 3, 0), [0, 0, 0, 0]);
		const down = A.gridSheet("t", { ...src, layers: ["", "Shadows"] }, "a.png");
		assert.deepEqual(px(down, 0, 0), BLUE); // opaque blue on top hides the red
		assert.deepEqual(px(down, 2, 0), HALF_RED);
		// equals compositeOver applied by hand, and never touches the cached source rasters
		const hand = A.raster(4, 1);
		A.compositeOver(A.sourceCache.get("layer/order/Shadows/a.png"), hand, 0, 0, 1000);
		A.compositeOver(A.sourceCache.get("layer/order/a.png"), hand, 0, 0, 1000);
		assert.deepEqual([...up.data], [...hand.data]);
		assert.deepEqual(px(A.sourceCache.get("layer/order/a.png"), 0, 0), HALF_RED);
	});

	it("without layers the sheet is the source file itself", () => {
		prime("layer/none", "a.png");
		const img = A.gridSheet("t", { type: "grid", dir: "layer/none", frameW: 4, frameH: 1 }, "a.png");
		assert.equal(img, A.sourceCache.get("layer/none/a.png"));
	});

	it("lists every layer file for the lock (sourceFiles), sorted, and one file without layers", () => {
		const config = (layers) => ({
			spriteSets: {
				"enemy.l": {
					source: { type: "grid", dir: "pack/Beast", frameW: 4, frameH: 1, ...(layers ? { layers } : {}) },
					facingCount: 1,
					animations: { idle: { file: "Idle 16.png", frames: [0] }, hit: { cellsOf: "idle" } },
				},
			},
			images: {},
		});
		assert.deepEqual(A.sourceFiles(config(undefined)), ["pack/Beast/Idle 16.png"]);
		assert.deepEqual(A.sourceFiles(config(["Shadows", ""])), ["pack/Beast/Idle 16.png", "pack/Beast/Shadows/Idle 16.png"]);
		assert.deepEqual(A.sourceFiles(config(["Shadows", "", "Effects/Glow"])), [
			"pack/Beast/Effects/Glow/Idle 16.png",
			"pack/Beast/Idle 16.png",
			"pack/Beast/Shadows/Idle 16.png",
		]);
		assert.deepEqual(A.gridFiles("t", { dir: "d", type: "grid", layers: ["Shadows", ""] }, "x.png"), ["d/Shadows/x.png", "d/x.png"]);
	});

	it("fails loudly on a missing layer file or layers of different sizes", () => {
		A.sourceCache.set("layer/miss/a.png", A.raster(4, 1));
		assert.throws(
			() => A.gridSheet("Idle.png", { type: "grid", dir: "layer/miss", frameW: 4, frameH: 1, layers: ["NoSuchLayer", ""] }, "a.png"),
			/Idle\.png: layer file layer\/miss\/NoSuchLayer\/a\.png is missing/,
		);
		A.sourceCache.set("layer/size/S/a.png", A.raster(4, 2));
		A.sourceCache.set("layer/size/a.png", A.raster(4, 1));
		assert.throws(
			() => A.gridSheet("t", { type: "grid", dir: "layer/size", frameW: 4, frameH: 1, layers: ["S", ""] }, "a.png"),
			/layer layer\/size\/a\.png is 4x1, but layer\/size\/S\/a\.png is 4x2/,
		);
	});

	it("rejects a malformed layers list, and layers on a frames source", () => {
		const grid = (layers) => ({ type: "grid", dir: "d", layers });
		for (const bad of [[], "Shadows", [3], ["../up"], ["/abs"], ["a//b"], ["a/"], ["./a"], ["a\\b"]]) {
			assert.throws(() => A.gridLayers("enemy.b", grid(bad)), /enemy\.b: source\.layers/, JSON.stringify(bad));
		}
		assert.throws(() => A.gridLayers("enemy.b", grid(["Shadows", "Shadows"])), /lists "Shadows" twice/);
		assert.throws(() => A.gridLayers("enemy.b", { type: "frames", dir: "d", layers: [""] }), /needs a grid source/);
		assert.deepEqual(A.gridLayers("ok", grid(["Shadows", "", "Effects/Glow"])), ["Shadows", "", "Effects/Glow"]);
		assert.equal(A.gridLayers("ok", { type: "grid", dir: "d" }), null);
	});

	it("layerNoiseAlpha clears a layer's faint pixels before it is composited, leaving the other layers whole", () => {
		const bottom = A.raster(4, 1);
		const top = A.raster(4, 1);
		const SHADE = [2, 4, 5, 191];
		const GLOW = [255, 0, 255, 126];
		const BODY = [9, 9, 9, 255];
		put(bottom, 0, 0, SHADE);
		put(bottom, 1, 0, SHADE);
		put(top, 0, 0, GLOW); // a glow over the shadow
		put(top, 2, 0, GLOW); // a glow over nothing
		put(top, 3, 0, BODY);
		A.sourceCache.set("layer/cut/Shadows/a.png", bottom);
		A.sourceCache.set("layer/cut/a.png", top);
		const src = { type: "grid", dir: "layer/cut", frameW: 4, frameH: 1, layers: ["Shadows", ""] };
		const cut = A.gridSheet("t", { ...src, layerNoiseAlpha: { "": 254 } }, "a.png");
		assert.deepEqual(px(cut, 0, 0), SHADE); // the glow is gone, the shadow under it untouched
		assert.deepEqual(px(cut, 1, 0), SHADE);
		assert.deepEqual(px(cut, 2, 0), [0, 0, 0, 0]);
		assert.deepEqual(px(cut, 3, 0), BODY);
		// without the option (or a cut of 0) the glow composites as before; the cached sources are never touched
		const plain = A.gridSheet("t", src, "a.png");
		assert.notDeepEqual(px(plain, 0, 0), SHADE);
		assert.deepEqual(px(plain, 2, 0), GLOW);
		assert.deepEqual([...A.gridSheet("t", { ...src, layerNoiseAlpha: { "": 0 } }, "a.png").data], [...plain.data]);
		assert.deepEqual(px(A.sourceCache.get("layer/cut/a.png"), 0, 0), GLOW);
		// a cut on the bottom layer only clears that layer
		const low = A.gridSheet("t", { ...src, layerNoiseAlpha: { Shadows: 191 } }, "a.png");
		assert.deepEqual(px(low, 0, 0), GLOW);
		assert.deepEqual(px(low, 1, 0), [0, 0, 0, 0]);
	});

	it("rejects a malformed layerNoiseAlpha", () => {
		const grid = (layerNoiseAlpha, layers = ["Shadows", ""]) => ({ type: "grid", dir: "d", layers, layerNoiseAlpha });
		assert.equal(A.gridLayerNoise("ok", { type: "grid", dir: "d", layers: [""] }), null);
		assert.deepEqual(A.gridLayerNoise("ok", grid({ "": 254 })), [0, 254]);
		assert.throws(() => A.gridLayerNoise("enemy.b", { type: "grid", dir: "d", layerNoiseAlpha: { "": 9 } }), /needs source\.layers/);
		assert.throws(() => A.gridLayerNoise("enemy.b", grid({ Effects: 9 })), /names "Effects", which is not in source\.layers/);
		for (const bad of [-1, 255, 1.5, "9", null]) {
			assert.throws(() => A.gridLayerNoise("enemy.b", grid({ "": bad })), /enemy\.b: source\.layerNoiseAlpha/, JSON.stringify(bad));
		}
		for (const bad of [[254], 254, null]) {
			assert.throws(() => A.gridLayerNoise("enemy.b", grid(bad)), /must be an object/, JSON.stringify(bad));
		}
	});

	it("composites before the crop and the pivot: a shadow layer below the body grows the cell, the feet stay", () => {
		const plain = syntheticSet("layered", {});
		A.sourceCache.set("synthetic/Shadows/layered.png", A.raster(32, 16));
		const shadow = A.sourceCache.get("synthetic/Shadows/layered.png");
		for (let f = 0; f < 2; f++) for (let x = 5; x <= 10; x++) put(shadow, f * 16 + x, 14, SHADOW); // one row below the baked one
		const without = A.buildSpriteSet("enemy.lw", plain);
		const withLayers = A.buildSpriteSet("enemy.ly", { ...plain, source: { ...plain.source, layers: ["Shadows", ""] } });
		assert.equal(withLayers.layout.frameH, without.layout.frameH + 1);
		assert.equal(withLayers.layout.frameW, without.layout.frameW);
		assert.deepEqual(withLayers.layout.pivot, without.layout.pivot); // the shadow is not body (bodyMinRgb)
		const { img } = withLayers.sheets[0];
		assert.deepEqual(px(img, 7, 14), SHADOW); // the layer's pixel is in the sheet (cell origin is (0, 0) here)
		assert.equal(alphaAt(without.sheets[0].img, 7, 14), 0);
		// a set that names the body sheet alone as its one layer builds the same pixels as no layers
		const one = A.buildSpriteSet("enemy.l1", { ...plain, source: { ...plain.source, layers: [""] } });
		assert.equal(Buffer.compare(A.encodePng(one.sheets[0].img), A.encodePng(without.sheets[0].img)), 0);
	});
});

// ---------------------------------------------------------------------------------------------
// Per-sheet cells (docs/DEMON_ART.md DA2 / DD4): `cells: "perSheet"`

/** A 2-frame 32 x 16 grid source: a lit 4 x 8 body (feet at y 11), plus extra lit pixels at `extra` [x, y]. */
function primeShape(rel, extra) {
	const img = A.raster(32, 16);
	for (let f = 0; f < 2; f++) {
		const ox = f * 16;
		for (let y = 4; y <= 11; y++) for (let x = 6; x <= 9; x++) put(img, ox + x, y, LIT);
		for (const [x, y] of extra) put(img, ox + x, y, LIT);
	}
	A.sourceCache.set(rel, img);
}

/** Three animations in two sheets: idle (the body), lunge (reaches right to x 14), wave (reaches up to y 0). */
function cellSet(extra) {
	primeShape("cells/idle.png", []);
	primeShape("cells/lunge.png", [[14, 8]]);
	primeShape("cells/wave.png", [[7, 0]]);
	return {
		source: { type: "grid", dir: "cells", frameW: 16, frameH: 16 },
		facingCount: 1,
		rowForFacing: [0],
		noiseAlpha: 2,
		pad: 3,
		pivot: { measure: { animation: "idle", facing: 0, frame: 0 }, bodyAlpha: 64, bodyMinRgb: 8, footBand: 2 },
		bodyTiles: 1,
		resample: "Default",
		outline: { widthPx: 2 },
		animations: {
			idle: { file: "idle.png", frames: [0, 1], fps: 6, loop: true },
			lunge: { file: "lunge.png", frames: [0, 1], fps: 12, loop: false },
			wave: { file: "wave.png", frames: [0], fps: 12, loop: false },
			hit: { cellsOf: "lunge", frames: 1, fps: 1, loop: false },
		},
		sheets: [
			{ name: "c-idle", animations: ["idle"] },
			{ name: "c-act", animations: ["lunge", "wave"] },
		],
		...extra,
	};
}

describe("per-sheet cells", () => {
	const one = A.buildSpriteSet("enemy.one", cellSet({}));
	const per = A.buildSpriteSet("enemy.per", cellSet({ cells: "perSheet" }));

	it("keeps the set-level cell and pivot exactly as with one cell", () => {
		// union box x 6..14, y 0..11 -> 9 x 12, + 2 * 3 pad
		assert.equal(one.layout.frameW, 15);
		assert.equal(one.layout.frameH, 18);
		assert.deepEqual(one.layout.pivot, { x: 8 - 3, y: 12 + 3 });
		for (const k of ["frameW", "frameH", "pivot", "pixelsPerTile", "facings", "animations"]) assert.deepEqual(per.layout[k], one.layout[k], k);
		assert.equal(per.perSheet, true);
		assert.equal(one.perSheet, false);
	});

	it("trims each sheet to the union box of its own animations, plus pad", () => {
		const [idle, act] = per.layout.sheets;
		// idle: body x 6..9, y 4..11 -> 4 x 8 + 6
		assert.deepEqual([idle.frameW, idle.frameH], [10, 14]);
		// lunge + wave: x 6..14, y 0..11 -> the set's cell
		assert.deepEqual([act.frameW, act.frameH], [15, 18]);
		assert.equal(idle.w % idle.frameW, 0);
		assert.equal(idle.h % idle.frameH, 0);
		assert.equal(per.sheets[0].img.w, idle.w);
		assert.equal(per.sheets[0].outlineImg.w, idle.w);
		assert.equal(per.sheets[0].outlineImg.h, idle.h);
		assert.equal(idle.outlineFile, "c-idle-outline.png");
		// one cell: every sheet uses the set's cell and carries no cell fields
		assert.deepEqual(Object.keys(one.layout.sheets[0]), ["file", "w", "h", "outlineFile"]);
	});

	it("puts the pivot on the same source point in every sheet (translated by the sheet's crop offset)", () => {
		const [idle, act] = per.layout.sheets;
		// idle's crop starts at source (3, 1); the set's at (3, -3): the pivot moves up 4 px in the idle cell
		assert.deepEqual(idle.pivot, { x: 8 - 3, y: 12 - 1 });
		assert.deepEqual(act.pivot, per.layout.pivot);
		// every visible pixel of an idle cell sits at the same offset from its pivot as in the one-cell build
		const a = per.layout.animations.idle;
		for (let f = 0; f < a.frames; f++) {
			const cs = A.sheetCell(per.layout, idle);
			const co = A.sheetCell(one.layout, one.layout.sheets[0]);
			const pi = per.sheets[0].img;
			const oi = one.sheets[0].img;
			const pPer = Math.floor(idle.w / cs.w);
			const oPer = Math.floor(one.layout.sheets[0].w / co.w);
			const px0 = ((a.start + f) % pPer) * cs.w;
			const py0 = Math.floor((a.start + f) / pPer) * cs.h;
			const ox0 = ((a.start + f) % oPer) * co.w;
			const oy0 = Math.floor((a.start + f) / oPer) * co.h;
			let visible = 0;
			for (let y = 0; y < co.h; y++) {
				for (let x = 0; x < co.w; x++) {
					const o = px(oi, ox0 + x, oy0 + y);
					if (o[3] === 0) continue;
					visible++;
					const qx = x - co.pivot.x + cs.pivot.x;
					const qy = y - co.pivot.y + cs.pivot.y;
					assert.ok(qx >= 0 && qy >= 0 && qx < cs.w && qy < cs.h, `${x},${y} inside the trimmed cell`);
					assert.deepEqual(px(pi, px0 + qx, py0 + qy), o);
				}
			}
			assert.ok(visible > 0);
		}
	});

	it("keeps the pivot inside a sheet whose animations never reach the feet", () => {
		primeShape("cells/high.png", []);
		const high = A.raster(32, 16);
		for (let f = 0; f < 2; f++) put(high, f * 16 + 12, 1, LIT); // a lone pixel up-right, far from the feet
		A.sourceCache.set("cells/spark.png", high);
		const set = cellSet({ cells: "perSheet" });
		set.animations.spark = { file: "spark.png", frames: [0], fps: 12, loop: false };
		set.sheets.push({ name: "c-spark", animations: ["spark"] });
		const r = A.buildSpriteSet("enemy.spark", set);
		const s = r.layout.sheets[2];
		// box: the spark (12, 1) and the pixel up-left of the pivot (7, 11) -> x 7..12, y 1..11
		assert.deepEqual([s.frameW, s.frameH], [12, 17]);
		assert.deepEqual(s.pivot, { x: 8 - 4, y: 12 + 2 });
		assert.ok(s.pivot.x > 0 && s.pivot.x < s.frameW && s.pivot.y > 0 && s.pivot.y < s.frameH);
	});

	it("emits per-sheet frameW / frameH / pivot in layout.ts, and declares them only when a set uses them", () => {
		const text = A.layoutModule([per], [], "#000000");
		assert.match(text, /\tframeW\?: number;\n\tframeH\?: number;\n\tpivot\?: Pivot;\n\}/);
		assert.match(
			text,
			/\{\n\t\t\t\tfile: "c-idle\.png",\n\t\t\t\tw: \d+,\n\t\t\t\th: \d+,\n\t\t\t\tframeW: 10,\n\t\t\t\tframeH: 14,\n\t\t\t\tpivot: \{ x: 5, y: 11 \},\n\t\t\t\toutlineFile: "c-idle-outline\.png",\n\t\t\t\},/,
		);
		const plain = A.layoutModule([one], [], "#000000");
		assert.equal(plain.includes("frameW?: number"), false);
		assert.match(plain, /export interface ValeSpriteSheetFile extends ValeSheetFile \{\n\toutlineFile\?: string;\n\}/);
		// the interface depends on every set: one per-sheet set declares the fields for all
		assert.match(A.layoutModule([one, per], [], "#000000"), /pivot\?: Pivot;/);
	});

	it("draws contact sheets with every pivot on one spot, and builds deterministically", () => {
		const c = A.contactSheet(per);
		assert.equal(c.w, A.contactSheet(one).w);
		assert.equal(c.h, A.contactSheet(one).h);
		const again = A.buildSpriteSet("enemy.per", cellSet({ cells: "perSheet" }));
		for (let i = 0; i < per.sheets.length; i++) {
			assert.equal(Buffer.compare(A.encodePng(per.sheets[i].img), A.encodePng(again.sheets[i].img)), 0);
			assert.equal(Buffer.compare(A.encodePng(per.sheets[i].outlineImg), A.encodePng(again.sheets[i].outlineImg)), 0);
		}
		assert.equal(Buffer.compare(A.encodePng(c), A.encodePng(A.contactSheet(again))), 0);
		assert.equal(A.layoutModule([per], [], "#000000"), A.layoutModule([again], [], "#000000"));
	});

	it("rejects an unknown cells value", () => {
		assert.throws(() => A.buildSpriteSet("enemy.bad", cellSet({ cells: "sheet" })), /enemy\.bad: cells must be "perSheet" .* got "sheet"/);
		assert.equal(A.cellsMode("x", {}), "set");
	});
});

describe("sheet cuts and 9-sliced panels (docs/DRAFT_REVEAL.md DR3)", () => {
	const GREY = (v) => [v, v, v, 255];
	const FRAME = [70, 36, 36, 255];
	const pixel = (img, x, y) => Array.from(img.data.slice((y * img.w + x) * 4, (y * img.w + x) * 4 + 4));
	const quiet = (fn) => {
		const log = console.log;
		console.log = () => undefined;
		try {
			return fn();
		} finally {
			console.log = log;
		}
	};
	// A 40 x 30 sheet with two pieces: a 10 x 8 framed panel at (4, 5) whose fill is a grey ramp (noise), and a faint
	// alpha-1 pixel next to it; another opaque blob at (25, 20) the rect must leave out.
	const sheet = () => {
		const img = A.raster(40, 30);
		for (let y = 0; y < 8; y++) {
			for (let x = 0; x < 10; x++) put(img, 4 + x, 5 + y, x === 0 || y === 0 || x === 9 || y === 7 ? FRAME : GREY(28 + ((x + y) % 4)));
		}
		put(img, 14, 9, [255, 255, 0, 1]);
		for (let y = 20; y < 24; y++) for (let x = 25; x < 30; x++) put(img, x, y, LIT);
		A.sourceCache.set("synthetic/sheet.png", img);
		return img;
	};
	const panel = (extra) => ({ file: "synthetic/sheet.png", name: "panel", rect: [3, 4, 13, 11], crop: "alpha", noiseAlpha: 10, pad: 0, ...extra });

	it("rect: crop alpha trims the window to its opaque pixels (faint noise cleared, the other piece left out)", () => {
		sheet();
		const [img] = A.buildImages({ "ui.panel.test": panel() }, []);
		assert.deepEqual(img.layout, { file: "panel.png", w: 10, h: 8 });
		assert.deepEqual(pixel(img.img, 0, 0), FRAME);
		assert.deepEqual(pixel(img.img, 1, 1), GREY(30));
		// crop "none" keeps the window as it is: 13 x 11 from (3, 4), the faint pixel cleared by noiseAlpha
		const [none] = A.buildImages({ "ui.none.test": panel({ crop: "none" }) }, []);
		assert.deepEqual([none.layout.w, none.layout.h], [13, 11]);
		assert.equal(alphaAt(none.img, 11, 5), 0);
		assert.deepEqual(pixel(none.img, 1, 1), FRAME);
		// a window outside the file fails
		assert.throws(() => A.buildImages({ "ui.bad.test": panel({ rect: [30, 20, 20, 5] }) }, []), /ui\.bad\.test: rect \[30,20,20,5\] must be \[x, y, w, h\].*inside the 40x30 image/);
	});

	it("slice passes into the layout as insets and must leave a centre", () => {
		sheet();
		const [img] = A.buildImages({ "ui.panel.test": panel({ slice: [1, 1, 1, 1] }) }, []);
		assert.deepEqual(img.layout.slice, { left: 1, top: 1, right: 1, bottom: 1 });
		const text = A.layoutModule([], [img], "#000000");
		assert.match(text, /"ui\.panel\.test": \{[^}]*slice: \{ left: 1, top: 1, right: 1, bottom: 1 \}/);
		assert.match(text, /\tslice\?: SliceInsets;/);
		assert.match(text, /import type \{ HexColor, Pivot, SliceInsets, SpriteSetAsset \} from "\.\.\/\.\.\/types";/);
		// left + right = w, top + bottom = h, negatives, fractions, wrong length
		assert.throws(() => A.buildImages({ "ui.w.test": panel({ slice: [5, 1, 5, 1] }) }, []), /ui\.w\.test: slice \[5,1,5,1\] leaves no centre in the 10x8 image/);
		assert.throws(() => A.buildImages({ "ui.h.test": panel({ slice: [1, 4, 1, 4] }) }, []), /leaves no centre/);
		for (const bad of [[-1, 1, 1, 1], [1.5, 1, 1, 1], [1, 1, 1]]) {
			assert.throws(() => A.buildImages({ "ui.n.test": panel({ slice: bad }) }, []), /slice .* must be \[left, top, right, bottom\], integers >= 0/);
		}
		// a centre of exactly 1 x 1 is enough
		const [thin] = A.buildImages({ "ui.thin.test": panel({ slice: [4, 3, 5, 4] }) }, []);
		assert.deepEqual(thin.layout.slice, { left: 4, top: 3, right: 5, bottom: 4 });
		// no slice: no key
		assert.equal("slice" in A.buildImages({ "ui.panel.test": panel() }, [])[0].layout, false);
	});

	it('centre "flat" fills the slice centre with its rounded mean colour; the frame is untouched', () => {
		sheet();
		const [img] = A.buildImages({ "ui.panel.test": panel({ slice: [1, 1, 1, 1], centre: "flat" }) }, []);
		// the 8 x 6 centre: greys 28 + (x + y) % 4 for x 1..8, y 1..6 -> sum / 48, rounded
		let sum = 0;
		for (let y = 1; y <= 6; y++) for (let x = 1; x <= 8; x++) sum += 28 + ((x + y) % 4);
		const mean = Math.floor((2 * sum + 48) / 96);
		for (let y = 1; y <= 6; y++) for (let x = 1; x <= 8; x++) assert.deepEqual(pixel(img.img, x, y), GREY(mean));
		for (const [x, y] of [[0, 0], [9, 0], [0, 7], [9, 7], [4, 0], [0, 3]]) assert.deepEqual(pixel(img.img, x, y), FRAME);
		assert.equal(A.flatFill("t", (() => { const r = A.raster(3, 3); r.data.fill(255); return r; })(), { left: 1, top: 1, right: 1, bottom: 1 })[0], 255);
	});

	it("flatBoxes fill their boxes with one mean, must cover the centre and hold only opaque pixels", () => {
		sheet();
		// a 1 x 1 centre at (4, 3); boxes: the row y 3 and the column x 4 inside the frame (the stretched lines)
		const def = panel({ slice: [4, 3, 5, 4], centre: "flat", flatBoxes: [[1, 3, 8, 1], [4, 1, 1, 6]] });
		const [img] = A.buildImages({ "ui.panel.test": def }, []);
		let sum = 0;
		let n = 0;
		for (let x = 1; x <= 8; x++) (sum += 28 + ((x + 3) % 4)), n++;
		for (let y = 1; y <= 6; y++) if (y !== 3) (sum += 28 + ((4 + y) % 4)), n++;
		const mean = GREY(Math.floor((2 * sum + n) / (2 * n)));
		for (let x = 1; x <= 8; x++) assert.deepEqual(pixel(img.img, x, 3), mean);
		for (let y = 1; y <= 6; y++) assert.deepEqual(pixel(img.img, 4, y), mean);
		assert.deepEqual(pixel(img.img, 1, 1), GREY(30)); // outside the boxes: unchanged
		assert.throws(() => A.buildImages({ "ui.c.test": panel({ slice: [1, 1, 1, 1], centre: "flat", flatBoxes: [[1, 1, 2, 2]] }) }, []), /ui\.c\.test: flatBoxes leave the slice centre's pixel \(3, 1\) unfilled/);
		const clear = A.raster(4, 4);
		for (let i = 0; i < 16; i++) if (i !== 5) clear.data.set(GREY(30), i * 4);
		assert.throws(() => A.flatFill("ui.a.test", clear, { left: 1, top: 1, right: 1, bottom: 1 }), /ui\.a\.test: flat box pixel \(1, 1\) is not opaque/);
		assert.throws(() => A.buildImages({ "ui.s.test": panel({ centre: "flat" }) }, []), /ui\.s\.test: centre "flat" needs a slice/);
		assert.throws(() => A.buildImages({ "ui.b.test": panel({ flatBoxes: [[1, 1, 1, 1]] }) }, []), /ui\.b\.test: flatBoxes needs centre "flat"/);
		assert.throws(() => A.buildImages({ "ui.o.test": panel({ slice: [1, 1, 1, 1], centre: "smear" }) }, []), /centre must be "flat"/);
	});

	it("cutout keeps what a closed outline encloses (a diagonal step still closes) and clears the rest", () => {
		// 9 x 9: a diamond-ish outline of black pixels (8-connected), filled with grey, on a red panel
		const img = A.raster(9, 9);
		for (let i = 0; i < 81; i++) img.data.set([52, 12, 12, 255], i * 4);
		const ring = [[4, 1], [3, 2], [5, 2], [2, 3], [6, 3], [2, 4], [6, 4], [2, 5], [6, 5], [3, 6], [5, 6], [4, 7]];
		for (const [x, y] of ring) put(img, x, y, [0, 0, 0, 255]);
		for (const [x, y] of [[4, 2], [3, 3], [4, 3], [5, 3], [3, 4], [4, 4], [5, 4], [3, 5], [4, 5], [5, 5], [4, 6]]) put(img, x, y, GREY(35));
		A.cutoutPixels(img, 0);
		const kept = [];
		for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) if (alphaAt(img, x, y) > 0) kept.push(`${x},${y}`);
		assert.equal(kept.length, ring.length + 11);
		for (const [x, y] of ring) assert.ok(kept.includes(`${x},${y}`));
		assert.equal(alphaAt(img, 0, 0), 0);
		assert.equal(alphaAt(img, 3, 1), 0); // outside the diagonal step
		// through buildImages, with an explicit [x, y] pivot
		A.sourceCache.set("synthetic/skull.png", (() => {
			const s = A.raster(9, 9);
			s.data.set(img.data);
			for (let i = 0; i < 81; i++) if (s.data[i * 4 + 3] === 0) s.data.set([52, 12, 12, 255], i * 4);
			return s;
		})());
		const def = { file: "synthetic/skull.png", name: "skull", crop: "none", cutout: { outlineRgb: 0 }, pivot: [2, 3] };
		const [skull] = A.buildImages({ "ui.skull.test": def }, []);
		assert.deepEqual(skull.layout, { file: "skull.png", w: 9, h: 9, pivot: { x: 2, y: 3 } });
		assert.equal(alphaAt(skull.img, 0, 0), 0);
		assert.equal(alphaAt(skull.img, 4, 4), 255);
		assert.throws(() => A.buildImages({ "ui.p.test": { ...def, pivot: [10, 3] } }, []), /ui\.p\.test: pivot \[10,3\] must be \[x, y\] inside the 9x9 image/);
		assert.throws(() => A.buildImages({ "ui.k.test": { ...def, cutout: { outlineRgb: 300 } } }, []), /cutout\.outlineRgb must be an integer 0-255/);
	});

	it("mask: white on transparent where the pixels are dark enough inside the boxes, same size as the cut", () => {
		sheet();
		const src = A.sourceCache.get("synthetic/sheet.png");
		// two "sockets" in the panel, one outside the box
		put(src, 6, 7, [0, 0, 0, 255]);
		put(src, 7, 7, [0, 0, 0, 255]);
		put(src, 11, 9, [0, 0, 0, 255]);
		const [back, eyes] = quiet(() =>
			A.buildImages({ "ui.back.test": panel({ slice: [4, 3, 5, 4] }), "ui.back.test.eyes": panel({ slice: [4, 3, 5, 4], mask: { maxRgb: 0, boxes: [[0, 0, 5, 8]] } }) }, []),
		);
		assert.deepEqual([eyes.layout.w, eyes.layout.h, eyes.layout.slice], [back.layout.w, back.layout.h, back.layout.slice]);
		const white = [];
		for (let y = 0; y < eyes.img.h; y++) for (let x = 0; x < eyes.img.w; x++) if (alphaAt(eyes.img, x, y) > 0) white.push(`${x},${y}`);
		assert.deepEqual(white, ["2,2", "3,2"]); // (6, 7) and (7, 7) on the sheet; (11, 9) is outside the box
		assert.deepEqual(pixel(eyes.img, 2, 2), [255, 255, 255, 255]);
		// without boxes: every dark pixel
		const [all] = A.buildImages({ "ui.all.test": panel({ mask: { maxRgb: 0 } }) }, []);
		assert.equal(all.img.data.filter((v, i) => i % 4 === 3 && v > 0).length, 3);
		assert.throws(() => A.buildImages({ "ui.m.test": panel({ slice: [1, 1, 1, 1], centre: "flat", mask: { maxRgb: 0 } }) }, []), /ui\.m\.test: a mask has no centre to flatten/);
		assert.throws(() => A.buildImages({ "ui.m.test": panel({ mask: { maxRgb: 0, boxes: [[0, 0, 11, 1]] } }) }, []), /mask box \[0,0,11,1\] must be/);
		// deterministic
		const [again] = A.buildImages({ "ui.back.test.eyes": panel({ slice: [4, 3, 5, 4], mask: { maxRgb: 0, boxes: [[0, 0, 5, 8]] } }) }, []);
		assert.equal(Buffer.compare(A.encodePng(again.img), A.encodePng(eyes.img)), 0);
	});
});

describe("UI art pieces and the icon atlas (docs/UI_ART.md UA2, UA3)", () => {
	const fs = require("node:fs");
	const path = require("node:path");
	const pixel = (img, x, y) => Array.from(img.data.slice((y * img.w + x) * 4, (y * img.w + x) * 4 + 4));
	// The ToffeeCraft Horror UI sheet is 1024 x 607 (docs/UI_ART.md "The source"); the tests never read it.
	const SHEET = { file: "toffeecraft-horror-ui/UiHorror.png", w: 1024, h: 607 };
	const config = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "art", "atlases.json"), "utf8"));
	const SLICED = ["ui.panel.menu", "ui.panel.hud", "ui.panel.tall", "ui.button", "ui.button.focus", "ui.button.disabled", "ui.option.on", "ui.option.off", "ui.bar.track", "ui.bar.fill", "ui.slot.pair", "ui.slot"];
	const ICONS = [
		"ui.ornament.bones", "ui.focus.corner", "ui.chip", "ui.chip.white", "ui.heart.full", "ui.heart.half", "ui.heart.empty", "ui.flask.full", "ui.flask.empty",
		"ui.candle", "ui.caret", "ui.divider", "ui.stick.ring", "ui.touch.button", "ui.icon.pause", "ui.icon.check", "ui.icon.cross", "ui.icon.help", "ui.icon.gear",
		"ui.icon.home", "ui.icon.speaker", "ui.icon.mute", "ui.icon.coin", "ui.icon.skull", "ui.icon.skull.curse", "ui.icon.ghost", "ui.icon.rip",
	];

	it("art/atlases.json: every sliced piece and icon is there, cut from the sheet by a rect inside it", () => {
		const inside = (r) => Array.isArray(r) && r.length === 4 && r.every(Number.isInteger) && r[0] >= 0 && r[1] >= 0 && r[2] >= 1 && r[3] >= 1 && r[0] + r[2] <= SHEET.w && r[1] + r[3] <= SHEET.h;
		for (const id of SLICED) {
			const def = config.images[id];
			assert.ok(def, `${id} is in images`);
			assert.equal(def.file, SHEET.file, id);
			assert.ok(inside(def.rect), `${id}: rect ${JSON.stringify(def.rect)} inside the sheet`);
			assert.ok(typeof def.$comment === "string" && def.$comment.length > 0, `${id} explains its slice`);
			// the cut is at most the rect (crop alpha trims it), so the slice must leave a centre in the rect already
			const [l, t, r, b] = def.slice;
			assert.ok(l + r < def.rect[2] && t + b < def.rect[3], `${id}: slice ${def.slice} leaves a centre in the ${def.rect[2]}x${def.rect[3]} rect`);
		}
		assert.deepEqual(Object.keys(config.uiIcons.icons).filter((k) => k !== "$comment").sort(), [...ICONS].sort());
		for (const id of ICONS) {
			const def = config.uiIcons.icons[id];
			assert.ok(inside(def.rect), `${id}: rect ${JSON.stringify(def.rect)} inside the sheet`);
			assert.ok(typeof def.$comment === "string" && def.$comment.length > 0, `${id} notes its pick`);
			assert.equal(def.file === undefined ? config.uiIcons.file : def.file, SHEET.file, id);
		}
		// the icon atlas reads the sheet the lock already lists
		assert.ok(A.sourceFiles(config).includes(SHEET.file));
		const lock = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "art", "vendor.lock.json"), "utf8"));
		assert.ok(lock.files.some((f) => f.path === SHEET.file));
	});

	it("slice insets of 0 are allowed (a bar sliced horizontally only); the centre must stay >= 1 px", () => {
		const img = A.raster(12, 4);
		img.data.fill(255);
		A.sourceCache.set("synthetic/bar.png", img);
		const def = { file: "synthetic/bar.png", name: "bar", crop: "none", slice: [5, 0, 6, 0] };
		const [bar] = A.buildImages({ "ui.bar.test": def }, []);
		assert.deepEqual(bar.layout.slice, { left: 5, top: 0, right: 6, bottom: 0 });
		assert.throws(() => A.buildImages({ "ui.bar.test": { ...def, slice: [6, 0, 6, 0] } }, []), /leaves no centre in the 12x4 image/);
	});

	it('rgb "white" keeps the alpha and whitens every pixel; "grey" is the luminance; clearRgb clears exact colours', () => {
		const src = A.raster(3, 2);
		put(src, 0, 0, [200, 40, 10, 255]);
		put(src, 1, 0, [10, 200, 40, 120]);
		put(src, 2, 0, [18, 0, 0, 255]); // the backdrop colour
		put(src, 0, 1, [68, 21, 21, 255]);
		put(src, 1, 1, [18, 0, 0, 7]); // the backdrop colour, any alpha
		A.sourceCache.set("synthetic/rgb.png", src);
		const def = { file: "synthetic/rgb.png", name: "rgb", crop: "none" };
		const [white] = A.buildImages({ "ui.white.test": { ...def, rgb: "white" } }, []);
		for (let i = 0; i < 6; i++) {
			assert.equal(white.img.data[i * 4 + 3], src.data[i * 4 + 3], "alpha kept");
			assert.deepEqual(Array.from(white.img.data.slice(i * 4, i * 4 + 3)), [255, 255, 255]);
		}
		const [grey] = A.buildImages({ "ui.grey.test": { ...def, rgb: "grey" } }, []);
		assert.deepEqual(pixel(grey.img, 0, 1), [35, 35, 35, 255]); // (299 * 68 + 587 * 21 + 114 * 21 + 500) / 1000
		assert.deepEqual(pixel(grey.img, 0, 0), [Math.floor((299 * 200 + 587 * 40 + 114 * 10 + 500) / 1000), Math.floor((299 * 200 + 587 * 40 + 114 * 10 + 500) / 1000), Math.floor((299 * 200 + 587 * 40 + 114 * 10 + 500) / 1000), 255]);
		const [cleared] = A.buildImages({ "ui.clear.test": { ...def, clearRgb: ["#120000"] } }, []);
		assert.equal(alphaAt(cleared.img, 2, 0), 0);
		assert.equal(alphaAt(cleared.img, 1, 1), 0);
		assert.deepEqual(pixel(cleared.img, 0, 0), [200, 40, 10, 255]);
		assert.throws(() => A.buildImages({ "ui.bad.test": { ...def, rgb: "pink" } }, []), /ui\.bad\.test: rgb must be "white" or "grey"/);
		assert.throws(() => A.buildImages({ "ui.bad.test": { ...def, clearRgb: ["120000"] } }, []), /clearRgb must be a non-empty list of "#rrggbb" colours/);
		assert.throws(() => A.buildImages({ "ui.bad.test": { ...def, clearRgb: [] } }, []), /clearRgb must be a non-empty list/);
	});

	it("nineSlice keeps the corners and stretches the edges and centre; the slice contact sheet builds", () => {
		// 5 x 5: a distinct colour per pixel; insets 2 / 2 / 2 / 2 leave the 1 x 1 centre (2, 2)
		const img = A.raster(5, 5);
		for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) put(img, x, y, [x * 40, y * 40, 7, 255]);
		const out = A.nineSlice(img, { left: 2, top: 2, right: 2, bottom: 2 }, 9, 7);
		for (const [x, y, sx, sy] of [[0, 0, 0, 0], [1, 1, 1, 1], [8, 6, 4, 4], [7, 0, 3, 0], [0, 5, 0, 3], [4, 3, 2, 2], [2, 4, 2, 2], [6, 2, 2, 2]]) {
			assert.deepEqual(pixel(out, x, y), pixel(img, sx, sy), `(${x}, ${y}) <- (${sx}, ${sy})`);
		}
		assert.throws(() => A.nineSlice(img, { left: 2, top: 2, right: 2, bottom: 2 }, 4, 7), /smaller than the fixed insets/);
		const sheet = A.sliceContact({ img, layout: { slice: { left: 2, top: 2, right: 2, bottom: 2 } } });
		assert.ok(sheet.w > 5 * 4 && sheet.h >= 5 * 4);
	});

	// Synthetic sheet: icons of assorted sizes, each pixel's colour encoding its piece and position.
	const ICON_SIZES = [[8, 12], [18, 15], [18, 15], [10, 10], [48, 3], [39, 39], [14, 14], [5, 6], [28, 29], [7, 8], [44, 59], [43, 42], [89, 13], [11, 10], [1, 1]];
	const iconSheet = () => {
		const img = A.raster(256, 256);
		const icons = {};
		let x = 0;
		let y = 0;
		let rowH = 0;
		ICON_SIZES.forEach(([w, h], n) => {
			if (x + w + 1 > 256) {
				x = 0;
				y += rowH + 1;
				rowH = 0;
			}
			for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) put(img, x + xx, y + yy, [n * 16, (xx * 5) % 256, (yy * 5) % 256, xx === 0 ? 128 : 255]);
			icons[`ui.t${String(n).padStart(2, "0")}`] = { rect: [x, y, w, h] };
			x += w + 1;
			rowH = Math.max(rowH, h);
		});
		A.sourceCache.set("synthetic/icons.png", img);
		return { img, icons };
	};
	const section = (icons, extra) => ({ atlas: "ui-icons-test", file: "synthetic/icons.png", gutter: 1, icons, ...extra });

	it("packs every icon with its gutter inside the atlas, no two overlapping, deterministically", () => {
		const { icons } = iconSheet();
		const built = A.buildUiIcons(section(icons));
		assert.ok(built.w <= A.MAX_ATLAS && built.h <= A.MAX_ATLAS);
		assert.deepEqual([built.img.w, built.img.h], [built.w, built.h]);
		const ids = Object.keys(icons).sort();
		assert.deepEqual(Object.keys(built.rects).sort(), ids);
		const grown = ids.map((id) => {
			const r = built.rects[id];
			const [, , w, h] = icons[id].rect;
			assert.deepEqual([r.w, r.h], [w, h], `${id} keeps its size`);
			return { id, x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 };
		});
		for (const g of grown) assert.ok(g.x >= 0 && g.y >= 0 && g.x + g.w <= built.w && g.y + g.h <= built.h, `${g.id} with its gutter is inside the atlas`);
		for (let i = 0; i < grown.length; i++) {
			for (let j = i + 1; j < grown.length; j++) {
				const a = grown[i];
				const b = grown[j];
				assert.ok(a.x >= b.x + b.w || b.x >= a.x + a.w || a.y >= b.y + b.h || b.y >= a.y + a.h, `${a.id} and ${b.id} (with gutters) overlap`);
			}
		}
		// the area used is at least the pieces' and the result is the same every time
		const area = grown.reduce((n, g) => n + g.w * g.h, 0);
		assert.ok(built.w * built.h >= area);
		const again = A.buildUiIcons(section(icons));
		assert.deepEqual(again.rects, built.rects);
		assert.equal(Buffer.compare(A.encodePng(again.img), A.encodePng(built.img)), 0);
	});

	it("copies each piece's pixels into its rect and extrudes its edge pixels into the gutter", () => {
		const { img: src, icons } = iconSheet();
		const built = A.buildUiIcons(section(icons));
		for (const id of Object.keys(icons)) {
			const [sx, sy, w, h] = icons[id].rect;
			const r = built.rects[id];
			for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) assert.deepEqual(pixel(built.img, r.x + x, r.y + y), pixel(src, sx + x, sy + y), `${id} (${x}, ${y})`);
			for (let y = -1; y <= h; y++) {
				for (let x = -1; x <= w; x++) {
					if (x >= 0 && x < w && y >= 0 && y < h) continue;
					const ex = Math.min(Math.max(x, 0), w - 1);
					const ey = Math.min(Math.max(y, 0), h - 1);
					assert.deepEqual(pixel(built.img, r.x + x, r.y + y), pixel(built.img, r.x + ex, r.y + ey), `${id} gutter (${x}, ${y}) = its edge pixel (${ex}, ${ey})`);
				}
			}
		}
		// extrudeGutter alone: a 2 x 2 piece in a 6 x 6 raster, gutter 2
		const r = A.raster(6, 6);
		put(r, 2, 2, [1, 0, 0, 255]);
		put(r, 3, 2, [2, 0, 0, 255]);
		put(r, 2, 3, [3, 0, 0, 255]);
		put(r, 3, 3, [4, 0, 0, 0]);
		A.extrudeGutter(r, { x: 2, y: 2, w: 2, h: 2 }, 2);
		assert.deepEqual(pixel(r, 0, 0), [1, 0, 0, 255]);
		assert.deepEqual(pixel(r, 5, 0), [2, 0, 0, 255]);
		assert.deepEqual(pixel(r, 0, 5), [3, 0, 0, 255]);
		assert.deepEqual(pixel(r, 5, 4), [4, 0, 0, 0]);
	});

	it("white copies are white with the alpha kept; pivots, crop alpha and cutout pass through", () => {
		const { img: src, icons } = iconSheet();
		const id = "ui.t03";
		const [sx, sy, w, h] = icons[id].rect;
		const built = A.buildUiIcons(section({ ...icons, "ui.t03.white": { rect: icons[id].rect, rgb: "white", pivot: [5, 4] } }));
		const r = built.rects["ui.t03.white"];
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				const p = pixel(built.img, r.x + x, r.y + y);
				assert.deepEqual(p, [255, 255, 255, src.data[((sy + y) * src.w + sx + x) * 4 + 3]]);
			}
		}
		assert.deepEqual(built.layouts["ui.t03.white"], { rect: r, pivot: { x: 5, y: 4 } });
		assert.deepEqual(built.layouts[id], { rect: built.rects[id] });
		// crop alpha trims a window to the piece (the 1 x 1 icon from a 5 x 5 window around it)
		const [ox, oy] = icons["ui.t14"].rect;
		const tight = A.buildUiIcons(section({ "ui.one": { rect: [Math.max(0, ox - 2), oy, 3, 3], crop: "alpha", noiseAlpha: 0 } }));
		assert.ok(tight.rects["ui.one"].w <= 3 && tight.rects["ui.one"].h <= 3);
	});

	it("rejects an unknown key, a missing rect or file, a non-ui id and a bad gutter", () => {
		const { icons } = iconSheet();
		const one = { "ui.t00": icons["ui.t00"] };
		assert.throws(() => A.buildUiIcons(section({ "ui.x": { rect: [0, 0, 2, 2], slice: [0, 0, 0, 0] } })), /ui\.x: unknown ui icon key slice/);
		assert.throws(() => A.buildUiIcons(section({ "ui.x": {} })), /ui\.x: a ui icon needs a rect/);
		assert.throws(() => A.buildUiIcons(section({ "boost.x": { rect: [0, 0, 2, 2] } })), /boost\.x: ui icon ids start with "ui\."/);
		assert.throws(() => A.buildUiIcons(section(one, { file: undefined })), /ui\.t00: a ui icon needs a file/);
		assert.throws(() => A.buildUiIcons(section(one, { gutter: 0 })), /uiIcons\.gutter must be an integer >= 1/);
		assert.throws(() => A.buildUiIcons(section({ "ui.x": { rect: [250, 250, 10, 10] } })), /ui\.x: rect \[250,250,10,10\] must be/);
		assert.throws(() => A.buildUiIcons(section(one, { maxSize: 10 })), /do not fit one 10x10 atlas/);
		// sourceFiles lists the section's file (and an icon's own)
		const files = A.sourceFiles({ spriteSets: {}, images: {}, uiIcons: section({ ...one, "ui.y": { rect: [0, 0, 1, 1], file: "other/x.png" } }) });
		assert.deepEqual(files, ["other/x.png", "synthetic/icons.png"]);
	});

	it("uiIconLayout.ts has the fixed shape and matches the packed result, sorted by id", () => {
		const { icons } = iconSheet();
		const built = A.buildUiIcons(section({ ...icons, "ui.t01": { ...icons["ui.t01"], pivot: [3, 6] } }));
		const text = A.uiIconLayoutModule(built);
		const lines = text.split("\n");
		assert.deepEqual(lines.slice(0, 12), [
			"/** Generated by `npm run art:build` from art/atlases.json `uiIcons` (docs/UI_ART.md UA3). Do not edit. */",
			"export interface ValeUiIconLayout {",
			"\t/** The piece's rect in the icon atlas, pixels (gutter excluded). */",
			"\treadonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };",
			"\t/** Optional anchor point, pixels from the rect's top-left. */",
			"\treadonly pivot?: { readonly x: number; readonly y: number };",
			"}",
			"/** The atlas file name (the key of its id in assetIds.ts). */",
			'export const VALE_UI_ICON_FILE = "ui-icons-test.png";',
			"/** The atlas size, pixels. */",
			`export const VALE_UI_ICON_ATLAS = { w: ${built.w}, h: ${built.h} } as const;`,
			"export const VALE_UI_ICONS: Record<string, ValeUiIconLayout> = {",
		]);
		const entries = lines.slice(12, -2);
		assert.deepEqual(lines.slice(-2), ["};", ""]);
		const parsed = {};
		for (const line of entries) {
			const m = /^\t"([^"]+)": \{ rect: \{ x: (\d+), y: (\d+), w: (\d+), h: (\d+) \}(?:, pivot: \{ x: ([\d.]+), y: ([\d.]+) \})? \},$/.exec(line);
			assert.ok(m, `entry line: ${line}`);
			parsed[m[1]] = { rect: { x: +m[2], y: +m[3], w: +m[4], h: +m[5] }, ...(m[6] === undefined ? {} : { pivot: { x: +m[6], y: +m[7] } }) };
		}
		assert.deepEqual(Object.keys(parsed), Object.keys(built.layouts).sort());
		assert.deepEqual(parsed, built.layouts);
		assert.deepEqual(parsed["ui.t01"].pivot, { x: 3, y: 6 });
		for (const id of Object.keys(parsed)) assert.deepEqual(parsed[id].rect, built.rects[id]);
		// the contact sheet reads back through the layout
		const contact = A.uiIconContact(built);
		assert.ok(contact.w >= built.w * 4 && contact.h > built.h * 4);
	});

	it("maxRectsFit: best short side fit, ties by y then x; null when nothing fits", () => {
		const free = [{ x: 10, y: 0, w: 5, h: 9 }, { x: 0, y: 5, w: 6, h: 6 }, { x: 0, y: 0, w: 5, h: 5 }];
		assert.deepEqual(A.maxRectsFit(free, 5, 5), { f: free[2], score: 0 });
		// 4 x 4: score 1 at (10, 0) and (0, 0), 2 at (0, 5); the tie goes to the lower y, then the lower x
		assert.deepEqual(A.maxRectsFit(free, 4, 4).f, free[2]);
		assert.equal(A.maxRectsFit(free, 7, 1), null);
	});
});

describe("world sprite sets with `own` (docs/BREAKABLE_DROPS.md, the loot glint)", () => {
	/** A synthetic world sprite piece: `n` cells of w x h, each with one lit pixel. */
	function spritePiece(name, n, w, h, own) {
		const cells = [];
		for (let k = 0; k < n; k++) {
			const img = A.raster(w, h);
			put(img, k % w, 0, LIT);
			cells.push({ img });
		}
		return {
			name,
			kind: "sprites",
			frameW: w,
			frameH: h,
			pivot: { x: 1, y: 1 },
			pixelsPerTile: 29.6,
			facings: { count: 1, zeroDeg: 0, ccw: true },
			dirs: ["E"],
			animations: { idle: { start: 0, frames: n, fps: 12, loop: true } },
			cells,
			own,
		};
	}
	const world = { atlas: { name: "decor-atlas", maxSize: 64 } };

	it("packs the own set into its own sheet and leaves the shared atlas byte-identical", () => {
		const shared = () => [spritePiece("glint", 8, 6, 5), spritePiece("zone", 3, 10, 10)];
		const before = A.packWorldAtlases(world, shared());
		const after = A.packWorldAtlases(world, [...shared(), spritePiece("lootglint", 8, 7, 7, "loot-glint")]);
		assert.equal(after.atlases.length, before.atlases.length + 1);
		const a0 = before.atlases[0];
		const b0 = after.atlases[0];
		assert.equal(b0.file, "decor-atlas.png");
		assert.equal(b0.img.w, a0.img.w);
		assert.equal(b0.img.h, a0.img.h);
		assert.deepEqual(Buffer.from(b0.img.data), Buffer.from(a0.img.data));
		const own = after.atlases[after.atlases.length - 1];
		assert.equal(own.file, "loot-glint.png");
		// one row, as wide as its cells (8 x 7 = 56 <= 64), as tall as one cell
		assert.equal(own.img.w, 56);
		assert.equal(own.img.h, 7);
	});

	it("wraps an own set wider than maxSize onto more rows, and its layout names its own sheet", () => {
		const packed = A.packWorldAtlases(world, [spritePiece("lootglint", 12, 7, 7, "loot-glint")]);
		const own = packed.atlases.find((a) => a.file === "loot-glint.png");
		assert.ok(own);
		// 64 / 7 = 9 cells per row: 12 cells -> 2 rows
		assert.equal(own.img.w, 64);
		assert.equal(own.img.h, 14);
		const piece = own.items[0];
		const l = A.worldLayout(piece);
		assert.equal(l.kind, "sprites");
		assert.deepEqual(l.sheets, [{ file: "loot-glint.png", w: own.img.w, h: own.img.h }]);
		assert.deepEqual(l.animations.idle, { sheet: 0, start: 0, frames: 12, fps: 12, loop: true });
	});
});

describe("recolor (a gradient map by luminance; docs/FORTUNE.md FO10, the Goldling)", () => {
	const RAMP = [
		[0, "#000000"],
		[100, "#804000"],
		[255, "#ffff00"],
	];
	const lutAt = (lut, l) => [lut[l * 3], lut[l * 3 + 1], lut[l * 3 + 2]];

	it("recolorLut: absent is null; every stop is its colour exactly; between stops linear, rounded half up", () => {
		assert.equal(A.recolorLut("t", undefined), null);
		const lut = A.recolorLut("t", { ramp: RAMP });
		assert.equal(lut.length, 768);
		assert.deepEqual(lutAt(lut, 0), [0, 0, 0]);
		assert.deepEqual(lutAt(lut, 100), [0x80, 0x40, 0]);
		assert.deepEqual(lutAt(lut, 255), [255, 255, 0]);
		// 50 of 0..100: half of 128 / 64; 1: 1.28 -> 1, 0.64 -> 1 (round half up); 184 of 100..255: 128 + 127 * 84 / 155
		assert.deepEqual(lutAt(lut, 50), [64, 32, 0]);
		assert.deepEqual(lutAt(lut, 1), [1, 1, 0]);
		assert.deepEqual(lutAt(lut, 184), [197, 168, 0]);
		// a falling channel rounds the same way: 255 -> 0 over 0..255 is 255 - l
		const down = A.recolorLut("t", { ramp: [[0, "#ffffff"], [255, "#000000"]], $note: "comments are allowed" });
		for (let l = 0; l < 256; l++) assert.deepEqual(lutAt(down, l), [255 - l, 255 - l, 255 - l]);
	});

	it("recolorLut refuses a malformed recolor", () => {
		const bad = (recolor, re) => assert.throws(() => A.recolorLut("enemy.t", recolor), re);
		bad(null, /enemy\.t: recolor must be an object/);
		bad([RAMP], /must be an object/);
		bad({ ramp: RAMP, stretch: true }, /\.stretch: unknown key/);
		bad({}, /at least two stops/);
		bad({ ramp: [[0, "#000000"]] }, /at least two stops/);
		bad({ ramp: [[0, "#000000"], [255, "#fff"]] }, /ramp\[1\] must be/);
		bad({ ramp: [[0, "#000000"], [256, "#ffffff"]] }, /ramp\[1\] must be/);
		bad({ ramp: [[0, "#000000"], [10.5, "#808080"], [255, "#ffffff"]] }, /ramp\[1\] must be/);
		bad({ ramp: [[0, "#000000"], [80, "#808080"], [80, "#909090"], [255, "#ffffff"]] }, /strictly increase/);
		bad({ ramp: [[5, "#000000"], [255, "#ffffff"]] }, /from luminance 0 to 255/);
		bad({ ramp: [[0, "#000000"], [200, "#ffffff"]] }, /from luminance 0 to 255/);
	});

	it("recolorRegion: RGB from the lookup at the rounded Rec. 601 luminance, alpha kept, the source untouched", () => {
		const lut = A.recolorLut("t", { ramp: RAMP });
		const src = A.raster(4, 2);
		put(src, 1, 0, LIT); // luminance (299 * 200 + 587 * 180 + 114 * 160) / 1000 = 184.2 -> 184
		put(src, 2, 0, SHADOW); // black stays black, alpha 120 kept
		put(src, 3, 1, [10, 250, 30, 7]); // 2.99 + 146.75 + 3.42 = 153.16 -> 153, even at alpha 7
		const before = [...src.data];
		const r = A.recolorRegion({ img: src, x: 1, y: 0, w: 4, h: 2 }, lut);
		assert.deepEqual([r.x, r.y, r.w, r.h, r.img.w, r.img.h], [0, 0, 4, 2, 4, 2]);
		assert.deepEqual(rgbaAt(r.img, 0, 0), [...lutAt(lut, 184), 255]);
		assert.deepEqual(rgbaAt(r.img, 1, 0), [0, 0, 0, 120]);
		assert.deepEqual(rgbaAt(r.img, 2, 1), [...lutAt(lut, 153), 7]);
		assert.deepEqual(rgbaAt(r.img, 3, 0), [0, 0, 0, 0]); // outside the source: clear
		assert.deepEqual([...src.data], before);
	});

	it("buildSpriteSet: same cells, pivot, density and alpha as the uncoloured set; body RGB mapped; the rim traced the same way", () => {
		const plain = A.buildSpriteSet("enemy.plain", syntheticSet("recolor", { outline: { widthPx: 2 } }));
		const gold = A.buildSpriteSet("enemy.gold", syntheticSet("recolor", { outline: { widthPx: 2 }, recolor: { ramp: RAMP } }));
		assert.deepEqual(gold.layout, plain.layout);
		assert.deepEqual(gold.box, plain.box);
		assert.deepEqual([gold.recolorStops, plain.recolorStops], [3, 0]);
		const [g] = gold.sheets;
		const [p] = plain.sheets;
		const lut = A.recolorLut("t", { ramp: RAMP });
		for (let i = 0; i < g.img.w * g.img.h; i++) {
			const a = p.img.data[i * 4 + 3];
			assert.equal(g.img.data[i * 4 + 3], a);
			if (a === 0) continue; // bled, not drawn
			const rgb = [...p.img.data.subarray(i * 4, i * 4 + 3)];
			const l = Math.floor((299 * rgb[0] + 587 * rgb[1] + 114 * rgb[2] + 500) / 1000);
			assert.deepEqual([...g.img.data.subarray(i * 4, i * 4 + 3)], lutAt(lut, l));
		}
		// the ramp keeps the black shadow black, so the body mask and the rim are the plain set's
		assert.deepEqual(g.outlineImg.data, p.outlineImg.data);
		assert.deepEqual(g.outlineImg.data, A.outlineSheet(g.img, gold.layout.frameW, gold.layout.frameH, 2, 64, 8).data);
	});

	it("buildSpriteSet refuses a malformed recolor before reading a file", () => {
		assert.throws(() => A.buildSpriteSet("enemy.bad", syntheticSet("recolorbad", { recolor: { ramp: [[0, "#000000"]] } })), /enemy\.bad: recolor ramp/);
	});
});

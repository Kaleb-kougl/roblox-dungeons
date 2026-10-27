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

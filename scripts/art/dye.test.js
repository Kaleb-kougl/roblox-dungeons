// Specs for the dye sheets (docs/COSMETICS.md CS1-CS2): the `dye` config, the colour rule's maths (Rec. 601 luminance,
// colorsys HLS), the opening / regrowth / area cut, `exclude`, the set-wide normalisation, the sheet's alignment with
// the body sheet, the layout fields, and the body / outline outputs unchanged by adding a dye. Synthetic rasters only.
"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const A = require("./build-atlases.js");

function put(img, x, y, rgba) {
	img.data.set(rgba, (y * img.w + x) * 4);
}

/** Pixel coordinates "x,y" where a w-wide mask is set, sorted. */
function setPixels(mask, w) {
	const out = [];
	for (let i = 0; i < mask.length; i++) if (mask[i]) out.push(`${i % w},${Math.floor(i / w)}`);
	return out.sort();
}

/** A mask from rows of "#" / "." */
function maskOf(rows) {
	const w = rows[0].length;
	const m = new Uint8Array(w * rows.length);
	rows.forEach((r, y) => [...r].forEach((c, x) => (m[y * w + x] = c === "#" ? 1 : 0)));
	return { m, w, h: rows.length };
}

/** A set with just what dyeConfig reads. */
function bare(dye) {
	return { facingCount: 8, animations: { idle: { frames: [0, 1, 3] }, run: { frames: [0, 2] }, alias: { cellsOf: "idle" } }, dye };
}

const RULE = { alphaMin: 240, minRgb: 8 };

describe("dyeConfig", () => {
	it("is null without a dye and normalises a full one", () => {
		assert.equal(A.dyeConfig("s", bare(undefined)), null);
		const c = A.dyeConfig(
			"s",
			bare({
				$comment: "x",
				rule: { ...RULE, satMax: 0.1, lumMin: 88, hue: [[0, 55], [340, 360]] },
				unless: [{ lumMin: 130, hue: [[180, 360]] }],
				open: { sizePx: 3, regrowPx: 1 },
				minAreaPx: 20,
				normalizePercentile: 98,
				exclude: [{ animations: ["run"], facings: [2], frames: [1], rect: [1, 2, 3, 4] }],
			}),
		);
		assert.deepEqual(c, {
			rule: { alphaMin: 240, minRgb: 8, satMax: 0.1, lumMin: 88, hue: [[0, 55], [340, 360]] },
			unless: [{ lumMin: 130, hue: [[180, 360]] }],
			open: { sizePx: 3, regrowPx: 1 },
			minAreaPx: 20,
			normalizePercentile: 98,
			exclude: [{ animations: ["run"], facings: [2], frames: [1], rect: { x: 1, y: 2, w: 3, h: 4 } }],
		});
		assert.deepEqual(A.dyeConfig("s", bare({ rule: RULE, normalizePercentile: 50 })), { rule: RULE, unless: [], open: null, minAreaPx: 0, normalizePercentile: 50, exclude: [] });
	});

	it("throws on unknown keys at every level", () => {
		const base = { rule: RULE, normalizePercentile: 98 };
		assert.throws(() => A.dyeConfig("class.x", bare({ ...base, colour: "red" })), /class\.x: dye\.colour: unknown key/);
		assert.throws(() => A.dyeConfig("s", bare({ ...base, rule: { ...RULE, chroma: 1 } })), /dye\.rule\.chroma: unknown key/);
		assert.throws(() => A.dyeConfig("s", bare({ ...base, unless: [{ lumMin: 1, x: 1 }] })), /dye\.unless\[0\]\.x: unknown key/);
		assert.throws(() => A.dyeConfig("s", bare({ ...base, open: { sizePx: 3, iterations: 1 } })), /dye\.open\.iterations: unknown key/);
		assert.throws(() => A.dyeConfig("s", bare({ ...base, exclude: [{ rect: [0, 0, 1, 1], cell: 2 }] })), /dye\.exclude\[0\]\.cell: unknown key/);
	});

	it("throws on missing or out-of-range values", () => {
		const base = { rule: RULE, normalizePercentile: 98 };
		const bad = [
			[{ ...base, rule: { minRgb: 8 } }, /rule\.alphaMin must be an integer in \[0, 254\]/],
			[{ ...base, rule: { ...RULE, satMax: 1.5 } }, /rule\.satMax must be a number in \[0, 1\]/],
			[{ ...base, rule: { ...RULE, satMin: 0.3, satMax: 0.2 } }, /satMin 0\.3 must be below satMax 0\.2/],
			[{ ...base, rule: { ...RULE, lumMin: 90, lumMax: 80 } }, /lumMin 90 is above lumMax 80/],
			[{ ...base, rule: { ...RULE, lumMax: 256 } }, /rule\.lumMax must be an integer in \[0, 255\]/],
			[{ ...base, rule: { ...RULE, hue: [] } }, /rule\.hue must be a non-empty list/],
			[{ ...base, rule: { ...RULE, hue: [[55, 0]] } }, /rule\.hue\[0\]: from 55 must be below to 0/],
			[{ ...base, rule: { ...RULE, hue: [[0, 400]] } }, /rule\.hue\[0\]\[1\] must be a number in \[0, 360\]/],
			[{ ...base, unless: [{}] }, /unless\[0\] has no bound/],
			[{ ...base, unless: {} }, /unless must be a list/],
			[{ ...base, open: { sizePx: 1 } }, /open\.sizePx must be an integer in \[2, 8\]/],
			[{ ...base, open: { sizePx: 3, regrowPx: -1 } }, /open\.regrowPx must be an integer/],
			[{ ...base, minAreaPx: 0 }, /minAreaPx must be an integer/],
			[{ rule: RULE }, /normalizePercentile must be a number in \[0, 100\]/],
			[{ ...base, normalizePercentile: 0 }, /normalizePercentile must be above 0/],
			[{ ...base, exclude: [{ rect: [0, 0, 0, 1] }] }, /exclude\[0\]\.rect\[2\] must be an integer/],
			[{ ...base, exclude: [{ rect: [0, 0, 1] }] }, /exclude\[0\]\.rect must be \[x, y, w, h\]/],
			[{ ...base, exclude: [{ animations: ["alias"], rect: [0, 0, 1, 1] }] }, /"alias" is not a real animation/],
			[{ ...base, exclude: [{ facings: [8], rect: [0, 0, 1, 1] }] }, /exclude\[0\]\.facings\[0\] must be an integer in \[0, 7\]/],
			[{ ...base, exclude: [{ animations: ["run"], frames: [2], rect: [0, 0, 1, 1] }] }, /frames\[0\] \(kept frame index\) must be an integer in \[0, 1\]/],
			[2, /dye must be an object/],
		];
		for (const [dye, re] of bad) assert.throws(() => A.dyeConfig("s", bare(dye)), re, JSON.stringify(dye));
	});
});

describe("hlsSatHue", () => {
	it("matches Python's colorsys.rgb_to_hls (to 1e-12)", () => {
		// expected values from colorsys (saturation, hue x 360)
		const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} vs ${b}`); // colorsys works on r / 255: last bits differ
		const cases = [
			[[30, 17, 6], 0.6666666666666666, 27.500000000000004],
			[[112, 104, 104], 0.037037037037037035, 0],
			[[107, 99, 100], 0.038834951456310676, 352.5],
			[[202, 196, 203], 0.06306306306306282, 291.4285714285714],
			[[184, 182, 178], 0.04054054054054059, 40.0000000000001],
			[[0, 0, 255], 1, 240],
			[[200, 255, 0], 1, 72.94117647058825],
		];
		for (const [rgb, sat, hue] of cases) {
			const r = A.hlsSatHue(...rgb);
			near(r.sat, sat);
			near(r.hue, hue);
		}
		assert.deepEqual(A.hlsSatHue(90, 90, 90), { sat: 0, hue: 0 });
	});
});

describe("dyeRuleAt", () => {
	const at = (rule, rgba) => A.dyeRuleAt(rule, Uint8Array.from(rgba), 0);
	it("cuts on alpha and the darkest pixels (strictly above alphaMin / minRgb)", () => {
		assert.equal(at(RULE, [100, 100, 100, 241]), true);
		assert.equal(at(RULE, [100, 100, 100, 240]), false); // the baked shadow's alphas
		assert.equal(at(RULE, [8, 8, 8, 255]), false);
		assert.equal(at(RULE, [9, 0, 0, 255]), true);
	});
	it("bounds the Rec. 601 luminance inclusively", () => {
		// luminance of (88, 88, 88) = 88; of (100, 80, 60) = round(29.9 + 46.96 + 6.84) = 84
		assert.equal(at({ ...RULE, lumMin: 88 }, [88, 88, 88, 255]), true);
		assert.equal(at({ ...RULE, lumMin: 88 }, [87, 87, 87, 255]), false);
		assert.equal(at({ ...RULE, lumMax: 84 }, [100, 80, 60, 255]), true);
		assert.equal(at({ ...RULE, lumMax: 83 }, [100, 80, 60, 255]), false);
	});
	it("bounds saturation as [satMin, satMax) and hue by [from, to) ranges (a grey's hue is 0)", () => {
		const plate = { ...RULE, satMax: 0.1 };
		assert.equal(at(plate, [184, 182, 178, 255]), true); // 0.041
		assert.equal(at(plate, [200, 160, 140, 255]), false); // skin, 0.375
		assert.equal(at({ ...RULE, satMin: 0.5 }, [30, 17, 6, 255]), true);
		const leather = { ...RULE, lumMax: 69, hue: [[0, 55], [340, 360]] };
		assert.equal(at(leather, [30, 17, 6, 255]), true); // hue 27.5
		assert.equal(at(leather, [60, 20, 40, 255]), false); // hue 330
		assert.equal(at({ ...leather, hue: [[300, 360]] }, [60, 20, 40, 255]), true);
		assert.equal(at(leather, [40, 40, 40, 255]), true); // grey: hue 0
		assert.equal(at(leather, [20, 60, 20, 255]), false); // green, 120
		assert.equal(at({ ...RULE, hue: [[0, 27.5]] }, [30, 17, 6, 255]), false); // to is exclusive
	});
	it("an unless rule with open alpha / minRgb matches on its own bounds only", () => {
		const smear = { lumMin: 130, hue: [[180, 360]] };
		assert.equal(at(smear, [202, 196, 203, 10]), true);
		assert.equal(at(smear, [184, 182, 178, 255]), false); // lit plate: hue 40
		assert.equal(at(smear, [107, 99, 100, 255]), false); // shaded plate: hue 352.5, luminance 102
	});
});

describe("openCells / regrowCells / dropSmallPieces", () => {
	it("opening by a square keeps what the square fits, drops thinner strokes", () => {
		const { m, w, h } = maskOf(["#.......", "#..###..", "#..###..", "#..####.", "#.......", "##......"]);
		assert.deepEqual(setPixels(A.openCells(m, w, h, w, h, 3), w), setPixels(maskOf(["........", "...###..", "...###..", "...###..", "........", "........"]).m, w));
		// at 2 the block stays and so does nothing else: the column is 1 wide, (6, 3) and the foot have no 2 x 2 of their own
		assert.deepEqual(setPixels(A.openCells(m, w, h, w, h, 2), w), setPixels(A.openCells(m, w, h, w, h, 3), w));
		const wide = maskOf(["##.", "##.", ".##", ".##"]);
		assert.deepEqual(setPixels(A.openCells(wide.m, 3, 4, 3, 4, 2), 3).length, 8);
	});
	it("never fits a square across a cell edge", () => {
		const { m, w, h } = maskOf(["######", "######", "######"]); // two 3 x 3 cells side by side
		assert.equal(setPixels(A.openCells(m, w, h, 3, 3, 3), w).length, 18);
		assert.equal(setPixels(A.openCells(m, w, h, 2, 3, 3), w).length, 0); // 2-wide cells: no 3 x 3 fits
	});
	it("regrowth returns pixels of `within` one 8-step at a time, within the cell", () => {
		const within = maskOf(["####.#", "......"]);
		const seed = maskOf(["#.....", "......"]);
		assert.deepEqual(setPixels(A.regrowCells(seed.m, within.m, 6, 2, 6, 2, 1), 6), ["0,0", "1,0"]);
		assert.deepEqual(setPixels(A.regrowCells(seed.m, within.m, 6, 2, 6, 2, 3), 6), ["0,0", "1,0", "2,0", "3,0"]);
		assert.deepEqual(setPixels(A.regrowCells(seed.m, within.m, 6, 2, 2, 2, 3), 6), ["0,0", "1,0"]); // 2-wide cells
	});
	it("drops 8-connected pieces under the minimum, never joining across a cell edge", () => {
		const { m, w, h } = maskOf(["##..#", "#...#", "..#..", "...#."]);
		assert.deepEqual(setPixels(A.dropSmallPieces(m, w, h, w, h, 3), w), ["0,0", "0,1", "1,0"]);
		assert.deepEqual(setPixels(A.dropSmallPieces(m, w, h, w, h, 2), w), ["0,0", "0,1", "1,0", "2,2", "3,3", "4,0", "4,1"]);
		const two = maskOf(["####"]); // one row across two 2-wide cells: two pieces of 2
		assert.equal(setPixels(A.dropSmallPieces(two.m, 4, 1, 2, 1, 3), 4).length, 0);
		assert.equal(setPixels(A.dropSmallPieces(two.m, 4, 1, 4, 1, 3), 4).length, 4);
	});
});

describe("dyeMask", () => {
	/** Two 8 x 8 cells: a 4 x 4 block of leather in each, a 1 px leather stroke (a bow) in cell 0, skin, a shadow. */
	function sheet() {
		const img = A.raster(16, 8);
		for (let c = 0; c < 2; c++) for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) put(img, c * 8 + x, y, [60, 34, 10, 255]);
		for (let y = 0; y < 7; y++) put(img, 7, y, [30, 17, 6, 255]); // the stroke
		put(img, 1, 3, [200, 160, 140, 255]); // skin
		put(img, 9, 6, [0, 0, 0, 216]); // shadow
		return img;
	}
	const leather = { rule: { ...RULE, lumMax: 69, hue: [[0, 55]] }, unless: [], open: null, minAreaPx: 0, normalizePercentile: 98, exclude: [] };
	const cellOf = (c) => ({ animation: "idle", facing: 0, frame: c });

	it("the rule alone takes leather and the stroke, never skin or shadow", () => {
		const m = A.dyeMask(sheet(), 8, 8, leather, cellOf);
		assert.equal(setPixels(m, 16).length, 32 + 7);
		assert.equal(m[3 * 16 + 1], 0);
		assert.equal(m[6 * 16 + 9], 0);
	});
	it("the opening drops the stroke and keeps the blocks whole; regrowth adds back only what touches them", () => {
		const opened = A.dyeMask(sheet(), 8, 8, { ...leather, open: { sizePx: 3, regrowPx: 0 } }, cellOf);
		assert.equal(setPixels(opened, 16).length, 32);
		const regrown = A.dyeMask(sheet(), 8, 8, { ...leather, open: { sizePx: 3, regrowPx: 1 } }, cellOf);
		// the stroke at x 7 is 2 px from the block's edge (x 5): nothing to regrow into
		assert.equal(setPixels(regrown, 16).length, 32);
	});
	it("minAreaPx drops the stroke as its own piece", () => {
		const m = A.dyeMask(sheet(), 8, 8, { ...leather, minAreaPx: 8 }, cellOf);
		assert.equal(setPixels(m, 16).length, 32);
	});
	it("unless rules drop what they match", () => {
		const m = A.dyeMask(sheet(), 8, 8, { ...leather, unless: [{ lumMax: 20 }] }, cellOf); // the stroke is luminance 19
		assert.equal(setPixels(m, 16).length, 32);
	});
	it("exclude rects apply in cell pixels to the cells they name", () => {
		const ex = (e) => A.dyeMask(sheet(), 8, 8, { ...leather, exclude: [e] }, cellOf);
		assert.equal(setPixels(ex({ rect: { x: 2, y: 2, w: 2, h: 2 } }), 16).length, 39 - 8); // both cells
		assert.equal(setPixels(ex({ frames: [1], rect: { x: 2, y: 2, w: 2, h: 2 } }), 16).length, 39 - 4); // cell 1 only
		assert.equal(setPixels(ex({ facings: [3], rect: { x: 0, y: 0, w: 8, h: 8 } }), 16).length, 39); // no cell faces 3
		assert.equal(setPixels(ex({ animations: ["idle"], rect: { x: 6, y: 0, w: 99, h: 99 } }), 16).length, 39 - 7); // clipped to the cell
		const skip = A.dyeMask(sheet(), 8, 8, { ...leather, exclude: [{ rect: { x: 0, y: 0, w: 8, h: 8 } }] }, (c) => (c === 0 ? undefined : cellOf(c)));
		assert.equal(setPixels(skip, 16).length, 23); // an unused cell (undefined) is never excluded from
	});
});

describe("normalisation", () => {
	it("the nearest-rank percentile of the masked luminances, at least 1", () => {
		const hist = new Array(256).fill(0);
		hist[10] = 50;
		hist[60] = 49;
		hist[200] = 1;
		assert.equal(A.dyeNormalizer(hist, 98, "s"), 60); // rank 98 of 100
		assert.equal(A.dyeNormalizer(hist, 100, "s"), 200);
		assert.equal(A.dyeNormalizer(hist, 50, "s"), 10);
		assert.equal(A.dyeNormalizer(hist, 50.5, "s"), 60); // rank ceil(50.5) = 51
		const dark = new Array(256).fill(0);
		dark[0] = 3;
		assert.equal(A.dyeNormalizer(dark, 98, "s"), 1);
		assert.throws(() => A.dyeNormalizer(new Array(256).fill(0), 98, "class.x"), /class\.x: dye masks no pixel/);
	});
	it("grey = round(255 x min(1, l / p)) half up; the mean of min(1, l / p) to 4 decimals", () => {
		assert.equal(A.dyeGrey(60, 60), 255);
		assert.equal(A.dyeGrey(200, 60), 255);
		assert.equal(A.dyeGrey(30, 60), 128); // 127.5 -> 128
		assert.equal(A.dyeGrey(1, 3), 85);
		assert.equal(A.dyeGrey(0, 60), 0);
		for (let p = 1; p < 256; p += 7) for (let l = 0; l < 256; l += 3) assert.equal(A.dyeGrey(l, p), Math.round(255 * Math.min(1, l / p)), `${l}/${p}`);
		const hist = new Array(256).fill(0);
		hist[30] = 1;
		hist[60] = 2;
		hist[90] = 1;
		assert.equal(A.dyeMeanValue(hist, 60), 0.875); // (0.5 + 1 + 1 + 1) / 4
		hist[10] = 2;
		assert.equal(A.dyeMeanValue(hist, 60), 0.6389); // 3.8333 / 6
	});

	it("dyeSourceMean: each channel's mean over the masked pixels, rounded half up; nothing masked throws", () => {
		const img = { w: 3, h: 1, data: new Uint8Array([10, 20, 30, 255, 11, 21, 31, 255, 200, 200, 200, 255]) };
		const sum = { r: 0, g: 0, b: 0, n: 0 };
		A.addDyeColorSum(sum, img, new Uint8Array([1, 1, 0]));
		assert.deepEqual(sum, { r: 21, g: 41, b: 61, n: 2 });
		assert.equal(A.dyeSourceMean(sum, "t"), "#0b151f"); // 10.5 -> 11, 20.5 -> 21, 30.5 -> 31
		assert.throws(() => A.dyeSourceMean({ r: 0, g: 0, b: 0, n: 0 }, "t"), /masks no pixel/);
	});
	it("the dye sheet: masked pixels grey with their own alpha, everything else (0, 0, 0, 0)", () => {
		const img = A.raster(3, 1);
		put(img, 0, 0, [60, 60, 60, 250]);
		put(img, 1, 0, [30, 30, 30, 245]);
		put(img, 2, 0, [90, 90, 90, 255]);
		const out = A.dyeSheet(img, Uint8Array.from([1, 1, 0]), 60);
		assert.deepEqual([...out.data], [255, 255, 255, 250, 128, 128, 128, 245, 0, 0, 0, 0]);
	});
});

// ---------------------------------------------------------------------------------------------
// Whole sprite sets (synthetic sources in the source cache)

/** Two 16 x 16 frames: a 6 x 6 leather body, a 1 px leather bow beside it, skin, a black shadow under it. */
function primeSource(rel, bodyShade) {
	const img = A.raster(32, 16);
	for (let f = 0; f < 2; f++) {
		const ox = f * 16;
		for (let y = 4; y <= 9; y++) for (let x = 5; x <= 10; x++) put(img, ox + x, y, [bodyShade + f * 10, 34, 10, 255]);
		for (let y = 2; y <= 11; y++) put(img, ox + 13, y, [30, 17, 6, 255]); // the bow
		put(img, ox + 7, 3, [200, 160, 140, 255]); // a face
		for (let x = 3; x <= 12; x++) put(img, ox + x, 12, [0, 0, 0, 200]); // shadow
	}
	A.sourceCache.set(rel, img);
}

function dyedSet(name, extra) {
	primeSource(`dye/${name}.png`, 60);
	primeSource(`dye/${name}-b.png`, 40);
	return {
		source: { type: "grid", dir: "dye", frameW: 16, frameH: 16 },
		facingCount: 1,
		rowForFacing: [0],
		noiseAlpha: 2,
		pad: 1,
		pivot: { measure: { animation: "idle", facing: 0, frame: 0 }, bodyAlpha: 240, bodyMinRgb: 8, footBand: 2 },
		bodyTiles: 1,
		resample: "Default",
		animations: { idle: { file: `${name}.png`, frames: [0, 1], fps: 8, loop: true }, run: { file: `${name}-b.png`, frames: [0, 1], fps: 8, loop: true } },
		sheets: [
			{ name: `${name}-idle`, animations: ["idle"] },
			{ name: `${name}-run`, animations: ["run"] },
		],
		...extra,
	};
}

const LEATHER_DYE = { rule: { alphaMin: 240, minRgb: 8, lumMax: 69, hue: [[0, 55]] }, open: { sizePx: 3, regrowPx: 1 }, minAreaPx: 4, normalizePercentile: 98 };

describe("buildSpriteSet with a dye", () => {
	const plain = A.buildSpriteSet("class.plain", dyedSet("plain", { outline: { widthPx: 1 }, pad: 2 }));
	const dyed = A.buildSpriteSet("class.dyed", dyedSet("plain", { outline: { widthPx: 1 }, pad: 2, dye: LEATHER_DYE }));

	it("leaves the body and outline sheets and every other layout field exactly as without it", () => {
		assert.equal(dyed.sheets.length, plain.sheets.length);
		for (let i = 0; i < plain.sheets.length; i++) {
			assert.deepEqual(A.encodePng(dyed.sheets[i].img), A.encodePng(plain.sheets[i].img));
			assert.deepEqual(A.encodePng(dyed.sheets[i].outlineImg), A.encodePng(plain.sheets[i].outlineImg));
		}
		const strip = (l) => ({ ...l, dyeMeanValue: undefined, dyeSourceMean: undefined, sheets: l.sheets.map((s) => ({ ...s, dyeFile: undefined })) });
		assert.deepEqual(JSON.parse(JSON.stringify(strip(dyed.layout))), JSON.parse(JSON.stringify(plain.layout)));
		assert.equal(plain.dye, null);
		assert.equal(plain.layout.dyeMeanValue, undefined);
		assert.equal(plain.layout.dyeSourceMean, undefined);
	});

	it("writes a dye sheet per sheet, same size, aligned pixel for pixel with the body sheet", () => {
		for (const sh of dyed.sheets) {
			assert.equal(sh.dyeFile, sh.file.replace(/\.png$/, "-dye.png"));
			assert.deepEqual([sh.dyeImg.w, sh.dyeImg.h], [sh.img.w, sh.img.h]);
			let n = 0;
			for (let i = 0; i < sh.img.w * sh.img.h; i++) {
				const a = sh.dyeImg.data[i * 4 + 3];
				if (a === 0) {
					assert.deepEqual([...sh.dyeImg.data.slice(i * 4, i * 4 + 4)], [0, 0, 0, 0]);
					continue;
				}
				n++;
				assert.equal(a, sh.img.data[i * 4 + 3], "the body's own alpha");
				const v = sh.dyeImg.data[i * 4];
				assert.equal(sh.dyeImg.data[i * 4 + 1], v);
				assert.equal(sh.dyeImg.data[i * 4 + 2], v);
				assert.ok(sh.img.data[i * 4 + 3] > 240 && sh.img.data[i * 4 + 1] === 34, "only the leather body: no bow, face or shadow");
			}
			assert.equal(n, 2 * 36, "two frames of a 6 x 6 body");
			assert.equal(sh.dyePixels, n);
		}
	});

	it("normalises over the whole set, not per sheet", () => {
		// idle frames: luminance of (60, 34, 10) = 39 and (70, 34, 10) = 42; run frames (40 / 50, 34, 10) = 33 / 36
		assert.equal(dyed.dyeStats.normalizer, 42);
		const greyAt = (sh, v) => [...sh.dyeImg.data].filter((x, i) => i % 4 === 0 && sh.dyeImg.data[i + 3] > 0).every((x) => x === v[0] || x === v[1]);
		assert.ok(greyAt(dyed.sheets[0], [A.dyeGrey(39, 42), 255]));
		assert.ok(greyAt(dyed.sheets[1], [A.dyeGrey(33, 42), A.dyeGrey(36, 42)]));
		assert.equal(dyed.layout.dyeMeanValue, Math.round(((39 / 42 + 1 + 33 / 42 + 36 / 42) / 4) * 10000) / 10000);
		assert.equal(dyed.dyeStats.pixels, 4 * 36);
		// the undyed region's mean source colour: (60 + 70 + 40 + 50) / 4 = 55, 34, 10 over equal pixel counts
		assert.equal(dyed.layout.dyeSourceMean, "#37220a");
		assert.equal(dyed.dyeStats.sourceMean, "#37220a");
		assert.equal(dyed.dyeStats.bodyPixels, 4 * (36 + 10 + 1));
	});

	it("layout.ts lists dyeFile after outlineFile, dyeMeanValue and dyeSourceMean after the sheets", () => {
		assert.deepEqual(Object.keys(dyed.layout.sheets[0]), ["file", "w", "h", "outlineFile", "dyeFile"]);
		const keys = Object.keys(dyed.layout);
		assert.equal(keys[keys.indexOf("sheets") + 1], "dyeMeanValue");
		assert.equal(keys[keys.indexOf("sheets") + 2], "dyeSourceMean");
		const text = A.layoutModule([plain, dyed], [], "#000000");
		assert.match(text, /\tdyeFile\?: string;\n/);
		assert.match(text, /\tdyeMeanValue\?: number;\n/);
		assert.match(text, /\tdyeSourceMean\?: HexColor;\n/);
		assert.match(text, /dyeFile: "plain-idle-dye\.png"/);
		assert.match(text, new RegExp(`dyeMeanValue: ${dyed.layout.dyeMeanValue},\\n\\t\\tdyeSourceMean: "#37220a",\\n\\t\\tanimations`));
		const merged = A.mergeSpriteLayout(A.layoutModule([plain], [], "#000000"), "class.dyed", dyed.layout);
		assert.equal(merged, A.layoutModule([dyed, plain], [], "#000000"), "--only merges byte for byte what a full build (sorted by id) writes");
	});

	it("outputs each dye sheet after its outline sheet, and one dye contact sheet per animation", () => {
		const out = A.buildOutputs([dyed], []).map((o) => `${o.dir}/${o.name}`);
		assert.deepEqual(out, [
			"build/plain-idle.png",
			"build/plain-idle-outline.png",
			"build/plain-idle-dye.png",
			"build/plain-run.png",
			"build/plain-run-outline.png",
			"build/plain-run-dye.png",
			"contact/class.dyed.png",
			"contact/class.dyed-dye-idle.png",
			"contact/class.dyed-dye-run.png",
		]);
		assert.deepEqual(A.buildOutputs([plain], []).map((o) => o.name), ["plain-idle.png", "plain-idle-outline.png", "plain-run.png", "plain-run-outline.png", "class.plain.png"]);
	});

	it("dye contact sheets show the mask in magenta and each sample dye", () => {
		const [c] = A.dyeContactSheets(dyed);
		const has = (rgb) => {
			for (let i = 0; i < c.img.w * c.img.h; i++) if (c.img.data[i * 4] === rgb[0] && c.img.data[i * 4 + 1] === rgb[1] && c.img.data[i * 4 + 2] === rgb[2]) return true;
			return false;
		};
		assert.ok(has(A.DYE_MASK_PREVIEW_RGB));
		// the brightest leather (grey 255, opaque) dyed: exactly the sample colour
		for (const s of A.DYE_SAMPLE_RGB) assert.ok(has(s), String(s));
		assert.equal(A.DYE_SAMPLE_RGB.length, 4);
	});

	it("refuses a dye that masks nothing", () => {
		assert.throws(() => A.buildSpriteSet("class.none", dyedSet("none", { dye: { ...LEATHER_DYE, rule: { alphaMin: 240, minRgb: 8, lumMin: 250 } } })), /class\.none: dye masks no pixel/);
	});

	it("is deterministic", () => {
		const again = A.buildSpriteSet("class.dyed", dyedSet("plain", { outline: { widthPx: 1 }, pad: 2, dye: LEATHER_DYE }));
		for (let i = 0; i < again.sheets.length; i++) assert.deepEqual(A.encodePng(again.sheets[i].dyeImg), A.encodePng(dyed.sheets[i].dyeImg));
	});
});

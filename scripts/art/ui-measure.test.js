// Specs for the UI sheet measuring tool (docs/UI_ART.md UA2, npm run test:art). Synthetic rasters only.
"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { measurePiece, DEFAULT_ALPHA } = require("./ui-measure.js");

/** A w x h raster with the listed pixels set to the given alpha (RGB grey). */
function raster(w, h, pixels) {
	const data = new Uint8Array(w * h * 4);
	for (const [x, y, a] of pixels) data.set([90, 90, 90, a], (y * w + x) * 4);
	return { w, h, data };
}

describe("measurePiece", () => {
	it("returns the alpha box of everything 8-connected to the seed (a diagonal step joins), and its pixel count", () => {
		// an L of three pixels plus a diagonal neighbour; a second piece one clear column away
		const img = raster(12, 8, [[2, 2, 255], [3, 2, 255], [2, 3, 255], [4, 3, 255], [5, 4, 200], [7, 4, 255], [7, 5, 255]]);
		assert.deepEqual(measurePiece(img, 2, 2), { rect: [2, 2, 4, 3], pixels: 5 });
		assert.deepEqual(measurePiece(img, 7, 5), { rect: [7, 4, 1, 2], pixels: 2 });
	});

	it("follows only pixels with alpha above the threshold (default 10); a clear seed has no piece", () => {
		const img = raster(6, 3, [[0, 1, 255], [1, 1, DEFAULT_ALPHA], [2, 1, 255], [3, 1, 11], [4, 1, 255]]);
		assert.deepEqual(measurePiece(img, 0, 1), { rect: [0, 1, 1, 1], pixels: 1 }); // alpha 10 does not connect
		assert.deepEqual(measurePiece(img, 2, 1), { rect: [2, 1, 3, 1], pixels: 3 }); // alpha 11 does
		assert.deepEqual(measurePiece(img, 0, 1, 5), { rect: [0, 1, 5, 1], pixels: 5 });
		assert.equal(measurePiece(img, 5, 1), null);
		assert.equal(measurePiece(img, 1, 1), null);
	});

	it("reaches the image edges and rejects a point outside the image", () => {
		const pixels = [];
		for (let x = 0; x < 4; x++) pixels.push([x, 0, 255], [x, 2, 255]);
		pixels.push([3, 1, 255]);
		const img = raster(4, 3, pixels);
		assert.deepEqual(measurePiece(img, 0, 2), { rect: [0, 0, 4, 3], pixels: 9 });
		assert.throws(() => measurePiece(img, 4, 0), /point \(4, 0\) is outside the 4x3 image/);
		assert.throws(() => measurePiece(img, -1, 0), /outside/);
	});
});

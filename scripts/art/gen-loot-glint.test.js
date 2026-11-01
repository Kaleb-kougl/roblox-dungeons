// Specs for the generated loot glint (scripts/art/gen-loot-glint.js; npm run test:art): deterministic, every frame
// one CANVAS square of white pixels (the renderer tints it), something visible in every frame, the peak the biggest.
"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { PNG } = require("pngjs");
const G = require("./gen-loot-glint.js");

function decode(buf) {
	return PNG.sync.read(buf);
}

function opaque(png) {
	let n = 0;
	for (let i = 0; i < png.width * png.height; i++) if (png.data[i * 4 + 3] > 0) n++;
	return n;
}

describe("gen-loot-glint", () => {
	it("is deterministic (byte-identical PNGs, so art/vendor.lock.json holds)", () => {
		for (const s of G.FRAMES) assert.deepEqual(G.renderFrame(s), G.renderFrame(s));
	});

	it("draws 8 square frames of white pixels, every one visible, the peak the largest", () => {
		assert.equal(G.FRAMES.length, 8);
		const sizes = G.FRAMES.map((s) => {
			const png = decode(G.renderFrame(s));
			assert.equal(png.width, G.CANVAS);
			assert.equal(png.height, G.CANVAS);
			for (let i = 0; i < png.width * png.height; i++) {
				if (png.data[i * 4 + 3] === 0) continue;
				assert.deepEqual([png.data[i * 4], png.data[i * 4 + 1], png.data[i * 4 + 2]], [255, 255, 255]);
			}
			return opaque(png);
		});
		for (const n of sizes) assert.ok(n > 0);
		assert.equal(Math.max(...sizes), sizes[G.PEAK_FRAME]);
	});

	it("keeps every pixel above the pipeline's noise cut (worldArt noiseAlpha 2)", () => {
		for (const s of G.FRAMES) {
			const png = decode(G.renderFrame(s));
			for (let i = 0; i < png.width * png.height; i++) {
				const a = png.data[i * 4 + 3];
				assert.ok(a === 0 || a > 2);
			}
		}
	});
});

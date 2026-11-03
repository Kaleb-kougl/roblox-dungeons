// Specs for the generated pellets (scripts/art/gen-pellet.js; npm run test:art): deterministic, every pixel an opaque
// grey (the renderer tints it), a lit top face over a darker front face, the sizes the plan asks for at the pack's
// scale, and the power cube bigger with a glint.
"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { PNG } = require("pngjs");
const G = require("./gen-pellet.js");

/** The vale world art's scale (art/atlases.json worldArt.pixelsPerTileFrom: enemy.swarmer's 29.6 px per tile). */
const PIXELS_PER_TILE = 29.6;

function decode(buf) {
	return PNG.sync.read(buf);
}

describe("gen-pellet", () => {
	it("is deterministic (byte-identical PNGs, so art/vendor.lock.json holds)", () => {
		for (const c of G.CUBES) assert.deepEqual(G.renderCube(c), G.renderCube(c));
	});

	it("draws two cubes, pellet and pellet_power, every pixel opaque grey above the pipeline's cuts", () => {
		assert.deepEqual(
			G.CUBES.map((c) => c.name),
			["pellet", "pellet_power"],
		);
		for (const c of G.CUBES) {
			const png = decode(G.renderCube(c));
			assert.equal(png.width, c.w);
			assert.equal(png.height, c.topH + c.frontH);
			for (let i = 0; i < png.width * png.height; i++) {
				const [r, g, b, a] = png.data.subarray(i * 4, i * 4 + 4);
				assert.equal(a, 255);
				assert.ok(r === g && g === b, "grey (tinted by the colour role)");
				// worldArt noiseAlpha 2 / shadowRgb 4: no pixel may be cut as noise or a baked shadow
				assert.ok(r > 4);
			}
		}
	});

	it("reads as a cube in 3/4 view: the top face lit, the front darker, its bottom row darkest", () => {
		for (const c of G.CUBES) {
			const lv = G.levels(c);
			const at = (x, y) => lv[y * c.w + x];
			const mid = Math.floor(c.w / 2);
			const h = c.topH + c.frontH;
			assert.ok(at(mid, 1) > at(mid, c.topH), `${c.name}: top over lip`);
			assert.ok(at(mid, c.topH) > at(mid, c.topH + 1), `${c.name}: lip over front`);
			assert.ok(at(mid, h - 2) > at(mid, h - 1), `${c.name}: front over base`);
			// the top face is taller than the front (looking down), and the whole cube is about square
			assert.ok(c.topH > c.frontH);
			assert.ok(Math.abs(c.w - h) <= 1);
		}
	});

	it("sizes: the pellet about a quarter tile, the power pellet about 0.45 tile, with a bigger glint", () => {
		assert.ok(Math.abs(G.NORMAL.w / PIXELS_PER_TILE - 0.25) < 0.02);
		assert.ok(Math.abs(G.POWER.w / PIXELS_PER_TILE - 0.45) < 0.02);
		assert.ok(G.POWER.glint.length > G.NORMAL.glint.length);
		for (const c of G.CUBES) {
			const lv = G.levels(c);
			for (const [x, y] of c.glint) {
				assert.ok(y < c.topH, "the glint lies on the top face");
				assert.equal(lv[y * c.w + x], G.L.glint);
			}
		}
	});
});

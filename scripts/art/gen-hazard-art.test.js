// Specs for the generated floor hazards (scripts/art/gen-hazard-art.js; npm run test:art; docs/HAZARD_ART.md HA1):
// deterministic, every strip of its canvas and frame count, grey pixels only (the renderer tints them), the strike's
// flash reaching its hit rim, nothing touching a canvas edge, the ember's loop seamless, and the files
// art/atlases.json's `hazards` group reads with the generator's geometry.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");
const { PNG } = require("pngjs");
const G = require("./gen-hazard-art.js");

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "art", "atlases.json"), "utf8"));
const NAMES = ["strike_flash", "strike_scorch", "ember_burn"];

describe("gen-hazard-art", () => {
	it("strike rim round(1.1 x 29.6) = 33 px on an odd 77 px canvas centred on its pivot", () => {
		assert.equal(G.STRIKE_R, 33);
		assert.equal(G.STRIKE_SIZE, 77);
		assert.deepEqual(G.STRIKE_PIVOT, { x: 38.5, y: 38.5 });
		assert.ok(Math.abs(G.STRIKE_R - G.STRIKE_RADIUS_TILES * G.PIXELS_PER_TILE) <= 0.5);
	});

	it("the ember's patch box is the patch ellipse's, and its pivot the patch centre", () => {
		const p = G.EMBER_PATCH;
		assert.deepEqual(G.EMBER_LIT, { w: 2 * p.rx, h: 2 * p.ry });
		assert.deepEqual(G.EMBER_PIVOT, { x: p.cx, y: p.cy });
	});

	it("is deterministic (byte-identical PNGs, so art/vendor.lock.json holds)", () => {
		for (const n of NAMES) assert.deepEqual(G.renderStrip(n), G.renderStrip(n));
	});

	it("every strip: frames side by side, grey pixels, nothing on a canvas's outermost px, something in every frame", () => {
		for (const n of NAMES) {
			const s = G.STRIPS[n];
			const png = PNG.sync.read(G.renderStrip(n));
			assert.equal(png.width, s.w * s.frames, n);
			assert.equal(png.height, s.h, n);
			for (let f = 0; f < s.frames; f++) {
				let visible = 0;
				for (let y = 0; y < s.h; y++) {
					for (let x = 0; x < s.w; x++) {
						const o = (y * png.width + f * s.w + x) * 4;
						const a = png.data[o + 3];
						if (a === 0) continue;
						visible++;
						assert.equal(png.data[o], png.data[o + 1], `${n} f${f}: not grey`);
						assert.equal(png.data[o + 1], png.data[o + 2], `${n} f${f}: not grey`);
						assert.ok(png.data[o] > 0, `${n} f${f}: a black pixel`);
						assert.ok(x > 0 && y > 0 && x < s.w - 1 && y < s.h - 1, `${n} f${f}: pixel on the canvas edge at ${x},${y}`);
					}
				}
				assert.ok(visible > 0, `${n} f${f} is empty`);
			}
		}
	});

	it("frame counts: flash 3, scorch 2 (hot, cold), burn 6", () => {
		assert.equal(G.STRIPS.strike_flash.frames, G.FLASH_FRAMES);
		assert.equal(G.STRIPS.strike_scorch.frames, G.SCORCH_FRAMES);
		assert.equal(G.STRIPS.ember_burn.frames, G.BURN_FRAMES);
		assert.deepEqual([G.FLASH_FRAMES, G.SCORCH_FRAMES, G.BURN_FRAMES], [3, 2, 6]);
	});

	it("the first two flash frames draw the hit rim (a pixel within 0.5 px of radius 33 at every 30 degrees)", () => {
		for (const f of [0, 1]) {
			const img = G.drawFrame("strike_flash", f);
			for (let k = 0; k < 12; k++) {
				const a = (k / 12) * Math.PI * 2;
				let hit = false;
				for (let y = 0; y < img.h && !hit; y++) {
					for (let x = 0; x < img.w && !hit; x++) {
						if (img.alpha[y * img.w + x] === 0) continue;
						const dx = x + 0.5 - G.STRIKE_PIVOT.x;
						const dy = G.STRIKE_PIVOT.y - (y + 0.5);
						const r = Math.hypot(dx, dy);
						let d = Math.abs(Math.atan2(dy, dx) - a) % (Math.PI * 2);
						if (d > Math.PI) d = Math.PI * 2 - d;
						hit = Math.abs(r - G.STRIKE_R) <= 0.5 && d < 0.1;
					}
				}
				assert.ok(hit, `flash ${f}: no rim pixel at ${k * 30} degrees`);
			}
		}
	});

	it("the scorch's hot cracks glow (a white pixel) and its cold ones do not; its char stays inside the rim", () => {
		const max = (img) => Math.max(...img.lum.filter((_, i) => img.alpha[i] > 0));
		assert.equal(max(G.drawFrame("strike_scorch", 0)), 255);
		assert.ok(max(G.drawFrame("strike_scorch", 1)) < 255);
		for (const f of [0, 1]) {
			const img = G.drawFrame("strike_scorch", f);
			for (let y = 0; y < img.h; y++) {
				for (let x = 0; x < img.w; x++) {
					if (img.alpha[y * img.w + x] === 0) continue;
					const r = Math.hypot(x + 0.5 - G.STRIKE_PIVOT.x, y + 0.5 - G.STRIKE_PIVOT.y);
					assert.ok(r < G.STRIKE_R, `scorch ${f}: pixel at ${x},${y} outside the rim`);
				}
			}
		}
	});

	it("the burn loop is seamless: frame BURN_FRAMES draws exactly frame 0", () => {
		const a = G.drawFrame("ember_burn", 0);
		const b = G.drawFrame("ember_burn", G.BURN_FRAMES);
		assert.deepEqual([...b.lum], [...a.lum]);
		assert.deepEqual([...b.alpha], [...a.alpha]);
	});

	it("art/atlases.json's hazards group reads these strips with the generator's geometry", () => {
		const g = CONFIG.hazards;
		assert.ok(g, "no hazards group");
		const strike = g.sets["bullet.enemy.strike"];
		const ember = g.sets["bullet.player.ember"];
		assert.deepEqual(strike.canvas, [G.STRIKE_SIZE, G.STRIKE_SIZE]);
		assert.deepEqual(strike.pivot, [G.STRIKE_PIVOT.x, G.STRIKE_PIVOT.y]);
		assert.equal(strike.rimPx, G.STRIKE_R);
		assert.equal(strike.animations.flash.file, "kaleb-vale/hazards/strike_flash.png");
		assert.equal(strike.animations.flash.frames, G.FLASH_FRAMES);
		assert.equal(strike.animations.scorch.file, "kaleb-vale/hazards/strike_scorch.png");
		assert.equal(strike.animations.scorch.frames, G.SCORCH_FRAMES);
		assert.deepEqual(ember.canvas, [G.EMBER_W, G.EMBER_H]);
		assert.deepEqual(ember.pivot, [G.EMBER_PIVOT.x, G.EMBER_PIVOT.y]);
		assert.deepEqual(ember.lit, [G.EMBER_LIT.w, G.EMBER_LIT.h]);
		assert.equal(ember.animations.burn.file, "kaleb-vale/hazards/ember_burn.png");
		assert.equal(ember.animations.burn.frames, G.BURN_FRAMES);
		assert.equal(g.pixelsPerTile, G.PIXELS_PER_TILE);
	});
});

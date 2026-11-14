// Specs for the generated secret-room art (scripts/art/gen-secret-art.js; npm run test:art; docs/SECRET_ROOMS.md SR11):
// deterministic, every strip of its canvas and frame count, grey pixels only (the view tints them), nothing on a
// canvas's outermost pixel, three distinct crack variants that read darker than the wall (dark cores, nothing light),
// the rubble a lit heap with a dark rim, the dust a trickle that falls and lands, and the files art/atlases.json's
// `secret` group reads with the generator's geometry.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");
const { PNG } = require("pngjs");
const G = require("./gen-secret-art.js");

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "art", "atlases.json"), "utf8"));
const NAMES = ["crack", "rubble", "dust"];

/** The visible pixels of frame f of strip `name`: [{ x, y, lum, alpha }]. */
function visible(name, f) {
	const img = G.drawFrame(name, f);
	const out = [];
	for (let y = 0; y < img.h; y++) {
		for (let x = 0; x < img.w; x++) {
			const i = y * img.w + x;
			if (img.alpha[i] > 0) out.push({ x, y, lum: img.lum[i], alpha: img.alpha[i] });
		}
	}
	return out;
}

describe("gen-secret-art", () => {
	it("geometry: the crack and rubble two tiles by one at TILE_PX, centred pivots; the dust a strip a tile tall", () => {
		assert.equal(G.TILE_PX, 32);
		assert.deepEqual([G.CRACK_W, G.CRACK_H], [G.CRACK_CELLS * G.TILE_PX, G.TILE_PX]);
		assert.deepEqual([G.RUBBLE_W, G.RUBBLE_H], [G.CRACK_W, G.CRACK_H]);
		assert.deepEqual(G.CRACK_PIVOT, { x: G.CRACK_W / 2, y: G.CRACK_H / 2 });
		assert.deepEqual(G.RUBBLE_PIVOT, { x: G.RUBBLE_W / 2, y: G.RUBBLE_H / 2 });
		assert.equal(G.DUST_H, G.TILE_PX);
		assert.deepEqual([G.CRACK_VARIANTS, G.DUST_FRAMES], [3, 6]);
		assert.equal(G.DUST_PIVOT.x, G.DUST_W / 2);
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
				let count = 0;
				for (let y = 0; y < s.h; y++) {
					for (let x = 0; x < s.w; x++) {
						const o = (y * png.width + f * s.w + x) * 4;
						if (png.data[o + 3] === 0) continue;
						count++;
						assert.equal(png.data[o], png.data[o + 1], `${n} f${f}: not grey`);
						assert.equal(png.data[o + 1], png.data[o + 2], `${n} f${f}: not grey`);
						assert.ok(x > 0 && y > 0 && x < s.w - 1 && y < s.h - 1, `${n} f${f}: pixel on the canvas edge at ${x},${y}`);
					}
				}
				assert.ok(count > 0, `${n} f${f} is empty`);
			}
		}
	});

	it("the crack: three distinct variants, each a dark core across both cells, never lighter than its halo", () => {
		const shapes = [];
		for (let f = 0; f < G.CRACK_VARIANTS; f++) {
			const px = visible("crack", f);
			const core = px.filter((p) => p.lum === G.CRACK_LUM.core);
			assert.ok(core.length >= 40, `variant ${f}: a crack needs a core (${core.length} px)`);
			// it spans both cells and most of the face's height
			const xs = core.map((p) => p.x);
			const ys = core.map((p) => p.y);
			assert.ok(Math.min(...xs) < G.TILE_PX && Math.max(...xs) >= G.TILE_PX, `variant ${f}: crosses both cells`);
			assert.ok(Math.max(...ys) - Math.min(...ys) >= G.CRACK_H / 2, `variant ${f}: runs down the face`);
			// an overlay that only darkens: no pixel brighter than the halo
			for (const p of px) assert.ok(p.lum <= G.CRACK_LUM.halo, `variant ${f}: a light pixel at ${p.x},${p.y}`);
			// a light touch: the crack covers well under half of its face
			assert.ok(px.length < (G.CRACK_W * G.CRACK_H) / 2, `variant ${f}: covers ${px.length} px`);
			shapes.push(core.map((p) => `${p.x},${p.y}`).join(";"));
		}
		assert.equal(new Set(shapes).size, G.CRACK_VARIANTS);
	});

	it("the rubble: a heap of lit stones (every lit step), a dark rim, filling the two cells' middle", () => {
		const px = visible("rubble", 0);
		const solid = px.filter((p) => p.alpha === 255);
		for (const lum of G.STONE) assert.ok(solid.some((p) => p.lum === lum), `stone step ${lum} used`);
		assert.ok(solid.some((p) => p.lum < G.STONE[G.STONE.length - 1]), "a dark rim");
		// the middle of the heap is stone
		const at = (x, y) => solid.find((p) => p.x === x && p.y === y);
		assert.ok(at(G.RUBBLE_W / 2, G.RUBBLE_H / 2), "stone at the centre");
		assert.ok(solid.length > (G.RUBBLE_W * G.RUBBLE_H) / 3, `stone over a third of the canvas (${solid.length} px)`);
	});

	it("the dust: grains leave the joint at the top and fall, then land in a puff", () => {
		const lowest = [];
		for (let f = 0; f < G.DUST_FRAMES; f++) {
			const px = visible("dust", f);
			const grains = px.filter((p) => p.y < G.DUST_H - 3);
			lowest.push(grains.length > 0 ? Math.max(...grains.map((p) => p.y)) : -1);
		}
		// the first frame starts at the joint; the falling front moves down over the first frames
		assert.ok(lowest[0] <= G.DUST_PIVOT.y + 2, `frame 0 at the joint (${lowest[0]})`);
		for (let f = 1; f < 4; f++) assert.ok(lowest[f] > lowest[f - 1], `frame ${f} lower than ${f - 1}: ${lowest}`);
		// the puff on the landing row in the last frames, wider each frame
		const puff = (f) => visible("dust", f).filter((p) => p.y === G.DUST_H - 3).length;
		assert.equal(puff(0), 0);
		assert.ok(puff(G.DUST_FRAMES - 1) > puff(3) && puff(3) > 0);
	});

	it("matches art/atlases.json's secret group: files, canvases, pivots, frame counts", () => {
		const sets = CONFIG.secret.sets;
		const crack = sets["secret.crack"];
		assert.deepEqual(crack.canvas, [G.CRACK_W, G.CRACK_H]);
		assert.deepEqual(crack.pivot, [G.CRACK_PIVOT.x, G.CRACK_PIVOT.y]);
		assert.equal(crack.animations.idle.file, "kaleb-vale/secret/crack.png");
		assert.equal(crack.animations.idle.frames, G.CRACK_VARIANTS);
		const rubble = sets["secret.rubble"];
		assert.deepEqual(rubble.canvas, [G.RUBBLE_W, G.RUBBLE_H]);
		assert.deepEqual(rubble.pivot, [G.RUBBLE_PIVOT.x, G.RUBBLE_PIVOT.y]);
		assert.equal(rubble.animations.idle.file, "kaleb-vale/secret/rubble.png");
		assert.equal(rubble.animations.idle.frames, 1);
		const dust = sets["fx.secret.dust"];
		assert.deepEqual(dust.canvas, [G.DUST_W, G.DUST_H]);
		assert.deepEqual(dust.pivot, [G.DUST_PIVOT.x, G.DUST_PIVOT.y]);
		assert.equal(dust.animations.play.file, "kaleb-vale/secret/dust.png");
		assert.deepEqual([dust.animations.play.frames, dust.animations.play.fps], [G.DUST_FRAMES, G.DUST_FPS]);
		assert.equal(CONFIG.secret.pixelsPerTile, G.TILE_PX);
	});
});

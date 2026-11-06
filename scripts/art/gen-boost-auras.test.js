// Specs for the generated boost auras (scripts/art/gen-boost-auras.js; npm run test:art): deterministic, every frame a
// square greyscale canvas of its rank's size (the renderer tints it), every rank's ring where RING_PX says, nothing
// clipped at the canvas edge, every loop seamless, and the files art/atlases.json's `boostAuras` group reads.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");
const { PNG } = require("pngjs");
const G = require("./gen-boost-auras.js");

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "art", "atlases.json"), "utf8"));

function eachFrame(fn) {
	for (const kind of G.KIND_NAMES) for (let r = 0; r < G.RANKS; r++) for (let f = 0; f < G.FRAMES; f++) fn(kind, r, f);
}

describe("gen-boost-auras", () => {
	it("draws the four kinds in BOOST_KINDS order, four ranks, eight frames", () => {
		assert.deepEqual(G.KIND_NAMES, ["fury", "quickstep", "frenzy", "aegis"]);
		assert.equal(G.RANKS, 4);
		assert.equal(G.FRAMES, 8);
	});

	it("ring radius per rank: round((0.55 + 0.14 rank) x 29.6) px, within 0.5 px of the unrounded radius", () => {
		assert.deepEqual(G.RING_PX, [16, 20, 25, 29]);
		G.RING_PX.forEach((px, r) => assert.ok(Math.abs(px - (G.RADIUS_TILES + r * G.STEP_TILES) * G.PIXELS_PER_TILE) <= 0.5));
		G.RING_PX.forEach((px, r) => assert.equal(G.canvasOf(r), 2 * (px + G.MARGIN) + 1));
	});

	it("is deterministic (byte-identical PNGs, so art/vendor.lock.json holds)", () => {
		eachFrame((kind, r, f) => assert.deepEqual(G.renderFrame(kind, r, f), G.renderFrame(kind, r, f)));
	});

	it("every frame: its rank's odd square canvas, grey pixels, alpha above the noise cut, something visible", () => {
		eachFrame((kind, r, f) => {
			const png = PNG.sync.read(G.renderFrame(kind, r, f));
			assert.equal(png.width, G.canvasOf(r));
			assert.equal(png.height, G.canvasOf(r));
			let visible = 0;
			for (let i = 0; i < png.width * png.height; i++) {
				const [R, Gr, B, a] = png.data.subarray(i * 4, i * 4 + 4);
				if (a === 0) continue;
				visible++;
				assert.ok(a > 2, `${kind} r${r} f${f}: alpha ${a}`);
				assert.equal(R, Gr);
				assert.equal(Gr, B);
				assert.ok(R > 0, `${kind} r${r} f${f}: a black pixel tints to black`);
			}
			assert.ok(visible > 0, `${kind} r${r} f${f} is empty`);
		});
	});

	it("draws the ring at RING_PX (pixels on the ring's circle) and nothing on the canvas's outermost px (no clipping)", () => {
		eachFrame((kind, r, f) => {
			const img = G.drawFrame(kind, r, f);
			const R = G.RING_PX[r];
			let onRing = 0;
			let ringPixels = 0;
			for (let y = 0; y < img.size; y++) {
				for (let x = 0; x < img.size; x++) {
					const a = img.alpha[y * img.size + x];
					const edge = Math.min(x, y, img.size - 1 - x, img.size - 1 - y);
					if (a > 0) assert.ok(edge >= 1, `${kind} r${r} f${f}: pixel (${x}, ${y}) at the canvas edge`);
					if (Math.abs(Math.hypot(x - img.c, y - img.c) - R) < 0.5) {
						ringPixels++;
						if (a > 0) onRing++;
					}
				}
			}
			// Aegis's plate gaps leave ~1/6 of the circle empty; every other ring is whole
			assert.ok(onRing >= 0.7 * ringPixels, `${kind} r${r} f${f}: ${onRing} of ${ringPixels} ring pixels`);
		});
	});

	it("every loop is seamless: frame FRAMES draws exactly frame 0, and consecutive frames differ", () => {
		for (const kind of G.KIND_NAMES) {
			for (let r = 0; r < G.RANKS; r++) {
				const a = G.drawFrame(kind, r, 0);
				const b = G.drawUnchecked(kind, r, G.FRAMES);
				assert.deepEqual([...b.alpha], [...a.alpha], `${kind} r${r}`);
				assert.deepEqual([...b.lum], [...a.lum], `${kind} r${r}`);
				for (let f = 1; f < G.FRAMES; f++) assert.notDeepEqual(G.renderFrame(kind, r, f), G.renderFrame(kind, r, f - 1));
			}
		}
	});

	it("rejects an unknown kind, rank or frame", () => {
		assert.throws(() => G.drawFrame("haste", 0, 0), /no kind/);
		assert.throws(() => G.drawFrame("fury", G.RANKS, 0), /out of range/);
		assert.throws(() => G.drawFrame("fury", 0, G.FRAMES), /out of range/);
	});

	it("writes the files the atlas config reads: one set per kind, its ring px, frame count and file pattern", () => {
		const group = CONFIG.boostAuras;
		assert.ok(group, "art/atlases.json has a boostAuras group");
		assert.deepEqual(group.ringPx, G.RING_PX);
		assert.equal(group.frames, G.FRAMES);
		assert.deepEqual(
			Object.keys(group.sets).filter((k) => !k.startsWith("$")),
			G.KIND_NAMES.map((k) => `fx.boost.aura.${k}`),
		);
		for (const kind of G.KIND_NAMES) {
			const file = group.sets[`fx.boost.aura.${kind}`].file;
			assert.equal(path.posix.basename(file.replace("{r}", "2").replace("{f}", "5")), G.fileName(kind, 2, 5));
			assert.equal(path.posix.dirname(file), "kaleb-vale/boost-auras");
		}
	});
});

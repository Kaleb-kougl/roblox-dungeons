// Specs for the generated vault art (scripts/art/gen-treasure-art.js; npm run test:art; docs/TREASURE.md TR9):
// deterministic; the cage drawn in the chest's projection (its pivot the footprint centre, the padlock only where the
// chest's front faces the camera, the bars the chest hides cut), the column a white flipbook of stepped alpha that moves,
// and the numbers art/atlases.json's `treasure` group copies (strip size, pivot) in step with the generator.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");
const { PNG } = require("pngjs");
const G = require("./gen-treasure-art.js");

const decode = (buf) => PNG.sync.read(buf);
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "art", "atlases.json"), "utf8"));

function pixels(png) {
	const out = [];
	for (let i = 0; i < png.width * png.height; i++) {
		const a = png.data[i * 4 + 3];
		if (a > 0) out.push({ x: i % png.width, y: Math.floor(i / png.width), rgb: [...png.data.subarray(i * 4, i * 4 + 3)], a });
	}
	return out;
}

const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

describe("gen-treasure-art: the cage", () => {
	it("is deterministic (byte-identical PNGs, so art/vendor.lock.json holds)", () => {
		for (const f of G.FACINGS) assert.deepEqual(G.renderCage(f), G.renderCage(f));
	});

	it("draws four facings on the canvas, opaque iron or brass pixels only, round the pivot", () => {
		assert.deepEqual(
			G.FACINGS.map((f) => f.dir),
			["NE", "NW", "SW", "SE"],
		);
		const palette = [...G.IRON, ...G.BRASS];
		for (const f of G.FACINGS) {
			const png = decode(G.renderCage(f));
			assert.equal(png.width, G.CAGE_W);
			assert.equal(png.height, G.CAGE_H);
			const px = pixels(png);
			assert.ok(px.length > 200, `${f.dir}: ${px.length} px`);
			for (const p of px) {
				assert.equal(p.a, 255);
				assert.ok(palette.some((c) => same(c, p.rgb)), `${f.dir} (${p.x}, ${p.y}) ${p.rgb}`);
			}
			// the cage stands round its pivot: pixels left, right and above it, and some below (the near tray)
			const xs = px.map((p) => p.x);
			const ys = px.map((p) => p.y);
			assert.ok(Math.min(...xs) < G.CAGE_PIVOT[0] - 12 && Math.max(...xs) > G.CAGE_PIVOT[0] + 12, f.dir);
			assert.ok(Math.min(...ys) < G.CAGE_PIVOT[1] - 20 && Math.max(...ys) > G.CAGE_PIVOT[1] + 8, f.dir);
			// nothing touches the canvas edge (the pipeline crops with a pad)
			assert.ok(Math.min(...xs) > 0 && Math.min(...ys) > 0 && Math.max(...xs) < G.CAGE_W - 1 && Math.max(...ys) < G.CAGE_H - 1, f.dir);
		}
	});

	it("shows the padlock only where the chest's front (-y) faces the camera (SW, SE)", () => {
		for (const f of G.FACINGS) {
			const png = decode(G.renderCage(f));
			const brass = pixels(png).filter((p) => G.BRASS.some((c) => same(c, p.rgb))).length;
			const front = G.turn([0, -1, 0], f.rotZ);
			const facing = front[0] * G.camera().back[0] + front[1] * G.camera().back[1] > 0;
			assert.equal(brass > 0, facing, `${f.dir}: ${brass} brass px`);
		}
		assert.deepEqual(
			G.FACINGS.filter((f) => decode(G.renderCage(f)).data.some((v, i) => i % 4 === 0 && v === G.BRASS[2][0])).map((f) => f.dir),
			["SW", "SE"],
		);
	});

	it("cuts what the chest hides: a point behind the box is hidden, one in front or above is not", () => {
		// in the chest's frame (rotZ 0) the camera sits at +x / -y, looking down: the far side is -x / +y
		const back = G.camera().back;
		assert.ok(back[0] > 0 && back[1] < 0 && back[2] > 0);
		assert.equal(G.hiddenByChest([0, G.CAGE.hy, 0.3], back), true); // the far long side, mid-height
		assert.equal(G.hiddenByChest([-0.53, 0.37, 0.2], back), true); // the far corner, low
		assert.equal(G.hiddenByChest([0, G.CAGE.hy, G.CAGE.shoulder], back), false); // the far shoulder, above the lid
		assert.equal(G.hiddenByChest([0.53, -0.37, 0.2], back), false); // the near corner
		assert.equal(G.hiddenByChest([0, 0, G.CHEST_BOX.h + 0.05], back), false); // over the lid
	});

	it("art/atlases.json's treasure.cage reads the generator's files at its pivot", () => {
		const cage = CONFIG.treasure.cage;
		assert.deepEqual(cage.pivot, G.FACINGS.map(() => G.CAGE_PIVOT));
		assert.equal(cage.facings.count, G.FACINGS.length);
		assert.equal(cage.animations.idle.file, "kaleb-vale/vault-cage/{dir}/cage_{dir}_{angle}_{f}.png");
	});
});

describe("gen-treasure-art: the light column", () => {
	it("is deterministic", () => {
		assert.deepEqual(G.renderColumnStrip(), G.renderColumnStrip());
	});

	it("is a strip of COLUMN_FRAMES white frames with stepped alpha, every frame visible and the loop moving", () => {
		const png = decode(G.renderColumnStrip());
		assert.equal(png.width, G.COLUMN_W * G.COLUMN_FRAMES);
		assert.equal(png.height, G.COLUMN_H);
		const frames = [];
		for (let f = 0; f < G.COLUMN_FRAMES; f++) {
			const alpha = [];
			for (let y = 0; y < G.COLUMN_H; y++) {
				for (let x = 0; x < G.COLUMN_W; x++) {
					const i = (y * png.width + f * G.COLUMN_W + x) * 4;
					const a = png.data[i + 3];
					assert.ok(G.STEPS.includes(a), `frame ${f} (${x}, ${y}) alpha ${a}`);
					if (a > 0) assert.deepEqual([png.data[i], png.data[i + 1], png.data[i + 2]], [255, 255, 255]);
					alpha.push(a);
				}
			}
			assert.ok(alpha.some((a) => a === 255), `frame ${f} has a core`);
			frames.push(alpha.join(","));
		}
		assert.equal(new Set(frames).size, G.COLUMN_FRAMES, "every frame differs");
		// the core runs up the middle at the foot of every frame
		const mid = Math.floor(G.COLUMN_W / 2);
		for (let f = 0; f < G.COLUMN_FRAMES; f++) assert.equal(png.data[((G.COLUMN_H - 10) * png.width + f * G.COLUMN_W + mid) * 4 + 3], 255);
	});

	it("art/atlases.json's fx.treasure.column copies the generator's strip", () => {
		const c = CONFIG.treasure.column;
		assert.deepEqual([c.frameW, c.frames, c.fps, c.loop, c.grey], [G.COLUMN_W, G.COLUMN_FRAMES, G.COLUMN_FPS, true, true]);
		assert.equal(c.file, "kaleb-vale/treasure-column/column.png");
	});
});

// Specs for the atlas pipeline's secret group (docs/SECRET_ROOMS.md SR11; npm run test:art): the generator's strips (put
// in the pipeline's source cache, so no files are needed) packed into one sheet whose cells read back exactly, the world
// layouts (one facing, Pixelated, idle) and the effect layout (grey, play), the grey check, the config checks, the lock
// scope, and that the committed secretLayout.ts is what the group builds.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it, beforeEach } = require("node:test");
const { PNG } = require("pngjs");
const A = require("./build-atlases.js");
const G = require("./gen-secret-art.js");

const ROOT = path.join(__dirname, "..", "..");
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "art", "atlases.json"), "utf8"));
const GROUP = CONFIG.secret;
const STRIPS = { crack: "kaleb-vale/secret/crack.png", rubble: "kaleb-vale/secret/rubble.png", dust: "kaleb-vale/secret/dust.png" };

function cacheStrips(edit) {
	for (const [name, rel] of Object.entries(STRIPS)) {
		const png = PNG.sync.read(G.renderStrip(name));
		const data = new Uint8Array(png.data);
		if (edit) edit(name, png.width, data);
		A.sourceCache.set(rel, { w: png.width, h: png.height, data });
	}
}

/** Frame f's cell origin in the packed sheet through a layout's formula. */
function cellAt(sheetW, l, start, f) {
	const perRow = Math.floor(sheetW / l.frameW);
	const c = start + f;
	return [(c % perRow) * l.frameW, Math.floor(c / perRow) * l.frameH];
}

describe("secret group", () => {
	beforeEach(() => cacheStrips());

	it("lists its three strips as its sources (and the full build's lock includes them)", () => {
		assert.deepEqual(A.secretSourceFiles(GROUP), Object.values(STRIPS).sort());
		assert.deepEqual(A.secretSourceFiles(undefined), []);
	});

	it("packs every frame so its layout cell reads back the generator's frame exactly", () => {
		const t = A.buildSecret(GROUP);
		const cases = [
			[t.art["secret.crack"], t.art["secret.crack"].animations.idle.start, "crack"],
			[t.art["secret.rubble"], t.art["secret.rubble"].animations.idle.start, "rubble"],
			[t.fx["fx.secret.dust"], t.fx["fx.secret.dust"].start, "dust"],
		];
		for (const [l, start, strip] of cases) {
			for (let f = 0; f < G.STRIPS[strip].frames; f++) {
				const src = G.drawFrame(strip, f);
				const [ox, oy] = cellAt(t.packed.img.w, l, start, f);
				for (let y = 0; y < l.frameH; y++) {
					for (let x = 0; x < l.frameW; x++) {
						const i = y * src.w + x;
						const o = ((oy + y) * t.packed.img.w + ox + x) * 4;
						assert.equal(t.packed.img.data[o + 3], src.alpha[i], `${strip} ${f} alpha at ${x},${y}`);
						if (src.alpha[i] > 0) assert.equal(t.packed.img.data[o], src.lum[i], `${strip} ${f} lum at ${x},${y}`);
					}
				}
			}
		}
	});

	it("carries the generator's geometry: world sets one-facing Pixelated idle; the dust a grey play flipbook", () => {
		const t = A.buildSecret(GROUP);
		assert.equal(t.file, "secret.png");
		assert.deepEqual(Object.keys(t.art), ["secret.crack", "secret.rubble"]);
		assert.deepEqual(Object.keys(t.fx), ["fx.secret.dust"]);
		for (const id of Object.keys(t.art)) {
			const l = t.art[id];
			assert.deepEqual([l.kind, l.resample, l.facings, l.pixelsPerTile], ["sprites", "Pixelated", { count: 1, zeroDeg: 0, ccw: true }, G.TILE_PX]);
			assert.deepEqual(l.sheets, [{ file: "secret.png", w: t.packed.w, h: t.packed.h }]);
			assert.deepEqual(Object.keys(l.animations), ["idle"]);
		}
		const c = t.art["secret.crack"];
		assert.deepEqual([c.frameW, c.frameH, c.pivot], [G.CRACK_W, G.CRACK_H, G.CRACK_PIVOT]);
		assert.equal(c.animations.idle.frames, G.CRACK_VARIANTS);
		const r = t.art["secret.rubble"];
		assert.deepEqual([r.frameW, r.frameH, r.pivot], [G.RUBBLE_W, G.RUBBLE_H, G.RUBBLE_PIVOT]);
		const d = t.fx["fx.secret.dust"];
		assert.deepEqual([d.frameW, d.frameH, d.pivot, d.frames, d.fps, d.loop, d.grey], [G.DUST_W, G.DUST_H, G.DUST_PIVOT, G.DUST_FRAMES, G.DUST_FPS, false, true]);
	});

	it("rejects a pixel that is not grey, an unknown set, a wrong animation, a strip of the wrong size", () => {
		cacheStrips((name, w, data) => {
			if (name === "rubble") {
				const i = data.findIndex((_, k) => k % 4 === 3 && data[k] > 0) - 3;
				data[i] = 7;
			}
		});
		assert.throws(() => A.buildSecret(GROUP), /not grey/);
		cacheStrips();
		const bad = (edit) => {
			const g = JSON.parse(JSON.stringify(GROUP));
			edit(g);
			return () => A.buildSecret(g);
		};
		assert.throws(bad((g) => (g.sets["secret.chest"] = g.sets["secret.rubble"])), /unknown set/);
		assert.throws(bad((g) => (g.sets["secret.crack"].animations = { play: g.sets["secret.crack"].animations.idle })), /exactly \{ idle \}/);
		assert.throws(bad((g) => (g.sets["fx.secret.dust"].animations = { idle: g.sets["fx.secret.dust"].animations.play })), /exactly \{ play \}/);
		assert.throws(bad((g) => (g.sets["secret.rubble"].canvas = [63, 32])), /px wide/);
		assert.throws(bad((g) => (g.sets["secret.crack"].animations.idle.extra = 1)), /unknown key extra/);
		assert.throws(bad((g) => (g.extra = 1)), /unknown key extra/);
	});

	it("the committed secretLayout.ts is what the group builds", () => {
		const t = A.buildSecret(GROUP);
		const committed = fs.readFileSync(path.join(ROOT, "src", "shared", "theme", "packs", "vale", "secretLayout.ts"), "utf8");
		assert.equal(A.secretLayoutModule(t), committed);
	});

	it("draws a contact sheet with every cell", () => {
		const t = A.buildSecret(GROUP);
		const c = A.secretContact(t);
		assert.ok(c.w > 0 && c.h > 0);
	});
});

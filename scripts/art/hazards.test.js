// Specs for the atlas pipeline's hazards group (docs/HAZARD_ART.md HA2; npm run test:art): the generator's strips
// (put in the pipeline's source cache, so no files are needed) packed into one sheet whose cells read back exactly,
// the layout's pivot / rimPx / lit / animations, the grey check, the config checks, and that the committed
// hazardLayout.ts is what the group builds.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it, beforeEach } = require("node:test");
const { PNG } = require("pngjs");
const A = require("./build-atlases.js");
const G = require("./gen-hazard-art.js");

const ROOT = path.join(__dirname, "..", "..");
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "art", "atlases.json"), "utf8"));
const GROUP = CONFIG.hazards;
const STRIPS = { strike_flash: "kaleb-vale/hazards/strike_flash.png", strike_scorch: "kaleb-vale/hazards/strike_scorch.png", ember_burn: "kaleb-vale/hazards/ember_burn.png" };

function cacheStrips(edit) {
	for (const [name, rel] of Object.entries(STRIPS)) {
		const png = PNG.sync.read(G.renderStrip(name));
		const data = new Uint8Array(png.data);
		if (edit) edit(name, png.width, data);
		A.sourceCache.set(rel, { w: png.width, h: png.height, data });
	}
}

describe("hazards group", () => {
	beforeEach(() => cacheStrips());

	it("lists its three strips as its sources", () => {
		assert.deepEqual(A.hazardSourceFiles(GROUP), Object.values(STRIPS).sort());
		assert.deepEqual(A.hazardSourceFiles(undefined), []);
	});

	it("packs every frame so its layout cell reads back the generator's frame exactly", () => {
		const h = A.buildHazards(GROUP, undefined);
		const anims = { "bullet.enemy.strike": { flash: "strike_flash", scorch: "strike_scorch" }, "bullet.player.ember": { burn: "ember_burn" } };
		for (const [id, byAnim] of Object.entries(anims)) {
			const l = h.layouts[id];
			const perRow = Math.floor(h.packed.img.w / l.frameW);
			for (const [anim, strip] of Object.entries(byAnim)) {
				const a = l.animations[anim];
				assert.equal(a.frames, G.STRIPS[strip].frames);
				for (let f = 0; f < a.frames; f++) {
					const src = G.drawFrame(strip, f);
					const c = a.start + f;
					const ox = (c % perRow) * l.frameW;
					const oy = Math.floor(c / perRow) * l.frameH;
					for (let y = 0; y < l.frameH; y++) {
						for (let x = 0; x < l.frameW; x++) {
							const i = y * src.w + x;
							const o = ((oy + y) * h.packed.img.w + ox + x) * 4;
							assert.equal(h.packed.img.data[o + 3], src.alpha[i], `${id} ${anim} ${f} alpha at ${x},${y}`);
							if (src.alpha[i] > 0) assert.equal(h.packed.img.data[o], src.lum[i], `${id} ${anim} ${f} lum at ${x},${y}`);
						}
					}
				}
			}
		}
	});

	it("carries the generator's geometry: canvas, pivot, the strike's rim, the ember's patch, grey means", () => {
		const h = A.buildHazards(GROUP, undefined);
		const s = h.layouts["bullet.enemy.strike"];
		assert.deepEqual([s.frameW, s.frameH], [G.STRIKE_SIZE, G.STRIKE_SIZE]);
		assert.deepEqual(s.pivot, G.STRIKE_PIVOT);
		assert.equal(s.rimPx, G.STRIKE_R);
		assert.equal(s.lit, undefined);
		const e = h.layouts["bullet.player.ember"];
		assert.deepEqual([e.frameW, e.frameH], [G.EMBER_W, G.EMBER_H]);
		assert.deepEqual(e.pivot, G.EMBER_PIVOT);
		assert.deepEqual(e.lit, G.EMBER_LIT);
		assert.equal(e.rimPx, undefined);
		assert.equal(e.animations.burn.loop, true);
		assert.equal(s.animations.flash.loop, false);
		for (const l of [s, e]) assert.match(l.meanColor, /^#([0-9a-f]{2})\1\1$/);
		assert.deepEqual(Object.keys(h.layouts), ["bullet.enemy.strike", "bullet.player.ember"]);
	});

	it("rejects a pixel that is not grey, an unknown hazard, a misplaced rimPx or lit, a strip of the wrong size", () => {
		cacheStrips((name, w, data) => {
			if (name === "ember_burn") {
				const i = data.findIndex((_, k) => k % 4 === 3 && data[k] > 0) - 3;
				data[i] = 7;
			}
		});
		assert.throws(() => A.buildHazards(GROUP, undefined), /not grey/);
		cacheStrips();
		const bad = (edit) => {
			const g = JSON.parse(JSON.stringify(GROUP));
			edit(g);
			return () => A.buildHazards(g, undefined);
		};
		assert.throws(bad((g) => (g.sets["bullet.enemy.goo"] = g.sets["bullet.player.ember"])), /unknown hazard/);
		assert.throws(bad((g) => (g.sets["bullet.player.ember"].rimPx = 3)), /only the strike takes rimPx/);
		assert.throws(bad((g) => (g.sets["bullet.enemy.strike"].lit = [3, 3])), /only the ember takes lit/);
		assert.throws(bad((g) => delete g.sets["bullet.enemy.strike"].rimPx), /rimPx/);
		assert.throws(bad((g) => (g.sets["bullet.player.ember"].canvas = [18, 31])), /px wide/);
		assert.throws(bad((g) => (g.sets["bullet.player.ember"].animations.burn.extra = 1)), /unknown key extra/);
	});

	it("the committed hazardLayout.ts is what the group builds", () => {
		const h = A.buildHazards(GROUP, undefined);
		const committed = fs.readFileSync(path.join(ROOT, "src", "shared", "theme", "packs", "vale", "hazardLayout.ts"), "utf8");
		assert.equal(A.hazardLayoutModule(h.sheet, h.layouts), committed);
	});

	it("draws a contact sheet with every cell", () => {
		const h = A.buildHazards(GROUP, undefined);
		const c = A.hazardContact(h);
		assert.ok(c.w > 0 && c.h > 0);
	});
});

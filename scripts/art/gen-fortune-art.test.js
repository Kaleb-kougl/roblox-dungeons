// Specs for the generated Fortune art (scripts/art/gen-fortune-art.js; npm run test:art; docs/FORTUNE.md FO10):
// deterministic; the altar drawn in the vault's projection (the same camera as gen-treasure-art.js, its body centred on
// its pivot, only ramp colours or the floor shadow's black), the coin burst a greyscale flipbook that moves and stays
// centred on the hit, and the numbers art/atlases.json's `fortune` group and the view copy in step with the generator.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");
const { PNG } = require("pngjs");
const G = require("./gen-fortune-art.js");
const T = require("./gen-treasure-art.js");

const ROOT = path.join(__dirname, "..", "..");
const decode = (buf) => PNG.sync.read(buf);
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "art", "atlases.json"), "utf8"));

function pixels(png, x0 = 0, w = png.width) {
	const out = [];
	for (let y = 0; y < png.height; y++) {
		for (let x = x0; x < x0 + w; x++) {
			const i = (y * png.width + x) * 4;
			const a = png.data[i + 3];
			if (a > 0) out.push({ x: x - x0, y, rgb: [...png.data.subarray(i, i + 3)], a });
		}
	}
	return out;
}

const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

describe("gen-fortune-art: the altar", () => {
	it("is deterministic (byte-identical PNGs, so art/vendor.lock.json holds)", () => {
		assert.deepEqual(G.renderAltar(), G.renderAltar());
	});

	it("uses the vault's camera", () => {
		assert.deepEqual(G.camera(), T.camera());
	});

	it("draws opaque stone / iron / coal pixels round its pivot, and a black floor shadow at the shadow alphas", () => {
		const png = decode(G.renderAltar());
		assert.deepEqual([png.width, png.height], [G.ALTAR_W, G.ALTAR_H]);
		const palette = [...G.STONE, ...G.IRON, ...G.COALS];
		const px = pixels(png);
		const body = px.filter((p) => p.a === 255);
		assert.ok(body.length > 300, `${body.length} body px`);
		for (const p of body)
			assert.ok(
				palette.some((c) => same(c, p.rgb)),
				`(${p.x}, ${p.y}) ${p.rgb}`,
			);
		for (const p of px.filter((q) => q.a < 255)) {
			assert.ok(G.SHADOW_ALPHA.includes(p.a), `(${p.x}, ${p.y}) alpha ${p.a}`);
			assert.deepEqual(p.rgb, [0, 0, 0]);
		}
		// round: the body is centred on the pivot's column (within a pixel), it stands above the pivot and its foot
		// reaches below it (the near half of the footprint)
		const xs = body.map((p) => p.x);
		const ys = body.map((p) => p.y);
		assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs) + 1) / 2 - G.ALTAR_PIVOT[0]) <= 1);
		assert.ok(Math.min(...ys) < G.ALTAR_PIVOT[1] - 15 && Math.max(...ys) > G.ALTAR_PIVOT[1] + 5);
		// nothing touches the canvas edge (the pipeline crops with a pad)
		const all = px.map((p) => [p.x, p.y]);
		assert.ok(all.every(([x, y]) => x > 0 && y > 0 && x < G.ALTAR_W - 1 && y < G.ALTAR_H - 1));
	});

	it("shows the coal bed (where the view's flame stands) and the bowl's lit lip", () => {
		const px = pixels(decode(G.renderAltar())).filter((p) => p.a === 255);
		assert.ok(px.filter((p) => G.COALS.some((c) => same(c, p.rgb))).length > 20);
		assert.ok(px.some((p) => same(p.rgb, G.IRON[6])));
		// the coals' screen spot: the cell centre at ALTAR.coals tiles up
		const cam = G.camera();
		const y = Math.floor(G.ALTAR_PIVOT[1] - G.ALTAR.coals * cam.up[2] * G.TILE_PX);
		const at = px.find((p) => p.x === G.ALTAR_PIVOT[0] && p.y === y);
		assert.ok(at && G.COALS.some((c) => same(c, at.rgb)), `(${G.ALTAR_PIVOT[0]}, ${y}) is coal`);
	});

	it("the coal bed lies in the bowl (above the cap, under the lip)", () => {
		const bowl = G.ALTAR.parts.find((p) => p.name === "bowl");
		assert.ok(G.ALTAR.coals > bowl.z0 && G.ALTAR.coals < bowl.z1);
		assert.ok(G.field([0, 0, G.ALTAR.coals - 0.01]).d < 0);
		assert.ok(G.field([0, 0, G.ALTAR.coals + 0.02]).d > 0);
	});

	it("art/atlases.json's fortune.altar reads the generator's file at its pivot", () => {
		const altar = CONFIG.fortune.altar;
		assert.deepEqual(altar.pivot, [G.ALTAR_PIVOT]);
		assert.equal(altar.animations.idle.file, "kaleb-vale/pact-altar/altar_{f}.png");
		assert.deepEqual(altar.animations.idle.frames, [0]);
	});
});

describe("gen-fortune-art: the coin burst", () => {
	it("is deterministic", () => {
		assert.deepEqual(G.renderCoinStrip(), G.renderCoinStrip());
	});

	it("is a strip of COIN_FRAMES opaque grey frames on COIN_GREY, every frame visible and different", () => {
		const png = decode(G.renderCoinStrip());
		assert.deepEqual([png.width, png.height], [G.COIN_W * G.COIN_FRAMES, G.COIN_H]);
		const frames = [];
		for (let f = 0; f < G.COIN_FRAMES; f++) {
			const px = pixels(png, f * G.COIN_W, G.COIN_W);
			assert.ok(px.length > 20, `frame ${f}: ${px.length} px`);
			for (const p of px) {
				assert.equal(p.a, 255);
				assert.ok(
					G.COIN_GREY.includes(p.rgb[0]) && p.rgb[0] === p.rgb[1] && p.rgb[1] === p.rgb[2],
					`frame ${f} ${p.rgb}`,
				);
			}
			frames.push(px.map((p) => `${p.x},${p.y},${p.rgb[0]}`).join(";"));
		}
		assert.equal(new Set(frames).size, G.COIN_FRAMES, "every frame differs");
	});

	it("spreads out from the hit and stays centred on it (the pipeline puts the union box's centre on the hit)", () => {
		const png = decode(G.renderCoinStrip());
		const spread = (f) => {
			const px = pixels(png, f * G.COIN_W, G.COIN_W);
			return Math.max(...px.map((p) => Math.hypot(p.x - G.COIN_W / 2, p.y - G.COIN_H / 2)));
		};
		assert.ok(spread(G.COIN_FRAMES - 1) > spread(0) + 6);
		const all = [];
		for (let f = 0; f < G.COIN_FRAMES; f++) all.push(...pixels(png, f * G.COIN_W, G.COIN_W));
		const xs = all.map((p) => p.x);
		const ys = all.map((p) => p.y);
		const hit = [Math.floor(G.COIN_W / 2) + 0.5, Math.floor(G.COIN_H / 2) + 0.5];
		assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs) + 1) / 2 - hit[0]) <= 2);
		assert.ok(Math.abs((Math.min(...ys) + Math.max(...ys) + 1) / 2 - hit[1]) <= 2);
		assert.ok(xs.every((x) => x > 0 && x < G.COIN_W - 1) && ys.every((y) => y > 0 && y < G.COIN_H - 1));
	});

	it("art/atlases.json's fortune.coin copies the generator's strip", () => {
		const c = CONFIG.fortune.coin;
		assert.deepEqual(
			[c.frameW, c.frames, c.fps, c.loop, c.grey],
			[G.COIN_W, G.COIN_FRAMES, G.COIN_FPS, false, true],
		);
		assert.equal(c.file, "kaleb-vale/golden-coin/coin.png");
	});
});

describe("gen-fortune-art: the view's flame", () => {
	it("PACTS_VIEW.artTopTiles is the generator's coal bed", () => {
		const src = fs.readFileSync(path.join(ROOT, "src", "shared", "view", "pacts", "config.ts"), "utf8");
		const m = /artTopTiles:\s*([0-9.]+)/.exec(src);
		assert.ok(m, "PACTS_VIEW.artTopTiles");
		assert.equal(Number(m[1]), G.ALTAR.coals);
	});
});

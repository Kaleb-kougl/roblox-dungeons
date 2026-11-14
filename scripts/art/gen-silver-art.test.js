// Specs for Silver's art (scripts/art/gen-silver-art.js; npm run test:art; docs/SILVER.md SV7): deterministic; the icon
// an outlined octagonal coin on the counter's 12 x 12 box in its own colours (eight-sided, not round: never the score's
// gold coin), with the crescent stamped on its face; the flying coin a greyscale looping turn whose width falls to the
// edge and back, its face brighter than its back; and art/atlases.json's `silver` group in step with the generator.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");
const { PNG } = require("pngjs");
const G = require("./gen-silver-art.js");
const BOON = require("./gen-boon-icons.js");

const ROOT = path.join(__dirname, "..", "..");
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "art", "atlases.json"), "utf8"));

/** Opaque pixel columns of frame `f` of the coin strip, and its grey levels. */
function coinFrame(png, f) {
	const cols = new Set();
	const greys = new Set();
	for (let y = 0; y < G.COIN_H; y++) {
		for (let x = 0; x < G.COIN_W; x++) {
			const i = (y * png.width + f * G.COIN_W + x) * 4;
			if (png.data[i + 3] === 0) continue;
			cols.add(x);
			greys.add(png.data[i]);
			assert.equal(png.data[i], png.data[i + 1]);
			assert.equal(png.data[i], png.data[i + 2]);
		}
	}
	return { width: cols.size, greys };
}

describe("gen-silver-art: the icon", () => {
	it("is deterministic", () => {
		assert.deepEqual(G.renderIcon(), G.renderIcon());
	});

	it("is ICON x ICON, outlined on every side, in its own colours only", () => {
		const rows = G.drawIconMap();
		assert.equal(rows.length, G.ICON);
		for (const r of rows) assert.equal(r.length, G.ICON);
		const png = PNG.sync.read(G.renderIcon());
		assert.deepEqual([png.width, png.height], [G.ICON, G.ICON]);
		// every edge row / column holds outline only (or nothing): the 1 px border is never clipped
		for (let k = 0; k < G.ICON; k++) {
			for (const ch of [rows[0][k], rows[G.ICON - 1][k], rows[k][0], rows[k][G.ICON - 1]]) assert.ok(ch === "." || ch === "o");
		}
		for (const r of rows) for (const ch of r) assert.ok(ch === "." || G.ICON_COLOURS[ch] !== undefined, ch);
		assert.deepEqual(G.ICON_COLOURS.o, BOON.OUTLINE);
	});

	it("is eight-sided: its corners cut on the diagonal, its sides straight across the middle", () => {
		const rows = G.drawIconMap();
		const span = (r) => [r.search(/[^.]/), r.length - 1 - [...r].reverse().join("").search(/[^.]/)];
		const top = span(rows[0]);
		const mid = span(rows[G.ICON >> 1]);
		assert.ok(top[1] - top[0] + 1 <= G.ICON / 2, `top row ${rows[0]}`);
		assert.deepEqual(mid, [0, G.ICON - 1]);
		// straight sides: the outline holds the full width over several middle rows
		let full = 0;
		for (const r of rows) if (r[0] === "o" && r[G.ICON - 1] === "o") full++;
		assert.ok(full >= 3, `${full} full-width rows`);
	});

	it("is stamped: the crescent's colour, inside the rim, and lit from the top left", () => {
		const rows = G.drawIconMap();
		const count = (ch) => rows.join("").split(ch).length - 1;
		assert.ok(count("b") >= 6, "the crescent");
		assert.ok(count("e") > 0 && count("a") > 0);
		// the light on the upper left of the rim, the shadow on the lower right
		const firstE = rows.findIndex((r) => r.includes("e"));
		const lastA = rows.length - 1 - [...rows].reverse().findIndex((r) => r.includes("a"));
		assert.ok(firstE < lastA);
	});
});

describe("gen-silver-art: the flying coin", () => {
	it("is deterministic", () => {
		assert.deepEqual(G.renderCoinStrip(), G.renderCoinStrip());
	});

	it("is COIN_FRAMES greyscale frames side by side", () => {
		const png = PNG.sync.read(G.renderCoinStrip());
		assert.deepEqual([png.width, png.height], [G.COIN_W * G.COIN_FRAMES, G.COIN_H]);
		for (let f = 0; f < G.COIN_FRAMES; f++) {
			for (const g of coinFrame(png, f).greys) assert.ok(G.COIN_GREY.includes(g), `frame ${f}: grey ${g}`);
		}
	});

	it("turns: full width face on, the edge at a quarter turn, full width again at half a turn, a loop", () => {
		const png = PNG.sync.read(G.renderCoinStrip());
		const widths = [...Array(G.COIN_FRAMES).keys()].map((f) => coinFrame(png, f).width);
		const quarter = G.COIN_FRAMES / 4;
		assert.equal(widths[0], G.COIN_W);
		assert.equal(widths[2 * quarter], G.COIN_W);
		assert.equal(widths[quarter], G.COIN_EDGE + 2);
		assert.equal(widths[3 * quarter], G.COIN_EDGE + 2);
		assert.ok(widths[1] < widths[0] && widths[1] > widths[quarter]);
		// the last frame leads back into the first (a loop): as wide as the second
		assert.equal(widths[G.COIN_FRAMES - 1], widths[1]);
	});

	it("shows its face brighter than its back (the turn reads)", () => {
		const face = G.renderCoinFrame(0);
		const back = G.renderCoinFrame(G.COIN_FRAMES / 2);
		const sum = (lv) => lv.reduce((n, v) => n + (v > 0 ? v : 0), 0);
		assert.ok(sum(face) > sum(back));
	});
});

describe("gen-silver-art: art/atlases.json", () => {
	it("the silver group reads the generator's files at its sizes", () => {
		const g = CONFIG.silver;
		const icon = g.icon.icons["ui.icon.silver"];
		assert.equal(icon.file, "kaleb-vale/silver/icon.png");
		assert.deepEqual(icon.rect, [0, 0, G.ICON, G.ICON]);
		assert.equal(g.coin.file, "kaleb-vale/silver/coin.png");
		assert.deepEqual([g.coin.frameW, g.coin.frames, g.coin.fps, g.coin.loop, g.coin.grey], [G.COIN_W, G.COIN_FRAMES, G.COIN_FPS, true, true]);
		assert.notEqual(g.icon.atlas, g.coin.atlas);
	});
});

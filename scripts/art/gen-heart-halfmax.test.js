// Specs for the half-heart containers (scripts/art/gen-heart-halfmax.js; npm run test:art; docs/SILVER.md OC18): the
// cut on a synthetic heart (the left half kept exactly, the right half cleared, the cut closed by a straight edge in the
// heart's own edge colour, the tip kept), and, where the ToffeeCraft sheet is on this machine, the real pieces: the
// hearts' 18 x 15 box, the full container's fill exactly the full heart's left half, the empty one's the empty heart's,
// nothing right of the edge, byte-identical PNGs on every run.
"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const G = require("./gen-heart-halfmax.js");

const { W, H } = G;

/** A synthetic heart: every pixel (x, y) is [x, y, 7, alpha] with alpha 255 inside, 100 on columns 0 and W - 1. */
function synthetic() {
	const px = Buffer.alloc(W * H * 4);
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			const i = (y * W + x) * 4;
			px[i] = x;
			px[i + 1] = y;
			px[i + 2] = 7;
			px[i + 3] = x === 0 || x === W - 1 ? 100 : 255;
		}
	}
	return px;
}

const at = (px, x, y) => [...px.subarray((y * W + x) * 4, (y * W + x) * 4 + 4)];

describe("halfContainer", () => {
	const src = synthetic();
	const out = G.halfContainer(src);

	it("keeps the left half exactly", () => {
		for (let y = 0; y < H; y++) for (let x = 0; x < G.KEEP_COLUMNS; x++) assert.deepEqual(at(out, x, y), at(src, x, y));
	});

	it("clears everything right of the closing edge, and the edge column outside its rows and the tip", () => {
		for (let y = 0; y < H; y++) {
			for (let x = G.EDGE_X + 1; x < W; x++) assert.equal(at(out, x, y)[3], 0, `(${x}, ${y})`);
			const onEdge = (y >= G.EDGE_FIRST_ROW && y <= G.EDGE_LAST_ROW) || y === G.TIP_ROW;
			if (!onEdge) assert.equal(at(out, G.EDGE_X, y)[3], 0, `edge (${G.EDGE_X}, ${y})`);
		}
	});

	it("closes the cut in the heart's own edge colour and keeps the tip", () => {
		// The mean of columns 0 and W - 1 on rows 3-6: x (0 and 17) -> 8.5 -> 9 (round half up), y 3-6 -> 4.5 -> 5.
		assert.deepEqual(G.edgeColour(src), [9, 5, 7, 100]);
		for (let y = G.EDGE_FIRST_ROW; y <= G.EDGE_LAST_ROW; y++) assert.deepEqual(at(out, G.EDGE_X, y), [9, 5, 7, 100]);
		assert.deepEqual(at(out, G.EDGE_X, G.TIP_ROW), at(src, G.EDGE_X, G.TIP_ROW));
	});

	it("refuses a piece that is not the hearts' size", () => {
		assert.throws(() => G.halfContainer(Buffer.alloc(16 * 15 * 4)));
	});

	it("reads the source rects from art/atlases.json at the hearts' size", () => {
		const s = G.sources();
		for (const id of ["ui.heart.full", "ui.heart.empty"]) assert.deepEqual(s.rects[id].slice(2), [W, H]);
	});
});

const sheet = G.readSheet();

describe("the real pieces (needs the ToffeeCraft sheet in art/vendor)", { skip: sheet === undefined }, () => {
	const pieces = sheet !== undefined ? G.buildAll(sheet) : {};

	it("each container is the left half of its heart, with nothing right of the edge", () => {
		for (const [id, from] of G.ICONS) {
			const out = pieces[id];
			const heart = pieces[from];
			assert.equal(out.length, W * H * 4);
			for (let y = 0; y < H; y++) {
				for (let x = 0; x < G.KEEP_COLUMNS; x++) assert.deepEqual(at(out, x, y), at(heart, x, y), `${id} (${x}, ${y})`);
				for (let x = G.EDGE_X + 1; x < W; x++) assert.equal(at(out, x, y)[3], 0, `${id} (${x}, ${y})`);
			}
		}
	});

	it("the edge is darker than the fill beside it and at the heart's outline alpha", () => {
		for (const [id, from] of G.ICONS) {
			const edge = G.edgeColour(pieces[from]);
			const fill = at(pieces[id], G.KEEP_COLUMNS - 1, 6);
			assert.ok(edge[0] < fill[0], `${id}: edge red ${edge[0]} vs fill ${fill[0]}`);
			assert.ok(edge[3] > 0 && edge[3] < 255, `${id}: edge alpha ${edge[3]}`);
		}
	});

	it("encodes byte-identical PNGs", () => {
		for (const id of G.HEART_IDS) assert.deepEqual(G.encode(pieces[id]), G.encode(Buffer.from(pieces[id])));
		const again = G.buildAll(sheet);
		for (const id of G.HEART_IDS) assert.deepEqual(again[id], pieces[id]);
	});
});

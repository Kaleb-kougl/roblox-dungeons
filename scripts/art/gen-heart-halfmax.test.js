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

describe("the heartIcons atlas group (docs/SILVER.md SV16)", () => {
	const fs = require("node:fs");
	const path = require("node:path");
	const A = require("./build-atlases.js");
	const ROOT = path.join(__dirname, "..", "..");
	const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "art", "atlases.json"), "utf8"));
	const LAYOUT = path.join(ROOT, "src", "shared", "theme", "packs", "vale", "heartIconLayout.ts");
	const vendorFile = (file) => `kaleb-vale/heart-icons/${file}`;

	it("lists both containers once, as the whole 18 x 15 canvas, matching shared/theme HEART_ICON_IDS", () => {
		const group = CONFIG.heartIcons;
		assert.equal(group.atlas, "heart-icons");
		assert.deepEqual(Object.keys(group.icons).sort(), [...G.HEART_IDS].sort());
		for (const [id, , file] of G.ICONS) assert.deepEqual(group.icons[id], { file: vendorFile(file), rect: [0, 0, W, H] });
		assert.deepEqual(A.heartIconSourceFiles(group), G.ICONS.map((e) => vendorFile(e[2])).sort());
		assert.ok(A.sourceFiles(CONFIG).includes(vendorFile(G.ICONS[0][2])));
		assert.equal(A.onlyGroup(["node", "x", "--only", "heartIcons"]), "heartIcons");
		assert.deepEqual(A.heartIconSourceFiles(undefined), []);
		const src = fs.readFileSync(path.join(ROOT, "src", "shared", "theme", "heartIcons.ts"), "utf8");
		for (const id of G.HEART_IDS) assert.ok(src.includes(`"${id}"`), `${id} not in heartIcons.ts`);
	});

	it("builds the committed heartIconLayout.ts from two containers, each read back intact", () => {
		const pieces = {};
		for (const [id, , file] of G.ICONS) {
			pieces[id] = G.halfContainer(synthetic());
			A.sourceCache.set(vendorFile(file), { w: W, h: H, data: new Uint8Array(pieces[id]) });
		}
		const icons = A.buildHeartIcons(CONFIG.heartIcons);
		assert.equal(icons.file, "heart-icons.png");
		assert.equal(A.heartIconLayoutModule(icons), fs.readFileSync(LAYOUT, "utf8"));
		for (const id of G.HEART_IDS) {
			const r = icons.layouts[id].rect;
			assert.deepEqual([r.w, r.h], [W, H]);
			for (let y = 0; y < H; y++) {
				for (let x = 0; x < W; x++) {
					const a = ((r.y + y) * icons.w + r.x + x) * 4;
					const want = at(pieces[id], x, y);
					if (want[3] === 0) assert.equal(icons.img.data[a + 3], 0, `${id} (${x}, ${y})`);
					else assert.deepEqual([...icons.img.data.subarray(a, a + 4)], want, `${id} (${x}, ${y})`);
				}
			}
		}
		for (const [, , file] of G.ICONS) A.sourceCache.delete(vendorFile(file));
	});

	it("takes ui.heart.halfmax* ids only", () => {
		A.sourceCache.set("synthetic/heart.png", { w: W, h: H, data: new Uint8Array(synthetic()) });
		const section = (id) => ({ atlas: "heart-test", icons: { [id]: { file: "synthetic/heart.png", rect: [0, 0, W, H] } } });
		assert.throws(() => A.buildHeartIcons(section("ui.heart.full")), /heart icon ids start with/);
		assert.doesNotThrow(() => A.buildHeartIcons(section("ui.heart.halfmax.test")));
		A.sourceCache.delete("synthetic/heart.png");
	});
});

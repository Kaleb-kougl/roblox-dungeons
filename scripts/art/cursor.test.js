// Specs for the gauntlet cursor's art (docs/CURSOR.md C1): an image pivot { x, y } in SOURCE pixels (converted to the
// cut image, checked inside it), the same-crop check across a variant family (`sameCropAs`), the family a scoped
// `--only <image id>` builds, its layout.ts merge (byte for byte a full layoutModule) and the pivot contact sheet.
// Synthetic rasters only, no art/vendor files.
"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { describe, it } = require("node:test");
const A = require("./build-atlases.js");

const LIT = [40, 40, 48, 255];
const GLOW = [246, 246, 246, 90];

/**
 * A 40 x 40 source: a lit 10 x 10 hand at (12..21, 14..23) inside a 1 px glow ring (11..22, 13..24) in `glow`, plus a
 * faint pixel (alpha 2, cut by noiseAlpha 2) at (2, 2). `grow` widens the glow one more column on the right.
 */
function hand(file, glow = GLOW, grow = false) {
	const img = A.raster(40, 40);
	for (let y = 13; y <= 24; y++) for (let x = 11; x <= (grow ? 23 : 22); x++) img.data.set(glow, (y * 40 + x) * 4);
	for (let y = 14; y <= 23; y++) for (let x = 12; x <= 21; x++) img.data.set(LIT, (y * 40 + x) * 4);
	img.data.set([255, 255, 255, 2], (2 * 40 + 2) * 4);
	A.sourceCache.set(file, img);
	return file;
}

/** A cursor-like `images` def over `file`: crop alpha, noiseAlpha 2, pad 2, pivot at the hand's top-left (12, 14). */
function cursorDef(file, name, extra) {
	return { file, name, crop: "alpha", noiseAlpha: 2, pad: 2, pivot: { x: 12, y: 14 }, ...extra };
}

describe("image pivot { x, y } in source pixels", () => {
	it("converts to the cut image: minus the crop's top-left (the glow box (11, 13) minus pad 2)", () => {
		const b = A.buildImage("ui.test", cursorDef(hand("cur/a.png"), "a"));
		assert.deepEqual(b.crop, { x: 9, y: 11, w: 16, h: 16 });
		assert.deepEqual(b.layout, { file: "a.png", w: 16, h: 16, pivot: { x: 3, y: 3 } });
		// the pivot names the hand's first lit pixel
		assert.deepEqual([...b.img.data.subarray((3 * 16 + 3) * 4, (3 * 16 + 3) * 4 + 4)], LIT);
	});

	it("follows a `rect` window: the crop's top-left is in file pixels, so the source pivot needs no change", () => {
		const file = hand("cur/rect.png");
		const b = A.buildImage("ui.test", cursorDef(file, "r", { rect: [5, 6, 30, 30] }));
		assert.deepEqual(b.crop, { x: 9, y: 11, w: 16, h: 16 });
		assert.deepEqual(b.layout.pivot, { x: 3, y: 3 });
		const none = A.buildImage("ui.test", { file, name: "n", crop: "none", rect: [10, 12, 14, 14], pivot: { x: 12, y: 14 } });
		assert.deepEqual(none.crop, { x: 10, y: 12, w: 14, h: 14 });
		assert.deepEqual(none.layout.pivot, { x: 2, y: 2 });
	});

	it("accepts a pivot on the image's edges (0 and w / h), like [x, y]", () => {
		const file = hand("cur/edge.png");
		assert.deepEqual(A.buildImage("ui.test", cursorDef(file, "e", { pivot: { x: 9, y: 11 } })).layout.pivot, { x: 0, y: 0 });
		assert.deepEqual(A.buildImage("ui.test", cursorDef(file, "e", { pivot: { x: 25, y: 27 } })).layout.pivot, { x: 16, y: 16 });
	});

	it("fails outside the cut image, or when malformed", () => {
		const file = hand("cur/bad.png");
		assert.throws(() => A.buildImage("ui.test", cursorDef(file, "b", { pivot: { x: 8, y: 14 } })), /ui\.test: pivot \{"x":8,"y":14\} \(source pixels\) is \(-1, 3\) in the 16x16 image cut at source \(9, 11\): outside it/);
		assert.throws(() => A.buildImage("ui.test", cursorDef(file, "b", { pivot: { x: 12, y: 28 } })), /is \(3, 17\) in the 16x16 image/);
		assert.throws(() => A.buildImage("ui.test", cursorDef(file, "b", { pivot: { x: 12 } })), /ui\.test: pivot \{"x":12\} must be \{ x, y \}/);
		assert.throws(() => A.buildImage("ui.test", cursorDef(file, "b", { pivot: { x: 12, y: 14, z: 0 } })), /must be \{ x, y \}/);
		assert.throws(() => A.buildImage("ui.test", cursorDef(file, "b", { pivot: { x: "12", y: 14 } })), /must be \{ x, y \}/);
	});

	it("leaves the [x, y] / center / bottom forms as they were", () => {
		const file = hand("cur/old.png");
		assert.deepEqual(A.buildImage("ui.test", cursorDef(file, "o", { pivot: [3, 3] })).layout.pivot, { x: 3, y: 3 });
		assert.deepEqual(A.buildImage("ui.test", cursorDef(file, "o", { pivot: "center" })).layout.pivot, { x: 8, y: 8 });
		assert.throws(() => A.buildImage("ui.test", cursorDef(file, "o", { pivot: "top" })), /unknown pivot top/);
	});
});

describe("sameCropAs (a variant family crops to one rect)", () => {
	const images = (hover) => ({ "ui.cur": cursorDef(hand("cur/white.png"), "cur"), "ui.cur.hover": hover });

	it("passes for a recoloured variant: same rect, size and pivot", () => {
		const built = A.buildImages(images(cursorDef(hand("cur/yellow.png", [250, 220, 60, 90]), "cur-hover", { sameCropAs: "ui.cur" })), []);
		assert.deepEqual(built.map((b) => b.id), ["ui.cur", "ui.cur.hover"]);
		assert.deepEqual(built[0].crop, built[1].crop);
		assert.deepEqual(built[0].layout.pivot, built[1].layout.pivot);
		assert.notEqual(Buffer.compare(A.encodePng(built[0].img), A.encodePng(built[1].img)), 0);
	});

	it("fails when the variant crops to another rect", () => {
		const grown = cursorDef(hand("cur/grown.png", GLOW, true), "cur-hover", { sameCropAs: "ui.cur" });
		assert.throws(() => A.buildImages(images(grown), []), /ui\.cur\.hover: crops to source \(9, 11\) 17x16 but its sameCropAs ui\.cur to \(9, 11\) 16x16: a variant must share the rect/);
	});

	it("fails when the variant's pivot differs", () => {
		const moved = cursorDef(hand("cur/moved.png"), "cur-hover", { sameCropAs: "ui.cur", pivot: { x: 13, y: 14 } });
		assert.throws(() => A.buildImages(images(moved), []), /ui\.cur\.hover: pivot \{"x":4,"y":3\} differs from its sameCropAs ui\.cur's \{"x":3,"y":3\}/);
	});

	it("fails on an unknown, self or chained sameCropAs, or a non-string", () => {
		const file = hand("cur/ref.png");
		assert.throws(() => A.buildImages(images(cursorDef(file, "h", { sameCropAs: "ui.none" })), []), /ui\.cur\.hover: sameCropAs "ui\.none" is not another built images entry/);
		assert.throws(() => A.buildImages(images(cursorDef(file, "h", { sameCropAs: "ui.cur.hover" })), []), /is not another built images entry/);
		const chained = { ...images(cursorDef(file, "h", { sameCropAs: "ui.cur" })), "ui.cur.press": cursorDef(file, "p", { sameCropAs: "ui.cur.hover" }) };
		assert.throws(() => A.buildImages(chained, []), /ui\.cur\.press: sameCropAs ui\.cur\.hover, which has a sameCropAs itself/);
		assert.throws(() => A.buildImage("ui.x", cursorDef(file, "x", { sameCropAs: 3 })), /ui\.x: sameCropAs must be an images id, got 3/);
	});
});

describe("--only <image id> (the image's crop family)", () => {
	const config = () => ({
		spriteSets: { "class.x": {} },
		images: {
			"ui.cur": cursorDef(hand("cur/fw.png"), "cur"),
			"ui.cur.hover": cursorDef(hand("cur/fy.png", [250, 220, 60, 90]), "cur-hover", { sameCropAs: "ui.cur" }),
			"ui.ring": { file: "cur/ring.png", name: "ring", crop: "alpha", noiseAlpha: 0, pivot: "center" },
		},
	});

	it("argv: an images id is a scoped build; a sprite set id and the groups are as before", () => {
		const c = config();
		assert.equal(A.onlyGroup(["node", "b", "--only", "ui.cur"], c.spriteSets, c.images), "ui.cur");
		assert.equal(A.isOnlyImage("ui.cur", c.images), true);
		assert.equal(A.isOnlySpriteSet("ui.cur", c.images), false);
		assert.equal(A.isOnlyImage("class.x", c.images), false);
		assert.equal(A.isOnlySpriteSet("class.x", c.images), true);
		assert.equal(A.isOnlyImage("kenney", c.images), false);
		assert.equal(A.isOnlyImage(undefined, c.images), false);
	});

	it("builds the whole family from either member, and only it; locks only its files", () => {
		const c = config();
		assert.deepEqual(A.imageFamily(c.images, "ui.cur"), ["ui.cur", "ui.cur.hover"]);
		assert.deepEqual(A.imageFamily(c.images, "ui.cur.hover"), ["ui.cur", "ui.cur.hover"]);
		assert.deepEqual(A.imageFamily(c.images, "ui.ring"), ["ui.ring"]);
		assert.throws(() => A.imageFamily(c.images, "ui.none"), /no images entry ui\.none/);
		assert.deepEqual(A.imageFamilySourceFiles(c.images, "ui.cur.hover"), ["cur/fw.png", "cur/fy.png"]);
		assert.deepEqual(A.onlyGroupSourceFiles(c, "ui.cur"), ["cur/fw.png", "cur/fy.png"]);
		assert.deepEqual(A.buildImageFamily(c.images, "ui.cur.hover").map((b) => b.id), ["ui.cur", "ui.cur.hover"]);
	});

	it("refuses images the scoped build cannot write exactly (pixelsPerTileFrom, meanHex)", () => {
		const c = config();
		c.images["ui.cur"].pixelsPerTileFrom = "class.x";
		assert.throws(() => A.buildImageFamily(c.images, "ui.cur.hover"), /--only ui\.cur\.hover: ui\.cur has pixelsPerTileFrom/);
		const t = config();
		t.images["ui.ring"].meanHex = true;
		assert.throws(() => A.buildImageFamily(t.images, "ui.ring"), /ui\.ring has meanHex/);
	});

	it("merges into layout.ts byte for byte as a full layoutModule writes it", () => {
		const ring = A.raster(9, 7);
		for (let y = 1; y < 6; y++) for (let x = 1; x < 8; x++) ring.data.set(LIT, (y * 9 + x) * 4);
		A.sourceCache.set("cur/ring.png", ring);
		const c = config();
		const all = A.buildImages(c.images, []);
		const ringOnly = all.filter((b) => b.id === "ui.ring");
		let text = A.layoutModule([], ringOnly, "#101010");
		for (const b of A.buildImageFamily(c.images, "ui.cur")) text = A.mergeImageLayout(text, b.id, b.layout);
		assert.equal(text, A.layoutModule([], all, "#101010"));
		// replacing an entry with itself changes nothing
		assert.equal(A.mergeImageLayout(text, "ui.cur", all[0].layout), text);
		assert.throws(() => A.mergeImageLayout("// no layout\n", "ui.cur", all[0].layout), /layout\.ts has no VALE_IMAGE_LAYOUTS/);
	});
});

describe("pivot contact sheet", () => {
	it("follows every image with a pivot (not a sliced one), drawing the red cross on the scaled pivot", () => {
		const b = A.buildImage("ui.test", cursorDef(hand("cur/contact.png"), "contact"));
		const outputs = A.buildOutputs([], [b]);
		assert.deepEqual(outputs.map((o) => [o.dir, o.name]), [["build", "contact.png"], ["contact", "ui.test.png"]]);
		const sheet = outputs[1].img;
		// 16 px at scale 8 plus a margin of 8 on each side; the cross's centre at 8 + 3 * 8
		assert.deepEqual([sheet.w, sheet.h], [16 * 8 + 16, 16 * 8 + 16]);
		const at = (x, y) => [...sheet.data.subarray((y * sheet.w + x) * 4, (y * sheet.w + x) * 4 + 3)];
		assert.deepEqual(at(32, 32), [230, 30, 30]);
		assert.deepEqual(at(26, 32), [230, 30, 30]);
		assert.deepEqual(at(32, 38), [230, 30, 30]);
		const plain = A.buildImage("ui.test", { file: "cur/contact.png", name: "plain", crop: "alpha", noiseAlpha: 2 });
		assert.deepEqual(A.buildOutputs([], [plain]).map((o) => o.dir), ["build"]);
	});
});

describe("art/atlases.json: the gauntlet cursor (docs/CURSOR.md C1)", () => {
	const config = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "art", "atlases.json"), "utf8"));

	it("declares ui.cursor and its hover variant as one crop family with the fingertip pivot in source pixels", () => {
		const n = config.images["ui.cursor"];
		const h = config.images["ui.cursor.hover"];
		assert.equal(n.file, "lords-of-pain/user interface/cursor/cursor_gauntlet_white.png");
		assert.equal(h.file, "lords-of-pain/user interface/cursor/cursor_gauntlet_yellow.png");
		assert.deepEqual([n.name, h.name], ["ui-cursor", "ui-cursor-hover"]);
		for (const d of [n, h]) assert.deepEqual([d.crop, d.noiseAlpha, d.pad, d.pivot], ["alpha", 2, 2, { x: 53, y: 54 }]);
		assert.equal(n.sameCropAs, undefined);
		assert.equal(h.sameCropAs, "ui.cursor");
		assert.deepEqual(A.imageFamily(config.images, "ui.cursor"), ["ui.cursor", "ui.cursor.hover"]);
	});
});

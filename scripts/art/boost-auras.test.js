// Specs for the atlas pipeline's boost aura group (docs/BOOST_ART.md BAD3; npm run test:art): every rank centred in
// one cell per set (the ring's centre the pivot), the cells rank-major in one packed sheet, the greyscale / odd-square
// source rules, boostAuraLayout.ts, the scoped lock / --only, and that the group shares no source or output with any
// other. Synthetic PNGs (pngjs, put in the pipeline's source cache); the last spec builds the real config from the
// generator's frames (scripts/art/gen-boost-auras.js, in memory) and checks the committed boostAuraLayout.ts and the
// built art/build/boost-auras.png against it.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it, beforeEach } = require("node:test");
const { PNG } = require("pngjs");
const A = require("./build-atlases.js");
const G = require("./gen-boost-auras.js");

const ROOT = path.join(__dirname, "..", "..");
const LAYOUT_DIR = path.join(ROOT, "src", "shared", "theme", "packs", "vale");
const CONFIG = () => JSON.parse(fs.readFileSync(path.join(ROOT, "art", "atlases.json"), "utf8"));

/** Puts a decoded PNG (through pngjs, so the cache holds what readPng would decode) at `rel`. */
function cachePng(rel, buf) {
	const back = PNG.sync.read(buf);
	A.sourceCache.set(rel, { w: back.width, h: back.height, data: new Uint8Array(back.data) });
}

/** A side x side frame: a grey dot `reach` px right of the centre (frame f's luminance 100 + f), so cells are told apart. */
function dotFrame(rel, side, reach, f, rgb) {
	const png = new PNG({ width: side, height: side });
	const c = (side - 1) / 2;
	const v = 100 + f;
	png.data.set([...(rgb || [v, v, v]), 255], (c * side + c + reach) * 4);
	png.data.set([v, v, v, 200], (c * side + c) * 4);
	cachePng(rel, PNG.sync.write(png));
}

/** Two sets, two ranks (ring 2 / 3 px), two frames; rank r of set `a` reaches 3 + r px, set `b` 2 px. */
function group(overrides = {}) {
	return {
		$comment: "ignored",
		atlas: "auras",
		pad: 1,
		pixelsPerTile: 29.6,
		fps: 10,
		frames: 2,
		ringPx: [2, 3],
		sets: {
			$comment: "ignored",
			"fx.boost.aura.a": { file: "t/a_r{r}_{f}.png" },
			"fx.boost.aura.b": { file: "t/b_r{r}_{f}.png" },
		},
		...overrides,
	};
}

function synth() {
	for (let r = 0; r < 2; r++) {
		for (let f = 0; f < 2; f++) {
			dotFrame(`t/a_r${r}_${f}.png`, 9 + 2 * r, 3 + r, f + 2 * r);
			dotFrame(`t/b_r${r}_${f}.png`, 9 + 2 * r, 2, f + 2 * r);
		}
	}
}

beforeEach(() => {
	A.sourceCache.clear();
	synth();
});

/** RGBA of (x, y) of the sheet cell of set layout `l`, rank r, frame f (the SpriteSetAsset formula). */
function cellPixel(b, l, r, f, x, y) {
	const perRow = Math.floor(b.packed.w / l.frameW);
	const c = l.start + r * l.frames + f;
	const sx = (c % perRow) * l.frameW + x;
	const sy = Math.floor(c / perRow) * l.frameH + y;
	return [...b.packed.img.data.subarray((sy * b.packed.w + sx) * 4, (sy * b.packed.w + sx) * 4 + 4)];
}

describe("buildBoostAuras: cells", () => {
	it("one odd square cell per set holding every rank centred: 2 x (reach + pad) + 1, the pivot its centre", () => {
		const b = A.buildBoostAuras(group(), undefined);
		const a = b.layouts["fx.boost.aura.a"];
		const bb = b.layouts["fx.boost.aura.b"];
		assert.deepEqual([a.frameW, a.frameH, a.pivot], [11, 11, { x: 5.5, y: 5.5 }]); // reach 4 (rank 1), pad 1
		assert.deepEqual([bb.frameW, bb.frameH, bb.pivot], [7, 7, { x: 3.5, y: 3.5 }]); // reach 2, pad 1
		for (const l of [a, bb]) {
			assert.deepEqual([l.frames, l.fps, l.loop, l.grey, l.ringPx, l.pixelsPerTile], [2, 10, true, true, [2, 3], 29.6]);
		}
		assert.equal(b.ranks, 2);
		assert.deepEqual(b.sheet, { file: "auras.png", w: b.packed.w, h: b.packed.h });
	});

	it("cells are rank-major (rank r frame f = start + r x frames + f), each frame's centre on the pivot", () => {
		const b = A.buildBoostAuras(group(), undefined);
		for (const [id, reach0] of [
			["fx.boost.aura.a", 3],
			["fx.boost.aura.b", 2],
		]) {
			const l = b.layouts[id];
			const c = (l.frameW - 1) / 2;
			for (let r = 0; r < 2; r++) {
				for (let f = 0; f < 2; f++) {
					const v = 100 + f + 2 * r;
					assert.deepEqual(cellPixel(b, l, r, f, c, c), [v, v, v, 200], `${id} r${r} f${f} centre`);
					const reach = id === "fx.boost.aura.a" ? reach0 + r : reach0;
					assert.deepEqual(cellPixel(b, l, r, f, c + reach, c), [v, v, v, 255], `${id} r${r} f${f} dot`);
				}
			}
		}
	});

	it("contact sheet: a row per set and rank", () => {
		const b = A.buildBoostAuras(group(), undefined);
		const contact = A.boostAuraContact(b);
		assert.ok(contact.w > 0 && contact.h > 0);
	});

	it("refuses a malformed group, set or source frame", () => {
		assert.throws(() => A.buildBoostAuras(group({ extra: 1 }), undefined), /unknown key extra/);
		assert.throws(() => A.buildBoostAuras(group({ ringPx: [3, 3] }), undefined), /increasing positive integers/);
		assert.throws(() => A.buildBoostAuras(group({ ringPx: [] }), undefined), /one ring radius/);
		assert.throws(() => A.buildBoostAuras(group({ fps: 0 }), undefined), /fps/);
		assert.throws(() => A.buildBoostAuras(group({ sets: { "fx.hit.light": { file: "t/a_r{r}_{f}.png" } } }), undefined), /not an fx\.boost\.aura/);
		assert.throws(() => A.buildBoostAuras(group({ sets: { "fx.boost.aura.a": { file: "t/a.png" } } }), undefined), /\{r\} and \{f\}/);
		assert.throws(() => A.buildBoostAuras(group({ sets: { "fx.boost.aura.a": { file: "t/a_r{r}_{f}.png", tint: "x" } } }), undefined), /unknown aura set key tint/);
		dotFrame("t/b_r1_1.png", 11, 2, 3, [255, 0, 0]);
		assert.throws(() => A.buildBoostAuras(group(), undefined), /coloured pixel/);
		synth();
		cachePng("t/a_r0_0.png", PNG.sync.write(new PNG({ width: 10, height: 10 })));
		assert.throws(() => A.buildBoostAuras(group(), undefined), /not an odd square/);
		synth();
		assert.throws(() => A.buildBoostAuras(group({ ringPx: [2, 5] }), undefined), /too small for rank 1/);
	});

	it("is deterministic: two builds give byte-identical PNGs, contact sheets and layout text", () => {
		const one = A.buildBoostAuras(group(), undefined);
		A.sourceCache.clear();
		synth();
		const two = A.buildBoostAuras(group(), undefined);
		assert.ok(Buffer.compare(A.encodePng(one.packed.img), A.encodePng(two.packed.img)) === 0);
		assert.ok(Buffer.compare(A.encodePng(A.boostAuraContact(one)), A.encodePng(A.boostAuraContact(two))) === 0);
		assert.equal(A.boostAuraLayoutModule(one.sheet, one.layouts), A.boostAuraLayoutModule(two.sheet, two.layouts));
	});
});

describe("boostAuraLayoutModule", () => {
	it("prints the committed boostAuraLayout.ts's head (imports, ValeBoostAuraLayout) and the two constants", () => {
		const committed = fs.readFileSync(path.join(LAYOUT_DIR, "boostAuraLayout.ts"), "utf8");
		const head = (t) => t.slice(0, t.indexOf("export const VALE_BOOST_AURA_SHEET"));
		const b = A.buildBoostAuras(group(), undefined);
		const text = A.boostAuraLayoutModule(b.sheet, b.layouts);
		assert.equal(head(text), head(committed));
		assert.match(text, /import type \{ ValeFxLayout \} from "\.\/fxLayout";\nimport type \{ ValeSheetFile \} from "\.\/layout";\n/);
		assert.match(text, /export const VALE_BOOST_AURA_SHEET: ValeSheetFile = \{\n\tfile: "auras\.png",/);
		assert.match(text, /"fx\.boost\.aura\.a": \{\n\t\tframeW: 11,\n\t\tframeH: 11,\n\t\tpivot: \{ x: 5\.5, y: 5\.5 \},/);
		assert.match(text, /\t\tringPx: \[2, 3\],\n\t\tpixelsPerTile: 29\.6,\n/);
	});
});

describe("boostAuras: sources, the scoped lock, --only and every other output", () => {
	it("boostAuraSourceFiles lists every set x rank x frame; sourceFiles adds them; no group adds nothing", () => {
		assert.deepEqual(A.boostAuraSourceFiles(undefined), []);
		const files = A.boostAuraSourceFiles(group());
		assert.equal(files.length, 2 * 2 * 2);
		assert.deepEqual(files, [...files].sort());
		assert.ok(files.includes("t/a_r1_0.png") && files.includes("t/b_r0_1.png"));
		const base = { spriteSets: {}, images: {} };
		assert.deepEqual(A.sourceFiles(base), []);
		assert.deepEqual(A.sourceFiles({ ...base, boostAuras: group() }), files);
	});

	it("onlyGroup takes boostAuras; the scoped lock re-hashes only its frames", () => {
		assert.equal(A.onlyGroup(["node", "build-atlases.js", "--only", "boostAuras"]), "boostAuras");
		assert.deepEqual(A.onlyGroupSourceFiles({ boostAuras: group() }, "boostAuras"), A.boostAuraSourceFiles(group()));
	});

	it("the real config: reads only generated frames under kaleb-vale/boost-auras/, read by no other group, all locked; its own sheet", () => {
		const config = CONFIG();
		const auras = A.boostAuraSourceFiles(config.boostAuras);
		assert.equal(auras.length, G.KIND_NAMES.length * G.RANKS * G.FRAMES);
		for (const f of auras) assert.ok(f.startsWith("kaleb-vale/boost-auras/aura_"), f);
		const { boostAuras: _, ...rest } = config;
		const without = A.sourceFiles(rest);
		for (const f of auras) assert.ok(!without.includes(f), `${f} is also read by another group`);
		assert.deepEqual(A.sourceFiles(config), [...without, ...auras].sort());
		const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "art", "vendor.lock.json"), "utf8"));
		const locked = new Map(lock.files.map((e) => [e.path, e]));
		const crypto = require("node:crypto");
		for (const f of auras) {
			const [kind, rank, frame] = /aura_([a-z]+)_r(\d)_(\d)\.png$/.exec(f).slice(1);
			const bytes = G.renderFrame(kind, Number(rank), Number(frame));
			const e = locked.get(f);
			assert.ok(e, `${f} is in art/vendor.lock.json`);
			assert.deepEqual([e.sha256, e.bytes], [crypto.createHash("sha256").update(bytes).digest("hex"), bytes.length], `${f}: the lock pins the generator's bytes`);
		}
		const sheets = [config.fx.atlas, config.bullets.atlas, config.goo.atlas, config.worldArt.atlas.name];
		assert.ok(!sheets.includes(config.boostAuras.atlas));
		assert.equal(config.boostAuras.atlas, "boost-auras");
		assert.ok(!Object.keys(config.fx.sets).some((id) => id.startsWith("fx.boost.")), "no aura is in fx-effects.png");
	});

	it("the real config built from the generator's frames: the committed boostAuraLayout.ts and art/build/boost-auras.png", () => {
		const config = CONFIG();
		for (const kind of G.KIND_NAMES) {
			for (let r = 0; r < G.RANKS; r++) {
				for (let f = 0; f < G.FRAMES; f++) cachePng(`kaleb-vale/boost-auras/${G.fileName(kind, r, f)}`, G.renderFrame(kind, r, f));
			}
		}
		const b = A.buildBoostAuras(config.boostAuras, undefined);
		assert.equal(A.boostAuraLayoutModule(b.sheet, b.layouts), fs.readFileSync(path.join(LAYOUT_DIR, "boostAuraLayout.ts"), "utf8"));
		for (const kind of G.KIND_NAMES) {
			const l = b.layouts[`fx.boost.aura.${kind}`];
			assert.deepEqual(l.ringPx, G.RING_PX);
			assert.equal(l.frameW % 2, 1);
			assert.ok((l.frameW - 1) / 2 >= G.RING_PX[G.RANKS - 1]);
		}
		assert.ok(b.packed.w <= A.MAX_ATLAS && b.packed.h <= A.MAX_ATLAS);
		const built = path.join(ROOT, "art", "build", "boost-auras.png");
		if (fs.existsSync(built)) assert.ok(Buffer.compare(A.encodePng(b.packed.img), fs.readFileSync(built)) === 0);
	});
});

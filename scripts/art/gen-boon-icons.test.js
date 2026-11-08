// Specs for the generated boon icons (scripts/art/gen-boon-icons.js; npm run test:art): one icon per boon in BOONS
// order, deterministic, every icon a 16 x 16 opaque-or-clear canvas in the palette only, outlined (nothing clipped at
// the canvas edge: the outermost px is outline or clear), and distinct from every other icon; and the atlas group that
// packs them (art/atlases.json `boonIcons`, build-atlases.js buildBoonIcons): one entry per icon file, and the
// generated packs/vale/boonIconLayout.ts is exactly what the build makes from these icons; its `order` packs one
// column that only appends (the first upload's 17 icons keep their rects; build-atlases.js packColumn).
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");
const { PNG } = require("pngjs");
const G = require("./gen-boon-icons.js");
const A = require("./build-atlases.js");

const ROOT = path.join(__dirname, "..", "..");
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "art", "atlases.json"), "utf8"));
const LAYOUT = path.join(ROOT, "src", "shared", "theme", "packs", "vale", "boonIconLayout.ts");
/** The art/vendor-relative file of an icon (the generator's default out dir). */
const vendorFile = (id) => `kaleb-vale/boon-icons/${G.fileOf(id)}`;
/** Boons in the first upload of boon-icons.png (2026-11-08): BOONS 0-16, before builds v2 wave 1. */
const FIRST_UPLOAD = 17;
/** The theme id of a boon id (shared/theme boonIconId: lower-cased, asset ids are lowercase). */
const iconId = (id) => `ui.boon.${id.replace(/^boon\./, "").toLowerCase()}`;

/** The boon ids of shared/sim progression BOONS, read from the source so a new boon fails here until it has an icon. */
function boonIdsFromSource() {
	const file = path.join(__dirname, "..", "..", "src", "shared", "sim", "progression", "progressionData.ts");
	const src = fs.readFileSync(file, "utf8");
	const start = src.indexOf("export const BOONS");
	const end = src.indexOf("];", start);
	return [...src.slice(start, end).matchAll(/id: "(boon\.[A-Za-z]+)"/g)].map((m) => m[1]);
}

describe("gen-boon-icons", () => {
	it("draws one icon per boon, in BOONS order", () => {
		assert.deepEqual(G.BOON_IDS, boonIdsFromSource());
	});

	it("names files boon_<name>.png, all different", () => {
		assert.equal(G.fileOf("boon.swiftStrikes"), "boon_swiftStrikes.png");
		assert.equal(new Set(G.BOON_IDS.map(G.fileOf)).size, G.BOON_IDS.length);
	});

	it("is deterministic (byte-identical PNGs)", () => {
		for (const id of G.BOON_IDS) assert.deepEqual(G.renderIcon(id), G.renderIcon(id));
	});

	it("every icon: 16 x 16, alpha 0 or 255, palette colours only, something drawn", () => {
		const colours = new Set(Object.values(G.PALETTE).map((p) => p.rgb.join(",")));
		for (const id of G.BOON_IDS) {
			const png = PNG.sync.read(G.renderIcon(id));
			assert.equal(png.width, G.SIZE);
			assert.equal(png.height, G.SIZE);
			let drawn = 0;
			for (let i = 0; i < G.SIZE * G.SIZE; i++) {
				const a = png.data[i * 4 + 3];
				assert.ok(a === 0 || a === 255, `${id}: alpha ${a}`);
				if (a === 0) continue;
				drawn++;
				const rgb = [png.data[i * 4], png.data[i * 4 + 1], png.data[i * 4 + 2]].join(",");
				assert.ok(colours.has(rgb), `${id}: off-palette ${rgb}`);
			}
			assert.ok(drawn >= 40, `${id}: only ${drawn} px`);
		}
	});

	it("outlined: an outlined colour never touches a clear pixel or the canvas edge", () => {
		for (const id of G.BOON_IDS) {
			const rows = G.drawIcon(id);
			for (let y = 0; y < G.SIZE; y++) {
				for (let x = 0; x < G.SIZE; x++) {
					const ch = rows[y][x];
					if (ch === "." || ch === "o" || !G.PALETTE[ch].outlined) continue;
					assert.ok(x > 0 && y > 0 && x < G.SIZE - 1 && y < G.SIZE - 1, `${id}: ${ch} at the edge (${x}, ${y})`);
					for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
						assert.notEqual(rows[y + dy][x + dx], ".", `${id}: ${ch} at (${x}, ${y}) has no outline`);
					}
				}
			}
		}
	});

	it("no two icons are the same picture", () => {
		const seen = new Map();
		for (const id of G.BOON_IDS) {
			const key = G.drawIcon(id).join("\n");
			assert.ok(!seen.has(key), `${id} repeats ${seen.get(key)}`);
			seen.set(key, id);
		}
	});

	it("draws a contact sheet", () => {
		const png = PNG.sync.read(G.renderContact());
		assert.ok(png.width > G.SIZE && png.height > G.SIZE);
	});
});

describe("the boonIcons atlas group", () => {
	it("lists every icon file once, as the whole 16 x 16 canvas, under ui.boon.<name> (lower case)", () => {
		const group = CONFIG.boonIcons;
		assert.equal(group.atlas, "boon-icons");
		const ids = Object.keys(group.icons).sort();
		assert.deepEqual(ids, G.BOON_IDS.map(iconId).sort());
		for (const id of G.BOON_IDS) {
			assert.deepEqual(group.icons[iconId(id)], { file: vendorFile(id), rect: [0, 0, G.SIZE, G.SIZE] });
		}
		assert.deepEqual(A.boonIconSourceFiles(group), G.BOON_IDS.map(vendorFile).sort());
		assert.ok(A.sourceFiles(CONFIG).includes(vendorFile(G.BOON_IDS[0])));
		assert.equal(A.onlyGroup(["node", "x", "--only", "boonIcons"]), "boonIcons");
		assert.deepEqual(A.boonIconSourceFiles(undefined), []);
	});

	it("builds the committed boonIconLayout.ts from the generated icons, every icon read back intact", () => {
		for (const id of G.BOON_IDS) {
			const png = PNG.sync.read(G.renderIcon(id));
			A.sourceCache.set(vendorFile(id), { w: png.width, h: png.height, data: new Uint8Array(png.data) });
		}
		const icons = A.buildBoonIcons(CONFIG.boonIcons);
		assert.equal(icons.file, "boon-icons.png");
		assert.equal(A.boonIconLayoutModule(icons), fs.readFileSync(LAYOUT, "utf8"));
		for (const id of G.BOON_IDS) {
			const r = icons.layouts[iconId(id)].rect;
			const want = G.rgbaOf(id);
			for (let y = 0; y < G.SIZE; y++) {
				for (let x = 0; x < G.SIZE; x++) {
					const a = ((r.y + y) * icons.w + r.x + x) * 4;
					const b = (y * G.SIZE + x) * 4;
					if (want[b + 3] === 0) {
						assert.equal(icons.img.data[a + 3], 0, `${id} (${x}, ${y})`);
						continue;
					}
					assert.deepEqual([...icons.img.data.subarray(a, a + 4)], [...want.subarray(b, b + 4)], `${id} (${x}, ${y})`);
				}
			}
		}
		for (const id of G.BOON_IDS) A.sourceCache.delete(vendorFile(id));
	});

	it("packs one column in `order`: the first upload's 17 icons in id order, then every newer boon in BOONS order", () => {
		const first = G.BOON_IDS.slice(0, FIRST_UPLOAD).map(iconId).sort();
		const newer = G.BOON_IDS.slice(FIRST_UPLOAD).map(iconId);
		assert.deepEqual(CONFIG.boonIcons.order, [...first, ...newer]);
		const layout = fs.readFileSync(LAYOUT, "utf8");
		// the first upload (2026-11-08) was packUiIcons' 18 x 306 column in id order: every one of its rects is kept
		first.forEach((id, n) => assert.ok(layout.includes(`"${id}": { rect: { x: 1, y: ${1 + n * 18}, w: 16, h: 16 } },`), id));
	});

	it("packColumn: stacks in order, appending never moves a rect; a bad order or an overflow throws", () => {
		const piece = (id, h = 16) => ({ id, img: { w: 16, h } });
		const two = A.packColumn(["ui.b", "ui.a"])([piece("ui.a"), piece("ui.b", 8)], 1, 1024);
		assert.deepEqual(two, { w: 18, h: 28, rects: { "ui.b": { x: 1, y: 1, w: 16, h: 8 }, "ui.a": { x: 1, y: 11, w: 16, h: 16 } } });
		const three = A.packColumn(["ui.b", "ui.a", "ui.c"])([piece("ui.c"), piece("ui.a"), piece("ui.b", 8)], 1, 1024);
		assert.deepEqual(three.rects["ui.a"], two.rects["ui.a"]);
		assert.deepEqual(three.rects["ui.b"], two.rects["ui.b"]);
		assert.throws(() => A.packColumn(["ui.a"])([piece("ui.a"), piece("ui.b")], 1, 1024), /order must list every icon id once/);
		assert.throws(() => A.packColumn(["ui.a", "ui.a"])([piece("ui.a"), piece("ui.b")], 1, 1024), /order must list every icon id once/);
		assert.throws(() => A.packColumn(["ui.a", "ui.b"])([piece("ui.a"), piece("ui.b")], 1, 30), /do not fit one 30x30 column/);
	});

	it("takes ui.boon.* ids only", () => {
		const png = PNG.sync.read(G.renderIcon(G.BOON_IDS[0]));
		A.sourceCache.set("synthetic/boon.png", { w: png.width, h: png.height, data: new Uint8Array(png.data) });
		const section = { atlas: "boon-test", icons: { "ui.other": { file: "synthetic/boon.png", rect: [0, 0, 16, 16] } } };
		assert.throws(() => A.buildBoonIcons(section), /boon icon ids start with "ui\.boon\."/);
		A.sourceCache.delete("synthetic/boon.png");
	});
});

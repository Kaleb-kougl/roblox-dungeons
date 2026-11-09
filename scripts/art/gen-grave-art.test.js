// Specs for the generated gravestones (scripts/art/gen-grave-art.js; npm run test:art): five looks, deterministic,
// each a transparent-margined PNG in the Lords of Pain stone's dark range; and the world art pieces that pack them
// (art/atlases.json worldArt.pieces grave-<look>, own PNGs): the committed layout.ts entries are exactly what the build
// makes from these stones, and each stone's outline fits DECOR_BOX.grave (18 x 26 render px, nothing below its pivot)
// at full size, so the decor plan's footprint rule holds for the art as drawn.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");
const { PNG } = require("pngjs");
const G = require("./gen-grave-art.js");
const A = require("./build-atlases.js");

const ROOT = path.join(__dirname, "..", "..");
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "art", "atlases.json"), "utf8"));
const LAYOUT = fs.readFileSync(path.join(ROOT, "src", "shared", "theme", "packs", "vale", "layout.ts"), "utf8");
/** The art/vendor-relative file of a look (the generator's default out dir). */
const vendorFile = (look) => `kaleb-vale/${G.fileOf(look)}`;
/** DECOR_BOX.grave (shared/view/decor decorPlan.ts), render px, and render px per art px (PIXELS_PER_TILE 16 / 29.6). */
const BOX = { w: 18, h: 26, below: 0 };
const RENDER_PER_ART = 16 / G.TILE_PX;

describe("gen-grave-art", () => {
	it("draws five looks, in variant order", () => {
		assert.deepEqual(G.GRAVE_LOOKS, ["rounded", "cross", "cracked", "obelisk", "skull"]);
	});

	it("is deterministic (byte-identical PNGs)", () => {
		for (const g of G.GRAVES) assert.deepEqual(G.toPngBytes(G.renderGrave(g)), G.toPngBytes(G.renderGrave(g)));
	});

	it("every stone: a clear margin round its body, soft edges, in the Lords of Pain stone's dark range", () => {
		for (const g of G.GRAVES) {
			const img = G.renderGrave(g);
			let opaque = 0;
			let soft = 0;
			let lum = 0;
			for (let y = 0; y < img.h; y++) {
				for (let x = 0; x < img.w; x++) {
					const i = (y * img.w + x) * 4;
					const a = img.data[i + 3];
					const edge = x < G.GRAVE_MARGIN || y < G.GRAVE_MARGIN || x >= img.w - G.GRAVE_MARGIN || y >= img.h - G.GRAVE_MARGIN;
					if (edge) assert.equal(a, 0, `${g.look}: margin pixel (${x}, ${y})`);
					if (a === 255) {
						opaque++;
						lum += 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
					} else if (a > 0) soft++;
				}
			}
			assert.ok(opaque >= 200, `${g.look}: only ${opaque} opaque px`);
			assert.ok(soft > 0, `${g.look}: no anti-aliased edge`);
			// Lords of Pain columns' body mean luminance is ~28; the kits graded toward them sit at ~43-57
			const mean = lum / opaque;
			assert.ok(mean > 25 && mean < 65, `${g.look}: mean luminance ${mean}`);
		}
	});
});

describe("the grave world art pieces", () => {
	const pieces = {};
	for (const look of G.GRAVE_LOOKS) pieces[`grave-${look}`] = CONFIG.worldArt.pieces[`grave-${look}`];

	it("one own PNG per look, pivot at the foot, outlined", () => {
		for (const look of G.GRAVE_LOOKS) {
			assert.deepEqual(pieces[`grave-${look}`], {
				file: vendorFile(look),
				pivot: "bottom",
				outline: true,
				own: `grave-${look}`,
			});
		}
		for (const look of G.GRAVE_LOOKS) assert.ok(A.sourceFiles(CONFIG).includes(vendorFile(look)), look);
	});

	it("builds the committed layout.ts entries, and each outline fits DECOR_BOX.grave at full size", () => {
		for (const g of G.GRAVES) {
			const png = PNG.sync.read(G.toPngBytes(G.renderGrave(g)));
			A.sourceCache.set(vendorFile(g.look), { w: png.width, h: png.height, data: new Uint8Array(png.data) });
		}
		const world = { ...CONFIG.worldArt, pieces };
		const built = A.buildWorldPieces(world, [{ id: world.pixelsPerTileFrom, layout: { pixelsPerTile: G.TILE_PX } }]);
		for (const p of built.pieces) {
			p.file = `${p.own}.png`;
			const l = A.worldLayout(p);
			const xy = (q) => `{ x: ${q.x}, y: ${q.y} }`;
			assert.ok(LAYOUT.includes(`\t"${p.name}": {\n\t\tkind: "image",\n\t\tfile: "${p.file}",\n\t\tw: ${l.w},\n\t\th: ${l.h},\n\t\tpivot: ${xy(l.pivot)},`), p.name);
			for (const q of l.outline) assert.ok(LAYOUT.includes(`\t\t\t${xy(q)},`), `${p.name} ${xy(q)}`);
			for (const q of l.outline) {
				const dx = (q.x - l.pivot.x) * RENDER_PER_ART;
				const up = (l.pivot.y - q.y) * RENDER_PER_ART;
				assert.ok(Math.abs(dx) <= BOX.w / 2, `${p.name}: ${xy(q)} is ${dx} render px across`);
				assert.ok(up <= BOX.h && up >= -BOX.below, `${p.name}: ${xy(q)} is ${up} render px up`);
			}
		}
		for (const g of G.GRAVES) A.sourceCache.delete(vendorFile(g.look));
	});
});

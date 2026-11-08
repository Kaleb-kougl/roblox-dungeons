// Specs for the generated duo icons (scripts/art/gen-duo-icons.js; npm run test:art): one icon per duo in DUOS order,
// deterministic, every icon a 16 x 16 opaque-or-clear canvas in the boon icons' palette only, outlined (nothing clipped
// at the canvas edge), and distinct from every other duo icon and every boon icon; and the atlas group that packs them
// (art/atlases.json `duoIcons`, build-atlases.js buildDuoIcons): one entry per icon file, one append-only column in
// DUOS order, and the generated packs/vale/duoIconLayout.ts is exactly what the build makes from these icons.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");
const { PNG } = require("pngjs");
const G = require("./gen-duo-icons.js");
const BOON = require("./gen-boon-icons.js");
const A = require("./build-atlases.js");

const ROOT = path.join(__dirname, "..", "..");
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "art", "atlases.json"), "utf8"));
const LAYOUT = path.join(ROOT, "src", "shared", "theme", "packs", "vale", "duoIconLayout.ts");
/** The art/vendor-relative file of an icon (the generator's default out dir). */
const vendorFile = (id) => `kaleb-vale/duo-icons/${G.fileOf(id)}`;
/** The theme id of a duo id (shared/theme duoIconId: lower-cased, asset ids are lowercase). */
const iconId = (id) => `ui.duo.${id.replace(/^duo\./, "").toLowerCase()}`;

/** The duo ids of shared/sim builds DUOS, read from the source so a new duo fails here until it has an icon. */
function duoIdsFromSource() {
	const file = path.join(ROOT, "src", "shared", "sim", "builds", "buildsData.ts");
	const src = fs.readFileSync(file, "utf8");
	const start = src.indexOf("export const DUOS");
	const end = src.indexOf("];", start);
	return [...src.slice(start, end).matchAll(/id: "(duo\.[A-Za-z]+)"/g)].map((m) => m[1]);
}

describe("gen-duo-icons", () => {
	it("draws one icon per duo, in DUOS order", () => {
		assert.deepEqual(G.DUO_IDS, duoIdsFromSource());
	});

	it("uses the boon icons' kit and palette exactly", () => {
		assert.equal(G.SIZE, BOON.SIZE);
		assert.equal(G.MAP, BOON.MAP);
		assert.deepEqual(G.OUTLINE, BOON.OUTLINE);
		assert.equal(G.PALETTE, BOON.PALETTE);
	});

	it("names files duo_<name>.png, all different", () => {
		assert.equal(G.fileOf("duo.fireArrows"), "duo_fireArrows.png");
		assert.equal(new Set(G.DUO_IDS.map(G.fileOf)).size, G.DUO_IDS.length);
	});

	it("is deterministic (byte-identical PNGs)", () => {
		for (const id of G.DUO_IDS) assert.deepEqual(G.renderIcon(id), G.renderIcon(id));
	});

	it("every icon: 16 x 16, alpha 0 or 255, palette colours only, something drawn", () => {
		const colours = new Set(Object.values(G.PALETTE).map((p) => p.rgb.join(",")));
		for (const id of G.DUO_IDS) {
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
		for (const id of G.DUO_IDS) {
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

	it("no two icons are the same picture, and none repeats a boon icon", () => {
		const seen = new Map();
		for (const id of BOON.BOON_IDS) seen.set(BOON.drawIcon(id).join("\n"), id);
		for (const id of G.DUO_IDS) {
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

describe("the duoIcons atlas group", () => {
	it("lists every icon file once, as the whole 16 x 16 canvas, under ui.duo.<name> (lower case)", () => {
		const group = CONFIG.duoIcons;
		assert.equal(group.atlas, "duo-icons");
		const ids = Object.keys(group.icons).sort();
		assert.deepEqual(ids, G.DUO_IDS.map(iconId).sort());
		for (const id of G.DUO_IDS) {
			assert.deepEqual(group.icons[iconId(id)], { file: vendorFile(id), rect: [0, 0, G.SIZE, G.SIZE] });
		}
		assert.deepEqual(A.duoIconSourceFiles(group), G.DUO_IDS.map(vendorFile).sort());
		assert.ok(A.sourceFiles(CONFIG).includes(vendorFile(G.DUO_IDS[0])));
		assert.equal(A.onlyGroup(["node", "x", "--only", "duoIcons"]), "duoIcons");
		assert.deepEqual(A.duoIconSourceFiles(undefined), []);
	});

	it("packs one column in DUOS order (a new duo appends below, no rect moves)", () => {
		assert.deepEqual(CONFIG.duoIcons.order, G.DUO_IDS.map(iconId));
	});

	it("builds the committed duoIconLayout.ts from the generated icons, every icon read back intact", () => {
		for (const id of G.DUO_IDS) {
			const png = PNG.sync.read(G.renderIcon(id));
			A.sourceCache.set(vendorFile(id), { w: png.width, h: png.height, data: new Uint8Array(png.data) });
		}
		const icons = A.buildDuoIcons(CONFIG.duoIcons);
		assert.equal(icons.file, "duo-icons.png");
		assert.equal(A.duoIconLayoutModule(icons), fs.readFileSync(LAYOUT, "utf8"));
		G.DUO_IDS.forEach((id, n) => {
			const r = icons.layouts[iconId(id)].rect;
			assert.deepEqual(r, { x: 1, y: 1 + n * (G.SIZE + 2), w: G.SIZE, h: G.SIZE }, id);
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
		});
		for (const id of G.DUO_IDS) A.sourceCache.delete(vendorFile(id));
	});

	it("takes ui.duo.* ids only", () => {
		const png = PNG.sync.read(G.renderIcon(G.DUO_IDS[0]));
		A.sourceCache.set("synthetic/duo.png", { w: png.width, h: png.height, data: new Uint8Array(png.data) });
		const section = { atlas: "duo-test", icons: { "ui.boon.other": { file: "synthetic/duo.png", rect: [0, 0, 16, 16] } } };
		assert.throws(() => A.buildDuoIcons(section), /duo icon ids start with "ui\.duo\."/);
		A.sourceCache.delete("synthetic/duo.png");
	});
});

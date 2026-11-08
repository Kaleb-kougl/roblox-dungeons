// Specs for the generated relic and curse icons (scripts/art/gen-item-icons.js; npm run test:art): one icon per relic in
// RELICS order then one per curse in CURSES order, deterministic, every icon a 16 x 16 opaque-or-clear canvas in the
// palette only, outlined (nothing clipped at the canvas edge), distinct from every other icon and from every boon icon,
// curses drawn largely in their sickly colours; and the atlas group that packs them (art/atlases.json `itemIcons`,
// build-atlases.js buildItemIcons): one entry per icon file, and the generated packs/vale/itemIconLayout.ts is exactly
// what the build makes from these icons.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");
const { PNG } = require("pngjs");
const G = require("./gen-item-icons.js");
const BOON = require("./gen-boon-icons.js");
const A = require("./build-atlases.js");

const ROOT = path.join(__dirname, "..", "..");
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "art", "atlases.json"), "utf8"));
const LAYOUT = path.join(ROOT, "src", "shared", "theme", "packs", "vale", "itemIconLayout.ts");
/** The art/vendor-relative file of an icon (the generator's default out dir). */
const vendorFile = (id) => `kaleb-vale/item-icons/${G.fileOf(id)}`;
/** The theme id of a relic or curse id (shared/theme relicIconId / curseIconId: lower-cased). */
const iconId = (id) => {
	const [kind, name] = id.split(".");
	return `ui.${kind}.${name.toLowerCase()}`;
};
/** The palette characters only the curses use (gen-item-icons' additions to the boon palette). */
const SICKLY = Object.keys(G.PALETTE).filter((ch) => BOON.PALETTE[ch] === undefined);

/** The ids of shared/sim progression `table` (RELICS / CURSES), read from the source so a new one fails here. */
function idsFromSource(table, prefix) {
	const file = path.join(ROOT, "src", "shared", "sim", "progression", "progressionData.ts");
	const src = fs.readFileSync(file, "utf8");
	const start = src.indexOf(`export const ${table}`);
	const end = src.indexOf("];", start);
	return [...src.slice(start, end).matchAll(new RegExp(`id: "(${prefix}\\.[A-Za-z]+)"`, "g"))].map((m) => m[1]);
}

describe("gen-item-icons", () => {
	it("draws one icon per relic (RELICS order), then one per curse (CURSES order)", () => {
		assert.deepEqual(G.RELIC_IDS, idsFromSource("RELICS", "relic"));
		assert.deepEqual(G.CURSE_IDS, idsFromSource("CURSES", "curse"));
		assert.deepEqual(G.ITEM_IDS, [...G.RELIC_IDS, ...G.CURSE_IDS]);
	});

	it("names files relic_<name>.png / curse_<name>.png, all different", () => {
		assert.equal(G.fileOf("relic.mirrorCloak"), "relic_mirrorCloak.png");
		assert.equal(G.fileOf("curse.thirst"), "curse_thirst.png");
		assert.throws(() => G.fileOf("boon.hearty"), /not a relic or curse id/);
		assert.equal(new Set(G.ITEM_IDS.map(G.fileOf)).size, G.ITEM_IDS.length);
	});

	it("keeps the boon palette and adds only new characters", () => {
		for (const ch of Object.keys(BOON.PALETTE)) assert.deepEqual(G.PALETTE[ch], BOON.PALETTE[ch], ch);
		assert.ok(SICKLY.length > 0);
	});

	it("is deterministic (byte-identical PNGs)", () => {
		for (const id of G.ITEM_IDS) assert.deepEqual(G.renderIcon(id), G.renderIcon(id));
	});

	it("every icon: 16 x 16, alpha 0 or 255, palette colours only, something drawn", () => {
		const colours = new Set(Object.values(G.PALETTE).map((p) => p.rgb.join(",")));
		for (const id of G.ITEM_IDS) {
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
		for (const id of G.ITEM_IDS) {
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

	it("curses are sickly, relics are not: a curse draws at least a fifth of its colour px in the curse colours, a relic none", () => {
		for (const id of G.ITEM_IDS) {
			let colour = 0;
			let sickly = 0;
			for (const row of G.drawIcon(id)) {
				for (const ch of row) {
					if (ch === "." || ch === "o") continue;
					colour++;
					if (SICKLY.includes(ch)) sickly++;
				}
			}
			if (id.startsWith("curse.")) assert.ok(sickly * 5 >= colour, `${id}: ${sickly} of ${colour} px sickly`);
			else assert.equal(sickly, 0, `${id}: ${sickly} sickly px`);
		}
	});

	it("no two icons are the same picture, and none repeats a boon icon", () => {
		const seen = new Map(BOON.BOON_IDS.map((id) => [BOON.drawIcon(id).join("\n"), id]));
		for (const id of G.ITEM_IDS) {
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

describe("the itemIcons atlas group", () => {
	it("lists every icon file once, as the whole 16 x 16 canvas, under ui.relic.<name> / ui.curse.<name>", () => {
		const group = CONFIG.itemIcons;
		assert.equal(group.atlas, "item-icons");
		assert.deepEqual(Object.keys(group.icons).sort(), G.ITEM_IDS.map(iconId).sort());
		for (const id of G.ITEM_IDS) {
			assert.deepEqual(group.icons[iconId(id)], { file: vendorFile(id), rect: [0, 0, G.SIZE, G.SIZE] });
		}
		assert.deepEqual(A.itemIconSourceFiles(group), G.ITEM_IDS.map(vendorFile).sort());
		assert.ok(A.sourceFiles(CONFIG).includes(vendorFile(G.ITEM_IDS[0])));
		assert.equal(A.onlyGroup(["node", "x", "--only", "itemIcons"]), "itemIcons");
		assert.deepEqual(A.itemIconSourceFiles(undefined), []);
	});

	it("builds the committed itemIconLayout.ts from the generated icons, every icon read back intact", () => {
		for (const id of G.ITEM_IDS) {
			const png = PNG.sync.read(G.renderIcon(id));
			A.sourceCache.set(vendorFile(id), { w: png.width, h: png.height, data: new Uint8Array(png.data) });
		}
		const icons = A.buildItemIcons(CONFIG.itemIcons);
		assert.equal(icons.file, "item-icons.png");
		assert.equal(A.itemIconLayoutModule(icons), fs.readFileSync(LAYOUT, "utf8"));
		for (const id of G.ITEM_IDS) {
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
		for (const id of G.ITEM_IDS) A.sourceCache.delete(vendorFile(id));
	});

	it("takes ui.relic.* and ui.curse.* ids only", () => {
		const png = PNG.sync.read(G.renderIcon(G.ITEM_IDS[0]));
		A.sourceCache.set("synthetic/item.png", { w: png.width, h: png.height, data: new Uint8Array(png.data) });
		const section = (id) => ({ atlas: "item-test", icons: { [id]: { file: "synthetic/item.png", rect: [0, 0, 16, 16] } } });
		assert.throws(() => A.buildItemIcons(section("ui.boon.hearty")), /item icon ids start with/);
		assert.doesNotThrow(() => A.buildItemIcons(section("ui.curse.test")));
		A.sourceCache.delete("synthetic/item.png");
	});
});

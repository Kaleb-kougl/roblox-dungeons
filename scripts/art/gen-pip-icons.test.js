// Specs for the generated armor pips (scripts/art/gen-pip-icons.js; npm run test:art): the three pips, deterministic,
// 9 x 9 opaque-or-clear canvases in the palette only, outlined (nothing clipped at the canvas edge), the same shield
// silhouette for all three (so a spent or Aegis pip sits exactly where a full one would), the full pip in the armor
// blue around uiMana, the Aegis pip in the Aegis lavender around boost.aegis, the spent pip with none of either; and the
// atlas group that packs them (art/atlases.json `pipIcons`, build-atlases.js buildPipIcons): one entry per file, and the
// generated packs/vale/pipIconLayout.ts is exactly what the build makes from these pips.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");
const { PNG } = require("pngjs");
const G = require("./gen-pip-icons.js");
const BOON = require("./gen-boon-icons.js");
const A = require("./build-atlases.js");

const ROOT = path.join(__dirname, "..", "..");
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "art", "atlases.json"), "utf8"));
const LAYOUT = path.join(ROOT, "src", "shared", "theme", "packs", "vale", "pipIconLayout.ts");
const vendorFile = (id) => `kaleb-vale/pip-icons/${G.fileOf(id)}`;
const BLUE = ["n", "N", "k", "K"];
const LAVENDER = ["7", "8", "9", "0", "W"];

/** A placeholder pack colour role, hex -> rgb. */
function placeholderRole(key) {
	const src = fs.readFileSync(path.join(ROOT, "src", "shared", "theme", "packs", "placeholder", "manifest.ts"), "utf8");
	const m = src.match(new RegExp(`"?${key.replace(/\./g, "\\.")}"?: "#([0-9a-f]{6})"`));
	return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
}

/** The colour pixels of `id`, as palette characters (outline excluded). */
function colourChars(id) {
	return G.drawIcon(id).join("").split("").filter((ch) => ch !== "." && ch !== "o");
}

describe("gen-pip-icons", () => {
	it("draws the full, spent and Aegis pips, matching shared/theme PIP_ICON_IDS", () => {
		assert.deepEqual(G.PIP_IDS, ["ui.pip.armor", "ui.pip.armor.empty", "ui.pip.aegis"]);
		const src = fs.readFileSync(path.join(ROOT, "src", "shared", "theme", "pipIcons.ts"), "utf8");
		for (const id of G.PIP_IDS) assert.ok(src.includes(`"${id}"`), `${id} not in pipIcons.ts`);
	});

	it("names files pip_<name>.png, all different", () => {
		assert.equal(G.fileOf("ui.pip.armor.empty"), "pip_armor_empty.png");
		assert.throws(() => G.fileOf("ui.boost.aegis"), /not a pip id/);
		assert.equal(new Set(G.PIP_IDS.map(G.fileOf)).size, G.PIP_IDS.length);
	});

	it("ramps sit on their roles: the armor blue's third step is uiMana, the lavender's boost.aegis", () => {
		assert.deepEqual(G.PALETTE.k.rgb, placeholderRole("uiMana"));
		assert.deepEqual(G.PALETTE["9"].rgb, placeholderRole("boost.aegis"));
		assert.deepEqual(G.PALETTE.o.rgb, BOON.OUTLINE);
	});

	it("is deterministic (byte-identical PNGs)", () => {
		for (const id of G.PIP_IDS) assert.deepEqual(G.renderIcon(id), G.renderIcon(id));
	});

	it("every pip: 9 x 9, alpha 0 or 255, palette colours only, the same silhouette", () => {
		const colours = new Set(Object.values(G.PALETTE).map((p) => p.rgb.join(",")));
		const mask = (id) => [...PNG.sync.read(G.renderIcon(id)).data].filter((_, i) => i % 4 === 3).join(",");
		for (const id of G.PIP_IDS) {
			const png = PNG.sync.read(G.renderIcon(id));
			assert.equal(png.width, G.SIZE);
			assert.equal(png.height, G.SIZE);
			for (let i = 0; i < G.SIZE * G.SIZE; i++) {
				const a = png.data[i * 4 + 3];
				assert.ok(a === 0 || a === 255, `${id}: alpha ${a}`);
				if (a === 0) continue;
				const rgb = [png.data[i * 4], png.data[i * 4 + 1], png.data[i * 4 + 2]].join(",");
				assert.ok(colours.has(rgb), `${id}: off-palette ${rgb}`);
			}
			assert.equal(mask(id), mask(G.PIP_IDS[0]), `${id}: another silhouette`);
		}
	});

	it("outlined: an outlined colour never touches a clear pixel or the canvas edge", () => {
		for (const id of G.PIP_IDS) {
			const rows = G.drawIcon(id);
			for (let y = 0; y < G.SIZE; y++) {
				for (let x = 0; x < G.SIZE; x++) {
					const ch = rows[y][x];
					if (ch === "." || ch === "o") continue;
					assert.ok(x > 0 && y > 0 && x < G.SIZE - 1 && y < G.SIZE - 1, `${id}: ${ch} at the edge (${x}, ${y})`);
					for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
						assert.notEqual(rows[y + dy][x + dx], ".", `${id}: ${ch} at (${x}, ${y}) has no outline`);
					}
				}
			}
		}
	});

	it("each pip reads as its state: the full one mostly blue, the Aegis one mostly lavender, the spent one neither", () => {
		const share = (id, ramp) => colourChars(id).filter((ch) => ramp.includes(ch)).length / colourChars(id).length;
		assert.ok(share("ui.pip.armor", BLUE) >= 0.5, "armor: too little blue");
		assert.equal(share("ui.pip.armor", LAVENDER), 0);
		assert.ok(share("ui.pip.aegis", LAVENDER) >= 0.9, "aegis: too little lavender");
		assert.equal(share("ui.pip.aegis", BLUE), 0);
		assert.equal(share("ui.pip.armor.empty", BLUE), 0);
		assert.equal(share("ui.pip.armor.empty", LAVENDER), 0);
	});

	it("draws a contact sheet", () => {
		const png = PNG.sync.read(G.renderContact());
		assert.ok(png.width > G.SIZE && png.height > G.SIZE);
	});
});

describe("the pipIcons atlas group", () => {
	it("lists every pip file once, as the whole 9 x 9 canvas", () => {
		const group = CONFIG.pipIcons;
		assert.equal(group.atlas, "pip-icons");
		assert.deepEqual(Object.keys(group.icons).sort(), [...G.PIP_IDS].sort());
		for (const id of G.PIP_IDS) assert.deepEqual(group.icons[id], { file: vendorFile(id), rect: [0, 0, G.SIZE, G.SIZE] });
		assert.deepEqual(A.pipIconSourceFiles(group), G.PIP_IDS.map(vendorFile).sort());
		assert.ok(A.sourceFiles(CONFIG).includes(vendorFile(G.PIP_IDS[0])));
		assert.equal(A.onlyGroup(["node", "x", "--only", "pipIcons"]), "pipIcons");
		assert.deepEqual(A.pipIconSourceFiles(undefined), []);
	});

	it("builds the committed pipIconLayout.ts from the generated pips, every pip read back intact", () => {
		for (const id of G.PIP_IDS) {
			const png = PNG.sync.read(G.renderIcon(id));
			A.sourceCache.set(vendorFile(id), { w: png.width, h: png.height, data: new Uint8Array(png.data) });
		}
		const icons = A.buildPipIcons(CONFIG.pipIcons);
		assert.equal(icons.file, "pip-icons.png");
		assert.equal(A.pipIconLayoutModule(icons), fs.readFileSync(LAYOUT, "utf8"));
		for (const id of G.PIP_IDS) {
			const r = icons.layouts[id].rect;
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
		for (const id of G.PIP_IDS) A.sourceCache.delete(vendorFile(id));
	});

	it("takes ui.pip.* ids only", () => {
		const png = PNG.sync.read(G.renderIcon(G.PIP_IDS[0]));
		A.sourceCache.set("synthetic/pip.png", { w: png.width, h: png.height, data: new Uint8Array(png.data) });
		const section = (id) => ({ atlas: "pip-test", icons: { [id]: { file: "synthetic/pip.png", rect: [0, 0, 9, 9] } } });
		assert.throws(() => A.buildPipIcons(section("ui.boost.aegis")), /pip icon ids start with/);
		assert.doesNotThrow(() => A.buildPipIcons(section("ui.pip.test")));
		A.sourceCache.delete("synthetic/pip.png");
	});
});

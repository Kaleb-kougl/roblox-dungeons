// Specs for the generated boost icons (scripts/art/gen-boost-icons.js; npm run test:art): one icon per boost in
// BOOST_KINDS order, deterministic, every icon a 16 x 16 opaque-or-clear canvas in the palette only, outlined (nothing
// clipped at the canvas edge), drawn largely in its own boost's ramp, distinct from every other icon, boon icon and
// relic / curse icon; and the atlas group that packs them (art/atlases.json `boostIcons`, build-atlases.js
// buildBoostIcons): one entry per icon file, and the generated packs/vale/boostIconLayout.ts is exactly what the build
// makes from these icons.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");
const { PNG } = require("pngjs");
const G = require("./gen-boost-icons.js");
const BOON = require("./gen-boon-icons.js");
const ITEM = require("./gen-item-icons.js");
const A = require("./build-atlases.js");

const ROOT = path.join(__dirname, "..", "..");
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "art", "atlases.json"), "utf8"));
const LAYOUT = path.join(ROOT, "src", "shared", "theme", "packs", "vale", "boostIconLayout.ts");
/** The art/vendor-relative file of an icon (the generator's default out dir). */
const vendorFile = (id) => `kaleb-vale/boost-icons/${G.fileOf(id)}`;
/** The theme id of a boost id (shared/theme boostIconId). */
const iconId = (id) => `ui.${id}`;
/** Each boost's own ramp (palette characters), outlined steps then its glow. */
const RAMPS = {
	"boost.fury": ["f", "F", "a", "M", "!"],
	"boost.quickstep": ["d", "D", "i", "I", "?"],
	"boost.frenzy": ["j", "J", "5", "6", "/"],
	"boost.aegis": ["7", "8", "9", "0", "|"],
};
/** The identity colour of each boost (the placeholder pack's boost.<kind> roles): its ramp's third step. */
const ROLES = {
	"boost.fury": [255, 200, 61],
	"boost.quickstep": [63, 240, 216],
	"boost.frenzy": [168, 240, 60],
	"boost.aegis": [195, 166, 255],
};

/** The kinds of shared/theme BOOST_KINDS, read from the source so a new one fails here. */
function kindsFromSource() {
	const src = fs.readFileSync(path.join(ROOT, "src", "shared", "theme", "contract", "ids.ts"), "utf8");
	const m = src.match(/export const BOOST_KINDS = \[([^\]]*)\]/);
	return [...m[1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]);
}

/** The placeholder pack's boost.<kind> colour role, hex -> rgb. */
function placeholderRole(kind) {
	const src = fs.readFileSync(path.join(ROOT, "src", "shared", "theme", "packs", "placeholder", "manifest.ts"), "utf8");
	const m = src.match(new RegExp(`"boost\\.${kind}": "#([0-9a-f]{6})"`));
	return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
}

describe("gen-boost-icons", () => {
	it("draws one icon per boost, in BOOST_KINDS order", () => {
		assert.deepEqual(G.BOOST_IDS, kindsFromSource().map((k) => `boost.${k}`));
	});

	it("names files boost_<kind>.png, all different", () => {
		assert.equal(G.fileOf("boost.fury"), "boost_fury.png");
		assert.throws(() => G.fileOf("boon.hearty"), /not a boost id/);
		assert.equal(new Set(G.BOOST_IDS.map(G.fileOf)).size, G.BOOST_IDS.length);
	});

	it("keeps the boon palette, adds only new characters, and each ramp's third step is its boost's colour role", () => {
		for (const ch of Object.keys(BOON.PALETTE)) assert.deepEqual(G.PALETTE[ch], BOON.PALETTE[ch], ch);
		for (const id of G.BOOST_IDS) {
			for (const ch of RAMPS[id]) assert.equal(BOON.PALETTE[ch], undefined, `${id}: ${ch} is a boon colour`);
			assert.deepEqual(G.PALETTE[RAMPS[id][2]].rgb, ROLES[id], id);
			assert.deepEqual(ROLES[id], placeholderRole(id.slice("boost.".length)), id);
		}
	});

	it("is deterministic (byte-identical PNGs)", () => {
		for (const id of G.BOOST_IDS) assert.deepEqual(G.renderIcon(id), G.renderIcon(id));
	});

	it("every icon: 16 x 16, alpha 0 or 255, palette colours only, something drawn", () => {
		const colours = new Set(Object.values(G.PALETTE).map((p) => p.rgb.join(",")));
		for (const id of G.BOOST_IDS) {
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
		for (const id of G.BOOST_IDS) {
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

	it("each icon reads as its boost: at least half its colour px in its own ramp, none in another boost's", () => {
		for (const id of G.BOOST_IDS) {
			let colour = 0;
			let own = 0;
			for (const row of G.drawIcon(id)) {
				for (const ch of row) {
					if (ch === "." || ch === "o") continue;
					colour++;
					if (RAMPS[id].includes(ch)) own++;
					for (const other of G.BOOST_IDS) {
						if (other !== id) assert.ok(!RAMPS[other].includes(ch), `${id}: ${ch} is ${other}'s`);
					}
				}
			}
			assert.ok(own * 2 >= colour, `${id}: ${own} of ${colour} px in its ramp`);
		}
	});

	it("no two icons are the same picture, and none repeats a boon, relic or curse icon", () => {
		const seen = new Map(BOON.BOON_IDS.map((id) => [BOON.drawIcon(id).join("\n"), id]));
		for (const id of ITEM.ITEM_IDS) seen.set(ITEM.drawIcon(id).join("\n"), id);
		for (const id of G.BOOST_IDS) {
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

describe("the boostIcons atlas group", () => {
	it("lists every icon file once, as the whole 16 x 16 canvas, under ui.boost.<kind>", () => {
		const group = CONFIG.boostIcons;
		assert.equal(group.atlas, "boost-icons");
		assert.deepEqual(Object.keys(group.icons).sort(), G.BOOST_IDS.map(iconId).sort());
		for (const id of G.BOOST_IDS) {
			assert.deepEqual(group.icons[iconId(id)], { file: vendorFile(id), rect: [0, 0, G.SIZE, G.SIZE] });
		}
		assert.deepEqual(A.boostIconSourceFiles(group), G.BOOST_IDS.map(vendorFile).sort());
		assert.ok(A.sourceFiles(CONFIG).includes(vendorFile(G.BOOST_IDS[0])));
		assert.equal(A.onlyGroup(["node", "x", "--only", "boostIcons"]), "boostIcons");
		assert.deepEqual(A.boostIconSourceFiles(undefined), []);
	});

	it("builds the committed boostIconLayout.ts from the generated icons, every icon read back intact", () => {
		for (const id of G.BOOST_IDS) {
			const png = PNG.sync.read(G.renderIcon(id));
			A.sourceCache.set(vendorFile(id), { w: png.width, h: png.height, data: new Uint8Array(png.data) });
		}
		const icons = A.buildBoostIcons(CONFIG.boostIcons);
		assert.equal(icons.file, "boost-icons.png");
		assert.equal(A.boostIconLayoutModule(icons), fs.readFileSync(LAYOUT, "utf8"));
		for (const id of G.BOOST_IDS) {
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
		for (const id of G.BOOST_IDS) A.sourceCache.delete(vendorFile(id));
	});

	it("takes ui.boost.* ids only", () => {
		const png = PNG.sync.read(G.renderIcon(G.BOOST_IDS[0]));
		A.sourceCache.set("synthetic/boost.png", { w: png.width, h: png.height, data: new Uint8Array(png.data) });
		const section = (id) => ({ atlas: "boost-test", icons: { [id]: { file: "synthetic/boost.png", rect: [0, 0, 16, 16] } } });
		assert.throws(() => A.buildBoostIcons(section("ui.relic.hourglass")), /boost icon ids start with/);
		assert.doesNotThrow(() => A.buildBoostIcons(section("ui.boost.test")));
		A.sourceCache.delete("synthetic/boost.png");
	});
});

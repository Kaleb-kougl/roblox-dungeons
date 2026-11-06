// Specs for the atlas pipeline's goo group (docs/GOO_ART.md GA1; npm run test:art): the one-crop cut of the land and
// hold frames, the cells and their indexes, the pivot and lit box, the recolour (alpha and the black outline kept), the
// lit mean and its gate, gooLayout.ts, the scoped lock / --only, and that the group touches no other output. Synthetic
// PNGs (made and decoded with pngjs, put in the pipeline's source cache); the last spec also checks the committed
// gooLayout.ts against the real pack when art/vendor holds it (skipped otherwise).
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it, beforeEach } = require("node:test");
const { PNG } = require("pngjs");
const A = require("./build-atlases.js");

const ROOT = path.join(__dirname, "..", "..");
const LAYOUT_DIR = path.join(ROOT, "src", "shared", "theme", "packs", "vale");
const rgbaAt = (img, x, y) => [...img.data.subarray((y * img.w + x) * 4, (y * img.w + x) * 4 + 4)];

/** A w x h PNG (through pngjs, so the cache holds what readPng would decode) with `paint(x, y)` -> rgba | null. */
function syntheticPng(rel, w, h, paint) {
	const png = new PNG({ width: w, height: h });
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const c = paint(x, y) || [0, 0, 0, 0];
			png.data.set(c, (y * w + x) * 4);
		}
	}
	const back = PNG.sync.read(PNG.sync.write(png));
	A.sourceCache.set(rel, { w: back.width, h: back.height, data: new Uint8Array(back.data) });
}

// the pack's colours and their Rec. 601 luminances
const BLACK = [0, 0, 0, 255];
const DARK = [0x37, 0x66, 0x33, 255]; // 82
const GREEN = [0x56, 0xc4, 0x4d, 255]; // 150
const LIGHT = [0xa1, 0xe0, 0x9c, 255]; // 197
const RED = [255, 0, 0, 255];
const FW = 12;
const FH = 10;

/**
 * A 5-frame strip of 12 x 10 cells. Frames 0-2: a red block (never read). Frame 3 (land): x 4..7, y 5..6, black at
 * x 4 and 7, green inside. Frame 4 (hold): x 2..9, y 3..7, a black border, row 4 light, rows 5..6 green but (3, 6) dark.
 * Union box 2,3 .. 9,7; with pad 1 the cell is 10 x 7, the hold lit box 8 x 5 at cell (1, 1), the land at cell (3, 3).
 */
function slimeStrip(rel) {
	syntheticPng(rel, 5 * FW, FH, (x, y) => {
		const f = Math.floor(x / FW);
		const lx = x % FW;
		if (f < 3) return lx >= 1 && lx <= 10 && y >= 0 && y <= 9 ? RED : null;
		if (f === 3) {
			if (lx < 4 || lx > 7 || y < 5 || y > 6) return null;
			return lx === 4 || lx === 7 ? BLACK : GREEN;
		}
		if (lx < 2 || lx > 9 || y < 3 || y > 7) return null;
		if (lx === 2 || lx === 9 || y === 3 || y === 7) return BLACK;
		if (y === 4) return LIGHT;
		return lx === 3 && y === 6 ? DARK : GREEN;
	});
}

const RAMP = [
	[0, "#000000"],
	[82, "#700070"],
	[110, "#b000b0"],
	[150, "#f000f0"],
	[197, "#ff80ff"],
	[255, "#ffffff"],
];

function gooSet(overrides = {}) {
	return { file: "t/slime.png", frameW: FW, frames: 5, land: 3, hold: [4], recolor: { ramp: RAMP }, ...overrides };
}

function group(overrides = {}, set = gooSet()) {
	return {
		$comment: "ignored",
		atlas: "goo",
		pad: 1,
		pixelsPerTile: 29.6,
		gates: { role: "#f000f0", maxDifference: 12, minContrast: 3, surfaces: ["#24242c", "#3a3a46"] },
		sets: { $comment: "ignored", "bullet.enemy.goo": set },
		...overrides,
	};
}

beforeEach(() => {
	A.sourceCache.clear();
	slimeStrip("t/slime.png");
});

describe("buildGoo: cells", () => {
	it("cuts land then hold with ONE crop (union alpha box + pad), each frame where the source draws it", () => {
		const g = A.buildGoo(group(), undefined);
		assert.deepEqual(g.box, [2, 3, 9, 7]);
		assert.deepEqual(g.holdBox, [2, 3, 9, 7]);
		assert.equal(g.cells.length, 2);
		assert.deepEqual([g.layout.frameW, g.layout.frameH], [10, 7]);
		// land: source (4, 5) -> cell (3, 3); nothing outside its 4 x 2 there
		const land = g.cells[g.layout.land];
		for (let y = 0; y < 7; y++) {
			for (let x = 0; x < 10; x++) assert.equal(rgbaAt(land, x, y)[3] > 0, x >= 3 && x <= 6 && y >= 3 && y <= 4, `land ${x},${y}`);
		}
		// hold: source (2, 3) -> cell (1, 1); the pad ring clear
		const hold = g.cells[g.layout.hold];
		for (let y = 0; y < 7; y++) {
			for (let x = 0; x < 10; x++) assert.equal(rgbaAt(hold, x, y)[3] > 0, x >= 1 && x <= 8 && y >= 1 && y <= 5, `hold ${x},${y}`);
		}
	});

	it("lays out the interface's fields: land cell 0, hold cell 1, one variant, lit box and its centre as the pivot", () => {
		const g = A.buildGoo(group(), undefined);
		assert.deepEqual(Object.keys(g.layout), ["frameW", "frameH", "pivot", "land", "hold", "holdFrames", "litW", "litH", "meanColor", "pixelsPerTile"]);
		assert.deepEqual(g.layout, {
			frameW: 10,
			frameH: 7,
			pivot: { x: 5, y: 3.5 },
			land: 0,
			hold: 1,
			holdFrames: 1,
			litW: 8,
			litH: 5,
			meanColor: "#ee23ee",
			pixelsPerTile: 29.6,
		});
		assert.deepEqual(g.sheet, { file: "goo.png", w: 20, h: 7 });
		assert.equal(g.pixelsPerTileFrom, undefined);
	});

	it("the sheet's cells, read through the SpriteSetAsset formula, are the cut cells; a second hold variant is cell 2", () => {
		const check = (g) => {
			const l = g.layout;
			const perRow = Math.floor(g.sheet.w / l.frameW);
			const cellsInOrder = [l.land, ...Array.from({ length: l.holdFrames }, (_, k) => l.hold + k)];
			assert.deepEqual(cellsInOrder, [...g.cells.keys()]);
			for (const c of cellsInOrder) {
				const x0 = (c % perRow) * l.frameW;
				const y0 = Math.floor(c / perRow) * l.frameH;
				for (let y = 0; y < l.frameH; y++) {
					for (let x = 0; x < l.frameW; x++) {
						const want = rgbaAt(g.cells[c], x, y);
						const got = rgbaAt(g.img, x0 + x, y0 + y);
						assert.equal(got[3], want[3]);
						if (want[3] > 0) assert.deepEqual(got, want);
					}
				}
			}
		};
		check(A.buildGoo(group(), undefined));
		// frame 2 (the red block, 10 x 10 at x 1) as a second variant: the union lit box grows over both hold frames
		const two = A.buildGoo(group({ gates: { role: "#f000f0", maxDifference: 200, minContrast: 1, surfaces: ["#24242c"] } }, gooSet({ hold: [4, 2] })), undefined);
		assert.deepEqual([two.layout.hold, two.layout.holdFrames, two.sheet.w], [1, 2, 3 * two.layout.frameW]);
		assert.deepEqual(two.holdBox, [1, 0, 10, 9]);
		assert.deepEqual([two.layout.litW, two.layout.litH], [10, 10]);
		check(two);
	});

	it("contact sheet reads every cell back", () => {
		const c = A.gooContact(A.buildGoo(group(), undefined));
		assert.ok(c.w > 0 && c.h > 0);
	});
});

describe("buildGoo: recolour, mean and gate", () => {
	it("keeps every alpha and keeps the black outline black; lit pixels take the ramp in luminance order", () => {
		const g = A.buildGoo(group(), undefined);
		const plain = A.buildGoo(group({ gates: { role: "#f000f0", maxDifference: 200, minContrast: 1, surfaces: ["#24242c"] } }, gooSet({ recolor: undefined })), undefined);
		assert.equal(g.recolorStops, 6);
		assert.equal(plain.recolorStops, 0);
		assert.deepEqual(g.box, plain.box);
		for (let c = 0; c < 2; c++) {
			for (let i = 0; i < 70; i++) assert.equal(g.cells[c].data[i * 4 + 3], plain.cells[c].data[i * 4 + 3]);
		}
		for (let i = 0; i < g.img.w * g.img.h; i++) assert.equal(g.img.data[i * 4 + 3], plain.img.data[i * 4 + 3]);
		const hold = g.cells[1];
		assert.deepEqual(rgbaAt(hold, 1, 1), BLACK); // the border (source black) stays #000000
		assert.deepEqual(rgbaAt(hold, 8, 5), BLACK);
		assert.deepEqual(rgbaAt(g.cells[0], 3, 3), BLACK);
		assert.deepEqual(rgbaAt(g.img, 10 + 1, 1), BLACK); // in the sheet too, after the bleed
		assert.deepEqual(rgbaAt(hold, 2, 2), [0xff, 0x80, 0xff, 255]); // light -> lighter magenta
		assert.deepEqual(rgbaAt(hold, 3, 3), [0xf0, 0x00, 0xf0, 255]); // green (the body) -> enemyGoo
		assert.deepEqual(rgbaAt(hold, 2, 4), [0x70, 0x00, 0x70, 255]); // dark -> darker magenta
	});

	it("meanColor: alpha-weighted over every cell's pixels with max RGB > 32 (outline out), after the recolour", () => {
		// lit: 6 light (#ff80ff), 15 green (#f000f0), 1 dark (#700070) -> (238.3, 34.9, 238.3)
		assert.equal(A.buildGoo(group(), undefined).layout.meanColor, "#ee23ee");
		const img = A.raster(3, 1);
		img.data.set([0, 0, 0, 255, 32, 32, 32, 255, 200, 100, 0, 128], 0); // black, max 32: both out; one half-alpha lit
		assert.equal(A.litMeanColor([img], 32), "#c86400");
		img.data.set([33, 0, 0, 255], 4); // max 33 counts
		assert.equal(A.litMeanColor([img], 32), "#592100"); // (33 x 255 + 200 x 128) / 383 = 88.8; 100 x 128 / 383 = 33.4
		assert.throws(() => A.litMeanColor([A.raster(2, 2)], 32), /no lit pixels/);
	});

	it("the gate: mean <= maxDifference CIE76 from the role and >= minContrast on every surface; a failure fails the build", () => {
		const r = A.gooGate("#ee23ee", group().gates);
		assert.equal(r.id, "bullet.enemy.goo");
		assert.ok(r.ok && r.difference < 12 && r.worst >= 3);
		assert.equal(r.difference, A.cie76("#ee23ee", "#f000f0"));
		assert.throws(() => A.buildGoo(group({}, gooSet({ recolor: undefined })), undefined), /goo: colour gate failed:\n {2}bullet\.enemy\.goo: mean #[0-9a-f]{6}, [\d.]+ CIE76 from #f000f0 \(<= 12\).*FAIL/);
		const dim = group();
		dim.gates.surfaces = ["#24242c", "#d0d0d0"]; // a light surface: under 3:1
		assert.throws(() => A.buildGoo(dim, undefined), /worst contrast [\d.]+ on #d0d0d0 \(>= 3\)  FAIL/);
	});

	it("pixelsPerTileFrom: unchecked without sprite sets, equal passes, a different density or a missing set fails", () => {
		const g = group({ pixelsPerTileFrom: "enemy.swarmer" });
		assert.deepEqual(A.buildGoo(g, undefined).pixelsPerTileFrom, { id: "enemy.swarmer", checked: false });
		const swarmer = (ppt) => [{ id: "enemy.swarmer", layout: { pixelsPerTile: ppt } }];
		assert.deepEqual(A.buildGoo(g, swarmer(29.6)).pixelsPerTileFrom, { id: "enemy.swarmer", checked: true });
		assert.throws(() => A.buildGoo(g, swarmer(30)), /goo\.pixelsPerTile 29\.6 differs from enemy\.swarmer's 30/);
		assert.throws(() => A.buildGoo(g, []), /goo\.pixelsPerTileFrom names no sprite set enemy\.swarmer/);
	});

	it("refuses a malformed group or set", () => {
		const bad = (g, re) => assert.throws(() => A.buildGoo(g, undefined), re);
		bad(group({ upscale: 2 }), /goo: unknown key upscale/);
		bad(group({ atlas: "Goo.png" }), /goo\.atlas/);
		bad(group({ pad: -1 }), /goo\.pad/);
		bad(group({ pixelsPerTile: 0 }), /goo\.pixelsPerTile/);
		bad(group({ sets: { "bullet.enemy.ember": gooSet() } }), /exactly one set, bullet\.enemy\.goo/);
		bad(group({ sets: { "bullet.enemy.goo": gooSet(), "bullet.enemy.x": gooSet() } }), /exactly one set/);
		bad(group({}, gooSet({ resample: "Default" })), /unknown goo set key resample/);
		bad(group({}, gooSet({ file: "" })), /needs a file/);
		bad(group({}, gooSet({ frameW: 10 })), /60 px wide, not 5 frames x 10 px/);
		bad(group({}, gooSet({ land: 5 })), /land frame 5 outside 0\.\.4/);
		bad(group({}, gooSet({ hold: [] })), /hold must list at least one/);
		bad(group({}, gooSet({ hold: [3] })), /land and hold must name different strip frames/);
		bad(group({}, gooSet({ recolor: { ramp: [[0, "#000000"]] } })), /bullet\.enemy\.goo: recolor ramp/);
		bad(group({ gates: { role: "#f000f0", maxDifference: 12, minContrast: 3, surfaces: [] } }), /goo\.gates\.surfaces/);
		bad(group({ gates: { role: "magenta", maxDifference: 12, minContrast: 3, surfaces: ["#24242c"] } }), /goo\.gates\.role/);
		bad(group({ gates: { role: "#f000f0", maxDifference: 12, minContrast: 3, surfaces: ["#24242c"], player: {} } }), /goo\.gates: unknown key player/);
	});

	it("is deterministic: two builds give byte-identical PNGs, contact sheets and layout text", () => {
		const one = A.buildGoo(group(), undefined);
		A.sourceCache.clear();
		slimeStrip("t/slime.png");
		const two = A.buildGoo(group(), undefined);
		const png = A.encodePng(one.img);
		assert.ok(Buffer.compare(png, A.encodePng(two.img)) === 0);
		assert.ok(Buffer.compare(A.encodePng(A.gooContact(one)), A.encodePng(A.gooContact(two))) === 0);
		assert.equal(A.gooLayoutModule(one.sheet, one.layout), A.gooLayoutModule(two.sheet, two.layout));
		const back = PNG.sync.read(png);
		assert.deepEqual([back.width, back.height], [one.img.w, one.img.h]);
		assert.deepEqual(new Uint8Array(back.data), one.img.data);
	});
});

describe("gooLayoutModule", () => {
	it("prints the committed gooLayout.ts's head (imports, ValeGooLayout) and the two constants", () => {
		const committed = fs.readFileSync(path.join(LAYOUT_DIR, "gooLayout.ts"), "utf8");
		const head = (t) => t.slice(0, t.indexOf("export const VALE_GOO_SHEET"));
		const g = A.buildGoo(group(), undefined);
		const text = A.gooLayoutModule(g.sheet, g.layout);
		assert.equal(head(text), head(committed));
		assert.ok(text.startsWith("// GENERATED by `npm run art:build` (scripts/art/build-atlases.js) from art/atlases.json. Do not edit.\n"));
		assert.match(text, /import type \{ HexColor, Pivot \} from "\.\.\/\.\.\/types";\nimport type \{ ValeSheetFile \} from "\.\/layout";\n/);
		assert.match(text, /export const VALE_GOO_SHEET: ValeSheetFile = \{\n\tfile: "goo\.png",\n\tw: 20,\n\th: 7,\n\};\n/);
		assert.ok(
			text.endsWith(
				"export const VALE_GOO_LAYOUT: ValeGooLayout = {\n\tframeW: 10,\n\tframeH: 7,\n\tpivot: { x: 5, y: 3.5 },\n\tland: 0,\n\thold: 1,\n\tholdFrames: 1,\n" +
					'\tlitW: 8,\n\tlitH: 5,\n\tmeanColor: "#ee23ee",\n\tpixelsPerTile: 29.6,\n};\n',
			),
		);
		// the interface's fields, in order, with their types
		const fields = [...head(text).matchAll(/^\t(\w+): (\w+);$/gm)].map((m) => `${m[1]}: ${m[2]}`);
		assert.deepEqual(fields, ["frameW: number", "frameH: number", "pivot: Pivot", "land: number", "hold: number", "holdFrames: number", "litW: number", "litH: number", "meanColor: HexColor", "pixelsPerTile: number"]);
	});
});

describe("goo: sources, the scoped lock, --only and every other output", () => {
	it("gooSourceFiles is the set's file; sourceFiles adds it; no goo group adds nothing", () => {
		assert.deepEqual(A.gooSourceFiles(undefined), []);
		assert.deepEqual(A.gooSourceFiles(group()), ["t/slime.png"]);
		const base = { spriteSets: {}, images: {} };
		assert.deepEqual(A.sourceFiles(base), []);
		assert.deepEqual(A.sourceFiles({ ...base, goo: group() }), ["t/slime.png"]);
		assert.throws(() => A.gooSourceFiles(group({ sets: {} })), /goo\.sets\.bullet\.enemy\.goo needs a file/);
	});

	it("onlyGroup takes goo; the scoped lock re-hashes only the goo file", () => {
		assert.equal(A.onlyGroup(["node", "build-atlases.js", "--only", "goo"]), "goo");
		assert.equal(A.onlyGroup(["node", "build-atlases.js", "--lock", "--only", "goo"]), "goo");
		assert.deepEqual(A.onlyGroupSourceFiles({ goo: group() }, "goo"), ["t/slime.png"]);
		const bullets = { sets: { "bullet.player.basic": { file: "t/yellow.png", frameW: 6, frames: 3 } } };
		assert.deepEqual(A.onlyGroupSourceFiles({ bullets, goo: group() }, "bullets"), ["t/yellow.png"]);
	});

	it("the real config: goo reads only the Slime pack's file, read by no other group; everything else's sources are as without it", () => {
		const config = JSON.parse(fs.readFileSync(path.join(ROOT, "art", "atlases.json"), "utf8"));
		assert.ok(config.goo, "art/atlases.json has a goo group");
		const goo = A.gooSourceFiles(config.goo);
		assert.deepEqual(goo, ["Free Slimes Asset Pack/Green Slime/green slime-Death Down.png"]);
		const { goo: _, ...rest } = config;
		const without = A.sourceFiles(rest);
		for (const f of goo) assert.ok(!without.includes(f), `${f} is also read by another group`);
		assert.deepEqual(A.sourceFiles(config), [...without, ...goo].sort());
		assert.ok(!A.bulletSourceFiles(config.bullets).some((f) => f.startsWith("Free Slimes Asset Pack/")));
		assert.equal(config.goo.atlas, "goo");
		assert.ok(!Object.keys(config.bullets.sets).includes("bullet.enemy.goo"), "goo is not in bullets.png");
		assert.notEqual(config.bullets.atlas, config.goo.atlas);
		// the lock holds the goo file (art:lock --only goo)
		const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "art", "vendor.lock.json"), "utf8"));
		for (const f of goo) assert.ok(lock.files.some((e) => e.path === f), `${f} is in art/vendor.lock.json`);
	});

	it("building goo leaves the bullet atlas byte-identical (no shared state): bullets built before and after match", () => {
		const boltStrip = (rel) =>
			syntheticPng(rel, 18, 10, (x, y) => {
				const lx = x % 6;
				return lx >= 2 && lx <= 3 && y >= 3 && y < 7 + Math.floor(x / 6) ? [250, 220, 40, 255] : null;
			});
		boltStrip("t/yellow.png");
		const bullets = {
			atlas: "bullets",
			pad: 1,
			fps: 10,
			pixelsPerTile: 29.6,
			gates: {
				enemy: { role: "#ff3fa4", maxDifference: 12, minContrast: 3, surfaces: ["#24242c"] },
				player: { minDifference: 40, from: { enemyBullet: "#ff3fa4", enemyBulletOutline: "#1a0610", telegraph: "#ff8a3d" } },
			},
			sets: { "bullet.player.basic": { file: "t/yellow.png", frameW: 6, frames: 3 } },
		};
		const before = A.buildBullets(bullets, undefined);
		A.buildGoo(group(), undefined);
		const after = A.buildBullets(bullets, undefined);
		assert.ok(Buffer.compare(A.encodePng(before.packed.img), A.encodePng(after.packed.img)) === 0);
		assert.equal(A.bulletLayoutModule(after.sheet, after.layouts, after.fxLayouts), A.bulletLayoutModule(before.sheet, before.layouts, before.fxLayouts));
		// and the committed bulletLayout.ts has no goo in it
		assert.ok(!fs.readFileSync(path.join(LAYOUT_DIR, "bulletLayout.ts"), "utf8").includes("goo"));
	});

	const real = path.join(ROOT, "art", "vendor", "Free Slimes Asset Pack", "Green Slime", "green slime-Death Down.png");
	it("with the real pack on disk: the committed gooLayout.ts and art/build/goo.png are what the config builds", { skip: !fs.existsSync(real) && "art/vendor has no Slime pack" }, () => {
		const config = JSON.parse(fs.readFileSync(path.join(ROOT, "art", "atlases.json"), "utf8"));
		const g = A.buildGoo(config.goo, undefined);
		assert.equal(A.gooLayoutModule(g.sheet, g.layout), fs.readFileSync(path.join(LAYOUT_DIR, "gooLayout.ts"), "utf8"));
		assert.deepEqual(g.layout.pivot, { x: 16.5, y: 9.5 });
		assert.deepEqual([g.layout.frameW, g.layout.frameH, g.layout.litW, g.layout.litH], [33, 19, 31, 17]);
		assert.ok(g.gate.difference <= 12);
		const built = path.join(ROOT, "art", "build", "goo.png");
		if (fs.existsSync(built)) assert.ok(Buffer.compare(A.encodePng(g.img), fs.readFileSync(built)) === 0);
	});
});

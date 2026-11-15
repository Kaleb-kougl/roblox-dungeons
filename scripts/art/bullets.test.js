// Specs for the atlas pipeline's bullet group (docs/PROJECTILE_ART.md PA2; npm run test:art): strip cuts, the union
// crop, recolour, the colour gates, packing, bulletLayout.ts, the scoped lock and determinism. Synthetic PNGs (made and
// decoded with pngjs, put in the pipeline's source cache), no art/vendor files.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it, beforeEach } = require("node:test");
const { PNG } = require("pngjs");
const A = require("./build-atlases.js");

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

const YELLOW = [250, 220, 40, 255];
const GREEN = [40, 220, 150, 255];
const GREY = [150, 150, 150, 255];
const DARK = [60, 60, 60, 255];

/** A 3-frame 6 px strip, 10 high: frame f a 2 x (4 + f) bar at x 2..3 from y 3 (so the union box is 2,3 .. 3,8). */
function boltStrip(rel, rgba) {
	syntheticPng(rel, 18, 10, (x, y) => {
		const f = Math.floor(x / 6);
		const lx = x % 6;
		return lx >= 2 && lx <= 3 && y >= 3 && y < 7 + f ? rgba : null;
	});
}

/** A 2-frame 8 px strip, 8 high: frame 0 a grey 4x4 block at 1,2; frame 1 a 2x2 dark block at 3,3. */
function enemyStrip(rel) {
	syntheticPng(rel, 16, 8, (x, y) => {
		if (x < 8) return x >= 1 && x <= 4 && y >= 2 && y <= 5 ? (y === 2 ? DARK : GREY) : null;
		return x >= 11 && x <= 12 && y >= 3 && y <= 4 ? DARK : null;
	});
}

/** bulletLayoutModule's trailer without any `own` set (docs/NEW_ENEMIES_2.md NX8). */
const OWN_SHEETS_NONE =
	"\n/** The bullets' own sheets by file (a layout's `sheet`; art/atlases.json bullets set `own`). */\n" +
	"export const VALE_BULLET_OWN_SHEETS: Record<string, ValeSheetFile> = {};\n";

const RAMP = [
	[0, "#1a0610"],
	[60, "#c0206f"],
	[150, "#ff3fa4"],
	[255, "#ffe0f0"],
];

function group(overrides = {}) {
	return {
		atlas: "bullets",
		pad: 1,
		fps: 10,
		pixelsPerTile: 29.6,
		gates: {
			enemy: { role: "#ff3fa4", maxDifference: 12, minContrast: 3, surfaces: ["#24242c", "#3a3a46"] },
			player: { minDifference: 40, from: { enemyBullet: "#ff3fa4", enemyBulletOutline: "#1a0610", telegraph: "#ff8a3d" } },
		},
		lockAlso: ["t/spare.png"],
		sets: {
			$comment: "ignored",
			"bullet.player.basic": { file: "t/yellow.png", frameW: 6, frames: 3 },
			"bullet.player.bolt": { file: "t/green.png", frameW: 6, frames: 3, fps: 12 },
			"bullet.enemy.small": { file: "t/grey.png", frameW: 8, frames: 2, keep: [0], recolor: { ramp: RAMP } },
		},
		...overrides,
	};
}

beforeEach(() => {
	A.sourceCache.clear();
	boltStrip("t/yellow.png", YELLOW);
	boltStrip("t/green.png", GREEN);
	enemyStrip("t/grey.png");
});

describe("buildBulletSet", () => {
	it("cuts the strip, crops every frame to the union alpha box + pad, measures the mean; fps from the group", () => {
		const s = A.buildBulletSet("bullet.player.basic", { file: "t/yellow.png", frameW: 6, frames: 3 }, group());
		assert.deepEqual(s.box, [2, 3, 3, 8]);
		assert.deepEqual([s.frameW, s.frameH, s.frames.length, s.fps, s.sourceH], [4, 8, 3, 10, 10]);
		assert.equal(s.meanColor, "#fadc28");
		// frame 0: rows 3..6 opaque -> cell rows 1..4; the pad ring and row 5+ clear
		assert.deepEqual(rgbaAt(s.frames[0], 1, 1), YELLOW);
		assert.deepEqual(rgbaAt(s.frames[0], 2, 4), YELLOW);
		assert.equal(rgbaAt(s.frames[0], 1, 5)[3], 0);
		assert.equal(rgbaAt(s.frames[0], 0, 1)[3], 0);
		assert.deepEqual(rgbaAt(s.frames[2], 2, 6), YELLOW);
		assert.equal(rgbaAt(s.frames[2], 2, 7)[3], 0);
	});

	it("`keep` picks strip frames (a strip half); the crop is that frame's own box", () => {
		const s = A.buildBulletSet("bullet.enemy.x", { file: "t/grey.png", frameW: 8, frames: 2, keep: [1] }, group({ pad: 0 }));
		assert.deepEqual(s.box, [3, 3, 4, 4]);
		assert.deepEqual([s.frameW, s.frameH, s.frames.length], [2, 2, 1]);
		assert.deepEqual(rgbaAt(s.frames[0], 0, 0), DARK);
	});

	it("`recolor` maps every pixel through the ramp before the crop; alpha and the box are the uncoloured set's", () => {
		const plain = A.buildBulletSet("bullet.enemy.small", { file: "t/grey.png", frameW: 8, frames: 2, keep: [0] }, group());
		const pink = A.buildBulletSet("bullet.enemy.small", { file: "t/grey.png", frameW: 8, frames: 2, keep: [0], recolor: { ramp: RAMP } }, group());
		assert.deepEqual(pink.box, plain.box);
		assert.deepEqual([pink.frameW, pink.frameH, pink.recolorStops, plain.recolorStops], [plain.frameW, plain.frameH, 4, 0]);
		const lut = A.recolorLut("t", { ramp: RAMP });
		const at = (l) => [lut[l * 3], lut[l * 3 + 1], lut[l * 3 + 2], 255];
		assert.deepEqual(rgbaAt(pink.frames[0], 1, 1), at(60)); // the dark top row, luminance 60
		assert.deepEqual(rgbaAt(pink.frames[0], 1, 2), at(150)); // grey 150 lands on the role
		assert.deepEqual(rgbaAt(pink.frames[0], 1, 2), [0xff, 0x3f, 0xa4, 255]);
		for (let i = 0; i < pink.frames[0].w * pink.frames[0].h; i++) assert.equal(pink.frames[0].data[i * 4 + 3], plain.frames[0].data[i * 4 + 3]);
		// the mean is taken after the recolour: 4 of 16 pixels #c0206f, 12 the role -> (239.25, 55.25, 150.75)
		assert.equal(pink.meanColor, "#ef3797");
		assert.equal(plain.meanColor, "#808080"); // (4 x 60 + 12 x 150) / 16 = 127.5 -> 128
	});

	it("refuses a malformed set", () => {
		const bad = (def, re, g = group()) => assert.throws(() => A.buildBulletSet("bullet.t", def, g), re);
		bad({ file: "t/yellow.png", frameW: 6, frames: 3, rect: [0, 0, 6, 10] }, /unknown bullet set key rect/);
		bad({ frameW: 6, frames: 3 }, /needs a file/);
		bad({ file: "t/yellow.png", frameW: 0, frames: 3 }, /positive integers/);
		bad({ file: "t/yellow.png", frameW: 5, frames: 3 }, /18 px wide, not 3 frames x 5 px/);
		bad({ file: "t/yellow.png", frameW: 6, frames: 3, keep: [3] }, /keep frame 3 outside 0\.\.2/);
		bad({ file: "t/yellow.png", frameW: 6, frames: 3 }, /fps/, group({ fps: undefined }));
		bad({ file: "t/yellow.png", frameW: 6, frames: 3 }, /bullets\.pad/, group({ pad: -1 }));
		bad({ file: "t/yellow.png", frameW: 6, frames: 3, recolor: { ramp: [[0, "#000000"]] } }, /bullet\.t: recolor ramp/);
	});
});

describe("colour maths (mirrors shared/theme color.ts)", () => {
	it("contrast is WCAG 2.x; CIE76 is the Lab distance", () => {
		assert.equal(A.wcagContrast("#000000", "#ffffff"), 21);
		assert.equal(A.wcagContrast("#ff3fa4", "#ff3fa4"), 1);
		assert.equal(A.cie76("#ff3fa4", "#ff3fa4"), 0);
		assert.ok(Math.abs(A.cie76("#000000", "#ffffff") - 100) < 1e-3);
		// relative luminance of #ff3fa4 0.2751 vs #3a3a46 0.0436: (0.3251 / 0.0936)
		assert.ok(Math.abs(A.wcagContrast("#ff3fa4", "#3a3a46") - 3.473) < 0.01);
	});
});

describe("bulletGates", () => {
	const gates = group().gates;
	const set = (id, meanColor) => ({ id, meanColor });

	it("an enemy mean must be near the role and light enough on every surface; a player mean far from every danger role", () => {
		const rows = A.bulletGates([set("bullet.enemy.a", "#ff3fa4"), set("bullet.enemy.b", "#ff80c0"), set("bullet.enemy.c", "#c0206f"), set("bullet.player.a", "#52df9a"), set("bullet.player.b", "#f0a040"), set("bullet.odd", "#ffffff")], gates);
		const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
		assert.equal(byId["bullet.enemy.a"].ok, true);
		assert.equal(byId["bullet.enemy.a"].difference, 0);
		assert.equal(byId["bullet.enemy.a"].worstOn, "#3a3a46");
		assert.equal(byId["bullet.enemy.b"].ok, false); // light enough, but too far from the role
		assert.ok(byId["bullet.enemy.b"].difference > 12);
		assert.equal(byId["bullet.enemy.c"].ok, false); // too dark and too far
		assert.ok(byId["bullet.enemy.c"].worst < 3);
		assert.equal(byId["bullet.player.a"].ok, true);
		assert.equal(byId["bullet.player.b"].ok, false); // amber: near the telegraph orange
		assert.equal(byId["bullet.player.b"].nearestTo, "telegraph");
		assert.equal(byId["bullet.odd"].side, "unknown");
		assert.equal(byId["bullet.odd"].ok, false);
	});

	it("refuses malformed gates", () => {
		assert.throws(() => A.bulletGates([], undefined), /needs enemy and player/);
		assert.throws(() => A.bulletGates([], { ...gates, enemy: { ...gates.enemy, role: "pink" } }), /enemy\.role/);
		assert.throws(() => A.bulletGates([], { ...gates, enemy: { ...gates.enemy, surfaces: [] } }), /surfaces/);
		assert.throws(() => A.bulletGates([], { ...gates, player: { minDifference: 40, from: {} } }), /player\.from/);
		assert.throws(() => A.bulletGates([], { ...gates, player: { ...gates.player, minDifference: 0 } }), /player\.minDifference/);
	});
});

describe("buildBullets", () => {
	it("packs every set into one atlas whose cells the layout's formula reads back; pivot = cell centre", () => {
		const b = A.buildBullets(group(), undefined);
		assert.equal(b.file, "bullets.png");
		assert.deepEqual(Object.keys(b.layouts), ["bullet.enemy.small", "bullet.player.basic", "bullet.player.bolt"]);
		assert.deepEqual(b.sheet, { file: "bullets.png", w: b.packed.w, h: b.packed.h });
		for (const s of b.sets) {
			const l = b.layouts[s.id];
			assert.deepEqual(Object.keys(l), ["frameW", "frameH", "pivot", "start", "frames", "fps", "meanColor", "pixelsPerTile"]);
			assert.deepEqual(l.pivot, { x: l.frameW / 2, y: l.frameH / 2 });
			assert.equal(l.pixelsPerTile, 29.6);
			assert.equal(l.meanColor, s.meanColor);
			const perRow = Math.floor(b.packed.w / l.frameW);
			for (let f = 0; f < l.frames; f++) {
				const c = l.start + f;
				const x0 = (c % perRow) * l.frameW;
				const y0 = Math.floor(c / perRow) * l.frameH;
				for (let y = 0; y < l.frameH; y++) {
					for (let x = 0; x < l.frameW; x++) {
						const want = rgbaAt(s.frames[f], x, y);
						const got = rgbaAt(b.packed.img, x0 + x, y0 + y);
						assert.equal(got[3], want[3]);
						if (want[3] > 0) assert.deepEqual(got, want);
					}
				}
			}
		}
		assert.equal(b.layouts["bullet.player.bolt"].fps, 12);
		assert.equal(b.pixelsPerTileFrom, undefined);
		const contact = A.bulletContact(b);
		assert.ok(contact.w > 0 && contact.h > 0);
	});

	it("pixelsPerTileFrom: unchecked without sprite sets, equal passes, a different density or a missing set fails", () => {
		const g = group({ pixelsPerTileFrom: "enemy.swarmer" });
		assert.deepEqual(A.buildBullets(g, undefined).pixelsPerTileFrom, { id: "enemy.swarmer", checked: false });
		const swarmer = (ppt) => [{ id: "enemy.swarmer", layout: { pixelsPerTile: ppt } }];
		assert.deepEqual(A.buildBullets(g, swarmer(29.6)).pixelsPerTileFrom, { id: "enemy.swarmer", checked: true });
		assert.throws(() => A.buildBullets(g, swarmer(30)), /pixelsPerTile 29\.6 differs from enemy\.swarmer's 30/);
		assert.throws(() => A.buildBullets(g, []), /names no sprite set enemy\.swarmer/);
	});

	it("a failed gate fails the build and names the set", () => {
		const g = group();
		g.sets["bullet.enemy.small"] = { file: "t/grey.png", frameW: 8, frames: 2, keep: [0] }; // grey, not recoloured
		assert.throws(() => A.buildBullets(g, undefined), /colour gates failed:\n {2}bullet\.enemy\.small: mean #808080.*FAIL/);
		const p = group();
		p.sets["bullet.player.basic"].file = "t/grey.png";
		p.sets["bullet.player.basic"].frameW = 8;
		p.sets["bullet.player.basic"].frames = 2;
		p.sets["bullet.player.basic"].recolor = { ramp: RAMP }; // a pink player bullet
		assert.throws(() => A.buildBullets(p, undefined), /bullet\.player\.basic: mean .* from enemyBullet .*FAIL/);
	});

	it("refuses a malformed group", () => {
		assert.throws(() => A.buildBullets(group({ upscale: 2 }), undefined), /bullets: unknown key upscale/);
		assert.throws(() => A.buildBullets(group({ atlas: "Bullets.png" }), undefined), /bullets\.atlas/);
		assert.throws(() => A.buildBullets(group({ pixelsPerTile: 0 }), undefined), /bullets\.pixelsPerTile/);
		assert.throws(() => A.buildBullets(group({ sets: { $comment: "none" } }), undefined), /no sets/);
	});

	it("is deterministic: two builds give byte-identical PNGs and layout text; the PNG decodes to the atlas", () => {
		const one = A.buildBullets(group(), undefined);
		A.sourceCache.clear();
		boltStrip("t/yellow.png", YELLOW);
		boltStrip("t/green.png", GREEN);
		enemyStrip("t/grey.png");
		const two = A.buildBullets(group(), undefined);
		const png = A.encodePng(one.packed.img);
		assert.ok(Buffer.compare(png, A.encodePng(two.packed.img)) === 0);
		assert.ok(Buffer.compare(A.encodePng(A.bulletContact(one)), A.encodePng(A.bulletContact(two))) === 0);
		assert.equal(A.bulletLayoutModule(one.sheet, one.layouts), A.bulletLayoutModule(two.sheet, two.layouts));
		const back = PNG.sync.read(png);
		assert.deepEqual([back.width, back.height], [one.packed.w, one.packed.h]);
		assert.deepEqual(new Uint8Array(back.data), one.packed.img.data);
	});
});

describe("packFx (shared by the effects and the bullet atlas)", () => {
	it("names the atlas in its overflow error, `fx` by default", () => {
		const huge = { id: "x", frameW: 1000, frameH: 1000, frames: [A.raster(1000, 1000), A.raster(1000, 1000)] };
		assert.throws(() => A.packFx([huge]), /^Error: fx: the effects do not fit one 1024x1024 atlas$/);
		assert.throws(() => A.packFx([huge], "bullets"), /^Error: bullets: the sets do not fit one 1024x1024 atlas$/);
	});
});

describe("bulletLayoutModule", () => {
	it("prints the committed stub's shape: everything above VALE_BULLET_SHEET is the committed bulletLayout.ts's", () => {
		const committed = fs.readFileSync(path.join(__dirname, "..", "..", "src", "shared", "theme", "packs", "vale", "bulletLayout.ts"), "utf8");
		const head = (t) => t.slice(0, t.indexOf("export const VALE_BULLET_SHEET"));
		const b = A.buildBullets(group(), undefined);
		const text = A.bulletLayoutModule(b.sheet, b.layouts);
		assert.equal(head(text), head(committed));
		assert.match(text, /export const VALE_BULLET_SHEET: ValeSheetFile = \{\n\tfile: "bullets\.png",\n\tw: \d+,\n\th: \d+,\n\};\n/);
		assert.match(text, /\t"bullet\.player\.basic": \{\n\t\tframeW: 4,\n\t\tframeH: 8,\n\t\tpivot: \{ x: 2, y: 4 \},\n\t\tstart: \d+,\n\t\tframes: 3,\n\t\tfps: 10,\n\t\tmeanColor: "#fadc28",\n\t\tpixelsPerTile: 29\.6,\n\t\},/);
		assert.ok(text.endsWith("};\n"));
		// the empty stub (the PA stub commit's file exactly, from its head down)
		const empty = A.bulletLayoutModule({ file: "bullets.png", w: 0, h: 0 }, {});
		assert.ok(
			empty.endsWith(
				'export const VALE_BULLET_SHEET: ValeSheetFile = {\n\tfile: "bullets.png",\n\tw: 0,\n\th: 0,\n};\n\nexport const VALE_BULLET_LAYOUTS: Record<string, ValeBulletLayout> = {};\n\n' +
					"/** Effects in VALE_BULLET_SHEET (fx.* ids; cells by the same formula). */\nexport const VALE_BULLET_FX_LAYOUTS: Record<string, ValeFxLayout> = {};\n" +
						OWN_SHEETS_NONE,
			),
		);
		assert.equal(head(empty), head(committed));
	});
});

/** A 3-frame 8 px strip, 8 high: frame f an orange 2 x 2 block at x 3..4, y 2 + f (so the union box is 3,2 .. 4,5). */
function hitStrip(rel) {
	syntheticPng(rel, 24, 8, (x, y) => {
		const f = Math.floor(x / 8);
		const lx = x % 8;
		return lx >= 3 && lx <= 4 && y >= 2 + f && y <= 3 + f ? [232, 173, 44, 255] : null;
	});
}

const FX_GATE = { minDifference: 40, from: { enemyBullet: "#ff3fa4", enemyBulletOutline: "#1a0610" } };

function fxGroup(overrides = {}) {
	const g = group(overrides);
	g.gates = { ...g.gates, fx: FX_GATE };
	g.fx = { $comment: "ignored", "fx.bullet.hit": { file: "t/hit.png", frameW: 8, frames: 3, fps: 20, loop: false } };
	return g;
}

describe("bullet group effects (`fx`, docs/PROJECTILE_ART.md PA7)", () => {
	beforeEach(() => hitStrip("t/hit.png"));

	it("an fx set is cropped like an effects-atlas set, untinted, with its mean, fps and loop", () => {
		const s = A.buildBulletFxSet("fx.bullet.hit", { file: "t/hit.png", frameW: 8, frames: 3, fps: 20 }, fxGroup());
		assert.deepEqual(s.box, [3, 2, 4, 5]);
		assert.deepEqual([s.frameW, s.frameH, s.frames.length, s.fps, s.loop, s.grey], [4, 6, 3, 20, false, false]);
		assert.equal(s.meanColor, "#e8ad2c");
		assert.deepEqual(rgbaAt(s.frames[1], 1, 2), [232, 173, 44, 255]);
		assert.equal(rgbaAt(s.frames[1], 1, 1)[3], 0);
		// fps from the group, loop as given
		const g = A.buildBulletFxSet("fx.x", { file: "t/hit.png", frameW: 8, frames: 3, loop: true }, fxGroup());
		assert.deepEqual([g.fps, g.loop], [10, true]);
	});

	it("packs the effects into the bullet atlas: their own layouts in fxLayout.ts's shape, the bullets' unchanged", () => {
		const plain = A.buildBullets(group(), undefined);
		const b = A.buildBullets(fxGroup(), undefined);
		assert.deepEqual(Object.keys(b.layouts), Object.keys(plain.layouts));
		assert.deepEqual(Object.keys(b.fxLayouts), ["fx.bullet.hit"]);
		const l = b.fxLayouts["fx.bullet.hit"];
		assert.deepEqual(Object.keys(l), ["frameW", "frameH", "pivot", "start", "frames", "fps", "loop", "grey", "meanColor"]);
		assert.deepEqual([l.frameW, l.frameH, l.pivot, l.frames, l.fps, l.loop, l.grey, l.meanColor], [4, 6, { x: 2, y: 3 }, 3, 20, false, false, "#e8ad2c"]);
		assert.equal(plain.fxLayouts && Object.keys(plain.fxLayouts).length, 0);
		// every effect frame reads back through the cell formula
		const s = b.fxSets[0];
		const perRow = Math.floor(b.packed.w / l.frameW);
		for (let f = 0; f < l.frames; f++) {
			const c = l.start + f;
			const x0 = (c % perRow) * l.frameW;
			const y0 = Math.floor(c / perRow) * l.frameH;
			for (let y = 0; y < l.frameH; y++) {
				for (let x = 0; x < l.frameW; x++) {
					const want = rgbaAt(s.frames[f], x, y);
					const got = rgbaAt(b.packed.img, x0 + x, y0 + y);
					assert.equal(got[3], want[3]);
					if (want[3] > 0) assert.deepEqual(got, want);
				}
			}
		}
		// the gate row and the module's second export
		const row = b.gates.find((r) => r.id === "fx.bullet.hit");
		assert.equal(row.side, "fx");
		assert.equal(row.ok, true);
		const text = A.bulletLayoutModule(b.sheet, b.layouts, b.fxLayouts);
		assert.match(text, /import type \{ ValeFxLayout \} from "\.\/fxLayout";/);
		assert.match(text, /export const VALE_BULLET_FX_LAYOUTS: Record<string, ValeFxLayout> = \{\n\t"fx\.bullet\.hit": \{\n\t\tframeW: 4,\n\t\tframeH: 6,\n\t\tpivot: \{ x: 2, y: 3 \},\n\t\tstart: \d+,\n\t\tframes: 3,\n\t\tfps: 20,\n\t\tloop: false,\n\t\tgrey: false,\n\t\tmeanColor: "#e8ad2c",\n\t\},\n\};\n\n\/\*\* The bullets' own sheets by file[^\n]*\nexport const VALE_BULLET_OWN_SHEETS: Record<string, ValeSheetFile> = \{\};\n$/);
		// the contact sheet has a row for the effect too (taller than without it)
		assert.ok(A.bulletContact(b).h > A.bulletContact(plain).h);
		// sources: the effect's file is read (locked) once
		assert.ok(A.bulletSourceFiles(fxGroup()).includes("t/hit.png"));
	});

	it("an effect too near an enemy-bullet role fails its gate; gates.fx is required with fx sets", () => {
		const g = fxGroup();
		g.fx["fx.bullet.hit"].file = "t/pink.png"; // a strip in the enemyBullet role itself
		g.fx["fx.bullet.hit"].frameW = 8;
		g.fx["fx.bullet.hit"].frames = 2;
		syntheticPng("t/pink.png", 16, 8, (x, y) => (y >= 2 && y <= 5 && x % 8 >= 1 && x % 8 <= 4 ? [255, 63, 164, 255] : null));
		assert.throws(() => A.buildBullets(g, undefined), /fx\.bullet\.hit: mean #ff3fa4, nearest 0\.0 CIE76 from enemyBullet \(>= 40\) {2}FAIL/);
		const missing = fxGroup();
		delete missing.gates.fx;
		assert.throws(() => A.buildBullets(missing, undefined), /bullets\.gates\.fx is required with fx sets/);
		assert.throws(() => A.bulletGates([{ id: "fx.a", meanColor: "#e8ad2c" }], { ...fxGroup().gates, fx: { minDifference: 40, from: {} } }), /gates\.fx\.from/);
		assert.throws(() => A.bulletGates([{ id: "fx.a", meanColor: "#e8ad2c" }], { ...fxGroup().gates, fx: { ...FX_GATE, minDifference: 0 } }), /gates\.fx\.minDifference/);
		// no fx sets: gates.fx is not needed (the PA2 group as it was)
		assert.doesNotThrow(() => A.buildBullets(group(), undefined));
	});

	it("refuses a malformed fx set", () => {
		const bad = (def, re, id = "fx.bullet.hit") => assert.throws(() => A.buildBulletFxSet(id, def, fxGroup()), re);
		const ok = { file: "t/hit.png", frameW: 8, frames: 3 };
		bad({ ...ok, grey: true }, /unknown bullet fx set key grey/);
		bad({ ...ok, recolor: { ramp: RAMP } }, /unknown bullet fx set key recolor/);
		bad(ok, /must be an fx\.\* id/, "bullet.player.hit");
		bad({ ...ok, file: "" }, /needs a file/);
		bad({ ...ok, frames: 0 }, /positive integers/);
		bad({ ...ok, loop: "no" }, /loop must be true or false/);
		bad({ ...ok, frameW: 7 }, /24 px wide, not 3 frames x 7 px/);
		assert.throws(() => A.buildBullets({ ...fxGroup(), fx: [] }, undefined), /bullets\.fx must be an object/);
	});

	it("is deterministic with effects: two builds give byte-identical PNGs and layout text", () => {
		const one = A.buildBullets(fxGroup(), undefined);
		const two = A.buildBullets(fxGroup(), undefined);
		assert.ok(Buffer.compare(A.encodePng(one.packed.img), A.encodePng(two.packed.img)) === 0);
		assert.ok(Buffer.compare(A.encodePng(A.bulletContact(one)), A.encodePng(A.bulletContact(two))) === 0);
		assert.equal(A.bulletLayoutModule(one.sheet, one.layouts, one.fxLayouts), A.bulletLayoutModule(two.sheet, two.layouts, two.fxLayouts));
	});
});

describe("sources, the scoped lock and --only", () => {
	it("sourceFiles lists the bullet sets' files and lockAlso once each; no bullets group adds nothing", () => {
		const base = { spriteSets: {}, images: {} };
		assert.deepEqual(A.sourceFiles(base), []);
		assert.deepEqual(A.bulletSourceFiles(undefined), []);
		const g = group();
		g.sets["bullet.player.shard"] = { file: "t/yellow.png", frameW: 6, frames: 3 };
		assert.deepEqual(A.bulletSourceFiles(g), ["t/green.png", "t/grey.png", "t/spare.png", "t/yellow.png"]);
		assert.deepEqual(A.sourceFiles({ ...base, bullets: g }), ["t/green.png", "t/grey.png", "t/spare.png", "t/yellow.png"]);
		assert.throws(() => A.bulletSourceFiles(group({ lockAlso: "t/spare.png" })), /lockAlso/);
	});

	it("mergeLockEntries keeps every other entry, re-hashed ones win, sorted by path as a full lock is", () => {
		const e = (p, h) => ({ path: p, sha256: h, bytes: 1 });
		const kept = [e("a/x.png", "1"), e("q/y.png", "2"), e("z/z.png", "3")];
		const merged = A.mergeLockEntries(kept, [e("player-bullets/B.png", "4"), e("player-bullets/A b.png", "5"), e("q/y.png", "6")]);
		assert.deepEqual(
			merged.map((x) => `${x.path}=${x.sha256}`),
			["a/x.png=1", "player-bullets/A b.png=5", "player-bullets/B.png=4", "q/y.png=6", "z/z.png=3"],
		);
	});

	it("onlyGroup: none, bullets", () => {
		assert.equal(A.onlyGroup(["node", "build-atlases.js"]), undefined);
		assert.equal(A.onlyGroup(["node", "build-atlases.js", "--only", "bullets"]), "bullets");
		assert.equal(A.onlyGroup(["node", "build-atlases.js", "--lock", "--only", "bullets"]), "bullets");
	});
});

describe("bullet sets with `own` (docs/NEW_ENEMIES_2.md NX8)", () => {
	const ownGroup = () => {
		const g = group();
		g.sets["bullet.enemy.hook"] = { file: "t/grey.png", frameW: 8, frames: 2, keep: [0], recolor: { ramp: RAMP }, own: "bullets-2" };
		g.sets["bullet.enemy.flame"] = { file: "t/grey.png", frameW: 8, frames: 2, keep: [0], recolor: { ramp: RAMP }, own: "bullets-2" };
		return g;
	};

	it("packs them into their own sheet: the group's atlas, its contact sheet and every other layout byte-identical", () => {
		const plain = A.buildBullets(group(), undefined);
		const b = A.buildBullets(ownGroup(), undefined);
		assert.ok(Buffer.compare(A.encodePng(plain.packed.img), A.encodePng(b.packed.img)) === 0);
		assert.ok(Buffer.compare(A.encodePng(A.bulletContact(plain)), A.encodePng(A.bulletContact(b))) === 0);
		assert.deepEqual(b.sheet, plain.sheet);
		for (const id of Object.keys(plain.layouts)) assert.deepEqual(b.layouts[id], plain.layouts[id]);
		assert.deepEqual(Object.keys(b.layouts), [...Object.keys(plain.layouts), "bullet.enemy.flame", "bullet.enemy.hook"].sort());
		assert.deepEqual(b.own.map((o) => o.file), ["bullets-2.png"]);
		const o = b.own[0];
		assert.deepEqual(b.ownSheets, { "bullets-2.png": { file: "bullets-2.png", w: o.packed.w, h: o.packed.h } });
		for (const id of ["bullet.enemy.flame", "bullet.enemy.hook"]) {
			const l = b.layouts[id];
			assert.equal(l.sheet, "bullets-2.png");
			const s = b.sets.find((x) => x.id === id);
			const perRow = Math.floor(o.packed.w / l.frameW);
			for (let f = 0; f < l.frames; f++) {
				const c = l.start + f;
				const x0 = (c % perRow) * l.frameW;
				const y0 = Math.floor(c / perRow) * l.frameH;
				for (let y = 0; y < l.frameH; y++) {
					for (let x = 0; x < l.frameW; x++) {
						const want = rgbaAt(s.frames[f], x, y);
						const got = rgbaAt(o.packed.img, x0 + x, y0 + y);
						assert.equal(got[3], want[3]);
						if (want[3] > 0) assert.deepEqual(got, want);
					}
				}
			}
		}
		const contact = A.bulletContact(b, o);
		assert.ok(contact.w > 0 && contact.h > 0);
		const text = A.bulletLayoutModule(b.sheet, b.layouts, b.fxLayouts, b.ownSheets);
		assert.match(text, /\t\tsheet: "bullets-2\.png",\n\t\},/);
		assert.match(text, /export const VALE_BULLET_OWN_SHEETS: Record<string, ValeSheetFile> = \{\n\t"bullets-2\.png": \{ file: "bullets-2\.png", w: \d+, h: \d+ \},\n\};\n$/);
	});

	it("still gates them, and refuses a bad `own`", () => {
		const g = ownGroup();
		delete g.sets["bullet.enemy.flame"].recolor;
		assert.throws(() => A.buildBullets(g, undefined), /colour gates failed:\n {2}bullet\.enemy\.flame: mean #808080.*FAIL/);
		for (const bad of ["bullets", "Bullets-2", "", 3]) {
			const h = ownGroup();
			h.sets["bullet.enemy.hook"].own = bad;
			assert.throws(() => A.buildBullets(h, undefined), /bullet\.enemy\.hook: own must be a file name/);
		}
	});
});

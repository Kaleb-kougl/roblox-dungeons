#!/usr/bin/env node
/*
 * The boost icons (docs/BOOSTS.md B7, the HUD's boost row): original 16 x 16 pixel art drawn by code, one icon per
 * temporary boost (BOOST_KINDS order, shared/theme: Fury, Quickstep, Frenzy, Aegis), so they need no third-party pack.
 * The boon icons' kit (scripts/art/gen-boon-icons.js: 14 x 14 palette-character maps centred on the canvas,
 * auto-outlined, glows unoutlined, lit from the top left) and palette, plus one four-step ramp per boost around its
 * identity colour (the placeholder / vale roles boost.fury #ffc83d, boost.quickstep #3ff0d8, boost.frenzy #a8f03c,
 * boost.aegis #c3a6ff), so an icon reads as its kind's drop halo and aura (docs/BOOST_ART.md) before its frame does.
 * Each icon echoes its aura's motif: Fury an angry flame (the flame ring), Quickstep a winged boot (the comets), Frenzy
 * twin daggers in a whirl (the whirling blades), Aegis a round ward with the Aegis pip's diamond (the shield plates).
 *
 *   node scripts/art/gen-boost-icons.js [outDir] [--contact <file.png>]   (default art/vendor/kaleb-vale/boost-icons)
 *
 * Writes boost_<kind>.png (e.g. boost_fury.png). `--contact` also writes a review sheet (every icon at 1x and 6x on the
 * UI's panel colour, named). Same inputs, byte-identical PNGs (no timestamps, fixed encoder options).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");
const BOON = require("./gen-boon-icons.js");

const { SIZE, MAP, OUTLINE, FONT } = BOON;

/** The boon icons' palette plus one ramp per boost (characters the boon palette does not use). */
const PALETTE = {
	...BOON.PALETTE,
	// Fury gold (boost.fury #ffc83d): ember, orange, the role, pale flame core
	f: { rgb: [130, 46, 14], outlined: true },
	F: { rgb: [222, 120, 30], outlined: true },
	a: { rgb: [255, 200, 61], outlined: true },
	M: { rgb: [255, 242, 178], outlined: true },
	// Quickstep teal (boost.quickstep #3ff0d8)
	d: { rgb: [14, 86, 96], outlined: true },
	D: { rgb: [26, 168, 160], outlined: true },
	i: { rgb: [63, 240, 216], outlined: true },
	I: { rgb: [196, 255, 244], outlined: true },
	// Frenzy lime (boost.frenzy #a8f03c)
	j: { rgb: [44, 92, 20], outlined: true },
	J: { rgb: [100, 170, 34], outlined: true },
	5: { rgb: [168, 240, 60], outlined: true },
	6: { rgb: [228, 255, 170], outlined: true },
	// Aegis lavender (boost.aegis #c3a6ff)
	7: { rgb: [62, 44, 120], outlined: true },
	8: { rgb: [128, 100, 200], outlined: true },
	9: { rgb: [195, 166, 255], outlined: true },
	0: { rgb: [236, 226, 255], outlined: true },
	// glows: no outline
	"!": { rgb: [255, 200, 61], outlined: false },
	"?": { rgb: [63, 240, 216], outlined: false },
	"/": { rgb: [168, 240, 60], outlined: false },
	"|": { rgb: [195, 166, 255], outlined: false },
};

/** The icons in BOOST_KINDS order: [boost id, 14 rows of 14 palette characters]. */
const ICONS = [
	// Fury (+50% damage): an angry flame
	["boost.fury", [
		"......F......!",
		".!...FF.......",
		".....FaF....F.",
		"..F..FaaF..FF.",
		".FF..FaaF.FaF.",
		".FaF.FaMaFFaF.",
		".FaaFFaMaaaaF.",
		"FaaaaaMMMaaaFf",
		"FaMoMMMMMMoaFf",
		"FaMooMMMMooaFf",
		"FaMMMMMMMMaaFf",
		".FaMMMMMMaaFf.",
		"..fFaaaaaaFff.",
		"....ffffff....",
	]],
	// Quickstep (+30% walk speed): a winged boot and its streaks
	["boost.quickstep", [
		"..............",
		"......IIIIII..",
		"......iiiiiD..",
		"......DiDDDd..",
		"IIIII.DiDDDd..",
		".iiiiiDiDDDd..",
		"IIIIIIDiDDDd..",
		".iiiiiDiDDDdd.",
		"..IIiiDiDDDDDd",
		"...iiiDiDDDDDd",
		"???...DDDDDDDd",
		".....dddddddd.",
		"??............",
		"..............",
	]],
	// Frenzy (faster attacks): twin daggers crossed in a whirl
	["boost.frenzy", [
		"6....////....6",
		"J65./..../.56J",
		".J65......56J.",
		"..J65....56J..",
		"...J65..56J...",
		"....J6556J....",
		".....J65J.....",
		"..E..5J65..E..",
		"...g56JJ65g...",
		"....g....g....",
		"...J.g..g.J...",
		"..j...EE...j..",
		".5..........5.",
		"j............j",
	]],
	// Aegis (+1 armor pip): a round ward set with the Aegis pip's diamond
	["boost.aegis", [
		"....000099....",
		"..0099999997..",
		".098888888887.",
		".09888oo88887.",
		"09888o*9o88887",
		"0988o0099o8887",
		"098o000999o887",
		"988o999777o887",
		"9888o9977o8887",
		"98888o97o88887",
		".98888oo88887.",
		".988888888877.",
		"..9777777777..",
		"....777777....",
	]],
];

const PREFIX = "boost.";

/** The icon's output file name: boost_<kind>.png. */
function fileOf(id) {
	if (!id.startsWith(PREFIX)) throw new Error(`gen-boost-icons: "${id}" is not a boost id`);
	return `boost_${id.slice(PREFIX.length)}.png`;
}

/** The map of `id` (a programming error when absent or malformed). */
function mapOf(id) {
	const entry = ICONS.find((e) => e[0] === id);
	if (entry === undefined) throw new Error(`gen-boost-icons: no icon "${id}"`);
	const rows = entry[1];
	if (rows.length !== MAP || rows.some((r) => r.length !== MAP)) {
		throw new Error(`gen-boost-icons: ${id} is not ${MAP} x ${MAP}`);
	}
	for (const row of rows) {
		for (const ch of row) {
			if (ch !== "." && PALETTE[ch] === undefined) throw new Error(`gen-boost-icons: ${id}: unknown colour "${ch}"`);
		}
	}
	return rows;
}

/** The icon as palette characters on the full canvas, outline filled in: SIZE rows of SIZE characters. */
function drawIcon(id) {
	const rows = mapOf(id);
	const grid = Array.from({ length: SIZE }, () => new Array(SIZE).fill("."));
	for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) grid[y + 1][x + 1] = rows[y][x];
	const outlined = (x, y) => {
		if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return false;
		const ch = grid[y][x];
		return ch !== "." && ch !== "#" && PALETTE[ch].outlined;
	};
	for (let y = 0; y < SIZE; y++) {
		for (let x = 0; x < SIZE; x++) {
			if (grid[y][x] !== ".") continue;
			if (outlined(x - 1, y) || outlined(x + 1, y) || outlined(x, y - 1) || outlined(x, y + 1)) grid[y][x] = "#";
		}
	}
	return grid.map((r) => r.map((ch) => (ch === "#" ? "o" : ch)).join(""));
}

/** RGBA bytes of an icon (SIZE x SIZE). */
function rgbaOf(id) {
	const rows = drawIcon(id);
	const data = Buffer.alloc(SIZE * SIZE * 4);
	for (let y = 0; y < SIZE; y++) {
		for (let x = 0; x < SIZE; x++) {
			const ch = rows[y][x];
			if (ch === ".") continue;
			const i = (y * SIZE + x) * 4;
			const [r, g, b] = PALETTE[ch].rgb;
			data[i] = r;
			data[i + 1] = g;
			data[i + 2] = b;
			data[i + 3] = 255;
		}
	}
	return data;
}

/** The icon's PNG bytes. */
function renderIcon(id) {
	const png = new PNG({ width: SIZE, height: SIZE });
	rgbaOf(id).copy(png.data);
	return PNG.sync.write(png, { colorType: 6 });
}

/** A review sheet: per icon, 1x and SCALE x on the UI panel colour, named. */
function renderContact(scale = 6, perRow = 4) {
	const cellW = SIZE * scale + SIZE + 24;
	const cellH = SIZE * scale + 22;
	const cols = Math.min(perRow, ICONS.length);
	const rowsN = Math.ceil(ICONS.length / cols);
	const W = cols * cellW + 8;
	const H = rowsN * cellH + 8;
	const png = new PNG({ width: W, height: H });
	const bg = [28, 22, 24];
	for (let i = 0; i < W * H; i++) {
		png.data[i * 4] = bg[0];
		png.data[i * 4 + 1] = bg[1];
		png.data[i * 4 + 2] = bg[2];
		png.data[i * 4 + 3] = 255;
	}
	const set = (x, y, [r, g, b]) => {
		if (x < 0 || y < 0 || x >= W || y >= H) return;
		const i = (y * W + x) * 4;
		png.data[i] = r;
		png.data[i + 1] = g;
		png.data[i + 2] = b;
	};
	ICONS.forEach(([id], n) => {
		const ox = 8 + (n % cols) * cellW;
		const oy = 8 + Math.floor(n / cols) * cellH;
		const px = rgbaOf(id);
		for (let y = 0; y < SIZE; y++) {
			for (let x = 0; x < SIZE; x++) {
				const i = (y * SIZE + x) * 4;
				if (px[i + 3] === 0) continue;
				const c = [px[i], px[i + 1], px[i + 2]];
				set(ox + x, oy + y, c);
				for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) set(ox + SIZE + 8 + x * scale + dx, oy + y * scale + dy, c);
			}
		}
		const label = id.slice(PREFIX.length).toUpperCase().slice(0, 16);
		[...label].forEach((ch, k) => {
			const glyph = FONT[ch] ?? FONT[" "];
			for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) {
				if (glyph[gy * 3 + gx] === "1") set(ox + k * 4 + gx, oy + SIZE * scale + 8 + gy, [215, 204, 180]);
			}
		});
	});
	return PNG.sync.write(png, { colorType: 6 });
}

const BOOST_IDS = ICONS.map((e) => e[0]);

if (require.main === module) {
	const args = process.argv.slice(2);
	let contact;
	const ci = args.indexOf("--contact");
	if (ci >= 0) {
		contact = args[ci + 1];
		args.splice(ci, 2);
	}
	const outDir = args[0] ?? path.join(__dirname, "..", "..", "art", "vendor", "kaleb-vale", "boost-icons");
	fs.mkdirSync(outDir, { recursive: true });
	for (const id of BOOST_IDS) fs.writeFileSync(path.join(outDir, fileOf(id)), renderIcon(id));
	if (contact !== undefined) fs.writeFileSync(contact, renderContact());
	console.log(`gen-boost-icons: ${BOOST_IDS.length} icons -> ${outDir}`);
}

module.exports = { SIZE, MAP, OUTLINE, PALETTE, ICONS, BOOST_IDS, fileOf, drawIcon, rgbaOf, renderIcon, renderContact };

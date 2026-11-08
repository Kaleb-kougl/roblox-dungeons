#!/usr/bin/env node
/*
 * The armor pip icons (docs/UI_ART.md "As built: armor pips"): original 9 x 9 pixel art drawn by code for the status
 * panel's armor row (hearts row, after the hearts) and the touch strip, so they need no third-party pack. They replace
 * the ToffeeCraft sheet's grey `ui.chip` (a plain dark disc, drawn at 1 screen px per art px at 1080 p) with a small
 * heater shield that reads as armor: 9 px is the largest art that draws at 2 screen px per art px in the pip box
 * (HUD_VIEW.pipSize 12 reference px = 18 screen px at 1080 p), so the shields stand crisp beside the 18 x 15 hearts.
 *
 *   - ui.pip.armor        a full pip: a steel rim round a field in the armor blue (uiMana #4a78d9), lit top left;
 *   - ui.pip.armor.empty  a spent pip: the same shield hollowed out, a dark steel rim round a near-black field with a
 *                         crack (drawn as its own state, not the full pip dimmed: a dimmed blue pip read as muddy);
 *   - ui.pip.aegis        the Aegis pip (docs/BOOSTS.md B7, +1 pip over the maximum): the shield in the Aegis lavender
 *                         (boost.aegis #c3a6ff) with a white diamond, the Aegis drop's and boost icon's mark.
 *
 * The boon icons' kit (scripts/art/gen-boon-icons.js): a map of palette characters (7 x 7 here) centred on the canvas;
 * every transparent pixel 4-next to an outlined colour becomes the outline (the sheet's warm near black), so nothing is
 * clipped at the canvas edge.
 *
 *   node scripts/art/gen-pip-icons.js [outDir] [--contact <file.png>]   (default art/vendor/kaleb-vale/pip-icons)
 *
 * Writes pip_<name>.png (pip_armor.png, pip_armor_empty.png, pip_aegis.png). `--contact` also writes a review sheet
 * (every icon at 1x and 8x on the UI's panel colour, then a mock armor row: hearts-row pips at 2x). Same inputs,
 * byte-identical PNGs (no timestamps, fixed encoder options).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");
const BOON = require("./gen-boon-icons.js");

const { OUTLINE, FONT } = BOON;

/** Canvas side, px. */
const SIZE = 9;
/** The drawn map's side, px: one px of outline room on every side. */
const MAP = SIZE - 2;

/** Palette: character -> [r, g, b] and whether it is outlined. `.` is transparent, `o` the outline drawn by hand. */
const PALETTE = {
	o: { rgb: OUTLINE, outlined: true },
	// steel (the boon palette's steel ramp)
	s: { rgb: [78, 80, 90], outlined: true },
	S: { rgb: [128, 130, 140], outlined: true },
	t: { rgb: [182, 186, 194], outlined: true },
	T: { rgb: [232, 236, 242], outlined: true },
	// armor blue (uiMana #4a78d9 is the third step)
	n: { rgb: [30, 50, 112], outlined: true },
	N: { rgb: [46, 82, 168], outlined: true },
	k: { rgb: [74, 120, 217], outlined: true },
	K: { rgb: [168, 200, 250], outlined: true },
	// the spent pip: a dark iron rim, a near-black field, its crack
	z: { rgb: [52, 52, 62], outlined: true },
	Z: { rgb: [22, 20, 26], outlined: true },
	y: { rgb: [96, 96, 108], outlined: true },
	// Aegis lavender (boost.aegis #c3a6ff is the third step; the boost icons' ramp)
	7: { rgb: [62, 44, 120], outlined: true },
	8: { rgb: [128, 100, 200], outlined: true },
	9: { rgb: [195, 166, 255], outlined: true },
	0: { rgb: [236, 226, 255], outlined: true },
	W: { rgb: [255, 255, 255], outlined: true },
};

/** The icons: [theme id, 7 rows of 7 palette characters]. Shield rows 7 / 7 / 7 / 7 / 5 / 3 / 1 wide. */
const ICONS = [
	// a full armor pip: steel rim lit from the top left, the blue field with a glint
	["ui.pip.armor", [
		"tTTTTts",
		"TKkkkNs",
		"tkkkNNs",
		"tkkNNns",
		".tNNns.",
		"..tns..",
		"...s...",
	]],
	// a spent armor pip: hollow and cracked
	["ui.pip.armor.empty", [
		"zzzzZzz",
		"zZZZyZz",
		"zZZyZZz",
		"zZyZZZz",
		".zyZZz.",
		"..zZz..",
		"...z...",
	]],
	// the Aegis pip: the lavender shield set with a white diamond
	["ui.pip.aegis", [
		"0000097",
		"0998887",
		"9880887",
		"980W087",
		".98087.",
		"..987..",
		"...7...",
	]],
];

const PREFIX = "ui.pip.";

/** The icon's output file name: ui.pip.armor.empty -> pip_armor_empty.png. */
function fileOf(id) {
	if (!id.startsWith(PREFIX)) throw new Error(`gen-pip-icons: "${id}" is not a pip id`);
	return `pip_${id.slice(PREFIX.length).replace(/\./g, "_")}.png`;
}

/** The map of `id` (a programming error when absent or malformed). */
function mapOf(id) {
	const entry = ICONS.find((e) => e[0] === id);
	if (entry === undefined) throw new Error(`gen-pip-icons: no icon "${id}"`);
	const rows = entry[1];
	if (rows.length !== MAP || rows.some((r) => r.length !== MAP)) {
		throw new Error(`gen-pip-icons: ${id} is not ${MAP} x ${MAP}`);
	}
	for (const row of rows) {
		for (const ch of row) {
			if (ch !== "." && PALETTE[ch] === undefined) throw new Error(`gen-pip-icons: ${id}: unknown colour "${ch}"`);
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

/**
 * A review sheet on the UI panel colour: per icon 1x and `scale` x with its name; under them a mock armor row as the
 * HUD draws it at 1080 p (2 screen px per art px): two full pips, one spent, one Aegis, a HUD gap (4 ref px = 6 px) apart.
 */
function renderContact(scale = 8) {
	const cellW = SIZE * scale + SIZE + 24;
	const cellH = SIZE * scale + 22;
	const W = ICONS.length * cellW + 8;
	const H = cellH + SIZE * 2 + 24;
	const png = new PNG({ width: W, height: H });
	const bg = [28, 28, 36];
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
	const blit = (id, ox, oy, k) => {
		const px = rgbaOf(id);
		for (let y = 0; y < SIZE; y++) {
			for (let x = 0; x < SIZE; x++) {
				const i = (y * SIZE + x) * 4;
				if (px[i + 3] === 0) continue;
				const c = [px[i], px[i + 1], px[i + 2]];
				for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) set(ox + x * k + dx, oy + y * k + dy, c);
			}
		}
	};
	ICONS.forEach(([id], n) => {
		const ox = 8 + n * cellW;
		blit(id, ox, 8, 1);
		blit(id, ox + SIZE + 8, 8, scale);
		const label = id.slice(PREFIX.length).toUpperCase().replace(/\./g, " ").slice(0, 16);
		[...label].forEach((ch, k) => {
			const glyph = FONT[ch] ?? FONT[" "];
			for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) {
				if (glyph[gy * 3 + gx] === "1") set(ox + k * 4 + gx, 8 + SIZE * scale + 8 + gy, [215, 204, 180]);
			}
		});
	});
	const row = ["ui.pip.armor", "ui.pip.armor", "ui.pip.armor.empty", "ui.pip.aegis"];
	row.forEach((id, n) => blit(id, 8 + n * (SIZE * 2 + 6), cellH + 12, 2));
	return PNG.sync.write(png, { colorType: 6 });
}

const PIP_IDS = ICONS.map((e) => e[0]);

if (require.main === module) {
	const args = process.argv.slice(2);
	let contact;
	const ci = args.indexOf("--contact");
	if (ci >= 0) {
		contact = args[ci + 1];
		args.splice(ci, 2);
	}
	const outDir = args[0] ?? path.join(__dirname, "..", "..", "art", "vendor", "kaleb-vale", "pip-icons");
	fs.mkdirSync(outDir, { recursive: true });
	for (const id of PIP_IDS) fs.writeFileSync(path.join(outDir, fileOf(id)), renderIcon(id));
	if (contact !== undefined) fs.writeFileSync(contact, renderContact());
	console.log(`gen-pip-icons: ${PIP_IDS.length} icons -> ${outDir}`);
}

module.exports = { SIZE, MAP, OUTLINE, PALETTE, ICONS, PIP_IDS, fileOf, drawIcon, rgbaOf, renderIcon, renderContact };

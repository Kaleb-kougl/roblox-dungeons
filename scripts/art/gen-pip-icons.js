#!/usr/bin/env node
/*
 * The armor pip icons (docs/UI_ART.md "As built: armor pips"): original pixel art drawn by code for the status panel's
 * armor row (the hearts row, after the hearts) and the touch strip, so they need no third-party pack. They replace the
 * ToffeeCraft sheet's grey `ui.chip` (a plain dark disc) with a heater shield that reads as armor, drawn at the hearts'
 * size: 16 x 15 on the hearts' 18 x 15, the same height, so in the hearts' 24 reference px box (HUD_SKIN.heartBox) it
 * draws at the hearts' 2 screen px per art px at 1080 p, and the HUD spaces the pips like the hearts.
 *
 *   - ui.pip.armor        a full pip: a steel rim round a field in the armor blue (uiMana #4a78d9), lit top left;
 *   - ui.pip.armor.empty  a spent pip: the same shield hollowed out, a dark iron rim round a near-black field with a
 *                         crack (drawn as its own state, not the full pip dimmed: a dimmed blue pip read as muddy);
 *   - ui.pip.aegis        the Aegis pip (docs/BOOSTS.md B7, +1 pip over the maximum): the shield in the Aegis lavender
 *                         (boost.aegis #c3a6ff) with a white diamond, the Aegis drop's and boost icon's mark.
 *
 * The boon icons' kit (scripts/art/gen-boon-icons.js): a map of palette characters centred on the canvas; every
 * transparent pixel 4-next to an outlined colour becomes the outline (the sheet's warm near black), so nothing is
 * clipped at the canvas edge. All three fill one silhouette (SHAPE).
 *
 *   node scripts/art/gen-pip-icons.js [outDir] [--contact <file.png>]   (default art/vendor/kaleb-vale/pip-icons)
 *
 * Writes pip_<name>.png (pip_armor.png, pip_armor_empty.png, pip_aegis.png). `--contact` also writes a review sheet
 * (every icon at 1x and 6x on the UI's panel colour, then a mock HP row at 2x: three hearts and the pips, the HUD's gap
 * apart in 24 px boxes, as at 1080 p). Same inputs, byte-identical PNGs (no timestamps, fixed encoder options).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");
const BOON = require("./gen-boon-icons.js");

const { OUTLINE, FONT } = BOON;

/** Canvas size, px: the hearts' height (ui.heart.* are 18 x 15). */
const W = 16;
const H = 15;
/** The drawn map's size, px: one px of outline room on every side. */
const MAP_W = W - 2;
const MAP_H = H - 2;

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
	z: { rgb: [74, 74, 88], outlined: true },
	Z: { rgb: [30, 28, 36], outlined: true },
	y: { rgb: [122, 122, 136], outlined: true },
	// Aegis lavender (boost.aegis #c3a6ff is the third step; the boost icons' ramp)
	7: { rgb: [62, 44, 120], outlined: true },
	8: { rgb: [128, 100, 200], outlined: true },
	9: { rgb: [195, 166, 255], outlined: true },
	0: { rgb: [236, 226, 255], outlined: true },
	W: { rgb: [255, 255, 255], outlined: true },
};

/**
 * The shield's silhouette: per map row, the first and last drawn column. Seven straight rows, then the taper to the
 * point. Every icon fills exactly these cells (mapOf checks), so a spent or Aegis pip covers a full one exactly.
 */
const SHAPE = [
	[0, 13], [0, 13], [0, 13], [0, 13], [0, 13], [0, 13], [0, 13],
	[1, 12], [1, 12], [2, 11], [3, 10], [5, 8], [6, 7],
];

/** The icons: [theme id, MAP_H rows of MAP_W palette characters]. */
const ICONS = [
	// a full armor pip: a steel rim lit from the top left round the blue field, shading to the bottom right
	["ui.pip.armor", [
		"tTTTTTTTTTTTtS",
		"TKKkkkkkkkkkNs",
		"TKkkkkkkkkkNNs",
		"tkkkkkkkkkkNNs",
		"tkkkkkkkkkNNNs",
		"tkkkkkkkkNNNns",
		"tkkkkkkkNNNNns",
		".tkkkkkNNNNns.",
		".tkkkkNNNNnns.",
		"..tkkNNNNnns..",
		"...tkNNNnns...",
		".....tNns.....",
		"......ss......",
	]],
	// a spent armor pip: a dark iron rim round a hollow field, split by a crack from the top rim
	["ui.pip.armor.empty", [
		"zzzzzzzzyzzzzz",
		"zZZZZZZZyZZZZz",
		"zZZZZZZyZZZZZz",
		"zZZZZZZyZZZZZz",
		"zZZZZZyZZZZZZz",
		"zZZZZZZyZZZZZz",
		"zZZZZZyZZZZZZz",
		".zZZZyZZZZZZz.",
		".zZZZZyZZZZZz.",
		"..zZZZZZZZZz..",
		"...zZZZZZZz...",
		".....zZZz.....",
		"......zz......",
	]],
	// the Aegis pip: the shield in the Aegis lavender, set with a white diamond
	["ui.pip.aegis", [
		"00000000000097",
		"09999999999987",
		"09999999999887",
		"09999900999887",
		"099990WW098887",
		"09990WWWW08887",
		"09990WWWW08887",
		".09990WW08887.",
		".099990088887.",
		"..0999988887..",
		"...09988887...",
		".....0987.....",
		"......07......",
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
	if (rows.length !== MAP_H || rows.some((r) => r.length !== MAP_W)) {
		throw new Error(`gen-pip-icons: ${id} is not ${MAP_W} x ${MAP_H}`);
	}
	rows.forEach((row, y) => {
		[...row].forEach((ch, x) => {
			if (ch !== "." && PALETTE[ch] === undefined) throw new Error(`gen-pip-icons: ${id}: unknown colour "${ch}"`);
			const inside = x >= SHAPE[y][0] && x <= SHAPE[y][1];
			if (inside !== (ch !== ".")) throw new Error(`gen-pip-icons: ${id}: (${x}, ${y}) off the shield's silhouette`);
		});
	});
	return rows;
}

/** The icon as palette characters on the full canvas, outline filled in: H rows of W characters. */
function drawIcon(id) {
	const rows = mapOf(id);
	const grid = Array.from({ length: H }, () => new Array(W).fill("."));
	for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) grid[y + 1][x + 1] = rows[y][x];
	const outlined = (x, y) => {
		if (x < 0 || y < 0 || x >= W || y >= H) return false;
		const ch = grid[y][x];
		return ch !== "." && ch !== "#" && PALETTE[ch].outlined;
	};
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			if (grid[y][x] !== ".") continue;
			if (outlined(x - 1, y) || outlined(x + 1, y) || outlined(x, y - 1) || outlined(x, y + 1)) grid[y][x] = "#";
		}
	}
	return grid.map((r) => r.map((ch) => (ch === "#" ? "o" : ch)).join(""));
}

/** RGBA bytes of an icon (W x H). */
function rgbaOf(id) {
	const rows = drawIcon(id);
	const data = Buffer.alloc(W * H * 4);
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			const ch = rows[y][x];
			if (ch === ".") continue;
			const i = (y * W + x) * 4;
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
	const png = new PNG({ width: W, height: H });
	rgbaOf(id).copy(png.data);
	return PNG.sync.write(png, { colorType: 6 });
}

/**
 * A review sheet on the UI panel colour: per icon 1x and `scale` x with its name; under them a mock armor row as the
 * HUD draws it at 1080 p: two full pips, a spent one and an Aegis one at 2 screen px per art px, each centred in a 36 px
 * box (the hearts' 24 reference px), 6 px (the HUD's 4 reference px gap) apart, with red boxes where hearts would sit.
 */
function renderContact(scale = 6) {
	const cellW = W * scale + W + 24;
	const cellH = H * scale + 22;
	const BOX = 36;
	const GAP = 6;
	const row = ["heart", "heart", "heart", "ui.pip.armor", "ui.pip.armor", "ui.pip.armor.empty", "ui.pip.aegis"];
	const rowW = row.length * BOX + (row.length - 1) * GAP + 16;
	const width = Math.max(ICONS.length * cellW + 8, rowW);
	const height = cellH + BOX + 20;
	const png = new PNG({ width, height });
	const bg = [28, 28, 36];
	for (let i = 0; i < width * height; i++) {
		png.data[i * 4] = bg[0];
		png.data[i * 4 + 1] = bg[1];
		png.data[i * 4 + 2] = bg[2];
		png.data[i * 4 + 3] = 255;
	}
	const set = (x, y, [r, g, b]) => {
		if (x < 0 || y < 0 || x >= width || y >= height) return;
		const i = (y * width + x) * 4;
		png.data[i] = r;
		png.data[i + 1] = g;
		png.data[i + 2] = b;
	};
	const blit = (id, ox, oy, k) => {
		const px = rgbaOf(id);
		for (let y = 0; y < H; y++) {
			for (let x = 0; x < W; x++) {
				const i = (y * W + x) * 4;
				if (px[i + 3] === 0) continue;
				const c = [px[i], px[i + 1], px[i + 2]];
				for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) set(ox + x * k + dx, oy + y * k + dy, c);
			}
		}
	};
	ICONS.forEach(([id], n) => {
		const ox = 8 + n * cellW;
		blit(id, ox, 8, 1);
		blit(id, ox + W + 8, 8, scale);
		const label = id.slice(PREFIX.length).toUpperCase().replace(/\./g, " ").slice(0, 16);
		[...label].forEach((ch, k) => {
			const glyph = FONT[ch] ?? FONT[" "];
			for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) {
				if (glyph[gy * 3 + gx] === "1") set(ox + k * 4 + gx, 8 + H * scale + 8 + gy, [215, 204, 180]);
			}
		});
	});
	row.forEach((id, n) => {
		const bx = 8 + n * (BOX + GAP);
		const by = cellH + 10;
		if (id === "heart") {
			// the heart's 36 x 30 footprint at 2x, centred in its box
			for (let y = 0; y < 30; y++) for (let x = 0; x < 36; x++) set(bx + x, by + 3 + y, [128, 6, 12]);
			return;
		}
		blit(id, bx + (BOX - W * 2) / 2, by + (BOX - H * 2) / 2, 2);
	});
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

module.exports = { W, H, MAP_W, MAP_H, SHAPE, OUTLINE, PALETTE, ICONS, PIP_IDS, fileOf, drawIcon, rgbaOf, renderIcon, renderContact };

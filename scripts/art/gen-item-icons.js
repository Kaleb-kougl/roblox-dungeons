#!/usr/bin/env node
/*
 * The relic and curse icons: original 16 x 16 pixel art drawn by code, one icon per relic (RELICS order) and per curse
 * (CURSES order, shared/sim progression progressionData.ts), so they need no third-party pack. The same kit as the boon
 * icons (scripts/art/gen-boon-icons.js: 14 x 14 palette-character maps centred on the canvas, auto-outlined, glows
 * unoutlined, lit from the top left) and its palette, so the items row reads as one set:
 *   - relics in the UI's own colours (bone, blood red, steel, glass, candle gold), treasure-like;
 *   - curses in a SICKLY palette of their own (corrupted plum and bile green, with the bone and glass), so a curse
 *     reads as a curse before its frame does. A curse that takes something away mirrors the boon that gives it
 *     (Frailty / Hearty, Thirst / Deep Flask) with a bile-green minus where the boon has its white plus.
 *
 *   node scripts/art/gen-item-icons.js [outDir] [--contact <file.png>]   (default art/vendor/kaleb-vale/item-icons)
 *
 * Writes relic_<name>.png and curse_<name>.png (name = the id without its "relic." / "curse." prefix, e.g.
 * relic_mirrorCloak.png). `--contact` also writes a review sheet (every icon at 1x and 6x on the UI's panel colour,
 * named). Same inputs, byte-identical PNGs (no timestamps, fixed encoder options).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");
const BOON = require("./gen-boon-icons.js");

const { SIZE, MAP, OUTLINE, FONT } = BOON;

/** The boon icons' palette plus the curses' sickly colours (characters the boon palette does not use). */
const PALETTE = {
	...BOON.PALETTE,
	// corrupted plum (the curses' flesh and rims)
	n: { rgb: [44, 18, 50], outlined: true },
	N: { rgb: [86, 36, 94], outlined: true },
	u: { rgb: [136, 70, 142], outlined: true },
	U: { rgb: [188, 128, 190], outlined: true },
	// bile green (rot, ooze, the curses' minus)
	y: { rgb: [46, 68, 22], outlined: true },
	Y: { rgb: [98, 136, 38], outlined: true },
	z: { rgb: [166, 202, 66], outlined: true },
	Z: { rgb: [224, 242, 146], outlined: true },
	// glows: no outline
	"%": { rgb: [166, 202, 66], outlined: false },
	"&": { rgb: [188, 128, 190], outlined: false },
};

/** The icons: relics in RELICS order, then curses in CURSES order: [id, 14 rows of 14 palette characters]. */
const ICONS = [
	// Mirror Cloak (guarded bullets fly back): a gold hand mirror and the bullet it sent back
	["relic.mirrorCloak", [
		".....gggg.....",
		"....gqqqqE..pm",
		"...gqqq*qqE.mR",
		"...gqq*qqqE=..",
		"...gq*qq*qE...",
		"...g*qq*qqE...",
		"...gqq*qqqE...",
		"...gq*qqqqE...",
		"....gqqqqE....",
		".....EEEE.....",
		"......gE......",
		"......Ww......",
		"......Ww......",
		".....gggE.....",
	]],
	// Hourglass (bullets slow after a hit): a gold-capped hourglass on steel posts, its sand ice blue and slow
	["relic.hourglass", [
		"............^.",
		".gggggggggggg.",
		".EEEEEEEEEEEE.",
		"..SQccccccqS..",
		"..SQQcccBqqS..",
		"..S.QQcBqq.S..",
		"..S..QcBq..S..",
		"..S..QQcq..S..",
		"..S.QQQcqq.S..",
		"..SQQQccqqqS..",
		"..SQcccBBBqS..",
		".gggggggggggg.",
		".EEEEEEEEEEEE.",
		".^............",
	]],
	// Vampire Fang (kills heal): a long fang in red gums, blood dripping from its tip
	["relic.vampireFang", [
		"..............",
		".mmpmmmmmmmmR.",
		".RmmmmmmmmmRr.",
		"..4432332432..",
		"..4432332432..",
		"..443....432..",
		"..443....432..",
		"..443....432..",
		"...43....43...",
		"...43....43...",
		"....3....3....",
		".........m....",
		".........m....",
		"........pmR...",
	]],
	// Second Wind (survive a lethal hit): a heart borne up on a bone-white wing
	["relic.secondWind", [
		"44............",
		".344..........",
		"4334444.......",
		".223344.......",
		"44223334mm.mm.",
		".322233mpmmmmR",
		"..42223mpmmmmR",
		"...3222mmmmmRR",
		"....222.mmmRR.",
		"........mmRR..",
		".........RR...",
		"..............",
		"..............",
		"..............",
	]],
	// Frailty (-1 heart): a cracked, rotting plum heart and a bile minus
	["curse.frailty", [
		"..............",
		"..............",
		"........zzzzz.",
		"..............",
		".NNN..NNN.....",
		"NuuNNoNNNn....",
		"NuNNNoNYNn....",
		"NNNNoNNNnn....",
		".NYNNoNnn.....",
		"..NNoNnn......",
		"...NNon.......",
		"....nn........",
		"....Y.........",
		"....z.........",
	]],
	// Haste (enemy bullets faster): a bile-green bullet tearing along plum streaks
	["curse.haste", [
		"..............",
		"..............",
		"..&&&&........",
		"........YYYY..",
		"&&&&&&.YzZZzy.",
		".......zZZzzYy",
		"..&&&&&YZzzzYy",
		".......YzzzYYy",
		"&&&&&&.yYYYYyy",
		"........yyyy..",
		"...&&&&.......",
		"..............",
		"..............",
		"..............",
	]],
	// Impatience (a shorter combo window): a cracked pocket watch, its hands bile green
	["curse.impatience", [
		"......Nn......",
		".....NuNn.....",
		"....NNNNnn....",
		"..NN444433on..",
		".N4444Y433o3n.",
		".N4444Y43o33n.",
		"N44444Y333o22n",
		"N44444Y3333o2n",
		"N444YYy333o22n",
		"N44444433o322n",
		".N444433o222n.",
		".N3333332o22n.",
		"..nn332222nn..",
		"....nnnnnn....",
	]],
	// Thirst (-1 flask charge): an empty cracked flask, a plum stopper, bile dregs and a bile minus
	["curse.thirst", [
		".....NN.......",
		".....nn.......",
		".....QQ.zzzzz.",
		".....Qq.......",
		".....Qq.......",
		"....QQqq......",
		"...QQqqqq.....",
		"..QQqqqoqq....",
		"..Qqqqoqqq....",
		".QQqqqoqqqq...",
		".Qqqqqqoqqq...",
		".QYzYYYYYyq...",
		"..qyyyyyyq....",
		"...qqqqqq.....",
	]],
];

const PREFIXES = ["relic.", "curse."];

/** The icon's output file name: relic_<name>.png / curse_<name>.png. */
function fileOf(id) {
	const prefix = PREFIXES.find((p) => id.startsWith(p));
	if (prefix === undefined) throw new Error(`gen-item-icons: "${id}" is not a relic or curse id`);
	return `${prefix.slice(0, -1)}_${id.slice(prefix.length)}.png`;
}

/** The map of `id` (a programming error when absent or malformed). */
function mapOf(id) {
	const entry = ICONS.find((e) => e[0] === id);
	if (entry === undefined) throw new Error(`gen-item-icons: no icon "${id}"`);
	const rows = entry[1];
	if (rows.length !== MAP || rows.some((r) => r.length !== MAP)) {
		throw new Error(`gen-item-icons: ${id} is not ${MAP} x ${MAP}`);
	}
	for (const row of rows) {
		for (const ch of row) {
			if (ch !== "." && PALETTE[ch] === undefined) throw new Error(`gen-item-icons: ${id}: unknown colour "${ch}"`);
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
		const label = id.replace(/^(relic|curse)\./, "").toUpperCase().slice(0, 16);
		[...label].forEach((ch, k) => {
			const glyph = FONT[ch] ?? FONT[" "];
			for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) {
				if (glyph[gy * 3 + gx] === "1") set(ox + k * 4 + gx, oy + SIZE * scale + 8 + gy, [215, 204, 180]);
			}
		});
	});
	return PNG.sync.write(png, { colorType: 6 });
}

const ITEM_IDS = ICONS.map((e) => e[0]);
const RELIC_IDS = ITEM_IDS.filter((id) => id.startsWith("relic."));
const CURSE_IDS = ITEM_IDS.filter((id) => id.startsWith("curse."));

if (require.main === module) {
	const args = process.argv.slice(2);
	let contact;
	const ci = args.indexOf("--contact");
	if (ci >= 0) {
		contact = args[ci + 1];
		args.splice(ci, 2);
	}
	const outDir = args[0] ?? path.join(__dirname, "..", "..", "art", "vendor", "kaleb-vale", "item-icons");
	fs.mkdirSync(outDir, { recursive: true });
	for (const id of ITEM_IDS) fs.writeFileSync(path.join(outDir, fileOf(id)), renderIcon(id));
	if (contact !== undefined) fs.writeFileSync(contact, renderContact());
	console.log(`gen-item-icons: ${ITEM_IDS.length} icons -> ${outDir}`);
}

module.exports = {
	SIZE,
	MAP,
	OUTLINE,
	PALETTE,
	ICONS,
	ITEM_IDS,
	RELIC_IDS,
	CURSE_IDS,
	fileOf,
	drawIcon,
	rgbaOf,
	renderIcon,
	renderContact,
};

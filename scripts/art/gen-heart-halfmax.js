#!/usr/bin/env node
/*
 * The half-heart containers (docs/SILVER.md OC18 / SV16): the last heart of an ODD heart maximum (the Archer's 1 1/2
 * hearts, Vigor I's 2 1/2), drawn as half a container instead of the half-FILLED heart (`ui.heart.half`), which means
 * "hurt". Derived from the ToffeeCraft Horror UI sheet's own hearts (art/atlases.json `uiIcons`: `ui.heart.full` and
 * `ui.heart.empty`, 18 x 15, symmetric about x = 8.5), so they match the hearts pixel for pixel:
 *
 *   - ui.heart.halfmax        the half container holding its half heart: `ui.heart.full`'s left half (columns 0-8);
 *   - ui.heart.halfmax.empty  the half container, spent: `ui.heart.empty`'s left half (columns 0-8, translucent).
 *
 * Each keeps the hearts' 18 x 15 canvas (so it draws in the same box at the same density and sits where a whole heart
 * would), the right half cleared, and the cut closed: column 9 (the right lobe's first column) becomes a straight edge
 * from the lobes' notch to the tip, rows 3-13, in that heart's own edge colour (the mean of its outer edge, columns 0
 * and 17 of rows 3-6: a dark red at the heart's own outline alpha); the tip pixel (row 14) is the heart's own. So the
 * fill is exactly half a heart and the piece reads as a closed shape, not a torn heart.
 *
 * Derived from a paid sheet (THIRD_PARTY_NOTICES.md: ToffeeCraft, no redistribution), so the PNGs go to the gitignored
 * art/vendor/kaleb-vale/heart-icons/ like the sheet itself, and the script needs the sheet: without it, it says so and
 * writes nothing (exit 0).
 *
 *   node scripts/art/gen-heart-halfmax.js [outDir] [--contact <file.png>]   (default art/vendor/kaleb-vale/heart-icons)
 *
 * Writes heart_halfmax.png and heart_halfmax_empty.png. `--contact` also writes a review sheet: the source hearts and
 * both containers at 1x and 6x, then mock hearts rows at 2x as the HUD draws them (each heart in a 36 px box, 6 px
 * apart): Knight with Vigor I at 5, 4 and 3 half hearts of 5, the Archer at 3 and 2 of 3, and today's drawing of a full
 * 3-of-3 row (a half-filled last heart) for comparison. Every pixel alpha-blended on the UI panel colour. Same inputs,
 * byte-identical PNGs (no timestamps, fixed encoder options).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");
const BOON = require("./gen-boon-icons.js");

const { FONT } = BOON;
const ROOT = path.join(__dirname, "..", "..");

/** The hearts' canvas (ui.heart.* are 18 x 15). */
const W = 18;
const H = 15;
/** Columns kept from the source heart: the left half (the heart is symmetric about x = 8.5). */
const KEEP_COLUMNS = 9;
/** The closing edge: column 9, from the row under the lobes' notch to the row above the tip. */
const EDGE_X = 9;
const EDGE_FIRST_ROW = 3;
const EDGE_LAST_ROW = 13;
/** The tip row: its column 9 pixel is the heart's own outline, kept. */
const TIP_ROW = 14;
/** Rows whose outer edge (columns 0 and 17) sets the closing edge's colour: the straight part of both lobes. */
const EDGE_SAMPLE_ROWS = [3, 4, 5, 6];

/** id -> [the source heart's uiIcons id, the file written]. */
const ICONS = [
	["ui.heart.halfmax", "ui.heart.full", "heart_halfmax.png"],
	["ui.heart.halfmax.empty", "ui.heart.empty", "heart_halfmax_empty.png"],
];
const HEART_IDS = ICONS.map((e) => e[0]);

/** The UI sheet and the source hearts' rects, read from art/atlases.json (the one place they are measured). */
function sources(config = JSON.parse(fs.readFileSync(path.join(ROOT, "art", "atlases.json"), "utf8"))) {
	const section = config.uiIcons;
	const out = { file: path.join(ROOT, "art", "vendor", section.file), rects: {} };
	for (const id of ["ui.heart.full", "ui.heart.empty", "ui.heart.half"]) {
		const rect = section.icons[id]?.rect;
		if (rect === undefined || rect[2] !== W || rect[3] !== H)
			throw new Error(`gen-heart-halfmax: ${id} must be a ${W} x ${H} rect in art/atlases.json uiIcons`);
		out.rects[id] = rect;
	}
	return out;
}

/** The `rect` [x, y, w, h] of a decoded sheet, as RGBA bytes (w x h). */
function cut(sheet, [rx, ry, w, h]) {
	const out = Buffer.alloc(w * h * 4);
	for (let y = 0; y < h; y++) sheet.data.copy(out, y * w * 4, ((ry + y) * sheet.width + rx) * 4, ((ry + y) * sheet.width + rx + w) * 4);
	return out;
}

/** The mean RGBA (rounded) of the heart's outer edge: columns 0 and W - 1 of EDGE_SAMPLE_ROWS. */
function edgeColour(heart) {
	const sum = [0, 0, 0, 0];
	let n = 0;
	for (const y of EDGE_SAMPLE_ROWS) {
		for (const x of [0, W - 1]) {
			const i = (y * W + x) * 4;
			for (let c = 0; c < 4; c++) sum[c] += heart[i + c];
			n++;
		}
	}
	return sum.map((v) => Math.round(v / n));
}

/** A half container from a whole heart's RGBA (W x H): the left half, the right cleared, the cut closed. */
function halfContainer(heart) {
	if (heart.length !== W * H * 4) throw new Error(`gen-heart-halfmax: a heart must be ${W} x ${H}`);
	const out = Buffer.alloc(W * H * 4);
	for (let y = 0; y < H; y++) heart.copy(out, y * W * 4, y * W * 4, (y * W + KEEP_COLUMNS) * 4);
	const edge = edgeColour(heart);
	for (let y = EDGE_FIRST_ROW; y <= EDGE_LAST_ROW; y++) {
		const i = (y * W + EDGE_X) * 4;
		for (let c = 0; c < 4; c++) out[i + c] = edge[c];
	}
	const tip = (TIP_ROW * W + EDGE_X) * 4;
	heart.copy(out, tip, tip, tip + 4);
	return out;
}

/** The sheet decoded, or undefined when it is not in art/vendor (no paid pack on this machine). */
function readSheet(src = sources()) {
	if (!fs.existsSync(src.file)) return undefined;
	return PNG.sync.read(fs.readFileSync(src.file));
}

/** id -> RGBA of every heart piece the sheet gives (the sources and the two containers). */
function buildAll(sheet, src = sources()) {
	const pieces = {};
	for (const id of Object.keys(src.rects)) pieces[id] = cut(sheet, src.rects[id]);
	for (const [id, from] of ICONS) pieces[id] = halfContainer(pieces[from]);
	return pieces;
}

/** A piece's PNG bytes. */
function encode(rgba) {
	const png = new PNG({ width: W, height: H });
	rgba.copy(png.data);
	return PNG.sync.write(png, { colorType: 6 });
}

/** The review sheet (see the file comment), every pixel alpha-blended on the panel colour. */
function renderContact(pieces, scale = 6) {
	const show = ["ui.heart.full", "ui.heart.half", "ui.heart.empty", ...HEART_IDS];
	const cellW = W * scale + W + 24;
	const cellH = H * scale + 22;
	const BOX = 36;
	const GAP = 6;
	const F = "ui.heart.full";
	const HF = "ui.heart.half";
	const E = "ui.heart.empty";
	// Labels in the boon font (letters only): half hearts held of the maximum.
	const rows = [
		["KNIGHT FIVE OF FIVE", [F, F, "ui.heart.halfmax"]],
		["KNIGHT FOUR OF FIVE", [F, F, "ui.heart.halfmax.empty"]],
		["KNIGHT THREE OF FIVE", [F, HF, "ui.heart.halfmax.empty"]],
		["ARCHER THREE OF THREE", [F, "ui.heart.halfmax"]],
		["ARCHER TWO OF THREE", [F, "ui.heart.halfmax.empty"]],
		["ARCHER ONE OF THREE", [HF, "ui.heart.halfmax.empty"]],
		["TODAY THREE OF THREE", [F, HF]],
	];
	const labelW = 21 * 4 + 8;
	const rowH = BOX + 6;
	const width = Math.max(show.length * cellW + 8, labelW + 3 * (BOX + GAP) + 16);
	const height = cellH + 8 + rows.length * rowH + 8;
	const png = new PNG({ width, height });
	const bg = [28, 28, 36];
	for (let i = 0; i < width * height; i++) {
		png.data[i * 4] = bg[0];
		png.data[i * 4 + 1] = bg[1];
		png.data[i * 4 + 2] = bg[2];
		png.data[i * 4 + 3] = 255;
	}
	const blend = (x, y, [r, g, b, a]) => {
		if (!Number.isInteger(x) || !Number.isInteger(y)) throw new Error(`gen-heart-halfmax: pixel (${x}, ${y})`);
		if (x < 0 || y < 0 || x >= width || y >= height || a === 0) return;
		const i = (y * width + x) * 4;
		png.data[i] = Math.round((r * a + png.data[i] * (255 - a)) / 255);
		png.data[i + 1] = Math.round((g * a + png.data[i + 1] * (255 - a)) / 255);
		png.data[i + 2] = Math.round((b * a + png.data[i + 2] * (255 - a)) / 255);
	};
	const blit = (id, ox, oy, k) => {
		const px = pieces[id];
		for (let y = 0; y < H; y++) {
			for (let x = 0; x < W; x++) {
				const i = (y * W + x) * 4;
				const c = [px[i], px[i + 1], px[i + 2], px[i + 3]];
				for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) blend(ox + x * k + dx, oy + y * k + dy, c);
			}
		}
	};
	const text = (label, ox, oy) => {
		[...label].forEach((ch, k) => {
			const glyph = FONT[ch] ?? FONT[" "];
			for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) {
				if (glyph[gy * 3 + gx] === "1") blend(ox + k * 4 + gx, oy + gy, [215, 204, 180, 255]);
			}
		});
	};
	show.forEach((id, n) => {
		const ox = 8 + n * cellW;
		blit(id, ox, 8, 1);
		blit(id, ox + W + 8, 8, scale);
		text(id.slice("ui.heart.".length).toUpperCase().replace(/\./g, " ").slice(0, 16), ox, 8 + H * scale + 8);
	});
	rows.forEach(([label, hearts], r) => {
		const by = cellH + 8 + r * rowH;
		text(label, 8, by + Math.floor((BOX - 5) / 2));
		hearts.forEach((id, n) => blit(id, labelW + n * (BOX + GAP), by + Math.floor((BOX - H * 2) / 2), 2));
	});
	return PNG.sync.write(png, { colorType: 6 });
}

if (require.main === module) {
	const args = process.argv.slice(2);
	let contact;
	const ci = args.indexOf("--contact");
	if (ci >= 0) {
		contact = args[ci + 1];
		args.splice(ci, 2);
	}
	const outDir = args[0] ?? path.join(ROOT, "art", "vendor", "kaleb-vale", "heart-icons");
	const src = sources();
	const sheet = readSheet(src);
	if (sheet === undefined) {
		console.log(`gen-heart-halfmax: ${path.relative(ROOT, src.file)} not found; skipped (needs the ToffeeCraft sheet)`);
		process.exit(0);
	}
	const pieces = buildAll(sheet, src);
	fs.mkdirSync(outDir, { recursive: true });
	for (const [id, , file] of ICONS) fs.writeFileSync(path.join(outDir, file), encode(pieces[id]));
	if (contact !== undefined) fs.writeFileSync(contact, renderContact(pieces));
	console.log(`gen-heart-halfmax: ${ICONS.length} icons -> ${outDir}`);
}

module.exports = {
	W,
	H,
	KEEP_COLUMNS,
	EDGE_X,
	EDGE_FIRST_ROW,
	EDGE_LAST_ROW,
	TIP_ROW,
	ICONS,
	HEART_IDS,
	sources,
	cut,
	edgeColour,
	halfContainer,
	readSheet,
	buildAll,
	encode,
	renderContact,
};

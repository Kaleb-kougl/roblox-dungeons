#!/usr/bin/env node
/*
 * UI sheet measuring tool (docs/UI_ART.md UA2): flood-fills the piece under a sheet point and prints its alpha
 * bounding rect, so every `rect` in art/atlases.json comes from a measurement, never from the eye.
 *
 *   node scripts/art/ui-measure.js <x> <y> [--sheet <path>] [--alpha <n>]
 *
 * The piece is every pixel 8-connected to (x, y) through pixels with alpha > n (default 10, the reveal's noiseAlpha
 * for this sheet); the seed itself must be such a pixel. Prints `[x, y, w, h]` (sheet pixels) and the pixel count.
 * Default sheet: art/vendor/toffeecraft-horror-ui/UiHorror.png (paths are relative to the repo root unless absolute).
 * Plain Node plus pngjs; `measurePiece` is exported for scripts/art/ui-measure.test.js.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_SHEET = "art/vendor/toffeecraft-horror-ui/UiHorror.png";
const DEFAULT_ALPHA = 10;

/**
 * The piece under (x, y) in `img` ({ w, h, data: RGBA }): the alpha bounding rect { rect: [x, y, w, h], pixels } of
 * every pixel 8-connected to the seed through pixels with alpha > threshold, or null when the seed is not one.
 */
function measurePiece(img, x, y, threshold = DEFAULT_ALPHA) {
	const { w, h, data } = img;
	if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= w || y >= h) {
		throw new Error(`point (${x}, ${y}) is outside the ${w}x${h} image`);
	}
	const solid = (i) => data[i * 4 + 3] > threshold;
	const start = y * w + x;
	if (!solid(start)) return null;
	const seen = new Uint8Array(w * h);
	const stack = [start];
	seen[start] = 1;
	let x0 = x;
	let y0 = y;
	let x1 = x;
	let y1 = y;
	let pixels = 0;
	while (stack.length > 0) {
		const i = stack.pop();
		const px = i % w;
		const py = (i - px) / w;
		pixels++;
		if (px < x0) x0 = px;
		if (px > x1) x1 = px;
		if (py < y0) y0 = py;
		if (py > y1) y1 = py;
		for (let dy = -1; dy <= 1; dy++) {
			for (let dx = -1; dx <= 1; dx++) {
				const nx = px + dx;
				const ny = py + dy;
				if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
				const j = ny * w + nx;
				if (!seen[j] && solid(j)) {
					seen[j] = 1;
					stack.push(j);
				}
			}
		}
	}
	return { rect: [x0, y0, x1 - x0 + 1, y1 - y0 + 1], pixels };
}

function readSheet(file) {
	const png = PNG.sync.read(fs.readFileSync(path.isAbsolute(file) ? file : path.join(ROOT, file)));
	return { w: png.width, h: png.height, data: new Uint8Array(png.data) };
}

function main(argv) {
	const args = [];
	let sheet = DEFAULT_SHEET;
	let alpha = DEFAULT_ALPHA;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--sheet") sheet = argv[++i];
		else if (argv[i] === "--alpha") alpha = Number(argv[++i]);
		else args.push(argv[i]);
	}
	const [x, y] = args.map(Number);
	if (args.length !== 2 || !Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(alpha) || alpha < 0 || alpha > 254) {
		console.error("usage: node scripts/art/ui-measure.js <x> <y> [--sheet <path>] [--alpha <0-254>]");
		process.exit(2);
	}
	if (sheet === undefined || !fs.existsSync(path.isAbsolute(sheet) ? sheet : path.join(ROOT, sheet))) {
		console.error(`ui-measure: ${sheet} is missing (art/README.md says where to get the packs)`);
		process.exit(1);
	}
	const img = readSheet(sheet);
	let piece;
	try {
		piece = measurePiece(img, x, y, alpha);
	} catch (e) {
		console.error(`ui-measure: ${e.message}`);
		process.exit(1);
	}
	if (!piece) {
		console.error(`ui-measure: (${x}, ${y}) has alpha <= ${alpha}: no piece there`);
		process.exit(1);
	}
	console.log(`[${piece.rect.join(", ")}]  (${piece.pixels} px with alpha > ${alpha})`);
}

module.exports = { measurePiece, DEFAULT_ALPHA };

if (require.main === module) main(process.argv.slice(2));

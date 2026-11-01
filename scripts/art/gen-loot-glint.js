#!/usr/bin/env node
/*
 * The loot glint (docs/BREAKABLE_DROPS.md, BL6 art): an original anime-style pixel-art star twinkle, drawn by code so
 * it needs no third-party pack. Greyscale (white core, alpha falling off toward the ray tips): the renderer tints it
 * with the `decor.fx.glint` colour role, like the Lords of Pain glint it stands in for on loaded pieces.
 *
 *   node scripts/art/gen-loot-glint.js [outDir]     (default art/vendor/kaleb-vale/loot-glint)
 *
 * Writes loot_glint_0.png .. loot_glint_7.png (one CANVAS x CANVAS frame each, the star centred). The sequence: a dot
 * pops into a plus, stretches into a long thin four-point star with short diagonal rays and a small companion sparkle
 * up and to the right (the peak, frame PEAK_FRAME), then shrinks back to a dot. Same inputs, byte-identical PNGs.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

/** Frame size in pixels (square, odd so the star has a centre pixel). */
const CANVAS = 31;
const CX = 15;
const CY = 15;
/** The companion sparkle's centre (up and to the right of the main star). */
const SX = 24;
const SY = 7;

/** Alpha steps (pixel art: a few flat levels, no smooth gradients). */
const A = { full: 255, hi: 215, mid: 160, lo: 105, faint: 60 };

/**
 * Per frame: v / h the main star's vertical / horizontal arm length beyond the core, core the core diamond's radius,
 * thick how many arm pixels next to the core are three wide, diag the diagonal ray length, comp the companion's arm
 * length (-1: none, 0: a single pixel), fade a multiplier on every alpha (pop in / out).
 */
const FRAMES = [
	{ v: 1, h: 1, core: 0, thick: 0, diag: 0, comp: -1, fade: 0.7 },
	{ v: 3, h: 2, core: 0, thick: 1, diag: 0, comp: -1, fade: 0.9 },
	{ v: 7, h: 5, core: 1, thick: 1, diag: 1, comp: 0, fade: 1 },
	{ v: 11, h: 8, core: 1, thick: 2, diag: 3, comp: 2, fade: 1 },
	{ v: 13, h: 10, core: 2, thick: 2, diag: 4, comp: 3, fade: 1 },
	{ v: 9, h: 7, core: 1, thick: 2, diag: 3, comp: 2, fade: 1 },
	{ v: 5, h: 4, core: 1, thick: 1, diag: 0, comp: 1, fade: 0.85 },
	{ v: 2, h: 1, core: 0, thick: 0, diag: 0, comp: 0, fade: 0.55 },
];
/** The brightest frame (a still sparkle under reduced motion should use it). */
const PEAK_FRAME = 4;

function blank() {
	return new Uint8Array(CANVAS * CANVAS); // alpha only; RGB is white everywhere a pixel is set
}

/** Keeps the brighter of what is there and `a` (strokes overlap at the core). */
function plot(img, x, y, a) {
	if (x < 0 || y < 0 || x >= CANVAS || y >= CANVAS || !(a > 0)) return;
	const i = y * CANVAS + x;
	if (a > img[i]) img[i] = Math.min(255, Math.round(a));
}

/** Alpha at step `k` (1 = next to the core) of an arm `len` long: bright near the core, faint at the tip. */
function armAlpha(k, len) {
	const t = k / len;
	if (t <= 0.35) return A.full;
	if (t <= 0.6) return A.hi;
	if (t <= 0.8) return A.mid;
	if (t < 1) return A.lo;
	return A.faint;
}

/** A four-point star at (cx, cy): arms v (up / down) and h (left / right), a diamond core, optional diagonal rays. */
function star(img, cx, cy, s, fade) {
	// core diamond
	for (let dy = -s.core; dy <= s.core; dy++)
		for (let dx = -s.core; dx <= s.core; dx++) if (Math.abs(dx) + Math.abs(dy) <= s.core) plot(img, cx + dx, cy + dy, A.full * fade);
	plot(img, cx, cy, A.full * fade);
	const arms = [
		[0, -1, s.v],
		[0, 1, s.v],
		[-1, 0, s.h],
		[1, 0, s.h],
	];
	for (const [ux, uy, len] of arms) {
		for (let k = 1; k <= len; k++) {
			const a = armAlpha(k, len) * fade;
			const x = cx + ux * (s.core + k);
			const y = cy + uy * (s.core + k);
			plot(img, x, y, a);
			// the first `thick` pixels are three wide (the sides at a lower step), so the arm tapers to a 1 px line
			if (k <= s.thick) {
				const side = (k === 1 ? A.hi : A.mid) * fade;
				plot(img, x + uy, y + ux, side);
				plot(img, x - uy, y - ux, side);
			}
		}
	}
	for (const [ux, uy] of [
		[1, 1],
		[1, -1],
		[-1, 1],
		[-1, -1],
	]) {
		// a ray of 2+ starts one pixel out (a dark notch between it and the core keeps the core pinched, star-like)
		for (let k = s.diag >= 2 ? 2 : 1; k <= s.diag; k++)
			plot(img, cx + ux * (s.core + k), cy + uy * (s.core + k), (k <= 2 ? A.hi : k === 3 ? A.mid : A.lo) * fade);
	}
}

/** The companion: a small plus (arm `len`), or one pixel at 0. */
function companion(img, len, fade) {
	if (len < 0) return;
	plot(img, SX, SY, A.full * fade);
	for (let k = 1; k <= len; k++) {
		const a = (k === len ? A.lo : A.hi) * fade;
		plot(img, SX, SY - k, a);
		plot(img, SX, SY + k, a);
		plot(img, SX - k, SY, a);
		plot(img, SX + k, SY, a);
	}
}

/**
 * Fills the pinholes the strokes leave round the core (a pixel with at least three set 4-neighbours gets the dimmest of
 * them, at most A.mid: a little shading), so the core reads as one solid bloom instead of a grid. Within HOLE_FILL_RADIUS of the centre only.
 */
const HOLE_FILL_RADIUS = 3;
function fillHoles(img, cx, cy) {
	const add = [];
	for (let y = cy - HOLE_FILL_RADIUS; y <= cy + HOLE_FILL_RADIUS; y++)
		for (let x = cx - HOLE_FILL_RADIUS; x <= cx + HOLE_FILL_RADIUS; x++) {
			if (img[y * CANVAS + x] > 0) continue;
			const n = [
				[x + 1, y],
				[x - 1, y],
				[x, y + 1],
				[x, y - 1],
			]
				.map(([nx, ny]) => img[ny * CANVAS + nx])
				.filter((a) => a > 0);
			if (n.length >= 3) add.push([x, y, Math.min(A.mid, ...n)]);
		}
	for (const [x, y, a] of add) plot(img, x, y, a);
}

function renderFrame(s) {
	const img = blank();
	star(img, CX, CY, s, s.fade);
	fillHoles(img, CX, CY);
	companion(img, s.comp, s.fade);
	const png = new PNG({ width: CANVAS, height: CANVAS });
	for (let i = 0; i < CANVAS * CANVAS; i++) {
		const a = img[i];
		png.data[i * 4] = 255;
		png.data[i * 4 + 1] = 255;
		png.data[i * 4 + 2] = 255;
		png.data[i * 4 + 3] = a;
	}
	return PNG.sync.write(png, { colorType: 6 });
}

function main() {
	const out = path.resolve(process.argv[2] || path.join(__dirname, "..", "..", "art", "vendor", "kaleb-vale", "loot-glint"));
	fs.mkdirSync(out, { recursive: true });
	FRAMES.forEach((s, f) => fs.writeFileSync(path.join(out, `loot_glint_${f}.png`), renderFrame(s)));
	console.log(`gen-loot-glint: ${FRAMES.length} frames (${CANVAS}x${CANVAS}, peak ${PEAK_FRAME}) -> ${path.relative(process.cwd(), out)}`);
}

if (require.main === module) main();

module.exports = { CANVAS, FRAMES, PEAK_FRAME, renderFrame };

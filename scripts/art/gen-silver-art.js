#!/usr/bin/env node
/*
 * Silver's art (docs/SILVER.md SV7): original pixel art drawn by code, so it needs no third-party pack (like the boon
 * icons and the Goldling's coin burst, scripts/art/gen-boon-icons.js and gen-fortune-art.js).
 *
 *   node scripts/art/gen-silver-art.js [outDir] [--contact <file.png>]   (default art/vendor/kaleb-vale/silver)
 *
 * ui.icon.silver: the Silver counter's icon, ICON x ICON full colour (the counter's box is SILVER_COUNTER.iconPx 12
 *   reference px, so the art draws at whole steps of 1). An OCTAGONAL coin, never the score's round gold coin, in a
 *   cool silver ramp around the `silver` role (#c4d0dc), lit from the top left like the boon icons, stamped with a
 *   crescent moon (the old alchemists' sign for silver), auto-outlined in the boon icons' near black. Writes icon.png.
 *
 * fx.silver.coins: the crate burst's coin in flight (SilverHudController's coin layer), a greyscale loop tinted by
 *   `silver` at draw time: the same octagonal coin turning about its upright axis, one COIN_STEP_DEG step a frame (face,
 *   oblique, edge, oblique, back, ...): the face bright with a shine, the back a step darker, the edge a milled bar;
 *   outlined in a dark grey (near black once tinted). At 7 px a stamp would only smudge, so the flying coin has none.
 *   Writes coin.png: COIN_FRAMES frames of COIN_W x COIN_H side by side (the fx strip format).
 *
 * `--contact` also writes a review sheet (both at 1x and 8x on the UI's panel colour). Same inputs, byte-identical PNGs.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");
const BOON = require("./gen-boon-icons.js");

// --- the icon ---------------------------------------------------------------------------------------------------------

/** The icon's canvas side, px (the counter's box, SILVER_COUNTER.iconPx). */
const ICON = 12;
/** The drawn coin's side, px: one px of outline room on every side. */
const ICON_MAP = ICON - 2;
/** The octagon: a pixel centre (dx, dy) from the coin's centre (in the map) is inside when |dx| + |dy| <= ICON_CUT. */
const ICON_CUT = 6;
/** The icon's colours: a cool silver ramp around the `silver` role (#c4d0dc) and the boon icons' outline. */
const ICON_COLOURS = {
	o: BOON.OUTLINE,
	a: [62, 70, 86], // the rim's shadow side
	b: [112, 124, 142], // the stamp
	c: [160, 172, 188], // the rim's turning sides
	d: [196, 208, 220], // the face: the `silver` role
	e: [238, 243, 249], // the rim's lit side and the shine
};

/** The crescent: inside the moon disc and outside the bite (centres and radii in map px, from the map's top left). */
const MOON = { cx: 4.7, cy: 5.0, r: 2.8, biteX: 5.9, biteY: 4.3, biteR: 2.3 };

/** The icon as colour characters (ICON rows of ICON characters, `.` clear). */
function drawIconMap() {
	const half = ICON_MAP / 2;
	const inside = (x, y) => {
		if (x < 0 || y < 0 || x >= ICON_MAP || y >= ICON_MAP) return false;
		const dx = x + 0.5 - half;
		const dy = y + 0.5 - half;
		return Math.abs(dx) + Math.abs(dy) <= ICON_CUT;
	};
	const grid = Array.from({ length: ICON }, () => new Array(ICON).fill("."));
	for (let y = 0; y < ICON_MAP; y++) {
		for (let x = 0; x < ICON_MAP; x++) {
			if (!inside(x, y)) continue;
			const rim = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
			const dx = x + 0.5 - half;
			const dy = y + 0.5 - half;
			let ch = "d";
			if (rim) {
				// lit from the top left: the outward direction against the light
				const light = -(dx + dy) / Math.hypot(dx, dy);
				ch = light > 0.38 ? "e" : light < -0.38 ? "a" : "c";
			} else {
				const px = x + 0.5;
				const py = y + 0.5;
				const inMoon = Math.hypot(px - MOON.cx, py - MOON.cy) <= MOON.r;
				const inBite = Math.hypot(px - MOON.biteX, py - MOON.biteY) <= MOON.biteR;
				if (inMoon && !inBite) ch = "b";
			}
			grid[y + 1][x + 1] = ch;
		}
	}
	// the shine: the face's top-left pixel inside the rim
	const shine = grid.findIndex((r) => r.includes("d"));
	if (shine >= 0) grid[shine][grid[shine].indexOf("d")] = "e";
	// the outline: every clear pixel 4-next to the coin
	const solid = (x, y) => x >= 0 && y >= 0 && x < ICON && y < ICON && grid[y][x] !== "." && grid[y][x] !== "#";
	for (let y = 0; y < ICON; y++) {
		for (let x = 0; x < ICON; x++) {
			if (grid[y][x] !== ".") continue;
			if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) grid[y][x] = "#";
		}
	}
	return grid.map((r) => r.map((ch) => (ch === "#" ? "o" : ch)).join(""));
}

function renderIcon() {
	const rows = drawIconMap();
	return toPng(ICON, ICON, (i) => {
		const ch = rows[Math.floor(i / ICON)][i % ICON];
		if (ch === ".") return [0, 0, 0, 0];
		return [...ICON_COLOURS[ch], 255];
	});
}

// --- the coin in flight -----------------------------------------------------------------------------------------------

/** The coin's side face on, px (7: the octagon reads as eight-sided at 7 px), and the frame's side with its outline. */
const COIN_SIDE = 7;
const COIN_W = COIN_SIDE + 2;
const COIN_H = COIN_SIDE + 2;
/** The turn: one step a frame; 360 / COIN_STEP_DEG frames make one loop. */
const COIN_STEP_DEG = 45;
const COIN_FRAMES = 360 / COIN_STEP_DEG;
const COIN_FPS = 12;
/** Grey levels by index: outline, shadow, rim, face, light (the tint multiplies them by `silver`). */
const COIN_GREY = [40, 98, 160, 210, 255];
/** The octagon's cut (pixel centres): |u| + |v| <= COIN_CUT inside the 7 px square (3 px across its top row). */
const COIN_CUT = 4.5;
/** The thinnest a turning coin is drawn, px: its edge (two px, so the edge-on frame is not a hairline). */
const COIN_EDGE = 2;
/** The face's shine: interior pixels with u + v at or below minus this (and both negative) are drawn at full light. */
const COIN_SHINE = 1.5;

/** The coin's width at turn angle `deg`, px (whole, at least the edge's). */
function coinWidth(deg) {
	const c = Math.abs(Math.cos((deg * Math.PI) / 180));
	return Math.max(COIN_EDGE, Math.round(COIN_SIDE * c));
}

/** One frame as COIN_GREY indices (-1 clear), COIN_W x COIN_H. */
function renderCoinFrame(f) {
	const deg = f * COIN_STEP_DEG;
	const front = Math.cos((deg * Math.PI) / 180) > 0.01;
	const w = coinWidth(deg);
	const lv = new Int8Array(COIN_W * COIN_H).fill(-1);
	const x0 = Math.floor((COIN_W - w) / 2);
	const half = COIN_SIDE / 2;
	const inside = (x, y) => {
		if (x < x0 || x >= x0 + w || y < 1 || y >= 1 + COIN_SIDE) return false;
		// edge on: the whole height (the octagon's cut would shorten the bar)
		if (w <= COIN_EDGE) return true;
		// the face's u, stretched back to the 7 px coin; v as drawn
		const u = ((x - x0 + 0.5) / w) * COIN_SIDE - half;
		const v = y - 1 + 0.5 - half;
		return Math.abs(u) + Math.abs(v) <= COIN_CUT;
	};
	for (let y = 0; y < COIN_H; y++) {
		for (let x = 0; x < COIN_W; x++) {
			if (!inside(x, y)) continue;
			const rim = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
			const u = ((x - x0 + 0.5) / w) * COIN_SIDE - half;
			const v = y - 1 + 0.5 - half;
			let g = front ? 3 : 2;
			if (w <= COIN_EDGE) {
				// edge on: the milled edge, lit on its left, its ends in shade
				g = x === x0 ? 4 : 2;
				if (y === 1 || y === COIN_SIDE) g = 1;
			} else if (rim) {
				const light = -(u + v) / Math.max(1e-6, Math.hypot(u, v));
				g = light > 0.38 ? 4 : light < -0.38 ? 1 : 2;
			} else if (front && v < 0 && u < 0 && u + v <= -COIN_SHINE) {
				// the face's shine, up and left by the rim
				g = 4;
			}
			lv[y * COIN_W + x] = g;
		}
	}
	// the outline
	const solid = (x, y) => x >= 0 && y >= 0 && x < COIN_W && y < COIN_H && lv[y * COIN_W + x] > 0;
	for (let y = 0; y < COIN_H; y++) {
		for (let x = 0; x < COIN_W; x++) {
			if (lv[y * COIN_W + x] >= 0) continue;
			if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) lv[y * COIN_W + x] = 0;
		}
	}
	return lv;
}

function renderCoinStrip() {
	const W = COIN_W * COIN_FRAMES;
	const frames = [...Array(COIN_FRAMES).keys()].map(renderCoinFrame);
	return toPng(W, COIN_H, (i) => {
		const x = i % W;
		const y = (i - x) / W;
		const f = Math.floor(x / COIN_W);
		const v = frames[f][y * COIN_W + (x - f * COIN_W)];
		if (v < 0) return [0, 0, 0, 0];
		const g = COIN_GREY[v];
		return [g, g, g, 255];
	});
}

// --- review sheet -----------------------------------------------------------------------------------------------------

/** The UI's panel colour (the boon icons' contact background) and the `silver` tint the coin is drawn with. */
const PANEL = [28, 18, 20];
const SILVER_TINT = [196, 208, 220];

/** Both at 1x and `scale` x: the icon, then every coin frame tinted by `silver`. */
function renderContact(scale = 8) {
	const icon = PNG.sync.read(renderIcon());
	const strip = PNG.sync.read(renderCoinStrip());
	const gap = 4;
	const W = gap + (ICON + gap) + ICON * scale + gap + COIN_FRAMES * (COIN_W * scale + gap);
	const H = gap + Math.max(ICON * scale, COIN_H * scale) + gap + COIN_H + gap;
	const png = new PNG({ width: W, height: H });
	for (let i = 0; i < W * H; i++) {
		png.data[i * 4] = PANEL[0];
		png.data[i * 4 + 1] = PANEL[1];
		png.data[i * 4 + 2] = PANEL[2];
		png.data[i * 4 + 3] = 255;
	}
	const put = (src, sx, sy, sw, sh, dx, dy, k, tint) => {
		for (let y = 0; y < sh * k; y++) {
			for (let x = 0; x < sw * k; x++) {
				const si = ((sy + Math.floor(y / k)) * src.width + sx + Math.floor(x / k)) * 4;
				const a = src.data[si + 3] / 255;
				if (a === 0) continue;
				const di = ((dy + y) * W + dx + x) * 4;
				for (let c = 0; c < 3; c++) {
					const v = tint ? (src.data[si + c] * tint[c]) / 255 : src.data[si + c];
					png.data[di + c] = Math.round(v * a + png.data[di + c] * (1 - a));
				}
			}
		}
	};
	put(icon, 0, 0, ICON, ICON, gap, gap, 1);
	put(icon, 0, 0, ICON, ICON, gap + ICON + gap, gap, scale);
	let x = gap + ICON + gap + ICON * scale + gap;
	for (let f = 0; f < COIN_FRAMES; f++) {
		put(strip, f * COIN_W, 0, COIN_W, COIN_H, x, gap, scale, SILVER_TINT);
		put(strip, f * COIN_W, 0, COIN_W, COIN_H, x, gap + COIN_H * scale + gap, 1, SILVER_TINT);
		x += COIN_W * scale + gap;
	}
	return PNG.sync.write(png, { colorType: 6 });
}

// --- output -----------------------------------------------------------------------------------------------------------

function toPng(w, h, px) {
	const png = new PNG({ width: w, height: h });
	for (let i = 0; i < w * h; i++) {
		const [r, g, b, a] = px(i);
		png.data[i * 4] = a > 0 ? r : 0;
		png.data[i * 4 + 1] = a > 0 ? g : 0;
		png.data[i * 4 + 2] = a > 0 ? b : 0;
		png.data[i * 4 + 3] = a;
	}
	return PNG.sync.write(png, { colorType: 6 });
}

function main() {
	const args = process.argv.slice(2);
	const ci = args.indexOf("--contact");
	const contact = ci >= 0 ? args[ci + 1] : undefined;
	if (ci >= 0) args.splice(ci, 2);
	const out = path.resolve(args[0] || path.join(__dirname, "..", "..", "art", "vendor", "kaleb-vale", "silver"));
	fs.mkdirSync(out, { recursive: true });
	fs.writeFileSync(path.join(out, "icon.png"), renderIcon());
	fs.writeFileSync(path.join(out, "coin.png"), renderCoinStrip());
	if (contact !== undefined) fs.writeFileSync(contact, renderContact());
	console.log(
		`gen-silver-art: icon ${ICON}x${ICON}, coin ${COIN_FRAMES} frames (${COIN_W}x${COIN_H} @ ${COIN_FPS} fps) -> ${path.relative(
			process.cwd(),
			out,
		)}`,
	);
}

if (require.main === module) main();

module.exports = {
	ICON,
	ICON_MAP,
	ICON_COLOURS,
	COIN_W,
	COIN_H,
	COIN_FRAMES,
	COIN_FPS,
	COIN_GREY,
	COIN_EDGE,
	coinWidth,
	drawIconMap,
	renderIcon,
	renderCoinFrame,
	renderCoinStrip,
	renderContact,
};

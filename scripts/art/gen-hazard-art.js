#!/usr/bin/env node
/*
 * The floor hazards (docs/HAZARD_ART.md HAD1, supersedes docs/PROJECTILE_ART.md PAD3 for the strike and the embers):
 * original pixel art drawn by code, so they need no third-party pack.
 *
 *   - The Stormcaller's lightning strike (`bullet.enemy.strike`), seen from straight above like the boost auras (a true
 *     circle: the renderer lays it flat UNstretched, so the camera foreshortens it exactly onto the hit circle). `flash`
 *     plays over the strike's 0.1 s life: a white core with six jagged forks reaching the hit rim, then a shock ring at
 *     the rim, then the ring breaking into sparks. `scorch` is what the view leaves after the bullet is gone (HAD3): a
 *     char blot with radial cracks, hot (glowing cracks, sparks) then cold.
 *   - The build embers (`bullet.player.ember`), in the game's 3/4 view like the goo: a burning patch on the floor (an
 *     ellipse squashed to sin 55 deg, the box `EMBER_LIT` that covers the drawn disc) and one flame tongue rising off
 *     it, swaying and flickering, a spark climbing off the tip. `burn` is a seamless 6-frame loop.
 *
 * Greyscale (white = the tint's full colour, greys its shades; HAD2): the renderer tints the strike with `enemyBullet`
 * and the embers with `build.ember` (ImageColor3 multiplies). Shades are kept light where the art must glow (falloff in
 * alpha, not luminance); only the scorch's char is dark on purpose.
 *
 *   node scripts/art/gen-hazard-art.js [outDir]     (default art/vendor/kaleb-vale/hazards)
 *
 * Writes horizontal strips (art/atlases.json `hazards` reads them): strike_flash.png, strike_scorch.png,
 * ember_burn.png. Same inputs, byte-identical PNGs (no timestamps, fixed encoder options).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const TAU = Math.PI * 2;
/** The vale bullet sheets' density (the swarmer's), px a tile. */
const PIXELS_PER_TILE = 29.6;
/** The strike's hit radius, tiles (shared/sim STRIKE_BULLET_RADIUS; hazards.spec.ts pins the generated layout). */
const STRIKE_RADIUS_TILES = 1.1;
/** The hit rim, px from the centre: round(1.1 x 29.6) = 33. */
const STRIKE_R = Math.round(STRIKE_RADIUS_TILES * PIXELS_PER_TILE);
/** Canvas margin beyond the rim (the last flash frame's sparks reach R + 4.5). */
const STRIKE_MARGIN = 5;
/** Strike canvas side, px (odd: the centre is the centre pixel). */
const STRIKE_SIZE = 2 * (STRIKE_R + STRIKE_MARGIN) + 1;
/** The strike's pivot (the centre pixel's centre), canvas px. */
const STRIKE_PIVOT = { x: STRIKE_R + STRIKE_MARGIN + 0.5, y: STRIKE_R + STRIKE_MARGIN + 0.5 };
const FLASH_FRAMES = 3;
const SCORCH_FRAMES = 2;

/** Ember canvas, px: the patch at the bottom, the tongue above it. */
const EMBER_W = 17;
const EMBER_H = 31;
/** The burning patch: centre (canvas px) and radii. 15 x 12: a floor circle seen at 55 deg (12 / 15 ~ sin 55). */
const EMBER_PATCH = { cx: 8.5, cy: 23.5, rx: 7.5, ry: 6 };
/** The patch's box (what covers the drawn disc), px, centred on the pivot: the patch ellipse's width and height. */
const EMBER_LIT = { w: 15, h: 12 };
/** The ember's pivot: the patch's centre, canvas px. */
const EMBER_PIVOT = { x: EMBER_PATCH.cx, y: EMBER_PATCH.cy };
const BURN_FRAMES = 6;

/** Flat levels (pixel art: no smooth gradients). */
const L = { white: 255, hot: 235, light: 210, mid: 170, cool: 110, char: 40 };
const A = { full: 255, hi: 225, mid: 170, lo: 120, faint: 80 };

/** A blank canvas: per-pixel luminance and alpha. */
function blank(w, h) {
	return { w, h, lum: new Uint8Array(w * h), alpha: new Uint8Array(w * h) };
}
/** Keeps the more opaque (then the brighter) of what is there and (lum, alpha). */
function put(img, x, y, lum, alpha) {
	if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
	const i = y * img.w + x;
	if (alpha > img.alpha[i] || (alpha === img.alpha[i] && lum > img.lum[i])) {
		img.alpha[i] = alpha;
		img.lum[i] = lum;
	}
}
/** Overwrites (lum, alpha): for the char, which must darken what is under it. */
function set(img, x, y, lum, alpha) {
	if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
	const i = y * img.w + x;
	img.alpha[i] = alpha;
	img.lum[i] = lum;
}
/** A deterministic hash in [0, 1). */
function hash(n) {
	let h = (n * 2654435761) >>> 0;
	h ^= h >>> 15;
	h = Math.imul(h, 2246822519) >>> 0;
	h ^= h >>> 13;
	return (h >>> 0) / 4294967296;
}
function hash2(a, b) {
	return hash(a * 7919 + b * 104729 + 13);
}
/** Polar coordinates of pixel (x, y)'s centre around the strike's centre: radius and angle (0 = right, ccw). */
function polar(x, y) {
	const dx = x + 0.5 - STRIKE_PIVOT.x;
	const dy = STRIKE_PIVOT.y - (y + 0.5);
	let a = Math.atan2(dy, dx);
	if (a < 0) a += TAU;
	return { r: Math.hypot(dx, dy), a };
}
/** A 1 px line from (x0, y0) to (x1, y1), canvas px (Bresenham on rounded ends). */
function line(img, x0, y0, x1, y1, lum, alpha) {
	let ax = Math.round(x0);
	let ay = Math.round(y0);
	const bx = Math.round(x1);
	const by = Math.round(y1);
	const dx = Math.abs(bx - ax);
	const dy = -Math.abs(by - ay);
	const sx = ax < bx ? 1 : -1;
	const sy = ay < by ? 1 : -1;
	let err = dx + dy;
	for (;;) {
		put(img, ax, ay, lum, alpha);
		if (ax === bx && ay === by) return;
		const e2 = 2 * err;
		if (e2 >= dy) {
			err += dy;
			ax += sx;
		}
		if (e2 <= dx) {
			err += dx;
			ay += sy;
		}
	}
}
/** The canvas point at radius r, angle a (around the strike centre). */
function at(r, a) {
	return [STRIKE_PIVOT.x - 0.5 + Math.cos(a) * r, STRIKE_PIVOT.y - 0.5 - Math.sin(a) * r];
}
/**
 * A jagged bolt from radius r0 to r1 along angle a: vertices every `step` px, each pushed sideways by up to `jag` px
 * (seeded). Returns the vertices (canvas px).
 */
function boltPath(seed, a, r0, r1, step, jag) {
	const pts = [];
	const n = Math.max(1, Math.round((r1 - r0) / step));
	for (let k = 0; k <= n; k++) {
		const r = r0 + ((r1 - r0) * k) / n;
		const side = k === 0 || k === n ? 0 : (hash2(seed, k) * 2 - 1) * jag;
		const [x, y] = at(r, a);
		pts.push([x - Math.sin(a) * side, y - Math.cos(a) * side]);
	}
	return pts;
}
function drawPath(img, pts, lum, alpha) {
	for (let k = 1; k < pts.length; k++) line(img, pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1], lum, alpha);
}
/** A soft halo round a drawn path: the 4-neighbours of every pixel already at `minAlpha`+, at (lum, alpha). */
function halo(img, minAlpha, lum, alpha) {
	const src = Uint8Array.from(img.alpha);
	for (let y = 0; y < img.h; y++) {
		for (let x = 0; x < img.w; x++) {
			if (src[y * img.w + x] < minAlpha) continue;
			put(img, x + 1, y, lum, alpha);
			put(img, x - 1, y, lum, alpha);
			put(img, x, y + 1, lum, alpha);
			put(img, x, y - 1, lum, alpha);
		}
	}
}
function eachPixel(img, fn) {
	for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) fn(x, y);
}

/** The six main forks' angles: evenly spaced, each nudged (seeded) so the strike does not read as a wheel. */
const FORKS = Array.from({ length: 6 }, (_, k) => (k / 6) * TAU + 0.5 + (hash(k + 11) - 0.5) * 0.5);
const R = STRIKE_R;

// Flash 0: the impact. A white core, six jagged forks to the rim with branches, a thin rim ring.
function flash0(img) {
	eachPixel(img, (x, y) => {
		const p = polar(x, y);
		if (p.r < 5) put(img, x, y, L.white, A.full);
		else if (p.r < 8) put(img, x, y, L.white, A.hi);
		else if (p.r < 11) put(img, x, y, L.hot, A.faint);
		if (p.r >= R - 0.5 && p.r < R + 0.5) put(img, x, y, L.white, A.mid);
	});
	FORKS.forEach((a, k) => {
		const pts = boltPath(100 + k, a, 4, R, 5, 2.6);
		drawPath(img, pts, L.white, A.full);
		// the inner third of each fork two px thick
		const inner = pts.slice(0, Math.ceil(pts.length / 3) + 1).map(([x, y]) => [x + Math.sin(a) * 0.9, y + Math.cos(a) * 0.9]);
		drawPath(img, inner, L.white, A.full);
		// a branch off the middle of every other fork
		if (k % 2 === 0) {
			const mid = pts[Math.floor(pts.length / 2)];
			const b = a + (hash(k + 50) < 0.5 ? 0.45 : -0.45);
			const end = [mid[0] + Math.cos(b) * 11, mid[1] - Math.sin(b) * 11];
			const kink = [mid[0] + Math.cos(b + 0.3) * 6, mid[1] - Math.sin(b + 0.3) * 6];
			line(img, mid[0], mid[1], kink[0], kink[1], L.white, A.hi);
			line(img, kink[0], kink[1], end[0], end[1], L.white, A.hi);
		}
	});
	halo(img, A.hi, L.hot, A.lo);
}

// Flash 1: the shock. The core shrinks, the forks flicker (re-jagged, dimmer), a bright shock band at the rim.
function flash1(img) {
	eachPixel(img, (x, y) => {
		const p = polar(x, y);
		if (p.r < 3) put(img, x, y, L.white, A.hi);
		else if (p.r < 6) put(img, x, y, L.hot, A.lo);
		if (p.r >= R - 1.5 && p.r < R + 0.5) put(img, x, y, L.white, A.full);
		else if (p.r >= R - 3.5 && p.r < R - 1.5) put(img, x, y, L.hot, A.mid);
		else if (p.r >= R - 5.5 && p.r < R - 3.5 && hash2(x, y) < 0.35) put(img, x, y, L.light, A.faint);
	});
	FORKS.forEach((a, k) => {
		const pts = boltPath(200 + k, a + 0.06, 6, R - 2, 5, 2.2);
		drawPath(img, pts, L.white, A.mid);
	});
}

// Flash 2: the ring breaks into dashes and sparks thrown past the rim; crackles near it; a faint centre.
function flash2(img) {
	eachPixel(img, (x, y) => {
		const p = polar(x, y);
		if (p.r < 2.5) put(img, x, y, L.hot, A.faint);
		const seg = Math.floor((p.a / TAU) * 28);
		if (p.r >= R - 0.5 && p.r < R + 0.5 && hash(seg + 300) < 0.6) put(img, x, y, L.white, A.mid);
	});
	for (let s = 0; s < 16; s++) {
		const a = hash(s + 400) * TAU;
		const r = R + 1 + hash(s + 450) * 3.5;
		const [x, y] = at(r, a);
		const [x2, y2] = at(r - 1.6, a);
		line(img, x2, y2, x, y, L.white, s % 3 === 0 ? A.full : A.hi);
	}
	FORKS.forEach((a, k) => {
		const pts = boltPath(500 + k, a + 0.3, R - 8, R - 2, 2, 1.6);
		drawPath(img, pts, L.light, A.lo);
	});
}

/** The scorch's char edge at angle a, px: about 0.62 R, wobbly. */
function charEdge(a) {
	return 0.6 * R * (1 + 0.07 * Math.sin(3 * a + 1) + 0.06 * Math.sin(7 * a + 2.1) + 0.04 * Math.sin(12 * a + 0.4));
}
/** The scorch's cracks: seven, between the forks, out past the char. */
const CRACKS = Array.from({ length: 7 }, (_, k) => (k / 7) * TAU + 0.2 + (hash(k + 600) - 0.5) * 0.6);

// Scorch: a char blot (dark: soot), radial cracks glowing hot (frame 0) or dim (frame 1), a glowing pit, sparks.
function scorch(img, hot) {
	eachPixel(img, (x, y) => {
		const p = polar(x, y);
		const e = charEdge(p.a);
		if (p.r < 0.7 * e) set(img, x, y, L.char, 215);
		else if (p.r < 0.9 * e) set(img, x, y, L.char, 165);
		else if (p.r < e) set(img, x, y, L.char, 110);
		else if (p.r < e + 2.5 && hash2(x + 1000, y) < 0.3) set(img, x, y, L.char, A.faint);
	});
	CRACKS.forEach((a, k) => {
		const len = charEdge(a) * (0.95 + 0.35 * hash(k + 650));
		const pts = boltPath(700 + k, a, 3, len, 4, 1.8);
		if (hot) {
			drawPath(img, pts, L.white, A.hi);
		} else {
			for (let j = 1; j < pts.length; j++) {
				const lum = L.cool;
				lineOver(img, pts[j - 1], pts[j], lum, A.mid);
			}
		}
	});
	eachPixel(img, (x, y) => {
		const p = polar(x, y);
		if (p.r < 3) set(img, x, y, hot ? L.light : 60, 230);
	});
	if (hot) {
		for (let s = 0; s < 6; s++) {
			const a = hash(s + 800) * TAU;
			const r = 4 + hash(s + 850) * (0.8 * R - 4);
			const [x, y] = at(r, a);
			put(img, Math.round(x), Math.round(y), L.white, A.hi);
		}
	}
}
/** A line that overwrites (cold cracks must replace the char under them). */
function lineOver(img, p0, p1, lum, alpha) {
	const tmp = blank(img.w, img.h);
	line(tmp, p0[0], p0[1], p1[0], p1[1], lum, alpha);
	for (let i = 0; i < img.w * img.h; i++) {
		if (tmp.alpha[i] > 0) {
			img.lum[i] = lum;
			img.alpha[i] = alpha;
		}
	}
}

// Ember burn: a burning patch on the floor and one flame tongue swaying and flickering, a spark off the tip.
function burn(img, f) {
	const ph = ((f % BURN_FRAMES) / BURN_FRAMES) * TAU; // one loop: every term repeats after BURN_FRAMES frames
	const P = EMBER_PATCH;
	eachPixel(img, (x, y) => {
		const ex = (x + 0.5 - P.cx) / P.rx;
		const ey = (y + 0.5 - P.cy) / P.ry;
		const e = Math.hypot(ex, ey);
		if (e >= 1) return;
		const flick = hash2(x * 31 + y, (f % BURN_FRAMES) + 1);
		if (e < 0.45) put(img, x, y, L.white, A.hi);
		else if (e < 0.8) put(img, x, y, L.hot, flick < 0.75 ? A.mid : A.lo);
		else if (flick < 0.6) put(img, x, y, L.light, A.lo);
	});
	// the tongue: from just above the patch centre up to a height that breathes with the loop; a flame's profile (a
	// belly low down, a pointed tip), its edges licking (a wave running up it), and a smaller side tongue that swaps
	// sides over the loop
	const baseY = P.cy - 1;
	const height = 18 + 1.6 * Math.sin(ph) + 0.9 * Math.sin(2 * ph + 1);
	const sway = (t) => 1.6 * Math.pow(t, 1.4) * Math.sin(ph + 2.4 * t);
	const half = (t) => 5.4 * Math.pow(Math.sin(Math.PI * (0.18 + 0.82 * t)), 0.9) * Math.pow(1 - t, 0.35);
	const lick = (t, side) => 1 + 0.22 * Math.sin(11 * t - 2 * ph + side * 1.7);
	const tongue = (x, y, cx, h, scale, sideSeed) => {
		const t = (baseY - (y + 0.5)) / h;
		if (t < 0 || t >= 1) return;
		const dx = x + 0.5 - (cx + sway(t) * scale);
		const w = half(t) * scale * lick(t, dx < 0 ? -1 : 1 + sideSeed);
		const d = Math.abs(dx);
		if (d >= w) return;
		const z = d / w;
		const tip = t > 0.8;
		if (z < 0.42 && t < 0.58) put(img, x, y, L.white, A.full);
		else if (z < 0.74) put(img, x, y, L.hot, tip ? A.mid : A.hi);
		else put(img, x, y, L.light, tip ? A.lo : A.mid);
	};
	const side = Math.sin(ph) >= 0 ? 1 : -1;
	eachPixel(img, (x, y) => {
		tongue(x, y, P.cx, height, 1, 0);
		tongue(x, y, P.cx + side * 3.5, height * (0.42 + 0.12 * Math.cos(2 * ph)), 0.5, 2);
	});
	// a spark climbing off the tip (frames 0..4, until it leaves the canvas), gone on the last frame so the loop restarts it
	const k = f % BURN_FRAMES;
	if (k < BURN_FRAMES - 1) {
		const sy = Math.round(baseY - height - 1 - 1.6 * k);
		const sx = Math.round(P.cx - 0.5 + sway(1) + (k % 2 === 0 ? 1 : -1));
		if (sy >= 1) put(img, sx, sy, L.white, k < 3 ? A.hi : A.lo); // never on the canvas edge
	}
}

/** Every strip: its file, frame size and the frame drawer. */
const STRIPS = {
	strike_flash: { w: STRIKE_SIZE, h: STRIKE_SIZE, frames: FLASH_FRAMES, draw: (img, f) => [flash0, flash1, flash2][f](img) },
	strike_scorch: { w: STRIKE_SIZE, h: STRIKE_SIZE, frames: SCORCH_FRAMES, draw: (img, f) => scorch(img, f === 0) },
	ember_burn: { w: EMBER_W, h: EMBER_H, frames: BURN_FRAMES, draw: (img, f) => burn(img, f) },
};

/** Frame `f` of strip `name` as { w, h, lum, alpha } (no range check on f for ember_burn: the seamless spec). */
function drawFrame(name, f) {
	const s = STRIPS[name];
	if (!s) throw new Error(`gen-hazard-art: no strip ${name}`);
	if (name !== "ember_burn" && !(Number.isInteger(f) && f >= 0 && f < s.frames)) throw new Error(`gen-hazard-art: ${name} frame ${f} out of range`);
	const img = blank(s.w, s.h);
	s.draw(img, f);
	return img;
}

/** The PNG bytes of strip `name` (frames side by side): RGB = the luminance, alpha the frame's. */
function renderStrip(name) {
	const s = STRIPS[name];
	const png = new PNG({ width: s.w * s.frames, height: s.h });
	for (let f = 0; f < s.frames; f++) {
		const img = drawFrame(name, f);
		for (let y = 0; y < s.h; y++) {
			for (let x = 0; x < s.w; x++) {
				const i = y * s.w + x;
				const o = (y * s.w * s.frames + f * s.w + x) * 4;
				png.data[o] = img.lum[i];
				png.data[o + 1] = img.lum[i];
				png.data[o + 2] = img.lum[i];
				png.data[o + 3] = img.alpha[i];
			}
		}
	}
	return PNG.sync.write(png, { colorType: 6 });
}

function main() {
	const out = path.resolve(process.argv[2] || path.join(__dirname, "..", "..", "art", "vendor", "kaleb-vale", "hazards"));
	fs.mkdirSync(out, { recursive: true });
	for (const name of Object.keys(STRIPS)) fs.writeFileSync(path.join(out, `${name}.png`), renderStrip(name));
	console.log(
		`gen-hazard-art: strike ${STRIKE_SIZE}x${STRIKE_SIZE} (rim ${STRIKE_R} px) flash ${FLASH_FRAMES} + scorch ${SCORCH_FRAMES}, ember ${EMBER_W}x${EMBER_H} burn ${BURN_FRAMES} -> ${path.relative(process.cwd(), out)}`,
	);
}

if (require.main === module) main();

module.exports = {
	PIXELS_PER_TILE,
	STRIKE_RADIUS_TILES,
	STRIKE_R,
	STRIKE_SIZE,
	STRIKE_PIVOT,
	FLASH_FRAMES,
	SCORCH_FRAMES,
	EMBER_W,
	EMBER_H,
	EMBER_PATCH,
	EMBER_LIT,
	EMBER_PIVOT,
	BURN_FRAMES,
	STRIPS,
	drawFrame,
	renderStrip,
};

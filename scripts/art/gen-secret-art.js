#!/usr/bin/env node
/*
 * The secret rooms' art (docs/SECRET_ROOMS.md SR11, Design 11): original pixel art drawn by code, so it needs no
 * third-party pack and no Credits entry (like gen-hazard-art.js, gen-fortune-art.js and gen-treasure-art.js).
 *
 *   node scripts/art/gen-secret-art.js [outDir]     (default art/vendor/kaleb-vale/secret)
 *
 * Greyscale (white = the tint's full colour, greys its shades), transparent elsewhere: the view tints the crack and the
 * rubble with the biome's wall colour (darkened) and the dust with `secret.dust` (ImageColor3 multiplies). TILE_PX px a
 * tile (the wall texture's density halved, 2 px for each of its 64 px tile's 4: crisp at the game camera); nothing
 * touches a canvas's outermost pixel.
 *
 *   - `secret.crack` (crack.png, CRACK_VARIANTS frames of CRACK_W x CRACK_H: a 2-cell wall face, 2 x 1 tiles): the crack
 *     overlay the view lays on the wall face and its top. Three variants (the frames of its `idle`, never played): a
 *     SPLIT (a jagged fracture running down across both cells, two branches), an IMPACT (a star of rays from a spalled pit
 *     near the middle, a half ring of hairlines) and a MORTAR crack (stepping along the course joints of a block wall).
 *     A crack is a dark core (CRACK_LUM.core), a 1 px darker edge on its trunk, a soft shadow halo either side
 *     (CRACK_LUM.halo at a low alpha: the band reads darker than the wall, never lighter) and a few chipped flakes.
 *   - `secret.rubble` (rubble.png, RUBBLE_W x RUBBLE_H, 2 x 1 tiles seen from straight above: the view lays it flat on
 *     the two opened cells): a heap of broken blocks, bigger in the middle and along the wall line (the top edge), lit
 *     from the upper left in four flat steps with a dark rim on the shadow side, pebbles round it and a faint dust bed.
 *   - `fx.secret.dust` (dust.png, DUST_FRAMES frames of DUST_W x DUST_H, played once): a thin trickle of grit falling
 *     from a joint (the top, DUST_PIVOT) down the face, grains accelerating, then a tiny puff where they land.
 *
 * Same inputs, byte-identical PNGs (no timestamps, fixed encoder options).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

/** Pixels a tile (the secret sheet's density; art/atlases.json `secret.pixelsPerTile`). */
const TILE_PX = 32;
/** The crack's cells: two wall cells wide, one tall (a wall is GAME_WORLD.wallHeightTiles 1 tile high). */
const CRACK_CELLS = 2;
const CRACK_W = CRACK_CELLS * TILE_PX;
const CRACK_H = TILE_PX;
const CRACK_PIVOT = { x: CRACK_W / 2, y: CRACK_H / 2 };
const CRACK_VARIANTS = 3;
/** The rubble: the two opened cells, seen from straight above. */
const RUBBLE_W = CRACK_CELLS * TILE_PX;
const RUBBLE_H = TILE_PX;
const RUBBLE_PIVOT = { x: RUBBLE_W / 2, y: RUBBLE_H / 2 };
/** The dust trickle: a thin strip one tile tall, the grit leaving the joint at its top centre. */
const DUST_W = 12;
const DUST_H = TILE_PX;
const DUST_PIVOT = { x: DUST_W / 2, y: 1 };
const DUST_FRAMES = 6;
const DUST_FPS = 10;

/** Flat levels (pixel art: no smooth gradients). Crack: core, its darker trunk edge, flakes, the shadow halo. */
const CRACK_LUM = { core: 30, edge: 70, flake: 90, halo: 150 };
const CRACK_ALPHA = { core: 255, edge: 235, flake: 220, halo: 90, hair: 200 };
/** The rubble's four lit steps (lit side to shadow side), its rim, its pebbles, its dust bed. */
const STONE = [255, 214, 170, 124];
const RUBBLE_LUM = { rim: 64, crevice: 92, pebble: 190, bed: 225 };
const RUBBLE_ALPHA = { stone: 255, pebble: 235, bed: 70 };
const DUST = { grain: 255, trail: 235, puff: 245 };
const DUST_ALPHA = { grain: 235, trail: 130, puff: 120, puffEdge: 70 };

/** A blank canvas: per-pixel luminance and alpha. */
function blank(w, h) {
	return { w, h, lum: new Uint8Array(w * h), alpha: new Uint8Array(w * h) };
}
/** Inside the canvas and off its outermost pixel ring (nothing is drawn there). */
function inside(img, x, y) {
	return x >= 1 && y >= 1 && x < img.w - 1 && y < img.h - 1;
}
/** Keeps the more opaque (then the darker) of what is there and (lum, alpha): a crack darkens what it crosses. */
function putDark(img, x, y, lum, alpha) {
	if (!inside(img, x, y)) return;
	const i = y * img.w + x;
	if (alpha > img.alpha[i] || (alpha === img.alpha[i] && lum < img.lum[i])) {
		img.alpha[i] = alpha;
		img.lum[i] = lum;
	}
}
/** Keeps the more opaque (then the brighter) of what is there and (lum, alpha): dust and pebbles. */
function putLight(img, x, y, lum, alpha) {
	if (!inside(img, x, y)) return;
	const i = y * img.w + x;
	if (alpha > img.alpha[i] || (alpha === img.alpha[i] && lum > img.lum[i])) {
		img.alpha[i] = alpha;
		img.lum[i] = lum;
	}
}
/** Overwrites (lum, alpha): a stone drawn over the stones behind it. */
function set(img, x, y, lum, alpha) {
	if (!inside(img, x, y)) return;
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

/** The pixels of a 1 px line from (x0, y0) to (x1, y1) (Bresenham on rounded ends), in order. */
function linePixels(x0, y0, x1, y1) {
	const out = [];
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
		out.push([ax, ay]);
		if (ax === bx && ay === by) return out;
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

/**
 * A jagged path from (x0, y0) to (x1, y1): vertices every `step` px along it, each pushed sideways by up to `jag` px
 * (seeded). Returns the vertices.
 */
function jagged(seed, x0, y0, x1, y1, step, jag) {
	const len = Math.hypot(x1 - x0, y1 - y0);
	const n = Math.max(1, Math.round(len / step));
	const nx = -(y1 - y0) / len;
	const ny = (x1 - x0) / len;
	const pts = [];
	for (let k = 0; k <= n; k++) {
		const t = k / n;
		const side = k === 0 || k === n ? 0 : (hash2(seed, k) * 2 - 1) * jag;
		pts.push([x0 + (x1 - x0) * t + nx * side, y0 + (y1 - y0) * t + ny * side]);
	}
	return pts;
}

/** Every pixel of a polyline, in order, without repeats at the joins. */
function pathPixels(pts) {
	const out = [];
	for (let i = 0; i + 1 < pts.length; i++) {
		const seg = linePixels(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
		for (let k = i === 0 ? 0 : 1; k < seg.length; k++) out.push(seg[k]);
	}
	return out;
}

/**
 * Draws a crack along `pts`: the shadow halo first (the 8 neighbours of every core pixel, faint), then the core; with
 * `trunk` the core is 2 px wide (the pixel below each core pixel at the edge level) over its first `trunk` share.
 */
function crack(img, pts, trunk = 0) {
	const px = pathPixels(pts);
	for (const [x, y] of px) {
		for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) putDark(img, x + dx, y + dy, CRACK_LUM.halo, CRACK_ALPHA.halo);
	}
	px.forEach(([x, y], k) => {
		putDark(img, x, y, CRACK_LUM.core, CRACK_ALPHA.core);
		if (trunk > 0 && k < px.length * trunk) putDark(img, x + 1, y, CRACK_LUM.edge, CRACK_ALPHA.edge);
	});
}

/** A hairline: a 1 px fracture with no halo (fine branches at a crack's ends). */
function hairline(img, pts) {
	for (const [x, y] of pathPixels(pts)) putDark(img, x, y, CRACK_LUM.edge, CRACK_ALPHA.hair);
}

/** A chipped flake: a small irregular dark blob at (cx, cy), radius r (seeded edge). */
function flake(img, seed, cx, cy, r) {
	for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
		for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
			const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
			const edge = r * (0.75 + 0.5 * hash2(seed, x * 31 + y));
			if (d <= edge) putDark(img, x, y, d <= edge * 0.5 ? CRACK_LUM.core : CRACK_LUM.flake, CRACK_ALPHA.flake);
		}
	}
}

/** The point a share `t` along polyline `pts` (by vertex count: enough for branching). */
function along(pts, t) {
	const i = Math.min(pts.length - 1, Math.max(0, Math.round(t * (pts.length - 1))));
	return pts[i];
}

/** Variant 0, SPLIT: a fracture down across both cells, two branches and hairline ends. */
function crackSplit(img) {
	const main = jagged(11, 24, 2, 41, CRACK_H - 3, 3, 2.6);
	crack(img, main, 0.55);
	const a = along(main, 0.35);
	const b1 = jagged(12, a[0], a[1], a[0] - 14, a[1] + 11, 3, 1.8);
	crack(img, b1);
	hairline(img, jagged(13, b1[b1.length - 1][0], b1[b1.length - 1][1], b1[b1.length - 1][0] - 5, CRACK_H - 3, 2, 1));
	const c = along(main, 0.6);
	const b2 = jagged(14, c[0], c[1], c[0] + 15, c[1] - 6, 3, 1.6);
	crack(img, b2);
	hairline(img, jagged(15, b2[b2.length - 1][0], b2[b2.length - 1][1], b2[b2.length - 1][0] + 6, 3, 2, 1));
	hairline(img, jagged(16, 24, 2, 20, 6, 2, 0.8));
	flake(img, 17, a[0] + 1, a[1], 1.6);
	flake(img, 18, 41, CRACK_H - 5, 1.2);
}

/** Variant 1, IMPACT: rays from a spalled pit left of the middle, a half ring of hairlines round it. */
function crackImpact(img) {
	const cx = 29;
	const cy = 15;
	// [angle (0 = right, y down), length px, a full crack (else a hairline)]
	const rays = [
		[-0.2, 24, true],
		[0.75, 12, false],
		[1.45, 13, true],
		[2.35, 12, false],
		[3.1, 20, true],
		[4.0, 11, false],
		[4.85, 12, true],
	];
	rays.forEach(([ang, len, full], k) => {
		const ex = cx + Math.cos(ang) * len;
		const ey = cy + Math.sin(ang) * len * 0.85;
		const pts = jagged(30 + k, cx, cy, ex, ey, 3, 1.2);
		if (full) crack(img, pts, 0.4);
		else hairline(img, pts);
	});
	// the half ring: four short hairlines across the rays below the pit (the pressure ring)
	for (let k = 0; k < 4; k++) {
		const a0 = 0.35 + k * 0.62;
		const a1 = a0 + 0.32;
		const r = 9 + hash2(40, k) * 1.5;
		hairline(img, [
			[cx + Math.cos(a0) * r, cy + Math.sin(a0) * r * 0.85],
			[cx + Math.cos(a1) * r, cy + Math.sin(a1) * r * 0.85],
		]);
	}
	flake(img, 41, cx, cy, 2.6);
	flake(img, 42, cx + 5, cy - 2, 1.1);
	flake(img, 43, cx - 4, cy + 3, 1.2);
}

/** Variant 2, MORTAR: stepping along a block wall's course joints (rows every 10 px, heads staggered), hairline offshoots. */
function crackMortar(img) {
	// course joints at y 10 and 21; head joints at x 22 (top course), 34 (middle), 46 (bottom)
	const pts = [
		[14, 2],
		[16, 6],
		[15, 10],
		[22, 10],
		[23, 15],
		[22, 21],
		[34, 21],
		[35, 25],
		[34, CRACK_H - 3],
	];
	// soften the straight runs a little (a crack, not a drawn grid)
	const soft = [];
	for (let i = 0; i + 1 < pts.length; i++) {
		const seg = jagged(50 + i, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 3, 0.7);
		for (let k = i === 0 ? 0 : 1; k < seg.length; k++) soft.push(seg[k]);
	}
	crack(img, soft, 0.5);
	// a second, finer step run on the right cell
	const right = [
		[46, 3],
		[47, 10],
		[53, 10],
		[52, 16],
	];
	const rsoft = [];
	for (let i = 0; i + 1 < right.length; i++) {
		const seg = jagged(60 + i, right[i][0], right[i][1], right[i + 1][0], right[i + 1][1], 3, 0.6);
		for (let k = i === 0 ? 0 : 1; k < seg.length; k++) rsoft.push(seg[k]);
	}
	crack(img, rsoft);
	hairline(img, jagged(64, 34, 21, 46, 18, 2, 1));
	hairline(img, jagged(65, 22, 15, 12, 20, 2, 1));
	flake(img, 66, 22, 10, 1.5);
	flake(img, 67, 34, 21, 1.8);
	flake(img, 68, 47, 10, 1.1);
}

const CRACK_DRAW = [crackSplit, crackImpact, crackMortar];

/** A rubble stone: an irregular polygon of `n` vertices round (cx, cy), radii rx / ry (seeded). */
function stoneShape(seed, cx, cy, rx, ry, n) {
	const pts = [];
	const turn = hash2(seed, 99) * Math.PI * 2;
	for (let k = 0; k < n; k++) {
		const a = turn + (k / n) * Math.PI * 2;
		const r = 0.7 + 0.45 * hash2(seed, k);
		pts.push([cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r]);
	}
	return pts;
}
/** Is (x, y) inside polygon `pts` (even-odd)? */
function inPolygon(pts, x, y) {
	let inn = false;
	for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
		const [xi, yi] = pts[i];
		const [xj, yj] = pts[j];
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inn = !inn;
	}
	return inn;
}
/** Draws one stone: four flat lit steps by the facet's side (upper left lit), a dark rim on its lower right. */
function stone(img, seed, cx, cy, rx, ry) {
	const pts = stoneShape(seed, cx, cy, rx, ry, 6 + Math.floor(hash2(seed, 7) * 3));
	const x0 = Math.floor(cx - rx * 1.2) - 1;
	const x1 = Math.ceil(cx + rx * 1.2) + 1;
	const y0 = Math.floor(cy - ry * 1.2) - 1;
	const y1 = Math.ceil(cy + ry * 1.2) + 1;
	const mask = (x, y) => inPolygon(pts, x + 0.5, y + 0.5);
	for (let y = y0; y <= y1; y++) {
		for (let x = x0; x <= x1; x++) {
			if (!mask(x, y)) continue;
			// the shadow-side rim: an outside pixel to the right or below
			if (!mask(x + 1, y) || !mask(x, y + 1)) {
				set(img, x, y, RUBBLE_LUM.rim, RUBBLE_ALPHA.stone);
				continue;
			}
			// the facet: which way this pixel faces from the stone's centre (upper left = lit), in four steps
			const fx = (x + 0.5 - cx) / rx;
			const fy = (y + 0.5 - cy) / ry;
			const lit = -(fx + fy) * 0.5 + (hash2(seed, x * 17 + y * 5) - 0.5) * 0.2;
			const step = lit > 0.35 ? 0 : lit > 0 ? 1 : lit > -0.35 ? 2 : 3;
			set(img, x, y, STONE[step], RUBBLE_ALPHA.stone);
		}
	}
}

/** The rubble heap (see the file comment). */
function rubble(img) {
	// the dust bed: a faint ellipse grounding the heap
	const bx = RUBBLE_W / 2;
	const by = RUBBLE_H / 2;
	for (let y = 1; y < RUBBLE_H - 1; y++) {
		for (let x = 1; x < RUBBLE_W - 1; x++) {
			const d = ((x + 0.5 - bx) / (bx - 2)) ** 2 + ((y + 0.5 - by) / (by - 2)) ** 2;
			if (d <= 1 && hash2(70, x * 61 + y) < 0.85 - d * 0.4) putLight(img, x, y, RUBBLE_LUM.bed, RUBBLE_ALPHA.bed);
		}
	}
	// stones, back (the wall line, top) to front, big in the middle; each overwrites the ones behind it
	const stones = [];
	let k = 0;
	for (let row = 0; row < 4; row++) {
		const cy = 6 + row * 6.2;
		const span = row === 0 ? 22 : row === 3 ? 19 : 26;
		const count = row === 0 || row === 3 ? 4 : 5;
		for (let c = 0; c < count; c++) {
			const t = count === 1 ? 0.5 : c / (count - 1);
			const cx = bx - span + 2 * span * t + (hash2(80 + row, c) - 0.5) * 5;
			const mid = 1 - Math.abs(t - 0.5) * 1.4;
			const big = row === 0 || row === 1 ? 1.15 : 0.95;
			const rx = (2.4 + 4.4 * mid * big) * (0.8 + 0.4 * hash2(90 + row, c));
			const ry = rx * (0.62 + 0.25 * hash2(100 + row, c));
			stones.push({ seed: 200 + k++, cx, cy: cy + (hash2(110 + row, c) - 0.5) * 2.5, rx, ry });
		}
	}
	for (const s of stones) stone(img, s.seed, s.cx, s.cy, s.rx, s.ry);
	// crevices: a dark pixel where two stones meet (a rim pixel with lit stone on both sides horizontally)
	for (let y = 1; y < RUBBLE_H - 1; y++) {
		for (let x = 2; x < RUBBLE_W - 2; x++) {
			const i = y * img.w + x;
			if (img.lum[i] !== RUBBLE_LUM.rim) continue;
			const l = img.lum[i - 1];
			const r = img.lum[i + 1];
			if (l >= STONE[1] && r >= STONE[2] && img.alpha[i - 1] === 255 && img.alpha[i + 1] === 255) img.lum[i] = RUBBLE_LUM.crevice;
		}
	}
	// pebbles round the heap
	for (let p = 0; p < 26; p++) {
		const a = hash2(120, p) * Math.PI * 2;
		const r = 0.72 + 0.3 * hash2(121, p);
		const x = Math.round(bx + Math.cos(a) * (bx - 3) * r);
		const y = Math.round(by + Math.sin(a) * (by - 3) * r);
		const i = y * img.w + x;
		if (!inside(img, x, y) || img.alpha[i] === 255) continue;
		putLight(img, x, y, RUBBLE_LUM.pebble, RUBBLE_ALPHA.pebble);
		if (hash2(122, p) < 0.4) putLight(img, x + 1, y, RUBBLE_LUM.rim, RUBBLE_ALPHA.pebble);
	}
}

/** Frame `f` of the dust trickle: grains leaving the joint at staggered times, falling faster, a puff where they land. */
function dust(img, f) {
	const cx = Math.floor(DUST_PIVOT.x);
	const floorY = DUST_H - 3;
	// grain g leaves the joint at frame starts[g]; its fall after t frames: 1 + 2.6 t^2 px (accelerating)
	const starts = [0, 0.5, 1, 1.6, 2.2];
	starts.forEach((s, g) => {
		const t = f - s;
		if (t < 0) return;
		const y = Math.round(DUST_PIVOT.y + 1 + 2.6 * t * t);
		if (y >= floorY) return;
		const x = cx + (g % 2 === 0 ? 0 : g % 4 === 1 ? -1 : 1);
		putLight(img, x, y, DUST.grain, DUST_ALPHA.grain);
		// a short streak above a falling grain (motion), longer as it speeds up
		const trail = Math.min(4, Math.floor(t * 1.5));
		for (let k = 1; k <= trail; k++) putLight(img, x, y - k, DUST.trail, DUST_ALPHA.trail);
	});
	// the joint itself sheds a speck in the first frames
	if (f <= 2) putLight(img, cx, DUST_PIVOT.y + 1, DUST.trail, DUST_ALPHA.trail);
	// the puff: from frame 3, grit spreading where the grains land
	if (f >= 3) {
		const spread = f - 2;
		for (let dx = -spread; dx <= spread; dx++) {
			const edge = Math.abs(dx) === spread;
			putLight(img, cx + dx, floorY, DUST.puff, edge ? DUST_ALPHA.puffEdge : DUST_ALPHA.puff);
			if (!edge && Math.abs(dx) < spread - 1) putLight(img, cx + dx, floorY - 1, DUST.puff, DUST_ALPHA.puffEdge);
		}
		if (f === DUST_FRAMES - 1) {
			for (const dx of [-spread - 1, spread + 1]) putLight(img, cx + dx, floorY - 2, DUST.puff, DUST_ALPHA.puffEdge);
		}
	}
}

/** Every strip: its frame size, frame count and the frame drawer. */
const STRIPS = {
	crack: { w: CRACK_W, h: CRACK_H, frames: CRACK_VARIANTS, draw: (img, f) => CRACK_DRAW[f](img) },
	rubble: { w: RUBBLE_W, h: RUBBLE_H, frames: 1, draw: (img) => rubble(img) },
	dust: { w: DUST_W, h: DUST_H, frames: DUST_FRAMES, draw: (img, f) => dust(img, f) },
};

/** Frame `f` of strip `name` as { w, h, lum, alpha }. */
function drawFrame(name, f) {
	const s = STRIPS[name];
	if (!s) throw new Error(`gen-secret-art: no strip ${name}`);
	if (!(Number.isInteger(f) && f >= 0 && f < s.frames)) throw new Error(`gen-secret-art: ${name} frame ${f} out of range`);
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
	const out = path.resolve(process.argv[2] || path.join(__dirname, "..", "..", "art", "vendor", "kaleb-vale", "secret"));
	fs.mkdirSync(out, { recursive: true });
	for (const name of Object.keys(STRIPS)) fs.writeFileSync(path.join(out, `${name}.png`), renderStrip(name));
	console.log(
		`gen-secret-art: crack ${CRACK_W}x${CRACK_H} x ${CRACK_VARIANTS} variants, rubble ${RUBBLE_W}x${RUBBLE_H}, dust ${DUST_W}x${DUST_H} x ${DUST_FRAMES} -> ${path.relative(process.cwd(), out)}`,
	);
}

if (require.main === module) main();

module.exports = {
	TILE_PX,
	CRACK_CELLS,
	CRACK_W,
	CRACK_H,
	CRACK_PIVOT,
	CRACK_VARIANTS,
	CRACK_LUM,
	RUBBLE_W,
	RUBBLE_H,
	RUBBLE_PIVOT,
	DUST_W,
	DUST_H,
	DUST_PIVOT,
	DUST_FRAMES,
	DUST_FPS,
	STONE,
	STRIPS,
	drawFrame,
	renderStrip,
};

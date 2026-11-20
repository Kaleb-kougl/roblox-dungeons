#!/usr/bin/env node
/*
 * The boost auras (docs/BOOST_ART.md BAD3, supersedes BA-P5's tinted Lords of Pain ring): original pixel-art floor
 * rings drawn by code, one design per boost kind, so they need no third-party pack. Fury a ring of fire whose flame
 * front licks outward with embers rising off it; Quickstep three comets racing round a faint ring; Frenzy six curved
 * blades whirling off the ring; Aegis six shield plates with a glint sweeping round them. Greyscale (white = the tint's
 * full colour, greys its shades): the renderer tints each with its `boost.<kind>` colour role (ImageColor3
 * multiplies), like the loot glint. Each is drawn as a true circle seen from straight above; the game camera
 * foreshortens it on the floor like the Neon disc it replaces.
 *
 *   node scripts/art/gen-boost-auras.js [outDir]     (default art/vendor/kaleb-vale/boost-auras)
 *
 * Writes aura_<kind>_r<rank>_<frame>.png: every kind at every stack rank 0..RANKS - 1 (BoostAuraController draws the
 * first running boost innermost, each further one BOOST_VIEW.auraRingStepTiles wider), FRAMES frames each, a seamless
 * loop. Each rank is drawn natively (never a scaled copy): its ring radius is RING_PX[rank] = round((RADIUS_TILES +
 * rank * STEP_TILES) * PIXELS_PER_TILE) px (16, 20, 25, 29), on a square canvas canvasOf(rank) = 2 * (RING_PX[rank] +
 * MARGIN) + 1 px (odd: the ring's centre is the centre pixel) that holds the flame tips and the embers. Motif counts
 * are the same at every rank; pixel-sized details (plate gaps, the glint, the comet heads' and blades' edges) keep
 * their size in px, so a wider ring has longer arcs, not fatter pixels. Same inputs, byte-identical PNGs (no
 * timestamps, fixed encoder options); art:build and art:lock run it before packing (art/atlases.json `boostAuras`).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

/** The kinds, in BOOST_KINDS order (shared/theme contract/ids.ts). */
const KIND_NAMES = ["fury", "quickstep", "frenzy", "aegis"];
/**
 * Ring geometry, mirroring shared/view BOOST_VIEW (auraRadiusTiles 0.55, auraRingStepTiles 0.14) at the vale props'
 * 29.6 px a tile (the swarmer's pixelsPerTile); boostAuras.spec.ts pins the generated layout's ring px against them.
 */
const RADIUS_TILES = 0.55;
const STEP_TILES = 0.14;
const PIXELS_PER_TILE = 29.6;
/** Stack ranks drawn (four boost kinds: at most four rings at once). */
const RANKS = 4;
/** Ring radius in art px per rank: 16, 20, 25, 29. */
const RING_PX = Array.from({ length: RANKS }, (_, r) => Math.round((RADIUS_TILES + r * STEP_TILES) * PIXELS_PER_TILE));
/** Canvas margin beyond the ring, px: the flame tips reach R + 7.8, the embers R + 10.6 (+ rounding). */
const MARGIN = 12;
/** Frames per loop (seamless: frame FRAMES would equal frame 0). */
const FRAMES = 8;
/** The rank-0 ring the draft was drawn at: pixel-sized details scale by BASE_R / R so they keep their px size. */
const BASE_R = 16;
const TAU = Math.PI * 2;

/** Flat levels (pixel art: no smooth gradients). */
const L = { white: 255, light: 210, mid: 160, dark: 110 };
const A = { full: 255, hi: 220, mid: 165, lo: 110, faint: 60 };

/** Canvas side of rank `rank`, px (odd). */
function canvasOf(rank) {
	return 2 * (RING_PX[rank] + MARGIN) + 1;
}

/** A blank frame: per-pixel luminance and alpha, `size` square, centre pixel `c`. */
function blank(size) {
	return { size, c: (size - 1) / 2, lum: new Uint8Array(size * size), alpha: new Uint8Array(size * size) };
}
/** Keeps the more opaque (then the brighter) of what is there and (lum, alpha). */
function put(img, x, y, lum, alpha) {
	if (x < 0 || y < 0 || x >= img.size || y >= img.size) return;
	const i = y * img.size + x;
	if (alpha > img.alpha[i] || (alpha === img.alpha[i] && lum > img.lum[i])) {
		img.alpha[i] = alpha;
		img.lum[i] = lum;
	}
}
/** Polar coordinates of a pixel's centre: radius and angle (0 = screen right, counter-clockwise, 0..TAU). */
function polar(img, x, y) {
	const dx = x - img.c;
	const dy = img.c - y;
	let a = Math.atan2(dy, dx);
	if (a < 0) a += TAU;
	return { r: Math.hypot(dx, dy), a };
}
/** Smallest angular distance between two angles. */
function angDist(a, b) {
	const d = Math.abs(a - b) % TAU;
	return d > Math.PI ? TAU - d : d;
}
/** Signed angular offset of a from b in (-PI, PI]. */
function angOff(a, b) {
	let d = (a - b) % TAU;
	if (d > Math.PI) d -= TAU;
	if (d <= -Math.PI) d += TAU;
	return d;
}
function eachPixel(img, fn) {
	for (let y = 0; y < img.size; y++) for (let x = 0; x < img.size; x++) fn(x, y, polar(img, x, y));
}
/** A deterministic hash in [0, 1). */
function hash(n) {
	let h = (n * 2654435761) >>> 0;
	h ^= h >>> 15;
	h = Math.imul(h, 2246822519) >>> 0;
	h ^= h >>> 13;
	return (h >>> 0) / 4294967296;
}

// Fury: a ring of fire, its flame front licking outward and flickering, embers rising off it.
function fury(img, R, f) {
	const ph = (f / FRAMES) * TAU; // one loop: every term below repeats after FRAMES frames
	eachPixel(img, (x, y, p) => {
		// the burning band: bright inner edge, white core
		if (p.r >= R - 1.5 && p.r < R - 0.5) put(img, x, y, L.light, A.hi);
		if (p.r >= R - 0.5 && p.r < R + 0.5) put(img, x, y, L.white, A.full);
		// the flame front above the band: two waves travelling opposite ways plus a fast flicker
		const h =
			1.4 +
			3.2 * Math.max(0, Math.sin(9 * p.a - ph)) +
			1.8 * Math.max(0, Math.sin(5 * p.a + 2 * ph + 1.3)) +
			0.9 * Math.max(0, Math.sin(17 * p.a - 3 * ph + 0.4));
		const t = (p.r - (R + 0.5)) / h; // 0 at the band, 1 at the tip
		if (t < 0 || t >= 1) return;
		if (t < 0.3) put(img, x, y, L.white, A.full);
		else if (t < 0.6) put(img, x, y, L.light, A.hi);
		else put(img, x, y, L.mid, A.mid);
	});
	// embers: single pixels rising off the front, each on its own loop
	for (let e = 0; e < 6; e++) {
		const a = hash(e * 97 + 7) * TAU;
		const step = (f + e * 3) % FRAMES;
		const r = R + 4 + step * 1.1;
		if (step >= FRAMES - 1) continue;
		put(img, Math.round(img.c + Math.cos(a) * r), Math.round(img.c - Math.sin(a) * r), L.white, step > 4 ? A.lo : A.mid);
	}
}

// Quickstep: three comets racing round a faint ring, long fading tails.
function quickstep(img, R, f) {
	const comets = 3;
	const tail = TAU * 0.24;
	const lead = (0.06 * BASE_R) / R; // the head's leading edge, a px-sized angle
	const head = (f / FRAMES) * (TAU / comets); // one comet spacing per loop: seamless
	eachPixel(img, (x, y, p) => {
		if (p.r >= R - 0.5 && p.r < R + 0.5) put(img, x, y, L.mid, A.faint);
		for (let c = 0; c < comets; c++) {
			const h = head + (c / comets) * TAU;
			// behind the head (the tail trails it)
			const back = angOff(p.a, h);
			if (back < -lead || back > tail) continue;
			const t = Math.max(0, back) / tail; // 0 head .. 1 tail end
			const thick = t < 0.15 ? 1.5 : t < 0.5 ? 1.0 : 0.5;
			if (Math.abs(p.r - R) >= thick) continue;
			if (t < 0.15) put(img, x, y, L.white, A.full);
			else if (t < 0.4) put(img, x, y, L.light, A.hi);
			else if (t < 0.7) put(img, x, y, L.mid, A.mid);
			else put(img, x, y, L.mid, A.lo);
		}
		// speed lines: short streaks just outside the ring, ahead of each head
		for (let c = 0; c < comets; c++) {
			const h = head + (c / comets) * TAU + TAU * 0.08;
			const back = angOff(p.a, h);
			if (back >= 0 && back < TAU * 0.07 && p.r >= R + 2.5 && p.r < R + 3.5) put(img, x, y, L.light, A.lo);
		}
	});
}

// Frenzy: a whirl of six curved blades sweeping off the ring, spinning fast, a bright pair chasing round.
function frenzy(img, R, f) {
	const N = 6;
	const spin = (f / FRAMES) * (TAU / N) * 2; // two blade spacings per loop: a fast whirl (clockwise)
	const edge = (0.05 * BASE_R) / R; // the blade's second stroke, a px-sized angle
	eachPixel(img, (x, y, p) => {
		if (p.r >= R - 0.5 && p.r < R + 0.5) put(img, x, y, L.light, A.mid);
	});
	// The bright pair moves one blade on most frames: floor(7f / 8) steps 7 times a loop, so after the loop's two-blade
	// spin it lands on the blades frame 0 lit (7 = -2 mod 3): seamless.
	const chase = Math.floor((7 * f) / FRAMES);
	for (let k = 0; k < N; k++) {
		const a = (k / N) * TAU - spin;
		const bright = (k + chase) % 3 === 0;
		for (let t = 0; t <= 1; t += 0.02) {
			// a blade: leaves the ring and sweeps outward, curling back against the spin
			const r = R - 0.5 + 6.5 * t;
			const ang = a + 0.75 * t * t;
			const thick = t < 0.55 ? 1 : 0;
			for (let w = 0; w <= thick; w++) {
				const rr = r - w * 0.9;
				const px = img.c + Math.cos(ang + w * edge) * rr;
				const py = img.c - Math.sin(ang + w * edge) * rr;
				const tip = t > 0.7;
				const lum = bright ? L.white : tip ? L.mid : L.light;
				const alpha = bright ? (tip ? A.hi : A.full) : tip ? A.lo : A.hi;
				put(img, Math.round(px), Math.round(py), lum, alpha);
			}
		}
	}
}

// Aegis: six shield plates with gaps, a rim highlight and a glint sweeping round.
function aegis(img, R, f) {
	const N = 6;
	const gap = (0.09 * BASE_R) / R; // half-gap, a px-sized angle (the gaps stay ~3 px at every rank)
	const glintHalf = (0.22 * BASE_R) / R; // the glint's half-width, likewise
	const glint = (f / FRAMES) * TAU;
	eachPixel(img, (x, y, p) => {
		if (p.r < R - 2.5 || p.r >= R + 1.5) return;
		const seg = ((p.a + TAU / N / 2) % TAU) / (TAU / N);
		const within = (seg - Math.floor(seg)) * (TAU / N); // radians into the plate
		if (within < gap || within > TAU / N - gap) return;
		const outer = p.r >= R + 0.5;
		const inner = p.r < R - 1.5;
		const g = angDist(p.a, glint);
		if (g < glintHalf) put(img, x, y, L.white, A.full);
		else if (outer) put(img, x, y, L.white, A.hi);
		else if (inner) put(img, x, y, L.dark, A.mid);
		else put(img, x, y, L.light, A.hi);
	});
	// rivets: a pixel at each plate's centre
	for (let k = 0; k < N; k++) {
		const a = (k / N) * TAU;
		put(img, Math.round(img.c + Math.cos(a) * (R - 1)), Math.round(img.c - Math.sin(a) * (R - 1)), L.white, A.full);
	}
}

const DRAW = { fury, quickstep, frenzy, aegis };

/** Kind `kind`'s frame `f` at rank `rank` as { size, c, lum, alpha } (luminance and alpha per pixel). */
function drawFrame(kind, rank, f) {
	if (!DRAW[kind]) throw new Error(`gen-boost-auras: no kind ${kind}`);
	if (!(rank >= 0 && rank < RANKS) || !(f >= 0 && f < FRAMES)) throw new Error(`gen-boost-auras: rank ${rank} / frame ${f} out of range`);
	const img = blank(canvasOf(rank));
	DRAW[kind](img, RING_PX[rank], f);
	return img;
}

/** The PNG bytes of drawFrame(kind, rank, f): RGB = the luminance, alpha the frame's. */
function renderFrame(kind, rank, f) {
	const img = drawFrame(kind, rank, f);
	const png = new PNG({ width: img.size, height: img.size });
	for (let i = 0; i < img.size * img.size; i++) {
		png.data[i * 4] = img.lum[i];
		png.data[i * 4 + 1] = img.lum[i];
		png.data[i * 4 + 2] = img.lum[i];
		png.data[i * 4 + 3] = img.alpha[i];
	}
	return PNG.sync.write(png, { colorType: 6 });
}

/** File name of a frame (art/atlases.json `boostAuras` sets read aura_<kind>_r{r}_{f}.png). */
function fileName(kind, rank, f) {
	return `aura_${kind}_r${rank}_${f}.png`;
}

function main() {
	const out = path.resolve(process.argv[2] || path.join(__dirname, "..", "..", "art", "vendor", "kaleb-vale", "boost-auras"));
	fs.mkdirSync(out, { recursive: true });
	for (const kind of KIND_NAMES) {
		for (let r = 0; r < RANKS; r++) for (let f = 0; f < FRAMES; f++) fs.writeFileSync(path.join(out, fileName(kind, r, f)), renderFrame(kind, r, f));
	}
	console.log(
		`gen-boost-auras: ${KIND_NAMES.length} kinds x ${RANKS} ranks (ring ${RING_PX.join(" / ")} px, canvas ${RING_PX.map((_, r) => canvasOf(r)).join(" / ")}) x ${FRAMES} frames -> ${path.relative(process.cwd(), out)}`,
	);
}

if (require.main === module) main();

/**
 * Frame `f` of `kind` at rank `rank` WITHOUT the range check (any integer f), for the seamless-loop spec: frame FRAMES
 * must draw exactly frame 0.
 */
function drawUnchecked(kind, rank, f) {
	const img = blank(canvasOf(rank));
	DRAW[kind](img, RING_PX[rank], f);
	return img;
}

module.exports = {
	KIND_NAMES,
	RANKS,
	RING_PX,
	MARGIN,
	FRAMES,
	PIXELS_PER_TILE,
	RADIUS_TILES,
	STEP_TILES,
	canvasOf,
	drawFrame,
	drawUnchecked,
	renderFrame,
	fileName,
};

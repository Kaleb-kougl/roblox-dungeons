#!/usr/bin/env node
/*
 * The grave art (docs/DECOR.md "Graves"): five ORIGINAL gravestones drawn by code in the style of the Lords of Pain
 * props (pre-rendered 3D, soft-shaded, dark warm stone, lit from the camera's upper left), so the decor kind `grave`
 * (the Dungeon Forge's grim graveyard rooms: standing on far-wall tops, DECOR_BOX.grave) needs no third-party pack.
 *
 *   node scripts/art/gen-grave-art.js [outDir]     (default art/vendor/kaleb-vale)
 *
 * Each stone is modelled in tiles as a signed distance field about its cell's centre (z up) and rendered with the game
 * camera exactly as render_kit.py, gen-treasure-art.js and gen-fortune-art.js project their props (orthographic, 55
 * degrees down, azimuth -45, TILE_PX px a tile), but the way render_kit.py renders a 3D kit rather than as crisp pixel
 * art: SUPER x SUPER rays per pixel averaged (premultiplied), so the edges are soft and the shading continuous, a sun
 * from the camera's upper left with cast self-shadows plus a dim ambient, and the result graded into the Lords of Pain
 * stone's range (STONE_GRADE: their columns' body is RGB ~34 / 27 / 26 mean, warm in the darks, neutral grey on top).
 * Every stone faces the camera (turned to azimuth -45 + 180), so one image serves a far wall of either axis: the decor
 * plan picks a grave's variant by cell hash, not by its wall.
 *
 * The looks (GRAVES, variants 1-5 in this order): a round-topped headstone on a plinth with a carved cross and epitaph
 * lines; a stone cross on a stepped base; a cracked slab sunk into the ground, leaning, its corner broken off; a small
 * obelisk on a plinth; an arched headstone with a skull in relief, moss on its shoulders and foot.
 * Writes grave/grave_<look>.png, each cropped to its body with a GRAVE_MARGIN px clear margin (the atlas pipeline's
 * `pivot: "bottom"` finds the foot).
 *
 * Same inputs, byte-identical PNGs (no Math.random, no timestamps, fixed encoder options).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

// --- the camera (scripts/art/kit/render_kit.py, the same as gen-fortune-art.js) --------------------------------------
const TILE_PX = 29.6;
const PITCH_DEG = 55;
const AZ_DEG = -45;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (e0, e1, v) => {
	const t = clamp((v - e0) / (e1 - e0), 0, 1);
	return t * t * (3 - 2 * t);
};

function camera() {
	const el = (PITCH_DEG * Math.PI) / 180;
	const az = (AZ_DEG * Math.PI) / 180;
	const back = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
	const fwd = back.map((v) => -v);
	const right = norm(cross(fwd, [0, 0, 1]));
	const up = norm(cross(right, fwd));
	// the kit's sun: from the camera's upper left (render_kit.py sun_side 1)
	const sun = norm(add(add(scale(back, 0.6), scale(right, -0.8)), [0, 0, 1.2]));
	return { back, fwd, right, up, sun };
}

/** A stable pseudo-random in [0, 1) from integers (no Math.random: byte-identical output). */
function hash01(a, b, c = 0) {
	let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 1440662683)) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
}

/** Smooth 3D value noise in [0, 1) (trilinear over hash01 lattice values, smoothstep weights). */
function noise3(x, y, z) {
	const xi = Math.floor(x);
	const yi = Math.floor(y);
	const zi = Math.floor(z);
	const fx = x - xi;
	const fy = y - yi;
	const fz = z - zi;
	const u = fx * fx * (3 - 2 * fx);
	const v = fy * fy * (3 - 2 * fy);
	const w = fz * fz * (3 - 2 * fz);
	let s = 0;
	for (let k = 0; k < 8; k++) {
		const dx = k & 1;
		const dy = (k >> 1) & 1;
		const dz = (k >> 2) & 1;
		const wt = (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
		s += wt * hash01(xi + dx + 1000, yi + dy + 2000, zi + dz + 3000);
	}
	return s;
}

/** Fractal noise: three octaves of noise3 at `freq` cycles a tile, in [0, 1). */
function fbm(q, freq) {
	let s = 0;
	let amp = 0.5;
	let f = freq;
	for (let o = 0; o < 3; o++) {
		s += amp * noise3(q[0] * f, q[1] * f, q[2] * f);
		f *= 2.07;
		amp *= 0.5;
	}
	return s / 0.875;
}

// --- signed distance primitives (tiles) -------------------------------------------------------------------------------
/** A box of half extents b about the origin, its edges rounded by r. */
function sdBox(p, b, r = 0) {
	const qx = Math.abs(p[0]) - b[0] + r;
	const qy = Math.abs(p[1]) - b[1] + r;
	const qz = Math.abs(p[2]) - b[2] + r;
	const out = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
	return out + Math.min(Math.max(qx, qy, qz), 0) - r;
}

/** A 2D shape (signed distance d2 in the x / z plane) extruded to half depth t along y, its edges rounded by r. */
function extrude(d2, y, t, r = 0) {
	const wx = d2 + r;
	const wy = Math.abs(y) - t + r;
	return Math.min(Math.max(wx, wy), 0) + Math.hypot(Math.max(wx, 0), Math.max(wy, 0)) - r;
}

/** 2D: a rectangle of half extents (bx, bz) centred at (cx, cz). */
function sdRect2(x, z, cx, cz, bx, bz) {
	const qx = Math.abs(x - cx) - bx;
	const qz = Math.abs(z - cz) - bz;
	return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
}

/** 2D: a round-topped tablet: half width hw from z0 up to the shoulder zs, a half disc of radius hw above it. */
function sdArch2(x, z, hw, z0, zs) {
	const body = sdRect2(x, z, 0, (z0 + zs) / 2, hw, (zs - z0) / 2);
	const cap = Math.max(Math.hypot(x, z - zs) - hw, zs - z);
	return Math.min(body, cap);
}

/** Rotate (x, y) by angle a about the origin. */
function rot2(x, y, a) {
	const c = Math.cos(a);
	const s = Math.sin(a);
	return [c * x - s * y, s * x + c * y];
}

// --- the stones ---------------------------------------------------------------------------------------------------
// Local coordinates: x across the stone (screen right), y out of its face toward the camera, z up, the cell's centre
// at the origin on the floor. Every look returns { d, mat } for a local point: d the distance (< 0 inside), mat the
// material at that point ("stone", "carve" (a cut groove), "earth", "moss", "bone" (the skull's relief)).

/** Carved marks on a face: true where (x, z) lies on one of the strokes (half width hw). */
function onStroke(x, z, strokes, hw) {
	for (const [x0, z0, x1, z1] of strokes) {
		const dx = x1 - x0;
		const dz = z1 - z0;
		const t = clamp(((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz), 0, 1);
		if (Math.hypot(x - (x0 + dx * t), z - (z0 + dz * t)) < hw) return true;
	}
	return false;
}

/** The cut depth of a groove (tiles). */
const CARVE = 0.012;

const GRAVES = [
	{
		look: "rounded",
		// a round-topped headstone on a plinth: a carved cross over three epitaph lines
		sdf(p) {
			const [x, y, z] = p;
			const plinth = sdBox([x, y, z - 0.045], [0.27, 0.12, 0.045], 0.012);
			const slab = extrude(sdArch2(x, z, 0.22, 0.08, 0.6), y + 0.01, 0.055, 0.012);
			let d = Math.min(plinth, slab);
			let mat = "stone";
			if (slab <= plinth && y > 0.02) {
				const marks = [
					[0, 0.56, 0, 0.7],
					[-0.055, 0.645, 0.055, 0.645],
					[-0.13, 0.44, 0.13, 0.44],
					[-0.13, 0.36, 0.11, 0.36],
					[-0.13, 0.28, 0.07, 0.28],
				];
				if (onStroke(x, z, marks, 0.024)) {
					d += CARVE;
					mat = "carve";
				}
			}
			return { d, mat };
		},
	},
	{
		look: "cross",
		// a stone cross on a stepped base
		sdf(p) {
			const [x, y, z] = p;
			const step1 = sdBox([x, y, z - 0.04], [0.26, 0.17, 0.04], 0.01);
			const step2 = sdBox([x, y, z - 0.11], [0.18, 0.12, 0.035], 0.01);
			const shaft = sdBox([x, y, z - 0.46], [0.065, 0.06, 0.32], 0.01);
			const arms = sdBox([x, y, z - 0.6], [0.2, 0.06, 0.065], 0.01);
			const d = Math.min(step1, step2, shaft, arms);
			let mat = "stone";
			// a ring cut where the arms cross the shaft
			if (y > 0.04 && Math.abs(Math.hypot(x, z - 0.6) - 0.035) < 0.012) mat = "carve";
			return { d: mat === "carve" ? d + CARVE * 0.6 : d, mat };
		},
	},
	{
		look: "cracked",
		// a slab sunk in the ground, leaning back and to the right, its top left corner broken off, a crack down it
		sdf(p) {
			let [x, y, z] = p;
			// lean: back (about x) then right (about y), pivoting at the foot
			[y, z] = rot2(y, z, -0.22);
			[x, z] = rot2(x, z, -0.2);
			const slab = sdBox([x, y, z - 0.26], [0.2, 0.05, 0.3], 0.014);
			// the broken corner: a rough plane through the top left
			const nx = 0.78;
			const nz = 0.62;
			const rough = (fbm([x, y * 3, z], 22) - 0.5) * 0.03;
			const cut = (-x * nx + (z - 0.5) * nz) / Math.hypot(nx, nz) - 0.02 + rough;
			let d = Math.max(slab, cut);
			// a mound of earth at the foot hides the bottom
			const mound = sdBox([x, y, z], [0.26, 0.11, 0.035], 0.03);
			let mat = d < mound ? "stone" : "earth";
			d = Math.min(d, mound);
			// the crack: a jagged line from the break down to the earth
			const cx = 0.02 + (fbm([0.3, 0.7, z], 9) - 0.5) * 0.09 + (z - 0.3) * 0.1;
			if (mat === "stone" && y > 0.02 && Math.abs(x - cx) < 0.022 && z > 0.06 && z < 0.5) {
				d += CARVE * 1.4;
				mat = "carve";
			}
			return { d, mat };
		},
	},
	{
		look: "obelisk",
		// a small tapering obelisk with a pointed cap, on a plinth
		sdf(p) {
			const [x, y, z] = p;
			const plinth = sdBox([x, y, z - 0.06], [0.2, 0.2, 0.06], 0.012);
			const zb = 0.12;
			const zt = 0.82;
			const t = clamp((z - zb) / (zt - zb), 0, 1);
			const half = 0.1 - 0.035 * t;
			const shaft = sdBox([x, y, z - (zb + zt) / 2], [half, half, (zt - zb) / 2], 0.006) * 0.9;
			// the pyramidion: a four-sided point above the shaft
			const h = 0.12;
			const k = (z - zt) / h;
			const capHalf = 0.066 * (1 - k);
			const capSide = Math.max(Math.abs(x), Math.abs(y)) - capHalf;
			const cap = Math.max(capSide * 0.7, zt - z, z - (zt + h));
			const d = Math.min(plinth, shaft, cap);
			let mat = "stone";
			// a carved band below the cap
			if (shaft < plinth && Math.abs(z - 0.74) < 0.012) mat = "carve";
			return { d: mat === "carve" ? d + CARVE * 0.6 : d, mat };
		},
	},
	{
		look: "skull",
		// an arched headstone with a skull in relief, moss on its shoulders and at its foot
		sdf(p) {
			const [x, y, z] = p;
			const base = sdBox([x, y, z - 0.035], [0.25, 0.1, 0.035], 0.015);
			// a pointed arch: two circles' intersection over the body
			const hw = 0.2;
			const zs = 0.42;
			const body = sdRect2(x, z, 0, (0.06 + zs) / 2, hw, (zs - 0.06) / 2);
			const r = 0.3;
			const arch = Math.max(Math.hypot(x - (hw - r), z - zs) - r, Math.hypot(x + (hw - r), z - zs) - r, zs - z);
			let slab = extrude(Math.min(body, arch), y + 0.005, 0.06, 0.012);
			// the skull: raised from the face (cranium, jaw), its eyes and nose cut in
			let mat = "stone";
			const fx = x;
			const fz = z - 0.37;
			const cranium = Math.hypot(fx, (fz - 0.01) / 0.9) - 0.105;
			const jaw = sdRect2(fx, fz, 0, -0.1, 0.06, 0.035);
			const skull = Math.min(cranium, jaw);
			if (y > 0 && skull < 0) {
				slab -= 0.018;
				mat = "bone";
				const eye = Math.min(Math.hypot(fx - 0.045, fz + 0.01) - 0.03, Math.hypot(fx + 0.045, fz + 0.01) - 0.03);
				const nose = Math.hypot(fx, fz + 0.065) - 0.016;
				if (eye < 0 || nose < 0) {
					slab += 0.026;
					mat = "carve";
				}
			}
			const d = Math.min(base, slab);
			if (mat === "stone") {
				// moss: on top-facing parts near the shoulders and the foot, broken up by noise
				const n = fbm([x + 3, y + 5, z + 7], 9);
				const shoulder = z > 0.36 && Math.abs(x) > 0.08 && n > 0.46;
				const foot = z < 0.15 && n > 0.5;
				if (shoulder || foot) mat = "moss";
			}
			return { d, mat };
		},
	},
];

// --- rendering ------------------------------------------------------------------------------------------------------
/** Rays per pixel side (SUPER x SUPER per pixel, averaged premultiplied like render_kit.py's Lanczos reduce). */
const SUPER = 6;
/** The canvas each stone is first rendered into, px, and the pivot (the cell's centre on the floor) in it. */
const CANVAS_W = 44;
const CANVAS_H = 56;
const CANVAS_PIVOT = [22, 40];
/**
 * The stones are modelled at gravestone proportions in a 0.6 x 0.6 tile plot and drawn this much larger, to stand with
 * the Lords of Pain columns (column2's stump is ~35 px across) and fill DECOR_BOX.grave (18 x 26 render px = 33 x 48
 * art px at 29.6 px a tile) with room to spare.
 */
const GRAVE_SCALE = 1.3;
/** Clear margin round the cropped body, px (render_kit.py's). */
const GRAVE_MARGIN = 2;
/**
 * The stone's turn: its face toward the camera, turned FACE_TURN_DEG further so its sunlit left side shows (a stone square
 * to the camera reads as a flat card).
 */
const FACE_TURN_DEG = -28;
const FACE_YAW = ((AZ_DEG + 180 + FACE_TURN_DEG) * Math.PI) / 180;

/**
 * Albedo (0-1 linear-ish) per material. Stone: a warm grey-brown mottled toward a cold neutral grey by noise (the
 * Lords of Pain stone: rusty darks, grey lights), with fine grain; a groove is the stone darkened; earth a dark loam;
 * moss a muted dark olive.
 */
const STONE_WARM = [0.5, 0.36, 0.31];
const STONE_COLD = [0.55, 0.53, 0.52];
const EARTH = [0.24, 0.18, 0.14];
const MOSS = [0.3, 0.4, 0.17];
const BONE = [0.82, 0.77, 0.66];
const CARVE_DARK = 0.35;

/** Light: the sun's strength, the ambient, how much a face turned to the sky gains, and a self-shadow's leftover. */
const LIGHT = { sun: 0.78, ambient: 0.3, sky: 0.14, shadow: 0.35 };

/**
 * The Lords of Pain grade (render_kit.py's kits use saturation 0.6, brightness 0.6, contrast 1.15, tint 1.06 / 0.97 /
 * 0.92): applied to the shaded 0-1 colour, then scaled into 0-255 by `scale` so the body sits in their stone's range.
 */
const STONE_GRADE = { saturation: 0.62, contrast: 1.15, pivot: 0.42, tint: [1.06, 0.97, 0.92], scale: 128 };

function albedo(mat, q) {
	const grain = fbm(q, 26);
	if (mat === "earth") return scale(EARTH, 0.8 + 0.4 * grain);
	if (mat === "moss") return scale(MOSS, 0.75 + 0.5 * grain);
	if (mat === "bone") return scale(BONE, 0.85 + 0.3 * grain);
	const mottle = smooth(0.35, 0.7, fbm([q[0] + 11, q[1] + 13, q[2] + 17], 7));
	let c = mix(STONE_WARM, STONE_COLD, mottle);
	c = scale(c, 0.88 + 0.18 * grain);
	if (mat === "carve") c = scale(c, CARVE_DARK);
	return c;
}

/** The look's field in world coordinates (the stone turned to face the camera). */
function fieldOf(g) {
	return (w) => {
		// local +y (the stone's face) toward FACE_YAW; the model drawn GRAVE_SCALE times its modelled size
		const [lx, ly] = rot2(w[0] / GRAVE_SCALE, w[1] / GRAVE_SCALE, -FACE_YAW + Math.PI / 2);
		const r = g.sdf([-lx, -ly, w[2] / GRAVE_SCALE]);
		return { d: r.d * GRAVE_SCALE, mat: r.mat };
	};
}

/** Sphere-trace the ray o + t d (t up to tMax) against `f`; the hit point or undefined. */
function trace(f, o, d, tMax) {
	let t = 0;
	for (let i = 0; i < 400 && t < tMax; i++) {
		const q = add(o, scale(d, t));
		const s = f(q).d;
		if (s < 0.0005) return q;
		t += Math.max(s * 0.8, 0.0008);
	}
	return undefined;
}

function normalAt(f, q) {
	const e = 0.003;
	const g = (dx, dy, dz) => f([q[0] + dx, q[1] + dy, q[2] + dz]).d;
	return norm([g(e, 0, 0) - g(-e, 0, 0), g(0, e, 0) - g(0, -e, 0), g(0, 0, e) - g(0, 0, -e)]);
}

function grade(c) {
	const { saturation, contrast, pivot, tint } = STONE_GRADE;
	const l = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
	let o = mix([l, l, l], c, saturation);
	o = o.map((v) => pivot + (v - pivot) * contrast);
	return [o[0] * tint[0], o[1] * tint[1], o[2] * tint[2]];
}

/** One ray's colour (linear 0-1) and coverage. */
function sample(f, cam, u, v) {
	const o = add(add(scale(cam.right, u), scale(cam.up, v)), scale(cam.back, 3));
	const hit = trace(f, o, cam.fwd, 6);
	if (hit === undefined || hit[2] < -1e-4) return undefined;
	const { mat } = f(hit);
	const n = normalAt(f, hit);
	const lam = Math.max(0, dot(n, cam.sun));
	const lit = trace(f, add(hit, scale(n, 0.004)), cam.sun, 1.5) === undefined ? 1 : LIGHT.shadow;
	const sky = Math.max(0, n[2]) * LIGHT.sky;
	const k = LIGHT.ambient + sky + LIGHT.sun * lam * lit;
	return scale(albedo(mat, hit), k);
}

/** A look's RGBA pixels, cropped to its body plus GRAVE_MARGIN: { w, h, data }. */
function renderGrave(g) {
	const cam = camera();
	const f = fieldOf(g);
	const W = CANVAS_W;
	const H = CANVAS_H;
	const acc = new Float64Array(W * H * 4);
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			let r = 0;
			let gg = 0;
			let b = 0;
			let a = 0;
			for (let sy = 0; sy < SUPER; sy++) {
				for (let sx = 0; sx < SUPER; sx++) {
					const u = (x + (sx + 0.5) / SUPER - CANVAS_PIVOT[0]) / TILE_PX;
					const v = (CANVAS_PIVOT[1] - (y + (sy + 0.5) / SUPER)) / TILE_PX;
					const c = sample(f, cam, u, v);
					if (c === undefined) continue;
					const gc = grade(c);
					r += gc[0];
					gg += gc[1];
					b += gc[2];
					a += 1;
				}
			}
			const i = (y * W + x) * 4;
			const n = SUPER * SUPER;
			// straight colour = premultiplied sum / coverage; alpha = coverage
			acc[i] = a > 0 ? r / a : 0;
			acc[i + 1] = a > 0 ? gg / a : 0;
			acc[i + 2] = a > 0 ? b / a : 0;
			acc[i + 3] = a / n;
		}
	}
	// crop to the body (alpha > 0) plus the margin
	let x0 = W;
	let y0 = H;
	let x1 = -1;
	let y1 = -1;
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			if (acc[(y * W + x) * 4 + 3] <= 0) continue;
			x0 = Math.min(x0, x);
			y0 = Math.min(y0, y);
			x1 = Math.max(x1, x);
			y1 = Math.max(y1, y);
		}
	}
	if (x1 < 0) throw new Error(`gen-grave-art: ${g.look} drew nothing`);
	if (x0 === 0 || y0 === 0 || x1 === W - 1 || y1 === H - 1) throw new Error(`gen-grave-art: ${g.look} touches the canvas edge`);
	const w = x1 - x0 + 1 + 2 * GRAVE_MARGIN;
	const h = y1 - y0 + 1 + 2 * GRAVE_MARGIN;
	const data = Buffer.alloc(w * h * 4);
	for (let y = y0; y <= y1; y++) {
		for (let x = x0; x <= x1; x++) {
			const s = (y * W + x) * 4;
			const a = acc[s + 3];
			if (a <= 0) continue;
			const o = ((y - y0 + GRAVE_MARGIN) * w + (x - x0 + GRAVE_MARGIN)) * 4;
			for (let c = 0; c < 3; c++) data[o + c] = clamp(Math.round(acc[s + c] * STONE_GRADE.scale), 0, 255);
			data[o + 3] = clamp(Math.round(a * 255), 0, 255);
		}
	}
	return { w, h, data, pivot: [CANVAS_PIVOT[0] - x0 + GRAVE_MARGIN, CANVAS_PIVOT[1] - y0 + GRAVE_MARGIN] };
}

function toPngBytes(img) {
	const png = new PNG({ width: img.w, height: img.h });
	img.data.copy(png.data);
	return PNG.sync.write(png, { colorType: 6, deflateLevel: 9 });
}

/** The output file of a look, relative to the out dir. */
function fileOf(look) {
	return `grave/grave_${look}.png`;
}

const GRAVE_LOOKS = GRAVES.map((g) => g.look);

function main() {
	const outDir = process.argv[2] ?? path.join(__dirname, "..", "..", "art", "vendor", "kaleb-vale");
	fs.mkdirSync(path.join(outDir, "grave"), { recursive: true });
	for (const g of GRAVES) {
		const img = renderGrave(g);
		fs.writeFileSync(path.join(outDir, fileOf(g.look)), toPngBytes(img));
	}
	console.log(`gen-grave-art: ${GRAVES.length} gravestones -> ${path.join(outDir, "grave")}`);
}

if (require.main === module) main();

module.exports = { TILE_PX, SUPER, GRAVE_MARGIN, GRAVE_SCALE, GRAVES, GRAVE_LOOKS, STONE_GRADE, fileOf, renderGrave, toPngBytes };

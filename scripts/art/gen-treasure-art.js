#!/usr/bin/env node
/*
 * The vault's cage and light column (docs/TREASURE.md TR9): original pixel art drawn by code, so it needs no
 * third-party pack (like scripts/art/gen-loot-glint.js and gen-pellet.js).
 *
 *   node scripts/art/gen-treasure-art.js [outDir]     (default art/vendor/kaleb-vale)
 *
 * treasure.cage: a domed birdcage of iron bars over the vault chest, four facings like the chest (output d = NE, NW,
 *   SW, SE: the chest's front toward -Z, -X, +Z, +X; scripts/art/kit/old-chest.json rotZ 180 / 270 / 0 / 90). The cage
 *   is modelled in the chest's frame (a rounded-rectangle tray hugging its 0.94 x 0.58 tile footprint, 22 bars, every
 *   other one rising on into an 11-rib dome, a shoulder ring, a top ring, finial and hanging hoop, a brass padlock on
 *   the front bar) and projected with the game camera exactly as render_kit.py renders the chest (orthographic, 55
 *   degrees down, azimuth -45, TILE_PX px a tile), so its pivot (the footprint centre on the floor) lands on the
 *   chest's. Each pixel is a 1 px line sample shaded from a 7-step iron ramp by its normal against the kit sun; the
 *   bars behind the chest are cut where the chest's box hides them (a ray toward the camera), so the cage, drawn just in
 *   front of the chest (TREASURE_VIEW.cageDepthStuds), reads as standing round it.
 *   Writes vault-cage/<DIR>/cage_<DIR>_<angle>_0.png (CAGE_W x CAGE_H, pivot CAGE_PIVOT in every facing).
 *
 * fx.treasure.column: the open's light column, a greyscale loop (tinted by the tier's floor role at draw time):
 *   a white core, stepped glow, a flared foot, a dithered fade at the top, bands and motes rising one period per loop.
 *   Writes treasure-column/column.png: COLUMN_FRAMES frames of COLUMN_W x COLUMN_H side by side (the fx strip format).
 *
 * Same inputs, byte-identical PNGs.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

// --- the camera (scripts/art/kit/render_kit.py) ----------------------------------------------------------------------
const TILE_PX = 29.6;
const PITCH_DEG = 55;
const AZ_DEG = -45;

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

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));

// --- the cage -------------------------------------------------------------------------------------------------------
/** Output facings d (the chest's): directory, angle in the file name, the chest's turn about Z (old-chest.json rotZ). */
const FACINGS = [
	{ dir: "NE", angle: "45.0", rotZ: 180 },
	{ dir: "NW", angle: "135.0", rotZ: 270 },
	{ dir: "SW", angle: "225.0", rotZ: 0 },
	{ dir: "SE", angle: "315.0", rotZ: 90 },
];
/** Canvas and pivot (the footprint centre on the floor), px; the same in every facing. */
const CAGE_W = 44;
const CAGE_H = 46;
const CAGE_PIVOT = [22, 31];

/** The cage, tiles, in the chest's frame (x along its 0.94 length, y across, -y its front, z up). */
const CAGE = {
	/** Tray half extents and corner radius: the chest (0.47 x 0.29 half) plus a hair. */
	hx: 0.53,
	hy: 0.37,
	r: 0.16,
	bars: 22,
	/** Shoulder (top of the straight bars, the dome's foot), dome rise, top ring radius. */
	shoulder: 0.62,
	dome: 0.36,
	topRing: 0.12,
	/** The tray's rings (z). */
	tray: [0.0, 0.035, 0.07],
	/** The finial above the top ring and the hoop above that (centre z, radius). */
	finial: 0.05,
	hoop: { z: 0.14, r: 0.06 },
	/** The padlock on the front bar (z of its body's centre). */
	lockZ: 0.3,
};
/** The chest box that hides the bars behind it (half extents and height, a hair inside the model's). */
const CHEST_BOX = { hx: 0.46, hy: 0.28, h: 0.57 };

/** Iron, dark to light (treasure.cage #a8adb5 sits at step 4). */
const IRON = ["#24262c", "#3a3d45", "#555a64", "#737983", "#969ca6", "#bcc1c9", "#e2e5ea"].map(hex);
const BRASS = ["#5a3f17", "#8f6a2a", "#c79a45", "#efd389"].map(hex);

function hex(h) {
	return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

/** The tray's outline point and outward normal at arc length s (0 = the front middle, -y; counter-clockwise from above). */
function trayAt(s) {
	const { hx, hy, r } = CAGE;
	const ex = hx - r;
	const ey = hy - r;
	const q = (Math.PI * r) / 2;
	// segments from the front middle: front right half, corner, right side, corner, back, corner, left side, corner, front left half
	const segs = [
		{ len: ex, at: (t) => [[t, -hy], [0, -1]] },
		{ len: q, at: (t) => arc(ex, -ey, -Math.PI / 2 + t / r) },
		{ len: 2 * ey, at: (t) => [[hx, -ey + t], [1, 0]] },
		{ len: q, at: (t) => arc(ex, ey, t / r) },
		{ len: 2 * ex, at: (t) => [[ex - t, hy], [0, 1]] },
		{ len: q, at: (t) => arc(-ex, ey, Math.PI / 2 + t / r) },
		{ len: 2 * ey, at: (t) => [[-hx, ey - t], [-1, 0]] },
		{ len: q, at: (t) => arc(-ex, -ey, Math.PI + t / r) },
		{ len: ex, at: (t) => [[-ex + t, -hy], [0, -1]] },
	];
	const total = segs.reduce((n, g) => n + g.len, 0);
	let t = ((s % total) + total) % total;
	for (const g of segs) {
		if (t <= g.len) return g.at(t);
		t -= g.len;
	}
	return segs[segs.length - 1].at(segs[segs.length - 1].len);
	function arc(cx, cy, a) {
		return [[cx + r * Math.cos(a), cy + r * Math.sin(a)], [Math.cos(a), Math.sin(a)]];
	}
}

function trayLength() {
	const { hx, hy, r } = CAGE;
	return 4 * (hx - r) + 4 * (hy - r) + 2 * Math.PI * r;
}

/**
 * Every line of the cage as samples { p (chest frame), n (unit normal), part }: dense enough that no projected step
 * skips a pixel.
 */
function cageSamples() {
	const out = [];
	const L = trayLength();
	const step = 0.004;
	const push = (p, n, part, line) => out.push({ p, n, part, line });
	// tray rings and the shoulder ring
	CAGE.tray.forEach((z, k) => {
		for (let s = 0; s < L; s += step) {
			const [xy, n] = trayAt(s);
			push([xy[0], xy[1], z], [n[0], n[1], k === CAGE.tray.length - 1 ? 0.6 : 0], k === CAGE.tray.length - 1 ? "trayTop" : "tray", `tray${k}`);
		}
	});
	for (let s = 0; s < L; s += step) {
		const [xy, n] = trayAt(s);
		push([xy[0], xy[1], CAGE.shoulder], [n[0], n[1], 0.5], "ring", "shoulder");
	}
	// bars, every other one on into the dome
	for (let b = 0; b < CAGE.bars; b++) {
		const [xy, n] = trayAt((b * L) / CAGE.bars);
		for (let z = CAGE.tray[CAGE.tray.length - 1]; z <= CAGE.shoulder; z += step) push([xy[0], xy[1], z], [n[0], n[1], 0], "bar", `bar${b}`);
		if (b % 2 !== 0) continue;
		const len = Math.hypot(xy[0], xy[1]);
		const top = [(xy[0] / len) * CAGE.topRing, (xy[1] / len) * CAGE.topRing];
		for (let u = 0; u <= 1; u += step / 2) {
			const a = (u * Math.PI) / 2;
			const k = 1 - Math.cos(a);
			const p = [xy[0] + (top[0] - xy[0]) * k, xy[1] + (top[1] - xy[1]) * k, CAGE.shoulder + CAGE.dome * Math.sin(a)];
			push(p, norm([n[0] * Math.cos(a), n[1] * Math.cos(a), Math.sin(a) + 0.15]), "dome", `bar${b}`);
		}
	}
	// the top ring (two turns, a hair apart, so it reads as a band)
	const apex = CAGE.shoulder + CAGE.dome;
	for (const dz of [0, 0.03]) {
		for (let a = 0; a < 2 * Math.PI; a += step / CAGE.topRing) {
			push([CAGE.topRing * Math.cos(a), CAGE.topRing * Math.sin(a), apex + dz], [Math.cos(a), Math.sin(a), 0.8], "ring", `top${dz}`);
		}
	}
	return out;
}

/** Does the ray from p toward the camera pass through the chest box? (slab test) */
function hiddenByChest(p, back) {
	const lo = [-CHEST_BOX.hx, -CHEST_BOX.hy, 0];
	const hi = [CHEST_BOX.hx, CHEST_BOX.hy, CHEST_BOX.h];
	let t0 = 1e-6;
	let t1 = Infinity;
	for (let i = 0; i < 3; i++) {
		if (Math.abs(back[i]) < 1e-12) {
			if (p[i] < lo[i] || p[i] > hi[i]) return false;
			continue;
		}
		let a = (lo[i] - p[i]) / back[i];
		let b = (hi[i] - p[i]) / back[i];
		if (a > b) [a, b] = [b, a];
		t0 = Math.max(t0, a);
		t1 = Math.min(t1, b);
		if (t0 > t1) return false;
	}
	return true;
}

/** Turns a chest-frame vector by `deg` about Z (counter-clockwise from above, Blender's sense). */
function turn(v, deg) {
	const a = (deg * Math.PI) / 180;
	const c = Math.cos(a);
	const s = Math.sin(a);
	return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
}

/** The iron step for a sample: lit by the kit sun, darker when we see its inside (behind the cage's middle). */
function ironStep(n, cam, part) {
	const lam = dot(n, cam.sun) / Math.hypot(n[0], n[1], n[2]);
	const facing = dot(n, cam.back) > 0;
	if (!facing) return Math.max(1, Math.min(3, 2 + Math.round(-lam * 1.2)));
	// the straight bars top out a step under the rings, so the frame (tray, shoulder, top) reads first
	const base = part === "tray" ? 2 : 3;
	const max = part === "bar" || part === "dome" ? 5 : 6;
	return Math.max(2, Math.min(max, base + Math.round(lam * 2.2)));
}

function renderCage(f) {
	const cam = camera();
	const W = CAGE_W;
	const H = CAGE_H;
	const depth = new Float64Array(W * H).fill(Infinity);
	const rgb = new Array(W * H).fill(null);
	const put = (x, y, d, c) => {
		if (x < 0 || y < 0 || x >= W || y >= H) return;
		const i = y * W + x;
		if (d < depth[i]) {
			depth[i] = d;
			rgb[i] = c;
		}
	};
	// the chest box is axis-aligned in the chest's frame: test there, with the camera turned back
	const backLocal = turn(cam.back, -f.rotZ);
	const proj = (p) => [CAGE_PIVOT[0] + dot(p, cam.right) * TILE_PX, CAGE_PIVOT[1] - dot(p, cam.up) * TILE_PX, dot(p, cam.fwd)];
	for (const s of cageSamples()) {
		if (hiddenByChest(s.p, backLocal)) continue;
		const p = turn(s.p, f.rotZ);
		const n = turn(s.n, f.rotZ);
		const [x, y, d] = proj(p);
		put(Math.floor(x), Math.floor(y), d, IRON[ironStep(n, cam, s.part)]);
	}
	// finial: a 2 x 2 knob, lit top-left
	const apex = CAGE.shoulder + CAGE.dome + 0.03;
	const [fx, fy, fd] = proj([0, 0, apex + CAGE.finial]);
	const kx = Math.floor(fx - 0.5);
	const ky = Math.floor(fy - 0.5);
	put(kx, ky, fd - 1, IRON[6]);
	put(kx + 1, ky, fd - 1, IRON[5]);
	put(kx, ky + 1, fd - 1, IRON[4]);
	put(kx + 1, ky + 1, fd - 1, IRON[3]);
	// the hoop: a ring facing the camera over the finial
	const hz = apex + CAGE.hoop.z;
	for (let a = 0; a < 2 * Math.PI; a += 0.05) {
		const p = add(add([0, 0, hz], scale(cam.right, CAGE.hoop.r * Math.cos(a))), [0, 0, CAGE.hoop.r * Math.sin(a) * 1.15]);
		const [x, y] = proj(p);
		const lit = Math.cos(a) < 0.2 && Math.sin(a) > -0.3;
		put(Math.floor(x), Math.floor(y), fd - 2, IRON[lit ? 5 : 3]);
	}
	// the padlock on the front middle bar (hidden with it when the front faces away)
	const lockLocal = [0, -CAGE.hy - 0.01, CAGE.lockZ];
	const lockAt = turn(lockLocal, f.rotZ);
	if (!hiddenByChest(lockLocal, backLocal) && dot(turn([0, -1, 0], f.rotZ), cam.back) > 0) {
		const [lx, ly, ld] = proj(lockAt);
		const x0 = Math.floor(lx) - 1;
		const y0 = Math.floor(ly) - 1;
		// shackle (2 px tall arc) then a 3 x 3 body with a keyhole
		const shackle = [[0, -2, 2], [1, -3, 3], [2, -2, 1]];
		for (const [dx, dy, c] of shackle) put(x0 + dx, y0 + dy, ld - 3, BRASS[c]);
		put(x0, y0 - 1, ld - 3, BRASS[2]);
		put(x0 + 2, y0 - 1, ld - 3, BRASS[1]);
		const body = [
			[3, 2, 2],
			[2, 2, 1],
			[2, 0, 1],
		];
		for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) put(x0 + dx, y0 + dy, ld - 3, BRASS[body[dy][dx]]);
		put(x0 + 1, y0 + 1, ld - 4, BRASS[0]);
	}
	return toPng(W, H, (i) => (rgb[i] ? [...rgb[i], 255] : [0, 0, 0, 0]));
}

// --- the column -----------------------------------------------------------------------------------------------------
const COLUMN_W = 27;
const COLUMN_H = 148;
const COLUMN_FRAMES = 8;
const COLUMN_FPS = 12;

/** Alpha steps (pixel art: a few flat levels). */
const STEPS = [0, 40, 80, 130, 190, 255];

/** A stable pseudo-random in [0, 1) from integers (no Math.random: byte-identical output). */
function hash01(a, b) {
	let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
}

/**
 * One frame as STEPS indices (0 = clear .. 5 = white) per pixel: flat bands out from the core (core 5, then 4 / 3 / 2 /
 * 1 at COLUMN_BANDS half-widths), one band brighter where a rising pulse passes, a flared foot, the top quarter thinning
 * band by band with a checker dither at each band's edge, and motes.
 */
const COLUMN_BANDS = [1.5, 3, 5, 8, 11.5];
function renderColumnFrame(f) {
	const W = COLUMN_W;
	const H = COLUMN_H;
	const cx = (W - 1) / 2;
	const phase = f / COLUMN_FRAMES;
	const lv = new Uint8Array(W * H);
	for (let y = 0; y < H; y++) {
		const h = 1 - y / (H - 1); // 0 at the foot, 1 at the top
		const foot = Math.max(0, 1 - h / 0.06); // the last ~9 rows flare out
		// rising pulses: 3 a column, one period a loop; a pulse lifts every band by one step
		const pulse = Math.sin(2 * Math.PI * (h * 3 - phase)) > 0.88 ? 1 : 0;
		// the top: from h 0.6 each band's edge pulls in, the outer ones first
		const thin = Math.max(0, (h - 0.7) / 0.3);
		for (let x = 0; x < W; x++) {
			const d = Math.abs(x - cx);
			let level = 0;
			for (let k = 0; k < COLUMN_BANDS.length; k++) {
				const half = COLUMN_BANDS[k] + foot * foot * (3 + k * 1.2) - thin * thin * k * 2.2;
				if (d <= half) {
					level = 5 - k;
					// the band's outermost pixel column is dithered (a soft but pixel-crisp edge)
					if (d > half - 1 && ((x + y) & 1) === 1) level = Math.max(0, level - 1);
					break;
				}
			}
			if (level > 0 && level < 4) level += pulse;
			// the very top fades out by a dither over its last rows
			// the top quarter fades out: ever more pixels drop a step, then two
			const fade = Math.max(0, (h - 0.72) / 0.28);
			if (level > 0 && hash01(x, y) < fade) level = Math.max(0, level - 1 - (hash01(y, x) < fade ? 2 : 0));
			lv[y * W + x] = level;
		}
	}
	// motes: small sparkles rising through the glow, one or two trips of their lane per loop
	const MOTES = 9;
	for (let m = 0; m < MOTES; m++) {
		const lane = m % 2 === 0 ? -1 : 1;
		const x = Math.round(cx + lane * (5 + Math.floor(hash01(m, 3) * 6)));
		const speed = 1 + (m % 3 === 0 ? 1 : 0);
		const y0 = hash01(m, 11) * H;
		const y = Math.floor((((y0 - phase * speed * H) % H) + H) % H);
		const h = 1 - y / (H - 1);
		if (h > 0.85 || h < 0.08) continue;
		const at = (xx, yy, v) => {
			if (xx >= 0 && xx < W && yy >= 0 && yy < H) lv[yy * W + xx] = Math.max(lv[yy * W + xx], v);
		};
		const top = h > 0.6 ? 4 : 5;
		at(x, y, top);
		if (m % 3 !== 2) {
			at(x - 1, y, top - 2);
			at(x + 1, y, top - 2);
			at(x, y - 1, top - 2);
			at(x, y + 1, top - 2);
		}
		at(x, y + 2, 2);
	}
	return lv;
}

function renderColumnStrip() {
	const W = COLUMN_W * COLUMN_FRAMES;
	const frames = [...Array(COLUMN_FRAMES).keys()].map(renderColumnFrame);
	return toPng(W, COLUMN_H, (i) => {
		const x = i % W;
		const y = (i - x) / W;
		const f = Math.floor(x / COLUMN_W);
		const lx = x - f * COLUMN_W;
		return [255, 255, 255, STEPS[frames[f][y * COLUMN_W + lx]]];
	});
}

// --- output ---------------------------------------------------------------------------------------------------------
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
	const out = path.resolve(process.argv[2] || path.join(__dirname, "..", "..", "art", "vendor", "kaleb-vale"));
	for (const f of FACINGS) {
		const dir = path.join(out, "vault-cage", f.dir);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, `cage_${f.dir}_${f.angle}_0.png`), renderCage(f));
	}
	const col = path.join(out, "treasure-column");
	fs.mkdirSync(col, { recursive: true });
	fs.writeFileSync(path.join(col, "column.png"), renderColumnStrip());
	console.log(
		`gen-treasure-art: cage ${FACINGS.length} facings (${CAGE_W}x${CAGE_H}, pivot ${CAGE_PIVOT.join(",")}), column ${COLUMN_FRAMES} frames (${COLUMN_W}x${COLUMN_H} @ ${COLUMN_FPS} fps) -> ${path.relative(process.cwd(), out)}`,
	);
}

if (require.main === module) main();

module.exports = {
	FACINGS,
	CAGE,
	CAGE_W,
	CAGE_H,
	CAGE_PIVOT,
	CHEST_BOX,
	IRON,
	BRASS,
	STEPS,
	COLUMN_W,
	COLUMN_H,
	COLUMN_FRAMES,
	COLUMN_FPS,
	camera,
	hiddenByChest,
	turn,
	renderCage,
	renderColumnStrip,
};

#!/usr/bin/env node
/*
 * Fortune's art (docs/FORTUNE.md FO10): original pixel art drawn by code, so it needs no third-party pack (like
 * scripts/art/gen-treasure-art.js, gen-loot-glint.js and gen-pellet.js).
 *
 *   node scripts/art/gen-fortune-art.js [outDir]     (default art/vendor/kaleb-vale)
 *
 * pact.altar: a round stone altar holding an iron fire bowl (both pacts draw it; the pact is told by the view's flame in
 *   its role colour and its floor card, never by the stone). Round, so one facing serves every camera turn. Modelled in
 *   tiles as a stack of solids of revolution about the cell's centre (a two-step foot, a drum with a carved rune band, a
 *   cap slab, the iron bowl with a bed of coals) and projected with the game camera exactly as render_kit.py
 *   and gen-treasure-art.js project the vault (orthographic, 55 degrees down, azimuth -45, TILE_PX px a tile), so its
 *   pivot (the footprint centre on the floor) is the altar cell. One ray per pixel centre (crisp pixel edges), shaded
 *   from a 7-step stone ramp / the cage's iron ramp by the kit sun with cast shadows, a darker silhouette on the shadow
 *   side and a dithered contact shadow on the floor. ALTAR.coals is the coal bed's height: the view's flame stands there
 *   (shared/view/pacts PACTS_VIEW.artTopTiles), so it rises out of the bowl's opening.
 *   Writes pact-altar/altar_0.png (ALTAR_W x ALTAR_H, pivot ALTAR_PIVOT).
 *
 * fx.golden.coin: the Goldling's coin burst, a greyscale flipbook (tinted by `golden.coin` at draw time) drawn as seen on
 *   screen (the fx are laid flat on the floor, depth stretched by 1 / sin(pitch)): a four-point flash, COIN_COUNT coins
 *   tossed out from the hit over an arc, spinning (face, oblique, edge), twinkling at the top and on landing, landing
 *   face up with a one-pixel bounce and blinking out. Writes golden-coin/coin.png: COIN_FRAMES frames of COIN_W x
 *   COIN_H side by side (the fx strip format).
 *
 * Same inputs, byte-identical PNGs.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

// --- the camera (scripts/art/kit/render_kit.py, the same as gen-treasure-art.js) -------------------------------------
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

function hex(h) {
	return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

/** A stable pseudo-random in [0, 1) from integers (no Math.random: byte-identical output). */
function hash01(a, b) {
	let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
}

// --- the altar ------------------------------------------------------------------------------------------------------
/** Canvas and pivot (the footprint centre on the floor), px. */
const ALTAR_W = 32;
const ALTAR_H = 34;
const ALTAR_PIVOT = [15, 22];

/**
 * The altar, tiles, about the cell's centre (z up). Each part is a frustum (radius r0 at z0 to r1 at z1) of one
 * material; the bowl is hollow down to the coals.
 */
const ALTAR = {
	parts: [
		{ name: "foot", z0: 0, z1: 0.07, r0: 0.37, r1: 0.36, mat: "stone" },
		{ name: "base", z0: 0.07, z1: 0.13, r0: 0.32, r1: 0.31, mat: "stone" },
		{ name: "drum", z0: 0.13, z1: 0.5, r0: 0.27, r1: 0.26, mat: "stone" },
		{ name: "cap", z0: 0.5, z1: 0.55, r0: 0.3, r1: 0.3, mat: "stone" },
		{ name: "bowl", z0: 0.55, z1: 0.7, r0: 0.17, r1: 0.27, mat: "iron" },
	],
	/** The bowl's wall thickness (tiles) and the coal bed's height (the view's flame stands on it). */
	bowlWall: 0.04,
	coals: 0.64,
	/** The drum's carved rune band (z range) and its glyph count round the drum. */
	runes: { z0: 0.2, z1: 0.44, glyphs: 8 },
	/** The floor shadow: radius and its centre pushed away from the sun (tiles). */
	shadow: { r: 0.46, push: 0.07 },
};

/** Stone, dark to light: a neutral warm grey (the placeholder's uiTextDim plinth sits near step 4). */
const STONE = ["#1c1a1f", "#2c2930", "#3f3b43", "#57525b", "#726c75", "#928b93", "#b8b1b6"].map(hex);
/** Iron (gen-treasure-art.js IRON, the cage's: the brazier is of a piece with the vault's iron). */
const IRON = ["#24262c", "#3a3d45", "#555a64", "#737983", "#969ca6", "#bcc1c9", "#e2e5ea"].map(hex);
/** Coals and ash in the bowl (neutral: the view's flame brings the pact's colour). */
const COALS = ["#141215", "#231f24", "#3a343a", "#5a5359"].map(hex);
/** The contact shadow's alpha steps (black). */
const SHADOW_ALPHA = [0, 56, 96];

/** The radius of a frustum part at height z. */
function radiusAt(p, z) {
	return p.r0 + ((p.r1 - p.r0) * (z - p.z0)) / (p.z1 - p.z0);
}

/**
 * Signed distance-like field of the solid altar at q (tiles): < 0 inside. The union of the parts; the bowl is cut
 * hollow above the coals. Returns { d, part }.
 */
function field(q) {
	const rxy = Math.hypot(q[0], q[1]);
	let best = { d: Infinity, part: undefined };
	for (const p of ALTAR.parts) {
		const side = rxy - radiusAt(p, Math.min(p.z1, Math.max(p.z0, q[2])));
		let d = Math.max(side, q[2] - p.z1, p.z0 - q[2]);
		if (p.name === "bowl") {
			const inner = radiusAt(p, Math.min(p.z1, Math.max(p.z0, q[2]))) - ALTAR.bowlWall - rxy;
			// hollow: inside the inner wall and above the coals is empty
			if (inner > 0 && q[2] > ALTAR.coals) d = Math.max(d, Math.min(inner, q[2] - ALTAR.coals));
		}
		if (d < best.d) best = { d, part: p };
	}
	return best;
}

/** The surface normal at q from the field's central differences. */
function normalAt(q) {
	const e = 0.004;
	const f = (dx, dy, dz) => field([q[0] + dx, q[1] + dy, q[2] + dz]).d;
	return norm([f(e, 0, 0) - f(-e, 0, 0), f(0, e, 0) - f(0, -e, 0), f(0, 0, e) - f(0, 0, -e)]);
}

/** The first hit of the ray o + t d (t in [0, tMax]) on the solid, refined by bisection, or undefined. */
function march(o, d, tMax, step = 0.003) {
	let prev = 0;
	for (let t = 0; t <= tMax; t += step) {
		const q = add(o, scale(d, t));
		if (field(q).d < 0) {
			let lo = prev;
			let hi = t;
			for (let k = 0; k < 20; k++) {
				const mid = (lo + hi) / 2;
				if (field(add(o, scale(d, mid))).d < 0) hi = mid;
				else lo = mid;
			}
			return add(o, scale(d, hi));
		}
		prev = t;
	}
	return undefined;
}

/** Is q (just off a surface) in the shadow of the altar toward the sun? */
function shadowed(q, sun) {
	return march(add(q, scale(sun, 0.012)), sun, 1.2, 0.006) !== undefined;
}

const RUNE_NONE = 0;
const RUNE_GROOVE = 1;
const RUNE_GLYPH = 2;

/**
 * The drum's carved band at (angle a, height z): RUNE_GROOVE on the band's two edge lines and the recessed field between,
 * RUNE_GLYPH where a raised glyph stands in the field (a stem with a tick or a bar, per glyph by a stable hash), else
 * RUNE_NONE (plain stone).
 */
function runeAt(a, z) {
	const { z0, z1, glyphs } = ALTAR.runes;
	if (z < z0 || z > z1) return RUNE_NONE;
	const h = (z - z0) / (z1 - z0);
	if (h < 0.14 || h > 0.86) return RUNE_GROOVE;
	const w = ((((a / (2 * Math.PI)) * glyphs) % glyphs) + glyphs) % glyphs;
	const g = Math.floor(w);
	const u = w - g; // across one glyph's cell
	const shape = Math.floor(hash01(g, 7) * 3);
	if (u > 0.36 && u < 0.64 && h > 0.22 && h < 0.74) return RUNE_GLYPH; // the stem
	if (shape === 0 && Math.abs(h - 0.5) < 0.09 && u > 0.2 && u < 0.8) return RUNE_GLYPH; // a cross bar
	if (shape === 1 && Math.abs(h - 0.32) < 0.09 && u > 0.5 && u < 0.8) return RUNE_GLYPH; // a low tick
	if (shape === 2 && Math.abs(h - 0.68) < 0.09 && u > 0.2 && u < 0.5) return RUNE_GLYPH; // a high tick
	return RUNE_GROOVE;
}

/** A shaded pixel: the ramp step for a hit (material, normal, lit or in shadow), the rune band cut and raised. */
function shade(q, n, part, cam) {
	const lam = dot(n, cam.sun);
	const lit = !shadowed(q, cam.sun);
	if (
		part.name === "bowl" &&
		Math.hypot(q[0], q[1]) < radiusAt(part, q[2]) - ALTAR.bowlWall * 0.5 &&
		q[2] <= ALTAR.coals + 0.01
	) {
		// the coal bed: dark, a few lighter ash flecks
		const fleck = hash01(Math.floor(q[0] * 90 + 500), Math.floor(q[1] * 90 + 500));
		return COALS[fleck < 0.12 ? 3 : fleck < 0.4 ? 2 : 1];
	}
	// the bowl's lip: a bright ring, a step darker on the shadow side
	if (part.name === "bowl" && n[2] > 0.7 && q[2] > part.z1 - 0.01) return IRON[lam > 0.3 ? 6 : 5];
	const ramp = part.mat === "iron" ? IRON : STONE;
	let s = 2 + Math.round(Math.max(-0.4, lam) * 3.2);
	if (!lit) s -= 1;
	if (part.mat === "iron") s += 1; // the brazier reads against the dark floor
	const rune = part.name === "drum" ? runeAt(Math.atan2(q[1], q[0]), q[2]) : RUNE_NONE;
	if (rune === RUNE_GROOVE) s -= 2;
	else if (rune === RUNE_GLYPH) s += 1;
	// the bowl's inner wall (seen over the near rim) stays dark
	if (part.name === "bowl" && Math.hypot(q[0], q[1]) < radiusAt(part, q[2]) - ALTAR.bowlWall * 0.5)
		s = Math.min(s, 2) - 1;
	return ramp[Math.max(1, Math.min(ramp.length - 1, s))];
}

function renderAltar() {
	const cam = camera();
	const W = ALTAR_W;
	const H = ALTAR_H;
	const rgb = new Array(W * H).fill(null);
	const nz = new Array(W * H).fill(0);
	const shadowA = new Uint8Array(W * H);
	const sunXY = norm([cam.sun[0], cam.sun[1], 0]);
	const shadowC = [-sunXY[0] * ALTAR.shadow.push, -sunXY[1] * ALTAR.shadow.push];
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			const u = (x + 0.5 - ALTAR_PIVOT[0]) / TILE_PX;
			const v = (ALTAR_PIVOT[1] - (y + 0.5)) / TILE_PX;
			// the pixel's ray, started well toward the camera
			const o = add(add(scale(cam.right, u), scale(cam.up, v)), scale(cam.back, 2));
			const hit = march(o, cam.fwd, 3);
			const i = y * W + x;
			if (hit !== undefined && hit[2] > -1e-6) {
				const { part } = field(hit);
				const n = normalAt(hit);
				rgb[i] = shade(hit, n, part, cam);
				nz[i] = dot(n, cam.sun);
				continue;
			}
			// the floor (z = 0) under this pixel: the contact shadow
			const t = o[2] / -cam.fwd[2];
			const g = add(o, scale(cam.fwd, t));
			const r = Math.hypot(g[0] - shadowC[0], g[1] - shadowC[1]) / ALTAR.shadow.r;
			if (r < 0.78) shadowA[i] = 2;
			else if (r < 1) shadowA[i] = (x + y) % 2 === 0 ? 1 : 0;
		}
	}
	// the silhouette on the shadow side: edge pixels facing away from the sun take the ramp's darkest step
	const out = rgb.slice();
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			const i = y * W + x;
			if (!rgb[i]) continue;
			const empty = (xx, yy) => xx < 0 || yy < 0 || xx >= W || yy >= H || !rgb[yy * W + xx];
			const edge = empty(x - 1, y) || empty(x + 1, y) || empty(x, y - 1) || empty(x, y + 1);
			if (edge && nz[i] < 0.25) out[i] = STONE[0];
		}
	}
	return toPng(W, H, (i) =>
		out[i] ? [...out[i], 255] : shadowA[i] ? [0, 0, 0, SHADOW_ALPHA[shadowA[i]]] : [0, 0, 0, 0],
	);
}

// --- the coin burst -------------------------------------------------------------------------------------------------
const COIN_W = 36;
const COIN_H = 36;
const COIN_FRAMES = 10;
const COIN_FPS = 20;
const COIN_COUNT = 7;
/** Grey levels: outline, rim, face, highlight (white is golden.coin itself once tinted). */
const COIN_GREY = [72, 136, 206, 255];
/** The coin seen face on (5 x 5), three-quarter (3 x 5) and edge on (1 x 5): COIN_GREY indices, -1 clear. */
const COIN_FACES = [
	[
		[-1, 0, 0, 0, -1],
		[0, 3, 2, 2, 0],
		[0, 2, 1, 2, 0],
		[0, 2, 2, 1, 0],
		[-1, 0, 0, 0, -1],
	],
	[
		[-1, 0, -1],
		[0, 3, 0],
		[0, 2, 0],
		[0, 1, 0],
		[-1, 0, -1],
	],
	[[3], [2], [2], [1], [1]],
];
/** The spin: which face a coin shows at each step of its turn. */
const SPIN = [0, 1, 2, 1];

/** The toss: every coin lands LAND_FRAME frames in (its arc's end), bounces once, then blinks out. */
const LAND_FRAME = 7;

/**
 * Each coin's toss (screen px): out along angle `a` (squashed to the floor's depth, `depth`) to `reach`, eased out, over
 * an arc `hop` high; `phase` its spin's start; `gone` the frame it blinks out.
 */
function coinTosses() {
	const out = [];
	for (let k = 0; k < COIN_COUNT; k++) {
		out.push({
			a: ((k + 0.25) / COIN_COUNT) * 2 * Math.PI + (hash01(k, 1) - 0.5) * 0.5,
			reach: 9 + hash01(k, 2) * 5,
			hop: 4 + hash01(k, 3) * 2.5,
			phase: (k * 3) % SPIN.length,
			gone: COIN_FRAMES - (k % 2),
		});
	}
	return out;
}
/** The floor's depth on screen (sin of the camera's pitch): a toss toward the camera covers less screen. */
const COIN_DEPTH = Math.sin((PITCH_DEG * Math.PI) / 180);

/** A coin's screen centre at frame f: eased out along the floor, up an arc, a one-pixel bounce after landing. */
function coinAt(c, f, cx, cy) {
	const s = Math.min(1, (f + 1) / (LAND_FRAME + 1));
	const ease = 1 - (1 - s) * (1 - s);
	const x = cx + Math.cos(c.a) * c.reach * ease;
	let y = cy + Math.sin(c.a) * c.reach * COIN_DEPTH * ease - c.hop * 4 * s * (1 - s);
	if (f === LAND_FRAME + 1) y -= 1;
	return [x, y];
}

/** One frame as COIN_GREY indices per pixel (-1 clear). */
function renderCoinFrame(f) {
	const W = COIN_W;
	const H = COIN_H;
	const lv = new Int8Array(W * H).fill(-1);
	const at = (x, y, v) => {
		if (x < 0 || y < 0 || x >= W || y >= H) return;
		lv[y * W + x] = Math.max(lv[y * W + x], v);
	};
	const cx = Math.floor(W / 2);
	const cy = Math.floor(H / 2);
	// the flash: a four-point star, big on frame 0, shrinking, gone by frame 3
	const flash = [4, 3, 1][f];
	if (flash !== undefined) {
		for (let d = -flash; d <= flash; d++) {
			const v = Math.abs(d) <= 1 ? 3 : Math.abs(d) <= flash - 1 ? 2 : 1;
			at(cx + d, cy, v);
			at(cx, cy + d, v);
		}
		if (flash >= 3)
			for (const [dx, dy] of [
				[1, 1],
				[-1, 1],
				[1, -1],
				[-1, -1],
			])
				at(cx + dx, cy + dy, 2);
	}
	// the coins, each spinning one step a frame (flat once landed: face on)
	for (const [k, c] of coinTosses().entries()) {
		if (f >= c.gone) continue;
		const [x, y] = coinAt(c, f, cx, cy);
		const landed = f >= LAND_FRAME;
		const face = COIN_FACES[landed ? 0 : SPIN[(c.phase + f) % SPIN.length]];
		const fw = face[0].length;
		const x0 = Math.round(x - (fw - 1) / 2);
		const y0 = Math.round(y - 2);
		for (let dy = 0; dy < face.length; dy++)
			for (let dx = 0; dx < fw; dx++) if (face[dy][dx] >= 0) at(x0 + dx, y0 + dy, face[dy][dx]);
		// a twinkle at the top of the arc (every other coin) and on landing (the others)
		if ((k % 2 === 0 && f === 3) || (k % 2 === 1 && f === LAND_FRAME)) {
			const tx = x0 + fw + 1;
			const ty = y0 - 1;
			at(tx, ty, 3);
			at(tx - 1, ty, 1);
			at(tx + 1, ty, 1);
			at(tx, ty - 1, 1);
			at(tx, ty + 1, 1);
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
	const altar = path.join(out, "pact-altar");
	fs.mkdirSync(altar, { recursive: true });
	fs.writeFileSync(path.join(altar, "altar_0.png"), renderAltar());
	const coin = path.join(out, "golden-coin");
	fs.mkdirSync(coin, { recursive: true });
	fs.writeFileSync(path.join(coin, "coin.png"), renderCoinStrip());
	console.log(
		`gen-fortune-art: altar ${ALTAR_W}x${ALTAR_H} (pivot ${ALTAR_PIVOT.join(",")}, coals at ${
			ALTAR.coals
		} tiles), coin burst ${COIN_FRAMES} frames (${COIN_W}x${COIN_H} @ ${COIN_FPS} fps) -> ${path.relative(
			process.cwd(),
			out,
		)}`,
	);
}

if (require.main === module) main();

module.exports = {
	TILE_PX,
	ALTAR,
	ALTAR_W,
	ALTAR_H,
	ALTAR_PIVOT,
	STONE,
	IRON,
	COALS,
	SHADOW_ALPHA,
	COIN_W,
	COIN_H,
	COIN_FRAMES,
	COIN_FPS,
	COIN_COUNT,
	COIN_GREY,
	camera,
	field,
	renderAltar,
	renderCoinStrip,
};

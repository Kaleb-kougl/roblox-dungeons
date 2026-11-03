#!/usr/bin/env node
/*
 * The pellets (docs/PELLETS.md PL8, PD3): original pixel-art cubes, drawn by code so they need no third-party pack.
 * Greyscale (the lit top face near white, the front face darker, its bottom row darkest): the renderer tints them with
 * the `pellet.normal` / `pellet.power` colour roles (ImageColor3 multiplies), like the loot glint.
 *
 *   node scripts/art/gen-pellet.js [outDir]     (default art/vendor/kaleb-vale/pellets)
 *
 * Writes pellet.png (the room's pellet: a small cube in 3/4 view, NORMAL.w px wide, about a quarter tile at the
 * pack's 29.6 px per tile) and pellet_power.png (the power pellet: a bigger cube, about 0.45 tile, a bevelled top face
 * with a bright glint in its back-left corner). One frame each, every pixel opaque (alpha 255: above the pipeline's
 * noise cut, and its RGB above the shadow cut, so the "center" pivot measures the whole cube). Same inputs,
 * byte-identical PNGs.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

/**
 * Grey levels (the role colour is multiplied by level / 255). A few flat steps, no gradients (pixel art): `glint` the
 * highlight, `top` the lit top face, `rim` its bevel (the power cube's top face border), `lip` the front face's lit top
 * row, `front` the front face, `base` its bottom row (the edge on the floor).
 */
const L = { glint: 255, top: 232, rim: 208, lip: 188, front: 156, base: 112 };

/**
 * A cube: `w` px wide, the top face `topH` rows (foreshortened: the camera looks down at about 3/4), the front face
 * `frontH` rows below it. `glint`: the highlight pixels on the top face ([x, y], face pixels); `bevel`: the top face's
 * border is drawn at `rim` (the power cube's raised look).
 */
const NORMAL = { name: "pellet", w: 7, topH: 4, frontH: 3, bevel: false, glint: [[1, 1]] };
const POWER = {
	name: "pellet_power",
	w: 13,
	topH: 7,
	frontH: 6,
	bevel: true,
	glint: [
		[2, 1],
		[3, 1],
		[4, 1],
		[2, 2],
		[3, 2],
		[2, 3],
	],
};
const CUBES = [NORMAL, POWER];

/** The cube's grey level per pixel, row-major (w x (topH + frontH)); every pixel is part of the cube. */
function levels(c) {
	const h = c.topH + c.frontH;
	const out = new Uint8Array(c.w * h);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < c.w; x++) {
			let v;
			if (y < c.topH) {
				const edge = x === 0 || x === c.w - 1 || y === 0 || y === c.topH - 1;
				v = c.bevel && edge ? L.rim : L.top;
			} else if (y === c.topH) v = L.lip;
			else if (y === h - 1) v = L.base;
			else v = L.front;
			out[y * c.w + x] = v;
		}
	}
	for (const [x, y] of c.glint) out[y * c.w + x] = L.glint;
	return out;
}

/** One cube as a PNG (RGBA, grey, alpha 255). */
function renderCube(c) {
	const lv = levels(c);
	const h = c.topH + c.frontH;
	const png = new PNG({ width: c.w, height: h });
	for (let i = 0; i < c.w * h; i++) {
		png.data[i * 4] = lv[i];
		png.data[i * 4 + 1] = lv[i];
		png.data[i * 4 + 2] = lv[i];
		png.data[i * 4 + 3] = 255;
	}
	return PNG.sync.write(png, { colorType: 6 });
}

function main() {
	const out = path.resolve(process.argv[2] || path.join(__dirname, "..", "..", "art", "vendor", "kaleb-vale", "pellets"));
	fs.mkdirSync(out, { recursive: true });
	for (const c of CUBES) fs.writeFileSync(path.join(out, `${c.name}.png`), renderCube(c));
	console.log(`gen-pellet: ${CUBES.map((c) => `${c.name} ${c.w}x${c.topH + c.frontH}`).join(", ")} -> ${path.relative(process.cwd(), out)}`);
}

if (require.main === module) main();

module.exports = { CUBES, L, NORMAL, POWER, levels, renderCube };

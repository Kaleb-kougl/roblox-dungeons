#!/usr/bin/env node
/*
 * Atlas pipeline (docs/ART.md task S3): vendor art -> Roblox-sized atlases + a generated layout module.
 *
 *   art/atlases.json        (config, committed)   what to read, crops, facing order, frames kept, fps
 *   art/vendor.lock.json    (committed)           every source file the config reads: path, sha256, bytes
 *   art/vendor/**           (gitignored)          the raw packs (art/README.md says where to get them)
 *
 *   -> art/build/<sheet>.png             atlases and images to upload (<= 1024 px a side)
 *   -> art/build/contact/<id>.png        contact sheets: every animation x facing x frame on mid-grey, read back
 *                                        from the built atlases through the layout's cell formula; a white arrow
 *                                        in the margin shows each row's facing, a red cross the pivot
 *   -> src/shared/theme/packs/vale/layout.ts   generated (committed): frame sizes, pivots, cells, sheets by file name
 *   -> src/shared/theme/packs/vale/fxLayout.ts generated (committed): the sprite-effect atlas and the ambient particle
 *                                        textures (docs/FX_AUDIO.md F2, F6; config keys `fx` and `ambient`)
 *
 * Every sprite set has one cell size and one pivot (SpriteSetAsset): each frame of the set is cropped to the union
 * bounding box (alpha > noiseAlpha) over all its animations and facings, plus `pad`. Facings are written in the
 * SpriteSetAsset convention (zeroDeg 0, ccw true; facing d at d * 360 / count degrees from screen right). Every
 * output is alpha-bled: transparent pixels take the colour of the nearest opaque ones (alpha unchanged), so Roblox's
 * bilinear filter does not pull a white or black halo in from under the transparent pixels.
 *
 * Deterministic: same inputs -> byte-identical outputs (sorted iteration, integer maths on pixels, fixed deflate
 * options, no timestamps). Stale files in art/build are removed.
 *
 * Usage: node scripts/art/build-atlases.js          build (refuses if a source is missing or differs from the lock)
 *        node scripts/art/build-atlases.js --lock   rewrite art/vendor.lock.json from the files on disk
 * Plain Node plus pngjs.
 */
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const ROOT = path.resolve(__dirname, "..", "..");
const ART = path.join(ROOT, "art");
const VENDOR = path.join(ART, "vendor");
const CONFIG_FILE = path.join(ART, "atlases.json");
const LOCK_FILE = path.join(ART, "vendor.lock.json");
const BUILD = path.join(ART, "build");
const CONTACT = path.join(BUILD, "contact");
const LAYOUT_DIR = path.join(ROOT, "src", "shared", "theme", "packs", "vale");
const LAYOUT_FILE = path.join(LAYOUT_DIR, "layout.ts");
const FX_LAYOUT_FILE = path.join(LAYOUT_DIR, "fxLayout.ts");

/** Roblox stores images at most this many pixels on a side. */
const MAX_ATLAS = 1024;
/** Fixed PNG encoder options (determinism). */
const PNG_OPTIONS = { colorType: 6, inputColorType: 6, bitDepth: 8, deflateLevel: 9, deflateStrategy: 3, filterType: -1 };
/** Contact sheets. */
const CONTACT_BG = 128;
const CONTACT_GUTTER = 4;
const CONTACT_MARGIN = 48;
const CONTACT_SEPARATOR = 8;
const PRINT_WIDTH = 120;

function fail(message) {
	console.error(`art:build: ${message}`);
	process.exit(1);
}

// ---------------------------------------------------------------------------------------------
// Rasters: { w, h, data: Uint8Array RGBA, straight alpha }

function raster(w, h) {
	return { w, h, data: new Uint8Array(w * h * 4) };
}

const pngCache = new Map();

function readPng(rel) {
	let img = pngCache.get(rel);
	if (!img) {
		const png = PNG.sync.read(fs.readFileSync(path.join(VENDOR, rel)));
		img = { w: png.width, h: png.height, data: new Uint8Array(png.data) };
		pngCache.set(rel, img);
	}
	return img;
}

/** Copies src[sx.., sy..] (w x h) to dst at (dx, dy); pixels with alpha <= noiseAlpha or outside src become clear. */
function blit(src, sx, sy, w, h, dst, dx, dy, noiseAlpha) {
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const px = sx + x;
			const py = sy + y;
			const di = ((dy + y) * dst.w + dx + x) * 4;
			if (px < 0 || py < 0 || px >= src.w || py >= src.h) {
				dst.data.fill(0, di, di + 4);
				continue;
			}
			const si = (py * src.w + px) * 4;
			if (src.data[si + 3] <= noiseAlpha) dst.data.fill(0, di, di + 4);
			else for (let k = 0; k < 4; k++) dst.data[di + k] = src.data[si + k];
		}
	}
}

/** Bounding box [x0, y0, x1, y1] (inclusive) of pixels with alpha > threshold inside a region, or null. */
function alphaBounds(img, rx, ry, rw, rh, threshold) {
	let x0 = Infinity;
	let y0 = Infinity;
	let x1 = -1;
	let y1 = -1;
	for (let y = 0; y < rh; y++) {
		for (let x = 0; x < rw; x++) {
			if (img.data[((ry + y) * img.w + rx + x) * 4 + 3] > threshold) {
				if (x < x0) x0 = x;
				if (x > x1) x1 = x;
				if (y < y0) y0 = y;
				if (y > y1) y1 = y;
			}
		}
	}
	return x1 < 0 ? null : [x0, y0, x1, y1];
}

function unionBox(a, b) {
	if (!a) return b;
	if (!b) return a;
	return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

/**
 * Alpha bleed: every alpha-0 pixel gets the RGB of its nearest non-transparent pixels by wavefront dilation (each
 * wave takes the rounded mean of its already-filled 8-neighbours). Alpha is unchanged. An image with no visible
 * pixel is left as it is.
 */
function alphaBleed(img) {
	const { w, h, data } = img;
	const n = w * h;
	const filled = new Uint8Array(n);
	let frontier = [];
	for (let i = 0; i < n; i++) if (data[i * 4 + 3] > 0) filled[i] = 1;
	for (let i = 0; i < n; i++) {
		if (filled[i]) continue;
		if (hasFilledNeighbour(i)) frontier.push(i);
	}
	function hasFilledNeighbour(i) {
		const x = i % w;
		const y = (i - x) / w;
		for (let dy = -1; dy <= 1; dy++) {
			for (let dx = -1; dx <= 1; dx++) {
				const nx = x + dx;
				const ny = y + dy;
				if ((dx || dy) && nx >= 0 && ny >= 0 && nx < w && ny < h && filled[ny * w + nx] === 1) return true;
			}
		}
		return false;
	}
	while (frontier.length > 0) {
		const colours = new Array(frontier.length);
		for (let k = 0; k < frontier.length; k++) {
			const i = frontier[k];
			const x = i % w;
			const y = (i - x) / w;
			let r = 0;
			let g = 0;
			let b = 0;
			let c = 0;
			for (let dy = -1; dy <= 1; dy++) {
				for (let dx = -1; dx <= 1; dx++) {
					const nx = x + dx;
					const ny = y + dy;
					if ((dx || dy) && nx >= 0 && ny >= 0 && nx < w && ny < h && filled[ny * w + nx] === 1) {
						const j = (ny * w + nx) * 4;
						r += data[j];
						g += data[j + 1];
						b += data[j + 2];
						c++;
					}
				}
			}
			colours[k] = [Math.floor((r + c / 2) / c), Math.floor((g + c / 2) / c), Math.floor((b + c / 2) / c)];
		}
		const next = [];
		for (let k = 0; k < frontier.length; k++) {
			const i = frontier[k];
			data[i * 4] = colours[k][0];
			data[i * 4 + 1] = colours[k][1];
			data[i * 4 + 2] = colours[k][2];
			filled[i] = 2; // filled this wave; becomes a source next wave
		}
		for (let k = 0; k < frontier.length; k++) {
			const i = frontier[k];
			const x = i % w;
			const y = (i - x) / w;
			for (let dy = -1; dy <= 1; dy++) {
				for (let dx = -1; dx <= 1; dx++) {
					const nx = x + dx;
					const ny = y + dy;
					if ((dx || dy) && nx >= 0 && ny >= 0 && nx < w && ny < h && filled[ny * w + nx] === 0) {
						filled[ny * w + nx] = 3; // queued
						next.push(ny * w + nx);
					}
				}
			}
		}
		for (let k = 0; k < frontier.length; k++) filled[frontier[k]] = 1;
		next.sort((a, b) => a - b);
		for (let k = 0; k < next.length; k++) filled[next[k]] = 0;
		frontier = next;
	}
}

function encodePng(img) {
	const png = new PNG({ width: img.w, height: img.h });
	png.data = Buffer.from(img.data);
	return PNG.sync.write(png, PNG_OPTIONS);
}

// ---------------------------------------------------------------------------------------------
// Sources and the lock

function frameFileName(set, anim, d) {
	// Lords of Pain: <folder>/<dir>/<folder>_<dir>_<angle>_<frame>.png, angle = the facing's screen angle.
	const dir = set.facingDirs[d];
	const angle = ((d * 360) / set.facingCount).toFixed(1);
	return (frame) => `${set.source.dir}/${anim.folder}/${dir}/${anim.folder}_${dir}_${angle}_${frame}.png`;
}

/** Every source file the config reads, sorted. */
function sourceFiles(config) {
	const files = new Set();
	for (const id of Object.keys(config.spriteSets).sort()) {
		const set = config.spriteSets[id];
		for (const name of Object.keys(set.animations).sort()) {
			const anim = set.animations[name];
			if (anim.cellsOf) continue;
			if (set.source.type === "grid") files.add(`${set.source.dir}/${anim.file}`);
			else for (let d = 0; d < set.facingCount; d++) for (const f of anim.frames) files.add(frameFileName(set, anim, d)(f));
		}
	}
	for (const id of Object.keys(config.images).sort()) files.add(config.images[id].file);
	for (const id of fxIds(config)) files.add(config.fx.sets[id].file);
	for (const id of ambientIds(config)) files.add(config.ambient[id].file);
	return [...files].sort();
}

function hashFile(rel) {
	const bytes = fs.readFileSync(path.join(VENDOR, rel));
	return { path: rel, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
}

function missingHint(rel) {
	return `art/vendor/${rel} is missing. Download the packs into art/vendor/ as art/README.md describes.`;
}

function writeLock(config) {
	const entries = sourceFiles(config).map((rel) => {
		if (!fs.existsSync(path.join(VENDOR, rel))) fail(missingHint(rel));
		return hashFile(rel);
	});
	const lock = {
		$comment: "Generated by `npm run art:lock` from art/atlases.json: every source file the atlas pipeline reads (paths relative to art/vendor/).",
		files: entries,
	};
	fs.writeFileSync(LOCK_FILE, JSON.stringify(lock, null, "\t") + "\n");
	console.log(`art:lock: ${entries.length} file(s) -> ${path.relative(ROOT, LOCK_FILE)}`);
}

function checkLock(config) {
	if (!fs.existsSync(LOCK_FILE)) fail("art/vendor.lock.json is missing; run `npm run art:lock` once the packs are in art/vendor/.");
	const lock = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
	const locked = new Map(lock.files.map((e) => [e.path, e]));
	const problems = [];
	for (const rel of sourceFiles(config)) {
		const entry = locked.get(rel);
		if (!entry) {
			problems.push(`${rel}: read by art/atlases.json but not in art/vendor.lock.json (run \`npm run art:lock\` if the config changed on purpose)`);
			continue;
		}
		if (!fs.existsSync(path.join(VENDOR, rel))) {
			problems.push(missingHint(rel));
			continue;
		}
		const actual = hashFile(rel);
		if (actual.sha256 !== entry.sha256 || actual.bytes !== entry.bytes) {
			problems.push(`${rel}: differs from the lock (sha256 ${actual.sha256.slice(0, 12)}.., ${actual.bytes} bytes; locked ${entry.sha256.slice(0, 12)}.., ${entry.bytes} bytes)`);
		}
	}
	if (problems.length > 0) fail(`source art does not match art/vendor.lock.json:\n  ${problems.join("\n  ")}`);
}

// ---------------------------------------------------------------------------------------------
// Sprite sets

/** Source region of frame `frame` (a source frame number) of facing d (output order) of a real animation. */
function sourceRegion(set, anim, d, frame) {
	const { source } = set;
	if (source.type === "grid") {
		const img = readPng(`${source.dir}/${anim.file}`);
		const cols = Math.floor(img.w / source.frameW);
		const rows = Math.floor(img.h / source.frameH);
		const row = set.rowForFacing[d];
		if (frame >= cols || row >= rows) throw new Error(`${anim.file}: frame ${frame} row ${row} outside the ${cols}x${rows} grid`);
		return { img, x: frame * source.frameW, y: row * source.frameH, w: source.frameW, h: source.frameH };
	}
	if (source.type === "frames") {
		const rel = frameFileName(set, anim, d)(frame);
		if (!fs.existsSync(path.join(VENDOR, rel))) fail(`${missingHint(rel)} (or facingDirs does not match the folder angles)`);
		const img = readPng(rel);
		if (img.w !== source.frameW || img.h !== source.frameH) throw new Error(`${rel}: ${img.w}x${img.h}, expected ${source.frameW}x${source.frameH}`);
		return { img, x: 0, y: 0, w: img.w, h: img.h };
	}
	throw new Error(`unknown source type ${source.type}`);
}

/** Resolves a stand-in to the animation whose cells it reuses. */
function realAnimation(set, name) {
	const anim = set.animations[name];
	if (!anim) throw new Error(`no animation ${name}`);
	return anim.cellsOf ? { name: anim.cellsOf, anim: set.animations[anim.cellsOf] } : { name, anim };
}

function buildSpriteSet(id, set) {
	const count = set.facingCount;
	if (![1, 4, 8, 16].includes(count)) throw new Error(`${id}: facingCount ${count}`);
	const order = set.source.type === "grid" ? set.rowForFacing : set.facingDirs;
	if (!order || order.length !== count) throw new Error(`${id}: need ${count} entries of facing order`);
	if (set.source.type === "grid" && [...order].sort((a, b) => a - b).join() !== [...Array(count).keys()].join()) {
		throw new Error(`${id}: rowForFacing must be a permutation of 0..${count - 1}`);
	}
	const realNames = Object.keys(set.animations).filter((n) => !set.animations[n].cellsOf);

	// 1. union crop box (source-frame coordinates) over every kept frame of every real animation and facing
	let box = null;
	for (const name of realNames) {
		const anim = set.animations[name];
		for (let d = 0; d < count; d++) {
			for (const f of anim.frames) {
				const r = sourceRegion(set, anim, d, f);
				box = unionBox(box, alphaBounds(r.img, r.x, r.y, r.w, r.h, set.noiseAlpha));
			}
		}
	}
	if (!box) throw new Error(`${id}: no visible pixels`);
	const pad = set.pad;
	const originX = box[0] - pad;
	const originY = box[1] - pad;
	const frameW = box[2] - box[0] + 1 + 2 * pad;
	const frameH = box[3] - box[1] + 1 + 2 * pad;

	// 2. pivot (feet) and texel density, measured on one frame; the other facings are printed as a sanity check
	const measureBody = (animName, d, k) => {
		const { anim } = realAnimation(set, animName);
		const r = sourceRegion(set, anim, d, anim.frames[k]);
		const { bodyAlpha, bodyMinRgb } = set.pivot;
		const isBody = (x, y) => {
			const i = ((r.y + y) * r.img.w + r.x + x) * 4;
			const data = r.img.data;
			return data[i + 3] > bodyAlpha && Math.max(data[i], data[i + 1], data[i + 2]) > bodyMinRgb;
		};
		let b = null;
		for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) if (isBody(x, y)) b = unionBox(b, [x, y, x, y]);
		if (!b) throw new Error(`${id}: no body pixels in ${animName} facing ${d} frame ${k}`);
		let fx0 = Infinity;
		let fx1 = -1;
		for (let y = b[3] - set.pivot.footBand + 1; y <= b[3]; y++) {
			for (let x = 0; x < r.w; x++) {
				if (isBody(x, y)) {
					fx0 = Math.min(fx0, x);
					fx1 = Math.max(fx1, x);
				}
			}
		}
		return { feetX: (fx0 + fx1 + 1) / 2, feetY: b[3] + 1, height: b[3] - b[1] + 1 };
	};
	const m = set.pivot.measure;
	const body = measureBody(m.animation, m.facing, m.frame);
	const pivot = { x: Math.round(body.feetX) - originX, y: body.feetY - originY };
	const pixelsPerTile = Math.round((body.height / set.bodyTiles) * 10) / 10;
	const sanity = [];
	for (let d = 0; d < count; d++) {
		const s = measureBody(m.animation, d, m.frame);
		sanity.push(`${d}:(${s.feetX - originX},${s.feetY - originY})h${s.height}`);
	}

	// 3. sheets: each sheet holds its animations back to back, facing-major
	const sheets = [];
	const animations = {};
	set.sheets.forEach((sheetDef, sheetIndex) => {
		let cells = 0;
		const placed = [];
		for (const name of sheetDef.animations) {
			const anim = set.animations[name];
			if (!anim || anim.cellsOf) throw new Error(`${id}: sheet ${sheetDef.name} lists ${name}, which is not a real animation`);
			if (animations[name]) throw new Error(`${id}: ${name} is in two sheets`);
			animations[name] = { sheet: sheetIndex, start: cells, frames: anim.frames.length, fps: anim.fps, loop: anim.loop };
			placed.push({ name, anim, start: cells });
			cells += anim.frames.length * count;
		}
		const { cols, rows } = chooseGrid(cells, frameW, frameH, `${id} sheet ${sheetDef.name}`);
		const img = raster(cols * frameW, rows * frameH);
		for (const p of placed) {
			for (let d = 0; d < count; d++) {
				p.anim.frames.forEach((f, k) => {
					const cell = p.start + d * p.anim.frames.length + k;
					const r = sourceRegion(set, p.anim, d, f);
					blit(r.img, r.x + originX, r.y + originY, frameW, frameH, img, (cell % cols) * frameW, Math.floor(cell / cols) * frameH, set.noiseAlpha);
				});
			}
		}
		alphaBleed(img);
		sheets.push({ name: sheetDef.name, file: `${sheetDef.name}.png`, img, cells });
	});
	for (const name of realNames) if (!animations[name]) throw new Error(`${id}: ${name} is in no sheet`);
	for (const name of Object.keys(set.animations)) {
		const anim = set.animations[name];
		if (!anim.cellsOf) continue;
		const target = animations[anim.cellsOf];
		if (!target) throw new Error(`${id}: ${name} reuses ${anim.cellsOf}, which has no cells`);
		const frames = anim.frames === undefined ? target.frames : anim.frames;
		if (frames > target.frames) throw new Error(`${id}: ${name} wants ${frames} frames of ${anim.cellsOf}'s ${target.frames}`);
		const def = { sheet: target.sheet, start: target.start, frames, fps: anim.fps, loop: anim.loop };
		if (frames !== target.frames) def.stride = target.frames;
		animations[name] = def;
	}

	const layout = {
		frameW,
		frameH,
		pivot,
		pixelsPerTile,
		resample: set.resample,
		facings: { count, zeroDeg: 0, ccw: true },
		sheets: sheets.map((s) => ({ file: s.file, w: s.img.w, h: s.img.h })),
		animations: sortedObject(animations),
	};
	selfCheck(id, layout);
	return { id, layout, sheets, sanity, bodyHeight: body.height, box };
}

/** Columns x rows of frameW x frameH cells for `cells` cells, within MAX_ATLAS, smallest area (then narrowest). */
function chooseGrid(cells, frameW, frameH, what) {
	const maxCols = Math.floor(MAX_ATLAS / frameW);
	const maxRows = Math.floor(MAX_ATLAS / frameH);
	let best = null;
	for (let cols = 1; cols <= maxCols; cols++) {
		const rows = Math.ceil(cells / cols);
		if (rows > maxRows) continue;
		const area = cols * frameW * rows * frameH;
		if (!best || area < best.area) best = { cols, rows, area };
	}
	if (!best) {
		throw new Error(`${what}: ${cells} cells of ${frameW}x${frameH} do not fit one ${MAX_ATLAS}x${MAX_ATLAS} atlas (max ${maxCols * maxRows}); split it or keep fewer frames`);
	}
	return best;
}

/** Every referenced cell lies inside its sheet, which is within MAX_ATLAS (the SpriteSetAsset cell formula). */
function selfCheck(id, layout) {
	for (const s of layout.sheets) {
		if (s.w > MAX_ATLAS || s.h > MAX_ATLAS) throw new Error(`${id}: ${s.file} is ${s.w}x${s.h} (> ${MAX_ATLAS})`);
		if (s.w % layout.frameW !== 0 || s.h % layout.frameH !== 0) throw new Error(`${id}: ${s.file} is not a whole number of cells`);
	}
	for (const name of Object.keys(layout.animations)) {
		const a = layout.animations[name];
		const sheet = layout.sheets[a.sheet];
		if (!sheet) throw new Error(`${id}.${name}: sheet ${a.sheet} missing`);
		const perRow = Math.floor(sheet.w / layout.frameW);
		for (let d = 0; d < layout.facings.count; d++) {
			for (let f = 0; f < a.frames; f++) {
				const cell = a.start + d * (a.stride === undefined ? a.frames : a.stride) + f;
				const x = (cell % perRow) * layout.frameW;
				const y = Math.floor(cell / perRow) * layout.frameH;
				if (x + layout.frameW > sheet.w || y + layout.frameH > sheet.h) {
					throw new Error(`${id}.${name}: facing ${d} frame ${f} -> cell ${cell} at (${x}, ${y}) outside ${sheet.file} ${sheet.w}x${sheet.h}`);
				}
			}
		}
	}
	if (layout.pivot.x < 0 || layout.pivot.y < 0 || layout.pivot.x > layout.frameW || layout.pivot.y > layout.frameH) {
		throw new Error(`${id}: pivot (${layout.pivot.x}, ${layout.pivot.y}) outside the ${layout.frameW}x${layout.frameH} cell`);
	}
}

// ---------------------------------------------------------------------------------------------
// Contact sheets (read back from the built atlases through the layout)

function fillRect(img, x, y, w, h, rgb) {
	for (let yy = Math.max(0, y); yy < Math.min(img.h, y + h); yy++) {
		for (let xx = Math.max(0, x); xx < Math.min(img.w, x + w); xx++) {
			const i = (yy * img.w + xx) * 4;
			img.data[i] = rgb[0];
			img.data[i + 1] = rgb[1];
			img.data[i + 2] = rgb[2];
			img.data[i + 3] = 255;
		}
	}
}

/** Composites src (straight alpha) over an opaque dst at (dx, dy). */
function over(src, sx, sy, w, h, dst, dx, dy) {
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const si = ((sy + y) * src.w + sx + x) * 4;
			const di = ((dy + y) * dst.w + dx + x) * 4;
			const a = src.data[si + 3];
			for (let k = 0; k < 3; k++) dst.data[di + k] = Math.floor((src.data[si + k] * a + dst.data[di + k] * (255 - a) + 127) / 255);
		}
	}
}

/** A white arrow from (cx, cy) towards screen angle `deg` (0 = right, 90 = up), red tip. Integer pixels only. */
function arrow(img, cx, cy, deg, len) {
	const rad = (deg * Math.PI) / 180;
	const ex = Math.round(cx + Math.cos(rad) * len);
	const ey = Math.round(cy - Math.sin(rad) * len);
	const steps = len * 2;
	for (let s = 0; s <= steps; s++) {
		const x = Math.round(cx + ((ex - cx) * s) / steps);
		const y = Math.round(cy + ((ey - cy) * s) / steps);
		fillRect(img, x - 1, y - 1, 3, 3, [240, 240, 240]);
	}
	fillRect(img, ex - 2, ey - 2, 5, 5, [220, 40, 40]);
	fillRect(img, cx - 2, cy - 2, 5, 5, [40, 40, 40]);
}

function contactSheet(result) {
	const { layout } = result;
	const names = Object.keys(layout.animations);
	const maxFrames = Math.max(...names.map((n) => layout.animations[n].frames));
	const cellW = layout.frameW + CONTACT_GUTTER;
	const cellH = layout.frameH + CONTACT_GUTTER;
	const w = CONTACT_MARGIN + maxFrames * cellW;
	const h = names.length * (layout.facings.count * cellH + CONTACT_SEPARATOR);
	const img = raster(w, h);
	fillRect(img, 0, 0, w, h, [CONTACT_BG, CONTACT_BG, CONTACT_BG]);
	const sheetImgs = result.sheets.map((s) => s.img);
	let y = 0;
	for (const name of names) {
		const a = layout.animations[name];
		const sheet = layout.sheets[a.sheet];
		const perRow = Math.floor(sheet.w / layout.frameW);
		for (let d = 0; d < layout.facings.count; d++) {
			arrow(img, CONTACT_MARGIN / 2, y + Math.floor(cellH / 2), (d * 360) / layout.facings.count, Math.floor(CONTACT_MARGIN / 2) - 6);
			for (let f = 0; f < a.frames; f++) {
				const cell = a.start + d * (a.stride === undefined ? a.frames : a.stride) + f;
				const dx = CONTACT_MARGIN + f * cellW + CONTACT_GUTTER / 2;
				const dy = y + CONTACT_GUTTER / 2;
				fillRect(img, dx - 1, dy - 1, layout.frameW + 2, layout.frameH + 2, [96, 96, 96]);
				fillRect(img, dx, dy, layout.frameW, layout.frameH, [CONTACT_BG, CONTACT_BG, CONTACT_BG]);
				over(sheetImgs[a.sheet], (cell % perRow) * layout.frameW, Math.floor(cell / perRow) * layout.frameH, layout.frameW, layout.frameH, img, dx, dy);
				fillRect(img, dx + layout.pivot.x - 3, dy + layout.pivot.y, 7, 1, [230, 30, 30]);
				fillRect(img, dx + layout.pivot.x, dy + layout.pivot.y - 3, 1, 7, [230, 30, 30]);
			}
			y += cellH;
		}
		fillRect(img, 0, y + 2, w, CONTACT_SEPARATOR - 4, [40, 40, 40]);
		y += CONTACT_SEPARATOR;
	}
	return img;
}

// ---------------------------------------------------------------------------------------------
// Images

function buildImage(id, def) {
	const src = readPng(def.file);
	let img;
	let pivot;
	if (def.crop === "none") {
		img = raster(src.w, src.h);
		blit(src, 0, 0, src.w, src.h, img, 0, 0, -1);
	} else if (def.crop === "alpha") {
		const b = alphaBounds(src, 0, 0, src.w, src.h, def.noiseAlpha);
		if (!b) throw new Error(`${id}: no visible pixels`);
		const w = b[2] - b[0] + 1 + 2 * def.pad;
		const h = b[3] - b[1] + 1 + 2 * def.pad;
		img = raster(w, h);
		blit(src, b[0] - def.pad, b[1] - def.pad, w, h, img, 0, 0, def.noiseAlpha);
	} else throw new Error(`${id}: unknown crop ${def.crop}`);
	if (def.pivot === "center") pivot = { x: img.w / 2, y: img.h / 2 };
	else if (def.pivot === "bottom") pivot = { x: img.w / 2, y: img.h - def.pad };
	else if (def.pivot !== undefined) throw new Error(`${id}: unknown pivot ${def.pivot}`);
	if (img.w > MAX_ATLAS || img.h > MAX_ATLAS) throw new Error(`${id}: ${img.w}x${img.h} > ${MAX_ATLAS}`);

	let meanHex;
	if (def.meanHex) {
		const sum = [0, 0, 0];
		for (let i = 0; i < img.w * img.h; i++) for (let k = 0; k < 3; k++) sum[k] += img.data[i * 4 + k];
		const n = img.w * img.h;
		meanHex = "#" + sum.map((s) => Math.floor((2 * s + n) / (2 * n)).toString(16).padStart(2, "0")).join("");
	}
	alphaBleed(img);
	const layout = { file: `${def.name}.png`, w: img.w, h: img.h };
	if (def.tilesPerImage !== undefined) layout.tilesPerImage = def.tilesPerImage;
	if (pivot) layout.pivot = pivot;
	return { id, name: def.name, img, layout, meanHex };
}

// ---------------------------------------------------------------------------------------------
// layout.ts (emitted already in prettier's format: tabs, every object expanded, keys quoted only where needed)

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function sortedObject(o) {
	const out = {};
	for (const k of Object.keys(o).sort()) out[k] = o[k];
	return out;
}

const TAB_WIDTH = 4;

function tsKey(k) {
	return IDENT.test(k) ? k : JSON.stringify(k);
}

function isLeaf(v) {
	return v === null || typeof v !== "object";
}

/** A one-line rendering of a primitive, a flat object or an array of those, or null. */
function tsInline(v) {
	if (isLeaf(v)) return tsValue(v, 0, 0);
	if (Array.isArray(v)) {
		// prettier always breaks an array of two or more non-empty objects
		if (v.length > 1 && v.every((x) => !isLeaf(x) && !Array.isArray(x) && Object.keys(x).length > 0)) return null;
		const parts = v.map(tsInline);
		return parts.includes(null) ? null : `[${parts.join(", ")}]`;
	}
	const keys = Object.keys(v).filter((k) => v[k] !== undefined);
	if (!keys.every((k) => isLeaf(v[k]))) return null;
	return keys.length === 0 ? "{}" : `{ ${keys.map((k) => `${tsKey(k)}: ${tsValue(v[k], 0, 0)}`).join(", ")} }`;
}

/**
 * Prettier's layout for this data: flat objects and arrays stay on one line when they fit (`used` = columns before the
 * value, +1 for the trailing comma or semicolon), anything else is expanded one entry per line.
 */
function tsValue(v, depth, used) {
	const pad = "\t".repeat(depth);
	if (typeof v === "string") return JSON.stringify(v);
	if (typeof v === "number") {
		if (!Number.isFinite(v)) throw new Error("non-finite number in layout");
		return String(v);
	}
	if (typeof v === "boolean") return v ? "true" : "false";
	const inline = tsInline(v);
	if (inline !== null && used + inline.length + 1 <= PRINT_WIDTH) return inline;
	const inner = (depth + 1) * TAB_WIDTH;
	if (Array.isArray(v)) {
		if (v.length === 0) return "[]";
		return `[\n${v.map((x) => `${pad}\t${tsValue(x, depth + 1, inner)},\n`).join("")}${pad}]`;
	}
	const keys = Object.keys(v).filter((k) => v[k] !== undefined);
	const lines = keys.map((k) => `${pad}\t${tsKey(k)}: ${tsValue(v[k], depth + 1, inner + tsKey(k).length + 2)},\n`);
	return `{\n${lines.join("")}${pad}}`;
}

function comment(lines) {
	return lines.map((l) => (l ? ` * ${l}` : " *")).join("\n");
}

function layoutModule(sets, images, floorHex) {
	const spriteLayouts = {};
	for (const s of sets) spriteLayouts[s.id] = s.layout;
	const imageLayouts = {};
	for (const i of images) imageLayouts[i.id] = i.layout;
	const out = [
		"// GENERATED by `npm run art:build` (scripts/art/build-atlases.js) from art/atlases.json. Do not edit.",
		"",
		"/**",
		comment([
			"Layout of the `vale` pack's sprite atlases and images (docs/ART.md task S3). No asset IDs: `file` names the",
			"PNG in art/build/ to upload; the pack manifest pairs each file with its uploaded `rbxassetid://`.",
			"Sprite sets follow SpriteSetAsset (cell `start + d * (stride ?? frames) + f`, row-major; facings zeroDeg 0,",
			"counter-clockwise, 0 = screen right, 90 = screen up).",
		]),
		" */",
		"",
		'import type { HexColor, Pivot, SpriteSetAsset } from "../../types";',
		"",
		"/** An atlas PNG in art/build/, by file name. */",
		"export interface ValeSheetFile {",
		"\tfile: string;",
		"\tw: number;",
		"\th: number;",
		"}",
		"",
		"/** SpriteSetAsset without `kind`, with sheets named by file instead of asset ID. */",
		'export interface ValeSpriteLayout extends Omit<SpriteSetAsset, "kind" | "sheets"> {',
		"\tsheets: Array<ValeSheetFile>;",
		"}",
		"",
		"/** A single image in art/build/. `pivot` (pixels from the top-left) is where it is anchored, when it matters. */",
		"export interface ValeImageLayout extends ValeSheetFile {",
		"\ttilesPerImage?: number;",
		"\tpivot?: Pivot;",
		"}",
		"",
		`export const VALE_SPRITE_LAYOUTS: Record<string, ValeSpriteLayout> = ${tsValue(spriteLayouts, 0, PRINT_WIDTH)};`,
		"",
		`export const VALE_IMAGE_LAYOUTS: Record<string, ValeImageLayout> = ${tsValue(imageLayouts, 0, PRINT_WIDTH)};`,
		"",
		"/** Rounded mean colour of the biome.1 floor texture (tile.biome.1.floor): the `biome.1` floor colour. */",
		`export const VALE_FLOOR_HEX: HexColor = ${JSON.stringify(floorHex)};`,
		"",
	];
	const text = out.join("\n");
	for (const line of text.split("\n")) {
		const width = line.replace(/\t/g, "    ").length;
		if (width > PRINT_WIDTH) throw new Error(`layout.ts line over ${PRINT_WIDTH} columns: ${line}`);
	}
	return text;
}

// ---------------------------------------------------------------------------------------------
// Sprite effects and ambient particle textures (docs/FX_AUDIO.md F2, F6; config keys `fx` and `ambient`)

/** Contact sheets of effects: cells scaled this much (pixel art 24-66 px), with this gap and label row. */
const FX_CONTACT_SCALE = 4;
const FX_CONTACT_GAP = 8;
const FX_CONTACT_LABEL = 14;
/** Rec. 601 luma weights, per mille (integer maths). */
const LUMA = [299, 587, 114];
/** Per-mille fixed point. */
const MILLE = 1000;
/** ParticleEmitter flipbook grids (Grid2x2 / Grid4x4 / Grid8x8), 1 = a single frame. */
const AMBIENT_GRIDS = [1, 2, 4, 8];
/** Flipbook modes the theme accepts (shared/theme contract PARTICLE_FLIPBOOK_MODES). */
const AMBIENT_MODES = ["Loop", "OneShot", "PingPong", "Random"];

function fxIds(config) {
	return config.fx ? Object.keys(config.fx.sets).sort() : [];
}

function ambientIds(config) {
	return config.ambient ? Object.keys(config.ambient).filter((k) => !k.startsWith("$")).sort() : [];
}

/** The frames of a horizontal strip (frameW wide, the strip's height), `keep` (default all) in order. */
function stripFrames(what, def) {
	const src = readPng(def.file);
	if (src.w !== def.frameW * def.frames) {
		throw new Error(`${what}: ${def.file} is ${src.w} px wide, not ${def.frames} frames x ${def.frameW} px`);
	}
	const keep = def.keep || [...Array(def.frames).keys()];
	return keep.map((f) => {
		if (!(f >= 0 && f < def.frames)) throw new Error(`${what}: keep frame ${f} outside 0..${def.frames - 1}`);
		const img = raster(def.frameW, src.h);
		blit(src, f * def.frameW, 0, def.frameW, src.h, img, 0, 0, 0);
		return img;
	});
}

/** Straight-alpha src over dst at (dx, dy), src alpha scaled by `permille`; outside dst is clipped. Integer maths. */
function compositeOver(src, dst, dx, dy, permille) {
	for (let y = 0; y < src.h; y++) {
		for (let x = 0; x < src.w; x++) {
			const tx = dx + x;
			const ty = dy + y;
			if (tx < 0 || ty < 0 || tx >= dst.w || ty >= dst.h) continue;
			const si = (y * src.w + x) * 4;
			const a = Math.floor((src.data[si + 3] * permille + MILLE / 2) / MILLE);
			if (a === 0) continue;
			const di = (ty * dst.w + tx) * 4;
			const da = dst.data[di + 3];
			const outA = a + Math.floor((da * (255 - a) + 127) / 255);
			for (let k = 0; k < 3; k++) {
				const num = src.data[si + k] * a * 255 + dst.data[di + k] * da * (255 - a);
				dst.data[di + k] = Math.floor((num + (outA * 255) / 2) / (outA * 255));
			}
			dst.data[di + 3] = outA;
		}
	}
}

/** A particle strip's pieces composed into a burst (def.burst; see the `fx` $comment in art/atlases.json). */
function burstFrames(what, def) {
	const b = def.burst;
	const pieces = stripFrames(what, def).map((img) => {
		const box = alphaBounds(img, 0, 0, img.w, img.h, 0);
		if (!box) throw new Error(`${what}: an empty piece`);
		const w = box[2] - box[0] + 1;
		const h = box[3] - box[1] + 1;
		const piece = raster(w, h);
		blit(img, box[0], box[1], w, h, piece, 0, 0, 0);
		return piece;
	});
	if (!(b.frames >= 2) || !(b.fadeFrom >= 0 && b.fadeFrom < b.frames)) throw new Error(`${what}: bad burst frames`);
	const out = [];
	const c = Math.floor(b.cell / 2);
	const span = b.frames - 1;
	for (let f = 0; f < b.frames; f++) {
		const img = raster(b.cell, b.cell);
		const r = b.radiusFrom + Math.floor(((b.radiusTo - b.radiusFrom) * f * 2 + span) / (2 * span));
		const fade = f < b.fadeFrom ? MILLE : Math.floor(((b.frames - f) * MILLE) / (b.frames - b.fadeFrom));
		pieces.forEach((piece, k) => {
			const [dx, dy] = b.dirs[k % b.dirs.length];
			const px = c + Math.floor((dx * r + MILLE / 2) / MILLE) - Math.floor(piece.w / 2);
			const py = c - Math.floor((dy * r + MILLE / 2) / MILLE) - Math.floor(piece.h / 2);
			compositeOver(piece, img, px, py, Math.min(MILLE, fade));
		});
		out.push(img);
	}
	return out;
}

/** Alpha-weighted mean colour "#rrggbb" of the visible pixels of `imgs`. */
function meanColor(imgs) {
	const sum = [0, 0, 0];
	let weight = 0;
	for (const img of imgs) {
		for (let i = 0; i < img.w * img.h; i++) {
			const a = img.data[i * 4 + 3];
			weight += a;
			for (let k = 0; k < 3; k++) sum[k] += img.data[i * 4 + k] * a;
		}
	}
	if (weight === 0) throw new Error("meanColor of nothing");
	return "#" + sum.map((s) => Math.floor((2 * s + weight) / (2 * weight)).toString(16).padStart(2, "0")).join("");
}

/** Greys `imgs` in place: luminance stretched so the brightest visible pixel of all of them is white; alpha kept. */
function greyInPlace(imgs) {
	const luma = (d, i) => Math.floor((LUMA[0] * d[i] + LUMA[1] * d[i + 1] + LUMA[2] * d[i + 2] + MILLE / 2) / MILLE);
	let max = 0;
	for (const img of imgs) {
		for (let i = 0; i < img.w * img.h; i++) if (img.data[i * 4 + 3] > 0) max = Math.max(max, luma(img.data, i * 4));
	}
	for (const img of imgs) {
		for (let i = 0; i < img.w * img.h; i++) {
			const p = i * 4;
			const v = max > 0 ? Math.floor((luma(img.data, p) * 255 * 2 + max) / (2 * max)) : 0;
			img.data[p] = v;
			img.data[p + 1] = v;
			img.data[p + 2] = v;
		}
	}
}

/** One effect set: its frames cropped to their union alpha box (+ pad), greyed or measured. */
function buildFxSet(id, def, pad) {
	if (def.preview === undefined && def.fps === undefined) throw new Error(`${id}: no preview timing and no fps`);
	const fps = def.fps !== undefined ? def.fps : Math.round((10 * MILLE) / def.preview.ms) / 10;
	if (def.preview !== undefined && def.preview.frames !== def.frames && !def.previewNote) {
		throw new Error(`${id}: Preview.gif shows ${def.preview.frames} frames, the strip ${def.frames}: add a previewNote`);
	}
	const raw = def.burst ? burstFrames(id, def) : stripFrames(id, def);
	let box = null;
	for (const img of raw) box = unionBox(box, alphaBounds(img, 0, 0, img.w, img.h, 0));
	if (!box) throw new Error(`${id}: no visible pixels`);
	const frameW = box[2] - box[0] + 1 + 2 * pad;
	const frameH = box[3] - box[1] + 1 + 2 * pad;
	const frames = raw.map((img) => {
		const cell = raster(frameW, frameH);
		blit(img, box[0] - pad, box[1] - pad, frameW, frameH, cell, 0, 0, 0);
		return cell;
	});
	const grey = def.grey === true;
	const mean = grey ? undefined : meanColor(frames);
	if (grey) greyInPlace(frames);
	return { id, def, frames, frameW, frameH, fps, loop: def.loop === true, grey, meanColor: mean, box, sourceH: raw[0].h };
}

/**
 * Packs every effect set into one atlas: each set a band of rows starting at x 0 and at a y that is a multiple of its
 * frame height, so a set's frames are cells `start .. start + frames - 1` of the SpriteSetAsset formula with perRow =
 * floor(atlas w / frameW). Bands by frame height (tallest first, then id); the width with the smallest area wins
 * (then the narrowest).
 */
function packFx(sets) {
	const order = [...sets].sort((a, b) => b.frameH - a.frameH || (a.id < b.id ? -1 : 1));
	const minW = Math.max(...sets.map((s) => s.frameW));
	let best = null;
	for (let w = minW; w <= MAX_ATLAS; w++) {
		let y = 0;
		const placed = [];
		for (const s of order) {
			const perRow = Math.floor(w / s.frameW);
			const y0 = Math.ceil(y / s.frameH) * s.frameH;
			placed.push({ s, y0, perRow, start: (y0 / s.frameH) * perRow });
			y = y0 + Math.ceil(s.frames.length / perRow) * s.frameH;
		}
		if (y > MAX_ATLAS) continue;
		if (!best || w * y < best.w * best.h) best = { w, h: y, placed };
	}
	if (!best) throw new Error(`fx: the effects do not fit one ${MAX_ATLAS}x${MAX_ATLAS} atlas`);
	const img = raster(best.w, best.h);
	let used = 0;
	for (const p of best.placed) {
		p.s.frames.forEach((cell, f) => {
			const c = p.start + f;
			blit(cell, 0, 0, p.s.frameW, p.s.frameH, img, (c % p.perRow) * p.s.frameW, Math.floor(c / p.perRow) * p.s.frameH, -1);
		});
		used += p.s.frames.length * p.s.frameW * p.s.frameH;
	}
	alphaBleed(img);
	return { img, w: best.w, h: best.h, placed: best.placed, used };
}

function fxLayoutOf(p) {
	const s = p.s;
	const out = {
		frameW: s.frameW,
		frameH: s.frameH,
		pivot: { x: s.frameW / 2, y: s.frameH / 2 },
		start: p.start,
		frames: s.frames.length,
		fps: s.fps,
		loop: s.loop,
		grey: s.grey,
	};
	if (s.meanColor !== undefined) out.meanColor = s.meanColor;
	return out;
}

/** The cell of frame f of a placed set, read through the layout's formula (start + f, perRow = floor(w / frameW)). */
function fxCellAt(atlasW, layout, f) {
	const perRow = Math.floor(atlasW / layout.frameW);
	const c = layout.start + f;
	return [(c % perRow) * layout.frameW, Math.floor(c / perRow) * layout.frameH];
}

// 3x5 digits for contact-sheet frame labels.
const DIGITS = ["111101101101111", "010110010010111", "111001111100111", "111001111001111", "101101111001001", "111100111001111", "111100111101111", "111001001001001", "111101111101111", "111101111001111"];

function drawNumber(img, x, y, n, scale, rgb) {
	const text = String(n);
	for (let i = 0; i < text.length; i++) {
		const bits = DIGITS[text.charCodeAt(i) - 48];
		for (let k = 0; k < 15; k++) {
			if (bits[k] === "1") fillRect(img, x + (i * 4 + (k % 3)) * scale, y + Math.floor(k / 3) * scale, scale, scale, rgb);
		}
	}
}

/** Frames side by side at FX_CONTACT_SCALE on mid-grey, each labelled with its index; a red cross on the pivot. */
function scaledContact(cells, w, h, pivot) {
	const S = FX_CONTACT_SCALE;
	const cw = w * S + FX_CONTACT_GAP;
	const out = raster(FX_CONTACT_GAP + cells.length * cw, FX_CONTACT_LABEL + h * S + FX_CONTACT_GAP);
	fillRect(out, 0, 0, out.w, out.h, [CONTACT_BG, CONTACT_BG, CONTACT_BG]);
	cells.forEach(([src, sx, sy], f) => {
		const ox = FX_CONTACT_GAP + f * cw;
		const oy = FX_CONTACT_LABEL;
		drawNumber(out, ox, 2, f, 2, [240, 240, 240]);
		fillRect(out, ox - 1, oy - 1, w * S + 2, h * S + 2, [96, 96, 96]);
		fillRect(out, ox, oy, w * S, h * S, [CONTACT_BG, CONTACT_BG, CONTACT_BG]);
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				const si = ((sy + y) * src.w + sx + x) * 4;
				const a = src.data[si + 3];
				if (a === 0) continue;
				const rgb = [0, 1, 2].map((k) => Math.floor((src.data[si + k] * a + CONTACT_BG * (255 - a) + 127) / 255));
				fillRect(out, ox + x * S, oy + y * S, S, S, rgb);
			}
		}
		if (pivot) {
			fillRect(out, ox + Math.floor(pivot.x * S) - 6, oy + Math.floor(pivot.y * S), 13, 1, [230, 30, 30]);
			fillRect(out, ox + Math.floor(pivot.x * S), oy + Math.floor(pivot.y * S) - 6, 1, 13, [230, 30, 30]);
		}
	});
	return out;
}

function nextPow2(n) {
	let p = 1;
	while (p < n) p *= 2;
	return p;
}

/** An ambient particle texture: grid x grid power-of-two square cells, the strip frame centred in each, greyed. */
function buildAmbient(id, def) {
	if (!AMBIENT_GRIDS.includes(def.grid)) throw new Error(`${id}: grid ${def.grid} (one of ${AMBIENT_GRIDS.join(", ")})`);
	if (def.grid > 1 && !AMBIENT_MODES.includes(def.mode)) throw new Error(`${id}: mode ${def.mode} (${AMBIENT_MODES.join(", ")})`);
	if (def.grid > 1 && !(def.fps > 0)) throw new Error(`${id}: a flipbook needs fps > 0`);
	const frames = stripFrames(id, def);
	const n = def.grid * def.grid;
	const cells = def.cells || [...Array(n).keys()].map((i) => Math.floor((i * frames.length) / n));
	if (cells.length !== n) throw new Error(`${id}: ${cells.length} cells for a ${def.grid}x${def.grid} grid`);
	const cell = nextPow2(Math.max(def.frameW, frames[0].h));
	const side = cell * def.grid;
	if (side > MAX_ATLAS) throw new Error(`${id}: ${side} px > ${MAX_ATLAS}`);
	const img = raster(side, side);
	const ox = Math.floor((cell - def.frameW) / 2);
	const oy = Math.floor((cell - frames[0].h) / 2);
	cells.forEach((f, i) => {
		const src = frames[f];
		if (!src) throw new Error(`${id}: cell frame ${f} outside 0..${frames.length - 1}`);
		blit(src, 0, 0, src.w, src.h, img, (i % def.grid) * cell + ox, Math.floor(i / def.grid) * cell + oy, 0);
	});
	greyInPlace([img]);
	alphaBleed(img);
	const layout = { file: `${def.name}.png`, w: side, h: side, grid: def.grid };
	if (def.grid > 1) {
		layout.fps = def.fps;
		layout.mode = def.mode;
	}
	return { id, img, layout, cell, cells };
}

function fxLayoutModule(atlas, fxLayouts, ambientLayouts) {
	const out = [
		"// GENERATED by `npm run art:build` (scripts/art/build-atlases.js) from art/atlases.json. Do not edit.",
		"",
		"/**",
		comment([
			"Layout of the `vale` pack's sprite effects (docs/FX_AUDIO.md F2) and ambient particle textures (F6). No asset",
			"IDs: `file` names the PNG in art/build/ to upload. Every effect is a one-facing flipbook in the ONE effects atlas",
			"VALE_FX_SHEET, cells `start + f` of the SpriteSetAsset formula (perRow = floor(sheet w / frameW)); `grey` sets",
			"were greyed for tinting, the others carry their alpha-weighted mean colour. Ambient textures are square",
			"`grid` x `grid` ParticleEmitter flipbooks (grid 1: one frame).",
		]),
		" */",
		"",
		'import type { HexColor, ParticleFlipbookMode, Pivot } from "../../types";',
		'import type { ValeSheetFile } from "./layout";',
		"",
		"/** One effect's flipbook in VALE_FX_SHEET. */",
		"export interface ValeFxLayout {",
		"\tframeW: number;",
		"\tframeH: number;",
		"\tpivot: Pivot;",
		"\tstart: number;",
		"\tframes: number;",
		"\tfps: number;",
		"\tloop: boolean;",
		"\tgrey: boolean;",
		"\tmeanColor?: HexColor;",
		"}",
		"",
		"/** An ambient particle texture: a square of grid x grid flipbook cells. */",
		"export interface ValeAmbientLayout extends ValeSheetFile {",
		"\tgrid: number;",
		"\tfps?: number;",
		"\tmode?: ParticleFlipbookMode;",
		"}",
		"",
		`export const VALE_FX_SHEET: ValeSheetFile = ${tsValue(atlas, 0, PRINT_WIDTH)};`,
		"",
		`export const VALE_FX_LAYOUTS: Record<string, ValeFxLayout> = ${tsValue(fxLayouts, 0, PRINT_WIDTH)};`,
		"",
		`export const VALE_AMBIENT_LAYOUTS: Record<string, ValeAmbientLayout> = ${tsValue(ambientLayouts, 0, PRINT_WIDTH)};`,
		"",
	];
	const text = out.join("\n");
	for (const line of text.split("\n")) {
		if (line.replace(/\t/g, "    ").length > PRINT_WIDTH) throw new Error(`fxLayout.ts line over ${PRINT_WIDTH} columns: ${line}`);
	}
	return text;
}

/** Builds the effects atlas and the ambient textures; emits their PNGs and contact sheets. Returns what main prints. */
function buildEffects(config, emit, builtFiles, contactFiles) {
	if (!config.fx && !config.ambient) return undefined;
	// A config with ambient textures but no `fx` section has no effects atlas: an empty file name (no ID ever pairs
	// with it, so the pack has no fx entries).
	const pad = config.fx ? config.fx.pad : 0;
	const atlasFile = config.fx ? `${config.fx.atlas}.png` : "";
	const sets = fxIds(config).map((id) => buildFxSet(id, config.fx.sets[id], pad));
	const fxLayouts = {};
	let atlas = { file: atlasFile, w: 0, h: 0 };
	let packed;
	if (sets.length > 0) {
		packed = packFx(sets);
		atlas = { file: atlasFile, w: packed.w, h: packed.h };
		emit(BUILD, atlas.file, packed.img, builtFiles);
		for (const p of [...packed.placed].sort((a, b) => (a.s.id < b.s.id ? -1 : 1))) {
			const l = fxLayoutOf(p);
			fxLayouts[p.s.id] = l;
			const cells = [];
			for (let f = 0; f < l.frames; f++) cells.push([packed.img, ...fxCellAt(packed.w, l, f)]);
			emit(CONTACT, `${p.s.id}.png`, scaledContact(cells, l.frameW, l.frameH, l.pivot), contactFiles);
		}
	}
	const ambient = ambientIds(config).map((id) => buildAmbient(id, config.ambient[id]));
	const ambientLayouts = {};
	for (const a of ambient) {
		ambientLayouts[a.id] = a.layout;
		emit(BUILD, a.layout.file, a.img, builtFiles);
		const cells = [];
		for (let i = 0; i < a.layout.grid * a.layout.grid; i++) cells.push([a.img, (i % a.layout.grid) * a.cell, Math.floor(i / a.layout.grid) * a.cell]);
		emit(CONTACT, `${a.id}.png`, scaledContact(cells, a.cell, a.cell, undefined), contactFiles);
	}
	return { sets, packed, atlas, fxLayouts, ambient, ambientLayouts };
}

function printEffects(fx) {
	if (!fx) return;
	if (fx.packed) {
		const fill = (100 * fx.packed.used) / (fx.packed.w * fx.packed.h);
		console.log(`fx: ${fx.atlas.file} ${fx.packed.w}x${fx.packed.h}, ${fx.sets.length} sets, ${fill.toFixed(1)}% of its area in cells`);
	}
	for (const s of fx.sets) {
		const l = fx.fxLayouts[s.id];
		const p = s.def.preview;
		const gif = p ? `preview ${p.frames} @ ${p.ms} ms${p.frames !== s.def.frames ? " (MISMATCH, see previewNote)" : ""}` : "no preview";
		console.log(`  ${s.id}: ${s.def.file.split("/").slice(-2).join("/")} ${s.def.frames} x ${s.def.frameW}x${s.sourceH}${s.def.burst ? " (burst cells)" : ""} -> cell ${l.frameW}x${l.frameH}, start ${l.start}, ${l.frames} frames @ ${l.fps} fps${l.loop ? " loop" : ""}, ${s.grey ? "grey" : `mean ${s.meanColor}`}; ${gif}`);
	}
	for (const a of fx.ambient) {
		const l = a.layout;
		console.log(`${a.id}: ${l.file} ${l.w}x${l.h}, grid ${l.grid} (cells ${a.cells.join(",")})${l.grid > 1 ? `, ${l.mode} @ ${l.fps} fps` : ""}`);
	}
}

// ---------------------------------------------------------------------------------------------
// Main

function writeIfChanged(file, content) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	if (fs.existsSync(file) && Buffer.compare(fs.readFileSync(file), Buffer.from(content)) === 0) return false;
	fs.writeFileSync(file, content);
	return true;
}

function removeStale(dir, keep) {
	if (!fs.existsSync(dir)) return;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.isFile() && entry.name.endsWith(".png") && !keep.has(entry.name)) {
			fs.unlinkSync(path.join(dir, entry.name));
			console.log(`art:build: removed stale ${path.relative(ROOT, path.join(dir, entry.name))}`);
		}
	}
}

function main() {
	const config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
	if (process.argv.includes("--lock")) {
		writeLock(config);
		return;
	}
	checkLock(config);

	const sets = Object.keys(config.spriteSets)
		.sort()
		.map((id) => buildSpriteSet(id, config.spriteSets[id]));
	const images = Object.keys(config.images)
		.sort()
		.map((id) => buildImage(id, config.images[id]));
	const floor = images.find((i) => i.meanHex);
	if (!floor) throw new Error("no image has meanHex (the floor colour)");

	const builtFiles = new Set();
	const contactFiles = new Set();
	let changed = 0;
	const emit = (dir, name, img, set) => {
		if (set.has(name)) throw new Error(`two outputs named ${name}`);
		set.add(name);
		if (writeIfChanged(path.join(dir, name), encodePng(img))) changed++;
	};
	for (const s of sets) {
		for (const sheet of s.sheets) emit(BUILD, sheet.file, sheet.img, builtFiles);
		emit(CONTACT, `${s.id}.png`, contactSheet(s), contactFiles);
	}
	for (const i of images) emit(BUILD, i.layout.file, i.img, builtFiles);
	const fx = buildEffects(config, emit, builtFiles, contactFiles);
	removeStale(BUILD, builtFiles);
	removeStale(CONTACT, contactFiles);

	if (writeIfChanged(LAYOUT_FILE, layoutModule(sets, images, floor.meanHex))) changed++;
	if (fx && writeIfChanged(FX_LAYOUT_FILE, fxLayoutModule(fx.atlas, fx.fxLayouts, fx.ambientLayouts))) changed++;

	for (const s of sets) {
		const l = s.layout;
		console.log(`${s.id}: cell ${l.frameW}x${l.frameH} (source box ${s.box.join(",")}), pivot (${l.pivot.x}, ${l.pivot.y}), body ${s.bodyHeight} px -> ${l.pixelsPerTile} px/tile`);
		console.log(`  pivot per facing (cell coords) on the measured frame: ${s.sanity.join(" ")}`);
		for (const sh of s.sheets) console.log(`  ${sh.file}: ${sh.img.w}x${sh.img.h}, ${sh.cells} cells`);
	}
	for (const i of images) console.log(`${i.id}: ${i.layout.file} ${i.layout.w}x${i.layout.h}${i.meanHex ? ` mean ${i.meanHex}` : ""}`);
	printEffects(fx);
	console.log(`art:build: ${builtFiles.size} atlas/image file(s), ${contactFiles.size} contact sheet(s), ${changed} file(s) updated`);
}

main();

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
	removeStale(BUILD, builtFiles);
	removeStale(CONTACT, contactFiles);

	if (writeIfChanged(LAYOUT_FILE, layoutModule(sets, images, floor.meanHex))) changed++;

	for (const s of sets) {
		const l = s.layout;
		console.log(`${s.id}: cell ${l.frameW}x${l.frameH} (source box ${s.box.join(",")}), pivot (${l.pivot.x}, ${l.pivot.y}), body ${s.bodyHeight} px -> ${l.pixelsPerTile} px/tile`);
		console.log(`  pivot per facing (cell coords) on the measured frame: ${s.sanity.join(" ")}`);
		for (const sh of s.sheets) console.log(`  ${sh.file}: ${sh.img.w}x${sh.img.h}, ${sh.cells} cells`);
	}
	for (const i of images) console.log(`${i.id}: ${i.layout.file} ${i.layout.w}x${i.layout.h}${i.meanHex ? ` mean ${i.meanHex}` : ""}`);
	console.log(`art:build: ${builtFiles.size} atlas/image file(s), ${contactFiles.size} contact sheet(s), ${changed} file(s) updated`);
}

main();

#!/usr/bin/env node
/*
 * Atlas pipeline (docs/ART.md task S3): vendor art -> Roblox-sized atlases + a generated layout module.
 *
 *   art/atlases.json        (config, committed)   what to read, crops, facing order, frames kept, fps
 *   art/vendor.lock.json    (committed)           every source file the config reads: path, sha256, bytes
 *   art/vendor/**           (gitignored)          the raw packs (art/README.md says where to get them)
 *
 *   -> art/build/<sheet>.png             atlases and images to upload (<= 1024 px a side)
 *   -> art/build/<sheet>-outline.png     outline sheets, for sets with `outline` (same size and cell grid as <sheet>)
 *   -> art/build/contact/<id>.png        contact sheets: every animation x facing x frame on mid-grey, read back
 *                                        from the built atlases through the layout's cell formula; a white arrow
 *                                        in the margin shows each row's facing, a red cross the pivot; sets with an
 *                                        outline draw it in OUTLINE_PREVIEW_RGB under each frame
 *                                        (decor.<piece>.png for world art: + the outline in cyan, glowAt in yellow)
 *   -> art/upload/<sheet>.png            exactly the PNGs to upload, flat (a copy of art/build/*.png, no contact
 *                                        sheets) for one Bulk Import; the build lists the ones assetIds.ts lacks
 *   -> src/shared/theme/packs/vale/layout.ts   generated (committed): frame sizes, pivots, cells, sheets by file name
 *   -> src/shared/theme/packs/vale/fxLayout.ts generated (committed): the sprite-effect atlas and the ambient particle
 *                                        textures (docs/FX_AUDIO.md F2, F6; config keys `fx` and `ambient`)
 *
 * World art (decor props, effects, breakables; docs/DECOR.md R5) has its own section below ("World art").
 *
 * Every sprite set has one cell size and one pivot (SpriteSetAsset): each frame of the set is cropped to the union
 * bounding box (alpha > noiseAlpha) over all its animations and facings, plus `pad`. Its texel density comes from
 * exactly one of `bodyTiles` (the measured body height / bodyTiles) or `pixelsPerTileFrom` (another sprite set's id:
 * that set's pixelsPerTile, exactly, for art of one pack drawn at one scale); sets build in dependency order, and a
 * missing or cyclic reference fails the build. `lockAlso` (optional, `frames` sources): extra animations
 * ({ folder, frames }) the lock covers and the build checks, but no sheet reads (art kept for a later phase). Facings are written in the
 * SpriteSetAsset convention (zeroDeg 0, ccw true; facing d at d * 360 / count degrees from screen right). Every
 * output is alpha-bled: transparent pixels take the colour of the nearest opaque ones (alpha unchanged), so Roblox's
 * bilinear filter does not pull a white or black halo in from under the transparent pixels.
 *
 * Outline sheets (set `outline: { widthPx }`, enemy contrast rim): per cell (never across a cell edge), the body mask
 * (the pivot's: alpha > pivot.bodyAlpha and max(R, G, B) > pivot.bodyMinRgb, so the baked black shadow is left out)
 * dilated by a disc of radius widthPx (dx * dx + dy * dy <= widthPx * widthPx); white, alpha = 255 - the sprite's
 * alpha inside the dilated mask, 0 outside. Drawn under the sprite and tinted, it composites to a rim that does not
 * light the anti-aliased bones from behind. Every pixel is white, so it needs no bleed. The set's pad must be at
 * least widthPx + 1, so the rim is never clipped and keeps a transparent border for the bilinear filter.
 *
 * Deterministic: same inputs -> byte-identical outputs (sorted iteration, integer maths on pixels, fixed deflate
 * options, no timestamps). Stale files in art/build are removed.
 *
 * Usage: node scripts/art/build-atlases.js          build (refuses if a source is missing or differs from the lock)
 *        node scripts/art/build-atlases.js --lock   rewrite art/vendor.lock.json from the files on disk
 * Plain Node plus pngjs. The pure helpers are exported for scripts/art/build-atlases.test.js (npm run test:art).
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
const UPLOAD = path.join(ART, "upload");
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
/** Outline sheets: allowed widthPx, and the role-like red the contact sheets preview the rim in (#ff3b30). */
const OUTLINE_MIN_WIDTH = 1;
const OUTLINE_MAX_WIDTH = 4;
const OUTLINE_PREVIEW_RGB = [0xff, 0x3b, 0x30];

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
// Outline sheets

/** The set's outline config ({ widthPx }), or null when it has none. Throws on a bad config or a pad too small for it. */
function outlineConfig(id, set) {
	const o = set.outline;
	if (o === undefined) return null;
	if (o === null || typeof o !== "object" || Array.isArray(o)) throw new Error(`${id}: outline must be an object { widthPx }`);
	for (const k of Object.keys(o)) if (k !== "widthPx" && !k.startsWith("$")) throw new Error(`${id}: outline.${k}: unknown key (allowed: widthPx)`);
	const r = o.widthPx;
	if (!Number.isInteger(r) || r < OUTLINE_MIN_WIDTH || r > OUTLINE_MAX_WIDTH) {
		throw new Error(`${id}: outline.widthPx must be an integer in [${OUTLINE_MIN_WIDTH}, ${OUTLINE_MAX_WIDTH}], got ${JSON.stringify(r)}`);
	}
	if (!Number.isInteger(set.pad) || set.pad < r + 1) {
		throw new Error(`${id}: pad ${set.pad} is too small for outline.widthPx ${r}: pad must be >= widthPx + 1 = ${r + 1} (so the rim is not clipped)`);
	}
	if (!set.pivot || !Number.isInteger(set.pivot.bodyAlpha) || !Number.isInteger(set.pivot.bodyMinRgb)) {
		throw new Error(`${id}: outline needs pivot.bodyAlpha and pivot.bodyMinRgb (integers), its body mask`);
	}
	return { widthPx: r };
}

/** Body pixel test (the pivot's mask): alpha > bodyAlpha and max(R, G, B) > bodyMinRgb. `i` is the byte index. */
function isBodyAt(data, i, bodyAlpha, bodyMinRgb) {
	return data[i + 3] > bodyAlpha && Math.max(data[i], data[i + 1], data[i + 2]) > bodyMinRgb;
}

/** Body mask of a whole raster: Uint8Array w * h of 0 / 1. */
function bodyMask(img, bodyAlpha, bodyMinRgb) {
	const n = img.w * img.h;
	const mask = new Uint8Array(n);
	for (let i = 0; i < n; i++) if (isBodyAt(img.data, i * 4, bodyAlpha, bodyMinRgb)) mask[i] = 1;
	return mask;
}

/** Offsets [dx, dy] of the integer disc of radius r (dx * dx + dy * dy <= r * r), row-major. */
function discOffsets(r) {
	const out = [];
	for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) out.push([dx, dy]);
	return out;
}

/**
 * Disc dilation of a w x h mask by radius r, per cellW x cellH cell: a pixel is set when a mask pixel of the SAME cell
 * lies within the disc, so nothing bleeds across a cell edge (or past the raster's edge).
 */
function dilateCells(mask, w, h, cellW, cellH, r) {
	const out = new Uint8Array(w * h);
	const disc = discOffsets(r);
	for (let y = 0; y < h; y++) {
		const cy0 = y - (y % cellH);
		const cy1 = Math.min(h, cy0 + cellH);
		for (let x = 0; x < w; x++) {
			if (!mask[y * w + x]) continue;
			const cx0 = x - (x % cellW);
			const cx1 = Math.min(w, cx0 + cellW);
			for (const [dx, dy] of disc) {
				const nx = x + dx;
				const ny = y + dy;
				if (nx >= cx0 && nx < cx1 && ny >= cy0 && ny < cy1) out[ny * w + nx] = 1;
			}
		}
	}
	return out;
}

/**
 * The outline sheet of a built atlas: same size; white everywhere; alpha = round(255 * dilated * (1 - a / 255)) =
 * dilated ? 255 - a : 0, with a the atlas pixel's alpha and `dilated` the per-cell disc dilation of its body mask.
 */
function outlineSheet(img, frameW, frameH, widthPx, bodyAlpha, bodyMinRgb) {
	const { w, h } = img;
	const dilated = dilateCells(bodyMask(img, bodyAlpha, bodyMinRgb), w, h, frameW, frameH, widthPx);
	const out = raster(w, h);
	for (let i = 0; i < w * h; i++) {
		out.data[i * 4] = 255;
		out.data[i * 4 + 1] = 255;
		out.data[i * 4 + 2] = 255;
		out.data[i * 4 + 3] = dilated[i] ? 255 - img.data[i * 4 + 3] : 0;
	}
	return out;
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
		for (const name of Object.keys(set.lockAlso || {}).sort()) {
			const anim = set.lockAlso[name];
			if (set.source.type !== "frames" || !anim.folder || !Array.isArray(anim.frames)) throw new Error(`${id}: lockAlso.${name} needs a frames source, a folder and frames`);
			for (let d = 0; d < set.facingCount; d++) for (const f of anim.frames) files.add(frameFileName(set, anim, d)(f));
		}
	}
	for (const id of Object.keys(config.images).sort()) files.add(config.images[id].file);
	for (const f of worldSourceFiles(config.worldArt)) files.add(f);
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

/**
 * A set's texel density: body height / bodyTiles (rounded to 0.1), or exactly the pixelsPerTile of the already built
 * set its `pixelsPerTileFrom` names (`built`: id -> buildSpriteSet result). Exactly one of the two must be given.
 */
function setPixelsPerTile(id, set, bodyHeight, built) {
	const hasFrom = set.pixelsPerTileFrom !== undefined;
	const hasTiles = set.bodyTiles !== undefined;
	if (hasFrom === hasTiles) throw new Error(`${id}: give exactly one of bodyTiles and pixelsPerTileFrom`);
	if (hasTiles) {
		if (typeof set.bodyTiles !== "number" || !(set.bodyTiles > 0)) throw new Error(`${id}: bodyTiles must be a positive number`);
		return Math.round((bodyHeight / set.bodyTiles) * 10) / 10;
	}
	const from = built ? built.get(set.pixelsPerTileFrom) : undefined;
	if (!from) throw new Error(`${id}: pixelsPerTileFrom ${set.pixelsPerTileFrom} is not a built sprite set (build with buildSpriteSets)`);
	return from.layout.pixelsPerTile;
}

/** Sprite-set ids in build order: by id, each preceded by the set its `pixelsPerTileFrom` names (depth first). */
function spriteSetOrder(spriteSets) {
	const order = [];
	const state = new Map(); // 1 = on the current chain, 2 = placed
	const visit = (id, chain) => {
		if (state.get(id) === 2) return;
		if (state.get(id) === 1) throw new Error(`pixelsPerTileFrom cycle: ${[...chain, id].join(" -> ")}`);
		state.set(id, 1);
		const from = spriteSets[id].pixelsPerTileFrom;
		if (from !== undefined) {
			if (!Object.prototype.hasOwnProperty.call(spriteSets, from)) throw new Error(`${id}: pixelsPerTileFrom names no sprite set ${from}`);
			visit(from, [...chain, id]);
		}
		state.set(id, 2);
		order.push(id);
	};
	for (const id of Object.keys(spriteSets).sort()) visit(id, []);
	return order;
}

/** Builds every sprite set in dependency order; returns the results sorted by id (the output order). */
function buildSpriteSets(spriteSets) {
	const built = new Map();
	for (const id of spriteSetOrder(spriteSets)) built.set(id, buildSpriteSet(id, spriteSets[id], built));
	return Object.keys(spriteSets)
		.sort()
		.map((id) => built.get(id));
}

/** `built` (id -> result) is only read when the set has `pixelsPerTileFrom`; buildSpriteSets passes it. */
function buildSpriteSet(id, set, built) {
	const count = set.facingCount;
	if (![1, 4, 8, 16].includes(count)) throw new Error(`${id}: facingCount ${count}`);
	const order = set.source.type === "grid" ? set.rowForFacing : set.facingDirs;
	if (!order || order.length !== count) throw new Error(`${id}: need ${count} entries of facing order`);
	if (set.source.type === "grid" && [...order].sort((a, b) => a - b).join() !== [...Array(count).keys()].join()) {
		throw new Error(`${id}: rowForFacing must be a permutation of 0..${count - 1}`);
	}
	const realNames = Object.keys(set.animations).filter((n) => !set.animations[n].cellsOf);
	const outline = outlineConfig(id, set);

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
			return isBodyAt(r.img.data, ((r.y + y) * r.img.w + r.x + x) * 4, bodyAlpha, bodyMinRgb);
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
	const pixelsPerTile = setPixelsPerTile(id, set, body.height, built);
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
		const sheet = { name: sheetDef.name, file: `${sheetDef.name}.png`, img, cells };
		if (outline) {
			sheet.outlineFile = `${sheetDef.name}-outline.png`;
			sheet.outlineImg = outlineSheet(img, frameW, frameH, outline.widthPx, set.pivot.bodyAlpha, set.pivot.bodyMinRgb);
		}
		sheets.push(sheet);
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
		sheets: sheets.map((s) => {
			const sheet = { file: s.file, w: s.img.w, h: s.img.h };
			if (s.outlineFile) sheet.outlineFile = s.outlineFile;
			return sheet;
		}),
		animations: sortedObject(animations),
	};
	selfCheck(id, layout);
	return { id, layout, sheets, sanity, bodyHeight: body.height, box, outline, pixelsPerTileFrom: set.pixelsPerTileFrom };
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
		if (s.outlineFile !== undefined && s.outlineFile !== s.file.replace(/\.png$/, "-outline.png")) throw new Error(`${id}: outline of ${s.file} is ${s.outlineFile}`);
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

/** Composites src (straight alpha) over an opaque dst at (dx, dy); with `tint`, src's RGB is replaced by it. */
function over(src, sx, sy, w, h, dst, dx, dy, tint) {
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const si = ((sy + y) * src.w + sx + x) * 4;
			const di = ((dy + y) * dst.w + dx + x) * 4;
			const a = src.data[si + 3];
			for (let k = 0; k < 3; k++) {
				const c = tint ? tint[k] : src.data[si + k];
				dst.data[di + k] = Math.floor((c * a + dst.data[di + k] * (255 - a) + 127) / 255);
			}
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
				const sx = (cell % perRow) * layout.frameW;
				const sy = Math.floor(cell / perRow) * layout.frameH;
				const outlineImg = result.sheets[a.sheet].outlineImg;
				if (outlineImg) over(outlineImg, sx, sy, layout.frameW, layout.frameH, img, dx, dy, OUTLINE_PREVIEW_RGB);
				over(sheetImgs[a.sheet], sx, sy, layout.frameW, layout.frameH, img, dx, dy);
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

/**
 * One `images` entry. `pixelsPerTileFrom` (optional, a sprite set id): the image is world art drawn at that set's scale
 * (the boost drops, docs/BOOST_ART.md: the Lords of Pain props at the skeleton's), so its layout gets that set's
 * `pixelsPerTile` exactly. `built` (id -> buildSpriteSet result) is only read when it is given; buildImages passes it.
 */
function buildImage(id, def, built) {
	let pixelsPerTile;
	if (def.pixelsPerTileFrom !== undefined) {
		const from = built ? built.get(def.pixelsPerTileFrom) : undefined;
		if (!from) throw new Error(`${id}: pixelsPerTileFrom ${def.pixelsPerTileFrom} is not a built sprite set`);
		pixelsPerTile = from.layout.pixelsPerTile;
	}
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
	if (pixelsPerTile !== undefined) layout.pixelsPerTile = pixelsPerTile;
	return { id, name: def.name, img, layout, meanHex };
}

/** Every `images` entry in id order; `sets` (buildSpriteSets' result) feeds `pixelsPerTileFrom`. */
function buildImages(images, sets) {
	const built = new Map(sets.map((s) => [s.id, s]));
	return Object.keys(images)
		.sort()
		.map((id) => buildImage(id, images[id], built));
}

// ---------------------------------------------------------------------------------------------
// World art (docs/DECOR.md R5): decor pieces, decor effects and breakables, packed into shared atlases
//
// Every piece is read from single-frame source PNGs (Lords of Pain: one 256 px PNG per facing and frame) and cleaned
// (alpha <= noiseAlpha cleared; `shadow: false` clears the pure-black baked shadow, max(R, G, B) <= shadowRgb;
// `clearRgbBelow` clears darker pixels, e.g. smoke). A piece is
//   an image    one frame (`file`), optionally downscaled (box filter, premultiplied), cut out of a shared atlas by a
//               `rect`, or written as its own PNG (`own`: a ParticleEmitter texture cannot take an ImageRect);
//   sprites     `animations` x `facings`: facing d of the output (SpriteSetAsset: zeroDeg + d * 360 / count, ccw) uses
//               the pack's facing at zeroDeg + d * 360 / count + artOffsetDeg; every facing is cropped so its own
//               measured pivot lands on the same cell pixel (one cell size and pivot per set).
// Pivots are measured on the cleaned pixels with max(R, G, B) > shadowRgb (the body, never the baked shadow):
//   bottom  the bottom edge; x = midpoint of the body in the lowest footBand rows (a barrel's base, a column's front
//           corner: standing decor stands on its lowest pixel, since DECOR_BOX leaves nothing below a wall-top pivot
//           and fitArtLayout would lift a higher pivot to the bottom anyway)
//   run     a wall segment's base: x = the body box's centre, y = the lowest body pixel in that column (walls)
//   top     the top edge; x = midpoint of the body in the top footBand rows (a torch's cup)
//   hang    x as `top`, y = the body box's middle: a wall torch hangs centred on its face, cup over the anchor
//   root    the bottom edge at the body box's centre (a flame: its faint flickering lowest rows are off to one side)
//   center  the body box's centre (flat pieces, effects)
//   union   sprites: the centre of the union box of every frame (a loop whose frames move about: the glint)
// `outline` (standing pieces): per facing, the convex hull of every opaque pixel over all frames, cell pixels, so the
// footprint fit (shared/view decor.ts fitArtLayout) can hold the real shape inside its box instead of the cell's
// rectangle (a diagonal wall's rectangle is mostly empty). `glowAt: { animation, bright }`: the top edge / horizontal
// centre of the pixels at least that bright in an animation's frames (where a brazier's embers glow); `glowAt: { top:
// d }`: the `top` point of facing d (a torch's cup; facings are aligned on the pivot). Every piece is drawn at
// the pack's own scale: pixelsPerTile = the `pixelsPerTileFrom` sprite set's (divided by a downscale factor).
//
// Atlas packing (deterministic): sprite sets first, each in its own band of whole cell rows on its own cell lattice
// (SpriteSetAsset cells run row-major across the sheet's full width, so a band starts on a row boundary of its cell
// height), tallest cells first; then the images by MaxRects (best short side fit, ties by y, then x), largest first.
// An item that does not fit opens the next atlas (<name>-2, ...).

const DIR_ANGLES = [
	["E", 0],
	["NEE", 22.5],
	["NE", 45],
	["NNE", 67.5],
	["N", 90],
	["NNW", 112.5],
	["NW", 135],
	["NWW", 157.5],
	["W", 180],
	["SWW", 202.5],
	["SW", 225],
	["SSW", 247.5],
	["S", 270],
	["SSE", 292.5],
	["SE", 315],
	["SEE", 337.5],
];

function wrap360(deg) {
	const a = deg % 360;
	return a < 0 ? a + 360 : a;
}

/** The pack folder name of a facing angle (Lords of Pain: 16 directions, E = 0, counter-clockwise). */
function dirOfAngle(deg, what) {
	const a = wrap360(deg);
	const hit = DIR_ANGLES.find(([, angle]) => angle === a);
	if (!hit) throw new Error(`${what}: no pack facing at ${a} degrees (the pack has 16, 22.5 apart)`);
	return hit;
}

/** A frame file: `{dir}`, `{angle}` (one decimal, as the pack names them) and `{f}` filled in. */
function expandFile(template, dir, angle, f) {
	return template.replace(/\{dir\}/g, dir).replace(/\{angle\}/g, angle.toFixed(1)).replace(/\{f\}/g, String(f));
}

/** Every source file world art reads, sorted. */
function worldSourceFiles(world) {
	const files = new Set();
	if (!world) return files;
	for (const name of Object.keys(world.pieces).sort()) {
		if (name.startsWith("$")) continue;
		const piece = world.pieces[name];
		if (piece.file) {
			files.add(piece.file);
			continue;
		}
		for (const d of pieceFacings(name, piece)) {
			for (const anim of Object.keys(piece.animations).sort()) {
				const a = piece.animations[anim];
				for (const f of a.frames) files.add(expandFile(a.file, d.dir, d.angle, f));
			}
		}
	}
	return files;
}

/** The output facings of a sprite piece: [{ d, dir, angle }] (the pack facing each one reads). */
function pieceFacings(name, piece) {
	const f = piece.facings || { count: 1 };
	const count = f.count;
	if (![1, 4, 8, 16].includes(count)) throw new Error(`${name}: facings.count ${count}`);
	const out = [];
	for (let d = 0; d < count; d++) {
		const [dir, angle] = dirOfAngle((f.zeroDeg || 0) + (d * 360) / count + (f.artOffsetDeg || 0), name);
		out.push({ d, dir, angle });
	}
	return out;
}

const worldFrameCache = new Map();

/** A source frame, cleaned for this piece (see the section comment). Shared rasters: never mutate. */
function worldFrame(world, piece, rel) {
	const key = `${rel}|${piece.shadow === false ? "s" : ""}|${piece.clearRgbBelow || 0}`;
	let img = worldFrameCache.get(key);
	if (img) return img;
	const src = readPng(rel);
	img = raster(src.w, src.h);
	img.data.set(src.data);
	const d = img.data;
	for (let i = 0; i < img.w * img.h; i++) {
		const m = Math.max(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
		const clear =
			d[i * 4 + 3] <= world.noiseAlpha ||
			(piece.shadow === false && m <= world.shadowRgb) ||
			(piece.clearRgbBelow !== undefined && m < piece.clearRgbBelow);
		if (clear) d.fill(0, i * 4, i * 4 + 4);
	}
	worldFrameCache.set(key, img);
	return img;
}

/** Box filter by an integer factor, alpha-weighted colour (integer maths). The source is padded to whole blocks. */
function downscale(img, k) {
	const w = Math.ceil(img.w / k);
	const h = Math.ceil(img.h / k);
	const out = raster(w, h);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			let a = 0;
			let r = 0;
			let g = 0;
			let b = 0;
			for (let yy = y * k; yy < y * k + k; yy++) {
				for (let xx = x * k; xx < x * k + k; xx++) {
					if (xx >= img.w || yy >= img.h) continue;
					const i = (yy * img.w + xx) * 4;
					const pa = img.data[i + 3];
					a += pa;
					r += img.data[i] * pa;
					g += img.data[i + 1] * pa;
					b += img.data[i + 2] * pa;
				}
			}
			const o = (y * w + x) * 4;
			const n = k * k;
			out.data[o + 3] = Math.floor((2 * a + n) / (2 * n));
			if (a > 0) {
				out.data[o] = Math.floor((2 * r + a) / (2 * a));
				out.data[o + 1] = Math.floor((2 * g + a) / (2 * a));
				out.data[o + 2] = Math.floor((2 * b + a) / (2 * a));
			}
		}
	}
	return out;
}

/** Bounding box [x0, y0, x1, y1] (inclusive) of the pixels `test(i)` accepts, or null. */
function boundsWhere(img, test) {
	let b = null;
	for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) if (test((y * img.w + x) * 4)) b = unionBox(b, [x, y, x, y]);
	return b;
}

function isOpaque(img, i) {
	return img.data[i + 3] > 0;
}

function isBody(world, img, i) {
	return img.data[i + 3] > 0 && Math.max(img.data[i], img.data[i + 1], img.data[i + 2]) > world.shadowRgb;
}

/** Leftmost / rightmost body pixel of row y, or null. */
function rowSpan(world, img, y) {
	let x0 = -1;
	let x1 = -1;
	for (let x = 0; x < img.w; x++) {
		if (isBody(world, img, (y * img.w + x) * 4)) {
			if (x0 < 0) x0 = x;
			x1 = x;
		}
	}
	return x0 < 0 ? null : [x0, x1];
}

/** The pivot of a cleaned frame in its own pixels (see the section comment). */
function measurePivot(world, img, mode, what) {
	const b = boundsWhere(img, (i) => isBody(world, img, i));
	if (!b) throw new Error(`${what}: no body pixels to measure a pivot on`);
	const band = world.footBand;
	const spanOf = (rows) => {
		let x0 = Infinity;
		let x1 = -1;
		for (const y of rows) {
			const s = rowSpan(world, img, y);
			if (s) {
				x0 = Math.min(x0, s[0]);
				x1 = Math.max(x1, s[1]);
			}
		}
		return (x0 + x1 + 1) / 2;
	};
	const rows = (from, to) => {
		const out = [];
		for (let y = from; y <= to; y++) out.push(y);
		return out;
	};
	if (mode === "bottom") return { x: spanOf(rows(b[3] - band + 1, b[3])), y: b[3] + 1 };
	if (mode === "top") return { x: spanOf(rows(b[1], b[1] + band - 1)), y: b[1] };
	if (mode === "center") return { x: (b[0] + b[2] + 1) / 2, y: (b[1] + b[3] + 1) / 2 };
	if (mode === "root") return { x: (b[0] + b[2] + 1) / 2, y: b[3] + 1 };
	if (mode === "hang") return { x: spanOf(rows(b[1], b[1] + band - 1)), y: (b[1] + b[3] + 1) / 2 };
	if (mode === "run") {
		const x = Math.floor((b[0] + b[2] + 1) / 2);
		let low = -1;
		for (let y = 0; y < img.h; y++) {
			for (const cx of [x - 1, x]) if (cx >= 0 && isBody(world, img, (y * img.w + cx) * 4)) low = y;
		}
		if (low < 0) throw new Error(`${what}: no body pixel in the centre column`);
		return { x, y: low + 1 };
	}
	throw new Error(`${what}: unknown pivot mode ${mode}`);
}

/** Convex hull (ccw in image coordinates, collinear points dropped) of integer points [[x, y], ...]. */
function hullOf(points) {
	const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	const uniq = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
	if (uniq.length < 3) return uniq;
	const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
	const lower = [];
	for (const p of uniq) {
		while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
		lower.push(p);
	}
	const upper = [];
	for (let i = uniq.length - 1; i >= 0; i--) {
		const p = uniq[i];
		while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
		upper.push(p);
	}
	return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Corners of every opaque pixel's row span of `img`, shifted by (-ox, -oy): hull input. */
function opaqueCorners(img, ox, oy, out) {
	for (let y = 0; y < img.h; y++) {
		let x0 = -1;
		let x1 = -1;
		for (let x = 0; x < img.w; x++) {
			if (isOpaque(img, (y * img.w + x) * 4)) {
				if (x0 < 0) x0 = x;
				x1 = x;
			}
		}
		if (x0 < 0) continue;
		out.push([x0 - ox, y - oy], [x0 - ox, y + 1 - oy], [x1 + 1 - ox, y - oy], [x1 + 1 - ox, y + 1 - oy]);
	}
}

/** Builds every world piece's pixels and placement (atlas positions come later). */
function buildWorldPieces(world, sets) {
	const from = sets.find((s) => s.id === world.pixelsPerTileFrom);
	if (!from) throw new Error(`worldArt.pixelsPerTileFrom: no sprite set ${world.pixelsPerTileFrom}`);
	const ppt = from.layout.pixelsPerTile;
	const pad = world.pad;
	const pieces = [];
	for (const name of Object.keys(world.pieces).sort()) {
		if (name.startsWith("$")) continue;
		const def = world.pieces[name];
		if (def.file) pieces.push(buildWorldImage(world, name, def, ppt, pad));
		else pieces.push(buildWorldSprites(world, name, def, ppt, pad));
	}
	return { pieces, ppt };
}

function buildWorldImage(world, name, def, ppt, pad) {
	let img = worldFrame(world, def, def.file);
	const box = boundsWhere(img, (i) => isOpaque(img, i));
	if (!box) throw new Error(`${name}: no visible pixels`);
	let k = def.downscale || 1;
	// crop to the box (whole k-blocks), then downscale
	const cw = Math.ceil((box[2] - box[0] + 1) / k) * k;
	const ch = Math.ceil((box[3] - box[1] + 1) / k) * k;
	let crop = raster(cw, ch);
	blit(img, box[0], box[1], cw, ch, crop, 0, 0, 0);
	if (k > 1) crop = downscale(crop, k);
	if (def.alpha === "normalize") {
		let max = 0;
		for (let i = 0; i < crop.w * crop.h; i++) max = Math.max(max, crop.data[i * 4 + 3]);
		for (let i = 0; i < crop.w * crop.h; i++) crop.data[i * 4 + 3] = Math.floor((crop.data[i * 4 + 3] * 255 * 2 + max) / (2 * max));
	}
	if (def.rgb === "white") for (let i = 0; i < crop.w * crop.h; i++) crop.data.fill(255, i * 4, i * 4 + 3);
	const out = raster(crop.w + 2 * pad, crop.h + 2 * pad);
	blit(crop, 0, 0, crop.w, crop.h, out, pad, pad, 0);
	// the pivot on the original pixels (body: never the baked shadow), into the cell
	const p = measurePivot(world, img, def.pivot, name);
	const pivot = { x: (p.x - box[0]) / k + pad, y: (p.y - box[1]) / k + pad };
	let outline;
	if (def.outline) {
		const pts = [];
		opaqueCorners(out, 0, 0, pts);
		outline = hullOf(pts).map(([x, y]) => ({ x, y }));
	}
	return { name, kind: "image", img: out, pivot, outline, own: def.own, pixelsPerTile: Math.round((ppt / k) * 1000) / 1000 };
}

function buildWorldSprites(world, name, def, ppt, pad) {
	const facings = pieceFacings(name, def);
	const animNames = Object.keys(def.animations).sort();
	const pivotFrom = def.pivotFrom || { animation: animNames[0], frame: 0 };
	// per facing: the pivot (rounded to a whole pixel, so every facing shifts by whole pixels) and the union box
	let box = null;
	const refs = [];
	for (const fc of facings) {
		let p;
		if (def.pivot === "union") {
			// the centre of the union box of every frame (a loop whose frames move about, e.g. a sparkle)
			let u = null;
			for (const an of animNames) {
				const a = def.animations[an];
				for (const f of a.frames) {
					const img = worldFrame(world, def, expandFile(a.file, fc.dir, fc.angle, f));
					u = unionBox(u, boundsWhere(img, (i) => isOpaque(img, i)));
				}
			}
			if (!u) throw new Error(`${name} ${fc.dir}: no visible pixels`);
			p = { x: (u[0] + u[2] + 1) / 2, y: (u[1] + u[3] + 1) / 2 };
		} else {
			const pa = def.animations[pivotFrom.animation];
			p = measurePivot(world, worldFrame(world, def, expandFile(pa.file, fc.dir, fc.angle, pa.frames[pivotFrom.frame])), def.pivot, `${name} ${fc.dir}`);
		}
		const ref = { x: Math.round(p.x), y: Math.round(p.y) };
		refs.push(ref);
		for (const an of animNames) {
			const a = def.animations[an];
			for (const f of a.frames) {
				const img = worldFrame(world, def, expandFile(a.file, fc.dir, fc.angle, f));
				const b = boundsWhere(img, (i) => isOpaque(img, i));
				if (b) box = unionBox(box, [b[0] - ref.x, b[1] - ref.y, b[2] - ref.x, b[3] - ref.y]);
			}
		}
	}
	if (!box) throw new Error(`${name}: no visible pixels`);
	const frameW = box[2] - box[0] + 1 + 2 * pad;
	const frameH = box[3] - box[1] + 1 + 2 * pad;
	const pivot = { x: -box[0] + pad, y: -box[1] + pad };
	// cells: animations back to back (name order), facing-major inside each
	const cells = [];
	const animations = {};
	for (const an of animNames) {
		const a = def.animations[an];
		animations[an] = { start: cells.length, frames: a.frames.length, fps: a.fps, loop: a.loop };
		for (const fc of facings) {
			for (const f of a.frames) {
				const img = worldFrame(world, def, expandFile(a.file, fc.dir, fc.angle, f));
				const cell = raster(frameW, frameH);
				blit(img, refs[fc.d].x - pivot.x, refs[fc.d].y - pivot.y, frameW, frameH, cell, 0, 0, 0);
				cells.push({ img: cell, facing: fc.d });
			}
		}
	}
	let outlines;
	if (def.outline) {
		outlines = facings.map((fc) => {
			const pts = [];
			for (const c of cells) if (c.facing === fc.d) opaqueCorners(c.img, 0, 0, pts);
			return hullOf(pts).map(([x, y]) => ({ x, y }));
		});
	}
	let glowAt;
	if (def.glowAt && def.glowAt.top !== undefined) {
		// the top of the body (a torch's cup) of facing `top`'s pivot frame, in cell pixels
		const fc = facings[def.glowAt.top];
		const pa = def.animations[pivotFrom.animation];
		const t = measurePivot(world, worldFrame(world, def, expandFile(pa.file, fc.dir, fc.angle, pa.frames[pivotFrom.frame])), "top", `${name} glowAt`);
		glowAt = { x: t.x - refs[fc.d].x + pivot.x, y: t.y - refs[fc.d].y + pivot.y };
	} else if (def.glowAt) {
		const g = def.glowAt;
		const a = animations[g.animation];
		if (!a) throw new Error(`${name}: glowAt.animation ${g.animation} is not an animation`);
		let y0 = Infinity;
		let x0 = Infinity;
		let x1 = -1;
		for (let k = 0; k < a.frames; k++) {
			const img = cells[a.start + k].img; // facing 0
			for (let i = 0; i < img.w * img.h; i++) {
				if (img.data[i * 4 + 3] > 0 && Math.max(img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]) >= g.bright) {
					const x = i % img.w;
					const y = (i - x) / img.w;
					y0 = Math.min(y0, y);
					x0 = Math.min(x0, x);
					x1 = Math.max(x1, x);
				}
			}
		}
		if (x1 < 0) throw new Error(`${name}: no pixel at least ${g.bright} bright for glowAt`);
		glowAt = { x: (x0 + x1 + 1) / 2, y: y0 };
	}
	return {
		name,
		kind: "sprites",
		frameW,
		frameH,
		pivot,
		pixelsPerTile: ppt,
		facings: { count: facings.length, zeroDeg: (def.facings && def.facings.zeroDeg) || 0, ccw: true },
		dirs: facings.map((fc) => fc.dir),
		animations,
		cells,
		outlines,
		glowAt,
	};
}

/** MaxRects free list: place `r` (taken), splitting every free rect it overlaps, then drop contained ones. */
function takeRect(free, r) {
	const next = [];
	for (const f of free) {
		if (r.x >= f.x + f.w || r.x + r.w <= f.x || r.y >= f.y + f.h || r.y + r.h <= f.y) {
			next.push(f);
			continue;
		}
		if (r.x > f.x) next.push({ x: f.x, y: f.y, w: r.x - f.x, h: f.h });
		if (r.x + r.w < f.x + f.w) next.push({ x: r.x + r.w, y: f.y, w: f.x + f.w - r.x - r.w, h: f.h });
		if (r.y > f.y) next.push({ x: f.x, y: f.y, w: f.w, h: r.y - f.y });
		if (r.y + r.h < f.y + f.h) next.push({ x: f.x, y: r.y + r.h, w: f.w, h: f.y + f.h - r.y - r.h });
	}
	const inside = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
	const kept = next.filter((a, i) => !next.some((b, j) => j !== i && inside(a, b) && (!inside(b, a) || j < i)));
	kept.sort((a, b) => a.y - b.y || a.x - b.x || a.w - b.w || a.h - b.h);
	free.length = 0;
	free.push(...kept);
}

/** Packs the pieces into atlases `<name>.png`, `<name>-2.png`, ... (see the section comment). */
function packWorldAtlases(world, pieces) {
	const size = world.atlas.maxSize;
	const atlases = [];
	const open = () => {
		const a = { index: atlases.length, free: [{ x: 0, y: 0, w: size, h: size }], usedH: 0, bandY: 0, items: [] };
		a.name = a.index === 0 ? world.atlas.name : `${world.atlas.name}-${a.index + 1}`;
		atlases.push(a);
		return a;
	};
	open();
	const sprites = pieces.filter((p) => p.kind === "sprites").sort((a, b) => b.frameH - a.frameH || (a.name < b.name ? -1 : 1));
	const band = (a, p) => {
		const perRow = Math.floor(size / p.frameW);
		const rowsNeeded = Math.ceil(p.cells.length / perRow);
		const y0 = Math.ceil(a.bandY / p.frameH) * p.frameH;
		if (perRow < 1 || y0 + rowsNeeded * p.frameH > size) return false;
		p.atlas = a;
		p.startCell = (y0 / p.frameH) * perRow;
		p.perRow = perRow;
		const fullRows = Math.floor(p.cells.length / perRow);
		if (fullRows > 0) takeRect(a.free, { x: 0, y: y0, w: perRow * p.frameW, h: fullRows * p.frameH });
		const rest = p.cells.length - fullRows * perRow;
		if (rest > 0) takeRect(a.free, { x: 0, y: y0 + fullRows * p.frameH, w: rest * p.frameW, h: p.frameH });
		a.bandY = y0 + rowsNeeded * p.frameH;
		a.usedH = Math.max(a.usedH, a.bandY);
		a.items.push(p);
		return true;
	};
	for (const p of sprites) {
		if (atlases.some((a) => band(a, p))) continue;
		if (!band(open(), p)) throw new Error(`${p.name}: ${p.cells.length} cells of ${p.frameW}x${p.frameH} do not fit a ${size} atlas`);
	}
	const images = pieces
		.filter((p) => p.kind === "image" && !p.own)
		.sort((a, b) => b.img.h - a.img.h || b.img.w - a.img.w || (a.name < b.name ? -1 : 1));
	for (const p of images) {
		const w = p.img.w;
		const h = p.img.h;
		let best = null;
		for (const a of atlases) {
			for (const f of a.free) {
				if (f.w < w || f.h < h) continue;
				const score = Math.min(f.w - w, f.h - h);
				if (!best || score < best.score || (score === best.score && (f.y < best.f.y || (f.y === best.f.y && f.x < best.f.x)))) best = { a, f, score };
			}
			if (best) break; // fill earlier atlases first
		}
		if (!best) {
			const a = open();
			const f = a.free[0];
			if (f.w < w || f.h < h) throw new Error(`${p.name}: ${w}x${h} does not fit a ${size} atlas`);
			best = { a, f, score: 0 };
		}
		p.atlas = best.a;
		p.at = { x: best.f.x, y: best.f.y };
		takeRect(best.a.free, { x: p.at.x, y: p.at.y, w, h });
		best.a.usedH = Math.max(best.a.usedH, p.at.y + h);
		best.a.items.push(p);
	}
	// rasters: the full width (sprite cells run across it), the used height; no two pieces may share a pixel
	for (const a of atlases) {
		a.img = raster(size, a.usedH);
		const taken = new Uint8Array(size * a.usedH);
		const claim = (x, y, w, h, what) => {
			if (x < 0 || y < 0 || x + w > size || y + h > a.usedH) throw new Error(`${what}: outside ${a.name}`);
			for (let yy = y; yy < y + h; yy++) {
				for (let xx = x; xx < x + w; xx++) {
					if (taken[yy * size + xx]) throw new Error(`${what}: overlaps another piece in ${a.name} at (${xx}, ${yy})`);
					taken[yy * size + xx] = 1;
				}
			}
		};
		for (const p of a.items) {
			if (p.kind === "sprites") {
				for (let k = 0; k < p.cells.length; k++) {
					const cell = p.startCell + k;
					claim((cell % p.perRow) * p.frameW, Math.floor(cell / p.perRow) * p.frameH, p.frameW, p.frameH, `${p.name} cell ${k}`);
				}
			} else claim(p.at.x, p.at.y, p.img.w, p.img.h, p.name);
		}
		for (const p of a.items) {
			if (p.kind === "sprites") {
				p.cells.forEach((c, k) => {
					const cell = p.startCell + k;
					blit(c.img, 0, 0, p.frameW, p.frameH, a.img, (cell % p.perRow) * p.frameW, Math.floor(cell / p.perRow) * p.frameH, 0);
				});
			} else {
				blit(p.img, 0, 0, p.img.w, p.img.h, a.img, p.at.x, p.at.y, 0);
			}
		}
		alphaBleed(a.img);
		a.file = `${a.name}.png`;
	}
	const own = pieces.filter((p) => p.kind === "image" && p.own);
	for (const p of own) {
		alphaBleed(p.img);
		p.file = `${p.own}.png`;
	}
	return { atlases, own };
}

/** The layout.ts entry of a world piece (cells, rect, pivot, outline, glowAt; atlas named by file). */
function worldLayout(p) {
	if (p.kind === "image") {
		const out = p.own
			? { kind: "image", file: p.file, w: p.img.w, h: p.img.h, pivot: p.pivot, pixelsPerTile: p.pixelsPerTile }
			: {
					kind: "image",
					file: p.atlas.file,
					w: p.atlas.img.w,
					h: p.atlas.img.h,
					rect: { x: p.at.x, y: p.at.y, w: p.img.w, h: p.img.h },
					pivot: p.pivot,
					pixelsPerTile: p.pixelsPerTile,
				};
		if (p.outline) out.outline = p.outline;
		return out;
	}
	const animations = {};
	for (const an of Object.keys(p.animations).sort()) {
		const a = p.animations[an];
		animations[an] = { sheet: 0, start: p.startCell + a.start, frames: a.frames, fps: a.fps, loop: a.loop };
	}
	const out = {
		kind: "sprites",
		frameW: p.frameW,
		frameH: p.frameH,
		pivot: p.pivot,
		pixelsPerTile: p.pixelsPerTile,
		resample: "Default",
		facings: p.facings,
		sheets: [{ file: p.atlas.file, w: p.atlas.img.w, h: p.atlas.img.h }],
		animations,
	};
	if (p.outlines) out.outlines = p.outlines;
	if (p.glowAt) out.glowAt = p.glowAt;
	return out;
}

/** Contact sheet of one world piece, read back from its atlas: every facing x frame (or the rect) on mid-grey, the
 * pivot as a red cross, glowAt as a yellow one, the outline in cyan. */
function worldContact(p) {
	const l = worldLayout(p);
	const sheet = p.kind === "image" ? (p.own ? p.img : p.atlas.img) : p.atlas.img;
	const cellsOf = [];
	if (p.kind === "image") cellsOf.push({ x: l.rect ? l.rect.x : 0, y: l.rect ? l.rect.y : 0, w: p.img.w, h: p.img.h, row: 0, col: 0, outline: l.outline });
	else {
		let row = 0;
		for (const an of Object.keys(l.animations).sort()) {
			const a = l.animations[an];
			for (let d = 0; d < l.facings.count; d++) {
				for (let f = 0; f < a.frames; f++) {
					const cell = a.start + d * a.frames + f;
					cellsOf.push({ x: (cell % p.perRow) * l.frameW, y: Math.floor(cell / p.perRow) * l.frameH, w: l.frameW, h: l.frameH, row, col: f, outline: l.outlines ? l.outlines[d] : undefined, facing: d });
				}
				row++;
			}
		}
	}
	const cw = cellsOf[0].w;
	const chh = cellsOf[0].h;
	const cols = Math.max(...cellsOf.map((c) => c.col)) + 1;
	const rows = Math.max(...cellsOf.map((c) => c.row)) + 1;
	const img = raster(CONTACT_MARGIN + cols * (cw + CONTACT_GUTTER), rows * (chh + CONTACT_GUTTER));
	fillRect(img, 0, 0, img.w, img.h, [CONTACT_BG, CONTACT_BG, CONTACT_BG]);
	const pivot = l.pivot;
	for (const c of cellsOf) {
		const dx = CONTACT_MARGIN + c.col * (cw + CONTACT_GUTTER) + CONTACT_GUTTER / 2;
		const dy = c.row * (chh + CONTACT_GUTTER) + CONTACT_GUTTER / 2;
		if (c.col === 0 && p.kind === "sprites" && l.facings.count > 1) {
			arrow(img, CONTACT_MARGIN / 2, dy + Math.floor(chh / 2), l.facings.zeroDeg + (c.facing * 360) / l.facings.count, Math.floor(CONTACT_MARGIN / 2) - 6);
		}
		fillRect(img, dx - 1, dy - 1, cw + 2, chh + 2, [96, 96, 96]);
		fillRect(img, dx, dy, cw, chh, [CONTACT_BG, CONTACT_BG, CONTACT_BG]);
		over(sheet, c.x, c.y, cw, chh, img, dx, dy);
		if (c.outline) {
			for (let k = 0; k < c.outline.length; k++) {
				const a = c.outline[k];
				const b = c.outline[(k + 1) % c.outline.length];
				const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 1);
				for (let s = 0; s <= steps; s++) {
					const x = Math.round(a.x + ((b.x - a.x) * s) / steps);
					const y = Math.round(a.y + ((b.y - a.y) * s) / steps);
					fillRect(img, dx + Math.min(x, cw - 1), dy + Math.min(y, chh - 1), 1, 1, [40, 220, 230]);
				}
			}
		}
		const cross = (pt, rgb) => {
			const px = Math.floor(pt.x);
			const py = Math.floor(pt.y);
			fillRect(img, dx + px - 3, dy + py, 7, 1, rgb);
			fillRect(img, dx + px, dy + py - 3, 1, 7, rgb);
		};
		cross(pivot, [230, 30, 30]);
		if (l.glowAt) cross(l.glowAt, [240, 220, 40]);
	}
	return img;
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

function layoutModule(sets, images, floorHex, world) {
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
		world ? 'import type { HexColor, Pivot, PixelBox, SpriteSetAsset } from "../../types";' : 'import type { HexColor, Pivot, SpriteSetAsset } from "../../types";',
		"",
		"/** An atlas PNG in art/build/, by file name. */",
		"export interface ValeSheetFile {",
		"\tfile: string;",
		"\tw: number;",
		"\th: number;",
		"}",
		"",
		"/**",
		comment([
			"A sprite atlas. `outlineFile`, present exactly on sets with an outline (art/atlases.json `outline`), names",
			"its outline sheet: same size and cell grid, white, alpha = the body mask dilated by `widthPx` minus the",
			"sprite's own alpha. Drawn under the frame with the same rect and tinted, it is the enemy contrast rim.",
		]),
		" */",
		"export interface ValeSpriteSheetFile extends ValeSheetFile {",
		"\toutlineFile?: string;",
		"}",
		"",
		"/** SpriteSetAsset without `kind`, with sheets named by file instead of asset ID. */",
		'export interface ValeSpriteLayout extends Omit<SpriteSetAsset, "kind" | "sheets"> {',
		"\tsheets: Array<ValeSpriteSheetFile>;",
		"}",
		"",
		"/**",
		comment([
			"A single image in art/build/. `pivot` (pixels from the top-left) is where it is anchored, when it matters;",
			"`pixelsPerTile`, on world art drawn at a sprite set's scale (art/atlases.json `pixelsPerTileFrom`), sizes it.",
		]),
		" */",
		"export interface ValeImageLayout extends ValeSheetFile {",
		"\ttilesPerImage?: number;",
		"\tpivot?: Pivot;",
		"\tpixelsPerTile?: number;",
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
	if (world) {
		const worldLayouts = {};
		for (const p of world.pieces) worldLayouts[p.name] = worldLayout(p);
		out.push(
			"/**",
			comment([
				"World art (docs/DECOR.md R5): decor pieces, decor effects and breakables by art name (art/atlases.json",
				"`worldArt.pieces`); packs/vale/manifest.ts maps the decor / breakable IDs onto them. Images are `rect` cuts of",
				"a shared atlas (or a file of their own); sprite sets are cell bands in one. `outline` / `outlines`: the convex",
				"hull of the opaque pixels (per facing), rect / cell pixels, for the footprint fit.",
			]),
			" */",
			"export interface ValeWorldImageLayout extends ValeSheetFile {",
			'\tkind: "image";',
			"\trect?: PixelBox;",
			"\tpivot: Pivot;",
			"\tpixelsPerTile: number;",
			"\toutline?: Array<Pivot>;",
			"}",
			"",
			"export interface ValeWorldSpriteLayout extends ValeSpriteLayout {",
			'\tkind: "sprites";',
			"}",
			"",
			"export type ValeWorldLayout = ValeWorldImageLayout | ValeWorldSpriteLayout;",
			"",
			`export const VALE_WORLD_LAYOUTS: Record<string, ValeWorldLayout> = ${tsValue(worldLayouts, 0, PRINT_WIDTH)};`,
			"",
		);
	}
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

/** Removes every .png directly in `dir` whose name is not in `keep` (a Set of file names). */
function removeStale(dir, keep) {
	if (!fs.existsSync(dir)) return;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.isFile() && entry.name.endsWith(".png") && !keep.has(entry.name)) {
			fs.unlinkSync(path.join(dir, entry.name));
			console.log(`art:build: removed stale ${path.relative(ROOT, path.join(dir, entry.name))}`);
		}
	}
}

/**
 * Every PNG the build writes, in write order: { dir: "build" | "contact", name, img }. Sheets (each followed by its
 * outline sheet, if any) and a contact sheet per set, then the images. Everything else in art/build is stale.
 */
function buildOutputs(sets, images) {
	const out = [];
	for (const s of sets) {
		for (const sheet of s.sheets) {
			out.push({ dir: "build", name: sheet.file, img: sheet.img });
			if (sheet.outlineImg) out.push({ dir: "build", name: sheet.outlineFile, img: sheet.outlineImg });
		}
		out.push({ dir: "contact", name: `${s.id}.png`, img: contactSheet(s) });
	}
	for (const i of images) out.push({ dir: "build", name: i.layout.file, img: i.img });
	return out;
}

function main() {
	const config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
	if (process.argv.includes("--lock")) {
		writeLock(config);
		return;
	}
	checkLock(config);

	const sets = buildSpriteSets(config.spriteSets);
	const images = buildImages(config.images, sets);
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
	for (const o of buildOutputs(sets, images)) {
		if (o.dir === "build") emit(BUILD, o.name, o.img, builtFiles);
		else emit(CONTACT, o.name, o.img, contactFiles);
	}
	let world;
	if (config.worldArt) {
		const { pieces } = buildWorldPieces(config.worldArt, sets);
		const packed = packWorldAtlases(config.worldArt, pieces);
		world = { pieces, ...packed };
		for (const a of packed.atlases) emit(BUILD, a.file, a.img, builtFiles);
		for (const p of packed.own) emit(BUILD, p.file, p.img, builtFiles);
		for (const p of pieces) emit(CONTACT, `decor.${p.name}.png`, worldContact(p), contactFiles);
	}
	const fx = buildEffects(config, emit, builtFiles, contactFiles);
	removeStale(BUILD, builtFiles);
	removeStale(CONTACT, contactFiles);

	// art/upload: exactly the PNGs to upload (every art/build/*.png), flat, for one bulk import
	for (const name of [...builtFiles].sort()) {
		if (writeIfChanged(path.join(UPLOAD, name), fs.readFileSync(path.join(BUILD, name)))) changed++;
	}
	removeStale(UPLOAD, builtFiles);

	if (writeIfChanged(LAYOUT_FILE, layoutModule(sets, images, floor.meanHex, world))) changed++;
	if (fx && writeIfChanged(FX_LAYOUT_FILE, fxLayoutModule(fx.atlas, fx.fxLayouts, fx.ambientLayouts))) changed++;

	for (const s of sets) {
		const l = s.layout;
		console.log(`${s.id}: cell ${l.frameW}x${l.frameH} (source box ${s.box.join(",")}), pivot (${l.pivot.x}, ${l.pivot.y}), body ${s.bodyHeight} px -> ${l.pixelsPerTile} px/tile${s.pixelsPerTileFrom ? ` (from ${s.pixelsPerTileFrom})` : ""}`);
		console.log(`  pivot per facing (cell coords) on the measured frame: ${s.sanity.join(" ")}`);
		for (const sh of s.sheets) {
			console.log(`  ${sh.file}: ${sh.img.w}x${sh.img.h}, ${sh.cells} cells${sh.outlineFile ? ` + ${sh.outlineFile} (outline ${s.outline.widthPx} px)` : ""}`);
		}
	}
	for (const i of images) console.log(`${i.id}: ${i.layout.file} ${i.layout.w}x${i.layout.h}${i.meanHex ? ` mean ${i.meanHex}` : ""}`);
	if (world) {
		for (const p of world.pieces) {
			const l = worldLayout(p);
			const where = l.kind === "image" ? `${l.file}${l.rect ? ` rect ${l.rect.x},${l.rect.y} ${l.rect.w}x${l.rect.h}` : ` ${l.w}x${l.h}`}` : `${l.sheets[0].file} cells ${l.frameW}x${l.frameH} x ${p.cells.length} from ${p.startCell} (${p.dirs.join(" ")})`;
			const extra = `${l.outline || l.outlines ? `, outline ${(l.outline || l.outlines[0]).length} pts` : ""}${l.glowAt ? `, glowAt (${l.glowAt.x}, ${l.glowAt.y})` : ""}`;
			console.log(`world ${p.name}: ${where}, pivot (${l.pivot.x}, ${l.pivot.y}), ${l.pixelsPerTile} px/tile${extra}`);
		}
		for (const a of world.atlases) console.log(`  ${a.file}: ${a.img.w}x${a.img.h}, ${a.items.length} piece(s)`);
	}
	printEffects(fx);
	console.log(`art:build: ${builtFiles.size} atlas/image file(s), ${contactFiles.size} contact sheet(s), ${changed} file(s) updated`);
	const uploaded = uploadedFiles();
	const pending = [...builtFiles].sort().filter((f) => !uploaded.has(f));
	console.log(`art:build: art/upload/ holds ${builtFiles.size} PNG(s); ${pending.length} still need an ID in packs/vale/assetIds.ts${pending.length > 0 ? ":" : ""}`);
	for (const f of pending) console.log(`  ${f}  (${fs.statSync(path.join(BUILD, f)).size} bytes)`);
}

/** The file names packs/vale/assetIds.ts already has IDs for. */
function uploadedFiles() {
	const file = path.join(LAYOUT_DIR, "assetIds.ts");
	const out = new Set();
	if (!fs.existsSync(file)) return out;
	for (const m of fs.readFileSync(file, "utf8").matchAll(/"([^"]+\.png)"\s*:\s*"rbxassetid:\/\/\d+"/g)) out.add(m[1]);
	return out;
}

module.exports = {
	MAX_ATLAS,
	OUTLINE_PREVIEW_RGB,
	alphaBleed,
	alphaBounds,
	blit,
	bodyMask,
	buildImages,
	buildOutputs,
	buildSpriteSet,
	buildSpriteSets,
	chooseGrid,
	contactSheet,
	dilateCells,
	discOffsets,
	encodePng,
	isBodyAt,
	layoutModule,
	outlineConfig,
	outlineSheet,
	raster,
	removeStale,
	sourceFiles,
	spriteSetOrder,
	/** Decoded sources by art/vendor-relative path; the tests put synthetic rasters here instead of files. */
	sourceCache: pngCache,
};

if (require.main === module) main();

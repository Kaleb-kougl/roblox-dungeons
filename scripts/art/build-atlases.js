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
 *   -> src/shared/theme/packs/vale/uiIconLayout.ts generated (committed): the UI icon atlas (docs/UI_ART.md UA3;
 *                                        config key `uiIcons`; section "UI icon atlas" below)
 *   -> src/shared/theme/packs/vale/bulletLayout.ts generated (committed): the bullet atlas (docs/PROJECTILE_ART.md
 *                                        PA2; config key `bullets`; section "Bullet atlas" below), with its sheet
 *                                        art/build/bullets.png and contact sheet art/build/contact/bullets.png; the
 *                                        group's `fx` sets (PA7: fx.bullet.hit) ride in the same sheet
 *   -> src/shared/theme/packs/vale/gooLayout.ts generated (committed): the goo puddle sheet (docs/GOO_ART.md GA1;
 *                                        config key `goo`; section "Goo atlas" below), with its sheet
 *                                        art/build/goo.png and contact sheet art/build/contact/goo.png
 *   -> src/shared/theme/packs/vale/boostAuraLayout.ts generated (committed): the boost aura sheet (docs/BOOST_ART.md
 *                                        BAD3; config key `boostAuras`; section "Boost aura sheet" below), with its
 *                                        sheet art/build/boost-auras.png and contact sheet art/build/contact/boost-auras.png
 *   -> src/shared/theme/packs/vale/hazardLayout.ts generated (committed): the floor hazard sheet (docs/HAZARD_ART.md
 *                                        HA2; config key `hazards`; section "Hazard sheet" below), with its sheet
 *                                        art/build/hazards.png and contact sheet art/build/contact/hazards.png
 *   -> src/shared/theme/packs/vale/boonIconLayout.ts generated (committed): the boon icon sheet (docs/BUILDS.md
 *                                        BU11; config key `boonIcons`; section "Boon icon sheet" below), with its
 *                                        sheet art/build/boon-icons.png and contact sheet art/build/contact/boon-icons.png
 *   -> src/shared/theme/packs/vale/itemIconLayout.ts generated (committed): the relic and curse icon sheet
 *                                        (docs/BUILDS.md BU11; config key `itemIcons`; section "Item icon sheet"
 *                                        below), with its sheet art/build/item-icons.png and contact sheet
 *                                        art/build/contact/item-icons.png
 *   -> src/shared/theme/packs/vale/boostIconLayout.ts generated (committed): the boost icon sheet (docs/BOOSTS.md
 *                                        B7, the HUD's boost row; config key `boostIcons`; section "Boost icon sheet"
 *                                        below), with its sheet art/build/boost-icons.png and contact sheet
 *                                        art/build/contact/boost-icons.png
 *   -> src/shared/theme/packs/vale/pipIconLayout.ts generated (committed): the armor pip sheet (docs/UI_ART.md "As
 *                                        built: armor pips"; config key `pipIcons`; section "Pip icon sheet" below),
 *                                        with its sheet art/build/pip-icons.png and contact sheet
 *                                        art/build/contact/pip-icons.png
 *   -> src/shared/theme/packs/vale/duoIconLayout.ts generated (committed): the duo icon sheet (docs/BUILDS.md BU11,
 *                                        the duo part; config key `duoIcons`; section "Duo icon sheet" below), with
 *                                        its sheet art/build/duo-icons.png and contact sheet art/build/contact/duo-icons.png
 *
 * World art (decor props, effects, breakables; docs/DECOR.md R5) has its own section below ("World art").
 *
 * Every sprite set has one cell size and one pivot (SpriteSetAsset; but see per-sheet cells below): each frame of the
 * set is cropped to the union bounding box (alpha > noiseAlpha) over all its animations and facings, plus `pad`. Its
 * texel density comes from
 * exactly one of `bodyTiles` (the measured body height / bodyTiles) or `pixelsPerTileFrom` (another sprite set's id:
 * that set's pixelsPerTile, exactly, for art of one pack drawn at one scale); sets build in dependency order, and a
 * missing or cyclic reference fails the build. `lockAlso` (optional, `frames` sources): extra animations
 * ({ folder, frames }) the lock covers and the build checks, but no sheet reads (art kept for a later phase). Facings are written in the
 * SpriteSetAsset convention (zeroDeg 0, ccw true; facing d at d * 360 / count degrees from screen right). Every
 * output is alpha-bled: transparent pixels take the colour of the nearest opaque ones (alpha unchanged), so Roblox's
 * bilinear filter does not pull a white or black halo in from under the transparent pixels.
 *
 * Per-sheet cells (set `cells: "perSheet"`; sprite contract v2 SpriteSheetImage.frameW / frameH / pivot, docs/DEMON_ART.md
 * DD4): each sheet is instead cropped to the union box of ITS OWN animations (every kept frame and facing, alpha >
 * noiseAlpha, plus the pixel up-left of the set's pivot point, so the pivot always lies inside the cell), plus `pad`,
 * and layout.ts gives that sheet its own frameW / frameH / pivot. The pivot is measured once for the set (as above) and
 * is the same source point in every cell (the set's pivot translated by the sheet's crop offset), so the feet stay
 * planted when the animation changes. The set-level frameW / frameH / pivot stay the whole set's union cell, exactly as
 * without the option; pixelsPerTile stays per set. Absent: one cell for every sheet of the set.
 *
 * Layered grid sources (`source.layers`, docs/DEMON_ART.md DD3): a list of sub-folders of `source.dir`, BOTTOM TO TOP,
 * "" = `source.dir` itself; e.g. ["Shadows", ""] draws the body sheet over the same-named sheet in Shadows/. Each
 * animation's sheet is the composite of `file` from every layer (straight-alpha "over" with premultiplied integer
 * maths: compositeOver), made before anything else reads it (noiseAlpha, crop boxes, pivot, outline). Every layer file
 * must exist and have the first layer's size; sourceFiles (so the lock and its check) lists every one. Absent: the one
 * sheet `source.dir/file`, read as it is.
 * `source.layerNoiseAlpha` (optional, with `layers`; docs/DEMON_ART.md Phase 2): { <layer>: n }, an integer 0-254 per
 * listed layer: that layer's pixels with alpha <= n are cleared BEFORE it is composited (noiseAlpha's rule, per layer),
 * so a glow baked semi-transparent into the body sheet (Demon Spawn 8 / 11's staff orb) goes, while the shadow layer
 * under it stays whole. Absent: every layer composited as it is.
 *
 * Outline sheets (set `outline: { widthPx }`, enemy contrast rim): per cell (never across a cell edge), the body mask
 * (the pivot's: alpha > pivot.bodyAlpha and max(R, G, B) > pivot.bodyMinRgb, so the baked black shadow is left out)
 * dilated by a disc of radius widthPx (dx * dx + dy * dy <= widthPx * widthPx); white, alpha = 255 - the sprite's
 * alpha inside the dilated mask, 0 outside. Drawn under the sprite and tinted, it composites to a rim that does not
 * light the anti-aliased bones from behind. Every pixel is white, so it needs no bleed. The set's pad must be at
 * least widthPx + 1, so the rim is never clipped and keeps a transparent border for the bilinear filter.
 * `outline.clipAtCellEdge: true` (player outline) lifts the pad rule for a set whose cells cannot grow (the knight:
 * 128 px cells, pad 0, 64 to a 1024 atlas): the rim stops at the cell edge where the body comes within widthPx of it,
 * and the build prints how many cells and body pixels that clips (rimClip) so the cost stays visible.
 *
 * Recolour (set `recolor: { ramp }`, docs/FORTUNE.md FO10 / FD14: the Goldling is the skeleton in gold): a gradient map
 * by luminance, applied to every source region the set reads (so before the crop box, the pivot, the packing and the
 * outline rim, which keep their own logic on the recoloured pixels). Each pixel's luminance is the integer Rec. 601
 * one (LUMA, rounded: the `rgb: "grey"` / fx `grey` weights); its RGB becomes the ramp's colour there, linearly
 * interpolated between the two stops around it (integer maths, rounded half up: recolorLut); alpha is kept, so the crop
 * box and every alpha cut are exactly the uncoloured set's. `ramp`: [[luminance, "#rrggbb"], ...], at least two stops,
 * luminances integers strictly increasing from 0 to 255 (positions in the SOURCE's luminance, tuned per set). Absent:
 * the source pixels as they are.
 *
 * Per-frame sources (`source.type: "frames"`): one PNG per frame, <dir>/<folder>/<facing dir>/<file>, the facing dirs
 * in output order (`facingDirs`), named by `source.naming` (FRAME_NAMINGS: "lordsOfPain", the default, or "smallscale"
 * for SmallScaleInt's individual sprites, whose frame numbers are 2 f + 1).
 *
 * Downscale (set `downscale: k`, an integer; docs/BOSS_DEMONLORD.md D1): every kept frame is noise-cut at full
 * resolution, then box-filtered by k (the world-art `downscale`, premultiplied alpha). The union box is measured at
 * full resolution and grown to whole k-blocks, then / k; `pad`, the cell, the outline (and its pad rule) are in
 * downscaled (atlas) pixels. The pivot and body height are measured at full resolution (the body cuts are tuned
 * there) and / k: pivot x rounded, y the bottom edge of the downscaled row holding the lowest body row (ceil), so
 * pixelsPerTile = height / k / bodyTiles. With per-sheet cells, each sheet's own box is grown and / k the same way
 * (and the pivot point is the downscaled one). Absent or 1: exactly the full-resolution path.
 *
 * Deterministic: same inputs -> byte-identical outputs (sorted iteration, integer maths on pixels, fixed deflate
 * options, no timestamps). Stale files in art/build are removed.
 *
 * Usage: node scripts/art/build-atlases.js          build (refuses if a source is missing or differs from the lock)
 *        node scripts/art/build-atlases.js --lock   rewrite art/vendor.lock.json from the files on disk
 *        node scripts/art/build-atlases.js --only bullets          build just the bullet atlas (its packs alone suffice;
 *                                                                  every other output untouched)
 *        node scripts/art/build-atlases.js --lock --only bullets   re-hash just its files into the existing lock
 *        node scripts/art/build-atlases.js --only goo              the same for the goo sheet (docs/GOO_ART.md GA1;
 *        node scripts/art/build-atlases.js --lock --only goo       needs only the Slime pack)
 *        node scripts/art/build-atlases.js --only boostAuras       the same for the boost aura sheet (docs/BOOST_ART.md
 *        node scripts/art/build-atlases.js --lock --only boostAuras BAD3; needs only the generated aura frames)
 *        node scripts/art/build-atlases.js --only treasure         the same for the vault cage and light column sheets
 *        node scripts/art/build-atlases.js --lock --only treasure  (docs/TREASURE.md TR9; needs only the generated frames)
 *        node scripts/art/build-atlases.js --only hazards          the same for the floor hazard sheet (docs/HAZARD_ART.md
 *        node scripts/art/build-atlases.js --lock --only hazards   HA2; needs only the generated strips)
 *        node scripts/art/build-atlases.js --only fortune          the same for the pact altar and coin burst sheets
 *        node scripts/art/build-atlases.js --lock --only fortune   (docs/FORTUNE.md FO10; needs only the generated frames)
 *        node scripts/art/build-atlases.js --only boonIcons        the same for the boon icon sheet (docs/BUILDS.md BU11;
 *        node scripts/art/build-atlases.js --lock --only boonIcons needs only the generated icons)
 *        node scripts/art/build-atlases.js --only itemIcons        the same for the relic and curse icon sheet
 *        node scripts/art/build-atlases.js --lock --only itemIcons (docs/BUILDS.md BU11; needs only the generated icons)
 *        node scripts/art/build-atlases.js --only boostIcons       the same for the boost icon sheet (docs/BOOSTS.md B7;
 *        node scripts/art/build-atlases.js --lock --only boostIcons needs only the generated icons)
 *        node scripts/art/build-atlases.js --only pipIcons         the same for the armor pip sheet (docs/UI_ART.md;
 *        node scripts/art/build-atlases.js --lock --only pipIcons  needs only the generated icons)
 *        node scripts/art/build-atlases.js --only duoIcons         the same for the duo icon sheet (docs/BUILDS.md BU11;
 *        node scripts/art/build-atlases.js --lock --only duoIcons  needs only the generated icons)
 *        node scripts/art/build-atlases.js --only kenney           the same for the Kenney decor sheet
 *        node scripts/art/build-atlases.js --lock --only kenney    (docs/KENNEY_DECOR.md KN9; needs only art/vendor/kenney/)
 *        node scripts/art/build-atlases.js --only class.ranger     build just one sprite set (any `spriteSets` id): its
 *                                                                  sheets, outline sheets, contact sheet and its entry
 *                                                                  in layout.ts (merged, every other entry unchanged);
 *                                                                  needs only its packs and its pixelsPerTileFrom set's
 *        node scripts/art/build-atlases.js --lock --only class.ranger  re-hash just that set's files into the lock
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
const UI_ICON_LAYOUT_FILE = path.join(LAYOUT_DIR, "uiIconLayout.ts");
const BULLET_LAYOUT_FILE = path.join(LAYOUT_DIR, "bulletLayout.ts");
const GOO_LAYOUT_FILE = path.join(LAYOUT_DIR, "gooLayout.ts");
const BOOST_AURA_LAYOUT_FILE = path.join(LAYOUT_DIR, "boostAuraLayout.ts");
const TREASURE_LAYOUT_FILE = path.join(LAYOUT_DIR, "treasureLayout.ts");
const FORTUNE_LAYOUT_FILE = path.join(LAYOUT_DIR, "fortuneLayout.ts");
const BOON_ICON_LAYOUT_FILE = path.join(LAYOUT_DIR, "boonIconLayout.ts");
const ITEM_ICON_LAYOUT_FILE = path.join(LAYOUT_DIR, "itemIconLayout.ts");
const BOOST_ICON_LAYOUT_FILE = path.join(LAYOUT_DIR, "boostIconLayout.ts");
const PIP_ICON_LAYOUT_FILE = path.join(LAYOUT_DIR, "pipIconLayout.ts");
const DUO_ICON_LAYOUT_FILE = path.join(LAYOUT_DIR, "duoIconLayout.ts");

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

/**
 * The set's outline config ({ widthPx }, plus clipAtCellEdge: true when set), or null when it has none. Throws on a bad
 * config or a pad too small for it (unless clipAtCellEdge).
 */
function outlineConfig(id, set) {
	const o = set.outline;
	if (o === undefined) return null;
	if (o === null || typeof o !== "object" || Array.isArray(o)) throw new Error(`${id}: outline must be an object { widthPx }`);
	for (const k of Object.keys(o)) {
		if (k !== "widthPx" && k !== "clipAtCellEdge" && !k.startsWith("$")) throw new Error(`${id}: outline.${k}: unknown key (allowed: widthPx, clipAtCellEdge)`);
	}
	const r = o.widthPx;
	if (!Number.isInteger(r) || r < OUTLINE_MIN_WIDTH || r > OUTLINE_MAX_WIDTH) {
		throw new Error(`${id}: outline.widthPx must be an integer in [${OUTLINE_MIN_WIDTH}, ${OUTLINE_MAX_WIDTH}], got ${JSON.stringify(r)}`);
	}
	const clip = o.clipAtCellEdge;
	if (clip !== undefined && clip !== true) throw new Error(`${id}: outline.clipAtCellEdge must be true or absent, got ${JSON.stringify(clip)}`);
	if (!Number.isInteger(set.pad) || set.pad < 0) throw new Error(`${id}: pad must be a non-negative integer, got ${JSON.stringify(set.pad)}`);
	if (clip !== true && set.pad < r + 1) {
		throw new Error(
			`${id}: pad ${set.pad} is too small for outline.widthPx ${r}: pad must be >= widthPx + 1 = ${r + 1} (so the rim is not clipped), or set outline.clipAtCellEdge`,
		);
	}
	if (!set.pivot || !Number.isInteger(set.pivot.bodyAlpha) || !Number.isInteger(set.pivot.bodyMinRgb)) {
		throw new Error(`${id}: outline needs pivot.bodyAlpha and pivot.bodyMinRgb (integers), its body mask`);
	}
	return clip === true ? { widthPx: r, clipAtCellEdge: true } : { widthPx: r };
}

/**
 * What a cell-bounded rim clips (outline.clipAtCellEdge): the cells holding a body pixel closer than widthPx to their
 * cell's edge (so part of its disc falls outside the cell), and how many such body pixels. 0 / 0 when nothing clips.
 */
function rimClip(img, frameW, frameH, widthPx, bodyAlpha, bodyMinRgb) {
	const { w, h } = img;
	const cellsHit = new Set();
	let pixels = 0;
	for (let y = 0; y < h; y++) {
		const ly = y % frameH;
		for (let x = 0; x < w; x++) {
			const lx = x % frameW;
			const near = lx < widthPx || ly < widthPx || frameW - 1 - lx < widthPx || frameH - 1 - ly < widthPx;
			if (!near || !isBodyAt(img.data, (y * w + x) * 4, bodyAlpha, bodyMinRgb)) continue;
			pixels++;
			cellsHit.add(Math.floor(y / frameH) * Math.ceil(w / frameW) + Math.floor(x / frameW));
		}
	}
	return { cells: cellsHit.size, pixels };
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

/**
 * Per-frame file naming schemes of a `frames` source (`source.naming`; absent = "lordsOfPain"). In both the folder is
 * <animation folder>/<facing dir>/ and the angle the facing's screen angle (d * 360 / count, E = 0, counter-clockwise):
 *   lordsOfPain  <folder>_<dir>_<angle, 1 decimal>_<frame>.png       (the Lords of Pain packs: skeleton_E_0.0_3.png)
 *   smallscale   <folder>_<angle, integer>_<2 frame + 1, 3 digits>.png (SmallScaleInt's individual sprites, the paid
 *                edition's Archer: Idle_45_007.png is frame 3; the export numbers every other frame of a 30-frame
 *                render, 001..029, so `frames` stay the knight's grid indices 0..14). The angle must be a whole number.
 */
const FRAME_NAMINGS = ["lordsOfPain", "smallscale"];

/** The naming scheme of a `frames` source (FRAME_NAMINGS); throws on an unknown one. */
function frameNaming(source) {
	const naming = source.naming === undefined ? "lordsOfPain" : source.naming;
	if (!FRAME_NAMINGS.includes(naming)) throw new Error(`${source.dir}: source.naming must be one of ${FRAME_NAMINGS.join(", ")} (or absent), got ${JSON.stringify(source.naming)}`);
	return naming;
}

function frameFileName(set, anim, d) {
	const dir = set.facingDirs[d];
	const deg = (d * 360) / set.facingCount;
	const base = `${set.source.dir}/${anim.folder}/${dir}/${anim.folder}`;
	if (frameNaming(set.source) === "smallscale") {
		if (!Number.isInteger(deg)) throw new Error(`${set.source.dir}: naming "smallscale" needs whole-degree facings, facing ${d} of ${set.facingCount} is ${deg}`);
		return (frame) => `${base}_${deg}_${String(2 * frame + 1).padStart(3, "0")}.png`;
	}
	// Lords of Pain: <folder>/<dir>/<folder>_<dir>_<angle>_<frame>.png, angle = the facing's screen angle.
	const angle = deg.toFixed(1);
	return (frame) => `${base}_${dir}_${angle}_${frame}.png`;
}

/**
 * A grid source's `layers` (sub-folders of `dir`, bottom to top; "" = `dir` itself; see the header), or null when it
 * has none. Throws on a malformed list or on `layers` outside a grid source.
 */
function gridLayers(what, source) {
	const layers = source.layers;
	if (layers === undefined) return null;
	if (source.type !== "grid") throw new Error(`${what}: source.layers needs a grid source, not ${source.type}`);
	if (!Array.isArray(layers) || layers.length === 0) {
		throw new Error(`${what}: source.layers must be a non-empty array of sub-folders of source.dir, bottom to top ("" = source.dir itself)`);
	}
	const seen = new Set();
	for (const l of layers) {
		const bad =
			typeof l !== "string" || l.includes("\\") || (l !== "" && l.split("/").some((part) => part === "" || part === "." || part === ".."));
		if (bad) throw new Error(`${what}: source.layers entry ${JSON.stringify(l)} must be "" or a relative sub-folder of source.dir`);
		if (seen.has(l)) throw new Error(`${what}: source.layers lists ${JSON.stringify(l)} twice`);
		seen.add(l);
	}
	return layers;
}

/** Largest per-layer noise cut: 255 would clear every pixel of the layer. */
const MAX_LAYER_NOISE_ALPHA = 254;

/**
 * A grid source's `layerNoiseAlpha` (see the header) as one cut per layer, bottom first (0 = composited as it is), or
 * null without it. Throws on a key that is not a listed layer, a value outside 0-MAX_LAYER_NOISE_ALPHA, or no `layers`.
 */
function gridLayerNoise(what, source) {
	const cuts = source.layerNoiseAlpha;
	if (cuts === undefined) return null;
	const layers = gridLayers(what, source);
	if (!layers) throw new Error(`${what}: source.layerNoiseAlpha needs source.layers`);
	if (cuts === null || typeof cuts !== "object" || Array.isArray(cuts)) {
		throw new Error(`${what}: source.layerNoiseAlpha must be an object of layer -> alpha (an integer 0-${MAX_LAYER_NOISE_ALPHA})`);
	}
	for (const [layer, n] of Object.entries(cuts)) {
		if (!layers.includes(layer)) throw new Error(`${what}: source.layerNoiseAlpha names ${JSON.stringify(layer)}, which is not in source.layers`);
		if (!Number.isInteger(n) || n < 0 || n > MAX_LAYER_NOISE_ALPHA) {
			throw new Error(`${what}: source.layerNoiseAlpha.${JSON.stringify(layer)} must be an integer 0-${MAX_LAYER_NOISE_ALPHA}, got ${JSON.stringify(n)}`);
		}
	}
	return layers.map((l) => cuts[l] ?? 0);
}

/** The art/vendor-relative files of a grid animation's sheet, bottom layer first (one file without `layers`). */
function gridFiles(what, source, file) {
	const layers = gridLayers(what, source);
	if (!layers) return [`${source.dir}/${file}`];
	return layers.map((l) => (l === "" ? `${source.dir}/${file}` : `${source.dir}/${l}/${file}`));
}

/** Composited layered sheets by their file list (see gridSheet). Shared rasters: never mutate. */
const layeredCache = new Map();

/**
 * A grid animation's sheet: the file as it is without `layers`; with them, the layers composited bottom to top over a
 * transparent raster (compositeOver at full opacity), each first noise-cut by its `layerNoiseAlpha` (a copy: the cached
 * source is never touched). A missing layer or one of another size fails.
 */
function gridSheet(what, source, file) {
	const files = gridFiles(what, source, file);
	if (source.layers === undefined) return readPng(files[0]);
	const cuts = gridLayerNoise(what, source);
	const key = cuts ? `${files.join("\n")}\n${cuts.join()}` : files.join("\n");
	let img = layeredCache.get(key);
	if (img) return img;
	for (const rel of files) {
		if (!pngCache.has(rel) && !fs.existsSync(path.join(VENDOR, rel))) throw new Error(`${what}: layer file ${rel} is missing. ${missingHint(rel)}`);
	}
	files.forEach((rel, i) => {
		let layer = readPng(rel);
		if (!img) img = raster(layer.w, layer.h);
		else if (layer.w !== img.w || layer.h !== img.h) {
			throw new Error(`${what}: layer ${rel} is ${layer.w}x${layer.h}, but ${files[0]} is ${img.w}x${img.h} (layers must be the same size)`);
		}
		if (cuts && cuts[i] > 0) {
			const cut = raster(layer.w, layer.h);
			blit(layer, 0, 0, layer.w, layer.h, cut, 0, 0, cuts[i]);
			layer = cut;
		}
		compositeOver(layer, img, 0, 0, MILLE);
	});
	layeredCache.set(key, img);
	return img;
}

/** A set's `cells` option: "set" (absent: one cell for the set) or "perSheet" (each sheet its own; see the header). */
function cellsMode(id, set) {
	if (set.cells === undefined) return "set";
	if (set.cells === "perSheet") return "perSheet";
	throw new Error(`${id}: cells must be "perSheet" (each sheet trimmed to its own animations) or absent (one cell for the set), got ${JSON.stringify(set.cells)}`);
}

/** Every source file sprite set `id` reads (its real animations and `lockAlso`), added to `files` (a Set). */
function addSpriteSetFiles(files, id, set) {
	for (const name of Object.keys(set.animations).sort()) {
		const anim = set.animations[name];
		if (anim.cellsOf) continue;
		if (set.source.type === "grid") for (const f of gridFiles(id, set.source, anim.file)) files.add(f);
		else for (let d = 0; d < set.facingCount; d++) for (const f of anim.frames) files.add(frameFileName(set, anim, d)(f));
	}
	for (const name of Object.keys(set.lockAlso || {}).sort()) {
		const anim = set.lockAlso[name];
		if (set.source.type !== "frames" || !anim.folder || !Array.isArray(anim.frames)) throw new Error(`${id}: lockAlso.${name} needs a frames source, a folder and frames`);
		for (let d = 0; d < set.facingCount; d++) for (const f of anim.frames) files.add(frameFileName(set, anim, d)(f));
	}
	return files;
}

/** Every source file sprite set `id` of `spriteSets` reads, sorted (`--lock --only <set id>`). */
function spriteSetSourceFiles(spriteSets, id) {
	if (!Object.prototype.hasOwnProperty.call(spriteSets, id)) throw new Error(`no sprite set ${id}`);
	return [...addSpriteSetFiles(new Set(), id, spriteSets[id])].sort();
}

/** Every source file the config reads, sorted. */
function sourceFiles(config) {
	const files = new Set();
	for (const id of Object.keys(config.spriteSets).sort()) addSpriteSetFiles(files, id, config.spriteSets[id]);
	for (const id of Object.keys(config.images).sort()) files.add(config.images[id].file);
	for (const f of worldSourceFiles(config.worldArt)) files.add(f);
	for (const id of fxIds(config)) files.add(config.fx.sets[id].file);
	for (const id of ambientIds(config)) files.add(config.ambient[id].file);
	if (config.uiIcons) for (const id of uiIconIds(config.uiIcons)) files.add(uiIconFile(config.uiIcons, id));
	for (const f of bulletSourceFiles(config.bullets)) files.add(f);
	for (const f of gooSourceFiles(config.goo)) files.add(f);
	for (const f of boostAuraSourceFiles(config.boostAuras)) files.add(f);
	for (const f of treasureSourceFiles(config.treasure)) files.add(f);
	for (const f of hazardSourceFiles(config.hazards)) files.add(f);
	for (const f of fortuneSourceFiles(config.fortune)) files.add(f);
	for (const f of boonIconSourceFiles(config.boonIcons)) files.add(f);
	for (const f of itemIconSourceFiles(config.itemIcons)) files.add(f);
	for (const f of boostIconSourceFiles(config.boostIcons)) files.add(f);
	for (const f of pipIconSourceFiles(config.pipIcons)) files.add(f);
	for (const f of duoIconSourceFiles(config.duoIcons)) files.add(f);
	for (const f of kenneySourceFiles(config.kenney)) files.add(f);
	return [...files].sort();
}

function hashFile(rel) {
	const bytes = fs.readFileSync(path.join(VENDOR, rel));
	return { path: rel, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
}

function missingHint(rel) {
	return `art/vendor/${rel} is missing. Download the packs into art/vendor/ as art/README.md describes.`;
}

/**
 * Rewrites art/vendor.lock.json. `only` (a list of art/vendor-relative files, `--lock --only <group>`): hashes just
 * those and merges them into the existing lock (replacing their entries, every other entry kept as it is, sorted by
 * path like a full lock), for a machine that holds only that group's packs.
 */
function writeLock(config, only) {
	const fresh = (only || sourceFiles(config)).map((rel) => {
		if (!fs.existsSync(path.join(VENDOR, rel))) fail(missingHint(rel));
		return hashFile(rel);
	});
	let entries = fresh;
	if (only) {
		if (!fs.existsSync(LOCK_FILE)) fail("--lock --only needs an existing art/vendor.lock.json to merge into");
		const mine = new Set(only);
		const kept = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8")).files.filter((e) => !mine.has(e.path));
		entries = mergeLockEntries(kept, fresh);
	}
	const lock = {
		$comment: "Generated by `npm run art:lock` from art/atlases.json: every source file the atlas pipeline reads (paths relative to art/vendor/).",
		files: entries,
	};
	fs.writeFileSync(LOCK_FILE, JSON.stringify(lock, null, "\t") + "\n");
	console.log(`art:lock: ${entries.length} file(s)${only ? ` (${fresh.length} re-hashed)` : ""} -> ${path.relative(ROOT, LOCK_FILE)}`);
}

/** Lock entries `kept` plus `fresh` (which win on a shared path), sorted by path (the order sourceFiles gives). */
function mergeLockEntries(kept, fresh) {
	const byPath = new Map(kept.map((e) => [e.path, e]));
	for (const e of fresh) byPath.set(e.path, e);
	return [...byPath.keys()].sort().map((k) => byPath.get(k));
}

/** Checks `files` (default: every file the config reads) against art/vendor.lock.json; fails the build on a mismatch. */
function checkLock(config, files) {
	if (!fs.existsSync(LOCK_FILE)) fail("art/vendor.lock.json is missing; run `npm run art:lock` once the packs are in art/vendor/.");
	const lock = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
	const locked = new Map(lock.files.map((e) => [e.path, e]));
	const problems = [];
	for (const rel of files || sourceFiles(config)) {
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
		const img = gridSheet(anim.file, source, anim.file);
		const cols = Math.floor(img.w / source.frameW);
		const rows = Math.floor(img.h / source.frameH);
		const row = set.rowForFacing[d];
		if (frame >= cols || row >= rows) throw new Error(`${anim.file}: frame ${frame} row ${row} outside the ${cols}x${rows} grid`);
		return { img, x: frame * source.frameW, y: row * source.frameH, w: source.frameW, h: source.frameH };
	}
	if (source.type === "frames") {
		const rel = frameFileName(set, anim, d)(frame);
		if (!pngCache.has(rel) && !fs.existsSync(path.join(VENDOR, rel))) fail(`${missingHint(rel)} (or facingDirs does not match the folder angles)`);
		const img = readPng(rel);
		if (img.w !== source.frameW || img.h !== source.frameH) throw new Error(`${rel}: ${img.w}x${img.h}, expected ${source.frameW}x${source.frameH}`);
		return { img, x: 0, y: 0, w: img.w, h: img.h };
	}
	throw new Error(`unknown source type ${source.type}`);
}

/** A sprite set's `downscale` factor: 1 when absent, else an integer >= 1 (throws otherwise). */
function spriteDownscale(id, set) {
	const k = set.downscale === undefined ? 1 : set.downscale;
	if (!Number.isInteger(k) || k < 1) throw new Error(`${id}: downscale must be an integer >= 1, got ${JSON.stringify(set.downscale)}`);
	return k;
}

/**
 * A region of a downscaled set as its own raster: the source region with alpha <= noiseAlpha cleared (at full
 * resolution, before anything else, as for every set), then box-filtered by k (`downscale`, premultiplied). The
 * frame's k-blocks start at the region's top-left, so a crop aligned to whole blocks in source pixels is the same
 * crop / k here.
 */
function scaledRegion(set, r, k) {
	const clean = raster(r.w, r.h);
	blit(r.img, r.x, r.y, r.w, r.h, clean, 0, 0, set.noiseAlpha);
	const img = downscale(clean, k);
	return { img, x: 0, y: 0, w: img.w, h: img.h };
}

/**
 * A sprite set's `recolor` (see the header) as a 256-entry lookup: luminance l -> RGB at lut[3 l .. 3 l + 2], each channel
 * the ramp's colour at l linearly interpolated between the stops around it (c0 + round(dc * (l - l0) / span), half up,
 * integer maths), exactly the stop's colour at a stop. Null when `recolor` is absent; throws on a malformed one.
 */
function recolorLut(id, recolor) {
	if (recolor === undefined) return null;
	const bad = (why) => new Error(`${id}: recolor ${why}`);
	if (recolor === null || typeof recolor !== "object" || Array.isArray(recolor)) throw bad("must be an object { ramp }");
	for (const k of Object.keys(recolor)) if (k !== "ramp" && !k.startsWith("$")) throw bad(`.${k}: unknown key (allowed: ramp)`);
	const ramp = recolor.ramp;
	if (!Array.isArray(ramp) || ramp.length < 2) throw bad('ramp must list at least two stops [luminance, "#rrggbb"]');
	ramp.forEach((stop, i) => {
		if (!Array.isArray(stop) || stop.length !== 2 || !isByte(stop[0]) || typeof stop[1] !== "string" || !HEX_RGB.test(stop[1])) {
			throw bad(`ramp[${i}] must be [an integer 0-255, "#rrggbb"], got ${JSON.stringify(stop)}`);
		}
		if (i > 0 && stop[0] <= ramp[i - 1][0]) throw bad(`ramp luminances must strictly increase (ramp[${i}] ${stop[0]} after ${ramp[i - 1][0]})`);
	});
	if (ramp[0][0] !== 0 || ramp[ramp.length - 1][0] !== 255) throw bad("ramp must run from luminance 0 to 255");
	const rgb = ramp.map(([, hex]) => {
		const v = parseInt(hex.slice(1), 16);
		return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
	});
	const lut = new Uint8Array(256 * 3);
	let s = 0;
	for (let l = 0; l < 256; l++) {
		while (ramp[s + 1][0] < l) s++;
		const l0 = ramp[s][0];
		const span = ramp[s + 1][0] - l0;
		for (let c = 0; c < 3; c++) {
			const dc = rgb[s + 1][c] - rgb[s][c];
			lut[l * 3 + c] = rgb[s][c] + Math.floor((2 * dc * (l - l0) + span) / (2 * span));
		}
	}
	return lut;
}

/** Region r as its own raster with every pixel's RGB replaced by lut[its luminance] (LUMA, rounded); alpha kept. */
function recolorRegion(r, lut) {
	const img = raster(r.w, r.h);
	const src = r.img.data;
	for (let y = 0; y < r.h; y++) {
		for (let x = 0; x < r.w; x++) {
			const px = r.x + x;
			const py = r.y + y;
			if (px < 0 || py < 0 || px >= r.img.w || py >= r.img.h) continue;
			const si = (py * r.img.w + px) * 4;
			const di = (y * r.w + x) * 4;
			const l = Math.floor((LUMA[0] * src[si] + LUMA[1] * src[si + 1] + LUMA[2] * src[si + 2] + MILLE / 2) / MILLE);
			img.data[di] = lut[l * 3];
			img.data[di + 1] = lut[l * 3 + 1];
			img.data[di + 2] = lut[l * 3 + 2];
			img.data[di + 3] = src[si + 3];
		}
	}
	return { img, x: 0, y: 0, w: r.w, h: r.h };
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
 * `bodyHeight` is in the set's atlas pixels (already / `downscale`). `pixelsPerTileFrom` is only defined between two
 * full-resolution sets (`k`: this set's downscale): a downscaled set on either side fails the build.
 */
function setPixelsPerTile(id, set, bodyHeight, built, k = 1) {
	const hasFrom = set.pixelsPerTileFrom !== undefined;
	const hasTiles = set.bodyTiles !== undefined;
	if (hasFrom === hasTiles) throw new Error(`${id}: give exactly one of bodyTiles and pixelsPerTileFrom`);
	if (hasTiles) {
		if (typeof set.bodyTiles !== "number" || !(set.bodyTiles > 0)) throw new Error(`${id}: bodyTiles must be a positive number`);
		return Math.round((bodyHeight / set.bodyTiles) * 10) / 10;
	}
	const from = built ? built.get(set.pixelsPerTileFrom) : undefined;
	if (!from) throw new Error(`${id}: pixelsPerTileFrom ${set.pixelsPerTileFrom} is not a built sprite set (build with buildSpriteSets)`);
	if (k !== 1 || (from.downscale !== undefined && from.downscale !== 1)) throw new Error(`${id}: pixelsPerTileFrom ${set.pixelsPerTileFrom} needs two sets without downscale`);
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

/** Sprite set `id` and the sets its `pixelsPerTileFrom` chain names, in build order (each named set before its user). */
function spriteSetChain(spriteSets, id) {
	if (!Object.prototype.hasOwnProperty.call(spriteSets, id)) throw new Error(`no sprite set ${id}`);
	const order = spriteSetOrder(spriteSets); // fails on a missing or cyclic reference first
	const need = new Set();
	for (let cur = id; cur !== undefined; cur = spriteSets[cur].pixelsPerTileFrom) need.add(cur);
	return order.filter((x) => need.has(x));
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
	const k = spriteDownscale(id, set);
	const perSheet = cellsMode(id, set) === "perSheet";
	gridLayers(id, set.source); // a malformed `layers` fails here, before any file is read
	gridLayerNoise(id, set.source); // and a malformed `layerNoiseAlpha`
	const lut = recolorLut(id, set.recolor); // and a malformed `recolor`; null when absent
	/** A kept frame's source region, recoloured when the set has `recolor` (before anything reads it). */
	const region = (anim, d, f) => (lut ? recolorRegion(sourceRegion(set, anim, d, f), lut) : sourceRegion(set, anim, d, f));

	// 1. union crop box (source-frame coordinates) over every kept frame of every real animation and facing; with
	// per-sheet cells, each animation's own box is kept for its sheet's crop
	let box = null;
	const animBoxes = new Map();
	for (const name of realNames) {
		const anim = set.animations[name];
		let animBox = null;
		for (let d = 0; d < count; d++) {
			for (const f of anim.frames) {
				const r = region(anim, d, f);
				animBox = unionBox(animBox, alphaBounds(r.img, r.x, r.y, r.w, r.h, set.noiseAlpha));
			}
		}
		animBoxes.set(name, animBox);
		box = unionBox(box, animBox);
	}
	if (!box) throw new Error(`${id}: no visible pixels`);
	// downscale k: the box grows to whole k-blocks (every downscaled pixel with any kept source pixel is inside it),
	// then everything below is in downscaled pixels: the box / k, the origin, the cell, the pad, the outline.
	const blocks = (b) => (k === 1 ? b : [Math.floor(b[0] / k), Math.floor(b[1] / k), Math.floor(b[2] / k), Math.floor(b[3] / k)]);
	const cropBox = blocks(box);
	const pad = set.pad;
	const originX = cropBox[0] - pad;
	const originY = cropBox[1] - pad;
	const frameW = cropBox[2] - cropBox[0] + 1 + 2 * pad;
	const frameH = cropBox[3] - cropBox[1] + 1 + 2 * pad;
	/** A kept frame's pixels in the set's (downscaled) pixel space, and the noise cut still to apply when blitting. */
	const cellSource = (anim, d, f) => {
		const r = region(anim, d, f);
		return k === 1 ? { r, noise: set.noiseAlpha } : { r: scaledRegion(set, r, k), noise: 0 };
	};

	// 2. pivot (feet) and texel density, measured on one frame; the other facings are printed as a sanity check
	const measureBody = (animName, d, kept) => {
		const { anim } = realAnimation(set, animName);
		const r = region(anim, d, anim.frames[kept]);
		const { bodyAlpha, bodyMinRgb } = set.pivot;
		const isBody = (x, y) => {
			return isBodyAt(r.img.data, ((r.y + y) * r.img.w + r.x + x) * 4, bodyAlpha, bodyMinRgb);
		};
		let b = null;
		for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) if (isBody(x, y)) b = unionBox(b, [x, y, x, y]);
		if (!b) throw new Error(`${id}: no body pixels in ${animName} facing ${d} frame ${kept}`);
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
	// Measured on the full-resolution source (the body cuts are tuned there), then / k: x rounded, y the bottom edge
	// of the downscaled pixel row holding the lowest body row (ceil), height and pixelsPerTile in downscaled pixels.
	/** The pivot point in source-frame coordinates (/ k when downscaled): the same point in every cell of the set. */
	const pivotAt = k === 1 ? { x: Math.round(body.feetX), y: body.feetY } : { x: Math.round(body.feetX / k), y: Math.ceil(body.feetY / k) };
	const pivot = { x: pivotAt.x - originX, y: pivotAt.y - originY };
	const pixelsPerTile = setPixelsPerTile(id, set, body.height / k, built, k);
	const sanity = [];
	for (let d = 0; d < count; d++) {
		const s = measureBody(m.animation, d, m.frame);
		sanity.push(`${d}:(${s.feetX / k - originX},${s.feetY / k - originY})h${s.height / k}`);
	}

	// 3. sheets: each sheet holds its animations back to back, facing-major, in the set's cell or (per-sheet cells)
	// in the union box of its own animations plus the pixel up-left of the pivot point, so the pivot stays inside
	const sheets = [];
	const animations = {};
	set.sheets.forEach((sheetDef, sheetIndex) => {
		let cells = 0;
		const placed = [];
		let sheetBox = null;
		for (const name of sheetDef.animations) {
			const anim = set.animations[name];
			if (!anim || anim.cellsOf) throw new Error(`${id}: sheet ${sheetDef.name} lists ${name}, which is not a real animation`);
			if (animations[name]) throw new Error(`${id}: ${name} is in two sheets`);
			animations[name] = { sheet: sheetIndex, start: cells, frames: anim.frames.length, fps: anim.fps, loop: anim.loop };
			placed.push({ name, anim, start: cells });
			cells += anim.frames.length * count;
			sheetBox = unionBox(sheetBox, animBoxes.get(name));
		}
		let cell = { originX, originY, frameW, frameH, pivot };
		if (perSheet) {
			const b = unionBox(blocks(sheetBox), [pivotAt.x - 1, pivotAt.y - 1, pivotAt.x - 1, pivotAt.y - 1]);
			const ox = b[0] - pad;
			const oy = b[1] - pad;
			cell = { originX: ox, originY: oy, frameW: b[2] - b[0] + 1 + 2 * pad, frameH: b[3] - b[1] + 1 + 2 * pad, pivot: { x: pivotAt.x - ox, y: pivotAt.y - oy } };
		}
		const cw = cell.frameW;
		const ch = cell.frameH;
		const { cols, rows } = chooseGrid(cells, cw, ch, `${id} sheet ${sheetDef.name}`);
		const img = raster(cols * cw, rows * ch);
		for (const p of placed) {
			for (let d = 0; d < count; d++) {
				p.anim.frames.forEach((f, fi) => {
					const c = p.start + d * p.anim.frames.length + fi;
					const { r, noise } = cellSource(p.anim, d, f);
					blit(r.img, r.x + cell.originX, r.y + cell.originY, cw, ch, img, (c % cols) * cw, Math.floor(c / cols) * ch, noise);
				});
			}
		}
		alphaBleed(img);
		const sheet = { name: sheetDef.name, file: `${sheetDef.name}.png`, img, cells };
		if (perSheet) sheet.cell = cell;
		if (outline) {
			sheet.outlineFile = `${sheetDef.name}-outline.png`;
			sheet.outlineImg = outlineSheet(img, cw, ch, outline.widthPx, set.pivot.bodyAlpha, set.pivot.bodyMinRgb);
			if (outline.clipAtCellEdge) sheet.rimClip = rimClip(img, cw, ch, outline.widthPx, set.pivot.bodyAlpha, set.pivot.bodyMinRgb);
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
			if (s.cell) {
				sheet.frameW = s.cell.frameW;
				sheet.frameH = s.cell.frameH;
				sheet.pivot = { x: s.cell.pivot.x, y: s.cell.pivot.y };
			}
			if (s.outlineFile) sheet.outlineFile = s.outlineFile;
			return sheet;
		}),
		animations: sortedObject(animations),
	};
	selfCheck(id, layout);
	const recolorStops = lut ? set.recolor.ramp.length : 0;
	return { id, layout, sheets, sanity, bodyHeight: body.height / k, box, downscale: k, outline, pixelsPerTileFrom: set.pixelsPerTileFrom, perSheet, recolorStops };
}

/** The cell of layout sheet `s`: its own frameW / frameH / pivot (per-sheet cells) or the set's. */
function sheetCell(layout, s) {
	return {
		w: s.frameW !== undefined ? s.frameW : layout.frameW,
		h: s.frameH !== undefined ? s.frameH : layout.frameH,
		pivot: s.pivot !== undefined ? s.pivot : layout.pivot,
	};
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
		const c = sheetCell(layout, s);
		if (s.w > MAX_ATLAS || s.h > MAX_ATLAS) throw new Error(`${id}: ${s.file} is ${s.w}x${s.h} (> ${MAX_ATLAS})`);
		if (s.w % c.w !== 0 || s.h % c.h !== 0) throw new Error(`${id}: ${s.file} is not a whole number of cells`);
		if (s.outlineFile !== undefined && s.outlineFile !== s.file.replace(/\.png$/, "-outline.png")) throw new Error(`${id}: outline of ${s.file} is ${s.outlineFile}`);
		if (c.pivot.x < 0 || c.pivot.y < 0 || c.pivot.x > c.w || c.pivot.y > c.h) {
			throw new Error(`${id}: ${s.file} pivot (${c.pivot.x}, ${c.pivot.y}) outside its ${c.w}x${c.h} cell`);
		}
	}
	for (const name of Object.keys(layout.animations)) {
		const a = layout.animations[name];
		const sheet = layout.sheets[a.sheet];
		if (!sheet) throw new Error(`${id}.${name}: sheet ${a.sheet} missing`);
		const c = sheetCell(layout, sheet);
		const perRow = Math.floor(sheet.w / c.w);
		for (let d = 0; d < layout.facings.count; d++) {
			for (let f = 0; f < a.frames; f++) {
				const cell = a.start + d * (a.stride === undefined ? a.frames : a.stride) + f;
				const x = (cell % perRow) * c.w;
				const y = Math.floor(cell / perRow) * c.h;
				if (x + c.w > sheet.w || y + c.h > sheet.h) {
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

/**
 * Contact sheet of a sprite set. Each frame slot spans the set's cell; with per-sheet cells, it spans the union of the
 * set's cell and every sheet's cell placed so all pivots coincide (a sheet's cell sits at the set pivot minus its own),
 * so the feet line up across animations and the grey border shows each sheet's own trim.
 */
function contactSheet(result) {
	const { layout } = result;
	const names = Object.keys(layout.animations);
	const maxFrames = Math.max(...names.map((n) => layout.animations[n].frames));
	const cells = layout.sheets.map((s) => {
		const c = sheetCell(layout, s);
		return { ...c, offX: layout.pivot.x - c.pivot.x, offY: layout.pivot.y - c.pivot.y };
	});
	let x0 = 0;
	let y0 = 0;
	let x1 = layout.frameW;
	let y1 = layout.frameH;
	for (const c of cells) {
		x0 = Math.min(x0, c.offX);
		y0 = Math.min(y0, c.offY);
		x1 = Math.max(x1, c.offX + c.w);
		y1 = Math.max(y1, c.offY + c.h);
	}
	const cellW = x1 - x0 + CONTACT_GUTTER;
	const cellH = y1 - y0 + CONTACT_GUTTER;
	const w = CONTACT_MARGIN + maxFrames * cellW;
	const h = names.length * (layout.facings.count * cellH + CONTACT_SEPARATOR);
	const img = raster(w, h);
	fillRect(img, 0, 0, w, h, [CONTACT_BG, CONTACT_BG, CONTACT_BG]);
	const sheetImgs = result.sheets.map((s) => s.img);
	let y = 0;
	for (const name of names) {
		const a = layout.animations[name];
		const sheet = layout.sheets[a.sheet];
		const c = cells[a.sheet];
		const perRow = Math.floor(sheet.w / c.w);
		for (let d = 0; d < layout.facings.count; d++) {
			arrow(img, CONTACT_MARGIN / 2, y + Math.floor(cellH / 2), (d * 360) / layout.facings.count, Math.floor(CONTACT_MARGIN / 2) - 6);
			for (let f = 0; f < a.frames; f++) {
				const cell = a.start + d * (a.stride === undefined ? a.frames : a.stride) + f;
				const dx = CONTACT_MARGIN + f * cellW + CONTACT_GUTTER / 2 + c.offX - x0;
				const dy = y + CONTACT_GUTTER / 2 + c.offY - y0;
				fillRect(img, dx - 1, dy - 1, c.w + 2, c.h + 2, [96, 96, 96]);
				fillRect(img, dx, dy, c.w, c.h, [CONTACT_BG, CONTACT_BG, CONTACT_BG]);
				const sx = (cell % perRow) * c.w;
				const sy = Math.floor(cell / perRow) * c.h;
				const outlineImg = result.sheets[a.sheet].outlineImg;
				if (outlineImg) over(outlineImg, sx, sy, c.w, c.h, img, dx, dy, OUTLINE_PREVIEW_RGB);
				over(sheetImgs[a.sheet], sx, sy, c.w, c.h, img, dx, dy);
				fillRect(img, dx + c.pivot.x - 3, dy + c.pivot.y, 7, 1, [230, 30, 30]);
				fillRect(img, dx + c.pivot.x, dy + c.pivot.y - 3, 1, 7, [230, 30, 30]);
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
 *
 * Sheet cuts and 9-sliced panels (docs/DRAFT_REVEAL.md DR3; the ToffeeCraft Horror UI sheet):
 *   - `rect` [x, y, w, h] (optional): the window of `file` the image is cut from (default: the whole file). `crop`
 *     "none" keeps the window as it is, "alpha" trims it to its pixels with alpha > noiseAlpha (+ pad). With "none",
 *     `noiseAlpha` (optional) clears the window's pixels with alpha <= it (absent: every pixel is kept);
 *   - `pivot` may also be [x, y] (pixels from the image's top-left, inside it);
 *   - `cutout` { outlineRgb } (optional): keeps only what an outline encloses (a piece cut from a busier panel, the
 *     red-eyed skulls): pixels with alpha > 0 and max(R, G, B) <= outlineRgb are the outline; every pixel 4-connected
 *     to the image border without crossing it is cleared (cutoutPixels);
 *   - `slice` [left, top, right, bottom] (optional): 9-slice insets in image pixels, integers >= 0 that leave a centre
 *     of at least 1 x 1 pixel; copied into the layout as { left, top, right, bottom };
 *   - `centre: "flat"` (with `slice`): fills the slice centre with its rounded mean colour (alpha 255), so stretching
 *     does not smear the panel's noise texture into blocks. `flatBoxes` [[x, y, w, h], ...] (optional) fill those boxes
 *     instead, all with the one mean of their pixels: a panel whose slice stretches a 1 px row or column through its
 *     edges (insets wide enough to keep the corner ornaments whole) flattens the panel fill along those lines too. The
 *     boxes must cover the slice centre and hold only opaque pixels (flatFill);
 *   - `mask` { maxRgb, boxes? } (optional, not with `centre`): the image becomes a white-on-transparent mask of its
 *     pixels with alpha > 0 and max(R, G, B) <= maxRgb inside `boxes` (default: everywhere), e.g. a skull's eye
 *     sockets. Same `file` / `rect` / `crop` / `slice` as the image it is drawn over keeps the two registered (maskPixels).
 *   - `clearRgb` ["#rrggbb", ...] (optional, docs/UI_ART.md UA3): clears the pixels of exactly those colours, after the
 *     crop and the cutout (a piece painted on an opaque backdrop: the portrait frame's coin);
 *   - `rgb` (optional, after `clearRgb`): "white" makes every pixel white with its alpha kept (a piece tinted by a
 *     colour role in code, like the white loot beam), "grey" its rounded luminance (LUMA, alpha kept; a dimmed state).
 *
 * A repeating tile (`tilesPerImage`, a biome floor or wall texture) needs `meanHex: true`: the rounded mean sRGB of all
 * its pixels, written to layout.ts's VALE_TILE_MEAN_HEX, which the pack manifest makes that biome surface's colour
 * once the texture is uploaded (so the contrast checks describe what is drawn).
 */
function buildImage(id, def, built) {
	let pixelsPerTile;
	if (def.pixelsPerTileFrom !== undefined) {
		const from = built ? built.get(def.pixelsPerTileFrom) : undefined;
		if (!from) throw new Error(`${id}: pixelsPerTileFrom ${def.pixelsPerTileFrom} is not a built sprite set`);
		pixelsPerTile = from.layout.pixelsPerTile;
	}
	const src = readPng(def.file);
	const win = imageWindow(id, def, src);
	let img;
	let pivot;
	if (def.crop === "none") {
		img = raster(win.w, win.h);
		blit(src, win.x, win.y, win.w, win.h, img, 0, 0, def.noiseAlpha === undefined ? -1 : def.noiseAlpha);
	} else if (def.crop === "alpha") {
		const b = alphaBounds(src, win.x, win.y, win.w, win.h, def.noiseAlpha);
		if (!b) throw new Error(`${id}: no visible pixels`);
		const pad = def.pad === undefined ? 0 : def.pad;
		const w = b[2] - b[0] + 1 + 2 * pad;
		const h = b[3] - b[1] + 1 + 2 * pad;
		img = raster(w, h);
		blit(src, win.x + b[0] - pad, win.y + b[1] - pad, w, h, img, 0, 0, def.noiseAlpha);
	} else throw new Error(`${id}: unknown crop ${def.crop}`);
	if (def.cutout !== undefined) {
		if (!isByte(def.cutout.outlineRgb)) throw new Error(`${id}: cutout.outlineRgb must be an integer 0-255`);
		cutoutPixels(img, def.cutout.outlineRgb);
	}
	if (def.clearRgb !== undefined) clearColours(id, img, def.clearRgb);
	if (def.rgb !== undefined) recolour(id, img, def.rgb);
	if (def.pivot === "center") pivot = { x: img.w / 2, y: img.h / 2 };
	else if (def.pivot === "bottom") pivot = { x: img.w / 2, y: img.h - def.pad };
	else if (Array.isArray(def.pivot)) {
		const [x, y] = def.pivot;
		if (def.pivot.length !== 2 || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > img.w || y > img.h) {
			throw new Error(`${id}: pivot ${JSON.stringify(def.pivot)} must be [x, y] inside the ${img.w}x${img.h} image`);
		}
		pivot = { x, y };
	} else if (def.pivot !== undefined) throw new Error(`${id}: unknown pivot ${def.pivot}`);
	if (img.w > MAX_ATLAS || img.h > MAX_ATLAS) throw new Error(`${id}: ${img.w}x${img.h} > ${MAX_ATLAS}`);
	const slice = def.slice === undefined ? undefined : sliceInsets(id, def.slice, img);
	if (def.mask !== undefined && def.centre !== undefined) throw new Error(`${id}: a mask has no centre to flatten`);
	if (def.centre !== undefined) {
		if (def.centre !== "flat") throw new Error(`${id}: centre must be "flat", got ${JSON.stringify(def.centre)}`);
		if (!slice) throw new Error(`${id}: centre "flat" needs a slice`);
		flatFill(id, img, slice, def.flatBoxes);
	} else if (def.flatBoxes !== undefined) throw new Error(`${id}: flatBoxes needs centre "flat"`);
	if (def.mask !== undefined) {
		if (!isByte(def.mask.maxRgb)) throw new Error(`${id}: mask.maxRgb must be an integer 0-255`);
		const boxes = def.mask.boxes === undefined ? [[0, 0, img.w, img.h]] : def.mask.boxes.map((b) => box(id, "mask box", b, img));
		img = maskPixels(img, def.mask.maxRgb, boxes);
	}

	if (def.tilesPerImage !== undefined && !def.meanHex) {
		throw new Error(`${id}: a repeating tile (tilesPerImage) needs meanHex: its mean colour is the biome surface's`);
	}
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
	if (slice) layout.slice = slice;
	return { id, name: def.name, img, layout, meanHex };
}

const isByte = (n) => Number.isInteger(n) && n >= 0 && n <= 255;

/** An image's source window ({ x, y, w, h } in `src`): `rect` checked inside the file, or the whole file. */
function imageWindow(id, def, src) {
	if (def.rect === undefined) return { x: 0, y: 0, w: src.w, h: src.h };
	const [x, y, w, h] = box(id, "rect", def.rect, src);
	return { x, y, w, h };
}

/** [x, y, w, h], integers, w and h >= 1, inside `img` (throws otherwise). */
function box(id, what, b, img) {
	const ok = Array.isArray(b) && b.length === 4 && b.every((n) => Number.isInteger(n)) && b[0] >= 0 && b[1] >= 0 && b[2] >= 1 && b[3] >= 1;
	if (!ok || b[0] + b[2] > img.w || b[1] + b[3] > img.h) {
		throw new Error(`${id}: ${what} ${JSON.stringify(b)} must be [x, y, w, h] (integers, w, h >= 1) inside the ${img.w}x${img.h} image`);
	}
	return b;
}

/** A `slice` [left, top, right, bottom] as layout insets, checked: integers >= 0 leaving a centre of >= 1 x 1 pixel. */
function sliceInsets(id, slice, img) {
	const ok = Array.isArray(slice) && slice.length === 4 && slice.every((n) => Number.isInteger(n) && n >= 0);
	if (!ok) throw new Error(`${id}: slice ${JSON.stringify(slice)} must be [left, top, right, bottom], integers >= 0`);
	const [left, top, right, bottom] = slice;
	if (left + right >= img.w || top + bottom >= img.h) {
		throw new Error(`${id}: slice ${JSON.stringify(slice)} leaves no centre in the ${img.w}x${img.h} image (left + right < w, top + bottom < h)`);
	}
	return { left, top, right, bottom };
}

/**
 * Fills `boxes` (default: the slice centre) with the rounded mean RGB of their pixels, alpha 255, in place. Throws
 * when a box holds a pixel that is not opaque or the boxes leave a centre pixel unfilled (it would stretch as it is).
 */
function flatFill(id, img, slice, flatBoxes) {
	const cw = img.w - slice.left - slice.right;
	const ch = img.h - slice.top - slice.bottom;
	const boxes = flatBoxes === undefined ? [[slice.left, slice.top, cw, ch]] : flatBoxes.map((b) => box(id, "flat box", b, img));
	const inside = new Uint8Array(img.w * img.h);
	for (const [bx, by, bw, bh] of boxes) for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) inside[y * img.w + x] = 1;
	for (let y = slice.top; y < slice.top + ch; y++) {
		for (let x = slice.left; x < slice.left + cw; x++) {
			if (!inside[y * img.w + x]) throw new Error(`${id}: flatBoxes leave the slice centre's pixel (${x}, ${y}) unfilled`);
		}
	}
	const sum = [0, 0, 0];
	let n = 0;
	for (let i = 0; i < inside.length; i++) {
		if (!inside[i]) continue;
		if (img.data[i * 4 + 3] !== 255) throw new Error(`${id}: flat box pixel (${i % img.w}, ${Math.floor(i / img.w)}) is not opaque`);
		for (let k = 0; k < 3; k++) sum[k] += img.data[i * 4 + k];
		n++;
	}
	const mean = sum.map((v) => Math.floor((2 * v + n) / (2 * n)));
	for (let i = 0; i < inside.length; i++) if (inside[i]) img.data.set([mean[0], mean[1], mean[2], 255], i * 4);
	return mean;
}

/**
 * Clears, in place, every pixel 4-connected to the image border without crossing the outline (alpha > 0 and
 * max(R, G, B) <= outlineRgb): what is left is the outline and what it encloses. 4-connected, so an outline drawn with
 * 8-connected (diagonal) steps still closes.
 */
function cutoutPixels(img, outlineRgb) {
	const { w, h, data } = img;
	const isOutline = (i) => data[i * 4 + 3] > 0 && Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) <= outlineRgb;
	const outside = new Uint8Array(w * h);
	const stack = [];
	const seed = (x, y) => {
		const i = y * w + x;
		if (!outside[i] && !isOutline(i)) {
			outside[i] = 1;
			stack.push(i);
		}
	};
	for (let x = 0; x < w; x++) {
		seed(x, 0);
		seed(x, h - 1);
	}
	for (let y = 0; y < h; y++) {
		seed(0, y);
		seed(w - 1, y);
	}
	while (stack.length > 0) {
		const i = stack.pop();
		const x = i % w;
		const y = (i - x) / w;
		if (x > 0) seed(x - 1, y);
		if (x < w - 1) seed(x + 1, y);
		if (y > 0) seed(x, y - 1);
		if (y < h - 1) seed(x, y + 1);
	}
	for (let i = 0; i < w * h; i++) if (outside[i]) data.fill(0, i * 4, i * 4 + 4);
}

/** A new raster: white, opaque where `img` has alpha > 0 and max(R, G, B) <= maxRgb inside one of `boxes`; else clear. */
function maskPixels(img, maxRgb, boxes) {
	const out = raster(img.w, img.h);
	for (const [bx, by, bw, bh] of boxes) {
		for (let y = by; y < by + bh; y++) {
			for (let x = bx; x < bx + bw; x++) {
				const i = (y * img.w + x) * 4;
				if (img.data[i + 3] > 0 && Math.max(img.data[i], img.data[i + 1], img.data[i + 2]) <= maxRgb) out.data.set([255, 255, 255, 255], i);
			}
		}
	}
	return out;
}

const HEX_RGB = /^#[0-9a-fA-F]{6}$/;

/** Clears, in place, every pixel whose RGB is exactly one of `colours` ("#rrggbb"), whatever its alpha. */
function clearColours(id, img, colours) {
	if (!Array.isArray(colours) || colours.length === 0 || !colours.every((c) => typeof c === "string" && HEX_RGB.test(c))) {
		throw new Error(`${id}: clearRgb must be a non-empty list of "#rrggbb" colours, got ${JSON.stringify(colours)}`);
	}
	const keys = new Set(colours.map((c) => parseInt(c.slice(1), 16)));
	for (let i = 0; i < img.w * img.h; i++) {
		const p = i * 4;
		if (keys.has(img.data[p] * 65536 + img.data[p + 1] * 256 + img.data[p + 2])) img.data.fill(0, p, p + 4);
	}
}

/** `rgb` in place: "white" sets every pixel's RGB to 255, "grey" to its rounded luminance (LUMA); alpha is kept. */
function recolour(id, img, mode) {
	if (mode !== "white" && mode !== "grey") throw new Error(`${id}: rgb must be "white" or "grey", got ${JSON.stringify(mode)}`);
	const d = img.data;
	for (let p = 0; p < d.length; p += 4) {
		const v = mode === "white" ? 255 : Math.floor((LUMA[0] * d[p] + LUMA[1] * d[p + 1] + LUMA[2] * d[p + 2] + MILLE / 2) / MILLE);
		d[p] = v;
		d[p + 1] = v;
		d[p + 2] = v;
	}
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
//               a sprite set may also say `own`: its cells become their own sheet `<own>.png`, packed after the shared
//               atlases, so adding one never repacks (and never forces a re-upload of) the shared atlas;
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
//   [x, y]  images: a point given in the source frame's pixels (a 3D kit render's footprint centre on the floor,
//           written by scripts/art/kit/render_kit.py: solid decor stands centred on its cells)
//   [[x, y], ...]  sprites: the same, one point per output facing d (the vault chest's four facings, docs/TREASURE.md TR9)
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

/** A world image's explicit pivot [x, y] in its source frame's pixels (inside the frame). */
function worldPivotAt(name, pivot, img) {
	const [x, y] = pivot;
	if (pivot.length !== 2 || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > img.w || y > img.h) {
		throw new Error(`${name}: pivot ${JSON.stringify(pivot)} must be [x, y] inside the ${img.w}x${img.h} source frame`);
	}
	return { x, y };
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
	// the pivot on the original pixels (body: never the baked shadow), into the cell; [x, y]: given in the source
	// frame's pixels (a render that knows where its footprint's centre lies, scripts/art/kit/render_kit.py)
	const p = Array.isArray(def.pivot) ? worldPivotAt(name, def.pivot, img) : measurePivot(world, img, def.pivot, name);
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
		if (Array.isArray(def.pivot)) {
			// [[x, y] per output facing d]: a 3D kit render's footprint centre per facing (render_kit.py pivotOut)
			const at = def.pivot[fc.d];
			if (!Array.isArray(at) || def.pivot.length !== facings.length) {
				throw new Error(`${name}: a sprite set's pivot array needs one [x, y] per facing (${facings.length})`);
			}
			const pa = def.animations[pivotFrom.animation];
			p = worldPivotAt(`${name} ${fc.dir}`, at, worldFrame(world, def, expandFile(pa.file, fc.dir, fc.angle, pa.frames[pivotFrom.frame])));
		} else if (def.pivot === "union") {
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
		own: def.own,
	};
}

/**
 * MaxRects choice: the free rect a w x h item goes into (its top-left corner), best short side fit, ties by y, then x;
 * { f, score } or null when nothing fits.
 */
function maxRectsFit(free, w, h) {
	let best = null;
	for (const f of free) {
		if (f.w < w || f.h < h) continue;
		const score = Math.min(f.w - w, f.h - h);
		if (!best || score < best.score || (score === best.score && (f.y < best.f.y || (f.y === best.f.y && f.x < best.f.x)))) best = { f, score };
	}
	return best;
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
		const a = { index: atlases.length, width: size, free: [{ x: 0, y: 0, w: size, h: size }], usedH: 0, bandY: 0, items: [] };
		a.name = a.index === 0 ? world.atlas.name : `${world.atlas.name}-${a.index + 1}`;
		atlases.push(a);
		return a;
	};
	open();
	const sprites = pieces.filter((p) => p.kind === "sprites" && !p.own).sort((a, b) => b.frameH - a.frameH || (a.name < b.name ? -1 : 1));
	const band = (a, p) => {
		const perRow = Math.floor(a.width / p.frameW);
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
			const fit = maxRectsFit(a.free, w, h);
			if (fit) {
				best = { a, f: fit.f, score: fit.score };
				break; // fill earlier atlases first
			}
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
	// a sprite set with `own` is its own sheet `<own>.png` (its cells alone, one row up to maxSize wide, then more rows),
	// added after the shared atlases are packed, so a new own set never moves anything in them
	for (const p of pieces.filter((q) => q.kind === "sprites" && q.own)) {
		const width = Math.min(size, p.cells.length * p.frameW);
		const a = { index: -1, own: true, name: p.own, width, free: [], usedH: 0, bandY: 0, items: [] };
		if (!band(a, p)) throw new Error(`${p.name}: ${p.cells.length} cells of ${p.frameW}x${p.frameH} do not fit its own ${size} sheet`);
		atlases.push(a);
	}
	// rasters: the full width (sprite cells run across it), the used height; no two pieces may share a pixel
	for (const a of atlases) {
		const W = a.width;
		a.img = raster(W, a.usedH);
		const taken = new Uint8Array(W * a.usedH);
		const claim = (x, y, w, h, what) => {
			if (x < 0 || y < 0 || x + w > W || y + h > a.usedH) throw new Error(`${what}: outside ${a.name}`);
			for (let yy = y; yy < y + h; yy++) {
				for (let xx = x; xx < x + w; xx++) {
					if (taken[yy * W + xx]) throw new Error(`${what}: overlaps another piece in ${a.name} at (${xx}, ${yy})`);
					taken[yy * W + xx] = 1;
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

const SPRITE_LAYOUTS_DECL = "export const VALE_SPRITE_LAYOUTS: Record<string, ValeSpriteLayout> = ";
const TOP_KEY = /^\t(?:("(?:[^"\\]|\\.)*")|([A-Za-z_$][A-Za-z0-9_$]*)): /;

/**
 * layout.ts `text` (as layoutModule wrote it) with sprite set `id`'s VALE_SPRITE_LAYOUTS entry set to `layout` (replaced,
 * or inserted at its sorted place), every other byte unchanged: exactly what layoutModule writes for the same sets with
 * this one rebuilt (`--only <set id>`). Throws when the text is not layoutModule's (no sorted VALE_SPRITE_LAYOUTS block),
 * or when the entry needs per-sheet cell fields the file does not declare (a full build adds them).
 */
function mergeSpriteLayout(text, id, layout) {
	const start = text.indexOf(`\n${SPRITE_LAYOUTS_DECL}`);
	if (start < 0) throw new Error("layout.ts has no VALE_SPRITE_LAYOUTS (run a full art:build)");
	const open = start + 1 + SPRITE_LAYOUTS_DECL.length;
	// layoutModule always expands it (an empty one is "{\n};"), one top-level entry per sprite set
	if (!text.startsWith("{\n", open)) throw new Error("layout.ts: VALE_SPRITE_LAYOUTS is not an expanded object (run a full art:build)");
	const close = text.indexOf("\n};\n", open);
	if (close < 0) throw new Error("layout.ts: VALE_SPRITE_LAYOUTS has no closing `};`");
	const body = text.slice(open + 2, close + 1);
	const end = close + "\n};\n".length;
	const entries = new Map();
	let key;
	for (const line of body.split("\n").slice(0, -1)) {
		const m = TOP_KEY.exec(line);
		if (m) {
			key = m[1] !== undefined ? JSON.parse(m[1]) : m[2];
			if (entries.has(key)) throw new Error(`layout.ts: VALE_SPRITE_LAYOUTS lists ${key} twice`);
			entries.set(key, "");
		} else if (key === undefined || (!line.startsWith("\t\t") && line !== "\t},")) {
			throw new Error(`layout.ts: unexpected line in VALE_SPRITE_LAYOUTS: ${line}`);
		}
		entries.set(key, `${entries.get(key)}${line}\n`);
	}
	const keys = [...entries.keys()];
	if (keys.join("\n") !== [...keys].sort().join("\n")) throw new Error("layout.ts: VALE_SPRITE_LAYOUTS is not sorted by id (run a full art:build)");
	const perSheet = layout.sheets.some((sh) => sh.frameW !== undefined);
	if (perSheet && !text.includes("\n\tframeW?: number;\n")) throw new Error(`${id}: per-sheet cells need the ValeSpriteSheetFile fields a full art:build declares`);
	const k = tsKey(id);
	entries.set(id, `\t${k}: ${tsValue(layout, 1, TAB_WIDTH + k.length + 2)},\n`);
	const merged = [...entries.keys()].sort().map((n) => entries.get(n));
	const out = `${text.slice(0, open)}{\n${merged.join("")}};\n${text.slice(end)}`;
	for (const line of out.split("\n")) {
		if (line.replace(/\t/g, "    ").length > PRINT_WIDTH) throw new Error(`layout.ts line over ${PRINT_WIDTH} columns: ${line}`);
	}
	return out;
}

/** The image whose mean colour is layout.ts's VALE_FLOOR_HEX (the biome.1 floor colour). */
const FLOOR_IMAGE_ID = "tile.biome.1.floor";

/** Every image's meanHex (art/atlases.json `meanHex`), by asset id, in image order: layout.ts's VALE_TILE_MEAN_HEX. */
function tileMeanHexes(images) {
	const out = {};
	for (const i of images) if (i.meanHex !== undefined) out[i.id] = i.meanHex;
	return out;
}

const TILE_MEAN_DECL = "export const VALE_TILE_MEAN_HEX: Record<string, HexColor> = ";

function layoutModule(sets, images, floorHex, world) {
	const spriteLayouts = {};
	for (const s of sets) spriteLayouts[s.id] = s.layout;
	// the per-sheet cell fields are declared only once a set uses them, so layout.ts is unchanged without one
	const perSheet = sets.some((s) => s.layout.sheets.some((sh) => sh.frameW !== undefined));
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
		world
			? 'import type { HexColor, Pivot, PixelBox, SliceInsets, SpriteSetAsset } from "../../types";'
			: 'import type { HexColor, Pivot, SliceInsets, SpriteSetAsset } from "../../types";',
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
		...(perSheet
			? [
					"\t/**",
					comment([
						'Per-sheet cell (art/atlases.json `cells: "perSheet"`; SpriteSheetImage): this sheet\'s own cell size and',
						"pivot (the set's pivot point, in this sheet's crop). Absent: the set's frameW / frameH / pivot.",
					]).replace(/^/gm, "\t"),
					"\t */",
					"\tframeW?: number;",
					"\tframeH?: number;",
					"\tpivot?: Pivot;",
				]
			: []),
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
			"`pixelsPerTile`, on world art drawn at a sprite set's scale (art/atlases.json `pixelsPerTileFrom`), sizes it;",
			"`slice`, on a 9-sliced panel (art/atlases.json `slice`), its insets in image pixels (ImageAsset.slice).",
		]),
		" */",
		"export interface ValeImageLayout extends ValeSheetFile {",
		"\ttilesPerImage?: number;",
		"\tpivot?: Pivot;",
		"\tpixelsPerTile?: number;",
		"\tslice?: SliceInsets;",
		"}",
		"",
		`${SPRITE_LAYOUTS_DECL}${tsValue(spriteLayouts, 0, PRINT_WIDTH)};`,
		"",
		`export const VALE_IMAGE_LAYOUTS: Record<string, ValeImageLayout> = ${tsValue(imageLayouts, 0, PRINT_WIDTH)};`,
		"",
		"/** Rounded mean colour of the biome.1 floor texture (tile.biome.1.floor): the `biome.1` floor colour. */",
		`export const VALE_FLOOR_HEX: HexColor = ${JSON.stringify(floorHex)};`,
		"",
		"/**",
		comment([
			"Rounded mean colour of every image with art/atlases.json `meanHex` (every repeating tile texture), by asset",
			"id: the colour of each biome floor or wall drawn with it, once uploaded (VALE_FLOOR_HEX is tile.biome.1.floor's).",
		]),
		" */",
		`${TILE_MEAN_DECL}${tsValue(tileMeanHexes(images), 0, TILE_MEAN_DECL.length)};`,
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
function packFx(sets, what = "fx") {
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
	if (!best) throw new Error(`${what}: the ${what === "fx" ? "effects" : "sets"} do not fit one ${MAX_ATLAS}x${MAX_ATLAS} atlas`);
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
// Sliced-image contact sheets (docs/UI_ART.md UA3)

const SLICE_CONTACT_SCALE = 4;
const SLICE_PREVIEW_SCALE = 2;
const SLICE_LINE_RGB = [0, 230, 230];

/**
 * Nearest-neighbour 9-slice of `img` to W x H (Roblox ScaleType.Slice at SliceScale 1): the corners stay as they are,
 * the edge bands and the centre stretch. W and H must leave the stretched part >= 1 px.
 */
function nineSlice(img, slice, W, H) {
	const { left, top, right, bottom } = slice;
	if (W < left + right + 1 || H < top + bottom + 1) throw new Error(`nineSlice: ${W}x${H} is smaller than the fixed insets`);
	const axis = (v, n, lo, hi, out) => {
		if (v < lo) return v;
		if (v >= out - hi) return v - (out - n);
		return lo + Math.floor(((v - lo) * (n - lo - hi)) / (out - lo - hi));
	};
	const out = raster(W, H);
	for (let y = 0; y < H; y++) {
		const sy = axis(y, img.h, top, bottom, H);
		for (let x = 0; x < W; x++) {
			const si = (sy * img.w + axis(x, img.w, left, right, W)) * 4;
			out.data.set(img.data.subarray(si, si + 4), (y * W + x) * 4);
		}
	}
	return out;
}

/** `src` scaled by s (nearest) and composited over the opaque `dst` at (dx, dy). */
function overScaled(src, s, dst, dx, dy) {
	for (let y = 0; y < src.h; y++) {
		for (let x = 0; x < src.w; x++) {
			const si = (y * src.w + x) * 4;
			const a = src.data[si + 3];
			if (a === 0) continue;
			for (let yy = 0; yy < s; yy++) {
				for (let xx = 0; xx < s; xx++) {
					const di = ((dy + y * s + yy) * dst.w + dx + x * s + xx) * 4;
					for (let k = 0; k < 3; k++) dst.data[di + k] = Math.floor((src.data[si + k] * a + dst.data[di + k] * (255 - a) + 127) / 255);
				}
			}
		}
	}
}

/**
 * Contact sheet of a sliced image: the image at SLICE_CONTACT_SCALE with the slice centre's edges in cyan (a 1 px
 * centre shows as two lines in one pixel column / row), then a 9-sliced preview at SLICE_PREVIEW_SCALE, twice as wide
 * (plus 13 px) and, unless the slice has no top / bottom insets (a bar sliced horizontally only), twice as tall (+ 7).
 */
function sliceContact(image) {
	const { img } = image;
	const sl = image.layout.slice;
	const S = SLICE_CONTACT_SCALE;
	const P = SLICE_PREVIEW_SCALE;
	const pw = img.w * 2 + 13;
	const ph = sl.top + sl.bottom === 0 ? img.h : img.h * 2 + 7;
	const preview = nineSlice(img, sl, pw, ph);
	const m = CONTACT_GUTTER * 2;
	const out = raster(m * 3 + img.w * S + pw * P, m * 2 + Math.max(img.h * S, ph * P));
	fillRect(out, 0, 0, out.w, out.h, [CONTACT_BG, CONTACT_BG, CONTACT_BG]);
	overScaled(img, S, out, m, m);
	const x0 = m + sl.left * S;
	const x1 = m + (img.w - sl.right) * S - 1;
	const y0 = m + sl.top * S;
	const y1 = m + (img.h - sl.bottom) * S - 1;
	for (const x of [x0, x1]) fillRect(out, x, m, 1, img.h * S, SLICE_LINE_RGB);
	for (const y of [y0, y1]) fillRect(out, m, y, img.w * S, 1, SLICE_LINE_RGB);
	overScaled(preview, P, out, m * 2 + img.w * S, m);
	return out;
}

// ---------------------------------------------------------------------------------------------
// UI icon atlas (docs/UI_ART.md UA3; config key `uiIcons`)
//
// Small fixed-size pieces of the UI sheet (hearts, potions, glyphs, framed icons, the focus bracket, ...) in ONE atlas,
// so one upload switches them all on. `uiIcons`: { atlas (file name without .png), file (the default source, relative
// to art/vendor), gutter (px, default 1), maxSize (default MAX_ATLAS), icons: { <id>: def } }. Each def is an `images`
// cut (buildImage) with these keys only: `rect` (required), `file`, `crop` (default "none": the rect as it is; "alpha"
// trims to alpha > noiseAlpha, + pad), `noiseAlpha`, `pad`, `cutout`, `clearRgb`, `rgb`, `pivot`. Ids must start with
// "ui.".
//
// Packing (deterministic): every piece grown by the gutter on each side, tallest first (then widest, then id), by
// MaxRects (maxRectsFit / takeRect, the world atlas packer) into a bin of width W and height maxSize, for every W
// from the widest piece to maxSize; the smallest W x used height wins (ties: the squarer, then the narrower). The
// gutter pixels are EXTRUDED copies of the piece's edge pixels (corners: the corner pixel), written after the atlas's
// alpha bleed, so a bilinear sample at a rect edge never reaches a neighbour. uiIconLayout.ts gives each id its rect
// (gutter excluded) and its pivot when the def has one.

const UI_ICON_KEYS = new Set(["$comment", "file", "rect", "crop", "noiseAlpha", "pad", "cutout", "clearRgb", "rgb", "pivot"]);

function uiIconIds(section) {
	return Object.keys(section.icons || {})
		.filter((k) => k !== "$comment")
		.sort();
}

function uiIconFile(section, id) {
	const file = section.icons[id].file === undefined ? section.file : section.icons[id].file;
	if (typeof file !== "string" || file === "") throw new Error(`${id}: a ui icon needs a file (its own or uiIcons.file)`);
	return file;
}

/** Packs `pieces` ({ id, img }) as the section comment says: { w, h, rects: { id: { x, y, w, h } } } (gutter excluded). */
function packUiIcons(pieces, gutter, maxSize) {
	if (pieces.length === 0) throw new Error("uiIcons: no icons");
	const order = [...pieces].sort((a, b) => b.img.h - a.img.h || b.img.w - a.img.w || (a.id < b.id ? -1 : 1));
	const g2 = 2 * gutter;
	const minW = Math.max(...order.map((p) => p.img.w + g2));
	const maxW = Math.min(maxSize, order.reduce((n, p) => n + p.img.w + g2, 0));
	let best = null;
	for (let W = minW; W <= maxW; W++) {
		const free = [{ x: 0, y: 0, w: W, h: maxSize }];
		const at = [];
		let H = 0;
		for (const p of order) {
			const fit = maxRectsFit(free, p.img.w + g2, p.img.h + g2);
			if (!fit) break;
			at.push({ p, x: fit.f.x, y: fit.f.y });
			takeRect(free, { x: fit.f.x, y: fit.f.y, w: p.img.w + g2, h: p.img.h + g2 });
			H = Math.max(H, fit.f.y + p.img.h + g2);
		}
		if (at.length < order.length) continue;
		const better = !best || W * H < best.w * best.h || (W * H === best.w * best.h && (Math.max(W, H) < Math.max(best.w, best.h) || (Math.max(W, H) === Math.max(best.w, best.h) && W < best.w)));
		if (better) best = { w: W, h: H, at };
	}
	if (!best) throw new Error(`uiIcons: the icons do not fit one ${maxSize}x${maxSize} atlas`);
	const rects = {};
	for (const { p, x, y } of best.at) rects[p.id] = { x: x + gutter, y: y + gutter, w: p.img.w, h: p.img.h };
	return { w: best.w, h: best.h, rects };
}

/** Copies, in place, every pixel of the g px ring around rect r from the nearest pixel of r (edges and corners). */
function extrudeGutter(img, r, g) {
	for (let y = r.y - g; y < r.y + r.h + g; y++) {
		for (let x = r.x - g; x < r.x + r.w + g; x++) {
			if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) continue;
			const sx = Math.min(Math.max(x, r.x), r.x + r.w - 1);
			const sy = Math.min(Math.max(y, r.y), r.y + r.h - 1);
			const si = (sy * img.w + sx) * 4;
			img.data.copyWithin((y * img.w + x) * 4, si, si + 4);
		}
	}
}

/**
 * Builds every icon, packs them and draws the atlas: { file, gutter, pieces, w, h, rects, img, layouts }. `pack`
 * (pieces, gutter, maxSize) -> { w, h, rects } places them (default packUiIcons; the boon sheet's `order` packs a fixed
 * column, packColumn).
 */
function buildUiIcons(section, pack = packUiIcons) {
	if (typeof section.atlas !== "string" || !/^[a-z0-9-]+$/.test(section.atlas)) throw new Error(`uiIcons.atlas must be a file name without .png, got ${JSON.stringify(section.atlas)}`);
	const gutter = section.gutter === undefined ? 1 : section.gutter;
	if (!Number.isInteger(gutter) || gutter < 1) throw new Error(`uiIcons.gutter must be an integer >= 1, got ${JSON.stringify(section.gutter)}`);
	const maxSize = section.maxSize === undefined ? MAX_ATLAS : section.maxSize;
	if (!Number.isInteger(maxSize) || maxSize < 1 || maxSize > MAX_ATLAS) throw new Error(`uiIcons.maxSize must be an integer 1-${MAX_ATLAS}`);
	const pieces = uiIconIds(section).map((id) => {
		if (!id.startsWith("ui.")) throw new Error(`${id}: ui icon ids start with "ui."`);
		const def = section.icons[id];
		for (const k of Object.keys(def)) if (!UI_ICON_KEYS.has(k)) throw new Error(`${id}: unknown ui icon key ${k}`);
		if (def.rect === undefined) throw new Error(`${id}: a ui icon needs a rect`);
		const built = buildImage(id, { ...def, file: uiIconFile(section, id), name: id, crop: def.crop === undefined ? "none" : def.crop });
		return { id, img: built.img, pivot: built.layout.pivot };
	});
	const packed = pack(pieces, gutter, maxSize);
	const img = raster(packed.w, packed.h);
	for (const p of pieces) {
		const r = packed.rects[p.id];
		blit(p.img, 0, 0, r.w, r.h, img, r.x, r.y, -1);
	}
	alphaBleed(img);
	for (const p of pieces) extrudeGutter(img, packed.rects[p.id], gutter);
	const layouts = {};
	for (const p of pieces) {
		layouts[p.id] = p.pivot ? { rect: packed.rects[p.id], pivot: p.pivot } : { rect: packed.rects[p.id] };
	}
	return { file: `${section.atlas}.png`, gutter, pieces, ...packed, img, layouts };
}

/** packs/vale/uiIconLayout.ts: the shape docs/UI_ART.md UA3 fixes (VALE_UI_ICON_FILE / _ATLAS, VALE_UI_ICONS by id). */
function uiIconLayoutModule(icons) {
	const xy = (p) => `{ x: ${p.x}, y: ${p.y} }`;
	const entry = (id) => {
		const l = icons.layouts[id];
		const r = l.rect;
		return `\t${JSON.stringify(id)}: { rect: { x: ${r.x}, y: ${r.y}, w: ${r.w}, h: ${r.h} }${l.pivot ? `, pivot: ${xy(l.pivot)}` : ""} },`;
	};
	const text = [
		"/** Generated by `npm run art:build` from art/atlases.json `uiIcons` (docs/UI_ART.md UA3). Do not edit. */",
		"export interface ValeUiIconLayout {",
		"\t/** The piece's rect in the icon atlas, pixels (gutter excluded). */",
		"\treadonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };",
		"\t/** Optional anchor point, pixels from the rect's top-left. */",
		"\treadonly pivot?: { readonly x: number; readonly y: number };",
		"}",
		"/** The atlas file name (the key of its id in assetIds.ts). */",
		`export const VALE_UI_ICON_FILE = ${JSON.stringify(icons.file)};`,
		"/** The atlas size, pixels. */",
		`export const VALE_UI_ICON_ATLAS = { w: ${icons.w}, h: ${icons.h} } as const;`,
		"export const VALE_UI_ICONS: Record<string, ValeUiIconLayout> = {",
		...Object.keys(icons.layouts).sort().map(entry),
		"};",
		"",
	].join("\n");
	for (const line of text.split("\n")) {
		if (line.replace(/\t/g, "    ").length > PRINT_WIDTH) throw new Error(`uiIconLayout.ts line over ${PRINT_WIDTH} columns: ${line}`);
	}
	return text;
}

/**
 * Contact sheet of the icon atlas: every icon read back from the atlas through its layout rect, in id order, at
 * SLICE_CONTACT_SCALE on mid-grey in a darker frame, numbered (the build log lists number -> id), a red cross on the
 * pivot; then the whole atlas at the same scale, gutters included.
 */
function uiIconContact(icons) {
	const S = SLICE_CONTACT_SCALE;
	const gap = FX_CONTACT_GAP;
	const label = FX_CONTACT_LABEL;
	const ids = Object.keys(icons.layouts).sort();
	const rowW = Math.max(icons.w * S + 2 * gap, 1000);
	const cells = [];
	let x = gap;
	let y = gap;
	let rowH = 0;
	for (const id of ids) {
		const r = icons.layouts[id].rect;
		const cw = Math.max(r.w * S, 24);
		if (x + cw + gap > rowW && x > gap) {
			x = gap;
			y += rowH + gap;
			rowH = 0;
		}
		cells.push({ id, x, y });
		x += cw + gap;
		rowH = Math.max(rowH, label + r.h * S);
	}
	const atlasY = y + rowH + gap * 2;
	const out = raster(rowW, atlasY + icons.h * S + gap);
	fillRect(out, 0, 0, out.w, out.h, [CONTACT_BG, CONTACT_BG, CONTACT_BG]);
	cells.forEach(({ id, x: cx, y: cy }, n) => {
		const l = icons.layouts[id];
		const r = l.rect;
		drawNumber(out, cx, cy + 2, n, 2, [240, 240, 240]);
		fillRect(out, cx - 1, cy + label - 1, r.w * S + 2, r.h * S + 2, [96, 96, 96]);
		fillRect(out, cx, cy + label, r.w * S, r.h * S, [CONTACT_BG, CONTACT_BG, CONTACT_BG]);
		const cut = raster(r.w, r.h);
		blit(icons.img, r.x, r.y, r.w, r.h, cut, 0, 0, -1);
		overScaled(cut, S, out, cx, cy + label);
		if (l.pivot) {
			fillRect(out, cx + Math.floor(l.pivot.x * S) - 6, cy + label + Math.floor(l.pivot.y * S), 13, 1, [230, 30, 30]);
			fillRect(out, cx + Math.floor(l.pivot.x * S), cy + label + Math.floor(l.pivot.y * S) - 6, 1, 13, [230, 30, 30]);
		}
	});
	fillRect(out, gap - 1, atlasY - 1, icons.w * S + 2, icons.h * S + 2, [96, 96, 96]);
	fillRect(out, gap, atlasY, icons.w * S, icons.h * S, [CONTACT_BG, CONTACT_BG, CONTACT_BG]);
	overScaled(icons.img, S, out, gap, atlasY);
	return out;
}

// ---------------------------------------------------------------------------------------------
// Boon icon sheet (docs/BUILDS.md BU11; config key `boonIcons`)
//
// The boon icons (ORIGINAL art, scripts/art/gen-boon-icons.js) in a sheet of their own: a `uiIcons`-shaped section
// (atlas, gutter, maxSize, icons: { <ui.boon.* id>: { file, rect } }), built and packed by buildUiIcons exactly like the
// UI icon atlas (same packer, extruded gutter, contact sheet), written to art/build/<atlas>.png with
// packs/vale/boonIconLayout.ts (VALE_BOON_ICON_FILE / _ATLAS, VALE_BOON_ICONS by id, in uiIconLayout.ts's
// ValeUiIconLayout shape), so ui-icons.png never repacks for them. Optional: absent, every other output is unchanged.
// Its optional `order` (every id once) packs one fixed column instead (packColumn): new icons are appended below the
// uploaded ones, whose rects never move.

const BOON_ICON_PREFIX = "ui.boon.";

/** The vendor files the boon icon group reads (none without the group). */
function boonIconSourceFiles(section) {
	if (!section) return [];
	return uiIconIds(section).map((id) => uiIconFile(section, id));
}

/**
 * A packer (buildUiIcons' `pack`) that stacks the pieces in ONE column in `order` (every id once), top to bottom, each in
 * its gutter: piece n's rect starts at y = gutter + the heights (+ 2 gutters) of the pieces before it. An id appended
 * to `order` never moves an earlier rect, so an uploaded sheet keeps drawing every piece it already holds.
 */
function packColumn(order) {
	return (pieces, gutter, maxSize) => {
		const byId = new Map(pieces.map((p) => [p.id, p]));
		if (!Array.isArray(order) || order.length !== pieces.length || new Set(order).size !== order.length || !order.every((id) => byId.has(id))) {
			throw new Error(`order must list every icon id once, got ${JSON.stringify(order)}`);
		}
		const g2 = 2 * gutter;
		const w = Math.max(...pieces.map((p) => p.img.w + g2));
		const rects = {};
		let y = 0;
		for (const id of order) {
			const p = byId.get(id);
			rects[id] = { x: gutter, y: y + gutter, w: p.img.w, h: p.img.h };
			y += p.img.h + g2;
		}
		if (w > maxSize || y > maxSize) throw new Error(`the ${order.length} icons do not fit one ${maxSize}x${maxSize} column (${w}x${y})`);
		return { w, h: y, rects };
	};
}

/**
 * buildUiIcons over the boon icon section, every id under BOON_ICON_PREFIX. With `order` (builds v2: every icon id,
 * the first upload's 17 in its packed order, newer boons appended) the sheet is that one column (packColumn), so a new
 * boon never moves an uploaded icon; without it, packUiIcons as for the UI icon atlas.
 */
function buildBoonIcons(section) {
	for (const id of uiIconIds(section)) {
		if (!id.startsWith(BOON_ICON_PREFIX)) throw new Error(`${id}: boon icon ids start with "${BOON_ICON_PREFIX}"`);
	}
	return section.order === undefined ? buildUiIcons(section) : buildUiIcons(section, packColumn(section.order));
}

/** packs/vale/boonIconLayout.ts: VALE_BOON_ICON_FILE / _ATLAS and VALE_BOON_ICONS by id (ValeUiIconLayout). */
function boonIconLayoutModule(icons) {
	const xy = (p) => `{ x: ${p.x}, y: ${p.y} }`;
	const entry = (id) => {
		const l = icons.layouts[id];
		const r = l.rect;
		return `\t${JSON.stringify(id)}: { rect: { x: ${r.x}, y: ${r.y}, w: ${r.w}, h: ${r.h} }${l.pivot ? `, pivot: ${xy(l.pivot)}` : ""} },`;
	};
	const text = [
		"/** Generated by `npm run art:build` from art/atlases.json `boonIcons` (docs/BUILDS.md BU11). Do not edit. */",
		'import type { ValeUiIconLayout } from "./uiIconLayout";',
		"",
		"/** The boon icon sheet's file name (the key of its id in assetIds.ts). */",
		`export const VALE_BOON_ICON_FILE = ${JSON.stringify(icons.file)};`,
		"/** The sheet size, pixels. */",
		`export const VALE_BOON_ICON_ATLAS = { w: ${icons.w}, h: ${icons.h} } as const;`,
		"export const VALE_BOON_ICONS: Record<string, ValeUiIconLayout> = {",
		...Object.keys(icons.layouts).sort().map(entry),
		"};",
		"",
	].join("\n");
	for (const line of text.split("\n")) {
		if (line.replace(/\t/g, "    ").length > PRINT_WIDTH) throw new Error(`boonIconLayout.ts line over ${PRINT_WIDTH} columns: ${line}`);
	}
	return text;
}

function printBoonIcons(icons) {
	console.log(`boon icons: ${icons.file} ${icons.w}x${icons.h}, ${icons.pieces.length} icons, ${icons.gutter} px extruded gutter (contact numbers in id order)`);
	Object.keys(icons.layouts)
		.sort()
		.forEach((id, n) => {
			const r = icons.layouts[id].rect;
			console.log(`  #${n} ${id}: rect ${r.x},${r.y} ${r.w}x${r.h}`);
		});
}

// ---------------------------------------------------------------------------------------------
// Item icon sheet (docs/BUILDS.md BU11, the relic and curse part; config key `itemIcons`)
//
// The relic and curse icons (ORIGINAL art, scripts/art/gen-item-icons.js) in a sheet of their own, exactly like the
// boon icon sheet above: a `uiIcons`-shaped section built and packed by buildUiIcons, written to art/build/<atlas>.png
// with packs/vale/itemIconLayout.ts (VALE_ITEM_ICON_FILE / _ATLAS, VALE_ITEM_ICONS by id, ValeUiIconLayout shape), so
// neither ui-icons.png nor boon-icons.png repacks for them. Optional: absent, every other output is unchanged.

const ITEM_ICON_PREFIXES = ["ui.relic.", "ui.curse."];

/** The vendor files the item icon group reads (none without the group). */
function itemIconSourceFiles(section) {
	if (!section) return [];
	return uiIconIds(section).map((id) => uiIconFile(section, id));
}

/** buildUiIcons over the item icon section, every id under one of ITEM_ICON_PREFIXES. */
function buildItemIcons(section) {
	for (const id of uiIconIds(section)) {
		if (!ITEM_ICON_PREFIXES.some((p) => id.startsWith(p))) {
			throw new Error(`${id}: item icon ids start with "${ITEM_ICON_PREFIXES.join('" or "')}"`);
		}
	}
	return buildUiIcons(section);
}

/** packs/vale/itemIconLayout.ts: VALE_ITEM_ICON_FILE / _ATLAS and VALE_ITEM_ICONS by id (ValeUiIconLayout). */
function itemIconLayoutModule(icons) {
	const xy = (p) => `{ x: ${p.x}, y: ${p.y} }`;
	const entry = (id) => {
		const l = icons.layouts[id];
		const r = l.rect;
		return `\t${JSON.stringify(id)}: { rect: { x: ${r.x}, y: ${r.y}, w: ${r.w}, h: ${r.h} }${l.pivot ? `, pivot: ${xy(l.pivot)}` : ""} },`;
	};
	const text = [
		"/** Generated by `npm run art:build` from art/atlases.json `itemIcons` (docs/BUILDS.md BU11). Do not edit. */",
		'import type { ValeUiIconLayout } from "./uiIconLayout";',
		"",
		"/** The relic and curse icon sheet's file name (the key of its id in assetIds.ts). */",
		`export const VALE_ITEM_ICON_FILE = ${JSON.stringify(icons.file)};`,
		"/** The sheet size, pixels. */",
		`export const VALE_ITEM_ICON_ATLAS = { w: ${icons.w}, h: ${icons.h} } as const;`,
		"export const VALE_ITEM_ICONS: Record<string, ValeUiIconLayout> = {",
		...Object.keys(icons.layouts).sort().map(entry),
		"};",
		"",
	].join("\n");
	for (const line of text.split("\n")) {
		if (line.replace(/\t/g, "    ").length > PRINT_WIDTH) throw new Error(`itemIconLayout.ts line over ${PRINT_WIDTH} columns: ${line}`);
	}
	return text;
}

function printItemIcons(icons) {
	console.log(`item icons: ${icons.file} ${icons.w}x${icons.h}, ${icons.pieces.length} icons, ${icons.gutter} px extruded gutter (contact numbers in id order)`);
	Object.keys(icons.layouts)
		.sort()
		.forEach((id, n) => {
			const r = icons.layouts[id].rect;
			console.log(`  #${n} ${id}: rect ${r.x},${r.y} ${r.w}x${r.h}`);
		});
}

// ---------------------------------------------------------------------------------------------
// Boost icon sheet (docs/BOOSTS.md B7, the HUD's boost row; config key `boostIcons`)
//
// The boost icons (ORIGINAL art, scripts/art/gen-boost-icons.js) in a sheet of their own, exactly like the
// item icon sheet above: a `uiIcons`-shaped section built and packed by buildUiIcons, written to art/build/<atlas>.png
// with packs/vale/boostIconLayout.ts (VALE_BOOST_ICON_FILE / _ATLAS, VALE_BOOST_ICONS by id, ValeUiIconLayout shape),
// so no other icon sheet repacks for them. Optional: absent, every other output is unchanged.

const BOOST_ICON_PREFIXES = ["ui.boost."];

/** The vendor files the boost icon group reads (none without the group). */
function boostIconSourceFiles(section) {
	if (!section) return [];
	return uiIconIds(section).map((id) => uiIconFile(section, id));
}

/** buildUiIcons over the boost icon section, every id under one of BOOST_ICON_PREFIXES. */
function buildBoostIcons(section) {
	for (const id of uiIconIds(section)) {
		if (!BOOST_ICON_PREFIXES.some((p) => id.startsWith(p))) {
			throw new Error(`${id}: boost icon ids start with "${BOOST_ICON_PREFIXES.join('" or "')}"`);
		}
	}
	return buildUiIcons(section);
}

/** packs/vale/boostIconLayout.ts: VALE_BOOST_ICON_FILE / _ATLAS and VALE_BOOST_ICONS by id (ValeUiIconLayout). */
function boostIconLayoutModule(icons) {
	const xy = (p) => `{ x: ${p.x}, y: ${p.y} }`;
	const entry = (id) => {
		const l = icons.layouts[id];
		const r = l.rect;
		return `\t${JSON.stringify(id)}: { rect: { x: ${r.x}, y: ${r.y}, w: ${r.w}, h: ${r.h} }${l.pivot ? `, pivot: ${xy(l.pivot)}` : ""} },`;
	};
	const text = [
		"/** Generated by `npm run art:build` from art/atlases.json `boostIcons` (docs/BOOSTS.md B7). Do not edit. */",
		'import type { ValeUiIconLayout } from "./uiIconLayout";',
		"",
		"/** The boost icon sheet's file name (the key of its id in assetIds.ts). */",
		`export const VALE_BOOST_ICON_FILE = ${JSON.stringify(icons.file)};`,
		"/** The sheet size, pixels. */",
		`export const VALE_BOOST_ICON_ATLAS = { w: ${icons.w}, h: ${icons.h} } as const;`,
		"export const VALE_BOOST_ICONS: Record<string, ValeUiIconLayout> = {",
		...Object.keys(icons.layouts).sort().map(entry),
		"};",
		"",
	].join("\n");
	for (const line of text.split("\n")) {
		if (line.replace(/\t/g, "    ").length > PRINT_WIDTH) throw new Error(`boostIconLayout.ts line over ${PRINT_WIDTH} columns: ${line}`);
	}
	return text;
}

function printBoostIcons(icons) {
	console.log(`boost icons: ${icons.file} ${icons.w}x${icons.h}, ${icons.pieces.length} icons, ${icons.gutter} px extruded gutter (contact numbers in id order)`);
	Object.keys(icons.layouts)
		.sort()
		.forEach((id, n) => {
			const r = icons.layouts[id].rect;
			console.log(`  #${n} ${id}: rect ${r.x},${r.y} ${r.w}x${r.h}`);
		});
}

// ---------------------------------------------------------------------------------------------
// Pip icon sheet (docs/UI_ART.md "As built: armor pips"; config key `pipIcons`)
//
// The armor pips (ORIGINAL art, scripts/art/gen-pip-icons.js: ui.pip.armor / .armor.empty / ui.pip.aegis) in a sheet
// of their own, exactly like the boost icon sheet above (buildUiIcons), written to art/build/<atlas>.png with
// packs/vale/pipIconLayout.ts (VALE_PIP_ICON_FILE / _ATLAS, VALE_PIP_ICONS by id, ValeUiIconLayout shape), so no other
// icon sheet repacks for them. Optional: absent, every other output is unchanged.

const PIP_ICON_PREFIXES = ["ui.pip."];

/** The vendor files the pip icon group reads (none without the group). */
function pipIconSourceFiles(section) {
	if (!section) return [];
	return uiIconIds(section).map((id) => uiIconFile(section, id));
}

/** buildUiIcons over the pip icon section, every id under one of PIP_ICON_PREFIXES. */
function buildPipIcons(section) {
	for (const id of uiIconIds(section)) {
		if (!PIP_ICON_PREFIXES.some((p) => id.startsWith(p))) {
			throw new Error(`${id}: pip icon ids start with "${PIP_ICON_PREFIXES.join('" or "')}"`);
		}
	}
	return buildUiIcons(section);
}

/** packs/vale/pipIconLayout.ts: VALE_PIP_ICON_FILE / _ATLAS and VALE_PIP_ICONS by id (ValeUiIconLayout). */
function pipIconLayoutModule(icons) {
	const xy = (p) => `{ x: ${p.x}, y: ${p.y} }`;
	const entry = (id) => {
		const l = icons.layouts[id];
		const r = l.rect;
		return `\t${JSON.stringify(id)}: { rect: { x: ${r.x}, y: ${r.y}, w: ${r.w}, h: ${r.h} }${l.pivot ? `, pivot: ${xy(l.pivot)}` : ""} },`;
	};
	const text = [
		"/** Generated by `npm run art:build` from art/atlases.json `pipIcons` (docs/UI_ART.md). Do not edit. */",
		'import type { ValeUiIconLayout } from "./uiIconLayout";',
		"",
		"/** The armor pip sheet's file name (the key of its id in assetIds.ts). */",
		`export const VALE_PIP_ICON_FILE = ${JSON.stringify(icons.file)};`,
		"/** The sheet size, pixels. */",
		`export const VALE_PIP_ICON_ATLAS = { w: ${icons.w}, h: ${icons.h} } as const;`,
		"export const VALE_PIP_ICONS: Record<string, ValeUiIconLayout> = {",
		...Object.keys(icons.layouts).sort().map(entry),
		"};",
		"",
	].join("\n");
	for (const line of text.split("\n")) {
		if (line.replace(/\t/g, "    ").length > PRINT_WIDTH) throw new Error(`pipIconLayout.ts line over ${PRINT_WIDTH} columns: ${line}`);
	}
	return text;
}

function printPipIcons(icons) {
	console.log(`pip icons: ${icons.file} ${icons.w}x${icons.h}, ${icons.pieces.length} icons, ${icons.gutter} px extruded gutter (contact numbers in id order)`);
	Object.keys(icons.layouts)
		.sort()
		.forEach((id, n) => {
			const r = icons.layouts[id].rect;
			console.log(`  #${n} ${id}: rect ${r.x},${r.y} ${r.w}x${r.h}`);
		});
}

// ---------------------------------------------------------------------------------------------
// Duo icon sheet (docs/BUILDS.md BU11, the duo part; config key `duoIcons`)
//
// The duo icons (ORIGINAL art, scripts/art/gen-duo-icons.js: ui.duo.<name>, one per duo) in a sheet of their own,
// exactly like the boon icon sheet above: buildUiIcons with `order` packed as one append-only column (packColumn), so a
// new duo never moves an uploaded icon. Written to art/build/<atlas>.png with packs/vale/duoIconLayout.ts
// (VALE_DUO_ICON_FILE / _ATLAS, VALE_DUO_ICONS by id, ValeUiIconLayout shape), so no other icon sheet repacks for them.
// Optional: absent, every other output is unchanged.

const DUO_ICON_PREFIX = "ui.duo.";

/** The vendor files the duo icon group reads (none without the group). */
function duoIconSourceFiles(section) {
	if (!section) return [];
	return uiIconIds(section).map((id) => uiIconFile(section, id));
}

/** buildUiIcons over the duo icon section, every id under DUO_ICON_PREFIX; with `order`, one column (packColumn). */
function buildDuoIcons(section) {
	for (const id of uiIconIds(section)) {
		if (!id.startsWith(DUO_ICON_PREFIX)) throw new Error(`${id}: duo icon ids start with "${DUO_ICON_PREFIX}"`);
	}
	return section.order === undefined ? buildUiIcons(section) : buildUiIcons(section, packColumn(section.order));
}

/** packs/vale/duoIconLayout.ts: VALE_DUO_ICON_FILE / _ATLAS and VALE_DUO_ICONS by id (ValeUiIconLayout). */
function duoIconLayoutModule(icons) {
	const xy = (p) => `{ x: ${p.x}, y: ${p.y} }`;
	const entry = (id) => {
		const l = icons.layouts[id];
		const r = l.rect;
		return `\t${JSON.stringify(id)}: { rect: { x: ${r.x}, y: ${r.y}, w: ${r.w}, h: ${r.h} }${l.pivot ? `, pivot: ${xy(l.pivot)}` : ""} },`;
	};
	const text = [
		"/** Generated by `npm run art:build` from art/atlases.json `duoIcons` (docs/BUILDS.md BU11). Do not edit. */",
		'import type { ValeUiIconLayout } from "./uiIconLayout";',
		"",
		"/** The duo icon sheet's file name (the key of its id in assetIds.ts). */",
		`export const VALE_DUO_ICON_FILE = ${JSON.stringify(icons.file)};`,
		"/** The sheet size, pixels. */",
		`export const VALE_DUO_ICON_ATLAS = { w: ${icons.w}, h: ${icons.h} } as const;`,
		"export const VALE_DUO_ICONS: Record<string, ValeUiIconLayout> = {",
		...Object.keys(icons.layouts).sort().map(entry),
		"};",
		"",
	].join("\n");
	for (const line of text.split("\n")) {
		if (line.replace(/\t/g, "    ").length > PRINT_WIDTH) throw new Error(`duoIconLayout.ts line over ${PRINT_WIDTH} columns: ${line}`);
	}
	return text;
}

function printDuoIcons(icons) {
	console.log(`duo icons: ${icons.file} ${icons.w}x${icons.h}, ${icons.pieces.length} icons, ${icons.gutter} px extruded gutter (contact numbers in id order)`);
	Object.keys(icons.layouts)
		.sort()
		.forEach((id, n) => {
			const r = icons.layouts[id].rect;
			console.log(`  #${n} ${id}: rect ${r.x},${r.y} ${r.w}x${r.h}`);
		});
}

// ---------------------------------------------------------------------------------------------
// Bullet atlas (docs/PROJECTILE_ART.md PA2)
//
// Config key `bullets` (optional; absent: no bullet atlas, every other output exactly as without it): { atlas (file
// name without .png), pad, fps (default for every set), pixelsPerTile (every set's texel density, a positive number),
// pixelsPerTileFrom (optional: a sprite set id whose pixelsPerTile must equal it; checked by a full build, which builds
// that set first; `--only bullets` cannot build it and says so), gates (below), lockAlso (optional: vendor files the
// lock covers and the build checks but no set reads, art kept for a later task), sets: { <bullet id>: def }, fx
// (optional, docs/PROJECTILE_ART.md PA7: { <fx id>: fxDef }, effects packed into the SAME atlas so the effects atlas
// fx-effects.png never repacks) }. A def is
// an `fx`-style strip (`file`, `frameW`, `frames`, optional `keep`, `fps`) with an optional `recolor` (the sprite sets'
// gradient map, recolorLut, applied to every strip frame before the crop). Each set is cropped to the union alpha box
// of its kept frames (+ pad), so a strip half (keep [0]) or a frame's content box needs no extra rect; its pivot is
// the cell centre, its meanColor the alpha-weighted mean of its cells after the recolour. Packed exactly like the
// effects atlas (packFx: bands by frame height, cells `start + f` of the SpriteSetAsset formula, alpha-bled).
// Outputs: art/build/<atlas>.png (also copied to art/upload/), the contact sheet art/build/contact/<atlas>.png (every
// frame x BULLET_CONTACT_SCALE on a dark ground, one row per set numbered in id order, bullets then effects; the build
// log maps number -> id) and src/shared/theme/packs/vale/bulletLayout.ts (VALE_BULLET_LAYOUTS, and the effects in
// VALE_BULLET_FX_LAYOUTS in fxLayout.ts's ValeFxLayout shape).
//
// An fxDef is an untinted `fx`-group strip: `file`, `frameW`, `frames`, optional `keep`, `fps` (default bullets.fps)
// and `loop` (default false); no grey, burst or recolour. Cropped and packed like a bullet set (pivot = cell centre,
// meanColor after the crop); its layout carries `loop` and `grey: false`.
//
// Gates (bulletGates; the build fails on any): `bullet.enemy.*` means <= gates.enemy.maxDifference CIE76 from
// gates.enemy.role and >= gates.enemy.minContrast WCAG contrast on every gates.enemy.surfaces colour;
// `bullet.player.*` means >= gates.player.minDifference CIE76 from every gates.player.from colour; `fx.*` means (the
// group's `fx` sets) >= gates.fx.minDifference from every gates.fx.from colour (the theme's fx rule, fxColorReport:
// the enemy-bullet roles; gates.fx is required only when there are fx sets); any other id fails. The colour maths
// mirror shared/theme color.ts (colorDifference, contrastRatio).

const BULLET_SET_KEYS = new Set(["$comment", "file", "frameW", "frames", "keep", "fps", "recolor", "recolorNote"]);
const BULLET_GROUP_KEYS = new Set(["$comment", "atlas", "pad", "fps", "pixelsPerTile", "pixelsPerTileFrom", "gates", "lockAlso", "sets", "fx"]);
const BULLET_FX_KEYS = new Set(["$comment", "file", "frameW", "frames", "keep", "fps", "loop"]);
const BULLET_CONTACT_SCALE = 8;
const BULLET_CONTACT_BG = [24, 22, 28];
const BULLET_CONTACT_CELL = [52, 50, 60];

function bulletIds(group) {
	return group ? Object.keys(group.sets || {}).filter((k) => !k.startsWith("$")).sort() : [];
}

/** The bullet group's effect ids (its `fx` sets), sorted. */
function bulletFxIds(group) {
	return group && group.fx ? Object.keys(group.fx).filter((k) => !k.startsWith("$")).sort() : [];
}

/** Every vendor file the bullet group reads (its sets and effects) or locks (`lockAlso`), sorted. */
function bulletSourceFiles(group) {
	if (!group) return [];
	const files = new Set(bulletIds(group).map((id) => group.sets[id].file));
	for (const id of bulletFxIds(group)) files.add(group.fx[id].file);
	const also = group.lockAlso === undefined ? [] : group.lockAlso;
	if (!Array.isArray(also) || !also.every((f) => typeof f === "string" && f !== "")) throw new Error("bullets.lockAlso must be a list of art/vendor-relative file paths");
	for (const f of also) files.add(f);
	return [...files].sort();
}

/** sRGB "#rrggbb" -> CIELAB (D65), shared/theme color.ts toLab. */
function hexToLab(hex) {
	const v = parseInt(hex.slice(1), 16);
	const lin = (c) => {
		const s = c / 255;
		return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	const r = lin((v >> 16) & 255);
	const g = lin((v >> 8) & 255);
	const b = lin(v & 255);
	const eps = (6 / 29) ** 3;
	const f = (t) => (t > eps ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29);
	const fx = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
	const fy = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
	const fz = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
	return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 Delta E between two "#rrggbb" colours (color.ts colorDifference). */
function cie76(a, b) {
	const la = hexToLab(a);
	const lb = hexToLab(b);
	return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

/** WCAG 2.x contrast ratio between two "#rrggbb" colours (color.ts contrastRatio). */
function wcagContrast(a, b) {
	const lum = (hex) => {
		const v = parseInt(hex.slice(1), 16);
		const lin = (c) => {
			const s = c / 255;
			return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
		};
		return 0.2126 * lin((v >> 16) & 255) + 0.7152 * lin((v >> 8) & 255) + 0.0722 * lin(v & 255);
	};
	const x = lum(a);
	const y = lum(b);
	return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** One bullet set: its strip frames (recoloured when `recolor`), cropped to their union alpha box + pad, measured. */
function buildBulletSet(id, def, group) {
	if (def === null || typeof def !== "object" || Array.isArray(def)) throw new Error(`${id}: a bullet set must be an object`);
	for (const k of Object.keys(def)) if (!BULLET_SET_KEYS.has(k)) throw new Error(`${id}: unknown bullet set key ${k}`);
	if (typeof def.file !== "string" || def.file === "") throw new Error(`${id}: a bullet set needs a file`);
	if (!Number.isInteger(def.frameW) || def.frameW < 1 || !Number.isInteger(def.frames) || def.frames < 1) throw new Error(`${id}: frameW and frames must be positive integers`);
	const pad = group.pad === undefined ? 0 : group.pad;
	if (!Number.isInteger(pad) || pad < 0) throw new Error(`bullets.pad must be a non-negative integer, got ${JSON.stringify(group.pad)}`);
	const fps = def.fps !== undefined ? def.fps : group.fps;
	if (typeof fps !== "number" || !(fps > 0)) throw new Error(`${id}: fps (its own or bullets.fps) must be a positive number`);
	const lut = recolorLut(id, def.recolor);
	let raw = stripFrames(id, def);
	if (lut) raw = raw.map((img) => recolorRegion({ img, x: 0, y: 0, w: img.w, h: img.h }, lut).img);
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
	return { id, def, frames, frameW, frameH, fps, meanColor: meanColor(frames), box, sourceH: raw[0].h, recolorStops: lut ? def.recolor.ramp.length : 0 };
}

/** One effect of the bullet group (`fx`): an untinted strip, cropped like an effects-atlas set (buildFxSet). */
function buildBulletFxSet(id, def, group) {
	if (def === null || typeof def !== "object" || Array.isArray(def)) throw new Error(`${id}: a bullet fx set must be an object`);
	for (const k of Object.keys(def)) if (!BULLET_FX_KEYS.has(k)) throw new Error(`${id}: unknown bullet fx set key ${k}`);
	if (!/^fx\.[a-z0-9.]+$/.test(id)) throw new Error(`${id}: a bullet fx set's id must be an fx.* id`);
	if (typeof def.file !== "string" || def.file === "") throw new Error(`${id}: a bullet fx set needs a file`);
	if (!Number.isInteger(def.frameW) || def.frameW < 1 || !Number.isInteger(def.frames) || def.frames < 1) throw new Error(`${id}: frameW and frames must be positive integers`);
	if (def.loop !== undefined && typeof def.loop !== "boolean") throw new Error(`${id}: loop must be true or false`);
	const pad = group.pad === undefined ? 0 : group.pad;
	if (!Number.isInteger(pad) || pad < 0) throw new Error(`bullets.pad must be a non-negative integer, got ${JSON.stringify(group.pad)}`);
	const fps = def.fps !== undefined ? def.fps : group.fps;
	if (typeof fps !== "number" || !(fps > 0)) throw new Error(`${id}: fps (its own or bullets.fps) must be a positive number`);
	return buildFxSet(id, { file: def.file, frameW: def.frameW, frames: def.frames, keep: def.keep, fps, loop: def.loop === true }, pad);
}

/**
 * The colour gates (see the section comment) on built sets: one row per set { id, side, mean, ok, ... } (enemy:
 * difference from the role, worst contrast and the surface it is on; player: the smallest difference and its colour).
 */
function bulletGates(sets, gates) {
	const hex = (v, what) => {
		if (typeof v !== "string" || !HEX_RGB.test(v)) throw new Error(`bullets.gates.${what} must be "#rrggbb", got ${JSON.stringify(v)}`);
		return v;
	};
	if (!gates || !gates.enemy || !gates.player) throw new Error("bullets.gates needs enemy and player");
	const e = gates.enemy;
	const p = gates.player;
	const role = hex(e.role, "enemy.role");
	if (!Array.isArray(e.surfaces) || e.surfaces.length === 0) throw new Error("bullets.gates.enemy.surfaces must list the floor / wall colours");
	e.surfaces.forEach((s, i) => hex(s, `enemy.surfaces[${i}]`));
	const from = p.from && typeof p.from === "object" ? Object.keys(p.from).filter((k) => !k.startsWith("$")).sort() : [];
	if (from.length === 0) throw new Error("bullets.gates.player.from must name { role: \"#rrggbb\" }");
	for (const k of from) hex(p.from[k], `player.from.${k}`);
	for (const [k, v] of [["enemy.maxDifference", e.maxDifference], ["enemy.minContrast", e.minContrast], ["player.minDifference", p.minDifference]]) {
		if (typeof v !== "number" || !(v > 0)) throw new Error(`bullets.gates.${k} must be a positive number`);
	}
	const fx = gates.fx;
	let fxFrom = [];
	if (sets.some((s) => s.id.startsWith("fx."))) {
		if (!fx || typeof fx !== "object") throw new Error("bullets.gates.fx is required with fx sets");
		fxFrom = fx.from && typeof fx.from === "object" ? Object.keys(fx.from).filter((k) => !k.startsWith("$")).sort() : [];
		if (fxFrom.length === 0) throw new Error("bullets.gates.fx.from must name { role: \"#rrggbb\" }");
		for (const k of fxFrom) hex(fx.from[k], `fx.from.${k}`);
		if (typeof fx.minDifference !== "number" || !(fx.minDifference > 0)) throw new Error("bullets.gates.fx.minDifference must be a positive number");
	}
	/** The nearest of `from`'s colours to `mean`: [difference, its name]. */
	const nearestOf = (mean, colours, names) => {
		let nearest = Infinity;
		let nearestTo = "";
		for (const k of names) {
			const d = cie76(mean, colours[k]);
			if (d < nearest) {
				nearest = d;
				nearestTo = k;
			}
		}
		return [nearest, nearestTo];
	};
	return sets.map((s) => {
		if (s.id.startsWith("bullet.enemy.")) {
			const difference = cie76(s.meanColor, role);
			let worst = Infinity;
			let worstOn = "";
			for (const surface of e.surfaces) {
				const c = wcagContrast(s.meanColor, surface);
				if (c < worst) {
					worst = c;
					worstOn = surface;
				}
			}
			return { id: s.id, side: "enemy", mean: s.meanColor, difference, worst, worstOn, ok: difference <= e.maxDifference && worst >= e.minContrast };
		}
		if (s.id.startsWith("bullet.player.")) {
			const [nearest, nearestTo] = nearestOf(s.meanColor, p.from, from);
			return { id: s.id, side: "player", mean: s.meanColor, nearest, nearestTo, ok: nearest >= p.minDifference };
		}
		if (s.id.startsWith("fx.")) {
			const [nearest, nearestTo] = nearestOf(s.meanColor, fx.from, fxFrom);
			return { id: s.id, side: "fx", mean: s.meanColor, nearest, nearestTo, ok: nearest >= fx.minDifference };
		}
		return { id: s.id, side: "unknown", mean: s.meanColor, ok: false };
	});
}

/** One gate row as a log line. */
function bulletGateLine(r, gates) {
	if (r.side === "enemy") {
		return `${r.id}: mean ${r.mean}, ${r.difference.toFixed(1)} CIE76 from ${gates.enemy.role} (<= ${gates.enemy.maxDifference}), worst contrast ${r.worst.toFixed(2)} on ${r.worstOn} (>= ${gates.enemy.minContrast})${r.ok ? "" : "  FAIL"}`;
	}
	if (r.side === "player") return `${r.id}: mean ${r.mean}, nearest ${r.nearest.toFixed(1)} CIE76 from ${r.nearestTo} (>= ${gates.player.minDifference})${r.ok ? "" : "  FAIL"}`;
	if (r.side === "fx") return `${r.id}: mean ${r.mean}, nearest ${r.nearest.toFixed(1)} CIE76 from ${r.nearestTo} (>= ${gates.fx.minDifference})${r.ok ? "" : "  FAIL"}`;
	return `${r.id}: neither bullet.enemy.* nor bullet.player.* nor an fx set  FAIL`;
}

/**
 * Builds the bullet atlas from the `bullets` group: { file, sets, fxSets, packed, sheet, layouts, fxLayouts, gates,
 * pixelsPerTileFrom } (fxLayouts: the `fx` sets in fxLayoutOf's shape).
 * `spriteSets` (the built sprite sets, a full build) checks pixelsPerTileFrom; undefined skips that check
 * (pixelsPerTileFrom then reports "unchecked"). Throws on a bad config or a failed gate.
 */
function buildBullets(group, spriteSets) {
	if (group === null || typeof group !== "object" || Array.isArray(group)) throw new Error("bullets must be an object");
	for (const k of Object.keys(group)) if (!BULLET_GROUP_KEYS.has(k)) throw new Error(`bullets: unknown key ${k}`);
	if (typeof group.atlas !== "string" || !/^[a-z0-9-]+$/.test(group.atlas)) throw new Error(`bullets.atlas must be a file name without .png, got ${JSON.stringify(group.atlas)}`);
	const ppt = group.pixelsPerTile;
	if (typeof ppt !== "number" || !(ppt > 0)) throw new Error("bullets.pixelsPerTile must be a positive number");
	const pixelsPerTileFrom = groupPixelsPerTileFrom("bullets", group, ppt, spriteSets);
	const ids = bulletIds(group);
	if (ids.length === 0) throw new Error("bullets: no sets");
	if (group.fx !== undefined && (group.fx === null || typeof group.fx !== "object" || Array.isArray(group.fx))) throw new Error("bullets.fx must be an object");
	const sets = ids.map((id) => buildBulletSet(id, group.sets[id], group));
	const fxSets = bulletFxIds(group).map((id) => buildBulletFxSet(id, group.fx[id], group));
	const gates = bulletGates([...sets, ...fxSets], group.gates);
	const failed = gates.filter((r) => !r.ok);
	if (failed.length > 0) throw new Error(`bullets: colour gates failed:\n  ${failed.map((r) => bulletGateLine(r, group.gates)).join("\n  ")}`);
	const packed = packFx([...sets, ...fxSets], "bullets");
	const file = `${group.atlas}.png`;
	const layouts = {};
	const fxLayouts = {};
	for (const p of [...packed.placed].sort((a, b) => (a.s.id < b.s.id ? -1 : 1))) {
		const s = p.s;
		if (fxSets.includes(s)) {
			fxLayouts[s.id] = fxLayoutOf(p);
			continue;
		}
		layouts[s.id] = {
			frameW: s.frameW,
			frameH: s.frameH,
			pivot: { x: s.frameW / 2, y: s.frameH / 2 },
			start: p.start,
			frames: s.frames.length,
			fps: s.fps,
			meanColor: s.meanColor,
			pixelsPerTile: ppt,
		};
	}
	return { file, sets, fxSets, packed, sheet: { file, w: packed.w, h: packed.h }, layouts, fxLayouts, gates, pixelsPerTileFrom };
}

/**
 * packs/vale/bulletLayout.ts: the shape of the PA stub (ValeBulletLayout, VALE_BULLET_SHEET, VALE_BULLET_LAYOUTS),
 * then the effects in the same sheet (VALE_BULLET_FX_LAYOUTS, fxLayout.ts's ValeFxLayout; `{}` without any).
 */
function bulletLayoutModule(sheet, layouts, fxLayouts = {}) {
	const text = [
		"// GENERATED by `npm run art:build` (scripts/art/build-atlases.js) from art/atlases.json. Do not edit.",
		"",
		"/**",
		comment([
			"Layout of the `vale` pack's projectile sprites (docs/PROJECTILE_ART.md PA2): every flying bullet's flipbook in the",
			"ONE bullet atlas VALE_BULLET_SHEET, cells `start + f` of the SpriteSetAsset formula (perRow = floor(sheet w /",
			"frameW)). Each frame's art points screen-up (the direction of travel). `meanColor` is the alpha-weighted mean of the",
			"set's opaque pixels (after `recolor`), held to the bullet colour rules (bulletArtReport). Effects that ride in the",
			"same sheet (VALE_BULLET_FX_LAYOUTS, PA7) have the effects atlas's layout shape. No asset IDs: `file` names the PNG",
			"in art/build/ to upload.",
		]),
		" */",
		"",
		'import type { HexColor, Pivot } from "../../types";',
		'import type { ValeFxLayout } from "./fxLayout";',
		'import type { ValeSheetFile } from "./layout";',
		"",
		"/** One bullet's flipbook in VALE_BULLET_SHEET. */",
		"export interface ValeBulletLayout {",
		"\tframeW: number;",
		"\tframeH: number;",
		"\tpivot: Pivot;",
		"\tstart: number;",
		"\tframes: number;",
		"\tfps: number;",
		"\tmeanColor: HexColor;",
		"\tpixelsPerTile: number;",
		"}",
		"",
		`export const VALE_BULLET_SHEET: ValeSheetFile = ${tsValue(sheet, 0, PRINT_WIDTH)};`,
		"",
		`export const VALE_BULLET_LAYOUTS: Record<string, ValeBulletLayout> = ${Object.keys(layouts).length === 0 ? "{}" : tsValue(layouts, 0, PRINT_WIDTH)};`,
		"",
		"/** Effects in VALE_BULLET_SHEET (fx.* ids; cells by the same formula). */",
		`export const VALE_BULLET_FX_LAYOUTS: Record<string, ValeFxLayout> = ${Object.keys(fxLayouts).length === 0 ? "{}" : tsValue(fxLayouts, 0, PRINT_WIDTH)};`,
		"",
	].join("\n");
	for (const line of text.split("\n")) {
		if (line.replace(/\t/g, "    ").length > PRINT_WIDTH) throw new Error(`bulletLayout.ts line over ${PRINT_WIDTH} columns: ${line}`);
	}
	return text;
}

/**
 * Contact sheet of the bullet atlas: one row per set (id order), its number (the build log maps it to the id), then
 * every frame read back from the atlas through the layout's cell formula, x BULLET_CONTACT_SCALE on a dark ground,
 * each cell's area a shade lighter so the pad shows.
 */
function bulletContact(result) {
	const S = BULLET_CONTACT_SCALE;
	const gap = FX_CONTACT_GAP;
	const labelW = 4 * 2 * 2 + gap;
	const all = { ...result.layouts, ...(result.fxLayouts || {}) };
	const ids = [...Object.keys(result.layouts).sort(), ...Object.keys(result.fxLayouts || {}).sort()];
	let w = 0;
	let h = gap;
	for (const id of ids) {
		const l = all[id];
		w = Math.max(w, labelW + gap + l.frames * (l.frameW * S + gap));
		h += l.frameH * S + gap;
	}
	const out = raster(w + gap, h);
	fillRect(out, 0, 0, out.w, out.h, BULLET_CONTACT_BG);
	let y = gap;
	ids.forEach((id, n) => {
		const l = all[id];
		drawNumber(out, gap, y, n, 2, [240, 240, 240]);
		for (let f = 0; f < l.frames; f++) {
			const x = gap + labelW + f * (l.frameW * S + gap);
			fillRect(out, x, y, l.frameW * S, l.frameH * S, BULLET_CONTACT_CELL);
			const [cx, cy] = fxCellAt(result.packed.w, l, f);
			const cut = raster(l.frameW, l.frameH);
			blit(result.packed.img, cx, cy, l.frameW, l.frameH, cut, 0, 0, -1);
			overScaled(cut, S, out, x, y);
		}
		y += l.frameH * S + gap;
	});
	return out;
}

/** Log lines for a built bullet atlas. */
function printBullets(b, group) {
	const fill = (100 * b.packed.used) / (b.packed.w * b.packed.h);
	const from = b.pixelsPerTileFrom ? ` (pixelsPerTileFrom ${b.pixelsPerTileFrom.id}: ${b.pixelsPerTileFrom.checked ? "equal" : "unchecked, its set is not built by --only"})` : "";
	console.log(`bullets: ${b.file} ${b.packed.w}x${b.packed.h}, ${b.sets.length} sets, ${fill.toFixed(1)}% of its area in cells, ${group.pixelsPerTile} px/tile${from}`);
	b.sets.forEach((s, n) => {
		const l = b.layouts[s.id];
		console.log(`  #${n} ${s.id}: ${s.def.file.split("/").slice(-1)[0]} ${s.def.frames} x ${s.def.frameW}x${s.sourceH}${s.def.keep ? ` keep ${s.def.keep.join(",")}` : ""} (box ${s.box.join(",")}) -> cell ${l.frameW}x${l.frameH}, start ${l.start}, ${l.frames} frame(s) @ ${l.fps} fps${s.recolorStops ? `, recoloured (${s.recolorStops}-stop ramp)` : ""}`);
	});
	(b.fxSets || []).forEach((s, k) => {
		const l = b.fxLayouts[s.id];
		console.log(`  #${b.sets.length + k} ${s.id} (effect): ${s.def.file.split("/").slice(-1)[0]} ${s.def.frames} x ${s.def.frameW}x${s.sourceH} (box ${s.box.join(",")}) -> cell ${l.frameW}x${l.frameH}, start ${l.start}, ${l.frames} frame(s) @ ${l.fps} fps, ${l.loop ? "loop" : "one-shot"}, mean ${l.meanColor}`);
	});
	for (const r of b.gates) console.log(`  gate ${bulletGateLine(r, group.gates)}`);
}

// ---------------------------------------------------------------------------------------------
// Goo atlas (docs/GOO_ART.md GA1)
//
// Config key `goo` (optional; absent: no goo sheet, every other output exactly as without it): { atlas (file name
// without .png), pad, pixelsPerTile (the nominal texel density, a positive number), pixelsPerTileFrom (optional: a
// sprite set id whose pixelsPerTile must equal it, checked by a full build as for `bullets`; `--only goo` cannot build
// it and says so), gates (below), sets: { "bullet.enemy.goo": def } (exactly that one set) }. A def is a horizontal
// strip (`file`, `frameW`, `frames`: the build fails unless the strip is exactly frames x frameW wide) with `land` (the
// strip frame drawn while the puddle lands) and `hold` (a non-empty list of strip frames, the puddle for the rest of its
// life: one per variant), an optional `recolor` (the sprite sets' gradient map, recolorLut, applied to every kept frame
// before the crop) and `recolorNote`. The kept frames are cut with ONE crop rectangle (the union alpha box of land and
// every hold frame, + pad), so each frame keeps its place in the source cell; nearest-neighbour, never resampled. The
// sheet is one row of cells, land first (cell 0), then the hold frames (cells 1 ..), alpha-bled like every atlas.
// Measured into the layout: the hold frames' union lit box (alpha > 0: litW x litH), the pivot (that box's centre in
// cell pixels) and meanColor (the alpha-weighted mean, over every cell, of the pixels with alpha > 0 and
// max(R, G, B) > GOO_LIT_MIN_RGB: the black outline left out; after the recolour, before the bleed).
// Gates (gooGate; the build fails on either, the log line is a bullet.enemy.* gate's): meanColor <=
// gates.maxDifference CIE76 from gates.role (enemyGoo) and >= gates.minContrast WCAG contrast on every gates.surfaces
// colour. Outputs: art/build/<atlas>.png (also copied to art/upload/), the contact sheet art/build/contact/<atlas>.png
// (scaledContact: every cell read back through the layout's formula, a red cross on the pivot) and
// src/shared/theme/packs/vale/gooLayout.ts (VALE_GOO_SHEET, VALE_GOO_LAYOUT). Build just this group:
// node scripts/art/build-atlases.js --only goo (and --lock --only goo).

const GOO_ID = "bullet.enemy.goo";
const GOO_GROUP_KEYS = new Set(["$comment", "atlas", "pad", "pixelsPerTile", "pixelsPerTileFrom", "gates", "sets"]);
const GOO_SET_KEYS = new Set(["$comment", "file", "frameW", "frames", "land", "hold", "recolor", "recolorNote"]);
const GOO_GATE_KEYS = new Set(["$comment", "role", "maxDifference", "minContrast", "surfaces"]);
/** meanColor counts only pixels whose max(R, G, B) is above this (the black outline is left out). */
const GOO_LIT_MIN_RGB = 32;

/** Every vendor file the goo group reads, sorted ([] without a group). */
function gooSourceFiles(group) {
	if (!group) return [];
	const def = group.sets && group.sets[GOO_ID];
	if (!def || typeof def.file !== "string" || def.file === "") throw new Error(`goo.sets.${GOO_ID} needs a file`);
	return [def.file];
}

/**
 * A group's `pixelsPerTileFrom` (see the bullet and goo sections): undefined when absent, { id, checked: false } without
 * built sprite sets (`--only`), else { id, checked: true } once the named set's pixelsPerTile equals `ppt` (throws if not).
 */
function groupPixelsPerTileFrom(what, group, ppt, spriteSets) {
	if (group.pixelsPerTileFrom === undefined) return undefined;
	if (!spriteSets) return { id: group.pixelsPerTileFrom, checked: false };
	const from = spriteSets.find((s) => s.id === group.pixelsPerTileFrom);
	if (!from) throw new Error(`${what}.pixelsPerTileFrom names no sprite set ${group.pixelsPerTileFrom}`);
	if (from.layout.pixelsPerTile !== ppt) throw new Error(`${what}.pixelsPerTile ${ppt} differs from ${group.pixelsPerTileFrom}'s ${from.layout.pixelsPerTile}`);
	return { id: group.pixelsPerTileFrom, checked: true };
}

/** Alpha-weighted mean "#rrggbb" of the pixels of `imgs` with alpha > 0 and max(R, G, B) > minRgb. */
function litMeanColor(imgs, minRgb) {
	const sum = [0, 0, 0];
	let weight = 0;
	for (const img of imgs) {
		for (let i = 0; i < img.w * img.h; i++) {
			const p = i * 4;
			const a = img.data[p + 3];
			if (a === 0 || Math.max(img.data[p], img.data[p + 1], img.data[p + 2]) <= minRgb) continue;
			weight += a;
			for (let k = 0; k < 3; k++) sum[k] += img.data[p + k] * a;
		}
	}
	if (weight === 0) throw new Error("litMeanColor: no lit pixels");
	return "#" + sum.map((s) => Math.floor((2 * s + weight) / (2 * weight)).toString(16).padStart(2, "0")).join("");
}

/** The goo gate row (bulletGates' enemy row shape, so bulletGateLine prints it): `mean` against `gates`. */
function gooGate(mean, gates) {
	if (gates === null || typeof gates !== "object" || Array.isArray(gates)) throw new Error("goo.gates must be an object { role, maxDifference, minContrast, surfaces }");
	for (const k of Object.keys(gates)) if (!GOO_GATE_KEYS.has(k)) throw new Error(`goo.gates: unknown key ${k}`);
	if (typeof gates.role !== "string" || !HEX_RGB.test(gates.role)) throw new Error(`goo.gates.role must be "#rrggbb", got ${JSON.stringify(gates.role)}`);
	for (const k of ["maxDifference", "minContrast"]) {
		if (typeof gates[k] !== "number" || !(gates[k] > 0)) throw new Error(`goo.gates.${k} must be a positive number`);
	}
	if (!Array.isArray(gates.surfaces) || gates.surfaces.length === 0) throw new Error("goo.gates.surfaces must list the floor / wall colours");
	gates.surfaces.forEach((s, i) => {
		if (typeof s !== "string" || !HEX_RGB.test(s)) throw new Error(`goo.gates.surfaces[${i}] must be "#rrggbb", got ${JSON.stringify(s)}`);
	});
	const difference = cie76(mean, gates.role);
	let worst = Infinity;
	let worstOn = "";
	for (const surface of gates.surfaces) {
		const c = wcagContrast(mean, surface);
		if (c < worst) {
			worst = c;
			worstOn = surface;
		}
	}
	return { id: GOO_ID, side: "enemy", mean, difference, worst, worstOn, ok: difference <= gates.maxDifference && worst >= gates.minContrast };
}

/** A strip frame index of a goo def: an integer in 0 .. frames - 1. */
function gooFrame(what, f, frames) {
	if (!Number.isInteger(f) || f < 0 || f >= frames) throw new Error(`${GOO_ID}: ${what} frame ${JSON.stringify(f)} outside 0..${frames - 1}`);
	return f;
}

/**
 * Builds the goo sheet from the `goo` group: { file, def, cells, img, sheet, layout, box, holdBox, gate,
 * pixelsPerTileFrom, sourceH, recolorStops }. `spriteSets` as for buildBullets (undefined: pixelsPerTileFrom
 * unchecked). Throws on a bad config or a failed gate.
 */
function buildGoo(group, spriteSets) {
	if (group === null || typeof group !== "object" || Array.isArray(group)) throw new Error("goo must be an object");
	for (const k of Object.keys(group)) if (!GOO_GROUP_KEYS.has(k)) throw new Error(`goo: unknown key ${k}`);
	if (typeof group.atlas !== "string" || !/^[a-z0-9-]+$/.test(group.atlas)) throw new Error(`goo.atlas must be a file name without .png, got ${JSON.stringify(group.atlas)}`);
	const pad = group.pad === undefined ? 0 : group.pad;
	if (!Number.isInteger(pad) || pad < 0) throw new Error(`goo.pad must be a non-negative integer, got ${JSON.stringify(group.pad)}`);
	const ppt = group.pixelsPerTile;
	if (typeof ppt !== "number" || !(ppt > 0)) throw new Error("goo.pixelsPerTile must be a positive number");
	const pixelsPerTileFrom = groupPixelsPerTileFrom("goo", group, ppt, spriteSets);
	const ids = group.sets && typeof group.sets === "object" ? Object.keys(group.sets).filter((k) => !k.startsWith("$")) : [];
	if (ids.length !== 1 || ids[0] !== GOO_ID) throw new Error(`goo.sets must hold exactly one set, ${GOO_ID}; got ${JSON.stringify(ids)}`);
	const def = group.sets[GOO_ID];
	if (def === null || typeof def !== "object" || Array.isArray(def)) throw new Error(`${GOO_ID}: the goo set must be an object`);
	for (const k of Object.keys(def)) if (!GOO_SET_KEYS.has(k)) throw new Error(`${GOO_ID}: unknown goo set key ${k}`);
	if (typeof def.file !== "string" || def.file === "") throw new Error(`${GOO_ID}: the goo set needs a file`);
	if (!Number.isInteger(def.frameW) || def.frameW < 1 || !Number.isInteger(def.frames) || def.frames < 1) throw new Error(`${GOO_ID}: frameW and frames must be positive integers`);
	const land = gooFrame("land", def.land, def.frames);
	if (!Array.isArray(def.hold) || def.hold.length === 0) throw new Error(`${GOO_ID}: hold must list at least one strip frame`);
	const hold = def.hold.map((f) => gooFrame("hold", f, def.frames));
	const keep = [land, ...hold];
	if (new Set(keep).size !== keep.length) throw new Error(`${GOO_ID}: land and hold must name different strip frames, got land ${land}, hold ${JSON.stringify(hold)}`);
	const lut = recolorLut(GOO_ID, def.recolor);
	let raw = stripFrames(GOO_ID, { file: def.file, frameW: def.frameW, frames: def.frames, keep });
	if (lut) raw = raw.map((img) => recolorRegion({ img, x: 0, y: 0, w: img.w, h: img.h }, lut).img);
	let box = null;
	for (const img of raw) box = unionBox(box, alphaBounds(img, 0, 0, img.w, img.h, 0));
	let holdBox = null;
	for (const img of raw.slice(1)) holdBox = unionBox(holdBox, alphaBounds(img, 0, 0, img.w, img.h, 0));
	if (!box || !holdBox) throw new Error(`${GOO_ID}: the hold frame(s) have no visible pixels`);
	const frameW = box[2] - box[0] + 1 + 2 * pad;
	const frameH = box[3] - box[1] + 1 + 2 * pad;
	const cells = raw.map((img) => {
		const cell = raster(frameW, frameH);
		blit(img, box[0] - pad, box[1] - pad, frameW, frameH, cell, 0, 0, 0);
		return cell;
	});
	if (cells.length * frameW > MAX_ATLAS || frameH > MAX_ATLAS) throw new Error(`${GOO_ID}: ${cells.length} cells of ${frameW}x${frameH} do not fit one row of a ${MAX_ATLAS} px sheet`);
	const img = raster(cells.length * frameW, frameH);
	cells.forEach((cell, c) => blit(cell, 0, 0, frameW, frameH, img, c * frameW, 0, -1));
	alphaBleed(img);
	const litW = holdBox[2] - holdBox[0] + 1;
	const litH = holdBox[3] - holdBox[1] + 1;
	const meanColor = litMeanColor(cells, GOO_LIT_MIN_RGB);
	const gate = gooGate(meanColor, group.gates);
	if (!gate.ok) throw new Error(`goo: colour gate failed:\n  ${bulletGateLine(gate, { enemy: group.gates })}`);
	const file = `${group.atlas}.png`;
	const layout = {
		frameW,
		frameH,
		pivot: { x: holdBox[0] - (box[0] - pad) + litW / 2, y: holdBox[1] - (box[1] - pad) + litH / 2 },
		land: 0,
		hold: 1,
		holdFrames: hold.length,
		litW,
		litH,
		meanColor,
		pixelsPerTile: ppt,
	};
	return { file, def, cells, img, sheet: { file, w: img.w, h: img.h }, layout, box, holdBox, gate, pixelsPerTileFrom, sourceH: raw[0].h, recolorStops: lut ? def.recolor.ramp.length : 0 };
}

/** packs/vale/gooLayout.ts: ValeGooLayout, VALE_GOO_SHEET and VALE_GOO_LAYOUT (docs/GOO_ART.md GA1). */
function gooLayoutModule(sheet, layout) {
	const text = [
		"// GENERATED by `npm run art:build` (scripts/art/build-atlases.js) from art/atlases.json. Do not edit.",
		"",
		"/**",
		comment([
			"Layout of the `vale` pack's goo puddle (docs/GOO_ART.md GA1): the Ooze's goo drawn flat on the floor from two",
			"frames of the Slime pack's death strip, in its own sheet VALE_GOO_SHEET, one row of cells of one size (cell c at",
			"x = (c % perRow) * frameW, y = floor(c / perRow) * frameH, perRow = floor(sheet w / frameW): the SpriteSetAsset",
			"formula). `land` is drawn while the puddle lands, then one of the `holdFrames` cells from `hold` for the rest of its",
			"life. Every cell is cut with the same crop, so the frames keep their place in the source cell. The art is drawn at",
			"a 3/4 angle (screen-up is up). `litW` x `litH` is the hold frames' lit box (alpha > 0) and `pivot` its centre.",
			"`meanColor` is the alpha-weighted mean, over every cell, of the opaque pixels with max RGB > 32 (the black outline",
			"left out), after `recolor` into the enemyGoo ramp, held to the goo colour gate by the build. No asset IDs: `file`",
			"names the PNG in art/build/ to upload.",
		]),
		" */",
		"",
		'import type { HexColor, Pivot } from "../../types";',
		'import type { ValeSheetFile } from "./layout";',
		"",
		"/** The goo puddle's cells in VALE_GOO_SHEET (docs/GOO_ART.md GA1). */",
		"export interface ValeGooLayout {",
		"\t/** Cell size, art px (every cell the same). */",
		"\tframeW: number;",
		"\tframeH: number;",
		"\t/** Centre of the hold frame's lit box, cell px. */",
		"\tpivot: Pivot;",
		"\t/** Cell index of the land frame (SpriteSetAsset cell formula, perRow = floor(sheet w / frameW)). */",
		"\tland: number;",
		"\t/** First cell of the hold frames. */",
		"\thold: number;",
		"\t/** Hold variants: cells hold .. hold + holdFrames - 1. */",
		"\tholdFrames: number;",
		"\t/** Lit box (alpha > 0) of the hold frame(s), art px (union over variants). */",
		"\tlitW: number;",
		"\tlitH: number;",
		"\t/** Alpha-weighted mean of opaque pixels whose max RGB channel > 32 (the outline excluded), after recolor. */",
		"\tmeanColor: HexColor;",
		"\t/** Nominal texel density from atlases.json. */",
		"\tpixelsPerTile: number;",
		"}",
		"",
		`export const VALE_GOO_SHEET: ValeSheetFile = ${tsValue(sheet, 0, PRINT_WIDTH)};`,
		"",
		`export const VALE_GOO_LAYOUT: ValeGooLayout = ${tsValue(layout, 0, PRINT_WIDTH)};`,
		"",
	].join("\n");
	for (const line of text.split("\n")) {
		if (line.replace(/\t/g, "    ").length > PRINT_WIDTH) throw new Error(`gooLayout.ts line over ${PRINT_WIDTH} columns: ${line}`);
	}
	return text;
}

/** Contact sheet of the goo sheet: every cell read back through the layout's formula (land, then hold), a red cross on the pivot. */
function gooContact(result) {
	const l = result.layout;
	const perRow = Math.floor(result.img.w / l.frameW);
	const cells = [];
	for (let c = 0; c < 1 + l.holdFrames; c++) cells.push([result.img, (c % perRow) * l.frameW, Math.floor(c / perRow) * l.frameH]);
	return scaledContact(cells, l.frameW, l.frameH, l.pivot);
}

/** Log lines for a built goo sheet. */
function printGoo(g, group) {
	const l = g.layout;
	const from = g.pixelsPerTileFrom ? ` (pixelsPerTileFrom ${g.pixelsPerTileFrom.id}: ${g.pixelsPerTileFrom.checked ? "equal" : "unchecked, its set is not built by --only"})` : "";
	console.log(`goo: ${g.file} ${g.img.w}x${g.img.h}, ${1 + l.holdFrames} cells, ${group.pixelsPerTile} px/tile${from}`);
	console.log(
		`  ${GOO_ID}: ${g.def.file.split("/").slice(-1)[0]} ${g.def.frames} x ${g.def.frameW}x${g.sourceH}, land frame ${g.def.land} -> cell ${l.land}, hold frame(s) ${g.def.hold.join(",")} -> cells ${l.hold}..${l.hold + l.holdFrames - 1} (box ${g.box.join(",")}) -> cell ${l.frameW}x${l.frameH}, hold lit ${l.litW}x${l.litH}, pivot (${l.pivot.x}, ${l.pivot.y})${g.recolorStops ? `, recoloured (${g.recolorStops}-stop ramp)` : ""}`,
	);
	console.log(`  gate ${bulletGateLine(g.gate, { enemy: group.gates })}`);
}

// ---------------------------------------------------------------------------------------------
// Boost aura sheet (docs/BOOST_ART.md BAD3)
//
// Config key `boostAuras` (optional; absent: no aura sheet, every other output exactly as without it): { atlas (file
// name without .png), pad, pixelsPerTile (the nominal texel density the art was drawn at), pixelsPerTileFrom (optional,
// as for `goo`: checked by a full build, not by `--only boostAuras`), fps, frames (per rank), ringPx (the ring radius of
// each stack rank, art px: positive integers, increasing; one rank per entry), sets: { "fx.boost.aura.<kind>": { file
// } } }. A set's `file` is an art/vendor-relative template with {r} (the rank, 0 ..) and {f} (the frame, 0 ..); every
// frame is an odd square (the ring's centre is its centre pixel) of greyscale pixels (R = G = B: the renderer tints
// them with the kind's role), drawn by scripts/art/gen-boost-auras.js. Per set, every rank goes centred into ONE cell:
// the smallest odd square centred on the ring holding every visible pixel of every rank and frame, + pad each side,
// so the pivot (the cell's centre) is the ring's centre at every rank; nearest-neighbour, never resampled. Cells are
// rank-major (rank r's frames are cells start + r * frames .. start + r * frames + frames - 1) and the sets are packed
// into ONE sheet by packFx (bands at multiples of their cell height: the SpriteSetAsset `start + f` formula). Outputs:
// art/build/<atlas>.png (also copied to art/upload/), the contact sheet art/build/contact/<atlas>.png (a row per set
// and rank, every cell read back through the layout's formula, a red cross on the pivot) and
// src/shared/theme/packs/vale/boostAuraLayout.ts (VALE_BOOST_AURA_SHEET, VALE_BOOST_AURA_LAYOUTS: fxLayout.ts's
// ValeFxLayout plus ringPx and pixelsPerTile). Build just this group: node scripts/art/build-atlases.js --only
// boostAuras (and --lock --only boostAuras).

const BOOST_AURA_PREFIX = "fx.boost.aura.";
const BOOST_AURA_GROUP_KEYS = new Set(["$comment", "atlas", "pad", "pixelsPerTile", "pixelsPerTileFrom", "fps", "frames", "ringPx", "sets"]);
const BOOST_AURA_SET_KEYS = new Set(["$comment", "file"]);

/** A boost aura group's set ids (not `$` keys), in config order. */
function boostAuraIds(group) {
	return group && group.sets && typeof group.sets === "object" ? Object.keys(group.sets).filter((k) => !k.startsWith("$")) : [];
}

/** The art/vendor-relative file of set `id`'s rank `r` frame `f`. */
function boostAuraFile(group, id, r, f) {
	const def = group.sets[id];
	if (!def || typeof def.file !== "string" || !def.file.includes("{r}") || !def.file.includes("{f}")) throw new Error(`boostAuras.sets.${id}.file must be a template with {r} and {f}`);
	return def.file.replace("{r}", String(r)).replace("{f}", String(f));
}

/** Every vendor file the boost aura group reads, sorted ([] without a group). */
function boostAuraSourceFiles(group) {
	if (!group) return [];
	const ranks = Array.isArray(group.ringPx) ? group.ringPx.length : 0;
	const out = [];
	for (const id of boostAuraIds(group)) for (let r = 0; r < ranks; r++) for (let f = 0; f < group.frames; f++) out.push(boostAuraFile(group, id, r, f));
	return out.sort();
}

/**
 * Builds the boost aura sheet from the `boostAuras` group: { file, sets, packed, sheet, layouts, pixelsPerTileFrom }.
 * `spriteSets` as for buildGoo (undefined: pixelsPerTileFrom unchecked). Throws on a bad config or source frame.
 */
function buildBoostAuras(group, spriteSets) {
	if (group === null || typeof group !== "object" || Array.isArray(group)) throw new Error("boostAuras must be an object");
	for (const k of Object.keys(group)) if (!BOOST_AURA_GROUP_KEYS.has(k)) throw new Error(`boostAuras: unknown key ${k}`);
	if (typeof group.atlas !== "string" || !/^[a-z0-9-]+$/.test(group.atlas)) throw new Error(`boostAuras.atlas must be a file name without .png, got ${JSON.stringify(group.atlas)}`);
	const pad = group.pad === undefined ? 0 : group.pad;
	if (!Number.isInteger(pad) || pad < 0) throw new Error(`boostAuras.pad must be a non-negative integer, got ${JSON.stringify(group.pad)}`);
	const ppt = group.pixelsPerTile;
	if (typeof ppt !== "number" || !(ppt > 0)) throw new Error("boostAuras.pixelsPerTile must be a positive number");
	const pixelsPerTileFrom = groupPixelsPerTileFrom("boostAuras", group, ppt, spriteSets);
	if (typeof group.fps !== "number" || !(group.fps > 0)) throw new Error("boostAuras.fps must be a positive number");
	if (!Number.isInteger(group.frames) || group.frames < 1) throw new Error("boostAuras.frames must be a positive integer");
	const ringPx = group.ringPx;
	if (!Array.isArray(ringPx) || ringPx.length === 0) throw new Error("boostAuras.ringPx must list one ring radius (art px) per rank");
	ringPx.forEach((px, r) => {
		if (!Number.isInteger(px) || px < 1 || (r > 0 && px <= ringPx[r - 1])) throw new Error(`boostAuras.ringPx must be increasing positive integers, got ${JSON.stringify(ringPx)}`);
	});
	const ids = boostAuraIds(group);
	if (ids.length === 0) throw new Error("boostAuras.sets must hold at least one fx.boost.aura.<kind> set");
	const sets = ids.map((id) => {
		if (!id.startsWith(BOOST_AURA_PREFIX) || !/^[a-z]+$/.test(id.slice(BOOST_AURA_PREFIX.length))) throw new Error(`boostAuras: set ${id} is not an fx.boost.aura.<kind> id`);
		const def = group.sets[id];
		if (def === null || typeof def !== "object" || Array.isArray(def)) throw new Error(`${id}: the aura set must be an object`);
		for (const k of Object.keys(def)) if (!BOOST_AURA_SET_KEYS.has(k)) throw new Error(`${id}: unknown aura set key ${k}`);
		const raw = [];
		let reach = -1; // the farthest visible pixel from the centre (Chebyshev), over every rank and frame
		for (let r = 0; r < ringPx.length; r++) {
			for (let f = 0; f < group.frames; f++) {
				const rel = boostAuraFile(group, id, r, f);
				const img = readPng(rel);
				if (img.w !== img.h || img.w % 2 !== 1) throw new Error(`${id}: ${rel} is ${img.w}x${img.h}, not an odd square (the ring's centre is its centre pixel)`);
				const c = (img.w - 1) / 2;
				if (ringPx[r] >= c) throw new Error(`${id}: ${rel} is ${img.w} px, too small for rank ${r}'s ${ringPx[r]} px ring`);
				for (let i = 0; i < img.w * img.h; i++) {
					const p = i * 4;
					if (img.data[p + 3] === 0) continue;
					if (img.data[p] !== img.data[p + 1] || img.data[p + 1] !== img.data[p + 2]) throw new Error(`${id}: ${rel} has a coloured pixel at (${i % img.w}, ${Math.floor(i / img.w)}); aura frames are greyscale (the renderer tints them)`);
					reach = Math.max(reach, Math.abs((i % img.w) - c), Math.abs(Math.floor(i / img.w) - c));
				}
				raw.push({ img, c, rel });
			}
		}
		if (reach < 0) throw new Error(`${id}: no visible pixels`);
		const half = reach + pad;
		const side = 2 * half + 1;
		const frames = raw.map(({ img, c }) => {
			const cell = raster(side, side);
			blit(img, c - half, c - half, side, side, cell, 0, 0, 0);
			return cell;
		});
		return { id, frames, frameW: side, frameH: side, reach, sourceSides: [...new Set(raw.map((x) => x.img.w))] };
	});
	const packed = packFx(sets, "boostAuras");
	const file = `${group.atlas}.png`;
	const layouts = {};
	for (const p of [...packed.placed].sort((a, b) => (a.s.id < b.s.id ? -1 : 1))) {
		const l = fxLayoutOf({ s: { ...p.s, fps: group.fps, loop: true, grey: true, frames: p.s.frames.slice(0, group.frames) }, start: p.start });
		l.ringPx = [...ringPx];
		l.pixelsPerTile = ppt;
		layouts[p.s.id] = l;
	}
	return { file, sets, packed, sheet: { file, w: packed.w, h: packed.h }, layouts, pixelsPerTileFrom, ranks: ringPx.length };
}

/** packs/vale/boostAuraLayout.ts: ValeBoostAuraLayout, VALE_BOOST_AURA_SHEET and VALE_BOOST_AURA_LAYOUTS. */
function boostAuraLayoutModule(sheet, layouts) {
	const text = [
		"// GENERATED by `npm run art:build` (scripts/art/build-atlases.js) from art/atlases.json. Do not edit.",
		"",
		"/**",
		comment([
			"Layout of the `vale` pack's boost auras (docs/BOOST_ART.md BAD3): original greyscale pixel-art rings drawn by",
			"scripts/art/gen-boost-auras.js, one set per fx.boost.aura.<kind>, in their own sheet VALE_BOOST_AURA_SHEET. Each",
			"set is fxLayout.ts's ValeFxLayout (cells `start + f` of the SpriteSetAsset formula, perRow = floor(sheet w /",
			"frameW); `frames` per loop) drawn natively at every stack rank: rank r's loop is cells start + r * frames ..",
			"start + r * frames + frames - 1, its ring `ringPx[r]` art px from the pivot (the cell's centre, the ring's",
			"centre at every rank). The art was drawn at `pixelsPerTile`. No asset IDs: `file` names the PNG in art/build/",
			"to upload.",
		]),
		" */",
		"",
		'import type { ValeFxLayout } from "./fxLayout";',
		'import type { ValeSheetFile } from "./layout";',
		"",
		"/** One boost aura in VALE_BOOST_AURA_SHEET: its rank-0 loop (ValeFxLayout) and every rank's ring. */",
		"export interface ValeBoostAuraLayout extends ValeFxLayout {",
		"\t/** Ring radius per stack rank, art px from the pivot (one rank per entry, increasing). */",
		"\tringPx: Array<number>;",
		"\t/** The texel density the art was drawn at (atlases.json). */",
		"\tpixelsPerTile: number;",
		"}",
		"",
		`export const VALE_BOOST_AURA_SHEET: ValeSheetFile = ${tsValue(sheet, 0, PRINT_WIDTH)};`,
		"",
		`export const VALE_BOOST_AURA_LAYOUTS: Record<string, ValeBoostAuraLayout> = ${tsValue(layouts, 0, PRINT_WIDTH)};`,
		"",
	].join("\n");
	for (const line of text.split("\n")) {
		if (line.replace(/\t/g, "    ").length > PRINT_WIDTH) throw new Error(`boostAuraLayout.ts line over ${PRINT_WIDTH} columns: ${line}`);
	}
	return text;
}

/** Contact sheet of the boost aura sheet: a row per set (id order) and rank, every cell read back through the layout. */
function boostAuraContact(result) {
	const rows = [];
	for (const id of Object.keys(result.layouts).sort()) {
		const l = result.layouts[id];
		for (let r = 0; r < l.ringPx.length; r++) {
			const cells = [];
			for (let f = 0; f < l.frames; f++) cells.push([result.packed.img, ...fxCellAt(result.packed.w, { ...l, start: l.start + r * l.frames }, f)]);
			rows.push(scaledContact(cells, l.frameW, l.frameH, l.pivot));
		}
	}
	const out = raster(Math.max(...rows.map((r) => r.w)), rows.reduce((h, r) => h + r.h, 0));
	fillRect(out, 0, 0, out.w, out.h, [CONTACT_BG, CONTACT_BG, CONTACT_BG]);
	let y = 0;
	for (const r of rows) {
		blit(r, 0, 0, r.w, r.h, out, 0, y, -1);
		y += r.h;
	}
	return out;
}

/** Log lines for a built boost aura sheet. */
function printBoostAuras(b, group) {
	const from = b.pixelsPerTileFrom ? ` (pixelsPerTileFrom ${b.pixelsPerTileFrom.id}: ${b.pixelsPerTileFrom.checked ? "equal" : "unchecked, its set is not built by --only"})` : "";
	const fill = (100 * b.packed.used) / (b.packed.w * b.packed.h);
	console.log(`boostAuras: ${b.file} ${b.packed.w}x${b.packed.h}, ${b.sets.length} sets x ${b.ranks} ranks x ${group.frames} frames @ ${group.fps} fps, ring ${group.ringPx.join(" / ")} px, ${group.pixelsPerTile} px/tile${from}, ${fill.toFixed(1)}% of its area in cells`);
	for (const s of b.sets) {
		const l = b.layouts[s.id];
		console.log(`  ${s.id}: sources ${s.sourceSides.join(" / ")} px -> cell ${l.frameW}x${l.frameH} (reach ${s.reach} px), start ${l.start}, pivot (${l.pivot.x}, ${l.pivot.y})`);
	}
}

// ---------------------------------------------------------------------------------------------
// Treasure sheets (docs/TREASURE.md TR9; config key `treasure`)
//
// The vault's cage and light column: original pixel art drawn by scripts/art/gen-treasure-art.js (art:build and
// art:lock run it first) into art/vendor/kaleb-vale/, each in a sheet of its own, so adding them never repacks the
// decor or effects atlas. `treasure`: { pixelsPerTile (a positive number), pixelsPerTileFrom (optional: a sprite set id
// whose pixelsPerTile must equal it, checked by a full build as for `goo`), cage, column }.
//   cage    a world sprite set (the worldArt piece keys: facings, animations, pivot, own; cleaned and cut by
//           buildWorldSprites with worldArt's noiseAlpha / pad): its cells in one row of <own>.png; `resample`
//           (optional, default worldArt's "Default") is written into its layout.
//   column  an effect strip (the fx set keys: file, frameW, frames, fps, loop, grey; buildFxSet with `pad`) alone in
//           <atlas>.png (packFx).
// Outputs: art/build/<own>.png and <atlas>.png (also copied to art/upload/), contact sheets art/build/contact/
// treasure.cage.png / fx.treasure.column.png, and src/shared/theme/packs/vale/treasureLayout.ts
// (VALE_TREASURE_CAGE_LAYOUT, VALE_TREASURE_FX_SHEET, VALE_TREASURE_FX_LAYOUTS). Build just this group:
// node scripts/art/build-atlases.js --only treasure (and --lock --only treasure).

const TREASURE_CAGE_ID = "treasure.cage";
const TREASURE_COLUMN_ID = "fx.treasure.column";
const TREASURE_GROUP_KEYS = new Set(["$comment", "pixelsPerTile", "pixelsPerTileFrom", "cage", "column"]);
const TREASURE_CAGE_KEYS = new Set(["$comment", "facings", "animations", "pivot", "own", "resample"]);
const TREASURE_COLUMN_KEYS = new Set(["$comment", "atlas", "pad", "file", "frameW", "frames", "fps", "loop", "grey"]);
const RESAMPLE_MODES = ["Default", "Pixelated"];

/** Every vendor file the treasure group reads, sorted ([] without a group). */
function treasureSourceFiles(group) {
	if (!group) return [];
	const files = new Set();
	const cage = group.cage;
	if (!cage || !cage.animations) throw new Error("treasure.cage needs animations");
	for (const fc of pieceFacings(TREASURE_CAGE_ID, cage)) {
		for (const a of Object.values(cage.animations)) for (const f of a.frames) files.add(expandFile(a.file, fc.dir, fc.angle, f));
	}
	if (!group.column || typeof group.column.file !== "string" || group.column.file === "") throw new Error("treasure.column needs a file");
	files.add(group.column.file);
	return [...files].sort();
}

/**
 * Builds the treasure sheets: { cage: { piece, layout, file, img }, column: { set, packed, sheet, layout },
 * pixelsPerTileFrom }. `world` is the worldArt group (cleaning and pad); `spriteSets` as for buildGoo.
 */
function buildTreasure(group, world, spriteSets) {
	if (group === null || typeof group !== "object" || Array.isArray(group)) throw new Error("treasure must be an object");
	for (const k of Object.keys(group)) if (!TREASURE_GROUP_KEYS.has(k)) throw new Error(`treasure: unknown key ${k}`);
	if (!world) throw new Error("treasure needs the worldArt group (its cleaning and pad)");
	const ppt = group.pixelsPerTile;
	if (typeof ppt !== "number" || !(ppt > 0)) throw new Error("treasure.pixelsPerTile must be a positive number");
	const pixelsPerTileFrom = groupPixelsPerTileFrom("treasure", group, ppt, spriteSets);
	// the cage: a world sprite set alone in its own sheet, one row of cells
	const cdef = group.cage;
	for (const k of Object.keys(cdef)) if (!TREASURE_CAGE_KEYS.has(k)) throw new Error(`${TREASURE_CAGE_ID}: unknown key ${k}`);
	if (typeof cdef.own !== "string" || !/^[a-z0-9-]+$/.test(cdef.own)) throw new Error(`${TREASURE_CAGE_ID}: own must be a file name without .png`);
	const resample = cdef.resample === undefined ? "Default" : cdef.resample;
	if (!RESAMPLE_MODES.includes(resample)) throw new Error(`${TREASURE_CAGE_ID}: resample must be one of ${RESAMPLE_MODES.join(", ")}`);
	const piece = buildWorldSprites(world, TREASURE_CAGE_ID, cdef, ppt, world.pad);
	if (piece.cells.length * piece.frameW > MAX_ATLAS) throw new Error(`${TREASURE_CAGE_ID}: ${piece.cells.length} cells of ${piece.frameW} px do not fit one row`);
	const cageImg = raster(piece.cells.length * piece.frameW, piece.frameH);
	piece.cells.forEach((c, k) => blit(c.img, 0, 0, piece.frameW, piece.frameH, cageImg, k * piece.frameW, 0, 0));
	alphaBleed(cageImg);
	const cageFile = `${cdef.own}.png`;
	piece.atlas = { file: cageFile, img: cageImg };
	piece.startCell = 0;
	piece.perRow = piece.cells.length;
	const cageLayout = { ...worldLayout(piece), resample };
	// the column: an effect strip alone in its own sheet
	const fdef = group.column;
	for (const k of Object.keys(fdef)) if (!TREASURE_COLUMN_KEYS.has(k)) throw new Error(`${TREASURE_COLUMN_ID}: unknown key ${k}`);
	if (typeof fdef.atlas !== "string" || !/^[a-z0-9-]+$/.test(fdef.atlas)) throw new Error(`${TREASURE_COLUMN_ID}: atlas must be a file name without .png`);
	if (`${fdef.atlas}.png` === cageFile) throw new Error(`treasure: the cage and the column cannot share ${cageFile}`);
	const pad = fdef.pad === undefined ? 0 : fdef.pad;
	if (!Number.isInteger(pad) || pad < 0) throw new Error(`${TREASURE_COLUMN_ID}: pad must be a non-negative integer`);
	if (typeof fdef.fps !== "number" || !(fdef.fps > 0)) throw new Error(`${TREASURE_COLUMN_ID}: fps must be a positive number`);
	const set = buildFxSet(TREASURE_COLUMN_ID, fdef, pad);
	const packed = packFx([set], "treasure");
	const columnLayout = fxLayoutOf(packed.placed[0]);
	const sheet = { file: `${fdef.atlas}.png`, w: packed.w, h: packed.h };
	return { cage: { piece, layout: cageLayout, file: cageFile, img: cageImg }, column: { set, packed, sheet, layout: columnLayout }, pixelsPerTileFrom };
}

/** packs/vale/treasureLayout.ts: VALE_TREASURE_CAGE_LAYOUT, VALE_TREASURE_FX_SHEET, VALE_TREASURE_FX_LAYOUTS. */
function treasureLayoutModule(t) {
	const text = [
		"// GENERATED by `npm run art:build` (scripts/art/build-atlases.js) from art/atlases.json. Do not edit.",
		"",
		"/**",
		comment([
			"Layout of the `vale` pack's vault art (docs/TREASURE.md TR9): original pixel art by scripts/art/gen-treasure-art.js,",
			"each in a sheet of its own. VALE_TREASURE_CAGE_LAYOUT is `treasure.cage`, a world sprite set (four facings like the",
			"chest, `idle`); VALE_TREASURE_FX_SHEET / VALE_TREASURE_FX_LAYOUTS hold `fx.treasure.column`, a greyscale effect",
			"flipbook (cells `start + f` of the SpriteSetAsset formula, perRow = floor(sheet w / frameW)) tinted at draw time.",
			"No asset IDs: `file` names the PNG in art/build/ to upload.",
		]),
		" */",
		"",
		'import type { ValeFxLayout } from "./fxLayout";',
		'import type { ValeSheetFile, ValeWorldSpriteLayout } from "./layout";',
		"",
		`export const VALE_TREASURE_CAGE_LAYOUT: ValeWorldSpriteLayout = ${tsValue(t.cage.layout, 0, PRINT_WIDTH)};`,
		"",
		`export const VALE_TREASURE_FX_SHEET: ValeSheetFile = ${tsValue(t.column.sheet, 0, PRINT_WIDTH)};`,
		"",
		`export const VALE_TREASURE_FX_LAYOUTS: Record<string, ValeFxLayout> = ${tsValue({ [TREASURE_COLUMN_ID]: t.column.layout }, 0, PRINT_WIDTH)};`,
		"",
	].join("\n");
	for (const line of text.split("\n")) {
		if (line.replace(/\t/g, "    ").length > PRINT_WIDTH) throw new Error(`treasureLayout.ts line over ${PRINT_WIDTH} columns: ${line}`);
	}
	return text;
}

/** The column's contact sheet: every frame read back through its layout. */
function treasureColumnContact(t) {
	const l = t.column.layout;
	const cells = [];
	for (let f = 0; f < l.frames; f++) cells.push([t.column.packed.img, ...fxCellAt(t.column.packed.w, l, f)]);
	return scaledContact(cells, l.frameW, l.frameH, l.pivot);
}

/** Every output of the treasure group: [dir, name, img]. */
function treasureOutputs(t) {
	return [
		["build", t.cage.file, t.cage.img],
		["build", t.column.sheet.file, t.column.packed.img],
		["contact", `${TREASURE_CAGE_ID}.png`, worldContact(t.cage.piece)],
		["contact", `${TREASURE_COLUMN_ID}.png`, treasureColumnContact(t)],
	];
}

/** Log lines for the built treasure sheets. */
function printTreasure(t) {
	const c = t.cage.layout;
	const l = t.column.layout;
	const from = t.pixelsPerTileFrom ? ` (pixelsPerTileFrom ${t.pixelsPerTileFrom.id}: ${t.pixelsPerTileFrom.checked ? "equal" : "unchecked, its set is not built by --only"})` : "";
	console.log(`treasure: ${c.pixelsPerTile} px/tile${from}`);
	console.log(`  ${TREASURE_CAGE_ID}: ${t.cage.file} ${t.cage.img.w}x${t.cage.img.h}, cells ${c.frameW}x${c.frameH} x ${t.cage.piece.cells.length} (${t.cage.piece.dirs.join(" ")}), pivot (${c.pivot.x}, ${c.pivot.y}), ${c.resample}`);
	console.log(`  ${TREASURE_COLUMN_ID}: ${t.column.sheet.file} ${t.column.sheet.w}x${t.column.sheet.h}, cell ${l.frameW}x${l.frameH}, ${l.frames} frames @ ${l.fps} fps${l.loop ? " loop" : ""}, ${l.grey ? "grey" : `mean ${l.meanColor}`}`);
}

// ---------------------------------------------------------------------------------------------
// Hazard sheet (docs/HAZARD_ART.md HA2; config key `hazards`)
//
// The floor hazards (the Stormcaller's strike, the build embers): original greyscale pixel art drawn by
// scripts/art/gen-hazard-art.js (art:build and art:lock run it first) into art/vendor/kaleb-vale/hazards/, packed into
// ONE sheet of its own (art/build/<atlas>.png, generated src/shared/theme/packs/vale/hazardLayout.ts), so no other
// atlas repacks. `hazards`: { atlas, pixelsPerTile, pixelsPerTileFrom (optional: as for `goo`, checked by a full
// build), sets: { "<bullet id>": { canvas [w, h] (every strip's frame size), pivot [x, y] (canvas px), rimPx (the
// strike: its hit rim), lit [w, h] (the ember: the box that covers the drawn disc, centred on the pivot), animations:
// { name: { file, frames, fps, loop? } } } } }. No crop (the generator's canvases are tight) and no recolour: every
// visible pixel must already be grey (the renderer tints it), checked here. A set's animations are its frames in
// animation order, one band of packFx. Build just this group: node scripts/art/build-atlases.js --only hazards (and
// --lock --only hazards).

const HAZARD_IDS = ["bullet.enemy.strike", "bullet.player.ember"];
const HAZARD_GROUP_KEYS = new Set(["$comment", "atlas", "pixelsPerTile", "pixelsPerTileFrom", "sets"]);
const HAZARD_SET_KEYS = new Set(["$comment", "canvas", "pivot", "rimPx", "lit", "animations"]);
const HAZARD_ANIM_KEYS = new Set(["$comment", "file", "frames", "fps", "loop"]);
const HAZARD_LAYOUT_FILE = path.join(LAYOUT_DIR, "hazardLayout.ts");

/** The group's set ids in HAZARD_IDS order (throws on an unknown one). */
function hazardIds(group) {
	const ids = group.sets && typeof group.sets === "object" ? Object.keys(group.sets).filter((k) => !k.startsWith("$")) : [];
	for (const id of ids) if (!HAZARD_IDS.includes(id)) throw new Error(`hazards.sets: unknown hazard ${id} (one of ${HAZARD_IDS.join(", ")})`);
	return HAZARD_IDS.filter((id) => ids.includes(id));
}

/** A set's animation names in config order (no `$` keys). */
function hazardAnimNames(id, def) {
	if (!def.animations || typeof def.animations !== "object" || Array.isArray(def.animations)) throw new Error(`${id}: animations must be an object`);
	const names = Object.keys(def.animations).filter((k) => !k.startsWith("$"));
	if (names.length === 0) throw new Error(`${id}: no animations`);
	return names;
}

/** Every vendor file the hazards group reads, sorted ([] without a group). */
function hazardSourceFiles(group) {
	if (!group) return [];
	const out = [];
	for (const id of hazardIds(group)) {
		const def = group.sets[id];
		for (const name of hazardAnimNames(id, def)) {
			const a = def.animations[name];
			if (!a || typeof a.file !== "string" || a.file === "") throw new Error(`${id}.${name} needs a file`);
			out.push(a.file);
		}
	}
	return out.sort();
}

/** A pair of positive numbers [a, b] (integers when `int`). */
function hazardPair(what, v, int) {
	const ok = Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && n > 0 && (!int || Number.isInteger(n)));
	if (!ok) throw new Error(`${what} must be [a, b] of positive ${int ? "integers" : "numbers"}, got ${JSON.stringify(v)}`);
	return v;
}

/**
 * Builds the hazard sheet: { file, sets, packed, sheet, layouts, pixelsPerTileFrom }. `spriteSets` as for buildGoo
 * (undefined: pixelsPerTileFrom unchecked). Throws on a bad config, a strip of the wrong size or a pixel not grey.
 */
function buildHazards(group, spriteSets) {
	if (group === null || typeof group !== "object" || Array.isArray(group)) throw new Error("hazards must be an object");
	for (const k of Object.keys(group)) if (!HAZARD_GROUP_KEYS.has(k)) throw new Error(`hazards: unknown key ${k}`);
	if (typeof group.atlas !== "string" || !/^[a-z0-9-]+$/.test(group.atlas)) throw new Error(`hazards.atlas must be a file name without .png, got ${JSON.stringify(group.atlas)}`);
	const ppt = group.pixelsPerTile;
	if (typeof ppt !== "number" || !(ppt > 0)) throw new Error("hazards.pixelsPerTile must be a positive number");
	const pixelsPerTileFrom = groupPixelsPerTileFrom("hazards", group, ppt, spriteSets);
	const ids = hazardIds(group);
	if (ids.length === 0) throw new Error("hazards.sets holds no hazard");
	const sets = ids.map((id) => {
		const def = group.sets[id];
		if (def === null || typeof def !== "object" || Array.isArray(def)) throw new Error(`${id}: the hazard set must be an object`);
		for (const k of Object.keys(def)) if (!HAZARD_SET_KEYS.has(k)) throw new Error(`${id}: unknown hazard set key ${k}`);
		const [w, h] = hazardPair(`${id}.canvas`, def.canvas, true);
		const [px, py] = hazardPair(`${id}.pivot`, def.pivot, false);
		if (px > w || py > h) throw new Error(`${id}: pivot ${def.pivot} outside its ${w}x${h} canvas`);
		if (id === "bullet.enemy.strike" && !(typeof def.rimPx === "number" && def.rimPx > 0 && def.rimPx <= Math.min(w, h) / 2)) {
			throw new Error(`${id}: rimPx must be a positive number within half the canvas`);
		}
		if (id !== "bullet.enemy.strike" && def.rimPx !== undefined) throw new Error(`${id}: only the strike takes rimPx`);
		if (id === "bullet.player.ember") {
			const [lw, lh] = hazardPair(`${id}.lit`, def.lit, true);
			if (lw > w || lh > h) throw new Error(`${id}: lit ${def.lit} larger than its canvas`);
		} else if (def.lit !== undefined) throw new Error(`${id}: only the ember takes lit`);
		const frames = [];
		const anims = [];
		for (const name of hazardAnimNames(id, def)) {
			const a = def.animations[name];
			for (const k of Object.keys(a)) if (!HAZARD_ANIM_KEYS.has(k)) throw new Error(`${id}.${name}: unknown key ${k}`);
			if (!Number.isInteger(a.frames) || a.frames < 1) throw new Error(`${id}.${name}: frames must be a positive integer`);
			if (typeof a.fps !== "number" || !(a.fps > 0)) throw new Error(`${id}.${name}: fps must be a positive number`);
			const strip = stripFrames(`${id}.${name}`, { file: a.file, frameW: w, frames: a.frames });
			for (const img of strip) {
				if (img.h !== h) throw new Error(`${id}.${name}: ${a.file} is ${img.h} px tall, not ${h}`);
				for (let i = 0; i < img.w * img.h; i++) {
					const p = i * 4;
					if (img.data[p + 3] === 0) continue;
					if (img.data[p] !== img.data[p + 1] || img.data[p + 1] !== img.data[p + 2]) throw new Error(`${id}.${name}: ${a.file} has a pixel that is not grey (the renderer tints it)`);
				}
			}
			anims.push({ name, offset: frames.length, frames: a.frames, fps: a.fps, loop: a.loop === true });
			frames.push(...strip);
		}
		return { id, def, frameW: w, frameH: h, frames, anims, pivot: { x: px, y: py }, meanColor: meanColor(frames) };
	});
	const packed = packFx(sets, "hazards");
	const file = `${group.atlas}.png`;
	const layouts = {};
	for (const p of packed.placed) {
		const s = p.s;
		const animations = {};
		for (const a of s.anims) animations[a.name] = { start: p.start + a.offset, frames: a.frames, fps: a.fps, loop: a.loop };
		const l = { frameW: s.frameW, frameH: s.frameH, pivot: s.pivot, animations, meanColor: s.meanColor, pixelsPerTile: ppt };
		if (s.def.rimPx !== undefined) l.rimPx = s.def.rimPx;
		if (s.def.lit !== undefined) l.lit = { w: s.def.lit[0], h: s.def.lit[1] };
		layouts[s.id] = l;
	}
	const ordered = {};
	for (const id of ids) ordered[id] = layouts[id];
	return { file, sets, packed, sheet: { file, w: packed.w, h: packed.h }, layouts: ordered, pixelsPerTileFrom };
}

/** packs/vale/hazardLayout.ts: ValeHazardLayout, VALE_HAZARD_SHEET and VALE_HAZARD_LAYOUTS (docs/HAZARD_ART.md HA2). */
function hazardLayoutModule(sheet, layouts) {
	const text = [
		"// GENERATED by `npm run art:build` (scripts/art/build-atlases.js) from art/atlases.json. Do not edit.",
		"",
		"/**",
		comment([
			"Layout of the `vale` pack's floor hazards (docs/HAZARD_ART.md HA2): original greyscale pixel art by",
			"scripts/art/gen-hazard-art.js (the Stormcaller's strike seen from straight above, the build embers in the 3/4",
			"view), in its own sheet VALE_HAZARD_SHEET. Per hazard one cell size; animation `name`'s frames are cells start ..",
			"start + frames - 1 (cell c at x = (c % perRow) * frameW, y = floor(c / perRow) * frameH, perRow = floor(sheet w /",
			"frameW): the SpriteSetAsset formula). `pivot` is where the bullet sits (cell px). `rimPx` (the strike) is its",
			"hit rim, px from the pivot; `lit` (the ember) the box, centred on the pivot, that covers the drawn disc. Grey: the",
			"renderer tints it. `meanColor` is the alpha-weighted mean of every visible pixel (grey). No asset IDs: `file`",
			"names the PNG in art/build/ to upload.",
		]),
		" */",
		"",
		'import type { HexColor, Pivot } from "../../types";',
		'import type { ValeSheetFile } from "./layout";',
		"",
		"/** One hazard animation's cells. */",
		"export interface ValeHazardAnimation {",
		"\tstart: number;",
		"\tframes: number;",
		"\tfps: number;",
		"\tloop: boolean;",
		"}",
		"",
		"/** One hazard's cells in VALE_HAZARD_SHEET (docs/HAZARD_ART.md HA2). */",
		"export interface ValeHazardLayout {",
		"\t/** Cell size, art px (every cell of the hazard the same). */",
		"\tframeW: number;",
		"\tframeH: number;",
		"\t/** Where the bullet sits, cell px. */",
		"\tpivot: Pivot;",
		"\tanimations: Record<string, ValeHazardAnimation>;",
		"\t/** Alpha-weighted mean of every visible pixel (grey: the sheet is tinted by the renderer). */",
		"\tmeanColor: HexColor;",
		"\t/** Nominal texel density from atlases.json. */",
		"\tpixelsPerTile: number;",
		"\t/** The strike only: its hit rim, art px from the pivot. */",
		"\trimPx?: number;",
		"\t/** The ember only: the box covering the drawn disc, art px, centred on the pivot. */",
		"\tlit?: { w: number; h: number };",
		"}",
		"",
		`export const VALE_HAZARD_SHEET: ValeSheetFile = ${tsValue(sheet, 0, PRINT_WIDTH)};`,
		"",
		`export const VALE_HAZARD_LAYOUTS: Record<string, ValeHazardLayout> = ${tsValue(layouts, 0, PRINT_WIDTH)};`,
		"",
	].join("\n");
	for (const line of text.split("\n")) {
		if (line.replace(/\t/g, "    ").length > PRINT_WIDTH) throw new Error(`hazardLayout.ts line over ${PRINT_WIDTH} columns: ${line}`);
	}
	return text;
}

/** Contact sheet of the hazard sheet: every cell of every hazard read back through its layout (one hazard per row band). */
function hazardContact(result) {
	const rows = [];
	for (const id of Object.keys(result.layouts)) {
		const l = result.layouts[id];
		const perRow = Math.floor(result.packed.img.w / l.frameW);
		const cells = [];
		for (const name of Object.keys(l.animations)) {
			const a = l.animations[name];
			for (let f = 0; f < a.frames; f++) {
				const c = a.start + f;
				cells.push([result.packed.img, (c % perRow) * l.frameW, Math.floor(c / perRow) * l.frameH]);
			}
		}
		rows.push(scaledContact(cells, l.frameW, l.frameH, l.pivot));
	}
	const w = Math.max(...rows.map((r) => r.w));
	const out = raster(w, rows.reduce((n, r) => n + r.h, 0));
	let y = 0;
	for (const r of rows) {
		blit(r, 0, 0, r.w, r.h, out, 0, y, 0);
		y += r.h;
	}
	return out;
}

/** Log lines for a built hazard sheet. */
function printHazards(h) {
	const from = h.pixelsPerTileFrom ? ` (pixelsPerTileFrom ${h.pixelsPerTileFrom.id}: ${h.pixelsPerTileFrom.checked ? "equal" : "unchecked, its set is not built by --only"})` : "";
	console.log(`hazards: ${h.file} ${h.packed.w}x${h.packed.h}, ${h.sets.reduce((n, s) => n + s.frames.length, 0)} cells${from}`);
	for (const id of Object.keys(h.layouts)) {
		const l = h.layouts[id];
		const anims = Object.keys(l.animations)
			.map((n) => `${n} ${l.animations[n].frames} @ ${l.animations[n].fps} fps from cell ${l.animations[n].start}${l.animations[n].loop ? " loop" : ""}`)
			.join(", ");
		const extra = `${l.rimPx !== undefined ? `, rim ${l.rimPx} px` : ""}${l.lit ? `, lit ${l.lit.w}x${l.lit.h}` : ""}`;
		console.log(`  ${id}: cell ${l.frameW}x${l.frameH}, pivot (${l.pivot.x}, ${l.pivot.y}), ${anims}${extra}, grey mean ${l.meanColor}`);
	}
}

/**
 * `--only hazards` (docs/HAZARD_ART.md HA2): checks the hazard strips against the lock, then writes ONLY
 * art/build/<atlas>.png (and its art/upload copy), art/build/contact/<atlas>.png and packs/vale/hazardLayout.ts, byte for
 * byte what a full build writes for them (pixelsPerTileFrom unchecked). Nothing else is read, written or removed.
 */
function mainOnlyHazards(config) {
	if (!config.hazards) fail("art/atlases.json has no `hazards` group");
	checkLock(config, hazardSourceFiles(config.hazards));
	const h = buildHazards(config.hazards, undefined);
	let changed = 0;
	const png = encodePng(h.packed.img);
	if (writeIfChanged(path.join(BUILD, h.file), png)) changed++;
	if (writeIfChanged(path.join(CONTACT, h.file), encodePng(hazardContact(h)))) changed++;
	if (writeIfChanged(path.join(UPLOAD, h.file), png)) changed++;
	if (writeIfChanged(HAZARD_LAYOUT_FILE, hazardLayoutModule(h.sheet, h.layouts))) changed++;
	printHazards(h);
	console.log(`art:build --only hazards: ${changed} file(s) updated`);
}

/**
 * `--only fortune` (docs/FORTUNE.md FO10): checks the fortune group's files against the lock, then writes ONLY its two
 * sheets (and their art/upload copies), their contact sheets and packs/vale/fortuneLayout.ts, byte for byte what a full
 * build writes for them (pixelsPerTileFrom unchecked). Nothing else is read, written or removed.
 */
function mainOnlyFortune(config) {
	if (!config.fortune) fail("art/atlases.json has no `fortune` group");
	checkLock(config, fortuneSourceFiles(config.fortune));
	const t = buildFortune(config.fortune, config.worldArt, undefined);
	let changed = 0;
	for (const [dir, name, img] of fortuneOutputs(t)) {
		const png = encodePng(img);
		if (writeIfChanged(path.join(dir === "build" ? BUILD : CONTACT, name), png)) changed++;
		if (dir === "build" && writeIfChanged(path.join(UPLOAD, name), png)) changed++;
	}
	if (writeIfChanged(FORTUNE_LAYOUT_FILE, fortuneLayoutModule(t))) changed++;
	printFortune(t);
	console.log(`art:build --only fortune: ${changed} file(s) updated`);
}

// ---------------------------------------------------------------------------------------------
// Kenney decor sheet (docs/KENNEY_DECOR.md KN9, KND8; config key `kenney`)
//
// The reprojected Kenney pieces the decor plan stands on solid decor (study tables, display cases, lecterns, the
// toppled case, dining tables, store stock, the library runner, the library's candle stands): PNGs written by
// scripts/art/kenney/reproject.py into art/vendor/kenney/, packed into ONE sheet of their own (<atlas.name>.png, more
// as <name>-2, ... if it overflows) so there is one upload and the decor atlas never repacks. `kenney`: { atlas: { name,
// maxSize }, pixelsPerTile, pixelsPerTileFrom (optional, checked by a full build), pieces }. A piece is a world image
// (worldArt's noiseAlpha / pad, buildWorldImage): `file` (art/vendor-relative), `pivot` [x, y] in the file's pixels
// (reproject.py's <png>.pivot.json: the footprint's centre on the floor), `outline` (true: the convex hull of its
// opaque pixels, for the footprint fit). Packed by packWorldAtlases' MaxRects (largest first). Outputs:
// art/build/<atlas>.png (also copied to art/upload/), the contact sheet art/build/contact/<atlas>.png, and
// src/shared/theme/packs/vale/kenneyLayout.ts (VALE_KENNEY_LAYOUTS: ValeWorldImageLayout by art name, rect cuts of the
// sheet). Build just this group: node scripts/art/build-atlases.js --only kenney (and --lock --only kenney).

const KENNEY_LAYOUT_FILE = path.join(LAYOUT_DIR, "kenneyLayout.ts");
const KENNEY_GROUP_KEYS = new Set(["$comment", "atlas", "pixelsPerTile", "pixelsPerTileFrom", "pieces"]);
const KENNEY_PIECE_KEYS = new Set(["$comment", "file", "pivot", "outline"]);
const KENNEY_SHEETS_DECL = "export const VALE_KENNEY_SHEETS: ReadonlyArray<string> = ";

/** The kenney group's piece names (no `$` comments), sorted. */
function kenneyPieceNames(group) {
	return Object.keys(group.pieces || {})
		.filter((n) => !n.startsWith("$"))
		.sort();
}

/** Every vendor file the kenney group reads, sorted ([] without a group). */
function kenneySourceFiles(group) {
	if (!group) return [];
	const files = new Set();
	for (const name of kenneyPieceNames(group)) {
		const def = group.pieces[name];
		if (typeof def.file !== "string" || def.file === "") throw new Error(`kenney.pieces.${name} needs a file`);
		files.add(def.file);
	}
	return [...files].sort();
}

/** Builds and packs the kenney sheet: { pieces, atlases, layouts, pixelsPerTileFrom }. `sets`: built sprite sets, or undefined (--only). */
function buildKenney(group, world, sets) {
	for (const k of Object.keys(group)) if (!KENNEY_GROUP_KEYS.has(k)) throw new Error(`kenney: unknown key ${k}`);
	if (!group.atlas || typeof group.atlas.name !== "string" || !(group.atlas.maxSize > 0)) throw new Error("kenney.atlas needs { name, maxSize }");
	const ppt = group.pixelsPerTile;
	if (typeof ppt !== "number" || !(ppt > 0)) throw new Error("kenney.pixelsPerTile must be a positive number");
	if (!world) throw new Error("kenney: needs worldArt (its noiseAlpha / pad)");
	const pixelsPerTileFrom = groupPixelsPerTileFrom("kenney", group, ppt, sets);
	const names = kenneyPieceNames(group);
	if (names.length === 0) throw new Error("kenney: no pieces");
	const pieces = names.map((name) => {
		const def = group.pieces[name];
		for (const k of Object.keys(def)) if (!KENNEY_PIECE_KEYS.has(k)) throw new Error(`kenney.pieces.${name}: unknown key ${k}`);
		if (!Array.isArray(def.pivot)) throw new Error(`kenney.pieces.${name}: pivot must be [x, y] (reproject.py's .pivot.json)`);
		return buildWorldImage(world, name, { file: def.file, pivot: def.pivot, outline: def.outline === true }, ppt, world.pad);
	});
	const packed = packWorldAtlases({ atlas: group.atlas }, pieces);
	const layouts = {};
	for (const p of pieces) layouts[p.name] = worldLayout(p);
	return { pieces, atlases: packed.atlases, layouts, pixelsPerTileFrom };
}

/** kenneyLayout.ts (docs/KENNEY_DECOR.md KN9). */
function kenneyLayoutModule(k) {
	const text = [
		"// GENERATED by `npm run art:build` (scripts/art/build-atlases.js) from art/atlases.json. Do not edit.",
		"",
		"/**",
		comment([
			"Layout of the `vale` pack's Kenney decor sheet (docs/KENNEY_DECOR.md KN9): Kenney's Isometric Library / Dungeon",
			"pieces (CC0) reprojected to the game camera by scripts/art/kenney/reproject.py, packed into one sheet of their own",
			"(art/atlases.json `kenney`). Every piece is a world image (`rect` cut of the sheet, `pivot` the footprint's centre",
			"on the floor, `outline` the convex hull of its opaque pixels for the footprint fit), by art name; packs/vale",
			"manifest.ts maps the decor IDs onto them. No asset IDs: `file` names the PNG in art/build/ to upload.",
		]),
		" */",
		"",
		'import type { ValeWorldImageLayout } from "./layout";',
		"",
		`${KENNEY_SHEETS_DECL}${tsValue(k.atlases.map((a) => a.file), 0, KENNEY_SHEETS_DECL.length)};`,
		"",
		`export const VALE_KENNEY_LAYOUTS: Record<string, ValeWorldImageLayout> = ${tsValue(k.layouts, 0, PRINT_WIDTH)};`,
		"",
	].join("\n");
	for (const line of text.split("\n")) {
		if (line.replace(/\t/g, "    ").length > PRINT_WIDTH) throw new Error(`kenneyLayout.ts line over ${PRINT_WIDTH} columns: ${line}`);
	}
	return text;
}

/** Every output of the kenney group: [dir, name, img] (each sheet, and its contact sheet: every piece, pivot, outline). */
function kenneyOutputs(k) {
	const out = [];
	for (const a of k.atlases) out.push(["build", a.file, a.img]);
	for (const a of k.atlases) {
		const parts = a.items.map((p) => worldContact(p));
		const w = Math.max(...parts.map((c) => c.w));
		const h = parts.reduce((n, c) => n + c.h, 0);
		const img = raster(w, h);
		fillRect(img, 0, 0, w, h, [CONTACT_BG, CONTACT_BG, CONTACT_BG]);
		let y = 0;
		for (const c of parts) {
			blit(c, 0, 0, c.w, c.h, img, 0, y, 0);
			y += c.h;
		}
		out.push(["contact", a.file, img]);
	}
	return out;
}

/** Log lines for the built kenney sheet. */
function printKenney(k) {
	const from = k.pixelsPerTileFrom ? ` (pixelsPerTileFrom ${k.pixelsPerTileFrom.id}: ${k.pixelsPerTileFrom.checked ? "equal" : "unchecked, its set is not built by --only"})` : "";
	console.log(`kenney: ${k.pieces.length} pieces${from}`);
	for (const a of k.atlases) console.log(`  ${a.file}: ${a.img.w}x${a.img.h}, ${a.items.length} piece(s)`);
	for (const name of Object.keys(k.layouts)) {
		const l = k.layouts[name];
		console.log(`  ${name}: rect ${l.rect.x},${l.rect.y} ${l.rect.w}x${l.rect.h}, pivot (${l.pivot.x}, ${l.pivot.y})${l.outline ? `, outline ${l.outline.length} pts` : ""}`);
	}
}

/**
 * `--only kenney` (docs/KENNEY_DECOR.md KN9): checks the kenney group's files against the lock, then writes ONLY its
 * sheet(s) (and their art/upload copies), their contact sheets and packs/vale/kenneyLayout.ts, byte for byte what a full
 * build writes for them (pixelsPerTileFrom unchecked). Nothing else is read, written or removed.
 */
function mainOnlyKenney(config) {
	if (!config.kenney) fail("art/atlases.json has no `kenney` group");
	checkLock(config, kenneySourceFiles(config.kenney));
	const k = buildKenney(config.kenney, config.worldArt, undefined);
	let changed = 0;
	for (const [dir, name, img] of kenneyOutputs(k)) {
		const png = encodePng(img);
		if (writeIfChanged(path.join(dir === "build" ? BUILD : CONTACT, name), png)) changed++;
		if (dir === "build" && writeIfChanged(path.join(UPLOAD, name), png)) changed++;
	}
	if (writeIfChanged(KENNEY_LAYOUT_FILE, kenneyLayoutModule(k))) changed++;
	printKenney(k);
	console.log(`art:build --only kenney: ${changed} file(s) updated`);
}

// ---------------------------------------------------------------------------------------------
// Fortune sheets (docs/FORTUNE.md FO10; config key `fortune`)
//
// The pact altar and the Goldling's coin burst: original pixel art drawn by scripts/art/gen-fortune-art.js (art:build and
// art:lock run it first) into art/vendor/kaleb-vale/, each in a sheet of its own, so adding them never repacks the decor
// or effects atlas. The treasure group's shape: `fortune`: { pixelsPerTile, pixelsPerTileFrom (optional, checked by a
// full build), altar, coin }.
//   altar  a world sprite set (the worldArt piece keys: facings (default one), animations, pivot, own; cleaned and cut by
//          buildWorldSprites with worldArt's noiseAlpha / pad): its cells in one row of <own>.png; `resample` (optional,
//          default "Default") is written into its layout.
//   coin   an effect strip (the fx set keys: file, frameW, frames, fps, loop, grey; buildFxSet with `pad`) alone in
//          <atlas>.png (packFx).
// Outputs: art/build/<own>.png and <atlas>.png (also copied to art/upload/), contact sheets art/build/contact/
// pact.altar.png / fx.golden.coin.png, and src/shared/theme/packs/vale/fortuneLayout.ts (VALE_PACT_ALTAR_LAYOUT,
// VALE_FORTUNE_FX_SHEET, VALE_FORTUNE_FX_LAYOUTS). Build just this group: node scripts/art/build-atlases.js --only
// fortune (and --lock --only fortune).

const FORTUNE_ALTAR_ID = "pact.altar";
const FORTUNE_COIN_ID = "fx.golden.coin";
const FORTUNE_GROUP_KEYS = new Set(["$comment", "pixelsPerTile", "pixelsPerTileFrom", "altar", "coin"]);
const FORTUNE_ALTAR_KEYS = new Set(["$comment", "facings", "animations", "pivot", "own", "resample"]);
const FORTUNE_COIN_KEYS = new Set(["$comment", "atlas", "pad", "file", "frameW", "frames", "fps", "loop", "grey"]);

/** Every vendor file the fortune group reads, sorted ([] without a group). */
function fortuneSourceFiles(group) {
	if (!group) return [];
	const files = new Set();
	const altar = group.altar;
	if (!altar || !altar.animations) throw new Error("fortune.altar needs animations");
	for (const fc of pieceFacings(FORTUNE_ALTAR_ID, altar)) {
		for (const a of Object.values(altar.animations)) for (const f of a.frames) files.add(expandFile(a.file, fc.dir, fc.angle, f));
	}
	if (!group.coin || typeof group.coin.file !== "string" || group.coin.file === "") throw new Error("fortune.coin needs a file");
	files.add(group.coin.file);
	return [...files].sort();
}

/**
 * Builds the fortune sheets: { altar: { piece, layout, file, img }, coin: { set, packed, sheet, layout },
 * pixelsPerTileFrom }. `world` is the worldArt group (cleaning and pad); `spriteSets` as for buildGoo.
 */
function buildFortune(group, world, spriteSets) {
	if (group === null || typeof group !== "object" || Array.isArray(group)) throw new Error("fortune must be an object");
	for (const k of Object.keys(group)) if (!FORTUNE_GROUP_KEYS.has(k)) throw new Error(`fortune: unknown key ${k}`);
	if (!world) throw new Error("fortune needs the worldArt group (its cleaning and pad)");
	const ppt = group.pixelsPerTile;
	if (typeof ppt !== "number" || !(ppt > 0)) throw new Error("fortune.pixelsPerTile must be a positive number");
	const pixelsPerTileFrom = groupPixelsPerTileFrom("fortune", group, ppt, spriteSets);
	// the altar: a world sprite set alone in its own sheet, one row of cells
	const adef = group.altar;
	for (const k of Object.keys(adef)) if (!FORTUNE_ALTAR_KEYS.has(k)) throw new Error(`${FORTUNE_ALTAR_ID}: unknown key ${k}`);
	if (typeof adef.own !== "string" || !/^[a-z0-9-]+$/.test(adef.own)) throw new Error(`${FORTUNE_ALTAR_ID}: own must be a file name without .png`);
	const resample = adef.resample === undefined ? "Default" : adef.resample;
	if (!RESAMPLE_MODES.includes(resample)) throw new Error(`${FORTUNE_ALTAR_ID}: resample must be one of ${RESAMPLE_MODES.join(", ")}`);
	const piece = buildWorldSprites(world, FORTUNE_ALTAR_ID, adef, ppt, world.pad);
	if (piece.cells.length * piece.frameW > MAX_ATLAS) throw new Error(`${FORTUNE_ALTAR_ID}: ${piece.cells.length} cells of ${piece.frameW} px do not fit one row`);
	const altarImg = raster(piece.cells.length * piece.frameW, piece.frameH);
	piece.cells.forEach((c, k) => blit(c.img, 0, 0, piece.frameW, piece.frameH, altarImg, k * piece.frameW, 0, 0));
	alphaBleed(altarImg);
	const altarFile = `${adef.own}.png`;
	piece.atlas = { file: altarFile, img: altarImg };
	piece.startCell = 0;
	piece.perRow = piece.cells.length;
	const altarLayout = { ...worldLayout(piece), resample };
	// the coin burst: an effect strip alone in its own sheet
	const cdef = group.coin;
	for (const k of Object.keys(cdef)) if (!FORTUNE_COIN_KEYS.has(k)) throw new Error(`${FORTUNE_COIN_ID}: unknown key ${k}`);
	if (typeof cdef.atlas !== "string" || !/^[a-z0-9-]+$/.test(cdef.atlas)) throw new Error(`${FORTUNE_COIN_ID}: atlas must be a file name without .png`);
	if (`${cdef.atlas}.png` === altarFile) throw new Error(`fortune: the altar and the coin burst cannot share ${altarFile}`);
	const pad = cdef.pad === undefined ? 0 : cdef.pad;
	if (!Number.isInteger(pad) || pad < 0) throw new Error(`${FORTUNE_COIN_ID}: pad must be a non-negative integer`);
	if (typeof cdef.fps !== "number" || !(cdef.fps > 0)) throw new Error(`${FORTUNE_COIN_ID}: fps must be a positive number`);
	const set = buildFxSet(FORTUNE_COIN_ID, cdef, pad);
	const packed = packFx([set], "fortune");
	const coinLayout = fxLayoutOf(packed.placed[0]);
	const sheet = { file: `${cdef.atlas}.png`, w: packed.w, h: packed.h };
	return { altar: { piece, layout: altarLayout, file: altarFile, img: altarImg }, coin: { set, packed, sheet, layout: coinLayout }, pixelsPerTileFrom };
}

/** packs/vale/fortuneLayout.ts: VALE_PACT_ALTAR_LAYOUT, VALE_FORTUNE_FX_SHEET, VALE_FORTUNE_FX_LAYOUTS. */
function fortuneLayoutModule(t) {
	const text = [
		"// GENERATED by `npm run art:build` (scripts/art/build-atlases.js) from art/atlases.json. Do not edit.",
		"",
		"/**",
		comment([
			"Layout of the `vale` pack's Fortune art (docs/FORTUNE.md FO10): original pixel art by scripts/art/gen-fortune-art.js,",
			"each in a sheet of its own. VALE_PACT_ALTAR_LAYOUT is `pact.altar`, a world sprite set (one facing: the altar is",
			"round; `idle`); VALE_FORTUNE_FX_SHEET / VALE_FORTUNE_FX_LAYOUTS hold `fx.golden.coin`, a greyscale effect flipbook",
			"(cells `start + f` of the SpriteSetAsset formula, perRow = floor(sheet w / frameW)) tinted at draw time. No asset",
			"IDs: `file` names the PNG in art/build/ to upload.",
		]),
		" */",
		"",
		'import type { ValeFxLayout } from "./fxLayout";',
		'import type { ValeSheetFile, ValeWorldSpriteLayout } from "./layout";',
		"",
		`export const VALE_PACT_ALTAR_LAYOUT: ValeWorldSpriteLayout = ${tsValue(t.altar.layout, 0, PRINT_WIDTH)};`,
		"",
		`export const VALE_FORTUNE_FX_SHEET: ValeSheetFile = ${tsValue(t.coin.sheet, 0, PRINT_WIDTH)};`,
		"",
		`export const VALE_FORTUNE_FX_LAYOUTS: Record<string, ValeFxLayout> = ${tsValue({ [FORTUNE_COIN_ID]: t.coin.layout }, 0, PRINT_WIDTH)};`,
		"",
	].join("\n");
	for (const line of text.split("\n")) {
		if (line.replace(/\t/g, "    ").length > PRINT_WIDTH) throw new Error(`fortuneLayout.ts line over ${PRINT_WIDTH} columns: ${line}`);
	}
	return text;
}

/** The coin burst's contact sheet: every frame read back through its layout. */
function fortuneCoinContact(t) {
	const l = t.coin.layout;
	const cells = [];
	for (let f = 0; f < l.frames; f++) cells.push([t.coin.packed.img, ...fxCellAt(t.coin.packed.w, l, f)]);
	return scaledContact(cells, l.frameW, l.frameH, l.pivot);
}

/** Every output of the fortune group: [dir, name, img]. */
function fortuneOutputs(t) {
	return [
		["build", t.altar.file, t.altar.img],
		["build", t.coin.sheet.file, t.coin.packed.img],
		["contact", `${FORTUNE_ALTAR_ID}.png`, worldContact(t.altar.piece)],
		["contact", `${FORTUNE_COIN_ID}.png`, fortuneCoinContact(t)],
	];
}

/** Log lines for the built fortune sheets. */
function printFortune(t) {
	const a = t.altar.layout;
	const l = t.coin.layout;
	const from = t.pixelsPerTileFrom ? ` (pixelsPerTileFrom ${t.pixelsPerTileFrom.id}: ${t.pixelsPerTileFrom.checked ? "equal" : "unchecked, its set is not built by --only"})` : "";
	console.log(`fortune: ${a.pixelsPerTile} px/tile${from}`);
	console.log(`  ${FORTUNE_ALTAR_ID}: ${t.altar.file} ${t.altar.img.w}x${t.altar.img.h}, cells ${a.frameW}x${a.frameH} x ${t.altar.piece.cells.length} (${t.altar.piece.dirs.join(" ")}), pivot (${a.pivot.x}, ${a.pivot.y}), ${a.resample}`);
	console.log(`  ${FORTUNE_COIN_ID}: ${t.coin.sheet.file} ${t.coin.sheet.w}x${t.coin.sheet.h}, cell ${l.frameW}x${l.frameH}, ${l.frames} frames @ ${l.fps} fps${l.loop ? " loop" : ""}, ${l.grey ? "grey" : `mean ${l.meanColor}`}`);
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
 * outline sheet, if any) and a contact sheet per set, then the images (a sliced one followed by its sliceContact).
 * Everything else in art/build is stale.
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
	for (const i of images) {
		out.push({ dir: "build", name: i.layout.file, img: i.img });
		if (i.layout.slice) out.push({ dir: "contact", name: `${i.id}.png`, img: sliceContact(i) });
	}
	return out;
}

/**
 * `--only <group>` from argv: undefined (a full build), a group the scoped build knows (ONLY_GROUPS), or the id of one
 * sprite set in `spriteSets` (art/atlases.json `spriteSets`; e.g. `--only class.ranger`, mainOnlySpriteSet).
 */
function onlyGroup(argv, spriteSets) {
	const i = argv.indexOf("--only");
	if (i < 0) return undefined;
	const g = argv[i + 1];
	if (ONLY_GROUPS.includes(g)) return g;
	if (spriteSets && typeof g === "string" && Object.prototype.hasOwnProperty.call(spriteSets, g)) return g;
	fail(`--only takes one of ${ONLY_GROUPS.join(", ")} or a sprite set id, got ${JSON.stringify(g)}`);
}

/** True when `only` (onlyGroup's result) names a sprite set rather than a group. */
function isOnlySpriteSet(only) {
	return only !== undefined && !ONLY_GROUPS.includes(only);
}

/** Groups `--only` can build on their own (their sources need no other pack). */
const ONLY_GROUPS = [
	"bullets",
	"goo",
	"boostAuras",
	"treasure",
	"hazards",
	"fortune",
	"boonIcons",
	"itemIcons",
	"boostIcons",
	"pipIcons",
	"duoIcons",
	"kenney",
];

/** The vendor files `--lock --only <group>` re-hashes (a sprite set id: that set's own files, not its pixelsPerTileFrom's). */
function onlyGroupSourceFiles(config, group) {
	if (isOnlySpriteSet(group)) return spriteSetSourceFiles(config.spriteSets, group);
	if (group === "bullets") return bulletSourceFiles(config.bullets);
	if (group === "goo") {
		if (!config.goo) fail("art/atlases.json has no `goo` group");
		return gooSourceFiles(config.goo);
	}
	if (group === "boostAuras") {
		if (!config.boostAuras) fail("art/atlases.json has no `boostAuras` group");
		return boostAuraSourceFiles(config.boostAuras);
	}
	if (group === "treasure") {
		if (!config.treasure) fail("art/atlases.json has no `treasure` group");
		return treasureSourceFiles(config.treasure);
	}
	if (group === "hazards") {
		if (!config.hazards) fail("art/atlases.json has no `hazards` group");
		return hazardSourceFiles(config.hazards);
	}
	if (group === "fortune") {
		if (!config.fortune) fail("art/atlases.json has no `fortune` group");
		return fortuneSourceFiles(config.fortune);
	}
	if (group === "boonIcons") {
		if (!config.boonIcons) fail("art/atlases.json has no `boonIcons` group");
		return boonIconSourceFiles(config.boonIcons);
	}
	if (group === "itemIcons") {
		if (!config.itemIcons) fail("art/atlases.json has no `itemIcons` group");
		return itemIconSourceFiles(config.itemIcons);
	}
	if (group === "boostIcons") {
		if (!config.boostIcons) fail("art/atlases.json has no `boostIcons` group");
		return boostIconSourceFiles(config.boostIcons);
	}
	if (group === "pipIcons") {
		if (!config.pipIcons) fail("art/atlases.json has no `pipIcons` group");
		return pipIconSourceFiles(config.pipIcons);
	}
	if (group === "duoIcons") {
		if (!config.duoIcons) fail("art/atlases.json has no `duoIcons` group");
		return duoIconSourceFiles(config.duoIcons);
	}
	if (group === "kenney") {
		if (!config.kenney) fail("art/atlases.json has no `kenney` group");
		return kenneySourceFiles(config.kenney);
	}
	throw new Error(`no --only group ${group}`);
}

/**
 * `--only bullets`: checks the bullet group's files against the lock, then writes ONLY art/build/<atlas>.png (and its
 * art/upload copy), art/build/contact/<atlas>.png and packs/vale/bulletLayout.ts, byte for byte what a full build
 * writes for them (pixelsPerTileFrom unchecked). Nothing else is read, written or removed.
 */
function mainOnlyBullets(config) {
	if (!config.bullets) fail("art/atlases.json has no `bullets` group");
	checkLock(config, bulletSourceFiles(config.bullets));
	const bullets = buildBullets(config.bullets, undefined);
	let changed = 0;
	const png = encodePng(bullets.packed.img);
	if (writeIfChanged(path.join(BUILD, bullets.file), png)) changed++;
	if (writeIfChanged(path.join(CONTACT, bullets.file), encodePng(bulletContact(bullets)))) changed++;
	if (writeIfChanged(path.join(UPLOAD, bullets.file), png)) changed++;
	if (writeIfChanged(BULLET_LAYOUT_FILE, bulletLayoutModule(bullets.sheet, bullets.layouts, bullets.fxLayouts))) changed++;
	printBullets(bullets, config.bullets);
	console.log(`art:build --only bullets: ${changed} file(s) updated`);
}

/**
 * `--only goo` (docs/GOO_ART.md GA1): checks the goo group's file against the lock, then writes ONLY
 * art/build/<atlas>.png (and its art/upload copy), art/build/contact/<atlas>.png and packs/vale/gooLayout.ts, byte for
 * byte what a full build writes for them (pixelsPerTileFrom unchecked). Nothing else is read, written or removed.
 */
function mainOnlyGoo(config) {
	if (!config.goo) fail("art/atlases.json has no `goo` group");
	checkLock(config, gooSourceFiles(config.goo));
	const goo = buildGoo(config.goo, undefined);
	let changed = 0;
	const png = encodePng(goo.img);
	if (writeIfChanged(path.join(BUILD, goo.file), png)) changed++;
	if (writeIfChanged(path.join(CONTACT, goo.file), encodePng(gooContact(goo)))) changed++;
	if (writeIfChanged(path.join(UPLOAD, goo.file), png)) changed++;
	if (writeIfChanged(GOO_LAYOUT_FILE, gooLayoutModule(goo.sheet, goo.layout))) changed++;
	printGoo(goo, config.goo);
	console.log(`art:build --only goo: ${changed} file(s) updated`);
}

/**
 * `--only boostAuras` (docs/BOOST_ART.md BAD3): checks the aura frames against the lock, then writes ONLY
 * art/build/<atlas>.png (and its art/upload copy), art/build/contact/<atlas>.png and packs/vale/boostAuraLayout.ts, byte
 * for byte what a full build writes for them (pixelsPerTileFrom unchecked). Nothing else is read, written or removed.
 */
function mainOnlyBoostAuras(config) {
	if (!config.boostAuras) fail("art/atlases.json has no `boostAuras` group");
	checkLock(config, boostAuraSourceFiles(config.boostAuras));
	const auras = buildBoostAuras(config.boostAuras, undefined);
	let changed = 0;
	const png = encodePng(auras.packed.img);
	if (writeIfChanged(path.join(BUILD, auras.file), png)) changed++;
	if (writeIfChanged(path.join(CONTACT, auras.file), encodePng(boostAuraContact(auras)))) changed++;
	if (writeIfChanged(path.join(UPLOAD, auras.file), png)) changed++;
	if (writeIfChanged(BOOST_AURA_LAYOUT_FILE, boostAuraLayoutModule(auras.sheet, auras.layouts))) changed++;
	printBoostAuras(auras, config.boostAuras);
	console.log(`art:build --only boostAuras: ${changed} file(s) updated`);
}

/**
 * `--only treasure` (docs/TREASURE.md TR9): checks the treasure group's files against the lock, then writes ONLY its two
 * sheets (and their art/upload copies), their contact sheets and packs/vale/treasureLayout.ts, byte for byte what a
 * full build writes for them (pixelsPerTileFrom unchecked). Nothing else is read, written or removed.
 */
function mainOnlyTreasure(config) {
	if (!config.treasure) fail("art/atlases.json has no `treasure` group");
	checkLock(config, treasureSourceFiles(config.treasure));
	const t = buildTreasure(config.treasure, config.worldArt, undefined);
	let changed = 0;
	for (const [dir, name, img] of treasureOutputs(t)) {
		const png = encodePng(img);
		if (writeIfChanged(path.join(dir === "build" ? BUILD : CONTACT, name), png)) changed++;
		if (dir === "build" && writeIfChanged(path.join(UPLOAD, name), png)) changed++;
	}
	if (writeIfChanged(TREASURE_LAYOUT_FILE, treasureLayoutModule(t))) changed++;
	printTreasure(t);
	console.log(`art:build --only treasure: ${changed} file(s) updated`);
}

/**
 * `--only boonIcons` (docs/BUILDS.md BU11): checks the boon icons against the lock, then writes ONLY
 * art/build/<atlas>.png (and its art/upload copy), art/build/contact/<atlas>.png and packs/vale/boonIconLayout.ts, byte
 * for byte what a full build writes for them. Nothing else is read, written or removed.
 */
function mainOnlyBoonIcons(config) {
	if (!config.boonIcons) fail("art/atlases.json has no `boonIcons` group");
	checkLock(config, boonIconSourceFiles(config.boonIcons));
	const icons = buildBoonIcons(config.boonIcons);
	let changed = 0;
	const png = encodePng(icons.img);
	if (writeIfChanged(path.join(BUILD, icons.file), png)) changed++;
	if (writeIfChanged(path.join(CONTACT, icons.file), encodePng(uiIconContact(icons)))) changed++;
	if (writeIfChanged(path.join(UPLOAD, icons.file), png)) changed++;
	if (writeIfChanged(BOON_ICON_LAYOUT_FILE, boonIconLayoutModule(icons))) changed++;
	printBoonIcons(icons);
	console.log(`art:build --only boonIcons: ${changed} file(s) updated`);
}

/**
 * `--only itemIcons` (docs/BUILDS.md BU11): checks the relic and curse icons against the lock, then writes ONLY
 * art/build/<atlas>.png (and its art/upload copy), art/build/contact/<atlas>.png and packs/vale/itemIconLayout.ts, byte
 * for byte what a full build writes for them. Nothing else is read, written or removed.
 */
function mainOnlyItemIcons(config) {
	if (!config.itemIcons) fail("art/atlases.json has no `itemIcons` group");
	checkLock(config, itemIconSourceFiles(config.itemIcons));
	const icons = buildItemIcons(config.itemIcons);
	let changed = 0;
	const png = encodePng(icons.img);
	if (writeIfChanged(path.join(BUILD, icons.file), png)) changed++;
	if (writeIfChanged(path.join(CONTACT, icons.file), encodePng(uiIconContact(icons)))) changed++;
	if (writeIfChanged(path.join(UPLOAD, icons.file), png)) changed++;
	if (writeIfChanged(ITEM_ICON_LAYOUT_FILE, itemIconLayoutModule(icons))) changed++;
	printItemIcons(icons);
	console.log(`art:build --only itemIcons: ${changed} file(s) updated`);
}

/**
 * `--only boostIcons` (docs/BOOSTS.md B7): checks the boost icons against the lock, then writes ONLY
 * art/build/<atlas>.png (and its art/upload copy), art/build/contact/<atlas>.png and packs/vale/boostIconLayout.ts, byte
 * for byte what a full build writes for them. Nothing else is read, written or removed.
 */
function mainOnlyBoostIcons(config) {
	if (!config.boostIcons) fail("art/atlases.json has no `boostIcons` group");
	checkLock(config, boostIconSourceFiles(config.boostIcons));
	const icons = buildBoostIcons(config.boostIcons);
	let changed = 0;
	const png = encodePng(icons.img);
	if (writeIfChanged(path.join(BUILD, icons.file), png)) changed++;
	if (writeIfChanged(path.join(CONTACT, icons.file), encodePng(uiIconContact(icons)))) changed++;
	if (writeIfChanged(path.join(UPLOAD, icons.file), png)) changed++;
	if (writeIfChanged(BOOST_ICON_LAYOUT_FILE, boostIconLayoutModule(icons))) changed++;
	printBoostIcons(icons);
	console.log(`art:build --only boostIcons: ${changed} file(s) updated`);
}

/**
 * `--only pipIcons` (docs/UI_ART.md "As built: armor pips"): checks the pip icons against the lock, then writes ONLY
 * art/build/<atlas>.png (and its art/upload copy), art/build/contact/<atlas>.png and packs/vale/pipIconLayout.ts, byte
 * for byte what a full build writes for them. Nothing else is read, written or removed.
 */
function mainOnlyPipIcons(config) {
	if (!config.pipIcons) fail("art/atlases.json has no `pipIcons` group");
	checkLock(config, pipIconSourceFiles(config.pipIcons));
	const icons = buildPipIcons(config.pipIcons);
	let changed = 0;
	const png = encodePng(icons.img);
	if (writeIfChanged(path.join(BUILD, icons.file), png)) changed++;
	if (writeIfChanged(path.join(CONTACT, icons.file), encodePng(uiIconContact(icons)))) changed++;
	if (writeIfChanged(path.join(UPLOAD, icons.file), png)) changed++;
	if (writeIfChanged(PIP_ICON_LAYOUT_FILE, pipIconLayoutModule(icons))) changed++;
	printPipIcons(icons);
	console.log(`art:build --only pipIcons: ${changed} file(s) updated`);
}

/**
 * `--only duoIcons` (docs/BUILDS.md BU11, the duo part): checks the duo icons against the lock, then writes ONLY
 * art/build/<atlas>.png (and its art/upload copy), art/build/contact/<atlas>.png and packs/vale/duoIconLayout.ts, byte
 * for byte what a full build writes for them. Nothing else is read, written or removed.
 */
function mainOnlyDuoIcons(config) {
	if (!config.duoIcons) fail("art/atlases.json has no `duoIcons` group");
	checkLock(config, duoIconSourceFiles(config.duoIcons));
	const icons = buildDuoIcons(config.duoIcons);
	let changed = 0;
	const png = encodePng(icons.img);
	if (writeIfChanged(path.join(BUILD, icons.file), png)) changed++;
	if (writeIfChanged(path.join(CONTACT, icons.file), encodePng(uiIconContact(icons)))) changed++;
	if (writeIfChanged(path.join(UPLOAD, icons.file), png)) changed++;
	if (writeIfChanged(DUO_ICON_LAYOUT_FILE, duoIconLayoutModule(icons))) changed++;
	printDuoIcons(icons);
	console.log(`art:build --only duoIcons: ${changed} file(s) updated`);
}

/** Log lines for a built sprite set (cell, pivot, density, sheets, outline clip). */
function printSpriteSet(s) {
	const l = s.layout;
	console.log(`${s.id}: cell ${l.frameW}x${l.frameH} (source box ${s.box.join(",")}${s.downscale > 1 ? `, downscale ${s.downscale}` : ""}), pivot (${l.pivot.x}, ${l.pivot.y}), body ${s.bodyHeight} px -> ${l.pixelsPerTile} px/tile${s.pixelsPerTileFrom ? ` (from ${s.pixelsPerTileFrom})` : ""}${s.recolorStops ? `, recoloured (${s.recolorStops}-stop ramp)` : ""}`);
	console.log(`  pivot per facing (cell coords) on the measured frame: ${s.sanity.join(" ")}`);
	for (const sh of s.sheets) {
		const own = sh.cell ? `, cell ${sh.cell.frameW}x${sh.cell.frameH} pivot (${sh.cell.pivot.x}, ${sh.cell.pivot.y})` : "";
		console.log(`  ${sh.file}: ${sh.img.w}x${sh.img.h}, ${sh.cells} cells${own}${sh.outlineFile ? ` + ${sh.outlineFile} (outline ${s.outline.widthPx} px)` : ""}${
			sh.rimClip ? `, rim clipped at the cell edge in ${sh.rimClip.cells} cells (${sh.rimClip.pixels} body px)` : ""
		}`);
	}
}

/**
 * Builds sprite set `id` of `spriteSets` alone: the set and the sets its pixelsPerTileFrom chain names (built to read
 * their pixelsPerTile, never written), in build order. Returns { set: the result for `id`, chain: every id built }.
 */
function buildOneSpriteSet(spriteSets, id) {
	const chain = spriteSetChain(spriteSets, id);
	const built = new Map();
	for (const sid of chain) built.set(sid, buildSpriteSet(sid, spriteSets[sid], built));
	return { set: built.get(id), chain };
}

/**
 * Every PNG `--only <set id>` writes for a built sprite set, as buildOutputs does for it in a full build: each sheet
 * (followed by its outline sheet) into art/build (and art/upload), and its contact sheet. [{ dir, name, img }].
 */
function spriteSetOutputs(s) {
	return buildOutputs([s], []);
}

/**
 * `--only <sprite set id>` (docs/ARCHER.md AR12: `--only class.ranger`): checks the files of the set and of its
 * pixelsPerTileFrom chain against the lock, builds them, then writes ONLY the set's sheets and outline sheets (and their
 * art/upload copies), its contact sheet art/build/contact/<id>.png and its entry in packs/vale/layout.ts (merged:
 * mergeSpriteLayout, every other byte of the file unchanged), byte for byte what a full build writes for them. The sets
 * of the chain (class.ranger's class.vanguard) are built to read their pixelsPerTile but not written; nothing else is
 * read, written or removed (no stale-file sweep).
 */
function mainOnlySpriteSet(config, id) {
	const chain = spriteSetChain(config.spriteSets, id);
	const files = new Set();
	for (const sid of chain) addSpriteSetFiles(files, sid, config.spriteSets[sid]);
	checkLock(config, [...files].sort());
	const { set } = buildOneSpriteSet(config.spriteSets, id);
	if (!fs.existsSync(LAYOUT_FILE)) fail(`--only ${id} merges into an existing ${path.relative(ROOT, LAYOUT_FILE)}; run a full art:build first`);
	let changed = 0;
	const written = [];
	for (const o of spriteSetOutputs(set)) {
		const png = encodePng(o.img);
		if (writeIfChanged(path.join(o.dir === "build" ? BUILD : CONTACT, o.name), png)) changed++;
		if (o.dir === "build") {
			written.push(o.name);
			if (writeIfChanged(path.join(UPLOAD, o.name), png)) changed++;
		}
	}
	if (writeIfChanged(LAYOUT_FILE, mergeSpriteLayout(fs.readFileSync(LAYOUT_FILE, "utf8"), id, set.layout))) changed++;
	printSpriteSet(set);
	console.log(`art:build --only ${id}: ${changed} file(s) updated${chain.length > 1 ? ` (built ${chain.filter((c) => c !== id).join(", ")} for pixelsPerTileFrom, not written)` : ""}`);
	const uploaded = uploadedFiles();
	const pending = written.filter((f) => !uploaded.has(f));
	console.log(`art:build --only ${id}: ${pending.length} of its ${written.length} PNG(s) still need an ID in packs/vale/assetIds.ts${pending.length > 0 ? ":" : ""}`);
	for (const f of pending) console.log(`  ${f}  (${fs.statSync(path.join(BUILD, f)).size} bytes)`);
}

function main() {
	const config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
	const only = onlyGroup(process.argv, config.spriteSets);
	if (process.argv.includes("--lock")) {
		writeLock(config, only ? onlyGroupSourceFiles(config, only) : undefined);
		return;
	}
	if (isOnlySpriteSet(only)) {
		mainOnlySpriteSet(config, only);
		return;
	}
	if (only === "bullets") {
		mainOnlyBullets(config);
		return;
	}
	if (only === "goo") {
		mainOnlyGoo(config);
		return;
	}
	if (only === "boostAuras") {
		mainOnlyBoostAuras(config);
		return;
	}
	if (only === "treasure") {
		mainOnlyTreasure(config);
		return;
	}
	if (only === "hazards") {
		mainOnlyHazards(config);
		return;
	}
	if (only === "fortune") {
		mainOnlyFortune(config);
		return;
	}
	if (only === "boonIcons") {
		mainOnlyBoonIcons(config);
		return;
	}
	if (only === "itemIcons") {
		mainOnlyItemIcons(config);
		return;
	}
	if (only === "boostIcons") {
		mainOnlyBoostIcons(config);
		return;
	}
	if (only === "pipIcons") {
		mainOnlyPipIcons(config);
		return;
	}
	if (only === "duoIcons") {
		mainOnlyDuoIcons(config);
		return;
	}
	if (only === "kenney") {
		mainOnlyKenney(config);
		return;
	}
	checkLock(config);

	const sets = buildSpriteSets(config.spriteSets);
	const images = buildImages(config.images, sets);
	const floor = images.find((i) => i.id === FLOOR_IMAGE_ID);
	if (!floor || !floor.meanHex) throw new Error(`no ${FLOOR_IMAGE_ID} image with meanHex (VALE_FLOOR_HEX)`);

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
	let icons;
	if (config.uiIcons) {
		icons = buildUiIcons(config.uiIcons);
		emit(BUILD, icons.file, icons.img, builtFiles);
		emit(CONTACT, icons.file, uiIconContact(icons), contactFiles);
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
	let bullets;
	if (config.bullets) {
		bullets = buildBullets(config.bullets, sets);
		emit(BUILD, bullets.file, bullets.packed.img, builtFiles);
		emit(CONTACT, bullets.file, bulletContact(bullets), contactFiles);
	}
	let goo;
	if (config.goo) {
		goo = buildGoo(config.goo, sets);
		emit(BUILD, goo.file, goo.img, builtFiles);
		emit(CONTACT, goo.file, gooContact(goo), contactFiles);
	}
	let auras;
	if (config.boostAuras) {
		auras = buildBoostAuras(config.boostAuras, sets);
		emit(BUILD, auras.file, auras.packed.img, builtFiles);
		emit(CONTACT, auras.file, boostAuraContact(auras), contactFiles);
	}
	let treasure;
	if (config.treasure) {
		treasure = buildTreasure(config.treasure, config.worldArt, sets);
		for (const [dir, name, img] of treasureOutputs(treasure)) emit(dir === "build" ? BUILD : CONTACT, name, img, dir === "build" ? builtFiles : contactFiles);
	}
	let hazards;
	if (config.hazards) {
		hazards = buildHazards(config.hazards, sets);
		emit(BUILD, hazards.file, hazards.packed.img, builtFiles);
		emit(CONTACT, hazards.file, hazardContact(hazards), contactFiles);
	}
	let fortune;
	if (config.fortune) {
		fortune = buildFortune(config.fortune, config.worldArt, sets);
		for (const [dir, name, img] of fortuneOutputs(fortune)) emit(dir === "build" ? BUILD : CONTACT, name, img, dir === "build" ? builtFiles : contactFiles);
	}
	let boonIcons;
	if (config.boonIcons) {
		boonIcons = buildBoonIcons(config.boonIcons);
		emit(BUILD, boonIcons.file, boonIcons.img, builtFiles);
		emit(CONTACT, boonIcons.file, uiIconContact(boonIcons), contactFiles);
	}
	let itemIcons;
	if (config.itemIcons) {
		itemIcons = buildItemIcons(config.itemIcons);
		emit(BUILD, itemIcons.file, itemIcons.img, builtFiles);
		emit(CONTACT, itemIcons.file, uiIconContact(itemIcons), contactFiles);
	}
	let boostIcons;
	if (config.boostIcons) {
		boostIcons = buildBoostIcons(config.boostIcons);
		emit(BUILD, boostIcons.file, boostIcons.img, builtFiles);
		emit(CONTACT, boostIcons.file, uiIconContact(boostIcons), contactFiles);
	}
	let pipIcons;
	if (config.pipIcons) {
		pipIcons = buildPipIcons(config.pipIcons);
		emit(BUILD, pipIcons.file, pipIcons.img, builtFiles);
		emit(CONTACT, pipIcons.file, uiIconContact(pipIcons), contactFiles);
	}
	let duoIcons;
	if (config.duoIcons) {
		duoIcons = buildDuoIcons(config.duoIcons);
		emit(BUILD, duoIcons.file, duoIcons.img, builtFiles);
		emit(CONTACT, duoIcons.file, uiIconContact(duoIcons), contactFiles);
	}
	let kenney;
	if (config.kenney) {
		kenney = buildKenney(config.kenney, config.worldArt, sets);
		for (const [dir, name, img] of kenneyOutputs(kenney)) emit(dir === "build" ? BUILD : CONTACT, name, img, dir === "build" ? builtFiles : contactFiles);
	}
	removeStale(BUILD, builtFiles);
	removeStale(CONTACT, contactFiles);

	// art/upload: exactly the PNGs to upload (every art/build/*.png), flat, for one bulk import
	for (const name of [...builtFiles].sort()) {
		if (writeIfChanged(path.join(UPLOAD, name), fs.readFileSync(path.join(BUILD, name)))) changed++;
	}
	removeStale(UPLOAD, builtFiles);

	if (writeIfChanged(LAYOUT_FILE, layoutModule(sets, images, floor.meanHex, world))) changed++;
	if (fx && writeIfChanged(FX_LAYOUT_FILE, fxLayoutModule(fx.atlas, fx.fxLayouts, fx.ambientLayouts))) changed++;
	if (icons && writeIfChanged(UI_ICON_LAYOUT_FILE, uiIconLayoutModule(icons))) changed++;
	if (bullets && writeIfChanged(BULLET_LAYOUT_FILE, bulletLayoutModule(bullets.sheet, bullets.layouts, bullets.fxLayouts))) changed++;
	if (goo && writeIfChanged(GOO_LAYOUT_FILE, gooLayoutModule(goo.sheet, goo.layout))) changed++;
	if (auras && writeIfChanged(BOOST_AURA_LAYOUT_FILE, boostAuraLayoutModule(auras.sheet, auras.layouts))) changed++;
	if (treasure && writeIfChanged(TREASURE_LAYOUT_FILE, treasureLayoutModule(treasure))) changed++;
	if (hazards && writeIfChanged(HAZARD_LAYOUT_FILE, hazardLayoutModule(hazards.sheet, hazards.layouts))) changed++;
	if (fortune && writeIfChanged(FORTUNE_LAYOUT_FILE, fortuneLayoutModule(fortune))) changed++;
	if (boonIcons && writeIfChanged(BOON_ICON_LAYOUT_FILE, boonIconLayoutModule(boonIcons))) changed++;
	if (itemIcons && writeIfChanged(ITEM_ICON_LAYOUT_FILE, itemIconLayoutModule(itemIcons))) changed++;
	if (boostIcons && writeIfChanged(BOOST_ICON_LAYOUT_FILE, boostIconLayoutModule(boostIcons))) changed++;
	if (pipIcons && writeIfChanged(PIP_ICON_LAYOUT_FILE, pipIconLayoutModule(pipIcons))) changed++;
	if (duoIcons && writeIfChanged(DUO_ICON_LAYOUT_FILE, duoIconLayoutModule(duoIcons))) changed++;
	if (kenney && writeIfChanged(KENNEY_LAYOUT_FILE, kenneyLayoutModule(kenney))) changed++;

	for (const s of sets) printSpriteSet(s);
	for (const i of images) {
		const sl = i.layout.slice;
		const slice = sl ? `, slice ${sl.left} ${sl.top} ${sl.right} ${sl.bottom}` : "";
		console.log(`${i.id}: ${i.layout.file} ${i.layout.w}x${i.layout.h}${i.meanHex ? ` mean ${i.meanHex}` : ""}${slice}`);
	}
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
	if (bullets) printBullets(bullets, config.bullets);
	if (goo) printGoo(goo, config.goo);
	if (auras) printBoostAuras(auras, config.boostAuras);
	if (treasure) printTreasure(treasure);
	if (hazards) printHazards(hazards);
	if (fortune) printFortune(fortune);
	if (boonIcons) printBoonIcons(boonIcons);
	if (itemIcons) printItemIcons(itemIcons);
	if (boostIcons) printBoostIcons(boostIcons);
	if (pipIcons) printPipIcons(pipIcons);
	if (duoIcons) printDuoIcons(duoIcons);
	if (kenney) printKenney(kenney);
	if (icons) {
		console.log(`ui icons: ${icons.file} ${icons.w}x${icons.h}, ${icons.pieces.length} icons, ${icons.gutter} px extruded gutter (contact numbers in id order)`);
		Object.keys(icons.layouts)
			.sort()
			.forEach((id, n) => {
				const l = icons.layouts[id];
				const src = config.uiIcons.icons[id].rect;
				console.log(`  #${n} ${id}: rect ${l.rect.x},${l.rect.y} ${l.rect.w}x${l.rect.h} (sheet ${src.join(",")})${l.pivot ? `, pivot (${l.pivot.x}, ${l.pivot.y})` : ""}`);
			});
	}
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
	FLOOR_IMAGE_ID,
	MAX_ATLAS,
	OUTLINE_PREVIEW_RGB,
	alphaBleed,
	alphaBounds,
	blit,
	bodyMask,
	buildImage,
	buildImages,
	buildOutputs,
	buildSpriteSet,
	buildSpriteSets,
	buildOneSpriteSet,
	frameNaming,
	isOnlySpriteSet,
	mergeSpriteLayout,
	spriteSetChain,
	spriteSetOutputs,
	spriteSetSourceFiles,
	buildBullets,
	buildBulletFxSet,
	buildBulletSet,
	boostAuraContact,
	boostAuraLayoutModule,
	boostAuraSourceFiles,
	buildBoostAuras,
	buildGoo,
	buildTreasure,
	buildFortune,
	fortuneLayoutModule,
	fortuneSourceFiles,
	buildHazards,
	hazardContact,
	hazardLayoutModule,
	hazardSourceFiles,
	bulletContact,
	bulletGates,
	bulletLayoutModule,
	bulletSourceFiles,
	treasureLayoutModule,
	treasureSourceFiles,
	cie76,
	buildUiIcons,
	buildBoonIcons,
	boonIconLayoutModule,
	boonIconSourceFiles,
	buildItemIcons,
	itemIconLayoutModule,
	itemIconSourceFiles,
	buildBoostIcons,
	boostIconLayoutModule,
	boostIconSourceFiles,
	buildPipIcons,
	pipIconLayoutModule,
	pipIconSourceFiles,
	buildDuoIcons,
	duoIconLayoutModule,
	duoIconSourceFiles,
	buildWorldPieces,
	buildKenney,
	kenneyLayoutModule,
	kenneySourceFiles,
	chooseGrid,
	contactSheet,
	cutoutPixels,
	dilateCells,
	discOffsets,
	encodePng,
	extrudeGutter,
	gooContact,
	gooGate,
	gooLayoutModule,
	gooSourceFiles,
	litMeanColor,
	flatFill,
	isBodyAt,
	layoutModule,
	maskPixels,
	maxRectsFit,
	mergeLockEntries,
	nineSlice,
	onlyGroup,
	onlyGroupSourceFiles,
	packFx,
	outlineConfig,
	packUiIcons,
	packColumn,
	outlineSheet,
	packWorldAtlases,
	rimClip,
	raster,
	recolorLut,
	recolorRegion,
	cellsMode,
	compositeOver,
	gridFiles,
	gridLayers,
	gridLayerNoise,
	gridSheet,
	removeStale,
	sheetCell,
	sliceContact,
	sourceFiles,
	spriteSetOrder,
	takeRect,
	uiIconContact,
	uiIconLayoutModule,
	wcagContrast,
	worldLayout,
	/** Composited layered sheets (gridSheet); tests clear it with the source cache. */
	layeredCache,
	/** Decoded sources by art/vendor-relative path; the tests put synthetic rasters here instead of files. */
	sourceCache: pngCache,
};

if (require.main === module) main();

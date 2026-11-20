/** The validator's per-asset checks (docs/CODEBASE_SCALE.md DX8: a pure move out of validate.ts): biome materials, images, sounds, world art, decor, particles, sprite sets and fx. */
import { append, describeValue, isArrayLike, isObj, matches, quote as q, sortedEntries, type Obj } from "../util";
import {
	AMBIENCE,
	BIOME_MATERIAL_SURFACES,
	DECOR,
	DECOR_LAYERS,
	DECOR_MIN_OUTLINE_POINTS,
	DECOR_PARTICLE,
	DEFAULT_BIOME_MATERIAL,
	DIGIT_FONT,
	FX,
	FX_SPRITE_MAX_TILES,
	MAX_ANIMATION_FPS,
	MUSIC,
	PARTICLE_FLIPBOOK_GRIDS,
	PARTICLE_FLIPBOOK_MODES,
	SLOTS,
	SOUND_PITCH_LIMITS,
	SPRITE_FACING_COUNTS,
	SPRITE_RESAMPLE_MODES,
	TILE,
	UI,
	WORLD_ART_SLOTS,
	parseDecorId,
	requiredAnimationList,
	requiredBaseAnimations,
	type DecorIdInfo,
	type SlotContract,
} from "../contract";
import { BIOME_TILE_KEYS } from "../types";
import { isHexColor } from "../color";
import {
	ASSET_ID_PATTERN,
	BIOME_MATERIAL_LIST,
	BIOME_MATERIAL_SET,
	COLOR_ROLE_SET,
	IMAGE_SIDE_MSG,
	fixed2,
	isFiniteNumber,
	isImageSide,
	isNonNegInt,
	isPosInt,
	type Err,
	type UnknownKeys,
} from "./helpers";

/**
 * A biome's optional `materials` (docs/DECOR.md R1): an object of surface (floor, wall, pool) -> a BIOME_MATERIALS
 * name. A floor or wall whose tile is a repeating texture (an image with `tilesPerImage`) must name a rough material:
 * on a glossy one (DEFAULT_BIOME_MATERIAL, also when the biome names none, or Glass) the sun's glint washes the image
 * out at the game camera (docs/ART.md "As built: molten tiles").
 */
export function validateBiomeMaterials(def: Obj, path: Array<string>, assets: Obj, err: Err, unknownKeys: UnknownKeys) {
	const materials = def.materials;
	const mp = append(path, "materials");
	if (materials !== undefined) {
		if (!isObj(materials)) {
			err(
				mp,
				`must map ${BIOME_MATERIAL_SURFACES.join(", ")} to material names, got ${describeValue(materials)}`,
			);
			return;
		}
		unknownKeys(materials, mp, BIOME_MATERIAL_SURFACES);
		for (const surface of BIOME_MATERIAL_SURFACES) {
			const name = materials[surface];
			if (name === undefined) {
				continue;
			}
			if (!typeIs(name, "string")) {
				err(append(mp, surface), `must be a material name string, got ${describeValue(name)}`);
			} else if (!BIOME_MATERIAL_SET.has(name)) {
				err(append(mp, surface), `unknown material ${q(name)} (allowed: ${BIOME_MATERIAL_LIST})`);
			}
		}
	}
	// The glossy materials a repeating texture may not sit on (a local: validate.luau is near Luau's 200 locals).
	const glossy = new Set<string>([DEFAULT_BIOME_MATERIAL, "Glass"]);
	for (const surface of BIOME_TILE_KEYS) {
		const ref = isObj(def.tiles) ? def.tiles[surface] : undefined;
		const asset = typeIs(ref, "string") ? assets[ref] : undefined;
		if (!typeIs(ref, "string") || !isObj(asset) || asset.kind !== "image" || asset.tilesPerImage === undefined) {
			continue;
		}
		const named = isObj(materials) ? materials[surface] : undefined;
		const name = named === undefined ? DEFAULT_BIOME_MATERIAL : named;
		if (typeIs(name, "string") && glossy.has(name)) {
			err(
				append(mp, surface),
				`${surface} tile ${q(ref)} is a repeating texture: name a rough material, not ${q(
					name,
				)} (its sun glint washes the image out at the game camera)`,
			);
		}
	}
}

/** `assetId` must be an uploaded Roblox asset, "rbxassetid://<digits>". */
function checkAssetIdAt(assetId: unknown, path: ReadonlyArray<string>, err: Err) {
	if (!typeIs(assetId, "string") || assetId === "") {
		err(path, 'must be an uploaded Roblox asset, "rbxassetid://<digits>"');
		return;
	}
	if (!matches(assetId, ASSET_ID_PATTERN)) {
		err(path, `${q(assetId)} must be "rbxassetid://<digits>" (upload with Asphalt or the Studio Asset Manager)`);
	}
}

export function validateAsset(
	def: unknown,
	path: Array<string>,
	slot: SlotContract,
	err: Err,
	unknownKeys: UnknownKeys,
) {
	if (!isObj(def)) {
		err(path, 'must be an object with a "kind"');
		return;
	}
	const kind = def.kind;
	if (!typeIs(kind, "string") || !(slot.kinds as ReadonlyArray<string>).includes(kind)) {
		err(
			append(path, "kind"),
			`slot "${slot.slot}" accepts kind ${slot.kinds.map((k) => q(k)).join(" | ")}, got ${describeValue(kind)}`,
		);
		return;
	}

	const checkCell = (w: unknown, h: unknown, wKey: string, hKey: string) => {
		if (!isPosInt(w)) {
			err(append(path, wKey), "must be a positive integer");
		}
		if (!isPosInt(h)) {
			err(append(path, hKey), "must be a positive integer");
		}
		const cell = slot.cell;
		if (cell !== undefined && isPosInt(w) && isPosInt(h) && (w !== cell.w || h !== cell.h)) {
			err(path, `sprite contract: ${slot.slot} cells are ${cell.w}x${cell.h}, got ${w}x${h}`);
		}
	};

	const checkAssetId = () => checkAssetIdAt(def.assetId, append(path, "assetId"), err);

	/**
	 * A ui image's 9-slice insets (docs/DRAFT_REVEAL.md DR3): { left, top, right, bottom }, integers >= 0 in art
	 * pixels, inside the image with a centre of at least 1 x 1 pixel (left + right < w, top + bottom < h). ui.* only.
	 * A closure, not a module function: this module's compiled Luau sits at the 200-top-level-locals limit.
	 */
	const checkSlice = (slice: unknown, w: unknown, h: unknown, slicePath: Array<string>, inUi: boolean) => {
		if (!inUi) {
			err(slicePath, "only ui.* images are 9-sliced");
			return;
		}
		if (!isObj(slice)) {
			err(slicePath, 'must be { "left": int, "top": int, "right": int, "bottom": int } in art pixels');
			return;
		}
		unknownKeys(slice, slicePath, ["left", "top", "right", "bottom"]);
		let ok = true;
		for (const k of ["left", "top", "right", "bottom"]) {
			if (!isNonNegInt(slice[k])) {
				err(append(slicePath, k), "must be an integer >= 0 (art pixels)");
				ok = false;
			}
		}
		if (!ok || !isPosInt(w) || !isPosInt(h)) {
			return;
		}
		const [l, t, r, b] = [slice.left as number, slice.top as number, slice.right as number, slice.bottom as number];
		if (l + r >= w || t + b >= h) {
			err(
				slicePath,
				`insets ${l} ${t} ${r} ${b} leave no centre in the ${w}x${h} image (left + right < w, top + bottom < h)`,
			);
		}
	};

	switch (kind) {
		case "placeholder": {
			unknownKeys(def, path, ["kind"]);
			break;
		}
		case "image": {
			if (WORLD_ART_SLOTS.includes(slot)) {
				validateWorldImage(def, path, slot, err, unknownKeys);
				break;
			}
			const imageKeys = ["kind", "assetId", "w", "h", "tilesPerImage", "pivot", "slice"];
			if (slot === UI) {
				imageKeys.push("rect");
			}
			unknownKeys(def, path, imageKeys);
			checkAssetId();
			if (def.slice !== undefined) {
				checkSlice(def.slice, def.w, def.h, append(path, "slice"), slot === UI);
			}
			// ui.* (docs/UI_ART.md UA4): `rect`, the region drawn (an icon atlas cut), inside the image; the pivot is then
			// from the rect's top-left and inside it. A sliced image is drawn whole, so it takes no rect.
			let pivotBox = isPosInt(def.w) && isPosInt(def.h) ? { w: def.w, h: def.h } : undefined;
			let pivotWhat = "image";
			const uiRect = def.rect;
			if (uiRect !== undefined) {
				const rp = append(path, "rect");
				pivotWhat = "rect";
				if (
					!isObj(uiRect) ||
					!isNonNegInt(uiRect.x) ||
					!isNonNegInt(uiRect.y) ||
					!isPosInt(uiRect.w) ||
					!isPosInt(uiRect.h)
				) {
					err(
						rp,
						'must be { "x": int >= 0, "y": int >= 0, "w": int >= 1, "h": int >= 1 } in pixels of the image',
					);
					pivotBox = undefined;
				} else {
					unknownKeys(uiRect, rp, ["x", "y", "w", "h"]);
					if (def.slice !== undefined) {
						err(rp, "a sliced image is drawn whole: give it no rect");
					}
					if (
						pivotBox !== undefined &&
						(uiRect.x + uiRect.w > pivotBox.w || uiRect.y + uiRect.h > pivotBox.h)
					) {
						err(
							rp,
							`(${uiRect.x}, ${uiRect.y}) ${uiRect.w}x${uiRect.h} reaches outside the ${def.w}x${def.h} image`,
						);
						pivotBox = undefined;
					} else {
						pivotBox = { w: uiRect.w, h: uiRect.h };
					}
				}
			}
			const imagePivot = def.pivot;
			if (imagePivot !== undefined) {
				const pp = append(path, "pivot");
				if (slot !== UI) {
					err(
						pp,
						`only ui.*, decor.*, breakable.*, boost.*, pellet.*, treasure.*, pact.* and secret.* images have a pivot; slot "${slot.slot}" has none`,
					);
				} else if (!isObj(imagePivot) || !isFiniteNumber(imagePivot.x) || !isFiniteNumber(imagePivot.y)) {
					err(pp, `must be { "x": number, "y": number } in pixels from the ${pivotWhat} top-left`);
				} else {
					unknownKeys(imagePivot, pp, ["x", "y"]);
					if (
						pivotBox !== undefined &&
						(imagePivot.x < 0 || imagePivot.x > pivotBox.w || imagePivot.y < 0 || imagePivot.y > pivotBox.h)
					) {
						err(
							pp,
							`(${imagePivot.x}, ${imagePivot.y}) is outside the ${pivotBox.w}x${pivotBox.h} ${pivotWhat}`,
						);
					}
				}
			}
			const tilesPerImage = def.tilesPerImage;
			if (tilesPerImage === undefined) {
				checkCell(def.w, def.h, "w", "h");
			} else if (slot !== TILE) {
				err(
					append(path, "tilesPerImage"),
					`only tile.* images repeat; slot "${slot.slot}" has no tilesPerImage`,
				);
				checkCell(def.w, def.h, "w", "h");
			} else {
				// A repeating texture: any size Roblox can store, spanning tilesPerImage world tiles per side.
				if (!isFiniteNumber(tilesPerImage) || !(tilesPerImage > 0)) {
					err(append(path, "tilesPerImage"), "must be a number > 0 (world tiles per image side)");
				}
				for (const k of ["w", "h"]) {
					if (!isImageSide(def[k])) {
						err(append(path, k), IMAGE_SIDE_MSG);
					}
				}
			}
			const stripW = DIGIT_FONT.cellW * DIGIT_FONT.glyphs.size();
			if (
				path[1] === DIGIT_FONT.id &&
				isPosInt(def.w) &&
				isPosInt(def.h) &&
				(def.w !== stripW || def.h !== DIGIT_FONT.cellH)
			) {
				err(
					path,
					`font contract: the digit strip is ${stripW}x${
						DIGIT_FONT.cellH
					} (${DIGIT_FONT.glyphs.size()} cells of ${DIGIT_FONT.cellW}x${DIGIT_FONT.cellH}: "${
						DIGIT_FONT.glyphs
					}"), got ${def.w}x${def.h}`,
				);
			}
			break;
		}
		case "spritesheet": {
			unknownKeys(def, path, ["kind", "assetId", "frameW", "frameH", "animations", "pivot"]);
			checkAssetId();
			checkCell(def.frameW, def.frameH, "frameW", "frameH");
			const pivot = def.pivot;
			if (!isObj(pivot) || !isNonNegInt(pivot.x) || !isNonNegInt(pivot.y)) {
				err(append(path, "pivot"), 'must be { "x": int, "y": int } in pixels from the cell top-left');
			} else {
				unknownKeys(pivot, append(path, "pivot"), ["x", "y"]);
				const want = slot.pivot;
				if (want !== undefined && (pivot.x !== want.x || pivot.y !== want.y)) {
					err(
						append(path, "pivot"),
						`sprite contract: ${slot.slot} pivot is (${want.x}, ${want.y}), got (${pivot.x}, ${pivot.y})`,
					);
				}
			}
			const anims = def.animations;
			if (!isObj(anims)) {
				err(append(path, "animations"), "must be an object of name -> { row, frames, fps, loop }");
				break;
			}
			const rows = new Map<number, string>();
			// Rows are claimed in row-then-name order so a duplicate is blamed on the same entry every run.
			const entries = sortedEntries(anims);
			const rowOf = (a: unknown) => (isObj(a) && isNonNegInt(a.row) ? a.row : math.huge);
			entries.sort((a, b) => {
				const ra = rowOf(a[1]);
				const rb = rowOf(b[1]);
				return ra !== rb ? ra < rb : a[0] < b[0];
			});
			for (const [name, a] of entries) {
				const ap = append(path, "animations", name);
				if (!isObj(a)) {
					err(ap, "must be { row, frames, fps, loop }");
					continue;
				}
				unknownKeys(a, ap, ["row", "frames", "fps", "loop"]);
				if (!isNonNegInt(a.row)) {
					err(append(ap, "row"), "must be an integer >= 0");
				} else if (rows.has(a.row)) {
					err(append(ap, "row"), `row ${a.row} is already used by ${q(rows.get(a.row) as string)}`);
				} else {
					rows.set(a.row, name);
				}
				if (!isPosInt(a.frames)) {
					err(append(ap, "frames"), "must be an integer >= 1");
				}
				if (!typeIs(a.fps, "number") || !(a.fps > 0) || a.fps > MAX_ANIMATION_FPS) {
					err(append(ap, "fps"), `must be a number in (0, ${MAX_ANIMATION_FPS}]`);
				}
				if (!typeIs(a.loop, "boolean")) {
					err(append(ap, "loop"), "must be true or false");
				}
			}
			for (const req of requiredAnimationList(slot)) {
				const a = anims[req.name];
				if (!isObj(a)) {
					err(
						append(path, "animations"),
						`sprite contract: missing animation ${q(req.name)} (${req.frames} frames)`,
					);
				} else if (isPosInt(a.frames) && a.frames !== req.frames) {
					err(
						append(path, "animations", req.name, "frames"),
						`sprite contract: ${q(req.name)} has ${req.frames} frames, got ${a.frames}`,
					);
				}
			}
			break;
		}
		case "sprites": {
			validateSpriteSet(def, path, slot, err, unknownKeys);
			break;
		}
		case "sound": {
			unknownKeys(def, path, ["kind", "assetId", "volume", "variants", "pitch", "minInterval"]);
			checkAssetId();
			const volume = def.volume;
			if (volume !== undefined && (!typeIs(volume, "number") || volume < 0 || volume > 1)) {
				err(append(path, "volume"), "must be a number in [0, 1]");
			}
			validateSoundExtras(def, path, slot, err);
			break;
		}
		case "silent": {
			unknownKeys(def, path, ["kind"]);
			break;
		}
	}
}

const PITCH_MSG = `must be [min, max] with ${SOUND_PITCH_LIMITS.min} <= min <= max <= ${SOUND_PITCH_LIMITS.max} (PlaybackSpeed)`;

/** Slots whose sounds the client loops as one bed (music, ambience): one clip at PlaybackSpeed 1. */
const LOOPED_SOUND_SLOTS: ReadonlyArray<SlotContract> = [MUSIC, AMBIENCE];

/**
 * A sound's optional extras (docs/FX_AUDIO.md A2): `variants` an array of uploaded asset IDs (empty is fine),
 * `pitch` a [min, max] PlaybackSpeed range inside SOUND_PITCH_LIMITS with min <= max, `minInterval` seconds >= 0.
 * A looped slot (music.*, amb.*) takes neither `variants` nor `pitch`: its channel plays the one clip at speed 1.
 */
function validateSoundExtras(def: Obj, path: Array<string>, slot: SlotContract, err: Err) {
	const variants = def.variants;
	const pitch = def.pitch;
	if (LOOPED_SOUND_SLOTS.includes(slot)) {
		const what = `${slot.prefix}* is looped (one clip at PlaybackSpeed 1)`;
		if (variants !== undefined) {
			err(append(path, "variants"), `${what}: no variants, put the one clip in assetId`);
		}
		if (pitch !== undefined) {
			err(append(path, "pitch"), `${what}: no pitch jitter`);
		}
	} else if (variants !== undefined) {
		const vp = append(path, "variants");
		if (isArrayLike(variants)) {
			for (let i = 0; i < variants.size(); i++) {
				checkAssetIdAt(variants[i], append(vp, tostring(i)), err);
			}
		} else if (!isObj(variants) || sortedEntries(variants).size() > 0) {
			err(vp, `must be an array of "rbxassetid://<digits>" (extra clips), got ${describeValue(variants)}`);
		}
	}
	if (pitch !== undefined && !LOOPED_SOUND_SLOTS.includes(slot)) {
		const pp = append(path, "pitch");
		if (!isArrayLike(pitch) || pitch.size() !== 2 || !isFiniteNumber(pitch[0]) || !isFiniteNumber(pitch[1])) {
			err(pp, `${PITCH_MSG}, got ${describeValue(pitch)}`);
		} else {
			const lo = pitch[0] as number;
			const hi = pitch[1] as number;
			if (lo < SOUND_PITCH_LIMITS.min || hi > SOUND_PITCH_LIMITS.max || lo > hi) {
				err(pp, `${PITCH_MSG}, got [${lo}, ${hi}]`);
			}
		}
	}
	const minInterval = def.minInterval;
	if (minInterval !== undefined && (!isFiniteNumber(minInterval) || minInterval < 0)) {
		err(append(path, "minInterval"), `must be a number of seconds >= 0, got ${describeValue(minInterval)}`);
	}
}

// ---------------------------------------------------------------------------------------------
// World art (Roblox port, docs/DECOR.md R2 / R13): decor.* and breakable.* images and sprite sets

/** Keys of a decor.* / breakable.* / boost.* image (decor pieces and effects add DECOR_ART_KEYS). */
const WORLD_IMAGE_KEYS = ["kind", "assetId", "w", "h", "rect", "pivot", "pixelsPerTile"];
/** Keys of an ambient particle texture (decor.fx.ambient.*): a ParticleEmitter texture, no placement. */
const AMBIENT_IMAGE_KEYS = ["kind", "assetId", "w", "h", "particle", "emissive"];
const DECOR_LAYER_LIST = DECOR_LAYERS.map((l) => q(l)).join(" | ");

/**
 * The decor fields a decor asset may carry on top of its kind's keys: pieces have a layer (and an image an `outline`, a
 * sprite set per-facing `outlines`), effects do not.
 */
function decorArtKeys(info: DecorIdInfo, kind: "image" | "sprites"): Array<string> {
	switch (info.type) {
		case "piece":
		case "void":
			return ["layer", "glow", "glowAt", "emissive", kind === "image" ? "outline" : "outlines"];
		case "fx":
			return ["glow", "glowAt", "emissive"];
		default:
			return [];
	}
}

type Box = { readonly w: number; readonly h: number };

/** A point `{ x, y }` in pixels, inside `box` (`what`: "image", "rect" or "cell") when the box is known. */
function checkPoint(
	p: unknown,
	pp: ReadonlyArray<string>,
	box: Box | undefined,
	what: string,
	err: Err,
	unknownKeys: UnknownKeys,
) {
	if (!isObj(p) || !isFiniteNumber(p.x) || !isFiniteNumber(p.y)) {
		err(pp, `must be { "x": number, "y": number } in pixels from the ${what} top-left`);
		return;
	}
	unknownKeys(p, pp, ["x", "y"]);
	if (box !== undefined && (p.x < 0 || p.x > box.w || p.y < 0 || p.y > box.h)) {
		err(pp, `(${p.x}, ${p.y}) is outside the ${box.w}x${box.h} ${what}`);
	}
}

/**
 * A world-art image (decor.*, breakable.*, boost.*): an uploaded image up to MAX_IMAGE_SIDE, an optional `rect`
 * inside it (the region drawn), an optional `pivot` inside the drawn region, `pixelsPerTile` > 0; decor IDs add their
 * decor fields. An ambient particle texture (decor.fx.ambient.*) is only a texture plus its `particle` look.
 */
function validateWorldImage(def: Obj, path: Array<string>, slot: SlotContract, err: Err, unknownKeys: UnknownKeys) {
	const info = slot === DECOR ? parseDecorId(path[1]) : undefined;
	const ambient = info !== undefined && info.type === "ambient";
	const keys = ambient
		? AMBIENT_IMAGE_KEYS
		: [...WORLD_IMAGE_KEYS, ...(info !== undefined ? decorArtKeys(info, "image") : [])];
	unknownKeys(def, path, keys);
	checkAssetIdAt(def.assetId, append(path, "assetId"), err);
	for (const k of ["w", "h"]) {
		if (!isImageSide(def[k])) {
			err(append(path, k), IMAGE_SIDE_MSG);
		}
	}
	const sizeOk = isImageSide(def.w) && isImageSide(def.h);
	if (ambient) {
		validateParticle(def.particle, append(path, "particle"), err, unknownKeys);
		if (isObj(def.particle) && def.particle.flipbook !== undefined && sizeOk && def.w !== def.h) {
			err(append(path, "particle", "flipbook"), `a flipbook texture must be square, got ${def.w}x${def.h}`);
		}
		if (def.emissive !== undefined && !typeIs(def.emissive, "boolean")) {
			err(append(path, "emissive"), "must be true or false");
		}
		return;
	}
	let box: Box | undefined = sizeOk ? { w: def.w as number, h: def.h as number } : undefined;
	let what = "image";
	const rect = def.rect;
	if (rect !== undefined) {
		const rp = append(path, "rect");
		what = "rect";
		if (!isObj(rect) || !isNonNegInt(rect.x) || !isNonNegInt(rect.y) || !isPosInt(rect.w) || !isPosInt(rect.h)) {
			err(rp, 'must be { "x": int >= 0, "y": int >= 0, "w": int >= 1, "h": int >= 1 } in pixels of the image');
			box = undefined;
		} else {
			unknownKeys(rect, rp, ["x", "y", "w", "h"]);
			if (sizeOk && (rect.x + rect.w > (def.w as number) || rect.y + rect.h > (def.h as number))) {
				err(rp, `(${rect.x}, ${rect.y}) ${rect.w}x${rect.h} reaches outside the ${def.w}x${def.h} image`);
				box = undefined;
			} else {
				box = { w: rect.w, h: rect.h };
			}
		}
	}
	if (def.pivot !== undefined) {
		checkPoint(def.pivot, append(path, "pivot"), box, what, err, unknownKeys);
	}
	if (!isFiniteNumber(def.pixelsPerTile) || !(def.pixelsPerTile > 0)) {
		err(append(path, "pixelsPerTile"), "must be a number > 0 (art pixels per world tile)");
	}
	if (info !== undefined) {
		validateDecorFields(def, path, info, box, what, err, unknownKeys);
		if (def.outline !== undefined) {
			validateOutline(def.outline, append(path, "outline"), box, what, err, unknownKeys);
		}
	}
}

/** A decor outline: at least 3 points `{ x, y }`, each inside `box` (the rect or cell) when it is known. */
function validateOutline(
	o: unknown,
	op: Array<string>,
	box: Box | undefined,
	what: string,
	err: Err,
	unknownKeys: UnknownKeys,
) {
	if (!isArrayLike(o) || o.size() < DECOR_MIN_OUTLINE_POINTS) {
		err(
			op,
			`must be an array of at least ${DECOR_MIN_OUTLINE_POINTS} points { "x", "y" } in pixels of the ${what}`,
		);
		return;
	}
	for (let i = 0; i < o.size(); i++) {
		checkPoint(o[i], append(op, tostring(i)), box, what, err, unknownKeys);
	}
}

/**
 * The decor fields of a decor piece or effect (image or sprite set): a piece's `layer` (required, one of the layers
 * its kind allows: DECOR_KIND_LAYERS, or VOID_DECOR.layers for a void piece), `glow` / `emissive` booleans, `glowAt` only with `glow: true` and inside the
 * drawn box.
 */
function validateDecorFields(
	def: Obj,
	path: Array<string>,
	info: DecorIdInfo,
	box: Box | undefined,
	what: string,
	err: Err,
	unknownKeys: UnknownKeys,
) {
	if (info.type === "piece" || info.type === "void") {
		const allowed = info.layers as ReadonlyArray<string>;
		const lp = append(path, "layer");
		const layer = def.layer;
		if (layer === undefined) {
			err(lp, `missing: a decor piece needs a layer (${q(info.kind)}: ${allowed.map((l) => q(l)).join(" | ")})`);
		} else if (!typeIs(layer, "string") || !(DECOR_LAYERS as ReadonlyArray<string>).includes(layer)) {
			err(lp, `must be ${DECOR_LAYER_LIST}, got ${describeValue(layer)}`);
		} else if (!allowed.includes(layer)) {
			err(lp, `${q(layer)} is not allowed for ${q(info.kind)} (allowed: ${allowed.join(", ")})`);
		}
	}
	for (const k of ["glow", "emissive"]) {
		if (def[k] !== undefined && !typeIs(def[k], "boolean")) {
			err(append(path, k), "must be true or false");
		}
	}
	if (def.glowAt !== undefined) {
		const gp = append(path, "glowAt");
		if (def.glow !== true) {
			err(gp, "only a glowing piece (glow: true) has a glowAt");
		}
		checkPoint(def.glowAt, gp, box, what, err, unknownKeys);
	}
}

/** An ambient particle's optional look: `sizeStuds` in (0, max], `transparency` in [min, 1] (DECOR_PARTICLE). */
function validateParticle(p: unknown, pp: Array<string>, err: Err, unknownKeys: UnknownKeys) {
	if (p === undefined) {
		return;
	}
	if (!isObj(p)) {
		err(pp, 'must be { "sizeStuds"?: number, "transparency"?: number, "flipbook"?: { grid, fps, mode } }');
		return;
	}
	unknownKeys(p, pp, ["sizeStuds", "transparency", "flipbook"]);
	const fb = p.flipbook;
	if (fb !== undefined) {
		const fp = append(pp, "flipbook");
		if (!isObj(fb)) {
			err(fp, 'must be { "grid": 2 | 4 | 8, "fps": number, "mode": "Loop" | "OneShot" | "PingPong" | "Random" }');
		} else {
			unknownKeys(fb, fp, ["grid", "fps", "mode"]);
			if (!PARTICLE_FLIPBOOK_GRIDS.includes(fb.grid as number)) {
				err(
					append(fp, "grid"),
					`must be one of ${PARTICLE_FLIPBOOK_GRIDS.join(", ")}, got ${describeValue(fb.grid)}`,
				);
			}
			if (!isFiniteNumber(fb.fps) || !(fb.fps > 0) || fb.fps > MAX_ANIMATION_FPS) {
				err(append(fp, "fps"), `must be a number in (0, ${MAX_ANIMATION_FPS}]`);
			}
			if (!PARTICLE_FLIPBOOK_MODES.some((m) => m === fb.mode)) {
				err(
					append(fp, "mode"),
					`must be one of ${PARTICLE_FLIPBOOK_MODES.join(", ")}, got ${describeValue(fb.mode)}`,
				);
			}
		}
	}
	const size = p.sizeStuds;
	if (size !== undefined && (!isFiniteNumber(size) || !(size > 0) || size > DECOR_PARTICLE.maxSizeStuds)) {
		err(
			append(pp, "sizeStuds"),
			`must be a number in (0, ${DECOR_PARTICLE.maxSizeStuds}] (studs: ambient particles stay smaller than bullets)`,
		);
	}
	const t = p.transparency;
	if (t !== undefined && (!isFiniteNumber(t) || t < DECOR_PARTICLE.minTransparency || t > 1)) {
		err(
			append(pp, "transparency"),
			`must be a number in [${DECOR_PARTICLE.minTransparency}, 1] (ambient particles stay fainter than bullets)`,
		);
	}
}

const SPRITE_SET_KEYS = [
	"kind",
	"frameW",
	"frameH",
	"pivot",
	"pixelsPerTile",
	"resample",
	"facings",
	"sheets",
	"animations",
];
const SPRITE_ANIMATION_KEYS = ["sheet", "start", "frames", "stride", "fps", "loop"];
/** A sheet's keys: its image, size, optional rim, and the optional per-sheet cell (actor slots only). */
const SPRITE_SHEET_KEYS = ["assetId", "w", "h", "outlineAssetId", "dyeAssetId", "frameW", "frameH", "pivot"];
const SHEET_SHAPE = "{ assetId, w, h, outlineAssetId?, dyeAssetId?, frameW?, frameH?, pivot? }";
/** The slots whose sets may give a sheet its own cell, for messages. */
const PER_SHEET_SLOTS = SLOTS.filter((s) => s.perSheetCells === true)
	.map((s) => `${s.prefix}*`)
	.join(" / ");

/**
 * A sheet's cell: the set's (`setCell`, undefined when the set's is invalid), or with per-sheet cells (docs/DEMON_ART.md
 * DD4) its own `frameW` / `frameH` / `pivot`, each defaulting to the set's. Accepted only in slots with
 * `perSheetCells` (the actor renderer re-sizes the billboard per sheet); the effective pivot must lie inside the
 * effective cell. Returns the cell size, or undefined when it is not valid (so the sheet's size is not checked).
 */
function validateSheetCell(
	sheet: Obj,
	sp: Array<string>,
	slot: SlotContract,
	setCell: { w: number; h: number } | undefined,
	setPivot: unknown,
	err: Err,
	unknownKeys: UnknownKeys,
): { w: number; h: number } | undefined {
	if (sheet.frameW === undefined && sheet.frameH === undefined && sheet.pivot === undefined) {
		return setCell;
	}
	if (slot.perSheetCells !== true) {
		err(
			sp,
			`per-sheet cells (frameW / frameH / pivot) are drawn on ${PER_SHEET_SLOTS} sets only: the ${slot.slot} renderer sizes every frame from the set's cell`,
		);
	}
	let w = setCell?.w;
	let h = setCell?.h;
	if (sheet.frameW !== undefined) {
		if (isImageSide(sheet.frameW)) {
			w = sheet.frameW;
		} else {
			err(append(sp, "frameW"), `${IMAGE_SIDE_MSG} (this sheet's cell width; absent: the set's frameW)`);
			w = undefined;
		}
	}
	if (sheet.frameH !== undefined) {
		if (isImageSide(sheet.frameH)) {
			h = sheet.frameH;
		} else {
			err(append(sp, "frameH"), `${IMAGE_SIDE_MSG} (this sheet's cell height; absent: the set's frameH)`);
			h = undefined;
		}
	}
	const cell = w !== undefined && h !== undefined ? { w, h } : undefined;
	const p = sheet.pivot;
	if (p !== undefined) {
		if (!isObj(p) || !isFiniteNumber(p.x) || !isFiniteNumber(p.y)) {
			err(
				append(sp, "pivot"),
				'must be { "x": number, "y": number } in pixels from the sheet cell top-left (absent: the set pivot)',
			);
			return cell;
		}
		unknownKeys(p, append(sp, "pivot"), ["x", "y"]);
		if (cell !== undefined && (p.x < 0 || p.x > cell.w || p.y < 0 || p.y > cell.h)) {
			err(append(sp, "pivot"), `(${p.x}, ${p.y}) is outside the sheet's ${cell.w}x${cell.h} cell`);
		}
	} else if (cell !== undefined && isObj(setPivot) && isFiniteNumber(setPivot.x) && isFiniteNumber(setPivot.y)) {
		if (setPivot.x < 0 || setPivot.x > cell.w || setPivot.y < 0 || setPivot.y > cell.h) {
			err(
				sp,
				`the set pivot (${setPivot.x}, ${setPivot.y}) is outside this sheet's ${cell.w}x${cell.h} cell: give the sheet its own pivot`,
			);
		}
	}
	return cell;
}
/**
 * Keys an fx.* sprite set adds (types.ts SpriteSetAsset, fx fields); `ringPx` is the boost auras' per-rank rings
 * (docs/BOOST_ART.md BAD3), which boostAuraArt.ts refuses on every other fx ID.
 */
const FX_ART_KEYS = ["sizeTiles", "tint", "additive", "meanColor", "ringPx"];
const FACING_COUNT_LIST = (SPRITE_FACING_COUNTS as ReadonlyArray<number>).map((n) => tostring(n)).join(" | ");
const RESAMPLE_LIST = SPRITE_RESAMPLE_MODES.map((m) => q(m)).join(" | ");

/**
 * Sprite contract v2: a `sprites` asset (SpriteSetAsset, types.ts). Every field is checked, and every cell an
 * animation references (all facings, all frames: `start + d * (stride ?? frames) + f`) must lie inside its sheet.
 */
function validateSpriteSet(def: Obj, path: Array<string>, slot: SlotContract, err: Err, unknownKeys: UnknownKeys) {
	const decor = slot === DECOR ? parseDecorId(path[1]) : undefined;
	if (decor !== undefined && decor.type === "ambient") {
		err(append(path, "kind"), 'decor.fx.ambient.* is a particle texture: kind "image", got "sprites"');
		return;
	}
	const fx = slot === FX;
	// docs/PROJECTILE_ART.md PA3: a bullet set adds its meanColor (bulletArt.ts checks it; by slot name: no new local);
	// docs/GOO_ART.md GA2: a floor sprite (the goo) also its hold frame's lit box `lit` (gooArt.ts checks it);
	// docs/HAZARD_ART.md HA3: a hazard its `lit` (the ember) or hit rim `rimPx` (the strike; hazardArt.ts checks both)
	const extraKeys =
		decor !== undefined
			? decorArtKeys(decor, "sprites")
			: fx
			? FX_ART_KEYS
			: slot.slot === "bullet"
			? ["meanColor", "lit", "rimPx"]
			: [];
	unknownKeys(def, path, [...SPRITE_SET_KEYS, ...extraKeys]);

	// --- cell, pivot, density, resample -----------------------------------------------------------
	const frameW = def.frameW;
	const frameH = def.frameH;
	if (!isImageSide(frameW)) {
		err(append(path, "frameW"), IMAGE_SIDE_MSG);
	}
	if (!isImageSide(frameH)) {
		err(append(path, "frameH"), IMAGE_SIDE_MSG);
	}
	const cellOk = isImageSide(frameW) && isImageSide(frameH);
	const pivot = def.pivot;
	if (!isObj(pivot) || !isFiniteNumber(pivot.x) || !isFiniteNumber(pivot.y)) {
		err(append(path, "pivot"), 'must be { "x": number, "y": number } in pixels from the cell top-left');
	} else {
		unknownKeys(pivot, append(path, "pivot"), ["x", "y"]);
		if (cellOk && (pivot.x < 0 || pivot.x > frameW || pivot.y < 0 || pivot.y > frameH)) {
			err(append(path, "pivot"), `(${pivot.x}, ${pivot.y}) is outside the ${frameW}x${frameH} cell`);
		}
	}
	if (!isFiniteNumber(def.pixelsPerTile) || !(def.pixelsPerTile > 0)) {
		err(append(path, "pixelsPerTile"), "must be a number > 0 (cell pixels per world tile)");
	}
	if (!SPRITE_RESAMPLE_MODES.some((m) => m === def.resample)) {
		err(append(path, "resample"), `must be ${RESAMPLE_LIST}, got ${describeValue(def.resample)}`);
	}
	if (decor !== undefined) {
		const cell = cellOk ? { w: frameW as number, h: frameH as number } : undefined;
		validateDecorFields(def, path, decor, cell, "cell", err, unknownKeys);
	}

	// --- facings ----------------------------------------------------------------------------------
	let facingCount: number | undefined;
	const facings = def.facings;
	if (!isObj(facings)) {
		err(append(path, "facings"), `must be { "count": ${FACING_COUNT_LIST}, "zeroDeg": number, "ccw": boolean }`);
	} else {
		const fp = append(path, "facings");
		unknownKeys(facings, fp, ["count", "zeroDeg", "ccw"]);
		if (SPRITE_FACING_COUNTS.some((n) => n === facings.count)) {
			facingCount = facings.count as number;
		} else {
			err(append(fp, "count"), `must be ${FACING_COUNT_LIST}, got ${describeValue(facings.count)}`);
		}
		if (!isFiniteNumber(facings.zeroDeg)) {
			err(append(fp, "zeroDeg"), "must be a finite number (degrees; 0 = screen right)");
		}
		if (!typeIs(facings.ccw, "boolean")) {
			err(append(fp, "ccw"), "must be true or false");
		}
		if (fx && facingCount !== undefined && facingCount !== 1) {
			err(append(fp, "count"), `an effect is drawn in one facing: must be 1, got ${facingCount}`);
		}
	}
	if (fx) {
		validateFxFields(def, path, cellOk ? math.max(frameW as number, frameH as number) : undefined, err);
	}

	if (decor !== undefined && def.outlines !== undefined) {
		const op = append(path, "outlines");
		const outlines = def.outlines;
		const cell = cellOk ? { w: frameW as number, h: frameH as number } : undefined;
		if (!isArrayLike(outlines) || (facingCount !== undefined && outlines.size() !== facingCount)) {
			err(op, `must be an array of one outline per facing (${facingCount ?? "facings.count"})`);
		} else {
			for (let i = 0; i < outlines.size(); i++) {
				validateOutline(outlines[i], append(op, tostring(i)), cell, "cell", err, unknownKeys);
			}
		}
	}

	// --- sheets -----------------------------------------------------------------------------------
	/** Sheet index -> cell capacity, for sheets whose size (and the cell) are valid. */
	const capacity = new Map<number, number>();
	/** Sheet index -> "WxH", for messages. */
	const sheetSize = new Map<number, string>();
	/** Sheet index -> its cell "WxH" (the set's, or its own with per-sheet cells), for messages. */
	const sheetCellSize = new Map<number, string>();
	let sheetCount: number | undefined;
	const sheets = def.sheets;
	if (!isArrayLike(sheets)) {
		err(append(path, "sheets"), `must be a non-empty array of ${SHEET_SHAPE}`);
	} else {
		sheetCount = sheets.size();
		for (let i = 0; i < sheets.size(); i++) {
			const sp = append(path, "sheets", tostring(i));
			const sheet = sheets[i];
			if (!isObj(sheet)) {
				err(sp, `must be ${SHEET_SHAPE}`);
				continue;
			}
			unknownKeys(sheet, sp, SPRITE_SHEET_KEYS);
			checkAssetIdAt(sheet.assetId, append(sp, "assetId"), err);
			if (sheet.outlineAssetId !== undefined) {
				// The baked rim (enemy outline plan O4): its own upload, same size and cells as the sheet.
				checkAssetIdAt(sheet.outlineAssetId, append(sp, "outlineAssetId"), err);
				if (sheet.outlineAssetId === sheet.assetId) {
					err(append(sp, "outlineAssetId"), "is the sheet's own assetId (upload the <sheet>-outline.png)");
				}
			}
			if (sheet.dyeAssetId !== undefined) {
				// docs/COSMETICS.md: the dye sheet, its own upload, same size and cells as the sheet.
				checkAssetIdAt(sheet.dyeAssetId, append(sp, "dyeAssetId"), err);
				if (sheet.dyeAssetId === sheet.assetId || sheet.dyeAssetId === sheet.outlineAssetId) {
					err(append(sp, "dyeAssetId"), "is the sheet's own or outline assetId (upload the <sheet>-dye.png)");
				}
			}
			const cell = validateSheetCell(
				sheet,
				sp,
				slot,
				cellOk ? { w: frameW, h: frameH } : undefined,
				pivot,
				err,
				unknownKeys,
			);
			const w = sheet.w;
			const h = sheet.h;
			if (!isImageSide(w)) {
				err(append(sp, "w"), IMAGE_SIDE_MSG);
			}
			if (!isImageSide(h)) {
				err(append(sp, "h"), IMAGE_SIDE_MSG);
			}
			if (!isImageSide(w) || !isImageSide(h) || cell === undefined) {
				continue;
			}
			if (w < cell.w || h < cell.h) {
				err(sp, `sheet is ${w}x${h}, smaller than the ${cell.w}x${cell.h} cell`);
				continue;
			}
			capacity.set(i, math.floor(w / cell.w) * math.floor(h / cell.h));
			sheetSize.set(i, `${w}x${h}`);
			sheetCellSize.set(i, `${cell.w}x${cell.h}`);
		}
	}

	// --- animations -------------------------------------------------------------------------------
	const anims = def.animations;
	const ap0 = append(path, "animations");
	if (!isObj(anims)) {
		err(ap0, "must be an object of name -> { sheet, start, frames, stride?, fps, loop }");
		return;
	}
	for (const name of requiredBaseAnimations(slot, path[1])) {
		if (!isObj(anims[name])) {
			err(ap0, `sprite contract: missing animation ${q(name)} (>= 1 frame)`);
		}
	}
	for (const [name, a] of sortedEntries(anims)) {
		const ap = append(ap0, name);
		if (!isObj(a)) {
			err(ap, "must be { sheet, start, frames, stride?, fps, loop }");
			continue;
		}
		unknownKeys(a, ap, SPRITE_ANIMATION_KEYS);
		const sheetIndex = a.sheet;
		if (!isNonNegInt(sheetIndex) || (sheetCount !== undefined && sheetIndex >= sheetCount)) {
			err(
				append(ap, "sheet"),
				sheetCount !== undefined
					? `must be a sheet index in [0, ${sheetCount - 1}], got ${describeValue(sheetIndex)}`
					: "must be an integer >= 0 (index into sheets)",
			);
		}
		if (!isNonNegInt(a.start)) {
			err(append(ap, "start"), "must be an integer >= 0 (first cell)");
		}
		if (!isPosInt(a.frames)) {
			err(append(ap, "frames"), "must be an integer >= 1");
		}
		if (a.stride !== undefined && !isPosInt(a.stride)) {
			err(append(ap, "stride"), "must be an integer >= 1 (cells between facings)");
		} else if (
			a.stride !== undefined &&
			isPosInt(a.frames) &&
			a.stride < a.frames &&
			(facingCount === undefined || facingCount > 1)
		) {
			err(
				append(ap, "stride"),
				`is ${a.stride}, less than frames (${a.frames}): consecutive facings would share cells`,
			);
		}
		if (!typeIs(a.fps, "number") || !(a.fps > 0) || a.fps > MAX_ANIMATION_FPS) {
			err(append(ap, "fps"), `must be a number in (0, ${MAX_ANIMATION_FPS}]`);
		}
		if (!typeIs(a.loop, "boolean")) {
			err(append(ap, "loop"), "must be true or false");
		}

		// Every referenced cell inside the sheet. Cells grow with the facing and the frame, so the first one out of
		// range is in the first facing whose last frame is out of range.
		const stride = a.stride === undefined ? a.frames : a.stride;
		if (
			facingCount === undefined ||
			!isNonNegInt(sheetIndex) ||
			!isNonNegInt(a.start) ||
			!isPosInt(a.frames) ||
			!isPosInt(stride)
		) {
			continue;
		}
		const cap = capacity.get(sheetIndex);
		if (cap === undefined) {
			continue;
		}
		const lastFacing = facingCount - 1;
		for (let d = 0; d <= lastFacing; d++) {
			const first = a.start + d * stride;
			if (first + a.frames - 1 < cap) {
				continue;
			}
			const f = math.max(0, cap - first);
			err(
				ap,
				`facing ${d} frame ${f} is cell ${first + f}, but sheet ${sheetIndex} (${sheetSize.get(
					sheetIndex,
				)}) holds ${cap} cells of ${sheetCellSize.get(sheetIndex)}`,
			);
			break;
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Sprite effects (Roblox port, docs/FX_AUDIO.md F1): fx.* fields

/**
 * An fx.* set's fields: `sizeTiles` in (0, FX_SPRITE_MAX_TILES] (absent: the longer cell side / pixelsPerTile, held
 * to the same cap), `tint` a known colour role, `additive` a boolean, `meanColor` "#rrggbb", required without a
 * `tint` (the pipeline always writes it; without it the colour rule would have nothing to check). The colour rule
 * (tint and meanColor vs the enemy-bullet roles) is fxColorReport's.
 */
function validateFxFields(def: Obj, path: Array<string>, longSide: number | undefined, err: Err) {
	const sizeTiles = def.sizeTiles;
	if (sizeTiles !== undefined) {
		if (!isFiniteNumber(sizeTiles) || !(sizeTiles > 0) || sizeTiles > FX_SPRITE_MAX_TILES) {
			err(
				append(path, "sizeTiles"),
				`must be a number in (0, ${FX_SPRITE_MAX_TILES}] (tiles: effects stay small), got ${describeValue(
					sizeTiles,
				)}`,
			);
		}
	} else if (longSide !== undefined && isFiniteNumber(def.pixelsPerTile) && def.pixelsPerTile > 0) {
		const drawn = longSide / def.pixelsPerTile;
		if (drawn > FX_SPRITE_MAX_TILES) {
			err(
				path,
				`drawn ${fixed2(drawn)} tiles (cell ${longSide} px / pixelsPerTile ${
					def.pixelsPerTile
				}), more than ${FX_SPRITE_MAX_TILES}: set sizeTiles or raise pixelsPerTile`,
			);
		}
	}
	const tint = def.tint;
	if (tint !== undefined && (!typeIs(tint, "string") || !COLOR_ROLE_SET.has(tint))) {
		err(append(path, "tint"), `must be a colour role (COLOR_ROLES), got ${describeValue(tint)}`);
	}
	if (def.additive !== undefined && !typeIs(def.additive, "boolean")) {
		err(append(path, "additive"), "must be true or false");
	}
	if (def.meanColor !== undefined && !isHexColor(def.meanColor)) {
		err(append(path, "meanColor"), `must be "#rrggbb", got ${describeValue(def.meanColor)}`);
	} else if (tint === undefined && def.meanColor === undefined) {
		err(
			path,
			"an untinted effect needs its sheet's meanColor (art:build writes it) for the enemy-bullet colour rule; or set a tint",
		);
	}
}

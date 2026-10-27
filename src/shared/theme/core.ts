/**
 * The pure half of the runtime theme pack: resolves logical IDs to asset IDs, sheet layouts,
 * hex colours, sounds, strings and placeholder visuals, with no Roblox types (so it runs
 * headlessly). `ThemePack` (pack.ts) wraps it and converts to Color3 / Vector2.
 *
 * Ported from project-kaleb-vale `src/theme/pack.ts` @ 42897e2 (ThemePack lookups, frameUV,
 * frameIndex). Missing IDs never crash: they warn once and fall back exactly as the source does
 * (magenta MISSING_COLOR, the key for strings, silence for sounds; the source's checkerboard
 * texture becomes `assetId: undefined` plus a magenta placeholder visual).
 *
 * Roblox port (docs/DECOR.md): decor lookups (`decor`, `decorVariants`, `ambient`) are optional art and never warn for
 * an ID the pack leaves out; `breakable` is required art (art, or its placeholder box).
 *
 * Roblox port (docs/BOOSTS.md B5): `boost` is required art too (art, or its placeholder gem), with its strings.
 *
 * Roblox port (docs/FX_AUDIO.md A2, F1): `sound` resolves variants, pitch jitter and minimum intervals (cached);
 * `fx` resolves an optional sprite effect (never warns for an ID the pack leaves out).
 */

import { isHexColor } from "./color";
import {
	BIOMES,
	BIOME_MATERIALS,
	BIOME_MATERIAL_SURFACES,
	DECOR_KIND_LAYERS,
	DECOR_MAX_VARIANTS,
	DECOR_MIN_OUTLINE_POINTS,
	DECOR_PARTICLE,
	DEFAULT_BIOME_MATERIAL,
	FX_ANIMATION,
	FX_SPRITE_MAX_TILES,
	MAX_ANIMATION_FPS,
	MAX_IMAGE_SIDE,
	PARTICLE_FLIPBOOK_GRIDS,
	PARTICLE_FLIPBOOK_MODES,
	SPRITE_FACING_COUNTS,
	SOUND_PITCH_LIMITS,
	SPRITE_RESAMPLE_MODES,
	boostId,
	boostStringKey,
	breakableId,
	decorAmbientId,
	decorAmbientRole,
	decorId,
	parseDecorId,
	requiredAnimationList,
	requiredBaseAnimations,
	slotFor,
	type BiomeId,
	type BiomeMaterial,
	type BiomeMaterialSurface,
	type BoostKind,
	type BreakableKind,
	type DecorKind,
	type DecorLayer,
	type ForgeTheme,
	type FxId,
	type SoundGroupName,
} from "./contract";
import { missingVisual, placeholderVisualFor, type PlaceholderColor, type PlaceholderVisual } from "./placeholders";
import { interpolate, type StringVars } from "./strings";
import {
	COLOR_ROLES,
	type AnimationDef,
	type AssetDef,
	type ColorRole,
	type HexColor,
	type ParticleFlipbook,
	type ParticleFlipbookMode,
	type PitchRange,
	type Pivot,
	type SpriteAnimationDef,
	type SpriteFacings,
	type SpriteSetAsset,
	type SpriteSheetImage,
} from "./types";
import { describeValue, isArrayLike, isInteger, isObj, sortedEntries, sortedKeys, type Obj } from "./util";

export const DEFAULT_PACK_ID = "placeholder";
export const MISSING_COLOR: HexColor = "#ff00ff";

/** Fallback cell for IDs outside every fixed-size slot (the source's 16 x 16 checkerboard). */
const FALLBACK_CELL = { w: 16, h: 16 };

/** UV rectangle of one frame, origin BOTTOM-left (the web build's three.js convention): offset (u, v), size (w, h). */
export interface FrameUV {
	u: number;
	v: number;
	w: number;
	h: number;
}

/** UV rect of the cell at (col, row), rows counted from the top of the sheet (source `frameUV`, kept for parity). */
export function frameUV(
	sheetW: number,
	sheetH: number,
	frameW: number,
	frameH: number,
	col: number,
	row: number,
): FrameUV {
	const w = frameW / sheetW;
	const h = frameH / sheetH;
	return { u: col * w, v: 1 - (row + 1) * h, w, h };
}

/** A frame in pixels, origin TOP-left (Roblox ImageRectOffset / ImageRectSize). */
export interface PixelRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Pixel rect of the cell at (col, row), rows counted from the top. No sheet size needed. */
export function frameRect(frameW: number, frameH: number, col: number, row: number): PixelRect {
	return { x: col * frameW, y: row * frameH, w: frameW, h: frameH };
}

/** Bottom-left UV (web) -> top-left pixel rect (Roblox): flips v. */
export function uvToPixelRect(uv: FrameUV, sheetW: number, sheetH: number): PixelRect {
	return { x: uv.u * sheetW, y: (1 - uv.v - uv.h) * sheetH, w: uv.w * sheetW, h: uv.h * sheetH };
}

/** Frame index for playback: wraps when looping, holds the last frame otherwise. */
export function frameIndex(anim: AnimationDef | SpriteAnimationDef, index: number): number {
	const i = math.max(0, math.floor(index));
	return anim.loop ? i % anim.frames : math.min(i, anim.frames - 1);
}

/** A sprite sheet's layout, without Roblox types. `assetId` is undefined for placeholders and missing IDs. */
export interface SheetLayout {
	readonly id: string;
	readonly assetId: string | undefined;
	readonly frameW: number;
	readonly frameH: number;
	/** Pixels from the cell's top-left (from the sprite contract). */
	readonly pivot: Readonly<Pivot>;
	readonly animations: Readonly<Record<string, AnimationDef>>;
	/** Animation names in order (contract order for placeholders, by row for real sheets). The first is the fallback. */
	readonly animationNames: ReadonlyArray<string>;
	/** Pixel rect (top-left origin) of frame `index` of `anim` (wrapped or held per its loop flag). */
	readonly frameRect: (anim: string, index: number) => PixelRect;
}

/** One frame of a sprite set: which sheet, and the cell's pixel rect there (top-left origin). */
export interface SpriteFrameRect {
	/** Index into the set's `sheets`. */
	readonly sheet: number;
	/** That sheet's uploaded image. */
	readonly assetId: string;
	/** That sheet's outline image (spriteSheetOutline), drawn under the frame with the same rect; undefined: no rim. */
	readonly outlineAssetId?: string;
	readonly x: number;
	readonly y: number;
	/** The cell size: the sheet's own with per-sheet cells (SpriteSheetImage.frameW / frameH), else the set's. */
	readonly w: number;
	readonly h: number;
}

/** One sheet's cell (sprite contract v2 per-sheet cells): its size and pivot, the set's where the sheet gives none. */
export interface SpriteCell {
	readonly frameW: number;
	readonly frameH: number;
	readonly pivot: Readonly<Pivot>;
}

/**
 * The cell of `sheet` in a set whose own cell is `set` (SpriteSheetImage.frameW / frameH / pivot, each defaulting to
 * the set's). Returns `set` itself when the sheet gives none of them.
 */
export function spriteSheetCell(set: SpriteCell, sheet: Readonly<SpriteSheetImage>): SpriteCell {
	if (sheet.frameW === undefined && sheet.frameH === undefined && sheet.pivot === undefined) return set;
	return { frameW: sheet.frameW ?? set.frameW, frameH: sheet.frameH ?? set.frameH, pivot: sheet.pivot ?? set.pivot };
}

/** Does any sheet of a manifest `sprites` def give its own cell (frameW / frameH / pivot)? */
function hasPerSheetCells(sheets: unknown): boolean {
	if (!isArrayLike(sheets)) return false;
	for (const sheet of sheets) {
		if (isObj(sheet) && (sheet.frameW !== undefined || sheet.frameH !== undefined || sheet.pivot !== undefined)) {
			return true;
		}
	}
	return false;
}

/**
 * A `sprites` asset's layout (sprite contract v2, `SpriteSetAsset` in types.ts), without Roblox types. Cell `c` of a
 * sheet sits at column `c % floor(sheet.w / frameW)`, row `floor(c / floor(sheet.w / frameW))`; frame `f` of facing
 * `d` of an animation is cell `start + d * (stride ?? frames) + f`.
 */
export interface SpriteSetLayout {
	readonly id: string;
	readonly frameW: number;
	readonly frameH: number;
	/** The feet, pixels from the cell's top-left. */
	readonly pivot: Readonly<Pivot>;
	/** Cell pixels per world tile (the billboard is frameW / pixelsPerTile tiles wide). */
	readonly pixelsPerTile: number;
	/** ImageLabel ResampleMode name. */
	readonly resample: SpriteSetAsset["resample"];
	/** Screen-space facings: facing d points at zeroDeg + d * 360 / count degrees (ccw: counter-clockwise). */
	readonly facings: Readonly<SpriteFacings>;
	readonly sheets: ReadonlyArray<Readonly<SpriteSheetImage>>;
	/** Animation names, sorted (deterministic). */
	readonly animationNames: ReadonlyArray<string>;
	/** Does the set define this animation (exact name, e.g. "attack.1")? */
	has(anim: string): boolean;
	/** The animation's definition, or undefined (no warning). */
	animation(anim: string): SpriteAnimationDef | undefined;
	/**
	 * Frame `index` of `anim` in `facing`. `facing` wraps modulo `facings.count` (negative too); `index` wraps when
	 * the animation loops and holds the last frame otherwise (`frameIndex`). Unknown `anim`: warn once, then play
	 * `idle` if the set has it, else the first name.
	 */
	frame(anim: string, facing: number, index: number): SpriteFrameRect;
	/**
	 * Sheet `sheet`'s cell (per-sheet cells, spriteSheetCell): its frameW / frameH / pivot, the set's where it gives
	 * none. The pivot of the cell `frame` returns is `cell(frame.sheet).pivot`.
	 */
	cell(sheet: number): SpriteCell;
}

/**
 * A sprite sheet's outline image (SpriteSheetImage.outlineAssetId), or undefined when it has none or the field is not a
 * string (a pack that failed validation still loads: its frames then draw without a rim, never with a bad Image).
 */
export function spriteSheetOutline(sheet: Readonly<SpriteSheetImage>): string | undefined {
	const id: unknown = sheet.outlineAssetId;
	return typeIs(id, "string") ? id : undefined;
}

/** Fallback for an unknown animation name in a sprite set (when it has one). */
const SPRITE_FALLBACK_ANIMATION = "idle";

const isFiniteNum = (v: unknown): v is number => typeIs(v, "number") && v === v && v !== math.huge && v !== -math.huge;
const isImageSidePx = (v: unknown): v is number => isInteger(v) && v >= 1 && v <= MAX_IMAGE_SIDE;

/** `{ x, y }` copied from a manifest point, or `fallback` when it is not one. */
function pointOr(p: unknown, fallback: Readonly<Pivot>): Pivot {
	return isObj(p) && isFiniteNum(p.x) && isFiniteNum(p.y) ? { x: p.x, y: p.y } : { x: fallback.x, y: fallback.y };
}

/** A decor outline's points (ImageAsset.outline), or undefined when it is not >= 3 finite `{ x, y }` points. */
function outlineOf(o: unknown): Array<Pivot> | undefined {
	if (!isArrayLike(o) || o.size() < DECOR_MIN_OUTLINE_POINTS) return undefined;
	const out = new Array<Pivot>();
	for (const p of o) {
		if (!isObj(p) || !isFiniteNum(p.x) || !isFiniteNum(p.y)) return undefined;
		out.push({ x: p.x, y: p.y });
	}
	return out;
}

/**
 * Why a `sprites` def cannot be drawn at all (its cell, pivot, density, resample, facings or sheets are unusable), or
 * undefined. The renderer would otherwise divide by a bad density or index a bad sheet at runtime.
 */
function spriteSetProblem(def: Obj): string | undefined {
	const { frameW, frameH, pivot, pixelsPerTile, resample, facings, sheets } = def;
	if (!isImageSidePx(frameW) || !isImageSidePx(frameH)) return "bad frameW / frameH";
	if (!isObj(pivot) || !isFiniteNum(pivot.x) || !isFiniteNum(pivot.y)) return "bad pivot";
	if (pivot.x < 0 || pivot.x > frameW || pivot.y < 0 || pivot.y > frameH) return "pivot outside the cell";
	if (!isFiniteNum(pixelsPerTile) || !(pixelsPerTile > 0)) return "pixelsPerTile must be > 0";
	if (!SPRITE_RESAMPLE_MODES.some((m) => m === resample)) return "bad resample";
	if (!isObj(facings) || !SPRITE_FACING_COUNTS.some((n) => n === facings.count)) return "bad facings.count";
	if (!isFiniteNum(facings.zeroDeg) || !typeIs(facings.ccw, "boolean")) return "bad facings";
	if (!isArrayLike(sheets) || sheets.size() === 0) return "no sheets";
	for (const sheet of sheets) {
		if (!isObj(sheet) || !typeIs(sheet.assetId, "string")) return "bad sheet";
		// per-sheet cells: each field optional, defaulting to the set's
		const cw = sheet.frameW ?? frameW;
		const ch = sheet.frameH ?? frameH;
		if (!isImageSidePx(cw) || !isImageSidePx(ch)) return "bad sheet frameW / frameH";
		const p = sheet.pivot ?? pivot;
		if (!isObj(p) || !isFiniteNum(p.x) || !isFiniteNum(p.y)) return "bad sheet pivot";
		if (p.x < 0 || p.x > cw || p.y < 0 || p.y > ch) return "sheet pivot outside its cell";
		if (!isImageSidePx(sheet.w) || !isImageSidePx(sheet.h) || sheet.w < cw || sheet.h < ch) {
			return "bad sheet size";
		}
	}
	return undefined;
}

/**
 * Why one animation of a drawable set cannot be drawn, or undefined: integer fields, a sheet that exists, a stride
 * that keeps facings apart (>= frames when there are several), fps in (0, MAX_ANIMATION_FPS], and every referenced
 * cell (all facings, all frames) inside its sheet.
 */
function spriteAnimationProblem(
	a: unknown,
	sheets: ReadonlyArray<Readonly<SpriteSheetImage>>,
	cell: SpriteCell,
	facingCount: number,
): string | undefined {
	if (!isObj(a)) return "not an object";
	if (!isInteger(a.sheet) || a.sheet < 0 || a.sheet >= sheets.size()) return "bad sheet index";
	if (!isInteger(a.start) || a.start < 0 || !isInteger(a.frames) || a.frames < 1) return "bad start / frames";
	const stride = a.stride === undefined ? a.frames : a.stride;
	if (!isInteger(stride) || stride < 1) return "bad stride";
	if (facingCount > 1 && stride < a.frames) return "stride < frames (facings would overlap)";
	if (!isFiniteNum(a.fps) || !(a.fps > 0) || a.fps > MAX_ANIMATION_FPS) return "bad fps";
	if (!typeIs(a.loop, "boolean")) return "bad loop";
	const sheet = sheets[a.sheet];
	const c = spriteSheetCell(cell, sheet);
	const capacity = math.floor(sheet.w / c.frameW) * math.floor(sheet.h / c.frameH);
	const lastCell = a.start + (facingCount - 1) * stride + a.frames - 1;
	if (lastCell >= capacity) return `cell ${lastCell} is outside sheet ${a.sheet} (${capacity} cells)`;
	return undefined;
}

class SpriteSetLayoutImpl implements SpriteSetLayout {
	readonly animationNames: ReadonlyArray<string>;
	private readonly fallback: string;
	/** The set's own cell, the default of every sheet's (spriteSheetCell). */
	private readonly ownCell: SpriteCell;

	constructor(
		readonly id: string,
		readonly frameW: number,
		readonly frameH: number,
		readonly pivot: Readonly<Pivot>,
		readonly pixelsPerTile: number,
		readonly resample: SpriteSetAsset["resample"],
		readonly facings: Readonly<SpriteFacings>,
		readonly sheets: ReadonlyArray<Readonly<SpriteSheetImage>>,
		private readonly animations: Readonly<Record<string, SpriteAnimationDef>>,
		private readonly warnOnce: (key: string, msg: string) => void,
	) {
		const names = sortedKeys(animations);
		this.animationNames = names;
		this.fallback = animations[SPRITE_FALLBACK_ANIMATION] !== undefined ? SPRITE_FALLBACK_ANIMATION : names[0];
		this.ownCell = { frameW, frameH, pivot };
	}

	has(anim: string): boolean {
		return this.animations[anim] !== undefined;
	}

	animation(anim: string): SpriteAnimationDef | undefined {
		return this.animations[anim];
	}

	cell(sheet: number): SpriteCell {
		return spriteSheetCell(this.ownCell, this.sheets[sheet]);
	}

	frame(anim: string, facing: number, index: number): SpriteFrameRect {
		let a = this.animations[anim];
		if (a === undefined) {
			this.warnOnce(
				`anim:${this.id}:${anim}`,
				`sprite set "${this.id}" has no animation "${anim}", using "${this.fallback}"`,
			);
			a = this.animations[this.fallback];
		}
		const count = this.facings.count;
		const d = ((math.floor(facing) % count) + count) % count;
		const cell = a.start + d * (a.stride ?? a.frames) + frameIndex(a, index);
		const sheet = this.sheets[a.sheet];
		const c = spriteSheetCell(this.ownCell, sheet);
		const perRow = math.floor(sheet.w / c.frameW);
		return {
			sheet: a.sheet,
			assetId: sheet.assetId,
			outlineAssetId: spriteSheetOutline(sheet),
			x: (cell % perRow) * c.frameW,
			y: math.floor(cell / perRow) * c.frameH,
			w: c.frameW,
			h: c.frameH,
		};
	}
}

/** An uploaded image (ThemeCore.image): its asset ID and pixel size. */
export interface ImageRef {
	readonly assetId: string;
	readonly w: number;
	readonly h: number;
	/** Repeating tile textures only: world tiles the image spans per side. */
	readonly tilesPerImage: number | undefined;
	/** ui.* images only: the anchor point, pixels from the top-left (undefined: the renderer's default). */
	readonly pivot: Readonly<Pivot> | undefined;
}

/**
 * Free-size world art (decor pieces and effects, breakables; docs/DECOR.md): an uploaded image region or a sprite set.
 * Billboard size in tiles = pixel size / pixelsPerTile.
 */
export type WorldArt = WorldImageArt | WorldSpriteArt;

export interface WorldImageArt {
	readonly kind: "image";
	readonly assetId: string;
	/** The whole uploaded image, pixels. */
	readonly w: number;
	readonly h: number;
	/** The region drawn (ImageRectOffset / ImageRectSize), pixels, top-left origin: `rect`, or the whole image. */
	readonly rect: Readonly<PixelRect>;
	/** The point placed on the ground spot, pixels from the rect's top-left (default: bottom centre; centre when flat). */
	readonly pivot: Readonly<Pivot>;
	/** Art pixels per world tile. */
	readonly pixelsPerTile: number;
}

export interface WorldSpriteArt {
	readonly kind: "sprites";
	/** The set (its own cell, pivot, pixelsPerTile, facings and animations: `idle`, plus e.g. `lit`, `shatter`). */
	readonly set: SpriteSetLayout;
}

/** A decor piece (decor.delve.*) or effect (decor.fx.<torch|flame|glow|glint|zone>) a pack has art for. */
export interface DecorArt {
	readonly id: string;
	/** Pieces: how and where it is drawn. Effects: undefined (they attach to a piece or a spot). */
	readonly layer: DecorLayer | undefined;
	/** A light source: flames go on it, the glow sprite under it, the light pool may pick it. */
	readonly glow: boolean;
	/** Where the flame / glow attaches, pixels from the rect's (image) or cell's (sprites) top-left: the pivot unless set. */
	readonly glowAt: Readonly<Pivot>;
	/** Self-lit: full brightness, no world lighting, no depth-band dimming. */
	readonly emissive: boolean;
	readonly art: WorldArt;
	/**
	 * Pieces: the outline per facing (an image's one outline serves every facing), pixels of the rect / cell, or
	 * undefined when the pack gives none (or a malformed one): the footprint fit then holds the whole rect / cell.
	 */
	readonly outlines?: ReadonlyArray<ReadonlyArray<Readonly<Pivot>>>;
}

/** A biome's ambient particle (decor.fx.ambient.b<n>): texture, look (clamped to DECOR_PARTICLE) and colour role. */
export interface AmbientParticleArt {
	readonly id: string;
	/** ParticleEmitter.Texture. */
	readonly assetId: string;
	/** ParticleEmitter.Size, studs: the pack's `particle.sizeStuds` (or the default), at most DECOR_PARTICLE.maxSizeStuds. */
	readonly sizeStuds: number;
	/** ParticleEmitter.Transparency: the pack's (or the default), at least DECOR_PARTICLE.minTransparency. */
	readonly transparency: number;
	/** LightEmission 1 when set (embers, wisps). */
	readonly emissive: boolean;
	/** The tint: `decor.fx.ambient.b<n>`. */
	readonly role: ColorRole;
	/** The texture's flipbook (docs/FX_AUDIO.md F6), or undefined: one still frame (also for a malformed one). */
	readonly flipbook: Readonly<ParticleFlipbook> | undefined;
}

/** A breakable kind's theme (docs/DECOR.md D4): always drawable, art or placeholder. */
export interface BreakableTheme {
	readonly kind: BreakableKind;
	/** Asset ID, also the colour role: `breakable.crate`. */
	readonly id: string;
	readonly role: ColorRole;
	/** String-table key of its name: `breakable.crate.name`. */
	readonly nameKey: string;
	/** Uploaded art, or undefined: draw `placeholder`. */
	readonly art: WorldArt | undefined;
	/** The placeholder primitive (a low box; magenta when the pack lacks the ID). */
	readonly placeholder: PlaceholderVisual;
}

/** A boost kind's theme (docs/BOOSTS.md B5): always drawable, art or placeholder, plus its strings. */
export interface BoostTheme {
	readonly kind: BoostKind;
	/** Asset ID, also the colour role: `boost.fury`. */
	readonly id: string;
	readonly role: ColorRole;
	/** String-table keys: `boost.fury.name`, `.desc`, `.icon`. */
	readonly nameKey: string;
	readonly descKey: string;
	readonly iconKey: string;
	/** Uploaded art, or undefined: draw `placeholder`. */
	readonly art: WorldArt | undefined;
	/** The placeholder primitive (a small gem; magenta when the pack lacks the ID). */
	readonly placeholder: PlaceholderVisual;
}

export interface BiomeTheme {
	readonly id: string;
	readonly forgeTheme: ForgeTheme | undefined;
	/** String-table key of the place name; pass to str(). */
	readonly nameKey: string;
	readonly floor: HexColor;
	readonly wall: HexColor;
	readonly tiles: { readonly floor: string; readonly wall: string };
	/** Roblox material (`Enum.Material` name) per surface; DEFAULT_BIOME_MATERIAL where the pack names none. */
	readonly materials: Readonly<Record<BiomeMaterialSurface, BiomeMaterial>>;
}

const BIOME_MATERIAL_SET: ReadonlySet<string> = new Set<string>(BIOME_MATERIALS);
const DEFAULT_MATERIALS: Readonly<Record<BiomeMaterialSurface, BiomeMaterial>> = {
	floor: DEFAULT_BIOME_MATERIAL,
	wall: DEFAULT_BIOME_MATERIAL,
	pool: DEFAULT_BIOME_MATERIAL,
};

export interface SoundRef {
	/** undefined: silent or missing. */
	readonly assetId: string | undefined;
	/** 0..1 mix level (0 when silent). */
	readonly volume: number;
	/** The SoundGroup to play it through. */
	readonly group: SoundGroupName;
	/** Extra clips of the event: the clip pool is `[assetId, ...variants]` (round-robin). Empty when none or silent. */
	readonly variants: ReadonlyArray<string>;
	/** PlaybackSpeed jitter `[min, max]`, inside SOUND_PITCH_LIMITS; undefined: none (play at 1). */
	readonly pitch: Readonly<PitchRange> | undefined;
	/** Shortest gap between two starts, seconds, overriding the audio layer's default; undefined: the default. */
	readonly minInterval: number | undefined;
}

/**
 * A sprite effect (fx.*, docs/FX_AUDIO.md F1) a pack has art for: a one-facing sprite set and how to draw it. Size:
 * the cell's longer side is drawn `sizeTiles` tiles (the other side keeps the cell's aspect: widthTiles x heightTiles).
 */
export interface FxArt {
	readonly id: FxId;
	/** The set (one facing); its FX_ANIMATION (`play`) animation is the flipbook. */
	readonly set: SpriteSetLayout;
	/** The flipbook's frame count, presentation frame rate and loop flag (one-shots hold the last frame). */
	readonly frames: number;
	readonly fps: number;
	readonly loop: boolean;
	/** Drawn size of the longer cell side, tiles: `sizeTiles`, or that side / pixelsPerTile; at most FX_SPRITE_MAX_TILES. */
	readonly sizeTiles: number;
	readonly widthTiles: number;
	readonly heightTiles: number;
	/** The colour role multiplied in (ImageColor3), or undefined: the sheet's own colours. */
	readonly tint: ColorRole | undefined;
	/** A brighter, self-lit blend (LightInfluence 0). */
	readonly additive: boolean;
}

const NO_VARIANTS: ReadonlyArray<string> = [];
const COLOR_ROLE_SET: ReadonlySet<string> = new Set<string>(COLOR_ROLES);

export interface ThemeCoreOptions {
	/** Active locale; strings fall back to the default table. */
	locale?: string;
	/** Validator errors found at load (kept for debug overlays). */
	problems?: ReadonlyArray<string>;
	/** Where warnings go (default: Roblox `warn`). Each distinct problem is reported once. */
	warn?: (message: string) => void;
}

const defaultWarn = (message: string) => warn(message);

export class ThemeCore {
	readonly id: string;
	readonly name: string;
	readonly locale: string | undefined;
	readonly problems: ReadonlyArray<string>;

	private readonly assets: Obj;
	private readonly strings: Obj;
	private readonly localeStrings: Obj;
	private readonly colorHex: Partial<Record<ColorRole, HexColor>> = {};
	private readonly biomes: Obj;
	private readonly sheets = new Map<string, SheetLayout>();
	private readonly spriteSets = new Map<string, SpriteSetLayout>();
	/** Decor lookups, misses included (`false`). */
	private readonly decorArt = new Map<string, DecorArt | false>();
	/** Sprite-effect lookups, misses included (`false`). */
	private readonly fxArt = new Map<string, FxArt | false>();
	private readonly soundRefs = new Map<string, SoundRef>();
	private readonly warned = new Set<string>();
	private readonly warnSink: (message: string) => void;

	/** Defensive: a manifest that failed validation still loads; bad entries fall back individually. */
	constructor(manifest: unknown, opts: ThemeCoreOptions = {}) {
		const m: Obj = isObj(manifest) ? manifest : {};
		this.id = typeIs(m.id, "string") ? m.id : "unknown";
		this.name = typeIs(m.name, "string") ? m.name : this.id;
		this.locale = opts.locale;
		this.problems = opts.problems ?? [];
		this.warnSink = opts.warn ?? defaultWarn;
		this.assets = isObj(m.assets) ? m.assets : {};
		this.strings = isObj(m.strings) ? m.strings : {};
		const locales = isObj(m.locales) ? m.locales : {};
		const localeTable = opts.locale !== undefined ? locales[opts.locale] : undefined;
		this.localeStrings = isObj(localeTable) ? localeTable : {};
		this.biomes = isObj(m.biomes) ? m.biomes : {};
		const colors = isObj(m.colors) ? m.colors : {};
		for (const r of COLOR_ROLES) {
			const hex = colors[r];
			if (isHexColor(hex)) {
				this.colorHex[r] = hex;
			}
		}
	}

	/** Report a problem once per key. */
	warnOnce(key: string, msg: string): void {
		if (this.warned.has(key)) {
			return;
		}
		this.warned.add(key);
		this.warnSink(`[theme:${this.id}] ${msg}`);
	}

	// --- assets --------------------------------------------------------------------------------

	/** Is this logical asset ID defined by the pack? */
	has(id: string): boolean {
		return isObj(this.assets[id]);
	}

	private asset(id: string): AssetDef | undefined {
		const def = this.assets[id];
		return isObj(def) && typeIs(def.kind, "string") ? (def as unknown as AssetDef) : undefined;
	}

	/**
	 * The uploaded image for a visual ID, or undefined when it is a placeholder (draw
	 * `placeholder(id)` instead). Missing: warn once, undefined. A `sprites` asset (several sheets) has no single
	 * image: undefined without a warning; read it through `sprites(id)`.
	 */
	texture(id: string): string | undefined {
		const def = this.asset(id);
		if (def === undefined) {
			this.warnOnce(`asset:${id}`, `missing asset "${id}", using the placeholder`);
			return undefined;
		}
		switch (def.kind) {
			case "image":
			case "spritesheet":
				return def.assetId;
			case "placeholder":
			case "sprites":
				return undefined;
			default:
				this.warnOnce(`kind:${id}`, `asset "${id}" is a ${def.kind}, not an image; using the placeholder`);
				return undefined;
		}
	}

	/**
	 * An uploaded `image` asset with its size (and `tilesPerImage` for a repeating tile texture, `pivot` for a ui image
	 * anchored at a point), or undefined for a
	 * placeholder, any other kind or a missing ID. Never warns: callers use it for optional art (a floor texture, the
	 * co-op ring) and keep their placeholder path when it is undefined.
	 */
	image(id: string): ImageRef | undefined {
		const def = this.asset(id);
		if (def === undefined || def.kind !== "image") return undefined;
		const pivot = def.pivot !== undefined ? { x: def.pivot.x, y: def.pivot.y } : undefined;
		return { assetId: def.assetId, w: def.w, h: def.h, tilesPerImage: def.tilesPerImage, pivot };
	}

	/**
	 * Sheet layout for an animated asset ID. Placeholders and stills become one-frame sheets. Cached. A `sprites`
	 * asset gets the placeholder layout (assetId undefined, the slot's contract cells), so callers that only know
	 * `spriteSheet` keep drawing the placeholder; sprite-aware callers use `sprites(id)` first.
	 */
	sheet(id: string): SheetLayout {
		const cached = this.sheets.get(id);
		if (cached !== undefined) {
			return cached;
		}
		const layout = this.createSheet(id);
		this.sheets.set(id, layout);
		return layout;
	}

	private createSheet(id: string): SheetLayout {
		const assetId = this.texture(id);
		const def = this.asset(id);
		const slot = slotFor(id);

		let frameW: number;
		let frameH: number;
		let pivot: Pivot;
		const animations: Record<string, AnimationDef> = {};
		const names = new Array<string>();

		if (def !== undefined && def.kind === "spritesheet" && isObj(def.animations)) {
			frameW = def.frameW;
			frameH = def.frameH;
			pivot = isObj(def.pivot)
				? def.pivot
				: slot?.pivot ?? { x: math.floor(frameW / 2), y: math.floor(frameH / 2) };
			const entries = sortedEntries(def.animations).filter((e) => isObj(e[1])) as Array<[string, AnimationDef]>;
			entries.sort((a, b) => (a[1].row !== b[1].row ? a[1].row < b[1].row : a[0] < b[0]));
			for (const [name, a] of entries) {
				animations[name] = a;
				names.push(name);
			}
		} else {
			// One static frame per row; a placeholder in a directional slot has one row per facing,
			// so code that picks `run.left` lines up with the art that replaces it.
			const cell =
				def !== undefined && def.kind === "image" ? { w: def.w, h: def.h } : slot?.cell ?? FALLBACK_CELL;
			frameW = cell.w;
			frameH = cell.h;
			pivot = slot?.pivot ?? { x: math.floor(frameW / 2), y: math.floor(frameH / 2) };
			const placeholderLike = def?.kind === "placeholder" || def?.kind === "sprites";
			const directional = placeholderLike && slot !== undefined && slot.facings.size() > 0;
			for (const req of slot !== undefined ? requiredAnimationList(slot) : []) {
				const facing = req.name.split(".")[1];
				const row = directional ? math.max(0, (slot.facings as ReadonlyArray<string>).indexOf(facing)) : 0;
				animations[req.name] = { row, frames: 1, fps: 1, loop: true };
				names.push(req.name);
			}
		}

		if (names.size() === 0) {
			animations.default = { row: 0, frames: 1, fps: 1, loop: true };
			names.push("default");
		}
		const first = names[0];
		return {
			id,
			assetId,
			frameW,
			frameH,
			pivot,
			animations,
			animationNames: names,
			frameRect: (anim, index) => {
				let a = animations[anim];
				if (a === undefined) {
					this.warnOnce(`anim:${id}:${anim}`, `sprite "${id}" has no animation "${anim}", using "${first}"`);
					a = animations[first];
				}
				return frameRect(frameW, frameH, frameIndex(a, index), a.row);
			},
		};
	}

	/**
	 * Layout of a `sprites` asset (sprite contract v2), cached. Undefined, without a warning, when the asset is any
	 * other kind (draw `placeholder(id)` / `sheet(id)` instead). Missing ID: warn once (like every lookup), undefined.
	 * A sprites asset too malformed to draw (createSpriteSet: bad cell, pivot, density, facings or sheets, or a required
	 * animation unusable) warns once, undefined; a bad optional animation is dropped (warned once).
	 */
	sprites(id: string): SpriteSetLayout | undefined {
		const cached = this.spriteSets.get(id);
		if (cached !== undefined) {
			return cached;
		}
		const def = this.asset(id);
		if (def === undefined) {
			this.warnOnce(`asset:${id}`, `missing asset "${id}", using the placeholder`);
			return undefined;
		}
		if (def.kind !== "sprites") {
			return undefined;
		}
		const layout = this.createSpriteSet(id, def as unknown as Obj); // warns once when undefined
		if (layout !== undefined) this.spriteSets.set(id, layout);
		return layout;
	}

	/**
	 * A drawable layout, or undefined (warned once, with the reason): a set-level problem rejects the set; a bad
	 * animation is dropped (warned once) unless it is one of the slot's required base animations, which rejects the set.
	 * The validator reports the same problems at load; this keeps a pack that failed validation from erroring later.
	 */
	private createSpriteSet(id: string, def: Obj): SpriteSetLayout | undefined {
		const reject = (reason: string) => {
			this.warnOnce(`sprites:${id}`, `sprite set "${id}" is malformed (${reason}), using the placeholder`);
			return undefined;
		};
		const problem = spriteSetProblem(def);
		if (problem !== undefined) return reject(problem);
		const slot = slotFor(id);
		if (hasPerSheetCells(def.sheets) && slot?.perSheetCells !== true) {
			return reject("per-sheet cells (sheets[i].frameW / frameH / pivot) outside an actor slot");
		}
		const frameW = def.frameW as number;
		const frameH = def.frameH as number;
		const setCell: SpriteCell = { frameW, frameH, pivot: def.pivot as unknown as Pivot };
		const facings = def.facings as unknown as SpriteFacings;
		const sheets = def.sheets as unknown as ReadonlyArray<Readonly<SpriteSheetImage>>;
		sheets.forEach((sheet, i) => {
			if (sheet.outlineAssetId !== undefined && spriteSheetOutline(sheet) === undefined) {
				this.warnOnce(
					`sprites:${id}:outline:${i}`,
					`sprite set "${id}" sheet ${i} has a bad outlineAssetId, drawing it without a rim`,
				);
			}
		});
		const animations: Record<string, SpriteAnimationDef> = {};
		const required = slot !== undefined ? requiredBaseAnimations(slot) : [];
		if (isObj(def.animations)) {
			for (const [name, a] of sortedEntries(def.animations)) {
				const bad = spriteAnimationProblem(a, sheets, setCell, facings.count);
				if (bad === undefined) {
					animations[name] = a as unknown as SpriteAnimationDef;
				} else if (required.includes(name)) {
					return reject(`animation "${name}": ${bad}`);
				} else {
					this.warnOnce(`sprites:${id}:${name}`, `sprite set "${id}" drops animation "${name}" (${bad})`);
				}
			}
		}
		for (const name of required) {
			if (animations[name] === undefined) return reject(`missing animation "${name}"`);
		}
		if (sortedKeys(animations).size() === 0) return reject("no animations");
		return new SpriteSetLayoutImpl(
			id,
			frameW,
			frameH,
			def.pivot as unknown as Pivot,
			def.pixelsPerTile as number,
			def.resample as SpriteSetAsset["resample"],
			facings,
			sheets,
			animations,
			(key, msg) => this.warnOnce(key, msg),
		);
	}

	// --- world art: decor and breakables (Roblox port, docs/DECOR.md) ------------------------------

	/**
	 * An `image` (decor.* / breakable.*) or `sprites` asset as world art, or undefined (warned once) when it is too
	 * malformed to draw: no assetId, a bad size, `rect` or `pixelsPerTile`, or a sprite set ThemeCore.sprites rejects.
	 * `flatPivot`: the default pivot is the centre (flat pieces, effects) instead of the bottom centre.
	 */
	private worldArt(id: string, def: AssetDef, flatPivot: boolean): WorldArt | undefined {
		if (def.kind === "sprites") {
			const set = this.sprites(id);
			return set !== undefined ? { kind: "sprites", set } : undefined;
		}
		if (def.kind !== "image") {
			return undefined;
		}
		const d = def as unknown as Obj;
		const reject = (reason: string) => {
			this.warnOnce(`world:${id}`, `art "${id}" is malformed (${reason}), not drawn`);
			return undefined;
		};
		if (!typeIs(d.assetId, "string")) return reject("no assetId");
		if (!isImageSidePx(d.w) || !isImageSidePx(d.h)) return reject("bad w / h");
		if (!isFiniteNum(d.pixelsPerTile) || !(d.pixelsPerTile > 0)) return reject("pixelsPerTile must be > 0");
		let rect: PixelRect = { x: 0, y: 0, w: d.w, h: d.h };
		if (d.rect !== undefined) {
			const r = d.rect;
			if (!isObj(r) || !isInteger(r.x) || !isInteger(r.y) || !isInteger(r.w) || !isInteger(r.h)) {
				return reject("bad rect");
			}
			if (r.x < 0 || r.y < 0 || r.w < 1 || r.h < 1 || r.x + r.w > d.w || r.y + r.h > d.h) {
				return reject("rect outside the image");
			}
			rect = { x: r.x, y: r.y, w: r.w, h: r.h };
		}
		const fallback = flatPivot ? { x: rect.w / 2, y: rect.h / 2 } : { x: rect.w / 2, y: rect.h };
		return {
			kind: "image",
			assetId: d.assetId,
			w: d.w,
			h: d.h,
			rect,
			pivot: pointOr(d.pivot, fallback),
			pixelsPerTile: d.pixelsPerTile,
		};
	}

	/**
	 * A decor piece (decor.delve.*) or effect (decor.fx.<torch|flame|glow|glint|zone>), or undefined: decor is
	 * optional, so an ID the pack does not define is undefined WITHOUT a warning (nothing is drawn). Cached. Art too
	 * malformed to draw (see worldArt; a piece whose layer is missing or not allowed for its kind) warns once and is
	 * undefined. Ambient textures go through `ambient(biome)`.
	 */
	decor(id: string): DecorArt | undefined {
		const cached = this.decorArt.get(id);
		if (cached !== undefined) {
			return cached === false ? undefined : cached;
		}
		const art = this.createDecor(id);
		this.decorArt.set(id, art ?? false);
		return art;
	}

	private createDecor(id: string): DecorArt | undefined {
		const def = this.asset(id);
		if (def === undefined) {
			return undefined;
		}
		const info = parseDecorId(id);
		if (info === undefined || info.type === "ambient") {
			this.warnOnce(`decor:${id}`, `"${id}" is not a decor piece or effect ID, not drawn`);
			return undefined;
		}
		if (def.kind !== "image" && def.kind !== "sprites") {
			this.warnOnce(`decor:${id}`, `decor "${id}" is a ${def.kind}, not an image or sprites; not drawn`);
			return undefined;
		}
		const d = def as unknown as Obj;
		let layer: DecorLayer | undefined;
		if (info.type === "piece") {
			const allowed = DECOR_KIND_LAYERS[info.kind] as ReadonlyArray<string>;
			if (!typeIs(d.layer, "string") || !allowed.includes(d.layer)) {
				this.warnOnce(
					`decor:${id}`,
					`decor "${id}" has layer ${describeValue(d.layer)}, ${info.kind} allows ${allowed.join(
						" | ",
					)}; not drawn`,
				);
				return undefined;
			}
			layer = d.layer as DecorLayer;
		}
		const art = this.worldArt(id, def, layer === undefined || layer === "flat");
		if (art === undefined) {
			return undefined; // worldArt warned
		}
		const pivot = art.kind === "image" ? art.pivot : art.set.pivot;
		const glow = d.glow === true;
		return {
			id,
			layer,
			glow,
			glowAt: glow ? pointOr(d.glowAt, pivot) : pivot,
			emissive: d.emissive === true,
			art,
			outlines: layer !== undefined ? this.decorOutlines(id, d, art) : undefined,
		};
	}

	/** A piece's outlines (DecorArt.outlines): an image's `outline`, a sprite set's per-facing `outlines`. */
	private decorOutlines(id: string, d: Obj, art: WorldArt): Array<Array<Pivot>> | undefined {
		const raw = art.kind === "image" ? d.outline : d.outlines;
		if (raw === undefined) return undefined;
		const out = new Array<Array<Pivot>>();
		if (art.kind === "image") {
			const o = outlineOf(raw);
			if (o !== undefined) out.push(o);
		} else if (isArrayLike(raw) && raw.size() === art.set.facings.count) {
			for (const facing of raw) {
				const o = outlineOf(facing);
				if (o === undefined) break;
				out.push(o);
			}
		}
		if (out.size() === 0 || (art.kind === "sprites" && out.size() !== art.set.facings.count)) {
			this.warnOnce(`outline:${id}`, `decor "${id}" has a malformed outline, held by its rectangle instead`);
			return undefined;
		}
		return out;
	}

	/**
	 * Every piece of `kind` the pack has for `biome`, in ID order: the base ID `decor.delve.b<n>.<kind>`, then the
	 * variants `.1` .. `.DECOR_MAX_VARIANTS`. Empty (no warning) when it has none: draw nothing. A renderer picks one
	 * per cell by hash, so every client draws the same floor.
	 */
	decorVariants(biome: BiomeId, kind: DecorKind): Array<DecorArt> {
		const out = new Array<DecorArt>();
		const base = this.decor(decorId(biome, kind));
		if (base !== undefined) out.push(base);
		for (let v = 1; v <= DECOR_MAX_VARIANTS; v++) {
			const art = this.decor(decorId(biome, kind, v));
			if (art !== undefined) out.push(art);
		}
		return out;
	}

	/**
	 * A biome's ambient particle (decor.fx.ambient.b<n>), or undefined (no warning) when the pack has none: no
	 * particles. Size and transparency default to DECOR_PARTICLE and are clamped to its caps whatever the pack says.
	 */
	ambient(biome: BiomeId): AmbientParticleArt | undefined {
		const id = decorAmbientId(biome);
		const def = this.asset(id);
		if (def === undefined) {
			return undefined;
		}
		const d = def as unknown as Obj;
		if (def.kind !== "image" || !typeIs(d.assetId, "string")) {
			this.warnOnce(`ambient:${id}`, `ambient particle "${id}" is not an uploaded image, not drawn`);
			return undefined;
		}
		const particle: Obj = isObj(d.particle) ? d.particle : {};
		const size = isFiniteNum(particle.sizeStuds) && particle.sizeStuds > 0 ? particle.sizeStuds : undefined;
		const t = isFiniteNum(particle.transparency) ? particle.transparency : undefined;
		const fb: Obj | undefined = isObj(particle.flipbook) ? particle.flipbook : undefined;
		let flipbook: ParticleFlipbook | undefined;
		if (
			fb !== undefined &&
			PARTICLE_FLIPBOOK_GRIDS.includes(fb.grid as number) &&
			isFiniteNum(fb.fps) &&
			fb.fps > 0 &&
			PARTICLE_FLIPBOOK_MODES.some((m) => m === fb.mode)
		) {
			flipbook = {
				grid: fb.grid as number,
				fps: math.min(fb.fps, MAX_ANIMATION_FPS),
				mode: fb.mode as ParticleFlipbookMode,
			};
		} else if (fb !== undefined) {
			this.warnOnce(
				`ambient:${id}:flipbook`,
				`ambient particle "${id}" has a malformed flipbook, using one frame`,
			);
		}
		return {
			id,
			assetId: d.assetId,
			sizeStuds: math.min(size ?? DECOR_PARTICLE.defaultSizeStuds, DECOR_PARTICLE.maxSizeStuds),
			transparency: math.clamp(t ?? DECOR_PARTICLE.defaultTransparency, DECOR_PARTICLE.minTransparency, 1),
			emissive: d.emissive === true,
			role: decorAmbientRole(biome),
			flipbook,
		};
	}

	/**
	 * A breakable kind: its uploaded art (an image with pixelsPerTile, or a sprite set with `idle` and an optional
	 * `shatter`), else its placeholder box. Missing ID (required in every pack): warn once, the magenta block.
	 */
	breakable(kind: BreakableKind): BreakableTheme {
		const id = breakableId(kind);
		const def = this.asset(id);
		const art = def !== undefined ? this.worldArt(id, def, false) : undefined;
		return {
			kind,
			id,
			role: id,
			nameKey: `${id}.name`,
			art,
			placeholder: this.placeholder(id),
		};
	}

	/**
	 * A boost kind (docs/BOOSTS.md B5): its uploaded art (an image with pixelsPerTile, or a sprite set with `idle`),
	 * else its placeholder gem. Missing ID (required in every pack): warn once, the magenta block.
	 */
	boost(kind: BoostKind): BoostTheme {
		const id = boostId(kind);
		const def = this.asset(id);
		const art = def !== undefined ? this.worldArt(id, def, false) : undefined;
		return {
			kind,
			id,
			role: id,
			nameKey: boostStringKey(kind, "name"),
			descKey: boostStringKey(kind, "desc"),
			iconKey: boostStringKey(kind, "icon"),
			art,
			placeholder: this.placeholder(id),
		};
	}

	/**
	 * What to build while an ID has no art: its placeholder visual. Missing ID: warn once, a magenta
	 * block the size of the slot's cell (the source's checkerboard).
	 */
	placeholder(id: string): PlaceholderVisual {
		if (!this.has(id)) {
			this.warnOnce(`asset:${id}`, `missing asset "${id}", using the placeholder`);
			return missingVisual(id);
		}
		const v = placeholderVisualFor(id);
		if (v === undefined) {
			this.warnOnce(`placeholder:${id}`, `no placeholder visual for "${id}", using the missing block`);
			return missingVisual(id);
		}
		return v;
	}

	/**
	 * Audio event -> uploaded sound (assetId undefined when silent or missing), its SoundGroup and its extras
	 * (variants, pitch jitter, minimum interval). Cached. A malformed extra (a variant that is not a string, a bad
	 * pitch or minInterval) warns once and is left out; a pitch is clamped to SOUND_PITCH_LIMITS.
	 */
	sound(id: string): SoundRef {
		const cached = this.soundRefs.get(id);
		if (cached !== undefined) {
			return cached;
		}
		const ref = this.createSound(id);
		this.soundRefs.set(id, ref);
		return ref;
	}

	private createSound(id: string): SoundRef {
		const group: SoundGroupName = slotFor(id)?.soundGroup ?? "sfx";
		const silent: SoundRef = {
			assetId: undefined,
			volume: 0,
			group,
			variants: NO_VARIANTS,
			pitch: undefined,
			minInterval: undefined,
		};
		const def = this.asset(id);
		if (def === undefined) {
			this.warnOnce(`asset:${id}`, `missing audio event "${id}", staying silent`);
			return silent;
		}
		if (def.kind === "silent") {
			return silent;
		}
		if (def.kind !== "sound") {
			this.warnOnce(`kind:${id}`, `asset "${id}" is a ${def.kind}, not a sound`);
			return silent;
		}
		const d = def as unknown as Obj;
		const variants = new Array<string>();
		if (isArrayLike(d.variants)) {
			for (const v of d.variants) {
				if (typeIs(v, "string") && v !== "") {
					variants.push(v);
				} else {
					this.warnOnce(`variant:${id}`, `sound "${id}" drops a variant that is not an asset ID`);
				}
			}
		}
		let pitch: PitchRange | undefined;
		const p = d.pitch;
		if (p !== undefined) {
			const lo: unknown = isArrayLike(p) ? p[0] : undefined;
			const hi: unknown = isArrayLike(p) ? p[1] : undefined;
			if (isFiniteNum(lo) && isFiniteNum(hi) && lo <= hi) {
				pitch = [
					math.clamp(lo, SOUND_PITCH_LIMITS.min, SOUND_PITCH_LIMITS.max),
					math.clamp(hi, SOUND_PITCH_LIMITS.min, SOUND_PITCH_LIMITS.max),
				];
			} else {
				this.warnOnce(`pitch:${id}`, `sound "${id}" has pitch ${describeValue(p)}, playing without jitter`);
			}
		}
		let minInterval: number | undefined;
		const gap = d.minInterval;
		if (gap !== undefined) {
			if (isFiniteNum(gap) && gap >= 0) {
				minInterval = gap;
			} else {
				this.warnOnce(
					`interval:${id}`,
					`sound "${id}" has minInterval ${describeValue(gap)}, using the default`,
				);
			}
		}
		return {
			assetId: def.assetId,
			volume: def.volume ?? 1,
			group,
			variants: variants.size() > 0 ? variants : NO_VARIANTS,
			pitch,
			minInterval,
		};
	}

	// --- sprite effects (Roblox port, docs/FX_AUDIO.md F1) ------------------------------------------

	/**
	 * A sprite effect, or undefined: fx is optional, so an ID the pack does not define is undefined WITHOUT a warning
	 * (nothing is drawn). Cached, misses too. A set too malformed to draw (not `sprites`, rejected by `sprites(id)`,
	 * more than one facing) warns once and is undefined; a bad `sizeTiles` falls back to the cell size and a `tint`
	 * that is not a colour role is dropped (warned once). The size is clamped to FX_SPRITE_MAX_TILES.
	 */
	fx(id: FxId): FxArt | undefined {
		const cached = this.fxArt.get(id);
		if (cached !== undefined) {
			return cached === false ? undefined : cached;
		}
		const art = this.createFx(id);
		this.fxArt.set(id, art ?? false);
		return art;
	}

	private createFx(id: FxId): FxArt | undefined {
		const def = this.asset(id);
		if (def === undefined) {
			return undefined;
		}
		if (def.kind !== "sprites") {
			this.warnOnce(`fx:${id}`, `effect "${id}" is a ${def.kind}, not sprites; not drawn`);
			return undefined;
		}
		const set = this.sprites(id); // warns once when malformed
		if (set === undefined) {
			return undefined;
		}
		if (set.facings.count !== 1) {
			this.warnOnce(`fx:${id}`, `effect "${id}" has ${set.facings.count} facings, effects have 1; not drawn`);
			return undefined;
		}
		const play = set.animation(FX_ANIMATION) as SpriteAnimationDef; // required: sprites() rejects a set without it
		const d = def as unknown as Obj;
		const longSide = math.max(set.frameW, set.frameH);
		let declared: number | undefined;
		if (d.sizeTiles !== undefined) {
			if (isFiniteNum(d.sizeTiles) && d.sizeTiles > 0) {
				declared = d.sizeTiles;
			} else {
				this.warnOnce(
					`fx:${id}:size`,
					`effect "${id}" has sizeTiles ${describeValue(d.sizeTiles)}, using its cell size`,
				);
			}
		}
		const sizeTiles = math.min(declared ?? longSide / set.pixelsPerTile, FX_SPRITE_MAX_TILES);
		let tint: ColorRole | undefined;
		if (d.tint !== undefined) {
			if (typeIs(d.tint, "string") && COLOR_ROLE_SET.has(d.tint)) {
				tint = d.tint as ColorRole;
			} else {
				this.warnOnce(`fx:${id}:tint`, `effect "${id}" has tint ${describeValue(d.tint)}, drawing it untinted`);
			}
		}
		return {
			id,
			set,
			frames: play.frames,
			fps: play.fps,
			loop: play.loop,
			sizeTiles,
			widthTiles: (sizeTiles * set.frameW) / longSide,
			heightTiles: (sizeTiles * set.frameH) / longSide,
			tint,
			additive: d.additive === true,
		};
	}

	// --- colors --------------------------------------------------------------------------------

	/** '#rrggbb' for a role. Missing: warn once, magenta. */
	hex(r: ColorRole): HexColor {
		const hex = this.colorHex[r];
		if (hex !== undefined) {
			return hex;
		}
		this.warnOnce(`color:${r}`, `missing color role "${r}", using magenta`);
		return MISSING_COLOR;
	}

	/** '#rrggbb' for a placeholder colour reference (a role, a biome surface, or missing). */
	visualHex(ref: PlaceholderColor): HexColor {
		switch (ref.kind) {
			case "role":
				return this.hex(ref.role);
			case "biome": {
				const b = this.biome(ref.biome);
				return ref.surface === "floor" ? b.floor : b.wall;
			}
			default:
				return MISSING_COLOR;
		}
	}

	// --- biomes --------------------------------------------------------------------------------

	/**
	 * Biome colors, tile IDs and surface materials. Unknown biome: warn once, magenta floor/wall, default tile IDs and
	 * DEFAULT_BIOME_MATERIAL everywhere.
	 */
	biome(id: string): BiomeTheme {
		const forgeTheme = BIOMES.find((b) => b.id === id)?.forgeTheme;
		const def = this.biomes[id];
		const defaultTiles = { floor: `tile.${id}.floor`, wall: `tile.${id}.wall` };
		if (!isObj(def)) {
			this.warnOnce(`biome:${id}`, `missing biome "${id}"`);
			return {
				id,
				forgeTheme,
				nameKey: `${id}.name`,
				floor: MISSING_COLOR,
				wall: MISSING_COLOR,
				tiles: defaultTiles,
				materials: DEFAULT_MATERIALS,
			};
		}
		const tiles = isObj(def.tiles) ? def.tiles : {};
		return {
			id,
			forgeTheme,
			nameKey: typeIs(def.name, "string") ? def.name : `${id}.name`,
			floor: isHexColor(def.floor) ? def.floor : MISSING_COLOR,
			wall: isHexColor(def.wall) ? def.wall : MISSING_COLOR,
			tiles: {
				floor: typeIs(tiles.floor, "string") ? tiles.floor : defaultTiles.floor,
				wall: typeIs(tiles.wall, "string") ? tiles.wall : defaultTiles.wall,
			},
			materials: this.biomeMaterials(id, def.materials),
		};
	}

	/** A biome's `materials`, every surface filled: absent -> the default; an unknown name -> warn once, the default. */
	private biomeMaterials(id: string, materials: unknown): Readonly<Record<BiomeMaterialSurface, BiomeMaterial>> {
		if (materials === undefined) {
			return DEFAULT_MATERIALS;
		}
		if (!isObj(materials)) {
			this.warnOnce(
				`material:${id}`,
				`biome "${id}" materials is not an object, using "${DEFAULT_BIOME_MATERIAL}"`,
			);
			return DEFAULT_MATERIALS;
		}
		const m: Obj = materials;
		const out: Record<BiomeMaterialSurface, BiomeMaterial> = { ...DEFAULT_MATERIALS };
		for (const surface of BIOME_MATERIAL_SURFACES) {
			const name = m[surface];
			if (name === undefined) {
				continue;
			}
			if (typeIs(name, "string") && BIOME_MATERIAL_SET.has(name)) {
				out[surface] = name as BiomeMaterial;
			} else {
				this.warnOnce(
					`material:${id}:${surface}`,
					`biome "${id}" ${surface} material ${describeValue(
						name,
					)} is not a known material, using "${DEFAULT_BIOME_MATERIAL}"`,
				);
			}
		}
		return out;
	}

	// --- strings -------------------------------------------------------------------------------

	hasString(key: string): boolean {
		return typeIs(this.strings[key], "string");
	}

	/** Localized text for a key with {name} placeholders filled from vars. Missing: warn once, return the key. */
	str(key: string, vars?: StringVars): string {
		const localized = this.localeStrings[key];
		const text = typeIs(localized, "string") ? localized : this.strings[key];
		if (!typeIs(text, "string")) {
			this.warnOnce(`str:${key}`, `missing string "${key}"`);
			return key;
		}
		return interpolate(text, vars);
	}
}

/**
 * The pure half of the runtime theme pack: resolves logical IDs to asset IDs, sheet layouts,
 * hex colours, sounds, strings and placeholder visuals, with no Roblox types (so it runs
 * headlessly). `ThemePack` (pack.ts) wraps it and converts to Color3 / Vector2.
 *
 * Ported from project-kaleb-vale `src/theme/pack.ts` @ 42897e2 (ThemePack lookups, frameUV,
 * frameIndex). Missing IDs never crash: they warn once and fall back exactly as the source does
 * (magenta MISSING_COLOR, the key for strings, silence for sounds; the source's checkerboard
 * texture becomes `assetId: undefined` plus a magenta placeholder visual).
 */

import { isHexColor } from "./color";
import {
	BIOMES,
	BIOME_MATERIALS,
	BIOME_MATERIAL_SURFACES,
	DEFAULT_BIOME_MATERIAL,
	MAX_ANIMATION_FPS,
	MAX_IMAGE_SIDE,
	SPRITE_FACING_COUNTS,
	SPRITE_RESAMPLE_MODES,
	requiredAnimationList,
	requiredBaseAnimations,
	slotFor,
	type BiomeMaterial,
	type BiomeMaterialSurface,
	type ForgeTheme,
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
	readonly x: number;
	readonly y: number;
	readonly w: number;
	readonly h: number;
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
}

/** Fallback for an unknown animation name in a sprite set (when it has one). */
const SPRITE_FALLBACK_ANIMATION = "idle";

const isFiniteNum = (v: unknown): v is number => typeIs(v, "number") && v === v && v !== math.huge && v !== -math.huge;
const isImageSidePx = (v: unknown): v is number => isInteger(v) && v >= 1 && v <= MAX_IMAGE_SIDE;

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
		if (!isImageSidePx(sheet.w) || !isImageSidePx(sheet.h) || sheet.w < frameW || sheet.h < frameH) {
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
	frameW: number,
	frameH: number,
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
	const capacity = math.floor(sheet.w / frameW) * math.floor(sheet.h / frameH);
	const lastCell = a.start + (facingCount - 1) * stride + a.frames - 1;
	if (lastCell >= capacity) return `cell ${lastCell} is outside sheet ${a.sheet} (${capacity} cells)`;
	return undefined;
}

class SpriteSetLayoutImpl implements SpriteSetLayout {
	readonly animationNames: ReadonlyArray<string>;
	private readonly fallback: string;

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
	}

	has(anim: string): boolean {
		return this.animations[anim] !== undefined;
	}

	animation(anim: string): SpriteAnimationDef | undefined {
		return this.animations[anim];
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
		const perRow = math.floor(sheet.w / this.frameW);
		return {
			sheet: a.sheet,
			assetId: sheet.assetId,
			x: (cell % perRow) * this.frameW,
			y: math.floor(cell / perRow) * this.frameH,
			w: this.frameW,
			h: this.frameH,
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
}

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
		const frameW = def.frameW as number;
		const frameH = def.frameH as number;
		const facings = def.facings as unknown as SpriteFacings;
		const sheets = def.sheets as unknown as ReadonlyArray<Readonly<SpriteSheetImage>>;
		const animations: Record<string, SpriteAnimationDef> = {};
		const slot = slotFor(id);
		const required = slot !== undefined ? requiredBaseAnimations(slot) : [];
		if (isObj(def.animations)) {
			for (const [name, a] of sortedEntries(def.animations)) {
				const bad = spriteAnimationProblem(a, sheets, frameW, frameH, facings.count);
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

	/** Audio event -> uploaded sound (assetId undefined when silent or missing) and its SoundGroup. */
	sound(id: string): SoundRef {
		const group: SoundGroupName = slotFor(id)?.soundGroup ?? "sfx";
		const def = this.asset(id);
		if (def === undefined) {
			this.warnOnce(`asset:${id}`, `missing audio event "${id}", staying silent`);
			return { assetId: undefined, volume: 0, group };
		}
		if (def.kind === "silent") {
			return { assetId: undefined, volume: 0, group };
		}
		if (def.kind !== "sound") {
			this.warnOnce(`kind:${id}`, `asset "${id}" is a ${def.kind}, not a sound`);
			return { assetId: undefined, volume: 0, group };
		}
		return { assetId: def.assetId, volume: def.volume ?? 1, group };
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

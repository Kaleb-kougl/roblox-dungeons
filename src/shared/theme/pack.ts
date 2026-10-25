/**
 * The runtime theme pack: the thin Roblox layer over ThemeCore (core.ts). Everything that needs
 * Color3 / Vector2 lives here; the logic (lookups, fallbacks, frame math) lives in the core and is
 * tested headlessly.
 *
 * Ported from project-kaleb-vale `src/theme/pack.ts` @ 42897e2 (ThemePack, loadThemePack, the active
 * pack). Packs are TS modules registered in `packs/index.ts` (no file loading, no async): switching
 * packs is still a restart.
 */

import { parseHex } from "./color";
import {
	DEFAULT_PACK_ID,
	MISSING_COLOR,
	ThemeCore,
	type BiomeTheme,
	type ImageRef,
	type SoundRef,
	type SpriteSetLayout,
} from "./core";
import { THEME_PACKS } from "./packs";
import type { PlaceholderColor, PlaceholderVisual } from "./placeholders";
import type { StringVars } from "./strings";
import type {
	AnimationDef,
	ColorRole,
	HexColor,
	Pivot,
	SpriteAnimationDef,
	SpriteFacings,
	SpriteSetAsset,
	SpriteSheetImage,
} from "./types";
import { sortedKeys } from "./util";
import { validateManifest } from "./validate";

/** One frame of a sheet as Roblox wants it: ImageRectOffset / ImageRectSize, pixels, top-left origin. */
export interface FrameRect {
	readonly offset: Vector2;
	readonly size: Vector2;
}

export interface SpriteSheet {
	readonly id: string;
	/** The uploaded sheet, or undefined while the ID is a placeholder (draw `pack.placeholder(id)`). */
	readonly assetId: string | undefined;
	readonly frameW: number;
	readonly frameH: number;
	/** Pixels from the cell's top-left (from the sprite contract). */
	readonly pivot: Readonly<Pivot>;
	readonly animations: Readonly<Record<string, AnimationDef>>;
	readonly animationNames: ReadonlyArray<string>;
	/** Frame `index` of `anim` (wrapped or held per its loop flag). Unknown animation: warn once, the first. */
	readonly frame: (anim: string, index: number) => FrameRect;
}

/** One frame of a sprite set as Roblox wants it: the sheet's image plus ImageRectOffset / ImageRectSize (pixels). */
export interface SpriteFrame {
	/** The sheet's uploaded image (ImageLabel.Image). */
	readonly image: string;
	readonly offset: Vector2;
	readonly size: Vector2;
}

/**
 * A `sprites` asset (sprite contract v2) for a renderer: the core `SpriteSetLayout` with frames as Vector2.
 * `ResampleMode = Enum.ResamplerMode[set.resample]`; billboard width in tiles = frameW / pixelsPerTile.
 */
export interface SpriteSet {
	readonly id: string;
	readonly frameW: number;
	readonly frameH: number;
	/** The feet, pixels from the cell's top-left. */
	readonly pivot: Readonly<Pivot>;
	readonly pixelsPerTile: number;
	readonly resample: SpriteSetAsset["resample"];
	readonly facings: Readonly<SpriteFacings>;
	readonly sheets: ReadonlyArray<Readonly<SpriteSheetImage>>;
	/** Animation names, sorted. */
	readonly animationNames: ReadonlyArray<string>;
	/** The pure layout underneath. */
	readonly layout: SpriteSetLayout;
	has(anim: string): boolean;
	animation(anim: string): SpriteAnimationDef | undefined;
	/** Frame `index` of `anim` in `facing` (see SpriteSetLayout.frame: facing wraps, one-shots hold, unknown anim warns once). */
	frame(anim: string, facing: number, index: number): SpriteFrame;
}

class PackSpriteSet implements SpriteSet {
	readonly id: string;
	readonly frameW: number;
	readonly frameH: number;
	readonly pivot: Readonly<Pivot>;
	readonly pixelsPerTile: number;
	readonly resample: SpriteSetAsset["resample"];
	readonly facings: Readonly<SpriteFacings>;
	readonly sheets: ReadonlyArray<Readonly<SpriteSheetImage>>;
	readonly animationNames: ReadonlyArray<string>;

	constructor(readonly layout: SpriteSetLayout) {
		this.id = layout.id;
		this.frameW = layout.frameW;
		this.frameH = layout.frameH;
		this.pivot = layout.pivot;
		this.pixelsPerTile = layout.pixelsPerTile;
		this.resample = layout.resample;
		this.facings = layout.facings;
		this.sheets = layout.sheets;
		this.animationNames = layout.animationNames;
	}

	has(anim: string): boolean {
		return this.layout.has(anim);
	}

	animation(anim: string): SpriteAnimationDef | undefined {
		return this.layout.animation(anim);
	}

	frame(anim: string, facing: number, index: number): SpriteFrame {
		const r = this.layout.frame(anim, facing, index);
		return { image: r.assetId, offset: new Vector2(r.x, r.y), size: new Vector2(r.w, r.h) };
	}
}

export interface BiomeColors extends BiomeTheme {
	readonly floorColor: Color3;
	readonly wallColor: Color3;
}

export interface ThemePackOptions {
	/** Active locale; strings fall back to the default table. */
	locale?: string;
	/** Validator errors found at load (kept for debug overlays). */
	problems?: ReadonlyArray<string>;
	/** Where warnings go (default: Roblox `warn`). */
	warn?: (message: string) => void;
}

/** '#rrggbb' -> Color3 (magenta for anything malformed). */
export function hexToColor3(hex: string): Color3 {
	const rgb = parseHex(hex) ?? (parseHex(MISSING_COLOR) as NonNullable<ReturnType<typeof parseHex>>);
	return Color3.fromRGB(rgb.r, rgb.g, rgb.b);
}

export class ThemePack {
	readonly core: ThemeCore;
	readonly id: string;
	readonly name: string;
	readonly locale: string | undefined;
	readonly problems: ReadonlyArray<string>;

	private readonly colors = new Map<string, Color3>();
	private readonly sheets = new Map<string, SpriteSheet>();
	private readonly spriteSets = new Map<string, SpriteSet>();

	/** Defensive: a manifest that failed validation still loads; bad entries fall back individually. */
	constructor(manifest: unknown, opts: ThemePackOptions = {}) {
		this.core = new ThemeCore(manifest, opts);
		this.id = this.core.id;
		this.name = this.core.name;
		this.locale = this.core.locale;
		this.problems = this.core.problems;
	}

	// --- assets --------------------------------------------------------------------------------

	has(id: string): boolean {
		return this.core.has(id);
	}

	/**
	 * The uploaded image for a visual ID; undefined while it is a placeholder. Missing: warn once, undefined.
	 * Undefined (no warning) for a `sprites` asset: use `sprites(id)`.
	 */
	texture(id: string): string | undefined {
		return this.core.texture(id);
	}

	/**
	 * Sprite sheet for an animated ID (placeholders become one-frame sheets laid out per the contract). Cached.
	 * A `sprites` asset also gets the placeholder layout (assetId undefined): ask `sprites(id)` first.
	 */
	spriteSheet(id: string): SpriteSheet {
		const cached = this.sheets.get(id);
		if (cached !== undefined) {
			return cached;
		}
		const layout = this.core.sheet(id);
		const sheet: SpriteSheet = {
			id: layout.id,
			assetId: layout.assetId,
			frameW: layout.frameW,
			frameH: layout.frameH,
			pivot: layout.pivot,
			animations: layout.animations,
			animationNames: layout.animationNames,
			frame: (anim, index) => {
				const r = layout.frameRect(anim, index);
				return { offset: new Vector2(r.x, r.y), size: new Vector2(r.w, r.h) };
			},
		};
		this.sheets.set(id, sheet);
		return sheet;
	}

	/**
	 * An uploaded `image` asset ({ assetId, w, h, tilesPerImage, pivot }), undefined otherwise (no warning; see
	 * ThemeCore.image).
	 */
	image(id: string): ImageRef | undefined {
		return this.core.image(id);
	}

	/**
	 * The `sprites` asset (sprite contract v2) for an ID, cached. Undefined (no warning) for any other kind: fall back
	 * to `placeholder(id)`. Missing ID: warn once, undefined.
	 */
	sprites(id: string): SpriteSet | undefined {
		const cached = this.spriteSets.get(id);
		if (cached !== undefined) {
			return cached;
		}
		const layout = this.core.sprites(id);
		if (layout === undefined) {
			return undefined;
		}
		const set = new PackSpriteSet(layout);
		this.spriteSets.set(id, set);
		return set;
	}

	/** What to build while an ID has no art. Missing ID: warn once, a magenta block. */
	placeholder(id: string): PlaceholderVisual {
		return this.core.placeholder(id);
	}

	/** Audio event -> { assetId | undefined, volume, group }. Silent or missing: assetId undefined, volume 0. */
	sound(id: string): SoundRef {
		return this.core.sound(id);
	}

	// --- colors --------------------------------------------------------------------------------

	/** '#rrggbb' for a role. Missing: warn once, MISSING_COLOR (magenta). */
	hex(role: ColorRole): HexColor {
		return this.core.hex(role);
	}

	/** Color3 for a role (cached; Color3 is immutable, so sharing is safe). Missing: warn once, magenta. */
	color(role: ColorRole): Color3 {
		return this.cachedColor(this.core.hex(role));
	}

	/** Color3 for a placeholder visual's colour reference. */
	visualColor(ref: PlaceholderColor): Color3 {
		return this.cachedColor(this.core.visualHex(ref));
	}

	visualHex(ref: PlaceholderColor): HexColor {
		return this.core.visualHex(ref);
	}

	private cachedColor(hex: HexColor): Color3 {
		let c = this.colors.get(hex);
		if (c === undefined) {
			c = hexToColor3(hex);
			this.colors.set(hex, c);
		}
		return c;
	}

	// --- biomes --------------------------------------------------------------------------------

	/** Biome colours (hex and Color3), tile IDs and surface materials. Unknown biome: warn once, magenta floor/wall. */
	biome(id: string): BiomeColors {
		const b = this.core.biome(id);
		return {
			id: b.id,
			forgeTheme: b.forgeTheme,
			nameKey: b.nameKey,
			floor: b.floor,
			wall: b.wall,
			tiles: b.tiles,
			materials: b.materials,
			floorColor: this.cachedColor(b.floor),
			wallColor: this.cachedColor(b.wall),
		};
	}

	// --- strings -------------------------------------------------------------------------------

	hasString(key: string): boolean {
		return this.core.hasString(key);
	}

	/** Localized text with {name} placeholders filled. Missing: warn once, the key. */
	str(key: string, vars?: StringVars): string {
		return this.core.str(key, vars);
	}
}

// ---------------------------------------------------------------------------------------------
// Loading

export interface LoadOptions {
	/** Packs to choose from (default: THEME_PACKS, the bundled packs). */
	packs?: Readonly<Record<string, unknown>>;
	locale?: string;
	/** Where warnings and validation problems go (default: Roblox `warn`). */
	warn?: (message: string) => void;
}

/** IDs of the bundled packs, sorted. */
export function listThemePacks(packs: Readonly<Record<string, unknown>> = THEME_PACKS): Array<string> {
	return sortedKeys(packs);
}

/**
 * Validate and load a pack. Validation problems are reported once (and kept on pack.problems) but
 * don't stop the load: bad entries fall back one by one. An unknown pack id falls back to the
 * placeholder pack; only a missing placeholder pack throws.
 */
export function loadThemePack(id: string = DEFAULT_PACK_ID, opts: LoadOptions = {}): ThemePack {
	const packs = opts.packs ?? THEME_PACKS;
	const sink = opts.warn ?? ((message: string) => warn(message));
	const manifest = packs[id];
	if (manifest !== undefined) {
		const problems = validateManifest(manifest, { packId: id });
		if (problems.size() > 0) {
			sink(`[theme:${id}] pack has ${problems.size()} problem(s):\n  ${problems.join("\n  ")}`);
		}
		return new ThemePack(manifest, { locale: opts.locale, problems, warn: sink });
	}
	if (id !== DEFAULT_PACK_ID) {
		sink(`[theme] pack "${id}" not found, falling back to "${DEFAULT_PACK_ID}"`);
		return loadThemePack(DEFAULT_PACK_ID, opts);
	}
	error(`[theme] the "${DEFAULT_PACK_ID}" pack is missing`);
}

// One pack at a time: switching packs is a restart. Non-React code (audio, renderers) reads it here.
let active: ThemePack | undefined;

export function setActiveThemePack(pack: ThemePack): void {
	if (active !== undefined && active !== pack && active.id !== pack.id) {
		warn(`[theme] switching from "${active.id}" to "${pack.id}" at runtime; packs are meant to change on restart`);
	}
	active = pack;
}

/** The active pack, or undefined before one is set. */
export function getActiveThemePack(): ThemePack | undefined {
	return active;
}

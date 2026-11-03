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
	FX_ANIMATION,
	type BiomeId,
	type BoostKind,
	type BreakableKind,
	type DecorKind,
	type VoidDecorKind,
	type DecorLayer,
	type FxId,
} from "./contract";
import {
	DEFAULT_PACK_ID,
	MISSING_COLOR,
	ThemeCore,
	type AmbientParticleArt,
	type BiomeTheme,
	type BoostTheme,
	type PelletTheme,
	type BreakableTheme,
	type DecorArt,
	type FxArt,
	type LocaleReport,
	type ImageRef,
	type SoundRef,
	type SpriteSetLayout,
	type WorldArt,
	type WorldImageArt,
} from "./core";
import type { LocaleTable } from "shared/l10n";
import { THEME_PACKS } from "./packs";
import type { PelletKind } from "./pellets";
import type { PlaceholderColor, PlaceholderVisual } from "./placeholders";
import type { StringVars } from "./strings";
import type {
	AnimationDef,
	ColorRole,
	ContentRef,
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
	/**
	 * The sheet's outline image (SpriteSheetImage.outlineAssetId), or undefined when that sheet has none. Same
	 * offset and size as the frame: an outline sheet has the atlas's size and cell grid (enemy outline plan O4).
	 */
	readonly outlineImage?: string;
	readonly offset: Vector2;
	/** The cell size (ImageRectSize): the frame's sheet's own with per-sheet cells, else the set's frameW x frameH. */
	readonly size: Vector2;
	/**
	 * The feet in this cell, pixels from its top-left (SpriteFrameRect.pivot): the sheet's own with per-sheet cells,
	 * else the set's pivot. The renderer re-sizes the billboard when size or pivot changes (SpriteView).
	 */
	readonly pivot: Readonly<Pivot>;
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
		return {
			image: r.assetId,
			outlineImage: r.outlineAssetId,
			offset: new Vector2(r.x, r.y),
			size: new Vector2(r.w, r.h),
			pivot: this.layout.cell(r.sheet).pivot,
		};
	}
}

/** World art as Roblox wants it (decor, breakables): an image region, or a sprite set. */
export type WorldVisual = WorldImage | WorldSprites;

/** An uploaded image region: ImageLabel.Image + ImageRectOffset / ImageRectSize; billboard tiles = size / pixelsPerTile. */
export interface WorldImage {
	readonly kind: "image";
	readonly image: string;
	readonly offset: Vector2;
	readonly size: Vector2;
	/** The point placed on the ground spot, pixels from the region's top-left. */
	readonly pivot: Readonly<Pivot>;
	readonly pixelsPerTile: number;
	/** The pure layout underneath. */
	readonly layout: WorldImageArt;
}

export interface WorldSprites {
	readonly kind: "sprites";
	readonly set: SpriteSet;
}

/** A decor piece or effect (ThemeCore.decor) with Roblox types. */
export interface DecorPiece {
	readonly id: string;
	readonly layer: DecorLayer | undefined;
	readonly glow: boolean;
	readonly glowAt: Readonly<Pivot>;
	readonly emissive: boolean;
	readonly art: WorldVisual;
	readonly core: DecorArt;
}

/** A biome's ambient particle (ThemeCore.ambient) with its tint as a Color3. */
export interface AmbientParticles extends AmbientParticleArt {
	readonly color: Color3;
}

/** A breakable kind (ThemeCore.breakable): art (or undefined: build `placeholder`) and its identity colour. */
export interface Breakable {
	readonly kind: BreakableKind;
	readonly id: string;
	readonly nameKey: string;
	readonly color: Color3;
	readonly art: WorldVisual | undefined;
	readonly placeholder: PlaceholderVisual;
	readonly core: BreakableTheme;
}

/** A boost kind (ThemeCore.boost): art (or undefined: build `placeholder`), its identity colour and string keys. */
export interface Boost {
	readonly kind: BoostKind;
	readonly id: string;
	readonly nameKey: string;
	readonly descKey: string;
	readonly iconKey: string;
	readonly color: Color3;
	readonly art: WorldVisual | undefined;
	readonly placeholder: PlaceholderVisual;
	readonly core: BoostTheme;
}

/** A pellet kind (ThemeCore.pellet) with Roblox types (docs/PELLETS.md PL7). */
export interface Pellet {
	readonly kind: PelletKind;
	readonly id: string;
	readonly color: Color3;
	readonly art: WorldVisual | undefined;
	readonly placeholder: PlaceholderVisual;
	readonly core: PelletTheme;
}

/**
 * A sprite effect (ThemeCore.fx) with Roblox types: a one-facing SpriteSet, its flipbook and how to draw it. Drawn
 * widthTiles x heightTiles; `ImageColor3 = color`; `additive`: LightInfluence 0.
 */
export interface FxSprite {
	readonly id: FxId;
	readonly set: SpriteSet;
	readonly frames: number;
	readonly fps: number;
	readonly loop: boolean;
	readonly sizeTiles: number;
	readonly widthTiles: number;
	readonly heightTiles: number;
	readonly tint: ColorRole | undefined;
	/** The tint as a Color3, white when untinted (ImageColor3 multiplies, so white keeps the sheet's colours). */
	readonly color: Color3;
	readonly additive: boolean;
	/** Frame `index` of the flipbook (wraps when looping, holds the last frame otherwise). */
	readonly frame: (index: number) => SpriteFrame;
	readonly core: FxArt;
}

const UNTINTED = new Color3(1, 1, 1);

export interface BiomeColors extends BiomeTheme {
	readonly floorColor: Color3;
	readonly wallColor: Color3;
	/** docs/VOID_DECOR.md VD1: `shoulder`, `abyss` and `ledge` as Color3. */
	readonly shoulderColor: Color3;
	readonly abyssColor: Color3;
	readonly ledgeColor: Color3;
}

export interface ThemePackOptions {
	/** Active locale (setLocale); strings fall back to the default table. */
	locale?: string;
	/** Generated locale tables by code (default: LOCALE_TABLES; specs pass synthetic ones). */
	localeTables?: ReadonlyMap<string, LocaleTable>;
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
	/** Active locale code (undefined: the default table). Read-only: change it with setLocale. */
	locale: string | undefined;
	readonly problems: ReadonlyArray<string>;

	private readonly colors = new Map<string, Color3>();
	private readonly sheets = new Map<string, SpriteSheet>();
	private readonly spriteSets = new Map<string, SpriteSet>();
	private readonly decorPieces = new Map<string, DecorPiece | false>();
	private readonly breakables = new Map<BreakableKind, Breakable>();
	private readonly boosts = new Map<BoostKind, Boost>();
	private readonly pellets = new Map<PelletKind, Pellet>();
	private readonly fxSprites = new Map<string, FxSprite | false>();

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

	// --- world art: decor and breakables (docs/DECOR.md) ------------------------------------------

	private worldVisual(art: WorldArt): WorldVisual | undefined {
		if (art.kind === "image") {
			return {
				kind: "image",
				image: art.assetId,
				offset: new Vector2(art.rect.x, art.rect.y),
				size: new Vector2(art.rect.w, art.rect.h),
				pivot: art.pivot,
				pixelsPerTile: art.pixelsPerTile,
				layout: art,
			};
		}
		const set = this.sprites(art.set.id);
		return set !== undefined ? { kind: "sprites", set } : undefined;
	}

	/**
	 * A decor piece (decor.delve.*) or effect (decor.fx.<torch|flame|glow|glint|zone>), cached. Undefined, without a
	 * warning, when the pack has no art for it: draw nothing (see ThemeCore.decor).
	 */
	decor(id: string): DecorPiece | undefined {
		const cached = this.decorPieces.get(id);
		if (cached !== undefined) {
			return cached === false ? undefined : cached;
		}
		const core = this.core.decor(id);
		const art = core !== undefined ? this.worldVisual(core.art) : undefined;
		const piece: DecorPiece | undefined =
			core !== undefined && art !== undefined
				? { id, layer: core.layer, glow: core.glow, glowAt: core.glowAt, emissive: core.emissive, art, core }
				: undefined;
		this.decorPieces.set(id, piece ?? false);
		return piece;
	}

	/** Every piece of `kind` for `biome` (base ID, then variants .1 ..); empty when the pack has none. */
	decorVariants(biome: BiomeId, kind: DecorKind): Array<DecorPiece> {
		const out = new Array<DecorPiece>();
		for (const art of this.core.decorVariants(biome, kind)) {
			const piece = this.decor(art.id);
			if (piece !== undefined) out.push(piece);
		}
		return out;
	}

	/**
	 * docs/VOID_DECOR.md VD7: every void art piece of `kind` for `biome` (`decor.void.b<n>.<kind>`, then variants .1 ..);
	 * empty, without a warning, when the pack has none (void art is optional: draw nothing).
	 */
	voidDecorVariants(biome: BiomeId, kind: VoidDecorKind): Array<DecorPiece> {
		const out = new Array<DecorPiece>();
		for (const art of this.core.voidDecorVariants(biome, kind)) {
			const piece = this.decor(art.id);
			if (piece !== undefined) out.push(piece);
		}
		return out;
	}

	/** A biome's ambient particle, or undefined (no warning) when the pack has none. Clamped to DECOR_PARTICLE. */
	ambient(biome: BiomeId): AmbientParticles | undefined {
		const a = this.core.ambient(biome);
		if (a === undefined) {
			return undefined;
		}
		return {
			id: a.id,
			assetId: a.assetId,
			sizeStuds: a.sizeStuds,
			transparency: a.transparency,
			emissive: a.emissive,
			role: a.role,
			flipbook: a.flipbook,
			color: this.color(a.role),
		};
	}

	/** A breakable kind (required in every pack): its art, or undefined art and the placeholder box. Cached. */
	breakable(kind: BreakableKind): Breakable {
		const cached = this.breakables.get(kind);
		if (cached !== undefined) {
			return cached;
		}
		const core = this.core.breakable(kind);
		const b: Breakable = {
			kind,
			id: core.id,
			nameKey: core.nameKey,
			color: this.color(core.role),
			art: core.art !== undefined ? this.worldVisual(core.art) : undefined,
			placeholder: core.placeholder,
			core,
		};
		this.breakables.set(kind, b);
		return b;
	}

	/** A boost kind (required in every pack, docs/BOOSTS.md B5): its art, or no art and the placeholder gem. Cached. */
	boost(kind: BoostKind): Boost {
		const cached = this.boosts.get(kind);
		if (cached !== undefined) {
			return cached;
		}
		const core = this.core.boost(kind);
		const b: Boost = {
			kind,
			id: core.id,
			nameKey: core.nameKey,
			descKey: core.descKey,
			iconKey: core.iconKey,
			color: this.color(core.role),
			art: core.art !== undefined ? this.worldVisual(core.art) : undefined,
			placeholder: core.placeholder,
			core,
		};
		this.boosts.set(kind, b);
		return b;
	}

	/** A pellet kind (required in every pack, docs/PELLETS.md PL7): its art, or no art and the placeholder cube. Cached. */
	pellet(kind: PelletKind): Pellet {
		const cached = this.pellets.get(kind);
		if (cached !== undefined) {
			return cached;
		}
		const core = this.core.pellet(kind);
		const p: Pellet = {
			kind,
			id: core.id,
			color: this.color(core.role),
			art: core.art !== undefined ? this.worldVisual(core.art) : undefined,
			placeholder: core.placeholder,
			core,
		};
		this.pellets.set(kind, p);
		return p;
	}

	/** What to build while an ID has no art. Missing ID: warn once, a magenta block. */
	placeholder(id: string): PlaceholderVisual {
		return this.core.placeholder(id);
	}

	/**
	 * Audio event -> { assetId | undefined, volume, group, variants, pitch, minInterval } (cached). Silent or missing:
	 * assetId undefined, volume 0, no variants.
	 */
	sound(id: string): SoundRef {
		return this.core.sound(id);
	}

	// --- sprite effects (docs/FX_AUDIO.md F1) -----------------------------------------------------

	/** A sprite effect, cached. Undefined, without a warning, when the pack has no art for it: draw nothing. */
	fx(id: FxId): FxSprite | undefined {
		const cached = this.fxSprites.get(id);
		if (cached !== undefined) {
			return cached === false ? undefined : cached;
		}
		const core = this.core.fx(id);
		const set = core !== undefined ? this.sprites(id) : undefined;
		let out: FxSprite | undefined;
		if (core !== undefined && set !== undefined) {
			out = {
				id,
				set,
				frames: core.frames,
				fps: core.fps,
				loop: core.loop,
				sizeTiles: core.sizeTiles,
				widthTiles: core.widthTiles,
				heightTiles: core.heightTiles,
				tint: core.tint,
				color: core.tint !== undefined ? this.color(core.tint) : UNTINTED,
				additive: core.additive,
				frame: (index) => set.frame(FX_ANIMATION, 0, index),
				core,
			};
		}
		this.fxSprites.set(id, out ?? false);
		return out;
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

	/**
	 * Biome colours (hex and Color3: floor, wall, the void's shoulder / abyss / ledge), tile IDs and surface materials
	 * (floor, wall, pool, shoulder, cliff). Unknown biome: warn once, magenta colours.
	 */
	biome(id: string): BiomeColors {
		const b = this.core.biome(id);
		return {
			id: b.id,
			forgeTheme: b.forgeTheme,
			nameKey: b.nameKey,
			floor: b.floor,
			wall: b.wall,
			shoulder: b.shoulder,
			abyss: b.abyss,
			ledge: b.ledge,
			tiles: b.tiles,
			materials: b.materials,
			floorColor: this.cachedColor(b.floor),
			wallColor: this.cachedColor(b.wall),
			shoulderColor: this.cachedColor(b.shoulder),
			abyssColor: this.cachedColor(b.abyss),
			ledgeColor: this.cachedColor(b.ledge),
		};
	}

	// --- content ids (docs/PRELOAD.md P1) ------------------------------------------------------

	/** Every uploaded content id of a logical id, deterministic order, each once (ThemeCore.contentIds). Cached. */
	contentIds(id: string): ReadonlyArray<ContentRef> {
		return this.core.contentIds(id);
	}

	/** The logical ids with at least one content id, sorted. */
	assetIdList(): ReadonlyArray<string> {
		return this.core.assetIdList();
	}

	/** The pack's biome keys, sorted. */
	biomeKeys(): ReadonlyArray<string> {
		return this.core.biomeKeys();
	}

	/** Every content id a biome draws (its table and its floor / wall tiles), media "image". Cached. */
	biomeContentIds(biome: string): ReadonlyArray<ContentRef> {
		return this.core.biomeContentIds(biome);
	}

	// --- strings -------------------------------------------------------------------------------

	hasString(key: string): boolean {
		return this.core.hasString(key);
	}

	/** Localized text with {name} placeholders filled. Missing: warn once, the key. */
	str(key: string, vars?: StringVars): string {
		return this.core.str(key, vars);
	}

	/**
	 * Switch strings (and the shared/l10n number locale) to locale `code`, live (docs/LOCALIZATION.md L3; ThemeCore
	 * setLocale). Colours, sprites and sounds don't depend on the locale.
	 */
	setLocale(code: string | undefined): void {
		this.core.setLocale(code);
		this.locale = this.core.locale;
	}

	/** What the active locale's generated table could not supply (ThemeCore localeReport). */
	localeReport(): LocaleReport {
		return this.core.localeReport();
	}
}

// ---------------------------------------------------------------------------------------------
// Loading

export interface LoadOptions {
	/** Packs to choose from (default: THEME_PACKS, the bundled packs). */
	packs?: Readonly<Record<string, unknown>>;
	/** Active locale (ThemePack.setLocale; change it live later the same way). */
	locale?: string;
	/** Generated locale tables by code (default: LOCALE_TABLES). */
	localeTables?: ReadonlyMap<string, LocaleTable>;
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
		return new ThemePack(manifest, {
			locale: opts.locale,
			localeTables: opts.localeTables,
			problems,
			warn: sink,
		});
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

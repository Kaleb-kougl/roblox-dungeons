/**
 * Decor renderer tunables (docs/DECOR.md R4, R9): DecorController (pieces, fades, debug), DecorFxController (flames,
 * the light pool, fixed lights, ambient particles, glints). Presentation only; Roblox-port choices, no web source.
 *
 * Kept in this folder (new file) rather than shared/view config.ts so the decor renderer's numbers live with its pure
 * logic. DECOR_RENDER_ORDER extends RENDER_ORDER (shared/view config.ts) the same way: offsets from
 * Enum.RenderPriority.Camera.
 */
import type { DecorKind } from "shared/theme";
import type { ColorRole } from "shared/theme";

/** Render steps of the decor views, offsets from Enum.RenderPriority.Camera (RENDER_ORDER's convention). */
export const DECOR_RENDER_ORDER = {
	/** DecorController: the director update, then pieces, fades and debug (with the other views: Camera + 2). */
	decorAfterCamera: 2,
	/** DecorFxController: flames, lights and particles, after DecorController so it applies this frame's view. */
	decorFxAfterDecor: 3,
} as const;

/** DecorController (R4). */
export const DECOR_VIEW = {
	folderName: "KV_Decor",
	debugFolderName: "KV_DecorDebug",
	renderStep: "KV_Decor",
	profileLabel: "KV Decor",
	/** Workspace attribute (boolean): draw fade boxes, footprint stencils and breakable cells. Off by default. */
	debugAttribute: "KV_DecorDebug",
	/** A faded tall / low piece's ImageTransparency (a player or the boss behind it). */
	fadeTransparency: 0.75,
	/** The fade tween's length, seconds (real time; transparency is not motion, so reduced motion keeps it). */
	fadeSeconds: 0.15,
	/** Flat pieces: thickness of the invisible floor Part under the SurfaceGui, and its lift off the floor, studs. */
	flatThicknessStuds: 0.05,
	flatLiftStuds: 0.03,
	/** A standing piece's resting animation, and a lit brazier's (a sprite set with `lit` swaps to it once lit). */
	idleAnimation: "idle",
	litAnimation: "lit",
	/** A brazier counts as lit (swaps to `lit`) from this director lit level on. */
	litSwapLevel: 0.5,
	/** A dimmed piece (the used shrine's crystal) multiplies its art by this grey at full dim. */
	dimBrightness: 0.45,
	/** Bodies that fade tall pieces: the drawn height of a player and of the boss, tiles. */
	playerBodyHeightTiles: 1.1,
	bossBodyHeightTiles: 2.5,
	/**
	 * Pieces that sit on the grid (the grid-aligned facing: their wall's normal); every other kind is round and takes a
	 * facing by cell hash (docs/DECOR.md "Facings").
	 */
	gridKinds: [
		"wall",
		"wallBroken",
		"column",
		"columnBroken",
		"pillar",
		"sarco",
		"grave",
		"torch",
		"banner",
		"brazier",
	] as ReadonlyArray<DecorKind>,
	/** Debug drawing: edge thickness, studs; colours (theme roles); stencil cell inset, tiles. */
	debugEdgeStuds: 0.08,
	debugFadeRole: "uiAccent" as ColorRole,
	debugStencilRole: "uiHealth" as ColorRole,
	debugBreakableRole: "uiMana" as ColorRole,
	debugTransparency: 0.55,
	debugCellInsetTiles: 0.1,
	/** Instances one drawn piece costs (anchor / Part + Gui + ImageLabel), for the per-floor build log's estimate. */
	instancesPerPiece: 3,
} as const;

/** The light pool and fixed lights (R4 light rule, R9 light pool). PointLights need no art: they draw with every pack. */
export const DECOR_LIGHTS = {
	/** PointLights shared by the lit torches / braziers nearest the camera focus (docs/DECOR.md DECOR_LIGHTS.pool). */
	pool: 6,
	/** The pool is reassigned at most this often, seconds. */
	reassignSeconds: 0.25,
	/** A pool light fades in / out over this long when it changes hands. */
	fadeSeconds: 0.3,
	/** Only lights whose director lit level is at least this compete for the pool. */
	minLitLevel: 0.05,
	/** Range and brightness of a torch / brazier light (x the depth band's light, x flicker, x the cold fade). */
	rangeTiles: 5,
	brightness: 0.9,
	/**
	 * Ceiling on every decor PointLight's brightness, flares included (the contrast rule: no light may lift the floor
	 * until enemy bullets lose 3:1; check in Studio, R15).
	 */
	maxBrightness: 1.4,
	/** A flare adds this much brightness at its peak (x motionScale through the director). */
	flareBrightness: 0.5,
	/** Height of a light without art above the floor, tiles, and how far off its wall face (wall pieces). */
	heightTiles: 0.8,
	wallOffsetTiles: 0.35,
	/** Fixed lights (the web build's light rule: 2-4 in the boss and shrine rooms, outside the pool). */
	bossRingLights: 3,
	stairwellLight: true,
	shrineLights: 2,
	/** decorHash salts of the fixed lights' flicker seeds (arbitrary distinct 32-bit values). */
	fixedSalt: { ring: 0x5bd1e995, stair: 0x27d4eb2f, shrine: 0x165667b1 },
	/** The boss ring's lights stand this high over their flat glow, tiles. */
	ringLightHeightTiles: 0.4,
	/** Flicker: brightness x (1 + amplitude x motionScale x noise), noise a sum of these frequencies (Hz) per light. */
	flickerAmplitude: 0.18,
	flickerHz: [7.3, 11.9, 3.1] as ReadonlyArray<number>,
	/** Run over: lights end at this share of their brightness, in the cold role. */
	coldBrightness: 0.35,
	coldRole: "uiMana" as ColorRole,
	/** An Ember's gutter takes up to this share of a light's brightness at its peak. */
	gutterDim: 0.6,
	/** No shadows: decor lights must never darken a bullet. */
	shadows: false,
} as const;

/** Flames, glows, glints, the stairwell zone and the biome's ambient particles (R9). */
export const DECOR_FX = {
	fxFolderName: "KV_DecorFx",
	renderStep: "KV_DecorFx",
	profileLabel: "KV DecorFx",
	/** Flame loops animate only within this many tiles of the camera focus (the rest hold their frame). */
	flameAnimateRadiusTiles: 24,
	/** Flame / glow billboards sit this much further toward the camera than their piece, studs (in front of it). */
	flameDepthStuds: 0.3,
	glowDepthStuds: 0.15,
	/** An Ember's gutter: flames this much more transparent and this much shorter at its peak. */
	gutterTransparency: 0.6,
	gutterShrink: 0.35,
	/** A flare grows the flame by this share at its peak. */
	flareGrow: 0.35,
	/** The glow under a flame: its transparency when fully lit. */
	glowTransparency: 0.35,
	/** Pedestal glint and stairwell zone sizes, tiles (their art keeps its aspect), and the glint's height. */
	glintHeightTiles: 0.6,
	glintLiftTiles: 0.7,
	zoneSizeTiles: 2.6,
	/** A flat boss-ring fire pit's glow, tiles across. */
	ringGlowTiles: 1.4,
	/**
	 * Ambient particles: at most this many alive (docs/DECOR.md DECOR_FX.maxParticles), whatever the biome's Forge count
	 * (THEMES[key].particles.n) x the band's light x the juice level asks for.
	 */
	maxParticles: 150,
	/** The juice particle level's share of the biome count (off / low / normal / high). */
	levelScale: { off: 0, low: 0.5, normal: 1, high: 1.25 },
	/** The emitter volume around the camera focus, tiles: [x, y (height), z]. */
	ambientVolumeTiles: [30, 3, 30] as readonly [number, number, number],
	/** The volume's centre height above the floor, tiles. */
	ambientHeightTiles: 1.5,
	/** Ambient particles fade in over the first share of their life and out from this share on (Transparency keys). */
	ambientFadeIn: 0.2,
	ambientFadeOut: 0.8,
	/**
	 * Motion per Forge particle kind (THEMES[key].particles.kind: 0 ancient dust motes, 1 molten embers rising, 2 frost
	 * snow, 3 grim wisps, 4 verdant spores): lifetime and speed ranges, vertical acceleration (studs / s^2, + up),
	 * emission spread (degrees) and the direction it emits (`up`: rising, `down`: falling).
	 */
	ambientMotion: [
		{ lifetime: [5, 8], speed: [0.1, 0.3], accelY: 0.02, spreadDeg: 180, up: true },
		{ lifetime: [2.5, 4], speed: [0.8, 1.6], accelY: 0.6, spreadDeg: 25, up: true },
		{ lifetime: [5, 7], speed: [0.8, 1.4], accelY: -0.1, spreadDeg: 20, up: false },
		{ lifetime: [4, 6], speed: [0.2, 0.5], accelY: 0.08, spreadDeg: 120, up: true },
		{ lifetime: [5, 8], speed: [0.15, 0.35], accelY: 0.05, spreadDeg: 90, up: true },
	] as ReadonlyArray<AmbientMotion>,
} as const;

/** One Forge particle kind's motion (DECOR_FX.ambientMotion). */
export interface AmbientMotion {
	readonly lifetime: readonly [number, number];
	readonly speed: readonly [number, number];
	readonly accelY: number;
	readonly spreadDeg: number;
	readonly up: boolean;
}

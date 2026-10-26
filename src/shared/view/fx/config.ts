/**
 * Presentation tunables of the juice views on Roblox (health bars, damage numbers, particles, freeze frame). The
 * gameplay-shaped rules (sizes in render px, timings) are the web build's and live next to their logic (bars.ts,
 * numbers.ts, particles.ts, hitstop.ts); this file holds the Roblox-side choices only. Presentation only: nothing here
 * reaches the sim.
 */
import { PIXELS_PER_TILE, STUDS_PER_TILE } from "shared/config";
import type { ParticlesLevel } from "shared/settings";

export const FX_VIEW = {
	/** Studs per render pixel: the web build's 16 px per tile at STUDS_PER_TILE studs per tile (0.25). */
	pxStuds: STUDS_PER_TILE / PIXELS_PER_TILE,
	/** BillboardGui / particle draw order: bars over particles, numbers over bars (web: 900 / 1000 / 1100). */
	healthBarZ: 1,
	damageNumberZ: 2,
	/** Opacity of an empty pip (enemyHealth over the dark plate). */
	emptyPipAlpha: 0.3,
	/** Longest frame step for particles (s): a hitch never fast-forwards a burst (web MAX_FRAME_DT). */
	maxParticleDt: 0.05,
	/** Particle transparency is written in steps of this size (fewer property writes). */
	alphaQuantum: 1 / 16,
	/** Particle parts are parked here (studs) when unused; same spot as the bullet pools. */
	parkedStuds: [0, -10000, 0] as readonly [number, number, number],
	/** Folder names under Workspace. */
	particleFolder: "KV_Particles",
	barFolder: "KV_HealthBars",
	numberFolder: "KV_DamageNumbers",
	/** Damage-number glyph box: DIGIT_FONT advance 4 px and cell height 7 px (theme contract), at scale 1. */
	glyphAdvancePx: 4,
	glyphHeightPx: 7,
	/** Most glyphs a number shows (pool layout: "999+" / "CAP"). */
	maxGlyphs: 6,
	/** Text stroke transparency of damage numbers at full opacity (a dark outline like the digit strip's). */
	numberStroke: 0.2,
} as const;

/**
 * Sprite effects (docs/FX_AUDIO.md F3 / F4: FxCueMapper in fxCues.ts, the client's FxSpriteController). The drawn size,
 * tint and blend of each effect are the theme pack's (`fx.*`, at most FX_SPRITE_MAX_TILES tiles); this block is when,
 * where and how many. Presentation only.
 */
export const FX_SPRITE_VIEW = {
	/** Most live sprite effects per particle level (effectiveParticles: one level lower under reduced motion). */
	maxSprites: { off: 0, low: 24, normal: 48, high: 64 } as Readonly<Record<ParticlesLevel, number>>,
	/** Cue objects one frame can hold (>= the largest maxSprites). */
	cueCapacity: 64,
	/** A hit mark on the same actor at most this often, seconds of the effect clock. */
	hitMarkMinSec: 0.12,
	/** Hit marks turn by one of these (ImageLabel.Rotation, degrees clockwise), picked by actor id + tick. */
	hitRotationsDeg: [0, 90, 180, 270] as ReadonlyArray<number>,
	/** A swing trail is centred this fraction of the swing's radius ahead of the swing origin. */
	swingAheadFraction: 0.55,
	/** Screen direction the slash art faces (degrees counter-clockwise from screen right; the Slash sheets bulge down). */
	swingArtHeadingDeg: 270,
	/** The guard shield: drawn this far ahead of the player, its art facing this screen direction (the dome's top). */
	guardAheadTiles: 0.6,
	guardArtHeadingDeg: 90,
	/** A deflect re-shows the shield at most this often per player, seconds of the effect clock. */
	guardMinSec: 0.15,
	/** Mother Bramble's death: explosions after these delays (effect-clock seconds), offset (sim tiles) and scaled. */
	bossDeathBursts: [
		{ delaySec: 0, dx: 0, dz: 0, scale: 1 },
		{ delaySec: 0.2, dx: 0.8, dz: -0.5, scale: 0.8 },
		{ delaySec: 0.4, dx: -0.7, dz: 0.6, scale: 0.8 },
	] as ReadonlyArray<{ readonly delaySec: number; readonly dx: number; readonly dz: number; readonly scale: number }>,
	/** On the frame an actor starts a telegraph, no cue lands within its radius + this many tiles (or the slam target). */
	telegraphClearTiles: 0.75,
	/** Breakable splinters queued by the breakable renderer between two frames. */
	splinterQueue: 8,
	/**
	 * Where effects are drawn. "floor": flat on the floor (a SurfaceGui on a thin Part at liftStuds, under every floor
	 * marking at MARKING_VIEW.liftTiles and every bullet at BULLET_Y), so an effect loses every overlap with a bullet,
	 * a telegraph or the aim line; bodies stand over it. "billboard": a camera-facing BillboardGui with SpriteView's
	 * floor clearance (over the floor markings near it: for comparing in Studio, F0 / F4).
	 */
	placement: "floor" as "floor" | "billboard",
	/** Floor placement: the top of the effect's Part above the floor, studs (decor flats sit at DECOR_VIEW.flatLiftStuds). */
	liftStuds: 0.06,
	/** Effects are spread over this many layers this far apart, studs (no z-fighting between overlapping effects). */
	layers: 8,
	layerStepStuds: 0.002,
	/** Thickness of the invisible floor Part under an effect, studs. */
	thicknessStuds: 0.02,
	/** Additive effects: SurfaceGui / BillboardGui Brightness (LightInfluence 0). */
	additiveBrightness: 1.6,
	/** Longest frame step of the effect clock, seconds (a hitch never skips an effect). */
	maxFrameDt: 0.05,
	folderName: "KV_FxSprites",
	renderStep: "KV_FxSprites",
	profileLabel: "KV FxSprites",
} as const;

/** The theme's cap on an effect's drawn size (tiles), re-exported for the renderer (owned by shared/theme). */
export { FX_SPRITE_MAX_TILES } from "shared/theme";

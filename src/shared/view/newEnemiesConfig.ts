import { BOMBER, CHARGER, REAPER, STORMCALLER, WARBANNER } from "shared/sim";
import type { ColorRole } from "shared/theme";

/**
 * Presentation tunables of the second endless set (docs/NEW_ENEMIES.md NE8; logic in newEnemies.ts and the sprite
 * inputs in sprites.ts). Presentation only: nothing here reaches the sim. Gameplay timings (fuse, lane, stun, cast,
 * wind, spin, dizzy) are read from the archetypes' data, never copied here.
 */

/** Sprite inputs of the five (sprites.ts bomberSpriteInput .. warbannerSpriteInput). */
export const NEW_ENEMY_SPRITE_VIEW = {
	/** Move loops play at their authored fps at these ground speeds, world units / s (each archetype's walk speed). */
	bomberMoveRefSpeed: BOMBER.data.speed,
	chargerMoveRefSpeed: CHARGER.data.speed,
	stormcallerMoveRefSpeed: STORMCALLER.data.speed,
	warbannerMoveRefSpeed: WARBANNER.data.speed,
	reaperMoveRefSpeed: REAPER.data.speed,
	/**
	 * Optional animations of the enemy slot (theme contract ENEMY.optionalAnimations): the Bomber's detonation
	 * (`Explode`; absent: `death`), the Warbanner's retreat (`Run Backwards`; absent: `move`). The Charger's stun plays
	 * the required `hit` (TakeDamage 1) stretched over the whole stun (slowed).
	 */
	anims: { detonation: "death.2", moveBack: "move.back", stun: "hit" },
	/**
	 * `move.back` plays while the Warbanner's ground velocity points away from its facing: unit velocity . facing at
	 * most this (-0.25: more than ~105 degrees off).
	 */
	moveBackDot: -0.25,
	/** The Reaper's dizzy plays `idle` at this fraction of its fps (the plan's "Idle slowed"). */
	dizzyIdleRate: 0.5,
} as const;

/**
 * Frame marks inside the five's attack animations (fractions of the frame count, like SPRITE_ANIM_MARKS). NAMED
 * PLACEHOLDERS from the plan's frame counts on `ne-strips.png`: NE9 measures them on the built sets.
 */
export const NEW_ENEMY_ANIM_MARKS = {
	/** The Charger's `attack` (Beast 1 Slide 1, 9 frames): the rear back [0, lane) over the lane, [lane, 1] looped while charging. */
	charger: { lane: 3 / 9 },
	/**
	 * The Stormcaller's `attack` (Spawn 7 Attack 4): the staff rising [0, raise) over the cast but its last holdTicks,
	 * then held overhead [raise, 1] over the last holdTicks (the strike lands as the cast runs out).
	 */
	stormcaller: { raise: 0.6, holdTicks: 12 },
	/** The Reaper's `attack` (Spawn 5 Taunt, 12 frames): the wind f0-4 [0, spin) over the wind, f5-11 [spin, 1] looped over the spin. */
	reaper: { spin: 5 / 12 },
} as const;

/** The Bomber's fuse flash (the whole fuse; the ring at its feet is the telegraph hint). */
export const FUSE_VIEW = {
	/**
	 * The body alternates the `flash` and `telegraph` looks, one half-period each; the period shrinks from startTicks at
	 * the fuse's start to endTicks at its end (a chirp: the flashing quickens toward the blast).
	 */
	periodStartTicks: 12,
	periodEndTicks: 3,
} as const;

/** The Bomber's detonation (v[BOMBER_FUSED] = BOMBER_DETONATED on the corpse). */
export const DETONATION_VIEW = {
	/**
	 * A detonated corpse WITHOUT a `death.2` animation (placeholders, and a sprite set that lacks it) is gone fast: it
	 * fades over this many ticks (the burst replaces the body), instead of the normal corpse time.
	 */
	quickFadeTicks: 8,
	/** The burst where it blew up (ParticleController chips in the Bomber's colour). */
	burst: { chunks: 3, bits: 16, sparks: 8, startPx: 9, radius: 0.5, speed: 2.4 },
	/** Seed salt of the burst (render RNG), apart from every other burst's. */
	seedSalt: 43,
} as const;

/** The Warbanner's aura (NED8): a dashed ring under the banner and a tint on every actor it buffs (EVD12: no Highlight). */
export const AURA_VIEW = {
	/** The ring around each living Warbanner, radius WARBANNER.data.auraRadius (the sim's); dashes in studs. */
	ringDash: { width: 0.14, height: 0.03, length: 0.6, gap: 0.45 },
	ringTransparency: 0.35,
	/** Over the goo and the strike flashes, under the affix rings (AFFIX_VIEW.ringLiftStuds 0.12) and every marking. */
	ringLiftStuds: 0.119,
	/** Placeholder bodies of buffed actors: base colour lerped this far toward `enemyAura` (sprites: the rim's tint). */
	placeholderTint: 0.4,
	folderName: "KV_NewEnemyMarks",
} as const;

/** The stun / dizzy marker: stars circling the Charger's stun and the Reaper's dizzy (a placeholder for an fx). */
export const DIZZY_VIEW = {
	stars: 3,
	/** Orbit radius: the actor's radius plus this, tiles. */
	marginTiles: 0.25,
	/** Each star is a small cross of two strokes this long (tiles). */
	starTiles: 0.22,
	/** Full turns per second of the orbit (sim seconds: it freezes with the run). */
	turnsPerSec: 0.8,
	dash: { width: 0.12, height: 0.03 },
	role: "particleSpark" as ColorRole,
	transparency: 0,
	liftStuds: 0.17,
} as const;

/** The Stormcaller's lightning strike (BulletKind.STRIKE): a short flash from the decal pool path (BulletRenderController). */
export const STRIKE_VIEW = {
	/** The decal look on (false: strikes are drawn like every enemy bullet from the normal pool). */
	decal: true,
	/** It flashes in at startScale and settles to 1 over popSec; it fades over its last fadeSec (bullet time). */
	startScale: 1.35,
	popSec: 0.05,
	fadeSec: 0.05,
	/** Between the goo (top 0.11) and the aura / affix rings (0.119 / 0.12). */
	thicknessStuds: 0.006,
	liftStuds: 0.112,
	quantum: 0.05,
	folderName: "KV_Strikes",
} as const;

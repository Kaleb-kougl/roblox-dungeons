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
 * Frame marks inside the five's attack animations (fractions of the kept frame count, like SPRITE_ANIM_MARKS), measured
 * in NE9 on the built sets (art/atlases.json; body height = alpha > 250 pixels facing the camera, source row 2).
 */
export const NEW_ENEMY_ANIM_MARKS = {
	/**
	 * The Charger's `attack` (Beast 1 Slide 1, kept f0-f8, 9 frames): the rear back [0, lane) over the lane, [lane, 1]
	 * looped while charging. Measured: body 56 64 62 px over f0-f2 (standing, rearing), 54 50 48 48 49 52 over f3-f8
	 * (the low lunge; blades out to 65-70 px wide in profile), rising again from f9 (not kept): the lunge starts at kept
	 * index 3.
	 */
	charger: { lane: 3 / 9 },
	/**
	 * The Stormcaller's `attack` (Spawn 7 Attack 4, kept 0 2 4 5 6 7 8 9 10 11): the staff rising [0, raise) over the cast
	 * but its last holdTicks, then held overhead [raise, 1] over the last holdTicks (the strike lands as the cast runs
	 * out). Measured: body 52-58 px over f0-f6 (the wind-up), 68 at f7 (thrown up), 70 69 69 68 over f8-f11 with the top
	 * edge within 2 px (held straight overhead), back to 56 from f13: the hold starts at kept index 6 (source f8).
	 */
	stormcaller: { raise: 6 / 10, holdTicks: 12 },
	/**
	 * The Reaper's `attack` (Spawn 5 Taunt, kept 0 2 4 5 6 7 8 9 10, 9 frames): the wind [0, spin) over the wind, the
	 * sickles out [spin, 1] looped over the spin. Measured: body 28-29 px wide over f0-f4 (standing, sickles at the
	 * hips), 66 65 66 67 66 70 over f5-f10 (sickles held out wide; f10 loops back to f5), 53 at f11 (drawing in, not
	 * kept): the sickles open at kept index 3 (source f5).
	 */
	reaper: { spin: 3 / 9 },
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

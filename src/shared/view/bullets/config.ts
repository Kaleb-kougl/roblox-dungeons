import { CAMERA_PITCH_DEG, CAMERA_YAW_DEG } from "shared/config";
import { SIM_DT, type PayloadField } from "shared/sim";
import { BULLET_VIEW } from "../config";

/**
 * Presentation tunables of sprite bullets (docs/PROJECTILE_ART.md §3 / §4, PA4 / PA5; logic in art.ts, looks.ts and
 * impacts.ts, drawn by the client's SpriteBulletPool). Presentation only: nothing here reaches the sim.
 */
export const BULLET_ART_VIEW = {
	/** Flicker loop rate when a sprite carries no fps of its own (PAD8: 10 fps). */
	fps: 10,
	/** The frame every bullet holds under reduced motion (PAD8). */
	reducedMotionFrame: 0,
	/** Drawn sizes change in these steps of draw scale x end-of-life fade (as the neon parts: BULLET_VIEW.sizeQuantum). */
	sizeQuantum: BULLET_VIEW.sizeQuantum,
	/**
	 * A Top-face SurfaceGui's canvas sits turned this many degrees anticlockwise (seen from above, i.e. on screen) from
	 * the anchor Part's own -Z: the engine quirk FX_SPRITE_VIEW.floorCanvasTurnDeg records (owner's Studio check
	 * 2026-11-01). With 90, the canvas's up is the part's local -X and its right the part's local -Z. bulletYaw and
	 * bulletPartSize read it, so the sprite's art-up (its direction of travel) lands on the velocity.
	 */
	canvasTurnDeg: 90,
	/**
	 * The SurfaceGui canvas is the art's frame size times this (whole canvas pixels per art pixel, so the pixel art
	 * stays crisp however the engine rasterizes the canvas; the ImageLabel fills it, the Part's Size sets the drawn size).
	 */
	canvasPixelsPerArtPixel: 4,
	/** The anchor Part's thickness, studs (its top face carries the sprite at the bullet's height). */
	thicknessStuds: 0.02,
	/**
	 * Sprites of one pool spread over this many layers this far apart, by slot (no z-fighting between overlapping
	 * sprites at the same height; FX_SPRITE_VIEW's layer step).
	 */
	layers: 8,
	layerStepStuds: 0.002,
	/**
	 * Extra lift of each pool's sprites over the bullet's height, studs: enemy sprites sit just over player sprites,
	 * so danger always draws on top where the two overlap (above every layer step of the player pool).
	 */
	liftStuds: { player: 0, enemy: 0.02 },
	/**
	 * At most this many flicker-only frame writes (ImageRectOffset / ImageRectSize) per pool per frame; the rest catch
	 * up on later frames. 0: no budget (PA0 sets one if it measures a need). Look changes are never budgeted.
	 */
	maxFlickerWritesPerFrame: 0,
	/** Camera angles the screen heading uses (shared/config view). */
	cameraYawDeg: CAMERA_YAW_DEG,
	cameraPitchDeg: CAMERA_PITCH_DEG,
	/** Pool folder names under BULLET_VIEW.folderName. */
	folderNames: { player: "KV_PlayerBulletSprites", enemy: "KV_EnemyBulletSprites" },
} as const;

/** Player bullet impacts (impacts.ts BulletImpacts; docs/PROJECTILE_ART.md §3, the feed PA7's `fx.bullet.hit` reads). */
export const BULLET_IMPACT_VIEW = {
	/**
	 * A bullet that vanished while it still had more than this many ticks of life left (projected from its last seen
	 * life over the steps since) hit something; less is a natural expiry.
	 */
	minLifeTicks: 1,
	/** Seconds per bullet step (the player pool always steps SIM_DT). */
	stepDt: SIM_DT,
	/** At most this many impacts per frame (the rest are counted in `dropped`, not reported). */
	maxPerFrame: 8,
	/**
	 * A slot whose bullet shows more life than its projected life (last seen life minus the steps since) plus this
	 * many ticks holds a NEW bullet (the free list is LIFO: a freed slot is often reused at once by the same emitter):
	 * the old one vanished in between. Covers float rounding between the sim's per-step subtraction and the projection.
	 */
	sameLifeToleranceTicks: 0.5,
	/**
	 * Payload fields the sim rewrites while a bullet flies (combat.ts: each pierce spends `pierce` and records
	 * `lastHit`), left out of a bullet's identity so a pierce is not read as a vanish. Every other field (damage, kind,
	 * source) is fixed at spawn (shared/sim combat/payload.ts).
	 */
	flightFields: ["pierce", "lastHit"] as ReadonlyArray<PayloadField>,
} as const;

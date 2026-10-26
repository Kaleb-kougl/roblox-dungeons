import type { ColorRole } from "shared/theme";

/**
 * Presentation tunables of breakable barrels and crates on screen (docs/DECOR.md D4, task R13; logic in
 * breakables.ts, drawing in the client's BreakableRenderController). Presentation only: the gameplay numbers (hp,
 * damage, what blocks) live in shared/sim breakablesData.ts and placement in shared/dungeon, so nothing here can change
 * a replay. Roblox-port choices, no web source.
 */

/** A burst of wood chips (ParticleController.breakableChips -> DeathParticleSystem.chips), counts at the `normal` level. */
export interface ChipBurstView {
	/** 3 px chunks, 1-2 px bits (the piece's colour role), sparks (uiText / particleSpark). */
	readonly chunks: number;
	readonly bits: number;
	readonly sparks: number;
}

export const BREAKABLE_VIEW = {
	/**
	 * Readability: nothing a piece draws stands taller than this, tiles (5/8, the theme placeholders' cap), so no piece
	 * hides a bullet or an enemy behind it. Taller art is scaled down to fit (sprite and image paths alike).
	 */
	maxHeightTiles: 5 / 8,
	/** Pieces stand this far above the floor, studs (keeps bases off the floor slab; ACTOR_VIEW.liftStuds' value). */
	liftStuds: 0.02,
	/**
	 * Hit: the piece blinks in `flashRole` for hitBlinkSec (on / off every blinkPeriodSec), on sim time, so it holds
	 * during pause and hitstop. Not motion, so reduced motion keeps it.
	 */
	hitBlinkSec: 0.2,
	blinkPeriodSec: 0.05,
	flashRole: "damageNumber" as ColorRole,
	/**
	 * Hit: a small shake along the screen's x axis, a decaying sine, amplitude x the juice motionScale (none under
	 * reduced motion): shakeSec long, shakeStuds at its peak, shakeHz back-and-forth.
	 */
	shakeSec: 0.16,
	shakeStuds: 0.2,
	shakeHz: 22,
	/** Every hit (a stopped bullet, a swing) throws the juice layer's hit sparks at the piece (DeathParticleSystem.hit). */
	hitSparks: true,
	/** Break: chips per kind (BREAKABLE_KINDS order: barrel, crate), scaled by the particle level like every burst. */
	chips: [
		{ chunks: 3, bits: 10, sparks: 3 },
		{ chunks: 4, bits: 12, sparks: 3 },
	] as ReadonlyArray<ChipBurstView>,
	/** Chips start this high (render px above the floor: the piece's body) and spread this far round the cell (tiles). */
	chipStartPx: 8,
	chipRadiusTiles: 0.35,
	/** Chip speed multiplier (the death bursts' speeds: 1). Wood flies a little slower than a dying swarmer. */
	chipSpeed: 0.8,
	/** Burst seed salts (render rng, shared/view/fx burstSeed), kept apart from the actors' (0..3). */
	hitSeedSalt: 11,
	chipSeedSalt: 12,
	/** The sprite set's intact animation and its one-shot break (theme BREAKABLE_SHATTER_ANIMATION). */
	idleAnimation: "idle",
	/** The broken piece's flat decal (decor brokenBarrel / brokenCrate): a Part this thick, its top this far up, studs. */
	debrisThicknessStuds: 0.05,
	debrisLiftStuds: 0.03,
	/** decorHash salt of the debris variant (no floor seed: by cell only), distinct from DECOR_SALT's. */
	debrisSalt: 0x4cf5ad43,
	/** Workspace folder of the pieces and decals. */
	folderName: "KV_Breakables",
	profileLabel: "KV Breakables",
} as const;

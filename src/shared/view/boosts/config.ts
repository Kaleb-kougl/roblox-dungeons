import type { ColorRole } from "shared/theme";

/**
 * Presentation tunables of boost drops (docs/BOOSTS.md B6 / B7; logic in boosts.ts, drawing in the client's
 * BoostDropRenderController / BoostAuraController and the HUD's BoostRow). Presentation only: the gameplay numbers
 * (chances, durations, pickup radius, ground life) live in shared/sim dropsData.ts, so nothing here can change a
 * replay. Roblox-port choices, no web source.
 */

/** A burst of bits for a pickup / a fade (ParticleController.boostBurst -> DeathParticleSystem.chips), `normal` level. */
export interface BoostBurstView {
	/** 3 px chunks, 1-2 px bits (the kind's colour role), sparks (uiText / particleSpark). */
	readonly chunks: number;
	readonly bits: number;
	readonly sparks: number;
	/** Start height (render px above the floor) and spread round the drop (tiles). */
	readonly startPx: number;
	readonly radiusTiles: number;
	/** Speed multiplier (the death bursts' speeds: 1). */
	readonly speed: number;
}

export const BOOST_VIEW = {
	// --- the drop on the floor -----------------------------------------------------------------------------------
	/**
	 * Readability: a drop's body (art or the placeholder gem) stands no taller than this above its base, tiles (5/8,
	 * the theme placeholders' cap, like breakables), so it never hides a bullet behind it. Taller art is scaled down.
	 */
	maxHeightTiles: 5 / 8,
	/** Drops stand this far above the floor, studs (keeps the gem off the floor slab; ACTOR_VIEW.liftStuds' value). */
	liftStuds: 0.02,
	/** Bob: up and down by bobStuds (x the juice motionScale: none under reduced motion), bobHz times a second. */
	bobStuds: 0.35,
	bobHz: 0.8,
	/**
	 * Blink while fading: during a drop's last blinkSeconds on the floor (and a boost's last blinkSeconds in the HUD) it
	 * alternates between opaque and blinkTransparency every blinkPeriodSec, on sim time (a drop's `ticksLeft`, a HUD
	 * entry's `secondsLeft`), so it holds during drafts and pause. Under reduced motion it does not flash: it stays at
	 * reducedBlinkTransparency for those seconds.
	 */
	blinkSeconds: 2,
	blinkPeriodSec: 0.2,
	blinkTransparency: 0.75,
	reducedBlinkTransparency: 0.4,
	/** Pop on landing: the body grows from popFromScale to full size over popSeconds (sim time); none under reduced motion. */
	popSeconds: 0.25,
	popFromScale: 0.3,
	/** Pickup burst (when the pack has no `fx.boost.collect` art) and the fade's poof, scaled by the particle level. */
	collectBurst: { chunks: 2, bits: 12, sparks: 4, startPx: 8, radiusTiles: 0.25, speed: 1 } as BoostBurstView,
	poofBurst: { chunks: 0, bits: 6, sparks: 2, startPx: 6, radiusTiles: 0.2, speed: 0.5 } as BoostBurstView,
	/** Burst seed salts (render rng, shared/view/fx burstSeed), apart from the actors' (0..3) and breakables' (11, 12). */
	collectSeedSalt: 13,
	poofSeedSalt: 14,
	/** The sprite set's loop (theme BOOST slot base animation). */
	idleAnimation: "idle",
	/** Workspace folder of the drops and its render step / profiler label. */
	folderName: "KV_Drops",
	renderStep: "KV_Drops",
	profileLabel: "KV Drops",

	// --- the aura on a boosted player ------------------------------------------------------------------------------
	/**
	 * One flat tinted disc per running boost under the player (every party member), concentric: the first running kind
	 * (Boost order) innermost and on top. Readability: the whole stack stays under auraMaxHeightTiles above the floor
	 * (well under the bullets' plane, shared/sim BULLET_Y), so an aura never covers a bullet.
	 */
	auraMaxHeightTiles: 0.1,
	/** The innermost disc's radius and each further disc's extra radius, tiles. */
	auraRadiusTiles: 0.55,
	auraRingStepTiles: 0.14,
	/** Each disc's thickness, the lowest one's lift above the floor and the step between stacked discs, studs. */
	auraThicknessStuds: 0.04,
	auraLiftStuds: 0.03,
	auraStackStuds: 0.02,
	/** Disc transparency, and its pulse (amplitude x motionScale, auraPulseHz a second; none under reduced motion). */
	auraTransparency: 0.55,
	auraPulseAmplitude: 0.15,
	auraPulseHz: 1.2,
	/** Enum.Material name of the discs (a soft glow on every floor). */
	auraMaterial: "Neon",
	auraFolderName: "KV_BoostAuras",
	auraRenderStep: "KV_BoostAuras",

	// --- the HUD's boost row (BoostRow, under the status panel's pips) -----------------------------------------------
	/** The icon square (the kind's colour role, its `boost.<kind>.icon` label in iconTextRole), reference px. */
	iconSize: 22,
	iconTextSize: 10,
	iconTextRole: "uiPanel" as ColorRole,
	/** Gap between an entry's icon and its bar, reference px. */
	iconBarGap: 3,
	/** The Aegis pip in the armor row (a diamond after the armor pips): the Aegis kind's colour role. */
	aegisPipRole: "boost.aegis" as ColorRole,
	/** The draining bar beside it: width, height, and its empty track's role. */
	barWidth: 56,
	barHeight: 6,
	barTrackRole: "uiPanel" as ColorRole,
	/** HUD seconds are shown in steps of 1 / secondsQuantum s (tenths), so the row re-renders at most that often. */
	secondsQuantum: 10,
	/** The tutorial's highlight id for the boost row (shared/tutorial TutorialHighlight; docs/BOOSTS.md B9). */
	hudHighlight: "boosts",
} as const;

import type { ColorRole } from "shared/theme";
import { BREAKABLE_VIEW } from "./breakablesConfig";

/**
 * Presentation tunables of boosts from breakables (docs/BREAKABLE_DROPS.md BL6; logic in breakableLoot.ts, drawing in
 * the client's BreakableRenderController (the glint, KV_LootDebug), BoostDropRenderController (the hop) and
 * ParticleController (the fizzle)). Presentation only: which pieces hold what is decided in shared/dungeon and released
 * in shared/sim, so nothing here can change a replay. Roblox-port choices, no web source.
 */

/** The fizzle of a boost lost on a full floor (ParticleController.lootFizzle -> DeathParticleSystem.chips), `normal` level. */
export interface LootFizzleView {
	/** 3 px chunks, 1-2 px bits (fizzleRole), sparks (uiText / particleSpark). */
	readonly chunks: number;
	readonly bits: number;
	readonly sparks: number;
	/** Start height (render px above the floor) and spread round the piece's cell (tiles). */
	readonly startPx: number;
	readonly radiusTiles: number;
	/** Speed multiplier (the death bursts' speeds: 1). */
	readonly speed: number;
}

export const BREAKABLE_LOOT_VIEW = {
	// --- the glint on a loaded intact piece (BLD3) ------------------------------------------------------------------
	/**
	 * The pack's `decor.fx.glint` (the treasure sparkle, also drawn over boost gems) plays once every glintEverySeconds
	 * of sim time on a loaded piece (hidden between), each piece glintPhaseSlots / glintPhaseSlots of the cycle off the
	 * others by its cell hash (lootGlintPhaseSec), so two loaded crates never sparkle in step and every client of a party
	 * sees the same glint at the same tick. Art without frames (an image, or a sprite with no fps) shows for
	 * glintFlashSeconds per cycle. No glint art: no glint.
	 */
	glintEverySeconds: 3.5,
	glintFlashSeconds: 0.45,
	glintPhaseSlots: 64,
	/** decorHash salt of the phase (by cell only, no floor seed), apart from BREAKABLE_VIEW.debrisSalt. */
	glintPhaseSalt: 0x1b873593,
	/** Soft: the sparkle's ImageTransparency while it plays. */
	glintTransparency: 0.2,
	/** Reduced motion (motionScale 0): a still sparkle, always shown at this transparency, frame glintStillFrame. */
	reducedTransparency: 0.4,
	glintStillFrame: 2,
	/**
	 * Its billboard: the art's own size x glintScale, centred glintTopFraction of the way up the piece as drawn (on its
	 * top, inside its silhouette's height cap BREAKABLE_VIEW.maxHeightTiles), glintDepthStuds nearer the camera than the
	 * piece's own front so the piece never hides it.
	 */
	glintScale: 0.55,
	glintTopFraction: 0.85,
	glintDepthStuds: 0.15,
	/**
	 * Never over a bullet: the glint hides while an enemy bullet's centre is within duckTiles (a square round the
	 * piece's cell centre, sim floor units; the glint is drawn depth-tested, never AlwaysOnTop).
	 */
	duckTiles: 1.25,

	// --- the hop of a boost out of a broken piece -------------------------------------------------------------------
	/**
	 * The released gem starts at the piece's top (hopFromTiles above the floor: the pieces' height cap) and lands on the
	 * floor over hopSeconds of sim time along a parabola that rises hopTiles above the straight line at its middle
	 * (lootHopStuds), instead of a kill drop's pop. Then it bobs like any drop, its bob starting at the landing. None
	 * under reduced motion (it simply lies there).
	 */
	hopFromTiles: BREAKABLE_VIEW.maxHeightTiles,
	hopTiles: 0.6,
	hopSeconds: 0.38,

	// --- the fizzle of a boost lost on a full floor (BLD5) ----------------------------------------------------------
	/** A small grey puff at the piece (no sound of its own: the break plays), scaled by the particle level. */
	fizzleBurst: { chunks: 0, bits: 7, sparks: 1, startPx: 8, radiusTiles: 0.2, speed: 0.45 } as LootFizzleView,
	fizzleRole: "uiTextDim" as ColorRole,
	/** Burst seed salt (render rng, shared/view/fx burstSeed), apart from the boosts' (13, 14) and the near misses'. */
	fizzleSeedSalt: 18,

	// --- KV_LootDebug (Studio check aid, off by default) ------------------------------------------------------------
	/**
	 * Workspace boolean attribute (Studio, or with KV_Debug): a label with the boost kind over every loaded intact piece.
	 * Developer text, English only (AutoLocalize off through client/ui createKvBillboardGui).
	 */
	debugAttribute: "KV_LootDebug",
	/** The label: lifted this far above the piece's base (studs), this big (px), in this role. */
	debugLiftStuds: 4,
	debugWidthPx: 96,
	debugHeightPx: 20,
	debugTextSize: 14,
	debugRole: "uiText" as ColorRole,
} as const;

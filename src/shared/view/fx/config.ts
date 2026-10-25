/**
 * Presentation tunables of the juice views on Roblox (health bars, damage numbers, particles, freeze frame). The
 * gameplay-shaped rules (sizes in render px, timings) are the web build's and live next to their logic (bars.ts,
 * numbers.ts, particles.ts, hitstop.ts); this file holds the Roblox-side choices only. Presentation only: nothing here
 * reaches the sim.
 */
import { PIXELS_PER_TILE, STUDS_PER_TILE } from "shared/config";

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

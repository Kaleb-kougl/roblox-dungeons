/**
 * Room clear celebration tunables (docs/ROOM_CLEAR.md). Real (unpaused) seconds unless the name says otherwise. The
 * sequence clock is NOT slowed by hitstop: the stamp must not crawl through its own slow motion. Data only.
 */
export const ROOM_CLEAR = {
	/** Every phase of the full sequence and of a chip ends by this (RCD10). */
	totalSec: 1.5,
	/** Longest step one frame may take (a hitch never skips the stamp). */
	maxFrameDtSec: 0.1,
	/** Solo slow motion (RCD11): HitstopClock.requestSlowMo(ms, fromScale). */
	slowMo: {
		clear: { fromScale: 0.5, ms: 500 },
		perfect: { fromScale: 0.5, ms: 700 },
	},
	stamp: {
		delaySec: 0.06,
		slamSec: 0.1,
		/** Scale at the start of the slam (it eases out back to 1). */
		slamFromScale: 2,
		/** The stamp is opaque after this fraction of the slam. */
		fadeInFraction: 0.4,
		/** PERFECT is drawn this much larger. */
		perfectScale: 1.1,
		/** PERFECT's shine sweeps once across the letters after the landing. */
		shineSec: 0.4,
		/** Ease-out-back overshoot constant (the standard 1.70158). */
		easeBack: 1.70158,
	},
	/** The tally row: segment i starts at startSec + i x gapSec and counts up over countSec. */
	tally: { startSec: 0.3, gapSec: 0.12, countSec: 0.2 },
	/** The bonus chip flies to the score panel; it lands (the bonus is released) at startSec + sec. */
	fly: { startSec: 0.95, sec: 0.2 },
	/** Stamp, tally and chips fade out from here to totalSec. */
	fadeStartSec: 1.2,
	/** A collapsed sequence fades out over this. */
	collapseSec: 0.15,
	/** The corner chip (RCD12): slides in from the right, merges into the score at mergeSec. */
	chip: { slideSec: 0.12, slidePx: 40, mergeSec: 0.9, max: 2, jingleVolume: 0.5 },
	/** The score panel rolls a kill's points over killSec and a landed bonus over bonusSec. */
	roll: { killSec: 0.15, bonusSec: 0.3 },
	/** Co-op: the view player within this many tiles of the room's bounds gets the full sequence, else a chip. */
	nearTiles: 4,
	/** Co-op: the last killed member's sprite holds this long (instead of slow motion). */
	coopHoldSec: 0.2,
	/** The spark ring at the last kill (ParticleController chips, BOOST_VIEW burst shape). */
	burst: { chunks: 0, bits: 16, sparks: 10, startPx: 8, radiusTiles: 0.4, speed: 1.4 },
	/** burstSeed salt (actors use 0..3, breakables 11 / 12, boosts 13 / 14). */
	burstSeedSalt: 15,
} as const;

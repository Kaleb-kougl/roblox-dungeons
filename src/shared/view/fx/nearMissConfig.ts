/**
 * Grazes and parries tunables (docs/GRAZE_PARRY.md GP4, decisions GPD3-GPD7). Real (unpaused) seconds unless the name
 * says otherwise; sizes in render pixels (px) or tiles. Data only: NearMissDirector (nearMissRules.ts) applies the
 * chain, grouping, cap and gate rules; the particle, audio and flash code read the drawing / mixing numbers. The guard
 * window the parry grouping uses is the sim's swordGuardTicks (never copied here).
 */
export const NEAR_MISS_VIEW = {
	/** A graze (GPD3 / GPD4): small, frequent. */
	graze: {
		/** Grazes by one player less than this apart form a chain (the pitch ladder); a longer gap resets it. */
		chainGapSec: 0.5,
		/** Semitones added per graze in a chain (the chain's first graze plays at +0). */
		semitoneStep: 1,
		/** Never above this many semitones. */
		maxSemitones: 7,
		/** At most one graze cue per this many seconds (and at most one per frame). */
		minIntervalSec: 0.05,
		/** sfx.player.graze's volume (quiet: the smallest reward). */
		volume: 0.35,
		/** At most this many graze sparks per frame (the view player's grazes kept first). */
		sparksPerFrame: 6,
		/** Sparks per graze, their size range and life; plus one streak of streakPx along the bullet's path. */
		sparkCount: 3,
		sparkMinPx: 1,
		sparkMaxPx: 2,
		streakPx: 1,
		lifeSec: 0.18,
		/**
		 * Drawing (GP5, the particle system's KIND_GRAZE): spark speed range (tiles/s along the bullet's direction, with
		 * exponential drag 1/s, so a spark travels about speed / drag), the spray's half-angle (radians), the share of
		 * life fully opaque before the fade. No hop: graze sparks stay on the floor plane.
		 */
		sparkSpeedMin: 3,
		sparkSpeedMax: 7,
		spreadRad: 0.35,
		drag: 12,
		hold: 0.35,
		/** The streak: this many streakPx dots one render pixel apart along the path, centred on the skim point. */
		streakDots: 3,
		/** The streak's dots all move along the path at this speed (tiles/s, the same drag), so the line stays rigid. */
		streakSpeed: 4,
		/** Graze sparks never recycle other particles: a graze spawns only while the pool is below this share of the limit. */
		maxFill: 0.75,
		/** burstSeed salt of a graze's sparks (the other particle salts: 1-3, 11-15). */
		seedSalt: 16,
	},
	/** A parry: a sword guard that erased at least one enemy bullet (GPD5 / GPD6). */
	parry: {
		/** At most this many bursts per frame; the rest merge into the nearest kept burst (its weight grows). */
		burstsPerFrame: 8,
		/** Sparks per burst, thrown away from the guarding player, plus one ring of ringPx. */
		sparkCount: 6,
		ringPx: 1,
		lifeSec: 0.25,
		/**
		 * Drawing (GP5, the particle system's KIND_PARRY): spark size range (px), speed range (tiles/s, thrown along the
		 * burst's direction), the fan's half-angle (radians), drag (1/s), a small hop (px/s up; none under reduced motion),
		 * the share of life fully opaque. Parry sparks recycle the most-faded particle at the live limit, like a burst.
		 */
		sparkMinPx: 1,
		sparkMaxPx: 2,
		sparkSpeedMin: 5,
		sparkSpeedMax: 11,
		fanRad: 0.9,
		drag: 10,
		hopMinPx: 20,
		hopMaxPx: 45,
		hold: 0.35,
		/** The ring: radius ringR0Tiles -> ringR1Tiles (ease-out) over lifeSec; RING_SEGMENTS dots of ringPx. */
		ringR0Tiles: 0.1,
		ringR1Tiles: 0.55,
		/** A merged burst (weight > 1) adds sparksPerMerged per merged erase, at most maxMergedSparks (before the level). */
		sparksPerMerged: 1,
		maxMergedSparks: 4,
		/** burstSeed salt of a parry burst. */
		seedSalt: 17,
		/** A guard whose first frame already erased bigFrom or more plays sfx.player.parry bigSemitones up. */
		bigFrom: 3,
		bigSemitones: 3,
	},
	/** The PARRY! floor flash (GPD5): one per guard per player. */
	flash: {
		/** Whole life from the guard's first erase. */
		sec: 0.45,
		/** Pops in from popScale to 1 over popSec (no pop under reduced motion). */
		popSec: 0.08,
		popScale: 1.4,
		/** Fades out over the last fadeSec of `sec`. */
		fadeSec: 0.15,
		/** Centred this many tiles screen-down from the guarding player (the combo shout slides screen-up). */
		offsetTiles: 1.2,
		/** "PARRY! xN" from this many erases in one guard. */
		countFrom: 3,
		/** A teammate's flash is drawn at this scale (GPD6). */
		teammateScale: 0.7,
	},
	/** Solo freeze on a view player's guard's first erase (GPD7), through the hitstop clock. */
	freezeMs: 30,
} as const;

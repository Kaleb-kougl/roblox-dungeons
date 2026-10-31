/**
 * Build effects tunables (docs/BUILDS.md BU8, "View and client"; decisions BUD12, BUD13). Real (unpaused) seconds unless
 * the name says otherwise; sizes in tiles or render pixels (px). Data only: BuildFxDirector (buildFxRules.ts) applies
 * the timing, cap and setting rules, the client's BuildFxController draws what it puts out, and the audio cue mapper
 * (shared/view/audio cues.ts) reads the `audio` block. The beam's life is the sim's SPARK_BEAM_TICKS (never copied
 * here).
 */
import type { ColorRole } from "shared/theme";

/** What a nova ring is drawn in, per the sim's nova kind (BU5's Overflowing / Bulwark; any other kind: `fallback`). */
export interface NovaLook {
	readonly role: ColorRole;
}

export const BUILD_FX_VIEW = {
	/** Chain Spark's jagged beam per hop (pooled Neon segments in build.spark). */
	beam: {
		/** Jagged segments per beam (Full); Reduced keeps these too (the beam IS the effect: only particles halve). */
		segments: 5,
		/** Each inner joint sits up to this many tiles off the straight line (perpendicular), at most jagShare of the hop. */
		jagTiles: 0.22,
		jagShare: 0.18,
		/** Full: the joints re-roll every this many seconds (a crackle); never under reduced motion (one jag per beam). */
		rejagSec: 0.04,
		/** Segment thickness, studs (a thin bolt), and its height above the floor (over the floor decals, under bullets). */
		thicknessStuds: 0.12,
		liftStuds: 0.35,
		/** Opaque for this share of its life, then fades out. */
		hold: 0.4,
		/** At most this many beams alive; a new one past the cap replaces the oldest. */
		maxAlive: 24,
		/** Seed salt of a beam's jag (render RNG; the other salts: 1-3, 11-17, 41). */
		seedSalt: 51,
	},
	/** Spark burst at each spark target (the particle system's chips in build.spark). Reduced halves every count. */
	sparkBurst: {
		/** Full counts (ChipBurst fields). */
		chunks: 0,
		bits: 4,
		sparks: 6,
		startPx: 2,
		radius: 0.25,
		speed: 0.9,
		/** At most this many bursts per frame (the view player's first). */
		perFrame: 8,
		seedSalt: 52,
	},
	/** A nova (BU5: Overflowing / Bulwark): an expanding floor ring of segments, radius 0 -> the nova's radius. */
	nova: {
		sec: 0.35,
		/** Ring segments (Full); Reduced halves them. */
		segments: 24,
		/** Segment thickness and lift, studs (a flat band on the floor, over the ember decals). */
		thicknessStuds: 0.05,
		widthStuds: 0.3,
		liftStuds: 0.12,
		/** Fades out over the last fadeShare of its life. */
		fadeShare: 0.5,
		maxAlive: 8,
		/** Nova kind -> look; a kind missing here uses `fallback`. */
		looks: [] as ReadonlyArray<NovaLook>,
		fallback: { role: "build.spark" } as NovaLook,
	},
	/** Executioner's flash on the executed enemy (BU5): a flat disc popping out and fading. */
	execute: {
		sec: 0.22,
		/** Disc diameter, tiles: popScale x at the start -> 1 x over popSec (no pop under reduced motion). */
		diameterTiles: 1.1,
		popScale: 0.4,
		popSec: 0.08,
		liftStuds: 0.14,
		thicknessStuds: 0.04,
		/** The plan's red "execute" flash: the HUD's health red (a hit marker on a dying enemy, never a hazard on the floor). */
		role: "uiHealth" as ColorRole,
		maxAlive: 8,
	},
	/** The evolve / duo flare on the knight (BU8): a ring around the player in the card's colour, 1 s. */
	flare: {
		sec: 1,
		/** Radius, tiles: r0 -> r1 (ease-out); under reduced motion it stays at r1 and only fades. */
		r0Tiles: 0.3,
		r1Tiles: 1.4,
		segments: 20,
		thicknessStuds: 0.05,
		widthStuds: 0.25,
		liftStuds: 0.13,
		fadeShare: 0.6,
		evolvedRole: "boon.evolved" as ColorRole,
		duoRole: "boon.duo" as ColorRole,
	},
	/** Jackpot's gold pop (BU5; slot only until the sim's feed names its fields): lives this long. */
	jackpot: {
		sec: 0.8,
		maxAlive: 4,
	},
	/** Reduced (BUD13): spark / nova particle counts and ring segments times this (rounded, at least 1 where > 0). */
	reducedShare: 0.5,
	/** The cues (the audio mapper's build block, cues.ts). */
	audio: {
		/** Semitones added per proc generation (gen 0 = the player's own kill plays at +0), capped at maxSemitones. */
		semitoneStep: 2,
		maxSemitones: 6,
		/**
		 * Voice cap: at most this many build cues start within any voiceWindowSec (a cascade must not machine-gun); the
		 * evolve and duo stings are outside the cap.
		 */
		maxVoices: 4,
		voiceWindowSec: 0.25,
		/** Volume of each build cue (an effect is never louder than the player's own hits). */
		volume: 0.6,
	},
} as const;

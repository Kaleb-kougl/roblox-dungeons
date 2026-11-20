/**
 * Build effects tunables (docs/BUILDS.md BU8, "View and client"; decisions BUD12, BUD13). Real (unpaused) seconds unless
 * the name says otherwise; sizes in tiles or render pixels (px). Data only: BuildFxDirector (buildFxRules.ts) applies
 * the timing, cap and setting rules, the client's BuildFxController draws what it puts out, and the audio cue mapper
 * (shared/view/audio cues.ts) reads the `audio` block. The beam's life is the sim's SPARK_BEAM_TICKS (never copied
 * here).
 *
 * @module
 */
import type { ColorRole } from "shared/theme";

/** What a nova ring is drawn in, per the sim's nova kind (BU5's Overflowing / Bulwark; any other kind: `fallback`). */
export interface NovaLook {
	readonly role: ColorRole;
}

/**
 * The floor rings' drawing blocks (BUILD_FX_VIEW keys): novas, evolve / duo flares, Lionheart pulses, origin flares,
 * Unshaken's shield glints and Bastion's brace ring (docs/LEGENDARIES.md LG6).
 */
export type BuildRingLook = "nova" | "flare" | "heal" | "pop" | "glint" | "brace";

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
		/** A Storm Crown fork (BU5's sparkFork) is drawn thinner: thicknessStuds times this (a branch off the hop). */
		forkThicknessShare: 0.6,
		/** Opaque for this share of its life, then fades out. */
		hold: 0.4,
		/** At most this many beams alive; a new one past the cap replaces the oldest. */
		maxAlive: 24,
		/** Seed salt of a beam's jag (render RNG; the other salts: 1-3, 11-17, 41, and 52-53 below). */
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
		/**
		 * Nova kind (the sim's NovaKind) -> look; a kind missing here uses `fallback`. Overflowing (a flask drink) in the
		 * flask effect's fx.heal, Bulwark (an armor pip broke) in build.spark's electric blue: existing roles, both kept
		 * >= 40 CIE76 from the enemy bullets (fx.heal by the fx rules, build.spark by buildReport).
		 */
		looks: [{ role: "fx.heal" }, { role: "build.spark" }] as ReadonlyArray<NovaLook>,
		fallback: { role: "build.spark" } as NovaLook,
	},
	/** Lionheart's heal pulse (BU5): a ring around the healed player (following them) in the heal effect's role. */
	heal: {
		sec: 0.6,
		/** Radius, tiles: r0 -> r1 (ease-out); r1 throughout under reduced motion (it only fades). */
		r0Tiles: 0.5,
		r1Tiles: 1.2,
		/** Ring segments (Full); Reduced halves them. */
		segments: 16,
		thicknessStuds: 0.05,
		widthStuds: 0.22,
		liftStuds: 0.13,
		fadeShare: 0.6,
		role: "fx.heal" as ColorRole,
	},
	/**
	 * A small flare at the origin of a Momentum volley, a Thrill Seeker ring, a Flurry release and a Ricochet split
	 * (BU5): a quick ring, r0 -> r1 (+ tierTiles per Momentum tier above the first), in the colour of the bullets it
	 * fired (shards: build.shard; spark bolts: build.spark). It stays where it was released. BU6's duo procs (Storm
	 * Blade / Conductor: the enemy the spark left from; Chain Reaction: the corpse; Close Call: the player) pop the same
	 * ring in duoRole, the duo card's colour (their sparks / bullets are drawn as any spark / effect bullet).
	 */
	pop: {
		sec: 0.25,
		r0Tiles: 0.1,
		r1Tiles: 0.55,
		tierTiles: 0.1,
		/** Ring segments (Full); Reduced halves them. */
		segments: 12,
		thicknessStuds: 0.05,
		widthStuds: 0.18,
		liftStuds: 0.12,
		fadeShare: 0.6,
		/** At most this many alive (a new one past the cap replaces the oldest). */
		maxAlive: 12,
		momentumRole: "build.shard" as ColorRole,
		thrillRole: "build.spark" as ColorRole,
		flurryRole: "build.spark" as ColorRole,
		ricochetRole: "build.spark" as ColorRole,
		duoRole: "boon.duo" as ColorRole,
	},
	/**
	 * Unshaken's shield glint (BU6): a hit on armor that the duo kept off the combo closes a quick ring in on the hit
	 * player (r0 -> r1, following them), in the duo card's colour. A newer glint replaces theirs.
	 */
	glint: {
		sec: 0.4,
		/** Radius, tiles: r0 -> r1 (ease-out, closing in); r1 throughout under reduced motion (it only fades). */
		r0Tiles: 1.1,
		r1Tiles: 0.7,
		/** Ring segments (Full); Reduced halves them. */
		segments: 16,
		thicknessStuds: 0.05,
		widthStuds: 0.2,
		liftStuds: 0.14,
		fadeShare: 0.5,
		role: "boon.duo" as ColorRole,
	},
	/**
	 * Phantom Step's erase sparks (BU5): a few chips where each enemy bullet vanished in a roll, in build.shard's
	 * violet-white (the ghost's colour, never a danger role). Reduced halves every count; none with particles off.
	 */
	phantom: {
		chunks: 0,
		bits: 2,
		sparks: 3,
		startPx: 2,
		radius: 0.15,
		speed: 0.7,
		/** At most this many per frame (the view player's first). */
		perFrame: 8,
		seedSalt: 53,
		role: "build.shard" as ColorRole,
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
	/**
	 * Jackpot's pop (BU5): a big gold score pop over the corpse, drawn by the client's ScorePopController with the score
	 * pops' machinery (scorePops.ts: life, fade, rise, the damageNumbers setting) in its own small pool: this many times
	 * the glyph size, `liftPx` higher, in boon.legendary's candle gold (a HUD text colour, never on the floor).
	 */
	jackpot: {
		maxAlive: 4,
		scale: 2,
		liftPx: 6,
		role: "boon.legendary" as ColorRole,
	},
	/**
	 * Gold Rush's kill pop (BU6): that kill's own score pop (the kill pops' pool, size and rules) in the duo card's
	 * colour instead of uiAccent, so a kill Gold Rush raised reads apart (a HUD text colour, never on the floor).
	 */
	goldRush: {
		role: "boon.duo" as ColorRole,
	},
	/**
	 * Overkill's streak (docs/LEGENDARIES.md LG6): one straight streak per strike, corpse -> target, the spark beam's
	 * construction (pooled Neon segments) but one segment, no jag, thicker, in build.overkill with a white core (the
	 * role is only 10.4 CIE76 from build.burst's Volatile bolts: the streak reads by its shape, a straight thick line).
	 * An impact flash (a flat disc, popping out) at the target. Reduced: a thin streak (reducedThicknessStuds), no core,
	 * no flash. Reduced motion: no pop.
	 */
	overkill: {
		/** The streak's whole life, real seconds: opaque for `hold` of it, then fading. */
		sec: 0.16,
		hold: 0.45,
		/** Thickness, studs, for a carry of 1; + carryStuds per point of carry above 1, at most maxCarrySteps of them. */
		thicknessStuds: 0.22,
		carryStuds: 0.03,
		maxCarrySteps: 4,
		/** Reduced: every streak this thin (studs), no core. */
		reducedThicknessStuds: 0.1,
		/** Skewer's streak (the duo fired on its line) is thicker by this share (Full and Reduced). */
		skewerThicknessShare: 1.3,
		/** Height above the floor (just over the spark beams, under the bullets). */
		liftStuds: 0.37,
		/** The white core: this share of the streak's thickness, the role mixed this far toward white, a hair above it. */
		coreShare: 0.4,
		coreWhiteMix: 0.75,
		coreLiftStuds: 0.01,
		/** At most this many alive; a new one past the cap replaces the oldest. */
		maxAlive: 24,
		role: "build.overkill" as ColorRole,
		/** The impact flash at the target (Full only). */
		impact: {
			sec: 0.18,
			/** Disc diameter, tiles: popScale x at the start -> 1 x over popSec (no pop under reduced motion). */
			diameterTiles: 0.8,
			popScale: 0.5,
			popSec: 0.06,
			liftStuds: 0.15,
			thicknessStuds: 0.04,
			maxAlive: 8,
		},
	},
	/**
	 * Bastion's brace (docs/LEGENDARIES.md LG6): a short stone ring cracks on the knight (following them): the ring
	 * widens r0 -> r1 while its segments shrink after crackAt of its life (gaps open: the crack), in the armor pips'
	 * uiMana. PIP and HEAL draw it at full strength; SPENT (nothing to restore) a faint one (spentStrength). HEAL adds
	 * Lionheart's heal pulse (the `heal` block). The floor shout, the armor row's pulse and the toast are the client's
	 * BraceFxController's (braceFx.ts BRACE_VIEW).
	 */
	brace: {
		sec: 0.3,
		r0Tiles: 0.75,
		r1Tiles: 1,
		/** Ring segments (Full); Reduced halves them. */
		segments: 10,
		thicknessStuds: 0.06,
		widthStuds: 0.24,
		liftStuds: 0.14,
		fadeShare: 0.5,
		/** Segments keep their full chord until this share of the life, then shrink to minChordShare at the end. */
		crackAt: 0.3,
		minChordShare: 0.45,
		/** A SPENT brace's ring: opacity times this. */
		spentStrength: 0.35,
		role: "uiMana" as ColorRole,
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

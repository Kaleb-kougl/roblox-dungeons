/**
 * Builds v2, wave 1 effects tunables (docs/BUILDS_V2.md Architecture 6, BV11). Data only: the pure planners beside this
 * file apply them (counterWaveFx.ts, siegeFx.ts, wreckerFx.ts, heartBeamFx.ts, overcapFx.ts; the shared helpers in
 * buildsV2Fx.ts), the client's controllers draw what they put out, and the audio cue mapper (shared/view/audio cues.ts)
 * reads `parryLadder`. Times are SIM seconds (the planners age everything on state.tick + alpha, so a pause, the
 * draft and a freeze hold every effect, and the counter-wave's radius is the sim's sweep exactly); sizes in tiles or
 * studs; px are render px. The gameplay numbers (the wave's speed and range, SIEGE_SHOCK_RADIUS, DEMOLITION_RADIUS,
 * FULL_HEART_RADIUS, HAPPY_HOUR_TICKS, ...) are the sim's (shared/sim effectsData.ts), never copied here: the ring
 * radii below that name one read it. Presentation only.
 *
 * @module
 */
import type { ColorRole } from "shared/theme";

/**
 * The overcap pops' merge window (docs/BUILDS_V2.md Architecture 6, "the overcap pops (merged per 0.25 s)"): every
 * payout within this many sim seconds of a pop's first one, near it, adds to that pop's "+N".
 */
export const OVERCAP_POP_MERGE_SEC = 0.25;

/** A floor ring look's block (BUILDS_V2_FX keys with a ring): life, radii, segments and drawing sizes. */
export interface WaveOneRingBlock {
	/** Whole life, sim seconds; radius r0 -> r1 eased out (r1 throughout under reduced motion). */
	readonly sec: number;
	readonly r0Tiles: number;
	readonly r1Tiles: number;
	/** Fades out over the last fadeShare of its life. */
	readonly fadeShare: number;
	/** Segments of a full ring (Full; Reduced: buildFxCount). */
	readonly segments: number;
	readonly thicknessStuds: number;
	readonly widthStuds: number;
	readonly liftStuds: number;
	/** At most this many alive; a new one past the cap replaces the oldest. */
	readonly maxAlive: number;
	readonly role: ColorRole;
}

export const BUILDS_V2_FX = {
	/**
	 * Co-op (Studio item 12, "a teammate's waves, pins and smashes read as theirs"): every wave 1 floor effect carries
	 * its owner and `mine` (owner = the view player); a teammate's is drawn at this opacity factor, in the same role (the
	 * owner rule of the v1 sparks: the role is the effect's, never the player's).
	 */
	teammateOpacity: 0.7,
	/**
	 * Riposte's counter-wave (BV2 / BV6): a crescent (FORWARD) or a full ring (RING, REBUKE) growing on the record's own
	 * speed and range (the sim's sweep: the band's leading edge is the radius that strikes), in build.counter. Once the
	 * radius reaches the range it fades over fadeSec. Full: a band of bandTiles behind the edge plus a glow (glowTiles
	 * wider at glowOpacity); Reduced: reducedBandTiles, no glow, buildFxCount's segments.
	 */
	counter: {
		role: "build.counter" as ColorRole,
		fadeSec: 0.15,
		bandTiles: 0.45,
		reducedBandTiles: 0.2,
		glowTiles: 0.35,
		glowOpacity: 0.35,
		/** Segments of a full ring; an arc takes its share (halfAngle / pi), at least minArcSegments. */
		segments: 32,
		minArcSegments: 6,
		thicknessStuds: 0.05,
		liftStuds: 0.16,
		/** At most this many alive (the sim's RIPOSTE_WAVES_MAX is 8). */
		maxAlive: 8,
		/**
		 * COUNTER xN on the floor (`fx.counter.text`, var n = the wave's counterCount): the combo shout's slot
		 * (ComboController.requestShout at FLOOR_SHOUT_PRIORITY.counter), the view player's waves only, the frame's highest
		 * count; its life and colour.
		 */
		shout: { key: "fx.counter.text", lifeSec: 0.9, role: "build.counter" as ColorRole },
	},
	/**
	 * The parry tick climbing per bullet a Riposte owner's guard eats (Player experience 1): the cue mapper plays
	 * sfx.player.parry again on every frame the view player's PARRY! count grew past its first frame, pitched
	 * semitoneStep x (count - 1) up, capped at maxSemitones, at `volume`, at most once per minIntervalSec. The guard's
	 * first erase keeps its ordinary parry cue. sfx.build.counter stays the wave's own sound (the release).
	 */
	parryLadder: {
		semitoneStep: 1,
		maxSemitones: 9,
		volume: 0.7,
		minIntervalSec: 0.05,
	},
	/**
	 * Ballista's burst flash (BV3): the last pierce's ring (a quick ring round the struck enemy, in the bolts' build.burst)
	 * or a wall's back fan (`fan`: the same ring cut to a fan of fanHalfAngleRad either side of the facing guess,
	 * BallistaRecord.dirX / dirZ, toward the archer; a full ring when the guess is 0 / 0).
	 */
	ballista: {
		ring: {
			sec: 0.22,
			r0Tiles: 0.15,
			r1Tiles: 0.85,
			fadeShare: 0.6,
			segments: 14,
			thicknessStuds: 0.05,
			widthStuds: 0.2,
			liftStuds: 0.15,
			maxAlive: 8,
			role: "build.burst" as ColorRole,
		},
		fan: {
			sec: 0.22,
			r0Tiles: 0.2,
			r1Tiles: 1.2,
			fadeShare: 0.6,
			segments: 14,
			thicknessStuds: 0.05,
			widthStuds: 0.22,
			liftStuds: 0.15,
			maxAlive: 8,
			role: "build.burst" as ColorRole,
		},
		/** Half the sim's BALLISTA_FAN_SPREAD (1.6 rad) plus a little, so the flash frames the bolts. */
		fanHalfAngleRad: 0.9,
	},
	/**
	 * Siege Bolt's pin (BV4): the pinned actor's animation is held (the client's sprite hold) while its arrow carries
	 * it, with a drag streak behind it: from the pin's start toward the body, at most streakTiles long, in build.burst.
	 * PINNED (`fx.pinned.text`) once per pin start of the view player in the combo shout's slot.
	 */
	pin: {
		streakTiles: 2.5,
		/** No streak until the body moved this far from where it was pinned. */
		streakMinTiles: 0.2,
		streakWidthStuds: 0.18,
		reducedStreakWidthStuds: 0.1,
		liftStuds: 0.2,
		role: "build.burst" as ColorRole,
		shout: { key: "fx.pinned.text", lifeSec: 0.7, role: "build.burst" as ColorRole },
	},
	/**
	 * Siege Bolt's slam: a solo freeze of freezeMs for the view player's slam (the Goldling catch's 40 ms,
	 * GOLDEN_VIEW.catchFreezeMs; docs/GRAZE_PARRY.md GPD7's rule: solo, freezeFrameOn), a shock ring out to the sim's
	 * SIEGE_SHOCK_RADIUS (Full only: Reduced drops it, Architecture 6) and SLAM (`fx.slam.text`) in the shout slot.
	 */
	slam: {
		freezeMs: 40,
		ring: {
			sec: 0.35,
			r0Tiles: 0.3,
			/** Unused: the ring ends on SIEGE_SHOCK_RADIUS (siegeFx.ts). */
			r1Tiles: 0,
			fadeShare: 0.5,
			segments: 24,
			thicknessStuds: 0.06,
			widthStuds: 0.3,
			liftStuds: 0.14,
			maxAlive: 4,
			role: "build.burst" as ColorRole,
		},
		shout: { key: "fx.slam.text", lifeSec: 0.9, role: "build.burst" as ColorRole },
	},
	/**
	 * Wrecker's smash pop (BV5): a quick ring at the piece's cell centre in the splinters' build.shard, plus a chip burst
	 * (Full only: Reduced drops the pops' particles). Its sound sfx.build.smash climbs with the smash's generation
	 * (buildGenSpeed: a Demolition chain goes up the build voice's ladder).
	 */
	smash: {
		ring: {
			sec: 0.25,
			r0Tiles: 0.1,
			r1Tiles: 0.6,
			fadeShare: 0.6,
			segments: 12,
			thicknessStuds: 0.05,
			widthStuds: 0.18,
			liftStuds: 0.13,
			maxAlive: 12,
			role: "build.shard" as ColorRole,
		},
		chips: { chunks: 2, bits: 3, sparks: 3, startPx: 3, radius: 0.3, speed: 1 },
		/** At most this many chip bursts per frame (the view player's first). */
		chipsPerFrame: 6,
		/** burstSeed salt (BUILD_FX_VIEW's salts: 51-53). */
		seedSalt: 54,
	},
	/** Demolition's blast (BV5): a ring out to the sim's DEMOLITION_RADIUS in build.ember, Full and Reduced. */
	demolition: {
		ring: {
			sec: 0.3,
			r0Tiles: 0.2,
			/** Unused: the ring ends on DEMOLITION_RADIUS (wreckerFx.ts). */
			r1Tiles: 0,
			fadeShare: 0.5,
			segments: 20,
			thicknessStuds: 0.06,
			widthStuds: 0.28,
			liftStuds: 0.135,
			maxAlive: 8,
			role: "build.ember" as ColorRole,
		},
	},
	/**
	 * Full Heart's beam (BV7): one straight segment per beam record, opaque for `hold` of `sec`, then fading, in the duo
	 * card's boon.duo; Full: widthStuds with a white core (coreShare of it, coreWhiteMix toward white); Reduced:
	 * reducedWidthStuds, no core.
	 */
	heartBeam: {
		sec: 0.2,
		hold: 0.4,
		widthStuds: 0.3,
		reducedWidthStuds: 0.14,
		coreShare: 0.4,
		coreWhiteMix: 0.7,
		liftStuds: 0.36,
		maxAlive: 6,
		role: "boon.duo" as ColorRole,
	},
	/**
	 * Happy Hour (BV7): the `hud.toast.happyHour` toast for the local player's drink (a personal line, like the brace's
	 * toast), and while a player's HAPPY_HOUR_TICKS run (from the drink's tick) the kill pops are tinted popRole (the
	 * flask's fx.heal: the drink is what started it). ScorePopTone.HAPPY.
	 */
	happyHour: {
		/** idBase -(2^24): apart from every other toast base (sightings 2^20, daily rank 2^21, vault 2^22, brace 2^23). */
		toast: { key: "hud.toast.happyHour", seconds: 2.5, idBase: -(2 ** 24) },
		popRole: "fx.heal" as ColorRole,
	},
	/**
	 * Overcap pops (BV9): every payout within OVERCAP_POP_MERGE_SEC of a pop's first one and within mergeTiles of it is
	 * one "+N" pop (the boss moves a little between hits). Distinguishing rule (BV10: build.overcap is ~3.5 CIE76 from the
	 * parry's nearMiss.parry gold): an overcap pop is always a bare number "+N" in the score pops' billboard machinery,
	 * at the kill pops' glyph scale (1, half the Jackpot's 2), lifted liftPx over the kill pops' start and rising only
	 * riseShare of their rise, over a boss; the parry's gold is only ever the PARRY! word on the floor under a guarding
	 * player. Never a word, never on the floor, never at a player: the two never share a shape, a plane or a place.
	 */
	overcap: {
		mergeTiles: 2,
		maxAlive: 6,
		scale: 1,
		liftPx: 10,
		riseShare: 0.6,
		role: "build.overcap" as ColorRole,
	},
} as const;

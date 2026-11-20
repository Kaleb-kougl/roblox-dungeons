/**
 * The draft reveal's tunables (docs/DRAFT_REVEAL.md DR1): the deal, the flips and their pitch ladder, the rare chime /
 * stroke flare / shine, the legendary beat (charge, its pitch-up ladder, hush, fast flip, flare, halo), the skip, the
 * pick stamp and exit, and the reduced-motion values. Data only; the per-frame state machine is draftReveal.ts.
 * Presentation only (DRD1): nothing here touches the sim; every number is free to move at the DR9 tuning pass.
 *
 * Units: real (unpaused) seconds from the moment the stage cover starts to fade; offsets in reference px (HUD_VIEW);
 * pitch in semitones (PlaybackSpeed = 2^(st / 12), comboConfig semitonesToSpeed); 0..1 fractions elsewhere.
 *
 * @module
 */

/** The reveal's port audio IDs (DR4 adds them to the theme's PORT_AUDIO_EVENTS; plain strings here). */
export const DRAFT_REVEAL_SFX = {
	/** Every flip's squash start (not the legendary's fast flip); one for a skip. */
	flip: "sfx.draft.flip",
	/** A rare card lands. */
	rare: "sfx.draft.rare",
	/** One hit of the legendary charge's pitch-up ladder (DRD11). */
	charge: "sfx.draft.charge",
	/** The legendary flare's sting (a jingle: it ducks the music itself, DR4 DUCKING_SFX). */
	legendary: "sfx.draft.legendary",
	/** A boon is taken (the stamp). */
	pick: "sfx.draft.pick",
} as const;

export const DRAFT_REVEAL = {
	/** Longest step one frame may take: a hitch delays the timeline, never skips a cue (they all fire, in order). */
	maxFrameDtSec: 0.1,
	/** The title fades in over this from t = 0. */
	titleFadeSec: 0.15,
	/** The deal: each back rises `risePx` into its slot and fades in over `sec`, `staggerSec` apart (column order). */
	deal: { risePx: 24, staggerSec: 0.05, sec: 0.18 },
	/**
	 * A flip: the width squashes to 0 over the first half (the face swaps in at the midpoint) and springs back over the
	 * second half: 0 -> `overshoot` over `overshootAt` of the half (ease out), then back to 1.
	 */
	flip: { firstAtSec: 0.35, sec: 0.2, intervalSec: 0.22, overshoot: 1.04, overshootAt: 0.7 },
	/** The name, rarity and effect fade in over this from a card's landing (no text while the card is thin). */
	textFadeSec: 0.08,
	/** Each flip's sound is this many semitones above the one before (+0 / +2 / +4). */
	flipSemitoneStep: 2,
	/** A rare card's landing: the chime, the stroke flare (glow 1 -> 0 over flareSec) and one shine sweep. */
	rare: { flareSec: 0.3, shineSec: 0.35 },
	/**
	 * The legendary charge (after the last other card landed; at flip.firstAtSec when every card is legendary): the other
	 * cards dim to `dim` over dimInSec; the back's eyes and its edge glow rise 0 -> 1, the back trembles 0 ->
	 * tremblePx, the rays fade in 0 -> rayAlpha and turn at halo.revPerSec. The tremble is a sample-and-hold jitter in
	 * time, not a sine: every 1 / trembleStepHz s it takes the next value of tremblePattern (fractions of the current
	 * amplitude), so it reads the same at 30, 60 or 144 fps (a fast sine aliases with the frame rate: at 30 Hz it is a
	 * constant offset at 30 fps). Keep trembleStepHz well under the slowest frame rate expected (30 fps).
	 * `duckOverlapSec`: the music dip holds through the hush and the fast flip and this far past the flare, so the
	 * sting's own duck (a jingle, DUCKING_SFX) takes over before the dip ends and the music never climbs in between.
	 */
	charge: {
		sec: 0.7,
		dim: 0.5,
		dimInSec: 0.15,
		tremblePx: 2,
		trembleStepHz: 15,
		tremblePattern: [1, -0.55, 0.3, -1, 0.7, -0.25, 0.85, -0.7],
		rayAlpha: 0.2,
		duckOverlapSec: 0.1,
	},
	/**
	 * The charge's pitch-up ladder (DRD11): `hits` sfx.draft.charge cues, the gaps closing linearly from firstGapSec to
	 * lastGapSec, the pitch climbing linearly 0 -> topSemitones (volume fromVolume -> toVolume); the last hit
	 * lastHitLeadSec before the hush (the ladder is placed backwards from the charge's end).
	 */
	chargeLadder: {
		hits: 6,
		firstGapSec: 0.16,
		lastGapSec: 0.07,
		topSemitones: 12,
		lastHitLeadSec: 0.06,
		fromVolume: 0.8,
		toVolume: 1,
	},
	/** The hush: nothing moves, nothing sounds. The beat. */
	hushSec: 0.12,
	/** The legendary's flip after the hush (no flip sound). */
	fastFlipSec: 0.14,
	/**
	 * The flare on the legendary's landing: a flash over the card (flashFrom -> 0 over flashSec, card area only), a ray
	 * burst (scale burstFrom -> burstTo, alpha 1 -> 0 over burstSec, eased out), the pop (popFrom -> 1, ease out back
	 * with popEaseBack, over popSec; the reveal settles when it lands) and the other cards undim over undimSec.
	 */
	flare: {
		flashFrom: 0.8,
		flashSec: 0.12,
		burstFrom: 0.6,
		burstTo: 1.4,
		burstSec: 0.5,
		popFrom: 1.25,
		popSec: 0.25,
		popEaseBack: 1.70158,
		undimSec: 0.2,
	},
	/** The legendary's halo after the flare: rays at `alpha` turning revPerSec, the edge glow pulsing glowMin..1 at pulseHz. */
	halo: { alpha: 0.35, revPerSec: 0.1, pulseHz: 1, glowMin: 0.6 },
	/** A skip (DRD6): every card still face down flips at once over this (one flip sound). */
	skipFlipSec: 0.12,
	/**
	 * Taking a boon: the chosen card stamps 1 -> stampScale -> 1 over stampSec with a flash from stampFlash; the others
	 * drop dropPx and fade over dropSec; the overlay fades over exitFadeSec after the stamp.
	 */
	pick: { stampScale: 1.12, stampSec: 0.15, stampFlash: 0.5, dropPx: 16, dropSec: 0.2, exitFadeSec: 0.25 },
	/**
	 * Reduced motion: a flip is a crossfade of crossfadeSec, ending where the flip would land (so every cue and the
	 * settle keep their times); no rise, tremble, pop, burst, ray rotation, stamp scale or drop; the legendary flash is
	 * replaced by its edge glow at full brightness (glow 1 from the flare, then the halo pulse).
	 */
	reducedMotion: { crossfadeSec: 0.12 },
} as const;

/** Degrees in a full turn (the halo's Frame.Rotation is in degrees). */
export const DRAFT_REVEAL_FULL_TURN_DEG = 360;

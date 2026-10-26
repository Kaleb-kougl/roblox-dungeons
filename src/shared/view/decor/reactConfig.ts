/**
 * DecorDirector tunables (docs/DECOR.md Phase 2 part 3, task R10): how the decoration reacts to the run. Presentation
 * only: the director reads the sim and never writes it, so nothing here can change a replay. Times are seconds of
 * director time (the frame's real dt, clamped to maxDtSeconds; it stands still while the run is paused or a draft is
 * open). Starting values; R15 tunes them.
 */
export const DECOR_REACT = {
	/** First entry into a room: its torches light in a sweep from the door, this far apart (x the juice motionScale). */
	igniteStepSeconds: 0.08,
	/** A light (torch, brazier, boss ring spot) fades in over this long once it ignites. */
	igniteFadeSeconds: 0.25,
	/** A combat room cleared: its braziers light with a warm flare (1 -> 0) this long (x motionScale). */
	flareSeconds: 0.6,
	/** While a combat room is engaged its flames burn this much taller (x motionScale on the extra). */
	engagedFlameScale: 1.35,
	/** The flame height eases toward its target with this time constant. */
	flameEaseSeconds: 0.3,
	/** Boss phases: one more 1 / bossPhases of the flat boss ring lights at each (phase 1 = engaged). */
	bossPhases: 3,
	/** The open stairwell's glow fades in (and out) over this long. */
	stairGlowSeconds: 0.6,
	/** The shrine's lights and crystal dim over this long once it is used. */
	shrineDimSeconds: 0.5,
	/** A pedestal's glint fades out over this long once it is taken. */
	glintFadeSeconds: 0.4,
	/** An Ember: every flame on screen gutters (1 -> 0) for this long (x motionScale). */
	emberGutterSeconds: 0.3,
	/** Run over (every player down): the lights fade to the cold palette over this long. */
	coldFadeSeconds: 1.5,
	/** Longest frame step the director takes (a hitch does not skip an ignition sweep). */
	maxDtSeconds: 0.1,
} as const;

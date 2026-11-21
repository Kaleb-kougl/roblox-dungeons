/**
 * The combo's presentation tunables (docs/COMBO.md CB2): the named tiers, the kill sound's pitch ladder, the score
 * panel's combo row and meter timings, and the floor shout. Data only, plus the tiny lookups over them (tier of a
 * combo, semitones -> PlaybackSpeed); the per-frame state machine is combo.ts. Presentation only (CD1): a tier is a
 * name, a colour and a sound, never a score rule; every number here is free to move at the CB9 tuning pass.
 *
 * Units: combo values are the sim's tenths (shared/sim COMBO_DENOMINATOR: 10 = x1.0, 50 = x5.0); times are real
 * (unpaused) seconds; sizes on the HUD are reference px (HUD_VIEW); sizes on the floor are tiles.
 *
 * @module
 */
import { COMBO_DENOMINATOR, COMBO_MAX, COMBO_MIN } from "shared/sim";

/** One combo tier. Indexed by tier number: 0 = none (x1.0 - x1.9), 1 RAMPAGE ... 4 UNSTOPPABLE (CD2). */
export interface ComboTierDef {
	/** The tier starts at this combo (tenths, inclusive). */
	readonly min: number;
	/**
	 * Theme string key of the tier's name (CB3 COMBO_STRING_KEYS); undefined for tier 0 (no name). Plain strings, not
	 * the theme's key union: the keys are added to the theme in the same wave.
	 */
	readonly nameKey: string | undefined;
	/** Theme colour role of the meter fill, the multiplier and the name (CB3 COMBO_ROLES; tier 0 keeps `ember`). */
	readonly role: string;
	/** The multiplier row's scale at the start of a feed's pop (it eases back to 1 over COMBO_VIEW.pop.sec). */
	readonly popScale: number;
	/** sfx.combo.tier is pitched up this many semitones on reaching this tier (CD7; tier 0 never stings). */
	readonly stingSemitones: number;
	/** The meter's gentle brightness pulse, Hz (0 = none; COMBO_VIEW.pulse.amount brighter at its peak). */
	readonly pulseHz: number;
	/** A shine sweeps the multiplier row every COMBO_VIEW.shine.periodSec (UNSTOPPABLE only). */
	readonly shine: boolean;
}

/** The five tiers, in order (COMBO_TIERS[comboTier(c)]). A milestone every 10 steps: x2 / x3 / x4 / x5. */
export const COMBO_TIERS: ReadonlyArray<ComboTierDef> = [
	{ min: COMBO_MIN, nameKey: undefined, role: "ember", popScale: 1.15, stingSemitones: 0, pulseHz: 0, shine: false },
	{
		min: 2 * COMBO_DENOMINATOR,
		nameKey: "hud.combo.rampage",
		role: "combo.rampage",
		popScale: 1.2,
		stingSemitones: 0,
		pulseHz: 0,
		shine: false,
	},
	{
		min: 3 * COMBO_DENOMINATOR,
		nameKey: "hud.combo.carnage",
		role: "combo.carnage",
		popScale: 1.25,
		stingSemitones: 3,
		pulseHz: 1,
		shine: false,
	},
	{
		min: 4 * COMBO_DENOMINATOR,
		nameKey: "hud.combo.dominating",
		role: "combo.dominating",
		popScale: 1.25,
		stingSemitones: 5,
		pulseHz: 1.5,
		shine: false,
	},
	{
		min: COMBO_MAX,
		nameKey: "hud.combo.unstoppable",
		role: "combo.unstoppable",
		popScale: 1.3,
		stingSemitones: 7,
		pulseHz: 0,
		shine: true,
	},
];

/** The highest tier number (UNSTOPPABLE). */
export const COMBO_TOP_TIER = COMBO_TIERS.size() - 1;

/** The colour role of a broken / lapsed combo (CB3; low chroma grey). */
export const COMBO_BROKEN_ROLE = "combo.broken";
/** The meter flashes these roles: white-ish on a tier up, red on a cut (docs/COMBO.md "Hit cut"). */
export const COMBO_FLASH_ROLES = { tierUp: "uiText", crack: "uiHealth" } as const;
/**
 * A theme colour role the combo meter can flash in: one of `COMBO_FLASH_ROLES`' values (`uiText` on a tier up,
 * `uiHealth` on a cut). The combo's frame carries it as `flashRole`.
 */
export type ComboFlashRole = (typeof COMBO_FLASH_ROLES)[keyof typeof COMBO_FLASH_ROLES];

/** The tier of a combo (tenths): the last tier whose `min` it reaches; 0 below x2 (and below COMBO_MIN). */
export function comboTier(tenths: number): number {
	let tier = 0;
	for (let i = 1; i < COMBO_TIERS.size(); i++) if (tenths >= COMBO_TIERS[i].min) tier = i;
	return tier;
}

/** One straight piece of the kill pitch ladder: `perStep` semitones per tenth from `from` to `to` (tenths). */
export interface KillPitchSegment {
	readonly from: number;
	readonly to: number;
	readonly perStep: number;
}

/**
 * The kill sound's pitch ladder (CD5): it follows the combo value, fast at the start, slower near the cap, so the early
 * climb is clear and the top does not squeal. +5 semitones at x2, +8 at x3, +10 at x4, +12 at x5.
 */
export const KILL_PITCH = {
	segments: [
		{ from: COMBO_MIN, to: 2 * COMBO_DENOMINATOR, perStep: 0.5 },
		{ from: 2 * COMBO_DENOMINATOR, to: 3 * COMBO_DENOMINATOR, perStep: 0.3 },
		{ from: 3 * COMBO_DENOMINATOR, to: COMBO_MAX, perStep: 0.2 },
	] as ReadonlyArray<KillPitchSegment>,
	/** Never above this. */
	maxSemitones: 12,
} as const;

/** Semitones in an octave (PlaybackSpeed doubles per octave). */
const SEMITONES_PER_OCTAVE = 12;

/** PlaybackSpeed for a pitch shift: 2^(st / 12). View only (the sim never does this math). */
export function semitonesToSpeed(semitones: number): number {
	return 2 ** (semitones / SEMITONES_PER_OCTAVE);
}

/** The kill ladder's shift at a combo (tenths): 0 at or below x1.0, piecewise up to KILL_PITCH.maxSemitones. */
export function killPitchSemitones(tenths: number): number {
	let st = 0;
	for (const s of KILL_PITCH.segments) {
		if (tenths <= s.from) break;
		st += (math.min(tenths, s.to) - s.from) * s.perStep;
	}
	return math.clamp(st, 0, KILL_PITCH.maxSemitones);
}

/** The kill sound's PlaybackSpeed factor at a combo (tenths). */
export function killPitchSpeed(tenths: number): number {
	return semitonesToSpeed(killPitchSemitones(tenths));
}

/** sfx.combo.tier's PlaybackSpeed factor for a tier (1 for tier 0 or out of range). */
export function tierStingSpeed(tier: number): number {
	const def = COMBO_TIERS[tier];
	return def === undefined ? 1 : semitonesToSpeed(def.stingSemitones);
}

/** The score panel's combo row and meter (docs/COMBO.md "Player experience"). Real seconds. */
export const COMBO_VIEW = {
	/** Longest step one frame may take (a hitch never skips a timeline). */
	maxFrameDtSec: 0.1,
	/** The meter blinks in the last warnFraction of the window: one more kill saves it. */
	warnFraction: 0.25,
	/** Blink rate (full on / off cycles per second); a steady dim under reduced motion. */
	blinkHz: 4,
	/** A feed pops the multiplier from its tier's popScale back to 1 over this. */
	pop: { sec: 0.1 },
	/** A tier up slams the name in: fromScale -> 1 over sec, ease out back. */
	slam: { fromScale: 1.6, sec: 0.12 },
	/** A tier up flashes the meter white (COMBO_FLASH_ROLES.tierUp) for this long. */
	tierFlashSec: 0.08,
	/** The meter's pulse (COMBO_TIERS pulseHz): at most this much brighter (a fraction toward white). */
	pulse: { amount: 0.1 },
	/** UNSTOPPABLE's shine: one sweep of sweepSec every periodSec. */
	shine: { periodSec: 1.5, sweepSec: 0.4 },
	/**
	 * A hit cut (CD4): the meter flashes uiHealth for flashSec, the row shakes shakePx left-right shakeCycles times
	 * over shakeSec, a `-xN.N` drops from the multiplier and fades over dropSec, and a name that changed fades in
	 * over nameFadeSec.
	 */
	crack: { flashSec: 0.25, shakePx: 3, shakeCycles: 2, shakeSec: 0.2, dropSec: 0.5, nameFadeSec: 0.25 },
	/**
	 * A break during a fight (CD3): grey and the lost value struck through for sec; the WHOLE meter track shatters into
	 * `shards` pieces in the lost tier's colour over shardSec (a break happens exactly when the timer reaches 0, so the
	 * fill is empty by then: shards sized from it would be sub-pixel), the track grey under them; the camera kicks at
	 * kickDelaySec (comboBreak nudge, Screen shake).
	 */
	break: { sec: 1.2, shards: 6, shardSec: 0.4, kickDelaySec: 0.08 },
	/** A break that lost less than this (tenths, x2.0) is a small break: no shards, no kick, the sound at half (CD14). */
	smallBreakBelow: 2 * COMBO_DENOMINATOR,
	smallBreakVolume: 0.5,
	/**
	 * A lapse (no fight on): the (empty) meter track and the multiplier fade to grey over greySec, BEST xN.N shows for
	 * bestSec. The fill is already empty when the timer runs out, so nothing drains.
	 */
	lapse: { greySec: 0.3, bestSec: 1.2 },
} as const;

/**
 * The floor shout on a tier up (CD9: it never hides a bullet). A SurfaceGui on a thin floor Part under every bullet,
 * telegraph and body, placed offsetTiles up-screen of the view player's feet, sliding slideTiles further up-screen
 * (no slide under reduced motion) and fading out over lifeSec; at most maxOpacity, ducking to duckOpacity (over
 * duckSec) while an enemy bullet is inside its box grown by duckMarginTiles (shoutDucked, combo.ts).
 *
 * The box: widthTiles along screen-right on the floor, depthTiles along up-screen. 5 x 1.25 tiles holds the longest
 * name ("UNSTOPPABLE!", 12 characters, ~0.4 tile each) TextScaled at about half a tile of letter height after the
 * camera's pitch foreshortens the depth; a longer translation scales down inside it, so the duck test never needs the
 * text's real size.
 */
export const COMBO_SHOUT = {
	offsetTiles: 2.5,
	slideTiles: 0.5,
	lifeSec: 0.6,
	maxOpacity: 0.55,
	duckOpacity: 0.15,
	duckSec: 0.05,
	duckMarginTiles: 1,
	widthTiles: 5,
	depthTiles: 1.25,
} as const;

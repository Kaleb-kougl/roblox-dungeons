/**
 * In-run haptics tunables (docs/HAPTICS.md HP1, the "Player experience" table; decisions HPD3-HPD5, HPD9, HPD10):
 * every play cue's pulses per device and the rules PlayHapticsDirector (playHaptics.ts) applies. Real seconds; strengths
 * 0..1. Data only. The menu's cues stay in shared/view/menu MENU_HAPTICS (the same pulse type, haptics.ts).
 *
 *   pad     pulses on the pad's Small / Large motors (HapticService:SetMotor; a ramp is stepped every
 *           PLAY_HAPTICS_RULES.rampStepSec by hapticTimeline).
 *   touch   pulses on the phone's single actuator (HapticEffect Custom; playHaptics touchWaveform turns them into
 *           FloatCurveKey points, ramps Linear). A phone's pulses never overlap (one actuator).
 */
import { pulsesSeconds, type HapticPulse, type TouchPulse } from "./haptics";
import { FEEL_HURT } from "./hurtConfig";
import { NEAR_MISS_VIEW } from "./nearMissConfig";

/** The device a play cue vibrates (HapticsController's backend: pad motors or the phone's HapticEffect). */
export type HapticDevice = "pad" | "touch";

/** The in-run moments that vibrate (HPD3: kill, parry, phase break, boss death, hurt). */
export type PlayHaptic =
	| "kill"
	| "killHeavy"
	| "parry"
	| "parryBig"
	| "stagger"
	| "bossDeath"
	| "hurtArmor"
	| "hurtHeart"
	| "hurtLethal";

/** Every PlayHaptic (specs, the debug test cues, the phone backend's preallocated effects). */
export const PLAY_HAPTIC_KINDS: ReadonlyArray<PlayHaptic> = [
	"kill",
	"killHeavy",
	"parry",
	"parryBig",
	"stagger",
	"bossDeath",
	"hurtArmor",
	"hurtHeart",
	"hurtLethal",
];

/** One play cue: its pad pulses and its phone pulses. */
export interface PlayHapticCue {
	readonly pad: ReadonlyArray<HapticPulse>;
	readonly touch: ReadonlyArray<TouchPulse>;
}

/**
 * Every play cue (docs/HAPTICS.md "Player experience"): kills a light tick on the small motor; a parry one clean thump
 * on the large motor with a small-motor edge; the phase break a heavy hit and a decaying tail; the boss death a long
 * rumble riding the slow-mo; hurts on the large motor, a heart hit a rough double buzz (two pulses 50 ms apart, never
 * the parry's shape), the lethal hit a long decay.
 */
export const PLAY_HAPTICS: { readonly [K in PlayHaptic]: PlayHapticCue } = {
	kill: {
		pad: [{ motor: "Small", strength: 0.25, seconds: 0.035 }],
		touch: [{ strength: 0.35, seconds: 0.025 }],
	},
	killHeavy: {
		pad: [{ motor: "Small", strength: 0.4, seconds: 0.055 }],
		touch: [{ strength: 0.5, seconds: 0.035 }],
	},
	parry: {
		pad: [
			{ motor: "Large", strength: 0.6, seconds: 0.08 },
			{ motor: "Small", strength: 0.3, seconds: 0.05 },
		],
		touch: [{ strength: 0.8, seconds: 0.07 }],
	},
	parryBig: {
		pad: [
			{ motor: "Large", strength: 0.8, seconds: 0.11 },
			{ motor: "Small", strength: 0.3, seconds: 0.05 },
		],
		touch: [{ strength: 1, seconds: 0.09 }],
	},
	stagger: {
		pad: [
			{ motor: "Large", strength: 1, seconds: 0.12 },
			{ motor: "Large", strength: 0.45, seconds: 0.26, atSec: 0.12, toStrength: 0 },
			{ motor: "Small", strength: 0.5, seconds: 0.06 },
		],
		touch: [
			{ strength: 1, seconds: 0.11 },
			{ strength: 0.5, seconds: 0.14, atSec: 0.15 },
		],
	},
	bossDeath: {
		pad: [
			{ motor: "Large", strength: 0.9, seconds: 0.6, toStrength: 0 },
			{ motor: "Small", strength: 0.4, seconds: 0.08 },
		],
		touch: [
			{ strength: 1, seconds: 0.1 },
			{ strength: 0.6, seconds: 0.4, atSec: 0.1, toStrength: 0 },
		],
	},
	hurtArmor: {
		pad: [{ motor: "Large", strength: 0.4, seconds: 0.09 }],
		touch: [{ strength: 0.6, seconds: 0.07 }],
	},
	hurtHeart: {
		pad: [
			{ motor: "Large", strength: 0.75, seconds: 0.09 },
			{ motor: "Large", strength: 0.5, seconds: 0.09, atSec: 0.14 },
			{ motor: "Small", strength: 0.4, seconds: 0.06 },
		],
		touch: [
			{ strength: 1, seconds: 0.08 },
			{ strength: 0.6, seconds: 0.08, atSec: 0.13 },
		],
	},
	hurtLethal: {
		pad: [
			{ motor: "Large", strength: 1, seconds: 0.5, toStrength: 0 },
			{ motor: "Small", strength: 0.6, seconds: 0.12 },
		],
		touch: [
			{ strength: 1, seconds: 0.12 },
			{ strength: 0.7, seconds: 0.35, atSec: 0.12, toStrength: 0 },
		],
	},
};

/**
 * Per-motor priority (docs/HAPTICS.md "Priority per motor"): lethal hurt > boss death > stagger > heart hurt > armor
 * hurt > parry > kill. A weaker cue never cuts a stronger one short (dropped, not queued); a stronger or equal one
 * replaces it at once (HapticGenerations' priority; the director's one cue per frame).
 */
export const PLAY_HAPTICS_PRIORITY: { readonly [K in PlayHaptic]: number } = {
	kill: 0,
	killHeavy: 0,
	parry: 1,
	parryBig: 1,
	hurtArmor: 2,
	hurtHeart: 3,
	stagger: 4,
	bossDeath: 5,
	hurtLethal: 6,
};

/** The rules PlayHapticsDirector applies (docs/HAPTICS.md "Rules for all of them"; HPD10). */
export const PLAY_HAPTICS_RULES = {
	/** A kill tick at least this long after the last played one (kills in one frame already merge into one). */
	killGapSec: 0.07,
	/** At most this many kill ticks in any rolling killCapWindowSec (the rest drop). */
	killCapPerSec: 6,
	/** The kill cap's rolling window. */
	killCapWindowSec: 1,
	/** The duty cap's rolling window. */
	dutyWindowSec: 1,
	/**
	 * In any dutyWindowSec the device is on at most this share of the time (the played cues' lengths, gaps included);
	 * only kill ticks are dropped for it: hurt, parry, stagger and death always play.
	 */
	dutyMax: 0.4,
	/** No pulse in PLAY_HAPTICS starts weaker than this (strengths under 0.1 may not trigger on some clients). */
	strengthFloor: 0.15,
	/** A pad ramp holds each step this long (hapticTimeline's ramp step). */
	rampStepSec: 0.05,
	/**
	 * A hurt within this long of the last played hurt plays only if its kind is stronger (it replaces the weaker buzz,
	 * as HurtFlash upgrades within FEEL_HURT.minIntervalSec: the sim's invulnerability spacing, 0.75 s).
	 */
	hurtUpgradeWindowSec: FEEL_HURT.minIntervalSec,
	/** A guard whose first frame erased this many bullets or more is the big parry (NEAR_MISS_VIEW's +3 st rule). */
	parryBigFrom: NEAR_MISS_VIEW.parry.bigFrom,
} as const;

/** A play cue's whole length on `device` (seconds from its first on to its last off, gaps included). */
export function playCueSeconds(kind: PlayHaptic, device: HapticDevice): number {
	return pulsesSeconds(PLAY_HAPTICS[kind][device]);
}

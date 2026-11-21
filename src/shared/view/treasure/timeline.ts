/**
 * Every vault animation as a pure function of time (docs/TREASURE.md TR7, Player experience): the sparkle's cadence,
 * the crack's flash, tier step, shards and rising tier line, the unlock's bars (sink / fade), kept line and wobble, the
 * open's jolt, pop, column and ring, the reward cards and the near-miss / kept line, the plate's fade and the SWIFT
 * countdown's warning pulse. `age` is sim seconds since the event (a negative age is before it; NEVER_AGE is a vault
 * whose event was not seen: everything settled). Reduced motion (`reduced`) keeps colours, text and fades and drops
 * the movement; Particles off (`particles` false) drops the column and the burst and stills the sparkle. Tunables:
 * TREASURE_VIEW (config.ts). Tested headlessly (timeline.spec.ts).
 *
 * @module
 */
import { TREASURE_VIEW } from "./config";

const TAU = 2 * math.pi;

/** The age of an event the view never saw (a vault met already cracked / unlocked / opened): every timeline is over. */
export const NEVER_AGE = math.huge;

/** treasureSparkleFrame: no pass shows this frame (between passes). */
export const SPARKLE_HIDDEN = -1;

function clamp01(u: number): number {
	return u <= 0 ? 0 : u >= 1 ? 1 : u;
}

/** A fade-in over `fadeIn`, full, then a linear fade-out over the last `fadeOut` of `life`; 0 outside [0, life). */
export function envelope(age: number, life: number, fadeIn: number, fadeOut: number): number {
	if (!(age >= 0) || !(age < life)) return 0;
	const up = fadeIn > 0 ? clamp01(age / fadeIn) : 1;
	const left = life - age;
	const down = fadeOut > 0 ? clamp01(left / fadeOut) : 1;
	return math.min(up, down);
}

function easeOut(u: number): number {
	const t = clamp01(u);
	return 1 - (1 - t) * (1 - t);
}

function easeIn(u: number): number {
	const t = clamp01(u);
	return t * t;
}

// ---------------------------------------------------------------------------------------------
// The sparkle

/**
 * Seconds between the sparkle's passes for `tier` (VaultTier), unlocked or not (TREASURE_VIEW.sparkle: Legendary twice
 * as often, x unlockedRate faster once unlocked).
 */
export function sparkleEverySec(tier: number, unlocked: boolean): number {
	const S = TREASURE_VIEW.sparkle;
	const every = S.everySec[tier] ?? S.everySec[0];
	return unlocked ? every / S.unlockedRate : every;
}

/** The sparkle's size factor for `tier` (Legendary 1.5x). */
export function sparkleSizeScale(tier: number): number {
	const S = TREASURE_VIEW.sparkle;
	return S.sizeScale[tier] ?? S.sizeScale[0];
}

/**
 * The sparkle's flipbook frame at sim second `simSec`: one pass of `frames` at `fps` at the start of every `everySec`
 * (a pass longer than the cycle loops), SPARKLE_HIDDEN between passes. Still (`still`: reduced motion or Particles
 * off): `stillFrame`, always shown. Art without frames (fps 0): frame 0 for `flashSec` per cycle.
 */
export function treasureSparkleFrame(
	simSec: number,
	everySec: number,
	fps: number,
	frames: number,
	still: boolean,
	stillFrame: number,
	flashSec: number,
): number {
	const n = math.max(1, math.floor(frames));
	if (still) return stillFrame % n;
	const pass = fps > 0 ? n / fps : flashSec;
	const cycle = math.max(pass, everySec);
	const t = math.max(0, simSec) % cycle;
	if (!(t < pass)) return SPARKLE_HIDDEN;
	return fps > 0 ? math.min(n - 1, math.floor(t * fps)) : 0;
}

/**
 * The art-less sparkle star's transparency at `simSec` (the placeholder pack): starPeakTransparency during a pass
 * (starPassSec at the start of every everySec), starTransparency between; still: always the resting value.
 */
export function sparkleStarTransparency(simSec: number, everySec: number, still: boolean): number {
	const S = TREASURE_VIEW.sparkle;
	if (still) return S.starTransparency;
	const cycle = math.max(S.starPassSec, everySec);
	const t = math.max(0, simSec) % cycle;
	return t < S.starPassSec ? S.starPeakTransparency : S.starTransparency;
}

// ---------------------------------------------------------------------------------------------
// The crack

/** The sparkle's mix toward white `age` after the crack: 1 -> 0 over crack.flashSec (0 outside it). */
export function crackFlashMix(age: number): number {
	const F = TREASURE_VIEW.crack.flashSec;
	if (!(age >= 0) || !(age < F)) return 0;
	return 1 - age / F;
}

/** The tier the sparkle shows `age` after a crack from `fromTier` to `tier`: the lost one until crack.stepSec. */
export function crackShownTier(age: number, fromTier: number, tier: number): number {
	return age >= 0 && age < TREASURE_VIEW.crack.stepSec ? fromTier : tier;
}

/** The shards' flight progress `age` after the crack (0..1, comboShardAt's `u`), or -1 when they are gone. */
export function crackShardProgress(age: number): number {
	const S = TREASURE_VIEW.crack.shardSec;
	if (!(age >= 0) || !(age < S)) return -1;
	return age / S;
}

/** A floor line's look (the crack's tier name, the unlock's kept line). Mutable, reused. */
export interface FloorLineLook {
	/** 0..1 of the line's own opacity (the controller caps it at the plate's maxOpacity and the duck). */
	alpha: number;
	/** How far it rose up-screen, tiles (0 under reduced motion). */
	riseTiles: number;
}

function floorLineAt(
	age: number,
	life: number,
	fadeIn: number,
	rise: number,
	reduced: boolean,
	out: FloorLineLook,
): FloorLineLook {
	out.alpha = envelope(age, life, fadeIn, life - fadeIn);
	out.riseTiles = reduced || out.alpha <= 0 ? 0 : rise * easeOut(age / life);
	return out;
}

/** The crack's rising tier name `age` after the crack: fades in, rises crack.lineRiseTiles and fades by lineSec. */
export function crackLineAt(age: number, reduced: boolean, out: FloorLineLook): FloorLineLook {
	const C = TREASURE_VIEW.crack;
	return floorLineAt(age, C.lineSec, C.lineFadeInSec, C.lineRiseTiles, reduced, out);
}

// ---------------------------------------------------------------------------------------------
// The unlock (ages are from the clear tick; everything waits unlock.delaySec for the stamp)

/** The cage's look. Mutable, reused. */
export interface CageLook {
	/** The cage is drawn. */
	shown: boolean;
	/** 0..1 of its height sunk below the floor (0 under reduced motion: it fades instead). */
	sink: number;
	/** Its transparency (0, or the reduced-motion fade). */
	transparency: number;
}

/**
 * The cage `age` after the unlock (NEVER_AGE: long gone; a locked vault passes a negative age: up and solid). The bars
 * sink (ease in) over unlock.sinkSec from delaySec; under reduced motion they fade over the same time in place.
 */
export function cageAt(age: number, reduced: boolean, out: CageLook): CageLook {
	const U = TREASURE_VIEW.unlock;
	const u = clamp01((age - U.delaySec) / U.sinkSec);
	out.shown = u < 1;
	out.sink = reduced ? 0 : easeIn(u);
	out.transparency = reduced ? u : 0;
	return out;
}

/** The bars have started to go (the unlock shows: TR8's rattle): `age` after the unlock reached unlock.delaySec. */
export function unlockShown(age: number): boolean {
	return age >= TREASURE_VIEW.unlock.delaySec;
}

/** The kept line `age` after the unlock: from delaySec for keptLineSec, rising keptLineRiseTiles. */
export function keptLineAt(age: number, reduced: boolean, out: FloorLineLook): FloorLineLook {
	const U = TREASURE_VIEW.unlock;
	return floorLineAt(age - U.delaySec, U.keptLineSec, U.keptLineFadeInSec, U.keptLineRiseTiles, reduced, out);
}

/**
 * The closed chest's wobble, degrees, `age` after the unlock: once the bars are down (delaySec + sinkSec), every
 * wobbleEverySec a decaying sine of wobbleCycles over wobbleSec, wobbleDeg at most. 0 under reduced motion.
 */
export function wobbleDegAt(age: number, reduced: boolean): number {
	const U = TREASURE_VIEW.unlock;
	if (reduced) return 0;
	const t = age - U.delaySec - U.sinkSec;
	if (!(t >= 0) || t === math.huge) return 0;
	const inCycle = t % U.wobbleEverySec;
	if (!(inCycle < U.wobbleSec)) return 0;
	const u = inCycle / U.wobbleSec;
	return U.wobbleDeg * (1 - u) * math.sin(TAU * U.wobbleCycles * u);
}

/** The lock plate's own opacity (0..1, before the cap and the duck). Kept lock: it fades with the bars from the unlock. */
export function plateAlpha(armAge: number, unlockAge: number | undefined): number {
	const P = TREASURE_VIEW.plate;
	if (!(armAge >= 0)) return 0;
	const up = P.fadeInSec > 0 ? clamp01(armAge / P.fadeInSec) : 1;
	if (unlockAge === undefined) return up;
	const U = TREASURE_VIEW.unlock;
	return math.min(up, 1 - clamp01((unlockAge - U.delaySec) / U.sinkSec));
}

/** The SWIFT countdown's warning: `warn` (the warn colour) in the last warnSec, its pulse factor in the last pulseSec. */
export interface CountdownLook {
	warn: boolean;
	/** Opacity factor, pulseMin..1 at pulseHz in the last pulseSec (1 otherwise and under reduced motion). */
	pulse: number;
}

/** The countdown with `secLeft` seconds left (sim time `simSec` for the pulse's phase). */
export function countdownAt(secLeft: number, simSec: number, reduced: boolean, out: CountdownLook): CountdownLook {
	const P = TREASURE_VIEW.plate;
	out.warn = secLeft <= P.warnSec;
	out.pulse = 1;
	if (!reduced && secLeft <= P.pulseSec && secLeft > 0) {
		const wave = (1 + math.cos(TAU * P.pulseHz * simSec)) / 2;
		out.pulse = P.pulseMin + (1 - P.pulseMin) * wave;
	}
	return out;
}

// ---------------------------------------------------------------------------------------------
// The opening (ages are from the open tick)

/** The lid's hop, studs, `age` after the open: `jolts` hops of joltStuds over joltSec (0 after, and under reduced motion). */
export function lidJoltStuds(age: number, reduced: boolean): number {
	const O = TREASURE_VIEW.open;
	if (reduced || !(age >= 0) || !(age < O.joltSec)) return 0;
	const u = (age / O.joltSec) * O.jolts;
	return O.joltStuds * math.sin(math.pi * (u % 1));
}

/** The chest shows its open art `age` after the open (from popSec). */
export function chestPopped(age: number): boolean {
	return age >= TREASURE_VIEW.open.popSec;
}

/** The pop happened between the last frame (`prevAge`) and this one (`age`): the freeze, the shake, the burst. */
export function popCrossed(prevAge: number, age: number): boolean {
	const p = TREASURE_VIEW.open.popSec;
	return prevAge < p && age >= p && age !== math.huge;
}

/** The light column's look. Mutable, reused. */
export interface ColumnLook {
	shown: boolean;
	/** 0..1 of column.heightTiles. */
	height: number;
	/** 0..column.opacity. */
	opacity: number;
}

/**
 * The column `age` after the open: from popSec it rises (ease out) over riseSec, holds holdSec and fades over
 * fadeSec. None with Particles off. Reduced motion: no rise (full height at once), the same fade.
 */
export function columnAt(age: number, particles: boolean, reduced: boolean, out: ColumnLook): ColumnLook {
	const O = TREASURE_VIEW.open;
	const C = O.column;
	const t = age - O.popSec;
	const life = C.riseSec + C.holdSec + C.fadeSec;
	out.shown = particles && t >= 0 && t < life;
	if (!out.shown) {
		out.height = 0;
		out.opacity = 0;
		return out;
	}
	out.height = reduced ? 1 : easeOut(t / C.riseSec);
	out.opacity = C.opacity * envelope(t, life, 0, C.fadeSec);
	return out;
}

/** A billboard line's look (a reward card, the near-miss / kept line). Mutable, reused. */
export interface CardLook {
	alpha: number;
	/** How far it rose, tiles (0 under reduced motion). */
	riseTiles: number;
}

/** Reward card `index` (0 = the top one) `age` after the open: from cardsSec + index x staggerSec, for cardSec. */
export function rewardCardAt(age: number, index: number, reduced: boolean, out: CardLook): CardLook {
	const O = TREASURE_VIEW.open;
	const t = age - O.cardsSec - index * O.staggerSec;
	out.alpha = envelope(t, O.cardSec, O.cardFadeInSec, O.cardFadeOutSec);
	out.riseTiles = reduced || out.alpha <= 0 ? 0 : O.cardRiseTiles * easeOut(t / O.cardSec);
	return out;
}

/** The near-miss / kept line under the cards `age` after the open: from lineStartSec for lineSec; it rises with the cards. */
export function openLineAt(age: number, reduced: boolean, out: CardLook): CardLook {
	const O = TREASURE_VIEW.open;
	const t = age - O.lineStartSec;
	out.alpha = envelope(t, O.lineSec, O.lineFadeInSec, O.lineFadeOutSec);
	const cardT = age - O.cardsSec;
	out.riseTiles = reduced || out.alpha <= 0 ? 0 : O.cardRiseTiles * easeOut(cardT / O.cardSec);
	return out;
}

/** Every open timeline is over `age` after the open (the cards and the line gone, the column faded). */
export function openSettled(age: number, cards: number): boolean {
	const O = TREASURE_VIEW.open;
	const C = O.column;
	const last = math.max(
		O.cardsSec + math.max(0, cards - 1) * O.staggerSec + O.cardSec,
		O.lineStartSec + O.lineSec,
		O.popSec + C.riseSec + C.holdSec + C.fadeSec,
	);
	return age >= last;
}

/**
 * A boost out of the chest `age` after its landing tick: the age its hop reads (lootHopStuds, lootSettledAgeSec), or
 * undefined while it is still inside the chest (hidden until open.hopDelaySec).
 */
export function chestHopAge(age: number): number | undefined {
	const d = TREASURE_VIEW.open.hopDelaySec;
	return age < d ? undefined : age - d;
}

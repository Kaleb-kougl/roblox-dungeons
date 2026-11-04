// Every vault timeline as a pure function of time (docs/TREASURE.md TR7, Player experience): the sparkle's cadence,
// the crack, the unlock, the open, the cards and lines, and what reduced motion / Particles off change.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	NEVER_AGE,
	SPARKLE_HIDDEN,
	TREASURE_VIEW,
	cageAt,
	chestHopAge,
	chestPopped,
	columnAt,
	countdownAt,
	crackFlashMix,
	crackLineAt,
	crackShardProgress,
	crackShownTier,
	envelope,
	keptLineAt,
	lidJoltStuds,
	openLineAt,
	openSettled,
	plateAlpha,
	popCrossed,
	rewardCardAt,
	sparkleEverySec,
	sparkleSizeScale,
	sparkleStarTransparency,
	treasureSparkleFrame,
	unlockShown,
	wobbleDegAt,
	type CageLook,
	type CardLook,
	type ColumnLook,
	type CountdownLook,
	type FloorLineLook,
} from ".";

const V = TREASURE_VIEW;
const EPS = 1e-9;
const line = (): FloorLineLook => ({ alpha: 0, riseTiles: 0 });
const cage = (): CageLook => ({ shown: false, sink: 0, transparency: 0 });
const column = (): ColumnLook => ({ shown: false, height: 0, opacity: 0 });
const card = (): CardLook => ({ alpha: 0, riseTiles: 0 });

describe("envelope", () => {
	it("fades in, holds and fades out inside its life, 0 outside", () => {
		expect(envelope(-0.01, 1, 0.1, 0.4)).toBe(0);
		expect(envelope(0, 1, 0.1, 0.4)).toBe(0);
		expect(envelope(0.05, 1, 0.1, 0.4)).toBeCloseTo(0.5, 9);
		expect(envelope(0.5, 1, 0.1, 0.4)).toBe(1);
		expect(envelope(0.8, 1, 0.1, 0.4)).toBeCloseTo(0.5, 9);
		expect(envelope(1, 1, 0.1, 0.4)).toBe(0);
		expect(envelope(NEVER_AGE, 1, 0.1, 0.4)).toBe(0);
	});
});

describe("the sparkle", () => {
	it("is twice as frequent and 1.5x bigger for a Legendary, faster again once unlocked", () => {
		expect([sparkleEverySec(0, false), sparkleEverySec(1, false), sparkleEverySec(2, false)]).toEqual([3, 3, 1.5]);
		expect(sparkleEverySec(1, true)).toBe(3 / V.sparkle.unlockedRate);
		expect(sparkleEverySec(2, true)).toBe(1.5 / V.sparkle.unlockedRate);
		expect([sparkleSizeScale(1), sparkleSizeScale(2)]).toEqual([1, 1.5]);
	});

	it("plays one pass at the start of every cycle and hides between", () => {
		// 8 frames at 16 fps: a 0.5 s pass every 3 s.
		expect(treasureSparkleFrame(0, 3, 16, 8, false, 4, 0.45)).toBe(0);
		expect(treasureSparkleFrame(0.26, 3, 16, 8, false, 4, 0.45)).toBe(4);
		expect(treasureSparkleFrame(0.49, 3, 16, 8, false, 4, 0.45)).toBe(7);
		expect(treasureSparkleFrame(0.5, 3, 16, 8, false, 4, 0.45)).toBe(SPARKLE_HIDDEN);
		expect(treasureSparkleFrame(2.9, 3, 16, 8, false, 4, 0.45)).toBe(SPARKLE_HIDDEN);
		expect(treasureSparkleFrame(3.1, 3, 16, 8, false, 4, 0.45)).toBe(1);
		// Faster cycle (Legendary): the next pass at 1.5 s.
		expect(treasureSparkleFrame(1.5, 1.5, 16, 8, false, 4, 0.45)).toBe(0);
	});

	it("is a still star (always shown) under reduced motion or Particles off, and flashes frameless art", () => {
		for (const t of [0, 0.7, 2.2]) expect(treasureSparkleFrame(t, 3, 16, 8, true, 4, 0.45)).toBe(4);
		expect(treasureSparkleFrame(0.2, 3, 0, 1, false, 4, 0.45)).toBe(0);
		expect(treasureSparkleFrame(0.5, 3, 0, 1, false, 4, 0.45)).toBe(SPARKLE_HIDDEN);
	});

	it("the art-less star peaks during a pass and rests between, still when asked", () => {
		const S = V.sparkle;
		expect(sparkleStarTransparency(0.1, 3, false)).toBe(S.starPeakTransparency);
		expect(sparkleStarTransparency(1, 3, false)).toBe(S.starTransparency);
		expect(sparkleStarTransparency(0.1, 3, true)).toBe(S.starTransparency);
	});
});

describe("the crack", () => {
	it("flashes white then steps the sparkle's tier down", () => {
		expect(crackFlashMix(0)).toBe(1);
		expect(crackFlashMix(V.crack.flashSec / 2)).toBeCloseTo(0.5, 9);
		expect(crackFlashMix(V.crack.flashSec)).toBe(0);
		expect(crackFlashMix(NEVER_AGE)).toBe(0);
		expect(crackShownTier(0, 2, 1)).toBe(2);
		expect(crackShownTier(V.crack.stepSec - EPS, 2, 1)).toBe(2);
		expect(crackShownTier(V.crack.stepSec, 2, 1)).toBe(1);
		expect(crackShownTier(NEVER_AGE, 2, 1)).toBe(1);
		expect(crackShownTier(-1, 2, 1)).toBe(1);
	});

	it("flies the shards over shardSec, then they are gone", () => {
		expect(crackShardProgress(-0.01)).toBe(-1);
		expect(crackShardProgress(0)).toBe(0);
		expect(crackShardProgress(V.crack.shardSec / 2)).toBeCloseTo(0.5, 9);
		expect(crackShardProgress(V.crack.shardSec)).toBe(-1);
		expect(crackShardProgress(NEVER_AGE)).toBe(-1);
	});

	it("raises the new tier's name and fades it by lineSec; reduced motion keeps it in place", () => {
		const out = line();
		crackLineAt(V.crack.lineSec / 2, false, out);
		expect(out.alpha > 0 && out.alpha < 1).toBe(true);
		expect(out.riseTiles > 0 && out.riseTiles < V.crack.lineRiseTiles).toBe(true);
		crackLineAt(V.crack.lineSec / 2, true, out);
		expect(out.alpha > 0).toBe(true);
		expect(out.riseTiles).toBe(0);
		crackLineAt(V.crack.lineSec, false, out);
		expect([out.alpha, out.riseTiles]).toEqual([0, 0]);
	});
});

describe("the unlock", () => {
	it("waits for the stamp, then sinks the bars (ease in) over sinkSec", () => {
		const U = V.unlock;
		const out = cage();
		cageAt(0, false, out);
		expect([out.shown, out.sink, out.transparency]).toEqual([true, 0, 0]);
		cageAt(U.delaySec - EPS, false, out);
		expect(out.sink).toBe(0);
		expect(unlockShown(U.delaySec - EPS)).toBe(false);
		expect(unlockShown(U.delaySec)).toBe(true);
		cageAt(U.delaySec + U.sinkSec / 2, false, out);
		expect(out.sink).toBeCloseTo(0.25, 9);
		expect(out.transparency).toBe(0);
		cageAt(U.delaySec + U.sinkSec, false, out);
		expect(out.shown).toBe(false);
		cageAt(NEVER_AGE, false, out);
		expect(out.shown).toBe(false);
	});

	it("fades the bars in place under reduced motion", () => {
		const U = V.unlock;
		const out = cage();
		cageAt(U.delaySec + U.sinkSec / 2, true, out);
		expect([out.shown, out.sink]).toEqual([true, 0]);
		expect(out.transparency).toBeCloseTo(0.5, 9);
	});

	it("shows a kept line from the stamp for keptLineSec", () => {
		const U = V.unlock;
		const out = line();
		keptLineAt(U.delaySec - EPS, false, out);
		expect(out.alpha).toBe(0);
		keptLineAt(U.delaySec + U.keptLineSec / 2, false, out);
		expect(out.alpha > 0).toBe(true);
		keptLineAt(U.delaySec + U.keptLineSec, false, out);
		expect(out.alpha).toBe(0);
	});

	it("wobbles the chest every wobbleEverySec once the bars are down, never under reduced motion", () => {
		const U = V.unlock;
		const start = U.delaySec + U.sinkSec;
		expect(wobbleDegAt(start - EPS, false)).toBe(0);
		let peak = 0;
		for (let i = 0; i <= 100; i++)
			peak = math.max(peak, math.abs(wobbleDegAt(start + (U.wobbleSec * i) / 100, false)));
		expect(peak > 0 && peak <= U.wobbleDeg).toBe(true);
		expect(wobbleDegAt(start + U.wobbleSec + 0.1, false)).toBe(0);
		expect(math.abs(wobbleDegAt(start + U.wobbleEverySec + U.wobbleSec / 8, false)) > 0).toBe(true);
		expect(wobbleDegAt(start + U.wobbleSec / 8, true)).toBe(0);
		expect(wobbleDegAt(NEVER_AGE, false)).toBe(0);
	});

	it("fades the plate in on the arm and, for a kept lock, out with the bars", () => {
		const P = V.plate;
		const U = V.unlock;
		expect(plateAlpha(-1, undefined)).toBe(0);
		expect(plateAlpha(P.fadeInSec / 2, undefined)).toBeCloseTo(0.5, 9);
		expect(plateAlpha(10, undefined)).toBe(1);
		expect(plateAlpha(NEVER_AGE, undefined)).toBe(1);
		expect(plateAlpha(10, U.delaySec)).toBe(1);
		expect(plateAlpha(10, U.delaySec + U.sinkSec / 2)).toBeCloseTo(0.5, 9);
		expect(plateAlpha(10, U.delaySec + U.sinkSec)).toBe(0);
		expect(plateAlpha(10, NEVER_AGE)).toBe(0);
	});

	it("warns the SWIFT countdown in its last 10 s and pulses it in its last 5 s (colour only, reduced motion)", () => {
		const out: CountdownLook = { warn: false, pulse: 1 };
		countdownAt(11, 0, false, out);
		expect([out.warn, out.pulse]).toEqual([false, 1]);
		countdownAt(10, 0, false, out);
		expect([out.warn, out.pulse]).toEqual([true, 1]);
		countdownAt(4, 0.5, false, out);
		expect(out.warn).toBe(true);
		expect(out.pulse).toBeCloseTo(V.plate.pulseMin, 9);
		countdownAt(4, 0, false, out);
		expect(out.pulse).toBeCloseTo(1, 9);
		countdownAt(4, 0.5, true, out);
		expect([out.warn, out.pulse]).toEqual([true, 1]);
	});
});

describe("the open", () => {
	it("jolts the lid twice before the pop, then pops once", () => {
		const O = V.open;
		expect(lidJoltStuds(0, false)).toBe(0);
		expect(lidJoltStuds(O.joltSec / 4, false)).toBeCloseTo(O.joltStuds, 9);
		expect(lidJoltStuds((3 * O.joltSec) / 4, false)).toBeCloseTo(O.joltStuds, 9);
		expect(lidJoltStuds(O.joltSec, false)).toBe(0);
		expect(lidJoltStuds(O.joltSec / 4, true)).toBe(0);
		expect(chestPopped(O.popSec - EPS)).toBe(false);
		expect(chestPopped(O.popSec)).toBe(true);
		expect(popCrossed(O.popSec - 0.01, O.popSec)).toBe(true);
		expect(popCrossed(O.popSec, O.popSec + 0.01)).toBe(false);
		expect(popCrossed(-1, 0.1)).toBe(false);
		expect(popCrossed(-math.huge, NEVER_AGE)).toBe(false);
	});

	it("raises the column from the pop, holds and fades it; none with Particles off; no rise under reduced motion", () => {
		const O = V.open;
		const C = O.column;
		const out = column();
		columnAt(O.popSec - EPS, true, false, out);
		expect(out.shown).toBe(false);
		columnAt(O.popSec + C.riseSec / 2, true, false, out);
		expect(out.shown).toBe(true);
		expect(out.height).toBeCloseTo(0.75, 9);
		expect(out.opacity).toBe(C.opacity);
		columnAt(O.popSec + C.riseSec / 2, true, true, out);
		expect(out.height).toBe(1);
		columnAt(O.popSec + C.riseSec + C.holdSec + C.fadeSec / 2, true, false, out);
		expect(out.opacity).toBeCloseTo(C.opacity / 2, 9);
		columnAt(O.popSec + C.riseSec / 2, false, false, out);
		expect([out.shown, out.height, out.opacity]).toEqual([false, 0, 0]);
		columnAt(NEVER_AGE, true, false, out);
		expect(out.shown).toBe(false);
	});

	it("staggers the reward cards from cardsSec and floats them up riseTiles over cardSec", () => {
		const O = V.open;
		const out = card();
		rewardCardAt(O.cardsSec - EPS, 0, false, out);
		expect(out.alpha).toBe(0);
		rewardCardAt(O.cardsSec + O.cardFadeInSec, 0, false, out);
		expect(out.alpha).toBeCloseTo(1, 9);
		rewardCardAt(O.cardsSec + O.cardFadeInSec, 1, false, out);
		expect(out.alpha < 1).toBe(true);
		rewardCardAt(O.cardsSec + O.cardSec - EPS, 0, false, out);
		expect(out.riseTiles).toBeCloseTo(O.cardRiseTiles, 6);
		rewardCardAt(O.cardsSec + O.cardSec, 0, false, out);
		expect(out.alpha).toBe(0);
		rewardCardAt(O.cardsSec + 0.5, 0, true, out);
		expect(out.alpha).toBe(1);
		expect(out.riseTiles).toBe(0);
	});

	it("shows the near-miss / kept line from lineStartSec for lineSec", () => {
		const O = V.open;
		const out = card();
		openLineAt(O.lineStartSec - EPS, false, out);
		expect(out.alpha).toBe(0);
		openLineAt(O.lineStartSec + O.lineSec / 2, false, out);
		expect(out.alpha).toBe(1);
		openLineAt(O.lineStartSec + O.lineSec, false, out);
		expect(out.alpha).toBe(0);
	});

	it("settles after the last card, the line and the column", () => {
		const O = V.open;
		const settled = O.cardsSec + 3 * O.staggerSec + O.cardSec;
		expect(openSettled(settled - EPS, 4)).toBe(false);
		expect(openSettled(settled, 4)).toBe(true);
		expect(openSettled(NEVER_AGE, 0)).toBe(true);
	});

	it("keeps a chest's boosts inside it until hopDelaySec after their landing", () => {
		const d = V.open.hopDelaySec;
		expect(chestHopAge(0)).toBe(undefined);
		expect(chestHopAge(d - EPS)).toBe(undefined);
		expect(chestHopAge(d)).toBe(0);
		expect(chestHopAge(d + 0.2)).toBeCloseTo(0.2, 9);
		// The boosts come out after the lid pops (Player experience: the pop at 0.25, the hop at 0.3).
		expect(d >= V.open.popSec).toBe(true);
	});
});

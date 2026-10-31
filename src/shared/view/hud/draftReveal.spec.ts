// docs/DRAFT_REVEAL.md DR1: the flip order, the charge ladder, the debug attribute and the DraftReveal timelines.
import { describe, expect, it } from "@rbxts/jest-globals";
import { Rarity, type RarityId } from "shared/sim";
import { semitonesToSpeed } from "./comboConfig";
import {
	DraftReveal,
	chargeLadder,
	draftTrembleAt,
	parseDraftRevealDebug,
	revealOrder,
	type DraftRevealFrame,
} from "./draftReveal";
import { DRAFT_REVEAL, DRAFT_REVEAL_SFX } from "./draftRevealConfig";

const STEP = 1 / 60;
const EPS = 1e-6;
const C = Rarity.COMMON;
const R = Rarity.RARE;
const L = Rarity.LEGENDARY;
const SFX = DRAFT_REVEAL_SFX;

interface HeardCue {
	t: number;
	id: string;
	speed: number;
	volume: number;
}

/** Drives a DraftReveal frame by frame, recording every cue with the time of the step that played it. */
class Driver {
	readonly reveal = new DraftReveal();
	readonly heard: HeardCue[] = [];
	readonly ducks: { t: number; sec: number }[] = [];
	frame: DraftRevealFrame;

	constructor(rarities: RarityId[], reducedMotion = false) {
		this.reveal.begin(rarities, reducedMotion);
		this.frame = this.reveal.frame;
	}

	step(dt = STEP): DraftRevealFrame {
		const f = this.reveal.step(dt);
		for (const c of f.cues) this.heard.push({ t: f.elapsed, id: c.id, speed: c.speed, volume: c.volume });
		if (f.duck > 0) this.ducks.push({ t: f.elapsed, sec: f.duck });
		this.frame = f;
		return f;
	}

	/** Steps until elapsed >= t (or `until` holds), calling `each` on every frame. */
	runTo(t: number, each?: (f: DraftRevealFrame) => void): DraftRevealFrame {
		while (this.frame.elapsed < t - EPS && !this.frame.done) {
			const f = this.step();
			if (each) each(f);
		}
		return this.frame;
	}

	/** Steps until settled; returns the elapsed time of the first settled frame. */
	runToSettled(limit = 5): number {
		while (!this.frame.settled && this.frame.elapsed < limit) this.step();
		return this.frame.elapsed;
	}

	of(id: string): HeardCue[] {
		const out: HeardCue[] = [];
		for (const c of this.heard) if (c.id === id) out.push(c);
		return out;
	}
}

const FLIP = DRAFT_REVEAL.flip;
/** The k-th plain flip's start / landing. */
function flipAt(k: number): number {
	return FLIP.firstAtSec + k * FLIP.intervalSec;
}
function landAt(k: number): number {
	return flipAt(k) + FLIP.sec;
}

/** The step that plays a cue scheduled at `at` (the first 1/60 step at or past it). */
function heardNear(cue: HeardCue, at: number): void {
	expect(cue.t >= at - EPS).toBe(true);
	expect(cue.t < at + STEP + EPS).toBe(true);
}

describe("revealOrder", () => {
	it("flips the non-legendary cards left to right, then every legendary in one beat", () => {
		expect(revealOrder([C, L, R])).toEqual([[0], [2], [1]]);
		expect(revealOrder([L, L, C])).toEqual([[2], [0, 1]]);
		expect(revealOrder([C, C, C])).toEqual([[0], [1], [2]]);
		expect(revealOrder([L])).toEqual([[0]]);
		expect(revealOrder([R, C])).toEqual([[0], [1]]);
	});
});

describe("chargeLadder", () => {
	it("six hits closing in from 0.16 s to 0.07 s apart, climbing 0 -> +12 semitones, the last just before the hush", () => {
		const hits = chargeLadder();
		const LD = DRAFT_REVEAL.chargeLadder;
		expect(hits.size()).toBe(LD.hits);
		expect(hits[0].offset >= 0).toBe(true);
		expect(hits[0].semitones).toBe(0);
		expect(hits[hits.size() - 1].semitones).toBe(LD.topSemitones);
		expect(hits[hits.size() - 1].offset).toBeCloseTo(DRAFT_REVEAL.charge.sec - LD.lastHitLeadSec, 9);
		expect(hits[hits.size() - 1].offset < DRAFT_REVEAL.charge.sec).toBe(true);
		expect(hits[1].offset - hits[0].offset).toBeCloseTo(LD.firstGapSec, 9);
		expect(hits[hits.size() - 1].offset - hits[hits.size() - 2].offset).toBeCloseTo(LD.lastGapSec, 9);
		for (let i = 1; i < hits.size(); i++) {
			expect(hits[i].semitones > hits[i - 1].semitones).toBe(true);
			expect(hits[i].volume >= hits[i - 1].volume).toBe(true);
			if (i >= 2) {
				const gap = hits[i].offset - hits[i - 1].offset;
				const before = hits[i - 1].offset - hits[i - 2].offset;
				expect(gap < before).toBe(true);
			}
		}
	});
});

describe("parseDraftRevealDebug", () => {
	it("reads letters or names, case and spaces ignored", () => {
		expect(parseDraftRevealDebug("c,l,r")).toEqual([C, L, R]);
		expect(parseDraftRevealDebug("l,l")).toEqual([L, L]);
		expect(parseDraftRevealDebug("r")).toEqual([R]);
		expect(parseDraftRevealDebug(" C , Legendary,rare ")).toEqual([C, L, R]);
	});
	it("refuses empty, unknown letters and more than three cards", () => {
		expect(parseDraftRevealDebug("")).toBe(undefined);
		expect(parseDraftRevealDebug("  ")).toBe(undefined);
		expect(parseDraftRevealDebug("c,x")).toBe(undefined);
		expect(parseDraftRevealDebug("c,,r")).toBe(undefined);
		expect(parseDraftRevealDebug("c,c,c,c")).toBe(undefined);
	});
});

describe("DraftReveal: three commons", () => {
	it("deals, flips one by one at +0 / +2 / +4 semitones and settles at 1.07 s", () => {
		const d = new Driver([C, C, C]);
		const f0 = d.frame;
		expect(f0.active).toBe(true);
		expect(f0.count).toBe(3);
		expect(f0.cards[0].rise).toBe(DRAFT_REVEAL.deal.risePx);
		expect(f0.cards[0].alpha).toBe(0);
		expect(f0.cards[0].face).toBe(0);
		expect(f0.titleAlpha).toBe(0);
		let maxWidth = 0;
		let minWidth = 1;
		let settledAt = -1;
		d.runTo(1.5, (f) => {
			if (f.settled && settledAt < 0) settledAt = f.elapsed;
			for (const c of f.cards) {
				maxWidth = math.max(maxWidth, c.width);
				minWidth = math.min(minWidth, c.width);
			}
		});
		const expected = landAt(2) + DRAFT_REVEAL.textFadeSec;
		expect(expected).toBeCloseTo(1.07, 9);
		expect(settledAt >= expected - EPS).toBe(true);
		expect(settledAt < expected + STEP + EPS).toBe(true);

		const flips = d.of(SFX.flip);
		expect(flips.size()).toBe(3);
		for (let k = 0; k < 3; k++) {
			heardNear(flips[k], flipAt(k));
			expect(flips[k].speed).toBeCloseTo(semitonesToSpeed(k * DRAFT_REVEAL.flipSemitoneStep), 9);
		}
		expect(d.heard.size()).toBe(3);
		expect(d.ducks.size()).toBe(0);
		expect(maxWidth <= FLIP.overshoot + EPS).toBe(true);
		expect(maxWidth > 1).toBe(true);
		const f = d.frame;
		expect(f.titleAlpha).toBe(1);
		for (const c of f.cards) {
			expect(c.shown).toBe(true);
			expect(c.face).toBe(1);
			expect(c.width).toBe(1);
			expect(c.alpha).toBe(1);
			expect(c.rise).toBe(0);
			expect(c.textAlpha).toBe(1);
			expect(c.dim).toBe(0);
			expect(c.haloAlpha).toBe(0);
			expect(c.glow).toBe(0);
		}
	});

	it("swaps the face at the squash midpoint and shows no text until the card lands", () => {
		const d = new Driver([C, C, C]);
		d.runTo(flipAt(0) + FLIP.sec * 0.25);
		expect(d.frame.cards[0].face).toBe(0);
		expect(d.frame.cards[0].width < 1).toBe(true);
		expect(d.frame.cards[0].textAlpha).toBe(0);
		d.runTo(flipAt(0) + FLIP.sec * 0.75);
		expect(d.frame.cards[0].face).toBe(1);
		expect(d.frame.cards[0].textAlpha).toBe(0);
		expect(d.frame.cards[1].face).toBe(0);
		d.runTo(landAt(0) + DRAFT_REVEAL.textFadeSec + STEP);
		expect(d.frame.cards[0].textAlpha).toBe(1);
		expect(d.frame.settled).toBe(false);
	});
});

describe("DraftReveal: a rare", () => {
	it("chimes on landing, flares its stroke and sweeps one shine", () => {
		const d = new Driver([C, R, C]);
		let shineSeen = false;
		d.runTo(landAt(1) - STEP);
		expect(d.frame.cards[1].glow).toBe(0);
		expect(d.frame.cards[1].shine).toBe(-1);
		d.runTo(landAt(1) + DRAFT_REVEAL.rare.shineSec + 0.05, (f) => {
			if (f.cards[1].shine >= 0) shineSeen = true;
		});
		expect(shineSeen).toBe(true);
		expect(d.frame.cards[1].shine).toBe(-1);
		expect(d.frame.cards[1].glow).toBe(0);
		const rares = d.of(SFX.rare);
		expect(rares.size()).toBe(1);
		heardNear(rares[0], landAt(1));
		const order: string[] = [];
		for (const c of d.heard) order.push(c.id);
		expect(order).toEqual([SFX.flip, SFX.flip, SFX.rare, SFX.flip]);
		expect(new Driver([C, R, C]).runToSettled()).toBeCloseTo(1.07, 1);
	});

	it("the stroke flare starts at full brightness on landing", () => {
		const d = new Driver([R]);
		d.runTo(landAt(0));
		expect(d.frame.cards[0].glow > 0.9).toBe(true);
		expect(d.frame.cards[0].glow <= 1).toBe(true);
	});
});

describe("DraftReveal: a legendary in the left column", () => {
	const chargeAt = landAt(1);
	const chargeEnd = chargeAt + DRAFT_REVEAL.charge.sec;
	const hushEnd = chargeEnd + DRAFT_REVEAL.hushSec;
	const flare = hushEnd + DRAFT_REVEAL.fastFlipSec;

	it("charges, hushes, flares, and settles at about 2 s with one dip, six climbing charge hits and one sting", () => {
		const d = new Driver([L, C, C]);
		let trembleInCharge = false;
		let trembleInHush = false;
		let dimMax = 0;
		let popMax = 0;
		let flashMax = 0;
		let burstSeen = false;
		let rotatedBeforeFlare = false;
		d.runTo(2.5, (f) => {
			const t = f.elapsed;
			const leg = f.cards[0];
			if (t >= chargeAt && t < chargeEnd && leg.tremble !== 0) trembleInCharge = true;
			if (t >= chargeEnd && t < hushEnd && leg.tremble !== 0) trembleInHush = true;
			if (t >= chargeAt && t < flare) rotatedBeforeFlare = rotatedBeforeFlare || leg.haloAngle > 0;
			dimMax = math.max(dimMax, f.cards[1].dim);
			popMax = math.max(popMax, leg.pop);
			flashMax = math.max(flashMax, leg.flash);
			if (leg.burst >= 0) burstSeen = true;
			expect(math.abs(leg.tremble) <= DRAFT_REVEAL.charge.tremblePx + EPS).toBe(true);
			expect(leg.dim).toBe(0);
		});
		expect(flare).toBeCloseTo(1.73, 9);

		const flips = d.of(SFX.flip);
		expect(flips.size()).toBe(2);
		heardNear(flips[0], flipAt(0));
		heardNear(flips[1], flipAt(1));

		const charges = d.of(SFX.charge);
		expect(charges.size()).toBe(DRAFT_REVEAL.chargeLadder.hits);
		for (const c of charges) {
			expect(c.t >= chargeAt - EPS).toBe(true);
			expect(c.t < chargeEnd).toBe(true); // none in the hush
		}
		expect(charges[0].speed).toBeCloseTo(1, 9);
		expect(charges[charges.size() - 1].speed).toBeCloseTo(semitonesToSpeed(12), 9);
		for (let i = 1; i < charges.size(); i++) expect(charges[i].speed > charges[i - 1].speed).toBe(true);
		const firstGap = charges[1].t - charges[0].t;
		const lastGap = charges[charges.size() - 1].t - charges[charges.size() - 2].t;
		expect(lastGap < firstGap).toBe(true);

		const stings = d.of(SFX.legendary);
		expect(stings.size()).toBe(1);
		heardNear(stings[0], flare);

		const ids: string[] = [];
		for (const c of d.heard) ids.push(c.id);
		expect(ids).toEqual([
			SFX.flip,
			SFX.flip,
			SFX.charge,
			SFX.charge,
			SFX.charge,
			SFX.charge,
			SFX.charge,
			SFX.charge,
			SFX.legendary,
		]);

		expect(d.ducks.size()).toBe(1);
		heardNear({ t: d.ducks[0].t, id: "", speed: 1, volume: 1 }, chargeAt);
		// The dip lasts until just past the sting (it ducks the music itself), never ending between the hush and the flare.
		expect(d.ducks[0].sec).toBeCloseTo(flare - chargeAt + DRAFT_REVEAL.charge.duckOverlapSec, 9);
		expect(d.ducks[0].t + d.ducks[0].sec > stings[0].t).toBe(true);

		expect(trembleInCharge).toBe(true);
		expect(trembleInHush).toBe(false);
		expect(dimMax).toBeCloseTo(DRAFT_REVEAL.charge.dim, 9);
		expect(popMax > 1.1).toBe(true);
		expect(popMax <= DRAFT_REVEAL.flare.popFrom + EPS).toBe(true);
		expect(flashMax > 0.7).toBe(true);
		expect(flashMax <= DRAFT_REVEAL.flare.flashFrom + EPS).toBe(true);
		expect(burstSeen).toBe(true);
		expect(rotatedBeforeFlare).toBe(true);
	});

	it("settles when the pop lands, then keeps a turning halo and a pulsing glow", () => {
		const d = new Driver([L, C, C]);
		const settledAt = d.runToSettled();
		const expected = flare + DRAFT_REVEAL.flare.popSec;
		expect(expected).toBeCloseTo(1.98, 9);
		expect(settledAt >= expected - EPS).toBe(true);
		expect(settledAt < expected + STEP + EPS).toBe(true);
		const a0 = d.frame.cards[0].haloAngle;
		let glowMin = 1;
		let glowMax = 0;
		d.runTo(settledAt + 1.5, (f) => {
			glowMin = math.min(glowMin, f.cards[0].glow);
			glowMax = math.max(glowMax, f.cards[0].glow);
			expect(f.cards[0].haloAlpha).toBe(DRAFT_REVEAL.halo.alpha);
			expect(f.cards[1].dim).toBe(0);
		});
		expect(d.frame.cards[0].haloAngle).never.toBe(a0);
		expect(glowMin).toBeCloseTo(DRAFT_REVEAL.halo.glowMin, 2);
		expect(glowMax).toBeCloseTo(1, 2);
		expect(d.frame.cards[0].face).toBe(1);
		expect(d.frame.cards[0].pop).toBe(1);
		expect(d.frame.cards[0].burst).toBe(-1);
		expect(d.frame.cards[0].flash).toBe(0);
	});

	it("lights the eyes and the glow over the charge, holds them through the hush, and freezes the rays", () => {
		const d = new Driver([L, C, C]);
		d.runTo(chargeAt + DRAFT_REVEAL.charge.sec * 0.5);
		const mid = d.frame.cards[0];
		expect(mid.eyes > 0.4 && mid.eyes < 0.6).toBe(true);
		expect(mid.glow).toBe(mid.eyes);
		expect(mid.face).toBe(0);
		d.runTo(chargeEnd + 0.02);
		const a1 = d.frame.cards[0].haloAngle;
		expect(d.frame.cards[0].eyes).toBe(1);
		expect(d.frame.cards[0].tremble).toBe(0);
		d.runTo(hushEnd - 0.02);
		expect(d.frame.cards[0].haloAngle).toBe(a1);
		expect(d.frame.cards[0].eyes).toBe(1);
		expect(d.frame.cards[1].dim).toBeCloseTo(DRAFT_REVEAL.charge.dim, 9);
		expect(d.frame.settled).toBe(false);
	});
});

describe("DraftReveal: two legendaries", () => {
	it("share one beat: one charge ladder, one flip together, one sting", () => {
		const d = new Driver([L, L, C]);
		let faceTogether = true;
		d.runToSettled();
		d.runTo(3, (f) => {
			if (f.cards[0].face !== f.cards[1].face) faceTogether = false;
		});
		expect(faceTogether).toBe(true);
		expect(d.of(SFX.flip).size()).toBe(1);
		expect(d.of(SFX.charge).size()).toBe(DRAFT_REVEAL.chargeLadder.hits);
		expect(d.of(SFX.legendary).size()).toBe(1);
		expect(d.ducks.size()).toBe(1);
		heardNear(d.of(SFX.charge)[0], landAt(0) + chargeLadder()[0].offset);
	});

	it("two legendary cards alone charge at the first flip's time", () => {
		const d = new Driver([L, L]);
		d.runTo(2);
		expect(d.of(SFX.flip).size()).toBe(0);
		heardNear({ t: d.ducks[0].t, id: "", speed: 1, volume: 1 }, FLIP.firstAtSec);
		expect(d.of(SFX.legendary).size()).toBe(1);
		expect(d.frame.cards[2].shown).toBe(false);
	});
});

describe("DraftReveal: one and two cards", () => {
	it("one rare: flip, chime, settled after one flip", () => {
		const d = new Driver([R]);
		const settledAt = d.runToSettled();
		expect(settledAt).toBeCloseTo(landAt(0) + DRAFT_REVEAL.textFadeSec, 1);
		expect(d.frame.count).toBe(1);
		expect(d.frame.cards[1].shown).toBe(false);
		expect(d.frame.cards[2].shown).toBe(false);
		const ids: string[] = [];
		for (const c of d.heard) ids.push(c.id);
		expect(ids).toEqual([SFX.flip, SFX.rare]);
	});

	it("a common and a legendary: the legendary charges after the common lands", () => {
		const d = new Driver([C, L]);
		d.runToSettled();
		expect(d.of(SFX.flip).size()).toBe(1);
		heardNear({ t: d.ducks[0].t, id: "", speed: 1, volume: 1 }, landAt(0));
		expect(d.of(SFX.legendary).size()).toBe(1);
		expect(d.frame.elapsed).toBeCloseTo(
			landAt(0) +
				DRAFT_REVEAL.charge.sec +
				DRAFT_REVEAL.hushSec +
				DRAFT_REVEAL.fastFlipSec +
				DRAFT_REVEAL.flare.popSec,
			1,
		);
	});
});

describe("DraftReveal: skip", () => {
	it("before the first flip: everything flips at once with one sound; the legendary still flares and stings", () => {
		const d = new Driver([C, R, L]);
		d.runTo(0.2);
		const skipAt = d.frame.elapsed;
		d.reveal.skip();
		const settledAt = d.runToSettled();
		d.runTo(3);
		expect(d.of(SFX.flip).size()).toBe(1);
		heardNear(d.of(SFX.flip)[0], skipAt);
		expect(d.of(SFX.flip)[0].speed).toBe(1);
		expect(d.of(SFX.charge).size()).toBe(0);
		expect(d.of(SFX.rare).size()).toBe(1);
		expect(d.of(SFX.legendary).size()).toBe(1);
		heardNear(d.of(SFX.legendary)[0], skipAt + DRAFT_REVEAL.skipFlipSec);
		expect(d.ducks.size()).toBe(0);
		const expected = skipAt + DRAFT_REVEAL.skipFlipSec + DRAFT_REVEAL.flare.popSec;
		expect(settledAt >= expected - EPS).toBe(true);
		expect(settledAt < expected + STEP + EPS).toBe(true);
		expect(d.frame.cards[2].haloAlpha).toBe(DRAFT_REVEAL.halo.alpha);
		for (const c of d.frame.cards) expect(c.face).toBe(1);
	});

	it("keeps the burst, pop and flash of a skipped legendary", () => {
		const d = new Driver([L, C, C]);
		d.runTo(0.1);
		d.reveal.skip();
		let flash = 0;
		let pop = 1;
		let burst = false;
		d.runTo(1.5, (f) => {
			flash = math.max(flash, f.cards[0].flash);
			pop = math.max(pop, f.cards[0].pop);
			if (f.cards[0].burst >= 0) burst = true;
			expect(f.cards[1].dim).toBe(0);
		});
		expect(flash > 0.7).toBe(true);
		expect(pop > 1.1).toBe(true);
		expect(burst).toBe(true);
	});

	it("mid-flip: the squashing card finishes into the skip flip, the rest flip with it, one more sound", () => {
		const d = new Driver([C, C, C]);
		d.runTo(flipAt(0) + FLIP.sec * 0.25);
		const w = d.frame.cards[0].width;
		expect(w < 1 && w > 0).toBe(true);
		const skipAt = d.frame.elapsed;
		d.reveal.skip();
		d.step();
		expect(d.frame.cards[0].width <= w).toBe(true); // keeps squashing, never pops back
		d.runToSettled();
		const flips = d.of(SFX.flip);
		expect(flips.size()).toBe(2);
		heardNear(flips[1], skipAt);
		expect(flips[1].speed).toBeCloseTo(semitonesToSpeed(DRAFT_REVEAL.flipSemitoneStep), 9);
		expect(d.frame.elapsed).toBeCloseTo(skipAt + DRAFT_REVEAL.skipFlipSec + DRAFT_REVEAL.textFadeSec, 1);
	});

	it("a card already past its midpoint lands on its own; the others flip", () => {
		const d = new Driver([R, C, C]);
		d.runTo(flipAt(0) + FLIP.sec * 0.75);
		expect(d.frame.cards[0].face).toBe(1);
		d.reveal.skip();
		d.runToSettled();
		d.runTo(2);
		const rares = d.of(SFX.rare);
		expect(rares.size()).toBe(1);
		heardNear(rares[0], landAt(0));
		expect(d.of(SFX.flip).size()).toBe(2);
	});

	it("mid-charge: no charge hit after the skip, no hush, the flare and the sting still once", () => {
		const d = new Driver([C, L, C]);
		const chargeAt = landAt(1);
		d.runTo(chargeAt + 0.3);
		const before = d.of(SFX.charge).size();
		expect(before >= 1 && before < DRAFT_REVEAL.chargeLadder.hits).toBe(true);
		const skipAt = d.frame.elapsed;
		d.reveal.skip();
		d.step();
		expect(d.frame.cards[1].tremble).toBe(0);
		d.runTo(3);
		expect(d.of(SFX.charge).size()).toBe(before);
		for (const c of d.of(SFX.charge)) expect(c.t <= skipAt + EPS).toBe(true);
		expect(d.of(SFX.legendary).size()).toBe(1);
		heardNear(d.of(SFX.legendary)[0], skipAt + DRAFT_REVEAL.skipFlipSec);
		expect(d.of(SFX.flip).size()).toBe(3);
		expect(d.ducks.size()).toBe(1); // the dip was already asked for at the charge's start
		expect(d.frame.cards[0].dim).toBe(0);
		expect(d.frame.cards[1].haloAlpha).toBe(DRAFT_REVEAL.halo.alpha);
	});

	it("does nothing once settled, and a second skip does nothing", () => {
		const d = new Driver([C, C, C]);
		d.runTo(0.1);
		d.reveal.skip();
		d.reveal.skip();
		d.runToSettled();
		const n = d.heard.size();
		expect(d.of(SFX.flip).size()).toBe(1);
		d.reveal.skip();
		d.runTo(d.frame.elapsed + 0.5);
		expect(d.heard.size()).toBe(n);
		expect(d.frame.settled).toBe(true);
	});
});

describe("DraftReveal: pick", () => {
	it("stamps the chosen card, drops the others, fades the overlay and ends", () => {
		const d = new Driver([C, R, C]);
		d.runToSettled();
		const n = d.heard.size();
		d.reveal.pick(1);
		const pickAt = d.frame.elapsed;
		let stampMax = 1;
		let flashMax = 0;
		let leaving = true;
		const P = DRAFT_REVEAL.pick;
		d.runTo(pickAt + P.stampSec + P.exitFadeSec + 0.1, (f) => {
			if (!f.done) leaving = leaving && f.leaving;
			stampMax = math.max(stampMax, f.cards[1].stamp);
			flashMax = math.max(flashMax, f.cards[1].flash);
			if (f.elapsed < pickAt + P.stampSec - EPS) expect(f.overlayAlpha).toBe(1);
			expect(f.cards[0].stamp).toBe(1);
		});
		expect(leaving).toBe(true);
		expect(d.heard.size()).toBe(n + 1);
		expect(d.heard[n].id).toBe(SFX.pick);
		heardNear(d.heard[n], pickAt);
		expect(stampMax).toBeCloseTo(P.stampScale, 1);
		expect(flashMax > P.stampFlash * 0.8 && flashMax <= P.stampFlash).toBe(true); // the first frame is one step in
		expect(d.frame.done).toBe(true);
		expect(d.frame.active).toBe(false);
		expect(d.frame.overlayAlpha).toBe(0);
		expect(d.frame.cards[0].drop).toBe(P.dropPx);
		expect(d.frame.cards[0].alpha).toBe(0);
		expect(d.frame.cards[1].stamp).toBe(1);
		expect(d.frame.cards[1].alpha).toBe(1);
		d.step();
		expect(d.frame.cues.size()).toBe(0);
		d.reveal.pick(0);
		d.step();
		expect(d.frame.cues.size()).toBe(0);
	});

	it("is done exactly when the overlay fade after the stamp ends", () => {
		const d = new Driver([C]);
		d.runToSettled();
		d.reveal.pick(0);
		const pickAt = d.frame.elapsed;
		for (let i = 0; i < 600 && !d.frame.done; i++) d.step();
		const endAt = pickAt + DRAFT_REVEAL.pick.stampSec + DRAFT_REVEAL.pick.exitFadeSec;
		expect(d.frame.elapsed >= endAt - EPS).toBe(true);
		expect(d.frame.elapsed < endAt + STEP + EPS).toBe(true);
	});

	it("a pick before the reveal settled snaps the faces and plays only the pick", () => {
		const d = new Driver([C, L, C]);
		d.runTo(0.5);
		const n = d.heard.size();
		d.reveal.pick(0);
		d.runTo(1);
		expect(d.heard.size()).toBe(n + 1);
		expect(d.heard[n].id).toBe(SFX.pick);
		expect(d.ducks.size()).toBe(0);
		expect(d.frame.cards[1].face).toBe(1);
		expect(d.frame.cards[1].burst).toBe(-1);
		expect(d.frame.cards[1].dim).toBe(0);
	});
});

describe("DraftReveal: reduced motion", () => {
	function ids(d: Driver): string[] {
		const out: string[] = [];
		for (const c of d.heard) out.push(`${c.id}@${string.format("%.4f", c.t)}x${string.format("%.4f", c.speed)}`);
		return out;
	}

	it("crossfades instead of squashing, with no rise, tremble, pop, burst, flash or ray rotation, and the same cues", () => {
		const full = new Driver([C, R, L]);
		const calm = new Driver([C, R, L], true);
		expect(calm.runToSettled()).toBe(full.runToSettled());
		let crossfade = false;
		let glowAtFlare = 0;
		const flare = landAt(1) + DRAFT_REVEAL.charge.sec + DRAFT_REVEAL.hushSec + DRAFT_REVEAL.fastFlipSec;
		const d = new Driver([C, R, L], true);
		d.runTo(3, (f) => {
			for (const c of f.cards) {
				expect(c.width).toBe(1);
				expect(c.rise).toBe(0);
				expect(c.tremble).toBe(0);
				expect(c.pop).toBe(1);
				expect(c.burst).toBe(-1);
				expect(c.flash).toBe(0);
				expect(c.haloAngle).toBe(0);
				if (c.face > 0 && c.face < 1) crossfade = true;
			}
			if (f.elapsed >= flare - EPS && glowAtFlare === 0) glowAtFlare = f.cards[2].glow;
		});
		full.runTo(3);
		expect(crossfade).toBe(true);
		expect(glowAtFlare > 0.99).toBe(true);
		expect(ids(d)).toEqual(ids(full));
		expect(d.ducks.size()).toBe(1);
		expect(d.frame.cards[2].eyes).toBe(1);
		expect(d.frame.cards[2].haloAlpha).toBe(DRAFT_REVEAL.halo.alpha);
	});

	it("keeps the dim and the deal's fade; the pick has no stamp scale or drop", () => {
		const d = new Driver([C, L], true);
		d.step();
		expect(d.frame.cards[0].alpha > 0).toBe(true);
		expect(d.frame.cards[0].alpha < 1).toBe(true);
		d.runTo(landAt(0) + DRAFT_REVEAL.charge.sec);
		expect(d.frame.cards[0].dim).toBeCloseTo(DRAFT_REVEAL.charge.dim, 9);
		d.runToSettled();
		d.reveal.pick(1);
		d.runTo(d.frame.elapsed + 0.1, (f) => {
			expect(f.cards[1].stamp).toBe(1);
			expect(f.cards[0].drop).toBe(0);
		});
		expect(d.frame.cards[1].flash > 0).toBe(true);
	});
});

describe("DraftReveal: dt", () => {
	it("dt 0 changes nothing and plays nothing", () => {
		const d = new Driver([C, L, R]);
		d.runTo(flipAt(0) - STEP);
		const t = d.frame.elapsed;
		for (let i = 0; i < 5; i++) d.step(0);
		expect(d.frame.elapsed).toBe(t);
		expect(d.heard.size()).toBe(0);
	});

	it("a huge dt is clamped: every cue still fires once, in order", () => {
		const fine = new Driver([C, L, R]);
		fine.runTo(4);
		const coarse = new Driver([C, L, R]);
		let steps = 0;
		while (!coarse.frame.settled) {
			const before = coarse.frame.elapsed;
			coarse.step(1000);
			expect(coarse.frame.elapsed - before).toBeCloseTo(DRAFT_REVEAL.maxFrameDtSec, 9);
			steps++;
		}
		coarse.step(1000);
		const a: string[] = [];
		const b: string[] = [];
		for (const c of fine.heard) a.push(`${c.id}x${string.format("%.6f", c.speed)}`);
		for (const c of coarse.heard) b.push(`${c.id}x${string.format("%.6f", c.speed)}`);
		expect(b).toEqual(a);
		expect(steps > 1).toBe(true);
		expect(coarse.ducks.size()).toBe(1);
	});

	it("negative dt is ignored; step before begin and after clear is inert", () => {
		const r = new DraftReveal();
		expect(r.step(1).active).toBe(false);
		expect(r.frame.cues.size()).toBe(0);
		r.begin([C], false);
		r.step(-1);
		expect(r.frame.elapsed).toBe(0);
		r.clear();
		const f = r.step(1);
		expect(f.active).toBe(false);
		expect(f.cards[0].shown).toBe(false);
		expect(f.cues.size()).toBe(0);
	});
});

describe("draftTrembleAt", () => {
	const C2 = DRAFT_REVEAL.charge;

	it("is pure in time: the same value at a time whatever the frame rate", () => {
		for (const t of [0, 0.01, 0.07, 0.2, 0.33, 0.5, 0.69]) {
			expect(draftTrembleAt(t)).toBe(draftTrembleAt(t));
			expect(math.abs(draftTrembleAt(t)) <= 1).toBe(true);
		}
		expect(draftTrembleAt(-1)).toBe(0);
	});

	it("never aliases to a constant or a two-value flip at 30 or 60 fps over the charge", () => {
		for (const fps of [30, 60, 144]) {
			const seen = new Set<number>();
			let pos = false;
			let neg = false;
			const frames = math.floor(C2.sec * fps);
			for (let k = 0; k < frames; k++) {
				const v = draftTrembleAt(k / fps);
				seen.add(v);
				if (v > 0) pos = true;
				if (v < 0) neg = true;
			}
			expect(pos && neg).toBe(true);
			expect(seen.size() > 2).toBe(true);
		}
	});

	it("holds each value for at least two frames at 30 fps", () => {
		expect(C2.trembleStepHz <= 30 / 2).toBe(true);
		expect(C2.tremblePattern.size() > 2).toBe(true);
	});
});

// docs/COMBO.md CB2: the tiers, the kill pitch ladder, the ComboDisplay timelines and the floor shout's duck test.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BULLET_Y,
	COMBO_MAX,
	COMBO_MIN,
	COMBO_WINDOW_TICKS,
	TILE_SIZE,
	acquireSpawnData,
	createBulletSimulation,
	type BulletSimulation,
} from "shared/sim";
import {
	ComboDisplay,
	shoutBoxAt,
	shoutDucked,
	type ComboDisplayCut,
	type ComboDisplayEvents,
	type ComboDisplayFrame,
	type ComboDisplayInput,
	type ComboDisplayReset,
	type ShoutBox,
	type ShoutBullets,
} from "./combo";
import {
	COMBO_BROKEN_ROLE,
	COMBO_SHOUT,
	COMBO_TIERS,
	COMBO_VIEW,
	KILL_PITCH,
	comboTier,
	killPitchSemitones,
	killPitchSpeed,
	semitonesToSpeed,
	tierStingSpeed,
} from "./comboConfig";

const STEP = 1 / 60;
const EPS = 1e-9;

interface EventsOver {
	start?: number;
	end?: number;
	peak?: number;
	kills?: number;
	grazes?: number;
	cuts?: ComboDisplayCut[];
	ended?: ComboDisplayReset;
}

interface InputOver {
	covered?: boolean;
	runOver?: boolean;
	reducedMotion?: boolean;
	screenShake?: boolean;
	timer?: number;
	dt?: number;
}

/** Drives a ComboDisplay as ComboController does: the live combo / timer plus one frame's events. */
class Driver {
	readonly display = new ComboDisplay();
	combo = COMBO_MIN;
	timer = 0;
	reducedMotion = false;
	screenShake = true;
	now = 0;
	tierUps: number[] = [];
	kicks: number[] = [];

	/** One frame. A feed (kills / grazes) refills the timer; `ev.end` sets the live combo. */
	frame(ev: EventsOver = {}, over: InputOver = {}): ComboDisplayFrame {
		const start = ev.start ?? this.combo;
		const endCombo = ev.end ?? start;
		const kills = ev.kills ?? 0;
		const grazes = ev.grazes ?? 0;
		if (kills + grazes > 0) this.timer = COMBO_WINDOW_TICKS;
		this.combo = endCombo;
		if (over.timer !== undefined) this.timer = over.timer;
		const events: ComboDisplayEvents = {
			startCombo: start,
			endCombo,
			peak: ev.peak ?? math.max(start, endCombo),
			kills,
			grazes,
			cuts: ev.cuts ?? [],
			ended: ev.ended,
		};
		const dt = over.dt ?? STEP;
		const input: ComboDisplayInput = {
			dt,
			combo: this.combo,
			comboTimer: this.timer,
			windowTicks: COMBO_WINDOW_TICKS,
			events,
			covered: over.covered ?? false,
			runOver: over.runOver ?? false,
			reducedMotion: over.reducedMotion ?? this.reducedMotion,
			screenShake: over.screenShake ?? this.screenShake,
		};
		const L = this.display.frame(input);
		this.now += dt;
		if (L.tierUp > 0) this.tierUps.push(L.tierUp);
		if (L.kick) this.kicks.push(this.now);
		return L;
	}

	/** A kill that moves the combo to `to`. */
	feed(to: number, over: InputOver = {}): ComboDisplayFrame {
		return this.frame({ start: this.combo, end: to, kills: 1 }, over);
	}

	/** Quiet frames for `sec` seconds (the timer is held where it is); returns the last. */
	run(sec: number, over: InputOver = {}): ComboDisplayFrame {
		let L = this.display.look;
		const n = math.floor(sec / STEP + 0.5);
		for (let i = 0; i < n; i++) L = this.frame({}, over);
		return L;
	}

	/** The timer ran out at `lost` (a reset to x1.0), during a fight or not. */
	reset(lost: number, peak: number, fight: boolean, over: InputOver = {}): ComboDisplayFrame {
		this.timer = 0;
		return this.frame({ start: lost, end: COMBO_MIN, peak: lost, ended: { lost, peak, fight } }, over);
	}
}

describe("COMBO_TIERS / comboTier", () => {
	it("has five tiers at x1 / x2 / x3 / x4 / x5 with the plan's names, roles and pops", () => {
		expect(COMBO_TIERS.size()).toBe(5);
		const mins = [10, 20, 30, 40, 50];
		const names = [
			undefined,
			"hud.combo.rampage",
			"hud.combo.carnage",
			"hud.combo.dominating",
			"hud.combo.unstoppable",
		];
		const roles = ["ember", "combo.rampage", "combo.carnage", "combo.dominating", "combo.unstoppable"];
		const pops = [1.15, 1.2, 1.25, 1.25, 1.3];
		const stings = [0, 0, 3, 5, 7];
		const pulses = [0, 0, 1, 1.5, 0];
		for (let i = 0; i < 5; i++) {
			const t = COMBO_TIERS[i];
			expect(t.min).toBe(mins[i]);
			expect(t.nameKey).toBe(names[i]);
			expect(t.role).toBe(roles[i]);
			expect(t.popScale).toBe(pops[i]);
			expect(t.stingSemitones).toBe(stings[i]);
			expect(t.pulseHz).toBe(pulses[i]);
			expect(t.shine).toBe(i === 4);
		}
		expect(COMBO_TIERS[0].min).toBe(COMBO_MIN);
		expect(COMBO_TIERS[4].min).toBe(COMBO_MAX);
	});

	it("tiers change exactly at 20 / 30 / 40 / 50", () => {
		const cases: [number, number][] = [
			[5, 0],
			[10, 0],
			[19, 0],
			[20, 1],
			[29, 1],
			[30, 2],
			[39, 2],
			[40, 3],
			[49, 3],
			[50, 4],
			[60, 4],
		];
		for (const [tenths, tier] of cases) expect(comboTier(tenths)).toBe(tier);
	});
});

describe("KILL_PITCH", () => {
	it("is +0 / +5 / +8 / +10 / +12 semitones at x1 / x2 / x3 / x4 / x5", () => {
		const at: [number, number][] = [
			[10, 0],
			[20, 5],
			[30, 8],
			[40, 10],
			[50, 12],
		];
		for (const [tenths, st] of at) expect(killPitchSemitones(tenths)).toBeCloseTo(st, 9);
		expect(killPitchSemitones(15)).toBeCloseTo(2.5, 9);
		expect(killPitchSemitones(25)).toBeCloseTo(6.5, 9);
	});

	it("is monotonic non-decreasing and clamped to [0, maxSemitones]", () => {
		let prev = -1;
		for (let t = 0; t <= 80; t++) {
			const st = killPitchSemitones(t);
			expect(st >= prev).toBe(true);
			expect(st >= 0 && st <= KILL_PITCH.maxSemitones).toBe(true);
			prev = st;
		}
		expect(killPitchSemitones(0)).toBe(0);
		expect(killPitchSemitones(COMBO_MIN)).toBe(0);
		expect(killPitchSemitones(999)).toBeCloseTo(KILL_PITCH.maxSemitones, 9);
	});

	it("turns semitones into PlaybackSpeed (an octave doubles it)", () => {
		expect(semitonesToSpeed(0)).toBe(1);
		expect(semitonesToSpeed(12)).toBeCloseTo(2, 9);
		expect(semitonesToSpeed(-12)).toBeCloseTo(0.5, 9);
		expect(killPitchSpeed(10)).toBe(1);
		expect(killPitchSpeed(50)).toBeCloseTo(2, 9);
		expect(killPitchSpeed(20)).toBeCloseTo(2 ** (5 / 12), 9);
	});

	it("pitches the sting 0 / +3 / +5 / +7 semitones for tiers 1-4 (1 for none or out of range)", () => {
		expect(tierStingSpeed(0)).toBe(1);
		expect(tierStingSpeed(1)).toBe(1);
		expect(tierStingSpeed(2)).toBeCloseTo(2 ** (3 / 12), 9);
		expect(tierStingSpeed(3)).toBeCloseTo(2 ** (5 / 12), 9);
		expect(tierStingSpeed(4)).toBeCloseTo(2 ** (7 / 12), 9);
		expect(tierStingSpeed(9)).toBe(1);
	});
});

describe("ComboDisplay: climbing and tier up", () => {
	it("pops on a feed inside a tier, with no edge", () => {
		const d = new Driver();
		d.combo = 21;
		const L = d.feed(22);
		expect(L.tierUp).toBe(0);
		expect(L.multScale).toBeCloseTo(COMBO_TIERS[1].popScale, 9);
		expect(L.slotScale).toBe(1);
		expect(L.role).toBe("combo.rampage");
		expect(L.slot).toBe("tier");
		expect(L.slotTier).toBe(1);
		expect(L.tenths).toBe(22);
		expect(L.fill).toBe(1);
		expect(d.run(COMBO_VIEW.pop.sec + STEP).multScale).toBe(1);
	});

	it("raises one tierUp edge, slams the tier name 1.6 -> 1 (the multiplier pops) and flashes white", () => {
		const d = new Driver();
		d.combo = 19;
		let L = d.feed(20);
		expect(L.tierUp).toBe(1);
		// The slam is the tier slot's own scale; the multiplier keeps its feed pop.
		expect(L.slotScale).toBeCloseTo(COMBO_VIEW.slam.fromScale, 9);
		expect(L.multScale).toBeCloseTo(COMBO_TIERS[1].popScale, 9);
		expect(L.slot).toBe("tier");
		expect(L.flashRole).toBe("uiText");
		expect(L.flashAlpha).toBe(1);
		expect(L.role).toBe("combo.rampage");
		let dipped = false;
		for (let i = 0; i < 6; i++) {
			L = d.frame();
			if (L.slotScale < 1) dipped = true;
			expect(L.multScale <= COMBO_TIERS[1].popScale + EPS).toBe(true);
			expect(L.tierUp).toBe(0);
		}
		expect(dipped).toBe(true);
		expect(L.flashAlpha).toBe(0);
		L = d.run(COMBO_VIEW.slam.sec);
		expect(L.slotScale).toBe(1);
		expect(L.multScale).toBe(1);
		expect(d.tierUps).toEqual([1]);
	});

	it("a frame that crosses several thresholds raises one edge for the highest new tier", () => {
		const d = new Driver();
		d.combo = 19;
		const L = d.frame({ start: 19, end: 31, kills: 12 });
		expect(L.tierUp).toBe(2);
		expect(d.tierUps).toEqual([2]);
	});

	it("judges the peak, not the end: a tier reached and cut on the same frame still stings", () => {
		const d = new Driver();
		d.combo = 19;
		const L = d.frame({ start: 19, peak: 20, end: 10, kills: 1, cuts: [{ before: 20, after: 10 }] });
		expect(L.tierUp).toBe(1);
		expect(L.cut).toBe(true);
		expect(L.tier).toBe(0);
	});

	it("plays the tier up again when it is re-earned after a cut", () => {
		const d = new Driver();
		d.combo = 19;
		d.feed(20);
		d.feed(22);
		const cut = d.frame({ start: 22, end: 11, cuts: [{ before: 22, after: 11 }] });
		expect(cut.tierUp).toBe(0);
		expect(cut.tier).toBe(0);
		for (let c = 12; c <= 20; c++) d.feed(c);
		expect(d.tierUps).toEqual([1, 1]);
	});

	it("pulses at CARNAGE and DOMINATING and shines at UNSTOPPABLE every 1.5 s", () => {
		const d = new Driver();
		d.combo = 21;
		d.feed(22);
		for (let i = 0; i < 60; i++) {
			const L = d.frame();
			expect(L.pulse).toBe(0);
			expect(L.shine).toBe(-1);
		}
		d.combo = 29;
		d.feed(30);
		let maxPulse = 0;
		for (let i = 0; i < 60; i++) {
			const L = d.frame();
			maxPulse = math.max(maxPulse, L.pulse);
			expect(L.pulse >= 0 && L.pulse <= COMBO_VIEW.pulse.amount + EPS).toBe(true);
			expect(L.shine).toBe(-1);
		}
		expect(maxPulse).toBeCloseTo(COMBO_VIEW.pulse.amount, 3);
		d.combo = 49;
		const top = d.feed(50);
		expect(top.tierUp).toBe(4);
		expect(top.shine).toBe(0);
		expect(top.pulse).toBe(0);
		expect(d.run(0.5).shine).toBe(-1);
		const again = d.run(COMBO_VIEW.shine.periodSec - 0.5 + STEP);
		expect(again.shine >= 0 && again.shine < 1).toBe(true);
	});
});

describe("ComboDisplay: the meter and the warning blink", () => {
	it("fills timer / window and warns in the last 25 % (not at x1.0)", () => {
		const d = new Driver();
		d.combo = 25;
		const quarter = COMBO_WINDOW_TICKS / 4;
		expect(d.frame({}, { timer: COMBO_WINDOW_TICKS / 2 }).fill).toBe(0.5);
		const above = d.frame({}, { timer: quarter + 1 });
		expect(above.warn).toBe(false);
		expect(above.dim).toBe(false);
		expect(d.frame({}, { timer: quarter }).warn).toBe(true);
		d.combo = COMBO_MIN;
		expect(d.frame({}, { timer: 30 }).warn).toBe(false);
	});

	it("blinks at 4 Hz while warning, and is a steady dim under reduced motion", () => {
		const d = new Driver();
		d.combo = 25;
		let flips = 0;
		let last = d.frame({}, { timer: 40 }).dim;
		expect(last).toBe(false);
		// 0.9 s: the half-period edges at 0.125 .. 0.875 s (never a float-accumulated 1.0).
		for (let i = 1; i < 54; i++) {
			const dim = d.frame({}, { timer: 40 }).dim;
			if (dim !== last) flips += 1;
			last = dim;
		}
		// 4 Hz: a flip every 0.125 s.
		expect(flips).toBe(7);
		d.reducedMotion = true;
		for (let i = 0; i < 30; i++) expect(d.frame({}, { timer: 40 }).dim).toBe(true);
		expect(d.frame({}, { timer: 120 }).dim).toBe(false);
	});
});

describe("ComboDisplay: crack (a hit cut)", () => {
	it("flashes uiHealth, shakes 3 px twice, drops -xN.N and fades the name down", () => {
		const d = new Driver();
		d.combo = 33;
		d.frame();
		let L = d.frame({ start: 33, end: 16, cuts: [{ before: 33, after: 16 }] });
		expect(L.cut).toBe(true);
		expect(L.flashRole).toBe("uiHealth");
		expect(L.flashAlpha).toBe(1);
		expect(L.dropTenths).toBe(17);
		expect(L.dropProgress).toBe(0);
		expect(L.tier).toBe(0);
		expect(L.role).toBe("ember");
		// The old name (CARNAGE) fades out first, then the slot empties (no tier below x2).
		expect(L.slot).toBe("tier");
		expect(L.slotTier).toBe(2);
		expect(L.slotAlpha).toBe(1);
		let maxShake = 0;
		let signs = 0;
		let lastSign = 0;
		for (let i = 0; i < 30; i++) {
			L = d.frame();
			expect(L.cut).toBe(false);
			maxShake = math.max(maxShake, math.abs(L.shakePx));
			const s = L.shakePx > 0.5 ? 1 : L.shakePx < -0.5 ? -1 : 0;
			if (s !== 0 && s !== lastSign) {
				signs += 1;
				lastSign = s;
			}
		}
		expect(maxShake <= COMBO_VIEW.crack.shakePx + EPS).toBe(true);
		expect(maxShake > COMBO_VIEW.crack.shakePx * 0.8).toBe(true);
		// Twice left-right: + - + -.
		expect(signs).toBe(4);
		expect(L.shakePx).toBe(0);
		expect(L.slot).toBe("none");
		expect(L.slotAlpha).toBe(1);
		expect(L.flashAlpha).toBe(0);
		expect(d.run(COMBO_VIEW.crack.dropSec).dropProgress).toBe(-1);
	});

	it("fades to the lower name on a cut inside the tiers and sums several cuts on one frame", () => {
		const d = new Driver();
		d.combo = 45;
		d.frame();
		let L = d.frame({
			start: 45,
			end: 25,
			cuts: [
				{ before: 45, after: 33 },
				{ before: 33, after: 25 },
			],
		});
		expect(L.dropTenths).toBe(20);
		L = d.run(COMBO_VIEW.crack.nameFadeSec * 0.75);
		expect(L.slotTier).toBe(1);
		expect(L.slotAlpha > 0 && L.slotAlpha < 1).toBe(true);
		L = d.run(COMBO_VIEW.crack.nameFadeSec);
		expect(L.slotTier).toBe(1);
		expect(L.slotAlpha).toBe(1);
		expect(L.role).toBe("combo.rampage");
	});

	it("a hit at x1.0 (a cut that lost nothing) shows no crack", () => {
		const d = new Driver();
		d.frame();
		const L = d.frame({ start: COMBO_MIN, end: COMBO_MIN, cuts: [{ before: COMBO_MIN, after: COMBO_MIN }] });
		expect(L.cut).toBe(false);
		expect(L.flashAlpha).toBe(0);
		expect(L.dropProgress).toBe(-1);
		expect(L.shakePx).toBe(0);
		for (let i = 0; i < 10; i++) expect(d.frame().shakePx).toBe(0);
	});

	it("a kill and a hit on one tick that net no loss (or a gain) show no crack", () => {
		const d = new Driver();
		d.combo = 20;
		d.frame();
		let L = d.frame({ start: 20, end: 20, kills: 1, cuts: [{ before: 20, after: 20 }] });
		expect([L.cut, L.flashAlpha, L.dropProgress]).toEqual([false, 0, -1]);
		L = d.frame({ start: 20, end: 21, kills: 3, cuts: [{ before: 20, after: 21 }] });
		expect([L.cut, L.flashAlpha, L.dropProgress]).toEqual([false, 0, -1]);
		expect(L.slotTier).toBe(1);
		expect(L.slotAlpha).toBe(1);
		// A real loss on a later frame still cracks.
		L = d.frame({ start: 21, end: 15, cuts: [{ before: 21, after: 15 }] });
		expect([L.cut, L.dropTenths, L.dropProgress]).toEqual([true, 6, 0]);
	});

	it("a cut that stays in the tier keeps the name", () => {
		const d = new Driver();
		d.combo = 39;
		d.frame();
		const L = d.frame({ start: 39, end: 31, cuts: [{ before: 39, after: 31 }] });
		expect(L.slotTier).toBe(2);
		expect(L.slotAlpha).toBe(1);
	});
});

describe("ComboDisplay: break and lapse", () => {
	it("a break during a fight: grey, struck lost value, COMBO LOST, shards, one kick at 0.08 s, back at 1.2 s", () => {
		const d = new Driver();
		d.combo = 34;
		let L = d.reset(34, 36, true);
		const t0 = d.now;
		expect(L.broke).toBe("break");
		expect(L.lapsed).toBe(false);
		expect(L.role).toBe(COMBO_BROKEN_ROLE);
		expect(L.greyMix).toBe(1);
		expect(L.tenths).toBe(34);
		expect(L.struck).toBe(true);
		expect(L.slot).toBe("lost");
		expect(L.fill).toBe(0);
		expect(L.trackGrey).toBe(1);
		expect(L.shards).toBe(0);
		expect(L.shardRole).toBe("combo.carnage");
		expect(L.kick).toBe(false);
		L = d.run(COMBO_VIEW.break.shardSec + STEP);
		expect(L.shards).toBe(-1);
		expect(L.broke).toBe("none");
		expect(L.slot).toBe("lost");
		expect(d.kicks.size()).toBe(1);
		const at = d.kicks[0] - t0;
		expect(at >= COMBO_VIEW.break.kickDelaySec - EPS && at < COMBO_VIEW.break.kickDelaySec + STEP + EPS).toBe(true);
		L = d.run(COMBO_VIEW.break.sec - COMBO_VIEW.break.shardSec - 3 * STEP);
		expect(L.slot).toBe("lost");
		// The track stays grey after the shards are gone, until the break ends.
		expect(L.trackGrey).toBe(1);
		L = d.run(3 * STEP);
		expect(L.trackGrey).toBe(0);
		expect(L.role).toBe("ember");
		expect(L.tenths).toBe(COMBO_MIN);
		expect(L.struck).toBe(false);
		expect(L.slot).toBe("none");
		expect(L.greyMix).toBe(0);
		expect(d.kicks.size()).toBe(1);
	});

	it("a real break comes with a near-zero fill: the whole track shatters in the lost tier's colour", () => {
		const d = new Driver();
		d.combo = 42;
		// The timer's last tick: the fill is all but empty when the break lands.
		let L = d.frame({}, { timer: 1 });
		expect(L.fill > 0 && L.fill < 0.01).toBe(true);
		L = d.reset(42, 45, true);
		expect(L.broke).toBe("break");
		expect(L.shards).toBe(0);
		// The shards' colour is the lost tier's (DOMINATING), never the fill's; their size never reads the fill.
		expect(L.shardRole).toBe("combo.dominating");
		expect(L.fill).toBe(0);
		expect(L.trackGrey).toBe(1);
		L = d.run(COMBO_VIEW.break.shardSec / 2);
		expect(L.shards > 0.4 && L.shards < 0.6).toBe(true);
		expect(L.shardRole).toBe("combo.dominating");
	});

	it("a small break (lost < x2.0): grey and struck, no shards, no kick", () => {
		const d = new Driver();
		d.combo = 14;
		let L = d.reset(14, 14, true);
		expect(L.broke).toBe("small");
		expect(L.struck).toBe(true);
		expect(L.tenths).toBe(14);
		expect(L.slot).toBe("lost");
		expect(L.shards).toBe(-1);
		L = d.run(0.5);
		expect(L.shards).toBe(-1);
		expect(d.kicks.size()).toBe(0);
		expect(COMBO_VIEW.smallBreakVolume).toBe(0.5);
		// x2.0 exactly is a full break.
		const e = new Driver();
		e.combo = 20;
		expect(e.reset(20, 20, true).broke).toBe("break");
	});

	it("Screen shake off: shards but no kick", () => {
		const d = new Driver();
		d.screenShake = false;
		d.combo = 34;
		expect(d.reset(34, 34, true).shards).toBe(0);
		d.run(0.3);
		expect(d.kicks.size()).toBe(0);
	});

	it("a new streak ends the break's grey at once", () => {
		const d = new Driver();
		d.combo = 34;
		d.reset(34, 34, true);
		d.run(0.2);
		const L = d.feed(11);
		expect(L.struck).toBe(false);
		expect(L.slot).toBe("none");
		expect(L.role).toBe("ember");
		expect(L.tenths).toBe(11);
		expect(L.fill).toBe(1);
	});

	it("a lapse (no fight): no sound edge, the empty track and multiplier fade to grey over 0.3 s, BEST 1.2 s", () => {
		const d = new Driver();
		d.combo = 34;
		// The timer ran out: the fill was all but empty already, so nothing drains.
		d.frame({}, { timer: 1 });
		let L = d.reset(34, 36, false);
		expect(L.lapsed).toBe(true);
		expect(L.broke).toBe("none");
		expect(L.slot).toBe("best");
		expect(L.slotTenths).toBe(36);
		expect(L.struck).toBe(false);
		expect(L.tenths).toBe(COMBO_MIN);
		expect(L.role).toBe("combo.carnage");
		expect(L.greyMix).toBe(0);
		expect(L.trackGrey).toBe(0);
		expect(L.fill).toBe(0);
		expect(L.shards).toBe(-1);
		L = d.run(COMBO_VIEW.lapse.greySec / 2);
		expect(L.greyMix > 0.3 && L.greyMix < 0.7).toBe(true);
		expect(L.trackGrey).toBe(L.greyMix);
		expect(L.fill).toBe(0);
		L = d.run(COMBO_VIEW.lapse.greySec / 2 + STEP);
		expect(L.greyMix).toBe(1);
		expect(L.trackGrey).toBe(1);
		expect(L.role).toBe(COMBO_BROKEN_ROLE);
		expect(L.slot).toBe("best");
		expect(L.lapsed).toBe(false);
		L = d.run(COMBO_VIEW.lapse.bestSec - COMBO_VIEW.lapse.greySec);
		expect(L.slot).toBe("none");
		expect(L.role).toBe("ember");
		expect(L.greyMix).toBe(0);
		expect(L.trackGrey).toBe(0);
		expect(d.kicks.size()).toBe(0);
	});
});

describe("ComboDisplay: reduced motion, the stage cover and run over", () => {
	it("reduced motion: no pop, slam, shake, shards or kick; edges, colours, names and the struck value stay", () => {
		const d = new Driver();
		d.reducedMotion = true;
		d.combo = 19;
		let L = d.feed(20);
		expect(L.tierUp).toBe(1);
		expect(L.slotScale).toBe(1);
		expect(L.multScale).toBe(1);
		expect(L.flashAlpha).toBe(1);
		expect(L.role).toBe("combo.rampage");
		expect(L.slotTier).toBe(1);
		for (let i = 0; i < 10; i++) {
			const F = d.feed(d.combo + 1);
			expect([F.slotScale, F.multScale]).toEqual([1, 1]);
		}
		L = d.frame({ start: d.combo, end: 15, cuts: [{ before: d.combo, after: 15 }] });
		expect(L.cut).toBe(true);
		for (let i = 0; i < 20; i++) expect(d.frame().shakePx).toBe(0);
		d.combo = 34;
		L = d.reset(34, 34, true);
		expect(L.broke).toBe("break");
		expect(L.struck).toBe(true);
		expect(L.role).toBe(COMBO_BROKEN_ROLE);
		expect(L.shards).toBe(-1);
		d.run(0.5);
		expect(d.kicks.size()).toBe(0);
	});

	it("under the stage cover: no tier up, break or lapse, and a running break is dropped", () => {
		const d = new Driver();
		d.combo = 19;
		let L = d.feed(20, { covered: true });
		expect(L.tierUp).toBe(0);
		expect([L.slotScale, L.multScale]).toEqual([1, 1]);
		expect(L.flashAlpha).toBe(0);
		expect(L.role).toBe("combo.rampage");
		d.combo = 34;
		L = d.reset(34, 34, true, { covered: true });
		expect(L.broke).toBe("none");
		expect(L.slot).toBe("none");
		expect(L.struck).toBe(false);
		expect(L.shards).toBe(-1);
		d.combo = 30;
		L = d.reset(30, 30, false, { covered: true });
		expect(L.lapsed).toBe(false);
		expect(L.slot).toBe("none");
		// A break that started before the cover: the cover drops it, the reveal shows the plain state.
		d.combo = 34;
		d.reset(34, 34, true);
		d.run(0.02);
		L = d.frame({}, { covered: true });
		expect(L.slot).toBe("none");
		L = d.frame();
		expect(L.slot).toBe("none");
		expect(L.role).toBe("ember");
		expect(L.shards).toBe(-1);
		d.run(0.3);
		expect(d.kicks.size()).toBe(0);
		expect(d.tierUps.size()).toBe(0);
	});

	it("run over: no tier up, break or lapse", () => {
		const d = new Driver();
		d.combo = 19;
		expect(d.feed(20, { runOver: true }).tierUp).toBe(0);
		expect(d.tierUps.size()).toBe(0);
		d.combo = 34;
		let L = d.reset(34, 34, true, { runOver: true });
		expect(L.broke).toBe("none");
		expect(L.slot).toBe("none");
		expect(L.struck).toBe(false);
		d.combo = 25;
		L = d.reset(25, 25, false, { runOver: true });
		expect(L.lapsed).toBe(false);
		expect(L.slot).toBe("none");
		d.run(0.3, { runOver: true });
		expect(d.kicks.size()).toBe(0);
	});

	it("clear() drops a running break for a new run", () => {
		const d = new Driver();
		d.combo = 34;
		d.reset(34, 34, true);
		d.display.clear();
		const L = d.frame();
		expect(L.slot).toBe("none");
		expect(L.shards).toBe(-1);
		expect(L.struck).toBe(false);
	});
});

/** Parallel-array bullets for the duck test (the real pool is checked below). */
class FakeBullets implements ShoutBullets {
	readonly xs: number[] = [];
	readonly zs: number[] = [];
	readonly visible: boolean[] = [];
	private readonly pos = { x: 0, z: 0 };
	add(x: number, z: number, visible = true): void {
		this.xs.push(x);
		this.zs.push(z);
		this.visible.push(visible);
	}
	highWater(): number {
		return this.xs.size();
	}
	isVisible(i: number): boolean {
		return this.visible[i];
	}
	positionAt(i: number): Readonly<{ x: number; z: number }> {
		this.pos.x = this.xs[i];
		this.pos.z = this.zs[i];
		return this.pos;
	}
}

function makeBox(x: number, z: number, rightX = 1, rightZ = 0): ShoutBox {
	return shoutBoxAt({ x: 0, z: 0, rightX: 0, rightZ: 0, halfWidth: 0, halfDepth: 0 }, x, z, rightX, rightZ);
}

describe("shoutDucked", () => {
	const m = COMBO_SHOUT.duckMarginTiles * TILE_SIZE;
	const halfW = (COMBO_SHOUT.widthTiles * TILE_SIZE) / 2;
	const halfD = (COMBO_SHOUT.depthTiles * TILE_SIZE) / 2;

	it("sizes the box from COMBO_SHOUT", () => {
		const b = makeBox(3, 4);
		expect(b.halfWidth).toBe(halfW);
		expect(b.halfDepth).toBe(halfD);
	});

	it("ducks for a bullet inside the grown box and on its edge, not outside or invisible", () => {
		const box = makeBox(10, 20);
		const none = new FakeBullets();
		expect(shoutDucked(box, none)).toBe(false);
		const inside = new FakeBullets();
		inside.add(10.5, 20.25);
		expect(shoutDucked(box, inside)).toBe(true);
		const inMargin = new FakeBullets();
		inMargin.add(10 + halfW + m / 2, 20);
		expect(shoutDucked(box, inMargin)).toBe(true);
		const onEdge = new FakeBullets();
		onEdge.add(10 + halfW + m, 20 - halfD - m);
		expect(shoutDucked(box, onEdge)).toBe(true);
		const outside = new FakeBullets();
		outside.add(10 + halfW + m + 0.01, 20);
		outside.add(10, 20 + halfD + m + 0.01);
		expect(shoutDucked(box, outside)).toBe(false);
		const hidden = new FakeBullets();
		hidden.add(10, 20, false);
		expect(shoutDucked(box, hidden)).toBe(false);
		// A later slot inside is still found past an outside one.
		outside.add(10, 20);
		expect(shoutDucked(box, outside)).toBe(true);
	});

	it("tests along the box's own (camera-turned) axes", () => {
		const r = math.sqrt(1 / 2);
		const box = makeBox(0, 0, r, -r);
		// Along the reading axis, just inside the grown half width ...
		const along = new FakeBullets();
		const a = halfW + m - 0.01;
		along.add(a * r, -a * r);
		expect(shoutDucked(box, along)).toBe(true);
		// ... but the same distance across it is far outside the grown half depth.
		const across = new FakeBullets();
		across.add(a * r, a * r);
		expect(shoutDucked(box, across)).toBe(false);
	});

	it("reads the sim's enemy pool as is; player bullets (another pool) never duck it", () => {
		const fire = (sim: BulletSimulation, x: number, z: number) =>
			sim.fireAt({ x, y: BULLET_Y, z }, () => {
				const p = acquireSpawnData();
				p.life = 5;
				return [p];
			});
		const enemyPool = createBulletSimulation({ maxBullets: 8 });
		const player = createBulletSimulation({ maxBullets: 8 });
		const asShout: ShoutBullets = enemyPool;
		const box = makeBox(4, 4);
		fire(player, 4, 4);
		expect(shoutDucked(box, asShout)).toBe(false);
		fire(enemyPool, 20, 20);
		expect(shoutDucked(box, enemyPool)).toBe(false);
		fire(enemyPool, 4.2, 3.9);
		expect(shoutDucked(box, enemyPool)).toBe(true);
		enemyPool.clear();
		expect(shoutDucked(box, enemyPool)).toBe(false);
	});
});

// Hitstop clock rules and the freeze-frame event rules (port of the web build's src/fx/freeze/hitstop.rules.test.ts
// and src/fx/hitstop.test.ts @ 42897e2): longest wins, the clamps, the rolling rate cap and its boss-death exception,
// the slow-motion ramp, settings, clearing, the camera nudge, and the clock driving a real FixedStepLoop.
import { describe, expect, it } from "@rbxts/jest-globals";
import { defaultJuiceSettings, type JuiceSettings } from "shared/settings";
import { FixedStepLoop, SIM_DT } from "shared/sim";
import {
	BOSS_DEATH_FREEZE_MS,
	BOSS_DEATH_SLOWMO_MS,
	BOSS_DEATH_SLOWMO_SCALE,
	BOSS_PHASE_FREEZE_MS,
	HEAVY_HIT_FREEZE_MS,
	HEAVY_KILL_FREEZE_MS,
	KILL_FREEZE_MS,
	NUDGE_MS,
	STAMP_NUDGE_MS,
	applyFreezeEvent,
	applyHurtFreeze,
	freezeMsFor,
	hurtFreezeMsFor,
	hurtNudgeFor,
	nudgeFor,
	nudgeOffset,
	nudgeReplaces,
	simPacerFor,
	type FreezeEvent,
	type NudgeKind,
} from "./freezeRules";
import {
	BOSS_DEATH_HITSTOP_MS,
	HITSTOP_WINDOW_BUDGET_MS,
	HITSTOP_WINDOW_MS,
	HitstopClock,
	MAX_HITSTOP_MS,
	newFrameAdvance,
	slowMoScaleAt,
} from "./hitstop";
import { FEEL_HURT } from "./hurtConfig";

const on = defaultJuiceSettings(false);
const off: JuiceSettings = { ...on, freezeFrame: false };
const reduced: JuiceSettings = { ...on, reducedMotion: true };
const noShake: JuiceSettings = { ...on, screenShake: false };

/** Spend `ms` of real time in frames of `frameMs`; returns the total sim ms. */
function spend(c: HitstopClock, ms: number, frameMs = 1): number {
	const o = newFrameAdvance();
	let sim = 0;
	let t = 0;
	while (t < ms - 1e-9) {
		sim += c.frame(math.min(frameMs, ms - t) / 1000, o).simDelta * 1000;
		t += frameMs;
	}
	return sim;
}

const ev = (eventType: FreezeEvent["type"], f: Partial<FreezeEvent> = {}): FreezeEvent => ({
	type: eventType,
	boss: false,
	elite: false,
	hpMax: 2,
	phase: 0,
	heavy: false,
	capped: false,
	...f,
});

describe("HitstopClock requests", () => {
	it("longest wins: several kills in one frame are one freeze of the longest length, not their sum", () => {
		const c = new HitstopClock();
		for (const ms of [50, 80, 50, 50, 30]) expect(c.request(ms, on)).toBe(true);
		expect(c.remainingMs).toBe(80);
		expect(c.windowUsed()).toBe(80);
		spend(c, 60);
		expect(c.remainingMs).toBeCloseTo(20, 9);
		c.request(10, on);
		expect(c.remainingMs).toBeCloseTo(20, 9);
		c.request(50, on);
		expect(c.remainingMs).toBeCloseTo(50, 9);
	});

	it("clamps one request to MAX_HITSTOP_MS, or BOSS_DEATH_HITSTOP_MS with exceedCap", () => {
		const c = new HitstopClock();
		c.request(10000, on);
		expect(c.remainingMs).toBe(MAX_HITSTOP_MS);
		c.clear();
		c.request(10000, on, { exceedCap: true });
		expect(c.remainingMs).toBe(BOSS_DEATH_HITSTOP_MS);
		expect(c.request(0, on)).toBe(false);
		expect(c.request(0 / 0, on)).toBe(false);
		expect(c.request(-5, on)).toBe(false);
	});

	it("rate cap: at most 150 ms of freeze per rolling 1 s, then the budget comes back as old grants age out", () => {
		const c = new HitstopClock();
		const granted: number[] = [];
		for (let k = 0; k < 6; k++) {
			const before = c.remainingMs;
			c.request(KILL_FREEZE_MS, on);
			granted.push(math.round(c.remainingMs - before));
			spend(c, 60);
		}
		expect(granted).toEqual([50, 50, 50, 0, 0, 0]);
		expect(c.stats.throttled).toBe(3);
		expect(c.windowUsed()).toBe(HITSTOP_WINDOW_BUDGET_MS);
		spend(c, HITSTOP_WINDOW_MS - 6 * 60 + 1);
		expect(c.windowUsed()).toBe(100);
		c.request(HEAVY_KILL_FREEZE_MS, on);
		expect(c.remainingMs).toBe(50);
		// Over any 1 s window of a long fight the freeze never exceeds the budget (+ one freeze's tail).
		const c2 = new HitstopClock();
		const o = newFrameAdvance();
		const frozenAt: number[] = [];
		for (let t = 0; t < 10000; t += 10) {
			if (t % 30 === 0) c2.request(t % 90 === 0 ? 80 : 50, on);
			frozenAt.push(c2.frame(0.01, o).frozenMs);
		}
		let total = 0;
		for (const f of frozenAt) total += f;
		const last = frozenAt.size() - 100;
		for (let i = 0; i <= last; i++) {
			let sum = 0;
			for (let k = i; k < i + 100; k++) sum += frozenAt[k];
			expect(sum <= HITSTOP_WINDOW_BUDGET_MS + MAX_HITSTOP_MS + 1e-6).toBe(true);
		}
		expect(total).toBeLessThanOrEqual((10000 / HITSTOP_WINDOW_MS + 1) * HITSTOP_WINDOW_BUDGET_MS + 1e-6);
		expect(total).toBeGreaterThan(9 * HITSTOP_WINDOW_BUDGET_MS);
	});

	it("the boss death may exceed the cap and the clamp (and still counts in the window)", () => {
		const c = new HitstopClock();
		c.request(150, on);
		spend(c, 150);
		expect(c.windowUsed()).toBe(150);
		c.request(50, on);
		expect(c.remainingMs).toBe(0); // throttled
		expect(c.request(BOSS_DEATH_HITSTOP_MS, on, { exceedCap: true })).toBe(true);
		expect(c.remainingMs).toBe(BOSS_DEATH_HITSTOP_MS);
		expect(c.windowUsed()).toBe(150 + BOSS_DEATH_HITSTOP_MS);
		c.request(80, on);
		expect(c.remainingMs).toBe(BOSS_DEATH_HITSTOP_MS);
	});

	it("settings off (freezeFrame false) or reducedMotion: no freeze and no slow motion", () => {
		for (const s of [off, reduced]) {
			const c = new HitstopClock();
			expect(c.request(50, s)).toBe(false);
			expect(c.request(250, s, { exceedCap: true })).toBe(false);
			expect(c.requestSlowMo(500, 0.3, s)).toBe(false);
			expect(c.isActive()).toBe(false);
			expect(c.timeScale()).toBe(1);
			expect(spend(c, 1000, 16)).toBeCloseTo(1000, 9);
			expect(c.stats.ignored).toBe(3);
		}
	});

	it("clear() drops the freeze, the slow motion and the rate-cap history", () => {
		const c = new HitstopClock();
		c.request(150, on);
		c.requestSlowMo(500, 0.3, on);
		c.clear();
		expect(c.remainingMs).toBe(0);
		expect(c.isActive()).toBe(false);
		expect(c.windowUsed()).toBe(0);
		expect(c.timeScale()).toBe(1);
		c.request(150, on);
		expect(c.remainingMs).toBe(150);
	});
});

describe("slow motion ramp", () => {
	it("smoothstep from the start scale back to 1 over the duration (monotonic, flat at both ends)", () => {
		expect(slowMoScaleAt(0, 500, 0.3)).toBeCloseTo(0.3, 12);
		expect(slowMoScaleAt(250, 500, 0.3)).toBeCloseTo(0.65, 12);
		expect(slowMoScaleAt(500, 500, 0.3)).toBe(1);
		expect(slowMoScaleAt(10, 500, 0.3) - 0.3).toBeLessThan(0.002);
		let prev = 0;
		for (let t = 0; t <= 500; t += 5) {
			const s = slowMoScaleAt(t, 500, 0.3);
			expect(s >= prev).toBe(true);
			prev = s;
		}
	});

	it("sim time over the ramp is exact and frame-rate independent: 500 ms real -> 325 ms sim", () => {
		const expected = 500 * (0.3 + 0.7 * 0.5);
		for (const frameMs of [1, 16.666, 33.3, 100, 499, 2000]) {
			const c = new HitstopClock();
			c.requestSlowMo(500, 0.3, on);
			expect(spend(c, 500, frameMs)).toBeCloseTo(expected, 6);
			expect(c.isActive()).toBe(false);
		}
		const c = new HitstopClock();
		c.requestSlowMo(500, 0.3, on);
		expect(c.frame(0.6, newFrameAdvance()).simDelta * 1000).toBeCloseTo(expected + 100, 9);
	});

	it("the boss death sequence: the freeze is spent first, then the ramp; FX time scale 0 -> ramp -> 1", () => {
		const c = new HitstopClock();
		expect(applyFreezeEvent(ev("bossDefeated", { boss: true }), c, on)).toBe(BOSS_DEATH_FREEZE_MS);
		expect(c.remainingMs).toBe(BOSS_DEATH_FREEZE_MS);
		expect(c.timeScale()).toBe(0);
		const o = newFrameAdvance();
		const scales: number[] = [];
		let sim = 0;
		for (let f = 0; f < 60; f++) {
			sim += c.frame(1 / 60, o).simDelta;
			scales.push(c.timeScale());
		}
		// 1 s real: 250 ms frozen, 500 ms ramp (325 ms sim), 250 ms normal.
		expect(sim * 1000).toBeCloseTo(325 + 1000 - 250 - 500, 6);
		expect(scales[0]).toBe(0);
		expect(scales[14]).toBe(0); // 250 ms = 15 frames
		expect(scales[16]).toBeGreaterThan(BOSS_DEATH_SLOWMO_SCALE);
		expect(scales[16]).toBeLessThan(0.35);
		expect(scales[59]).toBe(1);
		expect(c.stats.frozenFrames).toBe(15);
		expect(c.stats.slowMs).toBeCloseTo(BOSS_DEATH_SLOWMO_MS, 6);
	});

	it("partly frozen frames report the frozen share and the scaled delta", () => {
		const c = new HitstopClock();
		c.request(100, on);
		expect(c.frame(0.05, newFrameAdvance()).frozen).toBe(true);
		const a = c.frame(0.1, newFrameAdvance());
		expect(a.frozen).toBe(false);
		expect(a.frozenMs).toBeCloseTo(50, 9);
		expect(a.simDelta).toBeCloseTo(0.05, 12);
		expect(a.timeScale).toBeCloseTo(0.5, 12);
	});
});

describe("the clock driving a FixedStepLoop (the LiveRun hook)", () => {
	/** Drives a loop like LiveRun; returns the ticks run per frame and checks the frozen-frame invariants. */
	function drive(c: HitstopClock, loop: FixedStepLoop, deltas: number[], onFrame?: (i: number) => void): number[] {
		const o = newFrameAdvance();
		const ticks: number[] = [];
		for (let i = 0; i < deltas.size(); i++) {
			if (onFrame) onFrame(i);
			const accBefore = loop.accumulator;
			const alphaBefore = loop.getAlpha();
			const adv = c.frame(deltas[i], o);
			let n = 0;
			if (!adv.frozen) loop.advance(adv.simDelta, () => n++);
			else {
				expect(loop.accumulator).toBe(accBefore);
				expect(loop.getAlpha()).toBe(alphaBefore);
			}
			ticks.push(n);
		}
		return ticks;
	}

	const sixtyHz = (n: number): number[] => {
		const out: number[] = [];
		for (let i = 0; i < n; i++) out.push(1 / 60);
		return out;
	};

	it("a freeze runs no ticks, keeps alpha, and nothing catches up afterwards", () => {
		const c = new HitstopClock();
		const loop = new FixedStepLoop();
		const ticks = drive(c, loop, sixtyHz(120), (i) => {
			if (i === 30) c.request(150, on); // 9 frames
		});
		for (let i = 30; i < 39; i++) expect(ticks[i]).toBe(0);
		expect(math.max(...ticks)).toBe(1); // no burst after the freeze
		expect(loop.totalTicks).toBe(120 - 9);
		expect(loop.droppedTime).toBe(0);
	});

	it("slow motion: fewer ticks per real second, recovering to 1 per frame", () => {
		const c = new HitstopClock();
		const loop = new FixedStepLoop();
		const ticks = drive(c, loop, sixtyHz(120), (i) => {
			if (i === 0) c.requestSlowMo(500, 0.3, on);
		});
		let first = 0;
		for (let i = 0; i < 10; i++) first += ticks[i];
		let lastHalf = 0;
		for (let i = 60; i < 120; i++) lastHalf += ticks[i];
		expect(first).toBeLessThanOrEqual(4); // ~0.3x
		expect(lastHalf).toBe(60);
		expect(loop.totalTicks).toBe(math.floor((2000 - 500 + 325) / (SIM_DT * 1000) + 1e-6));
	});

	it("a huge frame spends the freeze and the ramp and the loop caps the ticks as usual", () => {
		const c = new HitstopClock();
		const loop = new FixedStepLoop();
		c.request(250, on, { exceedCap: true });
		c.requestSlowMo(500, 0.3, on);
		const ticks = drive(c, loop, [30, 1 / 60, 0 / 0, -1, math.huge, 1 / 60]);
		expect(ticks).toEqual([5, 1, 0, 0, 0, 1]);
		expect(c.isActive()).toBe(false);
	});
});

describe("freeze-frame event rules", () => {
	it("maps tracker events to freeze lengths", () => {
		expect(freezeMsFor(ev("killed", { hpMax: 2 }))).toBe(KILL_FREEZE_MS);
		expect(freezeMsFor(ev("killed", { hpMax: 4 }))).toBe(KILL_FREEZE_MS);
		expect(freezeMsFor(ev("killed", { hpMax: 10 }))).toBe(HEAVY_KILL_FREEZE_MS);
		expect(freezeMsFor(ev("killed", { hpMax: 2, elite: true }))).toBe(HEAVY_KILL_FREEZE_MS);
		expect(freezeMsFor(ev("killed", { hpMax: 400, boss: true }))).toBe(0);
		expect(freezeMsFor(ev("bossPhase", { phase: 1, boss: true }))).toBe(0);
		expect(freezeMsFor(ev("bossPhase", { phase: 2, boss: true }))).toBe(BOSS_PHASE_FREEZE_MS);
		expect(freezeMsFor(ev("bossPhase", { phase: 3, boss: true }))).toBe(BOSS_PHASE_FREEZE_MS);
		expect(freezeMsFor(ev("bossDefeated", { boss: true }))).toBe(BOSS_DEATH_FREEZE_MS);
		expect(freezeMsFor(ev("hit"))).toBe(0);
		expect(freezeMsFor(ev("spawned"))).toBe(0);
		expect(freezeMsFor(ev("capped"))).toBe(0);
	});

	it("applies to a clock: kills in one frame -> the longest; boss death -> freeze + slow-mo; reset clears", () => {
		const c = new HitstopClock();
		applyFreezeEvent(ev("killed", { hpMax: 2 }), c, on);
		applyFreezeEvent(ev("killed", { hpMax: 10 }), c, on);
		applyFreezeEvent(ev("killed", { hpMax: 2 }), c, on);
		expect(c.remainingMs).toBe(HEAVY_KILL_FREEZE_MS);
		applyFreezeEvent(ev("killed", { boss: true, hpMax: 400 }), c, on);
		applyFreezeEvent(ev("bossDefeated", { boss: true }), c, on);
		expect(c.remainingMs).toBe(BOSS_DEATH_FREEZE_MS);
		expect(c.slowActive).toBe(true);
		applyFreezeEvent(ev("reset"), c, on);
		expect(c.isActive()).toBe(false);
		applyFreezeEvent(ev("bossDefeated", { boss: true }), c, reduced);
		expect(c.isActive()).toBe(false);
	});

	it("camera nudge: 1 render pixel on boss phase 2/3 and death, none under reducedMotion", () => {
		expect(nudgeFor(ev("bossPhase", { phase: 2 }), on)).toBe("phase");
		expect(nudgeFor(ev("bossPhase", { phase: 1 }), on)).toBe("none");
		expect(nudgeFor(ev("bossDefeated"), on)).toBe("death");
		expect(nudgeFor(ev("killed"), on)).toBe("none");
		expect(nudgeFor(ev("bossDefeated"), reduced)).toBe("none");
		const o = { x: 0, y: 0 };
		expect(nudgeOffset("phase", 0, o)).toEqual({ x: 0, y: -1 });
		expect(nudgeOffset("phase", NUDGE_MS.phase - 1, o)).toEqual({ x: 0, y: 0 });
		const xs: number[] = [];
		for (let t = 0; t < NUDGE_MS.death + 60; t += 30) xs.push(nudgeOffset("death", t, o).x);
		for (const x of xs) expect(math.abs(x)).toBeLessThanOrEqual(1);
		expect(xs.includes(1)).toBe(true);
		expect(xs.includes(-1)).toBe(true);
		expect(xs[xs.size() - 1]).toBe(0);
	});
});

describe("freeze-frame rules: port additions (docs/FEEL.md J3)", () => {
	it("a heavy landed hit freezes HEAVY_HIT_FREEZE_MS; a capped or light hit does not", () => {
		expect(HEAVY_HIT_FREEZE_MS).toBe(40);
		expect(freezeMsFor(ev("hit", { heavy: true }))).toBe(HEAVY_HIT_FREEZE_MS);
		expect(freezeMsFor(ev("hit", { heavy: true, boss: true, hpMax: 400 }))).toBe(HEAVY_HIT_FREEZE_MS);
		expect(freezeMsFor(ev("hit", { heavy: true, capped: true }))).toBe(0);
		expect(freezeMsFor(ev("hit", { capped: true }))).toBe(0);
		expect(freezeMsFor(ev("capped", { capped: true, heavy: true }))).toBe(0);
		// a heavy killing blow: its hit and its kill in one frame -> the longer kill freeze (longest wins)
		const c = new HitstopClock();
		applyFreezeEvent(ev("hit", { heavy: true, hpMax: 10 }), c, on);
		expect(c.remainingMs).toBe(HEAVY_HIT_FREEZE_MS);
		applyFreezeEvent(ev("killed", { hpMax: 10 }), c, on);
		expect(c.remainingMs).toBe(HEAVY_KILL_FREEZE_MS);
	});

	it("hurt freeze: heart and lethal ask FEEL_HURT.freezeMs, armor and harmless nothing; settings off ignore it", () => {
		expect(FEEL_HURT.freezeMs).toBe(40);
		expect([hurtFreezeMsFor("none"), hurtFreezeMsFor("harmless"), hurtFreezeMsFor("armor")]).toEqual([0, 0, 0]);
		expect([hurtFreezeMsFor("heart"), hurtFreezeMsFor("lethal")]).toEqual([FEEL_HURT.freezeMs, FEEL_HURT.freezeMs]);
		const c = new HitstopClock();
		expect(applyHurtFreeze("armor", c, on)).toBe(0);
		expect(c.isActive()).toBe(false);
		expect(applyHurtFreeze("heart", c, on)).toBe(FEEL_HURT.freezeMs);
		expect(c.remainingMs).toBe(FEEL_HURT.freezeMs);
		const d = new HitstopClock();
		applyHurtFreeze("lethal", d, off);
		applyHurtFreeze("lethal", d, reduced);
		expect(d.isActive()).toBe(false);
		expect(d.stats.ignored).toBe(2);
	});

	it("the rate cap still holds through a finisher combo, a hurt and kills (150 ms per rolling second)", () => {
		const c = new HitstopClock();
		const o = newFrameAdvance();
		let granted = 0;
		// one second of 60 Hz frames: a heavy hit, a heavy kill and a hurt every 4 frames
		for (let f = 0; f < 60; f++) {
			if (f % 4 === 0) {
				applyFreezeEvent(ev("hit", { heavy: true, hpMax: 10 }), c, on);
				applyFreezeEvent(ev("killed", { hpMax: 10 }), c, on);
				applyHurtFreeze("heart", c, on);
			}
			c.frame(1 / 60, o);
			granted = c.stats.grantedMs;
		}
		expect(granted).toBeLessThanOrEqual(HITSTOP_WINDOW_BUDGET_MS);
		expect(c.stats.throttled).toBeGreaterThan(0);
	});

	it("co-op: the clock never paces a party's sim (simPacerFor), so these freezes are solo only", () => {
		const c = new HitstopClock();
		expect(simPacerFor(1, c)).toBe(c);
		expect(simPacerFor(2, c)).toBe(undefined);
		expect(simPacerFor(4, c)).toBe(undefined);
	});

	it("the room clear stamp's kick: 1 texel down for STAMP_NUDGE_MS, the heavy rank (docs/ROOM_CLEAR.md RC5)", () => {
		const o = { x: 0, y: 0 };
		expect(NUDGE_MS.stamp).toBe(STAMP_NUDGE_MS);
		expect(nudgeOffset("stamp", 0, o)).toEqual({ x: 0, y: -1 });
		expect(nudgeOffset("stamp", STAMP_NUDGE_MS - 1, o)).toEqual({ x: 0, y: -1 });
		expect(nudgeOffset("stamp", STAMP_NUDGE_MS, o)).toEqual({ x: 0, y: 0 });
		expect(nudgeReplaces("stamp", "heavy")).toBe(true);
		expect(nudgeReplaces("heavy", "stamp")).toBe(true);
		expect(nudgeReplaces("hurt", "stamp")).toBe(false);
	});

	it("nudges: heavy kick 1 texel down, hurt jolt 2 texels right / left / right; shake off or reduced motion: none", () => {
		expect(nudgeFor(ev("hit", { heavy: true }), on)).toBe("heavy");
		expect(nudgeFor(ev("hit", { heavy: true, capped: true }), on)).toBe("none");
		expect(nudgeFor(ev("hit"), on)).toBe("none");
		expect(nudgeFor(ev("hit", { heavy: true }), noShake)).toBe("none");
		expect(nudgeFor(ev("bossDefeated"), noShake)).toBe("none");
		expect(nudgeFor(ev("bossPhase", { phase: 2 }), noShake)).toBe("none");
		for (const k of ["harmless", "armor", "heart", "lethal"] as const) {
			expect(hurtNudgeFor(k, on)).toBe("hurt");
			expect(hurtNudgeFor(k, noShake)).toBe("none");
			expect(hurtNudgeFor(k, reduced)).toBe("none");
		}
		expect(hurtNudgeFor("none", on)).toBe("none");
		const o = { x: 0, y: 0 };
		expect(nudgeOffset("heavy", 0, o)).toEqual({ x: 0, y: -1 });
		expect(nudgeOffset("heavy", NUDGE_MS.heavy - 1, o)).toEqual({ x: 0, y: -1 });
		expect(nudgeOffset("heavy", NUDGE_MS.heavy, o)).toEqual({ x: 0, y: 0 });
		expect(NUDGE_MS.hurt).toBe(FEEL_HURT.nudgeSteps * FEEL_HURT.nudgeStepMs);
		const xs: number[] = [];
		for (let t = 0; t < NUDGE_MS.hurt + FEEL_HURT.nudgeStepMs; t += FEEL_HURT.nudgeStepMs) {
			xs.push(nudgeOffset("hurt", t, o).x);
			expect(o.y).toBe(0);
		}
		const n = FEEL_HURT.nudgeTexels;
		expect(xs).toEqual([n, -n, n, 0]);
	});

	it("combo break kick (docs/COMBO.md CB7): the heavy nudge's 1 texel down for the heavy nudge's length", () => {
		const o = { x: 0, y: 0 };
		expect(NUDGE_MS.comboBreak).toBe(NUDGE_MS.heavy);
		for (let t = 0; t < NUDGE_MS.heavy + 20; t += 10) {
			const heavy = nudgeOffset("heavy", t, o);
			const hx = heavy.x;
			const hy = heavy.y;
			expect(nudgeOffset("comboBreak", t, o)).toEqual({ x: hx, y: hy });
		}
		expect(nudgeOffset("comboBreak", 0, o)).toEqual({ x: 0, y: -1 });
		expect(nudgeOffset("comboBreak", NUDGE_MS.comboBreak, o)).toEqual({ x: 0, y: 0 });
		// Below hurt (and phase, death), above heavy.
		expect(nudgeReplaces("hurt", "comboBreak")).toBe(false);
		expect(nudgeReplaces("phase", "comboBreak")).toBe(false);
		expect(nudgeReplaces("death", "comboBreak")).toBe(false);
		expect(nudgeReplaces("comboBreak", "hurt")).toBe(true);
		expect(nudgeReplaces("heavy", "comboBreak")).toBe(true);
		expect(nudgeReplaces("comboBreak", "heavy")).toBe(false);
	});

	it("nudge priority: death > hurt > phase > comboBreak > heavy; a weaker nudge never cuts a stronger one short", () => {
		const order: NudgeKind[] = ["heavy", "comboBreak", "phase", "hurt", "death"];
		for (let a = 0; a < order.size(); a++) {
			for (let b = 0; b < order.size(); b++) {
				expect(nudgeReplaces(order[a], order[b])).toBe(b >= a);
			}
			expect(nudgeReplaces("none", order[a])).toBe(true);
			expect(nudgeReplaces(order[a], "none")).toBe(false);
		}
	});
});

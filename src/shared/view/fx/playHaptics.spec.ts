// In-run haptics (docs/HAPTICS.md HP1): the PLAY_HAPTICS table (strength floor, the heart hurt's double buzz unlike
// the parry, lengths), and PlayHapticsDirector on hand-built frames: kills merge (heavy wins), gap, cap, duty (a 30 s
// fight), priority (a kill during a stagger drops, a stagger during a kill replaces, the lethal hit replaces the boss
// death, a heart hit upgrades an armor buzz inside 0.75 s), hurt never dropped by the cap or duty, the quiet /
// spectating / no-device gates with one stopAll edge, the run-over edge (its lethal hit or boss death still plays and
// rings out), and touchWaveform's points.
import { describe, expect, it } from "@rbxts/jest-globals";
import type { HurtKind } from "../watch";
import { pulseEndSec, pulseStartSec } from "./haptics";
import {
	PLAY_HAPTICS,
	PLAY_HAPTICS_PRIORITY,
	PLAY_HAPTICS_RULES,
	PLAY_HAPTIC_KINDS,
	playCueSeconds,
	type HapticDevice,
	type PlayHaptic,
} from "./hapticsConfig";
import { PlayHapticsDirector, touchWaveform, type PlayHapticDropReason, type PlayHapticsInput } from "./playHaptics";

const R = PLAY_HAPTICS_RULES;
const EPS = 1e-9;
/** A rendered frame's length in the long fights (a kill every frame). */
const FRAME_SEC = 0.05;

interface Frame {
	device?: HapticDevice | "none";
	quiet?: boolean;
	/** Quiet only because the run ended (implies quiet). */
	ending?: boolean;
	spectating?: boolean;
	kills?: number;
	heavy?: boolean;
	parry?: number;
	hurt?: HurtKind;
	phase?: boolean;
	death?: boolean;
}

function input(f: Frame): PlayHapticsInput {
	return {
		device: f.device === "none" ? undefined : f.device ?? "pad",
		quiet: (f.quiet ?? false) || (f.ending ?? false),
		ending: f.ending ?? false,
		spectating: f.spectating ?? false,
		viewKills: f.kills ?? 0,
		viewHeavyKill: f.heavy ?? false,
		parry: f.parry === undefined ? undefined : { count: f.parry },
		hurt: f.hurt,
		bossPhaseBreak: f.phase ?? false,
		bossDeath: f.death ?? false,
	};
}

/** A gate's name in a test title. */
function gateName(gate: Frame): string {
	if (gate.quiet) return "quiet";
	if (gate.spectating) return "spectating";
	return "no device";
}

/** The frame's cue (undefined: none). */
function play(d: PlayHapticsDirector, f: Frame, nowSec: number): PlayHaptic | undefined {
	return d.frame(input(f), nowSec).cue;
}

/** The frame's drop reasons as "kind:reason". */
function dropsOf(d: PlayHapticsDirector): string[] {
	const out = new Array<string>();
	for (const drop of d.out.drops) out.push(`${drop.kind}:${drop.reason}`);
	return out;
}

/** A played cue's on interval (a later cue cuts the running one at its start). */
interface Played {
	kind: PlayHaptic;
	start: number;
	finish: number;
}

/** Records every played cue of a run, cutting a replaced one. */
function record(log: Played[], kind: PlayHaptic | undefined, nowSec: number, device: HapticDevice): void {
	if (kind === undefined) return;
	const last = log[log.size() - 1];
	if (last !== undefined && last.finish > nowSec) last.finish = nowSec;
	log.push({ kind, start: nowSec, finish: nowSec + playCueSeconds(kind, device) });
}

/** On-time inside [lo, hi]. */
function onTime(log: ReadonlyArray<Played>, lo: number, hi: number): number {
	let total = 0;
	for (const p of log) total += math.max(0, math.min(p.finish, hi) - math.max(p.start, lo));
	return total;
}

/** The largest on-time share over every dutyWindowSec window (its maxima sit on an interval's end or start). */
function maxDuty(log: ReadonlyArray<Played>): number {
	let worst = 0;
	for (const p of log) {
		for (const hi of [p.finish, p.start + R.dutyWindowSec]) {
			worst = math.max(worst, onTime(log, hi - R.dutyWindowSec, hi) / R.dutyWindowSec);
		}
	}
	return worst;
}

describe("PLAY_HAPTICS (the plan's table)", () => {
	it("every pulse starts at or above the strength floor and at most 1; a ramp ends within 0..1", () => {
		for (const kind of PLAY_HAPTIC_KINDS) {
			for (const device of ["pad", "touch"] as const) {
				for (const p of PLAY_HAPTICS[kind][device]) {
					const ok =
						p.strength >= R.strengthFloor &&
						p.strength <= 1 &&
						p.seconds > 0 &&
						(p.atSec ?? 0) >= 0 &&
						(p.toStrength === undefined || (p.toStrength >= 0 && p.toStrength <= 1));
					expect([kind, device, ok]).toEqual([kind, device, true]);
				}
			}
		}
		expect(R.strengthFloor).toBe(0.15);
	});

	it("a phone cue's pulses never overlap (one actuator)", () => {
		for (const kind of PLAY_HAPTIC_KINDS) {
			const touch = PLAY_HAPTICS[kind].touch;
			for (let i = 1; i < touch.size(); i++) {
				expect([kind, pulseStartSec(touch[i]) + EPS >= pulseEndSec(touch[i - 1])]).toEqual([kind, true]);
			}
		}
	});

	it("the heart hurt is a double buzz with a 50 ms gap; the parry is one thump: never the same shape", () => {
		for (const device of ["pad", "touch"] as const) {
			expect(PLAY_HAPTICS.hurtHeart[device]).never.toEqual(PLAY_HAPTICS.parry[device]);
			expect(PLAY_HAPTICS.hurtHeart[device]).never.toEqual(PLAY_HAPTICS.parryBig[device]);
		}
		const heartLarge = PLAY_HAPTICS.hurtHeart.pad.filter((p) => p.motor === "Large");
		expect(heartLarge.size()).toBe(2);
		expect(pulseStartSec(heartLarge[1]) - pulseEndSec(heartLarge[0])).toBeCloseTo(0.05, 9);
		expect(PLAY_HAPTICS.parry.pad.filter((p) => p.motor === "Large").size()).toBe(1);
		const heartTouch = PLAY_HAPTICS.hurtHeart.touch;
		expect(heartTouch.size()).toBe(2);
		expect(pulseStartSec(heartTouch[1]) - pulseEndSec(heartTouch[0])).toBeCloseTo(0.05, 9);
		expect(PLAY_HAPTICS.parry.touch.size()).toBe(1);
	});

	it("cue lengths: gaps included, the longest pulse's end", () => {
		expect(playCueSeconds("kill", "pad")).toBeCloseTo(0.035, 9);
		expect(playCueSeconds("kill", "touch")).toBeCloseTo(0.025, 9);
		expect(playCueSeconds("hurtHeart", "pad")).toBeCloseTo(0.23, 9);
		expect(playCueSeconds("stagger", "touch")).toBeCloseTo(0.29, 9);
		expect(playCueSeconds("bossDeath", "pad")).toBeCloseTo(0.6, 9);
		expect(playCueSeconds("hurtLethal", "touch")).toBeCloseTo(0.47, 9);
	});

	it("priority: lethal hurt > boss death > stagger > heart > armor > parry > kill", () => {
		const P = PLAY_HAPTICS_PRIORITY;
		const order: PlayHaptic[] = ["kill", "parry", "hurtArmor", "hurtHeart", "stagger", "bossDeath", "hurtLethal"];
		for (let i = 1; i < order.size(); i++) expect(P[order[i]] > P[order[i - 1]]).toBe(true);
		expect(P.killHeavy).toBe(P.kill);
		expect(P.parryBig).toBe(P.parry);
	});
});

describe("PlayHapticsDirector: kills (merge, gap, cap)", () => {
	it("six kills in one frame are one tick; a heavy kill in the frame makes it the heavy tick", () => {
		const d = new PlayHapticsDirector();
		expect(play(d, { kills: 6 }, 0)).toBe("kill");
		expect(dropsOf(d)).toEqual([]);
		expect(play(d, { kills: 3, heavy: true }, 1)).toBe("killHeavy");
	});

	it("a tick within killGapSec of the last played one drops (gap)", () => {
		const d = new PlayHapticsDirector();
		expect(play(d, { kills: 1 }, 0)).toBe("kill");
		expect(play(d, { kills: 1 }, 0.05)).toBeUndefined();
		expect(dropsOf(d)).toEqual(["kill:gap"]);
		expect(play(d, { kills: 1 }, R.killGapSec)).toBe("kill");
	});

	it("at most killCapPerSec ticks in a rolling second (cap)", () => {
		const d = new PlayHapticsDirector();
		for (let k = 0; k < R.killCapPerSec; k++) expect(play(d, { kills: 1 }, k * 0.1)).toBe("kill");
		expect(play(d, { kills: 1 }, 0.6)).toBeUndefined();
		expect(dropsOf(d)).toEqual(["kill:cap"]);
		expect(play(d, { kills: 1 }, 0.9)).toBeUndefined();
		// The first tick (at 0) has left the window.
		expect(play(d, { kills: 1 }, 1)).toBe("kill");
		expect(play(d, { kills: 1 }, 1.08)).toBeUndefined();
	});

	it("a 30 s fight with a kill every 0.05 s: never more than the cap a second, on at most 40 % of any second", () => {
		for (const device of ["pad", "touch"] as const) {
			for (const heavy of [false, true]) {
				const d = new PlayHapticsDirector();
				const log: Played[] = [];
				const frames = math.round(30 / FRAME_SEC);
				for (let i = 0; i < frames; i++) {
					const now = i * FRAME_SEC;
					record(log, play(d, { device, kills: 1, heavy }, now), now, device);
				}
				expect(log.size() >= R.killCapPerSec * 29).toBe(true);
				for (const p of log) {
					let inWindow = 0;
					for (const q of log) if (q.start > p.start - R.killCapWindowSec && q.start <= p.start) inWindow++;
					expect(inWindow <= R.killCapPerSec).toBe(true);
				}
				expect(maxDuty(log) <= R.dutyMax + EPS).toBe(true);
			}
		}
	});
});

describe("PlayHapticsDirector: duty cap (kill ticks drop first)", () => {
	it("with a parry every 0.5 s and heavy kills every frame, kills drop for duty; every parry plays", () => {
		const d = new PlayHapticsDirector();
		const log: Played[] = [];
		const reasons = new Map<PlayHapticDropReason, number>();
		let parries = 0;
		const frames = math.round(30 / FRAME_SEC);
		const parryEvery = math.round(0.5 / FRAME_SEC);
		for (let i = 0; i < frames; i++) {
			const now = i * FRAME_SEC;
			const parry = i % parryEvery === 0 ? 1 : undefined;
			if (parry !== undefined) parries++;
			const cue = play(d, { kills: 1, heavy: true, parry }, now);
			if (parry !== undefined) expect(cue).toBe("parry");
			record(log, cue, now, "pad");
			for (const drop of d.out.drops) reasons.set(drop.reason, (reasons.get(drop.reason) ?? 0) + 1);
		}
		expect((reasons.get("duty") ?? 0) > 0).toBe(true);
		expect(log.filter((p) => p.kind === "parry").size()).toBe(parries);
		// Every played tick kept the window that ends with it under the cap.
		for (const p of log) {
			if (p.kind !== "killHeavy") continue;
			expect(onTime(log, p.finish - R.dutyWindowSec, p.finish) <= R.dutyMax * R.dutyWindowSec + EPS).toBe(true);
		}
	});

	it("a hurt always plays: past the kill cap and the duty cap", () => {
		const d = new PlayHapticsDirector();
		for (let k = 0; k < R.killCapPerSec; k++) play(d, { kills: 1, heavy: true }, k * 0.1);
		expect(play(d, { kills: 1 }, 0.6)).toBeUndefined();
		expect(play(d, { hurt: "armor" }, 0.62)).toBe("hurtArmor");
		expect(play(d, { hurt: "heart" }, 0.64)).toBe("hurtHeart");
		// A long duty load: a heavy kill every frame and a hurt every 0.8 s (the sim's spacing): every hurt plays.
		const e = new PlayHapticsDirector();
		const hurtEvery = math.round(0.8 / FRAME_SEC);
		for (let i = 0; i < math.round(20 / FRAME_SEC); i++) {
			const hurt: HurtKind | undefined = i % hurtEvery === 0 ? "heart" : undefined;
			const cue = play(e, { kills: 1, heavy: true, parry: i % 4 === 0 ? 1 : undefined, hurt }, i * FRAME_SEC);
			if (hurt !== undefined) expect(cue).toBe("hurtHeart");
		}
	});
});

describe("PlayHapticsDirector: priority", () => {
	it("one cue a frame: the strongest; the others drop as priority", () => {
		const d = new PlayHapticsDirector();
		expect(play(d, { kills: 2, parry: 1 }, 0)).toBe("parry");
		expect(dropsOf(d)).toEqual(["kill:priority"]);
		expect(play(d, { kills: 1, parry: 5, hurt: "lethal", phase: true, death: true }, 1)).toBe("hurtLethal");
		expect(dropsOf(d)).toEqual(["kill:priority", "parryBig:priority", "stagger:priority", "bossDeath:priority"]);
	});

	it("a parry of parryBigFrom erases or more is the big parry", () => {
		const d = new PlayHapticsDirector();
		expect(play(d, { parry: R.parryBigFrom - 1 }, 0)).toBe("parry");
		expect(play(d, { parry: R.parryBigFrom }, 1)).toBe("parryBig");
	});

	it("a kill during a stagger drops; after it the stagger's on-time still counts for duty, then it plays", () => {
		const d = new PlayHapticsDirector();
		expect(play(d, { phase: true }, 0)).toBe("stagger");
		expect(play(d, { kills: 1 }, 0.1)).toBeUndefined();
		expect(dropsOf(d)).toEqual(["kill:priority"]);
		// The stagger is over, but its 0.38 s plus the tick would be over 40 % of the second ending with the tick.
		const staggerSec = playCueSeconds("stagger", "pad");
		expect(staggerSec + playCueSeconds("kill", "pad") > R.dutyMax * R.dutyWindowSec).toBe(true);
		expect(play(d, { kills: 1 }, staggerSec)).toBeUndefined();
		expect(dropsOf(d)).toEqual(["kill:duty"]);
		expect(play(d, { kills: 1 }, R.dutyWindowSec)).toBe("kill");
	});

	it("a parry after a stagger is never held by the duty cap", () => {
		const d = new PlayHapticsDirector();
		expect(play(d, { phase: true }, 0)).toBe("stagger");
		expect(play(d, { parry: 1 }, playCueSeconds("stagger", "pad"))).toBe("parry");
	});

	it("a stagger during a kill replaces it; the lethal hit replaces the boss death, never the reverse", () => {
		const d = new PlayHapticsDirector();
		expect(play(d, { kills: 1 }, 0)).toBe("kill");
		expect(play(d, { phase: true }, 0.01)).toBe("stagger");
		expect(play(d, { death: true }, 1)).toBe("bossDeath");
		expect(play(d, { hurt: "lethal" }, 1.1)).toBe("hurtLethal");
		expect(play(d, { death: true }, 1.2)).toBeUndefined();
		expect(dropsOf(d)).toEqual(["bossDeath:priority"]);
	});

	it("a heart hit inside 0.75 s upgrades an armor buzz; a same-or-weaker hurt there drops; after it, plays", () => {
		expect(R.hurtUpgradeWindowSec).toBe(0.75);
		const d = new PlayHapticsDirector();
		expect(play(d, { hurt: "armor" }, 0)).toBe("hurtArmor");
		expect(play(d, { hurt: "heart" }, 0.05)).toBe("hurtHeart");
		expect(play(d, { hurt: "heart" }, 0.5)).toBeUndefined();
		expect(play(d, { hurt: "harmless" }, 0.6)).toBeUndefined();
		expect(dropsOf(d)).toEqual(["hurtArmor:priority"]);
		expect(play(d, { hurt: "lethal" }, 0.7)).toBe("hurtLethal");
		expect(play(d, { hurt: "armor" }, 0.7 + R.hurtUpgradeWindowSec + 0.01)).toBe("hurtArmor");
		// "none" is no hurt.
		expect(play(d, { hurt: "none" }, 3)).toBeUndefined();
		expect(dropsOf(d)).toEqual([]);
	});

	it("a hurt mid kill-streak always buzzes (stronger than a kill, never held by the gap)", () => {
		const d = new PlayHapticsDirector();
		expect(play(d, { kills: 1 }, 0)).toBe("kill");
		expect(play(d, { kills: 1, hurt: "harmless" }, 0.01)).toBe("hurtArmor");
		expect(dropsOf(d)).toEqual(["kill:priority"]);
	});
});

describe("PlayHapticsDirector: quiet, spectating, no device", () => {
	for (const gate of [{ quiet: true }, { spectating: true }, { device: "none" as const }]) {
		it(`silent with ${gateName(gate)}; stopAll once on the edge from an open frame`, () => {
			const d = new PlayHapticsDirector();
			// Shut from the start: no stopAll (nothing ran).
			d.frame(input({ ...gate, kills: 1 }), 0);
			expect(d.out.cue).toBeUndefined();
			expect(d.out.stopAll).toBe(false);
			expect(dropsOf(d)).toEqual(["kill:quiet"]);
			expect(play(d, { death: true }, 1)).toBe("bossDeath");
			d.frame(input({ ...gate, hurt: "heart" }), 1.1);
			expect(d.out.cue).toBeUndefined();
			expect(d.out.stopAll).toBe(true);
			expect(dropsOf(d)).toEqual(["hurtHeart:quiet"]);
			d.frame(input({ ...gate }), 1.2);
			expect(d.out.stopAll).toBe(false);
			// Open again: the cut boss death no longer blocks a kill.
			expect(play(d, { kills: 1 }, 1.3)).toBe("kill");
			expect(d.out.stopAll).toBe(false);
		});
	}

	it("the run-over edge: the lethal hit (or the boss death) of that frame plays and rings out; nothing else", () => {
		const d = new PlayHapticsDirector();
		expect(play(d, { kills: 1 }, 0)).toBe("kill");
		// The death frame is already run over: the lethal hit plays, the kill drops, nothing stops.
		d.frame(input({ ending: true, hurt: "lethal", kills: 1 }), 0.5);
		expect(d.out.cue).toBe("hurtLethal");
		expect(d.out.stopAll).toBe(false);
		expect(dropsOf(d)).toEqual(["kill:quiet"]);
		// Later run-over frames: quiet, no stopAll (the rumble rings out), no new cue.
		d.frame(input({ ending: true, death: true }), 0.6);
		expect(d.out.cue).toBeUndefined();
		expect(d.out.stopAll).toBe(false);
		expect(dropsOf(d)).toEqual(["bossDeath:quiet"]);
		// An M1 victory: the boss death ends the run on its own frame; with the lethal hit the lethal wins.
		const m1 = new PlayHapticsDirector();
		play(m1, {}, 0);
		expect(play(m1, { ending: true, death: true, kills: 2 }, 0.1)).toBe("bossDeath");
		expect(m1.out.stopAll).toBe(false);
		const both = new PlayHapticsDirector();
		play(both, {}, 0);
		expect(play(both, { ending: true, death: true, hurt: "lethal" }, 0.1)).toBe("hurtLethal");
		expect(dropsOf(both)).toEqual(["bossDeath:priority"]);
	});

	it("the run-over edge needs an open frame before it on the same device, and never plays while spectating", () => {
		const shut = new PlayHapticsDirector();
		play(shut, { quiet: true }, 0);
		expect(play(shut, { ending: true, hurt: "lethal" }, 0.1)).toBeUndefined();
		const spectator = new PlayHapticsDirector();
		play(spectator, {}, 0);
		expect(play(spectator, { ending: true, spectating: true, hurt: "lethal" }, 0.1)).toBeUndefined();
		expect(spectator.out.stopAll).toBe(true);
		const moved = new PlayHapticsDirector();
		play(moved, {}, 0);
		expect(play(moved, { ending: true, device: "touch", hurt: "lethal" }, 0.1)).toBeUndefined();
		expect(moved.out.stopAll).toBe(true);
	});

	it("a device change (pad -> phone) stops the old one once", () => {
		const d = new PlayHapticsDirector();
		expect(play(d, { death: true }, 0)).toBe("bossDeath");
		expect(play(d, { device: "touch", kills: 1 }, 0.1)).toBe("kill");
		expect(d.out.stopAll).toBe(true);
		play(d, { device: "touch" }, 0.2);
		expect(d.out.stopAll).toBe(false);
	});

	it("the output and its drop records are reused frame to frame", () => {
		const d = new PlayHapticsDirector();
		const out = d.frame(input({ kills: 1, parry: 1 }), 0);
		const first = out.drops[0];
		expect(d.frame(input({ kills: 1, parry: 1 }), 1)).toBe(out);
		expect(out.drops[0]).toBe(first);
		d.reset();
		expect(play(d, { kills: 1 }, 1.01)).toBe("kill");
	});
});

describe("touchWaveform (FloatCurveKey points, ms)", () => {
	it("the heart hurt: two Constant steps with the 50 ms gap, ending at 0", () => {
		expect(touchWaveform(PLAY_HAPTICS.hurtHeart.touch)).toEqual([
			{ tMs: 0, value: 1, interp: "Constant" },
			{ tMs: 80, value: 0, interp: "Constant" },
			{ tMs: 130, value: 0.6, interp: "Constant" },
			{ tMs: 210, value: 0, interp: "Constant" },
		]);
	});

	it("the boss death: a step, then a Linear ramp to 0 starting where the step ends", () => {
		expect(touchWaveform(PLAY_HAPTICS.bossDeath.touch)).toEqual([
			{ tMs: 0, value: 1, interp: "Constant" },
			{ tMs: 100, value: 0.6, interp: "Linear" },
			{ tMs: 500, value: 0, interp: "Constant" },
		]);
	});

	it("every cue: integer ms rising strictly, ends at 0; a late start gets a leading 0; a ramp above 0 drops at its end", () => {
		for (const kind of PLAY_HAPTIC_KINDS) {
			const points = touchWaveform(PLAY_HAPTICS[kind].touch);
			for (let i = 0; i < points.size(); i++) {
				expect(points[i].tMs).toBe(math.floor(points[i].tMs));
				if (i > 0) expect([kind, points[i].tMs > points[i - 1].tMs]).toEqual([kind, true]);
			}
			expect(points[points.size() - 1].value).toBe(0);
			expect(points[points.size() - 1].tMs).toBe(math.round(playCueSeconds(kind, "touch") * 1000));
		}
		expect(touchWaveform([{ strength: 0.5, seconds: 0.1, atSec: 0.02, toStrength: 0.2 }])).toEqual([
			{ tMs: 0, value: 0, interp: "Constant" },
			{ tMs: 20, value: 0.5, interp: "Linear" },
			{ tMs: 119, value: 0.2, interp: "Constant" },
			{ tMs: 120, value: 0, interp: "Constant" },
		]);
	});
});

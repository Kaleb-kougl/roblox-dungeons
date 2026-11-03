// The grazes and parries director (docs/GRAZE_PARRY.md GP4), on hand-built frame sources over real scored states:
//   - closest-point math (behind the bullet, clamped never ahead of it, no velocity)
//   - graze sparks: per-frame cap with the view player's kept first; particles off
//   - graze cue: chain ladder steps / cap / gap reset, one cue per frame at the final step, min interval, view player only
//   - parry groups across frames and players, the +3 st rule, burst caps and the merge, flash records (count, pop,
//     fade, teammate scale, reduced motion, life, a dead player)
//   - freeze gating (solo / co-op / reduced motion / the setting), quiet, new-run resets, players outside the party
//   - the frame's parry group starts (docs/RUN_RECAP.md CM1) and the grouping rule startsParryGroup
import { describe, expect, it } from "@rbxts/jest-globals";
import { buildRunConfig } from "shared/run";
import { defaultJuiceSettings, type JuiceSettings } from "shared/settings";
import { SWORD_DATA, createSimState, playerAt, type SimState } from "shared/sim";
import { semitonesToSpeed } from "../hud/comboConfig";
import { NEAR_MISS_VIEW } from "./nearMissConfig";
import type { GrazeRecord, GuardEraseRecord, NearMissFrameSource } from "./nearMissEvents";
import { NearMissDirector, grazeClosestPoint, parryFlashFade, parryFlashPop, startsParryGroup } from "./nearMissRules";

const SEED = 1337;
const G = NEAR_MISS_VIEW.graze;
const P = NEAR_MISS_VIEW.parry;
const F = NEAR_MISS_VIEW.flash;
const SETTINGS = defaultJuiceSettings();

/** A scored state with every player at the origin facing +x (party of `n`). */
function scoredState(n = 1): SimState {
	const setup = buildRunConfig(SEED, { scoring: {}, partySize: n });
	const s = createSimState(SEED, setup.spawn!.x, setup.spawn!.z, setup.config);
	for (let i = 0; i < n; i++) {
		const p = playerAt(s, i);
		p.x = 0;
		p.z = 0;
		p.faceX = 1;
		p.faceZ = 0;
	}
	return s;
}

function graze(player: number, x = 2, z = 1, vx = 1, vz = 0, tick = 0): GrazeRecord {
	return { x, z, vx, vz, player, tick };
}

function erase(player: number, tick: number, x = 1, z = 0): GuardEraseRecord {
	return { x, z, player, tick };
}

function src(grazes: GrazeRecord[] = [], erases: GuardEraseRecord[] = []): NearMissFrameSource {
	return { ticks: 1, grazes, erases };
}

function juice(patch: Partial<JuiceSettings>): JuiceSettings {
	return { ...SETTINGS, ...patch };
}

const near = (a: number, b: number) => math.abs(a - b) < 1e-9;

describe("grazeClosestPoint", () => {
	const out = { x: 0, z: 0, dirX: 0, dirZ: 0 };

	it("projects the grazer onto the bullet's path behind it, with the unit direction of travel", () => {
		grazeClosestPoint(2, 1, 3, 0, 0, 0, out);
		expect([out.x, out.z, out.dirX, out.dirZ]).toEqual([0, 1, 1, 0]);
		// Diagonal: the path z = x - 2 passes closest to the origin at (1, -1).
		grazeClosestPoint(3, 1, 2, 2, 0, 0, out);
		expect(near(out.x, 1) && near(out.z, -1)).toBe(true);
		expect(near(out.dirX, math.sqrt(0.5)) && near(out.dirZ, math.sqrt(0.5))).toBe(true);
	});

	it("never puts the point ahead of the bullet", () => {
		// Still approaching (the grazer is ahead of it): the bullet's own position.
		grazeClosestPoint(-2, 1, 1, 0, 0, 0, out);
		expect([out.x, out.z, out.dirX, out.dirZ]).toEqual([-2, 1, 1, 0]);
	});

	it("no velocity: the bullet's position, sprayed away from the grazer", () => {
		grazeClosestPoint(0, 2, 0, 0, 0, 0, out);
		expect([out.x, out.z, out.dirX, out.dirZ]).toEqual([0, 2, 0, 1]);
	});
});

describe("NearMissDirector: graze sparks", () => {
	it("one spark per graze at the closest point, from the grazer's current position", () => {
		const s = scoredState();
		const d = new NearMissDirector();
		const out = d.frame(src([graze(0, 3, 1, 2, 0)]), s, 0, false, SETTINGS, 0);
		expect(out.grazeSparks.map((k) => [k.x, k.z, k.dirX, k.dirZ, k.player])).toEqual([[0, 1, 1, 0, 0]]);
		// The grazer moved on: the point follows its position now.
		s.player.x = 1;
		const out2 = d.frame(src([graze(0, 3, 1, 2, 0)]), s, 0, false, SETTINGS, 1);
		expect(out2.grazeSparks[0].x).toBe(1);
	});

	it("caps sparks per frame, keeping the view player's first", () => {
		const s = scoredState(2);
		const d = new NearMissDirector();
		const list: GrazeRecord[] = [];
		for (let k = 0; k < 3; k++) list.push(graze(1, 10 + k));
		for (let k = 0; k < 5; k++) list.push(graze(0, 20 + k));
		const out = d.frame(src(list), s, 0, false, SETTINGS, 0);
		expect(out.grazeSparks.size()).toBe(G.sparksPerFrame);
		expect(out.grazeSparks.map((k) => k.player)).toEqual([0, 0, 0, 0, 0, 1]);
		// Spectating player 1 instead: theirs first.
		const out2 = new NearMissDirector().frame(src(list), s, 1, false, SETTINGS, 0);
		expect(out2.grazeSparks.map((k) => k.player)).toEqual([1, 1, 1, 0, 0, 0]);
	});

	it("particles off: no sparks or bursts; the cues and the flash stay", () => {
		const s = scoredState();
		const out = new NearMissDirector().frame(
			src([graze(0)], [erase(0, 5)]),
			s,
			0,
			false,
			juice({ particles: "off" }),
			0,
		);
		expect(out.grazeSparks.size()).toBe(0);
		expect(out.parryBursts.size()).toBe(0);
		expect(out.grazeCue).never.toBe(undefined);
		expect(out.parryCues.size()).toBe(1);
		expect(out.flashes.size()).toBe(1);
	});
});

describe("NearMissDirector: the graze cue (chain ladder)", () => {
	/** Semitones of the cue at each (clock, graze count) frame, -1 for no cue. */
	function ladder(frames: ReadonlyArray<[number, number]>, view = 0, grazer = 0): number[] {
		const s = scoredState(2);
		const d = new NearMissDirector();
		const res: number[] = [];
		for (const [clock, count] of frames) {
			const list: GrazeRecord[] = [];
			for (let k = 0; k < count; k++) list.push(graze(grazer));
			const cue = d.frame(src(list), s, view, false, SETTINGS, clock).grazeCue;
			res.push(cue === undefined ? -1 : cue.semitones);
		}
		return res;
	}

	it("climbs one semitone per chained graze, from +0", () => {
		expect(
			ladder([
				[0, 1],
				[0.1, 1],
				[0.2, 1],
				[0.3, 1],
			]),
		).toEqual([0, 1, 2, 3]);
	});

	it("caps at maxSemitones", () => {
		const frames: Array<[number, number]> = [];
		for (let k = 0; k < 10; k++) frames.push([k * 0.1, 1]);
		expect(ladder(frames)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 7, 7]);
		expect(G.maxSemitones).toBe(7);
	});

	it("resets after the gap (a graze exactly chainGapSec later starts over)", () => {
		expect(
			ladder([
				[0, 1],
				[0.25, 1],
				[0.25 + G.chainGapSec, 1],
				[1, 1],
			]),
		).toEqual([0, 1, 0, 1]);
	});

	it("several grazes on one frame: one cue at the final step", () => {
		expect(
			ladder([
				[0, 3],
				[0.1, 2],
			]),
		).toEqual([2, 4]);
	});

	it("min interval: a frame too soon plays nothing but still climbs", () => {
		expect(
			ladder([
				[0, 1],
				[0.03, 1],
				[0.06, 1],
			]),
		).toEqual([0, -1, 2]);
	});

	it("frames without grazes play nothing", () => {
		expect(
			ladder([
				[0, 1],
				[0.1, 0],
				[0.2, 1],
			]),
		).toEqual([0, -1, 1]);
	});

	it("speed is the semitone shift as PlaybackSpeed", () => {
		const s = scoredState();
		const d = new NearMissDirector();
		d.frame(src([graze(0)]), s, 0, false, SETTINGS, 0);
		const cue = d.frame(src([graze(0), graze(0)]), s, 0, false, SETTINGS, 0.1).grazeCue!;
		expect(cue.semitones).toBe(2);
		expect(cue.speed).toBe(semitonesToSpeed(2));
	});

	it("only the view player's grazes sound; a teammate's chain never moves the view player's", () => {
		expect(
			ladder(
				[
					[0, 1],
					[0.1, 1],
				],
				0,
				1,
			),
		).toEqual([-1, -1]);
		const s = scoredState(2);
		const d = new NearMissDirector();
		d.frame(src([graze(1), graze(1), graze(1)]), s, 0, false, SETTINGS, 0);
		const cue = d.frame(src([graze(0), graze(1)]), s, 0, false, SETTINGS, 0.1).grazeCue;
		expect(cue!.semitones).toBe(0);
		// Switching the view to player 1 (spectating) picks up their running chain.
		const cue1 = d.frame(src([graze(1)]), s, 1, false, SETTINGS, 0.2).grazeCue;
		expect(cue1!.semitones).toBe(4);
	});
});

describe("NearMissDirector: parries", () => {
	it("one group per guard: one cue on the frame it starts, the count across frames", () => {
		const s = scoredState();
		const d = new NearMissDirector();
		const a = d.frame(src([], [erase(0, 100), erase(0, 100)]), s, 0, false, SETTINGS, 0);
		expect(a.parryCues.map((c) => [c.player, c.local, c.speed])).toEqual([[0, true, 1]]);
		expect(a.flashes.map((f) => [f.player, f.count, f.isNew, f.grew, f.showCount])).toEqual([
			[0, 2, true, true, false],
		]);

		const b = d.frame(src([], [erase(0, 100 + SWORD_DATA.guardTicks - 1)]), s, 0, false, SETTINGS, 0.1);
		expect(b.parryCues.size()).toBe(0);
		expect(b.flashes.map((f) => [f.count, f.isNew, f.grew, f.showCount])).toEqual([[3, false, true, true]]);

		const c = d.frame(src(), s, 0, false, SETTINGS, 0.2);
		expect(c.flashes.map((f) => [f.count, f.isNew, f.grew])).toEqual([[3, false, false]]);
	});

	it("an erase at the guard window's end starts a new group (a new cue, the flash restarts)", () => {
		const s = scoredState();
		const d = new NearMissDirector();
		d.frame(src([], [erase(0, 100)]), s, 0, false, SETTINGS, 0);
		const b = d.frame(src([], [erase(0, 100 + SWORD_DATA.guardTicks)]), s, 0, false, SETTINGS, 0.3);
		expect(b.parryCues.size()).toBe(1);
		expect(b.flashes.map((f) => [f.count, f.isNew, f.ageSec])).toEqual([[1, true, 0]]);
	});

	it("groups per player: two guards on one frame give two cues (local and teammate) and two flashes", () => {
		const s = scoredState(3);
		const d = new NearMissDirector();
		const out = d.frame(src([], [erase(2, 50), erase(0, 50), erase(2, 50)]), s, 2, false, SETTINGS, 0);
		expect(out.parryCues.map((c) => [c.player, c.local])).toEqual([
			[0, false],
			[2, true],
		]);
		expect(out.flashes.map((f) => [f.player, f.count, f.scale])).toEqual([
			[0, 1, F.teammateScale],
			[2, 2, 1],
		]);
	});

	it("parryGroups (docs/RUN_RECAP.md CM1): each group's start once, in start order, with its first erase's tick and position", () => {
		const s = scoredState(3);
		const d = new NearMissDirector();
		const a = d.frame(
			src([], [erase(2, 50, 4, 5), erase(0, 51, 1, 2), erase(2, 52, 9, 9)]),
			s,
			0,
			false,
			SETTINGS,
			0,
		);
		expect(a.parryGroups.map((g) => [g.player, g.tick, g.x, g.z])).toEqual([
			[2, 50, 4, 5],
			[0, 51, 1, 2],
		]);
		// later erases of the same guards start nothing; a guard window later is a new group
		const b = d.frame(
			src([], [erase(0, 60), erase(2, 50 + SWORD_DATA.guardTicks, 7, 0)]),
			s,
			0,
			false,
			SETTINGS,
			0.1,
		);
		expect(b.parryGroups.map((g) => [g.player, g.tick, g.x])).toEqual([[2, 50 + SWORD_DATA.guardTicks, 7]]);
		expect(d.frame(src(), s, 0, false, SETTINGS, 0.2).parryGroups.size()).toBe(0);
		// quiet: none
		expect(d.frame(src([], [erase(1, 200)]), s, 0, true, SETTINGS, 0.3).parryGroups.size()).toBe(0);
	});

	it("startsParryGroup: no group, a tick before the group's, or SWORD_DATA.guardTicks or more after it", () => {
		const w = SWORD_DATA.guardTicks;
		expect([
			startsParryGroup(false, 100, 100),
			startsParryGroup(true, 100, 100),
			startsParryGroup(true, 100, 99 + w),
			startsParryGroup(true, 100, 100 + w),
			startsParryGroup(true, 100, 99),
		]).toEqual([true, false, false, true, true]);
	});

	it("+3 semitones only when the guard's first frame erased bigFrom or more", () => {
		const s = scoredState();
		const big = new NearMissDirector().frame(
			src([], [erase(0, 9), erase(0, 9), erase(0, 9)]),
			s,
			0,
			false,
			SETTINGS,
			0,
		);
		expect(big.parryCues[0].speed).toBe(semitonesToSpeed(P.bigSemitones));
		expect(big.flashes[0].showCount).toBe(true);

		const d = new NearMissDirector();
		const first = d.frame(src([], [erase(0, 9), erase(0, 9)]), s, 0, false, SETTINGS, 0);
		expect(first.parryCues[0].speed).toBe(1);
		const later = d.frame(src([], [erase(0, 10)]), s, 0, false, SETTINGS, 0.05);
		expect(later.parryCues.size()).toBe(0);
		expect(later.flashes[0].count).toBe(3);
	});

	it("bursts: one per erase away from the guard, capped per frame, extras merged into the nearest", () => {
		const s = scoredState();
		const list: GuardEraseRecord[] = [];
		for (let k = 0; k < P.burstsPerFrame; k++) list.push(erase(0, 1, k + 1, 0));
		list.push(erase(0, 1, 2.1, 0)); // nearest kept: x = 2
		list.push(erase(0, 1, 7.9, 0.5)); // nearest kept: x = 8
		const out = new NearMissDirector().frame(src([], list), s, 0, false, SETTINGS, 0);
		expect(out.parryBursts.size()).toBe(P.burstsPerFrame);
		expect(out.parryBursts.map((b) => b.weight)).toEqual([1, 2, 1, 1, 1, 1, 1, 2]);
		let total = 0;
		for (const b of out.parryBursts) total += b.weight;
		expect(total).toBe(list.size());
		expect([out.parryBursts[0].dirX, out.parryBursts[0].dirZ]).toEqual([1, 0]);
		// Behind the guard: thrown the other way; on the guard: its facing.
		const back = new NearMissDirector().frame(
			src([], [erase(0, 1, 0, -2), erase(0, 1, 0, 0)]),
			s,
			0,
			false,
			SETTINGS,
			0,
		);
		expect(back.parryBursts.map((b) => [b.dirX, b.dirZ])).toEqual([
			[0, -1],
			[1, 0],
		]);
	});

	it("the flash pops in, holds, fades and ends; no pop under reduced motion", () => {
		expect(parryFlashPop(0, false)).toBe(F.popScale);
		expect(parryFlashPop(F.popSec / 2, false) < F.popScale && parryFlashPop(F.popSec / 2, false) > 1).toBe(true);
		expect(parryFlashPop(F.popSec, false)).toBe(1);
		expect(parryFlashPop(0, true)).toBe(1);
		expect(parryFlashFade(0)).toBe(1);
		expect(parryFlashFade(F.sec - F.fadeSec - 0.01)).toBe(1);
		expect(parryFlashFade(F.sec)).toBe(0);
		expect(near(parryFlashFade(F.sec - F.fadeSec / 2), 0.5)).toBe(true);

		const s = scoredState();
		const d = new NearMissDirector();
		expect(d.frame(src([], [erase(0, 1)]), s, 0, false, SETTINGS, 10).flashes[0].pop).toBe(F.popScale);
		const mid = d.frame(src(), s, 0, false, SETTINGS, 10.2).flashes[0];
		expect([mid.pop, mid.fade]).toEqual([1, 1]);
		expect(near(mid.ageSec, 0.2)).toBe(true);
		expect(d.frame(src(), s, 0, false, SETTINGS, 10 + F.sec + 0.01).flashes.size()).toBe(0);

		const rm = new NearMissDirector().frame(src([], [erase(0, 1)]), s, 0, false, juice({ reducedMotion: true }), 0);
		expect(rm.flashes[0].pop).toBe(1);
	});

	it("a dead guard's flash ends", () => {
		const s = scoredState(2);
		const d = new NearMissDirector();
		d.frame(src([], [erase(1, 1)]), s, 0, false, SETTINGS, 0);
		playerAt(s, 1).dead = 1;
		expect(d.frame(src(), s, 0, false, SETTINGS, 0.1).flashes.size()).toBe(0);
	});

	it("the flash follows the guarding player's position", () => {
		const s = scoredState();
		const d = new NearMissDirector();
		d.frame(src([], [erase(0, 1)]), s, 0, false, SETTINGS, 0);
		s.player.x = 3;
		s.player.z = -2;
		const f = d.frame(src(), s, 0, false, SETTINGS, 0.1).flashes[0];
		expect([f.x, f.z]).toEqual([3, -2]);
	});
});

describe("NearMissDirector: the solo freeze", () => {
	function freezeOf(n: number, view: number, guard: number, settings: JuiceSettings): number {
		return new NearMissDirector().frame(src([], [erase(guard, 1)]), scoredState(n), view, false, settings, 0)
			.freezeMs;
	}

	it("solo, the view player's guard starting: NEAR_MISS_VIEW.freezeMs once", () => {
		expect(freezeOf(1, 0, 0, SETTINGS)).toBe(NEAR_MISS_VIEW.freezeMs);
		const s = scoredState();
		const d = new NearMissDirector();
		d.frame(src([], [erase(0, 1)]), s, 0, false, SETTINGS, 0);
		expect(d.frame(src([], [erase(0, 2)]), s, 0, false, SETTINGS, 0.02).freezeMs).toBe(0);
	});

	it("none in co-op, under reduced motion, or with Freeze frame off", () => {
		expect(freezeOf(2, 0, 0, SETTINGS)).toBe(0);
		expect(freezeOf(2, 0, 1, SETTINGS)).toBe(0);
		expect(freezeOf(1, 0, 0, juice({ reducedMotion: true }))).toBe(0);
		expect(freezeOf(1, 0, 0, juice({ freezeFrame: false }))).toBe(0);
	});
});

describe("NearMissDirector: gates and resets", () => {
	it("quiet: nothing out, and the chains and groups start over afterwards", () => {
		const s = scoredState();
		const d = new NearMissDirector();
		d.frame(src([graze(0), graze(0)], [erase(0, 1)]), s, 0, false, SETTINGS, 0);
		const q = d.frame(src([graze(0)], [erase(0, 2)]), s, 0, true, SETTINGS, 0.1);
		expect(q.grazeSparks.size()).toBe(0);
		expect(q.parryBursts.size()).toBe(0);
		expect(q.grazeCue).toBe(undefined);
		expect(q.parryCues.size()).toBe(0);
		expect(q.flashes.size()).toBe(0);
		expect(q.freezeMs).toBe(0);

		const after = d.frame(src([graze(0)], [erase(0, 3)]), s, 0, false, SETTINGS, 0.2);
		expect(after.grazeCue!.semitones).toBe(0);
		expect(after.parryCues.size()).toBe(1);
		expect(after.flashes[0].count).toBe(1);
	});

	it("a new run (another state, or the tick going back) resets chains and groups", () => {
		const s = scoredState();
		s.tick = 100;
		const d = new NearMissDirector();
		d.frame(src([graze(0), graze(0)], [erase(0, 100)]), s, 0, false, SETTINGS, 0);
		const s2 = scoredState();
		s2.tick = 100;
		const other = d.frame(src([graze(0)], [erase(0, 100)]), s2, 0, false, SETTINGS, 0.1);
		expect(other.grazeCue!.semitones).toBe(0);
		expect(other.parryCues.size()).toBe(1);

		s2.tick = 5;
		const back = d.frame(src([graze(0)], [erase(0, 5)]), s2, 0, false, SETTINGS, 0.2);
		expect(back.grazeCue!.semitones).toBe(0);
		expect(back.parryCues.size()).toBe(1);
		expect(back.flashes.map((f) => [f.count, f.isNew])).toEqual([[1, true]]);
	});

	it("ignores records of a player outside the party", () => {
		const s = scoredState();
		const out = new NearMissDirector().frame(src([graze(3)], [erase(2, 1)]), s, 0, false, SETTINGS, 0);
		expect(out.grazeSparks.size()).toBe(0);
		expect(out.parryBursts.size()).toBe(0);
		expect(out.parryCues.size()).toBe(0);
		expect(out.flashes.size()).toBe(0);
	});

	it("reuses its output and records frame to frame", () => {
		const s = scoredState();
		const d = new NearMissDirector();
		const a = d.frame(src([graze(0)], [erase(0, 1)]), s, 0, false, SETTINGS, 0);
		const spark = a.grazeSparks[0];
		const burst = a.parryBursts[0];
		const b = d.frame(src([graze(0)], [erase(0, 1 + SWORD_DATA.guardTicks)]), s, 0, false, SETTINGS, 1);
		expect(b).toBe(a);
		expect(b).toBe(d.out);
		expect(b.grazeSparks[0]).toBe(spark);
		expect(b.parryBursts[0]).toBe(burst);
	});
});

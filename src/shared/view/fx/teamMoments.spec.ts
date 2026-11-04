// Co-op moments, the pure core (docs/RUN_RECAP.md CM1), on hand-built room clears and parry group starts over real
// scored states:
//   - TEAM PERFECT only in a party run (score.partySize >= 2) and only for the sim's PERFECT; streak in clear order, reset
//     by any non-perfect clear, several rooms on one tick, the best streak and the totals
//   - SYNC!: the 12 / 13 tick edge, the same player twice, three players (one frame, or grown on a later frame), the
//     cooldown (and a group waiting through it), across frames, the tether at the distance edge, the midpoint
//   - determinism: two instances fed the same log agree, whatever their frame boundaries; a new run resets
//   - the NearMissDirector's parryGroups feed TeamMoments end to end
import { describe, expect, it } from "@rbxts/jest-globals";
import { defaultJuiceSettings } from "shared/settings";
import { SWORD_DATA, createSimState, playerAt, type SimState } from "shared/sim";
import type { GuardEraseRecord } from "./nearMissEvents";
import { NearMissDirector, type ParryGroupStart } from "./nearMissRules";
import type { RoomClear } from "./roomClears";
import {
	SyncParryRule,
	TeamMoments,
	isTeamRun,
	syncCooldownTicks,
	syncTetherReach,
	type SyncParryMoment,
	type TeamMomentKind,
} from "./teamMoments";
import { TEAM_MOMENTS } from "./teamMomentsConfig";

const W = TEAM_MOMENTS.syncWindowTicks;

/** A scored state of a party of `size` (score.partySize = size). */
function scored(size: number): SimState {
	return createSimState(1, 0, 0, size > 1 ? { party: { size }, scoring: { partySize: size } } : { scoring: {} });
}

function clear(perfect: boolean, tick: number, rooms = 1, room = 0): RoomClear {
	return {
		room,
		rooms,
		perfect,
		killPoints: 100,
		clearPoints: 50,
		perfectPoints: perfect ? 300 : 0,
		fastPoints: 0,
		pelletPoints: 0,
		sweepPoints: 0,
		hordePoints: 0,
		hordeBonusPoints: 0,
		x: 3,
		z: 4,
		slot: -1,
		actorId: 0,
		minX: 0,
		maxX: 10,
		minZ: 0,
		maxZ: 10,
		tick,
	};
}

function group(player: number, tick: number, x = 0, z = 0): ParryGroupStart {
	return { player, tick, x, z };
}

/** The frame's sync records as [id, count, firstTick, tick, grew, players]. */
function syncs(list: ReadonlyArray<SyncParryMoment>): Array<[number, number, number, number, boolean, number[]]> {
	return list.map((s) => [s.id, s.count, s.firstTick, s.tick, s.grew, s.points.map((p) => p.player)]);
}

describe("TeamMoments: config", () => {
	it("holds the plan's tunables", () => {
		expect(TEAM_MOMENTS.syncWindowTicks).toBe(12);
		expect(TEAM_MOMENTS.syncCooldownSec).toBe(1);
		expect(syncCooldownTicks()).toBe(60);
		expect(TEAM_MOMENTS.tetherMaxTiles).toBe(10);
		expect(syncTetherReach()).toBe(10);
		expect([TEAM_MOMENTS.minPartySize, TEAM_MOMENTS.streakShowFrom]).toEqual([2, 2]);
		expect([isTeamRun(1), isTeamRun(2), isTeamRun(4)]).toEqual([false, true, true]);
	});
});

describe("TeamMoments: TEAM PERFECT", () => {
	it("only in a party run and only for the sim's PERFECT", () => {
		const solo = scored(1);
		const m = new TeamMoments();
		expect(m.frame(solo, [clear(true, 10)], []).teamPerfects.size()).toBe(0);
		expect(m.totals.teamPerfects).toBe(0);
		const duo = scored(2);
		expect(m.frame(duo, [clear(false, 10)], []).teamPerfects.size()).toBe(0);
		const out = m.frame(duo, [clear(true, 20, 1, 3)], []);
		expect(out.teamPerfects).toEqual([
			{
				kind: "teamPerfect",
				tick: 20,
				room: 3,
				rooms: 1,
				streak: 1,
				showStreak: false,
				points: 300,
				x: 3,
				z: 4,
			},
		]);
		expect(m.totals).toEqual({ teamPerfects: 1, bestTeamStreak: 1, syncParries: 0 });
	});

	it("streaks in clear order (several on one frame too), shown from 2, reset by any non-perfect clear", () => {
		const s = scored(2);
		const m = new TeamMoments();
		const streaks = (out: ReturnType<TeamMoments["frame"]>) =>
			out.teamPerfects.map((t) => [t.streak, t.showStreak]);
		expect(streaks(m.frame(s, [clear(true, 1)], []))).toEqual([[1, false]]);
		expect(streaks(m.frame(s, [clear(true, 2), clear(true, 3)], []))).toEqual([
			[2, true],
			[3, true],
		]);
		expect(m.currentStreak()).toBe(3);
		// a non-perfect clear in the same frame resets the streak before the next one
		expect(streaks(m.frame(s, [clear(false, 4), clear(true, 5)], []))).toEqual([[1, false]]);
		expect(streaks(m.frame(s, [clear(false, 6)], []))).toEqual([]);
		expect(m.currentStreak()).toBe(0);
		// two rooms on one tick, both perfect: they count two
		expect(streaks(m.frame(s, [clear(true, 7, 2)], []))).toEqual([[2, true]]);
	});

	it("tracks the best streak and the team perfect rooms", () => {
		const s = scored(3);
		const m = new TeamMoments();
		for (const c of [clear(true, 1), clear(true, 2), clear(true, 3), clear(false, 4), clear(true, 5)]) {
			m.frame(s, [c], []);
		}
		expect(m.totals).toEqual({ teamPerfects: 4, bestTeamStreak: 3, syncParries: 0 });
		expect(m.currentStreak()).toBe(1);
	});
});

describe("TeamMoments: SYNC! parries", () => {
	it("two players' groups 12 ticks apart sync; 13 apart do not", () => {
		const s = scored(2);
		const at12 = new TeamMoments();
		expect(syncs(at12.frame(s, [], [group(0, 100), group(1, 100 + W)]).syncs)).toEqual([
			[1, 2, 100, 112, false, [0, 1]],
		]);
		expect(at12.totals.syncParries).toBe(1);
		const at13 = new TeamMoments();
		expect(at13.frame(s, [], [group(0, 100), group(1, 101 + W)]).syncs.size()).toBe(0);
		expect(at13.totals.syncParries).toBe(0);
	});

	it("the same player twice is not a sync", () => {
		const r = new SyncParryRule();
		const out = new Array<SyncParryMoment>();
		r.add(0, 100, 0, 0);
		r.add(0, 105, 0, 0);
		r.drain(out);
		expect(out.size()).toBe(0);
		// and the player's newer group is the one that waits: 12 ticks from it, not from the first
		r.add(1, 105 + W, 0, 0);
		r.drain(out);
		expect(syncs(out)).toEqual([[1, 2, 105, 117, false, [0, 1]]]);
	});

	it("a solo run has no syncs (different player indices or not)", () => {
		const m = new TeamMoments();
		expect(m.frame(scored(1), [], [group(0, 100), group(1, 101)]).syncs.size()).toBe(0);
	});

	it("three players in the window make x3: in one frame one record; a later frame grows the same sync", () => {
		const s = scored(3);
		const one = new TeamMoments();
		expect(syncs(one.frame(s, [], [group(0, 100), group(1, 104), group(2, 100 + W)]).syncs)).toEqual([
			[1, 3, 100, 112, false, [0, 1, 2]],
		]);
		const split = new TeamMoments();
		expect(syncs(split.frame(s, [], [group(0, 100), group(1, 104)]).syncs)).toEqual([
			[1, 2, 100, 104, false, [0, 1]],
		]);
		expect(syncs(split.frame(s, [], [group(2, 100 + W)]).syncs)).toEqual([[1, 3, 100, 112, true, [0, 1, 2]]]);
		// a grown sync counts once
		expect(split.totals.syncParries).toBe(1);
		// a third player past the first group's window does not join (and cannot sync in the cooldown)
		const late = new TeamMoments();
		late.frame(s, [], [group(0, 100), group(1, 104)]);
		expect(late.frame(s, [], [group(2, 101 + W)]).syncs.size()).toBe(0);
	});

	it("at most one sync per cooldown; a group waiting through it can pair once it is over", () => {
		const s = scored(2);
		const cd = syncCooldownTicks();
		const m = new TeamMoments();
		expect(m.frame(s, [], [group(0, 100), group(1, 102)]).syncs.size()).toBe(1);
		// formed at 102: nothing until 162
		expect(m.frame(s, [], [group(0, 130), group(1, 131)]).syncs.size()).toBe(0);
		expect(m.frame(s, [], [group(0, 155)]).syncs.size()).toBe(0);
		expect(syncs(m.frame(s, [], [group(1, 102 + cd)]).syncs)).toEqual([[2, 2, 155, 162, false, [0, 1]]]);
		expect(m.totals.syncParries).toBe(2);
	});

	it("works across frames: a group that starts on a later frame inside the window still syncs", () => {
		const s = scored(2);
		const m = new TeamMoments();
		expect(m.frame(s, [], [group(1, 50)]).syncs.size()).toBe(0);
		expect(m.frame(s, [], []).syncs.size()).toBe(0);
		expect(syncs(m.frame(s, [], [group(0, 59)]).syncs)).toEqual([[1, 2, 50, 59, false, [1, 0]]]);
	});

	it("positions are each group's first erase; the midpoint; the tether at exactly tetherMaxTiles, not beyond", () => {
		const s = scored(3);
		const reach = syncTetherReach();
		const near = new TeamMoments().frame(s, [], [group(0, 10, 2, 1), group(1, 11, 2 + reach, 1)]).syncs[0];
		expect([near.midX, near.midZ, near.tethered]).toEqual([2 + reach / 2, 1, true]);
		expect(near.points.map((p) => [p.player, p.tick, p.x, p.z])).toEqual([
			[0, 10, 2, 1],
			[1, 11, 2 + reach, 1],
		]);
		const far = new TeamMoments().frame(s, [], [group(0, 10, 0, 0), group(1, 11, reach + 0.001, 0)]).syncs[0];
		expect(far.tethered).toBe(false);
		// distance never decides the sync itself (CMD4): 40 tiles apart still syncs, untethered
		const veryFar = new TeamMoments().frame(s, [], [group(0, 10, 0, 0), group(1, 11, 4 * reach, 0)]).syncs;
		expect([veryFar.size(), veryFar[0].tethered]).toEqual([1, false]);
		// three points: every two within reach
		const three = new TeamMoments().frame(
			s,
			[],
			[group(0, 10, 0, 0), group(1, 11, reach, 0), group(2, 12, 2 * reach, 0)],
		).syncs[0];
		expect([three.count, three.midX, three.tethered]).toEqual([3, reach, false]);
	});

	it("emits only the teamPerfect and sync kinds (revive is reserved)", () => {
		const s = scored(2);
		const m = new TeamMoments();
		const out = m.frame(s, [clear(true, 5)], [group(0, 6), group(1, 7)]);
		const kinds = new Array<TeamMomentKind>();
		for (const t of out.teamPerfects) kinds.push(t.kind);
		for (const t of out.syncs) kinds.push(t.kind);
		expect(kinds).toEqual(["teamPerfect", "sync"]);
	});
});

describe("TeamMoments: determinism and runs", () => {
	/** A co-op log: per frame, the clears and the group starts. */
	const LOG: Array<[RoomClear[], ParryGroupStart[]]> = [
		[[], [group(0, 10, 1, 1)]],
		[[clear(true, 15)], [group(1, 18, 4, 2)]],
		[[], [group(2, 21, 9, 9), group(0, 40, 0, 0)]],
		[
			[clear(true, 50), clear(false, 60)],
			[group(1, 75, 3, 3), group(2, 80, 2, 2)],
		],
		// a group waits through the cooldown (formed at 80: none before 140) and pairs once it is over
		[[clear(true, 90)], [group(0, 125, 1, 0), group(1, 135, 2, 0), group(2, 145, 30, 0)]],
	];

	it("two instances fed the same log give identical frames and totals", () => {
		const a = new TeamMoments();
		const b = new TeamMoments();
		const s = scored(3);
		for (const [c, g] of LOG) {
			const oa = a.frame(s, c, g);
			const ob = b.frame(s, c, g);
			expect([oa.teamPerfects, oa.syncs]).toEqual([ob.teamPerfects, ob.syncs]);
		}
		expect(a.totals).toEqual(b.totals);
		expect(a.totals).toEqual({ teamPerfects: 3, bestTeamStreak: 2, syncParries: 3 });
	});

	it("clearsFrame then parriesFrame (the client's two phases) equal frame(); each refills only its own half", () => {
		const s = scored(3);
		const whole = new TeamMoments();
		const split = new TeamMoments();
		for (const [c, g] of LOG) {
			const ow = whole.frame(s, c, g);
			const wp = ow.teamPerfects.map((p) => [p.tick, p.streak, p.showStreak]);
			const ws = syncs(ow.syncs);
			const perfects = split.clearsFrame(s, c).teamPerfects.map((p) => [p.tick, p.streak, p.showStreak]);
			const os = split.parriesFrame(s, g);
			// the parry half leaves the frame's team perfects alone
			expect([perfects, os.teamPerfects.map((p) => [p.tick, p.streak, p.showStreak]), syncs(os.syncs)]).toEqual([
				wp,
				wp,
				ws,
			]);
		}
		expect(split.totals).toEqual(whole.totals);
		// solo: neither half has moments
		const solo = new TeamMoments();
		expect(solo.clearsFrame(scored(1), [clear(true, 5)]).teamPerfects.size()).toBe(0);
		expect(solo.parriesFrame(scored(1), [group(0, 6), group(1, 7)]).syncs.size()).toBe(0);
	});

	it("frame boundaries do not change which syncs form (only whether a later frame's record reads `grew`)", () => {
		const s = scored(3);
		const perFrame = new TeamMoments();
		const last = new Map<number, [number, number, number, number[]]>();
		for (const [c, g] of LOG) {
			for (const r of perFrame.frame(s, c, g).syncs) {
				last.set(r.id, [r.count, r.firstTick, r.tick, r.points.map((p) => p.player)]);
			}
		}
		const oneFrame = new TeamMoments();
		const allClears = new Array<RoomClear>();
		const allGroups = new Array<ParryGroupStart>();
		for (const [c, g] of LOG) {
			for (const x of c) allClears.push(x);
			for (const x of g) allGroups.push(x);
		}
		const merged = oneFrame.frame(s, allClears, allGroups).syncs;
		expect(merged.size()).toBe(last.size());
		for (const r of merged) {
			expect([r.id, r.count, r.firstTick, r.tick, r.points.map((p) => p.player)]).toEqual([
				r.id,
				...last.get(r.id)!,
			]);
			expect(r.grew).toBe(false);
		}
		expect(oneFrame.totals).toEqual(perFrame.totals);
	});

	it("a new run (another state, or the tick going back) and reset() zero the totals and forget waiting groups", () => {
		const m = new TeamMoments();
		const s = scored(2);
		m.frame(s, [clear(true, 5)], [group(0, 6), group(1, 7)]);
		m.frame(s, [], [group(0, 100)]);
		expect(m.totals).toEqual({ teamPerfects: 1, bestTeamStreak: 1, syncParries: 1 });
		const nextRun = scored(2);
		// the waiting group of the old run does not pair with the new run's
		expect(m.frame(nextRun, [], [group(1, 101)]).syncs.size()).toBe(0);
		expect(m.totals).toEqual({ teamPerfects: 0, bestTeamStreak: 0, syncParries: 0 });
		expect(m.currentStreak()).toBe(0);
		m.frame(nextRun, [clear(true, 200)], []);
		m.reset();
		expect([m.totals.teamPerfects, m.currentStreak()]).toEqual([0, 0]);
	});
});

describe("TeamMoments: from the NearMissDirector's parry groups", () => {
	function party(n: number): SimState {
		const s = scored(n);
		for (let i = 0; i < n; i++) {
			const p = playerAt(s, i);
			p.x = i * 3;
			p.z = 0;
			p.faceX = 1;
			p.faceZ = 0;
		}
		return s;
	}

	function erase(player: number, tick: number, x: number): GuardEraseRecord {
		return { x, z: 0, player, tick };
	}

	it("one group per guard (later erases of the same guard are not new groups), two players' guards sync", () => {
		const s = party(2);
		const d = new NearMissDirector();
		const m = new TeamMoments();
		const settings = defaultJuiceSettings();
		const frame = (erases: GuardEraseRecord[], clock: number) => {
			const f = d.frame({ ticks: 1, grazes: [], erases }, s, 0, false, settings, clock);
			return m.frame(s, [], f.parryGroups);
		};
		expect(frame([erase(0, 100, 1), erase(0, 100, 2), erase(0, 103, 1)], 0).syncs.size()).toBe(0);
		expect(d.out.parryGroups.map((g) => [g.player, g.tick, g.x])).toEqual([[0, 100, 1]]);
		// player 0's guard keeps erasing inside its window: no new group; player 1's first erase is
		const out = frame([erase(0, 105, 1), erase(1, 108, 4)], 0.1);
		expect(d.out.parryGroups.map((g) => [g.player, g.tick, g.x])).toEqual([[1, 108, 4]]);
		expect(syncs(out.syncs)).toEqual([[1, 2, 100, 108, false, [0, 1]]]);
		expect([out.syncs[0].points[0].x, out.syncs[0].points[1].x]).toEqual([1, 4]);
		// a new guard of player 0 after the window is a new group (within the cooldown: no sync)
		frame([erase(0, 100 + SWORD_DATA.guardTicks, 1)], 0.5);
		expect(d.out.parryGroups.map((g) => [g.player, g.tick])).toEqual([[0, 100 + SWORD_DATA.guardTicks]]);
		expect(m.totals.syncParries).toBe(1);
	});
});

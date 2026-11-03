// The SYNC! callout's timeline (docs/RUN_RECAP.md CM5): the text's pop (none under reduced motion) and fade, the
// tether's snap (none under reduced motion) and fade over its 0.25 s, tethered vs one text per point, a grown sync
// restarting it, clear(), and the tunables.
import { describe, expect, it } from "@rbxts/jest-globals";
import { SyncCallout, syncCalloutFade, syncCalloutPop, syncTetherFade, syncTetherWidth } from "./syncCallout";
import type { SyncParryMoment } from "./teamMoments";
import { TEAM_MOMENTS_VIEW } from "./teamMomentsConfig";

const C = TEAM_MOMENTS_VIEW.callout;
const T = TEAM_MOMENTS_VIEW.tether;
const STEP = 1 / 60;

function moment(id: number, tethered: boolean, players = 2): SyncParryMoment {
	const points = new Array<SyncParryMoment["points"][number]>();
	for (let i = 0; i < players; i++) points.push({ player: i, tick: 10 + i, x: i * 4, z: 1 });
	return {
		kind: "sync",
		id,
		firstTick: 10,
		tick: 10 + players - 1,
		count: players,
		grew: false,
		points,
		midX: ((players - 1) * 4) / 2,
		midZ: 1,
		tethered,
	};
}

describe("SyncCallout: tunables", () => {
	it("holds the plan's numbers: the tether lives 0.25 s; the text under the shout's cap", () => {
		expect(T.sec).toBe(0.25);
		expect(C.sec > T.sec).toBe(true);
		expect(C.fadeSec <= C.sec && T.fadeSec <= T.sec && T.snapSec < T.sec).toBe(true);
		expect(C.scale <= 1 && C.smallScale < C.scale).toBe(true);
		expect([C.role, T.role]).toEqual(["nearMiss.parry", "nearMiss.parry"]);
		expect(T.maxOpacity <= 1 && T.widthTiles < T.flashWidthTiles).toBe(true);
	});
});

describe("SyncCallout: pure helpers", () => {
	it("the text pops from popScale to 1 over popSec (eased), never under reduced motion", () => {
		expect(syncCalloutPop(0, false)).toBe(C.popScale);
		const mid = syncCalloutPop(C.popSec / 2, false);
		expect(mid < C.popScale && mid > 1).toBe(true);
		expect(syncCalloutPop(C.popSec, false)).toBe(1);
		expect([syncCalloutPop(0, true), syncCalloutPop(C.popSec / 2, true)]).toEqual([1, 1]);
	});

	it("the text fades out over its last fadeSec", () => {
		expect(syncCalloutFade(0)).toBe(1);
		expect(syncCalloutFade(C.sec - C.fadeSec)).toBeCloseTo(1);
		expect(syncCalloutFade(C.sec - C.fadeSec / 2)).toBeCloseTo(0.5);
		expect([syncCalloutFade(C.sec), syncCalloutFade(C.sec + 1)]).toEqual([0, 0]);
	});

	it("the tether snaps from flashWidthTiles to widthTiles (thin at once under reduced motion) and fades by sec", () => {
		expect(syncTetherWidth(0, false)).toBe(T.flashWidthTiles);
		const mid = syncTetherWidth(T.snapSec / 2, false);
		expect(mid < T.flashWidthTiles && mid > T.widthTiles).toBe(true);
		expect(syncTetherWidth(T.snapSec, false)).toBe(T.widthTiles);
		expect([syncTetherWidth(0, true), syncTetherWidth(T.snapSec / 2, true)]).toEqual([T.widthTiles, T.widthTiles]);
		expect(syncTetherFade(0)).toBe(1);
		expect(syncTetherFade(T.sec - T.fadeSec / 2)).toBeCloseTo(0.5);
		expect([syncTetherFade(T.sec), syncTetherFade(T.sec + 1)]).toEqual([0, 0]);
	});
});

describe("SyncCallout: timeline", () => {
	it("a tethered sync: one text at the mean, the tether for its 0.25 s, the text to the end of its life", () => {
		const c = new SyncCallout();
		c.show(moment(1, true));
		let L = c.frame(STEP, false);
		expect([L.active, L.isNew, L.ageSec, L.count, L.tethered, L.pointCount, L.mid.x, L.mid.z]).toEqual([
			true,
			true,
			0,
			2,
			true,
			2,
			2,
			1,
		]);
		expect([L.pop, L.fade, L.tetherOn, L.tetherFade, L.tetherWidthTiles]).toEqual([
			C.popScale,
			1,
			true,
			1,
			T.flashWidthTiles,
		]);
		L = c.frame(STEP, false);
		expect(L.isNew).toBe(false);
		let tetherOffAt = -1;
		let endAt = -1;
		let age = STEP;
		for (let n = 0; n < 120; n++) {
			L = c.frame(STEP, false);
			age += STEP;
			if (tetherOffAt < 0 && !L.tetherOn) tetherOffAt = age;
			if (endAt < 0 && !L.active) endAt = age;
		}
		expect(math.abs(tetherOffAt - T.sec) <= STEP + 1e-9).toBe(true);
		expect(math.abs(endAt - C.sec) <= STEP + 1e-9).toBe(true);
	});

	it("an untethered sync has no tether; its points are kept for a text at each", () => {
		const c = new SyncCallout();
		c.show(moment(1, false, 3));
		const L = c.frame(STEP, false);
		expect([L.tethered, L.tetherOn, L.pointCount, L.count]).toEqual([false, false, 3, 3]);
		expect([L.points[0].x, L.points[1].x, L.points[2].x]).toEqual([0, 4, 8]);
	});

	it("reduced motion: no pop and no snap; the text and tether still fade", () => {
		const c = new SyncCallout();
		c.show(moment(1, true));
		let L = c.frame(STEP, true);
		expect([L.pop, L.tetherWidthTiles]).toEqual([1, T.widthTiles]);
		for (let n = 0; n < 12; n++) L = c.frame(STEP, true);
		expect([L.pop, L.tetherWidthTiles]).toEqual([1, T.widthTiles]);
		expect(L.tetherFade < 1 && L.tetherFade > 0).toBe(true);
	});

	it("a grown (or new) sync restarts it with the new count and points; clear() drops it", () => {
		const c = new SyncCallout();
		c.show(moment(1, true));
		for (let n = 0; n < 20; n++) c.frame(STEP, false);
		const grown: SyncParryMoment = { ...moment(1, true, 3), grew: true };
		c.show(grown);
		let L = c.frame(STEP, false);
		expect([L.isNew, L.ageSec, L.count, L.pointCount, L.tetherOn]).toEqual([true, 0, 3, 3, true]);
		c.clear();
		L = c.frame(STEP, false);
		expect([L.active, L.isNew, L.tetherOn]).toEqual([false, false, false]);
	});
});

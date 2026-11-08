// The bow's drawing rules (docs/BUILDS_V2.md BV11c): ring / fan chord angles and lengths, the pin hold mask, the
// slam's camera nudge.
import { describe, expect, it } from "@rbxts/jest-globals";
import { MAX_ACTORS } from "shared/sim";
import { BUILDS_V2_FX } from "./buildsV2FxConfig";
import { FULL_RING_HALF_ANGLE, type WaveOneRingView } from "./buildsV2Fx";
import { PinHoldMask, SIEGE_DRAW, slamNudge, waveOneChordTiles, waveOneSegmentAngle } from "./siegeDraw";

const EPS = 1e-9;

function ring(over: Partial<WaveOneRingView>): WaveOneRingView {
	return {
		x: 0,
		z: 0,
		radius: 1,
		fade: 1,
		role: "build.burst",
		segments: 4,
		block: BUILDS_V2_FX.ballista.ring,
		dirX: 0,
		dirZ: 0,
		halfAngleRad: FULL_RING_HALF_ANGLE,
		owner: 0,
		mine: true,
		ageSec: 0,
		...over,
	};
}

describe("waveOneSegmentAngle / waveOneChordTiles (BV11c)", () => {
	it("a full ring spreads its chords round the turn, BuildFxController.drawRing's angles", () => {
		const r = ring({ segments: 4, radius: 2 });
		for (let i = 0; i < 4; i++) expect(waveOneSegmentAngle(r, i)).toBeCloseTo((2 * math.pi * (i + 0.5)) / 4, 9);
		// 2 r sin(pi / n)
		expect(waveOneChordTiles(r)).toBeCloseTo(2 * 2 * math.sin(math.pi / 4), 9);
	});

	it("a fan spreads its chords over facing +- halfAngle, symmetric about the facing", () => {
		const half = 0.9;
		const r = ring({ segments: 6, dirX: 0, dirZ: 1, halfAngleRad: half, radius: 1.2 });
		const facing = math.pi / 2;
		const first = waveOneSegmentAngle(r, 0);
		const last = waveOneSegmentAngle(r, 5);
		expect(first).toBeCloseTo(facing - half + half / 6, 9);
		expect(last).toBeCloseTo(facing + half - half / 6, 9);
		expect(first + last).toBeCloseTo(2 * facing, 9);
		// Every chord inside the fan.
		for (let i = 0; i < 6; i++) {
			const a = waveOneSegmentAngle(r, i);
			expect(a > facing - half - EPS && a < facing + half + EPS).toBe(true);
		}
		// The fan's chords tile its span: n x the angle step = 2 x half.
		expect(waveOneChordTiles(r)).toBeCloseTo(2 * 1.2 * math.sin(half / 6), 9);
	});

	it("a fan facing -x points its middle chord at pi; no segments or no radius draws nothing", () => {
		const r = ring({ segments: 3, dirX: -1, dirZ: 0, halfAngleRad: 0.5 });
		expect(math.abs(math.cos(waveOneSegmentAngle(r, 1)) + 1)).toBeLessThan(1e-9);
		expect(waveOneChordTiles(ring({ segments: 0 }))).toBe(0);
		expect(waveOneChordTiles(ring({ radius: 0 }))).toBe(0);
		expect(waveOneSegmentAngle(ring({ segments: 0 }), 0)).toBe(0);
	});
});

describe("PinHoldMask (BV11c)", () => {
	it("holds exactly this frame's pinned slots and lets go of the ones that ended", () => {
		const m = new PinHoldMask();
		expect(m.held.size()).toBe(MAX_ACTORS);
		m.update([{ slot: 3 }, { slot: 7 }, { slot: 3 }]);
		expect([m.isHeld(3), m.isHeld(7), m.isHeld(4)]).toEqual([true, true, false]);
		m.update([{ slot: 7 }]);
		expect([m.isHeld(3), m.isHeld(7)]).toEqual([false, true]);
		m.clear();
		expect(m.isHeld(7)).toBe(false);
		let any = false;
		for (const h of m.held) any = any || h;
		expect(any).toBe(false);
	});

	it("ignores slots outside the mask", () => {
		const m = new PinHoldMask(4);
		m.update([{ slot: -1 }, { slot: 4 }, { slot: 2 }]);
		expect([m.isHeld(-1), m.isHeld(4), m.isHeld(2)]).toEqual([false, false, true]);
	});
});

describe("slamNudge (BV11c)", () => {
	it("the view player's slam kicks with the stamp nudge; a teammate's, none, quiet or outside the party: none", () => {
		expect(SIEGE_DRAW.slamNudge).toBe("stamp");
		expect(slamNudge([{ owner: 1 }, { owner: 0 }], 0, 2, false)).toBe("stamp");
		expect(slamNudge([{ owner: 1 }], 0, 2, false)).toBe("none");
		expect(slamNudge([], 0, 1, false)).toBe("none");
		expect(slamNudge([{ owner: 0 }], 0, 1, true)).toBe("none");
		expect(slamNudge([{ owner: 2 }], 2, 2, false)).toBe("none");
	});
});

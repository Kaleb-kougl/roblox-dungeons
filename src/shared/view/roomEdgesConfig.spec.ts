// Room edges' tunables and look (docs/ROOM_EDGES.md RE3): roomEdgeLook's fade clamps, the live pulse (range, motion
// scaling) and the plain per-state values; the derived inset.
import { describe, expect, it } from "@rbxts/jest-globals";
import { STUDS_PER_TILE } from "shared/config";
import { ROOM_EDGE_VIEW, RoomEdgeState, roomEdgeInsetTiles, roomEdgeLook, type RoomEdgeLook } from "shared/view";

const STATES: ReadonlyArray<RoomEdgeState> = [RoomEdgeState.SAFE, RoomEdgeState.WAITING, RoomEdgeState.LIVE];
const AMOUNT = ROOM_EDGE_VIEW.livePulse.amount;
const PERIOD = ROOM_EDGE_VIEW.livePulse.periodSeconds;

describe("ROOM_EDGE_VIEW", () => {
	it("one transparency and one colour role per state, in RoomEdgeState order", () => {
		expect(ROOM_EDGE_VIEW.transparency.size()).toBe(STATES.size());
		expect(ROOM_EDGE_VIEW.transparency[RoomEdgeState.SAFE]).toBe(0.55);
		expect(ROOM_EDGE_VIEW.transparency[RoomEdgeState.WAITING]).toBe(0.15);
		expect(ROOM_EDGE_VIEW.transparency[RoomEdgeState.LIVE]).toBe(0);
		expect([...ROOM_EDGE_VIEW.roles]).toEqual(["roomEdge.safe", "roomEdge.waiting", "roomEdge.live"]);
		for (const s of STATES) {
			const t = ROOM_EDGE_VIEW.transparency[s];
			expect(t >= 0 && t + AMOUNT <= 1).toBe(true);
		}
	});

	it("the inset puts the dash's inner edge on the room edge", () => {
		expect(roomEdgeInsetTiles()).toBe(ROOM_EDGE_VIEW.dash.width / 2 / STUDS_PER_TILE);
		expect(roomEdgeInsetTiles() * 2 * STUDS_PER_TILE).toBe(ROOM_EDGE_VIEW.dash.width);
	});
});

describe("roomEdgeLook", () => {
	it("from === to gives that state's transparency (motion 0, any fade and time)", () => {
		for (const s of STATES)
			for (const fade of [0, 0.5, 1, 2])
				for (const t of [0, 0.25, 0.5, 3.7]) {
					const look = roomEdgeLook(s, s, fade, t, 0);
					expect(look.transparency).toBe(ROOM_EDGE_VIEW.transparency[s]);
				}
		// with motion, only LIVE pulses
		expect(roomEdgeLook(RoomEdgeState.SAFE, RoomEdgeState.SAFE, 1, PERIOD / 2, 1).transparency).toBe(0.55);
		expect(roomEdgeLook(RoomEdgeState.WAITING, RoomEdgeState.WAITING, 1, PERIOD / 2, 1).transparency).toBe(0.15);
	});

	it("motion 0: no pulse on a live line", () => {
		for (const t of [0, 0.1, 0.25, 0.5, 0.75, 1.3])
			expect(roomEdgeLook(RoomEdgeState.LIVE, RoomEdgeState.LIVE, 1, t, 0).transparency).toBe(0);
	});

	it("the fade clamps to 0..1 and lerps transparency by the mix", () => {
		const below = roomEdgeLook(RoomEdgeState.SAFE, RoomEdgeState.WAITING, -0.5, 0, 1);
		expect(below.mix).toBe(0);
		expect(below.transparency).toBe(0.55);
		const above = roomEdgeLook(RoomEdgeState.SAFE, RoomEdgeState.WAITING, 1.5, 0, 1);
		expect(above.mix).toBe(1);
		expect(above.transparency).toBeCloseTo(0.15, 12);
		const half = roomEdgeLook(RoomEdgeState.SAFE, RoomEdgeState.WAITING, 0.5, 0, 1);
		expect(half.mix).toBe(0.5);
		expect(half.transparency).toBeCloseTo(0.35, 12);
		// fading out of live: no pulse (to is not LIVE)
		expect(roomEdgeLook(RoomEdgeState.LIVE, RoomEdgeState.SAFE, 1, PERIOD / 2, 1).transparency).toBeCloseTo(
			0.55,
			12,
		);
	});

	it("the live pulse stays within [0, amount], peaks mid-period, scales with motion and with the mix", () => {
		let lo = math.huge;
		let hi = -math.huge;
		for (let i = 0; i <= 200; i++) {
			const t = (i / 100) * PERIOD;
			const p = roomEdgeLook(RoomEdgeState.LIVE, RoomEdgeState.LIVE, 1, t, 1).transparency;
			lo = math.min(lo, p);
			hi = math.max(hi, p);
		}
		expect(lo).toBeCloseTo(0, 12);
		expect(hi).toBeCloseTo(AMOUNT, 12);
		expect(lo >= 0 && hi <= AMOUNT + 1e-12).toBe(true);
		expect(roomEdgeLook(RoomEdgeState.LIVE, RoomEdgeState.LIVE, 1, 0, 1).transparency).toBeCloseTo(0, 12);
		expect(roomEdgeLook(RoomEdgeState.LIVE, RoomEdgeState.LIVE, 1, PERIOD / 2, 1).transparency).toBeCloseTo(
			AMOUNT,
			12,
		);
		expect(roomEdgeLook(RoomEdgeState.LIVE, RoomEdgeState.LIVE, 1, PERIOD / 2, 0.5).transparency).toBeCloseTo(
			AMOUNT / 2,
			12,
		);
		// motion is clamped to 0..1
		expect(roomEdgeLook(RoomEdgeState.LIVE, RoomEdgeState.LIVE, 1, PERIOD / 2, 3).transparency).toBeCloseTo(
			AMOUNT,
			12,
		);
		// half way from waiting to live at the pulse's peak: lerp 0.075 + amount / 2
		expect(roomEdgeLook(RoomEdgeState.WAITING, RoomEdgeState.LIVE, 0.5, PERIOD / 2, 1).transparency).toBeCloseTo(
			0.075 + AMOUNT / 2,
			12,
		);
	});

	it("writes into `out` when given; the result is always within 0..1", () => {
		const out: RoomEdgeLook = { mix: -1, transparency: -1 };
		expect(roomEdgeLook(RoomEdgeState.SAFE, RoomEdgeState.LIVE, 0.25, 0.3, 1, out)).toBe(out);
		expect(out.mix).toBe(0.25);
		for (const a of STATES)
			for (const b of STATES)
				for (const fade of [-1, 0, 0.3, 0.7, 1, 4])
					for (const t of [0, 0.2, 0.5, 0.9]) {
						const look = roomEdgeLook(a, b, fade, t, 1, out);
						expect(look.transparency >= 0 && look.transparency <= 1).toBe(true);
						expect(look.mix >= 0 && look.mix <= 1).toBe(true);
					}
	});
});

import { describe, expect, it } from "@rbxts/jest-globals";
import { TILE_SIZE } from "shared/sim";
import { ROOM_CLEAR } from "./roomClearConfig";
import type { RoomClear } from "./roomClears";
import { RoomClearSequence, ScoreRoller, roomClearStyle, type RoomClearLook } from "./roomClearSequence";

const STEP = 1 / 60;

/** A room clear with the RC1 field defaults: bonus 250 (the clear award only), kills 300. */
function makeClear(over: Partial<RoomClear> = {}): RoomClear {
	const base: RoomClear = {
		room: 3,
		rooms: 1,
		perfect: false,
		killPoints: 300,
		clearPoints: 250,
		perfectPoints: 0,
		fastPoints: 0,
		x: 7,
		z: 5,
		slot: 1,
		actorId: 12,
		minX: 0,
		maxX: 10,
		minZ: 0,
		maxZ: 8,
		tick: 4,
	};
	return { ...base, ...over };
}

/** Drives a sequence one frame at a time, as the controller does, and adds up the one-shot cues. */
class Driver {
	readonly seq = new RoomClearSequence();
	now = 0;
	landed = 0;
	ticks = 0;
	bonusLanded = 0;
	chipsStarted = 0;

	/** One frame: `act` runs between beginFrame() and frame(), where the controller calls start / collapse. */
	frame(act?: () => void, dt = STEP): RoomClearLook {
		this.seq.beginFrame();
		if (act !== undefined) act();
		const L = this.seq.frame(dt);
		this.now += dt;
		if (L.landed) this.landed += 1;
		this.ticks += L.ticks;
		this.bonusLanded += L.bonusLanded;
		this.chipsStarted += L.chipsStarted;
		return L;
	}

	/** Frames for `sec` seconds; returns the last frame's look. */
	run(sec: number): RoomClearLook {
		let L = this.seq.look;
		const n = math.floor(sec / STEP + 0.5);
		for (let i = 0; i < n; i++) L = this.frame();
		return L;
	}
}

describe("roomClearStyle", () => {
	it("is always full solo; co-op is full within nearTiles of the room and a chip past it", () => {
		const c = makeClear();
		const m = ROOM_CLEAR.nearTiles * TILE_SIZE;
		expect(roomClearStyle(c, 1000, 1000, true)).toBe("full");
		expect(roomClearStyle(c, 5, 4, false)).toBe("full");
		expect(roomClearStyle(c, c.maxX + m, c.minZ, false)).toBe("full");
		expect(roomClearStyle(c, c.maxX + m + 1, c.minZ, false)).toBe("chip");
		expect(roomClearStyle(c, c.minX - m, c.maxZ, false)).toBe("full");
		expect(roomClearStyle(c, c.minX - m - 1, c.maxZ, false)).toBe("chip");
	});
});

describe("RoomClearSequence timeline", () => {
	it("lands the stamp once, dips and settles, ticks four segments in order and releases the bonus once", () => {
		const d = new Driver();
		const c = makeClear({ perfect: true, perfectPoints: 500, fastPoints: 90 });
		let landedFrame = -1;
		let dipped = false;
		let bonusAt = -1;
		const tickAt: number[] = [];
		let L = d.seq.look;
		for (let n = 1; n <= 100; n++) {
			const landedBefore = d.landed;
			const bonusBefore = d.bonusLanded;
			L = d.frame(n === 1 ? () => d.seq.start(c, "full", 1) : undefined);
			if (d.landed > landedBefore) landedFrame = n;
			if (d.bonusLanded > bonusBefore) bonusAt = d.now;
			for (let k = 0; k < L.ticks; k++) tickAt.push(d.now);
			if (L.stampScale < 1) dipped = true;
		}

		expect(landedFrame).toBe(10);
		expect(d.landed).toBe(1);
		expect(dipped).toBe(true);
		expect(L.stampScale).toBeCloseTo(1.1, 9);

		expect(tickAt.size()).toBe(4);
		for (let i = 0; i < 4; i++) {
			const at = ROOM_CLEAR.tally.startSec + i * ROOM_CLEAR.tally.gapSec;
			expect(tickAt[i] >= at - 1e-9 && tickAt[i] < at + STEP + 1e-9).toBe(true);
		}

		const kinds = ["kills", "clear", "perfect", "fast"];
		const values = [300, 250, 500, 90];
		expect(L.segmentCount).toBe(4);
		for (let i = 0; i < 4; i++) {
			expect(L.segments[i].kind).toBe(kinds[i]);
			expect(L.segments[i].value).toBe(values[i]);
			expect(L.segments[i].shown).toBe(values[i]);
			expect(L.segments[i].started).toBe(true);
		}
		expect(L.total).toBe(1140);

		expect(d.bonusLanded).toBe(840);
		expect(bonusAt >= 1.14 && bonusAt <= 1.17).toBe(true);
		expect(L.active).toBe(false);
	});

	it("leaves out the kills, perfect and fast segments that are zero", () => {
		const d = new Driver();
		d.frame(() => d.seq.start(makeClear({ killPoints: 0 }), "full", 1));
		expect(d.seq.look.segmentCount).toBe(1);
		expect(d.seq.look.segments[0].kind).toBe("clear");

		const e = new Driver();
		e.frame(() => e.seq.start(makeClear({ killPoints: 300, fastPoints: 90 }), "full", 1));
		expect(e.seq.look.segmentCount).toBe(3);
		expect(e.seq.look.segments[0].kind).toBe("kills");
		expect(e.seq.look.segments[1].kind).toBe("clear");
		expect(e.seq.look.segments[2].kind).toBe("fast");
	});

	it("holds the bonus until the fly lands, then nothing is held", () => {
		const d = new Driver();
		d.frame(() => d.seq.start(makeClear(), "full", 1));
		let L = d.run(0.5);
		expect(L.held).toBe(250);
		L = d.run(0.7);
		expect(L.held).toBe(0);
	});

	it("with reduced motion the stamp does not slam, the fly is hidden and the bonus still lands once", () => {
		const plain = new Driver();
		plain.frame(() => plain.seq.start(makeClear(), "full", 0));
		let plainScaleOff = false;
		for (let n = 0; n < 100; n++) {
			if (plain.frame().stampScale !== 1) plainScaleOff = true;
		}
		expect(plainScaleOff).toBe(false);

		const d = new Driver();
		d.frame(() => d.seq.start(makeClear({ perfect: true, perfectPoints: 500 }), "full", 0));
		let flying = false;
		let perfectScaleOff = false;
		for (let n = 0; n < 100; n++) {
			const L = d.frame();
			if (L.flyProgress >= 0) flying = true;
			if (L.stampScale !== 1.1) perfectScaleOff = true;
		}
		expect(flying).toBe(false);
		expect(perfectScaleOff).toBe(false);
		expect(d.bonusLanded).toBe(750);
	});

	it("collapse releases the bonus once, ends the sequence within collapseSec and never lands the stamp again", () => {
		for (const at of [0.05, 0.5, 1.0]) {
			const d = new Driver();
			d.frame(() => d.seq.start(makeClear({ perfect: true, perfectPoints: 500 }), "full", 1));
			d.run(at);
			const landedBefore = d.landed;
			d.frame(() => {
				d.seq.collapse();
				d.seq.collapse();
			});
			let frames = 1;
			let L = d.seq.look;
			while (L.active && frames < 100) {
				L = d.frame();
				frames += 1;
			}
			expect(L.active).toBe(false);
			expect(frames * STEP <= ROOM_CLEAR.collapseSec + 2 * STEP + 1e-9).toBe(true);
			d.run(0.3);
			expect(d.bonusLanded).toBe(750);
			expect(d.landed).toBe(landedBefore);
		}
	});

	it("a second start releases the first bonus at once and runs the second", () => {
		const d = new Driver();
		d.frame(() => d.seq.start(makeClear(), "full", 1));
		d.run(0.5);
		const first = d.frame(() => d.seq.start(makeClear({ killPoints: 100, clearPoints: 400 }), "full", 1));
		expect(first.bonusLanded).toBe(250);
		expect(first.held).toBe(400);
		d.run(2);
		expect(d.bonusLanded).toBe(650);
		expect(d.seq.look.total).toBe(500);
		expect(d.seq.look.segmentCount).toBe(2);
	});

	it("a huge step releases everything exactly once and ends the sequence", () => {
		const d = new Driver();
		d.frame(() => {
			d.seq.start(makeClear({ perfect: true, perfectPoints: 500 }), "full", 1);
			d.seq.start(makeClear({ clearPoints: 300, killPoints: 0 }), "chip", 1);
		}, 5);
		expect(d.bonusLanded).toBe(1050);
		expect(d.seq.look.active).toBe(false);
		d.run(0.5);
		expect(d.bonusLanded).toBe(1050);
	});
});

describe("corner chips", () => {
	it("merges a chip's points once at mergeSec", () => {
		const d = new Driver();
		d.frame(() => d.seq.start(makeClear(), "chip", 1));
		let mergedAt = -1;
		for (let n = 0; n < 70; n++) {
			const before = d.bonusLanded;
			d.frame();
			if (mergedAt < 0 && d.bonusLanded > before) mergedAt = d.now;
		}
		expect(mergedAt >= ROOM_CLEAR.chip.mergeSec - 1e-9 && mergedAt <= ROOM_CLEAR.chip.mergeSec + STEP + 1e-9).toBe(
			true,
		);
		expect(d.bonusLanded).toBe(250);
	});

	it("keeps at most `max` chips: the oldest merges when a third starts, and held counts the rest", () => {
		const d = new Driver();
		d.frame(() => d.seq.start(makeClear({ clearPoints: 100, killPoints: 0 }), "chip", 1));
		d.frame(() => d.seq.start(makeClear({ clearPoints: 200, killPoints: 0 }), "chip", 1));
		const L = d.frame(() => d.seq.start(makeClear({ clearPoints: 400, killPoints: 0 }), "chip", 1));
		expect(ROOM_CLEAR.chip.max).toBe(2);
		expect(d.bonusLanded).toBe(100);
		expect(L.held).toBe(600);
		expect(d.chipsStarted).toBe(3);

		d.run(2);
		for (const ch of d.seq.look.chips) expect(ch.shown).toBe(false);
		expect(d.bonusLanded).toBe(700);
	});

	it("slides in only with motion: under reduced motion the chip stays put", () => {
		const moving = new Driver();
		const first = moving.frame(() => moving.seq.start(makeClear(), "chip", 1));
		expect(first.chips[0].shown).toBe(true);
		expect(first.chips[0].offsetPx > 0).toBe(true);

		const still = new Driver();
		still.frame(() => still.seq.start(makeClear(), "chip", 0));
		let moved = false;
		for (let n = 0; n < 60; n++) {
			const L = still.frame();
			if (L.chips[0].shown && L.chips[0].offsetPx !== 0) moved = true;
		}
		expect(moved).toBe(false);
	});
});

describe("ScoreRoller", () => {
	it("rolls up to trueScore - held over killSec, never shows a held bonus and only shows whole numbers", () => {
		const r = new ScoreRoller();
		r.reset(0);
		let prev = 0;
		let over = false;
		let decreased = false;
		let fractional = false;
		let v = 0;
		for (let n = 0; n < 20; n++) {
			v = r.frame(STEP, 1000, 400, false);
			if (v > 600) over = true;
			if (v < prev) decreased = true;
			if (v % 1 !== 0) fractional = true;
			prev = v;
		}
		expect(over).toBe(false);
		expect(decreased).toBe(false);
		expect(fractional).toBe(false);
		expect(v).toBe(600);
	});

	it("after the bonus lands it reaches the true score within bonusSec", () => {
		const r = new ScoreRoller();
		r.reset(600);
		expect(r.frame(0, 1000, 400, false)).toBe(600);
		let v = r.frame(STEP, 1000, 0, true);
		for (let n = 0; n < 20; n++) v = r.frame(STEP, 1000, 0, false);
		expect(v).toBe(1000);
	});

	it("a lower target (a new run) snaps", () => {
		const r = new ScoreRoller();
		r.reset(0);
		for (let n = 0; n < 30; n++) r.frame(STEP, 1000, 0, false);
		expect(r.frame(STEP, 300, 0, false)).toBe(300);
	});
});

describe("celebration timing", () => {
	it("every phase ends by totalSec", () => {
		expect(ROOM_CLEAR.fly.startSec + ROOM_CLEAR.fly.sec + ROOM_CLEAR.roll.bonusSec <= ROOM_CLEAR.totalSec).toBe(
			true,
		);
		expect(ROOM_CLEAR.chip.mergeSec + ROOM_CLEAR.roll.bonusSec <= ROOM_CLEAR.totalSec).toBe(true);
		expect(ROOM_CLEAR.fadeStartSec < ROOM_CLEAR.totalSec).toBe(true);
	});
});

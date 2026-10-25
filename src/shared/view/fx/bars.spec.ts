// Health bar layout and state, and the damage number pool (port of project-kaleb-vale src/fx/bars/barLayout.test.ts,
// barState.test.ts and src/fx/numbers/numberPool.test.ts @ 42897e2), plus the Roblox placeholder screen size.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	ActorSizeCache,
	BAR_GAP,
	BAR_MIN_WIDTH,
	barGeometry,
	barInnerWidth,
	createBarGeometry,
	drawnSpriteSize,
	pipCount,
	pipLeft,
	placeholderScreenSize,
	segmentWidth,
} from "./bars";
import {
	CHIP_DRAIN,
	CHIP_HOLD,
	FADE_TIME,
	FLASH_TIME,
	HealthBarSlots,
	SHOW_TIME,
	SimClock,
	onDamageAlpha,
} from "./barState";
import {
	CAP_THROTTLE,
	DamageNumberPool,
	JITTER_PX,
	MERGE_WINDOW,
	NUMBER_BASE_GAP,
	NUMBER_FADE,
	NUMBER_LIFE,
	NumberStyle,
	POP_TIME,
	RISE_PX,
	RISE_TIME,
	numberAlpha,
	numberBaseY,
	numberRise,
	numberScale,
	numberText,
} from "./numbers";
import { RenderRng } from "./rng";

const size = (fw: number, fh: number, scale: number | undefined, boss = false) =>
	drawnSpriteSize(fw, fh, scale, boss, 40, { w: 0, h: 0 });

describe("drawn sizes", () => {
	it("web rule: scales the frame; height rounds up, width rounds; bosses at least the minimum width", () => {
		expect(size(16, 16, undefined)).toEqual({ w: 16, h: 16 });
		expect(size(16, 16, 1.35)).toEqual({ w: 22, h: 22 });
		expect(size(16, 24, 1)).toEqual({ w: 16, h: 24 });
		expect(size(16, 16, 1, true)).toEqual({ w: 40, h: 40 });
		expect(size(48, 48, 1.25, true)).toEqual({ w: 60, h: 60 });
	});

	it("a placeholder's screen size: widest side across, top edge height through the iso pitch", () => {
		const pitch = math.rad(55);
		const out = { w: 0, h: 0 };
		// A 4x4x4 stud block at 0.25 studs per px: 16 px wide, 4 cos55 + 2 sin55 studs high = 15.73 -> 16 px.
		expect(placeholderScreenSize([4, 4, 4], 1, pitch, 0.25, out)).toEqual({ w: 16, h: 16 });
		// Scale doubles both.
		expect(placeholderScreenSize([4, 4, 4], 2, pitch, 0.25, out)).toEqual({ w: 32, h: 32 });
		// A flat 2x0.5x2 slab is short.
		expect(placeholderScreenSize([2, 0.5, 2], 1, pitch, 0.25, out).h).toBe(5);
	});

	it("the size cache resolves each kind once and falls back for unknown kinds", () => {
		let calls = 0;
		const cache = new ActorSizeCache((kind) => {
			calls++;
			if (kind === 9) error("unknown");
			return { w: kind === 1 ? 22 : 16, h: 16, boss: false };
		});
		expect(cache.get(1)).toMatchObject({ w: 22, h: 16 });
		expect(cache.get(1)).toBe(cache.get(1));
		expect(cache.get(9)).toMatchObject({ w: 16, h: 16, boss: false });
		expect(cache.get(-1)).toMatchObject({ w: 16, h: 16 });
		expect(calls).toBe(2);
	});
});

describe("bar layout", () => {
	it("bar width follows the drawn sprite width (even, min 10)", () => {
		expect(barInnerWidth(16)).toBe(12);
		expect(barInnerWidth(22)).toBe(16);
		expect(barInnerWidth(8)).toBe(BAR_MIN_WIDTH);
		expect(barInnerWidth(60)).toBe(46);
		for (const w of [8, 13, 16, 22, 31]) expect(barInnerWidth(w) % 2).toBe(0);
	});

	it("places a centred plate with a 1 px outline BAR_GAP px above the sprite top", () => {
		const g = barGeometry(16, 16, 10, createBarGeometry());
		expect(g.pips).toBe(0);
		expect(g.innerW).toBe(12);
		expect(g.innerLeft).toBe(-6);
		expect([g.plateLeft, g.plateW, g.plateH]).toEqual([-7, 14, 4]);
		expect(g.plateBottom).toBe(16 + BAR_GAP);
		expect(g.innerBottom).toBe(g.plateBottom + 1);
		expect(g.top).toBe(g.plateBottom + 4);
		expect(g.plateLeft + g.plateW).toBe(-g.plateLeft);
	});

	it("uses pips for hpMax <= 4", () => {
		expect([1, 2, 3, 4, 5, 10, 0].map(pipCount)).toEqual([1, 2, 3, 4, 0, 0, 0]);
		const two = barGeometry(16, 16, 2, createBarGeometry());
		expect([two.pips, two.pipW, two.innerW]).toEqual([2, 3, 7]);
		expect([pipLeft(two, 0), pipLeft(two, 1)]).toEqual([-3, 1]);
		const four = barGeometry(16, 16, 4, createBarGeometry());
		expect([four.pips, four.pipW, four.innerW]).toEqual([4, 2, 11]);
		expect([0, 1, 2, 3].map((i) => pipLeft(four, i))).toEqual([-5, -2, 1, 4]);
		expect(pipLeft(four, 3) + four.pipW).toBe(four.innerLeft + four.innerW);
		expect(four.plateLeft + four.plateW).toBe(four.innerLeft + four.innerW + 1);
	});

	it("segment widths are whole pixels, at least 1 px for any hp left", () => {
		expect(segmentWidth(12, 10, 10)).toBe(12);
		expect(segmentWidth(12, 5, 10)).toBe(6);
		expect(segmentWidth(12, 0.1, 10)).toBe(1);
		expect(segmentWidth(12, 0, 10)).toBe(0);
		expect(segmentWidth(12, 15, 10)).toBe(12);
		expect(segmentWidth(12, 5, 0)).toBe(0);
	});
});

const fresh = () => {
	const s = new HealthBarSlots(4);
	s.adopt(0, 7, 10, 10, true, false);
	return s;
};

describe("chip trail", () => {
	it("fill drops at once; chip holds, then drains linearly to the fill", () => {
		const s = fresh();
		s.hit(0, 7, 4, 6, 10, 1, false);
		expect(s.hp[0]).toBe(6);
		expect(s.chip(0, 1)).toBe(10);
		expect(s.chip(0, 1 + CHIP_HOLD - 0.01)).toBe(10);
		expect(s.chip(0, 1 + CHIP_HOLD + CHIP_DRAIN / 2)).toBeCloseTo(8);
		expect(s.chip(0, 1 + CHIP_HOLD + CHIP_DRAIN)).toBe(6);
		expect(s.chip(0, 5)).toBe(6);
	});

	it("a hit while the chip is up keeps the chip where it is and restarts the hold", () => {
		const s = fresh();
		s.hit(0, 7, 2, 8, 10, 1, false);
		const mid = 1 + CHIP_HOLD + CHIP_DRAIN / 2; // chip at 9
		s.hit(0, 7, 2, 6, 10, mid, false);
		expect(s.chip(0, mid)).toBeCloseTo(9);
		expect(s.chip(0, mid + CHIP_HOLD - 0.01)).toBeCloseTo(9);
		expect(s.chip(0, mid + CHIP_HOLD + CHIP_DRAIN)).toBe(6);
		s.hit(0, 7, 1, 5, 10, 10, false);
		expect(s.chip(0, 10)).toBe(6);
	});

	it("adopts an unknown actor from the hit (hp before = after + damage); a new id resets the slot", () => {
		const s = new HealthBarSlots(2);
		s.hit(1, 3, 2, 8, 10, 0, true);
		expect([s.id[1], s.chip(1, 0), s.hp[1], s.elite[1]]).toEqual([3, 10, 8, 1]);
		s.adopt(1, 4, 12, 12, true, false);
		expect([s.chip(1, 0), s.hp[1]]).toEqual([12, 12]);
		expect(s.lastHit[1]).toBe(-math.huge);
	});

	it("heal moves fill and chip up at once", () => {
		const s = fresh();
		s.hit(0, 7, 4, 6, 10, 0, false);
		s.heal(0, 10);
		expect([s.hp[0], s.chip(0, 0)]).toEqual([10, 10]);
	});

	it("flash lasts FLASH_TIME; shake is 1 px for a few frames and off under reducedMotion", () => {
		const s = fresh();
		expect(s.flashing(0, 0)).toBe(false);
		s.hit(0, 7, 1, 9, 10, 2, false);
		expect(s.flashing(0, 2)).toBe(true);
		expect(s.flashing(0, 2 + FLASH_TIME * 0.9)).toBe(true);
		expect(s.flashing(0, 2 + FLASH_TIME)).toBe(false);
		expect([0, 1, 2, 3, 4, 5].map((f) => s.shake(0, 2 + f / 60, 1))).toEqual([1, -1, 1, -1, 0, 0]);
		expect([0, 1, 2, 3].map((f) => s.shake(0, 2 + f / 60, 0))).toEqual([0, 0, 0, 0]);
	});
});

describe("bar visibility", () => {
	it("'off' never shows; 'always' shows living actors from the start", () => {
		const s = fresh();
		expect(s.visibility(0, "off", 0)).toBe(0);
		expect(s.visibility(0, "always", 0)).toBe(1);
		s.hit(0, 7, 1, 9, 10, 0, false);
		expect(s.visibility(0, "off", 0)).toBe(0);
		expect(s.visibility(0, "always", 100)).toBe(1);
	});

	it("'onDamage': hidden until the first hit, shown SHOW_TIME after the last hit, then fades over FADE_TIME", () => {
		const s = fresh();
		expect(s.visibility(0, "onDamage", 0)).toBe(0);
		s.hit(0, 7, 1, 9, 10, 1, false);
		expect(s.visibility(0, "onDamage", 1)).toBe(1);
		expect(s.visibility(0, "onDamage", 1 + SHOW_TIME - 0.01)).toBe(1);
		expect(s.visibility(0, "onDamage", 1 + SHOW_TIME + FADE_TIME / 2)).toBeCloseTo(0.5);
		expect(s.visibility(0, "onDamage", 1 + SHOW_TIME + FADE_TIME)).toBe(0);
		s.hit(0, 7, 1, 8, 10, 2.5, false);
		expect(s.visibility(0, "onDamage", 2.5 + SHOW_TIME - 0.01)).toBe(1);
		expect(onDamageAlpha(math.huge)).toBe(0);
		expect(onDamageAlpha(-1)).toBe(0);
	});

	it("dead actors keep the bar only while the chip drains to 0, in every mode but off", () => {
		for (const mode of ["always", "onDamage"] as const) {
			const s = fresh();
			s.hit(0, 7, 10, 0, 10, 1, false);
			s.kill(0, 7);
			expect(s.alive[0]).toBe(0);
			expect(s.visibility(0, mode, 1)).toBe(1);
			expect(s.visibility(0, mode, 1 + CHIP_HOLD + CHIP_DRAIN / 2)).toBe(1);
			expect(s.visibility(0, mode, 1 + CHIP_HOLD + CHIP_DRAIN)).toBe(0);
			expect(s.visibility(0, "off", 1)).toBe(0);
		}
	});

	it("kill for another actor id is ignored; clear / release forget slots", () => {
		const s = fresh();
		s.kill(0, 99);
		expect(s.alive[0]).toBe(1);
		s.release(0);
		expect(s.visibility(0, "always", 0)).toBe(0);
		s.adopt(0, 7, 10, 10, true, false);
		s.clear();
		expect(s.id[0]).toBe(0);
	});
});

describe("sim clock", () => {
	it("is (tick + alpha) / 60, monotonic within a run, restarts when the tick goes back", () => {
		const c = new SimClock();
		expect(c.update(60, 0)).toBe(1);
		expect(c.update(60, 0.5)).toBeCloseTo(1 + 0.5 / 60);
		expect(c.update(60, 0)).toBeCloseTo(1 + 0.5 / 60);
		expect(c.update(61, 0)).toBeCloseTo(61 / 60);
		expect(c.update(0, 0)).toBe(0);
		c.update(120, 0);
		c.reset();
		expect(c.update(6, 0)).toBeCloseTo(0.1);
	});
});

describe("damage numbers", () => {
	it("hits on the same actor within MERGE_WINDOW of the last hit add up and re-pop", () => {
		const p = new DamageNumberPool(8, 1);
		const a = p.hit(3, 10, 0, 0, 1, false, 17, 1, 1);
		const b = p.hit(3, 10, 0.5, 0, 1, false, 17, 1 + MERGE_WINDOW * 0.9, 1);
		expect(b).toBe(a);
		expect(p.value[a]).toBe(2);
		expect(p.born[a]).toBeCloseTo(1 + MERGE_WINDOW * 0.9);
		expect(p.x[a]).toBe(0.5);
		let t = 1 + MERGE_WINDOW * 0.9;
		for (let k = 0; k < 5; k++) {
			t += MERGE_WINDOW * 0.8;
			expect(p.hit(3, 10, 0, 0, 1, false, 17, t, 1)).toBe(a);
		}
		expect(p.value[a]).toBe(7);
		expect(p.count()).toBe(1);
	});

	it("a gap longer than the window, another actor id, or another style spawns a new number", () => {
		const p = new DamageNumberPool(8, 1);
		const a = p.hit(3, 10, 0, 0, 1, false, 17, 1, 1);
		expect(p.hit(3, 10, 0, 0, 1, false, 17, 1 + MERGE_WINDOW + 0.01, 1)).never.toBe(a);
		const c = p.hit(3, 11, 0, 0, 1, false, 17, 2, 1);
		expect(p.hit(4, 11, 0, 0, 1, false, 17, 2, 1)).never.toBe(c);
		const heavy = p.hit(3, 11, 0, 0, 4, true, 17, 2.05, 1);
		expect(heavy).never.toBe(c);
		expect(p.style[heavy]).toBe(NumberStyle.HEAVY);
		expect(p.value[c]).toBe(1);
		expect(p.hit(3, 11, 0, 0, 4, true, 17, 2.1, 1)).toBe(heavy);
		expect(p.value[heavy]).toBe(8);
	});

	it("jitter is a whole number within +-JITTER_PX, and 0 under reducedMotion", () => {
		const p = new DamageNumberPool(64, 42);
		const seen = new Set<number>();
		for (let k = 0; k < 64; k++) {
			const i = p.hit(k, k + 1, 0, 0, 1, false, 17, 0, 1);
			expect(p.dx[i]).toBe(math.floor(p.dx[i]));
			expect(math.abs(p.dx[i])).toBeLessThanOrEqual(JITTER_PX);
			seen.add(p.dx[i]);
		}
		expect(seen.size()).toBeGreaterThan(4);
		const q = new DamageNumberPool(4, 42);
		expect(q.dx[q.hit(0, 1, 0, 0, 1, false, 17, 0, 0)]).toBe(0);
		const r = new RenderRng(5);
		for (let k = 0; k < 1000; k++) {
			const v = r.int(4);
			expect(v >= -4 && v <= 4).toBe(true);
		}
	});

	it("drops the oldest (least recently popped) number when full", () => {
		const p = new DamageNumberPool(3, 1);
		const n0 = p.hit(0, 1, 0, 0, 1, false, 0, 0.0, 1);
		p.hit(1, 2, 0, 0, 1, false, 0, 0.1, 1);
		const n2 = p.hit(2, 3, 0, 0, 1, false, 0, 0.2, 1);
		p.hit(0, 1, 0, 0, 1, false, 0, 0.21, 1); // re-pops n0: now n1 is the oldest
		const n3 = p.hit(3, 4, 0, 0, 5, false, 0, 0.3, 1);
		expect(n3).toBe(1);
		expect([p.actorId[n0], p.actorId[n2], p.actorId[n3]]).toEqual([1, 3, 4]);
		expect(p.value[n3]).toBe(5);
		expect(p.overflowed).toBe(1);
		expect(p.count()).toBe(3);
	});

	it("expires numbers after NUMBER_LIFE; clear empties it", () => {
		const p = new DamageNumberPool(4, 1);
		p.hit(0, 1, 0, 0, 1, false, 0, 0, 1);
		p.hit(1, 2, 0, 0, 1, false, 0, 0.5, 1);
		p.expire(NUMBER_LIFE - 0.01);
		expect(p.count()).toBe(2);
		p.expire(NUMBER_LIFE);
		expect(p.count()).toBe(1);
		p.clear();
		expect(p.count()).toBe(0);
	});

	it("shows a CAP tag at most once per CAP_THROTTLE", () => {
		const p = new DamageNumberPool(8, 1);
		const a = p.cap(0, 1, 0, 0, 32, 48, 1);
		expect(a >= 0).toBe(true);
		expect(p.style[a]).toBe(NumberStyle.CAP);
		expect([p.dx[a], p.dy[a]]).toEqual([32, 48]);
		expect(p.cap(0, 1, 0, 0, 32, 48, 1 + CAP_THROTTLE * 0.5)).toBe(-1);
		expect(p.cap(0, 1, 0, 0, 32, 48, 1 + CAP_THROTTLE * 0.99)).toBe(-1);
		expect(p.cap(0, 1, 0, 0, 32, 48, 1 + CAP_THROTTLE) >= 0).toBe(true);
		expect(p.count()).toBe(2);
		expect(p.hit(0, 1, 0, 0, 1, false, 0, 1 + CAP_THROTTLE, 1)).never.toBe(a);
		p.clear();
		expect(p.cap(0, 1, 0, 0, 0, 0, 1 + CAP_THROTTLE) >= 0).toBe(true);
	});

	it("rise: ease-out to RISE_PX over RISE_TIME in whole pixels; none under reducedMotion", () => {
		expect(numberRise(0, 1)).toBe(0);
		expect(numberRise(RISE_TIME, 1)).toBe(RISE_PX);
		expect(numberRise(NUMBER_LIFE, 1)).toBe(RISE_PX);
		expect(numberRise(RISE_TIME / 2, 1)).toBeGreaterThan(RISE_PX / 2);
		let last = 0;
		for (let f = 0; f <= 36; f++) {
			const r = numberRise(f / 60, 1);
			expect(r).toBe(math.floor(r));
			expect(r >= last).toBe(true);
			last = r;
		}
		expect(numberRise(RISE_TIME / 2, 0)).toBe(0);
	});

	it("alpha: opaque, then fades over the last NUMBER_FADE; scale pops normal numbers only", () => {
		expect(numberAlpha(0)).toBe(1);
		expect(numberAlpha(NUMBER_LIFE - NUMBER_FADE)).toBe(1);
		expect(numberAlpha(NUMBER_LIFE - NUMBER_FADE / 2)).toBeCloseTo(0.5);
		expect(numberAlpha(NUMBER_LIFE)).toBe(0);
		expect([0, 1, 2].map((f) => numberScale(NumberStyle.NORMAL, f / 60, 1))).toEqual([2, 2, 2]);
		expect(numberScale(NumberStyle.NORMAL, POP_TIME, 1)).toBe(1);
		expect(numberScale(NumberStyle.HEAVY, 0, 1)).toBe(2);
		expect(numberScale(NumberStyle.HEAVY, POP_TIME, 1)).toBe(2);
		expect(numberScale(NumberStyle.HEAVY, 0, 0)).toBe(2);
		expect(numberScale(NumberStyle.NORMAL, 0, 0)).toBe(1);
		expect(numberScale(NumberStyle.CAP, 0, 1)).toBe(1);
	});

	it("placement and text: just over the bar; boss numbers low on the body; whole values without decimals", () => {
		expect(numberBaseY(16, false)).toBe(16 + NUMBER_BASE_GAP);
		expect(NUMBER_BASE_GAP).toBe(7);
		expect(numberBaseY(60, true)).toBe(18);
		expect(numberText(NumberStyle.NORMAL, 6, "CAP")).toBe("6");
		expect(numberText(NumberStyle.NORMAL, 2.5, "CAP")).toBe("2.5");
		expect(numberText(NumberStyle.CAP, 0, "CAP")).toBe("CAP");
	});
});

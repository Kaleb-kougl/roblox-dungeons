// Score pops (M2): the pool (round-robin reuse, expiry, clear) and the fade / rise curves; Gold Rush's tone (BU6).
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	SCORE_POP_FADE,
	SCORE_POP_LIFE,
	SCORE_POP_RISE_PX,
	SCORE_POP_RISE_TIME,
	ScorePopPool,
	ScorePopTone,
	scorePopAlpha,
	scorePopRise,
	scorePopTones,
} from ".";

describe("score pops", () => {
	it("reuse the oldest slot when full, expire after their life, clear", () => {
		const pool = new ScorePopPool(3);
		expect([pool.add(1, 2, 50, 0), pool.add(0, 0, 100, 0.1), pool.add(0, 0, 200, 0.2)]).toEqual([0, 1, 2]);
		expect(pool.add(5, 6, 150, 0.3)).toBe(0);
		expect([pool.x[0], pool.z[0], pool.points[0], pool.born[0]]).toEqual([5, 6, 150, 0.3]);
		expect(pool.liveCount()).toBe(3);
		pool.expire(0.1 + SCORE_POP_LIFE);
		expect(pool.live).toEqual([1, 0, 1]);
		pool.clear();
		expect(pool.liveCount()).toBe(0);
		expect(pool.add(0, 0, 1, 0)).toBe(0);
	});

	it("fade over the end of their life and rise with an ease-out (none under reduced motion)", () => {
		expect(scorePopAlpha(0)).toBe(1);
		expect(scorePopAlpha(SCORE_POP_LIFE - SCORE_POP_FADE)).toBe(1);
		expect(scorePopAlpha(SCORE_POP_LIFE - SCORE_POP_FADE / 2)).toBeCloseTo(0.5);
		expect(scorePopAlpha(SCORE_POP_LIFE)).toBe(0);
		expect(scorePopAlpha(-1)).toBe(0);
		expect(scorePopRise(0, 1)).toBe(0);
		expect(scorePopRise(SCORE_POP_RISE_TIME, 1)).toBe(SCORE_POP_RISE_PX);
		expect(scorePopRise(SCORE_POP_RISE_TIME / 2, 1)).toBe(math.round(SCORE_POP_RISE_PX * 0.75));
		expect(scorePopRise(SCORE_POP_RISE_TIME, 0)).toBe(0);
	});

	it("a pop keeps its tone (KILL by default) until its slot is reused", () => {
		const pool = new ScorePopPool(2);
		pool.add(0, 0, 10, 0);
		pool.add(1, 1, 20, 0, ScorePopTone.GOLD_RUSH);
		expect([pool.tone[0], pool.tone[1]]).toEqual([ScorePopTone.KILL, ScorePopTone.GOLD_RUSH]);
		pool.add(2, 2, 30, 0.1);
		expect(pool.tone[0]).toBe(ScorePopTone.KILL);
		pool.add(3, 3, 40, 0.1);
		expect(pool.tone[1]).toBe(ScorePopTone.KILL);
	});

	it("Gold Rush tones: a kill pop matching a Gold Rush record (x, z, points) is GOLD_RUSH, each record once", () => {
		const out: ScorePopTone[] = [ScorePopTone.GOLD_RUSH];
		const pops = [
			{ x: 1, z: 2, points: 206 },
			{ x: 1, z: 2, points: 50 }, // same spot, other points: a plain kill
			{ x: 3, z: 4, points: 90 },
			{ x: 3, z: 4, points: 90 }, // two equal kills, one Gold Rush record: only the first
		];
		const gold = [
			{ x: 3, z: 4, amount: 90 },
			{ x: 1, z: 2, amount: 206 },
		];
		expect(scorePopTones(pops, gold, out)).toBe(out);
		expect(out).toEqual([ScorePopTone.GOLD_RUSH, ScorePopTone.KILL, ScorePopTone.GOLD_RUSH, ScorePopTone.KILL]);
		// No Gold Rush (every run without the duo): every pop is a kill pop; the scratch resets.
		expect(scorePopTones(pops, [], out)).toEqual([0, 0, 0, 0]);
		expect(scorePopTones([], gold, out)).toEqual([]);
	});
});

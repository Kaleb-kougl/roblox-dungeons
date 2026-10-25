// Score pops (M2): the pool (round-robin reuse, expiry, clear) and the fade / rise curves.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	SCORE_POP_FADE,
	SCORE_POP_LIFE,
	SCORE_POP_RISE_PX,
	SCORE_POP_RISE_TIME,
	ScorePopPool,
	scorePopAlpha,
	scorePopRise,
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
});

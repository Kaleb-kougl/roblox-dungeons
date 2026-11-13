// Elite affix census, shard 2 of 4 (docs/ENEMY_VARIANTS.md EV6, EVD7): run seeds split over four files so each runs in
// its own process (the 1200 Forge floors ran past three minutes as one file); the census and its gates are
// shared/dungeon/testing affixCensus.ts, the same in every shard.
import { describe, expect, it } from "@rbxts/jest-globals";
import { AFFIX_CENSUS, affixCensus, affixCensusLines, affixCensusProblems, censusShard } from "shared/dungeon/testing";

const [FIRST, LAST] = censusShard(2, AFFIX_CENSUS.shards, AFFIX_CENSUS.runs);

describe(`affix census, shard 2 (run seeds ${FIRST}-${LAST} x floors 1-${AFFIX_CENSUS.floors}, solo)`, () => {
	it("elite / combat shares hold, never on excluded kinds or below unlock floors (printed)", () => {
		const c = affixCensus(FIRST, LAST);
		const runs = LAST - FIRST + 1;
		for (const line of affixCensusLines(c, runs)) print(line);
		expect(c.floors).toBe(runs * AFFIX_CENSUS.floors);
		expect(affixCensusProblems(c, runs)).toEqual([]);
	});
});

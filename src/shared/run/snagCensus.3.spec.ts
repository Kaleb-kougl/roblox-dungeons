// Snag census, shard 3 of 3 (docs/WALL_SLIDE.md WS5, docs/ARCHER.md AR4): run seeds split over three files so each runs
// in its own process (30 floors at about 6 s ran past three minutes as one file); the census and its gates are
// shared/run/testing snagCensus.ts, the same in every shard (and per shard, stricter than one gate over all seeds).
import { describe, expect, it } from "@rbxts/jest-globals";
import { censusShard } from "shared/dungeon/testing";
import { SNAG_CENSUS, snagRollCensus, snagWalkCensus } from "shared/run/testing";

const [FIRST, LAST] = censusShard(3, SNAG_CENSUS.shards, SNAG_CENSUS.seeds);

describe(`snag census, shard 3 (WALL_SLIDE.md WS5): seeds ${FIRST}-${LAST}`, () => {
	it("no unexcused pillar stall with the slide, never more than the web mover", () => {
		const c = snagWalkCensus(FIRST, LAST);
		print(c.lines.join("\n"));
		expect(c.problems).toEqual([]);
	});

	it("rolls (docs/ARCHER.md AR4): the Archer's 140 % roll, no unexcused pillar stall with the slide, never more than the web mover", () => {
		const c = snagRollCensus(FIRST, LAST);
		print(c.lines.join("\n"));
		expect(c.problems).toEqual([]);
	});
});

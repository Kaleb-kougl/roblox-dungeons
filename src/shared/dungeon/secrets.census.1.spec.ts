// Secret room census, shard 1 of 4 (docs/SECRET_ROOMS.md SR1, numbers recorded there): opt-in (--census) run seeds
// split over four files so each runs in its own process; without --census a quick sample (the shard's first
// SECRET_CENSUS.quickRuns seeds, floors 2-SECRET_CENSUS.quickLast). The census is shared/dungeon/testing secretCensus.ts.
import { describe, expect, it } from "@rbxts/jest-globals";
import type { Dungeon } from "shared/dungeon";
import {
	SECRET_CENSUS,
	censusShard,
	secretCensus,
	secretCensusLines,
	secretCensusTotals,
} from "shared/dungeon/testing";
import { censusRequested } from "shared/run/testing";

const FULL = censusRequested();
const [FIRST, SHARD_LAST] = censusShard(1, SECRET_CENSUS.shards, SECRET_CENSUS.runs);
const LAST = FULL ? SHARD_LAST : FIRST + SECRET_CENSUS.quickRuns - 1;
const LAST_FLOOR = FULL ? SECRET_CENSUS.last : SECRET_CENSUS.quickLast;

describe(`secret census, shard 1 (run seeds ${FIRST}-${LAST} x floors ${SECRET_CENSUS.first}-${LAST_FLOOR})`, () => {
	it("every chance hit with a candidate holds a secret; the rates (printed)", () => {
		const dungeons = new Map<string, Dungeon>();
		for (const party of SECRET_CENSUS.parties) {
			const c = secretCensus(FIRST, LAST, party, LAST_FLOOR, dungeons);
			for (const line of secretCensusLines(c, "shard 1")) print(line);
			const t = secretCensusTotals(c);
			expect(t.floors).toBe((LAST - FIRST + 1) * (LAST_FLOOR - SECRET_CENSUS.first + 1));
			expect(t.secrets + t.empty).toBe(t.hits);
		}
	});
});

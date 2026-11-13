// Minimap tiles on endless floors, shard 1 of 4 (docs/MINIMAP.md M1): run seeds split over four files so each runs in
// its own process (1200 floors ran past three minutes as one file); the checks are testing/census.ts, the same as
// tiles.spec.ts's real floors.
import { describe, expect, it } from "@rbxts/jest-globals";
import { censusShard } from "shared/dungeon/testing";
import { MINIMAP_VIEW } from "shared/view";
import { MINIMAP_CENSUS, minimapCensus, minimapCensusLine } from "./testing";

const [FIRST, LAST] = censusShard(1, MINIMAP_CENSUS.shards, MINIMAP_CENSUS.runs);

describe("minimapTiles: endless floors, shard 1", () => {
	it(`run seeds ${FIRST}-${LAST} x floors 1-${MINIMAP_CENSUS.floors}: invariants, W x H <= ${MINIMAP_VIEW.maxImageSide}, the stairwell on its room`, () => {
		const started = os.clock();
		const c = minimapCensus(FIRST, LAST);
		print(minimapCensusLine(c, os.clock() - started));
		expect(c.floors).toBe((LAST - FIRST + 1) * MINIMAP_CENSUS.floors);
	});
});

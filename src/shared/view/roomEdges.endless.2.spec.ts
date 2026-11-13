// Room edges on endless floors, shard 2 of 4 (docs/ROOM_EDGES.md RE1): run seeds split over four files so each runs
// in its own process (1200 floors ran past three minutes as one file); the checks are testing/roomEdgesCensus.ts,
// the same as roomEdges.spec.ts's real floors.
import { describe, expect, it } from "@rbxts/jest-globals";
import { censusShard } from "shared/dungeon/testing";
import { ROOM_EDGES_CENSUS, roomEdgesCensus, roomEdgesCensusLine } from "./testing";

const [FIRST, LAST] = censusShard(2, ROOM_EDGES_CENSUS.shards, ROOM_EDGES_CENSUS.runs);

describe("roomEdges: endless floors, shard 2", () => {
	it(`run seeds ${FIRST}-${LAST} x floors 1-${ROOM_EDGES_CENSUS.floors}: parity, completeness, dashes <= maxDashes`, () => {
		const started = os.clock();
		const c = roomEdgesCensus(FIRST, LAST);
		print(roomEdgesCensusLine(c, os.clock() - started));
		expect(c.floors).toBe((LAST - FIRST + 1) * ROOM_EDGES_CENSUS.floors);
	});
});

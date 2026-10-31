// Endless room pool census for a party of 4 (docs/ENEMY_VARIANTS.md EV5): floors 1-20, run seeds 1-15 (a smaller
// sample than the solo census in roomPool.census.spec.ts). The bigger budget buys more imps and oozes but never a
// second summoner in a room; no kind before its floor; every wide body on an open tile. Seeded rosters (docs/DAILY.md
// DS1): every spawn is a kind of its run's roster and every roster follows the rules. A roster of only cheap kinds
// (no cost-3 kind yet) cannot spend a big party budget once the actor cap binds: the `cap-bound` and `cheap rosters`
// columns call those rooms out (docs/DAILY.md "Known side effect"). Printed.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	censusHeader,
	censusViolations,
	formatCensusRow,
	formatRosterRow,
	poolCensus,
	rosterHeader,
} from "shared/dungeon/testing";

describe("endless room pool census, party 4 (floors 1-20, run seeds 1-15)", () => {
	it("rosters hold, no kind before its floor, at most one summoner per room (printed)", () => {
		const rows = poolCensus(1, 20, 1, 15, 4);
		print(`[pool census] party 4, run seeds 1-15, means per populated room`);
		print(`[pool census] ${censusHeader()}`);
		for (const row of rows) print(`[pool census] ${formatCensusRow(row)}`);
		print(`[pool census] party 4, run seeds 1-15, share of runs whose roster holds the kind`);
		print(`[pool census] ${rosterHeader()}`);
		for (const row of rows) print(`[pool census] ${formatRosterRow(row)}`);
		expect(censusViolations(rows, false)).toEqual([]);
	});
});

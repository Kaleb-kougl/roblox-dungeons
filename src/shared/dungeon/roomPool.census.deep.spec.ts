// Endless room pool census, floors 11-20 (docs/ENEMY_VARIANTS.md EV5): run seeds 1-60, solo; see
// roomPool.census.spec.ts (floors 1-10). Every roster is full from floor 9 on (docs/DAILY.md DS1), so every kind is
// placed on every floor here. Printed: the rest of the doc's tables.
import { describe, expect, it } from "@rbxts/jest-globals";
import { ENDLESS_ROOM_KINDS } from "shared/dungeon";
import { censusViolations, formatCensusRow, formatRosterRow, poolCensus } from "shared/dungeon/testing";

describe("endless room pool census, floors 11-20 (run seeds 1-60, solo)", () => {
	it("full rosters, every kind on every floor, at most one summoner per room (printed)", () => {
		const rows = poolCensus(11, 20, 1, 60, 1);
		for (const row of rows) print(`[pool census] ${formatCensusRow(row)}`);
		for (const row of rows) print(`[pool census] ${formatRosterRow(row)}`);
		for (const row of rows)
			expect([row.floor, row.rosterRuns]).toEqual([row.floor, ENDLESS_ROOM_KINDS.map(() => 60)]);
		expect(censusViolations(rows, true)).toEqual([]);
	});
});

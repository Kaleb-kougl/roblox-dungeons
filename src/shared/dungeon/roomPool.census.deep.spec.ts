// Endless room pool census, floors 11-20 (docs/ENEMY_VARIANTS.md EV5): run seeds 1-60, solo; see
// roomPool.census.spec.ts (floors 1-10). Every roster is full from floor 19 on (docs/DAILY.md DS1; floor 9 before the
// docs/NEW_ENEMIES.md kinds doubled the seeded kinds, NED11), so every kind some run's roster holds is placed and on
// floors 19-20 every kind is in every roster. Printed: the rest of the doc's tables.
import { describe, expect, it } from "@rbxts/jest-globals";
import { ENDLESS_ROOM_KINDS } from "shared/dungeon";
import { censusViolations, formatCensusRow, formatRosterRow, poolCensus } from "shared/dungeon/testing";

/** 10 seeded kinds, one more every 2 floors from floor 1: every roster is full here. */
const FULL_ROSTER_FLOOR = 19;

describe("endless room pool census, floors 11-20 (run seeds 1-60, solo)", () => {
	it("full rosters from floor 19, every roster kind placed, at most one summoner per room (printed)", () => {
		const rows = poolCensus(11, 20, 1, 60, 1);
		for (const row of rows) print(`[pool census] ${formatCensusRow(row)}`);
		for (const row of rows) print(`[pool census] ${formatRosterRow(row)}`);
		for (const row of rows)
			if (row.floor >= FULL_ROSTER_FLOOR)
				expect([row.floor, row.rosterRuns]).toEqual([row.floor, ENDLESS_ROOM_KINDS.map(() => 60)]);
		expect(censusViolations(rows, true)).toEqual([]);
	});
});

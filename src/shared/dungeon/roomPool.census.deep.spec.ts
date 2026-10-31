// Endless room pool census, floors 11-20 (docs/ENEMY_VARIANTS.md EV5): run seeds 1-60, solo; see
// roomPool.census.spec.ts (floors 1-10). Printed: the rest of the doc's table.
import { describe, expect, it } from "@rbxts/jest-globals";
import { censusViolations, formatCensusRow, poolCensus } from "shared/dungeon/testing";

describe("endless room pool census, floors 11-20 (run seeds 1-60, solo)", () => {
	it("every kind on every floor, at most one summoner per room (printed)", () => {
		const rows = poolCensus(11, 20, 1, 60, 1);
		for (const row of rows) print(`[pool census] ${formatCensusRow(row)}`);
		expect(censusViolations(rows, true)).toEqual([]);
	});
});

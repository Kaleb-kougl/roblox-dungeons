// Endless room pool census, floors 1-10 (docs/ENEMY_VARIANTS.md EV5): run seeds 1-60, solo. Mean enemies per room by
// kind, budget spent, the most summoners in a room, the affixed share; no kind before its unlock floor, every kind from
// it on, at most one summoner per room, every wide body on an open tile. Printed: the table in the doc. Floors 11-20
// and the party sample are in their own files (each Forge floor takes about a tenth of a second headless).
import { describe, expect, it } from "@rbxts/jest-globals";
import { censusHeader, censusViolations, formatCensusRow, poolCensus } from "shared/dungeon/testing";

describe("endless room pool census, floors 1-10 (run seeds 1-60, solo)", () => {
	it("no kind before its floor, every kind from it, at most one summoner per room (printed)", () => {
		const rows = poolCensus(1, 10, 1, 60, 1);
		print(`[pool census] solo, run seeds 1-60, means per populated room`);
		print(`[pool census] ${censusHeader()}`);
		for (const row of rows) print(`[pool census] ${formatCensusRow(row)}`);
		expect(censusViolations(rows, true)).toEqual([]);
	});
});

// Endless room pool census, floors 1-10 (docs/ENEMY_VARIANTS.md EV5): run seeds 1-60, solo. Mean enemies per room by
// kind, budget spent, the most summoners in a room, the affixed share; no kind before its unlock floor, at most one
// summoner per room, every wide body on an open tile. Seeded rosters (docs/DAILY.md DS1): every floor spends with its
// run's roster, so each spawn is a kind of that roster, each roster follows the rules (swarmers + the floor's number
// of seeded kinds, none before its floor, none ever dropped) and every kind some run's roster holds on a floor is
// placed there (before the roster: every kind on every floor from its unlock floor on). Printed: the census and the
// roster tables in the docs. Floors 11-20 and the party sample are in their own files (each Forge floor takes about a
// tenth of a second headless).
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	censusHeader,
	censusViolations,
	formatCensusRow,
	formatRosterRow,
	poolCensus,
	rosterHeader,
} from "shared/dungeon/testing";

describe("endless room pool census, floors 1-10 (run seeds 1-60, solo)", () => {
	it("rosters hold, no kind before its floor, every roster kind placed, at most one summoner per room (printed)", () => {
		const rows = poolCensus(1, 10, 1, 60, 1);
		print(`[pool census] solo, run seeds 1-60, means per populated room`);
		print(`[pool census] ${censusHeader()}`);
		for (const row of rows) print(`[pool census] ${formatCensusRow(row)}`);
		print(`[pool census] solo, run seeds 1-60, share of runs whose roster holds the kind`);
		print(`[pool census] ${rosterHeader()}`);
		for (const row of rows) print(`[pool census] ${formatRosterRow(row)}`);
		expect(censusViolations(rows, true)).toEqual([]);
	});
});

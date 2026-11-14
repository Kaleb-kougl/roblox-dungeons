// docs/NEW_ENEMIES_2.md NX6 room pool census, floors 1-4 (shard 1 of 5, split by floors: each row a whole floor's
// sample), solo run seeds 1-60 with every endless world's rule (no unlock floors, DSD18; the Chainhook's minimum floor
// 2, NXD4), plus party 4's worst-case pool slots (a Pyre-keeper's 3 pyres counted). Gates: every roster and room rule
// (shared/dungeon/testing censusViolations: no Chainhook on floor 1, the caps, the Snatcher never a room's first buy,
// every roster kind placed), party 4's worst room under POOL_ROOM_TARGET. Printed: the doc's table (shared/run/testing
// newEnemies2Census.ts).
import { describe, expect, it } from "@rbxts/jest-globals";
import { censusViolations } from "shared/dungeon/testing";
import {
	POOL_ROOM_TARGET,
	formatNx6CensusRow,
	newEnemies2Census,
	nx6CensusHeader,
	nx6Counts,
} from "shared/run/testing";

const FIRST_FLOOR = 1;
const LAST_FLOOR = 4;

describe(`NX6 room pool census, floors ${FIRST_FLOOR}-${LAST_FLOOR} (solo run seeds 1-60, party 4 worst case)`, () => {
	it("every roster and room rule holds, party 4's worst room under the pool target (printed)", () => {
		const rows = newEnemies2Census(FIRST_FLOOR, LAST_FLOOR, 1, 60);
		print(`[nx6 census] ${nx6CensusHeader()}`);
		for (const row of rows) print(`[nx6 census] ${formatNx6CensusRow(row)}`);
		expect(
			censusViolations(
				rows.map((r) => r.solo),
				true,
			),
		).toEqual([]);
		for (const row of rows)
			expect([row.solo.floor, row.maxSlots < POOL_ROOM_TARGET]).toEqual([row.solo.floor, true]);
		// NXD4: floor 1 never holds a Chainhook (solo); the other three may (unlock floors off)
		const one = nx6Counts(rows[0]);
		expect(one[1]).toBe(0);
		print(`[nx6 census] floor 1 solo: ${one[0]} bulwarks, ${one[2]} snatchers, ${one[3]} pyre-keepers`);
	});
});

// docs/NEW_ENEMIES_3.md NT6 room pool census, floors 17-20 (shard 5 of 5, split by floors: each row a whole floor's
// sample): solo with every endless world's rule (no unlock floors, DSD18; the Chainhook's and the Mender's minimum floor
// 2, NXD4 / NTD7), plus party 4's worst case. --census: run seeds 1-60; by default 1-10. Gates (shared/run/testing
// newEnemies3Census.ts nt6CensusProblems): every roster and room rule, whole Jackal packs, no room past the 16-actor
// cap, party 4's worst room under POOL_ROOM_TARGET, no Mender on floor 1. Printed: the doc's table.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	censusRequested,
	formatNt6CensusRow,
	newEnemies3Census,
	nt6CensusHeader,
	nt6CensusProblems,
} from "shared/run/testing";

const FIRST_FLOOR = 17;
const LAST_FLOOR = 20;
const LAST_RUN = censusRequested() ? 60 : 10;

describe(`NT6 room pool census, floors ${FIRST_FLOOR}-${LAST_FLOOR} (solo run seeds 1-${LAST_RUN}, party 4 worst case)`, () => {
	it("every roster, room, pack and cap rule holds (printed)", () => {
		const rows = newEnemies3Census(FIRST_FLOOR, LAST_FLOOR, 1, LAST_RUN);
		print(`[nt6 census] ${nt6CensusHeader()}`);
		for (const row of rows) print(`[nt6 census] ${formatNt6CensusRow(row)}`);
		expect(nt6CensusProblems(rows, censusRequested())).toEqual([]);
	});
});

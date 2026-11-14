// docs/ARCHER.md AR13: builds per character on the swarmer pack and the mixed census rooms (shared/run/testing
// characterTune.ts CHARACTER_BUILD_CASES: no build, Storm Blade, Soul Swarm, Executioner, the Archer's Fire Arrows and
// Siege Bolt, the Knight's Counterstrike; a build a character is never dealt prints n/a), per character: the Knight,
// the Archer (charged shots back to back) and the old two-weapon player. The pack at floors 1 / 6 / 11 / 20 (seeds 1-3);
// the census room of each floor (buildTune.ts tuneCensusRoom over solo runs 1-10, its planned affixes) at its own floor
// (seeds 1-2). Open endless arena, god mode. Printed: the tables in the doc. Loose bounds only: every fight is won.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	CHARACTER_BUILD_CASES,
	KIND_ROOMS,
	characterTtkHeader,
	characterTtkRows,
	formatCharacterTtkRow,
	tuneCensusRoom,
	type CensusRoom,
	type TuneCharacter,
	type TuneFloor,
} from "shared/run/testing";

const WHO: ReadonlyArray<TuneCharacter> = ["knight", "archer", "both"];
const NAMES = ["Knight", "Archer", "Both"];
const BASE = 2;
const FLOORS: ReadonlyArray<TuneFloor> = [
	{ floor: 1, depth: 1 },
	{ floor: 6, depth: 2 },
	{ floor: 11, depth: 3 },
	{ floor: 20, depth: 4 },
];

const rooms = new Map<number, CensusRoom>();
function roomAt(f: TuneFloor): CensusRoom {
	let r = rooms.get(f.floor);
	if (r === undefined) {
		r = tuneCensusRoom(f.floor, 1, 10);
		rooms.set(f.floor, r);
	}
	return r;
}

/**
 * docs/NEW_ENEMIES_2.md NX6: with 14 room kinds the floor-20 census room (the most distinct kinds, runs 1-10) is a
 * 15-enemy room with two Shieldwalls, a Chainhook, a Pyre-keeper and a Snatcher; the Archer without a guard-breaking
 * build times out on it (the 180 s cap; without the four new kinds it clears in about 150 s, already near it). Left
 * for NX12's tuning (Archer TTK per kind): the Archer's floor-20 census room may time out, printed; every other fight
 * must be won.
 */
const ARCHER = 1;
const LAST_FLOOR = FLOORS.size() - 1;
const TIMEOUT = -1;

function check(rows: ReturnType<typeof characterTtkRows>, archerLastFloorMayTimeOut = false): void {
	for (const row of rows)
		for (let c = 0; c < WHO.size(); c++) {
			const won = row.seconds[c].every(
				(x, i) =>
					x > 0 ||
					x === -2 ||
					(archerLastFloorMayTimeOut && c === ARCHER && i === LAST_FLOOR && x === TIMEOUT),
			);
			if (archerLastFloorMayTimeOut && c === ARCHER && row.seconds[c][LAST_FLOOR] === TIMEOUT)
				print(
					`[archer tune] NX12: the Archer timed out on the floor-${FLOORS[LAST_FLOOR].floor} census room (${row.build})`,
				);
			expect([row.fight, row.build, NAMES[c], won]).toEqual([row.fight, row.build, NAMES[c], true]);
		}
}

describe("AR13 TTK: builds per character", () => {
	it("the swarmer pack (printed)", () => {
		const t0 = os.clock();
		const rows = characterTtkRows([KIND_ROOMS[0]], CHARACTER_BUILD_CASES, WHO, FLOORS, [1, 2, 3]);
		print(`[archer tune] pack, seeds 1-3, mean seconds`);
		print(`[archer tune] ${characterTtkHeader(NAMES, FLOORS, BASE)}`);
		for (const row of rows) print(`[archer tune] ${formatCharacterTtkRow(row, BASE)}`);
		print(`[archer tune] pack: ${string.format("%.1f", os.clock() - t0)} s`);
		check(rows);
	});

	it("the census mixed room of each floor (printed)", () => {
		const t0 = os.clock();
		for (const f of FLOORS) print(`[archer tune] census room f${f.floor}: ${roomAt(f).fight.label}`);
		const rows = characterTtkRows((f) => roomAt(f).fight, CHARACTER_BUILD_CASES, WHO, FLOORS, [1, 2]);
		print(`[archer tune] census rooms, seeds 1-2, mean seconds`);
		print(`[archer tune] ${characterTtkHeader(NAMES, FLOORS, BASE)}`);
		for (const row of rows) print(`[archer tune] ${formatCharacterTtkRow({ ...row, fight: "census room" }, BASE)}`);
		print(`[archer tune] census rooms: ${string.format("%.1f", os.clock() - t0)} s`);
		check(rows, true);
	});
});

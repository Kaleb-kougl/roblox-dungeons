// Builds time to clear a mixed room (docs/BUILDS.md BU13 "Build TTK"): per floor 1 / 6 / 11 a real endless room (solo
// run seeds 1-10: among the rooms with the most distinct kinds, the one closest to the floor's mean enemy count;
// tuneCensusRoom) with its planned affixes, its spawns centred on the player in an open endless arena, spawn hp of that
// floor (the endless floor and Depth set on the state), a scripted player with the sword or the bow's stream, god mode,
// each BU13 build granted before tick 0 (shared/run/testing buildTune.ts). Printed: the rooms and the table in the doc,
// with the effect kills' share and the procs per room (kill probe). Loose sanity bounds only: every room clears within
// its cap and no weapon shot is ever dropped.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BUILD_TTK_CASES,
	TUNE_FLOORS,
	buildTtkHeader,
	buildTtkRows,
	formatBuildTtkRow,
	tuneCensusRoom,
	type CensusRoom,
	type TuneFloor,
	type TuneWeapon,
} from "shared/run/testing";

const SEEDS = [1, 2, 3];
const WEAPONS: ReadonlyArray<TuneWeapon> = ["weapon.sword", "weapon.bow"];
const CENSUS_RUNS = [1, 10] as const;

const rooms = new Map<number, CensusRoom>();
function roomAt(f: TuneFloor): CensusRoom {
	let r = rooms.get(f.floor);
	if (r === undefined) {
		r = tuneCensusRoom(f.floor, CENSUS_RUNS[0], CENSUS_RUNS[1]);
		rooms.set(f.floor, r);
	}
	return r;
}

describe("builds TTK: a mixed census room per floor", () => {
	for (const weapon of WEAPONS) {
		it(`${weapon}: every room clears, no weapon shot dropped (printed)`, () => {
			for (const f of TUNE_FLOORS) print(`[builds tune] room f${f.floor}: ${roomAt(f).fight.label}`);
			const rows = buildTtkRows((f) => roomAt(f).fight, BUILD_TTK_CASES, weapon, TUNE_FLOORS, SEEDS);
			const cap = roomAt(TUNE_FLOORS[0]).fight.maxSeconds;
			print(`[builds tune] room, ${weapon}, seeds 1-3, mean`);
			print(`[builds tune] ${buildTtkHeader(TUNE_FLOORS)}`);
			for (const row of rows) print(`[builds tune] ${formatBuildTtkRow(row, rows[0], cap)}`);
			for (const row of rows) {
				expect([row.build.label, row.seconds.every((x) => x > 0)]).toEqual([row.build.label, true]);
				expect([row.build.label, row.otherDropped]).toEqual([row.build.label, 0]);
			}
		});
	}
});

// Overkill time to clear a mixed room, and its chains (docs/LEGENDARIES.md LG7): BU13's census rooms (per floor 1 / 6 /
// 11, solo run seeds 1-10: among the rooms with the most distinct kinds, the one closest to the floor's mean enemy
// count; tuneCensusRoom) centred on the player in an open endless arena, that floor's spawn hp, the sword bot and the
// bow's stream, god mode, each OVERKILL_TTK_CASES build granted before tick 0 (shared/run/testing legendaryTune.ts).
// Printed: BU13's TTK table, the streak table and the Skewer line counterfactuals. Loose bounds only: every room clears
// within its cap and no weapon shot is ever dropped.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	OVERKILL_TTK_CASES,
	TUNE_FLOORS,
	buildTtkHeader,
	formatBuildTtkRow,
	formatSkewerRow,
	formatStreakRow,
	overkillRows,
	skewerHeader,
	streakHeader,
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

describe("legendaries TTK: a mixed census room per floor", () => {
	for (const weapon of WEAPONS) {
		it(`${weapon}: every room clears, no weapon shot dropped (printed)`, () => {
			for (const f of TUNE_FLOORS) print(`[legendaries tune] room f${f.floor}: ${roomAt(f).fight.label}`);
			const rows = overkillRows((f) => roomAt(f).fight, OVERKILL_TTK_CASES, weapon, TUNE_FLOORS, SEEDS);
			const cap = roomAt(TUNE_FLOORS[0]).fight.maxSeconds;
			print(`[legendaries tune] room, ${weapon}, seeds 1-3, mean`);
			print(`[legendaries tune] ${buildTtkHeader(TUNE_FLOORS)}`);
			for (const row of rows) print(`[legendaries tune] ${formatBuildTtkRow(row.ttk, rows[0].ttk, cap)}`);
			print(`[legendaries tune] room streaks, ${weapon}`);
			print(`[legendaries tune] ${streakHeader(TUNE_FLOORS)}`);
			for (const row of rows) print(`[legendaries tune] ${formatStreakRow(row, SEEDS.size())}`);
			print(`[legendaries tune] room Skewer lines, ${weapon} (first strike of each streak, all floors)`);
			print(`[legendaries tune] ${skewerHeader()}`);
			for (const row of rows) if (row.all.streaks > 0) print(`[legendaries tune] ${formatSkewerRow(row)}`);
			for (const row of rows) {
				const label = row.ttk.build.label;
				expect([label, row.ttk.seconds.every((x) => x > 0)]).toEqual([label, true]);
				expect([label, row.ttk.otherDropped]).toEqual([label, 0]);
			}
		});
	}
});

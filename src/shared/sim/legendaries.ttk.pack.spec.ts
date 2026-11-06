// Overkill time to clear a swarmer pack, and its chains (docs/LEGENDARIES.md LG7): BU13's pack (8 swarmers 5-7 units
// ahead) at floors 1 / 6 / 11 spawn hp, the sword bot and the bow's stream in an open endless arena, god mode, each
// OVERKILL_TTK_CASES build granted before tick 0 (shared/run/testing legendaryTune.ts on buildTune.ts). Printed: BU13's
// TTK table, the streak table (streaks per kill, kills by a streak, carries, the longest chain, Skewer's line strikes)
// and the Skewer line counterfactuals; then Skewer's best case, a row of 6 swarmers (TUNE_LINE). Loose bounds only: every fight clears, no weapon shot is ever dropped, and a
// build without Overkill never streaks.
import { describe, expect, it } from "@rbxts/jest-globals";
import { Boon, boonCard } from "shared/sim";
import {
	OVERKILL_TTK_CASES,
	SKEWER_LINE_CASES,
	TUNE_LINE,
	TUNE_FLOORS,
	TUNE_PACK,
	buildTtkHeader,
	formatBuildTtkRow,
	formatSkewerRow,
	formatStreakRow,
	overkillRows,
	skewerHeader,
	streakHeader,
	type TuneWeapon,
} from "shared/run/testing";

const SEEDS = [1, 2, 3];
const WEAPONS: ReadonlyArray<TuneWeapon> = ["weapon.sword", "weapon.bow"];

describe("legendaries TTK: swarmer pack (8)", () => {
	for (const weapon of WEAPONS) {
		it(`${weapon}: every fight clears, no weapon shot dropped (printed)`, () => {
			const rows = overkillRows(() => TUNE_PACK, OVERKILL_TTK_CASES, weapon, TUNE_FLOORS, SEEDS);
			print(`[legendaries tune] pack, ${weapon}, seeds 1-3, mean`);
			print(`[legendaries tune] ${buildTtkHeader(TUNE_FLOORS)}`);
			for (const row of rows)
				print(`[legendaries tune] ${formatBuildTtkRow(row.ttk, rows[0].ttk, TUNE_PACK.maxSeconds)}`);
			print(`[legendaries tune] pack streaks, ${weapon}`);
			print(`[legendaries tune] ${streakHeader(TUNE_FLOORS)}`);
			for (const row of rows) print(`[legendaries tune] ${formatStreakRow(row, SEEDS.size())}`);
			print(`[legendaries tune] pack Skewer lines, ${weapon} (first strike of each streak, all floors)`);
			print(`[legendaries tune] ${skewerHeader()}`);
			for (const row of rows) if (row.all.streaks > 0) print(`[legendaries tune] ${formatSkewerRow(row)}`);
			for (const row of rows) {
				const label = row.ttk.build.label;
				expect([label, row.ttk.seconds.every((x) => x > 0)]).toEqual([label, true]);
				expect([label, row.ttk.otherDropped]).toEqual([label, 0]);
				if (!row.ttk.build.cards.includes(boonCard(Boon.OVERKILL)))
					expect([label, row.all.streaks]).toEqual([label, 0]);
			}
		});
	}
	for (const weapon of WEAPONS) {
		it(`${weapon}: Skewer on a row of swarmers (printed)`, () => {
			const rows = overkillRows(() => TUNE_LINE, SKEWER_LINE_CASES, weapon, TUNE_FLOORS, SEEDS);
			print(`[legendaries tune] line, ${weapon}, seeds 1-3, mean`);
			print(`[legendaries tune] ${buildTtkHeader(TUNE_FLOORS)}`);
			for (const row of rows)
				print(`[legendaries tune] ${formatBuildTtkRow(row.ttk, rows[0].ttk, TUNE_LINE.maxSeconds)}`);
			print(`[legendaries tune] ${streakHeader(TUNE_FLOORS)}`);
			for (const row of rows) print(`[legendaries tune] ${formatStreakRow(row, SEEDS.size())}`);
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

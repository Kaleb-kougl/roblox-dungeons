// Builds time to clear a swarmer pack (docs/BUILDS.md BU13 "Build TTK"): builds/procs.spec.ts's 8 swarmers 5-7 units
// ahead, at floors 1 / 6 / 11 spawn hp (the endless floor and Depth set on the state, Depth +1 per boss on the way), a
// scripted player with the sword or the bow's stream in an open endless arena, god mode, each BU13 build granted before
// tick 0 (shared/run/testing buildTune.ts). Printed: the table in the doc, with the effect kills' share and the procs
// per fight (kill probe). Loose sanity bounds only, so retunes do not break it: every fight clears, no build is ever
// slower than the slowest no-build fight by more than a second, and no weapon shot is ever dropped.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BUILD_TTK_CASES,
	TUNE_FLOORS,
	TUNE_PACK,
	buildTtkHeader,
	buildTtkRows,
	formatBuildTtkRow,
	tuneIdealDps,
	type TuneWeapon,
} from "shared/run/testing";

const SEEDS = [1, 2, 3];
const WEAPONS: ReadonlyArray<TuneWeapon> = ["weapon.sword", "weapon.bow"];

describe("builds TTK: swarmer pack (8)", () => {
	for (const weapon of WEAPONS) {
		it(`${weapon}: every fight clears, no weapon shot dropped (printed)`, () => {
			const rows = buildTtkRows(() => TUNE_PACK, BUILD_TTK_CASES, weapon, TUNE_FLOORS, SEEDS);
			print(
				`[builds tune] pack, ${weapon} (ideal ${string.format(
					"%.2f",
					tuneIdealDps(weapon),
				)} dps), seeds 1-3, mean`,
			);
			print(`[builds tune] ${buildTtkHeader(TUNE_FLOORS)}`);
			for (const row of rows) print(`[builds tune] ${formatBuildTtkRow(row, rows[0], TUNE_PACK.maxSeconds)}`);
			const slowest = math.max(...rows[0].seconds);
			for (const row of rows) {
				expect([row.build.label, row.seconds.every((x) => x > 0)]).toEqual([row.build.label, true]);
				expect([row.build.label, math.max(...row.seconds) <= slowest + 1]).toEqual([row.build.label, true]);
				expect([row.build.label, row.otherDropped]).toEqual([row.build.label, 0]);
			}
		});
	}
});

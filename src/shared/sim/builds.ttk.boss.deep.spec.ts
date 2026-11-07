// Builds time to kill Mother Mayhem on floor 15 (Depth 3) with the sword and the bow (docs/BUILDS.md BU13 "Build
// TTK"): builds.ttk.boss.sword / .bow.spec.ts's fight (shared/run/testing buildTune.ts) at her third floor, one seed
// (her longest fights: one seed keeps the file under a minute). Printed: the table in the doc and her damage cap's floor.
// Loose sanity bounds only: she always dies, never faster than the cap allows, and no weapon shot is ever dropped.
import { describe, expect, it } from "@rbxts/jest-globals";
import { BOSS_ACT1_DATA, endlessActorHp } from "shared/sim";
import {
	BUILD_TTK_CASES,
	TUNE_BOSS,
	TUNE_BOSS_FLOORS,
	buildTtkHeader,
	buildTtkRows,
	formatBuildTtkRow,
	type TuneFloor,
	type TuneWeapon,
} from "shared/run/testing";

const SEEDS = [1];
const FLOORS: ReadonlyArray<TuneFloor> = [TUNE_BOSS_FLOORS[2]];
const WEAPONS: ReadonlyArray<TuneWeapon> = ["weapon.sword", "weapon.bow"];

describe("builds TTK: Mother Mayhem, floor 15", () => {
	for (const weapon of WEAPONS) {
		it(`${weapon}: she dies, never faster than her damage cap, no weapon shot dropped (printed)`, () => {
			const rows = buildTtkRows(() => TUNE_BOSS, BUILD_TTK_CASES, weapon, FLOORS, SEEDS);
			const cap = BOSS_ACT1_DATA.damageCapPerSecond!;
			const capFloor = FLOORS.map((f) => endlessActorHp(BOSS_ACT1_DATA.hp, true, f.floor, f.depth) / cap);
			print(
				`[builds tune] boss, ${weapon}, seed 1; cap ${cap}/s: hp / cap = ${string.format(
					"%.1f",
					capFloor[0],
				)} s`,
			);
			print(`[builds tune] ${buildTtkHeader(FLOORS)}`);
			for (const row of rows) print(`[builds tune] ${formatBuildTtkRow(row, rows[0], TUNE_BOSS.maxSeconds)}`);
			for (const row of rows) {
				expect([row.build.label, row.seconds.every((x) => x > 0)]).toEqual([row.build.label, true]);
				expect([row.build.label, row.seconds[0] < capFloor[0] * 0.95]).toEqual([row.build.label, false]);
				expect([row.build.label, row.otherDropped]).toEqual([row.build.label, 0]);
			}
		});
	}
});

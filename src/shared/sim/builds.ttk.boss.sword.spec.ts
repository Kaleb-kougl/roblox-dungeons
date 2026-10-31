// Builds time to kill Mother Bramble with the sword (docs/BUILDS.md BU13 "Build TTK"): her own floors 5 / 10 (Depth 1 / 2:
// the endless floor and Depth set on the state, so she and her swarmer adds spawn at that hp), a square boss
// room in an open endless arena, the scripted player targeting the nearest living actor (her adds included), god mode,
// each BU13 build granted before tick 0 (shared/run/testing buildTune.ts). Printed: the table in the doc and her damage
// cap's floor (hp / damageCapPerSecond: no build can beat it). Loose sanity bounds only: she always dies, never faster
// than the cap allows, and no weapon shot is ever dropped.
import { describe, expect, it } from "@rbxts/jest-globals";
import { BOSS_ACT1_DATA, endlessActorHp } from "shared/sim";
import {
	BUILD_TTK_CASES,
	TUNE_BOSS,
	TUNE_BOSS_FLOORS,
	type TuneFloor,
	buildTtkHeader,
	buildTtkRows,
	formatBuildTtkRow,
	tuneIdealDps,
} from "shared/run/testing";

const WEAPON = "weapon.sword";
const SEEDS = [1, 2];
/** Floors 5 / 10; floor 15 is builds.ttk.boss.deep.spec.ts (one seed, to keep each file under a minute). */
const FLOORS: ReadonlyArray<TuneFloor> = [TUNE_BOSS_FLOORS[0], TUNE_BOSS_FLOORS[1]];

describe(`builds TTK: Mother Bramble, ${WEAPON}`, () => {
	it("she dies at every floor, never faster than her damage cap, no weapon shot dropped (printed)", () => {
		const rows = buildTtkRows(() => TUNE_BOSS, BUILD_TTK_CASES, WEAPON, FLOORS, SEEDS);
		const cap = BOSS_ACT1_DATA.damageCapPerSecond!;
		const capFloor = FLOORS.map((f) => endlessActorHp(BOSS_ACT1_DATA.hp, true, f.floor, f.depth) / cap);
		print(
			`[builds tune] boss, ${WEAPON} (ideal ${string.format(
				"%.2f",
				tuneIdealDps(WEAPON),
			)} dps), seeds 1-2, mean; ` +
				`cap ${cap}/s: hp / cap = ${capFloor.map((x) => string.format("%.1f", x)).join(" / ")} s`,
		);
		print(`[builds tune] ${buildTtkHeader(FLOORS)}`);
		for (const row of rows) print(`[builds tune] ${formatBuildTtkRow(row, rows[0], TUNE_BOSS.maxSeconds)}`);
		for (const row of rows) {
			expect([row.build.label, row.seconds.every((x) => x > 0)]).toEqual([row.build.label, true]);
			const beatsCap = row.seconds.some((x, i) => x < capFloor[i] * 0.95);
			expect([row.build.label, beatsCap]).toEqual([row.build.label, false]);
			expect([row.build.label, row.otherDropped]).toEqual([row.build.label, 0]);
		}
	});
});

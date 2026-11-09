// docs/ARCHER.md AR13: time to kill Mother Mayhem per character (shared/run/testing characterTune.ts TUNE_MAYHEM: buildTune.ts's
// boss arena, the player 3 units inside its edge) at the boss floors 5 / 10 / 15 (Depth 1 / 2 / 3), no build and Soul
// Swarm (her / his adds proc), per character: the Knight, the Archer (charged shots back to back), the Archer with the
// stream only, the old two-weapon player; god mode, seeds 1-2. The damage cap (6 / s) puts a floor under every fight:
// printed beside the table. Loose bounds only: the boss always dies and never faster than the cap allows.
import { describe, expect, it } from "@rbxts/jest-globals";
import { BOSS_ACT1_DATA, endlessActorHp } from "shared/sim";
import {
	CHARACTER_BOSS_FLOORS,
	CHARACTER_BUILD_CASES,
	TUNE_MAYHEM,
	characterTtkHeader,
	characterTtkRows,
	formatCharacterTtkRow,
	type FighterMode,
	type TuneCharacter,
} from "shared/run/testing";

const WHO: ReadonlyArray<TuneCharacter> = ["knight", "archer", "archer", "both"];
const MODES: ReadonlyArray<FighterMode> = ["knight", "archer", "archer-stream", "both"];
const NAMES = ["Knight", "Archer", "Archer (stream only)", "Both"];
const BASE = 3;

describe("AR13 TTK: Mother Mayhem per character", () => {
	it("dies at every floor, never faster than the cap (printed)", () => {
		const t0 = os.clock();
		const cap = BOSS_ACT1_DATA.damageCapPerSecond!;
		const capFloor = CHARACTER_BOSS_FLOORS.map(
			(f) => endlessActorHp(BOSS_ACT1_DATA.hp, true, f.floor, f.depth) / cap,
		);
		const builds = [CHARACTER_BUILD_CASES[0], CHARACTER_BUILD_CASES[2]];
		const rows = characterTtkRows([TUNE_MAYHEM], builds, WHO, CHARACTER_BOSS_FLOORS, [1, 2], MODES);
		print(
			`[archer tune] boss Mother Mayhem, seeds 1-2, mean seconds; cap ${cap}/s: hp / cap = ${capFloor
				.map((x) => string.format("%.1f", x))
				.join(" / ")} s`,
		);
		print(`[archer tune] ${characterTtkHeader(NAMES, CHARACTER_BOSS_FLOORS, BASE)}`);
		for (const row of rows) print(`[archer tune] ${formatCharacterTtkRow(row, BASE)}`);
		print(`[archer tune] boss Mother Mayhem: ${string.format("%.1f", os.clock() - t0)} s`);
		for (const row of rows)
			for (let c = 0; c < WHO.size(); c++) {
				expect([row.build, NAMES[c], row.seconds[c].every((x) => x > 0)]).toEqual([row.build, NAMES[c], true]);
				const beats = row.seconds[c].some((x, i) => x < capFloor[i] * 0.95);
				expect([row.build, NAMES[c], beats]).toEqual([row.build, NAMES[c], false]);
			}
	});
});

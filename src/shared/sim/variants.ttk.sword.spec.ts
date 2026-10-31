// Enemy variants time to kill with the port's sword (docs/ENEMY_VARIANTS.md EV13 "TTK table"): every new archetype
// (imp, the Ooze with its two slimelets, the summoner) and every affix on the swarmer / sniper / bruiser, at floors 1 / 6
// / 11 / 20 spawn hp (endlessActorHp, Depth +1 per boss on the way), scripted sword player in an open arena, god mode
// (shared/run/testing variantTtk.ts). Printed: the table in the doc. Loose sanity bounds only, so retunes do not break
// it: everything dies, floor 1 within 10 s, deeper floors never faster than floor 1 by more than a frame or two.
import { describe, expect, it } from "@rbxts/jest-globals";
import { formatTtkRow, ttkCases, ttkHeader, ttkIdealDps, ttkRows } from "shared/run/testing";

const WEAPON = "weapon.sword";
const SEEDS = [1, 2, 3, 4, 5, 6];

describe(`enemy variants TTK: ${WEAPON}`, () => {
	it("every enemy dies at every floor; floor 1 within 10 s (printed)", () => {
		const rows = ttkRows(ttkCases(), WEAPON, SEEDS);
		print(
			`[variants ttk] ${WEAPON} (ideal ${string.format(
				"%.2f",
				ttkIdealDps(WEAPON),
			)} dps), seeds 1-6, mean seconds`,
		);
		print(`[variants ttk] ${ttkHeader()}`);
		for (const row of rows) print(`[variants ttk] ${formatTtkRow(row)}`);
		for (const row of rows) {
			expect([row.ttkCase.label, row.seconds.every((x) => x > 0)]).toEqual([row.ttkCase.label, true]);
			expect([row.ttkCase.label, row.seconds[0] <= 10]).toEqual([row.ttkCase.label, true]);
			const last = row.seconds.size() - 1;
			expect([row.ttkCase.label, row.seconds[last] >= row.seconds[0] - 0.1]).toEqual([row.ttkCase.label, true]);
		}
	});
});

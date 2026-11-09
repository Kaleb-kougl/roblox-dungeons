// docs/ARCHER.md AR13: the Archer's roll while fighting, and what rides the roll. (1) LG7's fighting "roll" bot (the
// bow's stream, a roll into every volley) in LG7's defence rooms and the floor-6 census room, once as the Archer (the
// real character path: the bow and the Archer's roll) and once with the bow and the Knight's roll (no character: the
// arena's bow, no traits), so only the roll differs; rows no build, Bastion, Bastion + Slippery I; floor 6, god mode,
// seeds 1-5. (2) Blazing Trail (Ember Wake + Slippery I + the duo): one roll on open ground per character, its embers'
// spread (characterTune.ts rollReach). (3) Wrecker I: one roll into a line of crates on open floor per character, and
// single crates at 1..5 tiles (wreckerReach). Printed: the tables in the doc.
import { describe, expect, it } from "@rbxts/jest-globals";
import { Boon, Duo, boonCard, duoCard } from "shared/sim";
import {
	DEFENSE_FLOOR,
	DEFENSE_ROOMS,
	defenseHeader,
	defenseRows,
	formatDefenseRow,
	rollReach,
	tuneCensusRoom,
	wreckerReach,
	type DefenseCase,
	type DefenseRoom,
	type TuneCharacter,
} from "shared/run/testing";

const SEEDS = [1, 2, 3, 4, 5];
const CASES: ReadonlyArray<DefenseCase> = [
	{ label: "no build", cards: [] },
	{ label: "Bastion", cards: [boonCard(Boon.BASTION)] },
	{ label: "Bastion + Slippery I", cards: [boonCard(Boon.BASTION), boonCard(Boon.SLIPPERY)] },
];
const WHO: ReadonlyArray<TuneCharacter> = ["knight", "archer"];

describe("AR13: the roll per character (fighting, reach)", () => {
	const census = tuneCensusRoom(DEFENSE_FLOOR.floor, 1, 10);
	const rooms: DefenseRoom[] = [
		...DEFENSE_ROOMS,
		{ label: "mixed f6 census", fight: census.fight, untilClear: true },
	];
	// "none": no character (the arena's bow, no traits: the Knight's roll). A plain list: undefined would end it in Luau.
	for (const who of ["archer", "none"] as const) {
		it(`roll bot, the bow with the ${who === "none" ? "Knight's" : "Archer's"} roll (printed)`, () => {
			const t0 = os.clock();
			const rows = defenseRows(rooms, CASES, "roll", DEFENSE_FLOOR, SEEDS, who === "none" ? undefined : who);
			const name = who === "none" ? "bow + Knight's roll" : "Archer";
			print(`[archer tune] roll bot, ${name}, floor 6, seeds 1-5, mean per room`);
			print(`[archer tune] ${defenseHeader("roll")}`);
			for (const row of rows) print(`[archer tune] ${formatDefenseRow(row, "roll")}`);
			print(`[archer tune] roll ${name}: ${string.format("%.1f", os.clock() - t0)} s`);
			for (const row of rows) expect([row.room, row.sum.rolls > 0]).toEqual([row.room, true]);
		});
	}

	it("Blazing Trail and Wrecker along one roll (printed)", () => {
		const trail = [boonCard(Boon.EMBER_WAKE), boonCard(Boon.SLIPPERY), duoCard(Duo.BLAZING_TRAIL)];
		print(
			`[archer tune] | character | roll tiles | Blazing Trail embers | first to last ember | ember gaps min / max |`,
		);
		const spans: number[] = [];
		for (const who of WHO) {
			const r = rollReach(who, trail);
			spans.push(r.emberSpan);
			print(
				`[archer tune] | ${who} | ${string.format("%.2f", r.distance)} | ${r.embers} | ${string.format(
					"%.2f",
					r.emberSpan,
				)} | ${string.format("%.2f", r.emberGapMin)} / ${string.format("%.2f", r.emberGapMax)} |`,
			);
			expect(r.embers > 0).toBe(true);
		}
		expect(spans[1] > spans[0]).toBe(true);
		print(
			`[archer tune] | character | crates 1-6 tiles ahead: broken / farthest | single crate at 1 / 2 / 3 / 4 / 5 |`,
		);
		const lines: number[] = [];
		for (const who of WHO) {
			const line = wreckerReach(who, [1, 2, 3, 4, 5, 6]);
			lines.push(line.farthest);
			const singles: string[] = [];
			for (let d = 1; d <= 5; d++) singles.push(wreckerReach(who, [d]).broken > 0 ? "yes" : "no");
			print(`[archer tune] | ${who} | ${line.broken} / ${line.farthest} | ${singles.join(" / ")} |`);
		}
		expect(lines[1] >= lines[0]).toBe(true);
	});
});

// docs/ARCHER.md AR13: the Archer's roll against the Knight's under the same bot policy. LG7's defence rooms (caster /
// sprayer turrets, snipers, reapers) and BU13's floor-6 census room at floor 6's hp (shared/run/testing legendaryTune.ts
// defenseFight with a character: the run config built through withCharacters), the "roll-hold" bot (kites, never
// attacks, rolls into a volley whenever DEFENSE_ROLL_BULLETS enemy bullets are near: weapon-free, so only the roll
// differs), as the Knight (2.5 tiles, 12 i-frames) and as the Archer (3.38 tiles, 15 i-frames); and the Knight's own
// defence, "guard-hold" (the guard whenever a bullet is near, never a roll). Rows: no build, Slippery I, Bastion,
// Bastion + Slippery I, Bastion + Warding I + Citadel. God mode, at most DEFENSE_SECONDS per room, seeds 1-5. Printed:
// the tables in the doc. Loose bounds only: every fight ran, braces only with Bastion.
import { describe, expect, it } from "@rbxts/jest-globals";
import { Boon, Duo, boonCard, duoCard } from "shared/sim";
import type { CharacterId } from "shared/characters";
import {
	DEFENSE_FLOOR,
	DEFENSE_ROOMS,
	defenseHeader,
	defenseRows,
	formatDefenseRow,
	tuneCensusRoom,
	type DefenseBot,
	type DefenseCase,
	type DefenseRoom,
} from "shared/run/testing";

const SEEDS = [1, 2, 3, 4, 5];
const CITADEL = [boonCard(Boon.BASTION), boonCard(Boon.WARDING), duoCard(Duo.CITADEL)];
const CASES: ReadonlyArray<DefenseCase> = [
	{ label: "no build", cards: [] },
	{ label: "Slippery I", cards: [boonCard(Boon.SLIPPERY)] },
	{ label: "Bastion", cards: [boonCard(Boon.BASTION)] },
	{ label: "Bastion + Slippery I", cards: [boonCard(Boon.BASTION), boonCard(Boon.SLIPPERY)] },
	{ label: "Bastion + Warding I + Citadel", cards: CITADEL },
];
const RUNS: ReadonlyArray<readonly [DefenseBot, CharacterId, ReadonlyArray<DefenseCase>]> = [
	["roll-hold", "knight", CASES],
	["roll-hold", "archer", CASES],
	["guard-hold", "knight", [CASES[0], CASES[2], CASES[4]]],
];

describe("AR13: the roll per character (hold bots)", () => {
	const census = tuneCensusRoom(DEFENSE_FLOOR.floor, 1, 10);
	const rooms: DefenseRoom[] = [
		...DEFENSE_ROOMS,
		{ label: "mixed f6 census", fight: census.fight, untilClear: true },
	];
	for (const [bot, who, cases] of RUNS) {
		it(`${bot} as the ${who}: hits taken and braces per room (printed)`, () => {
			const t0 = os.clock();
			const rows = defenseRows(rooms, cases, bot, DEFENSE_FLOOR, SEEDS, who);
			print(`[archer tune] ${bot} bot as the ${who}, floor 6, seeds 1-5, mean per room`);
			print(`[archer tune] ${defenseHeader(bot)}`);
			for (const row of rows) print(`[archer tune] ${formatDefenseRow(row, bot)}`);
			print(`[archer tune] ${bot} ${who}: ${string.format("%.1f", os.clock() - t0)} s`);
			for (const row of rows) {
				const label = `${row.room} / ${row.build.label}`;
				expect([label, row.sum.seconds > 0]).toEqual([label, true]);
				if (!row.build.cards.includes(boonCard(Boon.BASTION)))
					expect([label, row.sum.braces]).toEqual([label, 0]);
			}
		});
	}
});

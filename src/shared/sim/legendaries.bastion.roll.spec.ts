// Bastion's roll brace (docs/LEGENDARIES.md LG7): caster / sprayer turret, sniper and reaper rooms and BU13's floor-6
// census room at floor 6's hp, the bow bot that rolls into a volley whenever DEFENSE_ROLL_BULLETS enemy bullets are near
// (shared/run/testing legendaryTune.ts defenseFight), god mode, at most DEFENSE_SECONDS per room. Rows: no build,
// Warding I, Slippery I, Bastion, Bastion + Slippery I, Bastion + Warding I + Citadel, and with Slippery I too (the
// plan's risk: longer i-frames, more bullets per roll). Both bots: the fighting one and "roll-hold" (never attacks,
// kites: the defence alone). Printed: the tables in the doc. Loose bounds only: every fight ran, the bot rolled, at
// most one brace per room without Citadel, and no brace without Bastion.
import { describe, expect, it } from "@rbxts/jest-globals";
import { Boon, Duo, boonCard, duoCard } from "shared/sim";
import {
	DEFENSE_FLOOR,
	DEFENSE_ROOMS,
	defenseHeader,
	defenseRows,
	formatDefenseRow,
	tuneCensusRoom,
	type DefenseCase,
	type DefenseRoom,
} from "shared/run/testing";

const SEEDS = [1, 2, 3, 4, 5];
const CITADEL = [boonCard(Boon.BASTION), boonCard(Boon.WARDING), duoCard(Duo.CITADEL)];

const CASES: ReadonlyArray<DefenseCase> = [
	{ label: "no build", cards: [] },
	{ label: "Warding I", cards: [boonCard(Boon.WARDING)] },
	{ label: "Slippery I", cards: [boonCard(Boon.SLIPPERY)] },
	{ label: "Bastion", cards: [boonCard(Boon.BASTION)] },
	{ label: "Bastion + Slippery I", cards: [boonCard(Boon.BASTION), boonCard(Boon.SLIPPERY)] },
	{ label: "Bastion + Warding I + Citadel", cards: CITADEL },
	{ label: "Bastion + Warding I + Citadel + Slippery I", cards: [...CITADEL, boonCard(Boon.SLIPPERY)] },
];

describe("legendaries tune: Bastion, the roll bot", () => {
	const census = tuneCensusRoom(DEFENSE_FLOOR.floor, 1, 10);
	const rooms: DefenseRoom[] = [
		...DEFENSE_ROOMS,
		{ label: "mixed f6 census", fight: census.fight, untilClear: true },
	];
	for (const bot of ["roll", "roll-hold"] as const) {
		it(`${bot}: hits taken and braces per room (printed)`, () => {
			print(`[legendaries tune] bastion ${bot} rooms: mixed = ${census.fight.label}`);
			const rows = defenseRows(rooms, CASES, bot, DEFENSE_FLOOR, SEEDS);
			print(`[legendaries tune] bastion, ${bot} bot (bow), floor 6, seeds 1-5, mean per room`);
			print(`[legendaries tune] ${defenseHeader(bot)}`);
			for (const row of rows) print(`[legendaries tune] ${formatDefenseRow(row, bot)}`);
			for (const row of rows) {
				const label = `${row.room} / ${row.build.label}`;
				const bastion = row.build.cards.includes(boonCard(Boon.BASTION));
				const citadel = row.build.cards.includes(duoCard(Duo.CITADEL));
				expect([label, row.sum.seconds > 0, row.sum.rolls > 0]).toEqual([label, true, true]);
				if (!bastion) expect([label, row.sum.braces]).toEqual([label, 0]);
				if (!citadel) expect([label, row.sum.braces <= row.fights]).toEqual([label, true]);
			}
		});
	}
});

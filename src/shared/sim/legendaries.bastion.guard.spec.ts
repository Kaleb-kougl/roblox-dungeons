// Bastion with the sword's guard (docs/LEGENDARIES.md LG7): caster / sprayer turret, sniper and reaper rooms and BU13's
// floor-6 census room at floor 6's hp, the sword bot that guards whenever the guard is off cooldown and an enemy bullet
// is near (shared/run/testing legendaryTune.ts defenseFight), god mode, at most DEFENSE_SECONDS per room. Rows: no
// build, Warding I, Bastion, Bastion + Warding I + Citadel, and the guard's shape without Bastion (SWORD_DATA's
// guardTicks / guardHalfAngleCos set for the fight: the full ring at 18 ticks, today's arc at 27, the ring at 27).
// Both bots: the fighting one and "guard-hold" (never attacks, kites at the bow bot's distance: the defence alone).
// Printed: the tables in the doc. Loose bounds only: every fight ran, the bot guarded, SWORD_DATA is restored, at most
// one brace per room without Citadel, and no brace without Bastion.
import { describe, expect, it } from "@rbxts/jest-globals";
import { BASTION_GUARD_TICKS, Boon, Duo, SWORD_DATA, boonCard, duoCard } from "shared/sim";
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
const RING = -2; // below -1: the cone test always holds (BASTION_GUARD_SWEEP_HALF_ANGLE_COS)

const CASES: ReadonlyArray<DefenseCase> = [
	{ label: "no build (guard 203 deg, 18 ticks)", cards: [] },
	{ label: "Warding I", cards: [boonCard(Boon.WARDING)] },
	{ label: "Bastion (ring, 27 ticks, pip, brace)", cards: [boonCard(Boon.BASTION)] },
	{
		label: "Bastion + Warding I + Citadel",
		cards: [boonCard(Boon.BASTION), boonCard(Boon.WARDING), duoCard(Duo.CITADEL)],
	},
	{ label: "no build, guard ring 18 ticks", cards: [], guardCos: RING },
	{ label: "no build, guard 203 deg 27 ticks", cards: [], guardTicks: BASTION_GUARD_TICKS },
	{ label: "no build, guard ring 27 ticks", cards: [], guardCos: RING, guardTicks: BASTION_GUARD_TICKS },
];

describe("legendaries tune: Bastion, the guard bot", () => {
	const census = tuneCensusRoom(DEFENSE_FLOOR.floor, 1, 10);
	const rooms: DefenseRoom[] = [
		...DEFENSE_ROOMS,
		{ label: "mixed f6 census", fight: census.fight, untilClear: true },
	];
	for (const bot of ["guard", "guard-hold"] as const) {
		it(`${bot}: hits taken and braces per room (printed)`, () => {
			print(`[legendaries tune] bastion ${bot} rooms: mixed = ${census.fight.label}`);
			const rows = defenseRows(rooms, CASES, bot, DEFENSE_FLOOR, SEEDS);
			print(`[legendaries tune] bastion, ${bot} bot (sword), floor 6, seeds 1-5, mean per room`);
			print(`[legendaries tune] ${defenseHeader(bot)}`);
			for (const row of rows) print(`[legendaries tune] ${formatDefenseRow(row, bot)}`);
			expect([SWORD_DATA.guardTicks, SWORD_DATA.guardHalfAngleCos]).toEqual([18, -0.2]);
			for (const row of rows) {
				const label = `${row.room} / ${row.build.label}`;
				const bastion = row.build.cards.includes(boonCard(Boon.BASTION));
				const citadel = row.build.cards.includes(duoCard(Duo.CITADEL));
				expect([label, row.sum.seconds > 0, row.sum.guards > 0]).toEqual([label, true, true]);
				if (!bastion) expect([label, row.sum.braces]).toEqual([label, 0]);
				if (!citadel) expect([label, row.sum.braces <= row.fights]).toEqual([label, true]);
			}
		});
	}
});

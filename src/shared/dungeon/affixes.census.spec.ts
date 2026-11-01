// Elite affix census (docs/ENEMY_VARIANTS.md EV6, EVD7): run seeds 1-60 x floors 1-20 (solo spawns). The elite share
// (35 % of a room's eligible members, rounded up, at least 1), the combat share (10 % per member from floor 11), the
// spread over the unlocked affixes, and never an affix on an excluded kind or below its unlock floor; printed. Its own
// file: the 1200 Forge floors take most of a minute headless.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	AFFIXES,
	assignAffixes,
	eliteAffixCount,
	encounterRooms,
	endlessFloorParams,
	endlessRoomSpawns,
	endlessRoster,
	generateDungeon,
	isAffixExcluded,
} from "shared/dungeon";

function unlockOf(kind: number): number {
	for (const u of AFFIXES.unlocks) if (u.kind === kind) return u.fromFloor;
	return math.huge;
}

describe("affix census (run seeds 1-60 x floors 1-20, solo)", () => {
	it("elite / combat shares hold, never on excluded kinds or below unlock floors (printed)", () => {
		let eliteRooms = 0;
		let eliteEligible = 0;
		let eliteAffixed = 0;
		let combatEligible = 0;
		let combatAffixed = 0;
		let combatAffixedDeep = 0;
		const byKind = [0, 0, 0, 0, 0];
		const deepByKind = [0, 0, 0, 0, 0];
		const perFloor: number[] = [];
		for (let floor = 0; floor <= 20; floor++) perFloor.push(0);
		for (let run = 1; run <= 60; run++) {
			for (let floor = 1; floor <= 20; floor++) {
				const params = endlessFloorParams(run, floor);
				const d = generateDungeon(params);
				const rooms = encounterRooms(d);
				const spawns = endlessRoomSpawns(d, floor, 1, endlessRoster(run, floor));
				const out = assignAffixes(params.seed, floor, rooms, spawns);
				for (let id = 0; id < spawns.size(); id++) {
					const roomType = rooms[id].type;
					let eligible = 0;
					let affixed = 0;
					for (let i = 0; i < spawns[id].size(); i++) {
						const kind = spawns[id][i].kind;
						const affix = out[id][i];
						if (!isAffixExcluded(kind)) eligible++;
						else expect(affix).toBe(0);
						if (affix === 0) continue;
						expect(floor >= unlockOf(affix)).toBe(true);
						expect(roomType === "elite" || roomType === "combat").toBe(true);
						affixed++;
						byKind[affix]++;
						if (floor >= 9) deepByKind[affix]++;
						perFloor[floor]++;
					}
					if (roomType === "elite" && floor >= AFFIXES.eliteFromFloor && eligible > 0) {
						eliteRooms++;
						eliteEligible += eligible;
						eliteAffixed += affixed;
						expect(affixed).toBe(eliteAffixCount(eligible));
					} else if (roomType === "combat" && floor >= AFFIXES.combatFromFloor) {
						combatEligible += eligible;
						combatAffixed += affixed;
						if (floor >= 9) combatAffixedDeep += affixed;
					} else expect(affixed).toBe(0);
				}
			}
		}
		const eliteShare = eliteAffixed / eliteEligible;
		const combatShare = combatAffixed / combatEligible;
		print(
			`[affix census] elite rooms (floors 4-20): ${eliteRooms}, ${eliteAffixed} of ${eliteEligible} members ` +
				`affixed (${string.format("%.1f", eliteShare * 100)} %, target 35 % rounded up per room)`,
		);
		print(
			`[affix census] combat rooms (floors 11-20): ${combatAffixed} of ${combatEligible} members affixed ` +
				`(${string.format("%.1f", combatShare * 100)} %, target 10 %)`,
		);
		print(
			`[affix census] by affix (all floors): hulking ${byKind[1]}, swift ${byKind[2]}, shielded ${byKind[3]}, ` +
				`vengeful ${byKind[4]}; floors 9-20: ${deepByKind[1]} / ${deepByKind[2]} / ${deepByKind[3]} / ${deepByKind[4]}`,
		);
		print(`[affix census] affixed members per floor (60 runs): ${perFloor.filter((_, f) => f >= 1).join(" ")}`);
		expect(eliteRooms > 500).toBe(true);
		// Rounding up per room puts the elite share above 35 % but within 1 / (smallest room) of it.
		expect(eliteShare >= AFFIXES.eliteSharePercent / 100).toBe(true);
		expect(eliteShare <= 0.5).toBe(true);
		expect(math.abs(combatShare - AFFIXES.combatChancePercent / 100)).toBeLessThanOrEqual(0.02);
		expect(combatAffixedDeep).toBe(combatAffixed);
		for (let f = 1; f < AFFIXES.eliteFromFloor; f++) expect(perFloor[f]).toBe(0);
		// From floor 9 every affix is offered: each takes about a quarter.
		const deep = deepByKind[1] + deepByKind[2] + deepByKind[3] + deepByKind[4];
		for (let k = 1; k <= 4; k++) expect(math.abs(deepByKind[k] / deep - 0.25)).toBeLessThanOrEqual(0.05);
	});
});

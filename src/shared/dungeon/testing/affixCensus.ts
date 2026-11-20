/**
 * The elite affix census (docs/ENEMY_VARIANTS.md EV6, EVD7), shared by its shard specs (affixes.census.<n>.spec.ts):
 * run seeds x floors 1..AFFIX_CENSUS.floors, solo spawns with the run's seeded roster as every endless world builds it
 * (no unlock floors since docs/DAILY.md DSD18). Per room it checks the exact rules (never an affix on an excluded kind,
 * below its unlock floor or outside an elite / combat room; an elite room from AFFIXES.eliteFromFloor holds exactly
 * eliteAffixCount of its eligible members; no affix anywhere else) and fails with error() naming the floor; the shares
 * are tallied for the spec to gate. Test support only.
 *
 * @module
 */
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

export const AFFIX_CENSUS = {
	/** Run seeds 1..runs over all shards. */
	runs: 60,
	floors: 20,
	shards: 4,
	/** shared/run ENDLESS_ROSTER_UNLOCK_FLOORS (false since DSD18); shared/dungeon cannot import shared/run. */
	unlockFloors: false,
	/** Elite rooms per run seed the sample must reach (the full census asked for more than 500 in 60 runs). */
	minEliteRoomsPerRun: 500 / 60,
	/** Floors from which every affix is offered (the last unlock): each then takes about a quarter. */
	allAffixesFloor: 9,
} as const;

export interface AffixCensus {
	readonly floors: number;
	readonly eliteRooms: number;
	readonly eliteEligible: number;
	readonly eliteAffixed: number;
	readonly combatEligible: number;
	readonly combatAffixed: number;
	/** Combat-room affixes on floors >= allAffixesFloor (all of them: combat rooms start later). */
	readonly combatAffixedDeep: number;
	/** Affixed members by affix kind (index 1..4), every floor. */
	readonly byKind: ReadonlyArray<number>;
	/** The same from allAffixesFloor on. */
	readonly deepByKind: ReadonlyArray<number>;
	/** Affixed members per floor (index = floor; 0 unused). */
	readonly perFloor: ReadonlyArray<number>;
}

function unlockOf(kind: number): number {
	for (const u of AFFIXES.unlocks) if (u.kind === kind) return u.fromFloor;
	return math.huge;
}

/** The census over run seeds firstRun..lastRun (every floor 1..AFFIX_CENSUS.floors). */
export function affixCensus(firstRun: number, lastRun: number): AffixCensus {
	let floors = 0;
	let eliteRooms = 0;
	let eliteEligible = 0;
	let eliteAffixed = 0;
	let combatEligible = 0;
	let combatAffixed = 0;
	let combatAffixedDeep = 0;
	const byKind = [0, 0, 0, 0, 0];
	const deepByKind = [0, 0, 0, 0, 0];
	const perFloor: number[] = [];
	for (let floor = 0; floor <= AFFIX_CENSUS.floors; floor++) perFloor.push(0);
	for (let run = firstRun; run <= lastRun; run++)
		for (let floor = 1; floor <= AFFIX_CENSUS.floors; floor++) {
			const label = `run ${run} floor ${floor}`;
			const params = endlessFloorParams(run, floor);
			const d = generateDungeon(params);
			const rooms = encounterRooms(d);
			const roster = endlessRoster(run, floor, AFFIX_CENSUS.unlockFloors);
			const spawns = endlessRoomSpawns(d, floor, 1, roster, AFFIX_CENSUS.unlockFloors);
			const out = assignAffixes(params.seed, floor, rooms, spawns);
			floors++;
			for (let id = 0; id < spawns.size(); id++) {
				const roomType = rooms[id].type;
				let eligible = 0;
				let affixed = 0;
				for (let i = 0; i < spawns[id].size(); i++) {
					const kind = spawns[id][i].kind;
					const affix = out[id][i];
					if (!isAffixExcluded(kind)) eligible++;
					else if (affix !== 0) error(`${label}: affix ${affix} on excluded ${kind}`);
					if (affix === 0) continue;
					if (floor < unlockOf(affix)) error(`${label}: affix ${affix} below its unlock floor`);
					if (roomType !== "elite" && roomType !== "combat") error(`${label}: affix in a ${roomType} room`);
					affixed++;
					byKind[affix]++;
					if (floor >= AFFIX_CENSUS.allAffixesFloor) deepByKind[affix]++;
					perFloor[floor]++;
				}
				if (roomType === "elite" && floor >= AFFIXES.eliteFromFloor && eligible > 0) {
					eliteRooms++;
					eliteEligible += eligible;
					eliteAffixed += affixed;
					if (affixed !== eliteAffixCount(eligible))
						error(
							`${label}: elite room ${id} has ${affixed} affixed of ${eligible}, want ${eliteAffixCount(
								eligible,
							)}`,
						);
				} else if (roomType === "combat" && floor >= AFFIXES.combatFromFloor) {
					combatEligible += eligible;
					combatAffixed += affixed;
					if (floor >= AFFIX_CENSUS.allAffixesFloor) combatAffixedDeep += affixed;
				} else if (affixed !== 0) error(`${label}: room ${id} (${roomType}) has ${affixed} affixed`);
			}
		}
	return {
		floors,
		eliteRooms,
		eliteEligible,
		eliteAffixed,
		combatEligible,
		combatAffixed,
		combatAffixedDeep,
		byKind,
		deepByKind,
		perFloor,
	};
}

function pct(x: number): string {
	return string.format("%.1f", x * 100);
}

/** The census's printed lines (shares, the spread by affix, affixed members per floor). */
export function affixCensusLines(c: AffixCensus, runs: number): string[] {
	const deep = AFFIX_CENSUS.allAffixesFloor;
	const perFloor: number[] = [];
	for (let f = 1; f < c.perFloor.size(); f++) perFloor.push(c.perFloor[f]);
	return [
		`[affix census] elite rooms (floors ${AFFIXES.eliteFromFloor}-${AFFIX_CENSUS.floors}): ${c.eliteRooms}, ` +
			`${c.eliteAffixed} of ${c.eliteEligible} members affixed (${pct(c.eliteAffixed / c.eliteEligible)} %, ` +
			`target ${AFFIXES.eliteSharePercent} % rounded up per room)`,
		`[affix census] combat rooms (floors ${AFFIXES.combatFromFloor}-${AFFIX_CENSUS.floors}): ${c.combatAffixed} of ` +
			`${c.combatEligible} members affixed (${pct(c.combatAffixed / c.combatEligible)} %, target ` +
			`${AFFIXES.combatChancePercent} %)`,
		`[affix census] by affix (all floors): hulking ${c.byKind[1]}, swift ${c.byKind[2]}, shielded ${c.byKind[3]}, ` +
			`vengeful ${c.byKind[4]}; floors ${deep}-${AFFIX_CENSUS.floors}: ${c.deepByKind[1]} / ${c.deepByKind[2]} / ` +
			`${c.deepByKind[3]} / ${c.deepByKind[4]}`,
		`[affix census] affixed members per floor (${runs} runs): ${perFloor.join(" ")}`,
	];
}

/**
 * The census's share gates over `runs` run seeds, as failure lines (empty: all hold): enough elite rooms; the elite
 * share at least AFFIXES.eliteSharePercent (rounding up per room puts it above, within 1 / the smallest room) and at
 * most half; the combat share within 2 points of AFFIXES.combatChancePercent; combat affixes only from
 * allAffixesFloor; none below AFFIXES.eliteFromFloor; from allAffixesFloor each affix about a quarter (5 points).
 */
export function affixCensusProblems(c: AffixCensus, runs: number): string[] {
	const out: string[] = [];
	const minRooms = AFFIX_CENSUS.minEliteRoomsPerRun * runs;
	if (c.eliteRooms <= minRooms) out.push(`${c.eliteRooms} elite rooms, want more than ${minRooms}`);
	const elite = c.eliteAffixed / c.eliteEligible;
	if (elite < AFFIXES.eliteSharePercent / 100 || elite > 0.5) out.push(`elite share ${pct(elite)} %`);
	const combat = c.combatAffixed / c.combatEligible;
	if (math.abs(combat - AFFIXES.combatChancePercent / 100) > 0.02) out.push(`combat share ${pct(combat)} %`);
	if (c.combatAffixedDeep !== c.combatAffixed)
		out.push(`${c.combatAffixed - c.combatAffixedDeep} combat affixes below floor ${AFFIX_CENSUS.allAffixesFloor}`);
	for (let f = 1; f < AFFIXES.eliteFromFloor; f++)
		if (c.perFloor[f] !== 0) out.push(`${c.perFloor[f]} affixed on floor ${f}`);
	const deep = c.deepByKind[1] + c.deepByKind[2] + c.deepByKind[3] + c.deepByKind[4];
	for (let k = 1; k <= 4; k++)
		if (math.abs(c.deepByKind[k] / deep - 0.25) > 0.05)
			out.push(`affix ${k}: ${pct(c.deepByKind[k] / deep)} % deep`);
	return out;
}

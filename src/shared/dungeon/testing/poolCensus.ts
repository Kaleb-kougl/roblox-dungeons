/**
 * The endless room pool census (docs/ENEMY_VARIANTS.md EV5), shared by the census specs (split over several files:
 * each Forge floor takes about a tenth of a second headless). Per floor: populated rooms, enemies per room by kind,
 * distinct kinds per room, the budget the placed enemies spend, the most summoners in one room, the affixed share
 * (assignAffixes over the same spawns), and rule breaks (a kind below its unlock floor, more of a kind in a room than its maxPerRoom, a wide body
 * on a tile with a non-FLOOR neighbour, a kind that needs company as a room's first spawn). Seeded rosters
 * (docs/DAILY.md DS1): every floor spends with its run's roster (endlessRoster, as buildEndlessFloor does); the rows
 * count the runs whose roster holds each kind, the rooms the actor cap left with budget unspent, and the rooms of
 * "cheap" rosters (no kind of the dearest room cost), and the roster rules break a row too (a spawn outside its
 * roster, a roster that is not swarmers first + the expected size, or that drops a kind of the floor before). Test
 * support only.
 *
 * `unlockFloors` (default true: the DSD9 rule these specs were written for) picks the roster and spender rule; false is
 * every endless world's live rule since docs/DAILY.md DSD18 (docs/NEW_ENEMIES_2.md NX6's census): no unlock floors, only
 * a kind's roomKindMinFloor (the Chainhook's 2, NXD4) holds, in the roster and in every room.
 */
import {
	ENDLESS_FIRST_FLOOR,
	ENDLESS_ROOM_ACTOR_CAP,
	ENDLESS_ROOM_KINDS,
	ROSTER,
	SUMMONERS_PER_ROOM,
	WIDE_BODY_KINDS,
	assignAffixes,
	encounterCost,
	encounterRooms,
	endlessFloorParams,
	endlessRoomSpawns,
	endlessRoster,
	generateDungeon,
	isAffixExcluded,
	isOpenTile,
	roomEncounterBudget,
	roomKindMinFloor,
	rosterTargetSize,
	type Dungeon,
} from "shared/dungeon";

/** One census row: totals over every populated room of one floor across the sampled runs. */
export interface PoolCensusRow {
	readonly floor: number;
	readonly party: number;
	/** The roster / spender rule (see the file comment). */
	readonly unlockFloors: boolean;
	runs: number;
	/** Rooms with a budget (combat / elite, not the entrance or the boss room). */
	rooms: number;
	enemies: number;
	/** Distinct kinds per room, summed over the rooms. */
	distinct: number;
	/** Enemies per kind, in ENDLESS_ROOM_KINDS order. */
	readonly byKind: number[];
	/** Encounter cost of the placed enemies, and the rooms' budgets. */
	cost: number;
	budget: number;
	/** The most of a ENDLESS_ROOM_KINDS kind in one room, in its order. */
	readonly maxPerRoom: number[];
	/** Planned spawns an affix may go on, and those that got one. */
	eligible: number;
	affixed: number;
	/** Runs whose roster on this floor holds each kind (ENDLESS_ROOM_KINDS order). */
	readonly rosterRuns: number[];
	/** Rooms that reached ENDLESS_ROOM_ACTOR_CAP enemies with at least the cheapest cost of budget left. */
	capBound: number;
	/** Rooms of runs whose roster has no kind of the dearest room cost, and their placed cost and budgets. */
	cheapRooms: number;
	cheapCost: number;
	cheapBudget: number;
	/** Rule breaks (see the file comment); the specs expect none. */
	readonly breaks: string[];
}

export function newCensusRow(floor: number, party: number, unlockFloors = true): PoolCensusRow {
	return {
		floor,
		party,
		unlockFloors,
		runs: 0,
		rooms: 0,
		enemies: 0,
		distinct: 0,
		byKind: ENDLESS_ROOM_KINDS.map(() => 0),
		cost: 0,
		budget: 0,
		maxPerRoom: ENDLESS_ROOM_KINDS.map(() => 0),
		eligible: 0,
		affixed: 0,
		rosterRuns: ENDLESS_ROOM_KINDS.map(() => 0),
		capBound: 0,
		cheapRooms: 0,
		cheapCost: 0,
		cheapBudget: 0,
		breaks: [],
	};
}

function kindIndex(kind: string): number {
	for (let i = 0; i < ENDLESS_ROOM_KINDS.size(); i++) if (ENDLESS_ROOM_KINDS[i].kind === kind) return i;
	return -1;
}

/** The dearest and the cheapest encounter cost among the room kinds. */
function costRange(): [number, number] {
	let lo = math.huge;
	let hi = 0;
	for (const k of ENDLESS_ROOM_KINDS) {
		lo = math.min(lo, encounterCost(k.kind));
		hi = math.max(hi, encounterCost(k.kind));
	}
	return [lo, hi];
}

/** The first floor kind row `k` may be on: its minimum floor and, with unlock floors, its unlock floor. */
function kindFloor(k: number, unlockFloors: boolean): number {
	const kind = ENDLESS_ROOM_KINDS[k];
	const min = roomKindMinFloor(kind.kind);
	return unlockFloors ? math.max(min, kind.fromFloor ?? ENDLESS_FIRST_FLOOR) : min;
}

/**
 * The roster rules of run `run` on `floor` (docs/DAILY.md DS1), as rule breaks: swarmers first; as many seeded kinds
 * as the floor wants, or every kind unlocked on it if fewer (an unlocked kind left out could always join); none
 * before its unlock floor (its minimum floor without unlock floors); no duplicate; the roster of the floor before is a
 * prefix (a kind never leaves).
 */
export function rosterBreaks(run: number, floor: number, unlockFloors = true): string[] {
	const out: string[] = [];
	const roster = endlessRoster(run, floor, unlockFloors);
	const where = `run ${run} floor ${floor}`;
	if (roster[0] !== ROSTER.always) out.push(`${where}: roster starts with '${roster[0]}'`);
	let unlocked = 0;
	for (let k = 0; k < ENDLESS_ROOM_KINDS.size(); k++)
		if (ENDLESS_ROOM_KINDS[k].kind !== ROSTER.always && kindFloor(k, unlockFloors) <= floor) unlocked++;
	const want = math.min(rosterTargetSize(floor, ENDLESS_ROOM_KINDS.size() - 1), unlocked);
	if (roster.size() - 1 !== want) out.push(`${where}: ${roster.size() - 1} seeded kinds, want ${want}`);
	for (let i = 0; i < roster.size(); i++) {
		const kind = roster[i];
		const k = kindIndex(kind);
		if (k < 0) out.push(`${where}: roster kind '${kind}' is not a room kind`);
		else if (kindFloor(k, unlockFloors) > floor) out.push(`${where}: roster '${kind}' before its floor`);
		for (let j = 0; j < i; j++) if (roster[j] === kind) out.push(`${where}: roster '${kind}' twice`);
	}
	if (floor > ENDLESS_FIRST_FLOOR) {
		const before = endlessRoster(run, floor - 1, unlockFloors);
		for (let i = 0; i < before.size(); i++)
			if (roster[i] !== before[i]) out.push(`${where}: roster dropped or moved '${before[i]}'`);
	}
	return out;
}

/**
 * Adds floor `row.floor` of run `run` (party `row.party`, rule `row.unlockFloors`) to `row`; `dungeon` is that floor's
 * Forge layout when the caller has it (generated otherwise).
 */
export function censusFloor(row: PoolCensusRow, run: number, dungeon?: Dungeon): void {
	const floor = row.floor;
	const params = endlessFloorParams(run, floor);
	const d = dungeon ?? generateDungeon(params);
	const rooms = encounterRooms(d);
	const roster = endlessRoster(run, floor, row.unlockFloors);
	const spawns = endlessRoomSpawns(d, floor, row.party, roster, row.unlockFloors);
	const affixes = assignAffixes(params.seed, floor, rooms, spawns);
	const [cheapest, dearest] = costRange();
	let rosterDearest = 0;
	for (const kind of roster) rosterDearest = math.max(rosterDearest, encounterCost(kind));
	const cheapRoster = rosterDearest < dearest;
	row.runs++;
	for (let k = 0; k < ENDLESS_ROOM_KINDS.size(); k++)
		if (roster.includes(ENDLESS_ROOM_KINDS[k].kind)) row.rosterRuns[k]++;
	for (const b of rosterBreaks(run, floor, row.unlockFloors)) row.breaks.push(b);
	for (const room of rooms) {
		const budget = roomEncounterBudget(floor, room.type, row.party);
		if (budget <= 0 || room.id === d.entrance || room.id === d.boss) continue;
		row.rooms++;
		row.budget += budget;
		const list = spawns[room.id];
		const counts = ENDLESS_ROOM_KINDS.map(() => 0);
		let roomCost = 0;
		for (let i = 0; i < list.size(); i++) {
			const s = list[i];
			const k = kindIndex(s.kind);
			if (k < 0) {
				row.breaks.push(`run ${run} floor ${floor} room ${room.id}: '${s.kind}' is not a room kind`);
				continue;
			}
			counts[k]++;
			row.enemies++;
			row.byKind[k]++;
			row.cost += encounterCost(s.kind);
			roomCost += encounterCost(s.kind);
			if (!roster.includes(s.kind))
				row.breaks.push(`run ${run} floor ${floor} room ${room.id}: '${s.kind}' outside the roster`);
			const from = kindFloor(k, row.unlockFloors);
			if (floor < from)
				row.breaks.push(`run ${run} floor ${floor} room ${room.id}: '${s.kind}' before floor ${from}`);
			if (WIDE_BODY_KINDS.has(s.kind) && !isOpenTile(d, s))
				row.breaks.push(`run ${run} floor ${floor} room ${room.id}: wide '${s.kind}' beside a wall`);
			if (!isAffixExcluded(s.kind)) row.eligible++;
			if (affixes[room.id][i] !== 0) row.affixed++;
		}
		const firstKind = list.size() > 0 ? kindIndex(list[0].kind) : -1;
		if (firstKind >= 0 && ENDLESS_ROOM_KINDS[firstKind].needsCompany === true)
			row.breaks.push(`run ${run} floor ${floor} room ${room.id}: '${list[0].kind}' is the room's first buy`);
		if (list.size() >= ENDLESS_ROOM_ACTOR_CAP && budget - roomCost >= cheapest) row.capBound++;
		if (cheapRoster) {
			row.cheapRooms++;
			row.cheapCost += roomCost;
			row.cheapBudget += budget;
		}
		for (let k = 0; k < counts.size(); k++) {
			if (counts[k] > 0) row.distinct++;
			row.maxPerRoom[k] = math.max(row.maxPerRoom[k], counts[k]);
			// maxPerRoom counts packs (docs/NEW_ENEMIES_3.md NT5): a pack kind's enemies are packOf each.
			const max = ENDLESS_ROOM_KINDS[k].maxPerRoom;
			if (max !== undefined && counts[k] > max * (ENDLESS_ROOM_KINDS[k].packOf ?? 1))
				row.breaks.push(
					`run ${run} floor ${floor} room ${room.id}: ${counts[k]} '${ENDLESS_ROOM_KINDS[k].kind}'`,
				);
		}
	}
}

/** The census of floors `firstFloor..lastFloor` over run seeds `firstRun..lastRun` for a party of `party`. */
export function poolCensus(
	firstFloor: number,
	lastFloor: number,
	firstRun: number,
	lastRun: number,
	party: number,
): PoolCensusRow[] {
	const rows: PoolCensusRow[] = [];
	for (let floor = firstFloor; floor <= lastFloor; floor++) {
		const row = newCensusRow(floor, party);
		for (let run = firstRun; run <= lastRun; run++) censusFloor(row, run);
		rows.push(row);
	}
	return rows;
}

/**
 * What the census specs check on their rows, as a list of failures (empty: all held): no rule break (the roster rules
 * and spawns outside the roster included), the placed cost within the budget, no kind on a floor below its unlock, at
 * most SUMMONERS_PER_ROOM summoners in a room, no kind placed on a floor where no sampled run's roster holds it, and
 * (with `appears`) every kind that some sampled run's roster holds on a floor placed there. Before the seeded roster
 * `appears` asked for every kind on every floor from its unlock floor on; a roster now keeps most kinds out of the
 * first floors by design (docs/DAILY.md DSD1 / DSD2), so it asks for the kinds the rosters let in.
 */
export function censusViolations(rows: ReadonlyArray<PoolCensusRow>, appears: boolean): string[] {
	const out: string[] = [];
	for (const row of rows) {
		for (const b of row.breaks) out.push(b);
		if (row.cost > row.budget) out.push(`floor ${row.floor}: cost ${row.cost} > budget ${row.budget}`);
		for (let k = 0; k < ENDLESS_ROOM_KINDS.size(); k++) {
			const kind = ENDLESS_ROOM_KINDS[k];
			const from = kindFloor(k, row.unlockFloors);
			if (row.floor < from && row.byKind[k] > 0) out.push(`floor ${row.floor}: ${row.byKind[k]} '${kind.kind}'`);
			if (row.rosterRuns[k] === 0 && row.byKind[k] > 0)
				out.push(`floor ${row.floor}: ${row.byKind[k]} '${kind.kind}' in no roster`);
			if (appears && row.rosterRuns[k] > 0 && row.byKind[k] === 0)
				out.push(`floor ${row.floor}: no '${kind.kind}' (in ${row.rosterRuns[k]} rosters)`);
			if (kind.kind === "summoner" && row.maxPerRoom[k] > SUMMONERS_PER_ROOM)
				out.push(`floor ${row.floor}: ${row.maxPerRoom[k]} summoners in one room`);
		}
	}
	return out;
}

const f2 = (x: number) => string.format("%.2f", x);

/** The census table's header (a Markdown table row; kinds in ENDLESS_ROOM_KINDS order). */
export function censusHeader(): string {
	const kinds = ENDLESS_ROOM_KINDS.map((k) => k.kind).join(" | ");
	return `| floor | rooms | enemies / room | kinds / room | ${kinds} | spent / budget | max summoners | affixed | cap-bound | cheap rosters |`;
}

/** One row as a Markdown table row: means per room, the spent share of the budget, the affixed share. */
export function formatCensusRow(row: PoolCensusRow): string {
	const n = math.max(1, row.rooms);
	const kinds = row.byKind.map((c) => f2(c / n)).join(" | ");
	const summoner = kindIndex("summoner");
	const spent = row.budget > 0 ? row.cost / row.budget : 0;
	const affixed = row.eligible > 0 ? (row.affixed * 100) / row.eligible : 0;
	const capBound = (row.capBound * 100) / n;
	const cheap =
		row.cheapRooms > 0
			? `${row.cheapRooms} rooms, ${string.format("%.0f", (row.cheapCost * 100) / row.cheapBudget)} % spent`
			: "-";
	return (
		`| ${row.floor} | ${row.rooms} | ${f2(row.enemies / n)} | ${f2(row.distinct / n)} | ${kinds} | ${f2(
			row.cost / n,
		)} / ` +
		`${f2(row.budget / n)} (${string.format("%.0f", spent * 100)} %) | ${row.maxPerRoom[summoner]} | ` +
		`${string.format("%.1f", affixed)} % | ${string.format("%.1f", capBound)} % | ${cheap} |`
	);
}

/** The roster table's header: per floor, the share of sampled runs whose roster holds each kind. */
export function rosterHeader(): string {
	const kinds = ENDLESS_ROOM_KINDS.map((k) => k.kind).join(" | ");
	return `| floor | runs | ${kinds} |`;
}

/** One roster row: the percentage of sampled runs whose roster holds each kind on the floor. */
export function formatRosterRow(row: PoolCensusRow): string {
	const n = math.max(1, row.runs);
	const kinds = row.rosterRuns.map((c) => string.format("%.0f %%", (c * 100) / n)).join(" | ");
	return `| ${row.floor} | ${row.runs} | ${kinds} |`;
}

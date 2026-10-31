/**
 * The endless room pool census (docs/ENEMY_VARIANTS.md EV5), shared by the census specs (split over several files:
 * each Forge floor takes about a tenth of a second headless). Per floor: populated rooms, enemies per room by kind,
 * the budget the placed enemies spend, the most summoners in one room, the affixed share (assignAffixes over the same
 * spawns), and rule breaks (a kind below its unlock floor, more of a kind in a room than its maxPerRoom, a wide body
 * on a tile with a non-FLOOR neighbour). Test support only.
 */
import {
	ENDLESS_ROOM_KINDS,
	SUMMONERS_PER_ROOM,
	WIDE_BODY_KINDS,
	assignAffixes,
	encounterCost,
	encounterRooms,
	endlessFloorParams,
	endlessRoomSpawns,
	generateDungeon,
	isAffixExcluded,
	isOpenTile,
	roomEncounterBudget,
} from "shared/dungeon";

/** One census row: totals over every populated room of one floor across the sampled runs. */
export interface PoolCensusRow {
	readonly floor: number;
	readonly party: number;
	runs: number;
	/** Rooms with a budget (combat / elite, not the entrance or the boss room). */
	rooms: number;
	enemies: number;
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
	/** Rule breaks (see the file comment); the specs expect none. */
	readonly breaks: string[];
}

export function newCensusRow(floor: number, party: number): PoolCensusRow {
	return {
		floor,
		party,
		runs: 0,
		rooms: 0,
		enemies: 0,
		byKind: ENDLESS_ROOM_KINDS.map(() => 0),
		cost: 0,
		budget: 0,
		maxPerRoom: ENDLESS_ROOM_KINDS.map(() => 0),
		eligible: 0,
		affixed: 0,
		breaks: [],
	};
}

function kindIndex(kind: string): number {
	for (let i = 0; i < ENDLESS_ROOM_KINDS.size(); i++) if (ENDLESS_ROOM_KINDS[i].kind === kind) return i;
	return -1;
}

/** Adds floor `row.floor` of run `run` (party `row.party`) to `row`. */
export function censusFloor(row: PoolCensusRow, run: number): void {
	const floor = row.floor;
	const params = endlessFloorParams(run, floor);
	const d = generateDungeon(params);
	const rooms = encounterRooms(d);
	const spawns = endlessRoomSpawns(d, floor, row.party);
	const affixes = assignAffixes(params.seed, floor, rooms, spawns);
	row.runs++;
	for (const room of rooms) {
		const budget = roomEncounterBudget(floor, room.type, row.party);
		if (budget <= 0 || room.id === d.entrance || room.id === d.boss) continue;
		row.rooms++;
		row.budget += budget;
		const list = spawns[room.id];
		const counts = ENDLESS_ROOM_KINDS.map(() => 0);
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
			const from = ENDLESS_ROOM_KINDS[k].fromFloor;
			if (from !== undefined && floor < from)
				row.breaks.push(`run ${run} floor ${floor} room ${room.id}: '${s.kind}' before floor ${from}`);
			if (WIDE_BODY_KINDS.has(s.kind) && !isOpenTile(d, s))
				row.breaks.push(`run ${run} floor ${floor} room ${room.id}: wide '${s.kind}' beside a wall`);
			if (!isAffixExcluded(s.kind)) row.eligible++;
			if (affixes[room.id][i] !== 0) row.affixed++;
		}
		for (let k = 0; k < counts.size(); k++) {
			row.maxPerRoom[k] = math.max(row.maxPerRoom[k], counts[k]);
			const max = ENDLESS_ROOM_KINDS[k].maxPerRoom;
			if (max !== undefined && counts[k] > max)
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
 * What the census specs check on their rows, as a list of failures (empty: all held): no rule break, the placed cost
 * within the budget, no kind on a floor below its unlock, at most SUMMONERS_PER_ROOM summoners in a room, and (with
 * `appears`) every kind present on every floor from its unlock floor on.
 */
export function censusViolations(rows: ReadonlyArray<PoolCensusRow>, appears: boolean): string[] {
	const out: string[] = [];
	for (const row of rows) {
		for (const b of row.breaks) out.push(b);
		if (row.cost > row.budget) out.push(`floor ${row.floor}: cost ${row.cost} > budget ${row.budget}`);
		for (let k = 0; k < ENDLESS_ROOM_KINDS.size(); k++) {
			const kind = ENDLESS_ROOM_KINDS[k];
			const from = kind.fromFloor ?? 1;
			if (row.floor < from && row.byKind[k] > 0) out.push(`floor ${row.floor}: ${row.byKind[k]} '${kind.kind}'`);
			if (appears && row.floor >= from && row.byKind[k] === 0) out.push(`floor ${row.floor}: no '${kind.kind}'`);
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
	return `| floor | rooms | enemies / room | ${kinds} | spent / budget | max summoners | affixed |`;
}

/** One row as a Markdown table row: means per room, the spent share of the budget, the affixed share. */
export function formatCensusRow(row: PoolCensusRow): string {
	const n = math.max(1, row.rooms);
	const kinds = row.byKind.map((c) => f2(c / n)).join(" | ");
	const summoner = kindIndex("summoner");
	const spent = row.budget > 0 ? row.cost / row.budget : 0;
	const affixed = row.eligible > 0 ? (row.affixed * 100) / row.eligible : 0;
	return (
		`| ${row.floor} | ${row.rooms} | ${f2(row.enemies / n)} | ${kinds} | ${f2(row.cost / n)} / ` +
		`${f2(row.budget / n)} (${string.format("%.0f", spent * 100)} %) | ${row.maxPerRoom[summoner]} | ` +
		`${string.format("%.1f", affixed)} % |`
	);
}

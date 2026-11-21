/**
 * Test support for specs (never imported by the game): docs/NEW_ENEMIES_3.md NT6's room pool census, like
 * docs/NEW_ENEMIES_2.md NX6's (newEnemies2Census.ts). Per floor over run seeds `firstRun..lastRun`, every endless world's
 * live rule (rosters and the spender without unlock floors, docs/DAILY.md DSD18; the Chainhook's and the Mender's
 * minimum floor 2, NXD4 / NTD7):
 *   solo     shared/dungeon/testing poolCensus's row (enemies, distinct kinds, every kind's count, cost / budget, the rule
 *            breaks: roster rules, maxPerRoom counted in packs, a needsCompany kind bought first, a kind below its
 *            minimum floor), plus the Jackal packs (every room's Jackals one run of JACKAL_PACK_SIZE in its spawn list),
 *            the rooms holding each new kind and the most spawns in one room against ENDLESS_ROOM_ACTOR_CAP
 *   party 4  the most spawns in one room, the rooms at the actor cap, and the worst room's pool slots (poolHighWater.ts
 *            roomLoad)
 * One Forge layout per (floor, run) serves both. Split over shard specs by floors (each row is a whole floor's sample).
 *
 * @module
 */
import {
	ENDLESS_ROOM_ACTOR_CAP,
	ENDLESS_ROOM_KINDS,
	JACKAL_PACK_SIZE,
	encounterRooms,
	endlessFloorParams,
	endlessRoomSpawns,
	endlessRoster,
	generateDungeon,
	roomEncounterBudget,
	roomKindMinFloor,
	type ActorSpawn,
} from "shared/dungeon";
import { censusFloor, censusViolations, newCensusRow, type PoolCensusRow } from "shared/dungeon/testing";
import { POOL_ROOM_TARGET, roomLoad } from "./poolHighWater";

/** The three docs/NEW_ENEMIES_3.md room kinds, in ENDLESS_ROOM_KINDS order (the table's columns). */
export const NT6_KINDS = ["mortar", "mender", "jackal"] as const;

/** The party size of the worst case. */
export const NT6_PARTY = 4;

/**
 * Spec support. One floor's row of the NT6 room pool census: the solo pool census row, the Jackal pack checks and
 * per-kind room counts, plus the party-of-four worst case over the same layouts.
 */
export interface Nt6CensusRow {
	readonly solo: PoolCensusRow;
	/** Solo: Jackal packs over the sample, and rooms whose Jackals are not whole packs of consecutive spawns. */
	packs: number;
	brokenPacks: string[];
	/** Solo: rooms holding at least one of each NT6_KINDS kind. */
	readonly roomsWith: number[];
	/** Solo: the most spawns in one room. */
	maxSpawns: number;
	/** Party 4: the most spawns in one room, the rooms at the actor cap, the rooms and Jackal packs. */
	p4MaxSpawns: number;
	p4CapRooms: number;
	p4Rooms: number;
	p4Packs: number;
	/** Party 4: the most pool slots / alive in one room, where, and what it holds. */
	p4MaxSlots: number;
	p4MaxAlive: number;
	worst: string;
}

function kindsOf(spawns: ReadonlyArray<ActorSpawn>): string {
	const counts = new Map<string, number>();
	const order: string[] = [];
	for (const s of spawns) {
		if (!counts.has(s.kind)) order.push(s.kind);
		counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
	}
	return order.map((k) => `${counts.get(k)} ${k}`).join(", ");
}

/**
 * The Jackal packs in one room's spawn list (in buy order), or undefined when its Jackals are not whole packs: every
 * run of consecutive Jackals a multiple of JACKAL_PACK_SIZE (one buy each).
 */
export function jackalPacks(spawns: ReadonlyArray<ActorSpawn>): number | undefined {
	let packs = 0;
	let i = 0;
	while (i < spawns.size()) {
		if (spawns[i].kind !== "jackal") {
			i++;
			continue;
		}
		let j = i;
		while (j < spawns.size() && spawns[j].kind === "jackal") j++;
		if ((j - i) % JACKAL_PACK_SIZE !== 0) return undefined;
		packs += (j - i) / JACKAL_PACK_SIZE;
		i = j;
	}
	return packs;
}

/** The census rows of floors `firstFloor..lastFloor` (see the file comment). */
export function newEnemies3Census(
	firstFloor: number,
	lastFloor: number,
	firstRun: number,
	lastRun: number,
): Nt6CensusRow[] {
	const out: Nt6CensusRow[] = [];
	for (let floor = firstFloor; floor <= lastFloor; floor++) {
		const row: Nt6CensusRow = {
			solo: newCensusRow(floor, 1, false),
			packs: 0,
			brokenPacks: [],
			roomsWith: NT6_KINDS.map(() => 0),
			maxSpawns: 0,
			p4MaxSpawns: 0,
			p4CapRooms: 0,
			p4Rooms: 0,
			p4Packs: 0,
			p4MaxSlots: 0,
			p4MaxAlive: 0,
			worst: "-",
		};
		for (let run = firstRun; run <= lastRun; run++) {
			const d = generateDungeon(endlessFloorParams(run, floor));
			censusFloor(row.solo, run, d);
			const roster = endlessRoster(run, floor, false);
			const solo = endlessRoomSpawns(d, floor, 1, roster, false);
			const party = endlessRoomSpawns(d, floor, NT6_PARTY, roster, false);
			for (const room of encounterRooms(d)) {
				if (room.id === d.entrance || room.id === d.boss) continue;
				if (roomEncounterBudget(floor, room.type, 1) > 0) {
					const list = solo[room.id];
					row.maxSpawns = math.max(row.maxSpawns, list.size());
					const packs = jackalPacks(list);
					if (packs === undefined) row.brokenPacks.push(`run ${run} floor ${floor} room ${room.id}`);
					else row.packs += packs;
					for (let k = 0; k < NT6_KINDS.size(); k++)
						if (list.some((s) => s.kind === NT6_KINDS[k])) row.roomsWith[k]++;
				}
				if (roomEncounterBudget(floor, room.type, NT6_PARTY) > 0) {
					const list = party[room.id];
					row.p4Rooms++;
					row.p4MaxSpawns = math.max(row.p4MaxSpawns, list.size());
					if (list.size() >= ENDLESS_ROOM_ACTOR_CAP) row.p4CapRooms++;
					const packs = jackalPacks(list);
					if (packs === undefined) row.brokenPacks.push(`party run ${run} floor ${floor} room ${room.id}`);
					else row.p4Packs += packs;
					const load = roomLoad(list);
					row.p4MaxAlive = math.max(row.p4MaxAlive, load.alive);
					if (load.slots > row.p4MaxSlots) {
						row.p4MaxSlots = load.slots;
						row.worst = `run ${run} room ${room.id} ${room.type}: ${kindsOf(list)}`;
					}
				}
			}
		}
		out.push(row);
	}
	return out;
}

function kindIndex(kind: string): number {
	for (let i = 0; i < ENDLESS_ROOM_KINDS.size(); i++) if (ENDLESS_ROOM_KINDS[i].kind === kind) return i;
	return -1;
}

const f2 = (x: number) => string.format("%.2f", x);

/** The table's header (a Markdown row). */
export function nt6CensusHeader(): string {
	return (
		"| floor | rooms | enemies / room | kinds / room | cost / budget | mortars / room (max) | menders / floor " +
		"(rooms) | jackal packs / floor (rooms) | max spawns solo / p4 (p4 rooms at 16) | p4 packs / floor | " +
		"p4 max slots / alive | p4 worst room |"
	);
}

/** One row: solo means per populated room or per floor (per run), then party 4's worst case. */
export function formatNt6CensusRow(row: Nt6CensusRow): string {
	const s = row.solo;
	const n = math.max(1, s.rooms);
	const runs = math.max(1, s.runs);
	const mortar = kindIndex("mortar");
	const mender = kindIndex("mender");
	const p4CapShare = (row.p4CapRooms * 100) / math.max(1, row.p4Rooms);
	return (
		`| ${s.floor} | ${s.rooms} | ${f2(s.enemies / n)} | ${f2(s.distinct / n)} | ` +
		`${f2(s.cost / n)} / ${f2(s.budget / n)} | ${f2(s.byKind[mortar] / n)} (${s.maxPerRoom[mortar]}) | ` +
		`${f2(s.byKind[mender] / runs)} (${row.roomsWith[1]}) | ${f2(row.packs / runs)} (${row.roomsWith[2]}) | ` +
		`${row.maxSpawns} / ${row.p4MaxSpawns} (${string.format("%.1f", p4CapShare)} %) | ` +
		`${f2(row.p4Packs / runs)} | ${row.p4MaxSlots} / ${row.p4MaxAlive} | ${row.worst} |`
	);
}

/** The solo enemies of each new kind over the row's sample (NT6_KINDS order). */
export function nt6Counts(row: Nt6CensusRow): number[] {
	return NT6_KINDS.map((k) => row.solo.byKind[kindIndex(k)]);
}

/** The most of each new kind in one solo room of the row (NT6_KINDS order). */
export function nt6MaxPerRoom(row: Nt6CensusRow): number[] {
	return NT6_KINDS.map((k) => row.solo.maxPerRoom[kindIndex(k)]);
}

/**
 * The census gates on `rows`, as failures (empty: all held): every roster and room rule (shared/dungeon/testing
 * censusViolations, `appears` passed through: every kind some sampled roster holds is placed), whole Jackal packs, no
 * room past ENDLESS_ROOM_ACTOR_CAP spawns (solo or party 4), party 4's worst room under POOL_ROOM_TARGET, and no Mender
 * on floor 1 (NTD7).
 */
export function nt6CensusProblems(rows: ReadonlyArray<Nt6CensusRow>, appears: boolean): string[] {
	const out = censusViolations(
		rows.map((r) => r.solo),
		appears,
	);
	for (const row of rows) {
		const floor = row.solo.floor;
		for (const b of row.brokenPacks) out.push(`broken Jackal pack: ${b}`);
		if (row.maxSpawns > ENDLESS_ROOM_ACTOR_CAP) out.push(`floor ${floor}: ${row.maxSpawns} solo spawns in a room`);
		if (row.p4MaxSpawns > ENDLESS_ROOM_ACTOR_CAP)
			out.push(`floor ${floor}: ${row.p4MaxSpawns} party spawns in a room`);
		if (row.p4MaxSlots >= POOL_ROOM_TARGET) out.push(`floor ${floor}: party worst room ${row.p4MaxSlots} slots`);
		if (floor < roomKindMinFloor("mender") && nt6Counts(row)[1] > 0) out.push(`floor ${floor}: a Mender`);
	}
	return out;
}

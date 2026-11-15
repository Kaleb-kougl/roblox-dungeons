/**
 * Test support for specs (never imported by the game): docs/NEW_ENEMIES_2.md NX6's room pool census, like
 * docs/NEW_ENEMIES.md NE7's. Per floor over run seeds `firstRun..lastRun`, every endless world's live rule (rosters and
 * the spender without unlock floors, docs/DAILY.md DSD18; the Chainhook's minimum floor, NXD4):
 *   solo     shared/dungeon/testing poolCensus's row (enemies, distinct kinds, every kind's count, cost / budget, the rule
 *            breaks: roster rules, maxPerRoom, a needsCompany kind bought first, a kind below its minimum floor)
 *   party 4  the worst room's pool slots (poolHighWater.ts roomLoad: Ooze splits, summons, a Pyre-keeper's 3 pyres)
 * One Forge layout per (floor, run) serves both. Split over shard specs by floors (each row is a whole floor's sample).
 */
import {
	ENDLESS_ROOM_KINDS,
	encounterRooms,
	endlessFloorParams,
	endlessRoomSpawns,
	endlessRoster,
	generateDungeon,
	roomEncounterBudget,
	type ActorSpawn,
} from "shared/dungeon";
import { censusFloor, newCensusRow, type PoolCensusRow } from "shared/dungeon/testing";
import { roomLoad } from "./poolHighWater";

/** The four docs/NEW_ENEMIES_2.md room kinds, in ENDLESS_ROOM_KINDS order (the table's columns). */
export const NX6_KINDS = ["bulwark", "chainhook", "snatcher", "pyrekeeper"] as const;

/** The party size of the worst-case pool slots. */
export const NX6_PARTY = 4;

export interface Nx6CensusRow {
	readonly solo: PoolCensusRow;
	/** Party 4: the most pool slots / alive in one room, where, and what it holds; the rooms holding a Pyre-keeper. */
	maxSlots: number;
	maxAlive: number;
	worst: string;
	keeperRooms: number;
	keeperMaxSlots: number;
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

/** The census rows of floors `firstFloor..lastFloor` (see the file comment). */
export function newEnemies2Census(
	firstFloor: number,
	lastFloor: number,
	firstRun: number,
	lastRun: number,
): Nx6CensusRow[] {
	const out: Nx6CensusRow[] = [];
	for (let floor = firstFloor; floor <= lastFloor; floor++) {
		const row: Nx6CensusRow = {
			solo: newCensusRow(floor, 1, false),
			maxSlots: 0,
			maxAlive: 0,
			worst: "-",
			keeperRooms: 0,
			keeperMaxSlots: 0,
		};
		for (let run = firstRun; run <= lastRun; run++) {
			const d = generateDungeon(endlessFloorParams(run, floor));
			censusFloor(row.solo, run, d);
			const spawns = endlessRoomSpawns(d, floor, NX6_PARTY, endlessRoster(run, floor, false), false);
			for (const room of encounterRooms(d)) {
				if (roomEncounterBudget(floor, room.type, NX6_PARTY) <= 0) continue;
				if (room.id === d.entrance || room.id === d.boss) continue;
				const list = spawns[room.id];
				const load = roomLoad(list);
				row.maxAlive = math.max(row.maxAlive, load.alive);
				if (load.slots > row.maxSlots) {
					row.maxSlots = load.slots;
					row.worst = `run ${run} room ${room.id} ${room.type}: ${kindsOf(list)}`;
				}
				if (load.pyrekeepers > 0) {
					row.keeperRooms++;
					row.keeperMaxSlots = math.max(row.keeperMaxSlots, load.slots);
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
export function nx6CensusHeader(): string {
	return (
		"| floor | rooms | enemies | kinds | bul | cha | sna | pyr | cost / budget | p4 max slots / alive | " +
		"p4 keeper rooms (max slots) | p4 worst room |"
	);
}

/** One row: solo means per populated room, then party 4's worst case. */
export function formatNx6CensusRow(row: Nx6CensusRow): string {
	const s = row.solo;
	const n = math.max(1, s.rooms);
	const kinds = NX6_KINDS.map((k) => f2(s.byKind[kindIndex(k)] / n)).join(" | ");
	return (
		`| ${s.floor} | ${s.rooms} | ${f2(s.enemies / n)} | ${f2(s.distinct / n)} | ${kinds} | ` +
		`${f2(s.cost / n)} / ${f2(s.budget / n)} | ${row.maxSlots} / ${row.maxAlive} | ` +
		`${row.keeperRooms} (${row.keeperMaxSlots}) | ${row.worst} |`
	);
}

/** The most of each new kind in one solo room of the row (NX6_KINDS order). */
export function nx6MaxPerRoom(row: Nx6CensusRow): number[] {
	return NX6_KINDS.map((k) => row.solo.maxPerRoom[kindIndex(k)]);
}

/** The solo enemies of each new kind over the row's sample (NX6_KINDS order). */
export function nx6Counts(row: Nx6CensusRow): number[] {
	return NX6_KINDS.map((k) => row.solo.byKind[kindIndex(k)]);
}

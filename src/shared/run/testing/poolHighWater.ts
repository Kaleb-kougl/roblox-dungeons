/**
 * Test support for specs (never imported by the game): the actor-pool high-water estimate of docs/ENEMY_VARIANTS.md
 * EV13, computed from a real endless floor's planned room spawns (shared/dungeon endlessRoomSpawns, the same call
 * buildEndlessFloor makes), without stepping the sim.
 *
 * Per room, from its bought spawns:
 *   alive  bought + slimes x (splitCount - 1) + summoners x summonMaxAlive: every planned enemy alive at once, every
 *          Ooze already split (its two slimelets replace it) and every summoner at its cap of live summons
 *   slots  alive + slimes (an Ooze's corpse keeps its pool slot for CORPSE_TICKS while its children live) + summoners x
 *          summonPerCast (the corpses of one cast's summons, killed while the next ones are alive): the pool slots a
 *          room can hold at its worst instant (dead bought enemies hold their own slot as corpses, already counted)
 * Per floor: the sum of `alive` over every room (the pool is per floor: rooms the players ran through stay populated).
 * Target (EV13): a room below 48 of MAX_ACTORS 64.
 */
import {
	encounterRooms,
	endlessFloorParams,
	endlessRoomSpawns,
	endlessRoster,
	generateDungeon,
	roomEncounterBudget,
	type ActorSpawn,
} from "shared/dungeon";
import { SLIME, SUMMONER } from "shared/sim";

/** The EV13 target for one room's worst case. */
export const POOL_ROOM_TARGET = 48;

export interface RoomLoad {
	readonly bought: number;
	readonly slimes: number;
	readonly summoners: number;
	readonly alive: number;
	readonly slots: number;
}

/** One room's load from its planned spawns (see the file comment). */
export function roomLoad(spawns: ReadonlyArray<ActorSpawn>): RoomLoad {
	let slimes = 0;
	let summoners = 0;
	for (const s of spawns) {
		if (s.kind === SLIME.id) slimes++;
		else if (s.kind === SUMMONER.id) summoners++;
	}
	const bought = spawns.size();
	const alive = bought + slimes * (SLIME.data.splitCount - 1) + summoners * SUMMONER.data.summonMaxAlive;
	const slots = alive + slimes + summoners * SUMMONER.data.summonPerCast;
	return { bought, slimes, summoners, alive, slots };
}

/** The worst room seen (by slots), where it is and what it holds. */
export interface WorstRoom extends RoomLoad {
	readonly run: number;
	readonly room: number;
	readonly type: string;
	readonly kinds: string;
}

export interface HighWaterRow {
	readonly floor: number;
	readonly party: number;
	runs: number;
	rooms: number;
	bought: number;
	maxBought: number;
	maxAlive: number;
	maxSlots: number;
	/** The most `alive` summed over one floor's rooms. */
	maxFloorAlive: number;
	worst?: WorstRoom;
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

/** Rows for floors firstFloor..lastFloor, run seeds firstRun..lastRun, one row per (floor, party) of `parties`. */
export function poolHighWater(
	firstFloor: number,
	lastFloor: number,
	firstRun: number,
	lastRun: number,
	parties: ReadonlyArray<number>,
): HighWaterRow[] {
	const rows: HighWaterRow[] = [];
	for (let floor = firstFloor; floor <= lastFloor; floor++) {
		const byParty = parties.map(
			(party): HighWaterRow => ({
				floor,
				party,
				runs: 0,
				rooms: 0,
				bought: 0,
				maxBought: 0,
				maxAlive: 0,
				maxSlots: 0,
				maxFloorAlive: 0,
			}),
		);
		for (let run = firstRun; run <= lastRun; run++) {
			// The layout does not depend on the party size: one Forge floor serves every party row.
			const d = generateDungeon(endlessFloorParams(run, floor));
			const rooms = encounterRooms(d);
			const roster = endlessRoster(run, floor);
			for (const row of byParty) {
				const spawns = endlessRoomSpawns(d, floor, row.party, roster);
				row.runs++;
				let floorAlive = 0;
				for (const room of rooms) {
					if (roomEncounterBudget(floor, room.type, row.party) <= 0) continue;
					if (room.id === d.entrance || room.id === d.boss) continue;
					const list = spawns[room.id];
					const load = roomLoad(list);
					row.rooms++;
					row.bought += load.bought;
					row.maxBought = math.max(row.maxBought, load.bought);
					row.maxAlive = math.max(row.maxAlive, load.alive);
					floorAlive += load.alive;
					if (load.slots > row.maxSlots) {
						row.maxSlots = load.slots;
						row.worst = { ...load, run, room: room.id, type: room.type, kinds: kindsOf(list) };
					}
				}
				row.maxFloorAlive = math.max(row.maxFloorAlive, floorAlive);
			}
		}
		for (const row of byParty) rows.push(row);
	}
	return rows;
}

export function highWaterHeader(): string {
	return "| floor | party | rooms | bought / room | max bought | max alive | max slots | worst room (run, room, type: kinds) | max floor alive |";
}

export function formatHighWaterRow(row: HighWaterRow): string {
	const w = row.worst;
	const worst = w !== undefined ? `run ${w.run} room ${w.room} ${w.type}: ${w.kinds}` : "-";
	return (
		`| ${row.floor} | ${row.party} | ${row.rooms} | ${string.format(
			"%.2f",
			row.bought / math.max(1, row.rooms),
		)} | ` + `${row.maxBought} | ${row.maxAlive} | ${row.maxSlots} | ${worst} | ${row.maxFloorAlive} |`
	);
}

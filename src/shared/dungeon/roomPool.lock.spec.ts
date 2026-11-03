// Endless room pool lock (docs/ENEMY_VARIANTS.md EV5): a digest of every deferred room spawn (room id, kind, tile)
// that endlessRoomSpawns gives. The floor 1 digests were recorded BEFORE the room pool learned fromFloor / maxPerRoom
// and the new kinds (imp from floor 2, slime from 4, summoner from 6, EVD2) and must never move: floor 1 spends draw
// for draw as before for every run seed and party size. Deeper floors are pinned informationally: each differs from
// its pre-EV5 digest (the new kinds join), and the as-built digest is pinned to catch later drift.
//
// Re-recorded for the seeded roster (docs/DAILY.md DS1, DSD1: the roster applies to every endless run, so endless room
// spawns change from floor 1 by design). Real floors spend with their run's roster (endlessRoster, as
// buildEndlessFloor does): those digests are pinned as built below. The spender itself did not change: without a
// roster (every unlocked kind open) floor 1 still gives exactly the pre-EV5 spawns, and floors 2-6 the EV5 ones.
//
// Solid decor (docs/DECOR.md "Solid decor") walls tomb and candle cells, so real floors' spawn tiles move: the roster
// digests are re-recorded with it on; the no-roster spender locks run on the floors without it (solidDecor: false).
import { describe, expect, it } from "@rbxts/jest-globals";
import { imul } from "shared/jsmath";
import { endlessFloorParams, endlessRoomSpawns, endlessRoster, generateDungeon, type ActorSpawn } from "shared/dungeon";

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv(h: number, s: string): number {
	for (let i = 1; i <= s.size(); i++) h = imul(bit32.bxor(h, string.byte(s, i)[0]), FNV_PRIME);
	return h;
}

function foldFloor(h: number, rooms: ReadonlyArray<ReadonlyArray<ActorSpawn>>): number {
	for (let id = 0; id < rooms.size(); id++)
		for (const s of rooms[id]) h = fnv(h, `${id}:${s.kind}@${tostring(s.x)},${tostring(s.z)};`);
	return fnv(h, "|");
}

/**
 * Digest of endlessRoomSpawns over run seeds `first..last` on `floor`, one per party size in `parties`; with `roster`
 * each run spends with its seeded roster (a real floor), without it every unlocked kind is open (the pre-roster spender).
 */
function digests(
	floor: number,
	first: number,
	last: number,
	parties: ReadonlyArray<number>,
	roster: boolean,
	solid = true,
): string[] {
	const h = parties.map(() => FNV_OFFSET);
	const n = parties.map(() => 0);
	for (let run = first; run <= last; run++) {
		const d = generateDungeon({ ...endlessFloorParams(run, floor), solidDecor: solid });
		for (let p = 0; p < parties.size(); p++) {
			const rooms = endlessRoomSpawns(d, floor, parties[p], roster ? endlessRoster(run, floor) : undefined);
			h[p] = foldFloor(h[p], rooms);
			for (const r of rooms) n[p] += r.size();
		}
	}
	return parties.map((party, p) => `floor ${floor} party ${party}: ${n[p]} spawns, ${string.format("%08x", h[p])}`);
}

describe("endless room pool lock (EV5)", () => {
	it("no roster: floor 1, run seeds 1-200, party 1-4: the spawns are exactly the pre-EV5 ones", () => {
		const got = digests(1, 1, 200, [1, 2, 3, 4], false, false);
		for (const line of got) print(`[room pool lock] ${line}`);
		expect(got).toEqual([
			"floor 1 party 1: 6504 spawns, 45049506", // check-asset-ids: allow (FNV-1a digest)
			"floor 1 party 2: 8482 spawns, 6d8ba487",
			"floor 1 party 3: 10531 spawns, 59f0b5ec",
			"floor 1 party 4: 12293 spawns, f296e5c0",
		]);
	});

	it("no roster: floors 2-6, run seeds 1-40, solo: each differs from its pre-EV5 digest, pinned as built at EV5", () => {
		// Before EV5 (commit f3e92ca); the new kinds join from floor 2 (imp), so every one of these floors moves.
		const before = [
			"floor 2 party 1: 1517 spawns, a3403803",
			"floor 3 party 1: 1659 spawns, 6f75d8da",
			"floor 4 party 1: 1897 spawns, de42a458",
			"floor 5 party 1: 2051 spawns, 96505152", // check-asset-ids: allow (FNV-1a digest)
			"floor 6 party 1: 2651 spawns, cd348b55",
		];
		const got: string[] = [];
		for (let floor = 2; floor <= 6; floor++) got.push(digests(floor, 1, 40, [1], false, false)[0]);
		for (const line of got) print(`[room pool lock] ${line}`);
		for (let i = 0; i < got.size(); i++) expect(got[i]).never.toBe(before[i]);
		expect(got).toEqual([
			"floor 2 party 1: 1458 spawns, 16d8c4d9",
			"floor 3 party 1: 1557 spawns, 57452b5c",
			"floor 4 party 1: 1692 spawns, ef3fc224",
			"floor 5 party 1: 1830 spawns, ecb0f584",
			"floor 6 party 1: 2281 spawns, 1cde5ea7",
		]);
	});

	it("seeded roster: floor 1, run seeds 1-200, party 1-4 (re-recorded for DSD1, solid decor and room themes)", () => {
		const got = digests(1, 1, 200, [1, 2, 3, 4], true);
		for (const line of got) print(`[room pool lock] roster ${line}`);
		expect(got).toEqual([
			"floor 1 party 1: 7384 spawns, a8cf7f36",
			"floor 1 party 2: 9703 spawns, 57e14ec9",
			"floor 1 party 3: 12003 spawns, ab6b646f",
			"floor 1 party 4: 13885 spawns, fd44a8d2", // check-asset-ids: allow (FNV-1a digest)
		]);
	});

	it("seeded roster: floors 2-6, run seeds 1-40, solo (re-recorded for DSD1, solid decor and room themes)", () => {
		const got: string[] = [];
		for (let floor = 2; floor <= 6; floor++) got.push(digests(floor, 1, 40, [1], true)[0]);
		for (const line of got) print(`[room pool lock] roster ${line}`);
		expect(got).toEqual([
			"floor 2 party 1: 1719 spawns, 3c4d5cbc",
			"floor 3 party 1: 1681 spawns, fceb0f0e",
			"floor 4 party 1: 1910 spawns, d3ba2aae",
			"floor 5 party 1: 1930 spawns, a8146f51",
			"floor 6 party 1: 2466 spawns, 6f1cca84",
		]);
	});
});

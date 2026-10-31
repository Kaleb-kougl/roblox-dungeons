// Endless room pool lock (docs/ENEMY_VARIANTS.md EV5): a digest of every deferred room spawn (room id, kind, tile)
// that endlessRoomSpawns gives. Recorded BEFORE the room pool learned fromFloor / maxPerRoom and the new kinds
// (imp from floor 2, slime from 4, summoner from 6, EVD2). Floor 1 must spend draw for draw as before for every run
// seed and party size; deeper floors are pinned too, informationally (they change once the pool holds new kinds).
import { describe, expect, it } from "@rbxts/jest-globals";
import { imul } from "shared/jsmath";
import { endlessFloorParams, endlessRoomSpawns, generateDungeon, type ActorSpawn } from "shared/dungeon";

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

/** Digest of endlessRoomSpawns over run seeds `first..last` on `floor`, one per party size in `parties`. */
function digests(floor: number, first: number, last: number, parties: ReadonlyArray<number>): string[] {
	const h = parties.map(() => FNV_OFFSET);
	const n = parties.map(() => 0);
	for (let run = first; run <= last; run++) {
		const d = generateDungeon(endlessFloorParams(run, floor));
		for (let p = 0; p < parties.size(); p++) {
			const rooms = endlessRoomSpawns(d, floor, parties[p]);
			h[p] = foldFloor(h[p], rooms);
			for (const r of rooms) n[p] += r.size();
		}
	}
	return parties.map((party, p) => `floor ${floor} party ${party}: ${n[p]} spawns, ${string.format("%08x", h[p])}`);
}

describe("endless room pool lock (EV5)", () => {
	it("floor 1, run seeds 1-200, party 1-4: the spawns are exactly the pre-EV5 ones", () => {
		const got = digests(1, 1, 200, [1, 2, 3, 4]);
		for (const line of got) print(`[room pool lock] ${line}`);
		expect(got).toEqual([
			"floor 1 party 1: 6504 spawns, 45049506", // check-asset-ids: allow (FNV-1a digest)
			"floor 1 party 2: 8482 spawns, 6d8ba487",
			"floor 1 party 3: 10531 spawns, 59f0b5ec",
			"floor 1 party 4: 12293 spawns, f296e5c0",
		]);
	});

	it("floors 2-6, run seeds 1-40, solo: pre-EV5 digests (informational)", () => {
		const got: string[] = [];
		for (let floor = 2; floor <= 6; floor++) got.push(digests(floor, 1, 40, [1])[0]);
		for (const line of got) print(`[room pool lock] ${line}`);
		expect(got).toEqual([
			"floor 2 party 1: 1517 spawns, a3403803",
			"floor 3 party 1: 1659 spawns, 6f75d8da",
			"floor 4 party 1: 1897 spawns, de42a458",
			"floor 5 party 1: 2051 spawns, 96505152", // check-asset-ids: allow (FNV-1a digest)
			"floor 6 party 1: 2651 spawns, cd348b55",
		]);
	});
});

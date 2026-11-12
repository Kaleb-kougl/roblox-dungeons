// The roster rule through the world registry (docs/DAILY.md DSD17, DSD18): the daily, endless and dev worlds' floors buy
// from endlessRoster(seed, floor, false) (no unlock floors), so floor 1 is swarmers plus one seeded kind that may be
// any room kind, and rosterUnlockFloors tells the readers (stage card, forecast) which rule a world uses.
import { describe, expect, it } from "@rbxts/jest-globals";
import { DAILY, DAILY_WORLD_KIND } from "shared/daily";
import { ENDLESS_FIRST_FLOOR, ENDLESS_ROOM_KINDS, endlessRoster } from "shared/dungeon";
import {
	DEV_WORLD_KIND,
	ENDLESS_ROSTER_UNLOCK_FLOORS,
	ENDLESS_WORLD_KIND,
	buildWorldSetup,
	rosterUnlockFloors,
} from "shared/run";

function unlockOf(kind: string): number {
	for (const k of ENDLESS_ROOM_KINDS) if (k.kind === kind) return k.fromFloor ?? ENDLESS_FIRST_FLOOR;
	return -1;
}

/** Every room enemy kind world `kind` plans on floor 1 of run `seed`. */
function floorOneKinds(kind: string, seed: number): Set<string> {
	const setup = buildWorldSetup(kind, seed, { atBossDoor: false });
	const world = setup.config.endless!.worldForFloor(ENDLESS_FIRST_FLOOR);
	const out = new Set<string>();
	for (const room of world.roomSpawns) for (const s of room) out.add(s.kind);
	return out;
}

describe("the roster in the world registry (DSD17, DSD18)", () => {
	it("rosterUnlockFloors: the Daily, endless and dev ignore the unlock floors; the legacy worlds keep them", () => {
		expect(DAILY.rosterUnlockFloors).toBe(false);
		expect(ENDLESS_ROSTER_UNLOCK_FLOORS).toBe(false);
		expect(rosterUnlockFloors(DAILY_WORLD_KIND)).toBe(false);
		expect(rosterUnlockFloors(ENDLESS_WORLD_KIND)).toBe(false);
		expect(rosterUnlockFloors(DEV_WORLD_KIND)).toBe(false);
		expect(rosterUnlockFloors("game")).toBe(true);
	});

	it("floor 1 of the daily and endless worlds buys swarmers plus one seeded kind, any room kind", () => {
		const roomKinds = new Set<string>();
		for (const k of ENDLESS_ROOM_KINDS) roomKinds.add(k.kind);
		const seen = new Set<string>();
		let locked = 0;
		for (let seed = 1; seed <= 60; seed++) {
			const roster = endlessRoster(seed, ENDLESS_FIRST_FLOOR, false);
			expect([seed, roster.size(), roster[0]]).toEqual([seed, 2, "swarmer"]);
			expect([seed, roomKinds.has(roster[1])]).toEqual([seed, true]);
			seen.add(roster[1]);
			if (unlockOf(roster[1]) > ENDLESS_FIRST_FLOOR) locked++;
			if (seed > 6) continue; // building floors is slow: the planned kinds on a few seeds
			for (const world of [ENDLESS_WORLD_KIND, DAILY_WORLD_KIND]) {
				for (const k of floorOneKinds(world, seed)) {
					expect([world, seed, k, roster.includes(k)]).toEqual([world, seed, k, true]);
				}
			}
		}
		// The whole pool takes part: kinds the unlock floors held back until floor 2+ now open runs.
		expect(locked > 0).toBe(true);
		expect(seen.size() >= 8).toBe(true);
	});
});

// The Daily's roster rule through the world registry (docs/DAILY.md DSD17): the daily world's floors buy from
// endlessRoster(seed, floor, false) (no unlock floors), every other endless world from the default roster, and
// rosterUnlockFloors tells the readers (stage card, forecast) which rule a world uses.
import { describe, expect, it } from "@rbxts/jest-globals";
import { DAILY, DAILY_WORLD_KIND } from "shared/daily";
import { ENDLESS_FIRST_FLOOR, ENDLESS_ROOM_KINDS, endlessRoster } from "shared/dungeon";
import { DEV_WORLD_KIND, ENDLESS_WORLD_KIND, buildWorldSetup, rosterUnlockFloors } from "shared/run";

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

describe("the Daily's roster in the world registry (DSD17)", () => {
	it("rosterUnlockFloors: the Daily follows DAILY.rosterUnlockFloors (false), every other world keeps them", () => {
		expect(DAILY.rosterUnlockFloors).toBe(false);
		expect(rosterUnlockFloors(DAILY_WORLD_KIND)).toBe(false);
		expect(rosterUnlockFloors(ENDLESS_WORLD_KIND)).toBe(true);
		expect(rosterUnlockFloors(DEV_WORLD_KIND)).toBe(true);
	});

	it("a daily floor 1 buys a kind floor 1 never unlocks on endless; the same seed's endless floor does not", () => {
		let checked = 0;
		for (let seed = 1; seed <= 200 && checked < 3; seed++) {
			const daily = endlessRoster(seed, ENDLESS_FIRST_FLOOR, false);
			if (unlockOf(daily[1]) <= ENDLESS_FIRST_FLOOR) continue;
			const dailyKinds = floorOneKinds(DAILY_WORLD_KIND, seed);
			for (const k of dailyKinds) expect([seed, k, daily.includes(k)]).toEqual([seed, k, true]);
			const endless = endlessRoster(seed, ENDLESS_FIRST_FLOOR);
			for (const k of floorOneKinds(ENDLESS_WORLD_KIND, seed)) {
				expect([seed, k, endless.includes(k)]).toEqual([seed, k, true]);
				expect([seed, k, unlockOf(k)]).toEqual([seed, k, ENDLESS_FIRST_FLOOR]);
			}
			checked++;
		}
		expect(checked).toBe(3);
	});
});

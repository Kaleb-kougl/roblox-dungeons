// docs/NEW_ENEMIES_2.md NX12-lite (no retune): the four new room enemies measured with the AR13 fighters (shared/run
// testing newEnemies2Tune.ts: characterTune.ts's open arena, god mode, the Knight and the Archer, no build).
//   1. Per-kind rooms (NX12_ROOMS) at floor 11 (Depth 3) hp, seed 1; --census: floors 6 / 11, seeds 1-3.
//   2. --census only: the floor-20 census room of archer.ttk.builds (tuneCensusRoom(20, 1, 10): 15 enemies with two
//      Shieldwalls, a Chainhook, a Pyre-keeper and a Snatcher), whole and with each new kind taken out, seeds 1-2.
//   3. --census only: the Archer on that room with a 480 s cap (the times behind the 180 s timeout).
// Printed: the doc's NX11 / NX12 tables. No bounds beyond "every fight ran": the numbers are for the owner's tuning.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BUILD_TTK_CASES,
	NX12_ROOMS,
	censusRequested,
	formatNx12Row,
	meanTally,
	nx12Fight,
	nx12Header,
	tuneCensusRoom,
	withoutKinds,
	type TuneCharacter,
	type TuneFight,
	type TuneFloor,
} from "shared/run/testing";

const WHO: ReadonlyArray<TuneCharacter> = ["knight", "archer"];
const NO_BUILD = BUILD_TTK_CASES[0];
/** The Archer's census-room cap for item 3 (the AR13 cap is 180 s: the Archer times out there). */
const LONG_CAP_SECONDS = 480;

function ablations(room: TuneFight): TuneFight[] {
	return [
		room,
		withoutKinds(room, ["bulwark"], "- bulwark"),
		withoutKinds(room, ["chainhook"], "- chainhook"),
		withoutKinds(room, ["pyrekeeper"], "- pyrekeeper"),
		withoutKinds(room, ["snatcher"], "- snatcher"),
		withoutKinds(room, ["bulwark", "chainhook", "pyrekeeper", "snatcher"], "- all four"),
	];
}

function rows(
	fights: ReadonlyArray<TuneFight>,
	floors: ReadonlyArray<TuneFloor>,
	seeds: ReadonlyArray<number>,
	who: ReadonlyArray<TuneCharacter> = WHO,
): number {
	let n = 0;
	for (const f of floors)
		for (const fight of fights)
			for (const c of who) {
				const ts = seeds.map((seed) => nx12Fight(fight, NO_BUILD, c, f, seed));
				print(`[nx12] ${formatNx12Row(`f${f.floor} ${fight.label}`, c, meanTally(ts))}`);
				n += ts.size();
			}
	return n;
}

describe("NX12-lite: the new kinds measured (printed)", () => {
	it("per-kind rooms", () => {
		const floors: TuneFloor[] = censusRequested()
			? [
					{ floor: 6, depth: 2 },
					{ floor: 11, depth: 3 },
			  ]
			: [{ floor: 11, depth: 3 }];
		const seeds = censusRequested() ? [1, 2, 3] : [1];
		print(`[nx12] per-kind rooms, seeds ${seeds.join(",")}, mean per fight`);
		print(`[nx12] ${nx12Header()}`);
		expect(rows(NX12_ROOMS, floors, seeds)).toBe(NX12_ROOMS.size() * WHO.size() * floors.size() * seeds.size());
	});

	it("the floor-20 census room, whole and without each new kind (--census)", () => {
		if (!censusRequested()) return;
		const room = tuneCensusRoom(20, 1, 10).fight;
		const fights = ablations(room);
		print(`[nx12] census room f20: ${room.label}`);
		for (const sp of room.spawns) print(`[nx12]   ${sp.kind} affix ${sp.affix}`);
		print(`[nx12] ${nx12Header()}`);
		expect(rows(fights, [{ floor: 20, depth: 4 }], [1, 2])).toBe(fights.size() * WHO.size() * 2);
	});

	it(`the Archer on the floor-20 census room with a ${LONG_CAP_SECONDS} s cap (--census)`, () => {
		if (!censusRequested()) return;
		const room = { ...tuneCensusRoom(20, 1, 10).fight, maxSeconds: LONG_CAP_SECONDS };
		const fights = ablations(room);
		print(`[nx12] ${nx12Header()}`);
		expect(rows(fights, [{ floor: 20, depth: 4 }], [1, 2], ["archer"])).toBe(fights.size() * 2);
	});
});

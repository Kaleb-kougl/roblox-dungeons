// docs/NEW_ENEMIES_3.md NT12-lite (no retune): the Mortar, the Mender and the Jackal measured with shared/run testing
// newEnemies3Tune.ts (AR13's arena fighters and survival bot; NX12-lite's shape).
//   1. Per-kind rooms (NT12_ROOMS), Knight and Archer, no build: floor 11 (Depth 3) hp, seed 1; --census: floors 6 / 11,
//      seeds 1-3. TTK, hits by source, shells and hits a shell, heals and heal per Mender life, lunges / spooks /
//      staggers and hits a lunge.
//   2. Drills (a passive bot, never attacking): a Mortar against a standing / strafing / wandering bot (how often a
//      shell lands on a moving target); a Jackal pack against a bot that faces its nearest Jackal / never turns / faces
//      and guards (the pack's hits). 60 s each; seed 1, --census seeds 1-3.
//   3. --census only: real floors (survivalBot's honest descent, hearts topped up), Knight and Archer, seeds 1-3 to
//      floor 10: room fight time against par by the new kinds a room planned, and the three's tallies on real floors.
//   4. --census only: the floor-20 census room of sim/archer.ttk.builds (tuneCensusRoom(20, 1, 10)), whole and without
//      the three, seeds 1-2 (the loosened Archer allowance, NT6).
// Printed: the doc's NT12 tables. No bounds beyond "every fight ran" and "each kind acted": the numbers are for the
// owner's tuning.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	NT12_JACKAL_DRILL,
	NT12_MORTAR_DRILL,
	NT12_ROOMS,
	censusRequested,
	formatNt12Class,
	formatNt12Row,
	meanNt12,
	mergeNt12Classes,
	nt12ClassHeader,
	nt12Drill,
	nt12Fight,
	nt12Header,
	nt12Survival,
	tuneCensusRoom,
	withoutKinds,
	type Nt12Bot,
	type Nt12Tally,
	type TuneCharacter,
	type TuneFight,
	type TuneFloor,
} from "shared/run/testing";

const WHO: ReadonlyArray<TuneCharacter> = ["knight", "archer"];
const F11: TuneFloor = { floor: 11, depth: 3 };
const DRILL_SECONDS = 60;

function seeds(): number[] {
	return censusRequested() ? [1, 2, 3] : [1];
}

function rows(
	fights: ReadonlyArray<TuneFight>,
	floors: ReadonlyArray<TuneFloor>,
	ss: ReadonlyArray<number>,
): Nt12Tally[] {
	const out: Nt12Tally[] = [];
	for (const f of floors)
		for (const fight of fights)
			for (const c of WHO) {
				const ts = ss.map((seed) => nt12Fight(fight, c, f, seed));
				const m = meanNt12(ts);
				const each = ts.map((t) => (t.seconds < 0 ? "t/o" : string.format("%.1f", t.seconds))).join(" / ");
				print(`[nt12] ${formatNt12Row(`f${f.floor} ${fight.label}`, c, m)} per seed: ${each}`);
				out.push(m);
			}
	return out;
}

describe("NT12-lite: the three measured (printed)", () => {
	it("per-kind rooms", () => {
		const floors: TuneFloor[] = censusRequested() ? [{ floor: 6, depth: 2 }, F11] : [F11];
		print(`[nt12] per-kind rooms, seeds ${seeds().join(",")}, mean per fight`);
		print(`[nt12] ${nt12Header()}`);
		const out = rows(NT12_ROOMS, floors, seeds());
		expect(out.size()).toBe(NT12_ROOMS.size() * WHO.size() * floors.size());
		// Each kind acted somewhere: shells, heals, lunges.
		let shells = 0;
		let heals = 0;
		let lunges = 0;
		for (const t of out) {
			shells += t.shells;
			heals += t.heals;
			lunges += t.lunges;
		}
		expect([shells > 0, heals > 0, lunges > 0]).toEqual([true, true, true]);
	});

	it("drills: shells on a moving bot, the pack against a watching / unturning bot", () => {
		print(`[nt12] drills, ${DRILL_SECONDS} s, seeds ${seeds().join(",")}, mean per drill (floor 11 hp)`);
		print(`[nt12] ${nt12Header()}`);
		const drill = (fight: TuneFight, bot: Nt12Bot): Nt12Tally => {
			const m = meanNt12(seeds().map((seed) => nt12Drill(fight, bot, F11, seed, DRILL_SECONDS)));
			print(`[nt12] ${formatNt12Row(`${fight.label} ${bot}`, "knight", m)}`);
			return m;
		};
		const stand = drill(NT12_MORTAR_DRILL, "stand");
		drill(NT12_MORTAR_DRILL, "strafe");
		drill(NT12_MORTAR_DRILL, "wander");
		const watch = drill(NT12_JACKAL_DRILL, "watch");
		const fixed = drill(NT12_JACKAL_DRILL, "fixed");
		drill(NT12_JACKAL_DRILL, "guard");
		expect(stand.shells > 0).toBe(true);
		expect(fixed.lunges > 0).toBe(true);
		expect(watch.hitsBy[2] <= fixed.hitsBy[2]).toBe(true);
	});

	it("real floors: room time against par by the new kinds (--census)", () => {
		if (!censusRequested()) return;
		const maxFloor = 10;
		print(`[nt12] real floors 1-${maxFloor}, seeds 1-3, hearts topped up`);
		for (const c of WHO) {
			const runs = [1, 2, 3].map((seed) => nt12Survival(seed, c, maxFloor));
			print(`[nt12] ${nt12ClassHeader()}`);
			for (const cl of mergeNt12Classes(runs)) print(`[nt12] ${formatNt12Class(c, cl)}`);
			print(`[nt12] ${nt12Header()}`);
			print(`[nt12] ${formatNt12Row("real floors (sum of 3 runs / 3)", c, meanNt12(runs.map((r) => r.tally)))}`);
			expect(runs.size()).toBe(3);
		}
	});

	it("the floor-20 census room, whole and without the three (--census)", () => {
		if (!censusRequested()) return;
		const room = tuneCensusRoom(20, 1, 10).fight;
		print(`[nt12] census room f20: ${room.label}`);
		for (const sp of room.spawns) print(`[nt12]   ${sp.kind} affix ${sp.affix}`);
		const fights = [room, withoutKinds(room, ["mortar", "mender", "jackal"], "- the three")];
		print(`[nt12] ${nt12Header()}`);
		const out = rows(fights, [{ floor: 20, depth: 4 }], [1, 2]);
		expect(out.size()).toBe(fights.size() * WHO.size());
	});
});

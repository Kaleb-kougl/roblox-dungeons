// Player bullet high-water with the heaviest builds (docs/BUILDS.md BU13 item 2): solo and a party of 4, the densest
// room of an EV13 worst floor (solo: run 12 floor 19, 40 actor slots; party 4: run 17 floor 14, 43 slots:
// docs/ENEMY_VARIANTS.md "Actor-pool high-water") and of run 1 floor 6 (enemies that die fast enough to cascade) with its planned affixes, as an open endless arena (no wall ends a
// bullet early: the pool's worst case), that floor's hp (Depth = the bosses on the way, the party multiplier), every
// player with the build, SIM_SECONDS of combat in god mode with the TTK bots (rolls every 1.5 s) (shared/run/testing
// buildTune.ts buildPoolRun). Printed: the table in the doc. Asserted: the BU3 reserve rule: no weapon shot is ever
// dropped (every drop is an effect bullet the budget refused, the enemy pool never full), and the pool never holds
// more than its capacity.
import { describe, expect, it } from "@rbxts/jest-globals";
import { POOL_CASES, TUNE_POOL_CAPACITY, buildPoolRun, formatPoolRow, poolHeader } from "shared/run/testing";

const SIM_SECONDS = 40;
/** (party, run seed, floor). */
const SCENARIOS: ReadonlyArray<readonly [number, number, number]> = [
	[1, 12, 19],
	[4, 17, 14],
	// Shallow floor, where whole rooms die in a cascade (the most effect bullets at once): run 1 floor 6's densest room.
	[1, 1, 6],
	[4, 1, 6],
];

describe(`builds: player bullet high-water (${SIM_SECONDS} s, god mode)`, () => {
	for (const [party, seed, floor] of SCENARIOS) {
		it(`party ${party}, run ${seed} floor ${floor}: no weapon shot dropped (printed)`, () => {
			print(`[builds tune] pool, party ${party} (capacity ${TUNE_POOL_CAPACITY.player})`);
			print(`[builds tune] ${poolHeader()}`);
			for (const c of POOL_CASES) {
				const r = buildPoolRun(seed, floor, party, c, SIM_SECONDS);
				print(`[builds tune] ${formatPoolRow(c.label, seed, floor, party, r)}`);
				expect([c.label, r.maxEnemyBullets < TUNE_POOL_CAPACITY.enemy]).toEqual([c.label, true]);
				expect([c.label, r.otherDropped]).toEqual([c.label, 0]);
				expect([c.label, r.maxPlayerBullets <= TUNE_POOL_CAPACITY.player]).toEqual([c.label, true]);
			}
		});
	}
});

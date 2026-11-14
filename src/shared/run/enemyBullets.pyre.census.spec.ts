// Enemy bullet peak with pyres (docs/NEW_ENEMIES_2.md NX6, like docs/NEW_ENEMIES.md NE7's run/enemyBullets.census.spec):
// floors 2-20, each floor's dearest room that holds a Pyre-keeper over solo run seeds 1-60 (--census; by default runs
// 1-20 on floors 2 / 6 / 10 / 14 / 20) with the live roster rule, with
// its planned affixes, as an open arena fight at that floor's hp (shared/run/testing buildTune.ts item 4), 20 s in god
// mode, solo. The passive bot never attacks, so the keeper lights its 3 pyres (the cap) and keeps them: the room's worst
// case; the sword bot walks in and swings. Printed: the doc's table (peak / mean bullets, the most pyres at once).
// Loose bounds only: the enemy pool never fills (nothing dropped, the peak below ENEMY_BULLET_CAPACITY), and the passive
// fight reaches the keeper's cap of pyres on some floor.
import { describe, expect, it } from "@rbxts/jest-globals";
import { ENEMY_BULLET_CAPACITY, PYREKEEPER } from "shared/sim";
import { censusRequested, dearestRoom, enemyBulletPeak } from "shared/run/testing";

const SECONDS = 20;
const FIRST_RUN = 1;
/** Run seeds 1-60 and every floor 2-20 with --census; the default sample: runs 1-20, five floors. */
const FULL_LAST_RUN = 60;
const QUICK_LAST_RUN = 20;
const QUICK_FLOORS = [2, 6, 10, 14, 20];
const LAST_RUN = censusRequested() ? FULL_LAST_RUN : QUICK_LAST_RUN;

describe(`enemy bullet peak with pyres (dearest Pyre-keeper room of solo runs ${FIRST_RUN}-${LAST_RUN}, ${SECONDS} s, god mode)`, () => {
	it("the enemy pool never fills; the passive fight reaches 3 pyres (printed)", () => {
		const floors: number[] = [];
		if (censusRequested()) for (let f = 2; f <= 20; f++) floors.push(f);
		else for (const f of QUICK_FLOORS) floors.push(f);
		print(
			`[pyre census] | floor | room | cost | passive peak / mean (pyres) | sword peak / mean (pyres) | sword cleared s |`,
		);
		print(`[pyre census] |---|---|---|---|---|---|`);
		let mostPyres = 0;
		for (const floor of floors) {
			const room = dearestRoom(floor, FIRST_RUN, LAST_RUN, PYREKEEPER.id);
			if (room === undefined) {
				print(`[pyre census] | ${floor} | none | - | - | - | - |`);
				continue;
			}
			const passive = enemyBulletPeak(room.fight, floor, room.run, SECONDS, false);
			const sword = enemyBulletPeak(room.fight, floor, room.run, SECONDS, true);
			mostPyres = math.max(mostPyres, passive.pyres);
			print(
				`[pyre census] | ${floor} | run ${room.run} room ${room.room} (${room.kinds}) | ${room.cost} | ` +
					`${passive.peak} / ${string.format("%.1f", passive.mean)} (${passive.pyres}) | ${sword.peak} / ` +
					`${string.format("%.1f", sword.mean)} (${sword.pyres}) | ${
						sword.cleared < 0 ? "no" : string.format("%.1f", sword.cleared)
					} |`,
			);
			expect([floor, passive.dropped, sword.dropped]).toEqual([floor, 0, 0]);
			expect(passive.peak < ENEMY_BULLET_CAPACITY).toBe(true);
			expect(passive.pyres <= PYREKEEPER.data.maxAlive).toBe(true);
		}
		expect(mostPyres).toBe(PYREKEEPER.data.maxAlive);
	});
});

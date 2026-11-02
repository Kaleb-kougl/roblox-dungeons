// Enemy bullet peak per floor (docs/NEW_ENEMIES.md NE7's census, the "bullets alive peak" column): floors 2-20, each
// floor's dearest room (encounter cost) over solo run seeds 1-20 with its planned affixes, as an open arena fight at
// that floor's hp (shared/run/testing buildTune.ts item 4), 20 s in god mode, solo. Two bots: "passive" (aims, strafes,
// rolls, never attacks: nothing dies, the room's worst case) and "sword" (walks in and swings). Printed: the table in
// the report. Loose bounds only: the enemy pool never fills (nothing dropped, the peak below ENEMY_BULLET_CAPACITY).
import { describe, expect, it } from "@rbxts/jest-globals";
import { ENEMY_BULLET_CAPACITY } from "shared/sim";
import { dearestRoom, enemyBulletPeak } from "shared/run/testing";

const SECONDS = 20;
const FIRST_RUN = 1;
const LAST_RUN = 20;

describe(`enemy bullet peak per floor (dearest room of solo runs ${FIRST_RUN}-${LAST_RUN}, ${SECONDS} s, god mode)`, () => {
	it("floors 2-20: the enemy pool never fills (printed)", () => {
		print(`[bullet census] | floor | room | cost | passive peak / mean | sword peak / mean | sword cleared s |`);
		print(`[bullet census] |---|---|---|---|---|---|`);
		for (let floor = 2; floor <= 20; floor++) {
			const room = dearestRoom(floor, FIRST_RUN, LAST_RUN);
			const passive = enemyBulletPeak(room.fight, floor, room.run, SECONDS, false);
			const sword = enemyBulletPeak(room.fight, floor, room.run, SECONDS, true);
			print(
				`[bullet census] | ${floor} | run ${room.run} room ${room.room} (${room.kinds}) | ${room.cost} | ` +
					`${passive.peak} / ${string.format("%.1f", passive.mean)} | ${sword.peak} / ` +
					`${string.format("%.1f", sword.mean)} | ${
						sword.cleared < 0 ? "no" : string.format("%.1f", sword.cleared)
					} |`,
			);
			expect([floor, passive.dropped, sword.dropped]).toEqual([floor, 0, 0]);
			expect(passive.peak < ENEMY_BULLET_CAPACITY).toBe(true);
		}
	});
});

// Actor-pool high-water estimate, floors 11-20 (docs/ENEMY_VARIANTS.md EV13): run seeds 1-20, solo and party 4, from
// each real floor's planned room spawns (shared/run/testing poolHighWater.ts: bought + every Ooze split + every
// summoner at 3 live summons, and the pool slots with corpses). Target: no room above 48 of MAX_ACTORS 64. Printed:
// the table in the doc. Floors 1-10 and 11-20 are separate files (each Forge floor takes about a tenth of a second).
import { describe, expect, it } from "@rbxts/jest-globals";
import { POOL_ROOM_TARGET, formatHighWaterRow, highWaterHeader, poolHighWater } from "shared/run/testing";

describe("actor-pool high-water, floors 11-20 (run seeds 1-20, solo and party 4)", () => {
	it("no room's worst case reaches 48 pool slots (printed)", () => {
		const rows = poolHighWater(11, 20, 1, 20, [1, 4]);
		print("[pool high-water] floors 11-20, run seeds 1-20");
		print(`[pool high-water] ${highWaterHeader()}`);
		for (const row of rows) print(`[pool high-water] ${formatHighWaterRow(row)}`);
		for (const row of rows) {
			expect([row.floor, row.party, row.maxSlots < POOL_ROOM_TARGET]).toEqual([row.floor, row.party, true]);
		}
	});
});

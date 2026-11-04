// The Goldling in the floor's vault room (docs/FORTUNE.md GE2 x docs/TREASURE.md TR2): the chest is a breakables piece
// (kind CHEST) that never breaks, so the Goldling's flee field treats its cell as blocked for the whole floor (the walk
// mask still has it: it is a FLOOR cell of the grid), no spawn tile (the Goldling's included) is on it, and no damage
// ever turns it into a broken piece the field would reopen.
import { describe, expect, it } from "@rbxts/jest-globals";
import { gridToWorld } from "shared/dungeon";
import {
	BreakableKind,
	BreakableSource,
	NOT_BROKEN,
	createSimState,
	damageBreakable,
	goldenBoxCell,
	goldenField,
} from "shared/sim";
import { buildEndlessRunConfig } from "shared/run";
import { skipToFloor } from "shared/run/testing";

/** The first (run seed, floor) solo whose Goldling room is its vault room. */
function findFloor(): [number, number] {
	for (let seed = 1; seed <= 300; seed++) {
		const setup = buildEndlessRunConfig(seed);
		for (let floor = 2; floor <= 9; floor++) {
			const w = setup.endlessFloor(floor);
			if (w.golden !== undefined && w.vault !== undefined && w.golden.room === w.vault.room) return [seed, floor];
		}
	}
	error("no floor whose Goldling room is its vault room (seeds 1-300, floors 2-9)", 0);
}

describe("the Goldling and the vault's chest (golden x treasure)", () => {
	it("the chest's cell is blocked in the flee field, never a spawn tile, and never breaks", () => {
		const [seed, floor] = findFloor();
		const setup = buildEndlessRunConfig(seed);
		const s = createSimState(seed, setup.spawn!.x, setup.spawn!.z, setup.config);
		skipToFloor(s, setup.config, floor);
		const w = setup.endlessFloor(floor);
		const g = s.golden!;
		const t = s.treasure!;
		const b = s.breakables!;
		const chest = b.pieces[t.slot];
		expect([chest.kind, chest.brokenTick]).toEqual([BreakableKind.CHEST, NOT_BROKEN]);
		const cx = gridToWorld(chest.x);
		const cz = gridToWorld(chest.y);
		const cell = goldenBoxCell(g, cx, cz);
		expect(cell >= 0).toBe(true);
		expect(g.floor!.walk[cell]).toBe(1); // a FLOOR cell of the room's walk mask
		expect(goldenField(s, g)!.open[cell]).toBe(0); // but blocked: an intact piece
		// no spawn tile of the room (the Goldling appears on one) is the chest's cell
		for (const tile of w.roomSpawnTiles![w.golden!.room])
			expect(goldenBoxCell(g, tile.x, tile.z) === cell).toBe(false);
		// every damage source leaves it intact (no break, no bookkeeping): the field never reopens the cell
		const intact = b.intact;
		for (const src of [
			BreakableSource.MELEE,
			BreakableSource.PLAYER_BULLET,
			BreakableSource.ENEMY_BULLET,
			BreakableSource.SLAM,
		]) {
			expect(damageBreakable(s, t.slot, 1e6, src)).toBe(false);
		}
		expect([chest.brokenTick, b.intact]).toEqual([NOT_BROKEN, intact]);
		expect(goldenField(s, g)!.open[cell]).toBe(0);
	});
});

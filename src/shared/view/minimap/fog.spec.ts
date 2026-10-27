// Minimap fog (docs/MINIMAP.md M3): standing still makes no dirty cells; a step dims and lights rings; a 5-tile jump
// lights what the tiles between saw (a teleport does not); entering a room reveals all its cells in the same update;
// two sources reveal their union; dead players are not sources; the frontier at a corridor end, cleared when the far
// side is seen; seedFromState on an endless state; reset and a new floor start fresh. Then the endless bot walks floor
// 1 of run 1337 to its stairwell and the share of floor seen is printed.
import { describe, expect, it } from "@rbxts/jest-globals";
import { gridToWorld, type WorldXZ } from "shared/dungeon";
import { buildEndlessRunConfig } from "shared/run";
import { Driver } from "shared/run/testing";
import { archetypeIndex, createSimState, type SimState } from "shared/sim";
import { FogOfWar, FogState, MapTile, minimapTiles, type FogSource, type MinimapTiles } from "shared/view";
import { specDungeon, specField } from "./testing";

function pos(gx: number, gy: number): WorldXZ {
	return { x: gridToWorld(gx), z: gridToWorld(gy) };
}

function at(t: MinimapTiles, x: number, y: number): number {
	return y * t.W + x;
}

function countState(fog: FogOfWar, t: MinimapTiles, s: number): number {
	let n = 0;
	for (let c = 0; c < t.W * t.H; c++) if (fog.state(c) === s) n++;
	return n;
}

/** A copy of the dirty list (the drained array is reused). */
function drain(fog: FogOfWar): number[] {
	const out: number[] = [];
	for (const c of fog.drainDirty()) out.push(c);
	return out;
}

describe("FogOfWar", () => {
	it("starts UNKNOWN with nothing dirty; standing still makes no dirty cells", () => {
		const t = minimapTiles(specField(41, 41));
		const fog = new FogOfWar(t, { sightTiles: 5 });
		expect(countState(fog, t, FogState.UNKNOWN)).toBe(41 * 41);
		expect(drain(fog).size()).toBe(0);
		fog.update([pos(20, 20)]);
		const first = drain(fog);
		expect(first.size() > 0).toBe(true);
		expect(countState(fog, t, FogState.IN_SIGHT)).toBe(81); // lattice points within r = 5
		fog.update([pos(20, 20)]);
		expect(drain(fog).size()).toBe(0);
		// a move inside the same tile is no change either
		fog.update([{ x: 20.3, z: 19.7 }]);
		expect(drain(fog).size()).toBe(0);
	});

	it("a step dims the trailing ring and lights the leading one; only changed cells are dirty", () => {
		const t = minimapTiles(specField(41, 41));
		const fog = new FogOfWar(t, { sightTiles: 5 });
		fog.update([pos(20, 20)]);
		drain(fog);
		const n = t.W * t.H;
		const stateBefore: number[] = [];
		const frontierBefore: boolean[] = [];
		for (let c = 0; c < n; c++) {
			stateBefore.push(fog.state(c));
			frontierBefore.push(fog.isFrontier(c));
		}
		fog.update([pos(21, 20)]);
		const dirty = drain(fog);
		let dimmed = 0;
		let lit = 0;
		let frontierFlips = 0;
		for (let c = 0; c < n; c++) {
			const x = c % t.W;
			const y = math.floor(c / t.W);
			const fromOld = (x - 20) * (x - 20) + (y - 20) * (y - 20) <= 25;
			const fromNew = (x - 21) * (x - 21) + (y - 20) * (y - 20) <= 25;
			const stateChanged = fog.state(c) !== stateBefore[c];
			const frontierChanged = fog.isFrontier(c) !== frontierBefore[c];
			// exactly the changed cells are dirty, each once
			expect(dirty.includes(c)).toBe(stateChanged || frontierChanged);
			if (frontierChanged) frontierFlips++;
			if (!stateChanged) {
				expect(fromOld === fromNew || fromNew).toBe(true);
				continue;
			}
			expect(fromOld !== fromNew).toBe(true);
			if (fromOld) {
				expect(fog.state(c)).toBe(FogState.REMEMBERED);
				dimmed++;
			} else {
				expect(fog.state(c)).toBe(FogState.IN_SIGHT);
				lit++;
			}
		}
		const unique = new Set<number>();
		for (const c of dirty) unique.add(c);
		expect(unique.size()).toBe(dirty.size());
		print(
			`[minimap] one step at r = 5: ${dimmed} dimmed, ${lit} lit, ${frontierFlips} frontier flips, ` +
				`${dirty.size()} dirty`,
		);
		expect(dimmed).toBe(lit);
		expect(dimmed > 0).toBe(true);
		expect(countState(fog, t, FogState.IN_SIGHT)).toBe(81);
	});

	it("a 5-tile jump lights what the tiles between saw; a jump past teleportTiles does not", () => {
		const t = minimapTiles(specField(41, 41));
		const between = at(t, 12, 22); // within 2 of (12, 20) only: not of (10, 20) nor (15, 20)
		const fog = new FogOfWar(t, { sightTiles: 2, teleportTiles: 8 });
		fog.update([pos(10, 20)]);
		fog.update([pos(15, 20)]);
		expect(fog.state(between)).toBe(FogState.REMEMBERED);
		expect(fog.state(at(t, 15, 22))).toBe(FogState.IN_SIGHT);
		expect(fog.state(at(t, 10, 22))).toBe(FogState.REMEMBERED);

		const far = new FogOfWar(t, { sightTiles: 2, teleportTiles: 4 });
		far.update([pos(10, 20)]);
		far.update([pos(15, 20)]);
		expect(far.state(between)).toBe(FogState.UNKNOWN);
	});

	it("stepping into a room reveals all its cells and wall ring in the same update", () => {
		// prettier-ignore
		const d = specDungeon([
			"###########     ",
			"#AAAAAAAAA#     ",
			"#AAAAAAAAA#     ",
			"#AAAAAAAAA#     ",
			"#AAAAAAAAA######",
			"#AAAAAAAAA......",
			"#AAAAAAAAA######",
			"###########     ",
		]);
		const t = minimapTiles(d);
		const fog = new FogOfWar(t, { sightTiles: 2 });
		fog.update([pos(14, 5)]);
		expect(fog.roomRevealed(0)).toBe(false);
		expect(fog.state(at(t, 1, 1))).toBe(FogState.UNKNOWN);
		fog.update([pos(9, 5)]);
		expect(fog.roomRevealed(0)).toBe(true);
		for (const c of t.roomCells[0]) expect(fog.state(c) !== FogState.UNKNOWN).toBe(true);
		expect(fog.state(at(t, 1, 1))).toBe(FogState.REMEMBERED);
		expect(fog.state(at(t, 9, 4))).toBe(FogState.IN_SIGHT);
		expect(fog.state(at(t, 0, 0))).toBe(FogState.REMEMBERED);
	});

	it("revealRoom shows a room once; walls deep in rock are never part of it", () => {
		// prettier-ignore
		const d = specDungeon([
			"#######",
			"#######",
			"##AAA##",
			"#######",
			"#######",
		]);
		const t = minimapTiles(d);
		const fog = new FogOfWar(t);
		fog.revealRoom(0);
		expect(drain(fog).size()).toBe(t.roomCells[0].size());
		expect(fog.state(at(t, 0, 0))).toBe(FogState.UNKNOWN);
		fog.revealRoom(0);
		expect(drain(fog).size()).toBe(0);
		fog.revealRoom(7); // out of range: ignored
		expect(drain(fog).size()).toBe(0);
	});

	it("two sources reveal their union; a dead player (false) is not a source", () => {
		const t = minimapTiles(specField(61, 21));
		const a = pos(10, 10);
		const b = pos(40, 10);
		const both = new FogOfWar(t, { sightTiles: 4 });
		both.update([a, b]);
		const one = new FogOfWar(t, { sightTiles: 4 });
		one.update([a]);
		const other = new FogOfWar(t, { sightTiles: 4 });
		other.update([false, b]);
		for (let c = 0; c < t.W * t.H; c++) {
			const want = math.max(one.state(c), other.state(c));
			if (both.state(c) !== want) error(`cell ${c}: ${both.state(c)}, union ${want}`);
		}
		expect(countState(both, t, FogState.IN_SIGHT)).toBe(2 * 49);
		// b dies: its cells are remembered, a's stay in sight
		drain(both);
		both.update([a, false]);
		expect(countState(both, t, FogState.IN_SIGHT)).toBe(49);
		expect(both.state(at(t, 40, 10))).toBe(FogState.REMEMBERED);
		expect(both.state(at(t, 10, 10))).toBe(FogState.IN_SIGHT);
		expect(drain(both).size()).toBe(49);
		// a slot past the end of the list is absent too
		both.update([a]);
		expect(drain(both).size()).toBe(0);
		// overlapping sources: a cell lit by both stays lit when one leaves
		const overlap = new FogOfWar(t, { sightTiles: 4 });
		overlap.update([pos(20, 10), pos(22, 10)]);
		overlap.update([pos(20, 10), false]);
		expect(overlap.state(at(t, 21, 10))).toBe(FogState.IN_SIGHT);
		expect(overlap.state(at(t, 26, 10))).toBe(FogState.REMEMBERED);
	});

	it("the frontier: a seen corridor end next to unknown floor, cleared when the far side is seen", () => {
		// a 1-wide corridor, 30 long
		const rows = ["#".rep(32), "#" + ".".rep(30) + "#", "#".rep(32)];
		const t = minimapTiles(specDungeon(rows, 0, -1));
		const fog = new FogOfWar(t, { sightTiles: 4 });
		fog.update([pos(1, 1)]);
		const tip = at(t, 5, 1);
		expect(fog.state(tip)).toBe(FogState.IN_SIGHT);
		expect(fog.isFrontier(tip)).toBe(true);
		expect(fog.isFrontier(at(t, 4, 1))).toBe(false);
		expect(fog.isFrontier(at(t, 1, 1))).toBe(false);
		// walls never are
		expect(fog.isFrontier(at(t, 5, 0))).toBe(false);
		drain(fog);
		fog.update([pos(3, 1)]);
		const dirty = drain(fog);
		expect(fog.isFrontier(tip)).toBe(false);
		expect(dirty.includes(tip)).toBe(true);
		expect(fog.isFrontier(at(t, 7, 1))).toBe(true);
		let count = 0;
		for (let c = 0; c < t.W * t.H; c++) if (fog.isFrontier(c)) count++;
		expect(count).toBe(1);
	});

	it("seedFromState: rooms entered, scored rooms engaged and an awake boss's room", () => {
		const setup = buildEndlessRunConfig(1337);
		const spawn = setup.spawn!;
		const state = createSimState(1337, spawn.x, spawn.z, setup.config);
		const floor = setup.endlessFloor(1);
		const t = minimapTiles(floor.dungeon, floor.layout.stairwell);
		const entered = state.endless!.roomsEntered;
		expect(entered.size()).toBe(t.roomCells.size());
		const rooms = state.score!.rooms;
		expect(rooms.size() > 0).toBe(true);
		// state surgery: room 1 entered, the first score record's room engaged
		const engaged = rooms[0].room;
		const enteredRoom = engaged === 1 ? 2 : 1;
		entered[enteredRoom] = 1;
		rooms[0].engageTick = 5;
		const fog = new FogOfWar(t);
		fog.seedFromState(state);
		for (let r = 0; r < t.roomCells.size(); r++) {
			const want = r === enteredRoom || r === engaged || entered[r] === 1;
			expect(fog.roomRevealed(r)).toBe(want);
		}
		for (const c of t.roomCells[enteredRoom]) expect(fog.state(c)).toBe(FogState.REMEMBERED);
		expect(drain(fog).size() > 0).toBe(true);

		// an awake boss (phase > 0) reveals the boss room; a dormant one does not
		// prettier-ignore
		const d = specDungeon([
			"########",
			"#AA##BB#",
			"#AA##BB#",
			"########",
		], 2, 1);
		const bt = minimapTiles(d);
		const boss = archetypeIndex("boss.act1");
		const fake = (phase: number) =>
			({ combat: { actors: [{ kind: boss, alive: 1, phase }] } } as unknown as SimState);
		const dormant = new FogOfWar(bt);
		dormant.seedFromState(fake(0));
		expect(dormant.roomRevealed(1)).toBe(false);
		const awake = new FogOfWar(bt);
		awake.seedFromState(fake(1));
		expect(awake.roomRevealed(1)).toBe(true);
		expect(awake.roomRevealed(0)).toBe(false);
	});

	it("a floor change starts fresh: reset() clears everything (dirtying what was known), a new floor's fog is empty", () => {
		const t = minimapTiles(specField(21, 21));
		const fog = new FogOfWar(t, { sightTiles: 3 });
		fog.update([pos(10, 10)]);
		drain(fog);
		const known = 21 * 21 - countState(fog, t, FogState.UNKNOWN);
		fog.reset();
		expect(countState(fog, t, FogState.UNKNOWN)).toBe(21 * 21);
		expect(drain(fog).size()).toBe(known);
		// the same source again after the reset lights again (its last tile was forgotten)
		fog.update([pos(10, 10)]);
		expect(countState(fog, t, FogState.IN_SIGHT)).toBe(29);
		const fresh = new FogOfWar(minimapTiles(specField(15, 15)));
		expect(drain(fresh).size()).toBe(0);
	});
});

describe("FogOfWar on a real floor", () => {
	it("the endless bot walks floor 1 of run 1337 to its stairwell: the share of floor seen", () => {
		const setup = buildEndlessRunConfig(1337);
		const drv = new Driver(setup, 1337);
		const world = drv.world();
		const t = minimapTiles(world.dungeon, world.layout.stairwell);
		const fog = new FogOfWar(t);
		const sources: FogSource[] = [false];
		let updates = 0;
		const started = os.clock();
		let castTime = 0;
		const track = () => {
			const p = drv.state.player;
			sources[0] = p.dead === 0 ? { x: p.x, z: p.z } : false;
			const t0 = os.clock();
			fog.update(sources);
			castTime += os.clock() - t0;
			updates++;
			fog.drainDirty();
			return false;
		};
		const ticks = drv.walkTo(world.stairX, world.stairZ, track, 6000);
		expect(drv.floor()).toBe(2);
		let open = 0;
		let seen = 0;
		let roomsSeen = 0;
		for (let c = 0; c < t.W * t.H; c++) {
			const tile = t.tile[c];
			if (tile !== MapTile.FLOOR && tile !== MapTile.POOL) continue;
			open++;
			if (fog.state(c) !== FogState.UNKNOWN) seen++;
		}
		for (let r = 0; r < t.roomCells.size(); r++) if (fog.roomRevealed(r)) roomsSeen++;
		print(
			`[minimap] run 1337 floor 1: ${ticks} ticks to the stairwell, ${seen} of ${open} floor cells seen ` +
				`(${string.format("%.1f", (100 * seen) / open)} %), ${roomsSeen} of ${t.roomCells.size()} rooms; ` +
				`${updates} updates, ${string.format("%.2f", (castTime * 1000) / updates)} ms each on average, ` +
				`${string.format("%.1f", os.clock() - started)} s`,
		);
		expect(fog.state(t.stairCell) !== FogState.UNKNOWN).toBe(true);
		expect(seen > 0 && seen < open).toBe(true);
	});
});

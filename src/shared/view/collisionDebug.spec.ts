// KV_CollisionDebug (docs/WALL_SLIDE.md WS6): the blocking cells near the watched player (isolated 1x1 blockers
// apart), the input magnitude, the stall detector's episodes and its log line, on small hand-made grids.
import { describe, expect, it } from "@rbxts/jest-globals";
import { TileType, cellKey, secretCrackCells, type Dungeon, type SolidCells } from "shared/dungeon";
import { endlessRunFloor } from "shared/run";
import { AXIS_MAX, BREAKABLES_CONFIG, PLAYER_SPEED, SIM_HZ, createBreakablesState } from "shared/sim";
import {
	COLLISION_DEBUG,
	StallDetector,
	blockingCellsNear,
	collisionBlocks,
	collisionDebugDungeon,
	inputMagnitude,
	isIsolatedBlocker,
	stallLine,
} from "shared/view";

/** A synthetic Dungeon from rows of characters: '.' floor, '#' wall, '~' pool, ' ' void. */
function dungeonOf(rows: ReadonlyArray<string>): Dungeon {
	const H = rows.size();
	const W = rows[0].size();
	const grid: number[] = [];
	for (const row of rows)
		for (let x = 1; x <= W; x++) {
			const ch = string.sub(row, x, x);
			grid.push(
				ch === "#" ? TileType.WALL : ch === "." ? TileType.FLOOR : ch === "~" ? TileType.POOL : TileType.VOID,
			);
		}
	return { W, H, grid, seed: 1, params: { themeKey: "ancient" } } as unknown as Dungeon;
}

function solidOf(cells: ReadonlyArray<[number, number]>): SolidCells {
	const m = new Map<number, number>();
	cells.forEach(([gx, gy], i) => m.set(cellKey(gx, gy), i));
	return m;
}

// 11 x 9: a room with a lone pillar at (3, 3), a 2x1 tomb at (6..7, 3), a pool at (3, 6), a wall notch at (9, 6).
const ROOM = dungeonOf([
	"###########", // 0
	"#.........#", // 1
	"#.........#", // 2
	"#..#..##..#", // 3
	"#.........#", // 4
	"#.........#", // 5
	"#..~......#", // 6
	"#.........#", // 7
	"###########", // 8
]);

describe("collisionBlocks / isIsolatedBlocker", () => {
	it("blocks on every tile but FLOOR (outside the grid too) and on a solid FLOOR cell", () => {
		expect(collisionBlocks(ROOM, 1, 1)).toBe(false);
		expect(collisionBlocks(ROOM, 0, 0)).toBe(true);
		expect(collisionBlocks(ROOM, 3, 3)).toBe(true);
		expect(collisionBlocks(ROOM, 3, 6)).toBe(true); // pool
		expect(collisionBlocks(ROOM, -1, 4)).toBe(true); // outside: VOID
		expect(collisionBlocks(ROOM, 11, 4)).toBe(true);
		expect(collisionBlocks(ROOM, 5, 5, solidOf([[5, 5]]))).toBe(true);
		expect(collisionBlocks(ROOM, 5, 5)).toBe(false);
	});

	it("a lone pillar, a lone pool and a lone crate are isolated; a tomb, a wall and an open cell are not", () => {
		expect(isIsolatedBlocker(ROOM, 3, 3)).toBe(true);
		expect(isIsolatedBlocker(ROOM, 3, 6)).toBe(true);
		expect(isIsolatedBlocker(ROOM, 5, 5, solidOf([[5, 5]]))).toBe(true);
		expect(isIsolatedBlocker(ROOM, 6, 3)).toBe(false);
		expect(isIsolatedBlocker(ROOM, 7, 3)).toBe(false);
		expect(isIsolatedBlocker(ROOM, 0, 4)).toBe(false);
		expect(isIsolatedBlocker(ROOM, 5, 5)).toBe(false); // open
	});

	it("a crate diagonally next to a pillar makes both non-isolated (8-neighbourhood)", () => {
		const solid = solidOf([[4, 4]]);
		expect(isIsolatedBlocker(ROOM, 3, 3, solid)).toBe(false);
		expect(isIsolatedBlocker(ROOM, 4, 4, solid)).toBe(false);
	});
});

describe("blockingCellsNear", () => {
	it("lists the blocking cells in the disc of radius 3, row by row, pillar and crate marked", () => {
		const solid = solidOf([[5, 5]]);
		const cells = blockingCellsNear(ROOM, 4, 4, solid);
		const keys = cells.map((c) => `${c.gx},${c.gy}${c.isolated ? "i" : ""}${c.solid ? "s" : ""}`);
		// (7, 3) is at distance sqrt(10): out; the walls of rows 0 / 8 and columns 0 / 10 are out of reach
		expect(keys).toEqual(["3,3i", "6,3", "5,5is", "3,6i"]);
		expect(COLLISION_DEBUG.cellRadiusTiles).toBe(3);
	});

	it("includes the edge of the disc (distance exactly the radius) and nothing past it", () => {
		const open = dungeonOf([".........", ".........", ".........", ".........", "........."]);
		// (4, 2) is the centre; radius 2: (2, 2), (6, 2), (4, 0), (4, 4) are on the edge; (2, 0) (distance 2.83) is out
		const solid = solidOf([
			[2, 2],
			[6, 2],
			[4, 0],
			[4, 4],
			[2, 0],
			[8, 2],
		]);
		const cells = blockingCellsNear(open, 4, 2, solid, 2);
		expect(cells.map((c) => `${c.gx},${c.gy}`)).toEqual(["4,0", "2,2", "6,2", "4,4"]);
	});

	it("counts cells outside the grid (VOID) near the border", () => {
		const tiny = dungeonOf(["..", ".."]);
		const cells = blockingCellsNear(tiny, 0, 0, undefined, 1);
		expect(cells.map((c) => `${c.gx},${c.gy}`)).toEqual(["0,-1", "-1,0"]);
	});

	it("is empty on open floor", () => {
		const open = dungeonOf([".......", ".......", ".......", ".......", ".......", ".......", "......."]);
		expect(blockingCellsNear(open, 3, 3).size()).toBe(0);
	});
});

describe("inputMagnitude", () => {
	it("is the unit length of the world axes, clamped to 1", () => {
		expect(inputMagnitude(0, 0)).toBe(0);
		expect(inputMagnitude(AXIS_MAX, 0)).toBe(1);
		expect(inputMagnitude(AXIS_MAX, AXIS_MAX)).toBe(1);
		expect(inputMagnitude(300, 400)).toBeCloseTo(0.5, 12);
		expect(inputMagnitude(-707, 707)).toBeCloseTo(0.99985, 4);
	});
});

/** Feeds `ticks` frames of one tick each, the body advancing `step` per tick along x from x0; the started frames. */
function feed(det: StallDetector, from: number, ticks: number, x0: number, step: number, magnitude = 1): number[] {
	const starts = new Array<number>();
	for (let k = 0; k <= ticks; k++) {
		if (det.update(from + k, x0 + step * k, 0, magnitude)) starts.push(from + k);
	}
	return starts;
}

const WALK = PLAYER_SPEED / SIM_HZ;
const HOLD_TICKS = 18; // 0.3 s at 60 Hz

describe("StallDetector", () => {
	it("uses the WS6 thresholds: input 0.5, 0.3 s, 25 %", () => {
		expect(COLLISION_DEBUG.stallInputMin).toBe(0.5);
		expect(COLLISION_DEBUG.stallHoldSec).toBe(0.3);
		expect(COLLISION_DEBUG.stallMoveShare).toBe(0.25);
		expect(math.ceil(COLLISION_DEBUG.stallHoldSec * SIM_HZ - 1e-9)).toBe(HOLD_TICKS);
	});

	it("starts an episode once, exactly 0.3 s into a hold against a wall, and stays stalled", () => {
		const det = new StallDetector();
		const starts = feed(det, 100, 120, 5, 0);
		expect(starts).toEqual([100 + HOLD_TICKS]);
		expect(det.isStalled()).toBe(true);
	});

	it("never stalls on open floor, at full input or at half input", () => {
		const det = new StallDetector();
		expect(feed(det, 0, 300, 0, WALK)).toEqual([]);
		det.reset();
		expect(feed(det, 0, 300, 0, WALK * 0.5, 0.5)).toEqual([]);
		expect(det.isStalled()).toBe(false);
	});

	it("ignores input below 0.5 (a resting stick, a light touch)", () => {
		const det = new StallDetector();
		expect(feed(det, 0, 120, 0, 0, 0.49)).toEqual([]);
		expect(feed(det, 200, 120, 0, 0, 0)).toEqual([]);
	});

	it("judges the last 0.3 s, not the whole hold: a free walk into a wall stalls once that window moved under 25 %", () => {
		const det = new StallDetector();
		expect(feed(det, 0, 120, 0, WALK)).toEqual([]);
		// the body stops at tick 120: the 0.3 s window holds less than 25 % of a walk (4 of 18 ticks) from tick 134
		const wallX = 120 * WALK;
		expect(feed(det, 121, 60, wallX, 0)).toEqual([120 + HOLD_TICKS - 4]);
	});

	it("a heavy drag (moving 20 % of the walk) stalls; a slide at 30 % does not", () => {
		const det = new StallDetector();
		expect(feed(det, 0, 60, 0, WALK * 0.2)).toEqual([HOLD_TICKS]);
		det.reset();
		expect(feed(det, 0, 60, 0, WALK * 0.3)).toEqual([]);
	});

	it("jitter in place (back and forth) is a stall: displacement, not path length", () => {
		const det = new StallDetector();
		let started = -1;
		for (let k = 0; k <= 60; k++) {
			const x = k % 2 === 0 ? 3 : 3 + WALK;
			if (det.update(k, x, 0, 1) && started < 0) started = k;
		}
		expect(started).toBe(HOLD_TICKS);
	});

	it("ends the episode when the body moves freely again; a new stall is a new episode (printed again)", () => {
		const det = new StallDetector();
		expect(feed(det, 0, 30, 0, 0)).toEqual([HOLD_TICKS]);
		// break free: walks 60 ticks
		expect(feed(det, 31, 60, 0, WALK)).toEqual([]);
		expect(det.isStalled()).toBe(false);
		// stopped again after tick 91: 4 of the window's 18 ticks moved at tick 105
		const x = 60 * WALK;
		expect(feed(det, 92, 30, x, 0)).toEqual([91 + HOLD_TICKS - 4]);
	});

	it("releasing the input ends the episode and the next hold waits the full 0.3 s again", () => {
		const det = new StallDetector();
		feed(det, 0, 30, 0, 0);
		expect(det.isStalled()).toBe(true);
		expect(det.update(31, 0, 0, 0)).toBe(false);
		expect(det.isStalled()).toBe(false);
		expect(feed(det, 32, 30, 0, 0)).toEqual([32 + HOLD_TICKS]);
	});

	it("frames without a tick (pause, hitstop) neither build nor end a hold", () => {
		const det = new StallDetector();
		let starts = 0;
		for (let k = 0; k < HOLD_TICKS; k++) {
			for (let r = 0; r < 5; r++) if (det.update(k, 0, 0, 1)) starts++;
		}
		expect(starts).toBe(0);
		expect(det.update(HOLD_TICKS, 0, 0, 1)).toBe(true);
		for (let r = 0; r < 5; r++) expect(det.update(HOLD_TICKS, 0, 0, 1)).toBe(false);
		expect(det.isStalled()).toBe(true);
	});

	it("multi-tick frames count every tick (a 2-tick frame cadence stalls at the same sim time)", () => {
		const det = new StallDetector();
		let started = -1;
		for (let t = 0; t <= 60; t += 2) if (det.update(t, 1, 1, 1) && started < 0) started = t;
		expect(started).toBe(HOLD_TICKS);
	});

	it("a tick that goes backwards (a new run) starts over", () => {
		const det = new StallDetector();
		feed(det, 500, 30, 0, 0);
		expect(det.isStalled()).toBe(true);
		expect(det.update(0, 0, 0, 1)).toBe(false);
		expect(det.isStalled()).toBe(false);
		expect(feed(det, 1, 30, 0, 0)).toEqual([HOLD_TICKS]);
	});
});

describe("stallLine", () => {
	it("prints the position, its grid cell and the unit input", () => {
		expect(stallLine(12.346, 5.6, 707, -707)).toBe("[collision] stall at 12.35,5.60 (12,6) input 0.71,-0.71");
		expect(stallLine(0.49, -0.5, AXIS_MAX, 0)).toBe("[collision] stall at 0.49,-0.50 (0,0) input 1.00,0.00");
	});
});

describe("collisionDebugDungeon: a secret floor's carved grid (docs/SECRET_ROOMS.md SR5)", () => {
	it("the crack blocks through its pieces until the open, the chamber is walkable; other floors keep the Forge's", () => {
		let seed = 1;
		while (endlessRunFloor(seed, 3).layout.secret === undefined) seed++;
		const w = endlessRunFloor(seed, 3);
		const plan = w.secret!;
		const d = collisionDebugDungeon(w.dungeon, w.secret);
		expect(d).toBe(plan.dungeon);
		expect(collisionDebugDungeon(w.dungeon, undefined)).toBe(w.dungeon);
		const b = createBreakablesState(BREAKABLES_CONFIG, w.layout.breakables!);
		const solid: SolidCells = b.slotByCell;
		for (const c of secretCrackCells(plan)) {
			// The Forge's grid: a wall. The sim's: FLOOR held shut by an intact piece, then open.
			expect(collisionBlocks(w.dungeon, c.x, c.y, solid)).toBe(true);
			expect(collisionBlocks(d, c.x, c.y, solid)).toBe(true);
			const near = blockingCellsNear(d, c.x, c.y + plan.fz, solid, 1);
			expect(near.find((n) => n.gx === c.x && n.gy === c.y)?.solid).toBe(true);
			expect(collisionBlocks(d, c.x, c.y, undefined)).toBe(false);
		}
		expect(collisionBlocks(w.dungeon, plan.chestX, plan.chestY - plan.fz, solid)).toBe(true);
		expect(collisionBlocks(d, plan.chestX + plan.ax, plan.chestY + plan.az, solid)).toBe(false);
		// The chest's own cell holds its piece (an intact chest blocks like any piece).
		expect(collisionBlocks(d, plan.chestX, plan.chestY, solid)).toBe(true);
	});
});

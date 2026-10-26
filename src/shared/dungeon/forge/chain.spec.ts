// Kaleb-Vale Forge option `chain` (forge/chain.ts; the tutorial's floor 1, docs/TUTORIAL.md §2): the rooms are the
// given ones in a line of straight corridors, the shape checks throw, the seed only changes the decoration, and the
// option off leaves every rolled floor alone (forge.digest.spec and the parity specs pin those byte for byte).
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	CHAIN_CLEARANCE,
	KALEB_VALE_MVP_PARAMS,
	TileType,
	chainGraph,
	generateDungeon,
	resolveParams,
	type ForgeChainRoom,
	type ForgeParams,
} from ".";

const ROOMS: ReadonlyArray<ForgeChainRoom> = [
	{ type: "entrance", w: 6, h: 6, shape: "rect", next: "e", gap: 3 },
	{ type: "combat", w: 10, h: 10, shape: "rect", next: "s", gap: 2 },
	{ type: "treasure", w: 6, h: 6, shape: "oct", next: "w", gap: 4 },
	{ type: "boss", w: 9, h: 9, shape: "ellipse" },
];

function params(seed: number, chain: ReadonlyArray<ForgeChainRoom> = ROOMS, extra: Partial<ForgeParams> = {}) {
	return { ...KALEB_VALE_MVP_PARAMS, seed, roomCount: chain.size(), chain, themeKey: "ancient" as const, ...extra };
}

describe("Forge chain floors", () => {
	it("lays the rooms out as given: ids in order, types, sizes, one straight corridor of `gap` tiles between neighbours", () => {
		const d = generateDungeon(params(5));
		expect(d.valid).toBe(true);
		expect(d.stats.attempts).toBe(1);
		expect(d.rooms.map((r) => r.type)).toEqual(["entrance", "combat", "treasure", "boss"]);
		expect([d.entrance, d.boss, d.maxDepth]).toEqual([0, 3, 3]);
		expect(d.rooms.map((r) => r.depth)).toEqual([0, 1, 2, 3]);
		expect(d.edges.map((e) => [e.a, e.b, e.isLoop, e.isCritical])).toEqual([
			[0, 1, false, true],
			[1, 2, false, true],
			[2, 3, false, true],
		]);
		// minCombatRoomSize (8) does not shrink the 10-tile combat room; the treasure room keeps its 6.
		expect(d.rooms.map((r) => [r.w, r.h])).toEqual([
			[6, 6],
			[10, 10],
			[6, 6],
			[9, 9],
		]);
		const [a, b, c, e] = d.rooms;
		// Same row / column, gap + 1 + the half widths apart.
		expect([b.cy - a.cy, b.cx - a.cx]).toEqual([0, 3 + 3 + 1 + 5]);
		expect([c.cx - b.cx, c.cy - b.cy]).toEqual([0, 5 + 2 + 1 + 3]);
		expect([e.cy - c.cy, c.cx - e.cx]).toEqual([0, 3 + 4 + 1 + 4]);
		// The corridor cells between a and b: exactly `gap` columns of 3 (KALEB_VALE corridorWidth) on a's row.
		let between = 0;
		for (let x = a.cx + 4; x <= b.cx - 6; x++)
			for (let y = a.cy - 1; y <= a.cy + 1; y++) {
				expect(d.grid[y * d.W + x]).toBe(TileType.FLOOR);
				expect(d.corridor[y * d.W + x]).toBe(1);
				between++;
			}
		expect(between).toBe(3 * 3);
		let corridorCells = 0;
		for (const v of d.corridor) corridorCells += v;
		expect(corridorCells).toBe(3 * (3 + 2 + 4));
	});

	it("the seed changes only the draws after the graph (decoration), never the rooms or corridors", () => {
		const x = generateDungeon(params(1));
		const y = generateDungeon(params(2));
		expect(x.rooms.map((r) => [r.cx, r.cy, r.w, r.h, r.type])).toEqual(
			y.rooms.map((r) => [r.cx, r.cy, r.w, r.h, r.type]),
		);
		expect(x.roomId).toEqual(y.roomId);
		expect(x.corridor).toEqual(y.corridor);
		// Same theme, no pits: the same walls (pillars sit on a fixed grid).
		expect(x.grid).toEqual(y.grid);
		expect(x.name === y.name && x.torches.size() === y.torches.size()).toBe(false);
	});

	it("roomScale scales the room sizes, not the gaps; solid pillars wall the combat room's pillar grid", () => {
		// ROOMS' U-turn is too tight at scale 2 (rooms 1 and 3 would touch: chainGraph throws), so a straight line.
		expect(() => generateDungeon(params(3, ROOMS, { roomScale: 2 }))).toThrow("touch");
		const line = ROOMS.map((r) => (r.next !== undefined ? { ...r, next: "e" as const } : r));
		const d = generateDungeon(params(3, line, { roomScale: 2, solidPillars: true }));
		expect(d.valid).toBe(true);
		expect(d.rooms.map((r) => r.w)).toEqual([12, 20, 12, 18]);
		const [a, b] = d.rooms;
		expect(b.cx - a.cx).toBe(6 + 3 + 1 + 10);
		let pillars = 0;
		for (const pr of d.props) if (pr.kind === "pillar" && d.grid[pr.y * d.W + pr.x] === TileType.WALL) pillars++;
		expect(pillars > 0).toBe(true);
	});

	it("throws on a bad chain: count, entrance / boss ends, sizes, missing sides or gaps", () => {
		expect(() => resolveParams({ ...params(1), roomCount: 5 })).toThrow("roomCount");
		const bad = (rooms: ForgeChainRoom[]) => () => resolveParams(params(1, rooms));
		const ok = [...ROOMS];
		expect(bad([{ ...ok[0], type: "combat" }, ok[1], ok[2], ok[3]])).toThrow("entrance");
		expect(bad([ok[0], ok[1], ok[2], { ...ok[3], type: "shrine" }])).toThrow("boss");
		expect(bad([ok[0], { ...ok[1], type: "boss" }, ok[2], ok[3]])).toThrow("second");
		expect(bad([ok[0], { ...ok[1], w: 0 }, ok[2], ok[3]])).toThrow("size");
		expect(bad([ok[0], { ...ok[1], next: undefined }, ok[2], ok[3]])).toThrow("next side");
		expect(bad([ok[0], { ...ok[1], gap: 0 }, ok[2], ok[3]])).toThrow("gap");
		expect(bad([ok[0], { ...ok[1], gap: 1.5 }, ok[2], ok[3]])).toThrow("gap");
	});

	it("throws when pieces that are not joined would touch, or a pair is too narrow for a straight corridor", () => {
		// Back the way it came: room 2 lands on room 0.
		const back: ForgeChainRoom[] = [
			{ type: "entrance", w: 6, h: 6, shape: "rect", next: "e", gap: 2 },
			{ type: "combat", w: 8, h: 8, shape: "rect", next: "w", gap: 2 },
			{ type: "boss", w: 8, h: 8, shape: "rect" },
		];
		expect(() => chainGraph(back, 1, undefined, 3)).toThrow("touch");
		// A U-turn too tight for CHAIN_CLEARANCE: e, s, w with short rooms.
		const tight: ForgeChainRoom[] = [
			{ type: "entrance", w: 8, h: 8, shape: "rect", next: "e", gap: 1 },
			{ type: "combat", w: 8, h: 8, shape: "rect", next: "s", gap: CHAIN_CLEARANCE - 1 },
			{ type: "combat", w: 8, h: 8, shape: "rect", next: "w", gap: 1 },
			{ type: "boss", w: 8, h: 8, shape: "rect" },
		];
		expect(() => chainGraph(tight, 1, undefined, 3)).toThrow("touch");
		const narrow: ForgeChainRoom[] = [
			{ type: "entrance", w: 6, h: 4, shape: "rect", next: "e", gap: 2 },
			{ type: "boss", w: 8, h: 8, shape: "rect" },
		];
		expect(() => chainGraph(narrow, 1, undefined, 3)).toThrow("too narrow");
	});
});

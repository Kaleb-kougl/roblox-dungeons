// Room scale on endless floors (ForgeParams.roomScale, ENDLESS_ROOM_SCALE): off (or 1) is the unscaled floor exactly;
// on, every room is roomScale times as wide and tall, combat rooms keep the scaled minimum, and floors stay valid.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	ENDLESS_ROOM_SCALE,
	KALEB_VALE_MVP_PARAMS,
	RoomType,
	TileType,
	endlessFloorParams,
	generateDungeon,
	resolveParams,
	type Dungeon,
} from "shared/dungeon";

function sameFloor(a: Dungeon, b: Dungeon): boolean {
	if (a.W !== b.W || a.H !== b.H || a.seed !== b.seed || a.name !== b.name) return false;
	for (let i = 0; i < a.grid.size(); i++) if (a.grid[i] !== b.grid[i] || a.roomId[i] !== b.roomId[i]) return false;
	return a.props.size() === b.props.size() && a.spawns.size() === b.spawns.size();
}

function roomFloorTiles(d: Dungeon): number {
	let n = 0;
	for (let i = 0; i < d.grid.size(); i++) if (d.grid[i] === TileType.FLOOR && d.roomId[i] >= 0) n++;
	return n;
}

describe("ForgeParams.roomScale", () => {
	it("is off on M1 and on at ENDLESS_ROOM_SCALE (2) on every endless floor", () => {
		expect((KALEB_VALE_MVP_PARAMS as { roomScale?: number }).roomScale).toBe(undefined);
		expect(ENDLESS_ROOM_SCALE).toBe(2);
		for (const floor of [1, 5, 6, 30]) expect(endlessFloorParams(1337, floor).roomScale).toBe(ENDLESS_ROOM_SCALE);
	});

	it("1 is the unscaled floor exactly", () => {
		for (const seed of [1, 42, 1337, 2024]) {
			const a = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed });
			const b = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed, roomScale: 1 });
			expect(sameFloor(a, b)).toBe(true);
		}
	});

	it("rejects a scale that is not a positive integer", () => {
		for (const roomScale of [0, -1, 1.5, 0 / 0]) {
			expect(() => resolveParams({ ...KALEB_VALE_MVP_PARAMS, seed: 1, roomScale })).toThrow();
		}
	});

	it("2 doubles every room's width and height and keeps endless floors valid", () => {
		const m = KALEB_VALE_MVP_PARAMS.minCombatRoomSize * ENDLESS_ROOM_SCALE;
		let scaledTiles = 0,
			unscaledTiles = 0;
		for (let run = 1; run <= 8; run++)
			for (let floor = 1; floor <= 6; floor++) {
				const params = endlessFloorParams(run * 7919, floor);
				const d = generateDungeon(params);
				expect(d.valid).toBe(true);
				for (const r of d.rooms) {
					// every rolled size is a multiple of the scale, and the smallest roll (5) doubles to 10
					expect(r.w % ENDLESS_ROOM_SCALE).toBe(0);
					expect(r.h % ENDLESS_ROOM_SCALE).toBe(0);
					expect(math.min(r.w, r.h) >= 5 * ENDLESS_ROOM_SCALE).toBe(true);
					if (r.type === RoomType.COMBAT || r.type === RoomType.ELITE)
						expect(math.min(r.w, r.h) >= m).toBe(true);
				}
				scaledTiles += roomFloorTiles(d);
				unscaledTiles += roomFloorTiles(generateDungeon({ ...params, roomScale: undefined }));
			}
		// four times the footprint, give or take shapes and pits
		const ratio = scaledTiles / unscaledTiles;
		expect(ratio > 3.5 && ratio < 4.5).toBe(true);
	});
});

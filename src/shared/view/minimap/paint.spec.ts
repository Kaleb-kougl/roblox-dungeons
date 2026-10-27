// Minimap paint (docs/MINIMAP.md M5): every tile kind x fog state, the room tint, the frontier, unknown and NONE =
// alpha 0, only listed cells touched; paintAll covers every cell; FogOfWar output paints as its states say.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	FogOfWar,
	FogState,
	MINIMAP_BYTES_PER_PIXEL,
	MINIMAP_VIEW,
	MapTile,
	channelByte,
	createMinimapBuffer,
	minimapBufferSize,
	minimapTiles,
	paintAll,
	paintCells,
	type MinimapFogView,
	type MinimapPalette,
	type MinimapRgb,
	type MinimapRoomLook,
} from "shared/view";
import { specDungeon } from "./testing";

const PALETTE: MinimapPalette = {
	floor: { r: 0.5, g: 0.5, b: 0.5 },
	wall: { r: 1, g: 0.8, b: 0.6 },
	pool: { r: 0, g: 0.2, b: 1 },
	frontier: { r: 1, g: 1, b: 1 },
};
const TINT: MinimapRgb = { r: 1, g: 0, b: 0 };

/** A fog view with fixed per-cell states and frontier flags. */
class FakeFog implements MinimapFogView {
	constructor(readonly states: number[], readonly frontier: boolean[]) {}
	state(cell: number): number {
		return this.states[cell];
	}
	isFrontier(cell: number): boolean {
		return this.frontier[cell];
	}
}

function pixel(buf: buffer, cell: number): [number, number, number, number] {
	const at = cell * MINIMAP_BYTES_PER_PIXEL;
	return [buffer.readu8(buf, at), buffer.readu8(buf, at + 1), buffer.readu8(buf, at + 2), buffer.readu8(buf, at + 3)];
}

function rgba(c: MinimapRgb, scale = 1): [number, number, number, number] {
	return [channelByte(c.r * scale), channelByte(c.g * scale), channelByte(c.b * scale), 255];
}

function mix(a: MinimapRgb, b: MinimapRgb, m: number): MinimapRgb {
	return { r: a.r + (b.r - a.r) * m, g: a.g + (b.g - a.g) * m, b: a.b + (b.b - a.b) * m };
}

// cells: 0 room floor, 1 corridor floor, 2 wall, 3 corridor pool, 4 room pool, 5 void
// prettier-ignore
const D = specDungeon([
	"A.#~a ",
	"######",
]);
const T = minimapTiles(D);
const ROOM_FLOOR = 0;
const FLOOR = 1;
const WALL = 2;
const POOL = 3;
const ROOM_POOL = 4;
const VOID = 5;
const N = T.W * T.H;

function fill(n: number, v: number): number[] {
	const out: number[] = [];
	for (let i = 0; i < n; i++) out.push(v);
	return out;
}

function falses(n: number): boolean[] {
	const out: boolean[] = [];
	for (let i = 0; i < n; i++) out.push(false);
	return out;
}

describe("minimap paint", () => {
	it("the test grid has every tile kind", () => {
		expect([
			T.tile[ROOM_FLOOR],
			T.tile[FLOOR],
			T.tile[WALL],
			T.tile[POOL],
			T.tile[ROOM_POOL],
			T.tile[VOID],
		]).toEqual([MapTile.FLOOR, MapTile.FLOOR, MapTile.WALL, MapTile.POOL, MapTile.POOL, MapTile.NONE]);
		expect(minimapBufferSize(T)).toBe(N * 4);
	});

	it("every tile kind x fog state: in sight full colour, remembered dimmed, unknown and NONE transparent", () => {
		const noLook: MinimapRoomLook = [];
		const all: number[] = [];
		for (let c = 0; c < N; c++) all.push(c);
		const dim = MINIMAP_VIEW.rememberedDim;
		for (const s of [FogState.UNKNOWN, FogState.REMEMBERED, FogState.IN_SIGHT]) {
			const buf = createMinimapBuffer(T);
			buffer.fill(buf, 0, 0x7f);
			paintCells(T, new FakeFog(fill(N, s), falses(N)), noLook, PALETTE, all, buf);
			const k = s === FogState.REMEMBERED ? dim : 1;
			const want = (c: MinimapRgb) => (s === FogState.UNKNOWN ? [0, 0, 0, 0] : rgba(c, k));
			expect(pixel(buf, ROOM_FLOOR)).toEqual(want(PALETTE.floor));
			expect(pixel(buf, FLOOR)).toEqual(want(PALETTE.floor));
			expect(pixel(buf, WALL)).toEqual(want(PALETTE.wall));
			expect(pixel(buf, POOL)).toEqual(want(PALETTE.pool));
			expect(pixel(buf, ROOM_POOL)).toEqual(want(PALETTE.pool));
			expect(pixel(buf, VOID)).toEqual([0, 0, 0, 0]);
		}
	});

	it("the room tint mixes into room floor only; the frontier brightens; remembered dims after both", () => {
		const look: MinimapRoomLook = [TINT];
		const buf = createMinimapBuffer(T);
		const states = fill(N, FogState.IN_SIGHT);
		const frontier = falses(N);
		paintCells(T, new FakeFog(states, frontier), look, PALETTE, [ROOM_FLOOR, FLOOR, ROOM_POOL], buf);
		const tinted = mix(PALETTE.floor, TINT, MINIMAP_VIEW.roomTintMix);
		expect(pixel(buf, ROOM_FLOOR)).toEqual(rgba(tinted));
		expect(pixel(buf, FLOOR)).toEqual(rgba(PALETTE.floor));
		expect(pixel(buf, ROOM_POOL)).toEqual(rgba(PALETTE.pool));
		// frontier on the room floor, remembered
		states[ROOM_FLOOR] = FogState.REMEMBERED;
		frontier[ROOM_FLOOR] = true;
		frontier[FLOOR] = true;
		paintCells(T, new FakeFog(states, frontier), look, PALETTE, [ROOM_FLOOR, FLOOR], buf);
		const bright = mix(tinted, PALETTE.frontier, MINIMAP_VIEW.frontierMix);
		expect(pixel(buf, ROOM_FLOOR)).toEqual(rgba(bright, MINIMAP_VIEW.rememberedDim));
		expect(pixel(buf, FLOOR)).toEqual(rgba(mix(PALETTE.floor, PALETTE.frontier, MINIMAP_VIEW.frontierMix)));
		// a room without a look (undefined entry) is untinted
		paintCells(T, new FakeFog(fill(N, FogState.IN_SIGHT), falses(N)), [undefined], PALETTE, [ROOM_FLOOR], buf);
		expect(pixel(buf, ROOM_FLOOR)).toEqual(rgba(PALETTE.floor));
	});

	it("only the listed cells are touched; paintAll writes every cell", () => {
		const buf = createMinimapBuffer(T);
		buffer.fill(buf, 0, 0x55);
		const fog = new FakeFog(fill(N, FogState.IN_SIGHT), falses(N));
		paintCells(T, fog, [], PALETTE, [WALL], buf);
		for (let c = 0; c < N; c++) {
			if (c === WALL) expect(pixel(buf, c)).toEqual(rgba(PALETTE.wall));
			else expect(pixel(buf, c)).toEqual([0x55, 0x55, 0x55, 0x55]);
		}
		paintAll(T, fog, [], PALETTE, buf);
		for (let c = 0; c < N; c++) {
			const [, , , a] = pixel(buf, c);
			expect(a).toBe(T.tile[c] === MapTile.NONE ? 0 : 255);
		}
	});

	it("channelByte rounds and clamps", () => {
		expect(channelByte(0)).toBe(0);
		expect(channelByte(1)).toBe(255);
		expect(channelByte(0.5)).toBe(128);
		expect(channelByte(-1)).toBe(0);
		expect(channelByte(2)).toBe(255);
	});

	it("a real FogOfWar's dirty cells paint as its states say", () => {
		const fog = new FogOfWar(T, { sightTiles: 3 });
		fog.update([{ x: 1, z: 0 }]);
		const buf = createMinimapBuffer(T);
		paintCells(T, fog, [], PALETTE, fog.drainDirty(), buf);
		expect(fog.state(FLOOR)).toBe(FogState.IN_SIGHT);
		expect(pixel(buf, WALL)).toEqual(rgba(PALETTE.wall));
		expect(pixel(buf, VOID)).toEqual([0, 0, 0, 0]);
	});
});

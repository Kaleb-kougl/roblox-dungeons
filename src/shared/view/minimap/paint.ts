/**
 * Minimap paint (docs/MINIMAP.md §5, task M5): fog + tiles -> RGBA8 pixels (one pixel per tile) in a Luau `buffer` of
 * W * H * 4 bytes, row-major (cell y * W + x at byte 4 * cell: R, G, B, A), ready for EditableImage:WritePixelsBuffer.
 * Pure: plain numbers, no Color3 (the caller turns theme roles into MinimapRgb). Roblox-port feature, no web source.
 *
 * Colour of a cell:
 *   - NONE tiles and UNKNOWN cells: fully transparent (0, 0, 0, 0): the panel background shows;
 *   - else the tile kind's colour (palette floor / wall / pool), then on room floor (MinimapTiles.room >= 0) the
 *     room's look mixed in by MINIMAP_VIEW.roomTintMix, then on a frontier cell the palette's frontier colour mixed in
 *     by MINIMAP_VIEW.frontierMix, then REMEMBERED cells scaled by MINIMAP_VIEW.rememberedDim; alpha 255.
 *
 * @module
 */
import { channelToByte, mixChannel } from "shared/theme";
import { MINIMAP_VIEW } from "./config";
import { FogState, type MinimapFogView } from "./fog";
import { MAP_NO_CELL, MapTile, type MinimapTiles } from "./tiles";

/** A colour as plain numbers, each channel 0..1 (Color3's R / G / B). */
export interface MinimapRgb {
	readonly r: number;
	readonly g: number;
	readonly b: number;
}

/** The map's tile colours (theme roles minimap.floor / .wall / .pool / .frontier, task M6). */
export interface MinimapPalette {
	readonly floor: MinimapRgb;
	readonly wall: MinimapRgb;
	readonly pool: MinimapRgb;
	readonly frontier: MinimapRgb;
}

/**
 * The tint per room id (the caller's roomEdge.* colour for that room's RoomEdgeStates state), or undefined for none.
 * Only ever indexed, never iterated, so holes are fine.
 */
export type MinimapRoomLook = ReadonlyArray<MinimapRgb | undefined>;

/** Bytes per pixel (RGBA8). */
export const MINIMAP_BYTES_PER_PIXEL = 4;
const CHANNEL_MAX = 255;

/** The buffer size paintCells / paintAll need for `tiles`. */
export function minimapBufferSize(tiles: MinimapTiles): number {
	return tiles.W * tiles.H * MINIMAP_BYTES_PER_PIXEL;
}

/** A fresh zeroed (all transparent) buffer for `tiles`. */
export function createMinimapBuffer(tiles: MinimapTiles): buffer {
	return buffer.create(minimapBufferSize(tiles));
}

/** A 0..1 channel to 0..255, rounded, clamped (shared/theme channelToByte: the validator's rule too). */
export function channelByte(v: number): number {
	return channelToByte(v);
}

function paintCell(
	tiles: MinimapTiles,
	fog: MinimapFogView,
	roomLook: MinimapRoomLook,
	palette: MinimapPalette,
	cell: number,
	buf: buffer,
): void {
	const at = cell * MINIMAP_BYTES_PER_PIXEL;
	const t = tiles.tile[cell];
	const s = fog.state(cell);
	if (t === MapTile.NONE || s === FogState.UNKNOWN) {
		buffer.writeu32(buf, at, 0);
		return;
	}
	const base = t === MapTile.FLOOR ? palette.floor : t === MapTile.WALL ? palette.wall : palette.pool;
	let r = base.r;
	let g = base.g;
	let b = base.b;
	const room = tiles.room[cell];
	if (room !== MAP_NO_CELL) {
		const look = roomLook[room];
		if (look !== undefined) {
			// shared/theme mixChannel: the validator's tinted-floor check (minimapReport) uses the same mix.
			const m = MINIMAP_VIEW.roomTintMix;
			r = mixChannel(r, look.r, m);
			g = mixChannel(g, look.g, m);
			b = mixChannel(b, look.b, m);
		}
	}
	if (fog.isFrontier(cell)) {
		const f = palette.frontier;
		const m = MINIMAP_VIEW.frontierMix;
		r = mixChannel(r, f.r, m);
		g = mixChannel(g, f.g, m);
		b = mixChannel(b, f.b, m);
	}
	if (s === FogState.REMEMBERED) {
		const k = MINIMAP_VIEW.rememberedDim;
		r *= k;
		g *= k;
		b *= k;
	}
	buffer.writeu8(buf, at, channelByte(r));
	buffer.writeu8(buf, at + 1, channelByte(g));
	buffer.writeu8(buf, at + 2, channelByte(b));
	buffer.writeu8(buf, at + 3, CHANNEL_MAX);
}

/** Repaints the listed cells (e.g. FogOfWar.drainDirty()) into `buf`; no other byte is touched. */
export function paintCells(
	tiles: MinimapTiles,
	fog: MinimapFogView,
	roomLook: MinimapRoomLook,
	palette: MinimapPalette,
	cells: ReadonlyArray<number>,
	buf: buffer,
): void {
	for (const c of cells) paintCell(tiles, fog, roomLook, palette, c, buf);
}

/** Repaints every cell (floor start, late attach, a palette or room-look change). */
export function paintAll(
	tiles: MinimapTiles,
	fog: MinimapFogView,
	roomLook: MinimapRoomLook,
	palette: MinimapPalette,
	buf: buffer,
): void {
	const n = tiles.W * tiles.H;
	for (let c = 0; c < n; c++) paintCell(tiles, fog, roomLook, palette, c, buf);
}

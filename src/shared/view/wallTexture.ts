/**
 * Continuous wall textures across greedy-merged wall Parts (WorldController): a biome whose wall tile is a repeating
 * image (`tilesPerImage`) draws it on every wall Part's Top face and four side faces. Like the floor (floorTexture.ts),
 * each face's Texture is offset by the Part's world position (modulo the period) so neighbouring wall Parts show one
 * world-anchored pattern: the Top face exactly as a floor slab, a side face's U along the world axis it runs on (X for
 * Front / Back, Z for Left / Right) and its V down from the wall's top edge, so the image's top row sits there on every
 * wall. Plain numbers, specced headlessly.
 *
 * How each side face's U / V run in the world and which way OffsetStudsU/V shift the pattern are Roblox conventions
 * this module does not assume: they are the `WallTextureUV` passed in (GAME_WORLD.wallTextureUV, to be confirmed in
 * Studio: no seams at wall joins, the image upright). The wall Parts are axis-aligned (no rotation).
 */
import { floorTextureOffsets, textureAxisOffset, type TopFaceUV } from "./floorTexture";

/** The side faces of an axis-aligned Part (Enum.NormalId names): Front -Z, Back +Z, Left -X, Right +X. */
export const WALL_SIDE_FACES = ["Front", "Back", "Left", "Right"] as const;
export type WallSideFace = (typeof WALL_SIDE_FACES)[number];
/** A wall face that can carry the texture (Enum.NormalId names; the Bottom face lies on the floor, never seen). */
export type WallTextureFace = "Top" | WallSideFace;

/** How a Texture on an axis-aligned Part's side face maps to world axes. */
export interface SideFaceUV {
	/** The horizontal world axis U runs along (V runs down / up the face). */
	readonly uAxis: "x" | "z";
	/** +1: U grows with its world axis, the pattern starting at the face's min edge; -1: against it, from the max edge. */
	readonly uSign: 1 | -1;
	/** +1: V grows downward, the pattern starting at the face's top edge; -1: upward, from its bottom edge. */
	readonly vSign: 1 | -1;
	/** +1: the pattern is sampled at (u + OffsetStudsU); -1: at (u - OffsetStudsU). Same for V. */
	readonly offsetSign: 1 | -1;
}

/** A wall Texture's U / V conventions: the Top face's (the floor's) and each side face's. */
export interface WallTextureUV {
	readonly top: TopFaceUV;
	readonly sides: Readonly<Record<WallSideFace, SideFaceUV>>;
}

/**
 * OffsetStudsU / OffsetStudsV for `face` of a wall Part spanning [minX, maxX] x [minZ, maxZ] (world studs),
 * `heightStuds` tall, with a texture repeating every `period` studs both ways. Top: floorTextureOffsets (uv.top).
 * A side face: its pattern at world coordinate a along U's axis is uSign * a (mod period), and at depth d below the
 * wall's top edge vSign * d (mod period), so the image's top row lies on the top edge (every wall's top is the same
 * height, so this is world-anchored too).
 */
export function wallTextureOffsets(
	face: WallTextureFace,
	minX: number,
	minZ: number,
	maxX: number,
	maxZ: number,
	heightStuds: number,
	period: number,
	uv: WallTextureUV,
): readonly [number, number] {
	if (!(period > 0)) return [0, 0];
	if (face === "Top") return floorTextureOffsets(minX, minZ, maxX, maxZ, period, uv.top);
	const side = uv.sides[face];
	const [uMin, uMax] = side.uAxis === "x" ? [minX, maxX] : [minZ, maxZ];
	return [
		textureAxisOffset(uMin, uMax, side.uSign, side.offsetSign, period),
		textureAxisOffset(0, heightStuds, side.vSign, side.offsetSign, period),
	];
}

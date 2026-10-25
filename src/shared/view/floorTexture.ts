/**
 * Continuous floor textures across greedy-merged slabs (WorldController). A Roblox `Texture` tiles from a corner of
 * the face it is on, so each merged floor Part would start the pattern at its own corner and the joins would show as
 * seams. Offsetting each slab's Texture by its world-space corner (modulo the period) makes every slab sample the same
 * world-anchored pattern. Plain numbers, specced headlessly.
 *
 * Which world axis a Top face's U runs along, which corner the pattern starts at and which way OffsetStudsU/V shift
 * it are Roblox conventions this module does not assume: they are the `TopFaceUV` passed in (GAME_WORLD.floorTextureUV,
 * to be confirmed in Studio: no seams at slab joins). The floor Parts are axis-aligned (no rotation).
 */

/** How a Texture on an axis-aligned Part's Top face maps to world axes. */
export interface TopFaceUV {
	/** The world axis U runs along (V runs along the other one). */
	readonly uAxis: "x" | "z";
	/** +1: U grows with its world axis, the pattern starting at the face's min edge; -1: against it, from the max edge. */
	readonly uSign: 1 | -1;
	readonly vSign: 1 | -1;
	/** +1: the pattern is sampled at (u + OffsetStudsU); -1: at (u - OffsetStudsU). Same for V. */
	readonly offsetSign: 1 | -1;
}

/** `a` modulo `period`, in [0, period). */
export function wrapStuds(a: number, period: number): number {
	const w = a - math.floor(a / period) * period;
	return w >= period ? w - period : w;
}

function axisOffset(min: number, max: number, sign: number, offsetSign: number, period: number): number {
	const corner = sign > 0 ? min : max;
	return wrapStuds(offsetSign * sign * corner, period);
}

/**
 * OffsetStudsU / OffsetStudsV for a slab spanning [minX, maxX] x [minZ, maxZ] (world studs) with a texture repeating
 * every `period` studs, so its pattern at world (x, z) is the same as every other slab's: u = uSign * x (mod period)
 * along U's axis, likewise for V.
 */
export function floorTextureOffsets(
	minX: number,
	minZ: number,
	maxX: number,
	maxZ: number,
	period: number,
	uv: TopFaceUV,
): readonly [number, number] {
	if (!(period > 0)) return [0, 0];
	const [uMin, uMax, vMin, vMax] = uv.uAxis === "x" ? [minX, maxX, minZ, maxZ] : [minZ, maxZ, minX, maxX];
	return [
		axisOffset(uMin, uMax, uv.uSign, uv.offsetSign, period),
		axisOffset(vMin, vMax, uv.vSign, uv.offsetSign, period),
	];
}

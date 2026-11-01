/**
 * The void's Parts (docs/VOID_DECOR.md VD3, VD9), the pure half of the client's VoidController: what plan input a run's
 * floor gives (so the VoidController and the DecorController plan the same void), where each greedy rectangle's
 * column stands in studs, and which biome colour / material (or debug tint) each layer takes.
 *
 * Geometry: grid cell (gx, gy) is centred on sim world (gx, gy) (WorldController's mapping), so a rect [x, x + w) x
 * [y, y + h) is centred on (x + (w - 1) / 2, y + (h - 1) / 2). A column runs from its `top` (tiles above the floor) down
 * to the abyss plane (VOID.abyssDepthTiles under the floor, where WorldController puts the backdrop's top face) and
 * VOID_VIEW.columnSinkTiles past it into the backdrop slab, so the near-side cliff faces meet the abyss with no seam.
 */
import type { Dungeon, EndlessFloorLayout } from "shared/dungeon";
import type { BiomeMaterialSurface } from "shared/theme";
import { STUDS_PER_TILE } from "shared/config";
import { floorStudsY, studsX, studsZ } from "../space";
import { VOID } from "./config";
import { VoidLayer, voidInputOfLayout, type VoidPlanInput, type VoidRect } from "./plan";
import { VOID_VIEW } from "./viewConfig";

const HALF = 0.5;

/**
 * The plan input of a run's floor, exactly as DecorController builds its decor input: an endless floor's layout (its
 * floor seed, floor number and the run's Depth), else the bare dungeon (M1, the tutorial's fixed floors without a
 * layout: floor 1, Depth 1); `forced` is the KV_DecorBand attribute's raw value (a number forces the band).
 */
export function voidRunInput(
	dungeon: Dungeon,
	layout: EndlessFloorLayout | undefined,
	depth: number,
	forced: unknown,
): VoidPlanInput {
	const base: VoidPlanInput = layout !== undefined ? voidInputOfLayout(layout, depth) : { dungeon };
	return { ...base, forceBand: voidForceBand(forced) };
}

/** A KV_DecorBand attribute value as a forced band: a number (not NaN), else undefined (the floor's own band). */
export function voidForceBand(forced: unknown): number | undefined {
	return typeIs(forced, "number") && forced === forced ? forced : undefined;
}

/** One column Part: size and centre, studs. */
export interface VoidColumn {
	readonly sizeX: number;
	readonly sizeY: number;
	readonly sizeZ: number;
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

/** The bottom of every column, tiles above the floor (negative: under the abyss plane, inside the backdrop slab). */
export function voidColumnBottomTiles(): number {
	return -(VOID.abyssDepthTiles + VOID_VIEW.columnSinkTiles);
}

/** The column Part of rect `r`: from r.top down to voidColumnBottomTiles(), over the rect's cells. */
export function voidColumnOf(r: VoidRect): VoidColumn {
	const S = STUDS_PER_TILE;
	const bottom = voidColumnBottomTiles();
	return {
		sizeX: r.w * S,
		sizeY: (r.top - bottom) * S,
		sizeZ: r.h * S,
		x: studsX(r.x + (r.w - 1) * HALF),
		y: floorStudsY() + (r.top + bottom) * HALF * S,
		z: studsZ(r.y + (r.h - 1) * HALF),
	};
}

/** How a raised layer is drawn: the biome colour it takes, its material surface, Part name and debug tint. */
export interface VoidLayerStyle {
	/** `shoulder`: BiomeColors.shoulderColor; `ledge`: ledgeColor (voidLedgeColor, what voidReport checks). */
	readonly color: "shoulder" | "ledge";
	/** The biome `materials` entry: the shoulder's own, or `cliff` (ledges and outcrops). */
	readonly material: BiomeMaterialSurface;
	readonly name: string;
	/** KV_VoidDebug tint (hex). */
	readonly debugHex: string;
}

const SHOULDER_STYLE: VoidLayerStyle = {
	color: "shoulder",
	material: "shoulder",
	name: VOID_VIEW.partNames.shoulder,
	debugHex: VOID_VIEW.debugColors.shoulder,
};
const LEDGE_STYLE: VoidLayerStyle = {
	color: "ledge",
	material: "cliff",
	name: VOID_VIEW.partNames.ledge,
	debugHex: VOID_VIEW.debugColors.ledge,
};
const OUTCROP_STYLE: VoidLayerStyle = {
	color: "ledge",
	material: "cliff",
	name: VOID_VIEW.partNames.outcrop,
	debugHex: VOID_VIEW.debugColors.outcrop,
};

/** The style of a raised layer (shoulder, ledge, outcrop); undefined for NONE and ABYSS (the backdrop draws those). */
export function voidLayerStyle(layer: number): VoidLayerStyle | undefined {
	if (layer === VoidLayer.SHOULDER) return SHOULDER_STYLE;
	if (layer === VoidLayer.LEDGE) return LEDGE_STYLE;
	if (layer === VoidLayer.OUTCROP) return OUTCROP_STYLE;
	return undefined;
}

/**
 * The void's client tunables (docs/VOID_DECOR.md VD3, VD9): the VoidController's folder, Part names, debug attributes
 * and debug palette, and how far the columns reach under the abyss plane. Presentation only.
 */
import { GAME_WORLD } from "../config";

/** Share of the backdrop slab's thickness a column's bottom sinks into (inside the slab, never out of its underside). */
const COLUMN_SINK_SHARE = 0.5;

export const VOID_VIEW = {
	/** The Workspace folder the void's Parts live in (rebuilt per floor). */
	folderName: "KV_Void",
	/** Workspace attribute (boolean): true builds no void Parts (and no abyss motes); toggles at once. Off by default. */
	offAttribute: "KV_VoidOff",
	/** Workspace attribute (boolean): true tints every void layer its `debugColors` entry; toggles at once. */
	debugAttribute: "KV_VoidDebug",
	/**
	 * Every column runs from its top down past the abyss plane (VOID.abyssDepthTiles under the floor, the backdrop's
	 * top face) by this many tiles, so its bottom sits inside the backdrop slab: no seam where a near-side cliff face
	 * meets the abyss, and nothing pokes out under the slab (sink < GAME_WORLD.backdropThicknessTiles, a spec checks).
	 */
	columnSinkTiles: COLUMN_SINK_SHARE * GAME_WORLD.backdropThicknessTiles,
	/** Columns cast shadows like the wall blocks do (WorldController's walls). */
	castShadow: true,
	/** Part names per raised layer (Explorer). */
	partNames: { shoulder: "VoidShoulder", ledge: "VoidLedge", outcrop: "VoidOutcrop" },
	/** KV_VoidDebug: one flat, clearly distinct colour per raised layer (hex), so the bands read at a glance. */
	debugColors: { shoulder: "#2f6fe0", ledge: "#e8a020", outcrop: "#d02fd0" },
} as const;

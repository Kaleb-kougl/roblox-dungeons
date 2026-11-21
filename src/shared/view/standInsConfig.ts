/**
 * Tunables of the stand-ins (docs/STAGE_ASSETS.md "Revision 2", SA18; logic in standIns.ts). Presentation only: nothing
 * here reaches the sim, the lockstep wire or a hash. Roblox-port choices, no web source.
 *
 * @module
 */
import type { SolidDecorKind } from "shared/dungeon";
import type { ColorRole } from "shared/theme";

/**
 * The shape of `SOLID_DECOR_STAND_IN`: how the plain box drawn in place of a solid decor piece whose art has not
 * downloaded is sized and coloured.
 */
export interface SolidDecorStandInConfig {
	/**
	 * The stand-in box's height per solid decor kind, tiles (its footprint is the piece's cells, inset by insetTiles).
	 * Roughly the art's standing height, kept at or under a wall's so a box never hides more than the art would.
	 */
	readonly heightTiles: Readonly<Record<SolidDecorKind, number>>;
	/** Each side of the footprint pulled in by this much, tiles (neighbouring pieces read as separate boxes). */
	readonly insetTiles: number;
	/**
	 * The box's colour: the floor's biome wall colour (its `tile.<biome>.wall` placeholder, as WorldController draws
	 * walls) mixed `lightenShare` of the way toward `lightenRole`, so it reads as stone furniture and not as a wall
	 * bump; `fallbackRole` on a floor with no matched biome.
	 */
	readonly fallbackRole: ColorRole;
	readonly lightenRole: ColorRole;
	readonly lightenShare: number;
	/** Workspace folder of the boxes. */
	readonly folderName: string;
}

/**
 * The solid decor stand-in boxes in play (standIns.ts reads it): each kind's height in tiles, the 0.06 tile inset per
 * side, and the colour (the biome's wall colour mixed 18 % toward `uiText`). A height is roughly its art's and never
 * above a wall's, so a box hides no more than the art will.
 */
export const SOLID_DECOR_STAND_IN: SolidDecorStandInConfig = {
	heightTiles: {
		tomb: 0.55,
		candelabrum: 0.9,
		throne: 0.7,
		statue: 1.2,
		brazier: 0.7,
		bookcase: 1.2,
		table: 0.5,
		chair: 0.5,
		studyTable: 0.5,
		display: 0.6,
		lectern: 0.7,
		fallenShelf: 0.35,
		diningTable: 0.5,
		barrelStack: 0.8,
		crateStack: 0.8,
		lumber: 0.45,
		barrelHeap: 0.7,
		stockpile: 1.1,
	},
	insetTiles: 0.06,
	fallbackRole: "wall",
	lightenRole: "uiText",
	lightenShare: 0.18,
	folderName: "KV_SolidStandIns",
};

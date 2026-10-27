/**
 * Every theme string key the stage loader's cover reads (docs/STAGE_LOADER.md SL2; client/ui/loading StageCard). All
 * five are REQUIRED in every pack (shared/theme contract STAGE_STRING_KEYS); stageLoader.spec.ts checks they match and
 * exist in the bundled packs. The card's biome line reuses the pack's `biome.<n>.name` (RunInfo.placeKey).
 *
 *   starting   a ranked run start waiting for the server's answer ("Starting run...")
 *   forging    floor `{floor}` is being generated under the run-start cover ("Forging floor {floor}...")
 *   building   the views are being rebuilt under the run-start cover ("Building...")
 *   floorCard  the floor-change card's title ("Floor {floor}")
 *   bossFloor  the card's extra line on a boss floor ("Boss floor")
 */
export const STAGE_STRINGS = {
	starting: "stage.starting",
	forging: "stage.forging",
	building: "stage.building",
	floorCard: "stage.floorCard",
	bossFloor: "stage.bossFloor",
} as const;

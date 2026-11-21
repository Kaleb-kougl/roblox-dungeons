/**
 * docs/COSMETICS.md CS3: the vale pack's dye measurements, the cosmetics validator's inputs (shared/theme
 * cosmeticReport: a dye's dyed mean is its colour x the mean value; rule 3's baseline is the undyed region's mean
 * colour). Written by the atlas pipeline into the generated layout (`dyeMeanValue` / `dyeSourceMean` on the sets with a
 * `dye`, art/atlases.json); undefined until `art:build` measured the set.
 *
 * @module
 */
import type { HexColor } from "../../types";
import { VALE_SPRITE_LAYOUTS } from "./layout";

/** The measured dye mean value (0..1) of sprite set `setId` (`class.vanguard`, `class.ranger`), or undefined. */
export function valeDyeMeanValue(setId: string): number | undefined {
	return VALE_SPRITE_LAYOUTS[setId]?.dyeMeanValue;
}

/** The undyed region's mean colour of sprite set `setId` (the pipeline's `dyeSourceMean`), or undefined. */
export function valeDyeSourceMean(setId: string): HexColor | undefined {
	return VALE_SPRITE_LAYOUTS[setId]?.dyeSourceMean;
}

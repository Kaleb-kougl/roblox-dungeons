/**
 * docs/COSMETICS.md CS3: the vale pack's dye mean values, the cosmetics validator's input (shared/theme
 * cosmeticReport: a dye's dyed mean is its colour x this). Written by the atlas pipeline into the generated layout
 * (`dyeMeanValue` on the sets with a `dye`, art/atlases.json); undefined until `art:build` measured the set.
 */
import { VALE_SPRITE_LAYOUTS } from "./layout";

/** The measured dye mean value (0..1) of sprite set `setId` (`class.vanguard`, `class.ranger`), or undefined. */
export function valeDyeMeanValue(setId: string): number | undefined {
	return VALE_SPRITE_LAYOUTS[setId]?.dyeMeanValue;
}

/**
 * Barrel for cosmetics on screen (docs/COSMETICS.md CS5-CS7, CS10's view half): the presentation tunables
 * (COSMETIC_VIEW) and a player's look as the views draw it (looks.ts: lookAt, the colours on the view's clock in whole
 * channels, the dye x tint, a dye's character and set, the stage's dyed sets). The Armory's Cosmetics tab and its
 * preview are shared/view/menu cosmetics.ts. Presentation only; tested headlessly (cosmetics.spec.ts). Not in the
 * shared/view barrel (like shared/view/silver): import "shared/view/cosmetics".
 *
 * @module
 */
export * from "./config";
export * from "./looks";

/**
 * The void layers (docs/VOID_DECOR.md VD2), in their own module with no imports: shared/view/decor's planDecor reads a
 * VoidPlan's layers (VD5, the void set pieces) while ./plan.ts imports shared/view/decor (decorHash, decorProfile), so
 * decorPlan.ts imports this file (and ./config.ts) directly, never the voidDecor barrel, to keep the require graph
 * acyclic.
 */

/** What a void cell is drawn as. NONE = not a void cell. */
export const VoidLayer = { NONE: 0, SHOULDER: 1, LEDGE: 2, OUTCROP: 3, ABYSS: 4 } as const;
export type VoidLayer = (typeof VoidLayer)[keyof typeof VoidLayer];

/**
 * Roblox port: the breakable outline, a yellow rim round every intact barrel and crate (BreakableRenderController), so
 * a piece you can smash reads apart from the solid decor. Pure data with no runtime import, like newEnemies3.ts: the
 * rule and its report (`breakableOutlineReport`) are in variantColors.ts, so contract.ts and validate.ts take no new
 * name. The sprite art draws its rim from a baked outline sheet (art/atlases.json worldArt piece `rim`, the vale pack's
 * decor-atlas-outline.png), tinted with this role; placeholder boxes take one shared Highlight in it.
 */

import type { ColorRole } from "./types";

/** The rim's colour role: yellow, never read as danger (held to variantColors.ts BREAKABLE_OUTLINE_COLOR_RULES). */
export const BREAKABLE_OUTLINE_ROLE: ColorRole = "breakableOutline";

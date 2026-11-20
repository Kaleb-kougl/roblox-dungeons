/**
 * The corner minimap's HUD box (docs/MINIMAP.md M7): its size in reference px, the `minimap` always-on footprint box
 * (footprint.ts HUD_FOOTPRINT, corner bottomRight) and what the verdict line moves up by.
 *
 * One source of truth: the map renderer's panel, shared/view/minimap MINIMAP_VIEW.panel (140 x 140, 35 tiles across at
 * `pxPerTile` 4, MD12). Owner decision MD7 (2026-10-27): the panel stays 140 x 140 and the cover cap
 * (HUD_FOOTPRINT_LIMITS.maxCoverShare) rose 0.12 -> 0.145 to hold it; the worst case is the 844 x 390 phone under the
 * Roblox top bar (HUD_TEST_TOP_INSET), where the HUD scale clamps at HUD_VIEW.minScale (footprint.spec.ts prints it).
 *
 * @module
 */
import { MINIMAP_VIEW } from "shared/view/minimap";

export const MINIMAP_PANEL = { w: MINIMAP_VIEW.panel.width, h: MINIMAP_VIEW.panel.height } as const;

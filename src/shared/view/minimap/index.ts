/**
 * Minimap with fog of war (docs/MINIMAP.md), the pure headless core:
 *
 *   config.ts     MINIMAP_VIEW: sight radius, panel, zoom, dims and tints, marker sizes, upload rate (§6)
 *   tiles.ts      MinimapTiles: the floor as the map draws it (map tiles, room cells + wall rings, stairwell) (§1)
 *   sight.ts      Shadowcaster: symmetric shadowcasting with exact rational slopes, no diagonal corner leaks (§2)
 *   fog.ts        FogOfWar: unknown / remembered / in sight per cell, whole-room reveal, frontier, dirty cells (§3)
 *   transform.ts  the camera-turned map: world <-> map pixels, the grid image's rotation and layout (§4)
 *   paint.ts      fog + tiles -> RGBA8 pixels in a Luau buffer (§5)
 *
 * @module
 */
export * from "./config";
export * from "./tiles";
export * from "./sight";
export * from "./fog";
export * from "./transform";
export * from "./paint";

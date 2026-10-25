/**
 * The camera view, ported from the web build so both frame the world the same way.
 *
 * Source: project-kaleb-vale `src/config.ts` (CAMERA_YAW, CAMERA_PITCH, RENDER_W/H,
 * PIXELS_PER_TILE) @ 42897e2. The web camera is a true orthographic camera; Roblox has no
 * orthographic projection, so the port fakes it with a very narrow perspective camera placed
 * far away (PLAN.md "Accepted losses"). See `shared/view` for the math.
 */

/** Camera yaw around +Y, degrees. 45: the camera sits at +X+Z looking toward -X-Z. */
export const CAMERA_YAW_DEG = 45;

/** Camera pitch below the horizon, degrees (angled top-down). */
export const CAMERA_PITCH_DEG = 55;

/** The web build's internal render resolution, in pixels. */
export const RENDER_W = 480;
export const RENDER_H = 270;

/** Render pixels per tile at that resolution (the web build's texel grid). */
export const PIXELS_PER_TILE = 16;

/**
 * Tiles visible top-to-bottom on screen, measured along the camera's up axis at the focus point
 * (the web build's orthographic frustum height: RENDER_H / PIXELS_PER_TILE).
 */
export const VIEW_TILES_HIGH = RENDER_H / PIXELS_PER_TILE;

/**
 * Roblox studs per web world unit (one dungeon tile). A default R15 character is about 5 studs
 * tall; 4 studs per tile keeps the web build's proportions (a 16x24 px class sprite is 1x1.5
 * tiles) readable next to Roblox-scale props. Changing this rescales every world-space value
 * the view layer derives from sim units.
 */
export const STUDS_PER_TILE = 4;

import type { ColorRole } from "shared/theme";

/**
 * Tunables of KV_CollisionDebug (docs/WALL_SLIDE.md WS6; logic in collisionDebug.ts, drawing in the client's
 * CollisionDebugController). A Studio check aid, off by default: presentation only, nothing here reaches the sim, the
 * dungeon or a replay. Roblox-port choices, no web source.
 */
export const COLLISION_DEBUG = {
	/** Workspace boolean attribute (Studio, or with KV_Debug): the overlay is drawn while it is true. */
	attribute: "KV_CollisionDebug",
	/** BindToRenderStep name (bound only while the overlay is on). */
	renderStep: "KvCollisionDebug",
	/** The Workspace folder that holds the overlay's anchor and adornments (exists only while it is on). */
	folderName: "KvCollisionDebug",

	// --- the blocking cells ------------------------------------------------------------------------------------------
	/** Blocking cells whose centre lies within this many tiles of the watched player's cell centre are drawn. */
	cellRadiusTiles: 3,
	/** Each cell's square is the tile minus this much (tiles, split over both sides) so neighbours read apart. */
	cellInsetTiles: 0.1,
	/** The squares' thickness and lift over the floor, studs. */
	cellThicknessStuds: 0.05,
	cellLiftStuds: 0.05,
	cellTransparency: 0.55,
	/** A wall / void / pool tile or an intact breakable. */
	cellRole: "uiAccent" as ColorRole,
	/** An isolated 1x1 blocker (a pillar or a lone crate: every one of its 8 neighbours open). */
	isolatedRole: "uiMana" as ColorRole,

	// --- the body circle ---------------------------------------------------------------------------------------------
	/** The ring's band width (inward from PLAYER_RADIUS), thickness and lift over the floor, studs. */
	ringWidthStuds: 0.15,
	ringThicknessStuds: 0.05,
	ringLiftStuds: 0.1,
	ringTransparency: 0.2,
	ringRole: "uiText" as ColorRole,
	/** The ring while a stall episode is on. */
	stallRole: "uiHealth" as ColorRole,

	/** Every piece draws over the art (a wall cell's square would be inside the wall's box otherwise). */
	alwaysOnTop: true,
	/** HandleAdornment ZIndex (0-10) of the squares and of the ring (on top of the squares). */
	cellZIndex: 1,
	ringZIndex: 2,

	// --- the stall flash (WS5's stall rule) --------------------------------------------------------------------------
	/** The move input counts as held at this magnitude or more (unit stick; the sim clamps it to 1). */
	stallInputMin: 0.5,
	/** A stall: the input held this long (seconds of sim time) ... */
	stallHoldSec: 0.3,
	/** ... and the body moved less than this share of what a free walk at that input would have in that time. */
	stallMoveShare: 0.25,
	/** Decimals of the `[collision] stall ...` line's position and input. */
	logDecimals: 2,
} as const;

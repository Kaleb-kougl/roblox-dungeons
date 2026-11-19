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
	/**
	 * docs/LOCAL_PREDICTION.md LP6: while the local player is drawn predicted the body ring follows the drawn knight and
	 * a second ring, in this role and transparency, marks the merged (sim) body; hidden otherwise.
	 */
	mergedRole: "uiTextDim" as ColorRole,
	mergedRingTransparency: 0.5,

	// --- the keep circles (docs/SWORD_SPACING.md SP6) -----------------------------------------------------------------
	/** A contact enemy's keep circle is drawn while it comes within this many tiles of the watched player's body. */
	keepNearTiles: 3,
	/** At most this many keep circles (the pool's size; the list's slot order decides which). */
	keepMaxRings: 16,
	/** The circles' band width (inward from the keep radius), thickness and lift over the floor, studs. */
	keepWidthStuds: 0.08,
	keepThicknessStuds: 0.05,
	keepLiftStuds: 0.08,
	/** The brake off (or not known: a spectated teammate): thin and dim. */
	keepDimRole: "uiTextDim" as ColorRole,
	keepDimTransparency: 0.65,
	/** The watched (local) player's brake on: lit. */
	keepLitRole: "uiAccent" as ColorRole,
	keepLitTransparency: 0.25,
	/** The watched player's body inside this keep distance. */
	keepInsideRole: "uiHealth" as ColorRole,
	keepInsideTransparency: 0.1,

	/** Every piece draws over the art (a wall cell's square would be inside the wall's box otherwise). */
	alwaysOnTop: true,
	/** HandleAdornment ZIndex (0-10): the squares, the keep circles over them, the body rings on top. */
	cellZIndex: 1,
	keepZIndex: 2,
	ringZIndex: 3,

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

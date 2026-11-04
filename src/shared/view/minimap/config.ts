/**
 * Minimap with fog of war (docs/MINIMAP.md §6): presentation tunables, all starting values for the M11 playtest.
 * Presentation only: nothing here reaches the sim, the lockstep wire or a hash. Theme colour roles live in the theme
 * contract (`MINIMAP_ROLES`, task M6), not here; the marker roles below only pick among existing roles (MD8). Roblox-port
 * feature, no web source.
 */
import { MINIMAP_ROOM_TINT_MIX, type ColorRole } from "shared/theme";

export const MINIMAP_VIEW = {
	/**
	 * Sight radius of each living player, tiles (a cell is in sight when its centre is within this distance of the
	 * source cell's centre and no wall blocks it). The screen reaches about 8.4 tiles up and 15 across.
	 */
	sightTiles: 10,
	/**
	 * The corner panel, reference px (bottom right, HUD_LAYOUT.md footprint rules; docs/MINIMAP.md §7, MD7). The one
	 * source of truth: shared/view/hud MINIMAP_PANEL (the footprint box, the verdict line's edge) reads it.
	 */
	panel: {
		width: 140,
		height: 140,
	},
	/** Corner zoom, reference px per tile: 140 / 4 = 35 tiles across (MD12). */
	pxPerTile: 4,
	/** The full-map toggle overlay (MD5). */
	fullMap: {
		/** The whole floor fits this share of the safe area's height (and its width). */
		heightShare: 0.7,
		/** Background / image transparency of the overlay, so play stays visible underneath. */
		transparency: 0.25,
	},
	/** Remembered (seen, not in sight now) cells: colour scale applied to the in-sight colour. */
	rememberedDim: 0.45,
	/**
	 * How much the room state (RoomEdgeStates -> roomEdge.* colour) tints a seen room's floor, 0..1: shared/theme
	 * MINIMAP_ROOM_TINT_MIX (0.1; the validator holds the markers to 3:1 on the tinted floors it makes).
	 */
	roomTintMix: MINIMAP_ROOM_TINT_MIX,
	/** Frontier (a seen floor cell next to unknown floor) brightening: the mix toward `minimap.frontier`, 0..1. */
	frontierMix: 0.6,
	/** Marker sizes, reference px (drawn upright over the map; MD8: plain shapes). */
	markers: {
		/** The watched player's arrow. */
		self: 9,
		/** A teammate's dot (class colour); a dead teammate's hollow ring. */
		teammate: 7,
		/** An enemy dot, only on cells in sight. */
		enemy: 4,
		/** The boss. */
		boss: 9,
		/** The stairwell, once seen (MD4). */
		stairs: 9,
		/** A boost drop's glint, only on cells in sight (MD14). */
		boost: 5,
		/** A treasure / shrine room's mark, once the room is revealed. */
		room: 6,
		/**
		 * The vault's chest (docs/TREASURE.md TR8: shared/view/treasure vaultMarkStyle), at its cell once revealed: a
		 * square in the tier's floor colour, a ring once opened. A step over the room marks: it is the floor's prize.
		 */
		vault: 7,
		/** Stroke of the hollow marks (a dead teammate's ring, the closed stairwell), reference px. */
		ringStroke: 1.5,
		/**
		 * The dark edge around the enemy, boss, stairwell and boost marks (UIStroke in `outlineRole`), reference px.
		 * Extra edge definition only: the validator holds the fills themselves to 3:1 on every floor they sit on
		 * (shared/theme minimapReport), so the marks pass without it.
		 */
		outline: 1,
		/** The self arrow's nose: a small square this big, this far ahead of the arrow's centre along the facing. */
		selfNose: 4,
		selfNoseOffset: 5,
	},
	/**
	 * Teammate dots by player index (index % size): the `class.*` roles the theme reserves for minimap dots. The party has
	 * no per-player class (every player is the vanguard capsule), so the index picks a stable identity colour.
	 */
	teammateRoles: [
		"class.vanguard",
		"class.ranger",
		"class.pyromancer",
		"class.tinkerer",
		"class.hexblade",
	] satisfies ReadonlyArray<ColorRole>,
	/** The marks' dark edge colour (markers.outline): the panel's own colour. */
	outlineRole: "uiPanel" satisfies ColorRole,
	/** Room marks (no minimap role of their own, MD8): the treasure glint's colour and the shrine effect's. */
	roomMarkRoles: {
		treasure: "decor.fx.glint" satisfies ColorRole,
		shrine: "fx.curse" satisfies ColorRole,
	},
	/** Most pixel uploads (WritePixelsBuffer) per second; dirty cells batch between them. */
	writeHz: 15,
	/** Enemy dots in the pool; more enemies in sight than this draw the nearest. */
	markerPool: 64,
	/**
	 * A source that moved more than one tile since its last update also lights what it saw along the tile line from
	 * its old tile to its new one, unless the jump is longer than this (tiles, Chebyshev): a teleport (floor change,
	 * respawn) skips the line.
	 */
	teleportTiles: 8,
	/** Largest grid side the map image may have (EditableImage limit); the M1 census asserts every floor fits. */
	maxImageSide: 1024,
} as const;

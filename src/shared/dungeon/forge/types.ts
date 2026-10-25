/*
 * Ported from Dungeon Forge (https://github.com/majidmanzarpour/threejs-procedural-dungeon), src/main.js.
 * MIT License. Copyright (c) 2026 Majid Manzarpour.
 * Full license text: THIRD_PARTY_NOTICES.md at the repository root.
 *
 * Roblox port of project-kaleb-vale src/dungeon/forge/types.ts @ 42897e2. Typed arrays became plain number arrays
 * (0-based in TypeScript, same indexing: y * W + x).
 */

/** Tile values in Dungeon.grid (indexed y * W + x). */
export const TileType = { VOID: 0, FLOOR: 1, WALL: 2, POOL: 3 } as const;
export type TileType = (typeof TileType)[keyof typeof TileType];

export const RoomType = {
	ENTRANCE: "entrance",
	COMBAT: "combat",
	ELITE: "elite",
	TREASURE: "treasure",
	SHRINE: "shrine",
	BOSS: "boss",
} as const;
export type RoomType = (typeof RoomType)[keyof typeof RoomType];

export type ThemeKey = "ancient" | "molten" | "frost" | "grim" | "verdant";

/** Room size class from the scatter stage: small 5-7, medium 8-12, large 13-18 tiles. */
export type RoomArch = "s" | "m" | "l";
export type RoomShape = "rect" | "ellipse" | "oct";

export interface Room {
	id: number;
	/** Center in grid tiles (integer after separation + grid offset). */
	cx: number;
	cy: number;
	/** Footprint in tiles. */
	w: number;
	h: number;
	arch: RoomArch;
	shape: RoomShape;
	/** Scatter position before separation (grid space, for the build animation). */
	sx0: number;
	sy0: number;
	type: RoomType;
	/** Graph hops from the entrance. */
	depth: number;
	/** min(1, 0.15 + 0.85 * depth / maxDepth); entrance 0, boss 1. */
	difficulty: number;
	/** Number of corridor edges touching this room. */
	degree: number;
	/** Frost theme: frozen lake interior. */
	lake?: boolean;
	/** Grim theme: graveyard room. */
	grave?: boolean;
}

export interface Edge {
	a: number;
	b: number;
	/** Extra edge beyond the minimum spanning tree. */
	isLoop: boolean;
	/** On the entrance -> boss path. */
	isCritical: boolean;
}

export type PropKind =
	| "ring"
	| "bossCrystal"
	| "brazier"
	| "chest"
	| "shrineCrystal"
	| "pillar"
	| "grave"
	| "sarco"
	| "candle"
	| "debris"
	| "icicle"
	| "shardIce"
	| "roots"
	| "moss"
	| "bones"
	| "crack"
	| "banner";

/** Decoration placement, in grid tiles. Fields beyond kind/x/y/rot/scale depend on kind. */
export interface Prop {
	kind: PropKind;
	x: number;
	y: number;
	rot: number;
	scale: number;
	roomId?: number;
	/** Facing (wall-mounted props: toward the floor; cracks: away from the liquid). */
	dx?: number;
	dy?: number;
	/** Debris variant 0..2. */
	v?: number;
	/** Frost lake-shore crack. */
	ice?: 1;
}

/** Enemy spawn tile. tier 1..3 (elite rooms always 3). */
export interface Spawn {
	x: number;
	y: number;
	tier: number;
	roomId: number;
}

/** Wall torch: wall tile (x, y) facing the floor tile at (x + dx, y + dy). */
export interface Torch {
	x: number;
	y: number;
	dx: number;
	dy: number;
}

export interface Cell {
	x: number;
	y: number;
}

/** Doorway arch frame: center (may be half-integer), run axis (px, py), run length <= 3. */
export interface Arch {
	x: number;
	y: number;
	px: number;
	py: number;
	len: number;
}

export interface DungeonStats {
	rooms: number;
	edges: number;
	loops: number;
	critLen: number;
	floorTiles: number;
	reach: number;
	/** Always 0 in the port: the generator may not read a clock (deterministic module). */
	genMs: number;
	attempts: number;
}

/**
 * Generator input. seed, roomCount, loopChance, decorDensity, themeKey are the original's
 * params (the demo's sliders: rooms 12..80, loopiness 0..0.40, decor 0..1, theme).
 *
 * The Kaleb-Vale options below are OFF when undefined. Off, output is identical to the
 * Dungeon Forge web demo for the same seed. Turning ANY of them on changes the layout (the first
 * four also shift the RNG stream from that point on), so such floors no longer match the demo.
 */
export interface ForgeParams {
	seed: number;
	roomCount: number;
	/** Probability that a short non-MST Delaunay edge becomes a loop corridor (demo "loopiness"). */
	loopChance: number;
	/** 0..1, scales debris/moss/bones/icicle density. */
	decorDensity: number;
	/** Theme; 'auto' (default) picks from the seed exactly like the demo's AUTO chip. */
	themeKey?: ThemeKey | "auto";

	/** Kaleb-Vale: grow combat and elite rooms to at least this many tiles on each side. */
	minCombatRoomSize?: number;
	/** Kaleb-Vale: every corridor this many tiles wide (1..7), instead of 3 critical / 2 or 1 other. Also keeps interior liquid pits 3+ tiles from corridor cells so they cannot pinch a corridor mouth. */
	corridorWidth?: number;
	/** Kaleb-Vale: at most this many treasure rooms (original: 4). */
	treasureCap?: number;
	/** Kaleb-Vale: at most this many shrine rooms (original: 2). */
	shrineCap?: number;
	/**
	 * Kaleb-Vale: pillars are solid. After all decoration (the last rng draw), every `pillar` prop's cell becomes WALL:
	 * it blocks movement, bullets and line of sight like any wall. Draws nothing, so every other prop, spawn, torch,
	 * arch, pool and the name are exactly the option-off floor's; the pillar props stay in `props` (where the decor
	 * goes). The cell keeps its `roomId` (like an interior pit: walkability is the grid's job, so code that wants
	 * standing room checks `grid === FLOOR`); `bfs`, `maxBfs`, `stats.floorTiles` / `reach` and `valid` describe the
	 * walled grid. Endless floors only (`endlessFloorParams`); M1 (`KALEB_VALE_MVP_PARAMS`) and the fixtures leave it off.
	 */
	solidPillars?: boolean;
}

/** ForgeParams after defaults: themeKey resolved to a concrete theme. */
export interface ResolvedForgeParams extends ForgeParams {
	themeKey: ThemeKey;
}

export interface Dungeon {
	valid: boolean;
	params: ResolvedForgeParams;
	/** Seed of the attempt that produced this layout (differs from params.seed after a reroll). */
	seed: number;
	name: string;
	W: number;
	H: number;
	/** TileType per cell, y * W + x. */
	grid: number[];
	/** Room id per cell, -1 outside rooms (corridors, walls, void). */
	roomId: number[];
	/** 1 where a corridor stamp created floor. */
	corridor: number[];
	/** 1 on corridor cells touching a room. */
	doorway: number[];
	/** BFS distance from the entrance center over FLOOR, -1 unreachable (after solidPillars: over the walled grid). */
	bfs: number[];
	maxBfs: number;
	rooms: Room[];
	edges: Edge[];
	/** Room index of the entrance / boss. */
	entrance: number;
	boss: number;
	maxDepth: number;
	props: Prop[];
	spawns: Spawn[];
	torches: Torch[];
	pools: Cell[];
	lakeCells: Cell[];
	lakeMask: number[];
	arches: Arch[];
	stats: DungeonStats;
}

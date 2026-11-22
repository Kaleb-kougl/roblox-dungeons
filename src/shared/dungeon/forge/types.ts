/*
 * Ported from Dungeon Forge (https://github.com/majidmanzarpour/threejs-procedural-dungeon), src/main.js.
 * MIT License. Copyright (c) 2026 Majid Manzarpour.
 * Full license text: THIRD_PARTY_NOTICES.md at the repository root.
 *
 * Roblox port of the web build's src/dungeon/forge/types.ts @ 42897e2. Typed arrays became plain number arrays
 * (0-based in TypeScript, same indexing: y * W + x).
 */
import type { DecorCarpet, RoomTheme, SolidDecorPiece } from "./solidDecor";

/** Tile values in Dungeon.grid (indexed y * W + x). */
export const TileType = { VOID: 0, FLOOR: 1, WALL: 2, POOL: 3 } as const;
/** A cell's tile value, one of the TileType constants. */
export type TileType = (typeof TileType)[keyof typeof TileType];

/** The room roles the graph stage assigns: one entrance, one boss room, the rest combat, elite, treasure or shrine. */
export const RoomType = {
	ENTRANCE: "entrance",
	COMBAT: "combat",
	ELITE: "elite",
	TREASURE: "treasure",
	SHRINE: "shrine",
	BOSS: "boss",
} as const;
/** A room's role, one of the RoomType constants. */
export type RoomType = (typeof RoomType)[keyof typeof RoomType];

/**
 * The Forge's five floor themes. A theme changes generation (pools, lakes, graveyards, the name pools), not only the
 * look.
 */
export type ThemeKey = "ancient" | "molten" | "frost" | "grim" | "verdant";

/** Room size class from the scatter stage: small 5-7, medium 8-12, large 13-18 tiles. */
export type RoomArch = "s" | "m" | "l";
/** The outline a room's footprint is carved in. */
export type RoomShape = "rect" | "ellipse" | "oct";

/** One room of a floor, filled in stage by stage while the generator runs (scatter, graph, theme, carve). */
export interface Room {
	/** The room's index in Dungeon.rooms, and its value in Dungeon.roomId. */
	id: number;
	/** Center in grid tiles (integer after separation + grid offset). */
	cx: number;
	/** Center row, grid tiles. */
	cy: number;
	/** Footprint in tiles. */
	w: number;
	/** Footprint height, tiles. */
	h: number;
	/** The size class it was rolled in. */
	arch: RoomArch;
	/** The outline its floor is carved in. */
	shape: RoomShape;
	/** Scatter position before separation (grid space, for the build animation). */
	sx0: number;
	/** The scatter position's y. */
	sy0: number;
	/** Its role on the floor. */
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

/** A corridor between two rooms of the graph. */
export interface Edge {
	/** Room id at one end. */
	a: number;
	/** Room id at the other end. */
	b: number;
	/** Extra edge beyond the minimum spanning tree. */
	isLoop: boolean;
	/** On the entrance -> boss path. */
	isCritical: boolean;
}

/**
 * The decoration kinds the Forge places. Presentation, except `pillar` under ForgeParams.solidPillars (its cell becomes
 * WALL).
 */
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
	/** What to draw. */
	kind: PropKind;
	/** Column, grid tiles (may be fractional). */
	x: number;
	/** Row, grid tiles (may be fractional). */
	y: number;
	/** Rotation about the vertical axis, radians. */
	rot: number;
	/** Size multiplier; 1 is the model's own size. */
	scale: number;
	/** The room it decorates; absent for props outside rooms. */
	roomId?: number;
	/** Facing (wall-mounted props: toward the floor; cracks: away from the liquid). */
	dx?: number;
	/** Facing, y part. */
	dy?: number;
	/** Debris variant 0..2. */
	v?: number;
	/** Frost lake-shore crack. */
	ice?: 1;
}

/** Enemy spawn tile. tier 1..3 (elite rooms always 3). */
export interface Spawn {
	/** Column, grid tiles. */
	x: number;
	/** Row, grid tiles. */
	y: number;
	/** 1..3: 3 in elite rooms, else ceil(room difficulty x 3), at least 1. */
	tier: number;
	/** The room it is in. */
	roomId: number;
}

/** Wall torch: wall tile (x, y) facing the floor tile at (x + dx, y + dy). */
export interface Torch {
	/** The wall tile's column. */
	x: number;
	/** The wall tile's row. */
	y: number;
	/** Step to the floor tile it faces, x (-1, 0 or 1). */
	dx: number;
	/** Step to the floor tile it faces, y (-1, 0 or 1). */
	dy: number;
}

/** A grid cell by column and row. */
export interface Cell {
	/** Column. */
	x: number;
	/** Row. */
	y: number;
}

/** Doorway arch frame: center (may be half-integer), run axis (px, py), run length <= 3. */
export interface Arch {
	/** Center column (may be half-integer). */
	x: number;
	/** Center row (may be half-integer). */
	y: number;
	/** The run axis, x part. */
	px: number;
	/** The run axis, y part. */
	py: number;
	/** Tiles the frame spans along its axis (at most 3). */
	len: number;
}

/** Counts of the finished layout, as the demo's stats panel showed them. */
export interface DungeonStats {
	/** Rooms on the floor. */
	rooms: number;
	/** Corridor edges, loops included. */
	edges: number;
	/** Edges beyond the minimum spanning tree. */
	loops: number;
	/** Edges on the entrance -> boss path. */
	critLen: number;
	/** FLOOR cells on the grid. */
	floorTiles: number;
	/** FLOOR cells the entrance flood reached; equal to floorTiles on a valid floor. */
	reach: number;
	/** Always 0 in the port: the generator may not read a clock (deterministic module). */
	genMs: number;
	/** Attempts it took: 1 unless the seed's first layout was not fully connected and rerolled. */
	attempts: number;
}

/**
 * Generator input. seed, roomCount, loopChance, decorDensity, themeKey are the original's
 * params (the demo's sliders: rooms 12..80, loopiness 0..0.40, decor 0..1, theme).
 *
 * The game's options below are OFF when undefined. Off, output is identical to the
 * Dungeon Forge web demo for the same seed. Turning ANY of them on changes the layout (the first
 * four also shift the RNG stream from that point on), so such floors no longer match the demo.
 */
export interface ForgeParams {
	/** Any number; the generator's rng starts from its uint32. */
	seed: number;
	/** Rooms to scatter (the demo: 12..80). */
	roomCount: number;
	/** Probability that a short non-MST Delaunay edge becomes a loop corridor (demo "loopiness"). */
	loopChance: number;
	/** 0..1, scales debris/moss/bones/icicle density. */
	decorDensity: number;
	/** Theme; 'auto' (default) picks from the seed exactly like the demo's AUTO chip. */
	themeKey?: ThemeKey | "auto";

	/** Game option: grow combat and elite rooms to at least this many tiles on each side (x `roomScale`). */
	minCombatRoomSize?: number;
	/**
	 * Game option: room size multiplier (integer >= 1). Every room's rolled width and height, `minCombatRoomSize` and
	 * the scatter radius are multiplied by it, so a floor keeps the same draws and roughly the same shape, just with
	 * rooms `roomScale` times as wide and tall. Draws nothing extra; 1 or undefined is the unscaled floor exactly.
	 * Endless floors only (`endlessFloorParams`, ENDLESS_ROOM_SCALE); M1 and the fixtures leave it off.
	 */
	roomScale?: number;
	/** Game option: every corridor this many tiles wide (1..7), instead of 3 critical / 2 or 1 other. Also keeps interior liquid pits 3+ tiles from corridor cells so they cannot pinch a corridor mouth. */
	corridorWidth?: number;
	/** Game option: at most this many treasure rooms (original: 4). */
	treasureCap?: number;
	/** Game option: at most this many shrine rooms (original: 2). */
	shrineCap?: number;
	/**
	 * Game option: pillars are solid. After all decoration (the last rng draw), every `pillar` prop's cell becomes WALL:
	 * it blocks movement, bullets and line of sight like any wall. Draws nothing, so every other prop, spawn, torch,
	 * arch, pool and the name are exactly the option-off floor's; the pillar props stay in `props` (where the decor
	 * goes). The cell keeps its `roomId` (like an interior pit: walkability is the grid's job, so code that wants
	 * standing room checks `grid === FLOOR`); `bfs`, `maxBfs`, `stats.floorTiles` / `reach` and `valid` describe the
	 * walled grid. Endless floors only (`endlessFloorParams`); M1 (`KALEB_VALE_MVP_PARAMS`) and the fixtures leave it off.
	 */
	solidPillars?: boolean;
	/**
	 * Game option: solid decor (./solidDecor.ts, docs/DECOR.md "Solid decor"). After solid pillars, combat and elite rooms
	 * get tombs and candle stands whose cells become WALL (Dungeon.solidDecor lists them), from their own stream: every
	 * other prop, spawn, torch, arch, pool and the name are the option-off floor's. `bfs`, `maxBfs`, the floor stats and
	 * `valid` describe the walled grid. Endless floors only (`endlessFloorParams`); M1, the fixtures and the tutorial
	 * leave it off.
	 */
	solidDecor?: boolean;
	/**
	 * Game option: a fixed linear floor (the tutorial's floor 1, docs/TUTORIAL.md). The rooms are these, in walk order
	 * (room id = index; the first is the entrance, the last the boss room), laid out by ./chain.ts with exactly one
	 * straight corridor between each room and the next and nothing else: no scatter, separation, Delaunay graph, MST,
	 * loops or room-type draws. Everything after the graph (theme mutations, carving, pits, arches, BFS, decoration,
	 * solid pillars) runs exactly as for a rolled floor, from the seed's stream. `roomCount` must equal its size.
	 * Off (undefined) on every other floor; M1, endless floors and the fixtures never set it.
	 */
	chain?: ReadonlyArray<ForgeChainRoom>;
}

/** Where the next room of a chain (ForgeParams.chain) lies: +x, -x, +y or -y in grid space. */
export type ForgeChainDir = "e" | "w" | "s" | "n";

/** One room of a chain floor (ForgeParams.chain). */
export interface ForgeChainRoom {
	/** The room's role. */
	readonly type: RoomType;
	/**
	 * Footprint in tiles before `roomScale` (like a rolled size: x roomScale, then combat and elite rooms grow to
	 * `minCombatRoomSize` x roomScale). Positive integers.
	 */
	readonly w: number;
	/** Footprint height before `roomScale`, the same way. */
	readonly h: number;
	/** The outline its floor is carved in. */
	readonly shape: RoomShape;
	/** The next room's side of this one (absent on the last room only). */
	readonly next?: ForgeChainDir;
	/** Corridor tiles between this room's floor and the next room's (an integer >= 1; not scaled). */
	readonly gap?: number;
}

/** ForgeParams after defaults: themeKey resolved to a concrete theme. */
export interface ResolvedForgeParams extends ForgeParams {
	/** The theme used: never "auto". */
	themeKey: ThemeKey;
}

/**
 * One generated floor: the tile grid, the room graph and everything placed on it. The sim, the encounter and decor
 * planners and the view all read this.
 */
export interface Dungeon {
	/** Every FLOOR cell is reachable from the entrance. `generate` only returns valid floors. */
	valid: boolean;
	/** The params it was generated from, with the theme resolved. */
	params: ResolvedForgeParams;
	/** Seed of the attempt that produced this layout (differs from params.seed after a reroll). */
	seed: number;
	/** The floor's generated name ("The Sunken Halls of ..."); its draws are part of seed parity. */
	name: string;
	/** Grid width, tiles. */
	W: number;
	/** Grid height, tiles. */
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
	/** The largest value in `bfs`. */
	maxBfs: number;
	/** The rooms, indexed by id. */
	rooms: Room[];
	/** The corridors of the room graph. */
	edges: Edge[];
	/** Room index of the entrance / boss. */
	entrance: number;
	/** Room index of the boss room. */
	boss: number;
	/** The largest Room.depth on the floor. */
	maxDepth: number;
	/** Decoration, in placement order (the order is part of fixture parity). */
	props: Prop[];
	/** Enemy spawn tiles, rooms in id order. */
	spawns: Spawn[];
	/** Wall torches. */
	torches: Torch[];
	/** Liquid cells (TileType.POOL): wall pockets and interior pits. */
	pools: Cell[];
	/** Frost lake cells: FLOOR that is drawn as ice (still walkable). */
	lakeCells: Cell[];
	/** 1 on the cells of `lakeCells`, per cell (y * W + x). */
	lakeMask: number[];
	/** Doorway arch frames. */
	arches: Arch[];
	/** Solid decor (ForgeParams.solidDecor): set pieces standing on WALL cells; empty when off. */
	solidDecor: SolidDecorPiece[];
	/** Carpet runs (ForgeParams.solidDecor, the boss room's throne): flat, walkable presentation; absent or empty when off. */
	carpets?: DecorCarpet[];
	/** Each room's dressing theme by room id (ForgeParams.solidDecor); absent or empty when off. */
	roomThemes?: RoomTheme[];
	/**
	 * Solid pillar cells a free-standing piece took (ForgeParams.solidDecor: a library's study tables, display cases and
	 * toppled case, a mess hall's dining tables; docs/BOOKSHELVES.md, docs/KENNEY_DECOR.md): FLOOR again, or under one
	 * of its pieces. Their `pillar` props stay in `props` (so every prop index is the option-off floor's); the
	 * decor plan draws nothing for them. Absent or empty when off.
	 */
	clearedPillars?: Array<{ x: number; y: number }>;
	/** Counts of this layout. */
	stats: DungeonStats;
}

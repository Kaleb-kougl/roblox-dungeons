/*
 * Kaleb-Vale addition to the Dungeon Forge port (no Dungeon Forge or web source): the `chain` option's room graph.
 * Dungeon Forge: MIT License. Copyright (c) 2026 Majid Manzarpour.
 * Full license text: THIRD_PARTY_NOTICES.md at the repository root.
 *
 * A chain floor (ForgeParams.chain, the tutorial's floor 1) skips the rolled floor's stages 1-4.2 (scatter, separate,
 * Delaunay, MST + loops, semantics, minCombatRoomSize): its rooms are the given ones, in walk order, each placed on
 * the given side of the one before with its centre on the same row (or column), `gap` corridor tiles from it. The
 * edges are exactly the chain's neighbours, so tryGenerate's carve stage stamps ONE straight corridor between each
 * room and the next (the rooms overlap across the corridor axis, so no L bend and no rng draw), and nothing else.
 * Draws nothing: the rest of tryGenerate (theme mutations, carving, pits, arches, BFS, decoration, solid pillars) runs
 * as for any floor from the seed's stream.
 *
 * Guaranteed (else it throws, before any carving): no room, and no corridor, comes within CHAIN_CLEARANCE tiles of a
 * room or corridor it does not join, so the only ways out of room i lead into rooms i - 1 and i + 1.
 */
import type { Edge, ForgeChainRoom, Room, RoomArch } from "./types";

/** Empty tiles kept between any two pieces (rooms, corridors) of a chain that are not joined (room to wall to room). */
export const CHAIN_CLEARANCE = 2;
/** The demo's critical-path corridor width, which chain corridors get when ForgeParams.corridorWidth is unset. */
const DEFAULT_CHAIN_CORRIDOR_WIDTH = 3;
/** A straight corridor needs the two rooms to overlap this much more than its width across it (tryGenerate's test). */
const STRAIGHT_OVERLAP_SLACK = 2;
/** Size classes by the unscaled longer side (the scatter's: small 5-7, medium 8-12, large 13-18). */
const SMALL_MAX = 7;
const MEDIUM_MAX = 12;

/**
 * The room graph of one attempt (tryGenerate's stages 1-4.2, rolled or a chain): rooms with types, depth and
 * difficulty, the corridor edges, the entrance and the boss room.
 */
export interface ForgeGraph {
	/** The rooms, indexed by id. */
	rooms: Room[];
	/** The corridor edges. */
	edges: Edge[];
	/** Room index of the entrance. */
	entrance: number;
	/** Room index of the boss room. */
	boss: number;
	/** The largest Room.depth. */
	maxDepth: number;
	/** Edges on the entrance -> boss path. */
	critLen: number;
}

/** Grid-space box (inclusive cells). */
interface Box {
	x0: number;
	x1: number;
	y0: number;
	y1: number;
}

function isPositiveInteger(v: number): boolean {
	return v === v && v >= 1 && math.floor(v) === v && v !== math.huge;
}

/** Checks a chain's shape (no geometry): roomCount rooms, the entrance first, the boss last, sizes, sides and gaps. */
export function validateChain(chain: ReadonlyArray<ForgeChainRoom>, roomCount: number): void {
	const n = chain.size();
	if (n !== roomCount) error(`RangeError: chain has ${n} rooms but roomCount is ${roomCount}`);
	for (let i = 0; i < n; i++) {
		const r = chain[i];
		const want = i === 0 ? "entrance" : i === n - 1 ? "boss" : undefined;
		if (want !== undefined && r.type !== want)
			error(`RangeError: chain room ${i} must be the ${want}, got ${r.type}`);
		if (want === undefined && (r.type === "entrance" || r.type === "boss")) {
			error(`RangeError: chain room ${i} is a second ${r.type}`);
		}
		if (!isPositiveInteger(r.w) || !isPositiveInteger(r.h)) {
			error(`RangeError: chain room ${i} size must be positive integers, got ${r.w}x${r.h}`);
		}
		if (i < n - 1) {
			if (r.next === undefined) error(`RangeError: chain room ${i} has no next side`);
			if (r.gap === undefined || !isPositiveInteger(r.gap)) {
				error(`RangeError: chain room ${i} gap must be an integer >= 1, got ${tostring(r.gap)}`);
			}
		}
	}
}

/** The room's floor cells' box: a w-wide room spans cx +- floor(w / 2) in every shape (tryGenerate's raster). */
function roomBox(r: Room): Box {
	const hx = math.floor(r.w / 2);
	const hy = math.floor(r.h / 2);
	return { x0: r.cx - hx, x1: r.cx + hx, y0: r.cy - hy, y1: r.cy + hy };
}

/** True when at least `clear` empty cells separate the boxes on some axis. */
function apart(a: Box, b: Box, clear: number): boolean {
	return a.x0 - b.x1 > clear || b.x0 - a.x1 > clear || a.y0 - b.y1 > clear || b.y0 - a.y1 > clear;
}

function archOf(w: number, h: number): RoomArch {
	const m = math.max(w, h);
	return m <= SMALL_MAX ? "s" : m <= MEDIUM_MAX ? "m" : "l";
}

/**
 * The chain's room graph (see the file comment), in pre-offset grid space like the rolled stages' output. Sizes are
 * x `scale`, then combat and elite rooms grow to `minCombatRoomSize` x scale. Throws when two pieces that are not
 * joined come within CHAIN_CLEARANCE tiles, or a pair cannot be joined by a straight corridor.
 */
export function chainGraph(
	chain: ReadonlyArray<ForgeChainRoom>,
	scale: number,
	minCombatRoomSize: number | undefined,
	corridorWidth: number | undefined,
): ForgeGraph {
	const n = chain.size();
	const maxDepth = math.max(1, n - 1);
	const width = corridorWidth ?? DEFAULT_CHAIN_CORRIDOR_WIDTH;
	const lo = -math.floor((width - 1) / 2); // tryGenerate corridorOffsets: lo .. lo + width - 1
	const rooms: Room[] = [];
	let cx = 0;
	let cy = 0;
	for (let i = 0; i < n; i++) {
		const c = chain[i];
		let w = c.w * scale;
		let h = c.h * scale;
		if (minCombatRoomSize !== undefined && (c.type === "combat" || c.type === "elite")) {
			w = math.max(w, minCombatRoomSize * scale);
			h = math.max(h, minCombatRoomSize * scale);
		}
		if (i > 0) {
			const prev = rooms[i - 1];
			const from = chain[i - 1];
			const gap = from.gap!;
			const side = from.next!;
			if (side === "e" || side === "w") {
				const d = math.floor(prev.w / 2) + gap + 1 + math.floor(w / 2);
				cx = prev.cx + (side === "e" ? d : -d);
			} else {
				const d = math.floor(prev.h / 2) + gap + 1 + math.floor(h / 2);
				cy = prev.cy + (side === "s" ? d : -d);
			}
		}
		const depth = i;
		const difficulty = i === 0 ? 0 : i === n - 1 ? 1 : math.min(1, 0.15 + 0.85 * (depth / maxDepth));
		rooms.push({
			id: i,
			cx,
			cy,
			w,
			h,
			arch: archOf(c.w, c.h),
			shape: c.shape,
			sx0: cx,
			sy0: cy,
			type: c.type,
			depth,
			difficulty,
			degree: (i > 0 ? 1 : 0) + (i < n - 1 ? 1 : 0),
		});
	}

	// The corridors' boxes (between the two rooms' floors, the corridor's rows / columns across) and the edges.
	const edges: Edge[] = [];
	const corridors: Box[] = [];
	for (let i = 0; i < n - 1; i++) {
		const a = rooms[i];
		const b = rooms[i + 1];
		const ra = roomBox(a);
		const rb = roomBox(b);
		const side = chain[i].next;
		const horizontal = side === "e" || side === "w";
		// Centres on one row (column): the overlap across the corridor is the narrower room.
		const span = horizontal ? math.min(a.h, b.h) : math.min(a.w, b.w);
		if (span < width + STRAIGHT_OVERLAP_SLACK) {
			error(`RangeError: chain rooms ${i} and ${i + 1} are too narrow for a straight ${width}-tile corridor`);
		}
		corridors.push(
			horizontal
				? {
						x0: math.min(ra.x1, rb.x1) + 1,
						x1: math.max(ra.x0, rb.x0) - 1,
						y0: a.cy + lo,
						y1: a.cy + lo + width - 1,
				  }
				: {
						x0: a.cx + lo,
						x1: a.cx + lo + width - 1,
						y0: math.min(ra.y1, rb.y1) + 1,
						y1: math.max(ra.y0, rb.y0) - 1,
				  },
		);
		edges.push({ a: i, b: i + 1, isLoop: false, isCritical: true });
	}

	// Nothing touches what it does not join.
	const boxes = rooms.map(roomBox);
	for (let i = 0; i < n; i++)
		for (let j = i + 2; j < n; j++)
			if (!apart(boxes[i], boxes[j], CHAIN_CLEARANCE)) error(`RangeError: chain rooms ${i} and ${j} touch`);
	for (let k = 0; k < corridors.size(); k++) {
		for (let i = 0; i < n; i++) {
			if (i === k || i === k + 1) continue;
			if (!apart(corridors[k], boxes[i], CHAIN_CLEARANCE)) {
				error(`RangeError: chain corridor ${k}-${k + 1} touches room ${i}`);
			}
		}
		for (let j = k + 1; j < corridors.size(); j++)
			if (!apart(corridors[k], corridors[j], CHAIN_CLEARANCE)) {
				error(`RangeError: chain corridors ${k}-${k + 1} and ${j}-${j + 1} touch`);
			}
	}
	return { rooms, edges, entrance: 0, boss: n - 1, maxDepth, critLen: n - 1 };
}

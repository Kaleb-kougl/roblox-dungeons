/**
 * The Snatcher's flee field (docs/NEW_ENEMIES_2.md NX4, "Design > Snatcher"): shared/dungeon fleeField over its room's
 * floor rectangle, the Goldling's construction (sim/golden goldenField.ts) without floor data of its own.
 *
 *   box       the room's floor rectangle (shared/dungeon roomGridRect of the encounter room).
 *   open      a box cell a body can stand on now: not body-blocked by the floor's world (SimCtx.isBodyBlocked: walls,
 *             pillars, solid decor, pools) and not an intact breakable's cell (solidCells).
 *   sources   every living player (index order) whose cell lies inside the box grown by SOURCE_MARGIN_CELLS (a doorway
 *             and the corridor tile before it), clamped into the box; a source on a closed cell is ignored (fleeField).
 *             Where its cell is unreached (no usable source) the caller falls back to walking straight away.
 *   field     fleeField(open, w, h, sources, factor): walking it downhill (fleeStep) runs away from the players along
 *             the room, not into its far corner.
 *
 * A pure function of hashed state (player positions, the intact pieces) and floor data (the world config, the room),
 * read fresh every tick it is needed (no hashed field tick: the Snatcher has no v slot to spare). The cache below is a
 * memo, never state: one entry per encounter room id (sized for one Snatcher per room, NXD9; two in one room read the
 * same entry, and get the same field as they would alone), keyed on everything it reads (the room object, the world
 * config, the breakables' piece list and intact count, the source cells), so any state (a clone, another run, a spec)
 * gets exactly the field it would build from scratch. It allocates only when a room id first appears or its box grows.
 *
 * @module
 */
import {
	cellKey,
	fleeField,
	fleeStep,
	gridToWorld,
	newFleeScratch,
	roomGridRect,
	TILE_SIZE,
	worldToGrid,
	type EncounterRoom,
	type FleeScratch,
} from "shared/dungeon";
import type { SimConfig } from "../../../step";
import { solidCells } from "../../../breakables/cells";
import { partySize, playerAt } from "../../../party";
import type { SimCtx } from "../../ctx";

/** A living player within this many cells outside the box (a doorway) is a source, clamped onto the box's edge. */
export const SNATCHER_SOURCE_MARGIN_CELLS = 2;

interface FieldEntry {
	/** Key: the encounter room (floor data) and its rectangle. */
	room: EncounterRoom | undefined;
	x0: number;
	y0: number;
	w: number;
	h: number;
	/** Key of `open`: the world config (its body blocker), the breakables' pieces and their intact count. */
	config: Readonly<SimConfig> | undefined;
	pieces: unknown;
	intact: number;
	/** Key of `field`: the fleeField factor and the source cells it was built from (`built` false: never). */
	factor: number;
	src: number[];
	built: boolean;
	/** Buffers, at least w x h long. */
	cap: number;
	open: number[];
	field: number[];
	scratch: FleeScratch | undefined;
}

const entries = new Map<number, FieldEntry>();
/** Scratch: this tick's source cells. */
const sources: number[] = [];

/** The field's step out of fleeSnatcherTarget: the world centre of the cell to walk to. */
export const SNATCHER_FLEE_TARGET = { x: 0, z: 0 };

function newEntry(): FieldEntry {
	return {
		room: undefined,
		x0: 0,
		y0: 0,
		w: 0,
		h: 0,
		config: undefined,
		pieces: undefined,
		intact: -1,
		factor: 0,
		src: [],
		built: false,
		cap: 0,
		open: [],
		field: [],
		scratch: undefined,
	};
}

function clampInt(v: number, lo: number, hi: number): number {
	return v < lo ? lo : v > hi ? hi : v;
}

/** This tick's source cells for box `e` into `sources` (see the file comment). */
function readSources(ctx: SimCtx, e: Readonly<FieldEntry>): void {
	sources.clear();
	const state = ctx.state;
	const n = partySize(state);
	for (let i = 0; i < n; i++) {
		const p = playerAt(state, i);
		if (p.dead !== 0) continue;
		const lx = worldToGrid(p.x) - e.x0;
		const ly = worldToGrid(p.z) - e.y0;
		const m = SNATCHER_SOURCE_MARGIN_CELLS;
		if (lx < -m || ly < -m || lx >= e.w + m || ly >= e.h + m) continue;
		sources.push(clampInt(ly, 0, e.h - 1) * e.w + clampInt(lx, 0, e.w - 1));
	}
}

function sameSources(e: Readonly<FieldEntry>): boolean {
	if (e.src.size() !== sources.size()) return false;
	for (let k = 0; k < sources.size(); k++) if (e.src[k] !== sources[k]) return false;
	return true;
}

/** Brings entry `e` up to date for `room` this tick (see the file comment). */
function refresh(ctx: SimCtx, e: FieldEntry, room: EncounterRoom, factor: number): void {
	if (e.room !== room) {
		const [x0, y0, x1, y1] = roomGridRect(room);
		e.room = room;
		e.x0 = x0;
		e.y0 = y0;
		e.w = x1 - x0 + 1;
		e.h = y1 - y0 + 1;
		e.config = undefined;
		e.built = false;
	}
	const n = e.w * e.h;
	if (e.cap < n) {
		e.open = new Array<number>(n, 0);
		e.field = new Array<number>(n, 0);
		e.scratch = newFleeScratch(n);
		e.cap = n;
		e.config = undefined;
		e.built = false;
	}
	const b = ctx.state.breakables;
	const pieces: unknown = b?.pieces;
	const intact = b?.intact ?? 0;
	if (e.config !== ctx.config || e.pieces !== pieces || e.intact !== intact) {
		const solid = solidCells(ctx.state);
		for (let ly = 0; ly < e.h; ly++)
			for (let lx = 0; lx < e.w; lx++) {
				const gx = e.x0 + lx;
				const gy = e.y0 + ly;
				const blocked =
					ctx.isBodyBlocked(gridToWorld(gx), gridToWorld(gy)) ||
					(solid !== undefined && solid.has(cellKey(gx, gy)));
				e.open[ly * e.w + lx] = blocked ? 0 : 1;
			}
		e.config = ctx.config;
		e.pieces = pieces;
		e.intact = intact;
		e.built = false;
	}
	readSources(ctx, e);
	if (e.built && e.factor === factor && sameSources(e)) return;
	fleeField(e.open, e.w, e.h, sources, sources.size(), e.field, e.scratch!, factor);
	e.factor = factor;
	e.src.clear();
	for (const c of sources) e.src.push(c);
	e.built = true;
}

/** The box cell of world (x, z) in `e`, or -1 outside it. */
function boxCell(e: Readonly<FieldEntry>, x: number, z: number): number {
	const lx = worldToGrid(x) - e.x0;
	const ly = worldToGrid(z) - e.y0;
	if (lx < 0 || ly < 0 || lx >= e.w || ly >= e.h) return -1;
	return ly * e.w + lx;
}

/**
 * Where a Snatcher at (x, z) in `room` should flee this tick: 1 with SNATCHER_FLEE_TARGET set to the world centre of
 * fleeStep's cell; 0 where no neighbour is lower (a safe spot: it stands); -1 when (x, z) is outside the room's box or
 * its cell is unreached (no usable source in its part of the room: a player outside the margin, or every player on a
 * closed cell): the caller falls back. No rng.
 */
export function snatcherFleeTarget(ctx: SimCtx, room: EncounterRoom, x: number, z: number, factor: number): number {
	let e = entries.get(room.id);
	if (e === undefined) {
		e = newEntry();
		entries.set(room.id, e);
	}
	refresh(ctx, e, room, factor);
	const cell = boxCell(e, x, z);
	if (cell < 0 || e.field[cell] === math.huge) return -1;
	const lx = cell % e.w;
	const ly = (cell - lx) / e.w;
	const target = fleeStep(e.open, e.w, e.h, e.field, lx, ly);
	if (target < 0) return 0;
	const tlx = target % e.w;
	const tly = (target - tlx) / e.w;
	SNATCHER_FLEE_TARGET.x = gridToWorld(e.x0 + tlx);
	SNATCHER_FLEE_TARGET.z = gridToWorld(e.y0 + tly);
	return 1;
}

/**
 * True when world (x, z) lies inside `room`'s floor rectangle (roomGridRect's cells, without its allocation): the flee
 * step never leaves it.
 */
export function snatcherInRoomBox(room: Readonly<EncounterRoom>, x: number, z: number): boolean {
	const half = TILE_SIZE / 2;
	const gx = worldToGrid(x);
	const gy = worldToGrid(z);
	return (
		gx >= worldToGrid(room.minX + half) &&
		gx <= worldToGrid(room.maxX - half) &&
		gy >= worldToGrid(room.minZ + half) &&
		gy <= worldToGrid(room.maxZ - half)
	);
}

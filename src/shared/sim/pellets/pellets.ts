/**
 * Pellets in the sim (docs/PELLETS.md PL2; a Roblox-port feature, no web source). OPT-IN: only a SimConfig with
 * `pellets` creates `SimState.pellets`, and only then does anything here run or the hash grow the appended `pellets`
 * group. Without it nothing changes (M1, every golden fixture, every replay that does not set it).
 *
 * Where the pellets lie is decided when the floor is built (shared/dungeon placePellets, PD5): the sim copies it in at
 * floor start and draws NO rng for pellets.
 *
 *   floor start   pelletsOnFloor(state, floorPellets) from createSimState (after the score state: pellets hang off
 *                 its room records) and from stepEndless's floor change (after rebuildScoreRooms): per pellet its world
 *                 position, the index of its room's score record (`rec`, -1 when the room has none: such a pellet
 *                 never goes live), taken 0; per score record its pellet range (`first` / `span`), its regular pellets
 *                 (`count`, the power pellet left out: PD8) and how many are still untaken (`left`), phase DORMANT,
 *                 swept 0; the cell -> pellet lookup (`byCell`, floor data, not hashed).
 *   rooms         one PelletRoom per score record (same index as state.score.rooms); without scoring there are none.
 *                 phase DORMANT -> LIVE on the record's engagement -> GONE at its clear (docs/PELLETS.md PL3).
 *
 * Behaviour (live / pickup / sweep / gone, PL3; the power pellet, PL4) is not here yet: this module holds the state,
 * its floor fill, clone and hash. Score awards (scorePellet / scoreSweep / scorePowerBullets) live in score/score.ts,
 * which reads `state.pellets.config` through the state types only (never requires this module).
 */
import { NO_POWER_PELLET, cellKey, worldToGrid, type FloorPellets } from "shared/dungeon";
import type { SimState } from "../state";
import {
	PELLET_PICKUP_RADIUS,
	PELLET_POINTS,
	POWER_BULLET_POINTS,
	POWER_MAX_BULLETS,
	SWEEP_POINTS,
} from "./pelletsData";

/** SimConfig.pellets: presence turns pellets on. */
export interface PelletsConfig {
	/** A living player's centre within this of a live pellet takes it (world units). */
	readonly pickupRadius: number;
	/** Base points per pellet (x the kills' floor scale). */
	readonly pelletPoints: number;
	/** The Sweep bonus base (flat). */
	readonly sweepPoints: number;
	/** Base points per enemy bullet the power pellet converts (flat). */
	readonly powerBulletPoints: number;
	/** The power pellet pays at most this many bullets. */
	readonly powerMaxBullets: number;
	/**
	 * Sandboxes without endless mode (specs): the run's one floor of pellets. Endless runs ignore it: each floor's
	 * pellets come from its world (EndlessFloorWorld.pellets).
	 */
	readonly floor?: FloorPellets;
}

/** The game's pellet rules (docs/PELLETS.md; endless worlds, PL5). */
export const PELLETS_CONFIG: PelletsConfig = table.freeze({
	pickupRadius: PELLET_PICKUP_RADIUS,
	pelletPoints: PELLET_POINTS,
	sweepPoints: SWEEP_POINTS,
	powerBulletPoints: POWER_BULLET_POINTS,
	powerMaxBullets: POWER_MAX_BULLETS,
});

/** PelletRoom.phase. */
export const PelletPhase = {
	/** Not engaged yet: its pellets lie there but cannot be taken (and the view hides them). */
	DORMANT: 0,
	/** Engaged, not cleared: its pellets can be taken. */
	LIVE: 1,
	/** Cleared: what was left is gone. */
	GONE: 2,
} as const;

/** PelletsState.rec of a pellet whose room has no score record. */
export const NO_PELLET_RECORD = -1;

/** One score record's pellets (PelletsState.rooms[k] belongs to state.score.rooms[k]). */
export interface PelletRoom {
	/** Index of the record's first pellet (into x / z / rec / taken); 0 when it has none (span 0). */
	first: number;
	/** Pellets in first .. first + span - 1, the power pellet included. */
	span: number;
	/** Regular pellets in the range (the power pellet left out, PD8): the Sweep's target. */
	count: number;
	/** Regular pellets not taken yet. */
	left: number;
	/** PelletPhase. */
	phase: number;
	/** 1 once the room's Sweep paid. */
	swept: number;
}

/** A pellet taken this tick (presentation: the score pop, the chomp). */
export interface PelletEaten {
	readonly index: number;
	readonly x: number;
	readonly z: number;
	readonly player: number;
	readonly points: number;
}

/** The power pellet's conversion this tick (presentation: the fly-in): the picker and each erased bullet's position. */
export interface PelletPowerEvent {
	readonly player: number;
	readonly x: number[];
	readonly z: number[];
	/** Points paid in all. */
	points: number;
}

/** Per-tick pellet events for presentation. Cleared at the start of every tick; NOT hashed. */
export interface PelletEvents {
	eaten: PelletEaten[];
	/** Score record indices whose pellets went live this tick. */
	live: number[];
	/** Score record indices whose pellets went (room cleared) this tick. */
	gone: number[];
	/** Score record indices whose Sweep paid this tick. */
	swept: number[];
	/** The power pellet's conversion this tick, if any. */
	power?: PelletPowerEvent;
}

/** SimState.pellets: plain numbers (hashed: taken, power, per room left / phase / swept) plus floor data. */
export interface PelletsState {
	readonly config: PelletsConfig;
	/** Per pellet (floor data, hashed as a count): world centre and its room's score record index (or NO_PELLET_RECORD). */
	x: number[];
	z: number[];
	rec: number[];
	/** Per pellet: 1 once taken. */
	taken: number[];
	/** Index of the power pellet, or NO_POWER_PELLET (shared/dungeon). */
	power: number;
	/** One per score record (state.score.rooms order). */
	rooms: PelletRoom[];
	/** cellKey(grid cell) -> pellet index (one pellet per cell). Floor data: rebuilt by pelletsOnFloor, not hashed. */
	byCell: Map<number, number>;
	/** Not hashed. */
	events: PelletEvents;
}

function emptyEvents(): PelletEvents {
	return { eaten: [], live: [], gone: [], swept: [], power: undefined };
}

/** An empty pellets state (no floor yet: pelletsOnFloor fills it). No rng. */
export function createPelletsState(config: PelletsConfig): PelletsState {
	return {
		config,
		x: [],
		z: [],
		rec: [],
		taken: [],
		power: NO_POWER_PELLET,
		rooms: [],
		byCell: new Map(),
		events: emptyEvents(),
	};
}

function newRoom(): PelletRoom {
	return { first: 0, span: 0, count: 0, left: 0, phase: PelletPhase.DORMANT, swept: 0 };
}

/**
 * A new floor (createSimState after the score state, stepEndless after rebuildScoreRooms): replaces the pellets with
 * `floor`'s (absent: none) and their rooms with one dormant PelletRoom per current score record (see the file comment).
 * No-op without state.pellets. Throws on a power index out of range or pellets of one room that are not contiguous. No
 * rng.
 */
export function pelletsOnFloor(state: SimState, floor: FloorPellets | undefined): void {
	const p = state.pellets;
	if (p === undefined) return;
	p.x.clear();
	p.z.clear();
	p.rec.clear();
	p.taken.clear();
	p.byCell.clear();
	p.rooms.clear();
	p.power = NO_POWER_PELLET;
	const records = state.score?.rooms ?? [];
	const recordOf = new Map<number, number>();
	for (let k = 0; k < records.size(); k++) {
		recordOf.set(records[k].room, k);
		p.rooms.push(newRoom());
	}
	if (floor === undefined) return;
	const n = floor.tiles.size();
	if (floor.room.size() !== n) error(`pellets: ${n} tiles but ${floor.room.size()} room ids`, 0);
	if (floor.power !== NO_POWER_PELLET && !(floor.power >= 0 && floor.power < n && floor.power % 1 === 0))
		error(`pellets: power pellet ${floor.power} out of range (${n} pellets)`, 0);
	p.power = floor.power;
	for (let i = 0; i < n; i++) {
		const t = floor.tiles[i];
		const rec = recordOf.get(floor.room[i]) ?? NO_PELLET_RECORD;
		p.x.push(t.x);
		p.z.push(t.z);
		p.rec.push(rec);
		p.taken.push(0);
		p.byCell.set(cellKey(worldToGrid(t.x), worldToGrid(t.z)), i);
		if (rec === NO_PELLET_RECORD) continue;
		const r = p.rooms[rec];
		if (r.span === 0) r.first = i;
		else if (r.first + r.span !== i) error(`pellets: room ${floor.room[i]}'s pellets are not contiguous`, 0);
		r.span += 1;
		if (i !== p.power) {
			r.count += 1;
			r.left += 1;
		}
	}
}

/** Start of every tick (step.ts, after clearEvents). */
export function clearPelletsEvents(p: PelletsState): void {
	const e = p.events;
	e.eaten.clear();
	e.live.clear();
	e.gone.clear();
	e.swept.clear();
	e.power = undefined;
}

export function clonePelletsState(p: Readonly<PelletsState>): PelletsState {
	const byCell = new Map<number, number>();
	for (const [k, v] of p.byCell) byCell.set(k, v);
	const e = p.events;
	const power = e.power;
	return {
		config: p.config,
		x: [...p.x],
		z: [...p.z],
		rec: [...p.rec],
		taken: [...p.taken],
		power: p.power,
		rooms: p.rooms.map((r) => ({ ...r })),
		byCell,
		events: {
			eaten: [...e.eaten],
			live: [...e.live],
			gone: [...e.gone],
			swept: [...e.swept],
			power: power !== undefined ? { ...power, x: [...power.x], z: [...power.z] } : undefined,
		},
	};
}

/** The pellet in grid cell (gx, gy), or -1. */
export function pelletAtCell(p: Readonly<PelletsState>, gx: number, gy: number): number {
	return p.byCell.get(cellKey(gx, gy)) ?? -1;
}

// ---------------------------------------------------------------------------------------------
// Hash: the `pellets` group, appended after `builds` only when state.pellets exists.

/** Hashed per PelletRoom, in order. */
export const PELLET_ROOM_HASH_FIELDS = ["left", "phase", "swept"] as const;

/**
 * writePelletsHash order: the pellet count, taken per pellet, power, the room count, then per room
 * PELLET_ROOM_HASH_FIELDS. Positions, room links and ranges are floor data (a pure function of the floor seed and the
 * record list, which the score group hashes), so they enter as the count only.
 */
export function writePelletsHash(p: Readonly<PelletsState>, out: number[]): void {
	out.push(p.taken.size());
	for (const t of p.taken) out.push(t);
	out.push(p.power);
	out.push(p.rooms.size());
	for (const r of p.rooms) for (const f of PELLET_ROOM_HASH_FIELDS) out.push(r[f]);
}

/** Dump names for writePelletsHash, same order (`pellets.taken[3]`, `pellets.rooms[0].left`, ...). */
export function pelletsHashNames(p: Readonly<PelletsState>, out: string[]): void {
	out.push("pellets.length");
	for (let i = 0; i < p.taken.size(); i++) out.push(`pellets.taken[${i}]`);
	out.push("pellets.power");
	out.push("pellets.rooms.length");
	for (let k = 0; k < p.rooms.size(); k++)
		for (const f of PELLET_ROOM_HASH_FIELDS) out.push(`pellets.rooms[${k}].${f}`);
}

/**
 * Room clears for the celebration (docs/ROOM_CLEAR.md RC1). The sim's score records (shared/sim score.ts RoomScore)
 * flip `cleared` 0 -> 1 on the tick a room clears and award ROOMS / PERFECT / FAST in the same tick. A rendered frame
 * may run several ticks, so the run views (shared/play LiveRun, shared/lockstep LockstepClient) `collect` after every
 * tick and `reset` at the start of every frame, as they do BoostFrameEvents. Read-only on the sim; no allocation per
 * tick except a clear record (a few per floor). Presentation only: nothing here is hashed or written back.
 *
 * Points are this tick's per-source deltas of `score.points` (exact award values, every multiplier included). Two rooms
 * that clear on the same tick cannot be split, so they make ONE clear with `rooms` 2 (perfect only when both were:
 * the PERFECT award count rose by `rooms`). Room points = score total now - the total before the room's engagement
 * tick (the tick its engageTick left -1); kill points = room points - the bonus (0 when the engagement was not seen).
 */
import { NO_KIND, ScoreSource, type RoomScore, type ScoreState, type SimState } from "shared/sim";

/** One room clear (or two on the same tick). Plain numbers. */
export interface RoomClear {
	/** RoomScore.room of the first room that cleared this tick (record order). */
	readonly room: number;
	/** Rooms that cleared on this tick (1, rarely 2+). */
	readonly rooms: number;
	/** Every room of this clear got the perfect award. */
	readonly perfect: boolean;
	/** Points scored from the engagement to the clear, bonuses excluded (0 when unknown). */
	readonly killPoints: number;
	/** This tick's ROOMS / PERFECT / FAST award points. */
	readonly clearPoints: number;
	readonly perfectPoints: number;
	readonly fastPoints: number;
	/** The last killed member's position (sim units), else the room's centre. */
	readonly x: number;
	readonly z: number;
	/** The last killed member's actor slot and ActorState.id (-1 / 0: none found). */
	readonly slot: number;
	readonly actorId: number;
	/** The first room's bounds (sim units). */
	readonly minX: number;
	readonly maxX: number;
	readonly minZ: number;
	readonly maxZ: number;
	/** state.tick at the end of the clear tick. */
	readonly tick: number;
}

/** What the views read once per frame (RoomClearEvents satisfies it). */
export interface RoomClearSource {
	readonly clears: ReadonlyArray<RoomClear>;
	/** Rooms that engaged during this frame's ticks (a new fight started: the celebration collapses). */
	readonly engaged: number;
}

const HALF = 0.5;

/** The member of `r` that died last (alive 0, smallest deadTicks; ties: the first), or -1. */
function lastKilledMember(state: Readonly<SimState>, r: Readonly<RoomScore>): number {
	let best = -1;
	let bestTicks = math.huge;
	for (let k = 0; k < r.memberSlots.size(); k++) {
		const a = state.combat.actors[r.memberSlots[k]];
		if (a === undefined || a.kind === NO_KIND || a.id !== r.memberIds[k] || a.alive !== 0) continue;
		if (a.deadTicks < bestTicks) {
			bestTicks = a.deadTicks;
			best = k;
		}
	}
	return best;
}

export class RoomClearEvents implements RoomClearSource {
	readonly clears: RoomClear[] = [];
	engaged = 0;

	private started = false;
	private floor = 0;
	private roomCount = 0;
	private prevTotal = 0;
	private prevRooms = 0;
	private prevPerfect = 0;
	private prevPerfectCount = 0;
	private prevFast = 0;
	private readonly prevCleared: number[] = [];
	private readonly prevEngage: number[] = [];
	/** Score total before each room's engagement tick, -1 unknown. */
	private readonly totalAtEngage: number[] = [];

	/** A new frame: forget the last one's clears. */
	reset(): void {
		this.clears.clear();
		this.engaged = 0;
	}

	/** After every tick. No-op without scoring. */
	collect(state: Readonly<SimState>): void {
		const s = state.score;
		if (s === undefined) return;
		const floor = state.endless?.floor ?? 0;
		if (!this.started || floor !== this.floor || s.rooms.size() !== this.roomCount) {
			this.baseline(s, floor);
			return;
		}
		let n = 0;
		let first = -1;
		for (let i = 0; i < s.rooms.size(); i++) {
			const r = s.rooms[i];
			if (this.prevEngage[i] < 0 && r.engageTick >= 0) {
				this.totalAtEngage[i] = this.prevTotal;
				this.engaged += 1;
			}
			if (this.prevCleared[i] === 0 && r.cleared !== 0) {
				n += 1;
				if (first < 0) first = i;
			}
			this.prevEngage[i] = r.engageTick;
			this.prevCleared[i] = r.cleared;
		}
		if (n > 0) this.pushClear(state, s, first, n);
		this.remember(s);
	}

	private pushClear(state: Readonly<SimState>, s: Readonly<ScoreState>, first: number, n: number): void {
		const r = s.rooms[first];
		const clearPoints = s.points[ScoreSource.ROOMS] - this.prevRooms;
		const perfectPoints = s.points[ScoreSource.PERFECT] - this.prevPerfect;
		const fastPoints = s.points[ScoreSource.FAST] - this.prevFast;
		const perfects = s.counts[ScoreSource.PERFECT] - this.prevPerfectCount;
		const bonus = clearPoints + perfectPoints + fastPoints;
		const engagedAt = this.totalAtEngage[first];
		const killPoints = engagedAt >= 0 ? math.max(0, s.total - engagedAt - bonus) : 0;
		const k = lastKilledMember(state, r);
		const a = k >= 0 ? state.combat.actors[r.memberSlots[k]] : undefined;
		this.clears.push({
			room: r.room,
			rooms: n,
			perfect: perfects >= n,
			killPoints,
			clearPoints,
			perfectPoints,
			fastPoints,
			x: a !== undefined ? a.x : (r.minX + r.maxX) * HALF,
			z: a !== undefined ? a.z : (r.minZ + r.maxZ) * HALF,
			slot: a !== undefined ? r.memberSlots[k] : -1,
			actorId: a !== undefined ? a.id : 0,
			minX: r.minX,
			maxX: r.maxX,
			minZ: r.minZ,
			maxZ: r.maxZ,
			tick: state.tick,
		});
	}

	/** First tick, a floor change (records rebuilt) or a record count change: take a fresh baseline, emit nothing. */
	private baseline(s: Readonly<ScoreState>, floor: number): void {
		this.started = true;
		this.floor = floor;
		this.roomCount = s.rooms.size();
		this.prevCleared.clear();
		this.prevEngage.clear();
		this.totalAtEngage.clear();
		for (const r of s.rooms) {
			this.prevCleared.push(r.cleared);
			this.prevEngage.push(r.engageTick);
			this.totalAtEngage.push(-1);
		}
		this.remember(s);
	}

	private remember(s: Readonly<ScoreState>): void {
		this.prevTotal = s.total;
		this.prevRooms = s.points[ScoreSource.ROOMS];
		this.prevPerfect = s.points[ScoreSource.PERFECT];
		this.prevPerfectCount = s.counts[ScoreSource.PERFECT];
		this.prevFast = s.points[ScoreSource.FAST];
	}
}

/** No clears (a run view without scoring, the specs' default). */
export const NO_ROOM_CLEARS: RoomClearSource = new RoomClearEvents();

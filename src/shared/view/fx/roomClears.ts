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
 *
 * Pellets (docs/PELLETS.md PL7): a pellet run's PELLETS points of the room's OWN pellets are its `pelletPoints` (shown
 * like Kills, so kill points leave them out): every tick's `state.pellets.events` (`eaten` carries the pellet index,
 * whose `rec` is its room's score record; the power pellet's bullets belong to the power pellet's own room) are summed
 * per record from its engagement. Pellets of another room live at the same time stay out of this room's pellets (they
 * are in its room points, like that room's kills). The SWEEP points of the clear tick are its `sweepPoints` (a bonus,
 * like ROOMS / PERFECT / FAST: it flies with them). Both 0 in every other run (no state.pellets, no sources).
 *
 * Pacts' Horde (docs/FORTUNE.md FO7): the horde room's record pays x2, the award without the x2 booked to its own
 * source and the rest to ScoreSource.HORDE (shared/sim score.ts awardX). Its clear's rows therefore show what the room
 * would pay without the pact (the clear tick's ROOMS / PERFECT / FAST / SWEEP deltas already are; the pellets' doubled
 * event points lose their horde half: per tick, the eaten points minus the PELLETS delta is that half, all of it the
 * horde record's, the only record that doubles), and its `hordePoints` (the HORDE points since its engagement) is the
 * tally's last segment, the doubled half; `hordeBonusPoints`, the HORDE points of the clear tick (the bonuses' doubled
 * half), flies with the bonus. Both 0 in every other clear and run.
 *
 * @module
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
	/**
	 * PELLETS points of the cleared room's own pellets (and power pellet) since its engagement, summed over the rooms of
	 * this clear (0 when the engagement was not seen, or no pellets: docs/PELLETS.md PL7).
	 */
	readonly pelletPoints: number;
	/** This tick's SWEEP award points (a bonus, docs/PELLETS.md PL7). */
	readonly sweepPoints: number;
	/**
	 * docs/FORTUNE.md FO7: the horde room's doubled half (HORDE points since its engagement; 0 for any other clear or
	 * when the engagement was not seen), the tally's last segment.
	 */
	readonly hordePoints: number;
	/** The HORDE points of the clear tick (the doubled half of its bonuses), part of the bonus that flies. */
	readonly hordeBonusPoints: number;
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

/** A score source's points, 0 when the run has no such source (PELLETS / SWEEP outside pellet runs). */
function sourcePoints(s: Readonly<ScoreState>, source: number): number {
	return s.points[source] ?? 0;
}

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

/**
 * The per-frame collector of room clears. The run views (LiveRun, LockstepClient) call `reset` at the start of a
 * rendered frame and `collect` after each sim tick; afterwards `clears` holds the frame's clears with their points
 * split by source and `engaged` the number of rooms whose fight started. It keeps the previous tick's score totals to
 * take the deltas. Read-only on the sim; does nothing in an unscored run.
 */
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
	private prevSweep = 0;
	private prevHorde = 0;
	private prevPellets = 0;
	private readonly prevCleared: number[] = [];
	private readonly prevEngage: number[] = [];
	/** Score total before each room's engagement tick, -1 unknown. */
	private readonly totalAtEngage: number[] = [];
	/** PELLETS points of each room's own pellets since its engagement (meaningful only where totalAtEngage is known). */
	private readonly ownPellets: number[] = [];
	/** HORDE points before each room's engagement tick (docs/FORTUNE.md FO7). */
	private readonly hordeAtEngage: number[] = [];
	/** This tick's cleared record indices (reused). */
	private readonly clearedNow: number[] = [];

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
		const cleared = this.clearedNow;
		cleared.clear();
		for (let i = 0; i < s.rooms.size(); i++) {
			const r = s.rooms[i];
			if (this.prevEngage[i] < 0 && r.engageTick >= 0) {
				this.totalAtEngage[i] = this.prevTotal;
				this.hordeAtEngage[i] = this.prevHorde;
				this.ownPellets[i] = 0;
				this.engaged += 1;
			}
			if (this.prevCleared[i] === 0 && r.cleared !== 0) cleared.push(i);
			this.prevEngage[i] = r.engageTick;
			this.prevCleared[i] = r.cleared;
		}
		// After the engagements: a room's pellets go live in stepScore, after this tick's pickups (none of its own yet).
		this.addOwnPellets(state, s);
		if (cleared.size() > 0) this.pushClear(state, s, cleared);
		cleared.clear();
		this.remember(s);
	}

	/**
	 * This tick's pellet points, each to its pellet's own score record (the power pellet's to its room's); the horde
	 * record's doubled half (the tick's event points over its PELLETS delta) taken back out of its own (see the file
	 * comment).
	 */
	private addOwnPellets(state: Readonly<SimState>, s: Readonly<ScoreState>): void {
		const p = state.pellets;
		if (p === undefined) return;
		const own = this.ownPellets;
		let sum = 0;
		for (const e of p.events.eaten) {
			sum += e.points;
			const rec = p.rec[e.index];
			if (rec !== undefined && rec >= 0 && rec < own.size()) own[rec] += e.points;
		}
		const power = p.events.power;
		if (power !== undefined && p.power >= 0) {
			sum += power.points;
			const rec = p.rec[p.power];
			if (rec !== undefined && rec >= 0 && rec < own.size()) own[rec] += power.points;
		}
		const half = sum - (sourcePoints(s, ScoreSource.PELLETS) - this.prevPellets);
		const horde = state.pacts?.horde;
		if (half > 0 && horde !== undefined && horde.room >= 0 && horde.record < own.size()) own[horde.record] -= half;
	}

	private pushClear(state: Readonly<SimState>, s: Readonly<ScoreState>, cleared: ReadonlyArray<number>): void {
		const first = cleared[0];
		const n = cleared.size();
		const r = s.rooms[first];
		const clearPoints = s.points[ScoreSource.ROOMS] - this.prevRooms;
		const perfectPoints = s.points[ScoreSource.PERFECT] - this.prevPerfect;
		const fastPoints = s.points[ScoreSource.FAST] - this.prevFast;
		const sweepPoints = sourcePoints(s, ScoreSource.SWEEP) - this.prevSweep;
		const perfects = s.counts[ScoreSource.PERFECT] - this.prevPerfectCount;
		const hordeNow = sourcePoints(s, ScoreSource.HORDE);
		const hordeBonusPoints = hordeNow - this.prevHorde;
		const bonus = clearPoints + perfectPoints + fastPoints + sweepPoints + hordeBonusPoints;
		const engagedAt = this.totalAtEngage[first];
		let pelletPoints = 0;
		let hordePoints = 0;
		if (engagedAt >= 0) {
			for (const i of cleared) {
				if (this.totalAtEngage[i] < 0) continue;
				pelletPoints += this.ownPellets[i];
				// Only one record doubles a floor (the horde room's): every HORDE point since its engagement is its own.
				const sinceEngage = hordeNow - this.hordeAtEngage[i];
				if (sinceEngage > hordePoints) hordePoints = sinceEngage;
			}
		}
		hordePoints = math.max(hordePoints, hordeBonusPoints);
		const killPoints =
			engagedAt >= 0
				? math.max(0, s.total - engagedAt - bonus - pelletPoints - (hordePoints - hordeBonusPoints))
				: 0;
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
			pelletPoints,
			sweepPoints,
			hordePoints,
			hordeBonusPoints,
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
		this.ownPellets.clear();
		this.hordeAtEngage.clear();
		for (const r of s.rooms) {
			this.prevCleared.push(r.cleared);
			this.prevEngage.push(r.engageTick);
			this.totalAtEngage.push(-1);
			this.ownPellets.push(0);
			this.hordeAtEngage.push(0);
		}
		this.remember(s);
	}

	private remember(s: Readonly<ScoreState>): void {
		this.prevTotal = s.total;
		this.prevRooms = s.points[ScoreSource.ROOMS];
		this.prevPerfect = s.points[ScoreSource.PERFECT];
		this.prevPerfectCount = s.counts[ScoreSource.PERFECT];
		this.prevFast = s.points[ScoreSource.FAST];
		this.prevSweep = sourcePoints(s, ScoreSource.SWEEP);
		this.prevHorde = sourcePoints(s, ScoreSource.HORDE);
		this.prevPellets = sourcePoints(s, ScoreSource.PELLETS);
	}
}

/** No clears (a run view without scoring, the specs' default). */
export const NO_ROOM_CLEARS: RoomClearSource = new RoomClearEvents();

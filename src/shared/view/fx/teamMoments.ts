/**
 * Co-op shared moments, the pure core (docs/RUN_RECAP.md Part B, CM1). TeamMoments turns a frame's room clears
 * (RunView.roomClears, RoomClearEvents) and the parry groups that started in it (NearMissDirector's frame,
 * NearMissFrame.parryGroups) into the frame's moments and the run's totals for the recap:
 *
 *   - TEAM PERFECT (B1, CMD1, CMD3): in a party run (ScoreState.partySize >= TEAM_MOMENTS.minPartySize) every clear the
 *     sim awarded PERFECT (RoomClear.perfect: no one in the party was hit since the room engaged) is a team perfect. No
 *     rule of its own beyond the sim's award. The streak counts team perfects in clear order (a clear of `rooms` rooms on
 *     one tick counts `rooms`), reset to 0 by any clear that is not perfect (a far room counts too); `showStreak` from
 *     TEAM_MOMENTS.streakShowFrom.
 *   - SYNC! parries (B2, CMD4): parry groups (the director's per-player grouping, one per guard) of DIFFERENT players
 *     whose start ticks are at most TEAM_MOMENTS.syncWindowTicks apart. Further players whose groups start within the
 *     window of the sync's first group join it (`count` 3, `grew` on a later frame). At most one sync per
 *     syncCooldownTicks (from the tick that formed it); groups that start during the cooldown wait and can still pair
 *     once it is over. Distance never decides a sync: it only sets `tethered` (every two parry points at most
 *     tetherMaxTiles apart).
 *   - Revives (B3) are reserved: TeamMomentKind names "revive" but nothing emits it. There is no revive mechanic (a dead
 *     player spectates, docs/SPECTATE.md); one would be gameplay with its own plan.
 *
 * Deterministic: every rule counts sim ticks and reads only lockstep-identical feeds, processed in tick order, so every
 * client of a run derives the same moments whatever its frame boundaries (a group that starts on a later frame inside
 * the window still syncs). A new run (another state object, or the tick going back) or reset() starts over.
 * Presentation only: nothing here is hashed or written back. Allocates a record per moment (a few per floor).
 */
import { SIM_HZ, TILE_SIZE, type SimState } from "shared/sim";
import type { ParryGroupStart } from "./nearMissRules";
import type { RoomClear } from "./roomClears";
import { TEAM_MOMENTS } from "./teamMomentsConfig";

/** Every moment kind. "revive" is reserved (docs/RUN_RECAP.md B3): no revive mechanic exists, so none is emitted. */
export type TeamMomentKind = "teamPerfect" | "sync" | "revive";

/** One team perfect clear (or several rooms on one tick, all perfect). */
export interface TeamPerfectMoment {
	readonly kind: "teamPerfect";
	/** RoomClear.tick: state.tick at the end of the clear tick. */
	readonly tick: number;
	/** RoomClear.room / rooms. */
	readonly room: number;
	readonly rooms: number;
	/** Team perfects in a row, this clear included (>= rooms). */
	readonly streak: number;
	/** streak >= TEAM_MOMENTS.streakShowFrom: the stamp reads `TEAM PERFECT x{streak}`. */
	readonly showStreak: boolean;
	/** The sim's PERFECT award points of this clear (RoomClear.perfectPoints). */
	readonly points: number;
	/** RoomClear.x / z: the last kill, else the room's centre (sim units). */
	readonly x: number;
	readonly z: number;
}

/** One parry point of a sync: a player's group and its first erased bullet's position (sim units). */
export interface SyncParryPoint {
	readonly player: number;
	readonly tick: number;
	readonly x: number;
	readonly z: number;
}

/** A SYNC! (or the same sync grown by a further player). A snapshot: later growth emits a new record with its id. */
export interface SyncParryMoment {
	readonly kind: "sync";
	/** 1, 2, ... in the run; a grown sync repeats its id. */
	readonly id: number;
	/** The start tick of the sync's first group (the window's anchor). */
	readonly firstTick: number;
	/** The start tick of its latest group (the tick it formed, or grew). */
	readonly tick: number;
	/** Distinct players (2, 3, ...). */
	readonly count: number;
	/** An earlier frame's sync gained a player this frame (a sync formed this frame is not `grew`, whatever its count). */
	readonly grew: boolean;
	/** The groups in join order (players distinct). */
	readonly points: ReadonlyArray<SyncParryPoint>;
	/** The points' mean (the callout's spot; two points: their midpoint). */
	readonly midX: number;
	readonly midZ: number;
	/** Every two points at most tetherMaxTiles apart: draw the tether; else a small SYNC! at each. */
	readonly tethered: boolean;
}

export type TeamMoment = TeamPerfectMoment | SyncParryMoment;

/** A frame's moments (reused: valid until the next frame call). */
export interface TeamMomentsFrame {
	/** In clear order. */
	readonly teamPerfects: ReadonlyArray<TeamPerfectMoment>;
	/** In tick order; at most one record per sync id. */
	readonly syncs: ReadonlyArray<SyncParryMoment>;
}

/** The run's totals for the recap (docs/RUN_RECAP.md highlights 3, 4 and 7). */
export interface TeamMomentTotals {
	/** Team perfect rooms. */
	readonly teamPerfects: number;
	/** The longest team perfect streak. */
	readonly bestTeamStreak: number;
	/** SYNC! moments (a grown sync counts once). */
	readonly syncParries: number;
}

/** SYNC!'s cooldown in sim ticks (TEAM_MOMENTS.syncCooldownSec at SIM_HZ). */
export function syncCooldownTicks(): number {
	return math.round(TEAM_MOMENTS.syncCooldownSec * SIM_HZ);
}

/** The tether's reach in sim units (TEAM_MOMENTS.tetherMaxTiles tiles). */
export function syncTetherReach(): number {
	return TEAM_MOMENTS.tetherMaxTiles * TILE_SIZE;
}

/** Whether a run of `partySize` (ScoreState.partySize) has team moments. */
export function isTeamRun(partySize: number): boolean {
	return partySize >= TEAM_MOMENTS.minPartySize;
}

interface MutableTotals {
	teamPerfects: number;
	bestTeamStreak: number;
	syncParries: number;
}

interface ActiveSync {
	id: number;
	firstTick: number;
	tick: number;
	readonly points: SyncParryPoint[];
}

/** The mean and the tether flag of a sync's points, as a record. */
function syncRecord(a: ActiveSync, grew: boolean): SyncParryMoment {
	const pts = new Array<SyncParryPoint>();
	let sx = 0;
	let sz = 0;
	for (const p of a.points) {
		pts.push(p);
		sx += p.x;
		sz += p.z;
	}
	const n = pts.size();
	const reach = syncTetherReach();
	const reach2 = reach * reach;
	let tethered = true;
	for (let i = 0; i < n; i++) {
		for (let j = i + 1; j < n; j++) {
			const dx = pts[i].x - pts[j].x;
			const dz = pts[i].z - pts[j].z;
			if (dx * dx + dz * dz > reach2) tethered = false;
		}
	}
	return {
		kind: "sync",
		id: a.id,
		firstTick: a.firstTick,
		tick: a.tick,
		count: n,
		grew,
		points: pts,
		midX: sx / n,
		midZ: sz / n,
		tethered,
	};
}

/**
 * The SYNC! rule over a stream of parry group starts in tick order (see the file comment). Pure and frame-free: `add`
 * each group as it starts; `drain` the records since the last drain. TeamMoments owns one.
 */
export class SyncParryRule {
	/** Syncs formed so far (the next id - 1). */
	count = 0;

	/** Groups that may still pair: one per player (the latest), each within the window of the newest start seen. */
	private readonly pending: SyncParryPoint[] = [];
	private active: ActiveSync | undefined;
	/** No sync forms before this tick. */
	private cooldownUntil = -math.huge;
	/** Records since the last drain: the id of each and whether it was formed (not grown) since then. */
	private readonly dirty: ActiveSync[] = [];
	private readonly formedSinceDrain = new Set<number>();

	reset(): void {
		this.count = 0;
		this.pending.clear();
		this.active = undefined;
		this.cooldownUntil = -math.huge;
		this.dirty.clear();
		this.formedSinceDrain.clear();
	}

	/** One group start (copied). Groups must arrive in nondecreasing tick order. */
	add(player: number, tick: number, x: number, z: number): void {
		const window = TEAM_MOMENTS.syncWindowTicks;
		const g: SyncParryPoint = { player, tick, x, z };
		// forget groups that can no longer pair with this one or any later one
		const pending = this.pending;
		let i = 0;
		while (i < pending.size()) {
			const p = pending[i];
			if (tick - p.tick > window || p.player === player) pending.remove(i);
			else i++;
		}
		// a further player inside the active sync's window joins it
		const a = this.active;
		if (a !== undefined && tick - a.firstTick <= window) {
			let joined = false;
			for (const p of a.points) if (p.player === player) joined = true;
			if (!joined) {
				a.points.push(g);
				a.tick = tick;
				this.markDirty(a);
				return;
			}
		}
		if (pending.size() > 0 && tick >= this.cooldownUntil) {
			this.count += 1;
			const sync: ActiveSync = { id: this.count, firstTick: pending[0].tick, tick, points: [] };
			// every waiting player (start order; pending holds one group per player, none of this one's)
			for (const p of pending) {
				sync.points.push(p);
				if (p.tick < sync.firstTick) sync.firstTick = p.tick;
			}
			sync.points.push(g);
			pending.clear();
			this.active = sync;
			this.cooldownUntil = tick + syncCooldownTicks();
			this.formedSinceDrain.add(sync.id);
			this.markDirty(sync);
			return;
		}
		pending.push(g);
	}

	/** The records since the last drain, appended to `out` in first-change order (one per sync). */
	drain(out: SyncParryMoment[]): void {
		for (const a of this.dirty) out.push(syncRecord(a, !this.formedSinceDrain.has(a.id)));
		this.dirty.clear();
		this.formedSinceDrain.clear();
	}

	private markDirty(a: ActiveSync): void {
		if (!this.dirty.includes(a)) this.dirty.push(a);
	}
}

/** The co-op moments of one run view (see the file comment). One per consumer. */
export class TeamMoments {
	/** The last frame's moments (also returned by frame()). */
	readonly out: TeamMomentsFrame;
	/** The run so far. */
	readonly totals: TeamMomentTotals;

	private readonly teamPerfects: TeamPerfectMoment[] = [];
	private readonly syncs: SyncParryMoment[] = [];
	private readonly sum: MutableTotals = { teamPerfects: 0, bestTeamStreak: 0, syncParries: 0 };
	private readonly sync = new SyncParryRule();
	private streak = 0;
	private lastState: Readonly<SimState> | undefined;
	private lastTick = 0;

	constructor() {
		this.out = { teamPerfects: this.teamPerfects, syncs: this.syncs };
		this.totals = this.sum;
	}

	/** Team perfects in a row right now (0 after any non-perfect clear). */
	currentStreak(): number {
		return this.streak;
	}

	/** A new run: zero the totals and the streak, forget every waiting group and sync. */
	reset(): void {
		this.streak = 0;
		this.sum.teamPerfects = 0;
		this.sum.bestTeamStreak = 0;
		this.sum.syncParries = 0;
		this.sync.reset();
		this.teamPerfects.clear();
		this.syncs.clear();
	}

	/**
	 * One rendered frame, after its ticks. `clears`: the frame's room clears (RunView.roomClears.clears). `groups`: the
	 * parry groups that started this frame (NearMissDirector's frame output, parryGroups). Returns `out`. A run without
	 * scoring or of one player has no moments.
	 */
	frame(
		state: Readonly<SimState>,
		clears: ReadonlyArray<RoomClear>,
		groups: ReadonlyArray<ParryGroupStart>,
	): TeamMomentsFrame {
		if (state !== this.lastState || state.tick < this.lastTick) this.reset();
		this.lastState = state;
		this.lastTick = state.tick;
		this.teamPerfects.clear();
		this.syncs.clear();
		const size = state.score?.partySize ?? 0;
		if (!isTeamRun(size)) return this.out;
		for (const c of clears) this.clear(c);
		for (const g of groups) this.sync.add(g.player, g.tick, g.x, g.z);
		this.sync.drain(this.syncs);
		this.sum.syncParries = this.sync.count;
		return this.out;
	}

	private clear(c: RoomClear): void {
		if (!c.perfect) {
			this.streak = 0;
			return;
		}
		this.streak += c.rooms;
		this.sum.teamPerfects += c.rooms;
		if (this.streak > this.sum.bestTeamStreak) this.sum.bestTeamStreak = this.streak;
		this.teamPerfects.push({
			kind: "teamPerfect",
			tick: c.tick,
			room: c.room,
			rooms: c.rooms,
			streak: this.streak,
			showStreak: this.streak >= TEAM_MOMENTS.streakShowFrom,
			points: c.perfectPoints,
			x: c.x,
			z: c.z,
		});
	}
}

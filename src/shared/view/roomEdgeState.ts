/**
 * Room edges (docs/ROOM_EDGES.md §2): each room's safe / waiting / live state for its dashed corridor-mouth line.
 * Pure and view-side (never feeds `step()`); reads the sim state, never writes it.
 *
 * The source of truth is scoring's own room records, so the line agrees with when the game thinks a room started and
 * was cleared:
 *   - scored runs (`state.score`: endless, the tutorial, M1 under KV_Scoring): `state.score.rooms`, read fresh on every
 *     update (endless floor changes replace them), keyed by `record.room`. No record -> SAFE, `cleared === 1` -> SAFE,
 *     `engageTick >= 0` -> LIVE, else WAITING.
 *   - unscored runs (plain M1): the `fallback` records the caller built with buildScoreRooms at the run's tick 0,
 *     judged every update with score's own predicates in stepScore's order (engagement latches like engageTick, then
 *     scoreRoomDown latches the clear). The records are never mutated. Judged per update, not per tick: with several
 *     ticks per frame a player who only crossed a room's bounds between two updates engages it on a later frame (a
 *     member hurt or down engages it too, so a cleared room is never stuck WAITING).
 *   - the boss room (`encounter.bossRoom`; bosses are never record members): a living `data.boss` actor -> WAITING
 *     while its phase <= 0 (dormant), LIVE once a boss's phase > 0; none alive after one was seen alive (on this
 *     endless floor) -> SAFE; otherwise the record rules (a non-boss endless floor's stairwell room has none: SAFE).
 */
import type { EncounterConfig } from "shared/dungeon";
import { NO_KIND, archetypeAt, scoreRoomDown, scoreRoomEngaged, type RoomScore, type SimState } from "shared/sim";
import { RoomEdgeState } from "./roomEdgesConfig";

/** The record rule (scored and fallback alike). */
function recordState(cleared: boolean, engaged: boolean): RoomEdgeState {
	if (cleared) return RoomEdgeState.SAFE;
	return engaged ? RoomEdgeState.LIVE : RoomEdgeState.WAITING;
}

/** No endless floor (M1): the boss latch's floor key. */
const NO_FLOOR = -1;

export class RoomEdgeStates {
	private readonly out: RoomEdgeState[] = [];
	private readonly fallback: ReadonlyArray<RoomScore> | undefined;
	/** Fallback latches, per fallback record index. */
	private readonly fallbackEngaged: boolean[] = [];
	private readonly fallbackDown: boolean[] = [];
	/** A boss was seen alive on `bossSeenFloor` (state.endless.floor, NO_FLOOR outside endless). */
	private bossSeen = false;
	private bossSeenFloor = NO_FLOOR;

	/**
	 * `roomCount`: the floor's room ids are 0..roomCount - 1 (rooms beyond are ignored). `fallback`: records for an
	 * unscored run (buildScoreRooms(state, encounter) at its tick 0); unused while `state.score` exists.
	 */
	constructor(roomCount: number, fallback?: ReadonlyArray<RoomScore>) {
		for (let r = 0; r < roomCount; r++) this.out.push(RoomEdgeState.SAFE);
		this.fallback = fallback;
		if (fallback !== undefined) {
			for (let i = 0; i < fallback.size(); i++) {
				this.fallbackEngaged.push(false);
				this.fallbackDown.push(false);
			}
		}
	}

	/** One state per room id (RoomEdgeState), in a reused array: read it before the next update. */
	update(state: Readonly<SimState>, encounter: Readonly<EncounterConfig>): ReadonlyArray<RoomEdgeState> {
		const out = this.out;
		const n = out.size();
		for (let r = 0; r < n; r++) out[r] = RoomEdgeState.SAFE;

		const score = state.score;
		if (score !== undefined) {
			for (const rec of score.rooms) {
				if (rec.room < 0 || rec.room >= n) continue;
				out[rec.room] = recordState(rec.cleared === 1, rec.engageTick >= 0);
			}
		} else if (this.fallback !== undefined) {
			const fallback = this.fallback;
			for (let i = 0; i < fallback.size(); i++) {
				const rec = fallback[i];
				// stepScore's order: a record without members never engages; engagement, then the clear.
				if (!this.fallbackDown[i] && rec.memberSlots.size() > 0) {
					if (!this.fallbackEngaged[i] && scoreRoomEngaged(state, rec)) this.fallbackEngaged[i] = true;
					if (this.fallbackEngaged[i] && scoreRoomDown(state, rec)) this.fallbackDown[i] = true;
				}
				if (rec.room < 0 || rec.room >= n) continue;
				out[rec.room] = recordState(this.fallbackDown[i], this.fallbackEngaged[i]);
			}
		}

		const bossRoom = encounter.bossRoom;
		if (bossRoom >= 0 && bossRoom < n) {
			const floor = state.endless !== undefined ? state.endless.floor : NO_FLOOR;
			if (floor !== this.bossSeenFloor) {
				this.bossSeenFloor = floor;
				this.bossSeen = false;
			}
			let alive = false;
			let awake = false;
			for (const a of state.combat.actors) {
				if (a.kind === NO_KIND || a.alive === 0 || archetypeAt(a.kind).data.boss !== true) continue;
				alive = true;
				if (a.phase > 0) awake = true;
			}
			if (alive) {
				this.bossSeen = true;
				out[bossRoom] = awake ? RoomEdgeState.LIVE : RoomEdgeState.WAITING;
			} else if (this.bossSeen) out[bossRoom] = RoomEdgeState.SAFE;
		}
		return out;
	}
}

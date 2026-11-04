/**
 * Pact room hooks (docs/FORTUNE.md PS4, FD7 / FD8), called from endless.ts (enterRoom) and score/score.ts (scoreKill,
 * clearRoom, stepScore). A LEAF: it reads and writes state.pacts / state.score / the actor pool through the state types
 * only and requires nothing but pactsData.ts, so neither caller requires pacts.ts or stepPacts.ts (which require them).
 * No rng. Every function is a no-op (or neutral) without state.pacts.
 *
 *   pactsOnRoomSpawned  a room's deferred enemies spawned (enterRoom, after attachScoreRoomMembers): with the Horde
 *                       armed and the room one with planned spawns (never the boss room: it has none), it becomes the
 *                       horde room (armed -> 0, room, its record, firstWave = the record's members now)
 *   pactHoldsRoom       stepScore: the horde record may not clear while its second wave has not spawned
 *   pactRoomPercent     clearRoom: the record's x2 (ROOMS / PERFECT / FAST / Sweep), and a pellet of it (scorePellet)
 *   pactKillPercent     scoreKill: the x2 for a kill of one of the horde record's members (adopted children and the
 *                       second wave included)
 *   pactRoomCleared     clearRoom: the horde record cleared (events.hordeCleared)
 */
import type { SimState } from "../state";
import type { ActorState } from "../combat/actors/types";
import { HORDE_NONE, HORDE_WAVE_PENDING, PACT_PERCENT } from "./pactsData";

/** The horde record's index while a horde room is roused, else HORDE_NONE. */
function hordeRecord(state: Readonly<SimState>): number {
	const p = state.pacts;
	if (p === undefined || p.horde.room < 0) return HORDE_NONE;
	return p.horde.record;
}

/**
 * Room `roomId` (with `planned` deferred spawns) just spawned and its record (if any) has its members: an armed Horde
 * rouses it. Needs scoring (the record is what the x2 and the wave hang off).
 */
export function pactsOnRoomSpawned(state: SimState, roomId: number, planned: number): void {
	const p = state.pacts;
	const s = state.score;
	if (p === undefined || s === undefined || p.horde.armed === 0 || planned <= 0) return;
	let k = -1;
	for (let i = 0; i < s.rooms.size(); i++) {
		if (s.rooms[i].room === roomId) {
			k = i;
			break;
		}
	}
	if (k < 0 || s.rooms[k].cleared !== 0) return;
	const h = p.horde;
	h.armed = 0;
	h.room = roomId;
	h.record = k;
	h.firstWave = s.rooms[k].memberSlots.size();
	p.events.hordeRoused = roomId + 1;
}

/** Record `k` is the horde room's and its second wave has not spawned yet: it may not clear. */
export function pactHoldsRoom(state: Readonly<SimState>, k: number): boolean {
	const p = state.pacts;
	return p !== undefined && hordeRecord(state) === k && p.horde.spawned === HORDE_WAVE_PENDING;
}

/** The pay percent of record `k`'s awards: the run's hordePercent for the horde record, else PACT_PERCENT (100). */
export function pactRoomPercent(state: Readonly<SimState>, k: number): number {
	const p = state.pacts;
	if (p === undefined || k < 0 || hordeRecord(state) !== k) return PACT_PERCENT;
	return p.config.hordePercent;
}

/** The pay percent of the kill of `a`: hordePercent when it is a member of the horde record, else PACT_PERCENT. */
export function pactKillPercent(state: Readonly<SimState>, a: Readonly<ActorState>): number {
	const p = state.pacts;
	const s = state.score;
	const k = hordeRecord(state);
	if (p === undefined || s === undefined || k < 0) return PACT_PERCENT;
	const r = s.rooms[k];
	if (r === undefined) return PACT_PERCENT;
	const slot = state.combat.actors.indexOf(a as ActorState);
	if (slot < 0) return PACT_PERCENT;
	for (let m = 0; m < r.memberSlots.size(); m++)
		if (r.memberSlots[m] === slot && r.memberIds[m] === a.id) return p.config.hordePercent;
	return PACT_PERCENT;
}

/** Record `k` cleared (clearRoom): the horde's presentation event. */
export function pactRoomCleared(state: SimState, k: number): void {
	const p = state.pacts;
	if (p === undefined || hordeRecord(state) !== k) return;
	p.events.hordeCleared = 1;
}

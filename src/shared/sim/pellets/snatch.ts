/**
 * The Snatcher's pellet rules (docs/NEW_ENEMIES_2.md NX4, NXD9-NXD11; a Roblox-port feature, no web source). A LEAF: it
 * reads and writes state.pellets and reads state.score / state.combat through the state types only, and requires only
 * pelletsData.ts and pellets.ts (themselves leaves), so the archetype (combat/actors/archetypes/snatcher.ts) imports it
 * without a require cycle. No rng. Every function is a no-op (or -1 / 0) without state.pellets.
 *
 *   record    snatchRecordOf: the score record whose members hold the Snatcher's slot with its id (alive or a corpse:
 *             its onDeath reads it), or -1. Its pellets (PelletsState.rooms[k], the same index) are the only ones it
 *             ever touches: never another room's.
 *   target    pelletsNearestLive: the record's pellet nearest a point that is on the floor (taken 0), regular (never
 *             the power pellet) and live (the room's pellets went LIVE and not GONE); ties to the lower index.
 *   steal     pelletsSteal: such a pellet becomes PELLET_STOLEN (carried) + events.stolen.
 *   swallow   pelletsDigest: every PELLET_STOLEN pellet of the record becomes PELLET_DIGESTED + events.swallowed.
 *   return    pelletsReturn: every PELLET_STOLEN pellet of the record goes back to 0 in place + events.returned.
 * None of them ever changes PelletRoom.left (NXD11): a digested pellet stays counted as not taken, so the room's Sweep
 * (left === 0 at the clear) can no longer pay; a returned one is on the floor again and a player's pickup counts it
 * (stepPellets). One Snatcher per room (NXD9: the room pool's cap, NX6; Horde's second wave never buys one), so a
 * record's PELLET_STOLEN pellets are all one Snatcher's.
 *
 * @module
 */
import type { ActorState } from "../combat/actors/types";
import type { SimState } from "../state";
import { PELLET_DIGESTED, PELLET_STOLEN, PelletPhase } from "./pelletsData";

/** Index into state.score.rooms of the record that holds actor `a` (its slot with its id), or -1. */
export function snatchRecordOf(state: Readonly<SimState>, a: Readonly<ActorState>): number {
	const rooms = state.score?.rooms;
	if (rooms === undefined) return -1;
	const slot = state.combat.actors.indexOf(a as ActorState);
	if (slot < 0) return -1;
	for (let k = 0; k < rooms.size(); k++) {
		const r = rooms[k];
		for (let m = 0; m < r.memberSlots.size(); m++)
			if (r.memberSlots[m] === slot && r.memberIds[m] === a.id) return k;
	}
	return -1;
}

/** True when pellet `i` of record `rec` can be stolen now (see the file comment). */
export function pelletStealable(state: Readonly<SimState>, rec: number, i: number): boolean {
	const p = state.pellets;
	if (p === undefined || rec < 0) return false;
	const r = p.rooms[rec];
	return (
		r !== undefined &&
		r.phase === PelletPhase.LIVE &&
		i >= r.first &&
		i < r.first + r.span &&
		i !== p.power &&
		p.rec[i] === rec &&
		p.taken[i] === 0
	);
}

/** The stealable pellet of record `rec` nearest (x, z), ties to the lower index; -1 for none. */
export function pelletsNearestLive(state: Readonly<SimState>, rec: number, x: number, z: number): number {
	const p = state.pellets;
	if (p === undefined || rec < 0) return -1;
	const r = p.rooms[rec];
	if (r === undefined || r.phase !== PelletPhase.LIVE) return -1;
	let best = -1;
	let best2 = math.huge;
	const last = r.first + r.span - 1;
	for (let i = r.first; i <= last; i++) {
		if (!pelletStealable(state, rec, i)) continue;
		const dx = p.x[i] - x;
		const dz = p.z[i] - z;
		const d2 = dx * dx + dz * dz;
		if (d2 < best2) {
			best = i;
			best2 = d2;
		}
	}
	return best;
}

/** Steals pellet `i` of record `rec` (PELLET_STOLEN, events.stolen). False (nothing changes) when it is not stealable. */
export function pelletsSteal(state: SimState, rec: number, i: number): boolean {
	const p = state.pellets;
	if (p === undefined || !pelletStealable(state, rec, i)) return false;
	p.taken[i] = PELLET_STOLEN;
	p.events.stolen.push({ index: i, x: p.x[i], z: p.z[i] });
	return true;
}

/** Pellets of record `rec` with taken === PELLET_STOLEN (the belly). */
export function pelletsCarried(state: Readonly<SimState>, rec: number): number {
	const p = state.pellets;
	if (p === undefined || rec < 0) return 0;
	const r = p.rooms[rec];
	if (r === undefined) return 0;
	let n = 0;
	const last = r.first + r.span - 1;
	for (let i = r.first; i <= last; i++) if (p.taken[i] === PELLET_STOLEN) n += 1;
	return n;
}

/**
 * The swallow: every PELLET_STOLEN pellet of record `rec` becomes PELLET_DIGESTED; one events.swallowed at (x, z) (the
 * Snatcher) when any did. Returns how many.
 */
export function pelletsDigest(state: SimState, rec: number, x: number, z: number): number {
	const p = state.pellets;
	if (p === undefined || rec < 0) return 0;
	const r = p.rooms[rec];
	if (r === undefined) return 0;
	let indices: number[] | undefined;
	const last = r.first + r.span - 1;
	for (let i = r.first; i <= last; i++) {
		if (p.taken[i] !== PELLET_STOLEN) continue;
		p.taken[i] = PELLET_DIGESTED;
		if (indices === undefined) indices = [];
		indices.push(i);
	}
	if (indices === undefined) return 0;
	p.events.swallowed.push({ x, z, indices });
	return indices.size();
}

/**
 * A Snatcher's death: every PELLET_STOLEN pellet of record `rec` goes back to 0 in place, one events.returned each (from
 * (fromX, fromZ), the corpse). Returns how many.
 */
export function pelletsReturn(state: SimState, rec: number, fromX: number, fromZ: number): number {
	const p = state.pellets;
	if (p === undefined || rec < 0) return 0;
	const r = p.rooms[rec];
	if (r === undefined) return 0;
	let n = 0;
	const last = r.first + r.span - 1;
	for (let i = r.first; i <= last; i++) {
		if (p.taken[i] !== PELLET_STOLEN) continue;
		p.taken[i] = 0;
		p.events.returned.push({ index: i, fromX, fromZ });
		n += 1;
	}
	return n;
}

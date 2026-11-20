/**
 * Pellet room hooks (docs/PELLETS.md PL3), called from score/score.ts's stepScore. A LEAF: it reads and writes
 * state.pellets through the state types only and requires nothing but pelletsData.ts, so score.ts never requires
 * pellets.ts or stepPellets.ts (which require score.ts). No rng. Every function is a no-op without state.pellets.
 *
 *   pelletRoomLive    a score record is engaged and not cleared (stepScore step 4, every such tick: on endless floors
 *                     the record engaged in attachScoreRoomMembers during stepEndless, in M1-style rooms inside
 *                     stepScore itself): DORMANT -> LIVE once, + events.live. Its pellets can be taken from the next
 *                     tick's stepPellets on.
 *   pelletRoomClear   the record clears (clearRoom, BEFORE its other awards): GONE, + events.gone; returns true when
 *                     the room earned its Sweep (every regular pellet taken, count > 0; the power pellet does not count,
 *                     PD8), with swept = 1 and events.swept, and clearRoom then pays scoreSweep. stepPellets runs before
 *                     stepScore, so a pickup on the clear tick already counts.
 *
 * @module
 */
import type { SimState } from "../state";
import { PelletPhase } from "./pelletsData";

/** Record `k` is engaged and not cleared: its pellets go live (once). */
export function pelletRoomLive(state: SimState, k: number): void {
	const p = state.pellets;
	if (p === undefined) return;
	const r = p.rooms[k];
	if (r === undefined || r.phase !== PelletPhase.DORMANT) return;
	r.phase = PelletPhase.LIVE;
	p.events.live.push(k);
}

/** Record `k` clears: its pellets are gone. Returns true when the Sweep is due (the caller pays it). */
export function pelletRoomClear(state: SimState, k: number): boolean {
	const p = state.pellets;
	if (p === undefined) return false;
	const r = p.rooms[k];
	if (r === undefined || r.phase === PelletPhase.GONE) return false;
	const sweep = r.left === 0 && r.count > 0;
	r.phase = PelletPhase.GONE;
	if (sweep) {
		r.swept = 1;
		p.events.swept.push(k);
	}
	p.events.gone.push(k);
	return sweep;
}

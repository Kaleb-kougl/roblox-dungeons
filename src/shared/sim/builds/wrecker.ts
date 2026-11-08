/**
 * Wrecker's hooks (docs/BUILDS_V2.md "Wrecker", BV5; a Roblox-port feature, no web source). A LEAF module like
 * ./hooks.ts: it imports only data, the dungeon's cell maths and ./hooks.ts, so breakables.ts (which score.ts and the
 * drops sit behind) and player.ts (which party.ts imports) can both call it without a require cycle. Every hook does
 * nothing without state.builds, for a player without Wrecker (or Powder Keg), or for one who left.
 *
 *   buildsOnPieceBroken(state, slot, owner, gen)   breakables.ts damageBreakable's break line, for a break with an
 *                      owner (a swing, a player bullet, the roll smash, a build effect's break): queues a SMASH proc
 *                      { x / z the piece's cell centre, owner, gen, slot -1, id -1, excess 0, kind SMASH } when the
 *                      owner has a smash effect (hasSmashEffect: Wrecker at any level, or Powder Keg) and gen <
 *                      genMax. Smashes resolve in stepBuilds' drain beside the kills (./procs.ts, ./smash.ts).
 *   buildsRollSmash(state, i, x, z, dx, dz)       player.ts, every roll tick before the roll's move: player i (party
 *                      index) with Wrecker breaks every piece its body touches along the step (breakables.ts
 *                      rollSmashBreakables, bound here at load by bindRollSmash: player.ts cannot import breakables.ts,
 *                      whose scoring imports party.ts), so the roll goes through.
 */
import { gridToWorld } from "shared/dungeon";
import type { SimState } from "../state";
import { Boon } from "../progression/progressionData";
import type { BuildPlayerState } from "./builds";
import { Duo, ProcKind } from "./buildsData";
import { buildPlayerLeft, hasDuo } from "./hooks";

/** The roll smash (breakables.ts rollSmashBreakables): breaks what player `owner` touches moving (dx, dz) from (x, z). */
export type RollSmasher = (state: SimState, owner: number, x: number, z: number, dx: number, dz: number) => number;

/** Bound by breakables.ts at load (it is loaded whenever state.breakables exists: it creates that state). */
let rollSmasher: RollSmasher | undefined;

/** breakables.ts, once at load. */
export function bindRollSmash(f: RollSmasher): void {
	rollSmasher = f;
}

/** True when a piece broken by `p` has anything to fire: Wrecker at any level, or Powder Keg (BV6). */
export function hasSmashEffect(p: Readonly<BuildPlayerState> | undefined): boolean {
	if (p === undefined) return false;
	return (p.levels[Boon.WRECKER] ?? 0) > 0 || hasDuo(p, Duo.POWDER_KEG);
}

/** The piece in breakable slot `slot` just broke, credited to player `owner` at generation `gen` (file comment). */
export function buildsOnPieceBroken(state: SimState, slot: number, owner: number, gen: number): void {
	const s = state.builds;
	const b = state.breakables;
	if (s === undefined || b === undefined || gen >= s.config.genMax) return;
	const p = s.players[owner];
	if (!hasSmashEffect(p) || buildPlayerLeft(state, owner)) return;
	const piece = b.pieces[slot];
	if (piece === undefined) return;
	s.procs.push({
		x: gridToWorld(piece.x),
		z: gridToWorld(piece.y),
		owner,
		gen,
		slot: -1,
		id: -1,
		excess: 0,
		kind: ProcKind.SMASH,
	});
}

/**
 * Player `i` (party index; 0 solo) rolls this tick from (x, z) by (dx, dz) (player.ts, before the roll's move): with
 * Wrecker (any level) every piece its body touches along the step breaks (file comment). Returns the pieces broken.
 */
export function buildsRollSmash(state: SimState, i: number, x: number, z: number, dx: number, dz: number): number {
	const s = state.builds;
	const b = state.breakables;
	if (s === undefined || b === undefined || b.intact === 0) return 0;
	const p = s.players[i];
	if (p === undefined || (p.levels[Boon.WRECKER] ?? 0) <= 0 || buildPlayerLeft(state, i)) return 0;
	if (rollSmasher === undefined) error("builds: the roll smash is not bound (breakables.ts not loaded)", 0);
	return rollSmasher(state, i, x, z, dx, dz);
}

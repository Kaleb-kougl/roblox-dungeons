/**
 * Executioner (Sharpened III; docs/BUILDS.md "Evolutions (level III)", BU5; a Roblox-port feature, no web source).
 * Called by actors.ts damageActor (only with state.builds) after filterDamage, the Shielded absorb and the damage cap,
 * before the overkill clamp and the hp subtraction:
 *
 *   a hit that lands (dmg > 0) on a non-boss enemy (def.data.boss not true) that it would NOT kill, credited to a player
 *   (ctx.playerIndex: the bullet's owner, the swinging player, the spark's owner) who owns Sharpened at level III, and
 *   that would leave it at or below EXECUTIONER_HP_PERCENT of its max hp ((hp - dmg) x 100 <= 20 x hpMax), deals the
 *   rest of its hp instead: the enemy dies by this hit, on damageActor's kill line, so the kill scores, procs (gen
 *   ctx.procGen) and counts like any player kill. BuildEvents execX / execZ / execOwner record it.
 *
 * A hit that kills anyway is not an execute; a hit the shield or the cap swallowed whole is not either.
 */
import type { SimCtx } from "../combat/ctx";
import type { ActorState, ArchetypeDef } from "../combat/actors/types";
import { Boon, PERCENT } from "../progression/progressionData";
import { isEvolved } from "./hooks";
import { EXECUTIONER_HP_PERCENT } from "./effectsData";

/** The damage the hit deals with Executioner applied (`dmg` itself when it does not execute). */
export function buildsExecute(ctx: SimCtx, a: Readonly<ActorState>, def: Readonly<ArchetypeDef>, dmg: number): number {
	const s = ctx.state.builds;
	if (s === undefined || !(dmg > 0) || dmg >= a.hp || def.data.boss === true) return dmg;
	const owner = ctx.playerIndex;
	if (!isEvolved(s.players[owner], Boon.SHARPENED)) return dmg;
	if ((a.hp - dmg) * PERCENT > EXECUTIONER_HP_PERCENT * a.hpMax) return dmg;
	const e = s.events;
	e.execX.push(a.x);
	e.execZ.push(a.z);
	e.execOwner.push(owner);
	return a.hp;
}

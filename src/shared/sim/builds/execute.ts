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
 *
 * Overkill's carry (docs/LEGENDARIES.md LG2; buildsKillCarry, from damageActor's kill line, only with state.builds):
 *   the hit after filterDamage, the Shielded absorb and the boss cap (`hit`, before Executioner) minus the hp the enemy
 *   had (`hpBefore`); an execute carries the whole `hit` (LGD3); a kill by the player's own hit (ctx.procGen 0) of an
 *   enemy at full hp carries at least OVERKILL_ONE_SHOT_MIN (LGD2: streak kills, gen >= 1, never get the floor); a
 *   carry below OVERKILL_MIN_CARRY is 0; a boss's kill never carries. Damage is an exact binary fraction, so is this.
 */
import type { SimCtx } from "../combat/ctx";
import type { ActorState, ArchetypeDef } from "../combat/actors/types";
import { Boon, PERCENT } from "../progression/progressionData";
import { isEvolved } from "./hooks";
import { EXECUTIONER_HP_PERCENT, OVERKILL_MIN_CARRY, OVERKILL_ONE_SHOT_MIN } from "./effectsData";

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

/** Overkill's carry of a kill (see the file comment): 0 when it carries nothing. */
export function buildsKillCarry(
	ctx: SimCtx,
	a: Readonly<ActorState>,
	def: Readonly<ArchetypeDef>,
	hit: number,
	hpBefore: number,
	executed: boolean,
): number {
	if (def.data.boss === true) return 0;
	let carry = executed ? hit : hit - hpBefore;
	if (ctx.procGen === 0 && hpBefore === a.hpMax && carry < OVERKILL_ONE_SHOT_MIN) carry = OVERKILL_ONE_SHOT_MIN;
	return carry >= OVERKILL_MIN_CARRY ? carry : 0;
}

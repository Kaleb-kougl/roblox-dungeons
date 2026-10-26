/**
 * The boosts' gameplay reads (docs/BOOSTS.md B3), a LEAF like progression/runMods.ts: it imports only dropsData.ts
 * and types, so runMods.ts, player.ts and party.ts can call it without a require cycle. Boosts change every tick, so
 * they are not folded into the cached RunMods; each read looks at state.drops directly.
 *
 * Neutral without state.drops (or with the boost off): every percent is BOOST_PERCENT (100), which the callers'
 * scalePercent / scaleTicks guard to return their input unchanged, every hook a no-op. So M1, every fixture and every
 * world without SimConfig.drops step exactly as before.
 *
 * Application points (all for the player the rule is about, as for the M2 modifiers):
 *   Fury       runMods playerHitDamage: after Sharpened, x FURY_DAMAGE_PERCENT / 100 (the acting / owning player)
 *   Frenzy     runMods attackTicks: Swift Strikes' percent x FRENZY_ATTACK_TICKS_PERCENT / 100 as ONE integer percent
 *              through scaleTicks (the acting player)
 *   Quickstep  player.ts stepPlayer walk: x QUICKSTEP_WALK_PERCENT / 100; movePlayer splits a walk tick longer than
 *              MAX_MOVE_STEP into equal sub-steps (the roll is untouched)
 *   Aegis      player.ts damagePlayer: after the tutorial's harmless branch, before armor, a pip absorbs the whole hit
 *              (absorbWithAegis; the hit player)
 *   death      boostsOnPlayerDied (damagePlayer's death, forfeitSoloRun, markPlayerLeft): every timer and pip cleared
 */
import type { SimState } from "../state";
import type { BoostPlayerState } from "./drops";
import {
	BOOST_PERCENT,
	Boost,
	FRENZY_ATTACK_TICKS_PERCENT,
	FURY_DAMAGE_PERCENT,
	QUICKSTEP_WALK_PERCENT,
} from "./dropsData";

/** Player `playerIndex`'s boost state, or undefined without drops. */
export function boostPlayer(state: Readonly<SimState>, playerIndex: number): BoostPlayerState | undefined {
	return state.drops?.players[playerIndex];
}

/** True while player `playerIndex`'s boost `kind` runs. */
export function isBoostActive(state: Readonly<SimState>, playerIndex: number, kind: number): boolean {
	const bp = state.drops?.players[playerIndex];
	return bp !== undefined && bp.ticks[kind] > 0;
}

/** Fury: the damage percent on top of Sharpened (BOOST_PERCENT when off). */
export function boostDamagePercent(state: Readonly<SimState>, playerIndex: number): number {
	return isBoostActive(state, playerIndex, Boost.FURY) ? FURY_DAMAGE_PERCENT : BOOST_PERCENT;
}

/** Frenzy: the attack ticks percent on top of Swift Strikes (BOOST_PERCENT when off). */
export function boostAttackTicksPercent(state: Readonly<SimState>, playerIndex: number): number {
	return isBoostActive(state, playerIndex, Boost.FRENZY) ? FRENZY_ATTACK_TICKS_PERCENT : BOOST_PERCENT;
}

/** Quickstep: the walk percent (BOOST_PERCENT when off). */
export function boostWalkPercent(state: Readonly<SimState>, playerIndex: number): number {
	return isBoostActive(state, playerIndex, Boost.QUICKSTEP) ? QUICKSTEP_WALK_PERCENT : BOOST_PERCENT;
}

/**
 * damagePlayer, a hit that lands (after the harmless branch, before armor): with an Aegis pip left, one pip absorbs
 * the whole hit (the last pip also ends the Aegis timer) and events.aegisBroke gets the player; returns true. Else
 * false (nothing changed).
 */
export function absorbWithAegis(state: SimState, playerIndex: number): boolean {
	const d = state.drops;
	const bp = d?.players[playerIndex];
	if (d === undefined || bp === undefined || bp.aegisPips <= 0) return false;
	bp.aegisPips -= 1;
	if (bp.aegisPips <= 0) bp.ticks[Boost.AEGIS] = 0;
	d.events.aegisBroke.push(playerIndex);
	return true;
}

/** Player `playerIndex` died (or left): every boost ends, the Aegis pips go. No event. No-op without drops. */
export function boostsOnPlayerDied(state: SimState, playerIndex: number): void {
	const bp = state.drops?.players[playerIndex];
	if (bp === undefined) return;
	for (let k = 0; k < bp.ticks.size(); k++) bp.ticks[k] = 0;
	bp.aegisPips = 0;
}

/**
 * Actor modifier choke points (Roblox port, docs/ENEMY_VARIANTS.md EV1): every room enemy's walk step and attack
 * cooldown goes through these, so elite affixes (EV7: Swift, Hulking) and Respite (docs/DIFFICULTY.md) scale them in
 * ONE place instead of at every archetype's call site.
 *
 * Without elite affixes (SimConfig.affixes absent) and without a Warbanner's aura (docs/NEW_ENEMIES.md NE1: the aura
 * hooks return PERCENT until NE6) every percent source returns PERCENT (100), and at 100 every helper
 * returns exactly what the raw expression it replaced gave (`ctx.data(a).speed * SIM_DT`; one `ctx.randomInt(min, max)`; the fixed tick count), with the same rng
 * draws: a pure refactor, so M1, every golden fixture and the tutorial replay bit for bit.
 *
 * Draw rule: `enemyCooldown` always draws exactly ONE `ctx.randomInt(min, max)` and only then scales the result, so a
 * modifier never changes the draw count (replays of unmodified actors stay put). Telegraph, lunge, recover and
 * strafe-flip ticks never go through here (EVD9: Swift never shortens a telegraph). Bosses, turrets and the dummy keep
 * their raw reads.
 */

import { SIM_DT } from "../../units";
import { PERCENT } from "../../progression/progressionData";
import { combinedPercent, scalePercent, scaleTicks } from "../../progression/runMods";
import type { SimCtx } from "../ctx";
import type { ActorState } from "./types";
import { affixCooldownPercent, affixWalkPercent } from "../../affixes/affixes";

/**
 * Integer percent applied to `a`'s walk step (100 = unchanged): the elite affix's (EV7, affixes.ts affixWalkPercent:
 * Swift 135, Hulking 85, from `state.affixes` with its actorId guard; PERCENT without affixes), combined with the
 * Warbanner's aura (docs/NEW_ENEMIES.md NE1 / NE6, auraWalkPercent; PERCENT without one) by `combinedPercent`, which
 * returns the affix percent itself while the aura is PERCENT. Respite combines its lever here the same way.
 */
export function actorWalkPercent(ctx: SimCtx, a: Readonly<ActorState>): number {
	const affix = ctx.state.affixes === undefined ? PERCENT : affixWalkPercent(ctx.state, a);
	return combinedPercent(affix, auraWalkPercent(ctx, a));
}

/**
 * Integer percent applied to `a`'s attack cooldowns (100 = unchanged): the elite affix's (EV7, affixes.ts
 * affixCooldownPercent: Swift 75; PERCENT without affixes), combined with the Warbanner's aura (auraCooldownPercent;
 * PERCENT without one) by `combinedPercent` (the affix percent itself at 100). Respite combines its lever here too.
 */
export function actorCooldownPercent(ctx: SimCtx, a: Readonly<ActorState>): number {
	const affix = ctx.state.affixes === undefined ? PERCENT : affixCooldownPercent(ctx.state, a);
	return combinedPercent(affix, auraCooldownPercent(ctx, a));
}

/**
 * The Warbanner's aura on `a`'s walk (docs/NEW_ENEMIES.md NED8: 125 inside a living Warbanner's radius), an integer
 * percent. NE1 hook point: always PERCENT (no aura exists yet), so actorWalkPercent is exactly the affix percent and
 * every run replays as before. NE6 fills it from the per-tick aura mask (never for a boss, turret, dummy or Warbanner).
 */
export function auraWalkPercent(_ctx: SimCtx, _a: Readonly<ActorState>): number {
	return PERCENT;
}

/**
 * The Warbanner's aura on `a`'s attack cooldowns (NED8: 80 inside the radius), an integer percent. NE1 hook point:
 * always PERCENT, like auraWalkPercent. Telegraph, lunge and recover ticks never go through it (EVD9).
 */
export function auraCooldownPercent(_ctx: SimCtx, _a: Readonly<ActorState>): number {
	return PERCENT;
}

/** World units `a` walks this tick: `data.speed * SIM_DT`, scaled by actorWalkPercent (exactly that at 100). */
export function walkStep(ctx: SimCtx, a: Readonly<ActorState>): number {
	return scalePercent(ctx.data(a).speed * SIM_DT, actorWalkPercent(ctx, a));
}

/**
 * An attack cooldown for `a`: ONE `ctx.randomInt(min, max)` (both inclusive), then scaled by actorCooldownPercent
 * through scaleTicks (round half up; the drawn value itself at 100).
 */
export function enemyCooldown(ctx: SimCtx, a: Readonly<ActorState>, min: number, max: number): number {
	const ticks = ctx.randomInt(min, max);
	return scaleTicks(ticks, actorCooldownPercent(ctx, a));
}

/** A fixed (no draw) attack cooldown for `a`: `ticks` scaled by actorCooldownPercent (`ticks` itself at 100). */
export function enemyCooldownFixed(ctx: SimCtx, a: Readonly<ActorState>, ticks: number): number {
	return scaleTicks(ticks, actorCooldownPercent(ctx, a));
}

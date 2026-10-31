/**
 * Actor modifier choke points (Roblox port, docs/ENEMY_VARIANTS.md EV1): every room enemy's walk step and attack
 * cooldown goes through these, so elite affixes (EV7: Swift, Hulking) and Respite (docs/DIFFICULTY.md) scale them in
 * ONE place instead of at every archetype's call site.
 *
 * Today both percent sources return PERCENT (100), and at 100 every helper returns exactly what the raw expression it
 * replaced gave (`ctx.data(a).speed * SIM_DT`; one `ctx.randomInt(min, max)`; the fixed tick count), with the same rng
 * draws: a pure refactor, so M1, every golden fixture and the tutorial replay bit for bit.
 *
 * Draw rule: `enemyCooldown` always draws exactly ONE `ctx.randomInt(min, max)` and only then scales the result, so a
 * modifier never changes the draw count (replays of unmodified actors stay put). Telegraph, lunge, recover and
 * strafe-flip ticks never go through here (EVD9: Swift never shortens a telegraph). Bosses, turrets and the dummy keep
 * their raw reads.
 */

import { SIM_DT } from "../../units";
import { PERCENT } from "../../progression/progressionData";
import { scalePercent, scaleTicks } from "../../progression/runMods";
import type { SimCtx } from "../ctx";
import type { ActorState } from "./types";

/**
 * Integer percent applied to `a`'s walk step (100 = unchanged). Placeholder source: always 100 today; EV7 (affixes:
 * Swift 135, Hulking 85, read from `state.affixes` with its actorId guard) fills it, and Respite combines its lever
 * here with `combinedPercent`.
 */
export function actorWalkPercent(_ctx: SimCtx, _a: Readonly<ActorState>): number {
	return PERCENT;
}

/**
 * Integer percent applied to `a`'s attack cooldowns (100 = unchanged). Placeholder source: always 100 today; EV7
 * (affixes: Swift 75) fills it, and Respite combines its lever here with `combinedPercent`.
 */
export function actorCooldownPercent(_ctx: SimCtx, _a: Readonly<ActorState>): number {
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

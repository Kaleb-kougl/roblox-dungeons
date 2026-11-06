/**
 * The training dummy's sprite input (docs/DUMMY_ART.md DA3). Registered in sprites.ts ACTOR_SPRITE_INPUTS under the
 * archetype id `dummy`, so the actor pipeline draws the placeholder post until the pack has an `enemy.dummy` sprite
 * set, which then plugs in like every other set. The dummy never moves, turns or attacks (archetypes/dummy.ts), so it
 * plays its one idle frame, the `hit` wobble after each hit (over the view-side clip the renderer adds, DD1) and the
 * `death` break on the kill. Its own module, imported by FILE from sprites.ts (sprites.luau sits near Luau's 200
 * top-level locals). A leaf (shared/sim, types only from sprites.ts): no require cycle.
 */
import { CORPSE_TICKS, DUMMY, type ActorState } from "shared/sim";
import type { ActorSpriteInput } from "../sprites";

/** The dummy's corpse time (its data's, else the shared default; the break plays over it). */
export const DUMMY_CORPSE_TICKS = DUMMY.data.corpseTicks ?? CORPSE_TICKS;

/** ActorSpriteInput for the training dummy: never attacks, never moves (speed 0: idle). */
export function dummySpriteInput(a: Readonly<ActorState>, alpha: number): ActorSpriteInput {
	return {
		alive: a.alive !== 0,
		deadTicks: a.deadTicks,
		corpseTicks: DUMMY_CORPSE_TICKS,
		flashTicks: a.flashTicks,
		attack: undefined,
		speed: 0,
		refSpeed: 0,
		alpha,
	};
}

/**
 * The Goldling's sprite input (docs/FORTUNE.md FO8; FD14: v1 art is a gold recolour of an existing small set, the
 * owner's FO10). Registered in sprites.ts ACTOR_SPRITE_INPUTS under the archetype id `golden`, so the actor pipeline
 * draws its placeholder gold block until the pack has an `enemy.golden` sprite set, and that set then plugs in like the
 * band-4 enemies' (ActorRenderController takes the sprite path once `pack.sprites("enemy.golden")` is a set): `idle`
 * standing, `move` while it runs or jinks (its ground speed against the run speed, so a jink plays faster), `hit` on
 * every damaging hit's flash, `death` on the catch (an escape frees the actor: no death plays, the dive puff covers it).
 * It never attacks. Its own module, imported by FILE from sprites.ts: sprites.luau sits near Luau's 200 top-level
 * locals, and this keeps its cost there at one import. A leaf (shared/sim, types only from sprites.ts): no require cycle.
 *
 * @module
 */
import { CORPSE_TICKS, GOLDEN, GOLDEN_SPEED, SIM_HZ, type ActorState } from "shared/sim";
import type { ActorSpriteInput } from "../sprites";

/** Ground speed from one tick's position delta, world units / s (sprites.ts tickSpeed; no import: no require cycle). */
function groundSpeed(a: Readonly<ActorState>): number {
	const dx = a.x - a.prevX;
	const dz = a.z - a.prevZ;
	return math.sqrt(dx * dx + dz * dz) * SIM_HZ;
}

/** The Goldling's corpse time (its data's, else the shared default; the catch's death plays over it). */
export const GOLDEN_CORPSE_TICKS = GOLDEN.data.corpseTicks ?? CORPSE_TICKS;

/** The speed at which its move loop plays at the authored fps: its run speed (GOLDEN_SPEED). */
export const GOLDEN_MOVE_REF_SPEED = GOLDEN_SPEED;

/** ActorSpriteInput for the Goldling: no attack, idle / move by speed, hit by the flash, death on the catch. */
export function goldenSpriteInput(a: Readonly<ActorState>, alpha: number): ActorSpriteInput {
	return {
		alive: a.alive !== 0,
		deadTicks: a.deadTicks,
		corpseTicks: GOLDEN_CORPSE_TICKS,
		flashTicks: a.flashTicks,
		attack: undefined,
		speed: groundSpeed(a),
		refSpeed: GOLDEN_MOVE_REF_SPEED,
		alpha,
	};
}

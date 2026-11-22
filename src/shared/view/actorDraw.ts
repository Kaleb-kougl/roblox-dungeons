/**
 * The actor renderer's placeholder rules (docs/ACTOR_RENDER.md R5): the scale a placeholder model is built at and the
 * capsule's tumble through a roll. Pure: the client's ActorRenderController and the juice's size cache
 * (fx/fxHelpers.ts) read them, so health bars sit on the body that is drawn.
 *
 * @module
 */
import { ROLL_TICKS } from "shared/sim";
import { ACTOR_VIEW } from "./config";

/**
 * The scale a placeholder model is built at: the archetype's data.spriteScale (1 when it has none); a boss at least
 * ACTOR_VIEW.bossMinDrawPx web pixels wide (`cellPxW`: the visual's cell width at scale 1; a boss already that wide
 * keeps its own scale); times `affixScale` (Hulking: affixDrawScale), applied after the boss minimum. Part of the
 * placeholder pool's key, so the same inputs must give the same number.
 */
export function placeholderDrawScale(
	spriteScale: number | undefined,
	boss: boolean,
	cellPxW: number,
	affixScale = 1,
): number {
	let scale = spriteScale ?? 1;
	if (boss && cellPxW * scale < ACTOR_VIEW.bossMinDrawPx) {
		scale = ACTOR_VIEW.bossMinDrawPx / cellPxW;
	}
	return scale * affixScale;
}

/**
 * How far through its roll a player is, 0 (the roll's first tick, at alpha 0) to 1 (done): the placeholder capsule
 * tumbles forward one whole turn over it. `rollTicks` is the sim's countdown (ROLL_TICKS at the start), `alpha` the
 * render interpolation within the tick. Clamped, so a countdown longer than ROLL_TICKS starts at 0.
 */
export function rollTumbleTurn(rollTicks: number, alpha: number): number {
	return math.clamp((ROLL_TICKS - rollTicks + alpha) / ROLL_TICKS, 0, 1);
}

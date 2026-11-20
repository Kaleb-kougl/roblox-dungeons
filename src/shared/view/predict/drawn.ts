/**
 * The drawn player (docs/LOCAL_PREDICTION.md Design 1 / 6, LP5), pure: the local player's PlayerState as the views draw
 * it while predicting. Every field is the merged player's (hearts, i-frames, the hurt blink, death, the flask charges:
 * truth, LPD5) except the body's motion, which is the predicted head's: position (with the smoother's offset), facing,
 * the roll (timer and direction) and the flask's slowdown timer. Its prevX / prevZ are the head's prev plus the same
 * offset, so a view's `lerp(prev, x, alpha)` gives exactly the smoothed pose and `x - prevX` the head's own step (the
 * walk animation's speed).
 *
 * Views take a DrawnPlayerOf (SimController's `drawnPlayerOf`) where they draw on or at the player; it returns the
 * merged player itself for everyone else and whenever nothing is predicted (solo, spectating, dead, a draft, the stage
 * cover), so those views are exactly today's.
 *
 * @module
 */
import { playerAt, type PlayerState, type SimState } from "shared/sim";
import type { PredictedBody } from "./smoother";

/** The predicted head's motion fields the drawn player takes (a shared/lockstep LocalPredictor head fits). */
export interface PredictedMotion extends PredictedBody {
	readonly rollTicks: number;
	readonly rollDirX: number;
	readonly rollDirZ: number;
	readonly flaskTicks: number;
}

/** Player `index` of `state` as drawn this frame (the merged player unless it is the predicted local one). */
export type DrawnPlayerOf = (state: Readonly<SimState>, index: number) => Readonly<PlayerState>;

/** Player `index` as `drawn` gives it, or the merged player without one. */
export function drawnOrMerged(
	state: Readonly<SimState>,
	index: number,
	drawn: DrawnPlayerOf | undefined,
): Readonly<PlayerState> {
	return drawn !== undefined ? drawn(state, index) : playerAt(state, index);
}

/** Writes the drawn player into `out`: `merged` with `head`'s motion, shifted by the smoother's offset (tiles). */
export function writeDrawnPlayer(
	out: PlayerState,
	merged: Readonly<PlayerState>,
	head: Readonly<PredictedMotion>,
	offsetX: number,
	offsetZ: number,
): void {
	out.hearts = merged.hearts;
	out.heartsMax = merged.heartsMax;
	out.armor = merged.armor;
	out.armorMax = merged.armorMax;
	out.flask = merged.flask;
	out.flaskMax = merged.flaskMax;
	out.embers = merged.embers;
	out.emberMax = merged.emberMax;
	out.iframeTicks = merged.iframeTicks;
	out.hurtTicks = merged.hurtTicks;
	out.prevButtons = merged.prevButtons;
	out.dead = merged.dead;
	out.x = head.x + offsetX;
	out.z = head.z + offsetZ;
	out.prevX = head.prevX + offsetX;
	out.prevZ = head.prevZ + offsetZ;
	out.faceX = head.faceX;
	out.faceZ = head.faceZ;
	out.rollTicks = head.rollTicks;
	out.rollDirX = head.rollDirX;
	out.rollDirZ = head.rollDirZ;
	out.flaskTicks = head.flaskTicks;
}

/**
 * Tunables of the hurt feedback (docs/FEEL.md J2 / J3 / J11): the red screen-edge flash when the view player is hit
 * (hurtFlash.ts), the low-health edge pulse (lowHealth.ts), the hurt camera jolt and the hurt freeze (freezeRules.ts).
 * Roblox-port choices, no web source. Presentation only: nothing here reaches the sim. Times are real seconds (the
 * effect clock), except the freeze and the jolt, which are ms like the rest of freezeRules.ts.
 *
 * @module
 */
import { HURT_INVULN_SECONDS } from "shared/sim";
import type { HurtKind } from "../watch";

export const FEEL_HURT = {
	/**
	 * Peak opacity of the edge flash per hit kind. harmless (the tutorial's hits, JD8) and armor (an armor or Aegis pip
	 * took the hit) at half strength, heart stronger, the lethal hit strongest.
	 */
	peak: { none: 0, harmless: 0.25, armor: 0.25, heart: 0.45, lethal: 0.6 } as Readonly<Record<HurtKind, number>>,
	/** Linear fade from the peak to clear, seconds. */
	fadeSec: 0.3,
	/**
	 * The lethal flash holds its peak this long (the death animation; as long as the spectate hold on a fresh corpse,
	 * SPECTATE.holdOnDeathSec), then fades over lethalFadeSec, so it never sits under the run-over panel for good.
	 */
	lethalHoldSec: 1.5,
	lethalFadeSec: 0.6,
	/** Each edge's gradient runs from the edge to clear over this fraction of the screen's short side. */
	edgeFraction: 0.18,
	/** A watched teammate's flash and pulse (spectating, JD7) at this share of the opacity. */
	spectateScale: 0.5,
	/**
	 * A hurt edge less than this many seconds after the running flash started does not restart it (it only raises the
	 * flash's kind). The sim already spaces hurt edges by HURT_INVULN_TICKS; this keeps the same spacing in real time
	 * when the loop catches up after a hitch (several ticks per frame), so flashes stay <= 1 / 0.75 s = 1.33 Hz.
	 */
	minIntervalSec: HURT_INVULN_SECONDS,
	/** Solo freeze on a heart or lethal hit, ms (JD12; armor and harmless hits: none). */
	freezeMs: 40,
	/** The hurt camera jolt: whole render texels, alternating right / left for `nudgeSteps` steps of `nudgeStepMs`. */
	nudgeTexels: 2,
	nudgeSteps: 3,
	nudgeStepMs: 40,
	/** The edge ScreenGui's DisplayOrder sits this far below HUD_VIEW.hudDisplayOrder (the HUD draws over it). */
	displayOrderBelowHud: 1,
	/** Edge transparency is written in steps of this size (fewer property writes). */
	writeQuantum: 1 / 64,
	/** Longest frame the low-health envelope advances by, seconds (a hitch never jumps it). */
	maxFrameDtSec: 0.1,
} as const;

/** The low-health pulse (J11, JD13): one more hit kills the view player. */
export const FEEL_LOW_HEALTH = {
	/** On at or below this many half hearts (with no armor or Aegis pip to absorb the next hit). */
	halfHearts: 1,
	/** Pulse peak opacity, and its rate (well under the 3 Hz photosensitivity guideline). */
	peak: 0.18,
	hz: 1,
	/** The pulse fades in when it turns on and out when it turns off over this many seconds. */
	fadeSec: 0.4,
	/** Reduced motion: a steady glow at this opacity instead of the pulse. */
	steady: 0.12,
} as const;

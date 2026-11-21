/**
 * The low-health pulse (docs/FEEL.md J11, JD13; a Roblox-port feature, no web source): while one more hit would kill
 * the view player, the red screen edges (the hurt flash's, HurtFlashController) pulse faintly. Pure: no clock (callers
 * pass the frame's dt), no Roblox API; tunables FEEL_LOW_HEALTH (hurtConfig.ts).
 *
 *   on         lowHealthOn(p, aegisUp): alive, hearts <= FEEL_LOW_HEALTH.halfHearts, no armor pip and no Aegis pip
 *              (either would absorb the next hit). lowHealthAt(state, i) reads the Aegis pip from state.drops and is
 *              never on in the tutorial's harmless mode (its hits never kill; its wounded start is 4 half hearts anyway)
 *   look       lowHealthLook(ageSec, motion): a raised cosine between clear and FEEL_LOW_HEALTH.peak at
 *              FEEL_LOW_HEALTH.hz (1 Hz, under the 3 Hz guideline), clear at age 0; under reduced motion (motion 0)
 *              a steady FEEL_LOW_HEALTH.steady instead
 *   envelope   LowHealthPulse fades the pulse in when it turns on and out when it turns off over fadeSec, and scales
 *              it by FEEL_HURT.spectateScale while spectating, like the flash
 *
 * @module
 */
import { aegisPips, playerAt, type PlayerState, type SimState } from "shared/sim";
import { FEEL_HURT, FEEL_LOW_HEALTH } from "./hurtConfig";

const CLEAR = 1;
const TAU = 2 * math.pi;

/** One more hit kills `p`: alive, on the last half heart(s), and neither armor nor an Aegis pip (`aegisUp`) left. */
export function lowHealthOn(p: Readonly<PlayerState>, aegisUp: boolean): boolean {
	return p.dead === 0 && p.hearts <= FEEL_LOW_HEALTH.halfHearts && p.armor <= 0 && !aegisUp;
}

/** lowHealthOn for player `i` of `state` (its Aegis pip from state.drops); never in the tutorial's harmless mode. */
export function lowHealthAt(state: Readonly<SimState>, i: number): boolean {
	const tutorial = state.tutorial;
	if (tutorial !== undefined && tutorial.harmless !== 0) return false;
	return lowHealthOn(playerAt(state, i), aegisPips(state, i) > 0);
}

/** Opacity (0..1) of a fully faded-in pulse `ageSec` after it turned on; `motion` 0 = reduced motion (steady). */
function pulseOpacity(ageSec: number, motion: number): number {
	if (!(motion > 0)) return FEEL_LOW_HEALTH.steady;
	const t = ageSec >= 0 ? ageSec : 0;
	return (FEEL_LOW_HEALTH.peak * (1 - math.cos(TAU * FEEL_LOW_HEALTH.hz * t))) / 2;
}

/** The edge transparency (1 = clear) of a fully faded-in pulse `ageSec` after it turned on (see the header). */
export function lowHealthLook(ageSec: number, motion: number): number {
	return CLEAR - pulseOpacity(ageSec, motion);
}

/** The view player's pulse: its fade envelope and phase. The client keeps one; reset() on a run start or a switch. */
export class LowHealthPulse {
	/** Fade envelope, 0 (off) .. 1 (fully on). */
	level = 0;
	/** Seconds since the pulse last turned on (its phase). */
	ageSec = 0;
	private wasOn = false;

	reset(): void {
		this.level = 0;
		this.ageSec = 0;
		this.wasOn = false;
	}

	/**
	 * One frame: `on` (lowHealthAt), the real `dtSec` (clamped to [0, FEEL_HURT.maxFrameDtSec]), motionScale and
	 * whether the views follow a teammate. Returns the pulse's edge transparency this frame.
	 */
	update(on: boolean, dtSec: number, motion: number, spectating: boolean): number {
		const dt = dtSec > 0 ? math.min(dtSec, FEEL_HURT.maxFrameDtSec) : 0;
		if (on && !this.wasOn && this.level <= 0) this.ageSec = 0;
		this.wasOn = on;
		const step = FEEL_LOW_HEALTH.fadeSec > 0 ? dt / FEEL_LOW_HEALTH.fadeSec : 1;
		this.level = on ? math.min(this.level + step, 1) : math.max(this.level - step, 0);
		if (this.level <= 0) return CLEAR;
		this.ageSec += dt;
		const opacity = this.level * pulseOpacity(this.ageSec, motion) * (spectating ? FEEL_HURT.spectateScale : 1);
		return CLEAR - opacity;
	}
}

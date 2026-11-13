/**
 * Haptics' shared pure core (docs/HAPTICS.md HP1, Design 1; moved out of shared/view/menu padFeedback.ts, GM9): the
 * pulse types both cue tables use (shared/view/menu MENU_HAPTICS, hapticsConfig.ts PLAY_HAPTICS), a cue's pulses as
 * motor events (hapticTimeline) and which scheduled event is still current per pad + motor (HapticGenerations, now with
 * a priority). No Roblox API, no clock (callers pass real seconds). The client's haptics controller plays them.
 *
 *   pulse      a shape (strength, seconds, start offset `atSec`, optional linear ramp to `toStrength` by its end) on a
 *              motor; the phone's single actuator takes the motor-free shape (TouchPulse, playHaptics touchWaveform).
 *   timeline   each pulse turns its motor on at its offset and off `seconds` later; a ramp holds each step for
 *              `rampStepSec` (on events at the ramp's value at the step's start) before the off. Ties: offs first.
 *   priority   a cue on a pad + motor runs until its `untilSec`; a weaker cue there is refused meanwhile, a stronger or
 *              equal one takes over (its events win, the older one's later events are stale). The priority-free begin
 *              (menu cues) always takes over, as before.
 */

/** A pad's vibration motors (Enum.VibrationMotor names). */
export type HapticMotor = "Small" | "Large";

/** A vibration's shape: `strength` (0..1) for `seconds`, starting `atSec` (default 0) after the cue. */
export interface HapticShape {
	readonly strength: number;
	readonly seconds: number;
	/** Start offset after the cue (seconds; absent: 0). */
	readonly atSec?: number;
	/** A linear ramp from `strength` to this by the pulse's end (absent: held at `strength`). */
	readonly toStrength?: number;
}

/** One pad pulse: a shape on one motor. */
export interface HapticPulse extends HapticShape {
	readonly motor: HapticMotor;
}

/** One phone pulse: a shape on the device's single actuator. */
export type TouchPulse = HapticShape;

/** One motor event: at `atSec` after the cue, set `motor` to `strength` (0: off). */
export interface HapticEvent {
	readonly atSec: number;
	readonly motor: HapticMotor;
	readonly strength: number;
}

/** A ramp step this close to the pulse's end is not emitted (float slack on `k * rampStepSec`). */
const RAMP_END_SLACK_SEC = 1e-9;

/** A shape's start offset, never negative. */
export function pulseStartSec(p: HapticShape): number {
	return math.max(0, p.atSec ?? 0);
}

/** A shape's end (start offset + length, the length never negative). */
export function pulseEndSec(p: HapticShape): number {
	return pulseStartSec(p) + math.max(0, p.seconds);
}

/** A shape's strength `intoSec` after its start, clamped to 0..1 (a ramp interpolates linearly over `seconds`). */
export function pulseStrengthAt(p: HapticShape, intoSec: number): number {
	const to = p.toStrength;
	if (to === undefined || !(p.seconds > 0)) return math.clamp(p.strength, 0, 1);
	const share = math.clamp(intoSec / p.seconds, 0, 1);
	return math.clamp(p.strength + (to - p.strength) * share, 0, 1);
}

/** The latest end over `pulses` (seconds after the cue; 0 for none): a cue's whole length, gaps included. */
export function pulsesSeconds(pulses: ReadonlyArray<HapticShape>): number {
	let lastSec = 0;
	for (const p of pulses) lastSec = math.max(lastSec, pulseEndSec(p));
	return lastSec;
}

/**
 * A cue's pulses as motor events, in time order (ties: offs first, so a pulse that starts as another on the same
 * motor ends is not cut): each pulse turns its motor on at its offset and off `seconds` later; a ramp (`toStrength`)
 * adds an on event every `rampStepSec` at the ramp's value at that step's start (a non-positive step: held at the
 * start value). Strength clamped to 0..1, durations and offsets never negative. Pulses without a ramp give exactly the
 * menu's old timeline.
 */
export function hapticTimeline(pulses: ReadonlyArray<HapticPulse>, rampStepSec: number): ReadonlyArray<HapticEvent> {
	const out = new Array<HapticEvent>();
	for (const p of pulses) {
		const start = pulseStartSec(p);
		const seconds = math.max(0, p.seconds);
		out.push({ atSec: start, motor: p.motor, strength: pulseStrengthAt(p, 0) });
		if (p.toStrength !== undefined && rampStepSec > 0) {
			for (let k = 1; k * rampStepSec < seconds - RAMP_END_SLACK_SEC; k++) {
				const into = k * rampStepSec;
				out.push({ atSec: start + into, motor: p.motor, strength: pulseStrengthAt(p, into) });
			}
		}
		out.push({ atSec: start + seconds, motor: p.motor, strength: 0 });
	}
	out.sort((a, b) => (a.atSec !== b.atSec ? a.atSec < b.atSec : a.strength < b.strength));
	return out;
}

/**
 * The latest cue per pad + motor (the client's haptics controller): `begin` hands a cue its generation for one pad's
 * motor, `current` says whether a scheduled event of that generation still applies. A newer cue on the SAME pad and
 * motor drops an older one's later events (the newer cue schedules its own off); a cue on another pad never does, so
 * every pad's "off" arrives. Generations come from one counter, so after `clear` (every motor off) no older event
 * matches again.
 *
 * With a priority (play cues): the cue holds its pad + motor until `untilSec`; until then a cue of a LOWER priority is
 * refused (`begin` returns undefined and the running cue keeps its events), an equal or higher one takes over.
 */
export class HapticGenerations {
	private counter = 0;
	private readonly latest = new Map<string, number>();
	/** Per pad + motor: the running prioritised cue's priority and the real second it ends (absent: no hold). */
	private readonly holdPriority = new Map<string, number>();
	private readonly holdUntil = new Map<string, number>();

	/** A new cue on `pad`'s `motor` (any stable names), always taking over (menu cues): its generation. */
	begin(pad: string, motor: HapticMotor): number;
	/**
	 * A new cue of `priority` on `pad`'s `motor` at `nowSec`, running until `untilSec`: its generation, or undefined
	 * while a higher-priority cue there still runs (`nowSec` before its `untilSec`).
	 */
	begin(pad: string, motor: HapticMotor, priority: number, nowSec: number, untilSec: number): number | undefined;
	begin(pad: string, motor: HapticMotor, priority?: number, nowSec?: number, untilSec?: number): number | undefined {
		const key = `${pad}/${motor}`;
		if (priority === undefined || nowSec === undefined || untilSec === undefined) {
			this.holdPriority.delete(key);
			this.holdUntil.delete(key);
		} else {
			const heldUntil = this.holdUntil.get(key);
			const heldPriority = this.holdPriority.get(key);
			if (
				heldUntil !== undefined &&
				heldPriority !== undefined &&
				nowSec < heldUntil &&
				priority < heldPriority
			) {
				return undefined;
			}
			this.holdPriority.set(key, priority);
			this.holdUntil.set(key, untilSec);
		}
		this.counter += 1;
		this.latest.set(key, this.counter);
		return this.counter;
	}

	/** An event of generation `gen` on `pad`'s `motor` still applies. */
	current(pad: string, motor: HapticMotor, gen: number): boolean {
		return this.latest.get(`${pad}/${motor}`) === gen;
	}

	/** Every pending event is stale and every hold released (the motors were turned off). */
	clear(): void {
		this.latest.clear();
		this.holdPriority.clear();
		this.holdUntil.clear();
	}
}

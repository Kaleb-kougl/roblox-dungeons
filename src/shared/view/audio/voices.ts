/**
 * Per-start choices of the audio layer, pure so specs can pin them (docs/FX_AUDIO.md A3): which clip of a sound's
 * pool plays (round-robin per ID), the PlaybackSpeed jitter (a seeded generator: presentation only, never the sim's
 * rng), and the music duck (a level the music group follows while a jingle or the Ember plays).
 */
import type { PitchRange } from "shared/theme";
import { AUDIO_VIEW } from "./config";

/** Round-robin clip choice per sound ID: 0, 1, .., count - 1, 0, .. (a pool of one is always 0). */
export class VariantPicker {
	private readonly nextIndex = new Map<string, number>();

	pick(id: string, count: number): number {
		if (count <= 1) return 0;
		const i = (this.nextIndex.get(id) ?? 0) % count;
		this.nextIndex.set(id, (i + 1) % count);
		return i;
	}

	reset(): void {
		this.nextIndex.clear();
	}
}

/** Park-Miller minimal standard generator: exact in float64 (multiplier x modulus < 2^53). */
const PM_MULTIPLIER = 16807;
const PM_MODULUS = 2147483647;

/** PlaybackSpeed jitter from a seeded generator, so a spec can pin the sequence. */
export class PitchJitter {
	private state: number;

	constructor(seed: number = AUDIO_VIEW.pitchSeed) {
		const s = math.floor(math.abs(seed)) % PM_MODULUS;
		this.state = s === 0 ? 1 : s;
	}

	/** Uniform in [0, 1). */
	unit(): number {
		this.state = (this.state * PM_MULTIPLIER) % PM_MODULUS;
		return (this.state - 1) / (PM_MODULUS - 1);
	}

	/** A PlaybackSpeed in `range` ([min, max]); 1 without a range. */
	speed(range: Readonly<PitchRange> | undefined): number {
		if (range === undefined) return 1;
		return range[0] + (range[1] - range[0]) * this.unit();
	}
}

/**
 * The music duck: trigger(now, seconds) holds the music at AUDIO_VIEW.duck.level until now + seconds; level(now, dt)
 * moves toward the target at the attack / release rate (full swing in attackSec / releaseSec) and returns it (1 = no
 * duck).
 */
export class MusicDuck {
	private holdUntil = -math.huge;
	private current = 1;

	trigger(now: number, seconds: number): void {
		const stop = now + seconds;
		if (stop > this.holdUntil) this.holdUntil = stop;
	}

	level(now: number, dt: number): number {
		const D = AUDIO_VIEW.duck;
		const target = now < this.holdUntil ? D.level : 1;
		const span = 1 - D.level;
		if (this.current > target) {
			const step = D.attackSec > 0 ? (span * dt) / D.attackSec : span;
			this.current = math.max(target, this.current - step);
		} else if (this.current < target) {
			const step = D.releaseSec > 0 ? (span * dt) / D.releaseSec : span;
			this.current = math.min(target, this.current + step);
		}
		return this.current;
	}

	reset(): void {
		this.holdUntil = -math.huge;
		this.current = 1;
	}
}

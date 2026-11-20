/**
 * The decor light pool and flicker (docs/DECOR.md Phase 2 part 2, task R9), pure. Instead of a PointLight per torch
 * (63 per floor) DECOR_LIGHTS.pool lights are shared by the lit lights nearest the camera focus: at most every
 * reassignSeconds the client asks for the nearest candidates (nearestDecorLights) and hands them to the pool
 * (DecorLightPool.assign); a light that loses its piece fades out first, then takes a new one and fades in. Flicker is
 * a per-light seeded curve (decorFlicker), so every light pulses on its own phase. Trig is fine here (view code; it
 * never reaches the sim).
 *
 * @module
 */
import { DECOR_LIGHTS } from "./fxConfig";

/** No piece. */
export const NO_DECOR_LIGHT = -1;

const TWO_PI = 2 * math.pi;
const HASH_BYTE = 256;
const HASH_SHIFT = 8;
/** A light's frequencies vary by +-FREQ_SPREAD / 2 around DECOR_LIGHTS.flickerHz by its hash. */
const FREQ_SPREAD = 0.4;
const FREQ_BASE = 1 - FREQ_SPREAD / 2;

/**
 * The indices of the `count` candidates nearest (fx, fz) among those with `level[i] >= minLevel`, nearest first (ties:
 * the lower index), written into `out` (cleared first). `xs` / `zs` / `level` are parallel arrays.
 */
export function nearestDecorLights(
	xs: ReadonlyArray<number>,
	zs: ReadonlyArray<number>,
	level: ReadonlyArray<number>,
	fx: number,
	fz: number,
	count: number,
	minLevel: number,
	out: number[],
	scratch: number[] = [],
): number[] {
	out.clear();
	scratch.clear();
	for (let i = 0; i < xs.size(); i++) {
		if (!(level[i] >= minLevel)) continue;
		const dx = xs[i] - fx;
		const dz = zs[i] - fz;
		const d2 = dx * dx + dz * dz;
		if (out.size() >= count && d2 >= scratch[count - 1]) continue;
		let k = out.size() < count ? out.size() : count - 1;
		if (out.size() < count) {
			out.push(i);
			scratch.push(d2);
		}
		while (k > 0 && scratch[k - 1] > d2) {
			out[k] = out[k - 1];
			scratch[k] = scratch[k - 1];
			k--;
		}
		out[k] = i;
		scratch[k] = d2;
	}
	return out;
}

/**
 * `size` lights, each holding one candidate key (or NO_DECOR_LIGHT) and a fade level. Pure, allocation-free per frame.
 * Per frame: `due(dt)` says whether to reassign now; if so, `assign(wanted)` with the nearest keys; then `fade(dt)`.
 */
export class DecorLightPool {
	/** Per light: the key it shows (NO_DECOR_LIGHT: free). */
	readonly key: number[] = [];
	/** Per light: fade level 0..1 (brightness multiplier). */
	readonly level: number[] = [];
	/** Per light: fading in (true) or out (false). */
	private readonly target: boolean[] = [];
	private readonly wanted: number[] = [];
	private timer = 0;
	/** Times assign changed which key a light holds (for budgets / specs). */
	changes = 0;

	constructor(
		readonly size: number = DECOR_LIGHTS.pool,
		private readonly reassignSeconds: number = DECOR_LIGHTS.reassignSeconds,
		private readonly fadeSeconds: number = DECOR_LIGHTS.fadeSeconds,
	) {
		for (let i = 0; i < size; i++) {
			this.key.push(NO_DECOR_LIGHT);
			this.level.push(0);
			this.target.push(false);
		}
		this.timer = reassignSeconds; // the first frame assigns
	}

	/** Every light free and dark; the next `due` is true. */
	clear(): void {
		for (let i = 0; i < this.size; i++) {
			this.key[i] = NO_DECOR_LIGHT;
			this.level[i] = 0;
			this.target[i] = false;
		}
		this.wanted.clear();
		this.timer = this.reassignSeconds;
	}

	/** Advances the reassign timer by `dt`; true when a reassignment is due (and restarts the timer). */
	due(dt: number): boolean {
		this.timer += math.max(0, dt);
		if (this.timer < this.reassignSeconds) return false;
		this.timer = 0;
		return true;
	}

	/**
	 * The keys that should be lit (the first `size` of `wanted`, most wanted first). A light whose key is wanted keeps
	 * it (fading in); one whose key is not fades out; wanted keys nobody holds go to free lights now, or as lights
	 * free up in `fade`.
	 */
	assign(wanted: ReadonlyArray<number>): void {
		const w = this.wanted;
		w.clear();
		for (let i = 0; i < wanted.size() && w.size() < this.size; i++) w.push(wanted[i]);
		for (let l = 0; l < this.size; l++) {
			const k = this.key[l];
			if (k === NO_DECOR_LIGHT) continue;
			this.target[l] = w.includes(k);
		}
		this.fill();
	}

	/** Fades every light toward its target; a light faded out is freed and takes a waiting wanted key. */
	fade(dt: number): void {
		const stepSize = this.fadeSeconds > 0 ? math.max(0, dt) / this.fadeSeconds : 1;
		let freed = false;
		for (let l = 0; l < this.size; l++) {
			if (this.key[l] === NO_DECOR_LIGHT) continue;
			if (this.target[l]) this.level[l] = math.min(1, this.level[l] + stepSize);
			else {
				this.level[l] = math.max(0, this.level[l] - stepSize);
				if (this.level[l] === 0) {
					this.key[l] = NO_DECOR_LIGHT;
					freed = true;
				}
			}
		}
		if (freed) this.fill();
	}

	/** The light holding `key`, or -1. */
	lightOf(key: number): number {
		for (let l = 0; l < this.size; l++) if (this.key[l] === key) return l;
		return -1;
	}

	/** Wanted keys nobody holds -> free lights (in wanted order, lowest light first). */
	private fill(): void {
		for (const k of this.wanted) {
			if (this.lightOf(k) >= 0) continue;
			let free = -1;
			for (let l = 0; l < this.size && free < 0; l++) if (this.key[l] === NO_DECOR_LIGHT) free = l;
			if (free < 0) return;
			this.key[free] = k;
			this.level[free] = 0;
			this.target[free] = true;
			this.changes++;
		}
	}
}

/**
 * Flicker noise in [-1, 1] of the light with seed `hash` (a decorHash) at time `t` seconds: the mean of sines at
 * DECOR_LIGHTS.flickerHz, each frequency and phase varied by a byte of the hash. Deterministic per light.
 */
export function decorFlicker(hash: number, t: number, hz: ReadonlyArray<number> = DECOR_LIGHTS.flickerHz): number {
	if (hz.size() === 0) return 0;
	let sum = 0;
	let h = hash;
	for (let i = 0; i < hz.size(); i++) {
		const byte = h % HASH_BYTE;
		h = math.floor(h / HASH_BYTE) + bit32.lshift(byte, HASH_SHIFT * 2);
		const f = hz[i] * (FREQ_BASE + (FREQ_SPREAD * byte) / HASH_BYTE);
		const phase = (TWO_PI * ((byte * 7) % HASH_BYTE)) / HASH_BYTE;
		sum += math.sin(TWO_PI * f * t + phase);
	}
	return sum / hz.size();
}

/** A light's brightness factor from its flicker: 1 + amplitude x motion x noise (never below 0). */
export function decorFlickerScale(
	hash: number,
	t: number,
	motion: number,
	amplitude: number = DECOR_LIGHTS.flickerAmplitude,
): number {
	return math.max(0, 1 + amplitude * math.clamp(motion, 0, 1) * decorFlicker(hash, t));
}

/**
 * The Silver crate burst, the pure rules (docs/SILVER.md SC3, "Silver in crates": "silver coins hop once and fly to the
 * Silver counter; `+6` rises from the piece; a coin clink climbing a step for quick successive breaks. Reduced motion:
 * the pop and the counter only."). SilverCrateFx turns a frame's Silver breaks (SilverFrameSource, collected per tick)
 * into what a client controller draws and plays, once per rendered frame after the ticks:
 *
 *   gained   the Silver the frame's breaks paid, ALL of them (near or far, co-op included: crate Silver is the team's,
 *            SVD6), so the counter always ticks by the truth; never capped.
 *   pops     one `+N` pop per break at the piece's cell centre, at most maxPopsPerFrame new ones a frame (the Silver of
 *            breaks past the cap joins the frame's last pop, so the pops still add up to `gained`); silverPopLook(age)
 *            gives its rise and fade. Shown under reduced motion too.
 *   coins    per break silverCoinCount(amount) coins, each hopping once to a landing spot near the piece (silverCoinHop)
 *            and then flying to the counter, staggered; at most maxCoinsPerFrame new coins a frame over every break.
 *            None under reduced motion (motion 0).
 *   clink    one clink a frame at most (the cue `sfx.silver.crate`): its step climbs by one for each break within
 *            chainWindowSeconds of the last (real time), capped at maxStep, back to 0 after a longer gap; the clink plays
 *            the frame's last step. Its speed is semitonesToSpeed(step x semitonesPerStep).
 *
 * The coins' landing spots come from a render rng seeded per break (shared/view/fx burstSeed on slot and tick, salt
 * coinSalt), never the sim's: the same break always throws the same coins. A new run (`reset`) forgets the chain. No
 * allocation in steady state but the frame's own lists. Presentation only; no client controller, theme ids or sounds
 * here (docs/SILVER.md SV7 / SV8 wire them: the cue `sfx.silver.crate`, an optional `fx.silver.coins` sprite).
 */
import { STUDS_PER_TILE } from "shared/config";
import { RenderRng, burstSeed } from "../fx/rng";
import { semitonesToSpeed } from "../hud/comboConfig";
import { SILVER_CRATE_FX } from "./config";
import type { SilverFrameSource } from "./events";

/** A `+N` pop that starts this frame. */
export interface SilverPopView {
	/** The broken piece's cell centre (world floor units). */
	readonly x: number;
	readonly z: number;
	/** The Silver it shows (`+amount`). */
	readonly amount: number;
}

/** A coin that starts this frame: its hop from the cell centre to the landing spot, then its flight to the counter. */
export interface SilverCoinView {
	/** The broken piece's cell centre (world floor units): where the hop starts. */
	readonly x: number;
	readonly z: number;
	/** Where it lands after the hop (world floor units). */
	readonly landX: number;
	readonly landZ: number;
	/** Seconds after the hop it starts flying (the stagger: index x flyStaggerSeconds). */
	readonly flyDelaySec: number;
}

/** The frame's clink. */
export interface SilverClinkView {
	/** 0 for a lone break, + 1 for each quick successive one, capped at maxStep. */
	readonly step: number;
	/** The PlaybackSpeed for the cue (semitonesToSpeed(step x semitonesPerStep)). */
	readonly speed: number;
}

/** What SilverCrateFx.frame fills (reused: valid until the next frame call). */
export interface SilverCrateFxFrame {
	readonly gained: number;
	readonly pops: ReadonlyArray<SilverPopView>;
	readonly coins: ReadonlyArray<SilverCoinView>;
	readonly clink: SilverClinkView | undefined;
}

/** The coins a break of `amount` Silver throws: ceil(amount / silverPerCoin), within [minCoins, maxCoins]. */
export function silverCoinCount(amount: number): number {
	const v = SILVER_CRATE_FX;
	if (!(amount > 0)) return 0;
	return math.clamp(math.ceil(amount / v.silverPerCoin), v.minCoins, v.maxCoins);
}

/** The clink's semitones at `step` (step x semitonesPerStep, the step clamped to [0, maxStep]). */
export function silverClinkSemitones(step: number): number {
	const v = SILVER_CRATE_FX;
	return math.clamp(math.floor(step), 0, v.maxStep) * v.semitonesPerStep;
}

/** The clink's PlaybackSpeed at `step`. */
export function silverClinkSpeed(step: number): number {
	return semitonesToSpeed(silverClinkSemitones(step));
}

/** A pop's look `ageSec` after it started: studs above its start, its text transparency (1 = gone). */
export interface SilverPopLook {
	readonly riseStuds: number;
	readonly transparency: number;
	/** False once its life is over (the controller frees it). */
	readonly alive: boolean;
}

/**
 * A pop's look at `ageSec`: it starts popStartTiles over the cell centre and rises popRiseTiles along an ease-out over
 * popSeconds, opaque until the last popFadeShare of its life, then fading to 1. Past its life (or a negative age): not
 * alive. The same under reduced motion (the pop is the reduced burst).
 */
export function silverPopLook(ageSec: number, studsPerTile: number = STUDS_PER_TILE): SilverPopLook {
	const v = SILVER_CRATE_FX;
	if (!(ageSec >= 0) || !(ageSec < v.popSeconds)) return { riseStuds: 0, transparency: 1, alive: false };
	const t = ageSec / v.popSeconds;
	const ease = 1 - (1 - t) * (1 - t);
	const fadeFrom = 1 - v.popFadeShare;
	const transparency = t <= fadeFrom ? 0 : math.min(1, (t - fadeFrom) / v.popFadeShare);
	return { riseStuds: (v.popStartTiles + ease * v.popRiseTiles) * studsPerTile, transparency, alive: true };
}

/** A coin's hop at `ageSec`: share of the way to its landing spot (0..1) and its height over the floor (studs). */
export interface SilverCoinHop {
	readonly along: number;
	readonly heightStuds: number;
	/** True once the hop is over (the coin flies to the counter from its landing spot). */
	readonly landed: boolean;
}

/** The hop: linear along, a parabola of peak hopTiles over hopSeconds; landed (along 1, height 0) after it. */
export function silverCoinHop(ageSec: number, studsPerTile: number = STUDS_PER_TILE): SilverCoinHop {
	const v = SILVER_CRATE_FX;
	const t = math.clamp(ageSec / v.hopSeconds, 0, 1);
	if (!(t < 1)) return { along: 1, heightStuds: 0, landed: true };
	return { along: t, heightStuds: 4 * t * (1 - t) * v.hopTiles * studsPerTile, landed: false };
}

/**
 * The flight's share (0..1) of a coin `ageSec` after it started, with its `flyDelaySec`: 0 through the hop and its
 * delay, then an ease-in to 1 over flySeconds (1: it reached the counter; the controller frees it and may flash it).
 */
export function silverCoinFlight(ageSec: number, flyDelaySec: number): number {
	const v = SILVER_CRATE_FX;
	const t = (ageSec - v.hopSeconds - math.max(0, flyDelaySec)) / v.flySeconds;
	if (!(t > 0)) return 0;
	if (!(t < 1)) return 1;
	return t * t;
}

interface FrameSlot {
	gained: number;
	readonly pops: SilverPopView[];
	readonly coins: SilverCoinView[];
	clink: SilverClinkView | undefined;
}

/** The Silver crate burst's per-frame planner (see the file comment). One per client. */
export class SilverCrateFx {
	readonly out: SilverCrateFxFrame;
	private readonly slot: FrameSlot;
	private readonly rng = new RenderRng();
	/** The chain's step and the real time of its last break (undefined: no chain yet). */
	private step = 0;
	private lastBreakSec: number | undefined;

	constructor() {
		this.slot = { gained: 0, pops: [], coins: [], clink: undefined };
		this.out = this.slot;
	}

	/** Forgets the chain (a new run). */
	reset(): void {
		this.step = 0;
		this.lastBreakSec = undefined;
		this.slot.gained = 0;
		this.slot.pops.clear();
		this.slot.coins.clear();
		this.slot.clink = undefined;
	}

	/**
	 * One rendered frame, after its ticks: `source` is the frame's collected breaks, `nowSec` real time (seconds, any
	 * clock that only grows), `motion` the motion scale (0: reduced motion: no coins). Returns `out`.
	 */
	frame(source: SilverFrameSource, nowSec: number, motion: number): SilverCrateFxFrame {
		const v = SILVER_CRATE_FX;
		const out = this.slot;
		out.gained = 0;
		out.pops.clear();
		out.coins.clear();
		out.clink = undefined;
		const breaks = source.breaks;
		if (breaks.size() === 0) return out;
		const coinsOn = motion > 0;
		for (const b of breaks) {
			out.gained += b.amount;
			// The clink's chain: every break in the frame counts (breaks of one frame are within the window of each other).
			const last = this.lastBreakSec;
			if (last === undefined || !(nowSec - last <= v.chainWindowSeconds)) this.step = 0;
			else this.step = math.min(v.maxStep, this.step + 1);
			this.lastBreakSec = nowSec;
			// The pop: a new one while under the cap, else its Silver joins the frame's last pop.
			if (out.pops.size() < v.maxPopsPerFrame) out.pops.push({ x: b.x, z: b.z, amount: b.amount });
			else {
				const i = out.pops.size() - 1;
				const p = out.pops[i];
				out.pops[i] = { x: p.x, z: p.z, amount: p.amount + b.amount };
			}
			if (!coinsOn) continue;
			const n = math.min(silverCoinCount(b.amount), v.maxCoinsPerFrame - out.coins.size());
			if (n <= 0) continue;
			this.rng.seed(burstSeed(b.slot, b.tick, v.coinSalt));
			for (let k = 0; k < n; k++) {
				// A landing spot in the square of half side spreadTiles round the cell centre (no trig).
				const dx = this.rng.range(-v.spreadTiles, v.spreadTiles);
				const dz = this.rng.range(-v.spreadTiles, v.spreadTiles);
				out.coins.push({
					x: b.x,
					z: b.z,
					landX: b.x + dx,
					landZ: b.z + dz,
					flyDelaySec: k * v.flyStaggerSeconds,
				});
			}
		}
		if (v.maxClinksPerFrame > 0) out.clink = { step: this.step, speed: silverClinkSpeed(this.step) };
		return out;
	}
}

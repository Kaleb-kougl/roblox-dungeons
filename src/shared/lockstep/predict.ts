/**
 * Local prediction (docs/LOCAL_PREDICTION.md Design 2 / 6 / 7, LP3), pure: the client's own player's body replayed past
 * the merged state from the inputs the sim has not stepped yet, so it can be drawn where the sim will have it.
 *
 *   rebuild(src)   a fresh prediction from the merged state (`src.state`, never written): the local player's body,
 *                  weapons and boost timers copied into scratch (predictMotion.ts copyMotionBase), then one
 *                  predictMotionTick per tick from state.tick: the server's finalized frame while one is queued (truth,
 *                  misses included), then the frame this client sent, a tick it never sent repeating the previous one
 *                  (as the relay repeats the player's last finalized input; the first such tick repeats the last
 *                  stepped frame's), up to the last tick sent and at most `maxTicks` ticks (LPD4). Nothing is
 *                  predicted (undefined) while the local player is dead or left or any draft is open (the sim freezes
 *                  everyone). The head is the pose after the last replayed tick; its prevX / prevZ the pose a tick before
 *                  (the views' lerp with the client's alpha).
 *   observe(state) after every stepped tick: the merged pose at that tick against the head last predicted for it (the
 *                  pose drawn for that tick: the error statistics; a floor change or a dead player is not compared).
 *
 * The world and the traits come from the run config like the sim's (simWorldConfig, playerTraits); the mirror reads the
 * merged state only. Corrections (a hit, a pickup, a piece broken, the boss's seal, a floor change, a miss) are the
 * next rebuild's business: the view smooths them (shared/view/predict). No allocation per rebuild.
 */
import {
	isDraftOpen,
	playerAt,
	playerTraits,
	simWorldConfig,
	type InputFrame,
	type PlayerState,
	type SimConfig,
	type SimState,
} from "shared/sim";
import type { PredictionTunables } from "./config";
import { copyMotionBase, newMotionScratch, predictMotionTick } from "./predictMotion";

/** What the predictor reads from its client (LockstepClient implements it; specs fake it). */
export interface PredictionSource {
	readonly state: Readonly<SimState>;
	/** The run's SimConfig (the floor's world and the players' traits come from it). */
	readonly config: Readonly<SimConfig>;
	readonly localIndex: number;
	/** Received merged frames not stepped yet. */
	backlog(): number;
	/** The queued merged frame `k` ticks after the next tick to step (0 <= k < backlog()). */
	queuedFrame(k: number): ReadonlyArray<Readonly<InputFrame>> | undefined;
	/** The own input sent for `tick` while that tick is not stepped yet (undefined: never sent). */
	sentInput(tick: number): Readonly<InputFrame> | undefined;
	/** The last tick an own input was sent for (-1 before the first send). */
	lastSentInputTick(): number;
	/** The own input in the last merged frame stepped (what the relay repeats for a tick never sent); undefined before. */
	lastSteppedInput(): Readonly<InputFrame> | undefined;
}

/** The predictor's numbers (KV_Debug's co-op line, docs/LOCAL_PREDICTION.md Design 7). */
export interface PredictionStats {
	/** Ticks the last rebuild replayed past the merged state (0: nothing to replay or not predicting). */
	readonly horizonTicks: number;
	/** Stepped ticks compared in the window (statsWindowTicks). */
	readonly compared: number;
	/** Mean and largest distance (tiles) between a stepped tick's merged pose and the head drawn for it, over the window. */
	readonly meanError: number;
	readonly maxError: number;
	/** Compared ticks whose error was over correctionTiles, in the window. */
	readonly corrections: number;
	/** Every compared tick and correction since the run started, and the largest error. */
	readonly totalCompared: number;
	readonly totalCorrections: number;
	readonly totalMaxError: number;
}

export class LocalPredictor {
	private readonly head = newMotionScratch();
	private active = false;
	private horizon = 0;
	/** The head last predicted per state tick (the state.tick after its last replayed tick), a ring of maxTicks + 2. */
	private readonly ringTick: number[] = [];
	private readonly ringX: number[] = [];
	private readonly ringZ: number[] = [];
	/** The errors of the last statsWindowTicks compared ticks (a ring). */
	private readonly errors: number[] = [];
	private errorAt = 0;
	private totalCompared = 0;
	private totalCorrections = 0;
	private totalMax = 0;

	constructor(private readonly tunables: PredictionTunables) {
		const n = tunables.maxTicks + 2;
		for (let k = 0; k < n; k++) {
			this.ringTick.push(-1);
			this.ringX.push(0);
			this.ringZ.push(0);
		}
	}

	/** The predicted head (the body after the last replayed tick); undefined while not predicting. Read only. */
	predicted(): Readonly<PlayerState> | undefined {
		return this.active ? this.head.player : undefined;
	}

	/** Ticks the last rebuild replayed (0 while not predicting). */
	horizonTicks(): number {
		return this.active ? this.horizon : 0;
	}

	/** Stops predicting until the next rebuild (the run is over on this client). */
	stop(): void {
		this.active = false;
		this.horizon = 0;
	}

	/** A fresh prediction from `src`'s merged state (see the file comment). */
	rebuild(src: PredictionSource): void {
		const state = src.state;
		const i = src.localIndex;
		const p = playerAt(state, i);
		if (p.dead !== 0 || isDraftOpen(state)) {
			this.stop();
			return;
		}
		const head = this.head;
		copyMotionBase(head, state, i);
		const base = state.tick;
		const last = src.lastSentInputTick();
		const span = last - base + 1;
		const h = span < 0 ? 0 : span > this.tunables.maxTicks ? this.tunables.maxTicks : span;
		const world = simWorldConfig(state, src.config);
		const traits = playerTraits(src.config, i);
		const queued = src.backlog();
		let input = src.lastSteppedInput();
		for (let k = 0; k < h; k++) {
			const tick = base + k;
			if (k < queued) {
				const frame = src.queuedFrame(k);
				if (frame !== undefined) input = frame[i];
			} else {
				const sent = src.sentInput(tick);
				if (sent !== undefined) input = sent;
			}
			// Nothing to repeat yet (before the first stepped frame): stop the replay here.
			if (input === undefined) {
				this.horizon = k;
				this.active = true;
				return;
			}
			predictMotionTick(head, state, input, world, i, traits);
		}
		this.horizon = h;
		this.active = true;
		// The head drawn for tick base + h: compared with the merged pose once that tick is stepped (observe).
		if (h > 0) {
			const slot = (base + h) % this.ringTick.size();
			this.ringTick[slot] = base + h;
			this.ringX[slot] = head.player.x;
			this.ringZ[slot] = head.player.z;
		}
	}

	/**
	 * After a stepped tick (state.tick is the tick after it): the merged pose against the head last predicted for it.
	 * Not compared: a floor change, a dead local player, a tick never a head.
	 */
	observe(state: Readonly<SimState>, localIndex: number): void {
		const slot = state.tick % this.ringTick.size();
		if (this.ringTick[slot] !== state.tick) return;
		this.ringTick[slot] = -1;
		const p = playerAt(state, localIndex);
		if (p.dead !== 0 || state.events.floorChanged !== 0) return;
		const dx = p.x - this.ringX[slot];
		const dz = p.z - this.ringZ[slot];
		const e = math.sqrt(dx * dx + dz * dz);
		const window = this.tunables.statsWindowTicks;
		if (this.errors.size() < window) this.errors.push(e);
		else this.errors[this.errorAt] = e;
		this.errorAt = (this.errorAt + 1) % window;
		this.totalCompared++;
		if (e > this.tunables.correctionTiles) this.totalCorrections++;
		if (e > this.totalMax) this.totalMax = e;
	}

	/** The numbers (see PredictionStats). */
	stats(): PredictionStats {
		let sum = 0;
		let max = 0;
		let corrections = 0;
		for (const e of this.errors) {
			sum += e;
			if (e > max) max = e;
			if (e > this.tunables.correctionTiles) corrections++;
		}
		const n = this.errors.size();
		return {
			horizonTicks: this.horizonTicks(),
			compared: n,
			meanError: n > 0 ? sum / n : 0,
			maxError: max,
			corrections,
			totalCompared: this.totalCompared,
			totalCorrections: this.totalCorrections,
			totalMaxError: this.totalMax,
		};
	}
}

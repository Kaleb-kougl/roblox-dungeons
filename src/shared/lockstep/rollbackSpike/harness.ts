/**
 * The rollback spike's offline harness (docs/ROLLBACK_SPIKE.md Design 2-4, task R2; spec support): replays a recorded
 * party run tick by tick as player i's client would see it on a fixed network (L, D), with a RollbackModel drawing
 * every frame, and returns its metrics. Roblox-API-free (os.clock only, for the runtime).
 *
 * The client modelled: 60 Hz paced play, one tick and one frame at a time. Before frame T (the confirmed state at T)
 * the merged frames of T .. T + D - 1 are in the playout buffer and player i's own frames of T + D .. T + D + L - 1 are
 * sent; the frame draws, then tick T is confirmed (stepped with its merged frame). Frames are taken from the recording
 * (the merged log: the truth); a recording ends D + L ticks before the last frame drawn needs.
 */
import {
	createSimState,
	partyFrameAt,
	recordingPartySize,
	stepRecorded,
	type InputFrame,
	type Recording,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { ROLLBACK_LIVE_METRICS, type RollbackGuessStrategy, type RollbackLiveMetric } from "shared/spikes";
import type { RollbackMetrics } from "./metrics";
import { RollbackModel, type RollbackCopy, type RollbackModelTimes } from "./model";

export interface ModelRunOptions {
	/** The observing player. */
	readonly playerIndex: number;
	/** The guessed span (net lead) and the playout depth, ticks (fixed for the pass). */
	readonly L: number;
	readonly D: number;
	/** Default repeatLast. */
	readonly strategy?: RollbackGuessStrategy;
	/** The horizon cap (default ROLLBACK_SPIKE.model.horizonCap). */
	readonly H?: number;
	/** The state copy (default cloneSimState). */
	readonly copy?: RollbackCopy;
	/** Feed the teammates' true future inputs as the guess (the perfect-guess sanity rule). */
	readonly perfect?: boolean;
	/** Frames are drawn for confirmed ticks [fromTick, toTick) (default the whole recording, less D + L at its end). */
	readonly fromTick?: number;
	readonly toTick?: number;
	/** Measure the cheap plan too (default true). */
	readonly cheapPlan?: boolean;
}

export interface ModelRunResult {
	readonly metrics: RollbackMetrics;
	/** Every metric per minute of play (all room types). */
	readonly perMinute: ReadonlyMap<RollbackLiveMetric, number>;
	/** Play seconds (draft ticks excluded) and frames drawn. */
	readonly seconds: number;
	readonly frames: number;
	/** The window's wall time (the model and the confirmed steps), and the steps up to its start, seconds. */
	readonly runtimeSec: number;
	readonly warmSec: number;
	readonly times: RollbackModelTimes;
	/** The confirmed state after the window. */
	readonly state: SimState;
}

/** Player k's frame of tick t in a recording. */
export function recordedFrame(recording: Readonly<Recording>, k: number, t: number): Readonly<InputFrame> {
	return k === 0 ? recording.frames[t] : recording.others![k - 1][t];
}

/** The first tick (state.tick) at which `test` holds while the recording replays, or undefined. */
export function firstTickWhere(
	config: Readonly<SimConfig>,
	recording: Readonly<Recording>,
	test: (state: Readonly<SimState>) => boolean,
	fromTick = 0,
): number | undefined {
	const state = createSimState(recording.seed, recording.spawn.x, recording.spawn.z, config);
	const total = recording.frames.size();
	while (state.tick < total) {
		if (state.tick >= fromTick && test(state)) return state.tick;
		stepRecorded(state, recording, state.tick, config);
	}
	return undefined;
}

/** Replays `recording` (built with `config`) through a RollbackModel for one player (see the file comment). */
export function runModelOverRecording(
	config: Readonly<SimConfig>,
	recording: Readonly<Recording>,
	options: ModelRunOptions,
): ModelRunResult {
	const n = recordingPartySize(recording);
	const i = options.playerIndex;
	if (i < 0 || i >= n) error(`runModelOverRecording: player ${i} of a party of ${n}`, 0);
	const L = math.max(0, options.L);
	const D = math.max(0, options.D);
	const total = recording.frames.size();
	const from = math.max(0, options.fromTick ?? 0);
	const last = math.min(options.toTick ?? total, total - D - L);
	const w0 = os.clock();
	const state = createSimState(recording.seed, recording.spawn.x, recording.spawn.z, config);
	while (state.tick < from && state.tick < total) stepRecorded(state, recording, state.tick, config);
	const w1 = os.clock();
	const model = new RollbackModel({
		playerIndex: i,
		config,
		strategy: options.strategy,
		horizonCap: options.H,
		copy: options.copy,
		cheapPlan: options.cheapPlan,
		oracle:
			options.perfect === true ? (t, k) => (t < total ? recordedFrame(recording, k, t) : undefined) : undefined,
	});
	model.reset(state);
	const merged: Array<Readonly<InputFrame>> = [];
	let truthPut = state.tick;
	let ownPut = state.tick;
	for (let T = state.tick; T < last; T++) {
		while (truthPut < T + D) {
			model.putTruth(truthPut, partyFrameAt(recording, truthPut, merged));
			truthPut++;
		}
		if (ownPut < truthPut) ownPut = truthPut;
		while (ownPut < T + D + L) {
			model.putOwn(ownPut, recordedFrame(recording, i, ownPut));
			ownPut++;
		}
		model.predict(state);
		if (truthPut <= T) {
			model.putTruth(T, partyFrameAt(recording, T, merged));
			truthPut = T + 1;
		}
		stepRecorded(state, recording, T, config);
		model.confirm(state);
	}
	const w2 = os.clock();
	const perMinute = new Map<RollbackLiveMetric, number>();
	for (const metric of ROLLBACK_LIVE_METRICS) perMinute.set(metric, model.metrics.perMinute(metric));
	return {
		metrics: model.metrics,
		perMinute,
		seconds: model.metrics.totalSeconds(),
		frames: model.metrics.frames,
		runtimeSec: w2 - w1,
		warmSec: w1 - w0,
		times: model.times,
		state,
	};
}

/**
 * The rollback spike's prediction model (docs/ROLLBACK_SPIKE.md Design 2-3, task R2): what ONE client (player index
 * i) would draw if it rolled back, measured against what the server's frames then confirm. Incremental and
 * Roblox-API-free: the harness feeds it a recording tick by tick (harness.ts), and the client's Parallel Luau worker
 * (R4b) feeds it the real LockstepClient's frames. It never writes the caller's state (it steps a copy).
 *
 * ## Per client frame (the caller's loop)
 *
 *   reset(state)             (re)start on a confirmed state: a run start, or the harness's window start
 *   putTruth(tick, frames)   a merged frame (everyone, index order) as soon as it is known: stepped, or waiting in the
 *                            playout buffer (ticks T .. T + D - 1 for a confirmed state at T); in tick order
 *   putOwn(tick, frame)      player i's own input for a tick past the merged ones (T + D .. T + D + L - 1: the
 *                            client's `sent` frames)
 *   predict(state)           once per rendered frame, with the confirmed state at T (`state.tick`): copies it (the
 *                            injected copy), steps the copy to the DRAWN tick K = T + min(D + L, H) (truth frames, then
 *                            i's own frames with the teammates' inputs guessed), records K's view digest (and, re-
 *                            predicted on the way, the previous frame's drawn tick: the corrections). Returns K.
 *                            Sliced, the same work is beginPredict(state) -> stepPredict(sliceTicks) until it returns
 *                            true (the worker yields between calls) -> finishPredict(); in flight, the caller must not
 *                            step `state` nor call confirm / reset (both refuse); putTruth / putOwn are fine (the
 *                            prediction froze its frame ends at the begin)
 *   confirm(state)           after the caller stepped its confirmed state one tick (with the frame it put): digests
 *                            the truth and compares every prediction of that tick (truth errors, the cheap plan) and,
 *                            `eventSlackTicks` later, its events
 *
 * D = (truth frames put) - T, L = (own frames put past them), both read at each begin; the caller decides them by what
 * it puts (the harness: fixed L and D; live: the real playout buffer and lead). The model never writes `state` (it
 * steps its copy; model.spec checks the hash). `metrics` (a RollbackMetrics) accumulates; `toLiveSummaryCounts()` /
 * `leadSeen()` are a LiveSummary's parts. `times` sums each prediction's copy / step / other seconds, `lastTimes()`
 * is the last one's (the probe's p50 / p95 samples).
 *
 * ## Guesses (Design 2)
 *
 * A teammate's input for a tick past the merged ones is guessed from their LAST KNOWN merged frame (strategy, RBD5:
 * `repeatLast`, GGPO's default, the baseline; `repeatLastAxesOnly`: move and aim kept, buttons released; `neutral`:
 * EMPTY_INPUT). A guess never invents a press: the sim takes presses as edges of `prevButtons`, so a held button
 * repeated stays held, and a released one stays released. `oracle` (a test hook, R4b's too) answers the true input
 * instead: the perfect-guess sanity rule.
 *
 * ## What is counted when (metrics.ts has the definitions)
 *
 * predict: corrections (enemies by id, teammates by index: living and on screen, within viewRadiusTiles of the
 * observer; bullets as phantoms: the previous frame's digest of its drawn tick against this frame's re-prediction of it,
 * BulletMatcher; a bullet only the new one shows counts when older than appearAgeTicks), in the room type of the
 * confirmed tick at the frame's begin.
 * confirm(C): truth errors of the drawn prediction for C (enemyErr*, distributions) and the cheap plan's bullets for C;
 * then the events of tick E = C - slack: a drawn event with no true one within E +- slack is undone (kill / death /
 * pickup / erase; a hit on player i: heartPhantom); a true event with no drawn one within E +- slack, drawn before E was
 * confirmed, is late (a hit on i with a drawn prediction for E: heartMissed). Each entity is counted once per
 * `dedupTicks`. Draft ticks (the world frozen) are not play: no seconds, nothing counted.
 *
 * ## The cheap plan (docs/LOCAL_PREDICTION.md, Design 3)
 *
 * The same frame's view without rollback: enemies and teammates at the confirmed state, your knight predicted (its
 * position taken from the drawn prediction: both plans predict it from your inputs), and the confirmed state's bullets
 * advanced ballistically to K (velocity += acceleration, position += velocity, life counts down; stopped by a wall
 * (the floor's bullet blocker) or an intact piece of the confirmed state, read-only). Enemy bullets step by SIM_DT (the
 * Hourglass slow is not modelled).
 */
import {
	EMPTY_INPUT,
	SIM_DT,
	breakableSlotAt,
	copyInput,
	partySize,
	simWorldConfig,
	stepParty,
	type BulletSimulation,
	type InputFrame,
	type SimConfig,
	type SimState,
	type Vec3,
} from "shared/sim";
import type { RollbackGuessStrategy } from "shared/spikes";
import { ROLLBACK_SPIKE } from "./config";
import { pooledCopyFn, type StateCopyFn } from "./pooledCopy";
import {
	BulletMatcher,
	BulletTracker,
	DigestEvent,
	PreSnap,
	RoomKind,
	ViewDigest,
	bulletKeyTag,
	fillDigest,
	roomTypeOf,
} from "./digest";
import { ErrorEntity, RollbackMetrics, metricIndex } from "./metrics";

const MODEL = ROLLBACK_SPIKE.model;

/**
 * The state copy a model uses: pooledCopy.ts's StateCopyFn. Default: a `pooledCopyFn()` of the model's own (R1b, one
 * scratch overwritten by every prediction: the model uses a copy only until its next beginPredict); R1's
 * `cloneSimState` (a fresh state each call, ~25x slower) also fits.
 */
export type RollbackCopy = StateCopyFn;

/** Test hook: the true input of `player` at `tick` (a perfect guess), or undefined (guess as the strategy says). */
export type RollbackGuessOracle = (tick: number, player: number) => Readonly<InputFrame> | undefined;

export interface RollbackModelOptions {
	/** The observing (predicting) player's index. */
	readonly playerIndex: number;
	/** The run's SimConfig (what the confirmed state is stepped with). */
	readonly config: Readonly<SimConfig>;
	/** Default repeatLast (RBD5). */
	readonly strategy?: RollbackGuessStrategy;
	/** H: the drawn tick is at most this many ticks past the confirmed one (default ROLLBACK_SPIKE.model.horizonCap). */
	readonly horizonCap?: number;
	/** The state copy (default: a new pooledCopyFn() per model). Never shared between two models in flight. */
	readonly copy?: RollbackCopy;
	readonly oracle?: RollbackGuessOracle;
	/** Also measure the cheap plan (default true). */
	readonly cheapPlan?: boolean;
}

/** Wall-clock costs of the model's own work (os.clock), seconds. */
export interface RollbackModelTimes {
	copy: number;
	step: number;
	/** Digests, comparisons, the cheap plan: everything but copy and step. */
	other: number;
}

/** Private pool fields the cheap plan reads (read-only; BulletSimulation exposes no acceleration). */
interface PoolInternals {
	readonly acc: ReadonlyArray<Readonly<Vec3>>;
}

const M_ENEMY_CORR = [
	metricIndex("enemyCorr010"),
	metricIndex("enemyCorr025"),
	metricIndex("enemyCorr050"),
	metricIndex("enemyCorr100"),
];
const M_MATE_CORR = [
	metricIndex("mateCorr010"),
	metricIndex("mateCorr025"),
	metricIndex("mateCorr050"),
	metricIndex("mateCorr100"),
];
const M_ENEMY_ERR = [metricIndex("enemyErr050"), metricIndex("enemyErr100")];
const M_UNDONE_KILL = metricIndex("undoneKill");
const M_UNDONE_DEATH = metricIndex("undoneDeath");
const M_UNDONE_PICKUP = metricIndex("undonePickup");
const M_UNDONE_ERASE = metricIndex("undoneErase");
const M_LATE = metricIndex("lateEvent");
const M_PHANTOM = metricIndex("phantomBullet");
const M_HEART_PHANTOM = metricIndex("heartPhantom");
const M_HEART_MISSED = metricIndex("heartMissed");
const M_CHEAP_PHANTOM = metricIndex("cheapPhantomBullet");
const M_CHEAP_LATE = metricIndex("cheapLateBullet");

/** 0..4 for the DigestEvent kinds. */
function kindSlot(kind: number): number {
	if (kind === DigestEvent.KILL) return 0;
	if (kind === DigestEvent.DEATH) return 1;
	if (kind === DigestEvent.PICKUP) return 2;
	if (kind === DigestEvent.ERASE) return 3;
	return 4;
}
const KIND_SLOTS = 5;

function undoneMetric(kind: number): number {
	if (kind === DigestEvent.KILL) return M_UNDONE_KILL;
	if (kind === DigestEvent.DEATH) return M_UNDONE_DEATH;
	if (kind === DigestEvent.PICKUP) return M_UNDONE_PICKUP;
	return M_UNDONE_ERASE;
}

/** Entity -> tick it was last counted: counts an entity once per dedupTicks. */
class Once {
	private readonly seen = new Map<number, number>();

	/** True (and remembered) when `entity` was not counted within dedupTicks before `tick`. */
	take(entity: number, tick: number): boolean {
		const last = this.seen.get(entity);
		if (last !== undefined && tick - last < MODEL.dedupTicks) return false;
		this.seen.set(entity, tick);
		return true;
	}

	prune(tick: number): void {
		const old: number[] = [];
		this.seen.forEach((t, e) => {
			if (tick - t >= MODEL.dedupTicks) old.push(e);
		});
		for (const e of old) this.seen.delete(e);
	}

	clear(): void {
		this.seen.clear();
	}
}

/** Input frames by tick (a ring), `width` players per tick, copied in (the caller's frames are never kept). */
class FrameRing {
	private readonly ticks: number[];
	private readonly frames: InputFrame[][];

	constructor(private readonly size: number, readonly width: number) {
		this.ticks = table.create(size, -1);
		this.frames = [];
		for (let s = 0; s < size; s++) {
			const row: InputFrame[] = [];
			for (let k = 0; k < width; k++) row.push(copyInput(EMPTY_INPUT));
			this.frames.push(row);
		}
	}

	put(tick: number, k: number, f: Readonly<InputFrame>): void {
		const s = tick % this.size;
		this.ticks[s] = tick;
		const out = this.frames[s][k];
		out.moveX = f.moveX;
		out.moveZ = f.moveZ;
		out.aimX = f.aimX;
		out.aimZ = f.aimZ;
		out.buttons = f.buttons;
	}

	/** Player k's frame at `tick`, or undefined (never put, or overwritten). */
	get(tick: number, k: number): Readonly<InputFrame> | undefined {
		if (tick < 0) return undefined;
		const s = tick % this.size;
		return this.ticks[s] === tick ? this.frames[s][k] : undefined;
	}

	clear(): void {
		for (let s = 0; s < this.size; s++) this.ticks[s] = -1;
	}
}

/** Distance between (ax, az) and (bx, bz). */
function dist(ax: number, az: number, bx: number, bz: number): number {
	const dx = ax - bx;
	const dz = az - bz;
	return math.sqrt(dx * dx + dz * dz);
}

/** (x, z) is on the observer's screen in digest `d` (within viewRadiusTiles of its observer). */
function inView(d: ViewDigest, x: number, z: number): boolean {
	const r = MODEL.viewRadiusTiles;
	const dx = x - d.observerX;
	const dz = z - d.observerZ;
	return dx * dx + dz * dz <= r * r;
}

/** One observing player's rollback model (see the file comment). */
export class RollbackModel {
	readonly metrics = new RollbackMetrics();
	readonly times: RollbackModelTimes = { copy: 0, step: 0, other: 0 };
	readonly playerIndex: number;
	readonly strategy: RollbackGuessStrategy;
	readonly horizonCap: number;
	private readonly config: Readonly<SimConfig>;
	private readonly copy: RollbackCopy;
	private readonly oracle: RollbackGuessOracle | undefined;
	private readonly cheapOn: boolean;

	private n = 0;
	private truth: FrameRing | undefined;
	private own: FrameRing;
	private truthEnd = 0;
	private ownEnd = 0;
	private confirmedTick = -1;
	private confirmedRoom: number = RoomKind.WALK;
	/** The floor config the next confirmed step uses (simWorldConfig before it). */
	private confirmedWorld: Readonly<SimConfig>;
	private tracker: BulletTracker | undefined;
	private predTracker: BulletTracker | undefined;
	private readonly preConfirmed = new PreSnap();
	private readonly prePred = new PreSnap();

	private readonly ringSize: number;
	private readonly predRing: ViewDigest[] = [];
	private readonly cheapRing: ViewDigest[] = [];
	private readonly truthSize: number;
	private readonly truthRing: ViewDigest[] = [];
	/** Room type per truth ring slot. */
	private readonly truthRoom: number[];
	private spare = new ViewDigest();
	private readonly redo = new ViewDigest();
	private readonly matcher = new BulletMatcher();
	private lastDrawn = -1;

	/** Per event kind (kindSlot): entities of different kinds share numbers (actor id 3, player 3). */
	private readonly undone: Once[] = [];
	private readonly late: Once[] = [];
	private readonly phantom = new Once();
	private readonly cheapPhantom = new Once();
	private readonly cheapLate = new Once();
	private lastHeartPhantom = -math.huge;
	private lastHeartMissed = -math.huge;

	private readonly inputs: Array<Readonly<InputFrame>> = [];
	private readonly guessed: InputFrame[] = [];

	// The prediction in flight (beginPredict .. finishPredict).
	private pending = false;
	private pT = 0;
	private pK = 0;
	/** The copy's tick (the next step goes from pAt to pAt + 1). */
	private pAt = 0;
	/** The frame ends frozen at the begin (inputAt reads these). */
	private pTruthEnd = 0;
	private pOwnEnd = 0;
	private pRedoTick = -1;
	private pOld: ViewDigest | undefined;
	private pRoom: number = RoomKind.WALK;
	private pState: SimState | undefined;
	private pCopy: SimState | undefined;
	/** The last prediction's own costs (copy / step / other, seconds); `times` sums them. */
	private readonly last: RollbackModelTimes = { copy: 0, step: 0, other: 0 };

	constructor(options: RollbackModelOptions) {
		this.playerIndex = options.playerIndex;
		this.config = options.config;
		this.strategy = options.strategy ?? "repeatLast";
		this.horizonCap = math.max(0, options.horizonCap ?? MODEL.horizonCap);
		this.copy = options.copy ?? pooledCopyFn();
		this.oracle = options.oracle;
		this.cheapOn = options.cheapPlan !== false;
		this.confirmedWorld = options.config;
		this.own = new FrameRing(MODEL.frameRingTicks, 1);
		const slack = MODEL.eventSlackTicks;
		this.ringSize = this.horizonCap + 2 * slack + 4;
		for (let s = 0; s < this.ringSize; s++) {
			this.predRing.push(new ViewDigest());
			this.cheapRing.push(new ViewDigest());
		}
		this.truthSize = 2 * slack + 2;
		for (let s = 0; s < this.truthSize; s++) this.truthRing.push(new ViewDigest());
		this.truthRoom = table.create(this.truthSize, RoomKind.WALK);
		for (let k = 0; k < KIND_SLOTS; k++) {
			this.undone.push(new Once());
			this.late.push(new Once());
		}
	}

	/** (Re)starts on the confirmed state `state` (the frames put so far are kept). */
	reset(state: SimState): void {
		if (this.pending) error("RollbackModel.reset: a prediction is in flight (finishPredict first)", 0);
		const n = partySize(state);
		if (this.truth === undefined || this.truth.width !== n) this.truth = new FrameRing(MODEL.frameRingTicks, n);
		this.n = n;
		while (this.inputs.size() < n) this.inputs.push(EMPTY_INPUT);
		while (this.inputs.size() > n) this.inputs.pop();
		while (this.guessed.size() < n) this.guessed.push(copyInput(EMPTY_INPUT));
		if (this.tracker === undefined) {
			this.tracker = BulletTracker.forState(state);
			this.predTracker = BulletTracker.forState(state);
		}
		this.tracker.init(state);
		this.preConfirmed.take(state);
		this.confirmedWorld = simWorldConfig(state, this.config);
		this.confirmedTick = state.tick;
		this.confirmedRoom = roomTypeOf(state, this.playerIndex);
		for (const d of this.predRing) d.invalidate();
		for (const d of this.cheapRing) d.invalidate();
		for (const d of this.truthRing) d.invalidate();
		const ts = state.tick % this.truthSize;
		fillDigest(this.truthRing[ts], state, undefined, this.tracker, this.playerIndex, state.tick);
		this.truthRoom[ts] = this.confirmedRoom;
		this.lastDrawn = -1;
		for (let k = 0; k < KIND_SLOTS; k++) {
			this.undone[k].clear();
			this.late[k].clear();
		}
		this.phantom.clear();
		this.cheapPhantom.clear();
		this.cheapLate.clear();
		this.lastHeartPhantom = -math.huge;
		this.lastHeartMissed = -math.huge;
		this.truthEnd = math.max(this.truthEnd, state.tick);
		this.ownEnd = math.max(this.ownEnd, this.truthEnd);
	}

	/** The merged frame (every player, index order) of `tick`. Call reset first (it sizes the party). */
	putTruth(tick: number, frames: ReadonlyArray<Readonly<InputFrame>>): void {
		const ring = this.truth;
		if (ring === undefined) error("RollbackModel.putTruth before reset", 0);
		for (let k = 0; k < this.n; k++) ring.put(tick, k, frames[k]);
		if (tick + 1 > this.truthEnd) this.truthEnd = tick + 1;
	}

	/** Player i's own input for `tick` (past the merged frames). */
	putOwn(tick: number, frame: Readonly<InputFrame>): void {
		this.own.put(tick, 0, frame);
		if (tick + 1 > this.ownEnd) this.ownEnd = tick + 1;
	}

	/** The last prediction's costs, seconds (zeros after a frame with nothing to predict). Overwritten per frame. */
	lastTimes(): Readonly<RollbackModelTimes> {
		return this.last;
	}

	/** The last drawn digest (a prediction of the drawn tick), or undefined. */
	drawn(): ViewDigest | undefined {
		if (this.lastDrawn < 0) return undefined;
		const d = this.predRing[this.lastDrawn % this.ringSize];
		return d.valid && d.tick === this.lastDrawn ? d : undefined;
	}

	// ---- inputs ----------------------------------------------------------------------------------

	/** The input of player k at tick t of a prediction (the file comment's rules). */
	private inputAt(t: number, k: number): Readonly<InputFrame> {
		const truth = this.truth!;
		if (t < this.pTruthEnd) return truth.get(t, k) ?? EMPTY_INPUT;
		if (k === this.playerIndex) return this.own.get(t, 0) ?? this.lastKnown(k);
		const o = this.oracle?.(t, k);
		if (o !== undefined) return o;
		if (this.strategy === "neutral") return EMPTY_INPUT;
		const last = this.lastKnown(k);
		if (this.strategy === "repeatLast") return last;
		const g = this.guessed[k];
		g.moveX = last.moveX;
		g.moveZ = last.moveZ;
		g.aimX = last.aimX;
		g.aimZ = last.aimZ;
		g.buttons = 0;
		return g;
	}

	/** Player k's last merged frame known when the prediction began (the newest one put), else EMPTY_INPUT. */
	private lastKnown(k: number): Readonly<InputFrame> {
		return this.truth!.get(this.pTruthEnd - 1, k) ?? EMPTY_INPUT;
	}

	// ---- per frame -------------------------------------------------------------------------------

	/** True between beginPredict and finishPredict (a sliced prediction in flight). */
	isPredicting(): boolean {
		return this.pending;
	}

	/**
	 * One client frame on the confirmed state `state` (see the file comment), all at once: beginPredict, stepPredict
	 * until done, finishPredict. Returns the drawn tick (T when there was nothing to predict).
	 */
	predict(state: SimState): number {
		const K = this.beginPredict(state);
		if (!this.pending) return K;
		while (!this.stepPredict()) {
			// stepPredict() with no limit steps to the drawn tick in one call; the loop is only a guard.
		}
		return this.finishPredict();
	}

	/**
	 * Starts one frame's prediction on the confirmed state `state` (at T = state.tick): copies it with the injected copy
	 * and freezes the frame ends known now (D and L of this frame; frames put later do not change it). Returns the drawn
	 * tick K = T + min(D + L, H); when that is T (nothing guessed or buffered) nothing is pending and no prediction is
	 * recorded. Until finishPredict: `state` must not be stepped or changed (the cheap plan reads it at the finish) and
	 * confirm / reset are refused; putTruth / putOwn are fine.
	 */
	beginPredict(state: SimState): number {
		if (this.pending) error("RollbackModel.beginPredict: a prediction is in flight (finishPredict first)", 0);
		const tStart = os.clock();
		const m = this.metrics;
		const T = state.tick;
		const d = math.max(0, this.truthEnd - T);
		const l = math.max(0, this.ownEnd - math.max(this.truthEnd, T));
		m.frames++;
		m.sampleLead(l, d);
		const span = math.min(d + l, this.horizonCap);
		const last = this.last;
		last.copy = 0;
		last.step = 0;
		last.other = 0;
		if (span <= 0 || this.tracker === undefined) {
			this.lastDrawn = -1;
			return T;
		}
		const K = T + span;
		const kp = this.lastDrawn;
		const oldDrawn = kp > T && kp <= K ? this.predRing[kp % this.ringSize] : undefined;
		this.pRedoTick = oldDrawn !== undefined && oldDrawn.valid && oldDrawn.tick === kp ? kp : -1;
		this.pOld = this.pRedoTick >= 0 ? oldDrawn : undefined;
		this.pT = T;
		this.pK = K;
		this.pAt = T;
		this.pTruthEnd = this.truthEnd;
		this.pOwnEnd = this.ownEnd;
		this.pRoom = this.confirmedRoom;
		this.pState = state;
		const c0 = os.clock();
		this.pCopy = this.copy(state);
		const c1 = os.clock();
		this.predTracker!.copyFrom(this.tracker);
		this.pending = true;
		last.copy = c1 - c0;
		last.other = os.clock() - tStart - last.copy;
		return K;
	}

	/**
	 * Steps the pending prediction at most `maxTicks` ticks (default: to the drawn tick; the worker passes
	 * ROLLBACK_SPIKE.sliceTicks and yields between calls). True when the copy reached the drawn tick (finishPredict
	 * next).
	 */
	stepPredict(maxTicks = math.huge): boolean {
		if (!this.pending) error("RollbackModel.stepPredict: no prediction in flight", 0);
		const tStart = os.clock();
		const copy = this.pCopy!;
		const tracker = this.predTracker!;
		const inputs = this.inputs;
		const K = this.pK;
		const redoTick = this.pRedoTick;
		const stop = math.min(K, this.pAt + math.max(1, maxTicks));
		let stepSec = 0;
		while (this.pAt < stop) {
			const t = this.pAt;
			for (let k = 0; k < this.n; k++) inputs[k] = this.inputAt(t, k);
			const want = t + 1 === redoTick || t + 1 === K;
			if (want) this.prePred.take(copy);
			const world = simWorldConfig(copy, this.config);
			const s0 = os.clock();
			stepParty(copy, inputs, this.config);
			stepSec += os.clock() - s0;
			tracker.observe(copy, world);
			if (t + 1 === K) fillDigest(this.spare, copy, this.prePred, tracker, this.playerIndex, this.pT);
			else if (t + 1 === redoTick) fillDigest(this.redo, copy, this.prePred, tracker, this.playerIndex, this.pT);
			this.pAt = t + 1;
		}
		this.last.step += stepSec;
		this.last.other += os.clock() - tStart - stepSec;
		return this.pAt >= K;
	}

	/** Ends the pending prediction (stepped to its drawn tick): records its digest and its corrections. Returns K. */
	finishPredict(): number {
		if (!this.pending) error("RollbackModel.finishPredict: no prediction in flight", 0);
		if (this.pAt < this.pK) error("RollbackModel.finishPredict: the prediction has not reached its drawn tick", 0);
		const tStart = os.clock();
		const m = this.metrics;
		const T = this.pT;
		const K = this.pK;
		const fresh = this.spare;
		m.predictions++;
		m.predictedTicks += K - T;
		m.bulletOverflow += fresh.bulletOverflow;
		m.eventOverflow += fresh.eventOverflow;
		for (let k = 0; k < fresh.eventCount; k++) m.drawnEvents[kindSlot(fresh.eventKind[k])] += 1;
		const old = this.pOld;
		if (old !== undefined) this.corrections(old, this.pRedoTick === K ? fresh : this.redo, K, this.pRoom);
		// The new drawn digest takes its ring slot; the old object becomes the spare.
		const slot = K % this.ringSize;
		this.spare = this.predRing[slot];
		this.predRing[slot] = fresh;
		if (this.cheapOn) this.cheapView(this.cheapRing[slot], this.pState!, K, fresh);
		this.lastDrawn = K;
		this.pending = false;
		this.pOld = undefined;
		this.pState = undefined;
		this.pCopy = undefined;
		const last = this.last;
		last.other += os.clock() - tStart;
		this.times.copy += last.copy;
		this.times.step += last.step;
		this.times.other += last.other;
		return K;
	}

	/** Consecutive frames' predictions of the same tick: corrections and phantom bullets. */
	private corrections(old: ViewDigest, now: ViewDigest, drawnTick: number, room: number): void {
		const m = this.metrics;
		const cuts = MODEL.correctionTiles;
		for (let j = 0; j < now.actorCount; j++) {
			if (!now.actorAlive[j] || !inView(now, now.actorX[j], now.actorZ[j])) continue;
			const k = old.actorIndexOf(now.actorId[j], j);
			if (k < 0 || !old.actorAlive[k]) continue;
			const e = dist(now.actorX[j], now.actorZ[j], old.actorX[k], old.actorZ[k]);
			m.correction[ErrorEntity.ENEMY].add(e);
			for (let b = 0; b < cuts.size(); b++) if (e >= cuts[b]) m.count(room, M_ENEMY_CORR[b]);
		}
		const np = math.min(now.playerCount, old.playerCount);
		for (let k = 0; k < np; k++) {
			const e = dist(now.playerX[k], now.playerZ[k], old.playerX[k], old.playerZ[k]);
			if (k === this.playerIndex) {
				m.correction[ErrorEntity.SELF].add(e);
				continue;
			}
			if (now.dead[k] || old.dead[k] || !inView(now, now.playerX[k], now.playerZ[k])) continue;
			m.correction[ErrorEntity.MATE].add(e);
			for (let b = 0; b < cuts.size(); b++) if (e >= cuts[b]) m.count(room, M_MATE_CORR[b]);
		}
		const mt = this.matcher;
		mt.match(old, now);
		const tick = now.tick;
		for (let i = 0; i < old.bulletCount; i++) {
			const j = mt.ofA[i];
			if (j >= 0) {
				m.correction[ErrorEntity.BULLET].add(
					dist(old.bulletX[i], old.bulletZ[i], now.bulletX[j], now.bulletZ[j]),
				);
			} else if (old.bulletInner[i] && this.phantom.take(old.bulletKey[i], tick)) {
				m.count(room, M_PHANTOM);
			}
		}
		// A bullet only this frame shows is a phantom when it first appears already along its path: older than
		// appearAgeTicks at the drawn tick (by its tracker tag, the spike-side spawn tick). A younger one is a shot drawn
		// at its muzzle, a tick later than the last frame guessed.
		const appear = MODEL.appearAgeTicks;
		for (let j = 0; j < now.bulletCount; j++) {
			if (mt.takenB[j] || !now.bulletInner[j]) continue;
			if (drawnTick - bulletKeyTag(now.bulletKey[j]) <= appear) continue;
			if (this.phantom.take(now.bulletKey[j], tick)) m.count(room, M_PHANTOM);
		}
	}

	/** The cheap plan's view of tick K from the confirmed state (see the file comment). */
	private cheapView(out: ViewDigest, state: SimState, K: number, drawn: ViewDigest): void {
		const truth = this.truthRing[state.tick % this.truthSize];
		out.valid = true;
		out.tick = K;
		out.frameTick = state.tick;
		out.floor = truth.floor;
		out.draft = truth.draft;
		out.observerX = drawn.observerX;
		out.observerZ = drawn.observerZ;
		out.actorCount = truth.actorCount;
		for (let k = 0; k < truth.actorCount; k++) {
			out.actorId[k] = truth.actorId[k];
			out.actorKind[k] = truth.actorKind[k];
			out.actorAlive[k] = truth.actorAlive[k];
			out.actorX[k] = truth.actorX[k];
			out.actorZ[k] = truth.actorZ[k];
			out.actorHp[k] = truth.actorHp[k];
		}
		out.playerCount = truth.playerCount;
		for (let k = 0; k < truth.playerCount; k++) {
			const mine = k === this.playerIndex;
			out.playerX[k] = mine ? drawn.playerX[k] : truth.playerX[k];
			out.playerZ[k] = mine ? drawn.playerZ[k] : truth.playerZ[k];
			out.hearts[k] = truth.hearts[k];
			out.armor[k] = truth.armor[k];
			out.dead[k] = truth.dead[k];
		}
		out.eventCount = 0;
		out.eventOverflow = 0;
		out.eventIndex.clear();
		out.bulletCount = 0;
		out.bulletOverflow = 0;
		out.keyIndex.clear();
		const steps = K - state.tick;
		const tracker = this.tracker!;
		this.cheapPool(out, state, state.combat.enemyBullets, tracker.enemy, steps);
		this.cheapPool(out, state, state.combat.playerBullets, tracker.player, steps);
	}

	private cheapPool(
		out: ViewDigest,
		state: SimState,
		sim: BulletSimulation,
		t: BulletTracker["enemy"],
		steps: number,
	): void {
		const acc = (sim as unknown as PoolInternals).acc;
		const blocked = this.confirmedWorld.isBulletBlocked;
		const pieces = state.breakables !== undefined && state.breakables.intact > 0 ? state.breakables : undefined;
		const inner = MODEL.viewRadiusTiles;
		const outer = inner + MODEL.viewMarginTiles;
		const cap = out.bulletKey.size();
		for (let k = 0; k < t.count; k++) {
			const s = t.list[k];
			let x = t.x[s];
			let z = t.z[s];
			let vx = t.vx[s];
			let vz = t.vz[s];
			const a = acc[s];
			let life = t.life[s];
			let gone = false;
			for (let n = 0; n < steps; n++) {
				vx += a.x * SIM_DT;
				vz += a.z * SIM_DT;
				x += vx * SIM_DT;
				z += vz * SIM_DT;
				life -= SIM_DT;
				if (life <= 0 || (blocked !== undefined && blocked(x, z))) {
					gone = true;
					break;
				}
				if (pieces !== undefined && breakableSlotAt(pieces, x, z) >= 0) {
					gone = true;
					break;
				}
			}
			if (gone) continue;
			const dx = x - out.observerX;
			const dz = z - out.observerZ;
			const d2 = dx * dx + dz * dz;
			if (d2 > outer * outer) continue;
			if (out.bulletCount >= cap) {
				out.bulletOverflow++;
				continue;
			}
			const b = out.bulletCount;
			out.bulletKey[b] = t.key[s];
			out.bulletEmitter[b] = t.emitterKeyAt(s);
			out.bulletKind[b] = t.kindAt(s);
			out.bulletX[b] = x;
			out.bulletZ[b] = z;
			out.bulletInner[b] = d2 <= inner * inner;
			out.keyIndex.set(t.key[s], b);
			out.bulletCount++;
		}
	}

	// ---- per confirmed tick ----------------------------------------------------------------------

	/** After the caller stepped its confirmed state one tick (see the file comment). */
	confirm(state: SimState): void {
		const tStart = os.clock();
		const tracker = this.tracker;
		if (tracker === undefined) error("RollbackModel.confirm before reset", 0);
		if (this.pending) error("RollbackModel.confirm: a prediction is in flight (finishPredict first)", 0);
		const C = state.tick;
		const m = this.metrics;
		tracker.observe(state, this.confirmedWorld);
		const ts = C % this.truthSize;
		const truth = this.truthRing[ts];
		fillDigest(truth, state, this.preConfirmed, tracker, this.playerIndex, C);
		m.bulletOverflow += truth.bulletOverflow;
		m.eventOverflow += truth.eventOverflow;
		for (let k = 0; k < truth.eventCount; k++) m.truthEvents[kindSlot(truth.eventKind[k])] += 1;
		for (let b = 0; b < truth.bulletCount; b++) if (truth.bulletInner[b]) m.truthBullets++;
		m.truthTicks++;
		this.preConfirmed.take(state);
		this.confirmedWorld = simWorldConfig(state, this.config);
		const room = roomTypeOf(state, this.playerIndex);
		this.truthRoom[ts] = room;
		this.confirmedRoom = room;
		this.confirmedTick = C;
		m.addTick(room);

		const slot = C % this.ringSize;
		const pred = this.predRing[slot];
		if (pred.valid && pred.tick === C && pred.frameTick < C) this.truthErrors(pred, truth, room);
		const cheap = this.cheapRing[slot];
		if (this.cheapOn && cheap.valid && cheap.tick === C && cheap.frameTick < C)
			this.cheapErrors(cheap, truth, room);
		this.events(C - MODEL.eventSlackTicks);
		if (C % MODEL.dedupTicks === 0) {
			for (let k = 0; k < KIND_SLOTS; k++) {
				this.undone[k].prune(C);
				this.late[k].prune(C);
			}
			this.phantom.prune(C);
			this.cheapPhantom.prune(C);
			this.cheapLate.prune(C);
		}
		this.times.other += os.clock() - tStart;
	}

	private truthErrors(pred: ViewDigest, truth: ViewDigest, room: number): void {
		const m = this.metrics;
		const cuts = MODEL.truthErrorTiles;
		for (let j = 0; j < truth.actorCount; j++) {
			if (!truth.actorAlive[j] || !inView(truth, truth.actorX[j], truth.actorZ[j])) continue;
			const k = pred.actorIndexOf(truth.actorId[j], j);
			if (k < 0 || !pred.actorAlive[k]) continue;
			const e = dist(truth.actorX[j], truth.actorZ[j], pred.actorX[k], pred.actorZ[k]);
			m.truthError[ErrorEntity.ENEMY].add(e);
			for (let b = 0; b < cuts.size(); b++) if (e >= cuts[b]) m.count(room, M_ENEMY_ERR[b]);
		}
		const np = math.min(truth.playerCount, pred.playerCount);
		for (let k = 0; k < np; k++) {
			const mine = k === this.playerIndex;
			if (!mine && (truth.dead[k] || !inView(truth, truth.playerX[k], truth.playerZ[k]))) continue;
			const e = dist(truth.playerX[k], truth.playerZ[k], pred.playerX[k], pred.playerZ[k]);
			m.truthError[mine ? ErrorEntity.SELF : ErrorEntity.MATE].add(e);
		}
		const mt = this.matcher;
		mt.match(pred, truth);
		for (let i = 0; i < pred.bulletCount; i++) {
			const j = mt.ofA[i];
			if (j < 0) continue;
			m.truthError[ErrorEntity.BULLET].add(
				dist(pred.bulletX[i], pred.bulletZ[i], truth.bulletX[j], truth.bulletZ[j]),
			);
		}
	}

	private cheapErrors(cheap: ViewDigest, truth: ViewDigest, room: number): void {
		const m = this.metrics;
		for (let j = 0; j < truth.actorCount; j++) {
			if (!truth.actorAlive[j] || !inView(truth, truth.actorX[j], truth.actorZ[j])) continue;
			const k = cheap.actorIndexOf(truth.actorId[j], j);
			if (k < 0 || !cheap.actorAlive[k]) continue;
			m.cheapError[ErrorEntity.ENEMY].add(
				dist(truth.actorX[j], truth.actorZ[j], cheap.actorX[k], cheap.actorZ[k]),
			);
		}
		const np = math.min(truth.playerCount, cheap.playerCount);
		for (let k = 0; k < np; k++) {
			const mine = k === this.playerIndex;
			if (!mine && (truth.dead[k] || !inView(truth, truth.playerX[k], truth.playerZ[k]))) continue;
			const e = dist(truth.playerX[k], truth.playerZ[k], cheap.playerX[k], cheap.playerZ[k]);
			m.cheapError[mine ? ErrorEntity.SELF : ErrorEntity.MATE].add(e);
		}
		const mt = this.matcher;
		mt.match(cheap, truth);
		const tick = truth.tick;
		for (let i = 0; i < cheap.bulletCount; i++) {
			const j = mt.ofA[i];
			if (j >= 0) {
				m.cheapError[ErrorEntity.BULLET].add(
					dist(cheap.bulletX[i], cheap.bulletZ[i], truth.bulletX[j], truth.bulletZ[j]),
				);
			} else if (cheap.bulletInner[i] && this.cheapPhantom.take(cheap.bulletKey[i], tick)) {
				m.count(room, M_CHEAP_PHANTOM);
			}
		}
		for (let j = 0; j < truth.bulletCount; j++) {
			if (!mt.takenB[j] && truth.bulletInner[j] && this.cheapLate.take(truth.bulletKey[j], tick)) {
				m.count(room, M_CHEAP_LATE);
			}
		}
	}

	/** The drawn prediction of tick t, if one was drawn before `before` (a confirmed tick). */
	private predOf(t: number, before: number): ViewDigest | undefined {
		if (t < 0) return undefined;
		const p = this.predRing[t % this.ringSize];
		return p.valid && p.tick === t && p.frameTick < before ? p : undefined;
	}

	private truthOf(t: number): ViewDigest | undefined {
		if (t < 0) return undefined;
		const d = this.truthRing[t % this.truthSize];
		return d.valid && d.tick === t ? d : undefined;
	}

	/** Some drawn prediction of a tick in [e - slack, e + slack], drawn before `before`, shows (kind, entity). */
	private drawnHas(kind: number, entity: number, e: number, before: number): boolean {
		const slack = MODEL.eventSlackTicks;
		for (let t = e - slack; t <= e + slack; t++) {
			const p = this.predOf(t, before);
			if (p !== undefined && p.hasEvent(kind, entity)) return true;
		}
		return false;
	}

	/** The truth of some tick in [e - slack, e + slack] has (kind, entity). */
	private truthHas(kind: number, entity: number, e: number): boolean {
		const slack = MODEL.eventSlackTicks;
		for (let t = e - slack; t <= e + slack; t++) {
			const d = this.truthOf(t);
			if (d !== undefined && d.hasEvent(kind, entity)) return true;
		}
		return false;
	}

	/** Events of tick e (every truth of e +- slack is known now). */
	private events(e: number): void {
		const truth = this.truthOf(e);
		if (truth === undefined) return;
		const m = this.metrics;
		const room = this.truthRoom[e % this.truthSize];
		const me = this.playerIndex;
		for (let k = 0; k < truth.eventCount; k++) {
			const kind = truth.eventKind[k];
			const entity = truth.eventEntity[k];
			if (kind === DigestEvent.HIT) {
				if (entity !== me || this.predOf(e, math.huge) === undefined) continue;
				if (this.drawnHas(kind, entity, e, math.huge)) continue;
				if (e - this.lastHeartMissed <= MODEL.eventSlackTicks) continue;
				this.lastHeartMissed = e;
				m.count(room, M_HEART_MISSED);
				continue;
			}
			if (this.drawnHas(kind, entity, e, e)) continue;
			if (this.late[kindSlot(kind)].take(entity, e)) m.count(room, M_LATE);
		}
		const pred = this.predOf(e, e);
		if (pred === undefined) return;
		for (let k = 0; k < pred.eventCount; k++) {
			const kind = pred.eventKind[k];
			const entity = pred.eventEntity[k];
			if (this.truthHas(kind, entity, e)) continue;
			if (kind === DigestEvent.HIT) {
				if (entity !== me || e - this.lastHeartPhantom <= MODEL.eventSlackTicks) continue;
				this.lastHeartPhantom = e;
				m.count(room, M_HEART_PHANTOM);
				continue;
			}
			if (this.undone[kindSlot(kind)].take(entity, e)) m.count(room, undoneMetric(kind));
		}
	}
}

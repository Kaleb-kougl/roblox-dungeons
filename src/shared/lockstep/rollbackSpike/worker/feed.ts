/**
 * The main thread's side of the rollback probe's mirror (docs/ROLLBACK_SPIKE.md Design 5, task R3): once per rendered
 * frame, BEFORE the sim steps, `RollbackFeed.next` reads what the client holds (a RollbackFrameSource: the
 * LockstepClient's queued merged frames and sent inputs, or a solo LiveRun's recorded frames) and builds the frames
 * message with what the worker has not seen yet, and every `hashEveryTicks` the main state's hash at T (the worker
 * answers with its mirror's at the same tick; `checkMirrorHash` compares). Pure.
 *
 * Read before the step, every merged frame received is still queued (the pump has not consumed it), so nothing is
 * missed; the worker's mirror then runs one frame behind the main state, which a measurement does not mind.
 */
import { EMPTY_INPUT, copyInput, type InputFrame } from "shared/sim";
import { ROLLBACK_SPIKE } from "../config";
import { packInput, type RollbackFramesMsg } from "./protocol";

/** What the main client holds, read-only (see the file comment). */
export interface RollbackFrameSource {
	/** The confirmed tick T: the main state's tick now (before this frame's step). */
	tick(): number;
	/** One past the newest merged frame held (received: stepped or queued). */
	truthEnd(): number;
	/** Writes tick `tick`'s merged frame (index order) into `out`; false when it is not held (any more). */
	truthAt(tick: number, out: InputFrame[]): boolean;
	/** One past the newest own frame sent (co-op), or truthEnd (solo: no own frames past the truth). */
	ownEnd(): number;
	/** The own frame sent for `tick` (undefined: never sent, the server repeats the last one). */
	ownAt(tick: number): Readonly<InputFrame> | undefined;
}

/** A mirror hash answer against the main state's hash at that tick. */
export type MirrorHashResult =
	| { readonly kind: "ok"; readonly tick: number }
	| { readonly kind: "mismatch"; readonly tick: number; readonly main: string; readonly mirror: string }
	| { readonly kind: "unknown"; readonly tick: number };

/** Builds the frames messages for one run (see the file comment). */
export class RollbackFeed {
	private nextTruth = 0;
	private nextOwn = 0;
	private nextHash: number;
	private readonly row: InputFrame[] = [];
	private readonly lastOwn: InputFrame = copyInput(EMPTY_INPUT);
	private readonly pending = new Map<number, string>();
	/** Answers that matched, and the first mismatch. */
	matched = 0;
	mismatch: MirrorHashResult | undefined;

	constructor(readonly partySize: number, private readonly hashEveryTicks: number = ROLLBACK_SPIKE.mirrorHashTicks) {
		for (let k = 0; k < partySize; k++) this.row.push(copyInput(EMPTY_INPUT));
		this.nextHash = hashEveryTicks;
	}

	/**
	 * This frame's message, or a string (why the probe must stop: a merged frame the worker needs is not held any
	 * more). `hashOf` is called (and its result kept for the answer) when a hash check is due at T.
	 */
	next(src: RollbackFrameSource, frameMs: number, hashOf: () => string): RollbackFramesMsg | string {
		const T = src.tick();
		const cap = ROLLBACK_SPIKE.probe.maxTicksPerMessage;
		const truthFirst = this.nextTruth;
		const truthEnd = math.min(src.truthEnd(), truthFirst + cap);
		const truth: number[] = [];
		for (let t = truthFirst; t < truthEnd; t++) {
			if (!src.truthAt(t, this.row)) return `merged frame of tick ${t} not held (first unsent ${truthFirst})`;
			for (const f of this.row) packInput(f, truth);
		}
		this.nextTruth = math.max(truthFirst, truthEnd);
		const ownFirst = math.max(this.nextOwn, this.nextTruth);
		const ownEnd = math.min(src.ownEnd(), ownFirst + cap);
		const own: number[] = [];
		for (let t = ownFirst; t < ownEnd; t++) {
			const f = src.ownAt(t);
			if (f !== undefined) copyInput(f, this.lastOwn);
			packInput(this.lastOwn, own);
		}
		this.nextOwn = math.max(ownFirst, ownEnd);
		// The worker steps its mirror to `tick`: never past the merged frames it has (a capped catch-up continues).
		const tick = math.min(T, this.nextTruth);
		let hashTick = -1;
		if (tick === T && T >= this.nextHash) {
			hashTick = T;
			this.pending.set(T, hashOf());
			this.nextHash = T + this.hashEveryTicks;
		}
		return { kind: "frames", tick, frameMs, truthFirst, truth, ownFirst, own, hashTick };
	}

	/** The worker's mirror hash at `tick` against the main state's (kept by `next`). */
	checkMirrorHash(tick: number, hash: string): MirrorHashResult {
		const main = this.pending.get(tick);
		if (main === undefined) return { kind: "unknown", tick };
		this.pending.delete(tick);
		if (main === hash) {
			this.matched++;
			return { kind: "ok", tick };
		}
		const r: MirrorHashResult = { kind: "mismatch", tick, main, mirror: hash };
		if (this.mismatch === undefined) this.mismatch = r;
		return r;
	}

	/** Hash checks sent and not answered yet. */
	pendingChecks(): number {
		return this.pending.size();
	}
}

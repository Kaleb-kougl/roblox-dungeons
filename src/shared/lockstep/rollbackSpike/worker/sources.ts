/**
 * RollbackFrameSource adapters (feed.ts) over what the client holds (docs/ROLLBACK_SPIKE.md R3): a co-op
 * LockstepClient (its queued merged frames and its sent own inputs, through the read-only spike accessors) and a solo
 * run (a LiveRun's recorded frames: every stepped tick's input, the truth of a party of one). Read-only; pure.
 */
import { copyInput, type InputFrame, type SimState } from "shared/sim";
import type { LockstepClient } from "../../client";
import type { RollbackFrameSource } from "./feed";

/** A co-op client: merged frames [state.tick, state.tick + backlog), own inputs through lastSentInputTick. */
export function lockstepFrameSource(client: LockstepClient): RollbackFrameSource {
	return {
		tick() {
			return client.state.tick;
		},
		truthEnd() {
			return client.state.tick + client.backlog();
		},
		truthAt(tick, out) {
			const frames = client.queuedFrame(tick - client.state.tick);
			if (frames === undefined) return false;
			for (let k = 0; k < out.size(); k++) copyInput(frames[k], out[k]);
			return true;
		},
		ownEnd() {
			return client.lastSentInputTick() + 1;
		},
		ownAt(tick) {
			return client.sentInput(tick);
		},
	};
}

/** What a solo run exposes (shared/play LiveRun): its state, recorded frames and the frames released so far. */
export interface RecordedRunView {
	readonly state: SimState;
	readonly recorder: { readonly frames: ReadonlyArray<Readonly<InputFrame>> };
	releasedFrameCount(): number;
}

/** A solo run: the recorded frame of every stepped tick is the merged frame (a party of one); no own frames past it. */
export function soloFrameSource(run: RecordedRunView): RollbackFrameSource {
	return {
		tick() {
			return run.state.tick;
		},
		truthEnd() {
			return run.state.tick;
		},
		truthAt(tick, out) {
			const f = run.recorder.frames[tick - run.releasedFrameCount()];
			if (f === undefined || tick >= run.state.tick) return false;
			copyInput(f, out[0]);
			return true;
		},
		ownEnd() {
			return run.state.tick;
		},
		ownAt() {
			return undefined;
		},
	};
}

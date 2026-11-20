/**
 * The server's merged input log of one co-op run (M4): every finalized merged frame (relay.ts), from which the server
 * cuts the segments it feeds into its own SegmentedValidator (the codec's party variant: one stream per player).
 * Frames of ticks already handed to the validator are released, so a long run keeps at most a segment's worth. Pure.
 *
 * @module
 */
import { encodeRecording, type InputFrame, type Recording } from "shared/sim";

/**
 * The server's merged input log of one co-op run: one frame stream per player, released as its ticks go to the
 * validator.
 */
export class PartyRunLog {
	/** Per player: the frames of ticks [base, base + size). */
	private readonly streams: InputFrame[][] = [];
	private base = 0;

	constructor(
		readonly seed: number,
		readonly spawn: { readonly x: number; readonly z: number },
		readonly players: number,
	) {
		for (let i = 0; i < players; i++) this.streams.push([]);
	}

	/** Appends the next tick's merged frame (player index order). */
	append(merged: ReadonlyArray<InputFrame>): void {
		if (merged.size() !== this.players) error(`PartyRunLog: ${merged.size()} frames, not ${this.players}`, 0);
		for (let i = 0; i < this.players; i++) this.streams[i].push(merged[i]);
	}

	/** Ticks logged (released ones included): the next tick's index. */
	ticks(): number {
		return this.base + this.streams[0].size();
	}

	/** First tick still held. */
	firstHeldTick(): number {
		return this.base;
	}

	/** The merged frame of tick `t` (held ticks only). */
	frameAt(t: number): InputFrame[] {
		const k = t - this.base;
		if (k < 0 || k >= this.streams[0].size()) error(`PartyRunLog: tick ${t} not held`, 0);
		const out: InputFrame[] = [];
		for (let i = 0; i < this.players; i++) out.push(this.streams[i][k]);
		return out;
	}

	/** The recording of ticks [startTick, endTick) (a segment's slice: the run's seed and spawn, every player). */
	slice(startTick: number, endTick: number): Recording {
		if (startTick < this.base || endTick > this.ticks() || endTick < startTick) {
			error(`PartyRunLog: slice [${startTick}, ${endTick}) outside [${this.base}, ${this.ticks()})`, 0);
		}
		const streams: InputFrame[][] = [];
		for (let i = 0; i < this.players; i++) {
			const s: InputFrame[] = [];
			const last = endTick - 1;
			for (let t = startTick; t <= last; t++) s.push(this.streams[i][t - this.base]);
			streams.push(s);
		}
		const others: InputFrame[][] = [];
		for (let i = 1; i < this.players; i++) others.push(streams[i]);
		return { seed: this.seed, spawn: { x: this.spawn.x, z: this.spawn.z }, frames: streams[0], others };
	}

	/** encodeRecording(slice(startTick, endTick)). */
	encodeSlice(startTick: number, endTick: number): buffer {
		return encodeRecording(this.slice(startTick, endTick));
	}

	/** Releases the frames of ticks before `tick`. */
	releaseBefore(tick: number): void {
		const drop = math.min(tick, this.ticks()) - this.base;
		if (drop <= 0) return;
		for (let i = 0; i < this.players; i++) {
			const old = this.streams[i];
			const kept: InputFrame[] = [];
			for (let k = drop; k < old.size(); k++) kept.push(old[k]);
			this.streams[i] = kept;
		}
		this.base += drop;
	}
}

/**
 * Late beds (docs/STAGE_ASSETS.md "Revision 2", SA18, SAD14): which looped bed (music or ambience) a channel should be
 * playing while its sound may still be downloading. A wanted bed that is ready plays at once (the channel's usual
 * cross-fade); one that is not waits silently, and starts (faded in over AUDIO_VIEW.lateBedFadeSec) the first time
 * readiness says it is in, if it is still the wanted bed. A bed already playing is never stopped by readiness (it
 * cannot be un-downloaded; KV_StandInsForce flipping it back leaves it playing). Pure: the client's AudioController
 * owns one per channel.
 */

/** What `want` asks the channel to do now. */
export type BedAction = "play" | "wait" | "stop";

export class BedGate {
	private wanted: string | undefined;
	private waiting = false;

	/** The bed wanted now (undefined: silence). Same id again: "wait" while still waiting, else "play" (a no-op). */
	want(id: string | undefined, ready: boolean): BedAction {
		if (id === undefined) {
			this.wanted = undefined;
			this.waiting = false;
			return "stop";
		}
		if (id === this.wanted) {
			// already playing (whatever readiness says now), or still waiting
			if (!this.waiting) return "play";
			if (!ready) return "wait";
			this.waiting = false;
			return "play";
		}
		this.wanted = id;
		this.waiting = !ready;
		return ready ? "play" : "wait";
	}

	/** Readiness moved: the waiting bed's id once it is ready (start it late, faded in), else undefined. */
	poll(isReady: (id: string) => boolean): string | undefined {
		const id = this.wanted;
		if (!this.waiting || id === undefined || !isReady(id)) return undefined;
		this.waiting = false;
		return id;
	}

	/** The bed wanted now, and whether it is still waiting for its sound. */
	current(): string | undefined {
		return this.wanted;
	}

	isWaiting(): boolean {
		return this.waiting;
	}
}

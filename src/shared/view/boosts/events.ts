/**
 * A frame's boost-drop events (docs/BOOSTS.md B6 / B7). The sim's DropsEvents (shared/sim drops.ts) are per TICK and
 * cleared at the start of every tick, and a rendered frame may run several ticks, so the run views (shared/play LiveRun,
 * shared/lockstep LockstepClient) `collect` them after every tick into one BoostFrameEvents and `reset` it at the start
 * of every frame, as they do their FrameEvents. The drop renderer (pickup bursts, poofs) and the audio cue mapper read
 * it once per frame. Presentation only: plain numbers, read-only on the sim, tested headlessly.
 */
import {
	NO_BOOST,
	dropsEvents,
	dropsGround,
	type BoostEnded,
	type DropCollected,
	type DropExpired,
	type SimState,
} from "shared/sim";

/** A drop that landed: its ground slot, kind (Boost index) and position (sim world units). */
export interface BoostLanding {
	readonly slot: number;
	readonly kind: number;
	readonly x: number;
	readonly z: number;
}

/** What the drop renderer and the audio mapper read (BoostFrameEvents satisfies it). */
export interface BoostEventSource {
	readonly dropped: ReadonlyArray<BoostLanding>;
	readonly collected: ReadonlyArray<DropCollected>;
	readonly expired: ReadonlyArray<DropExpired>;
	readonly ended: ReadonlyArray<BoostEnded>;
	readonly aegisBroke: ReadonlyArray<number>;
}

/** The boost-drop events of every tick a frame ran, in tick order. */
export class BoostFrameEvents implements BoostEventSource {
	readonly dropped: BoostLanding[] = [];
	readonly collected: DropCollected[] = [];
	readonly expired: DropExpired[] = [];
	readonly ended: BoostEnded[] = [];
	readonly aegisBroke: number[] = [];

	/** A new frame: forget the last one's events. */
	reset(): void {
		this.dropped.clear();
		this.collected.clear();
		this.expired.clear();
		this.ended.clear();
		this.aegisBroke.clear();
	}

	/** Every event of this frame (0: nothing happened). */
	count(): number {
		return (
			this.dropped.size() +
			this.collected.size() +
			this.expired.size() +
			this.ended.size() +
			this.aegisBroke.size()
		);
	}

	/**
	 * After every tick: appends that tick's events (no-op without drops). A landing's kind and position come from its
	 * ground slot; a drop taken on its landing tick from that tick's pickup; one a floor change freed on the same tick
	 * (it never showed) is skipped.
	 */
	collect(state: Readonly<SimState>): void {
		const ev = dropsEvents(state);
		if (ev === undefined) return;
		const ground = dropsGround(state);
		for (const slot of ev.dropped) {
			const g = ground[slot];
			if (g !== undefined && g.kind !== NO_BOOST) {
				this.dropped.push({ slot, kind: g.kind, x: g.x, z: g.z });
				continue;
			}
			const taken = ev.collected.find((c) => c.slot === slot);
			if (taken !== undefined) this.dropped.push({ slot, kind: taken.kind, x: taken.x, z: taken.z });
		}
		for (const c of ev.collected) this.collected.push(c);
		for (const e of ev.expired) this.expired.push(e);
		for (const e of ev.ended) this.ended.push(e);
		for (const p of ev.aegisBroke) this.aegisBroke.push(p);
	}
}

/** No events (a run view without drops, the specs' default). */
export const NO_BOOST_EVENTS: BoostEventSource = new BoostFrameEvents();

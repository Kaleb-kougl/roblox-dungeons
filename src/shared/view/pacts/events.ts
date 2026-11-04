/**
 * A frame's pact events (docs/FORTUNE.md FO7 / FO9). The sim's PactsEvents (shared/sim pacts.ts) are per TICK and
 * cleared at the start of every tick, and a rendered frame may run several ticks, so the run views (shared/play LiveRun,
 * shared/lockstep LockstepClient) `collect` them after every tick into one PactFrameEvents and `reset` it at the start of
 * every frame, as they do PelletFrameEvents. The pact renderer (the take pulse, the shouts), the audio cue mapper and
 * the room clear read it once per frame. Presentation only: plain numbers copied out, read-only on the sim. A leaf
 * (types and pure reads from shared/sim only).
 */
import { PactKind, type SimState } from "shared/sim";

/** A pact taken on one tick: who, which altar, where it stands (sim units), and (Greed) the curse taken. */
export interface PactTaken {
	readonly kind: number;
	readonly player: number;
	readonly x: number;
	readonly z: number;
	/** Greed: the Curse index applied; Horde: -1. */
	readonly curse: number;
	readonly tick: number;
}

/** What the views read (PactFrameEvents satisfies it). */
export interface PactFrameSource {
	/** Pacts taken during the frame's ticks, in tick order (Greed and Horde together; `kind` tells them apart). */
	readonly taken: ReadonlyArray<PactTaken>;
	/** The horde room roused (its encounter room id), at most one per floor. */
	readonly roused: ReadonlyArray<number>;
	/** Wave 2's telegraph started (its size). */
	readonly telegraphed: ReadonlyArray<number>;
	/** Wave 2 spawned (how many got a slot). */
	readonly spawned: ReadonlyArray<number>;
	/** The horde room's record cleared during the frame (its x2 paid): how many times (0 or 1). */
	readonly hordeCleared: number;
}

/** The pact events of every tick a frame ran, in tick order. */
export class PactFrameEvents implements PactFrameSource {
	readonly taken: PactTaken[] = [];
	readonly roused: number[] = [];
	readonly telegraphed: number[] = [];
	readonly spawned: number[] = [];
	hordeCleared = 0;

	/** A new frame: forget the last one's events. */
	reset(): void {
		this.taken.clear();
		this.roused.clear();
		this.telegraphed.clear();
		this.spawned.clear();
		this.hordeCleared = 0;
	}

	/** Every event of this frame (0: nothing happened). */
	count(): number {
		return (
			this.taken.size() + this.roused.size() + this.telegraphed.size() + this.spawned.size() + this.hordeCleared
		);
	}

	/** After every tick: appends that tick's events (no-op without pacts). Copies: the sim reuses its arrays. */
	collect(state: Readonly<SimState>): void {
		const p = state.pacts;
		if (p === undefined) return;
		const e = p.events;
		const tick = state.tick;
		for (let k = 0; k < e.greedPlayer.size(); k++)
			this.taken.push(takenAt(p.altarX, p.altarZ, PactKind.GREED, e.greedPlayer[k], e.greedCurse[k], tick));
		for (const i of e.hordePlayer) this.taken.push(takenAt(p.altarX, p.altarZ, PactKind.HORDE, i, -1, tick));
		if (e.hordeRoused > 0) this.roused.push(e.hordeRoused - 1);
		if (e.waveTelegraphed > 0) this.telegraphed.push(e.waveTelegraphed);
		if (e.waveSpawned > 0) this.spawned.push(e.waveSpawned - 1);
		if (e.hordeCleared > 0) this.hordeCleared += 1;
	}
}

function takenAt(
	xs: ReadonlyArray<number>,
	zs: ReadonlyArray<number>,
	kind: number,
	player: number,
	curse: number,
	tick: number,
): PactTaken {
	return { kind, player, x: xs[kind] ?? 0, z: zs[kind] ?? 0, curse, tick };
}

/** No events (a run view without pacts, the specs' default). */
export const NO_PACT_EVENTS: PactFrameSource = new PactFrameEvents();

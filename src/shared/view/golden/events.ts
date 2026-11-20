/**
 * A frame's Goldling events (docs/FORTUNE.md FO8). The sim's GoldenEvents (shared/sim golden.ts) are per TICK and
 * cleared at the start of every tick, and a rendered frame may run several ticks, so the run views (shared/play LiveRun,
 * shared/lockstep LockstepClient) `collect` them after every tick into one GoldenFrameEvents and `reset` it at the start
 * of every frame, as they do the boost and pellet events. GoldenRenderController (the flash, coins, fountain, puff,
 * shouts, freeze), the score pops, the boost hop and the audio cue mapper read it once per frame. Presentation only:
 * plain numbers, read-only on the sim (it reads the unhashed events and hashed state, never writes), tested headlessly.
 * A leaf (shared/sim only).
 *
 * @module
 */
import { NO_BOOST, dropsGround, type SimState } from "shared/sim";

/** It appeared: its spawn spot, its actor's id and the tick (state.tick after that tick). */
export interface GoldenAppear {
	readonly x: number;
	readonly z: number;
	readonly actorId: number;
	readonly tick: number;
}

/** A damaging hit: the spot, the hitter, the coins it paid and the hits so far on this Goldling (this one included). */
export interface GoldenHit {
	readonly x: number;
	readonly z: number;
	readonly player: number;
	readonly points: number;
	readonly hits: number;
	readonly tick: number;
}

/** One boost the catch landed: its ground slot and that slot's spawnTick at collection (NOT_ON_GROUND: taken at once). */
export interface GoldenBoostLanding {
	readonly slot: number;
	readonly spawnTick: number;
}

/** GoldenBoostLanding.spawnTick of a boost taken on its landing tick (it never shows on the ground). */
export const GOLDEN_NOT_ON_GROUND = -1;

/** The catch: the spot, the catcher, the jackpot's points, the boosts it landed (landing order) and the ones lost. */
export interface GoldenCatch {
	readonly x: number;
	readonly z: number;
	readonly player: number;
	readonly points: number;
	readonly boosts: ReadonlyArray<GoldenBoostLanding>;
	readonly lost: number;
	readonly tick: number;
}

/** The escape: where it dived and the coins the floor's Goldling paid (GoldenState.coins: banked, kept). */
export interface GoldenEscape {
	readonly x: number;
	readonly z: number;
	readonly coins: number;
	readonly tick: number;
}

/** What the views read (GoldenFrameEvents satisfies it). */
export interface GoldenFrameSource {
	readonly appeared: ReadonlyArray<GoldenAppear>;
	readonly hits: ReadonlyArray<GoldenHit>;
	readonly caught: ReadonlyArray<GoldenCatch>;
	readonly escaped: ReadonlyArray<GoldenEscape>;
	/** Ticks of the frame on which it was due but the actor pool was full (it never appeared). */
	readonly skipped: number;
}

/** The Goldling events of every tick a frame ran, in tick order. */
export class GoldenFrameEvents implements GoldenFrameSource {
	readonly appeared: GoldenAppear[] = [];
	readonly hits: GoldenHit[] = [];
	readonly caught: GoldenCatch[] = [];
	readonly escaped: GoldenEscape[] = [];
	skipped = 0;

	/** A new frame: forget the last one's events. */
	reset(): void {
		this.appeared.clear();
		this.hits.clear();
		this.caught.clear();
		this.escaped.clear();
		this.skipped = 0;
	}

	/** Every event of this frame (0: nothing happened). */
	count(): number {
		return this.appeared.size() + this.hits.size() + this.caught.size() + this.escaped.size() + this.skipped;
	}

	/** After every tick: appends that tick's events (no-op without state.golden). Copies: the sim reuses its arrays. */
	collect(state: Readonly<SimState>): void {
		const g = state.golden;
		if (g === undefined) return;
		const ev = g.events;
		const tick = state.tick;
		if (ev.appeared > 0) {
			const a = state.combat.actors[g.actorSlot];
			if (a !== undefined && a.id === g.actorId) this.appeared.push({ x: a.x, z: a.z, actorId: a.id, tick });
		}
		this.skipped += ev.skipped;
		for (const h of ev.hits)
			this.hits.push({ x: h.x, z: h.z, player: h.player, points: h.points, hits: h.hits, tick });
		const c = ev.caught;
		if (c !== undefined) {
			const ground = dropsGround(state);
			const boosts: GoldenBoostLanding[] = [];
			for (const slot of c.boosts) {
				const d = ground[slot];
				const on = d !== undefined && d.kind !== NO_BOOST;
				boosts.push({ slot, spawnTick: on ? d.spawnTick : GOLDEN_NOT_ON_GROUND });
			}
			this.caught.push({ x: c.x, z: c.z, player: c.player, points: c.points, boosts, lost: c.lost, tick });
		}
		const e = ev.escaped;
		if (e !== undefined) this.escaped.push({ x: e.x, z: e.z, coins: g.coins, tick });
	}
}

/** No events (a run view without the Goldling, the specs' default). */
export const NO_GOLDEN_EVENTS: GoldenFrameSource = new GoldenFrameEvents();

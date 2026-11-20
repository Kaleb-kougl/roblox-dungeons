/**
 * A frame's boost-drop events (docs/BOOSTS.md B6 / B7). The sim's DropsEvents (shared/sim drops.ts) are per TICK and
 * cleared at the start of every tick, and a rendered frame may run several ticks, so the run views (shared/play LiveRun,
 * shared/lockstep LockstepClient) `collect` them after every tick into one BoostFrameEvents and `reset` it at the start
 * of every frame, as they do their FrameEvents. The drop renderer (pickup bursts, poofs) and the audio cue mapper read
 * it once per frame. Presentation only: plain numbers, read-only on the sim, tested headlessly.
 *
 * Boosts from breakables (docs/BREAKABLE_DROPS.md BL6): `fromPiece` lists the frame's landings that came out of a
 * broken barrel / crate (a subset of `dropped`, collected in the same pass, so a landing `dropped` skips is skipped here
 * too) with their landing tick (the renderer's hop matches it to the slot's drop); `lostLoot` the loaded pieces that
 * broke with every ground slot taken (the renderer's fizzle).
 *
 * Treasure rooms (docs/TREASURE.md TR7): `fromChest` lists the frame's landings that came out of an opened chest
 * (DropsEvents.fromChest; a subset of `dropped`, collected the same way): the renderer holds them inside the chest until
 * the lid pops, then hops them out (chestLandingAt). Not in `fromPiece`: the loot sound is a breakable's.
 *
 * @module
 */
import {
	NO_BOOST,
	dropsEvents,
	dropsGround,
	type BoostEnded,
	type DropCollected,
	type DropExpired,
	type DropLostLoot,
	type SimState,
} from "shared/sim";

/** A drop that landed: its ground slot, kind (Boost index) and position (sim world units). */
export interface BoostLanding {
	readonly slot: number;
	readonly kind: number;
	readonly x: number;
	readonly z: number;
}

/**
 * A landing out of a broken breakable (docs/BREAKABLE_DROPS.md): the landing, and the ground slot's `spawnTick` at
 * collection (the tick it landed), or NOT_ON_GROUND when it was taken on its landing tick (it never shows).
 */
export interface PieceLanding extends BoostLanding {
	readonly spawnTick: number;
}

/** PieceLanding.spawnTick of a piece's drop taken on its landing tick (no slot to hop). */
export const NOT_ON_GROUND = -1;

/** What the drop renderer and the audio mapper read (BoostFrameEvents satisfies it). */
export interface BoostEventSource {
	readonly dropped: ReadonlyArray<BoostLanding>;
	readonly collected: ReadonlyArray<DropCollected>;
	readonly expired: ReadonlyArray<DropExpired>;
	readonly ended: ReadonlyArray<BoostEnded>;
	readonly aegisBroke: ReadonlyArray<number>;
	/** The landings out of a broken breakable (a subset of `dropped`, same order). */
	readonly fromPiece: ReadonlyArray<PieceLanding>;
	/** Loaded breakables that broke with every ground slot taken: the boost is lost (kind, sim position). */
	readonly lostLoot: ReadonlyArray<DropLostLoot>;
	/** The landings out of an opened chest (a subset of `dropped`, same order; docs/TREASURE.md TR7). */
	readonly fromChest: ReadonlyArray<PieceLanding>;
}

/** The boost-drop events of every tick a frame ran, in tick order. */
export class BoostFrameEvents implements BoostEventSource {
	readonly dropped: BoostLanding[] = [];
	readonly collected: DropCollected[] = [];
	readonly expired: DropExpired[] = [];
	readonly ended: BoostEnded[] = [];
	readonly aegisBroke: number[] = [];
	readonly fromPiece: PieceLanding[] = [];
	readonly lostLoot: DropLostLoot[] = [];
	readonly fromChest: PieceLanding[] = [];

	/** A new frame: forget the last one's events. */
	reset(): void {
		this.dropped.clear();
		this.collected.clear();
		this.expired.clear();
		this.ended.clear();
		this.aegisBroke.clear();
		this.fromPiece.clear();
		this.lostLoot.clear();
		this.fromChest.clear();
	}

	/** Every event of this frame (0: nothing happened). */
	count(): number {
		return (
			this.dropped.size() +
			this.collected.size() +
			this.expired.size() +
			this.ended.size() +
			this.aegisBroke.size() +
			this.lostLoot.size()
		);
	}

	/**
	 * After every tick: appends that tick's events (no-op without drops). A landing's kind and position come from its
	 * ground slot; a drop taken on its landing tick from that tick's pickup; one a floor change freed on the same tick
	 * (it never showed) is skipped. A landing in the tick's `fromPiece` is also a PieceLanding (its slot's spawnTick, or
	 * NOT_ON_GROUND when taken at once). `count()` counts a piece's landing once (as a landing).
	 */
	collect(state: Readonly<SimState>): void {
		const ev = dropsEvents(state);
		if (ev === undefined) return;
		const ground = dropsGround(state);
		const pieces = ev.fromPiece;
		const chests = ev.fromChest;
		for (const slot of ev.dropped) {
			const g = ground[slot];
			let landing: BoostLanding | undefined;
			let spawnTick = NOT_ON_GROUND;
			if (g !== undefined && g.kind !== NO_BOOST) {
				landing = { slot, kind: g.kind, x: g.x, z: g.z };
				spawnTick = g.spawnTick;
			} else {
				const taken = ev.collected.find((c) => c.slot === slot);
				if (taken !== undefined) landing = { slot, kind: taken.kind, x: taken.x, z: taken.z };
			}
			if (landing === undefined) continue;
			this.dropped.push(landing);
			if (pieces.includes(slot)) {
				this.fromPiece.push({
					slot,
					kind: landing.kind,
					x: landing.x,
					z: landing.z,
					spawnTick,
				});
			}
			if (chests.includes(slot)) {
				this.fromChest.push({ slot, kind: landing.kind, x: landing.x, z: landing.z, spawnTick });
			}
		}
		for (const c of ev.collected) this.collected.push(c);
		for (const e of ev.expired) this.expired.push(e);
		for (const e of ev.ended) this.ended.push(e);
		for (const p of ev.aegisBroke) this.aegisBroke.push(p);
		for (const l of ev.lostLoot) this.lostLoot.push({ kind: l.kind, x: l.x, z: l.z });
	}
}

/**
 * The frame's landing out of a piece in ground slot `slot` whose drop landed on `spawnTick` (the slot's GroundDrop), or
 * undefined: that drop is a kill drop (or a debug one). Tick-matched, so a piece's drop taken and the slot refilled by a
 * kill within one frame never hops.
 */
export function pieceLandingAt(source: BoostEventSource, slot: number, spawnTick: number): PieceLanding | undefined {
	for (const p of source.fromPiece) if (p.slot === slot && p.spawnTick === spawnTick) return p;
	return undefined;
}

/** The frame's landing out of an opened chest in ground slot `slot` landed on `spawnTick` (pieceLandingAt's rule). */
export function chestLandingAt(source: BoostEventSource, slot: number, spawnTick: number): PieceLanding | undefined {
	for (const p of source.fromChest) if (p.slot === slot && p.spawnTick === spawnTick) return p;
	return undefined;
}

/** No events (a run view without drops, the specs' default). */
export const NO_BOOST_EVENTS: BoostEventSource = new BoostFrameEvents();

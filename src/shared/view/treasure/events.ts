/**
 * A frame's vault events (docs/TREASURE.md TR7, Design §4). The sim's TreasureEvents (shared/sim treasure.ts) are per
 * TICK and cleared at the start of every tick, and a rendered frame may run several ticks, so the run views
 * (shared/play LiveRun, shared/lockstep LockstepClient) `collect` them after every tick into one TreasureFrameEvents and
 * `reset` it at the start of every frame, as they do BoostFrameEvents / PelletFrameEvents. TreasureRenderController
 * (the crack, the unlock, the open) reads it once per frame; TR8's toasts and audio cue mapper read the same source.
 * Presentation only: plain numbers copied out of the state, read-only on the sim, tested headlessly.
 *
 * Every record carries the vault's identity (room, slot) and the tick, so a view can tell a vault of the floor before
 * from the current one when a frame ran a floor change. A leaf (types and constants from shared/sim only).
 */
import { TREASURE_UNSET, VaultStatus, type SimState, type TreasureState } from "shared/sim";

/** The vault's identity and the tick an event happened on (state.tick at the end of that tick). */
export interface TreasureEventBase {
	readonly room: number;
	readonly slot: number;
	readonly tick: number;
	/** The chest's centre (sim world units). */
	readonly x: number;
	readonly z: number;
	/** VaultLock and VaultTier at the end of that tick. */
	readonly lock: number;
	readonly tier: number;
}

/** The vault armed (its room engaged): the toast's numbers. */
export interface TreasureArmedEvent extends TreasureEventBase {
	/** UNTOUCHED: hits the party may take (TREASURE_UNSET for SWIFT). */
	readonly allowance: number;
	/** SWIFT: the countdown's ticks at the arm (TREASURE_UNSET for UNTOUCHED). */
	readonly ticksLeft: number;
}

/** The lock cracked: `fromTier` is the tier it lost (the shards' colour), `tier` the new one. */
export interface TreasureCrackedEvent extends TreasureEventBase {
	readonly fromTier: number;
}

/** The room cleared and the chest unlocked: kept (1) with `spare`, or cracked with `missBy` (TREASURE_UNSET otherwise). */
export interface TreasureUnlockedEvent extends TreasureEventBase {
	readonly kept: number;
	readonly spare: number;
	readonly missBy: number;
}

/** One player's share of the open (shared/sim TreasureGrant, copied). */
export interface TreasureGrantView {
	readonly player: number;
	readonly relic: number;
	readonly bonusDeal: number;
	readonly boosts: ReadonlyArray<number>;
	readonly slots: ReadonlyArray<number>;
}

/** The open (shared/sim TreasureOpened, copied). */
export interface TreasureOpenedEvent extends TreasureEventBase {
	readonly opener: number;
	readonly startTier: number;
	readonly kept: number;
	readonly missBy: number;
	readonly spare: number;
	readonly points: number;
	readonly grants: ReadonlyArray<TreasureGrantView>;
}

/** What the views read (TreasureFrameEvents satisfies it). Each list is in tick order; almost always 0 or 1 entries. */
export interface TreasureFrameSource {
	readonly armed: ReadonlyArray<TreasureArmedEvent>;
	readonly cracked: ReadonlyArray<TreasureCrackedEvent>;
	readonly unlocked: ReadonlyArray<TreasureUnlockedEvent>;
	readonly opened: ReadonlyArray<TreasureOpenedEvent>;
}

function base(t: Readonly<TreasureState>, tick: number): TreasureEventBase {
	return { room: t.room, slot: t.slot, tick, x: t.x, z: t.z, lock: t.lock, tier: t.tier };
}

/** The vault events of every tick a frame ran, in tick order. */
export class TreasureFrameEvents implements TreasureFrameSource {
	readonly armed: TreasureArmedEvent[] = [];
	readonly cracked: TreasureCrackedEvent[] = [];
	readonly unlocked: TreasureUnlockedEvent[] = [];
	readonly opened: TreasureOpenedEvent[] = [];

	/** A new frame: forget the last one's events. */
	reset(): void {
		this.armed.clear();
		this.cracked.clear();
		this.unlocked.clear();
		this.opened.clear();
	}

	/** Every event of this frame (0: nothing happened). */
	count(): number {
		return this.armed.size() + this.cracked.size() + this.unlocked.size() + this.opened.size();
	}

	/** After every tick: appends that tick's events (no-op without treasure). Copies: the sim reuses its objects. */
	collect(state: Readonly<SimState>): void {
		const t = state.treasure;
		if (t === undefined) return;
		const ev = t.events;
		const tick = state.tick;
		if (ev.armed !== 0) this.armed.push({ ...base(t, tick), allowance: t.allowance, ticksLeft: t.ticksLeft });
		if (ev.cracked !== 0) this.cracked.push({ ...base(t, tick), fromTier: crackedFromTier(t) });
		if (ev.unlocked !== 0) {
			this.unlocked.push({
				...base(t, tick),
				kept: t.crackTick === TREASURE_UNSET ? 1 : 0,
				spare: t.spare,
				missBy: t.missBy,
			});
		}
		const o = ev.opened;
		if (o !== undefined) {
			const grants: TreasureGrantView[] = [];
			for (const g of o.grants) {
				grants.push({
					player: g.player,
					relic: g.relic,
					bonusDeal: g.bonusDeal,
					boosts: [...g.boosts],
					slots: [...g.slots],
				});
			}
			this.opened.push({
				...base(t, tick),
				tier: o.tier,
				lock: o.lock,
				opener: o.opener,
				startTier: o.startTier,
				kept: o.kept,
				missBy: o.missBy,
				spare: o.spare,
				points: o.points,
				grants,
			});
		}
	}
}

/** The tier a crack stepped down FROM: the start tier (a lock cracks once, so the tier before is always the start). */
export function crackedFromTier(t: Readonly<TreasureState>): number {
	return t.startTier;
}

/** No events (a run view without treasure, the specs' default). */
export const NO_TREASURE_EVENTS: TreasureFrameSource = new TreasureFrameEvents();

/** The floor has a vault (any status but NONE): TR8's floor-reveal toast reads it on the stage reveal. */
export function vaultOnFloor(state: Readonly<SimState>): boolean {
	const t = state.treasure;
	return t !== undefined && t.status !== VaultStatus.NONE;
}

/**
 * The party's hits since the vault's room engaged (the UNTOUCHED count: score.hitsTaken - the record's hitsAtEngage),
 * 0 before the arm or without a record.
 */
export function vaultHits(state: Readonly<SimState>): number {
	const t = state.treasure;
	const s = state.score;
	if (t === undefined || s === undefined || t.armTick === TREASURE_UNSET) return 0;
	const r = s.rooms[t.record];
	if (r === undefined) return 0;
	return math.max(0, s.hitsTaken - r.hitsAtEngage);
}

/**
 * A frame's third-endless-set events for the effects (docs/NEW_ENEMIES_2.md NX7): where blocks, guard breaks, chain
 * snaps and pyres going out happened. The sim's feeds are per TICK (CombatState.guardEvents / hookEvents, cleared at
 * the start of every tick; a pyre's death is a one-tick transition), and a rendered frame may run several ticks, so the
 * run views (shared/play LiveRun, shared/lockstep LockstepClient) `reset` this at the start of every frame and `collect`
 * after every tick, as they do VariantCueEvents. ParticleController reads it once per frame (newEnemies2.ts
 * newEnemy2Bursts). The sounds are VariantCueEvents' (the counts); the Snatcher's pellet moments are PelletFrameEvents'.
 *
 * Per tick, after the step:
 *   - blocks: CombatState.guardEvents' block points (the shield's front point for a swing, the bullet for a shot).
 *   - breaks: each guard break's Shieldwall, where it stands that tick.
 *   - snaps: each drag end that BREAKS the chain (hookEndBreaks: roll, sight, death, damage, the player's death; an
 *     arrival or a timeout is no snap), at the middle of the chain between the Chainhook and the player that tick.
 *   - puffs: a pyre alive last tick and dead now (withered or killed), where it stood. Per-slot memory ((slot, actor
 *     id) -> alive) across frames; a new state or the tick going back only snapshots, so nothing puffs on its first
 *     tick; a new actor id counts as alive-unknown (no puff).
 *
 * Read-only on the sim, no allocation per tick beyond the lists' growth (plain number arrays). Presentation only.
 */
import { NO_KIND, PYRE, archetypeIndex, hookEndBreaks, partySize, playerAt, type SimState } from "shared/sim";

/** What the effects read once per frame (NewEnemy2FrameEvents satisfies it). Parallel x / z lists, tick order. */
export interface NewEnemy2FrameSource {
	readonly blockX: ReadonlyArray<number>;
	readonly blockZ: ReadonlyArray<number>;
	readonly breakX: ReadonlyArray<number>;
	readonly breakZ: ReadonlyArray<number>;
	readonly snapX: ReadonlyArray<number>;
	readonly snapZ: ReadonlyArray<number>;
	readonly puffX: ReadonlyArray<number>;
	readonly puffZ: ReadonlyArray<number>;
}

/** Archetype index of `id`, or NO_KIND when it is not registered. */
function kindOf(id: string): number {
	const [ok, index] = pcall(() => archetypeIndex(id));
	return ok ? (index as number) : NO_KIND;
}

/** The third set's effect events of every tick a frame ran. */
export class NewEnemy2FrameEvents implements NewEnemy2FrameSource {
	readonly blockX: number[] = [];
	readonly blockZ: number[] = [];
	readonly breakX: number[] = [];
	readonly breakZ: number[] = [];
	readonly snapX: number[] = [];
	readonly snapZ: number[] = [];
	readonly puffX: number[] = [];
	readonly puffZ: number[] = [];
	private readonly pyreKind = kindOf(PYRE.id);
	private readonly slotIds: number[] = [];
	private readonly slotAlive: boolean[] = [];
	private lastState: Readonly<SimState> | undefined;
	private lastTick = -1;

	/** A new frame: forget the last one's events (the per-slot memory stays: a frame boundary is no transition). */
	reset(): void {
		this.blockX.clear();
		this.blockZ.clear();
		this.breakX.clear();
		this.breakZ.clear();
		this.snapX.clear();
		this.snapZ.clear();
		this.puffX.clear();
		this.puffZ.clear();
	}

	/** Every event of this frame (0: nothing happened). */
	count(): number {
		return this.blockX.size() + this.breakX.size() + this.snapX.size() + this.puffX.size();
	}

	/** Adds the tick just stepped (call after every step / stepParty). */
	collect(state: Readonly<SimState>): void {
		const combat = state.combat;
		const actors = combat.actors;
		const guard = combat.guardEvents;
		for (let i = 0; i < guard.blockX.size(); i++) {
			this.blockX.push(guard.blockX[i]);
			this.blockZ.push(guard.blockZ[i]);
		}
		for (const slot of guard.breakSlot) {
			const a = actors[slot];
			if (a === undefined) continue;
			this.breakX.push(a.x);
			this.breakZ.push(a.z);
		}
		const hook = combat.hookEvents;
		const party = partySize(state);
		for (let i = 0; i < hook.endReason.size(); i++) {
			if (!hookEndBreaks(hook.endReason[i])) continue;
			const a = actors[hook.endSlot[i]];
			const k = hook.endPlayer[i];
			if (a === undefined || k < 0 || k >= party) continue;
			const p = playerAt(state, k);
			this.snapX.push((a.x + p.x) / 2);
			this.snapZ.push((a.z + p.z) / 2);
		}
		this.collectPuffs(state);
	}

	private collectPuffs(state: Readonly<SimState>): void {
		const fresh = state !== this.lastState || state.tick < this.lastTick;
		this.lastState = state;
		this.lastTick = state.tick;
		const kind = this.pyreKind;
		const actors = state.combat.actors;
		for (let i = 0; i < actors.size(); i++) {
			const a = actors[i];
			while (this.slotIds.size() <= i) {
				this.slotIds.push(0);
				this.slotAlive.push(false);
			}
			const isPyre = kind !== NO_KIND && a.kind === kind && a.id !== 0;
			const alive = a.alive !== 0;
			if (!fresh && isPyre && this.slotIds[i] === a.id && this.slotAlive[i] && !alive) {
				this.puffX.push(a.x);
				this.puffZ.push(a.z);
			}
			this.slotIds[i] = isPyre ? a.id : 0;
			this.slotAlive[i] = alive;
		}
	}
}

/** No events (a run view without the set, the specs' default). */
export const NO_NEW_ENEMY_2_EVENTS: NewEnemy2FrameSource = new NewEnemy2FrameEvents();

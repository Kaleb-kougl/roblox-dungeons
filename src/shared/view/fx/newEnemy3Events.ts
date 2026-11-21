/**
 * A frame's fourth-endless-set events for the effects (docs/NEW_ENEMIES_3.md NT7): where shells landed, which enemies a
 * Mender healed and where a heal beam was cut. The sim's feeds are per TICK (SimEvents.shells, CombatState.healEvents,
 * cleared at the start of every tick), and a rendered frame may run several ticks, so the run views (shared/play
 * LiveRun, shared/lockstep LockstepClient) `reset` this at the start of every frame and `collect` after every tick, as
 * they do NewEnemy2FrameEvents. ParticleController reads it once per frame (newEnemies3.ts newEnemy3Bursts) and
 * NewEnemy3MarksController the heals (the `+`). The sounds are VariantCueEvents' (the counts).
 *
 * Per tick, after the step:
 *   - impacts: the landing point of every shell that landed (SimEvents.shells > 0 on the tick): a Mortar slot that was in
 *     flight with one flight tick left after the last tick and is no longer flying now (the same actor in flight again
 *     would be a new lob, which needs a draw first; a pinned Mortar does not step, so it stays at one tick left), at the
 *     point remembered from the last tick (a corpse may free its slot on the landing tick, NT2). At most `shells` per
 *     tick.
 *   - heals: each CombatState.healEvents pulse, where the healed actor stands that tick.
 *   - snaps: each link / channel end that is a cut (healEndCuts: sight, a body on the beam, a hit), at the middle of the
 *     beam between the Mender and the ally it was linked to after the last tick (per-slot memory: the end clears
 *     v[MENDER_ALLY]); without a remembered ally (a link started and cut on one tick), at the Mender.
 *   Per-slot memory ((slot, actor id) -> flight / ally) across frames; a new state or the tick going back only snapshots.
 *
 * Read-only on the sim, no allocation per tick beyond the lists' growth (plain number arrays). Presentation only.
 *
 * @module
 */
import {
	MENDER,
	MENDER_ALLY,
	MORTAR,
	MORTAR_FLIGHT,
	MORTAR_FLIGHT_TICKS,
	MORTAR_LAND_X,
	MORTAR_LAND_Z,
	NO_KIND,
	archetypeIndex,
	healEndCuts,
	menderLinked,
	type ActorState,
	type SimState,
} from "shared/sim";

/** What the effects read once per frame (NewEnemy3FrameEvents satisfies it). Parallel x / z lists, tick order. */
export interface NewEnemy3FrameSource {
	readonly impactX: ReadonlyArray<number>;
	readonly impactZ: ReadonlyArray<number>;
	readonly healX: ReadonlyArray<number>;
	readonly healZ: ReadonlyArray<number>;
	readonly snapX: ReadonlyArray<number>;
	readonly snapZ: ReadonlyArray<number>;
}

/** Archetype index of `id`, or NO_KIND when it is not registered. */
function kindOf(id: string): number {
	const [ok, index] = pcall(() => archetypeIndex(id));
	return ok ? (index as number) : NO_KIND;
}

function actorById(actors: ReadonlyArray<ActorState>, id: number): ActorState | undefined {
	if (id === 0) return undefined;
	for (let i = 0; i < actors.size(); i++) {
		const o = actors[i];
		if (o.id === id && o.kind !== NO_KIND) return o;
	}
	return undefined;
}

/** The fourth set's effect events of every tick a frame ran. */
export class NewEnemy3FrameEvents implements NewEnemy3FrameSource {
	readonly impactX: number[] = [];
	readonly impactZ: number[] = [];
	readonly healX: number[] = [];
	readonly healZ: number[] = [];
	readonly snapX: number[] = [];
	readonly snapZ: number[] = [];
	private readonly mortarKind = kindOf(MORTAR.id);
	private readonly menderKind = kindOf(MENDER.id);
	/** Per slot after the last tick: the actor id, its flight ticks left (0: not flying), its landing point, its ally. */
	private readonly slotIds: number[] = [];
	private readonly slotLeft: number[] = [];
	private readonly slotLandX: number[] = [];
	private readonly slotLandZ: number[] = [];
	private readonly slotAlly: number[] = [];
	private lastState: Readonly<SimState> | undefined;
	private lastTick = -1;

	/** A new frame: forget the last one's events (the per-slot memory stays: a frame boundary is no transition). */
	reset(): void {
		this.impactX.clear();
		this.impactZ.clear();
		this.healX.clear();
		this.healZ.clear();
		this.snapX.clear();
		this.snapZ.clear();
	}

	/** Every event of this frame (0: nothing happened). */
	count(): number {
		return this.impactX.size() + this.healX.size() + this.snapX.size();
	}

	/** Adds the tick just stepped (call after every step / stepParty). */
	collect(state: Readonly<SimState>): void {
		const fresh = state !== this.lastState || state.tick < this.lastTick;
		this.lastState = state;
		this.lastTick = state.tick;
		const actors = state.combat.actors;
		if (!fresh) {
			this.collectImpacts(state, actors);
			this.collectHeals(state, actors);
		}
		this.remember(actors);
	}

	private collectImpacts(state: Readonly<SimState>, actors: ReadonlyArray<ActorState>): void {
		let left = state.events.shells;
		if (left <= 0) return;
		for (let i = 0; i < this.slotIds.size() && left > 0; i++) {
			if (this.slotLeft[i] !== 1) continue;
			const a = actors[i];
			const stillFlying =
				a !== undefined &&
				a.id === this.slotIds[i] &&
				a.kind === this.mortarKind &&
				a.aiState === MORTAR_FLIGHT &&
				a.v[MORTAR_FLIGHT_TICKS] > 0;
			if (stillFlying) continue;
			this.impactX.push(this.slotLandX[i]);
			this.impactZ.push(this.slotLandZ[i]);
			left--;
		}
	}

	private collectHeals(state: Readonly<SimState>, actors: ReadonlyArray<ActorState>): void {
		const e = state.combat.healEvents;
		for (const slot of e.healSlot) {
			const o = actors[slot];
			if (o === undefined) continue;
			this.healX.push(o.x);
			this.healZ.push(o.z);
		}
		for (let i = 0; i < e.endSlot.size(); i++) {
			if (!healEndCuts(e.endReason[i])) continue;
			const slot = e.endSlot[i];
			const m = actors[slot];
			if (m === undefined) continue;
			const known = this.slotIds[slot] === m.id ? this.slotAlly[slot] : 0;
			const o = actorById(actors, known ?? 0);
			if (o === undefined) {
				this.snapX.push(m.x);
				this.snapZ.push(m.z);
			} else {
				this.snapX.push((m.x + o.x) / 2);
				this.snapZ.push((m.z + o.z) / 2);
			}
		}
	}

	private remember(actors: ReadonlyArray<ActorState>): void {
		for (let i = 0; i < actors.size(); i++) {
			const a = actors[i];
			while (this.slotIds.size() <= i) {
				this.slotIds.push(0);
				this.slotLeft.push(0);
				this.slotLandX.push(0);
				this.slotLandZ.push(0);
				this.slotAlly.push(0);
			}
			const used = a.kind !== NO_KIND && a.id !== 0;
			this.slotIds[i] = used ? a.id : 0;
			const flying = used && a.kind === this.mortarKind && a.aiState === MORTAR_FLIGHT;
			this.slotLeft[i] = flying ? math.max(0, a.v[MORTAR_FLIGHT_TICKS]) : 0;
			this.slotLandX[i] = flying ? a.v[MORTAR_LAND_X] : 0;
			this.slotLandZ[i] = flying ? a.v[MORTAR_LAND_Z] : 0;
			const linked = used && a.kind === this.menderKind && a.alive !== 0 && menderLinked(a);
			this.slotAlly[i] = linked ? a.v[MENDER_ALLY] : 0;
		}
		// A shrunk actor list (a new floor) leaves no stale flight behind.
		for (let i = actors.size(); i < this.slotIds.size(); i++) {
			this.slotIds[i] = 0;
			this.slotLeft[i] = 0;
			this.slotAlly[i] = 0;
		}
	}
}

/** No events (a run view without the set, the specs' default). */
export const NO_NEW_ENEMY_3_EVENTS: NewEnemy3FrameSource = new NewEnemy3FrameEvents();

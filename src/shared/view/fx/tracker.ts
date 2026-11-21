/**
 * Hit tracker (port of project-kaleb-vale src/fx/tracker.ts @ 42897e2): the pure diff core. Once per rendered frame,
 * AFTER the sim advanced, it compares every actor slot with a render-side snapshot keyed by (slot, ActorState.id) and
 * emits FX events (events.ts): hits with the hp lost this frame (aggregated over every tick the frame stepped), kills,
 * runtime spawns, boss phases and defeats, best-effort damage-cap hits, and a reset when a new run starts.
 *
 * Why diff instead of SimEvents: SimEvents are per tick and a frame can step 0..5 ticks, so a renderer only ever sees
 * the LAST tick's events. ActorState (hp, alive, phase, id) is durable, so diffing it never misses a hit or a kill.
 * (Player-side sim events, which have no durable state to diff, reach the audio layer through LiveRun's per-frame
 * event totals instead: shared/view/audio.)
 *
 * Render-side only: reads the live state, never writes it, never feeds anything back into step(). No Roblox API:
 * tested headlessly (tracker.spec.ts). The client wrapper is FxTrackerController.
 *
 * Port changes: typed arrays became plain number arrays (preallocated, so no allocation per update either);
 * `null` -> `undefined`; -Infinity -> -math.huge.
 *
 * @module
 */
import {
	DAMAGE_CAP_BUCKETS,
	DAMAGE_CAP_BUCKET_TICKS,
	DAMAGE_CAP_WINDOW_SECONDS,
	MAX_ACTORS,
	NO_KIND,
	archetypeAt,
	roomAt,
	type ActorState,
	type EncounterConfig,
} from "shared/sim";
import { eliteView, viewAffix, type AffixedState } from "../variants";
import { FX_EVENT_CAPACITY, FxEventBuffer, type FxEvent, type FxEventType } from "./events";

/** A hit that removes at least this much hp in one frame is `heavy` (sword finisher 6, heavy arrow 4; swings 3). */
export const HEAVY_HIT_DAMAGE = 4;
/** At most one 'capped' event per actor per this many ticks (a capped boss under a bow stream would spam it). */
export const CAPPED_EVENT_MIN_TICKS = 12;

/** What the tracker needs from an archetype. Default: archetypeAt(kind).data. Tests pass their own. */
export interface ActorInfo {
	readonly boss?: boolean;
	/** ArchetypeData.damageCapPerSecond (undefined: no cap). */
	readonly damageCapPerSecond?: number;
}
/**
 * Looks up what the tracker needs to know about an archetype index (is it a boss, its damage cap). The tracker calls it
 * for the actors it diffs each frame; the default is describeFromRegistry, specs pass a stub so they need no registered
 * archetypes.
 */
export type DescribeActor = (kind: number) => ActorInfo;

const NO_INFO: ActorInfo = { boss: false };

/** The default describer: the archetype registry. Unknown kinds (stale slot) describe as a plain enemy. */
export const describeFromRegistry: DescribeActor = (kind) => {
	const [ok, data] = pcall(() => archetypeAt(kind).data);
	return ok ? (data as ActorInfo) : NO_INFO;
};

/**
 * The slice of SimState the tracker reads (structural, so tests can pass plain objects). `affixes` (elite affixes,
 * docs/ENEMY_VARIANTS.md EV9): an affixed actor is elite like one in an elite room.
 */
export interface TrackedState extends AffixedState {
	readonly tick: number;
	readonly events: { readonly enemyHits: number };
	readonly combat: { readonly actors: ReadonlyArray<ActorState> };
}

/**
 * Damage the actor's cap window has booked as of `tick` (0 without a cap history). Mirrors the sim's applyDamageCap
 * WITHOUT writing: buckets that would be cleared at `tick` don't count. Pure; render-side.
 */
export function capWindowTaken(a: Readonly<ActorState>, tick: number): number {
	const n = DAMAGE_CAP_BUCKETS;
	if (a.capBucket < 0) return 0;
	const bucket = math.floor(tick / DAMAGE_CAP_BUCKET_TICKS);
	const gap = bucket - a.capBucket;
	if (gap >= n) return 0;
	const live = gap > 0 ? n - gap : n; // buckets capBucket, capBucket-1, ... still inside the window
	let taken = 0;
	for (let k = 0; k < live; k++) taken += a.capWindow[(((a.capBucket - k) % n) + n) % n];
	return taken;
}

/** True when an actor with a damage cap has no room left in its window at `tick` (the next hit would deal 0). */
export function isAtDamageCap(a: Readonly<ActorState>, tick: number, cap: number | undefined): boolean {
	return cap !== undefined && capWindowTaken(a, tick) >= cap * DAMAGE_CAP_WINDOW_SECONDS;
}

function filled(n: number, v: number): number[] {
	const out: number[] = [];
	for (let i = 0; i < n; i++) out.push(v);
	return out;
}

/**
 * The tracker. Call `update(state, alpha, encounter)` once per rendered frame after the sim advanced; read the frame's
 * events from `events`. Detects a new run by state identity (a restart builds a new SimState) or by the tick going
 * backwards, clears the snapshot and emits 'reset'.
 */
export class HitTracker {
	readonly events: FxEventBuffer;
	private readonly describe: DescribeActor;

	// Snapshot per slot (0-based). id 0 = nothing tracked in this slot.
	private readonly snapId = filled(MAX_ACTORS, 0);
	private readonly snapKind = filled(MAX_ACTORS, 0);
	private readonly snapHp = filled(MAX_ACTORS, 0);
	private readonly snapHpMax = filled(MAX_ACTORS, 0);
	private readonly snapAlive = filled(MAX_ACTORS, 0);
	private readonly snapPhase = filled(MAX_ACTORS, 0);
	private readonly snapElite = filled(MAX_ACTORS, 0);
	private readonly snapCappedTick = filled(MAX_ACTORS, 0);
	/** Slots whose hp dropped this frame (scratch for the capped heuristic). */
	private readonly hitThisFrame = filled(MAX_ACTORS, 0);

	private lastState: TrackedState | undefined;
	private lastTick = -1;
	/** Runs seen (1 after the first update; +1 per reset). */
	runs = 0;
	/** Ticks stepped by the last update's frame (0 while paused / in hitstop). */
	ticksThisFrame = 0;

	constructor(options: { describe?: DescribeActor; capacity?: number } = {}) {
		this.describe = options.describe ?? describeFromRegistry;
		this.events = new FxEventBuffer(options.capacity ?? FX_EVENT_CAPACITY);
	}

	/** Forget everything (next update adopts the state silently, without a 'reset' event). */
	clear(): void {
		for (let i = 0; i < MAX_ACTORS; i++) this.snapId[i] = 0;
		this.lastState = undefined;
		this.lastTick = -1;
		this.events.clear();
	}

	private begin(
		eventType: FxEventType,
		slot: number,
		a: Readonly<ActorState>,
		x: number,
		z: number,
		info: ActorInfo,
		tick: number,
	): FxEvent | undefined {
		const e = this.events.emit(eventType, tick);
		if (e === undefined) return undefined;
		e.slot = slot;
		e.actorId = a.id;
		e.kind = a.kind;
		e.x = x;
		e.z = z;
		e.hpMax = a.hpMax;
		e.boss = info.boss === true;
		e.elite = this.snapElite[slot] === 1;
		return e;
	}

	/**
	 * Diff the live state against the snapshot and fill `events` for this frame. `alpha` is the sim's interpolation
	 * alpha (positions are interpolated like the actor renderer); `encounter` (optional, SimConfig.encounter) marks
	 * actors that spawn inside an 'elite' room. Returns the number of events.
	 */
	update(state: TrackedState, alpha: number, encounter?: EncounterConfig): number {
		const ev = this.events;
		ev.clear();
		const tick = state.tick;

		let adopt = false;
		if (state !== this.lastState || tick < this.lastTick) {
			const hadRun = this.lastState !== undefined;
			for (let i = 0; i < MAX_ACTORS; i++) this.snapId[i] = 0;
			this.lastState = state;
			this.lastTick = tick;
			this.runs++;
			adopt = true;
			if (hadRun) ev.emit("reset", tick);
		}
		const ticks = tick - this.lastTick;
		this.ticksThisFrame = ticks;
		this.lastTick = tick;
		// Nothing stepped (paused, hitstop, or a second render in one tick): actors can't have changed.
		if (ticks === 0 && !adopt) return ev.count();

		const actors = state.combat.actors;
		const n = actors.size() < MAX_ACTORS ? actors.size() : MAX_ACTORS;
		let damagedSlots = 0;
		const hit = this.hitThisFrame;

		for (let i = 0; i < MAX_ACTORS; i++) {
			hit[i] = 0;
			const a = i < n ? actors[i] : undefined;
			const present = a !== undefined && a.kind !== NO_KIND;
			// Slot freed or handed to a new actor since the snapshot: forget the old one (never a fake hit / kill).
			if (this.snapId[i] !== 0 && (!present || a.id !== this.snapId[i] || a.kind !== this.snapKind[i])) {
				this.snapId[i] = 0;
			}
			if (!present) continue;

			const info = this.describe(a.kind);
			const x = a.prevX + (a.x - a.prevX) * alpha;
			const z = a.prevZ + (a.z - a.prevZ) * alpha;

			if (this.snapId[i] === 0) {
				this.snapId[i] = a.id;
				this.snapKind[i] = a.kind;
				this.snapHp[i] = a.hp;
				this.snapHpMax[i] = a.hpMax;
				this.snapAlive[i] = a.alive !== 0 ? 1 : 0;
				this.snapPhase[i] = a.phase;
				// Elite: first seen in an elite room (runtime spawns there too, EVD15) OR carrying an affix (EVD12).
				const eliteRoom = encounter !== undefined && roomAt(encounter, a.x, a.z)?.type === "elite";
				this.snapElite[i] = eliteView(eliteRoom, viewAffix(state, i, a.id)) ? 1 : 0;
				this.snapCappedTick[i] = -math.huge;
				// The run's first frame adopts the initial encounter silently; later arrivals are runtime spawns.
				if (!adopt) this.begin("spawned", i, a, x, z, info, tick);
				continue;
			}

			const wasAlive = this.snapAlive[i] === 1;
			const prevHp = this.snapHp[i];
			if (wasAlive && a.hp < prevHp) {
				const e = this.begin("hit", i, a, x, z, info, tick);
				hit[i] = 1;
				damagedSlots++;
				if (e !== undefined) {
					e.damage = prevHp - a.hp;
					e.hpAfter = a.hp;
					e.heavy = e.damage >= HEAVY_HIT_DAMAGE;
					e.capped = isAtDamageCap(a, tick - 1, info.damageCapPerSecond);
				}
			}
			if (wasAlive && a.alive === 0) {
				this.begin("killed", i, a, x, z, info, tick);
				if (info.boss === true) this.begin("bossDefeated", i, a, x, z, info, tick);
			} else if (!wasAlive && a.alive !== 0) {
				const e = this.begin("spawned", i, a, x, z, info, tick);
				if (e !== undefined) e.revived = true;
			}
			if (a.phase !== this.snapPhase[i] && info.boss === true && a.alive !== 0) {
				const e = this.begin("bossPhase", i, a, x, z, info, tick);
				if (e !== undefined) e.phase = a.phase;
			}

			this.snapHp[i] = a.hp;
			this.snapHpMax[i] = a.hpMax;
			this.snapAlive[i] = a.alive !== 0 ? 1 : 0;
			this.snapPhase[i] = a.phase;
		}

		// Capped damage (best effort): the last stepped tick counted more enemy hits than the slots that lost hp this
		// frame, and an actor with a full cap window took nothing -> those hits were probably absorbed by the cap.
		if (!adopt && ticks > 0 && state.events.enemyHits > damagedSlots) {
			for (let i = 0; i < n; i++) {
				if (this.snapId[i] === 0 || hit[i] === 1 || this.snapAlive[i] === 0) continue;
				const a = actors[i];
				const info = this.describe(a.kind);
				if (!isAtDamageCap(a, tick - 1, info.damageCapPerSecond)) continue;
				if (tick - this.snapCappedTick[i] < CAPPED_EVENT_MIN_TICKS) continue;
				this.snapCappedTick[i] = tick;
				const x = a.prevX + (a.x - a.prevX) * alpha;
				const z = a.prevZ + (a.z - a.prevZ) * alpha;
				const e = this.begin("capped", i, a, x, z, info, tick);
				if (e !== undefined) e.capped = true;
			}
		}
		return ev.count();
	}
}

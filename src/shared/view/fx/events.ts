/**
 * FX events (port of project-kaleb-vale src/fx/events.ts @ 42897e2): what the hit tracker (tracker.ts) saw change in
 * the live sim during one rendered frame. Render-side only: derived by diffing ActorState against a render-side
 * snapshot, never written back into the sim.
 *
 * Events live in a preallocated pool (FxEventBuffer) that is cleared at the start of every tracker update, so an event
 * object is valid only during the frame it was emitted in (copy what you keep). No allocation per frame.
 *
 * @module
 */

/** Event kinds. Fields valid per kind are listed on FxEvent. */
export type FxEventType =
	/** A new run started (R): drop every effect you hold. Always the first event of its frame. */
	| "reset"
	/** An actor lost hp this frame (aggregated over every tick the frame stepped). */
	| "hit"
	/** An actor died this frame (alive 1 -> 0). A killing blow also emits its 'hit' first, in the same frame. */
	| "killed"
	/** A new actor appeared in a slot after the run's first frame (runtime spawn), or a dead one came back (revived). */
	| "spawned"
	/** Best effort: hits landed on an actor at its damage cap and took no hp. */
	| "capped"
	/** A boss actor's phase changed (ActorState.phase). */
	| "bossPhase"
	/** A boss actor died (emitted right after its 'killed'). */
	| "bossDefeated";

/**
 * One FX event. A single flat shape for every kind (pool friendly); fields that don't apply to a kind hold their
 * neutral value (0 / false).
 *
 * | field            | reset | hit | killed | spawned | capped | bossPhase | bossDefeated |
 * | slot, actorId    |       |  x  |   x    |    x    |   x    |     x     |      x       |
 * | kind, x, z       |       |  x  |   x    |    x    |   x    |     x     |      x       |
 * | damage, hpAfter  |       |  x  |        |         |        |           |              |
 * | hpMax, boss      |       |  x  |   x    |    x    |   x    |     x     |      x       |
 * | elite            |       |  x  |   x    |    x    |   x    |           |              |
 * | heavy, capped    |       |  x  |        |         |  (x)   |           |              |
 * | phase            |       |     |        |         |        |     x     |              |
 * | revived          |       |     |        |    x    |        |           |              |
 */
export interface FxEvent {
	type: FxEventType;
	/** Actor pool slot (index into state.combat.actors, 0-based). -1 for 'reset'. */
	slot: number;
	/** ActorState.id (unique per run): key effects by (slot, actorId), never by slot alone. */
	actorId: number;
	/** Archetype index (archetypeAt(kind) gives the def: spriteId, data.boss, ...). */
	kind: number;
	/** Interpolated sim position at this frame's alpha (where the actor renderer draws its feet). */
	x: number;
	z: number;
	/** hit: hp lost this frame (sum over the ticks stepped this frame). */
	damage: number;
	/** hit: hp after the frame. */
	hpAfter: number;
	hpMax: number;
	/** hit: damage >= HEAVY_HIT_DAMAGE this frame (sword finisher 6, heavy arrow 4). Presentation only. */
	heavy: boolean;
	/** archetypeAt(kind).data.boss === true. */
	boss: boolean;
	/** The actor spawned inside an encounter room of type 'elite' (render-side; there is no elite flag in the sim). */
	elite: boolean;
	/** hit: the damage-cap window was full after this hit (part of it was probably absorbed). capped: always true. */
	capped: boolean;
	/** bossPhase: the new phase. */
	phase: number;
	/** spawned: a dead actor came back in place (same id; e.g. respawning turrets), not a new actor. */
	revived: boolean;
	/** state.tick when the event was emitted (after the frame's ticks). */
	tick: number;
}

function blankEvent(): FxEvent {
	return {
		type: "reset",
		slot: -1,
		actorId: 0,
		kind: -1,
		x: 0,
		z: 0,
		damage: 0,
		hpAfter: 0,
		hpMax: 0,
		heavy: false,
		boss: false,
		elite: false,
		capped: false,
		phase: 0,
		revived: false,
		tick: 0,
	};
}

/** Events one frame can hold. Overflow drops the newest (counted in `dropped`); a frame rarely needs more than ~20. */
export const FX_EVENT_CAPACITY = 256;

/**
 * Fixed pool of FxEvent objects, refilled every frame: `clear()` then `emit(type)` hands out the next pooled object
 * (all fields reset), or undefined when full. Readers use `count()` and `at(i)` (0-based).
 */
export class FxEventBuffer {
	readonly capacity: number;
	private readonly pool: FxEvent[] = [];
	private n = 0;
	/** Events dropped this frame because the pool was full. */
	dropped = 0;
	/** Events dropped since creation (debug HUD / tests). */
	droppedTotal = 0;

	constructor(capacity: number = FX_EVENT_CAPACITY) {
		this.capacity = capacity;
		for (let i = 0; i < capacity; i++) this.pool.push(blankEvent());
	}

	count(): number {
		return this.n;
	}

	clear(): void {
		this.n = 0;
		this.dropped = 0;
	}

	/** The next pooled event, reset to neutral values with `type` set; undefined (and counted) when the pool is full. */
	emit(eventType: FxEventType, tick: number): FxEvent | undefined {
		if (this.n >= this.capacity) {
			this.dropped++;
			this.droppedTotal++;
			return undefined;
		}
		const e = this.pool[this.n];
		this.n++;
		e.type = eventType;
		e.slot = -1;
		e.actorId = 0;
		e.kind = -1;
		e.x = 0;
		e.z = 0;
		e.damage = 0;
		e.hpAfter = 0;
		e.hpMax = 0;
		e.heavy = false;
		e.boss = false;
		e.elite = false;
		e.capped = false;
		e.phase = 0;
		e.revived = false;
		e.tick = tick;
		return e;
	}

	/** Event i of this frame (0 <= i < count()). */
	at(i: number): FxEvent {
		return this.pool[i];
	}
}

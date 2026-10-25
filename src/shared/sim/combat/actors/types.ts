/**
 * Actor model (E1.8; source: `src/sim/actors/types.ts`): every enemy and boss is an ActorState (plain numbers) driven
 * by an ArchetypeDef (code + data) from the archetype registry.
 */

import type { SimCtx } from "../ctx";

/** ActorState.kind of a free pool slot. */
export const NO_KIND = -1;
/** Length of ActorState.v, the archetype's own numeric scratch slots. */
export const ACTOR_SCRATCH_SLOTS = 8;

/**
 * Shared ActorState.aiState values. Archetypes own aiState otherwise: use AiState.CUSTOM and up for their own states.
 *   IDLE       0  default after spawn
 *   TELEGRAPH  1  winding up an attack (enter it with ctx.telegraph(actor, ticks, attack))
 *   CUSTOM     2  first value free for archetype-specific states
 */
export const AiState = {
	IDLE: 0,
	TELEGRAPH: 1,
	CUSTOM: 2,
} as const;

/**
 * One enemy or boss. PLAIN NUMBERS ONLY (plus two fixed-length number arrays): it is hashed field by field in
 * ACTOR_HASH_FIELDS order, then capWindow, then v. Archetypes may write any field; the generic code owns the ones
 * marked (generic).
 */
export interface ActorState {
	/** Serial number, unique for the run (CombatState.nextActorId). 0 for a free slot. (generic) */
	id: number;
	/** Archetype index (archetypeIndex(id)), NO_KIND (-1) for a free slot. (generic) */
	kind: number;
	/** Tick it was spawned on; -1 for the run's initial encounter. Not stepped on its spawn tick. (generic) */
	spawnTick: number;
	x: number;
	z: number;
	/** Position at the start of the tick, for render interpolation. Set by the generic loop before step(). */
	prevX: number;
	prevZ: number;
	/** Facing, a unit vector (render picks the sprite row from it). */
	faceX: number;
	faceZ: number;
	hp: number;
	hpMax: number;
	/** Body radius, world units: player bullets, melee arcs and contact damage use it. Starts as data.radius. */
	radius: number;
	/** 1 alive, 0 dead (lingering as a corpse until its slot is freed, or waiting for stepDead to revive it). */
	alive: number;
	/** Ticks since death (counted by the generic loop while dead). */
	deadTicks: number;
	/** AI state (AiState.IDLE / TELEGRAPH, or the archetype's own >= AiState.CUSTOM). */
	aiState: number;
	/** Archetype-owned timer (e.g. ticks left in the current aiState; ctx.telegraph sets it to the wind-up). */
	aiTicks: number;
	/** Archetype-owned attack id (which attack is telegraphed / running). */
	attack: number;
	/** Archetype-owned cooldown in ticks. */
	cooldown: number;
	/** Hit flash ticks left; set by damage, counted down by the generic loop. Render only reads it. */
	flashTicks: number;
	/** Its emitter id in the enemy bullet simulation, stamped on every bullet it fires. (generic) */
	emitterId: number;
	/** Boss phase (0 for regular enemies). Change it with ctx.setPhase so events.bossPhase fires. */
	phase: number;
	/** Damage cap bookkeeping: the last bucket number written (tick / DAMAGE_CAP_BUCKET_TICKS), -1 none. (generic) */
	capBucket: number;
	/** Damage cap bookkeeping: damage booked per bucket (DAMAGE_CAP_BUCKETS numbers, ring buffer). (generic) */
	capWindow: number[];
	/** Archetype scratch: ACTOR_SCRATCH_SLOTS numbers, all 0 at spawn. Name your slots with constants. */
	v: number[];
}

export type ActorScalarField = Exclude<keyof ActorState, "capWindow" | "v">;

/** The scalar ActorState fields, in hash order. Append only. */
export const ACTOR_HASH_FIELDS: ReadonlyArray<ActorScalarField> = [
	"id",
	"kind",
	"spawnTick",
	"x",
	"z",
	"prevX",
	"prevZ",
	"faceX",
	"faceZ",
	"hp",
	"hpMax",
	"radius",
	"alive",
	"deadTicks",
	"aiState",
	"aiTicks",
	"attack",
	"cooldown",
	"flashTicks",
	"emitterId",
	"phase",
	"capBucket",
];

/**
 * Gameplay data of an archetype (rule 4: numbers live here, never in art). Extend it with your own fields:
 * `interface SwarmerData extends ArchetypeData { packSize: number }` and `ArchetypeDef<SwarmerData>`.
 */
export interface ArchetypeData {
	/** Hit points at spawn. */
	hp: number;
	/** Body radius, world units. */
	radius: number;
	/** Walk speed, world units per second. */
	speed: number;
	/** Half hearts dealt by touching the player (0 = harmless body). Checked every tick by the generic loop. */
	contactDamage: number;
	/** Logical theme sprite ID (enemy.* or boss.*). */
	spriteId: string;
	/** Draw scale (default 1). Presentation only. */
	spriteScale?: number;
	/** Boss: drawn larger and counted as a boss by HUD / telemetry. */
	boss?: boolean;
	/** Most damage taken per ~second (rolling window, see DAMAGE_CAP_BUCKETS); omit for no cap. */
	damageCapPerSecond?: number;
	/** Ticks a corpse keeps its slot before it is freed (default CORPSE_TICKS). Ignored when stepDead is defined. */
	corpseTicks?: number;
}

/**
 * An archetype: an id, its data and its behaviour. Hooks run inside the fixed-step sim (determinism rules apply).
 * Every hook gets the shared SimCtx first. Register with registerArchetype(def) from its own file.
 * Hooks are METHODS (roblox-ts calls them with `:`): implement them with method syntax, not arrow properties.
 */
export interface ArchetypeDef<D extends ArchetypeData = ArchetypeData> {
	/** Unique id, lowercase dot-separated, e.g. 'swarmer', 'turret.sniper', 'boss.warden'. */
	readonly id: string;
	readonly data: D;
	/** After the generic fields are set (hp, radius, position, emitter, v all 0). Optional. */
	init?(ctx: SimCtx, actor: ActorState): void;
	/** Once per tick while alive (slot order). AI, movement, firing, spawning. */
	step(ctx: SimCtx, actor: ActorState): void;
	/** Once per tick while dead (after deadTicks += 1). Without it the slot is freed after data.corpseTicks. */
	stepDead?(ctx: SimCtx, actor: ActorState): void;
	/** Adjusts incoming damage before the cap and hp (return 0 for immune). */
	filterDamage?(ctx: SimCtx, actor: ActorState, damage: number): number;
	/** After damage was applied (damage = what actually came off hp, may be 0 when capped), before a death check. */
	onHit?(ctx: SimCtx, actor: ActorState, damage: number): void;
	/** When hp reaches 0 (alive is already 0). */
	onDeath?(ctx: SimCtx, actor: ActorState): void;
}

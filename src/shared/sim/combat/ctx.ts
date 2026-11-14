/**
 * SimCtx (E1.8; source: `src/sim/ctx.ts`): the one object every archetype hook and weapon hook receives. A thin,
 * allocation-free facade over the live SimState for the current tick: read state through it, act on the world through
 * its methods. One instance is re-bound each tick by stepCombat (and by createSimState for the initial spawns); never
 * keep it across ticks, and never call it from render code.
 *
 * Port note: the source's getters (`tick`, `player`, `combat`, `events`, `actors`) are plain fields refreshed by
 * `bind()`. That is equivalent because none of them changes identity or value while a tick's combat phase runs
 * (`state.tick` increments only after stepCombat returns; `player`, `events`, `combat` and `combat.actors` are never
 * replaced). Call `bind()` again after replacing any of them.
 *
 * Co-op (M4, ../party.ts): `player` / `playerIndex` are the player the current hook is about, `weapons` / `input` the
 * acting player's. `bind()` binds player 0 (all a solo run ever sees). stepCombat re-binds them per phase:
 *   actor hooks (step / stepDead)  targetNearest(actor): the nearest living player (ties: lower index)
 *   weapons                        bindPlayer(i, input i), players in index order
 *   player bullet hits             actingPlayer(owner): the bullet's owner (onHit / onDeath see who hit them)
 *   contact damage, enemy bullets  hurtPlayerAt(i, ...) per player in index order
 * `input` outside the weapons phase is player 0's (the boss's DEBUG_BOSS edge reads it).
 */

import { Button, EMPTY_INPUT, type InputFrame } from "../input";
import { rngInt, rngNext } from "../rng";
import { damagePlayer } from "../player";
import type { PlayerState, SimEvents, SimState } from "../state";
import type { SimConfig } from "../step";
import type { CombatState } from "./combat";
import { BulletKind, fireBurst, type BurstSpec } from "./patterns";
import { scaledEnemyBulletSpeedMultiplier } from "../endlessData";
import { tutorialScalingFloor } from "../tutorial/tutorial";
import { archetypeAt, archetypeIndex } from "./actors/registry";
import { AiState, type ActorState, type ArchetypeData, type ArchetypeDef } from "./actors/types";
import { EMPTY_ENCOUNTER, roomAt, type EncounterConfig, type EncounterRoom } from "./actors/encounter";
import { damageActor, freeActor, killActor, reviveActor, spawnActor } from "./actors/actors";
import { lineOfSight } from "./actors/helpers";
import { teamEnemyBulletSpeedMultiplier } from "../progression/runMods";
import type { WeaponSlotState, WeaponsState } from "./weapons/types";
import { nearestLivingPlayer, playerAt, weaponsAt } from "../party";
import { PERCENT } from "../progression/progressionData";
import { WARBANNER, warbannerAuraMask } from "./actors/archetypes/warbanner";

export class SimCtx {
	/** The live state (mutable). */
	state!: SimState;
	/** The run's SimConfig (read-only; same for live play and replays). */
	config: Readonly<SimConfig> = {};
	/** This tick's input (weapons read FIRE / aim through it; enemies should not read input). */
	input: Readonly<InputFrame> = EMPTY_INPUT;
	/** config.encounter, or an empty one: rooms (arena bounds), boss / entrance room indices, initial spawns. */
	encounter: EncounterConfig = EMPTY_ENCOUNTER;

	// --- State (the source's getters; refreshed by bind) --------------------------------------------
	/** The tick being stepped (state.tick; it increments after stepCombat). */
	tick = 0;
	player!: PlayerState;
	/** Index of `player` (0 in a solo run). */
	playerIndex = 0;
	/** The acting player's weapon sets (weapons phase; player 0's otherwise). */
	weapons!: WeaponsState;
	combat!: CombatState;
	events!: SimEvents;
	/** The actor pool, in slot order (free slots have kind NO_KIND). */
	actors!: ActorState[];
	/**
	 * Builds (docs/BUILDS.md BU3, sim/builds procs.ts): the generation a kill made by the damage being dealt now would
	 * give its proc. 0 (the player's own swing / arrow / ring / reflected bullet) except while a player bullet hits
	 * (killGenOfSource of its payload source: an effect bullet of generation g gives g + 1) and while a Chain Spark of a
	 * generation-g proc strikes (g + 1). Read only by buildsOnKill (with state.builds); never hashed.
	 */
	procGen = 0;
	/**
	 * Builds (docs/BUILDS.md BU6, sim/builds effectsData.ts KillCause): what deals the damage being dealt now, set and
	 * reset beside procGen: SPARK while a spark strikes, BURST while a Volatile bolt hits, else NONE. Read only by
	 * buildsOnKill (Chain Reaction); never hashed.
	 */
	procCause = 0;
	/**
	 * Builds (docs/LEGENDARIES.md LG2, sim/builds execute.ts buildsKillCarry): the Overkill carry of the kill being
	 * made now. Set by actors.ts damageActor on its kill line just before buildsOnKill and back to 0 right after (so 0
	 * everywhere else); buildsOnKill copies it into the proc's `excess`. Transient, never hashed.
	 */
	killCarry = 0;
	/**
	 * The Warbanner aura mask (docs/NEW_ENEMIES.md NE6, NED8): buffed actor -> its actor id when the mask was built.
	 * Transient, never hashed: rebuildAura fills it at the START of stepActors from the tick-start actor pool
	 * (`warbannerAuraMask`, a pure function of hashed state), it holds for the rest of that tick, and bind() empties it,
	 * so before stepActors (or on a ctx that never steps actors: initial / endless room spawns) nobody is buffed. The
	 * id check makes a slot freed and reused mid-tick read as unbuffed (actor ids are unique for the run).
	 */
	readonly auraMask = new Map<ActorState, number>();
	/**
	 * Siege Bolt's held actors (docs/BUILDS_V2.md BV4, sim/builds siege.ts): pinned actor -> its actor id when the mask
	 * was built. Transient, never hashed, the aura mask's construction: rebuildPins fills it at the START of stepActors
	 * from state.builds.pins (carrying records only; a pure function of hashed state), bind() empties it.
	 */
	readonly pinMask = new Map<ActorState, number>();
	/**
	 * The Bulwark's guard list (docs/NEW_ENEMIES_2.md NX2, ../shield.ts): the actor slots of every guarding Bulwark no pin
	 * holds. Transient, never hashed: combat.ts fills it right after the actor phase (shield.ts guardSlots, a pure
	 * function of the hashed pool), bind() empties it, so a ctx that never steps combat sees no shield.
	 */
	readonly guards: number[] = [];

	bind(state: SimState, config: Readonly<SimConfig>, input: Readonly<InputFrame>): this {
		this.state = state;
		this.config = config;
		this.input = input;
		this.encounter = config.encounter ?? EMPTY_ENCOUNTER;
		this.tick = state.tick;
		this.player = state.player;
		this.playerIndex = 0;
		this.weapons = state.combat.weapons;
		this.combat = state.combat;
		this.events = state.events;
		this.actors = state.combat.actors;
		this.procGen = 0;
		this.procCause = 0;
		this.killCarry = 0;
		this.auraMask.clear();
		this.pinMask.clear();
		this.guards.clear();
		return this;
	}

	// --- The Warbanner's aura (NE6; read through actorMods.ts auraWalkPercent / auraCooldownPercent) ------------

	/** stepActors, first thing: the aura mask from the actor pool as the tick starts. */
	rebuildAura(): void {
		warbannerAuraMask(this.actors, this.auraMask);
	}

	/** stepActors, first thing: Siege Bolt's held actors from state.builds.pins (empty without builds or pins). */
	rebuildPins(): void {
		this.pinMask.clear();
		const pins = this.state.builds?.pins;
		if (pins === undefined) return;
		for (const pin of pins) {
			if (pin.slot < 0) continue;
			const a = this.actors[pin.slot];
			if (a !== undefined) this.pinMask.set(a, pin.id);
		}
	}

	/** True when `a` is held by a Siege Bolt pin (this tick's rebuildPins; slot reuse reads as free by the id). */
	isPinned(a: Readonly<ActorState>): boolean {
		return this.pinMask.size() > 0 && this.pinMask.get(a as ActorState) === a.id;
	}

	/** True when `a` stood inside a living Warbanner's aura at this tick's rebuild (one aura at most: no stacking). */
	inAura(a: Readonly<ActorState>): boolean {
		return this.auraMask.get(a as ActorState) === a.id;
	}

	/** The aura's walk percent on `a`: WARBANNER auraWalkPercent (125) inside the mask, else PERCENT. */
	auraWalk(a: Readonly<ActorState>): number {
		return this.inAura(a) ? WARBANNER.data.auraWalkPercent : PERCENT;
	}

	/** The aura's attack cooldown percent on `a`: WARBANNER auraCooldownPercent (80) inside the mask, else PERCENT. */
	auraCooldown(a: Readonly<ActorState>): number {
		return this.inAura(a) ? WARBANNER.data.auraCooldownPercent : PERCENT;
	}

	// --- Co-op player binding (see the class comment) --------------------------------------------

	/** Binds player `i` as the acting player (player, playerIndex, weapons) with this tick's `input` for them. */
	bindPlayer(i: number, input: Readonly<InputFrame>): void {
		this.actingPlayer(i);
		this.input = input;
	}

	/** Player `i` becomes `player` / `playerIndex` / `weapons` (input unchanged). */
	actingPlayer(i: number): void {
		this.player = playerAt(this.state, i);
		this.playerIndex = i;
		this.weapons = weaponsAt(this.state, i);
	}

	/** `player` / `playerIndex` = the nearest living player to `actor` (ties: lower index; nobody alive: 0). */
	targetNearest(actor: Readonly<ActorState>): void {
		const i = nearestLivingPlayer(this.state, actor.x, actor.z);
		this.player = playerAt(this.state, i);
		this.playerIndex = i;
	}

	// --- Randomness (the sim's own mulberry32 stream; hashed and replayed) -----------------------

	/** Float in [0, 1). Advances state.rngState. */
	random(): number {
		return rngNext(this.state);
	}
	/** Integer in [min, max], both inclusive. Advances state.rngState. */
	randomInt(min: number, max: number): number {
		return rngInt(this.state, min, max);
	}

	// --- Archetypes ---------------------------------------------------------------------------------

	/** The def driving `actor`. */
	def(actor: Readonly<ActorState>): ArchetypeDef {
		return archetypeAt(actor.kind);
	}
	/** The archetype data of `actor`, typed as your data interface. */
	data<D extends ArchetypeData = ArchetypeData>(actor: Readonly<ActorState>): D {
		return archetypeAt(actor.kind).data as D;
	}
	/** Numeric kind of an archetype id. */
	kindOf(id: string): number {
		return archetypeIndex(id);
	}

	// --- Actors (the pool rules in ./actors/actors.ts) ------------------------------------------------

	/** Spawns archetype `kindId` at (x, z) into the lowest free slot; undefined when the pool is full. */
	spawnActor(kindId: string, x: number, z: number): ActorState | undefined {
		return spawnActor(this, archetypeIndex(kindId), x, z);
	}
	/** Damages a live actor (filterDamage -> damage cap -> hp -> flash -> onHit -> death). Returns hp removed. */
	damageActor(actor: ActorState, amount: number): number {
		return damageActor(this, actor, amount);
	}
	/** Kills a live actor at once (hp 0, onDeath, events.actorsKilled). */
	killActor(actor: ActorState): void {
		killActor(this, actor);
	}
	/** Brings a dead actor back with full hp (keeps its slot, id, emitter and scratch). */
	reviveActor(actor: ActorState): void {
		reviveActor(actor);
	}
	/** Frees the slot now (alive or dead): no onDeath. Its bullets keep flying. */
	freeActor(actor: ActorState): void {
		freeActor(this, actor);
	}

	// --- Player -------------------------------------------------------------------------------------

	/**
	 * Damages `player` (the bound player: the target in actor hooks) through damagePlayer (the one damage entry point)
	 * and, if the hit landed, records events.lastHitSource = `source` (an archetype index; -1 unknown). Returns whether
	 * it landed.
	 */
	hurtPlayer(halfHearts: number, source = -1): boolean {
		const landed = damagePlayer(this.state, halfHearts, this.player, this.playerIndex);
		if (landed) this.state.events.lastHitSource = source;
		return landed;
	}

	/** hurtPlayer for player `i` (co-op collisions), whoever is bound. */
	hurtPlayerAt(i: number, halfHearts: number, source = -1): boolean {
		const landed = damagePlayer(this.state, halfHearts, playerAt(this.state, i), i);
		if (landed) this.state.events.lastHitSource = source;
		return landed;
	}

	// --- Bullets ------------------------------------------------------------------------------------

	/**
	 * Fires `spec` from `actor` (default origin: its position) toward the unit direction (dirX, dirZ) into the enemy
	 * bullet simulation, stamped with its emitter id and payload source = kind + 1. Returns bullets spawned.
	 * Endless mode: the bullets' speed is scaled by the floor (enemyBulletSpeedMultiplier, with the M2 Haste curse:
	 * a world curse, applied once if any player took it); the shape is not.
	 */
	fireEnemy(
		actor: Readonly<ActorState>,
		dirX: number,
		dirZ: number,
		spec: BurstSpec,
		x = actor.x,
		z = actor.z,
	): number {
		const c = this.state.combat;
		const endless = this.state.endless;
		const speedScale =
			endless !== undefined
				? scaledEnemyBulletSpeedMultiplier(
						tutorialScalingFloor(this.state, endless.floor),
						teamEnemyBulletSpeedMultiplier(this.state),
				  )
				: 1;
		const n = fireBurst(c.enemyBullets, actor.emitterId, x, z, dirX, dirZ, spec, actor.kind + 1, speedScale);
		c.enemySpawned += n;
		c.dropped += spec.count - n;
		if (spec.kind === BulletKind.GOO) this.state.events.gooSpawned += n; // the enemy-shoot sound skips goo
		else if (spec.kind === BulletKind.STRIKE) this.state.events.strikes += n; // and strikes (NE5)
		return n;
	}

	/**
	 * Fires `spec` for the weapon in `slot` from (x, z) toward (dirX, dirZ) into the player bullet simulation
	 * (payload source = weapon index + 1, emitter = the acting player's: its owner); sets events.shotsFired. Returns
	 * bullets spawned.
	 */
	firePlayer(
		slot: Readonly<WeaponSlotState>,
		x: number,
		z: number,
		dirX: number,
		dirZ: number,
		spec: BurstSpec,
	): number {
		const c = this.state.combat;
		const n = fireBurst(c.playerBullets, this.weapons.emitterId, x, z, dirX, dirZ, spec, slot.weapon + 1);
		c.playerSpawned += n;
		c.dropped += spec.count - n;
		this.state.events.shotsFired = 1;
		return n;
	}

	// --- AI helpers ---------------------------------------------------------------------------------

	/** Starts a telegraphed wind-up: aiState TELEGRAPH, aiTicks = `ticks`, attack = `attack`, events.telegraphs += 1. */
	telegraph(actor: ActorState, ticks: number, attack: number): void {
		actor.aiState = AiState.TELEGRAPH;
		actor.aiTicks = ticks;
		actor.attack = attack;
		this.state.events.telegraphs += 1;
	}

	/** Sets a boss phase; when it changes, events.bossPhase = the new phase. */
	setPhase(actor: ActorState, phase: number): void {
		if (actor.phase === phase) return;
		actor.phase = phase;
		this.state.events.bossPhase = phase;
	}

	// --- World --------------------------------------------------------------------------------------

	/** True when a bullet at (x, z) would be stopped by the world (config.isBulletBlocked; false without one). */
	isBlocked(x: number, z: number): boolean {
		const b = this.config.isBulletBlocked;
		return b !== undefined && b(x, z);
	}
	/** True when a body cannot stand in the cell under (x, z) (config.isBodyBlocked, else isBlocked). */
	isBodyBlocked(x: number, z: number): boolean {
		const b = this.config.isBodyBlocked;
		return b !== undefined ? b(x, z) : this.isBlocked(x, z);
	}
	/** True when nothing bullet-blocking lies on the segment between the two points (tile DDA; true without a blocker). */
	lineOfSight(x0: number, z0: number, x1: number, z1: number): boolean {
		return lineOfSight(this.config.isBulletBlocked, x0, z0, x1, z1);
	}
	/** The encounter room containing (x, z), or undefined. */
	roomAt(x: number, z: number): EncounterRoom | undefined {
		return roomAt(this.encounter, x, z);
	}
	/** The boss room, or undefined (no dungeon / no encounter rooms). */
	bossRoom(): EncounterRoom | undefined {
		const i = this.encounter.bossRoom;
		return i >= 0 ? this.encounter.rooms[i] : undefined;
	}

	// --- Input (weapons) ----------------------------------------------------------------------------

	/** FIRE is held this tick. */
	fireHeld(): boolean {
		return bit32.band(this.input.buttons, Button.FIRE) !== 0;
	}
	/** FIRE was pressed this tick (edge against last tick). */
	firePressed(): boolean {
		return (
			bit32.band(this.input.buttons, Button.FIRE) !== 0 && bit32.band(this.weapons.prevButtons, Button.FIRE) === 0
		);
	}
	/** FIRE was released this tick (edge; for charge-and-release weapons). */
	fireReleased(): boolean {
		return (
			bit32.band(this.input.buttons, Button.FIRE) === 0 && bit32.band(this.weapons.prevButtons, Button.FIRE) !== 0
		);
	}
}

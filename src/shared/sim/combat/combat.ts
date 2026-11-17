/**
 * Combat simulation (E1.6, generalized in E1.8; source: `src/sim/combat.ts`): authoritative bullets, the actor pool,
 * the player's weapon sets, hits on the player, wall culling, the Ember bullet clear and the stress emitter. Runs after
 * stepPlayer() each tick. Deterministic, same rules as step.ts.
 *
 * stepCombat order (fixed; part of the determinism contract):
 *   1. Ember: events.emberUsed -> enemyBullets.clear() (every enemy bullet)
 *   2. actors, in slot order (stepActors): AI, movement, firing, runtime spawns (stepped from the next tick on); then
 *      (elite affixes, only with state.affixes) the affix phase (stepAffixes: shield refills, Vengeful rings); then the
 *      Bulwark's guard list (./shield.ts guardSlots into ctx.guards, docs/NEW_ENEMIES_2.md NX2; empty without one)
 *   3. the stress emitter
 *   4. the player's weapons (stepWeapons: cooldowns, SWAP, trigger -> fire / melee sweep)
 *   5. step both simulations by SIM_DT (./bullets.ts, the ported r3f-projectiles pool); M2 Hourglass (endless runs):
 *      enemy bullets step by SIM_DT x HOURGLASS_TIME_SCALE for 1 s after a hit landed on a player holding it
 *   5b. Siege Bolt (only with state.builds pins, docs/BUILDS_V2.md BV4): sim/builds siege.ts stepPins drops the pins of
 *      expired arrows and drags each pinned actor onto its arrow (nothing spawns a player bullet between 5 and 6)
 *   6. collisions, one forEachActive walk per simulation:
 *        enemy bullets:  wall (consume) -> [breakables: an intact piece's cell (consume, damage it)] -> [scoring:
 *                        graze flags] -> player circle -> ctx.hurtPlayer; consumed ONLY if the hit landed (a HOOK,
 *                        docs/NEW_ENEMIES_2.md NX3: chainhookStrike instead, consumed on a hittable player, a latch
 *                        only on its thrower's target)
 *        player bullets: wall (consume) -> [breakables: an intact piece's cell: its payload damage; consumed unless
 *                        piercing AND it broke the piece] -> [a guarding Bulwark's shield (consume; ./shield.ts)] ->
 *                        first live actor in range, slot order (ctx.damageActor,
 *                        consume); piercing ones pass through actors (piercingBulletHit). M2 Sharpened (endless
 *                        runs): the payload damage x 1.25 when it hits (playerHitDamage)
 *   6b. builds (only with state.builds, docs/BUILDS.md BU3 / BU5): sim/builds procs.ts stepBuilds: the evolutions'
 *      pre-drain phase (Ricochet splits, Soul Swarm steering, novas, Thrill Seeker), the proc queue (on-kill effects;
 *      sparks damage here, bursts / shards spawn here and first move next tick), Momentum. A player bullet's hit binds
 *      ctx.procGen from its payload source (an effect bullet's kill procs one generation on) and ctx.procCause (BU6:
 *      BURST for a Volatile bolt). In 6, Phantom Step (Slippery III) erases enemy bullets over a rolling owner, a
 *      piercing hit calls buildsOnPierceHit, and every actor hit by a player bullet calls buildsOnArrowHit (BU6: Storm
 *      Blade, Conductor). 6b also runs the duos (Close Call, Fire Arrows / Blazing Trail embers, Storm Blade /
 *      Conductor sparks, Chain Reaction)
 *   7. contact damage: the first live actor with data.contactDamage > 0 touching the player (stepContactDamage)
 *
 * Exact against every golden run, with and without actors (run-full-1337 / run-boss-1337 included).
 *
 * Co-op (M4, ../party.ts; only with state.party, so every solo run takes exactly the paths above):
 *   2. every actor hook runs with ctx.player = its target, the nearest living player (stepActors)
 *   4. each player's weapons in player index order (ctx.bindPlayer(i, inputs[i])); events.weaponSwapped is that
 *      player's own while its weapons step (then OR-ed into the tick's event)
 *   6. enemy bullets: [scoring: graze flags against the nearest living player] -> players in index order, the first
 *      hit that lands consumes the bullet; player bullets: ctx.player = the bullet's owner (emitter - 1) for the hit
 *   7. contact damage per living player, index order (stepContactDamage)
 * M2 modifiers in co-op (progression/runMods.ts): a player bullet's damage uses its OWNER's mods (Sharpened), the
 * graze radius the grazing player's (Daredevil); the Hourglass slow is global while ANY player's timer runs.
 */

import { SIM_DT } from "../units";
import { PLAYER_RADIUS } from "../playerData";
import { EMPTY_INPUT, type InputFrame } from "../input";
import type { SimState } from "../state";
import type { BulletBlocker, SimConfig } from "../step";
import {
	ENEMY_BULLET_LIFE,
	ENEMY_BULLET_RADIUS,
	FALLBACK_BULLET_BOUNDS,
	PLAYER_BULLET_CAPACITY,
	PLAYER_BULLET_RADIUS,
	STRESS_BULLET_DAMAGE,
	STRESS_BULLET_SPEED,
	STRESS_RING_COUNT,
	enemyBulletCapacity,
} from "./combatData";
import { createBulletSimulation, type BulletSimulation, type Vec3 } from "./bullets";
import {
	BulletKind,
	BulletPayload,
	FULL_RING,
	enemyBulletHitRadius,
	fireBurstRaw,
	packPayload,
	resetBurstLimit,
	turnDir,
	type Dir,
} from "./patterns";
import { BULLET_KIND_COUNT } from "./payload";
import { SimCtx } from "./ctx";
import { nearestLivingPlayer, partySize, playerAt, playerBulletOwner } from "../party";
import { scoreBulletVisit } from "../score/score";
import { stepAffixes } from "../affixes/stepAffixes";
import { resetBuildScratch, stepBuilds } from "../builds/procs";
import { BuildEffect, killGenOfSource, sourceEffect } from "../builds/buildsData";
import { KillCause } from "../builds/effectsData";
import { buildsOnPierceHit, phantomStepErased, phantomStepOn } from "../builds/evolutions";
import { buildsOnArrowHit, isHeavyArrow } from "../builds/duos";
import { secretsOpenPiece } from "../secrets/open";
import { SecretHow } from "../secrets/secretsData";
import { bastionRollOn, buildsOnRollThrough } from "../builds/hooks";
import { ballistaActive, buildsOnHeavyEnd } from "../builds/ballista";
import { siegeCarriedSlot, siegeSlamDue, siegeTryPin, stepPins } from "../builds/siege";
import { damageBreakable, enemyBulletHitsBreakable, type BreakablesState } from "../breakables/breakables";
import { breakableSlotAt } from "../breakables/cells";
import { BreakableKind, BreakableSource } from "../breakables/breakablesData";
import { SOLO_PLAYER, consumeEnemyBulletTimeScale, playerHitDamage, runMods } from "../progression/runMods";
import {
	actorHashNames,
	cloneActor,
	damageActor,
	spawnActor,
	stepActors,
	stepContactDamage,
	writeActorHash,
} from "./actors/actors";
import { archetypeIndex, sealArchetypes } from "./actors/registry";
import { NO_KIND, type ActorState } from "./actors/types";
import { cloneGuardEvents, createGuardEvents, guardSlots, shieldStopsBullet, type GuardEvents } from "./shield";
import { cloneHookEvents, createHookEvents, type HookEvents } from "./hookEvents";
import { cloneHealEvents, createHealEvents, type HealEvents } from "./healEvents";
import { chainhookStrike } from "./actors/archetypes/chainhook";
import {
	cloneWeaponsState,
	createWeaponsState,
	stepWeapons,
	weaponsHashNames,
	writeWeaponsHash,
} from "./weapons/weapons";
import { sealWeapons } from "./weapons/registry";
import { DEFAULT_LOADOUT } from "./weapons/loadout";
import type { WeaponsState } from "./weapons/types";
// Registers every archetype and weapon (side effects) before any run can start.
import "./actors/archetypes";
import "./weapons/defs";

/** Render-only end-of-life shrink (seconds) of each simulation (the source's createSims options). */
const ENEMY_BULLET_FADE_TIME = 0.25;
const PLAYER_BULLET_FADE_TIME = 0.15;

const STRESS_PAYLOAD = packPayload(STRESS_BULLET_DAMAGE, BulletKind.STRESS, 0);

// ---------------------------------------------------------------------------------------------
// State

export interface CombatState {
	/** Every enemy bullet. Stateful (not plain data): hashed via writeStateHash, see writeCombatHash. */
	enemyBullets: BulletSimulation;
	/** Every player bullet. */
	playerBullets: BulletSimulation;

	// Creation parameters (fixed for the run; kept so cloneCombatState can rebuild pristine simulations).
	enemyCapacity: number;
	playerCapacity: number;
	/** The simulations' bounds cube half-extent: Infinity (math.huge) with a bullet blocker, else the fallback. */
	boundsLimit: number;

	/** The actor pool (enemies, bosses), slot order. Grows up to MAX_ACTORS; free slots have kind NO_KIND. */
	actors: ActorState[];
	/** Next ActorState.id (serial, from 1). */
	nextActorId: number;
	/** Emitter ids acquired from enemyBullets so far (actors + stress), so a clone can re-acquire the same ids. */
	enemyEmitters: number;
	/** Spawns refused because the pool was full. */
	actorsDropped: number;

	/** The player's weapon sets (activeSet, per-set weapon index / cooldown / scratch, last melee swing). */
	weapons: WeaponsState;

	/** Stress mode: target live enemy bullets (0 = off), ring origin, ring heading, emitter id. */
	stressTarget: number;
	stressX: number;
	stressZ: number;
	stressDirX: number;
	stressDirZ: number;
	stressEmitterId: number;

	/** Totals for this run: bullets spawned per simulation, and bullets a full pool dropped. */
	enemySpawned: number;
	playerSpawned: number;
	dropped: number;

	/**
	 * The Bulwark's blocks and guard breaks this tick (docs/NEW_ENEMIES_2.md NX2, ./shield.ts): an unhashed feed for the
	 * view, cleared by step / stepParty. Not in writeCombatHash.
	 */
	guardEvents: GuardEvents;
	/**
	 * The Chainhook's latches and drag ends this tick (docs/NEW_ENEMIES_2.md NX3, ./hookEvents.ts): an unhashed feed for
	 * the view, cleared by step / stepParty. Not in writeCombatHash.
	 */
	hookEvents: HookEvents;
	/**
	 * The Mender's heal pulses and channel ends this tick (docs/NEW_ENEMIES_3.md NT3, ./healEvents.ts): an unhashed feed
	 * for the view, cleared by step / stepParty. Not in writeCombatHash.
	 */
	healEvents: HealEvents;
}

interface Sims {
	enemyBullets: BulletSimulation;
	playerBullets: BulletSimulation;
}

/** Builds both simulations; acquires `enemyEmitters` ids from the enemy one and the player's id (1). */
function createSims(enemyCapacity: number, playerCapacity: number, boundsLimit: number, enemyEmitters: number): Sims {
	// interpolation: the renderer draws prev -> current by the sim loop's alpha. fadeTime is render bookkeeping only.
	const enemyBullets = createBulletSimulation({
		maxBullets: enemyCapacity,
		boundsLimit,
		interpolation: true,
		fadeTime: ENEMY_BULLET_FADE_TIME,
	});
	const playerBullets = createBulletSimulation({
		maxBullets: playerCapacity,
		boundsLimit,
		interpolation: true,
		fadeTime: PLAYER_BULLET_FADE_TIME,
	});
	for (let i = 0; i < enemyEmitters; i++) enemyBullets.acquireEmitter();
	playerBullets.acquireEmitter();
	return { enemyBullets, playerBullets };
}

/**
 * Combat state for a new run from the run's config (stress, bullet culling, loadout), with an EMPTY actor pool:
 * createSimState then calls startCombat to spawn the encounter. Seals the archetype and weapon registries.
 */
export function createCombatState(
	config: Readonly<SimConfig>,
	loadout: ReadonlyArray<string | undefined> | undefined = config.loadout,
): CombatState {
	sealArchetypes();
	sealWeapons();
	const stress = config.stress !== undefined && config.stress.bullets > 0 ? config.stress : undefined;
	const stressTarget = stress !== undefined ? math.floor(stress.bullets) : 0;
	const enemyCapacity = enemyBulletCapacity(stressTarget);
	const playerCapacity = PLAYER_BULLET_CAPACITY;
	const boundsLimit = config.isBulletBlocked !== undefined ? math.huge : FALLBACK_BULLET_BOUNDS;
	const sims = createSims(enemyCapacity, playerCapacity, boundsLimit, 0);

	return {
		enemyBullets: sims.enemyBullets,
		playerBullets: sims.playerBullets,
		enemyCapacity,
		playerCapacity,
		boundsLimit,
		actors: [],
		nextActorId: 1,
		enemyEmitters: 0,
		actorsDropped: 0,
		weapons: createWeaponsState(loadout ?? DEFAULT_LOADOUT, 1),
		stressTarget,
		stressX: stress !== undefined ? stress.x : 0,
		stressZ: stress !== undefined ? stress.z : 0,
		stressDirX: 0,
		stressDirZ: 1,
		stressEmitterId: 0,
		enemySpawned: 0,
		playerSpawned: 0,
		dropped: 0,
		guardEvents: createGuardEvents(),
		hookEvents: createHookEvents(),
		healEvents: createHealEvents(),
	};
}

const ctx = new SimCtx();

/**
 * Run start (called by createSimState once the state exists): spawns config.encounter.spawns in order (spawnTick -1,
 * so they act from tick 0), then acquires the stress emitter. Emitter ids follow that order: actors 1..n, stress n + 1.
 */
export function startCombat(state: SimState, config: Readonly<SimConfig>): void {
	ctx.bind(state, config, EMPTY_INPUT);
	const c = state.combat;
	const spawns = config.encounter?.spawns ?? [];
	for (const s of spawns) {
		const a = spawnActor(ctx, archetypeIndex(s.kind), s.x, s.z);
		if (a !== undefined) a.spawnTick = -1;
	}
	if (c.stressTarget > 0) {
		c.stressEmitterId = c.enemyBullets.acquireEmitter();
		c.enemyEmitters += 1;
	}
}

/**
 * Copy of combat state. A bullet pool that has ever held a bullet cannot be reproduced (no snapshot / restore in the
 * library; the port keeps that contract): this throws once either simulation has spawned one. Pristine simulations
 * are rebuilt exactly (same options, emitter ids and step count).
 */
export function cloneCombatState(c: Readonly<CombatState>): CombatState {
	if (c.enemySpawned > 0 || c.playerSpawned > 0) {
		error(
			"cloneSimState: bullets have been spawned this run, and BulletSimulations cannot be cloned " +
				"(no snapshot/restore). Re-simulate from the recording with runReplay(recording, config, ticks) instead.",
			0,
		);
	}
	const sims = createSims(c.enemyCapacity, c.playerCapacity, c.boundsLimit, c.enemyEmitters);
	for (let i = 0; i < c.enemyBullets.stepCount; i++) sims.enemyBullets.step(SIM_DT);
	for (let i = 0; i < c.playerBullets.stepCount; i++) sims.playerBullets.step(SIM_DT);
	return {
		...c,
		enemyBullets: sims.enemyBullets,
		playerBullets: sims.playerBullets,
		actors: c.actors.map(cloneActor),
		weapons: cloneWeaponsState(c.weapons),
		guardEvents: cloneGuardEvents(c.guardEvents),
		hookEvents: cloneHookEvents(c.hookEvents),
		healEvents: cloneHealEvents(c.healEvents),
	};
}

// ---------------------------------------------------------------------------------------------
// Stress emitter

const turned: Dir = { x: 0, z: 1 };

function stepStress(c: CombatState): void {
	if (c.enemyBullets.activeCount >= c.stressTarget) return;
	const n = fireBurstRaw(
		c.enemyBullets,
		c.stressEmitterId,
		c.stressX,
		c.stressZ,
		c.stressDirX,
		c.stressDirZ,
		STRESS_RING_COUNT,
		FULL_RING,
		STRESS_BULLET_SPEED,
		ENEMY_BULLET_LIFE,
		STRESS_PAYLOAD,
	);
	c.enemySpawned += n;
	c.dropped += STRESS_RING_COUNT - n;
	turnDir(c.stressDirX, c.stressDirZ, turned);
	c.stressDirX = turned.x;
	c.stressDirZ = turned.z;
}

// ---------------------------------------------------------------------------------------------
// Collisions. Module-level callbacks reading the module-level ctx: no closure per tick. stepCombat is synchronous and
// never re-entered, so the ctx is only ever bound to the current state.

const ENEMY_HIT_R = PLAYER_RADIUS + ENEMY_BULLET_RADIUS;
/** (PLAYER_RADIUS + ENEMY_BULLET_RADIUS)^2, the enemy bullet vs player test (constants.json `derived`). */
export const ENEMY_HIT_R2 = ENEMY_HIT_R * ENEMY_HIT_R;

/**
 * (PLAYER_RADIUS + enemyBulletHitRadius(kind))^2 per BulletKind, index = kind, built once (docs/ENEMY_VARIANTS.md
 * EVD13). Every kind but GOO computes exactly ENEMY_HIT_R2 (same operands, same operations).
 */
const ENEMY_HIT_R2_BY_KIND: ReadonlyArray<number> = (() => {
	const out: number[] = [];
	for (let kind = 0; kind < BULLET_KIND_COUNT; kind++) {
		const r = PLAYER_RADIUS + enemyBulletHitRadius(kind);
		out.push(r * r);
	}
	return out;
})();

let hitBlocked: BulletBlocker | undefined;
/** This tick's breakables with an intact piece (docs/DECOR.md D4), else undefined: no lookup per bullet. */
let hitPieces: BreakablesState | undefined;
/** M2 scoring is on for this tick's state (graze tracking in the enemy bullet walk). */
let grazeOn = false;
/** The squared graze radius of this tick's solo player (M2 Daredevil widens it; co-op reads the grazing player's). */
let grazeR2 = 0;
/** Builds are on for this tick's state (playerBulletHit binds ctx.procGen from the payload source). */
let buildsOn = false;
/**
 * Builds v2 (docs/BUILDS_V2.md BV3 / BV4): some player owns Ballista or a Siege Bolt pin is recorded this tick
 * (sim/builds ballista.ts ballistaActive): heavy arrows burst, pin, plow and slam in the player bullet walk.
 */
let ballistaOn = false;
/** Some Bulwark guards this tick (ctx.guards is not empty: docs/NEW_ENEMIES_2.md NX2, ./shield.ts). */
let guardsOn = false;
/**
 * Builds (docs/BUILDS.md BU5, Phantom Step): per player, enemy bullets inside their hit circle are erased this tick
 * (sim/builds evolutions.ts phantomStepOn: Slippery III, rolling with i-frames). phantomAny: any of them.
 */
const phantom: boolean[] = [];
let phantomAny = false;

function computePhantom(state: SimState): void {
	phantomAny = false;
	phantom.clear();
	if (state.builds === undefined) return;
	for (let k = 0; k < partySize(state); k++) {
		const on = phantomStepOn(state, k);
		phantom.push(on);
		if (on) phantomAny = true;
	}
}

/**
 * Builds (docs/LEGENDARIES.md LG3, Bastion's roll brace): per player, a roll that counts enemy bullets this tick
 * (sim/builds hooks.ts bastionRollOn: Bastion, rolling with i-frames running). bastionAny: any of them (one boolean in
 * runs where nobody has Bastion).
 */
const bastionRolling: boolean[] = [];
let bastionAny = false;

function computeBastion(state: SimState): void {
	bastionAny = false;
	bastionRolling.clear();
	if (state.builds === undefined) return;
	for (let k = 0; k < partySize(state); k++) {
		const on = bastionRollOn(state, k);
		bastionRolling.push(on);
		if (on) bastionAny = true;
	}
}

/**
 * Bastion's roll brace: enemy bullet `i` (payload `payload`, neither goo nor a strike) overlaps rolling player `k`. A
 * bullet no roller counted yet (payload lastHit 0: unused on enemy bullets) is marked (lastHit 1, graze bits kept) and
 * counts once for k; a marked one never counts again, for anyone. Returns the payload as it is now.
 */
function bastionRollThrough(state: SimState, i: number, payload: number, k: number): number {
	if (BulletPayload.get(payload, "lastHit") !== 0) return payload;
	const marked = BulletPayload.with(payload, "lastHit", 1);
	state.combat.enemyBullets.setPayload(i, marked);
	buildsOnRollThrough(state, k);
	return marked;
}

function enemyBulletHit(i: number, pos: Readonly<Vec3>, payload: number, emitter: number): boolean {
	if (hitBlocked !== undefined && hitBlocked(pos.x, pos.z)) return true;
	const kind = BulletPayload.get(payload, "kind");
	// Goo (docs/ENEMY_VARIANTS.md EVD14) and strikes (docs/NEW_ENEMIES.md NE5) ignore breakables and never graze.
	const goo = kind === BulletKind.GOO;
	const strike = kind === BulletKind.STRIKE;
	const quiet = goo || strike;
	if (!quiet && hitPieces !== undefined && enemyBulletHitsBreakable(ctx.state, hitPieces, pos.x, pos.z)) return true;
	const p = ctx.state.player;
	const dx = pos.x - p.x;
	const dz = pos.z - p.z;
	const d2 = dx * dx + dz * dz;
	const inHit = d2 < ENEMY_HIT_R2_BY_KIND[kind];
	if (grazeOn && !quiet) scoreBulletVisit(ctx.state, ctx.state.combat.enemyBullets, i, payload, d2, inHit, grazeR2);
	if (!inHit) return strike && strikeHoldSpent(i, payload);
	// Builds (LG3): Bastion's roll brace counts it (before Phantom Step's erase: an erased bullet counts too).
	if (bastionAny && bastionRolling[SOLO_PLAYER] && !quiet) bastionRollThrough(ctx.state, i, payload, SOLO_PLAYER);
	// Builds (BU5): Phantom Step erases it (no hit, no score, no parry feed; goo quietly; never a strike: the roll's
	// i-frames already avoid it).
	if (phantomAny && phantom[SOLO_PLAYER] && !strike) {
		phantomStepErased(ctx.state, SOLO_PLAYER, goo, pos.x, pos.z);
		return true;
	}
	// The Chainhook's hook (docs/NEW_ENEMIES_2.md NX3): latches instead of hurting (consumed), or passes a player who is
	// not hittable.
	if (kind === BulletKind.HOOK) return chainhookStrike(ctx, emitter, SOLO_PLAYER);
	// Consumed only if the hit landed: i-frames, post-hit invulnerability, death and 0-damage bullets pass through.
	const landed = ctx.hurtPlayer(BulletPayload.get(payload, "damage"), BulletPayload.get(payload, "source") - 1);
	return landed || (strike && strikeHoldSpent(i, payload));
}

/**
 * Co-op enemyBulletHit: graze against the nearest living player (with THEIR graze radius: M2 Daredevil is personal),
 * then a hit on the first player (index order).
 */
function enemyBulletHitParty(i: number, pos: Readonly<Vec3>, payload: number, emitter: number): boolean {
	if (hitBlocked !== undefined && hitBlocked(pos.x, pos.z)) return true;
	const kind = BulletPayload.get(payload, "kind");
	// Goo (docs/ENEMY_VARIANTS.md EVD14) and strikes (docs/NEW_ENEMIES.md NE5) ignore breakables and never graze.
	const goo = kind === BulletKind.GOO;
	const strike = kind === BulletKind.STRIKE;
	const quiet = goo || strike;
	if (!quiet && hitPieces !== undefined && enemyBulletHitsBreakable(ctx.state, hitPieces, pos.x, pos.z)) return true;
	const state = ctx.state;
	const n = partySize(state);
	const hitR2 = ENEMY_HIT_R2_BY_KIND[kind];
	if (grazeOn && !quiet) {
		const ti = nearestLivingPlayer(state, pos.x, pos.z);
		const target = playerAt(state, ti);
		const gx = pos.x - target.x;
		const gz = pos.z - target.z;
		const g2 = gx * gx + gz * gz;
		scoreBulletVisit(
			state,
			state.combat.enemyBullets,
			i,
			payload,
			g2,
			g2 < hitR2,
			runMods(state, ti).grazeR2,
			target.dead !== 0,
			ti,
		);
	}
	for (let k = 0; k < n; k++) {
		const p = playerAt(state, k);
		if (p.dead !== 0) continue;
		const dx = pos.x - p.x;
		const dz = pos.z - p.z;
		if (dx * dx + dz * dz >= hitR2) continue;
		// Builds (LG3): Bastion's roll brace counts it for the first rolling owner it overlaps (marked: never again).
		if (bastionAny && bastionRolling[k] && !quiet) payload = bastionRollThrough(state, i, payload, k);
		// Builds (BU5): Phantom Step erases it over the first rolling owner it overlaps (index order); never a strike.
		if (phantomAny && phantom[k] && !strike) {
			phantomStepErased(state, k, goo, pos.x, pos.z);
			return true;
		}
		// The Chainhook's hook (NX3): consumed on the first hittable player it overlaps (a latch only on its target).
		if (kind === BulletKind.HOOK) {
			if (chainhookStrike(ctx, emitter, k)) return true;
			continue;
		}
		if (ctx.hurtPlayerAt(k, BulletPayload.get(payload, "damage"), BulletPayload.get(payload, "source") - 1)) {
			return true;
		}
	}
	return strike && strikeHoldSpent(i, payload);
}

/**
 * A strike (BulletKind.STRIKE, docs/NEW_ENEMIES.md NE5) that did not land this pass: spends one hold tick from its
 * payload's `pierce` field (the Stormcaller fires it with its hold; pierce is unused on enemy bullets). True (consume)
 * on the last one, so a strike holds that many collision passes whatever the Hourglass does to its float life.
 */
function strikeHoldSpent(i: number, payload: number): boolean {
	const left = BulletPayload.get(payload, "pierce");
	if (left <= 1) return true;
	ctx.state.combat.enemyBullets.setPayload(i, BulletPayload.with(payload, "pierce", left - 1));
	return false;
}

// Piercing: a bullet with payload pierce > 0, or one that has already pierced (lastHit > 0), damages every live
// actor it ENTERS this tick, never the actor in lastHit; each hit spends one pierce, and the hit with none left
// consumes it. Plain bullets never get here.
const PIERCE_BITS = bit32.bor(
	BulletPayload.with(0, "pierce", BulletPayload.max("pierce")),
	BulletPayload.with(0, "lastHit", BulletPayload.max("lastHit")),
);

function piercingBulletHit(i: number, pos: Readonly<Vec3>, payload: number): boolean {
	const c = ctx.state.combat;
	const actors = c.actors;
	const v = c.playerBullets.velocityAt(i);
	const px = pos.x - v.x * SIM_DT; // position at the start of the tick (straight flight)
	const pz = pos.z - v.z * SIM_DT;
	const damage = playerHitDamage(ctx.state, ctx.playerIndex, BulletPayload.get(payload, "damage")); // the owner's
	const lastHit = BulletPayload.get(payload, "lastHit");
	let pierce = BulletPayload.get(payload, "pierce");
	let hit = lastHit;
	// Siege Bolt (BV4): the actor this arrow carries (never hit by it; while it carries, no pierce is spent), else -1.
	let carriedSlot = ballistaOn ? siegeCarriedSlot(ctx, i) : -1;
	for (let k = 0; k < actors.size(); k++) {
		const a = actors[k];
		if (a.kind === NO_KIND || a.alive === 0 || k + 1 === lastHit || k === carriedSlot) continue;
		const r2 = (a.radius + PLAYER_BULLET_RADIUS) * (a.radius + PLAYER_BULLET_RADIUS);
		const dx = pos.x - a.x;
		const dz = pos.z - a.z;
		if (dx * dx + dz * dz >= r2) continue;
		const ex = px - a.x;
		const ez = pz - a.z;
		if (lastHit !== 0 && ex * ex + ez * ez < r2) continue; // already inside at the start of the tick
		damageActor(ctx, a, damage);
		// Siege Bolt (BV4): the first surviving hit of an owner's heavy arrow pins (that hit starts the carry).
		if (ballistaOn && carriedSlot < 0 && siegeTryPin(ctx, i, payload, a, k)) carriedSlot = k;
		// Builds v2 (BV4): a carrying arrow spends no pierce, so no hit consumes it.
		const spends = carriedSlot < 0;
		// Builds (BU5 / BU6): the pierce-hit hook (Ricochet: an arrow's last hit that kills splits) and the arrow-hit
		// hook (Storm Blade's count; Conductor when the arrow flies on).
		if (buildsOn) {
			buildsOnPierceHit(ctx, a, pos.x, pos.z, BulletPayload.get(payload, "source"), spends && pierce === 0);
			buildsOnArrowHit(ctx, a, i, payload, !spends || pierce > 0);
		}
		if (spends) {
			if (pierce === 0) {
				// Ballista (BV3): a heavy arrow's last pierce bursts into a ring.
				if (ballistaOn) buildsOnHeavyEnd(ctx, i, pos, payload, false, a);
				return true;
			}
			pierce--;
		}
		hit = k + 1;
	}
	if (hit !== lastHit) {
		c.playerBullets.setPayload(
			i,
			BulletPayload.with(BulletPayload.with(payload, "pierce", pierce), "lastHit", hit),
		);
	}
	return false;
}

function playerBulletHit(i: number, pos: Readonly<Vec3>, payload: number): boolean {
	if (hitBlocked !== undefined && hitBlocked(pos.x, pos.z)) {
		// Ballista (BV3): a heavy arrow on a wall bursts back into the room (Siege Bolt, BV4: and slams its pin).
		if (ballistaOn) buildsOnHeavyEnd(ctx, i, pos, payload, true);
		return true;
	}
	// Builds (opt-in): the generation a kill by this bullet gives its proc, bound like the owner, and (BU6, Chain
	// Reaction) whether it is a Volatile bolt.
	if (buildsOn) {
		const source = BulletPayload.get(payload, "source");
		ctx.procGen = killGenOfSource(source);
		ctx.procCause = sourceEffect(source) === BuildEffect.VOLATILE ? KillCause.BURST : KillCause.NONE;
	}
	const piercing = bit32.band(payload, PIERCE_BITS) !== 0;
	if (hitPieces !== undefined) {
		// A piece (docs/DECOR.md D4): it takes the payload damage; a plain bullet stops there, a piercing one flies on
		// (to the actors below, no pierce spent) only when it broke the piece.
		const slot = breakableSlotAt(hitPieces, pos.x, pos.z);
		if (slot >= 0) {
			// A secret's cracked wall (docs/SECRET_ROOMS.md SR3): a heavy arrow stopped by it opens it (consumed like on a
			// wall; Ballista bursts back from it). Any other bullet knocks below (damageBreakable's early return).
			if (hitPieces.pieces[slot].kind === BreakableKind.CRACKED_WALL) {
				const v = ctx.state.combat.playerBullets.velocityAt(i);
				if (
					isHeavyArrow(payload, v.x, v.z) &&
					secretsOpenPiece(ctx.state, slot, SecretHow.HEAVY, ctx.playerIndex)
				) {
					if (ballistaOn) buildsOnHeavyEnd(ctx, i, pos, payload, true);
					return true;
				}
			}
			const broke = damageBreakable(
				ctx.state,
				slot,
				BulletPayload.get(payload, "damage"),
				BreakableSource.PLAYER_BULLET,
				ctx.playerIndex, // Builds v2 (BV5): the bullet's owner and generation own the break (Wrecker)
				ctx.procGen,
			);
			if (!broke || !piercing) {
				// Ballista (BV3): a heavy arrow stopped by a piece bursts back (Siege Bolt, BV4: and slams its pin).
				if (ballistaOn && !broke) buildsOnHeavyEnd(ctx, i, pos, payload, true);
				return true;
			}
		}
	}
	// Siege Bolt (BV4): a carried body that fell short of its arrow (a pillar, a piece) slams here.
	if (ballistaOn && siegeSlamDue(ctx, i)) {
		buildsOnHeavyEnd(ctx, i, pos, payload, true);
		return true;
	}
	// The Bulwark's shield (docs/NEW_ENEMIES_2.md NX2, ./shield.ts): a guarding front stops it before any actor (the
	// cover arc, NXD6; a piercing arrow stops, a Siege arrow never pins); a heavy arrow breaks the guard. Ballista: the
	// shield stops a heavy arrow like a wall (its back fan; Siege Bolt: the carried actor slams on it).
	if (guardsOn && shieldStopsBullet(ctx, i, pos, payload)) {
		if (ballistaOn) buildsOnHeavyEnd(ctx, i, pos, payload, true);
		return true;
	}
	if (piercing) return piercingBulletHit(i, pos, payload);
	for (const a of ctx.state.combat.actors) {
		if (a.kind === NO_KIND || a.alive === 0) continue;
		const r = a.radius + PLAYER_BULLET_RADIUS;
		const dx = pos.x - a.x;
		const dz = pos.z - a.z;
		if (dx * dx + dz * dz >= r * r) continue;
		damageActor(ctx, a, playerHitDamage(ctx.state, ctx.playerIndex, BulletPayload.get(payload, "damage")));
		// Builds (BU6): the arrow-hit hook (Storm Blade's count).
		if (buildsOn) buildsOnArrowHit(ctx, a, i, payload, false);
		return true;
	}
	return false;
}

/** Co-op playerBulletHit: the bullet's owner is ctx.player while it damages (onHit / onDeath see who hit them). */
function playerBulletHitParty(i: number, pos: Readonly<Vec3>, payload: number, emitter: number): boolean {
	ctx.actingPlayer(playerBulletOwner(emitter));
	return playerBulletHit(i, pos, payload);
}

/** Co-op weapons phase: every player's weapons, index order, each seeing only its own weaponSwapped. */
function stepPartyWeapons(state: SimState, inputs: ReadonlyArray<Readonly<InputFrame>>): void {
	const ev = state.events;
	let swapped = ev.weaponSwapped;
	for (let i = 0; i < partySize(state); i++) {
		ctx.bindPlayer(i, inputs[i]);
		ev.weaponSwapped = 0;
		stepWeapons(ctx);
		if (ev.weaponSwapped !== 0) swapped = 1;
	}
	ev.weaponSwapped = swapped;
	ctx.bindPlayer(0, inputs[0]);
}

/**
 * One tick of combat (see the order at the top of this file). Called by step() after stepPlayer(). `inputs` (co-op:
 * one frame per player, index order; stepParty passes it) defaults to [input]; `input` must be inputs[0].
 */
export function stepCombat(
	state: SimState,
	input: Readonly<InputFrame>,
	config: Readonly<SimConfig>,
	inputs?: ReadonlyArray<Readonly<InputFrame>>,
): void {
	const c = state.combat;
	const party = state.party !== undefined && inputs !== undefined;
	ctx.bind(state, config, input);
	// Per-tick module scratch back to empty (a no-op after a normal tick; see resetBuildScratch / resetBurstLimit).
	resetBurstLimit();
	resetBuildScratch(state);

	// 1. Ember: clears every enemy bullet (player bullets stay).
	if (state.events.emberUsed !== 0) state.events.bulletsCleared += c.enemyBullets.clear();

	// 2-4. Act.
	stepActors(ctx);
	if (state.affixes !== undefined) stepAffixes(ctx);
	// The Bulwark's guard list (docs/NEW_ENEMIES_2.md NX2): from the pool as the actors left it, for phases 4-6.
	guardSlots(ctx, ctx.guards);
	if (c.stressTarget > 0) stepStress(c);
	if (party) stepPartyWeapons(state, inputs);
	else stepWeapons(ctx);

	// 5. Move (the Hourglass slows enemy bullets; a scale of 1 steps by SIM_DT itself).
	const enemyTimeScale = consumeEnemyBulletTimeScale(state);
	c.enemyBullets.step(enemyTimeScale === 1 ? SIM_DT : SIM_DT * enemyTimeScale);
	c.playerBullets.step(SIM_DT);
	// 5b. Siege Bolt (docs/BUILDS_V2.md BV4, only with pins): drop expired arrows' pins, drag the pinned actors.
	if (state.builds !== undefined && state.builds.pins.size() > 0) stepPins(ctx);

	// 6. Collide.
	hitBlocked = config.isBulletBlocked;
	hitPieces = state.breakables !== undefined && state.breakables.intact > 0 ? state.breakables : undefined;
	grazeOn = state.score !== undefined;
	grazeR2 = runMods(state, SOLO_PLAYER).grazeR2;
	buildsOn = state.builds !== undefined;
	guardsOn = ctx.guards.size() > 0;
	if (buildsOn) {
		computePhantom(state);
		computeBastion(state);
		// Builds v2 (BV3 / BV4): Ballista's bursts and Siege Bolt's pins in the player bullet walk.
		ballistaOn = ballistaActive(state);
	}
	if (party) {
		c.enemyBullets.forEachActive(enemyBulletHitParty);
		c.playerBullets.forEachActive(playerBulletHitParty);
		ctx.actingPlayer(0);
	} else {
		c.enemyBullets.forEachActive(enemyBulletHit);
		c.playerBullets.forEachActive(playerBulletHit);
	}
	hitBlocked = undefined;
	hitPieces = undefined;
	grazeOn = false;
	guardsOn = false;
	if (buildsOn) {
		ctx.procGen = 0;
		ctx.procCause = KillCause.NONE;
		buildsOn = false;
		ballistaOn = false;
		phantomAny = false;
		bastionAny = false;
		// 6b. Builds (opt-in): the proc queue (on-kill effects of this tick's kills and the carry-over).
		stepBuilds(ctx);
	}

	// 7. Bodies.
	stepContactDamage(ctx);
}

/** Live (alive) actors and present (alive or corpse) actors, for HUD / debug. */
export function countActors(c: Readonly<CombatState>): { alive: number; present: number } {
	let alive = 0;
	let present = 0;
	for (const a of c.actors) {
		if (a.kind === NO_KIND) continue;
		present++;
		if (a.alive !== 0) alive++;
	}
	return { alive, present };
}

// ---------------------------------------------------------------------------------------------
// Hash. writeCombatHash = header, every actor slot, weapons, then each bullet simulation (count + live bullets).
// The pieces are exported so the labelled dump (../hashLayout.ts) walks exactly the same writers.

/** Group 2 of hashed-fields.md (`combatHeader`, 16 numbers). Append only. */
export function writeCombatHeader(c: Readonly<CombatState>, out: number[]): void {
	out.push(
		c.enemyCapacity,
		c.playerCapacity,
		c.boundsLimit,
		c.nextActorId,
		c.enemyEmitters,
		c.actorsDropped,
		c.stressTarget,
		c.stressX,
		c.stressZ,
		c.stressDirX,
		c.stressDirZ,
		c.stressEmitterId,
		c.enemySpawned,
		c.playerSpawned,
		c.dropped,
		c.actors.size(),
	);
}

/** Dump names for writeCombatHeader, same order. */
export const COMBAT_HEADER_NAMES: ReadonlyArray<string> = [
	"combat.enemyCapacity",
	"combat.playerCapacity",
	"combat.boundsLimit",
	"combat.nextActorId",
	"combat.enemyEmitters",
	"combat.actorsDropped",
	"combat.stressTarget",
	"combat.stressX",
	"combat.stressZ",
	"combat.stressDirX",
	"combat.stressDirZ",
	"combat.stressEmitterId",
	"combat.enemySpawned",
	"combat.playerSpawned",
	"combat.dropped",
	"combat.actors.length",
];

/** Group 3: every actor slot, free ones included (all zeros), in slot order. */
export function writeActorsHash(c: Readonly<CombatState>, out: number[]): void {
	for (const a of c.actors) writeActorHash(a, out);
}

export function actorsHashNames(c: Readonly<CombatState>, out: string[]): void {
	for (let i = 0; i < c.actors.size(); i++) actorHashNames(c.actors[i], i, out);
}

/** Groups 5 / 6: live count, then 10 numbers per live bullet (slot, position, velocity, life, payload, emitter). */
export function writeBulletsHash(sim: BulletSimulation, out: number[]): void {
	out.push(sim.activeCount);
	sim.writeStateHash(out);
}

const BULLET_HASH_FIELDS = ["slot", "px", "py", "pz", "vx", "vy", "vz", "life", "payload", "emitter"];

/**
 * Dump names for writeBulletsHash: `enemyBullets.activeCount`, then `enemyBullets[<slot>].slot`, `...px`, ... per live
 * bullet, named by SLOT index as the fixtures do. `values[start]` is the activeCount that writeBulletsHash wrote.
 */
export function bulletsHashNames(prefix: string, values: ReadonlyArray<number>, start: number, out: string[]): void {
	out.push(`${prefix}.activeCount`);
	const count = values[start];
	for (let k = 0; k < count; k++) {
		const slot = values[start + 1 + k * BULLET_HASH_FIELDS.size()];
		for (const f of BULLET_HASH_FIELDS) out.push(`${prefix}[${slot}].${f}`);
	}
}

export { weaponsHashNames, writeWeaponsHash };

/** Hash fields for combat state, in fixed order. Append only. */
export function writeCombatHash(state: Readonly<SimState>, out: number[]): void {
	const c = state.combat;
	writeCombatHeader(c, out);
	writeActorsHash(c, out);
	writeWeaponsHash(c.weapons, out);
	writeBulletsHash(c.enemyBullets, out);
	writeBulletsHash(c.playerBullets, out);
}

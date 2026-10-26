/**
 * Combat simulation (E1.6, generalized in E1.8; source: `src/sim/combat.ts`): authoritative bullets, the actor pool,
 * the player's weapon sets, hits on the player, wall culling, the Ember bullet clear and the stress emitter. Runs after
 * stepPlayer() each tick. Deterministic, same rules as step.ts.
 *
 * stepCombat order (fixed; part of the determinism contract):
 *   1. Ember: events.emberUsed -> enemyBullets.clear() (every enemy bullet)
 *   2. actors, in slot order (stepActors): AI, movement, firing, runtime spawns (stepped from the next tick on)
 *   3. the stress emitter
 *   4. the player's weapons (stepWeapons: cooldowns, SWAP, trigger -> fire / melee sweep)
 *   5. step both simulations by SIM_DT (./bullets.ts, the ported r3f-projectiles pool); M2 Hourglass (endless runs):
 *      enemy bullets step by SIM_DT x HOURGLASS_TIME_SCALE for 1 s after a hit landed on a player holding it
 *   6. collisions, one forEachActive walk per simulation:
 *        enemy bullets:  wall (consume) -> [breakables: an intact piece's cell (consume, damage it)] -> [scoring:
 *                        graze flags] -> player circle -> ctx.hurtPlayer; consumed ONLY if the hit landed
 *        player bullets: wall (consume) -> [breakables: an intact piece's cell: its payload damage; consumed unless
 *                        piercing AND it broke the piece] -> first live actor in range, slot order (ctx.damageActor,
 *                        consume); piercing ones pass through actors (piercingBulletHit). M2 Sharpened (endless
 *                        runs): the payload damage x 1.25 when it hits (playerHitDamage)
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
import { BulletKind, BulletPayload, FULL_RING, fireBurstRaw, packPayload, turnDir, type Dir } from "./patterns";
import { SimCtx } from "./ctx";
import { nearestLivingPlayer, partySize, playerAt, playerBulletOwner } from "../party";
import { scoreBulletVisit } from "../score/score";
import { damageBreakable, enemyBulletHitsBreakable, type BreakablesState } from "../breakables/breakables";
import { breakableSlotAt } from "../breakables/cells";
import { BreakableSource } from "../breakables/breakablesData";
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
export function createCombatState(config: Readonly<SimConfig>): CombatState {
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
		weapons: createWeaponsState(config.loadout ?? DEFAULT_LOADOUT, 1),
		stressTarget,
		stressX: stress !== undefined ? stress.x : 0,
		stressZ: stress !== undefined ? stress.z : 0,
		stressDirX: 0,
		stressDirZ: 1,
		stressEmitterId: 0,
		enemySpawned: 0,
		playerSpawned: 0,
		dropped: 0,
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

let hitBlocked: BulletBlocker | undefined;
/** This tick's breakables with an intact piece (docs/DECOR.md D4), else undefined: no lookup per bullet. */
let hitPieces: BreakablesState | undefined;
/** M2 scoring is on for this tick's state (graze tracking in the enemy bullet walk). */
let grazeOn = false;
/** The squared graze radius of this tick's solo player (M2 Daredevil widens it; co-op reads the grazing player's). */
let grazeR2 = 0;

function enemyBulletHit(i: number, pos: Readonly<Vec3>, payload: number): boolean {
	if (hitBlocked !== undefined && hitBlocked(pos.x, pos.z)) return true;
	if (hitPieces !== undefined && enemyBulletHitsBreakable(ctx.state, hitPieces, pos.x, pos.z)) return true;
	const p = ctx.state.player;
	const dx = pos.x - p.x;
	const dz = pos.z - p.z;
	const d2 = dx * dx + dz * dz;
	const inHit = d2 < ENEMY_HIT_R2;
	if (grazeOn) scoreBulletVisit(ctx.state, ctx.state.combat.enemyBullets, i, payload, d2, inHit, grazeR2);
	if (!inHit) return false;
	// Consumed only if the hit landed: i-frames, post-hit invulnerability, death and 0-damage bullets pass through.
	return ctx.hurtPlayer(BulletPayload.get(payload, "damage"), BulletPayload.get(payload, "source") - 1);
}

/**
 * Co-op enemyBulletHit: graze against the nearest living player (with THEIR graze radius: M2 Daredevil is personal),
 * then a hit on the first player (index order).
 */
function enemyBulletHitParty(i: number, pos: Readonly<Vec3>, payload: number): boolean {
	if (hitBlocked !== undefined && hitBlocked(pos.x, pos.z)) return true;
	if (hitPieces !== undefined && enemyBulletHitsBreakable(ctx.state, hitPieces, pos.x, pos.z)) return true;
	const state = ctx.state;
	const n = partySize(state);
	if (grazeOn) {
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
			g2 < ENEMY_HIT_R2,
			runMods(state, ti).grazeR2,
			target.dead !== 0,
		);
	}
	for (let k = 0; k < n; k++) {
		const p = playerAt(state, k);
		if (p.dead !== 0) continue;
		const dx = pos.x - p.x;
		const dz = pos.z - p.z;
		if (dx * dx + dz * dz >= ENEMY_HIT_R2) continue;
		if (ctx.hurtPlayerAt(k, BulletPayload.get(payload, "damage"), BulletPayload.get(payload, "source") - 1)) {
			return true;
		}
	}
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
	for (let k = 0; k < actors.size(); k++) {
		const a = actors[k];
		if (a.kind === NO_KIND || a.alive === 0 || k + 1 === lastHit) continue;
		const r2 = (a.radius + PLAYER_BULLET_RADIUS) * (a.radius + PLAYER_BULLET_RADIUS);
		const dx = pos.x - a.x;
		const dz = pos.z - a.z;
		if (dx * dx + dz * dz >= r2) continue;
		const ex = px - a.x;
		const ez = pz - a.z;
		if (lastHit !== 0 && ex * ex + ez * ez < r2) continue; // already inside at the start of the tick
		damageActor(ctx, a, damage);
		if (pierce === 0) return true;
		pierce--;
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
	if (hitBlocked !== undefined && hitBlocked(pos.x, pos.z)) return true;
	const piercing = bit32.band(payload, PIERCE_BITS) !== 0;
	if (hitPieces !== undefined) {
		// A piece (docs/DECOR.md D4): it takes the payload damage; a plain bullet stops there, a piercing one flies on
		// (to the actors below, no pierce spent) only when it broke the piece.
		const slot = breakableSlotAt(hitPieces, pos.x, pos.z);
		if (slot >= 0) {
			const broke = damageBreakable(
				ctx.state,
				slot,
				BulletPayload.get(payload, "damage"),
				BreakableSource.PLAYER_BULLET,
			);
			if (!broke || !piercing) return true;
		}
	}
	if (piercing) return piercingBulletHit(i, pos, payload);
	for (const a of ctx.state.combat.actors) {
		if (a.kind === NO_KIND || a.alive === 0) continue;
		const r = a.radius + PLAYER_BULLET_RADIUS;
		const dx = pos.x - a.x;
		const dz = pos.z - a.z;
		if (dx * dx + dz * dz >= r * r) continue;
		damageActor(ctx, a, playerHitDamage(ctx.state, ctx.playerIndex, BulletPayload.get(payload, "damage")));
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

	// 1. Ember: clears every enemy bullet (player bullets stay).
	if (state.events.emberUsed !== 0) state.events.bulletsCleared += c.enemyBullets.clear();

	// 2-4. Act.
	stepActors(ctx);
	if (c.stressTarget > 0) stepStress(c);
	if (party) stepPartyWeapons(state, inputs);
	else stepWeapons(ctx);

	// 5. Move (the Hourglass slows enemy bullets; a scale of 1 steps by SIM_DT itself).
	const enemyTimeScale = consumeEnemyBulletTimeScale(state);
	c.enemyBullets.step(enemyTimeScale === 1 ? SIM_DT : SIM_DT * enemyTimeScale);
	c.playerBullets.step(SIM_DT);

	// 6. Collide.
	hitBlocked = config.isBulletBlocked;
	hitPieces = state.breakables !== undefined && state.breakables.intact > 0 ? state.breakables : undefined;
	grazeOn = state.score !== undefined;
	grazeR2 = runMods(state, SOLO_PLAYER).grazeR2;
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

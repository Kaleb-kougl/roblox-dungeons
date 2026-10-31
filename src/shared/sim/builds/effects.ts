/**
 * Build effects' shared rules (docs/BUILDS.md BU3; a Roblox-port feature, no web source): fireEffect (an effect's
 * bullets for a player, under the effect budget) and the target pick every effect uses (the nearest living enemy).
 * Only reached with state.builds (stepBuilds in ./procs.ts; the evolutions and duos of BU5 / BU6).
 *
 * fireEffect(ctx, owner, x, z, dirX, dirZ, spec, effect, gen): `spec` from (x, z) toward the unit direction into the
 * player bullet simulation with the OWNER's emitter (so its hits are credited to them and use their damage boons,
 * combat.ts playerBulletHit) and payload source buildSource(effect, gen) (its kill makes a gen + 1 proc). At most
 *   min(spec.count, effectBulletsMax - the owner's live effect bullets,
 *       playerCapacity - effectWeaponReserve x party size - every live player bullet)
 * bullets spawn: the first ones of the burst's arc order (patterns.ts fireBurstLimited: a ring is cut short, never
 * re-spaced). Effect bullets are counted by kind (EFFECT_BULLET_KINDS: burst / shard / ember / spark bolt) per owner
 * (emitter - 1). The second bound keeps effectWeaponReserve slots per player free of effects, and a player's own fire
 * never has more than that alive (procs.spec.ts), so effects can never make a weapon's shot drop. Every bullet not
 * spawned counts in combat.dropped and BuildEvents.effectDropped; combat.playerSpawned counts the rest. No
 * events.shotsFired (that is the player's own shot sound).
 *
 * The count walks the player bullets once: inside stepBuilds (beginEffectBudget .. endEffectBudget) it is taken at the
 * first fireEffect and kept while it fires (nothing in stepBuilds releases a player bullet); any other caller (the
 * weapons phase's Flurry crescent) is counted per call.
 */
import { jsMin } from "shared/jsmath";
import type { SimCtx } from "../combat/ctx";
import type { SimState } from "../state";
import type { Vec3 } from "../combat/bullets";
import { BulletPayload, fireBurstLimited, type BurstSpec } from "../combat/patterns";
import { BULLET_KIND_COUNT } from "../combat/payload";
import { NO_KIND } from "../combat/actors/types";
import { partySize, playerBulletOwner, weaponsAt } from "../party";
import { buildSource } from "./buildsData";
import { EFFECT_BULLET_KINDS, EFFECT_DIR_X, EFFECT_DIR_Z } from "./effectsData";

// ---------------------------------------------------------------------------------------------
// The effect budget

/** Per BulletKind: true for an effect bullet. Built once. */
const EFFECT_KIND: ReadonlyArray<boolean> = (() => {
	const out: boolean[] = [];
	for (let k = 0; k < BULLET_KIND_COUNT; k++) out.push(EFFECT_BULLET_KINDS.includes(k));
	return out;
})();

/** Live effect bullets per player (party index), as last counted. */
const alive: number[] = [];
/** The state whose count `alive` holds during a stepBuilds drain (undefined: count per call). */
let session: SimState | undefined;
/** The session's count has been taken (lazily, at its first fireEffect: nothing releases a player bullet before). */
let sessionCounted = false;

/** An actor id no actor has (ids start at 1): nearestEnemy's `skipId` when nothing is skipped. */
export const NO_SKIP_ID = 0;

function countVisit(_i: number, _pos: Readonly<Vec3>, payload: number, emitter: number): boolean {
	if (EFFECT_KIND[BulletPayload.get(payload, "kind")]) {
		const o = playerBulletOwner(emitter);
		if (o >= 0 && o < alive.size()) alive[o] += 1;
	}
	return false;
}

function countEffects(state: Readonly<SimState>): void {
	alive.clear();
	for (let i = 0; i < partySize(state); i++) alive.push(0);
	state.combat.playerBullets.forEachActive(countVisit);
}

/** stepBuilds begins: count once (at the first fireEffect), keep the count until endEffectBudget. */
export function beginEffectBudget(state: SimState): void {
	session = state;
	sessionCounted = false;
}

/** stepBuilds ends. */
export function endEffectBudget(): void {
	session = undefined;
	sessionCounted = false;
}

/** Live effect bullets of player `owner` (counted now). For specs and the BU13 census. */
export function effectBulletsAlive(state: Readonly<SimState>, owner: number): number {
	countEffects(state);
	return alive[owner] ?? 0;
}

/**
 * Fires `spec` for build effect `effect` (BuildEffect) at generation `gen` for player `owner` (see the file comment).
 * Returns the bullets spawned. Requires state.builds.
 */
export function fireEffect(
	ctx: SimCtx,
	owner: number,
	x: number,
	z: number,
	dirX: number,
	dirZ: number,
	spec: BurstSpec,
	effect: number,
	gen: number,
): number {
	const state = ctx.state;
	const s = state.builds!;
	const c = state.combat;
	const sim = c.playerBullets;
	if (session !== state) countEffects(state);
	else if (!sessionCounted) {
		countEffects(state);
		sessionCounted = true;
	}
	const ownRoom = s.config.effectBulletsMax - (alive[owner] ?? 0);
	const poolRoom = c.playerCapacity - s.config.effectWeaponReserve * partySize(state) - sim.activeCount;
	const limit = jsMin(spec.count, jsMin(ownRoom, poolRoom));
	const emitter = weaponsAt(state, owner).emitterId;
	const source = buildSource(effect, gen);
	const n = limit > 0 ? fireBurstLimited(sim, emitter, x, z, dirX, dirZ, spec, source, limit) : 0;
	if (owner < alive.size()) alive[owner] += n;
	c.playerSpawned += n;
	const lost = spec.count - n;
	c.dropped += lost;
	s.events.effectDropped += lost;
	return n;
}

// ---------------------------------------------------------------------------------------------
// Targets

/**
 * The slot of the living enemy nearest (x, z) with a squared distance <= `range2` (ties: the lower slot), or -1.
 * Skipped: free slots and corpses, the actor with id `skipId` (the proc's victim), the slots in `exclude`, and actors
 * spawned this tick (a slime's slimelets: the actor phase skips them too; they are targets from the next tick on).
 */
export function nearestEnemy(
	ctx: SimCtx,
	x: number,
	z: number,
	range2: number,
	skipId: number,
	exclude: ReadonlyArray<number>,
): number {
	const actors = ctx.actors;
	let best = -1;
	let bestD2 = range2;
	for (let k = 0; k < actors.size(); k++) {
		const a = actors[k];
		if (a.kind === NO_KIND || a.alive === 0 || a.id === skipId || a.spawnTick === ctx.tick) continue;
		const dx = a.x - x;
		const dz = a.z - z;
		const d2 = dx * dx + dz * dz;
		if (d2 > bestD2 || (d2 === bestD2 && best >= 0)) continue;
		if (exclude.includes(k)) continue;
		best = k;
		bestD2 = d2;
	}
	return best;
}

/** Scratch: an aimed volley's targets (never re-entered: firing only spawns bullets). */
const volleyTargets: number[] = [];

/**
 * An aimed volley (Soul Shards, Momentum, Ricochet): up to `count` living enemies within `range2` (squared) of (x, z),
 * nearest first (nearestEnemy: ties by slot, never `skipId`, never one spawned this tick); bullet i flies at target i
 * and those beyond the targets found at the nearest one. Each is `spec` (count 1) aimed at spawn by a unit vector (sqrt,
 * no trig; EFFECT_DIR when the target stands on (x, z)), fired through fireEffect for `owner` as build effect `effect`
 * at generation `gen`. No target: nothing fired. Returns the bullets spawned.
 */
export function fireAimedVolley(
	ctx: SimCtx,
	owner: number,
	x: number,
	z: number,
	count: number,
	range2: number,
	skipId: number,
	spec: BurstSpec,
	effect: number,
	gen: number,
): number {
	volleyTargets.clear();
	for (let i = 0; i < count; i++) {
		const k = nearestEnemy(ctx, x, z, range2, skipId, volleyTargets);
		if (k < 0) break;
		volleyTargets.push(k);
	}
	const found = volleyTargets.size();
	if (found === 0) return 0;
	let fired = 0;
	for (let i = 0; i < count; i++) {
		const a = ctx.actors[volleyTargets[i < found ? i : 0]];
		const dx = a.x - x;
		const dz = a.z - z;
		const d = math.sqrt(dx * dx + dz * dz);
		const dirX = d > 0 ? dx / d : EFFECT_DIR_X;
		const dirZ = d > 0 ? dz / d : EFFECT_DIR_Z;
		fired += fireEffect(ctx, owner, x, z, dirX, dirZ, spec, effect, gen);
	}
	volleyTargets.clear();
	return fired;
}

/**
 * Siege Bolt (Ballista III; docs/BUILDS_V2.md "Siege Bolt", BV4; a Roblox-port feature, no web source): the heavy
 * arrow pins the first enemy it hits and does not kill, carries it, plows through everything else on the way and slams
 * it into the wall. Only with state.builds; nothing here runs for a player without Ballista III (and nothing at all
 * while state.builds.pins is empty and no hit pins).
 *
 * The record (BuildPin, hashed, state.builds.pins, oldest first): the arrow's player bullet slot, the archer, the
 * pinned actor's slot and id, where the pin started (x0, z0) and the `slam` flag. One pin per arrow, ever (BVD6): when
 * the pinned actor dies or its slot is freed, the record stays as a SPENT record (slot -1, id 0, slam 0) until its
 * arrow is consumed or expires, so the arrow, flying on as an ordinary heavy arrow, can never pin again. At most
 * SIEGE_PINS_MAX records carry at once (spent records do not count: they live only as long as their arrow).
 *
 *   pin    (siegeTryPin, combat.ts piercingBulletHit, right after the damage) a heavy arrow of an owner with Ballista
 *          III (present) and no record yet hits an actor that survives: the actor is pinned unless it is a boss
 *          (def.data.boss), the Goldling (GOLDEN_KIND), a reviver (def.stepDead: turrets), PROC_INELIGIBLE_ARCHETYPES
 *          (the dummy) or already pinned (slot and id), or SIEGE_PINS_MAX carry already. The pinning hit spends no
 *          pierce (it starts the carry; it does not consume the arrow even with no pierce left). BuildEvents pinStart*.
 *   held   (combat/ctx.ts rebuildPins / isPinned, actors.ts stepActors) a carried actor does not step (def.step
 *          skipped: no walk, no attack, no timers); prevX / prevZ and its hit flash still update, contact damage is
 *          unchanged. The mask is rebuilt from the records at the start of stepActors (never hashed).
 *   carry  (stepPins, stepCombat phase 5b: after the bullets move, before the collisions; nothing spawns a player bullet
 *          in between, BV0) records in index order: a departed owner's record is dropped; a record whose arrow is not
 *          live (it expired: the pool's `step` released it; no slam) or whose slot no longer holds a heavy arrow is
 *          dropped; a carrying record whose actor died or was freed (slot AND id checked) becomes spent (the arrow flies
 *          on); every other one drags its actor onto the arrow's position with moveActor (the actor's own mover: walls
 *          slide, intact pieces block; never a steer), and sets `slam` when the body ends more than SIEGE_SLAM_SHORT
 *          short of the arrow (it hit something the arrow did not). Ended carries push pinEnd* (slam 0).
 *   plow   (combat.ts piercingBulletHit) while it carries, the arrow hits every enemy it enters (the piercing walk's
 *          rules) but never the pinned one, and spends no pierce (BVD7): a carrying arrow is never consumed by a pierce
 *          hit (Ricochet: no last pierce while carrying).
 *   slam   (siegeArrowEnd, from ./ballista.ts buildsOnHeavyEnd in the arrow's walk visit: a wall, a piece it does not
 *          break, or a set `slam`, siegeSlamDue) the pinned actor takes playerHitDamage(owner, SIEGE_SLAM_DAMAGE_PERCENT
 *          % of the arrow's payload damage) at procGen 0 (the player's own kill), then every other living enemy within
 *          SIEGE_SHOCK_RADIUS of it (centre distance, slot order; not ones spawned this tick) takes
 *          playerHitDamage(owner, SIEGE_SHOCK_DAMAGE) at procGen 1, then every intact piece but the chest whose cell
 *          centre is within the radius breaks (BreakableSource.BUILD). The arrow is consumed, its record removed, and
 *          Ballista's back fan queues from the slammed actor (its bolts start on its hit circle, so they never fly
 *          into it). BuildEvents pinEnd* (slam 1) and slam*.
 *   floor  builds.ts clearBuildProcs drops every record with the bullet pools.
 *
 * The slot-reuse case (BV0: the pool has no release by index and its free list is LIFO): a record is removed in the very
 * walk visit that consumes its arrow, and an arrow the pool releases itself (life over, out of bounds) is caught by
 * phase 5b before anything can spawn into its slot, so no record ever names another bullet.
 *
 * Positions (BV0 findings): score room records are membership lists, so a carried actor still belongs to its room
 * whatever its position. A Charger held mid-charge waits; released outside its room's box, its next charge tick's box
 * bound cuts the step to 0 (a stun), and outside a charge it cannot start a lane until it walks back inside the box. The
 * Goldling is never pinned (its walk mask is its own).
 */
import type { SimCtx } from "../combat/ctx";
import type { SimState } from "../state";
import { NO_KIND, type ActorState } from "../combat/actors/types";
import { archetypeAt } from "../combat/actors/registry";
import { moveActor } from "../combat/actors/helpers";
import { BulletPayload } from "../combat/patterns";
import { gridToWorld } from "shared/dungeon";
import { damageBreakable } from "../breakables/breakables";
import { BreakableKind, BreakableSource, NOT_BROKEN } from "../breakables/breakablesData";
import { GOLDEN_KIND } from "../golden/goldenData";
import { Boon } from "../progression/progressionData";
import { playerHitDamage, scalePercent } from "../progression/runMods";
import type { BuildPin, BuildsState } from "./builds";
import { PROC_INELIGIBLE_ARCHETYPES } from "./buildsData";
import {
	KillCause,
	SIEGE_PINS_MAX,
	SIEGE_SHOCK_DAMAGE,
	SIEGE_SHOCK_GEN,
	SIEGE_SHOCK_RADIUS,
	SIEGE_SLAM_DAMAGE_PERCENT,
	SIEGE_SLAM_SHORT,
} from "./effectsData";
import { isHeavyArrow } from "./duos";
import { buildPlayerLeft, isEvolved } from "./hooks";

const SLAM_SHORT2 = SIEGE_SLAM_SHORT * SIEGE_SLAM_SHORT;
const SHOCK_RADIUS2 = SIEGE_SHOCK_RADIUS * SIEGE_SHOCK_RADIUS;
/** BuildPin.slot of a spent record (its actor died: the arrow flies on and never pins again). */
export const PIN_SPENT = -1;

/** The record of player bullet `i`, or -1. */
function recordOf(s: Readonly<BuildsState>, i: number): number {
	const pins = s.pins;
	for (let k = 0; k < pins.size(); k++) if (pins[k].bullet === i) return k;
	return -1;
}

/** The actor record `pin` carries, alive and still the same actor (slot AND id), else undefined. */
function carried(ctx: SimCtx, pin: Readonly<BuildPin>): ActorState | undefined {
	if (pin.slot < 0) return undefined;
	const a = ctx.actors[pin.slot];
	if (a === undefined || a.kind === NO_KIND || a.alive === 0 || a.id !== pin.id) return undefined;
	return a;
}

/** Pushes a BuildEvents pinEnd entry for `pin` (its actor at (x, z) now). */
function pushPinEnd(s: BuildsState, pin: Readonly<BuildPin>, x: number, z: number, slam: number): void {
	const e = s.events;
	const dx = x - pin.x0;
	const dz = z - pin.z0;
	e.pinEndSlot.push(pin.slot);
	e.pinEndOwner.push(pin.owner);
	e.pinEndCarried.push(math.sqrt(dx * dx + dz * dz));
	e.pinEndSlam.push(slam);
}

/** Ends `pin`'s carry without a slam (its pinEnd entry at the actor's slot as it is now, if any). */
function endCarry(ctx: SimCtx, s: BuildsState, pin: BuildPin): void {
	if (pin.slot < 0) return;
	const a = ctx.actors[pin.slot];
	pushPinEnd(s, pin, a !== undefined ? a.x : pin.x0, a !== undefined ? a.z : pin.z0, 0);
	pin.slot = PIN_SPENT;
	pin.id = 0;
	pin.slam = 0;
}

/**
 * The slot of the actor player bullet `i` carries right now (a live pinned actor), else -1. combat.ts piercingBulletHit
 * skips it and spends no pierce while it is >= 0.
 */
export function siegeCarriedSlot(ctx: SimCtx, i: number): number {
	const s = ctx.state.builds;
	if (s === undefined || s.pins.size() === 0) return -1;
	const k = recordOf(s, i);
	if (k < 0) return -1;
	return carried(ctx, s.pins[k]) !== undefined ? s.pins[k].slot : -1;
}

/** True when player bullet `i` carries a live actor whose drag fell short this tick (its walk visit slams). */
export function siegeSlamDue(ctx: SimCtx, i: number): boolean {
	const s = ctx.state.builds;
	if (s === undefined || s.pins.size() === 0) return false;
	const k = recordOf(s, i);
	return k >= 0 && s.pins[k].slam !== 0 && carried(ctx, s.pins[k]) !== undefined;
}

/** True when actor `a` (slot `slot`) may be pinned (file comment: never a boss, the Goldling, a reviver or the dummy). */
function pinnable(s: Readonly<BuildsState>, a: Readonly<ActorState>, slot: number): boolean {
	const def = archetypeAt(a.kind);
	if (def.data.boss === true || def.id === GOLDEN_KIND || def.stepDead !== undefined) return false;
	if (PROC_INELIGIBLE_ARCHETYPES.includes(def.id)) return false;
	let carrying = 0;
	for (const pin of s.pins) {
		if (pin.slot < 0) continue;
		if (pin.slot === slot && pin.id === a.id) return false;
		carrying++;
	}
	return carrying < SIEGE_PINS_MAX;
}

/**
 * combat.ts piercingBulletHit, right after player bullet `i` (payload `payload`) damaged actor `a` in slot `slot`,
 * credited to ctx's bound player: pins `a` when the file comment's rule says so. True when it did (the hit then spends
 * no pierce).
 */
export function siegeTryPin(ctx: SimCtx, i: number, payload: number, a: Readonly<ActorState>, slot: number): boolean {
	const state = ctx.state;
	const s = state.builds;
	if (s === undefined || a.alive === 0 || a.kind === NO_KIND) return false;
	const owner = ctx.playerIndex;
	if (!isEvolved(s.players[owner], Boon.BALLISTA) || buildPlayerLeft(state, owner)) return false;
	const v = ctx.combat.playerBullets.velocityAt(i);
	if (!isHeavyArrow(payload, v.x, v.z)) return false;
	if (recordOf(s, i) >= 0 || !pinnable(s, a, slot)) return false;
	s.pins.push({ bullet: i, owner, slot, id: a.id, x0: a.x, z0: a.z, slam: 0 });
	const e = s.events;
	e.pinStartSlot.push(slot);
	e.pinStartOwner.push(owner);
	e.pinStartX.push(a.x);
	e.pinStartZ.push(a.z);
	return true;
}

/** stepCombat phase 5b (only with records): drops, spends and drags them (file comment, "carry"). */
export function stepPins(ctx: SimCtx): void {
	const state = ctx.state;
	const s = state.builds;
	if (s === undefined) return;
	const pins = s.pins;
	const sim = ctx.combat.playerBullets;
	let w = 0;
	const total = pins.size();
	for (let k = 0; k < total; k++) {
		const pin = pins[k];
		let keep = true;
		if (buildPlayerLeft(state, pin.owner)) {
			endCarry(ctx, s, pin);
			keep = false;
		} else if (!sim.isLive(pin.bullet)) {
			endCarry(ctx, s, pin);
			keep = false;
		} else {
			const v = sim.velocityAt(pin.bullet);
			if (!isHeavyArrow(sim.payloadAt(pin.bullet), v.x, v.z)) {
				endCarry(ctx, s, pin);
				keep = false;
			} else if (pin.slot >= 0) {
				const a = carried(ctx, pin);
				if (a === undefined) {
					endCarry(ctx, s, pin);
				} else {
					const pos = sim.positionAt(pin.bullet);
					const tx = pos.x;
					const tz = pos.z;
					moveActor(ctx, a, tx - a.x, tz - a.z);
					const dx = tx - a.x;
					const dz = tz - a.z;
					if (dx * dx + dz * dz > SLAM_SHORT2) pin.slam = 1;
				}
			}
		}
		if (keep) {
			pins[w] = pin;
			w++;
		}
	}
	while (pins.size() > w) pins.pop();
}

/**
 * ./ballista.ts buildsOnHeavyEnd: heavy arrow player bullet `i` (payload `payload`) is consumed in its walk visit.
 * Removes its record; when it carries a live actor, slams (file comment) and returns that actor (else undefined).
 */
export function siegeArrowEnd(ctx: SimCtx, i: number, payload: number): ActorState | undefined {
	const s = ctx.state.builds;
	if (s === undefined || s.pins.size() === 0) return undefined;
	const k = recordOf(s, i);
	if (k < 0) return undefined;
	const pin = s.pins[k];
	s.pins.remove(k);
	const a = carried(ctx, pin);
	if (a === undefined) {
		endCarry(ctx, s, pin);
		return undefined;
	}
	slam(ctx, s, pin, a, BulletPayload.get(payload, "damage"));
	return a;
}

function slam(ctx: SimCtx, s: BuildsState, pin: Readonly<BuildPin>, a: ActorState, arrowDamage: number): void {
	const state = ctx.state;
	const owner = pin.owner;
	const x = a.x;
	const z = a.z;
	pushPinEnd(s, pin, x, z, 1);
	const gen = ctx.procGen;
	const cause = ctx.procCause;
	// The pinned actor: the player's own kill (gen 0).
	ctx.procGen = 0;
	ctx.procCause = KillCause.NONE;
	ctx.damageActor(a, playerHitDamage(state, owner, scalePercent(arrowDamage, SIEGE_SLAM_DAMAGE_PERCENT)));
	let struck = 1;
	// The shockwave: every other living enemy within the radius, slot order, one generation on.
	ctx.procGen = SIEGE_SHOCK_GEN;
	const shock = playerHitDamage(state, owner, SIEGE_SHOCK_DAMAGE);
	const actors = ctx.actors;
	for (let k = 0; k < actors.size(); k++) {
		const b = actors[k];
		if (b === a || b.kind === NO_KIND || b.alive === 0 || b.spawnTick === ctx.tick) continue;
		const dx = b.x - x;
		const dz = b.z - z;
		if (dx * dx + dz * dz > SHOCK_RADIUS2) continue;
		ctx.damageActor(b, shock);
		struck++;
	}
	ctx.procGen = gen;
	ctx.procCause = cause;
	breakPieces(state, x, z, owner);
	const e = s.events;
	e.slamX.push(x);
	e.slamZ.push(z);
	e.slamOwner.push(owner);
	e.slamStruck.push(struck);
}

/**
 * Breaks every intact piece but a chest whose cell centre is within SIEGE_SHOCK_RADIUS of (x, z), for `owner` at the
 * shockwave's generation (1), so a Wrecker archer's pieces splinter (docs/BUILDS_V2.md BV5).
 */
function breakPieces(state: SimState, x: number, z: number, owner: number): void {
	const b = state.breakables;
	if (b === undefined || b.intact === 0) return;
	for (let k = 0; k < b.pieces.size(); k++) {
		const p = b.pieces[k];
		// A chest is skipped; a secret's crack goes on to damageBreakable, which knocks (docs/SECRET_ROOMS.md SR2).
		if (p.brokenTick !== NOT_BROKEN || p.kind === BreakableKind.CHEST) continue;
		const dx = gridToWorld(p.x) - x;
		const dz = gridToWorld(p.y) - z;
		if (dx * dx + dz * dz > SHOCK_RADIUS2) continue;
		damageBreakable(state, k, p.hp, BreakableSource.BUILD, owner, SIEGE_SHOCK_GEN);
	}
}

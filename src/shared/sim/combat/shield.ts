/**
 * The Bulwark's shield (Roblox port, docs/NEW_ENEMIES_2.md NX2, NXD6 / NXD7, NX0 "the damageActor callers"). Not a
 * `filterDamage` (damageActor knows no hit origin): the hit sites that know the origin ask here first.
 *
 * The guard list (SimCtx.guards, transient, never hashed): the slots of every living Bulwark with its shield up
 * (v[BULWARK_GUARDING] 1) that no Siege Bolt pin holds (SimCtx.isPinned). `guardSlots` below builds it once a tick,
 * called by combat.ts stepCombat right after the actor phase (end of phase 2), a pure function of the hashed pool as it
 * stands then, so the sword's sweep (phase 4), the Siege slam (5b / 6) and the player bullet walk (6) read the same
 * list; bind() empties it. Every test below also reads the actor's live fields (alive, the flag), so a guard broken or
 * a Bulwark killed earlier in the tick stops blocking at once. With no guarding Bulwark the list is empty and every
 * caller returns before doing anything: each hit site runs exactly as before.
 *
 * The front cone: a hit origin at offset o from the Bulwark's centre is in front when dot(face, o) >= frontCos x |o|
 * (frontCos 0.34: ~140 degrees). The facing is the actor's own (faceX / faceZ, hashed).
 *
 *   bullets  (combat.ts playerBulletHit, before the plain / piercing actor walks: OC2) a player bullet of any kind but
 *            EMBER (speed 0, a flame under its feet: it passes), within max(coverRadius, the body's hit radius) of a
 *            guarding Bulwark's centre, inside its front cone and heading into the shield (velocity . face < 0: a bullet
 *            leaving through the front, fired from behind it, is not stopped), is consumed there (NXD6, the cover arc:
 *            the actors behind it are untouched; a piercing arrow stops, a Siege arrow never pins). Mirror Cloak's
 *            reflections are BulletKind.PLAYER, so they stop too. A heavy arrow (sim/builds duos.ts isHeavyArrow,
 *            Ballista's included) breaks the guard instead of a block. Guarding Bulwarks are tried in slot order.
 *   melee    (weapons/defs/sword.ts hitSwing / hitFinisher, sweepArc's per-actor callback) the origin is the swinging
 *            player: a swing from in front does nothing to it (the other actors in the arc still take it), a finisher
 *            breaks the guard.
 *   slam     (sim/builds siege.ts, the shockwave; not the pinned actor) the origin is the slam point: from in front the
 *            shockwave breaks the guard and deals nothing. A Bulwark whose guard already broke this tick (SimCtx.
 *            guardsBroken) is spared too by a shockwave from in front (nothing more breaks): a carrying Siege arrow the
 *            shield stopped (a guard break) slams its carried actor right there, and that slam is the same blocked hit
 *            (NXD19, docs/NEW_ENEMIES_2.md review fixes).
 * A block or a break engages a calm Bulwark (like a hit). Nothing here draws.
 *
 * Feed (unhashed, for the view, cleared every tick by step / stepParty): SimEvents.shieldBlocks / guardBreaks count them;
 * CombatState.guardEvents holds where each block was (the bullet's position, or the shield's front for a swing) and
 * its Bulwark's slot, and the slot of each guard break.
 *
 * @module
 */

import type { Vec3 } from "./bullets";
import type { SimCtx } from "./ctx";
import { BulletKind, BulletPayload } from "./patterns";
import { PLAYER_BULLET_RADIUS } from "./combatData";
import { archetypeIndex } from "./actors/registry";
import { NO_KIND, type ActorState } from "./actors/types";
import { BULWARK, BULWARK_GUARDING, bulwarkGuardBreak } from "./actors/archetypes/bulwark";
import { engageOnHit } from "./actors/archetypes/enemyShared";
import { isHeavyArrow } from "../builds/duos";

/** Where this tick's blocks and guard breaks were (unhashed; cleared by step / stepParty). */
export interface GuardEvents {
	/** One entry per block: where it was, and the blocking Bulwark's actor slot. */
	blockX: number[];
	blockZ: number[];
	blockSlot: number[];
	/** One entry per guard break: the Bulwark's actor slot. */
	breakSlot: number[];
}

export function createGuardEvents(): GuardEvents {
	return { blockX: [], blockZ: [], blockSlot: [], breakSlot: [] };
}

export function cloneGuardEvents(e: Readonly<GuardEvents>): GuardEvents {
	return { blockX: [...e.blockX], blockZ: [...e.blockZ], blockSlot: [...e.blockSlot], breakSlot: [...e.breakSlot] };
}

export function clearGuardEvents(e: GuardEvents): void {
	if (e.blockX.size() > 0) {
		e.blockX.clear();
		e.blockZ.clear();
		e.blockSlot.clear();
	}
	if (e.breakSlot.size() > 0) e.breakSlot.clear();
}

/**
 * Fills `out` (combat.ts passes SimCtx.guards) with the slots of every guarding Bulwark (file comment), slot order, and
 * empties SimCtx.guardsBroken (this tick's guard breaks start here).
 */
export function guardSlots(ctx: SimCtx, out: number[]): void {
	out.clear();
	ctx.guardsBroken.clear();
	const kind = archetypeIndex(BULWARK.id);
	const actors = ctx.actors;
	for (let i = 0; i < actors.size(); i++) {
		const a = actors[i];
		if (a.kind === kind && a.alive !== 0 && a.v[BULWARK_GUARDING] === 1 && !ctx.isPinned(a)) out.push(i);
	}
}

/** True when `a` still guards now (the list's test on its live fields). */
function guardingNow(a: Readonly<ActorState>): boolean {
	return a.kind !== NO_KIND && a.alive !== 0 && a.v[BULWARK_GUARDING] === 1;
}

/** True when (ox, oz) is inside guarding `a`'s front cone. */
function inFront(a: Readonly<ActorState>, ox: number, oz: number): boolean {
	const dx = ox - a.x;
	const dz = oz - a.z;
	return dx * a.faceX + dz * a.faceZ >= BULWARK.data.frontCos * math.sqrt(dx * dx + dz * dz);
}

/** The slot of `a` when it is in this tick's guard list and still guards, else -1. */
function guardSlotOf(ctx: SimCtx, a: Readonly<ActorState>): number {
	const guards = ctx.guards;
	for (let k = 0; k < guards.size(); k++) {
		const slot = guards[k];
		if (ctx.actors[slot] === a) return guardingNow(a) ? slot : -1;
	}
	return -1;
}

/** True when `a`'s guard broke earlier this tick (SimCtx.guardsBroken). */
function brokeThisTick(ctx: SimCtx, a: Readonly<ActorState>): boolean {
	const broken = ctx.guardsBroken;
	for (let k = 0; k < broken.size(); k++) if (ctx.actors[broken[k]] === a) return true;
	return false;
}

function pushBlock(ctx: SimCtx, slot: number, x: number, z: number): void {
	const e = ctx.combat.guardEvents;
	e.blockX.push(x);
	e.blockZ.push(z);
	e.blockSlot.push(slot);
	ctx.events.shieldBlocks += 1;
}

function breakGuard(ctx: SimCtx, a: ActorState, slot: number): void {
	bulwarkGuardBreak(a);
	ctx.guardsBroken.push(slot);
	ctx.combat.guardEvents.breakSlot.push(slot);
	ctx.events.guardBreaks += 1;
}

/**
 * combat.ts playerBulletHit: player bullet `i` (payload `payload`, at `pos` after this tick's move) against every
 * guarding shield (file comment, "bullets"). True when a shield consumed it (a block, or a heavy arrow's guard break).
 */
export function shieldStopsBullet(ctx: SimCtx, i: number, pos: Readonly<Vec3>, payload: number): boolean {
	const guards = ctx.guards;
	if (guards.size() === 0) return false;
	if (BulletPayload.get(payload, "kind") === BulletKind.EMBER) return false;
	const v = ctx.combat.playerBullets.velocityAt(i);
	const vx = v.x;
	const vz = v.z;
	const cover = BULWARK.data.coverRadius;
	for (let k = 0; k < guards.size(); k++) {
		const slot = guards[k];
		const a = ctx.actors[slot];
		if (!guardingNow(a)) continue;
		if (vx * a.faceX + vz * a.faceZ >= 0) continue; // not heading into the shield
		const body = a.radius + PLAYER_BULLET_RADIUS;
		const reach = body > cover ? body : cover;
		const dx = pos.x - a.x;
		const dz = pos.z - a.z;
		if (dx * dx + dz * dz >= reach * reach) continue;
		if (!inFront(a, pos.x, pos.z)) continue;
		engageOnHit(ctx, a);
		if (isHeavyArrow(payload, vx, vz)) breakGuard(ctx, a, slot);
		else pushBlock(ctx, slot, pos.x, pos.z);
		return true;
	}
	return false;
}

/**
 * The sword's sweep callbacks (weapons/defs/sword.ts): `a` is in the arc of a swing by the bound player (ctx.player).
 * True when its shield takes the swing (file comment, "melee": `finisher` breaks the guard); the caller then deals
 * nothing to it.
 */
export function shieldStopsMelee(ctx: SimCtx, a: ActorState, finisher: boolean): boolean {
	if (ctx.guards.size() === 0) return false;
	const slot = guardSlotOf(ctx, a);
	if (slot < 0) return false;
	const p = ctx.player;
	if (!inFront(a, p.x, p.z)) return false;
	engageOnHit(ctx, a);
	if (finisher) breakGuard(ctx, a, slot);
	else pushBlock(ctx, slot, a.x + a.faceX * a.radius, a.z + a.faceZ * a.radius);
	return true;
}

/**
 * The Siege slam's shockwave (sim/builds siege.ts) at (x, z) reaches `a`: true when its shield takes it (file comment,
 * "slam": the guard breaks; one broken earlier this tick is spared without a second break); the caller then deals nothing
 * to it.
 */
export function shieldStopsSlam(ctx: SimCtx, a: ActorState, x: number, z: number): boolean {
	if (ctx.guards.size() === 0) return false;
	const slot = guardSlotOf(ctx, a);
	if (slot < 0) return brokeThisTick(ctx, a) && inFront(a, x, z);
	if (!inFront(a, x, z)) return false;
	engageOnHit(ctx, a);
	breakGuard(ctx, a, slot);
	return true;
}

/**
 * 'chainhook' (Roblox port, docs/NEW_ENEMIES_2.md NX3; no web source): a heavy demon that throws a hook down a
 * telegraphed line and drags the player it catches to its feet. 9 hp, contact damage 0. Never bought on floor 1 (NXD4:
 * the dungeon's room pool, NX6).
 *
 *   keep    (CHAINHOOK_KEEP) the sniper's reposition: keeps keepMin-keepMax from its target with line of sight (walks
 *           toward it out of sight, leashes past lostTicks without it: v[CHAINHOOK_LOST]), strafing at strafeWeight; the
 *           strafe side (v[CHAINHOOK_STRAFE], first by actor id parity) flips when a wall stops it and after every throw
 *           or drag, never by a draw. The cooldown counts down here only.
 *   aim     cooldown out, the target in sight within throwRange: the heading to it locks (v[CHAINHOOK_DIR_X / Z]), the
 *           target's party index + 1 goes into v[CHAINHOOK_THROW_TARGET], the next cooldown is drawn (`enemyCooldown`,
 *           the throw's ONE draw) and it telegraphs aimTicks (attack CHAINHOOK_ATTACK_THROW; the `aimLine` hint,
 *           throwLineLength), standing still facing the heading. On the last tick: the target dead, or a full pool, and
 *           the throw is dropped (back to keep); else one `hook` bullet (BulletKind.HOOK) down the locked heading.
 *   thrown  (CHAINHOOK_THROWN) stands still while the hook flies; back to keep once none of its bullets is live (the
 *           hook hit a wall or a piece, was erased, missed or was consumed on a player without a latch).
 *   drag    (CHAINHOOK_DRAG) set by chainhookStrike from the enemy bullet walk (combat.ts): v[CHAINHOOK_HOOKED] = the
 *           hooked player + 1, v[CHAINHOOK_DAMAGE] = 0. Each tick (stepActors, after stepPlayer: the player's own walk
 *           and a roll pressed this tick already happened), in order: the hooked player dead (PLAYER_DEAD), rolling
 *           (rollTicks > 0: ROLL) or out of sight (SIGHT) breaks it; else it pulls them toward itself by pullSpeed x
 *           SIM_DT (never past pullStop; a literal, no walk mods) through SimCtx.dragPlayer (movePlayer with the floor's
 *           world config: walls, pillars and pieces stop the pull like a walk), aiTicks += 1, then the player within
 *           pullStop (+ ARRIVE_SLACK, rounding) is an ARRIVED end (the yank), dragMaxTicks drag ticks are a TIMED_OUT end (back to
 *           keep). It takes breakDamage since the latch (onHit: DAMAGE) or dies (onDeath: DEATH): broken at once.
 *           Leash rules wait for the drag's end (at most dragMaxTicks). A Siege pin holds its step, so the drag pauses.
 *   yank    on arrival: the heading to the player locks in v[CHAINHOOK_DIR_X / Z] and it telegraphs yankTelegraphTicks
 *           (attack CHAINHOOK_ATTACK_YANK; the `ring` hint at its feet, yankRingRadius), then the imp's 5-bullet fan
 *           (`yankFan`, the same spec object and port arc row 5 @ 0.7, HIT_NORMAL) down it; back to keep.
 *
 * The hook's rules (combat.ts enemyBulletHit / enemyBulletHitParty, NXD8): a normal enemy bullet everywhere (walls,
 * pieces, grazes, Bastion's roll count, Phantom Step, the guard's erase and its parry feed, the power pellet, the
 * Hourglass) except on a player hit, where chainhookStrike replaces the hurt (the hook deals no damage):
 *   - the player not hittable (SimCtx.playerHittable: dead, i-frames, post-hit invulnerability, rolling, dev god mode,
 *     or already dragged): it passes through, like a hit that does not land;
 *   - else it is consumed, and it latches only when its thrower (the living Chainhook whose emitterId is the bullet's
 *     emitter) is still in CHAINHOOK_THROWN and the player is the one it was thrown at (v[CHAINHOOK_THROW_TARGET]). A
 *     hook from a dead or freed thrower, or caught by a teammate standing in the line, latches nothing (only the target
 *     is ever moved).
 *
 * Draws: the first cooldown in init, one per throw (on the aim's start tick); nothing else.
 *
 * Feed (unhashed): SimEvents.hookLatched / hookBroken and CombatState.hookEvents (../../hookEvents.ts: every latch and
 * every drag end with its HookEnd reason). Read from hashed state: hookedPlayerOf (the player a Chainhook drags) and
 * chainhookHolderOf (the Chainhook that drags a player): the view suspends local prediction while the local player is
 * held (NX7).
 *
 * View contract: states CHAINHOOK_KEEP (= STATE_ENGAGED) / AiState.TELEGRAPH (the aim, then the yank) /
 * CHAINHOOK_THROWN / CHAINHOOK_DRAG (aiTicks counts the drag's ticks); attack ids CHAINHOOK_ATTACK_THROW /
 * CHAINHOOK_ATTACK_YANK; v slots CHAINHOOK_DIR_X / _Z (the locked throw heading, then the yank's), CHAINHOOK_HOOKED
 * (hooked party index + 1 while dragging, 0 otherwise), slot 6 shared by state (CHAINHOOK_LOST: ticks without sight
 * while keeping range; CHAINHOOK_THROW_TARGET: the target + 1 while aiming and thrown; CHAINHOOK_DAMAGE: damage taken
 * since the latch while dragging), CHAINHOOK_STRAFE (+1 / -1).
 *
 * @module
 */

import { secondsToTicks } from "../../../playerData";
import { SIM_DT } from "../../../units";
import { playerAt } from "../../../party";
import type { SimState } from "../../../state";
import { BulletKind, type BurstSpec } from "../../patterns";
import type { SimCtx } from "../../ctx";
import { HookEnd, hookEndBreaks } from "../../hookEvents";
import { enemyCooldown, walkStep } from "../actorMods";
import { faceToward, moveActor, toPlayer, walkToward } from "../helpers";
import { PORT_BAND_ENEMIES_3, archetypeIndex, registerArchetype } from "../registry";
import { AiState, type ActorState } from "../types";
import {
	STATE_ENGAGED,
	STEER,
	alertOnDeath,
	engageOnHit,
	initRoomEnemy,
	leash,
	shouldLeash,
	stepCalm,
	type RoomEnemyData,
} from "./enemyShared";
import { IMP } from "./imp";

export interface ChainhookData extends RoomEnemyData {
	/** Preferred distance band to its target (world units; it wants line of sight). */
	readonly keepMin: number;
	readonly keepMax: number;
	/** Weight of the sideways component of the keep-range move (radial is 1; the sniper's). */
	readonly strafeWeight: number;
	/** Ticks between throws (random in [min, max], `enemyCooldown`; the first drawn at spawn). */
	readonly throwCooldownMin: number;
	readonly throwCooldownMax: number;
	/** Throws when its target is this close (world units) and in sight. */
	readonly throwRange: number;
	/** Aim telegraph ticks (the heading locks at its start) and its warning line's length (world units). */
	readonly aimTicks: number;
	readonly throwLineLength: number;
	/** The hook: one BulletKind.HOOK bullet (0 damage: it latches, never hurts). */
	readonly hook: BurstSpec;
	/** The drag: pull speed (world units / s), stop distance (world units, centre to centre), longest drag (ticks). */
	readonly pullSpeed: number;
	readonly pullStop: number;
	readonly dragMaxTicks: number;
	/** Damage it takes since the latch that breaks the drag (a teammate freed you). */
	readonly breakDamage: number;
	/** The yank strike on arrival: telegraph ticks, the ring at its feet (world units), the fan. */
	readonly yankTelegraphTicks: number;
	readonly yankRingRadius: number;
	readonly yankFan: BurstSpec;
}

// --- States and attack ids
/** Keeping range. */
export const CHAINHOOK_KEEP = STATE_ENGAGED;
/** The hook is in flight. */
export const CHAINHOOK_THROWN = AiState.CUSTOM + 1;
/** Dragging the hooked player (aiTicks counts the drag's ticks). */
export const CHAINHOOK_DRAG = AiState.CUSTOM + 2;
/** ActorState.attack while telegraphing the throw (the aim line). */
export const CHAINHOOK_ATTACK_THROW = 1;
/** ActorState.attack while telegraphing the yank (the ring at its feet). */
export const CHAINHOOK_ATTACK_YANK = 2;

// --- v[] slots (0..2 shared)
/** Locked heading (unit): the throw's while aiming, the yank's while telegraphing it. */
export const CHAINHOOK_DIR_X = 3;
export const CHAINHOOK_DIR_Z = 4;
/** The hooked player's party index + 1 while dragging (0: nobody). */
export const CHAINHOOK_HOOKED = 5;
/** Slot 6 while keeping range: ticks without line of sight to its target (the sniper's lost counter). */
export const CHAINHOOK_LOST = 6;
/** Slot 6 while aiming and while the hook flies: the party index + 1 of the player it was thrown at. */
export const CHAINHOOK_THROW_TARGET = 6;
/** Slot 6 while dragging: damage taken since the latch. */
export const CHAINHOOK_DAMAGE = 6;
/** Strafe side, +1 or -1. */
export const CHAINHOOK_STRAFE = 7;

const AIM_SECONDS = 0.7;
const THROW_RANGE = 8;
const HOOK_SPEED = 16;
const HOOK_LIFE = 0.5;
const YANK_SECONDS = 0.3;
const YANK_RING_RADIUS = 1.6;
/** A drag that leaves the player within pullStop plus this (world units) has arrived: the rounding of its last step. */
const ARRIVE_SLACK = 1e-6;
/** A move shorter than this fraction of the step means a wall: flip the strafe side (the sniper's). */
const STRAFE_BLOCKED = 0.3;
/** Squared length below which a vector has no direction. */
const MIN_DIR2 = 1e-12;

export const CHAINHOOK = registerArchetype<ChainhookData>({
	id: "chainhook",
	band: PORT_BAND_ENEMIES_3,
	data: {
		hp: 9,
		radius: 0.45,
		speed: 2.2,
		contactDamage: 0,
		spriteId: "enemy.chainhook",
		roomEnemy: true,
		aggroRange: 10,
		leashRange: 15,
		lostTicks: secondsToTicks(2.5),
		alertRange: 4.5,
		keepMin: 4,
		keepMax: 7,
		strafeWeight: 0.8,
		throwCooldownMin: secondsToTicks(4),
		throwCooldownMax: secondsToTicks(5),
		throwRange: THROW_RANGE,
		aimTicks: secondsToTicks(AIM_SECONDS), // 42
		throwLineLength: THROW_RANGE,
		hook: {
			count: 1,
			spread: 0,
			speed: HOOK_SPEED,
			life: HOOK_LIFE, // 8 units
			damage: 0,
			kind: BulletKind.HOOK,
		},
		pullSpeed: 10,
		pullStop: 1.3,
		dragMaxTicks: secondsToTicks(0.6), // 36
		breakDamage: 3,
		yankTelegraphTicks: secondsToTicks(YANK_SECONDS), // 18
		yankRingRadius: YANK_RING_RADIUS,
		yankFan: IMP.data.fan,
		fx: {
			aimLine: {
				dirX: CHAINHOOK_DIR_X,
				dirZ: CHAINHOOK_DIR_Z,
				length: THROW_RANGE,
				boldTicks: secondsToTicks(AIM_SECONDS), // locked from the start: bold throughout
				attack: CHAINHOOK_ATTACK_THROW,
			},
			ring: {
				state: AiState.TELEGRAPH,
				radius: YANK_RING_RADIUS,
				fillTicks: secondsToTicks(YANK_SECONDS),
				attack: CHAINHOOK_ATTACK_YANK,
			},
		},
	},
	init(ctx, a) {
		initRoomEnemy(a);
		const d = ctx.data<ChainhookData>(a);
		// No draw for the strafe side: alternate it by actor id (the imp's). The first throw's cooldown is the one draw.
		a.v[CHAINHOOK_STRAFE] = a.id % 2 === 0 ? 1 : -1;
		a.cooldown = enemyCooldown(ctx, a, d.throwCooldownMin, d.throwCooldownMax);
	},
	step(ctx, a) {
		const d = ctx.data<ChainhookData>(a);
		if (stepCalm(ctx, a)) return;
		if (a.aiState === CHAINHOOK_DRAG) {
			drag(ctx, a, d);
			return;
		}
		if (shouldLeash(ctx, a)) {
			a.v[CHAINHOOK_LOST] = 0;
			leash(a);
			return;
		}
		if (a.aiState === AiState.TELEGRAPH) {
			if (a.attack === CHAINHOOK_ATTACK_THROW) aiming(ctx, a, d);
			else yanking(ctx, a, d);
		} else if (a.aiState === CHAINHOOK_THROWN) thrown(ctx, a);
		else keepRange(ctx, a, d);
	},
	onHit(ctx, a, damage) {
		engageOnHit(ctx, a);
		if (a.aiState !== CHAINHOOK_DRAG) return;
		a.v[CHAINHOOK_DAMAGE] += damage;
		if (a.v[CHAINHOOK_DAMAGE] >= ctx.data<ChainhookData>(a).breakDamage) {
			endDrag(ctx, a, HookEnd.DAMAGE);
			backToKeep(a);
		}
	},
	onDeath(ctx, a) {
		if (a.aiState === CHAINHOOK_DRAG && a.v[CHAINHOOK_HOOKED] > 0) endDrag(ctx, a, HookEnd.DEATH);
		alertOnDeath(ctx, a); // a hook or a fan already in flight keeps flying (a hook latches nothing now)
	},
});

// ---------------------------------------------------------------------------------------------
// Reads of hashed state (the view, NX7, and SimCtx.playerHittable)

/** The party index of the player living Chainhook `a` drags, else -1 (any other actor: -1). */
export function hookedPlayerOf(a: Readonly<ActorState>): number {
	if (a.alive === 0 || a.aiState !== CHAINHOOK_DRAG || a.kind !== archetypeIndex(CHAINHOOK.id)) return -1;
	const h = a.v[CHAINHOOK_HOOKED];
	return h > 0 ? h - 1 : -1;
}

/** The actor slot of the living Chainhook that drags player `k` now, else -1 (slot order; at most one, NX3). */
export function chainhookHolderOf(state: Readonly<SimState>, k: number): number {
	const kind = archetypeIndex(CHAINHOOK.id);
	const actors = state.combat.actors;
	for (let i = 0; i < actors.size(); i++) {
		const a = actors[i];
		if (a.kind === kind && a.alive !== 0 && a.aiState === CHAINHOOK_DRAG && a.v[CHAINHOOK_HOOKED] === k + 1)
			return i;
	}
	return -1;
}

// ---------------------------------------------------------------------------------------------
// The hook's player hit (combat.ts, enemy bullet walks)

/** The slot of the living Chainhook whose emitter id is `emitter`, else -1 (a dead or freed thrower). */
function throwerSlot(ctx: SimCtx, emitter: number): number {
	const kind = archetypeIndex(CHAINHOOK.id);
	const actors = ctx.actors;
	for (let i = 0; i < actors.size(); i++) {
		const a = actors[i];
		if (a.kind === kind && a.alive !== 0 && a.emitterId === emitter) return i;
	}
	return -1;
}

/**
 * A HOOK bullet fired by `emitter` overlaps living player `k` (after Bastion's count and Phantom Step's erase): the
 * hook rules of the file comment in place of the hurt. Returns true when the hook is consumed (a latch, or a hit that
 * latches nothing), false when it passes through (the player is not hittable).
 */
export function chainhookStrike(ctx: SimCtx, emitter: number, k: number): boolean {
	if (!ctx.playerHittable(k)) return false;
	const slot = throwerSlot(ctx, emitter);
	if (slot < 0) return true;
	const a = ctx.actors[slot];
	if (a.aiState !== CHAINHOOK_THROWN || a.v[CHAINHOOK_THROW_TARGET] !== k + 1) return true;
	a.aiState = CHAINHOOK_DRAG;
	a.aiTicks = 0;
	a.attack = 0;
	a.v[CHAINHOOK_HOOKED] = k + 1;
	a.v[CHAINHOOK_DAMAGE] = 0;
	const e = ctx.combat.hookEvents;
	e.latchPlayer.push(k);
	e.latchSlot.push(slot);
	ctx.events.hookLatched += 1;
	return true;
}

// ---------------------------------------------------------------------------------------------
// States

/** Records the end of `a`'s drag (the feed) and lets the player go (v[CHAINHOOK_HOOKED] 0). The caller sets the state. */
function endDrag(ctx: SimCtx, a: ActorState, reason: HookEnd): void {
	const e = ctx.combat.hookEvents;
	e.endPlayer.push(a.v[CHAINHOOK_HOOKED] - 1);
	e.endSlot.push(ctx.actors.indexOf(a));
	e.endReason.push(reason);
	if (hookEndBreaks(reason)) ctx.events.hookBroken += 1;
	a.v[CHAINHOOK_HOOKED] = 0;
}

/** Back to keeping range (after a throw, a drag or the yank); the strafe side flips so it does not drift one way. */
function backToKeep(a: ActorState): void {
	a.aiState = CHAINHOOK_KEEP;
	a.aiTicks = 0;
	a.attack = 0;
	a.v[CHAINHOOK_HOOKED] = 0;
	a.v[CHAINHOOK_LOST] = 0;
	a.v[CHAINHOOK_STRAFE] = -a.v[CHAINHOOK_STRAFE];
}

function aiming(ctx: SimCtx, a: ActorState, d: ChainhookData): void {
	faceToward(a, a.v[CHAINHOOK_DIR_X], a.v[CHAINHOOK_DIR_Z]);
	a.aiTicks -= 1;
	if (a.aiTicks > 0) return;
	const target = playerAt(ctx.state, a.v[CHAINHOOK_THROW_TARGET] - 1);
	if (target.dead !== 0 || ctx.fireEnemy(a, a.v[CHAINHOOK_DIR_X], a.v[CHAINHOOK_DIR_Z], d.hook) === 0) {
		backToKeep(a); // dropped: the cooldown drawn at the aim's start stands
		return;
	}
	a.aiState = CHAINHOOK_THROWN;
	a.aiTicks = 0;
	a.attack = 0;
}

function thrown(ctx: SimCtx, a: ActorState): void {
	a.aiTicks += 1;
	// The latch (combat.ts, after this phase) moves it to CHAINHOOK_DRAG; here the hook is gone without one.
	if (ctx.combat.enemyBullets.activeCountFor(a.emitterId) === 0) backToKeep(a);
}

function drag(ctx: SimCtx, a: ActorState, d: ChainhookData): void {
	const k = a.v[CHAINHOOK_HOOKED] - 1;
	const p = playerAt(ctx.state, k);
	let reason: HookEnd | undefined;
	if (p.dead !== 0) reason = HookEnd.PLAYER_DEAD;
	else if (p.rollTicks > 0) reason = HookEnd.ROLL;
	else if (!ctx.lineOfSight(a.x, a.z, p.x, p.z)) reason = HookEnd.SIGHT;
	if (reason !== undefined) {
		endDrag(ctx, a, reason);
		backToKeep(a);
		return;
	}
	const arrive = d.pullStop + ARRIVE_SLACK;
	let dx = a.x - p.x;
	let dz = a.z - p.z;
	let dist2 = dx * dx + dz * dz;
	if (dist2 > d.pullStop * d.pullStop) {
		const dist = math.sqrt(dist2);
		const pull = d.pullSpeed * SIM_DT;
		const left = dist - d.pullStop;
		const len = left < pull ? left : pull;
		ctx.dragPlayer(k, (dx / dist) * len, (dz / dist) * len);
		dx = a.x - p.x;
		dz = a.z - p.z;
		dist2 = dx * dx + dz * dz;
	}
	faceToward(a, -dx, -dz);
	a.aiTicks += 1;
	if (dist2 <= arrive * arrive) {
		endDrag(ctx, a, HookEnd.ARRIVED);
		// The yank: the heading to the player locks now; the fan fires down it when the telegraph runs out.
		if (dist2 > MIN_DIR2) {
			const inv = 1 / math.sqrt(dist2);
			a.v[CHAINHOOK_DIR_X] = -dx * inv;
			a.v[CHAINHOOK_DIR_Z] = -dz * inv;
		} else {
			a.v[CHAINHOOK_DIR_X] = a.faceX;
			a.v[CHAINHOOK_DIR_Z] = a.faceZ;
		}
		a.v[CHAINHOOK_DAMAGE] = 0;
		ctx.telegraph(a, d.yankTelegraphTicks, CHAINHOOK_ATTACK_YANK);
		return;
	}
	if (a.aiTicks >= d.dragMaxTicks) {
		endDrag(ctx, a, HookEnd.TIMED_OUT);
		backToKeep(a);
	}
}

function yanking(ctx: SimCtx, a: ActorState, d: ChainhookData): void {
	faceToward(a, a.v[CHAINHOOK_DIR_X], a.v[CHAINHOOK_DIR_Z]);
	a.aiTicks -= 1;
	if (a.aiTicks > 0) return;
	ctx.fireEnemy(a, a.v[CHAINHOOK_DIR_X], a.v[CHAINHOOK_DIR_Z], d.yankFan);
	backToKeep(a);
}

/** The sniper's reposition (approach / back off / strafe; no timed strafe flips: no draw) and the throw decision. */
function keepRange(ctx: SimCtx, a: ActorState, d: ChainhookData): void {
	const p = ctx.player;
	const tp = toPlayer(ctx, a);
	const dist = tp.dist;
	const dirX = tp.dirX;
	const dirZ = tp.dirZ;
	const los = ctx.lineOfSight(a.x, a.z, p.x, p.z);
	if (los) {
		a.v[CHAINHOOK_LOST] = 0;
	} else {
		a.v[CHAINHOOK_LOST] += 1;
		if (a.v[CHAINHOOK_LOST] > d.lostTicks) {
			a.v[CHAINHOOK_LOST] = 0;
			leash(a);
			return;
		}
	}
	if (a.cooldown > 0) a.cooldown--;
	if (los && a.cooldown <= 0 && dist <= d.throwRange) {
		a.v[CHAINHOOK_DIR_X] = dirX;
		a.v[CHAINHOOK_DIR_Z] = dirZ;
		a.v[CHAINHOOK_THROW_TARGET] = ctx.playerIndex + 1;
		faceToward(a, dirX, dirZ);
		a.cooldown = enemyCooldown(ctx, a, d.throwCooldownMin, d.throwCooldownMax);
		ctx.telegraph(a, d.aimTicks, CHAINHOOK_ATTACK_THROW);
		return;
	}
	const stepLen = walkStep(ctx, a);
	if (!los) {
		// Lost sight: walk toward the target to find a line again (walls slide it around corners).
		walkToward(ctx, a, p.x, p.z, stepLen, STEER);
		return;
	}
	faceToward(a, dirX, dirZ);
	const radial = dist < d.keepMin ? -1 : dist > d.keepMax ? 1 : 0;
	const side = a.v[CHAINHOOK_STRAFE] * d.strafeWeight;
	// Perpendicular to the target direction: (-dirZ, dirX).
	let mx = dirX * radial - dirZ * side;
	let mz = dirZ * radial + dirX * side;
	const m2 = mx * mx + mz * mz;
	if (m2 <= MIN_DIR2) return;
	const k = stepLen / math.sqrt(m2);
	mx *= k;
	mz *= k;
	const x0 = a.x;
	const z0 = a.z;
	moveActor(ctx, a, mx, mz, STEER);
	const ox = a.x - x0;
	const oz = a.z - z0;
	if (ox * ox + oz * oz < stepLen * stepLen * STRAFE_BLOCKED * STRAFE_BLOCKED) {
		a.v[CHAINHOOK_STRAFE] = -a.v[CHAINHOOK_STRAFE];
	}
}

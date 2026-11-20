/**
 * 'jackal' (Roblox port, docs/NEW_ENEMIES_3.md "Design > Jackal", NT4; no web source): a lanky beast that comes as a
 * pack of three (one buy, NTD6), circles its target and lunges at its back; facing it during the wind-up spooks it off,
 * and a sword guard into a lunge staggers it (a parry, NTD9). 3 hp, contact damage 0 (the lunge hurts through its own
 * overlap check, `ctx.hurtPlayerAt`, the Bulwark's bash rule; NT0 correction 1). Built from the swarmer's lunge and the
 * Bulwark's hit bits; a copy, never an import of their steps.
 *
 * The target is the nearest living player (ctx.player, re-bound per actor per tick, NT0 finding 15); the pack is every
 * living Jackal with the same target: no pack id is stored.
 *
 *   1. Circling (JACKAL_CIRCLE): each tick the walk is the tangent round the target (side +1 / -1 from the actor id's
 *      parity, no draw), plus a radial pull toward the middle of the band circleMin-circleMax ((dist - mid) / half: equal
 *      to the tangent at the band's edges, dominant far out), plus a push off every other living Jackal within
 *      `separation` (each by its overlap share, slot order; exactly stacked: split along X by id), normalised to at most
 *      unit length (a shorter sum walks that share of a step: a crowded follower slows), through walkStep and the steer
 *      mover; it faces the way it walks. Without sight of its target it walks straight at it (the
 *      steer mover) to find a line and leashes after lostTicks (aiTicks counts them). Its cooldown counts down here only.
 *   2. The wind-up starts when the cooldown is out, its target is within lungeRange and in sight, it stands OUTSIDE the
 *      target's front cone (jackalBehind: dot(face, toJackal) < frontCos x |toJackal|, no sqrt) and the token is free
 *      (jackalTokenFree: no other living Jackal is winding up or lunging at the same target; a slot-order scan, so two can
 *      never start on one tick). The target, its nearest living player now, is locked in v[JACKAL_TARGET] for the
 *      attack (NT4: in co-op its nearest player can change mid-lunge; the lock keeps one per target). ctx.telegraph windupTicks with JACKAL_ATTACK_LUNGE (the
 *      crouch; the `aimLine` hint along the heading to the target, locked in v[JACKAL_DIR_*]). It stands facing the
 *      heading. No draw.
 *   3. Spooked: on any wind-up tick, when its locked target (alive) faces it (dot >= spookCos x |toJackal|), the lunge is called
 *      off: JACKAL_HOP for hopTicks, hopDistance back along the locked heading (moveActor, the plain mover), then its
 *      cooldown is spookCooldownTicks (`enemyCooldownFixed`, no draw). events.spooks += 1.
 *   4. The lunge (JACKAL_LUNGE, from the tick after the wind-up's last): ONE cooldown draw (lungeCooldownMin-Max) as it
 *      starts, events.lunges += 1, then lungeDistance / lungeTicks a tick along the heading (moveActor, the plain mover; a
 *      move under half its step is a wall and ends it early, the swarmer's rule). After every move, the first overlap
 *      with each living player (bit k of v[JACKAL_HIT_BITS], set on the overlap whether or not the hit lands) hurts
 *      lungeDamage once, unless that player's sword guard stops it (5). Then JACKAL_RECOVER for recoverTicks, standing.
 *   5. NTD9, the guard stop (NT0 findings 8 / 9): a player not rolling (rollTicks 0) whose active slot is the sword with
 *      v[SWORD_V_GUARD] > 0 (the guard sweeps this tick) and the Jackal within its reach (SWORD_DATA.guardReach) inside
 *      its sweep cone (swordGuardSweepCos: dot >= cos x the distance, melee.ts inCone's test; Bastion's full ring
 *      included) refuses the hit: JACKAL_STAGGER for staggerTicks (standing, full damage taken), the lunge over. A
 *      scored run pushes ONE guardX / guardZ (the contact point on the player's rim toward the Jackal) / guardPlayer
 *      entry on ScoreEvents: a parry for the view (sparks, PARRY!, recap, contribution, haptics), but no
 *      scoreGuardCancels (no points, nothing hashed), no Riposte or brace count.
 *   6. NTD10: the last Jackal of a pack keeps the back-only rule (2 has no exception).
 *
 * Draws: the first cooldown in init; one per lunge (at its start). The wind-up, a spook, the circling, a stagger and the
 * death draw nothing, so the draw count never depends on the layout.
 *
 * Pinned (Siege Bolt): a pinned actor does not step, so a pinned Jackal's wind-up waits while it is held, and keeps the
 * token for its target until it is released (NT11 note).
 *
 * View contract: states JACKAL_CIRCLE (= STATE_ENGAGED) / AiState.TELEGRAPH (the wind-up, crouched; attack
 * JACKAL_ATTACK_LUNGE, aiTicks left) / JACKAL_LUNGE (aiTicks left; attack still JACKAL_ATTACK_LUNGE) / JACKAL_RECOVER /
 * JACKAL_HOP (spooked) / JACKAL_STAGGER (v[JACKAL_PHASE] ticks left in the last three); v slots JACKAL_DIR_X / _Z (the
 * lunge heading), JACKAL_HIT_BITS, JACKAL_TARGET (the locked target while winding up or lunging). Feeds (unhashed): SimEvents.lunges / spooks, and the guard feed above.
 *
 * @module
 */

import { HIT_NORMAL, PLAYER_RADIUS, secondsToTicks } from "../../../playerData";
import { partySize, playerAt, weaponsAt } from "../../../party";
import type { PlayerState } from "../../../state";
import type { SimCtx } from "../../ctx";
import { activeWeaponSlot } from "../../weapons/weapons";
import { weaponIndex } from "../../weapons/registry";
import { NO_WEAPON } from "../../weapons/types";
import { SWORD, SWORD_DATA, SWORD_V_GUARD, swordGuardSweepCos } from "../../weapons/defs/sword";
import { enemyCooldown, enemyCooldownFixed, walkStep } from "../actorMods";
import { faceToward, moveActor, toPlayer } from "../helpers";
import { PORT_BAND_ENEMIES_4, registerArchetype } from "../registry";
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
export interface JackalData extends RoomEnemyData {
	/** The circling band around its target (world units). */
	readonly circleMin: number;
	readonly circleMax: number;
	/** Pushes away from every other Jackal within this (world units). */
	readonly separation: number;
	/** Lunges only from outside its target's front cone: dot(face, toJackal) < frontCos (a cosine literal). */
	readonly frontCos: number;
	/** Called off when, during the wind-up, the facing turns onto it: dot >= spookCos (a cosine literal). */
	readonly spookCos: number;
	/**
	 * Starts a wind-up only with its target this close (world units; NT4: the plan is silent): the lunge's distance plus
	 * the overlap reach (radius + PLAYER_RADIUS 0.67) is 3.47, so from here the lunge reaches a target that stands.
	 */
	readonly lungeRange: number;
	/** The wind-up: the telegraph's ticks (crouched, the aim line along the locked heading). */
	readonly windupTicks: number;
	/** The lunge: lungeDistance world units over lungeTicks along the locked heading. */
	readonly lungeDistance: number;
	readonly lungeTicks: number;
	/** Half hearts the lunge deals, once per player. */
	readonly lungeDamage: number;
	/** Standing after a lunge (the punish window). */
	readonly recoverTicks: number;
	/** Spooked: a hop back hopDistance over hopTicks, then spookCooldownTicks to the next try. */
	readonly hopDistance: number;
	readonly hopTicks: number;
	readonly spookCooldownTicks: number;
	/** Staggered by a sword guard (NTD9): standing still, taking full damage. */
	readonly staggerTicks: number;
	/** Ticks between lunges (random in [min, max], `enemyCooldown`), and before the first one. */
	readonly lungeCooldownMin: number;
	readonly lungeCooldownMax: number;
}

// --- States and attack ids
/** Circling its target. */
export const JACKAL_CIRCLE = STATE_ENGAGED;
/** Lunging along v[JACKAL_DIR_X / _Z]. */
export const JACKAL_LUNGE = STATE_ENGAGED + 1;
/** Standing after a lunge. */
export const JACKAL_RECOVER = STATE_ENGAGED + 2;
/** Spooked: the hop back. */
export const JACKAL_HOP = STATE_ENGAGED + 3;
/** Staggered by a sword guard. */
export const JACKAL_STAGGER = STATE_ENGAGED + 4;
/** ActorState.attack while winding up / lunging. */
export const JACKAL_ATTACK_LUNGE = 1;

// --- v[] slots (0..2 shared)
/** Ticks left in the hop / recover / stagger. */
export const JACKAL_PHASE = 3;
/** The lunge heading (unit), locked when the wind-up starts. */
export const JACKAL_DIR_X = 4;
export const JACKAL_DIR_Z = 5;
/** Players this lunge already hurt (bit k: player k). */
export const JACKAL_HIT_BITS = 6;
/**
 * The target (party index) locked when the wind-up starts: whose token it holds and whose facing can spook it (NT4: in
 * co-op a lunging Jackal's nearest player can change mid-attack; the lock keeps one per target).
 */
export const JACKAL_TARGET = 7;

const LUNGE_DISTANCE = 2.8;

export const JACKAL = registerArchetype<JackalData>({
	id: "jackal",
	band: PORT_BAND_ENEMIES_4,
	data: {
		hp: 3,
		radius: 0.32,
		speed: 4.6,
		contactDamage: 0,
		spriteId: "enemy.jackal",
		roomEnemy: true,
		aggroRange: 8,
		leashRange: 16,
		lostTicks: secondsToTicks(2),
		alertRange: 4.5,
		circleMin: 3,
		circleMax: 3.6,
		separation: 1.4,
		frontCos: 0.34,
		spookCos: 0.5,
		lungeRange: 3.4,
		windupTicks: secondsToTicks(0.35), // 21
		lungeDistance: LUNGE_DISTANCE,
		lungeTicks: secondsToTicks(0.18), // 11
		lungeDamage: HIT_NORMAL,
		recoverTicks: secondsToTicks(0.5), // 30
		hopDistance: 1.2,
		hopTicks: secondsToTicks(0.2), // 12
		spookCooldownTicks: secondsToTicks(0.6), // 36
		staggerTicks: secondsToTicks(1), // 60
		lungeCooldownMin: secondsToTicks(1.4),
		lungeCooldownMax: secondsToTicks(2),
		fx: {
			aimLine: {
				dirX: JACKAL_DIR_X,
				dirZ: JACKAL_DIR_Z,
				length: LUNGE_DISTANCE,
				boldTicks: 8,
				attack: JACKAL_ATTACK_LUNGE,
			},
		},
	},
	init(ctx, a) {
		initRoomEnemy(a);
		const d = ctx.data<JackalData>(a);
		a.cooldown = enemyCooldown(ctx, a, d.lungeCooldownMin, d.lungeCooldownMax); // the init's one draw
	},
	step(ctx, a) {
		const d = ctx.data<JackalData>(a);
		if (stepCalm(ctx, a)) return;
		if (shouldLeash(ctx, a)) {
			leash(a);
			return;
		}
		const st = a.aiState;
		if (st === AiState.TELEGRAPH) windUp(ctx, a, d);
		else if (st === JACKAL_LUNGE) lunging(ctx, a, d);
		else if (st === JACKAL_HOP) hopping(ctx, a, d);
		else if (st === JACKAL_RECOVER || st === JACKAL_STAGGER) standing(a);
		else circle(ctx, a, d);
	},
	onHit(ctx, a) {
		engageOnHit(ctx, a);
	},
	onDeath(ctx, a) {
		alertOnDeath(ctx, a);
	},
});

/** Two Jackals on the exact same point split along X by id, each by this share of `separation`. */
const STACKED_SPLIT = 0.5;
/** A lunge move shorter than this fraction of its step hit a wall: the lunge ends early (the swarmer's rule). */
const LUNGE_BLOCKED = 0.5;
/** A vector shorter than this (squared) is no direction. */
const EPS2 = 1e-12;

/**
 * True when a point at offset (dx, dz) from a player facing (fx, fz) is OUTSIDE the cone dot(face, offset) >= cos x
 * |offset| (Architecture 1's `behindPlayer`): no sqrt, both sides squared with the sign checked. A point on the player
 * is in front (never behind). `cos` is a literal (frontCos 0.34; the spook's complement is !jackalBehind(.., spookCos)).
 */
export function jackalBehind(fx: number, fz: number, dx: number, dz: number, cos: number): boolean {
	const len2 = dx * dx + dz * dz;
	if (len2 <= EPS2) return false;
	const dot = fx * dx + fz * dz;
	const rhs2 = cos * cos * len2;
	// dot < cos x len: for cos >= 0 true when dot < 0 or dot^2 < cos^2 len^2; for cos < 0 only when dot < 0 and
	// dot^2 > cos^2 len^2.
	if (cos >= 0) return dot < 0 || dot * dot < rhs2;
	return dot < 0 && dot * dot > rhs2;
}

/** jackalBehind for player `p` and the point (x, z). */
function behindOf(p: Readonly<PlayerState>, x: number, z: number, cos: number): boolean {
	return jackalBehind(p.faceX, p.faceZ, x - p.x, z - p.z, cos);
}

/** True while `o` holds its target's token: winding up its lunge or lunging. */
export function jackalHoldsToken(o: Readonly<ActorState>): boolean {
	return (
		o.alive !== 0 &&
		(o.aiState === JACKAL_LUNGE || (o.aiState === AiState.TELEGRAPH && o.attack === JACKAL_ATTACK_LUNGE))
	);
}

/**
 * The one-at-a-time token: true when no other living Jackal is winding up or lunging at `target` (its locked
 * v[JACKAL_TARGET]: its nearest living player when it started, NT0 finding 15). A slot-order scan; actors before `a`
 * have stepped this tick, so two can never start at once on one target.
 */
export function jackalTokenFree(ctx: SimCtx, a: Readonly<ActorState>, target: number): boolean {
	const actors = ctx.actors;
	for (let i = 0; i < actors.size(); i++) {
		const o = actors[i];
		if (o === a || o.kind !== a.kind || !jackalHoldsToken(o)) continue;
		if (o.v[JACKAL_TARGET] === target) return false;
	}
	return true;
}

let swordKind = -1;
/** The sword's weapon index (looked up once, after the weapons registered). */
function swordIndex(): number {
	if (swordKind < 0) swordKind = weaponIndex(SWORD.id);
	return swordKind;
}

/**
 * NTD9 (NT0 finding 8): true when player `k`'s sword guard sweeps this tick with `a` inside it: not rolling, the active
 * slot is the sword with v[SWORD_V_GUARD] > 0 (the weapons phase steps after the actors, so > 0 means the guard sweeps
 * this tick too), `a` within SWORD_DATA.guardReach and inside swordGuardSweepCos (melee.ts inCone: dot >= cos x the
 * distance; Bastion's full ring always holds).
 */
export function jackalGuardStops(ctx: SimCtx, k: number, a: Readonly<ActorState>): boolean {
	const p = playerAt(ctx.state, k);
	if (p.rollTicks > 0) return false;
	const slot = activeWeaponSlot(weaponsAt(ctx.state, k));
	if (slot === undefined || slot.weapon === NO_WEAPON || slot.weapon !== swordIndex()) return false;
	if (!(slot.v[SWORD_V_GUARD] > 0)) return false;
	const dx = a.x - p.x;
	const dz = a.z - p.z;
	const d2 = dx * dx + dz * dz;
	const reach = SWORD_DATA.guardReach;
	if (d2 > reach * reach) return false;
	return p.faceX * dx + p.faceZ * dz >= swordGuardSweepCos(ctx.state, k) * math.sqrt(d2);
}

/** The circling walk, the cooldown, and the wind-up's start (see the file comment, 1-2). */
function circle(ctx: SimCtx, a: ActorState, d: JackalData): void {
	const p = ctx.player;
	const tp = toPlayer(ctx, a);
	const dist = tp.dist;
	const dirX = tp.dirX;
	const dirZ = tp.dirZ;
	const los = ctx.lineOfSight(a.x, a.z, p.x, p.z);
	if (los) a.aiTicks = 0;
	else {
		a.aiTicks += 1;
		if (a.aiTicks > d.lostTicks) {
			leash(a);
			return;
		}
	}
	if (a.cooldown > 0) a.cooldown--;
	if (
		los &&
		a.cooldown <= 0 &&
		dist <= d.lungeRange &&
		behindOf(p, a.x, a.z, d.frontCos) &&
		jackalTokenFree(ctx, a, ctx.playerIndex)
	) {
		a.v[JACKAL_DIR_X] = dirX;
		a.v[JACKAL_DIR_Z] = dirZ;
		a.v[JACKAL_HIT_BITS] = 0;
		a.v[JACKAL_TARGET] = ctx.playerIndex;
		faceToward(a, dirX, dirZ);
		ctx.telegraph(a, d.windupTicks, JACKAL_ATTACK_LUNGE);
		return;
	}
	const stepLen = walkStep(ctx, a);
	if (!los) {
		// Finds a line: straight at the target on the steer mover.
		const k = dist < stepLen ? dist : stepLen;
		faceToward(a, dirX, dirZ);
		moveActor(ctx, a, dirX * k, dirZ * k, STEER);
		return;
	}
	const side = a.id % 2 === 0 ? 1 : -1;
	const mid = (d.circleMin + d.circleMax) * 0.5;
	const half = (d.circleMax - d.circleMin) * 0.5;
	const radial = (dist - mid) / half;
	let wx = -dirZ * side + dirX * radial;
	let wz = dirX * side + dirZ * radial;
	// Separation from every other living Jackal within `separation` (slot order).
	const actors = ctx.actors;
	const sep = d.separation;
	const sep2 = sep * sep;
	for (let i = 0; i < actors.size(); i++) {
		const o = actors[i];
		if (o === a || o.kind !== a.kind || o.alive === 0) continue;
		const ox = a.x - o.x;
		const oz = a.z - o.z;
		const o2 = ox * ox + oz * oz;
		if (o2 >= sep2) continue;
		if (o2 < EPS2) {
			wx += a.id < o.id ? -STACKED_SPLIT : STACKED_SPLIT;
			continue;
		}
		const od = math.sqrt(o2);
		const k = (sep - od) / (sep * od); // the unit push times its overlap share
		wx += ox * k;
		wz += oz * k;
	}
	// Normalised to at most one walk step: a longer sum walks one step its way, a shorter one (a packmate pushing
	// against the tangent) walks that share of a step, so a follower slows and the pair spreads.
	const w2 = wx * wx + wz * wz;
	if (w2 <= EPS2) return;
	const k = w2 > 1 ? stepLen / math.sqrt(w2) : stepLen;
	faceToward(a, wx, wz);
	moveActor(ctx, a, wx * k, wz * k, STEER);
}

/** The wind-up: stands facing the locked heading; spooked when the target faces it; the last tick starts the lunge. */
function windUp(ctx: SimCtx, a: ActorState, d: JackalData): void {
	faceToward(a, a.v[JACKAL_DIR_X], a.v[JACKAL_DIR_Z]);
	const target = playerAt(ctx.state, a.v[JACKAL_TARGET]);
	if (target.dead === 0 && !behindOf(target, a.x, a.z, d.spookCos)) {
		// Spooked (no draw): the hop back, then a short fixed cooldown.
		a.aiState = JACKAL_HOP;
		a.aiTicks = 0;
		a.attack = 0;
		a.v[JACKAL_PHASE] = d.hopTicks;
		a.cooldown = enemyCooldownFixed(ctx, a, d.spookCooldownTicks);
		ctx.events.spooks += 1;
		return;
	}
	a.aiTicks -= 1;
	if (a.aiTicks > 0) return;
	a.aiState = JACKAL_LUNGE;
	a.aiTicks = d.lungeTicks;
	a.v[JACKAL_HIT_BITS] = 0;
	a.cooldown = enemyCooldown(ctx, a, d.lungeCooldownMin, d.lungeCooldownMax); // the lunge's one draw
	ctx.events.lunges += 1;
}

/** One lunge tick: the move (a wall ends it early), then the hits or a guard stop. */
function lunging(ctx: SimCtx, a: ActorState, d: JackalData): void {
	const dirX = a.v[JACKAL_DIR_X];
	const dirZ = a.v[JACKAL_DIR_Z];
	const stepLen = d.lungeDistance / d.lungeTicks;
	const x0 = a.x;
	const z0 = a.z;
	moveActor(ctx, a, dirX * stepLen, dirZ * stepLen);
	const mx = a.x - x0;
	const mz = a.z - z0;
	const blocked = mx * mx + mz * mz < stepLen * stepLen * LUNGE_BLOCKED * LUNGE_BLOCKED;
	if (lungeHits(ctx, a, d)) return; // staggered
	a.aiTicks -= 1;
	if (a.aiTicks > 0 && !blocked) return;
	a.aiState = JACKAL_RECOVER;
	a.aiTicks = 0;
	a.attack = 0;
	a.v[JACKAL_PHASE] = d.recoverTicks;
}

/**
 * The first overlap with each living player this lunge (bit k of v[JACKAL_HIT_BITS]) hurts them once, unless their
 * guard stops it (jackalGuardStops): then the stagger and the parry feed, and true (the lunge is over).
 */
function lungeHits(ctx: SimCtx, a: ActorState, d: JackalData): boolean {
	const n = partySize(ctx.state);
	const reach = a.radius + PLAYER_RADIUS;
	const reach2 = reach * reach;
	for (let k = 0; k < n; k++) {
		const bit = bit32.lshift(1, k);
		if (bit32.band(a.v[JACKAL_HIT_BITS], bit) !== 0) continue;
		const p = playerAt(ctx.state, k);
		if (p.dead !== 0) continue;
		const dx = a.x - p.x;
		const dz = a.z - p.z;
		if (dx * dx + dz * dz >= reach2) continue;
		a.v[JACKAL_HIT_BITS] = bit32.bor(a.v[JACKAL_HIT_BITS], bit);
		if (jackalGuardStops(ctx, k, a)) {
			stagger(ctx, a, d, k, p.x + dx * (PLAYER_RADIUS / reach), p.z + dz * (PLAYER_RADIUS / reach));
			return true;
		}
		ctx.hurtPlayerAt(k, d.lungeDamage, a.kind);
	}
	return false;
}

/** NTD9: staggered by player `k`'s guard; a scored run feeds one parry entry at (cx, cz) (no points, nothing hashed). */
function stagger(ctx: SimCtx, a: ActorState, d: JackalData, k: number, cx: number, cz: number): void {
	a.aiState = JACKAL_STAGGER;
	a.aiTicks = 0;
	a.attack = 0;
	a.v[JACKAL_PHASE] = d.staggerTicks;
	const score = ctx.state.score;
	if (score === undefined) return;
	score.events.guardX.push(cx);
	score.events.guardZ.push(cz);
	score.events.guardPlayer.push(k);
}

/** Spooked: hopDistance back along the locked heading over hopTicks (the plain mover), then circling again. */
function hopping(ctx: SimCtx, a: ActorState, d: JackalData): void {
	const len = d.hopDistance / d.hopTicks;
	faceToward(a, a.v[JACKAL_DIR_X], a.v[JACKAL_DIR_Z]);
	moveActor(ctx, a, -a.v[JACKAL_DIR_X] * len, -a.v[JACKAL_DIR_Z] * len);
	standing(a);
}

/** Counts v[JACKAL_PHASE] down (hop / recover / stagger); at 0 it circles again. */
function standing(a: ActorState): void {
	a.v[JACKAL_PHASE] -= 1;
	if (a.v[JACKAL_PHASE] > 0) return;
	a.v[JACKAL_PHASE] = 0;
	a.aiState = JACKAL_CIRCLE;
	a.aiTicks = 0;
	a.attack = 0;
}

/**
 * 'mender' (Roblox port, docs/NEW_ENEMIES_3.md "Design > Mender", NT3; no web source): a small imp with bone charms that
 * channels a heal beam into the most wounded room enemy near it; a hit on it, a player's body on the beam or a wall
 * between them cuts the beam. With nobody to heal it plinks its target with slow bolts. 5 hp, contact damage 0. Built
 * from the summoner's shape (keep range, ally scans) and a caster's bolt; a copy, never an import of their steps.
 *
 *   1. The pick (MENDER_KEEP, every pickEveryTicks; no draw): the most wounded heal target (isMenderHealTarget: a living
 *      room enemy, never a boss, the Goldling, the dummy, a pyre or another Mender, NTD8 / NT0 finding 4) with
 *      hp < hpMax, within healRange and in sight (ctx.lineOfSight). Most wounded = lowest hp / hpMax, compared by
 *      cross-multiplying; ties go to slot order. Kept in v[MENDER_ALLY] (its actor id) until the next pick; dropped at
 *      once when that ally dies or is full again.
 *   2. Keeping range (MENDER_KEEP): without an ally it keeps keepMin-keepMax from its target (approach / back off /
 *      strafe; the strafe side flips when a wall stops it and after every bolt; no draw); without sight of its target it
 *      walks toward it to find a line and leashes after lostTicks without one (aiTicks counts them). With an ally it
 *      walks to stay within healRange - followSlack of the ALLY instead: farther, it walks to the ally (steer mover);
 *      closer, it keeps its range from the target but undoes any move that ends farther than that from the ally.
 *   3. One cooldown (a.cooldown, counted down while keeping range and flinching) gates both actions, so the Mender does
 *      one thing at a time: the first in init (a bolt's), a channel cooldown after every channel end, a bolt's after
 *      every bolt. Out, with an ally that is still in range, in sight and not body-blocked: the link (ctx.telegraph
 *      linkTicks, MENDER_ATTACK_HEAL; it stands still facing the ally). Out, with no ally and its target in sight within
 *      boltRange: the bolt (step 6).
 *   4. The channel (MENDER_CHANNEL, after the link; standing still facing the ally): every pulseTicks the ally gains
 *      healAmount hp through ctx.healActor (never above hpMax, never damageActor), v[MENDER_HEALED] += it. It ENDS when
 *      (checked every link and channel tick, in this order): the ally is dead or gone (HealEnd.ALLY_GONE) or full
 *      (FULL; also right after the pulse that fills it); a wall comes between them (SIGHT); a living player's centre is
 *      within PLAYER_RADIUS + beamBlockPad of the segment between them, only where it projects between the two ends
 *      (BLOCKED, menderBeamBlocker: any player, so a teammate can body-block in co-op); the channel's channelTicks are
 *      up (TIME); any hit on the Mender, link or channel (DAMAGE, from onHit: also a hit a Shielded affix or a cap
 *      soaked up whole; then MENDER_FLINCH for flinchTicks, standing still); it leashes (LEASH). Every end but its death
 *      draws ONE cooldown (channelCooldownMin-Max) and clears the ally (the next pick is on the next keep tick).
 *   5. Its death (onDeath) mid-link or mid-channel ends it (HealEnd.DEATH, no draw).
 *   6. The bolt: ONE enemyCooldown draw (the next action's), a short wind-up (ctx.telegraph boltWindupTicks,
 *      MENDER_ATTACK_BOLT; not in the plan's table: every attack starts through ctx.telegraph), then one aimed `bolt`
 *      (BulletKind.CASTER, the medium look) at its target's position at the release. Sight is not re-checked there.
 *
 * Pinned (Siege Bolt): a pinned actor does not step, so its link / channel / flinch / cooldown wait while it is held;
 * the hit that pins it is a hit (onHit), so a channelling Mender is cut by it before the pin holds it.
 *
 * Draws: init 1 (the first action's cooldown); each channel end 1 (not its death); each bolt 1 (at the wind-up's
 * start). The pick, the heal, the movement, a call-off and the death use none, so the draw count never depends on the
 * layout.
 *
 * Feed (unhashed): SimEvents.heals / healCuts and CombatState.healEvents (../../healEvents.ts: every pulse's ally slot
 * and hp, every end's Mender slot and HealEnd reason).
 *
 * View contract: states MENDER_KEEP (= STATE_ENGAGED) / AiState.TELEGRAPH (attack MENDER_ATTACK_HEAL: the link,
 * MENDER_ATTACK_BOLT: the bolt's wind-up) / MENDER_CHANNEL / MENDER_FLINCH; v slots MENDER_ALLY (the ally's actor id, 0
 * none: the beam runs to it while linking or channelling; while keeping range it is the ally it follows),
 * MENDER_CHANNEL_TICKS, MENDER_PULSE (ticks to the next pulse while channelling, to the next pick otherwise),
 * MENDER_STRAFE (+1 / -1), MENDER_HEALED (hp healed this life).
 *
 * @module
 */

import { HIT_NORMAL, PLAYER_RADIUS, secondsToTicks } from "../../../playerData";
import { partySize, playerAt } from "../../../party";
import type { SimState } from "../../../state";
import { BulletKind, type BurstSpec } from "../../patterns";
import type { SimCtx } from "../../ctx";
import { HealEnd, healEndCuts } from "../../healEvents";
import { enemyCooldown, walkStep } from "../actorMods";
import { faceToward, moveActor, toPlayer, walkToward } from "../helpers";
import { PORT_BAND_ENEMIES_4, archetypeAt, archetypeIndex, registerArchetype } from "../registry";
import { AiState, NO_KIND, type ActorState } from "../types";
import {
	STATE_ENGAGED,
	STEER,
	alertOnDeath,
	engageOnHit,
	initRoomEnemy,
	isRoomEnemyData,
	leash,
	shouldLeash,
	stepCalm,
	type RoomEnemyData,
} from "./enemyShared";

export interface MenderData extends RoomEnemyData {
	/** Preferred distance band to its target (world units). */
	readonly keepMin: number;
	readonly keepMax: number;
	/** Weight of the sideways component of the keep-range move (radial is 1). */
	readonly strafeWeight: number;
	/** Heals an ally within this distance (and in sight); with a wounded ally it walks to stay this close. */
	readonly healRange: number;
	/** With an ally it follows it to within healRange - followSlack (a margin so the next pick still finds it). */
	readonly followSlack: number;
	/** Ticks between two picks while not channelling. */
	readonly pickEveryTicks: number;
	/** The link: the telegraph's ticks (the beam forms). */
	readonly linkTicks: number;
	/** The channel's longest run (ticks), and its pulse: healAmount hp every pulseTicks. */
	readonly channelTicks: number;
	readonly pulseTicks: number;
	readonly healAmount: number;
	/** A living player whose centre is within PLAYER_RADIUS + this of the beam's segment blocks it (world units). */
	readonly beamBlockPad: number;
	/** Standing hurt after a hit cut the channel (ticks). */
	readonly flinchTicks: number;
	/** Ticks after a channel ends before the next action (random in [min, max], `enemyCooldown`). */
	readonly channelCooldownMin: number;
	readonly channelCooldownMax: number;
	/** Bolts its target in sight within this (world units) when no ally is wounded. */
	readonly boltRange: number;
	/** The bolt's wind-up (ctx.telegraph; NT3: every attack starts through a telegraph). */
	readonly boltWindupTicks: number;
	/** Ticks between bolts (random in [min, max]), and before the first action (drawn in init). */
	readonly boltCooldownMin: number;
	readonly boltCooldownMax: number;
	/** One aimed bolt (BulletKind.CASTER: the caster's medium look, NT0 correction 3). */
	readonly bolt: BurstSpec;
}

// --- States and attack ids
/** Keeping range (or keeping near a wounded ally). */
export const MENDER_KEEP = STATE_ENGAGED;
/** Channelling the heal into v[MENDER_ALLY]. */
export const MENDER_CHANNEL = STATE_ENGAGED + 1;
/** Standing hurt after a hit cut the channel. */
export const MENDER_FLINCH = STATE_ENGAGED + 2;
/** ActorState.attack while linking / channelling. */
export const MENDER_ATTACK_HEAL = 1;
/** ActorState.attack during the bolt's wind-up. */
export const MENDER_ATTACK_BOLT = 2;

// --- v[] slots (0..2 shared)
/** The ally's actor id (0 none): ids are never reused in a run, so the link is exact. */
export const MENDER_ALLY = 3;
/** Channel ticks so far. */
export const MENDER_CHANNEL_TICKS = 4;
/** Ticks to the next heal pulse while channelling; to the next pick otherwise. */
export const MENDER_PULSE = 5;
/** Strafe side, +1 or -1. */
export const MENDER_STRAFE = 6;
/** Hp healed this life (scratch, hashed like every v slot; read by the view and NT12). */
export const MENDER_HEALED = 7;

/** A move shorter than this fraction of the step means a wall: flip the strafe side (the summoner's rule). */
const STRAFE_BLOCKED = 0.3;

export const MENDER = registerArchetype<MenderData>({
	id: "mender",
	band: PORT_BAND_ENEMIES_4,
	data: {
		hp: 5,
		radius: 0.35,
		speed: 2.6,
		contactDamage: 0,
		spriteId: "enemy.mender",
		roomEnemy: true,
		aggroRange: 9,
		leashRange: 15,
		lostTicks: secondsToTicks(2.5),
		alertRange: 4.5,
		keepMin: 5,
		keepMax: 8,
		strafeWeight: 0.8,
		healRange: 6,
		followSlack: 1,
		pickEveryTicks: 15,
		linkTicks: secondsToTicks(0.4), // 24
		channelTicks: secondsToTicks(3), // 180
		pulseTicks: 30,
		healAmount: 1,
		beamBlockPad: 0.15,
		flinchTicks: secondsToTicks(0.4), // 24
		channelCooldownMin: secondsToTicks(1.2),
		channelCooldownMax: secondsToTicks(1.6),
		boltRange: 9,
		boltWindupTicks: secondsToTicks(0.3), // 18
		boltCooldownMin: secondsToTicks(2.2),
		boltCooldownMax: secondsToTicks(2.8),
		bolt: {
			count: 1,
			spread: 0,
			speed: 4.5,
			life: 2.5,
			damage: HIT_NORMAL,
			kind: BulletKind.CASTER,
		},
	},
	init(ctx, a) {
		initRoomEnemy(a);
		const d = ctx.data<MenderData>(a);
		// No draw for the side: alternate by actor id. One draw: the first action's cooldown (a bolt's).
		a.v[MENDER_STRAFE] = a.id % 2 === 0 ? 1 : -1;
		a.cooldown = enemyCooldown(ctx, a, d.boltCooldownMin, d.boltCooldownMax);
	},
	step(ctx, a) {
		const d = ctx.data<MenderData>(a);
		if (stepCalm(ctx, a)) return;
		if (shouldLeash(ctx, a)) {
			if (menderLinked(a)) endChannel(ctx, a, d, HealEnd.LEASH);
			a.v[MENDER_ALLY] = 0;
			leash(a);
			return;
		}
		if (a.aiState === AiState.TELEGRAPH) {
			if (a.attack === MENDER_ATTACK_HEAL) linking(ctx, a, d);
			else boltWindup(ctx, a, d);
		} else if (a.aiState === MENDER_CHANNEL) channelling(ctx, a, d);
		else if (a.aiState === MENDER_FLINCH) flinching(a);
		else keepRange(ctx, a, d);
	},
	onHit(ctx, a) {
		engageOnHit(ctx, a);
		// Any hit cuts the link or the channel (a killing hit is the death's end instead: onDeath, no draw).
		if (a.hp > 0 && menderLinked(a)) endChannel(ctx, a, ctx.data<MenderData>(a), HealEnd.DAMAGE);
	},
	onDeath(ctx, a) {
		alertOnDeath(ctx, a);
		if (menderLinked(a)) pushEnd(ctx, a, HealEnd.DEATH);
		a.v[MENDER_ALLY] = 0;
		a.aiState = MENDER_KEEP;
		a.aiTicks = 0;
		a.attack = 0;
	},
});

/** True while `a` links or channels (the beam is up). */
export function menderLinked(a: Readonly<ActorState>): boolean {
	return a.aiState === MENDER_CHANNEL || (a.aiState === AiState.TELEGRAPH && a.attack === MENDER_ATTACK_HEAL);
}

/**
 * NTD8 (NT0 finding 4): true when an actor of archetype index `kind` may be healed by a Mender: a room enemy
 * (`isRoomEnemyData`), not a boss and not a Mender. The Goldling, the dummy, a pyre and the turrets are no room
 * enemies; a boss's swarmer adds, slimelets and summoned swarmers are (healable). The shape of warbanner.ts
 * `isWarbannerAuraTarget`.
 */
export function isMenderHealTarget(kind: number, menderKind = archetypeIndex(MENDER.id)): boolean {
	if (kind === NO_KIND || kind === menderKind) return false;
	const data = archetypeAt(kind).data;
	return isRoomEnemyData(data) && data.boss !== true;
}

/** The live actor carrying `id` (0 = none), or undefined (dead, freed, or the slot reused by another actor). */
function liveActorById(actors: ReadonlyArray<ActorState>, id: number): ActorState | undefined {
	if (id === 0) return undefined;
	for (let i = 0; i < actors.size(); i++) {
		const o = actors[i];
		if (o.id === id && o.kind !== NO_KIND && o.alive !== 0) return o;
	}
	return undefined;
}

/** The living ally `a` is linked to or follows (v[MENDER_ALLY]), or undefined. */
export function menderAllyOf(actors: ReadonlyArray<ActorState>, a: Readonly<ActorState>): ActorState | undefined {
	return liveActorById(actors, a.v[MENDER_ALLY]);
}

/**
 * The pick (no draw): the most wounded heal target in slot order (lowest hp / hpMax by cross-multiplication, the first
 * one on a tie) that is alive, below hpMax, within healRange (inclusive) and in sight of `a`. Undefined when none.
 */
export function menderPick(ctx: SimCtx, a: Readonly<ActorState>): ActorState | undefined {
	const d = ctx.data<MenderData>(a);
	const menderKind = archetypeIndex(MENDER.id);
	const r2 = d.healRange * d.healRange;
	const actors = ctx.actors;
	let best: ActorState | undefined;
	for (let i = 0; i < actors.size(); i++) {
		const o = actors[i];
		if (o === a || o.alive === 0 || !(o.hp < o.hpMax) || !isMenderHealTarget(o.kind, menderKind)) continue;
		if (best !== undefined && !(o.hp * best.hpMax < best.hp * o.hpMax)) continue;
		const dx = o.x - a.x;
		const dz = o.z - a.z;
		if (dx * dx + dz * dz > r2) continue;
		if (!ctx.lineOfSight(a.x, a.z, o.x, o.z)) continue;
		best = o;
	}
	return best;
}

/**
 * The beam's body block: the index of the first living player (index order) whose centre is within
 * PLAYER_RADIUS + pad of the segment (ax, az) -> (bx, bz), counting only where the centre projects between the two
 * ends (an end's own round cap is not the beam); -1 when none. No division: the projection and the distance are
 * compared multiplied through by the segment's squared length.
 */
export function menderBeamBlocker(
	state: Readonly<SimState>,
	ax: number,
	az: number,
	bx: number,
	bz: number,
	pad: number,
): number {
	const sx = bx - ax;
	const sz = bz - az;
	const len2 = sx * sx + sz * sz;
	if (len2 <= 1e-12) return -1;
	const r = PLAYER_RADIUS + pad;
	const n = partySize(state);
	for (let i = 0; i < n; i++) {
		const p = playerAt(state, i);
		if (p.dead !== 0) continue;
		const px = p.x - ax;
		const pz = p.z - az;
		const dot = px * sx + pz * sz;
		if (dot < 0 || dot > len2) continue;
		// |p|^2 - dot^2 / len2 <= r^2, times len2.
		if ((px * px + pz * pz) * len2 - dot * dot <= r * r * len2) return i;
	}
	return -1;
}

/** Why the beam to `o` cannot hold this tick (a HealEnd), or -1 when it can (end rules but the time and a hit). */
function beamBreak(ctx: SimCtx, a: Readonly<ActorState>, d: MenderData, o: ActorState | undefined): number {
	if (o === undefined) return HealEnd.ALLY_GONE;
	if (!(o.hp < o.hpMax)) return HealEnd.FULL;
	if (!ctx.lineOfSight(a.x, a.z, o.x, o.z)) return HealEnd.SIGHT;
	if (menderBeamBlocker(ctx.state, a.x, a.z, o.x, o.z, d.beamBlockPad) >= 0) return HealEnd.BLOCKED;
	return -1;
}

function pushEnd(ctx: SimCtx, a: Readonly<ActorState>, reason: number): void {
	const actors = ctx.combat.actors;
	let slot = -1;
	for (let i = 0; i < actors.size(); i++) {
		if (actors[i] === a) {
			slot = i;
			break;
		}
	}
	const e = ctx.combat.healEvents;
	e.endSlot.push(slot);
	e.endReason.push(reason);
	if (healEndCuts(reason)) ctx.events.healCuts += 1;
}

/**
 * Ends the link or the channel for `reason` (never the death: onDeath): the feed, ONE channel cooldown draw, the ally
 * cleared, the next pick on the next keep tick; a hit (HealEnd.DAMAGE) flinches, every other end keeps range.
 */
function endChannel(ctx: SimCtx, a: ActorState, d: MenderData, reason: number): void {
	pushEnd(ctx, a, reason);
	a.cooldown = enemyCooldown(ctx, a, d.channelCooldownMin, d.channelCooldownMax);
	a.v[MENDER_ALLY] = 0;
	a.v[MENDER_CHANNEL_TICKS] = 0;
	a.v[MENDER_PULSE] = 0;
	a.attack = 0;
	if (reason === HealEnd.DAMAGE) {
		a.aiState = MENDER_FLINCH;
		a.aiTicks = d.flinchTicks;
	} else {
		a.aiState = MENDER_KEEP;
		a.aiTicks = 0;
	}
}

/** The link (the telegraph): stands still facing the ally; the end rules hold; then the channel. */
function linking(ctx: SimCtx, a: ActorState, d: MenderData): void {
	const o = menderAllyOf(ctx.actors, a);
	const why = beamBreak(ctx, a, d, o);
	if (why >= 0 || o === undefined) {
		endChannel(ctx, a, d, why >= 0 ? why : HealEnd.ALLY_GONE);
		return;
	}
	faceToward(a, o.x - a.x, o.z - a.z);
	a.aiTicks -= 1;
	if (a.aiTicks > 0) return;
	a.aiState = MENDER_CHANNEL;
	a.aiTicks = 0;
	a.v[MENDER_CHANNEL_TICKS] = 0;
	a.v[MENDER_PULSE] = d.pulseTicks;
}

/** The channel: stands still facing the ally; a pulse every pulseTicks; the end rules, then the time. */
function channelling(ctx: SimCtx, a: ActorState, d: MenderData): void {
	const o = menderAllyOf(ctx.actors, a);
	const why = beamBreak(ctx, a, d, o);
	if (why >= 0 || o === undefined) {
		endChannel(ctx, a, d, why >= 0 ? why : HealEnd.ALLY_GONE);
		return;
	}
	faceToward(a, o.x - a.x, o.z - a.z);
	a.v[MENDER_CHANNEL_TICKS] += 1;
	a.v[MENDER_PULSE] -= 1;
	if (a.v[MENDER_PULSE] <= 0) {
		a.v[MENDER_PULSE] = d.pulseTicks;
		a.v[MENDER_HEALED] += ctx.healActor(o, d.healAmount);
		if (!(o.hp < o.hpMax)) {
			endChannel(ctx, a, d, HealEnd.FULL);
			return;
		}
	}
	if (a.v[MENDER_CHANNEL_TICKS] >= d.channelTicks) endChannel(ctx, a, d, HealEnd.TIME);
}

/** The flinch after a hit cut the channel: stands still; the cooldown keeps counting. */
function flinching(a: ActorState): void {
	if (a.cooldown > 0) a.cooldown--;
	a.aiTicks -= 1;
	if (a.aiTicks > 0) return;
	a.aiState = MENDER_KEEP;
	a.aiTicks = 0;
}

/** The bolt's wind-up: faces its target; on the last tick one aimed bolt at where the target stands. */
function boltWindup(ctx: SimCtx, a: ActorState, d: MenderData): void {
	const tp = toPlayer(ctx, a);
	faceToward(a, tp.dirX, tp.dirZ);
	a.aiTicks -= 1;
	if (a.aiTicks > 0) return;
	if (ctx.player.dead === 0) ctx.fireEnemy(a, tp.dirX, tp.dirZ, d.bolt);
	a.v[MENDER_STRAFE] = -a.v[MENDER_STRAFE];
	a.aiState = MENDER_KEEP;
	a.aiTicks = 0;
	a.attack = 0;
}

/** True when the link may start to `o`: in healRange, in sight and not body-blocked (and still wounded). */
function linkOpen(ctx: SimCtx, a: Readonly<ActorState>, d: MenderData, o: ActorState): boolean {
	const dx = o.x - a.x;
	const dz = o.z - a.z;
	return dx * dx + dz * dz <= d.healRange * d.healRange && beamBreak(ctx, a, d, o) < 0;
}

/**
 * Keeping range (MENDER_KEEP): the pick timer, the cooldown, the link or the bolt when it is out, else the move: with
 * an ally, stay within healRange - followSlack of it; without one, keep keepMin-keepMax from the target (find a line
 * first; leash after lostTicks without one).
 */
function keepRange(ctx: SimCtx, a: ActorState, d: MenderData): void {
	const p = ctx.player;
	if (a.cooldown > 0) a.cooldown--;
	a.v[MENDER_PULSE] -= 1;
	if (a.v[MENDER_PULSE] <= 0) {
		const pick = menderPick(ctx, a);
		a.v[MENDER_ALLY] = pick !== undefined ? pick.id : 0;
		a.v[MENDER_PULSE] = d.pickEveryTicks;
	}
	let ally = menderAllyOf(ctx.actors, a);
	if (ally !== undefined && !(ally.hp < ally.hpMax)) ally = undefined;
	if (ally === undefined) a.v[MENDER_ALLY] = 0;
	const tp = toPlayer(ctx, a);
	const los = p.dead === 0 && ctx.lineOfSight(a.x, a.z, p.x, p.z);
	if (a.cooldown <= 0) {
		if (ally !== undefined) {
			if (linkOpen(ctx, a, d, ally)) {
				faceToward(a, ally.x - a.x, ally.z - a.z);
				ctx.telegraph(a, d.linkTicks, MENDER_ATTACK_HEAL);
				return;
			}
		} else if (los && tp.dist <= d.boltRange) {
			a.cooldown = enemyCooldown(ctx, a, d.boltCooldownMin, d.boltCooldownMax);
			faceToward(a, tp.dirX, tp.dirZ);
			ctx.telegraph(a, d.boltWindupTicks, MENDER_ATTACK_BOLT);
			return;
		}
	}
	const stepLen = walkStep(ctx, a);
	const follow = d.healRange - d.followSlack;
	if (ally !== undefined) {
		a.aiTicks = 0; // busy with an ally: losing sight of the target does not send it home
		const fx = ally.x - a.x;
		const fz = ally.z - a.z;
		if (fx * fx + fz * fz > follow * follow) {
			walkToward(ctx, a, ally.x, ally.z, stepLen, STEER);
			return;
		}
	} else if (!los) {
		// No line to its target: walk toward it to find one; leash after lostTicks without.
		a.aiTicks += 1;
		if (a.aiTicks > d.lostTicks) {
			leash(a);
			return;
		}
		walkToward(ctx, a, p.x, p.z, stepLen, STEER);
		return;
	} else a.aiTicks = 0;
	faceToward(a, tp.dirX, tp.dirZ);
	const radial = tp.dist < d.keepMin ? -1 : los && tp.dist > d.keepMax ? 1 : 0;
	const side = los ? a.v[MENDER_STRAFE] * d.strafeWeight : 0;
	// Perpendicular to the target direction: (-dirZ, dirX).
	let mx = tp.dirX * radial - tp.dirZ * side;
	let mz = tp.dirZ * radial + tp.dirX * side;
	const m2 = mx * mx + mz * mz;
	if (m2 <= 1e-12) return;
	const k = stepLen / math.sqrt(m2);
	mx *= k;
	mz *= k;
	const x0 = a.x;
	const z0 = a.z;
	moveActor(ctx, a, mx, mz);
	if (ally !== undefined) {
		const fx = ally.x - a.x;
		const fz = ally.z - a.z;
		if (fx * fx + fz * fz > follow * follow) {
			// The move would take it out of reach of its ally: undone, and the strafe side flips.
			a.x = x0;
			a.z = z0;
			a.v[MENDER_STRAFE] = -a.v[MENDER_STRAFE];
			return;
		}
	}
	const ox = a.x - x0;
	const oz = a.z - z0;
	if (side !== 0 && ox * ox + oz * oz < stepLen * stepLen * STRAFE_BLOCKED * STRAFE_BLOCKED) {
		a.v[MENDER_STRAFE] = -a.v[MENDER_STRAFE];
	}
}

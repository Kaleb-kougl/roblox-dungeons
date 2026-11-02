/**
 * 'warbanner' (Roblox port, docs/NEW_ENEMIES.md NE6; no web source): an imp with a banner that stays behind the pack and
 * buffs it. 6 hp, no contact damage. Never a room's first buy, at most one per room (NE7, NED9; not this file).
 *
 * Keep-away: engaged, it backs off from EVERY living player inside keepMin (their away bearings summed), closes in on
 * its target past keepMax (only with line of sight, like the summoner), strafes (with sight; the sniper's flip rule) and
 * is pulled toward the centroid of its allies (living aura targets within allyRange) while farther than centroidSlack
 * from it, at centroidWeight. With no allies the pull is absent: the summoner's plain keep-range. The sum is
 * normalised to one walkStep (the plain mover, so a wall flips the strafe side).
 *
 * Panic (the summoner's): its target (the nearest living player) within panicRange and in sight while the cooldown is
 * out -> one `enemyCooldown(panicCooldownMin, panicCooldownMax)` draw, WARBANNER_PANIC latched, a panicTelegraphTicks
 * telegraph (attack WARBANNER_ATTACK_PANIC), then the bruiser's gapped ring (`panicRing`, one `GAP_TURNS` draw) and
 * WARBANNER_BACKOFF (walks straight away from its target for backoffTicks), then keep-away again (latch cleared). It
 * starts with no cooldown (panic is a reaction, not a timed attack). Draws: a strafe coin in init, 2 per panic, the
 * strafe-flip timers.
 *
 * The aura (NED8): every living aura target (`isWarbannerAuraTarget`: a room enemy, not a boss and not a Warbanner;
 * turrets and the dummy are not room enemies) within auraRadius (centre to centre, inclusive) of a living Warbanner
 * walks at auraWalkPercent and cools down at auraCooldownPercent (actorMods.ts, combined with the affix percent by
 * `combinedPercent`). One aura at most: two banners never stack. `warbannerAuraMask` computes the set from the actor
 * pool alone (a pure function of hashed state); SimCtx.rebuildAura runs it at the START of every stepActors (tick-start
 * positions) into the transient SimCtx.auraMask, so a banner that dies stops buffing from the next tick's rebuild.
 * Telegraph, lunge and recover ticks never read it (EVD9).
 *
 * View contract: states WARBANNER_KEEP (= STATE_ENGAGED) / AiState.TELEGRAPH (the panic) / WARBANNER_BACKOFF; attack id
 * WARBANNER_ATTACK_PANIC; v slots WARBANNER_STRAFE (+1 / -1), WARBANNER_PANIC (1 from the panic telegraph to the end of
 * the back-off). Buffed actors: `warbannerAuraMask` on the state (or SimCtx.inAura inside the tick).
 */

import { secondsToTicks } from "../../../playerData";
import { partySize, playerAt } from "../../../party";
import { rotateDir, type BurstSpec, type Dir } from "../../patterns";
import type { SimCtx } from "../../ctx";
import { enemyCooldown, walkStep } from "../actorMods";
import { faceToward, moveActor, toPlayer } from "../helpers";
import { PORT_BAND_ENEMIES_2, archetypeAt, archetypeIndex, registerArchetype } from "../registry";
import { AiState, NO_KIND, type ActorState } from "../types";
import { BRUISER, GAP_TURNS } from "./bruiser";
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

export interface WarbannerData extends RoomEnemyData {
	/** Preferred distance band to every living player (world units). */
	readonly keepMin: number;
	readonly keepMax: number;
	/** Strafe direction flips after a random [min, max] ticks (or when a wall stops it). */
	readonly strafeFlipMin: number;
	readonly strafeFlipMax: number;
	/** Weight of the sideways component of the move (radial is 1). */
	readonly strafeWeight: number;
	/** The aura (NED8): its radius (world units, centre to centre) and the integer percents it applies. */
	readonly auraRadius: number;
	readonly auraWalkPercent: number;
	readonly auraCooldownPercent: number;
	/** Panics when a living player is this close (and in sight). */
	readonly panicRange: number;
	readonly panicTelegraphTicks: number;
	/** Ticks until it may panic again (random in [min, max], `enemyCooldown`). */
	readonly panicCooldownMin: number;
	readonly panicCooldownMax: number;
	/** The panic ring: the bruiser's (same spec object, same arc-table row). */
	readonly panicRing: BurstSpec;
	/** Walking straight away from the player after the panic ring. */
	readonly backoffTicks: number;
	/** Allies (living aura targets) this close (world units) count toward the centroid it stays near. */
	readonly allyRange: number;
	/** No centroid pull while it is within this distance of its allies' centroid. */
	readonly centroidSlack: number;
	/** Weight of the centroid pull in the move (radial is 1). */
	readonly centroidWeight: number;
}

// --- States and attack ids
/** Keeping away. */
export const WARBANNER_KEEP = STATE_ENGAGED;
/** After the panic ring: walking away from the player for backoffTicks. */
export const WARBANNER_BACKOFF = AiState.CUSTOM + 1;
/** ActorState.attack while telegraphing the panic ring. */
export const WARBANNER_ATTACK_PANIC = 1;

// --- v[] slots (0..2 shared)
/** Strafe side, +1 or -1. */
export const WARBANNER_STRAFE = 3;
/** Panic latch (1 while a panic is pending / running). */
export const WARBANNER_PANIC = 4;

/** NED8 aura numbers. */
export const WARBANNER_AURA_RADIUS = 4.5;
export const WARBANNER_AURA_WALK_PERCENT = 125;
export const WARBANNER_AURA_COOLDOWN_PERCENT = 80;
/** NE6 keep-away tunables (allyRange, centroidSlack, centroidWeight). */
export const WARBANNER_ALLY_RANGE = 10;
export const WARBANNER_CENTROID_SLACK = 2;
export const WARBANNER_CENTROID_WEIGHT = 0.6;

/** A move shorter than this fraction of the step means a wall: flip the strafe side (the sniper's rule). */
const STRAFE_BLOCKED = 0.3;
/** Coin flip for the first strafe side. */
const COIN = 0.5;
/** Below this squared length a vector has no direction. */
const EPS2 = 1e-12;
const dirScratch: Dir = { x: 0, z: 1 };
/** Scratch: the away / centroid vectors (module scratch, overwritten every call; never state). */
const vecScratch: Dir = { x: 0, z: 0 };

export const WARBANNER = registerArchetype<WarbannerData>({
	id: "warbanner",
	band: PORT_BAND_ENEMIES_2,
	data: {
		hp: 6,
		radius: 0.35,
		speed: 2.6,
		contactDamage: 0,
		spriteId: "enemy.warbanner",
		roomEnemy: true,
		aggroRange: 9,
		leashRange: 15,
		lostTicks: 0, // unused, like the summoner's: it keeps away on purpose, so losing sight never sends it home
		alertRange: 4.5,
		keepMin: 5,
		keepMax: 8,
		strafeFlipMin: secondsToTicks(0.8),
		strafeFlipMax: secondsToTicks(2.2),
		strafeWeight: 0.8,
		auraRadius: WARBANNER_AURA_RADIUS,
		auraWalkPercent: WARBANNER_AURA_WALK_PERCENT,
		auraCooldownPercent: WARBANNER_AURA_COOLDOWN_PERCENT,
		panicRange: 2.5,
		panicTelegraphTicks: secondsToTicks(0.5), // 30
		panicCooldownMin: secondsToTicks(2),
		panicCooldownMax: secondsToTicks(2.8),
		panicRing: BRUISER.data.ring,
		backoffTicks: secondsToTicks(0.8),
		allyRange: WARBANNER_ALLY_RANGE,
		centroidSlack: WARBANNER_CENTROID_SLACK,
		centroidWeight: WARBANNER_CENTROID_WEIGHT,
	},
	init(ctx, a) {
		initRoomEnemy(a);
		a.v[WARBANNER_STRAFE] = ctx.random() < COIN ? -1 : 1;
	},
	step(ctx, a) {
		const d = ctx.data<WarbannerData>(a);
		if (stepCalm(ctx, a)) return;
		if (shouldLeash(ctx, a)) {
			a.v[WARBANNER_PANIC] = 0;
			leash(a);
			return;
		}
		if (a.aiState === AiState.TELEGRAPH) telegraphing(ctx, a, d);
		else if (a.aiState === WARBANNER_BACKOFF) backingOff(ctx, a, d);
		else keepAway(ctx, a, d);
	},
	onHit(ctx, a) {
		engageOnHit(ctx, a);
	},
	onDeath(ctx, a) {
		alertOnDeath(ctx, a);
	},
});

/**
 * True when an actor of archetype index `kind` takes a Warbanner's aura: a room enemy that is neither a boss nor a
 * Warbanner (turrets, the dummy and the bosses are not room enemies / are bosses). Liveness is the caller's.
 */
export function isWarbannerAuraTarget(kind: number, bannerKind = archetypeIndex(WARBANNER.id)): boolean {
	if (kind === NO_KIND || kind === bannerKind) return false;
	const data = archetypeAt(kind).data;
	return isRoomEnemyData(data) && data.boss !== true;
}

/**
 * The aura mask (NED8), a pure function of the actor pool: clears `out`, then maps every living aura target within
 * auraRadius (inclusive, centre to centre) of a living Warbanner to its actor id. Slot order; a target already in the
 * mask is just set again (no stacking). SimCtx.rebuildAura runs it at the start of stepActors; the view may run it on
 * a state to tint buffed sprites.
 */
export function warbannerAuraMask(actors: ReadonlyArray<ActorState>, out: Map<ActorState, number>): void {
	out.clear();
	const banner = archetypeIndex(WARBANNER.id);
	const r = WARBANNER.data.auraRadius;
	const r2 = r * r;
	for (let i = 0; i < actors.size(); i++) {
		const b = actors[i];
		if (b.kind !== banner || b.alive === 0) continue;
		for (let j = 0; j < actors.size(); j++) {
			const o = actors[j];
			if (o.alive === 0 || !isWarbannerAuraTarget(o.kind, banner)) continue;
			const dx = o.x - b.x;
			const dz = o.z - b.z;
			if (dx * dx + dz * dz <= r2) out.set(o, o.id);
		}
	}
}

/**
 * Sums into vecScratch the unit bearings AWAY from every living player closer than `range` (a player on top of it
 * counts as its facing reversed). Returns how many players that was.
 */
function awayFromPlayers(ctx: SimCtx, a: Readonly<ActorState>, range: number): number {
	const n = partySize(ctx.state);
	const r2 = range * range;
	let x = 0;
	let z = 0;
	let count = 0;
	for (let k = 0; k < n; k++) {
		const q = playerAt(ctx.state, k);
		if (q.dead !== 0) continue;
		const dx = a.x - q.x;
		const dz = a.z - q.z;
		const d2 = dx * dx + dz * dz;
		if (d2 >= r2) continue;
		count++;
		if (d2 > EPS2) {
			const inv = 1 / math.sqrt(d2);
			x += dx * inv;
			z += dz * inv;
		} else {
			x -= a.faceX;
			z -= a.faceZ;
		}
	}
	vecScratch.x = x;
	vecScratch.z = z;
	return count;
}

/** Writes into vecScratch the centroid of `a`'s allies (living aura targets within allyRange); returns their count. */
function allyCentroid(ctx: SimCtx, a: Readonly<ActorState>, d: WarbannerData): number {
	const actors = ctx.actors;
	const banner = a.kind;
	const r2 = d.allyRange * d.allyRange;
	let x = 0;
	let z = 0;
	let count = 0;
	for (let i = 0; i < actors.size(); i++) {
		const o = actors[i];
		if (o.alive === 0 || !isWarbannerAuraTarget(o.kind, banner)) continue;
		const dx = o.x - a.x;
		const dz = o.z - a.z;
		if (dx * dx + dz * dz > r2) continue;
		x += o.x;
		z += o.z;
		count++;
	}
	if (count > 0) {
		vecScratch.x = x / count;
		vecScratch.z = z / count;
	}
	return count;
}

function keepAway(ctx: SimCtx, a: ActorState, d: WarbannerData): void {
	const p = ctx.player;
	const tp = toPlayer(ctx, a);
	const dist = tp.dist;
	const dirX = tp.dirX;
	const dirZ = tp.dirZ;
	const los = ctx.lineOfSight(a.x, a.z, p.x, p.z);
	faceToward(a, dirX, dirZ);
	if (a.cooldown > 0) a.cooldown--;
	if (a.cooldown <= 0 && p.dead === 0 && los && dist <= d.panicRange) {
		a.cooldown = enemyCooldown(ctx, a, d.panicCooldownMin, d.panicCooldownMax);
		a.v[WARBANNER_PANIC] = 1;
		ctx.telegraph(a, d.panicTelegraphTicks, WARBANNER_ATTACK_PANIC);
		return;
	}
	// Away from every living player inside keepMin; else toward the target past keepMax (only in sight).
	let mx = 0;
	let mz = 0;
	if (awayFromPlayers(ctx, a, d.keepMin) > 0) {
		mx = vecScratch.x;
		mz = vecScratch.z;
	} else if (los && dist > d.keepMax) {
		mx = dirX;
		mz = dirZ;
	}
	// Strafe (only in sight), perpendicular to the target's bearing: (-dirZ, dirX).
	const side = los ? a.v[WARBANNER_STRAFE] * d.strafeWeight : 0;
	mx -= dirZ * side;
	mz += dirX * side;
	// Stay near the pack: pulled toward its allies' centroid while farther than centroidSlack from it.
	if (allyCentroid(ctx, a, d) > 0) {
		const ex = vecScratch.x - a.x;
		const ez = vecScratch.z - a.z;
		const e2 = ex * ex + ez * ez;
		if (e2 > d.centroidSlack * d.centroidSlack) {
			const k = d.centroidWeight / math.sqrt(e2);
			mx += ex * k;
			mz += ez * k;
		}
	}
	const m2 = mx * mx + mz * mz;
	if (m2 > EPS2) {
		const stepLen = walkStep(ctx, a);
		const k = stepLen / math.sqrt(m2);
		const x0 = a.x;
		const z0 = a.z;
		moveActor(ctx, a, mx * k, mz * k);
		const ox = a.x - x0;
		const oz = a.z - z0;
		if (side !== 0 && ox * ox + oz * oz < stepLen * stepLen * STRAFE_BLOCKED * STRAFE_BLOCKED) {
			a.v[WARBANNER_STRAFE] = -a.v[WARBANNER_STRAFE];
		}
	}
	a.aiTicks -= 1;
	if (a.aiTicks <= 0) {
		a.v[WARBANNER_STRAFE] = -a.v[WARBANNER_STRAFE];
		a.aiTicks = ctx.randomInt(d.strafeFlipMin, d.strafeFlipMax);
	}
}

function telegraphing(ctx: SimCtx, a: ActorState, d: WarbannerData): void {
	const tp = toPlayer(ctx, a);
	const dirX = tp.dirX;
	const dirZ = tp.dirZ;
	faceToward(a, dirX, dirZ);
	a.aiTicks -= 1;
	if (a.aiTicks > 0) return;
	// The bruiser's gapped ring: the gap is the target's bearing turned by one GAP_TURNS draw.
	const turn = GAP_TURNS[ctx.randomInt(0, GAP_TURNS.size() - 1)];
	rotateDir(dirX, dirZ, turn[0], turn[1], dirScratch);
	ctx.fireEnemy(a, -dirScratch.x, -dirScratch.z, d.panicRing);
	a.attack = 0;
	a.aiState = WARBANNER_BACKOFF;
	a.aiTicks = d.backoffTicks;
}

function backingOff(ctx: SimCtx, a: ActorState, d: WarbannerData): void {
	const tp = toPlayer(ctx, a);
	const dirX = tp.dirX;
	const dirZ = tp.dirZ;
	faceToward(a, dirX, dirZ);
	const stepLen = walkStep(ctx, a);
	moveActor(ctx, a, -dirX * stepLen, -dirZ * stepLen, STEER);
	a.aiTicks -= 1;
	if (a.aiTicks <= 0) {
		a.v[WARBANNER_PANIC] = 0;
		a.aiState = WARBANNER_KEEP;
		a.aiTicks = ctx.randomInt(d.strafeFlipMin, d.strafeFlipMax);
	}
}

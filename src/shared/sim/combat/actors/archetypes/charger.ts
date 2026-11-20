/**
 * 'charger' (Roblox port, docs/NEW_ENEMIES.md NE3; no web source): a blade-armed beast that charges down a lane and
 * staggers when it hits a wall. 12 hp, contact damage 0 (its heavy hit lands only while charging, its own overlap
 * check through `ctx.hurtPlayerAt`).
 *
 * Engaged (CHARGER_KEEP) it keeps keepMin-keepMax from its target with line of sight (the sniper's approach / back
 * off, without the strafe: no draws); out of sight it walks toward the target to find a line (STEER) and leashes after
 * lostTicks (v[CHARGER_LOST]). Its cooldown counts down only here. At 0, with line of sight, the target within
 * chargeRange and its body inside its home room's box (`chargeBox`), it starts the **lane** (AiState.TELEGRAPH,
 * attack CHARGER_ATTACK_LANE, laneTicks): the heading locks at this tick toward the target (NED6, v[CHARGER_DIR_*],
 * the `aimLine` hint chargeRange long, bold throughout), the next cooldown is drawn (`enemyCooldown`: the ONLY draw of
 * an attack; the first one is drawn in init), and it stands still.
 *
 * **Charge** (CHARGER_CHARGE, from the lane's last tick): chargeSpeed * SIM_DT along the locked heading per tick (never
 * scaled: EVD9), for up to chargeRange units (v[CHARGER_LEFT]). Each tick, in this order:
 *   1. breaks every intact piece whose cell could touch its body anywhere along this tick's step (`slamBreakables` at
 *      the step's midpoint, radius = body radius + chargeBreakRadius (half a cell's diagonal) + half the step): an
 *      intact barrel stops a non-steering move like a wall, so it must break BEFORE the move or every piece would stun;
 *   2. limits the step to its home room's box (centre inside the room's floor box shrunk by its radius; no box when
 *      its home is in no room) and moves with the plain mover (no STEER: a pillar must stop it, not be rounded);
 *   3. hurts each living player it overlaps for the first time this charge (chargeDamage, once per player per charge:
 *      the bit in v[CHARGER_HIT_BITS] is set on the first overlap whether or not the hit lands, so a roll through it
 *      dodges the whole charge).
 * Blocked before the end (the room box cut the step, or it gained less than CHARGE_BLOCKED x the step along the
 * heading: wall, pillar, void) -> **stun** (CHARGER_STUN, stunTicks, still and vulnerable). Full range -> **recover**
 * (CHARGER_RECOVER, recoverTicks, still). Both end back in CHARGER_KEEP. No placement ever draws.
 *
 * View contract: states CHARGER_KEEP (= STATE_ENGAGED) / AiState.TELEGRAPH (the lane) / CHARGER_CHARGE / CHARGER_STUN /
 * CHARGER_RECOVER; attack id CHARGER_ATTACK_LANE (lane only; 0 while charging); v slots CHARGER_DIR_X / _Z (locked
 * heading), CHARGER_LEFT (charge distance left), CHARGER_HIT_BITS (players already overlapped this charge, one bit per
 * party index), CHARGER_LOST (ticks without sight while keeping range).
 *
 * @module
 */

import { HIT_HEAVY, PLAYER_RADIUS, secondsToTicks } from "../../../playerData";
import { SIM_DT } from "../../../units";
import { SQRT1_2 } from "../../../jsnum";
import { partySize, playerAt } from "../../../party";
import { slamBreakables } from "../../../breakables/breakables";
import { secretsChargeAt } from "../../../secrets/open";
import { TILE_SIZE, type EncounterRoom } from "shared/dungeon";
import type { SimCtx } from "../../ctx";
import { enemyCooldown, walkStep } from "../actorMods";
import { faceToward, moveActor, toPlayer, walkToward } from "../helpers";
import { PORT_BAND_ENEMIES_2, registerArchetype } from "../registry";
import { AiState, type ActorState } from "../types";
import {
	STATE_ENGAGED,
	STEER,
	V_HOME_X,
	V_HOME_Z,
	alertOnDeath,
	engageOnHit,
	initRoomEnemy,
	leash,
	shouldLeash,
	stepCalm,
	type RoomEnemyData,
} from "./enemyShared";

/**
 * The Charger's tuning on top of the room enemy rules: its keep-range band, the lane telegraph, the charge and the stun
 * or recover after it.
 */
export interface ChargerData extends RoomEnemyData {
	/** Preferred distance band to its target (world units; it wants line of sight). */
	readonly keepMin: number;
	/**
	 * The far edge of the band (world units): past it, it walks toward its target; nearer than keepMin it backs off.
	 */
	readonly keepMax: number;
	/** Ticks between charges (random in [min, max], `enemyCooldown`; also the first one, drawn in init). */
	readonly chargeCooldownMin: number;
	/** The longest wait between charges, ticks (inclusive upper bound of the draw). */
	readonly chargeCooldownMax: number;
	/** Lane telegraph ticks (the heading locks at its start). */
	readonly laneTicks: number;
	/** Charge speed (world units / s) and longest charge (world units; also the most distant target it charges). */
	readonly chargeSpeed: number;
	/**
	 * The longest charge, world units along the locked heading. Also the farthest target it starts a lane at, and the
	 * lane line's length.
	 */
	readonly chargeRange: number;
	/** Half hearts of the charge's hit (once per player per charge). */
	readonly chargeDamage: number;
	/**
	 * Pieces whose cell centre is within body radius + this (+ half the tick's step, from the step's midpoint) break as
	 * it passes: half a cell's diagonal, so no intact cell can touch the body anywhere along the step.
	 */
	readonly chargeBreakRadius: number;
	/** Staggered after a blocked charge (the punish window), and the short recover after a clear one. */
	readonly stunTicks: number;
	/** Ticks it stands still after a charge that ran its full range, before it keeps range again. */
	readonly recoverTicks: number;
}

// --- States and attack ids
/** Keeping range. */
export const CHARGER_KEEP = STATE_ENGAGED;
/** Charging along v[CHARGER_DIR_*]. */
export const CHARGER_CHARGE = AiState.CUSTOM + 1;
/** Staggered after a blocked charge. */
export const CHARGER_STUN = AiState.CUSTOM + 2;
/** Standing after a charge that ran its full range. */
export const CHARGER_RECOVER = AiState.CUSTOM + 3;
/** ActorState.attack while telegraphing the lane. */
export const CHARGER_ATTACK_LANE = 1;

// --- v[] slots (0..2 shared)
/** Locked charge heading (unit). */
export const CHARGER_DIR_X = 3;
/** v[4]: the z component of the locked charge heading (unit), the pair of CHARGER_DIR_X. */
export const CHARGER_DIR_Z = 4;
/** Charge distance left (world units). */
export const CHARGER_LEFT = 5;
/** Players already hit by this charge (bit k = party index k). */
export const CHARGER_HIT_BITS = 6;
/** Ticks without line of sight to its target while keeping range (leashes past lostTicks). */
export const CHARGER_LOST = 7;

const LANE_SECONDS = 0.75;
const CHARGE_RANGE = 9;
/** A charge tick that gains less than this fraction of its step along the heading is blocked (stun). */
export const CHARGE_BLOCKED = 0.5;
/** A charge with at most this much distance left has run its full range. */
const CHARGE_END_EPS = 1e-9;

/**
 * The registered 'charger' archetype: keeps range, telegraphs a lane, charges down it breaking pieces and hurting each
 * player once, and is stunned when a wall stops it. Its only draws are charge cooldowns (one in init, one per lane).
 */
export const CHARGER = registerArchetype<ChargerData>({
	id: "charger",
	band: PORT_BAND_ENEMIES_2,
	data: {
		hp: 12,
		radius: 0.5,
		speed: 2.2,
		contactDamage: 0,
		spriteId: "enemy.charger",
		roomEnemy: true,
		aggroRange: 10,
		leashRange: 15,
		lostTicks: secondsToTicks(2.5),
		alertRange: 4.5,
		keepMin: 5,
		keepMax: 9,
		chargeCooldownMin: secondsToTicks(3),
		chargeCooldownMax: secondsToTicks(4),
		laneTicks: secondsToTicks(LANE_SECONDS), // 45
		chargeSpeed: 11,
		chargeRange: CHARGE_RANGE,
		chargeDamage: HIT_HEAVY,
		chargeBreakRadius: TILE_SIZE * SQRT1_2,
		stunTicks: secondsToTicks(1.4), // 84
		recoverTicks: secondsToTicks(0.6), // 36
		fx: {
			aimLine: {
				dirX: CHARGER_DIR_X,
				dirZ: CHARGER_DIR_Z,
				length: CHARGE_RANGE,
				boldTicks: secondsToTicks(LANE_SECONDS), // locked from the start: bold throughout
				attack: CHARGER_ATTACK_LANE,
			},
		},
	},
	init(ctx, a) {
		initRoomEnemy(a);
		const d = ctx.data<ChargerData>(a);
		a.cooldown = enemyCooldown(ctx, a, d.chargeCooldownMin, d.chargeCooldownMax);
	},
	step(ctx, a) {
		const d = ctx.data<ChargerData>(a);
		if (stepCalm(ctx, a)) return;
		if (shouldLeash(ctx, a)) {
			leash(a);
			return;
		}
		const st = a.aiState;
		if (st === AiState.TELEGRAPH) lane(ctx, a, d);
		else if (st === CHARGER_CHARGE) charging(ctx, a, d);
		else if (st === CHARGER_STUN || st === CHARGER_RECOVER) standing(a);
		else keepRange(ctx, a, d);
	},
	onHit(ctx, a) {
		engageOnHit(ctx, a);
	},
	onDeath(ctx, a) {
		alertOnDeath(ctx, a);
	},
});

/** The room holding its home (undefined on a room-less floor or a home outside every room). */
function homeRoom(ctx: SimCtx, a: Readonly<ActorState>): EncounterRoom | undefined {
	return ctx.roomAt(a.v[V_HOME_X], a.v[V_HOME_Z]);
}

/** True when its centre is inside `room`'s floor box shrunk by its radius (the charge's box). */
function inChargeBox(room: EncounterRoom, a: Readonly<ActorState>): boolean {
	const r = a.radius;
	return a.x >= room.minX + r && a.x <= room.maxX - r && a.z >= room.minZ + r && a.z <= room.maxZ - r;
}

/** Keeps range (approach / back off, no strafe); starts the lane when the cooldown is out. */
function keepRange(ctx: SimCtx, a: ActorState, d: ChargerData): void {
	const p = ctx.player;
	const tp = toPlayer(ctx, a);
	const dist = tp.dist;
	const dirX = tp.dirX;
	const dirZ = tp.dirZ;
	const los = ctx.lineOfSight(a.x, a.z, p.x, p.z);
	if (los) {
		a.v[CHARGER_LOST] = 0;
	} else {
		a.v[CHARGER_LOST] += 1;
		if (a.v[CHARGER_LOST] > d.lostTicks) {
			leash(a);
			return;
		}
	}
	if (a.cooldown > 0) a.cooldown--;
	if (los && a.cooldown <= 0 && dist <= d.chargeRange) {
		const room = homeRoom(ctx, a);
		if (room === undefined || inChargeBox(room, a)) {
			startLane(ctx, a, d, dirX, dirZ);
			return;
		}
	}
	const stepLen = walkStep(ctx, a);
	if (!los) {
		walkToward(ctx, a, p.x, p.z, stepLen, STEER);
		return;
	}
	faceToward(a, dirX, dirZ);
	const radial = dist < d.keepMin ? -1 : dist > d.keepMax ? 1 : 0;
	if (radial === 0) return;
	const k = stepLen * radial;
	moveActor(ctx, a, dirX * k, dirZ * k, STEER);
}

/** Locks the heading (NED6), draws the next cooldown (the attack's one draw) and telegraphs the lane. */
function startLane(ctx: SimCtx, a: ActorState, d: ChargerData, dirX: number, dirZ: number): void {
	a.v[CHARGER_DIR_X] = dirX;
	a.v[CHARGER_DIR_Z] = dirZ;
	a.v[CHARGER_LEFT] = d.chargeRange;
	a.v[CHARGER_HIT_BITS] = 0;
	faceToward(a, dirX, dirZ);
	a.cooldown = enemyCooldown(ctx, a, d.chargeCooldownMin, d.chargeCooldownMax);
	ctx.telegraph(a, d.laneTicks, CHARGER_ATTACK_LANE);
}

/** The lane: stands on its locked heading; on the last tick the charge starts (and takes its first step). */
function lane(ctx: SimCtx, a: ActorState, d: ChargerData): void {
	a.aiTicks--;
	if (a.aiTicks > 0) return;
	a.aiState = CHARGER_CHARGE;
	a.aiTicks = 0;
	a.attack = 0;
	charging(ctx, a, d);
}

/** One charge tick (file header: break, bounded plain move, hits; then stun / recover / keep going). */
function charging(ctx: SimCtx, a: ActorState, d: ChargerData): void {
	const dirX = a.v[CHARGER_DIR_X];
	const dirZ = a.v[CHARGER_DIR_Z];
	const left = a.v[CHARGER_LEFT];
	const full = d.chargeSpeed * SIM_DT;
	let len = full < left ? full : left;
	// 2a. The room box cuts the step (a doorway never lets it out).
	let cut = false;
	const room = homeRoom(ctx, a);
	if (room !== undefined) {
		const r = a.radius;
		if (dirX > 0) len = boundStep(len, (room.maxX - r - a.x) / dirX);
		else if (dirX < 0) len = boundStep(len, (room.minX + r - a.x) / dirX);
		if (dirZ > 0) len = boundStep(len, (room.maxZ - r - a.z) / dirZ);
		else if (dirZ < 0) len = boundStep(len, (room.minZ + r - a.z) / dirZ);
		cut = len < (full < left ? full : left);
	}
	// 1. Break what the body would touch along this step, before the move.
	if (len > 0) {
		const half = len / 2;
		const mx = a.x + dirX * half;
		const mz = a.z + dirZ * half;
		const reach = a.radius + d.chargeBreakRadius + half;
		// docs/SECRET_ROOMS.md SR3 / SRD8: a secret's crack in the same reach opens (first, so the opening charge does
		// not also knock it).
		secretsChargeAt(ctx.state, mx, mz, reach);
		slamBreakables(ctx.state, mx, mz, reach);
	}
	// 2b. The plain mover (walls, pillars, void and intact pieces stop it).
	const x0 = a.x;
	const z0 = a.z;
	if (len > 0) moveActor(ctx, a, dirX * len, dirZ * len);
	const gained = (a.x - x0) * dirX + (a.z - z0) * dirZ;
	// 3. Hits.
	chargeHits(ctx, a, d);
	a.v[CHARGER_LEFT] = left - len;
	if (cut || gained < len * CHARGE_BLOCKED) {
		a.aiState = CHARGER_STUN;
		a.aiTicks = d.stunTicks;
	} else if (a.v[CHARGER_LEFT] <= CHARGE_END_EPS) {
		a.aiState = CHARGER_RECOVER;
		a.aiTicks = d.recoverTicks;
	}
}

/** min(len, limit), never below 0. */
function boundStep(len: number, limit: number): number {
	if (limit < 0) return 0;
	return limit < len ? limit : len;
}

/** The first overlap with each living player this charge hurts them once (bit k of v[CHARGER_HIT_BITS]). */
function chargeHits(ctx: SimCtx, a: ActorState, d: ChargerData): void {
	const n = partySize(ctx.state);
	const reach = a.radius + PLAYER_RADIUS;
	const reach2 = reach * reach;
	for (let k = 0; k < n; k++) {
		const bit = bit32.lshift(1, k);
		if (bit32.band(a.v[CHARGER_HIT_BITS], bit) !== 0) continue;
		const p = playerAt(ctx.state, k);
		if (p.dead !== 0) continue;
		const dx = p.x - a.x;
		const dz = p.z - a.z;
		if (dx * dx + dz * dz >= reach2) continue;
		a.v[CHARGER_HIT_BITS] = bit32.bor(a.v[CHARGER_HIT_BITS], bit);
		ctx.hurtPlayerAt(k, d.chargeDamage, a.kind);
	}
}

/** Stun / recover: stands still, then keeps range again. */
function standing(a: ActorState): void {
	a.aiTicks--;
	if (a.aiTicks > 0) return;
	a.aiState = CHARGER_KEEP;
	a.aiTicks = 0;
	a.v[CHARGER_LOST] = 0;
}

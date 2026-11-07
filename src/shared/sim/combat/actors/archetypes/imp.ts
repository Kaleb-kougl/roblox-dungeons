/**
 * 'imp' (Roblox port, docs/ENEMY_VARIANTS.md EV2): the flanker. A small 3 hp demon with no contact damage. Engaged, it
 * keeps 4-7 units from the player like the sniper (approach / back off / strafe, flipping its strafe side when a wall
 * stops it), and every 2.4-3.2 s it BLINKS:
 *
 *   1. Decision (IMP_REPOSITION, cooldown out, the player in sight within blinkRange): ONE draw picks a side, then the
 *      destination is the first valid of four candidates: the player's bearing from the imp turned exactly 90 degrees
 *      (an axis rotation, no trig) to that side, blinkFar from the player, then blinkNear; then the other side, far,
 *      then near. Then ONE enemyCooldown draw for the next blink, whether or not a spot was found, so the draw count
 *      never depends on the layout. No valid spot: no blink, it keeps repositioning.
 *   2. Blink wind-up: ctx.telegraph(IMP_BLINK_TELEGRAPH_TICKS = 0.5 s, IMP_ATTACK_BLINK); the destination is in
 *      v[IMP_DEST_X / Z] and `fx.ring` draws a filling circle there. The imp stands still facing the player.
 *   3. Landing (the wind-up's last tick): the destination is checked again; if it went invalid (a player walked onto
 *      it, sight is broken) the blink is cancelled (no teleport) and it goes back to repositioning. Otherwise it snaps
 *      there: x / z AND prevX / prevZ = the destination (no interpolation streak), home unchanged, and the aim at the
 *      player is locked into v[IMP_AIM_X / Z]: ctx.telegraph(IMP_LAND_AIM_TICKS = 0.35 s, IMP_ATTACK_FAN).
 *   4. Fan: on that telegraph's last tick, a 5-bullet fan (IMP_FAN_SPREAD 0.7 rad, ~40 degrees; a port arc shape,
 *      combat/arcTablePort.ts) down the locked aim at IMP_FAN_SPEED 5.5 u/s (slower than the sniper's slowest shot, 9,
 *      and the boss fan's 6.5: it is a read-and-step-aside fan), then back to repositioning.
 *
 * Blink safety: a destination is valid only when (a) its whole body box (the cells under x +- radius, z +- radius) is
 * floor (`ctx.isBlocked` false) and holds no intact breakable (the movers' `solid` cells, solidCells(state)); (b) it is
 * in the imp's own room (ctx.roomAt of the destination and of its home are the same room, or both none on a room-less
 * test floor) and within leashRange of its home (so it never lands where it would give up at once); (c) it has line
 * of sight to the targeted player; (d) it is at least SPAWN_SAFE_RADIUS (shared/sim endlessData) from EVERY living
 * player (co-op: all of them). SPAWN_SAFE_RADIUS is 4, so blinkNear is 4.25, not ~3.5: a nearer candidate could never
 * pass (d) against the player it flanks.
 *
 * View contract (EV9): states / attack ids / v slots below; the ring hint (`fx.ring`, only while attack ===
 * IMP_ATTACK_BLINK) fills over IMP_BLINK_TELEGRAPH_TICKS; the aim line (`fx.aimLine`, only while attack ===
 * IMP_ATTACK_FAN, bold throughout: the aim is locked at landing) shows the fan's centre line. A landing is the tick
 * where aiState === TELEGRAPH, attack === IMP_ATTACK_FAN and aiTicks === IMP_LAND_AIM_TICKS (prevX / prevZ equal x / z
 * there: snap, puff). While repositioning, aiTicks counts ticks without line of sight (leashes past lostTicks).
 * Leashes home after losing the player.
 */

import { HIT_NORMAL, secondsToTicks } from "../../../playerData";
import { SPAWN_SAFE_RADIUS } from "../../../endlessData";
import { partySize, playerAt } from "../../../party";
import { solidCells } from "../../../breakables/cells";
import { cellKey, gridToWorld, worldToGrid } from "shared/dungeon";
import { BulletKind, type BurstSpec } from "../../patterns";
import type { SimCtx } from "../../ctx";
import { enemyCooldown, enemyCooldownFixed, walkStep } from "../actorMods";
import { faceToward, moveActor, toPlayer, walkToward } from "../helpers";
import { PORT_BAND_ENEMIES, registerArchetype } from "../registry";
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

export interface ImpData extends RoomEnemyData {
	/** Preferred distance band to the player (world units). */
	readonly keepMin: number;
	readonly keepMax: number;
	/** Only decides to blink when the player is this close (and in sight). */
	readonly blinkRange: number;
	/** Ticks between blink decisions (random in [min, max], enemyCooldown), and before the first one after engaging. */
	readonly blinkCooldownMin: number;
	readonly blinkCooldownMax: number;
	readonly firstBlink: number;
	/** The blink's wind-up (the ring on the floor), ticks. */
	readonly blinkTelegraphTicks: number;
	/** Candidate distances of the destination from the player, tried far first (world units, >= SPAWN_SAFE_RADIUS). */
	readonly blinkFar: number;
	readonly blinkNear: number;
	/** The aim telegraph after landing, ticks. */
	readonly landAimTicks: number;
	/** The fan fired after the landing aim. */
	readonly fan: BurstSpec;
	/** Weight of the sideways component of the repositioning move (radial is 1). */
	readonly strafeWeight: number;
}

// --- States and attack ids
/** Keeping range: approach / back off / strafe, count down to the next blink. */
export const IMP_REPOSITION = STATE_ENGAGED;
/** ActorState.attack during the blink wind-up (aiState TELEGRAPH; the ring at v[IMP_DEST_X / Z]). */
export const IMP_ATTACK_BLINK = 1;
/** ActorState.attack during the landing aim (aiState TELEGRAPH; the locked aim at v[IMP_AIM_X / Z]). */
export const IMP_ATTACK_FAN = 2;

// --- v[] slots (0..2 shared)
/** The blink destination (world), valid while attack === IMP_ATTACK_BLINK. */
export const IMP_DEST_X = 3;
export const IMP_DEST_Z = 4;
/** Aim direction (unit): toward the player during the wind-up, locked at landing for the fan. */
export const IMP_AIM_X = 5;
export const IMP_AIM_Z = 6;
/** Strafe side, +1 or -1. */
export const IMP_STRAFE = 7;

// --- Timings and shapes the view reads
const BLINK_TELEGRAPH_SECONDS = 0.5;
const LAND_AIM_SECONDS = 0.35;
/** Blink wind-up ticks (30): the ring fills over these. */
export const IMP_BLINK_TELEGRAPH_TICKS = secondsToTicks(BLINK_TELEGRAPH_SECONDS);
/** Landing aim ticks (21): the fan fires when they run out. */
export const IMP_LAND_AIM_TICKS = secondsToTicks(LAND_AIM_SECONDS);
/** The fan: 5 bullets over 0.7 rad (~40.1 degrees). The SAME literal is the imp row of combat/arcTablePort.ts. */
export const IMP_FAN_COUNT = 5;
export const IMP_FAN_SPREAD = 0.7;
/** The fan's speed (world units / s, before the endless floor's bullet speed scale) and life (s). */
export const IMP_FAN_SPEED = 5.5;
const FAN_LIFE = 1.8;
/** Spawn offset of the fan's bullets from the imp's centre (BurstSpec.radius). */
const FAN_OFFSET = 0.4;

const IMP_RADIUS = 0.35;
/** The ring is the body plus this margin (world units). */
const RING_MARGIN = 0.25;
/** Radius of the destination ring (world units). */
export const IMP_RING_RADIUS = IMP_RADIUS + RING_MARGIN;
/** Length of the landing aim line (world units): the far blink distance, so it reaches the player it flanks. */
const AIM_LINE_LENGTH = 5;

/** A move shorter than this fraction of the step means a wall: flip the strafe side. */
const STRAFE_BLOCKED = 0.3;
/** Side pick: random() below this turns the bearing to the +1 side first. */
const COIN = 0.5;

export const IMP = registerArchetype<ImpData>({
	id: "imp",
	band: PORT_BAND_ENEMIES,
	data: {
		hp: 3,
		radius: IMP_RADIUS,
		speed: 3.2,
		contactDamage: 0,
		spriteId: "enemy.imp",
		roomEnemy: true,
		aggroRange: 9,
		leashRange: 15,
		lostTicks: secondsToTicks(2.5),
		alertRange: 4.5,
		keepMin: 4,
		keepMax: 7,
		blinkRange: 10,
		blinkCooldownMin: secondsToTicks(2.4), // 144
		blinkCooldownMax: secondsToTicks(3.2), // 192
		firstBlink: secondsToTicks(1.2),
		blinkTelegraphTicks: IMP_BLINK_TELEGRAPH_TICKS,
		blinkFar: 5,
		blinkNear: 4.25,
		landAimTicks: IMP_LAND_AIM_TICKS,
		fan: {
			count: IMP_FAN_COUNT,
			spread: IMP_FAN_SPREAD,
			speed: IMP_FAN_SPEED,
			life: FAN_LIFE,
			damage: HIT_NORMAL,
			kind: BulletKind.ENEMY,
			radius: FAN_OFFSET,
		},
		strafeWeight: 0.8,
		fx: {
			ring: {
				state: AiState.TELEGRAPH,
				attack: IMP_ATTACK_BLINK,
				xSlot: IMP_DEST_X,
				zSlot: IMP_DEST_Z,
				radius: IMP_RING_RADIUS,
				fillTicks: IMP_BLINK_TELEGRAPH_TICKS,
			},
			aimLine: {
				dirX: IMP_AIM_X,
				dirZ: IMP_AIM_Z,
				length: AIM_LINE_LENGTH,
				boldTicks: IMP_LAND_AIM_TICKS + 1,
				attack: IMP_ATTACK_FAN,
			},
		},
	},
	init(ctx, a) {
		initRoomEnemy(a);
		// No draws: alternate the first strafe side by actor id; the first blink waits firstBlink even when it engages on
		// its very first step (stepCalm re-arms it on every calm tick after that).
		a.v[IMP_STRAFE] = a.id % 2 === 0 ? 1 : -1;
		a.cooldown = enemyCooldownFixed(ctx, a, ctx.data<ImpData>(a).firstBlink);
	},
	step(ctx, a) {
		const d = ctx.data<ImpData>(a);
		if (stepCalm(ctx, a)) {
			a.cooldown = enemyCooldownFixed(ctx, a, d.firstBlink);
			return;
		}
		if (shouldLeash(ctx, a)) {
			leash(a);
			return;
		}
		if (a.aiState === AiState.TELEGRAPH) {
			if (a.attack === IMP_ATTACK_BLINK) blinkWindup(ctx, a, d);
			else landingAim(ctx, a, d);
		} else reposition(ctx, a, d);
	},
	onHit(ctx, a) {
		engageOnHit(ctx, a);
	},
	onDeath(ctx, a) {
		alertOnDeath(ctx, a); // a fan already in flight keeps flying
	},
});

/**
 * True when the cell under world (x, z) blocks a body: a wall, void or pool tile (ctx.isBodyBlocked; a pool lets
 * bullets through, so ctx.isBlocked let a blink land in one) or an intact breakable.
 */
function cellBlocked(ctx: SimCtx, gx: number, gz: number): boolean {
	if (ctx.isBodyBlocked(gridToWorld(gx), gridToWorld(gz))) return true;
	const solid = solidCells(ctx.state);
	return solid !== undefined && solid.has(cellKey(gx, gz));
}

/** The blink safety rules (file header) for a destination (x, z), against the bound target player and every player. */
export function impBlinkValid(ctx: SimCtx, a: Readonly<ActorState>, x: number, z: number): boolean {
	// (a) The body's box stands on open floor with no intact breakable.
	const r = a.radius;
	const gx0 = worldToGrid(x - r);
	const gx1 = worldToGrid(x + r);
	const gz0 = worldToGrid(z - r);
	const gz1 = worldToGrid(z + r);
	for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) if (cellBlocked(ctx, gx, gz)) return false;
	// (b) Its own room (the one holding its home), within its leash.
	const hx = a.v[V_HOME_X];
	const hz = a.v[V_HOME_Z];
	const home = ctx.roomAt(hx, hz);
	const there = ctx.roomAt(x, z);
	if (home === undefined ? there !== undefined : there === undefined || there.id !== home.id) return false;
	const leashRange = ctx.data<ImpData>(a).leashRange;
	if ((x - hx) * (x - hx) + (z - hz) * (z - hz) > leashRange * leashRange) return false;
	// (d) Clear of every living player (cheap, before the tile walk of the sight line).
	const n = partySize(ctx.state);
	const safe2 = SPAWN_SAFE_RADIUS * SPAWN_SAFE_RADIUS;
	for (let i = 0; i < n; i++) {
		const p = playerAt(ctx.state, i);
		if (p.dead !== 0) continue;
		const dx = p.x - x;
		const dz = p.z - z;
		if (dx * dx + dz * dz < safe2) return false;
	}
	// (c) Line of sight to the target.
	const t = ctx.player;
	return ctx.lineOfSight(x, z, t.x, t.z);
}

/**
 * Tries one candidate: the target's position plus the bearing (dirX, dirZ) turned 90 degrees to `side` (+1: (-z, x),
 * -1: (z, -x); exact) times `dist`. On success writes it into v[IMP_DEST_X / Z].
 */
function tryCandidate(ctx: SimCtx, a: ActorState, dirX: number, dirZ: number, side: number, dist: number): boolean {
	const p = ctx.player;
	const x = p.x - dirZ * side * dist;
	const z = p.z + dirX * side * dist;
	if (!impBlinkValid(ctx, a, x, z)) return false;
	a.v[IMP_DEST_X] = x;
	a.v[IMP_DEST_Z] = z;
	return true;
}

/** Sets the aim slots to the unit direction (dirX, dirZ) and faces it. */
function aimAt(a: ActorState, dirX: number, dirZ: number): void {
	a.v[IMP_AIM_X] = dirX;
	a.v[IMP_AIM_Z] = dirZ;
	faceToward(a, dirX, dirZ);
}

/**
 * The blink decision: ONE side draw, the four candidates in order, then ONE cooldown draw whatever came of it. Returns
 * true when the wind-up started.
 */
function decideBlink(ctx: SimCtx, a: ActorState, d: ImpData, dirX: number, dirZ: number): boolean {
	const side = ctx.random() < COIN ? 1 : -1;
	const found =
		tryCandidate(ctx, a, dirX, dirZ, side, d.blinkFar) ||
		tryCandidate(ctx, a, dirX, dirZ, side, d.blinkNear) ||
		tryCandidate(ctx, a, dirX, dirZ, -side, d.blinkFar) ||
		tryCandidate(ctx, a, dirX, dirZ, -side, d.blinkNear);
	a.cooldown = enemyCooldown(ctx, a, d.blinkCooldownMin, d.blinkCooldownMax);
	if (!found) return false;
	aimAt(a, dirX, dirZ);
	ctx.telegraph(a, d.blinkTelegraphTicks, IMP_ATTACK_BLINK);
	return true;
}

/** Back to keeping range (after the fan, or a cancelled blink); the strafe side flips so it does not drift one way. */
function backToReposition(a: ActorState): void {
	a.aiState = IMP_REPOSITION;
	a.aiTicks = 0;
	a.attack = 0;
	a.v[IMP_STRAFE] = -a.v[IMP_STRAFE];
}

function blinkWindup(ctx: SimCtx, a: ActorState, d: ImpData): void {
	const tp = toPlayer(ctx, a);
	aimAt(a, tp.dirX, tp.dirZ);
	a.aiTicks -= 1;
	if (a.aiTicks > 0) return;
	const x = a.v[IMP_DEST_X];
	const z = a.v[IMP_DEST_Z];
	if (!impBlinkValid(ctx, a, x, z)) {
		backToReposition(a); // cancelled: no teleport
		return;
	}
	// Snap: no interpolation streak from the old spot.
	a.x = x;
	a.z = z;
	a.prevX = x;
	a.prevZ = z;
	const landed = toPlayer(ctx, a);
	aimAt(a, landed.dirX, landed.dirZ);
	ctx.telegraph(a, d.landAimTicks, IMP_ATTACK_FAN);
}

function landingAim(ctx: SimCtx, a: ActorState, d: ImpData): void {
	a.aiTicks -= 1;
	if (a.aiTicks > 0) return;
	ctx.fireEnemy(a, a.v[IMP_AIM_X], a.v[IMP_AIM_Z], d.fan);
	backToReposition(a);
}

function reposition(ctx: SimCtx, a: ActorState, d: ImpData): void {
	const p = ctx.player;
	const tp = toPlayer(ctx, a);
	const dist = tp.dist;
	const dirX = tp.dirX;
	const dirZ = tp.dirZ;
	const los = ctx.lineOfSight(a.x, a.z, p.x, p.z);
	if (los) {
		a.aiTicks = 0;
	} else {
		a.aiTicks += 1;
		if (a.aiTicks > d.lostTicks) {
			leash(a);
			return;
		}
	}
	if (a.cooldown > 0) a.cooldown--;
	if (los && a.cooldown <= 0 && dist <= d.blinkRange && decideBlink(ctx, a, d, dirX, dirZ)) return;
	const stepLen = walkStep(ctx, a);
	if (!los) {
		// Lost sight: walk toward the player to find a line again (walls slide it around corners).
		walkToward(ctx, a, p.x, p.z, stepLen, STEER);
		return;
	}
	faceToward(a, dirX, dirZ);
	const radial = dist < d.keepMin ? -1 : dist > d.keepMax ? 1 : 0;
	const side = a.v[IMP_STRAFE] * d.strafeWeight;
	// Perpendicular to the player direction: (-dirZ, dirX).
	let mx = dirX * radial - dirZ * side;
	let mz = dirZ * radial + dirX * side;
	const m2 = mx * mx + mz * mz;
	if (m2 > 1e-12) {
		const k = stepLen / math.sqrt(m2);
		mx *= k;
		mz *= k;
		const x0 = a.x;
		const z0 = a.z;
		moveActor(ctx, a, mx, mz);
		const ox = a.x - x0;
		const oz = a.z - z0;
		if (ox * ox + oz * oz < stepLen * stepLen * STRAFE_BLOCKED * STRAFE_BLOCKED) {
			a.v[IMP_STRAFE] = -a.v[IMP_STRAFE];
		}
	}
}

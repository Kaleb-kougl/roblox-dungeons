/**
 * 'bomber' (Roblox port, docs/NEW_ENEMIES.md NE2; no web source): a frail rusher that blows up. 2 hp, no contact
 * damage. Engaged, it sprints straight at its target (the swarmer's chase through `walkStep`, steering round pillars
 * with config.actorSteerMover).
 *
 * Fuse: within fuseTrigger of its target, a LIVING player (co-op: the nearest living one, so a downed player never
 * lights it), it stops and fuses for fuseTicks (`ctx.telegraph`, attack BOMBER_ATTACK_FUSE; the `ring` hint at its
 * feet, fuseRingRadius, filling; v[BOMBER_FUSED] = BOMBER_FUSE_LIT). Once lit the blast is committed: no leash, no
 * calm, nothing but its death stops it. Blast (NED5: a bullet ring only): `blast` (12 slow bullets @ FULL_RING, the
 * port arc row; spawned blast.radius from its centre so point blank still hits; the ring is turned so one bullet flies
 * straight at its target), `slamBreakables` with blastBreakRadius, then it dies through the QUIET death path
 * (actors.ts killActor `quiet`): no points, no combo, no Vampire Fang, no drop roll (a guaranteed room still counts it
 * as gone), no Vengeful ring, no build procs (those only run on damageActor's kill line). Its corpse keeps
 * v[BOMBER_FUSED] = BOMBER_DETONATED (hashed: the view's Explode death).
 *
 * Shot or cut first (even mid-fuse, NED4) it fizzles: damageActor's ordinary kill (scores, rolls, procs, Vengeful),
 * no blast; its corpse keeps v[BOMBER_FUSED] 0 or BOMBER_FUSE_LIT (the view's plain death).
 *
 * Draws: none (the fuse is a distance test, the blast's turn is the target's bearing; no cooldown: it attacks once).
 *
 * View contract: states BOMBER_CHASE (= STATE_ENGAGED) / AiState.TELEGRAPH (the fuse); attack id BOMBER_ATTACK_FUSE;
 * v slot BOMBER_FUSED (0 never lit, BOMBER_FUSE_LIT fusing or fizzled mid-fuse, BOMBER_DETONATED blown up: read it on
 * the corpse, `alive === 0`, to pick Explode over Die 1).
 *
 * @module
 */

import { HIT_NORMAL, secondsToTicks } from "../../../playerData";
import { BulletKind, FULL_RING, type BurstSpec } from "../../patterns";
import type { SimCtx } from "../../ctx";
import { walkStep } from "../actorMods";
import { slamBreakables } from "../../../breakables/breakables";
import { killActor } from "../actors";
import { faceToward, toPlayer, walkToward } from "../helpers";
import { PORT_BAND_ENEMIES_2, registerArchetype } from "../registry";
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

export interface BomberData extends RoomEnemyData {
	/** Starts the fuse when a living player is this close (centre to centre, world units). */
	readonly fuseTrigger: number;
	/** Fuse ticks (the telegraph; the ring fills over it). */
	readonly fuseTicks: number;
	/** Radius of the fuse ring at its feet (render): about where the blast's bullets reach first. */
	readonly fuseRingRadius: number;
	/** The blast: a full ring of slow bullets, spawned `radius` from its centre. */
	readonly blast: BurstSpec;
	/** Breakables within this of its centre break in the blast (slamBreakables' radius). */
	readonly blastBreakRadius: number;
	/** Stops chasing this far from its target's centre. */
	readonly chaseStop: number;
}

// --- States and attack ids
/** Sprinting at its target. */
export const BOMBER_CHASE = STATE_ENGAGED;
/** ActorState.attack while fusing (AiState.TELEGRAPH). */
export const BOMBER_ATTACK_FUSE = 1;

// --- v[] slots (0..2 shared)
/**
 * BOMBER_FUSE_LIT once the fuse has started (the blast is committed unless it is killed first), BOMBER_DETONATED once
 * it blew up.
 */
export const BOMBER_FUSED = 3;
/** v[BOMBER_FUSED] while fusing (and on a corpse shot mid-fuse). */
export const BOMBER_FUSE_LIT = 1;
/** v[BOMBER_FUSED] on a corpse that detonated (the quiet death): the view plays Explode. */
export const BOMBER_DETONATED = 2;

/** Bullets in the blast ring (the port arc row 12 @ FULL_RING, combat/arcTablePort.ts, shared with Volatile II). */
export const BOMBER_BLAST_COUNT = 12;
const FUSE_SECONDS = 0.7;
const FUSE_RING_RADIUS = 2;
const BLAST_SPEED = 3;
const BLAST_LIFE = 2.6;
/** Blast bullets spawn this far from its centre (point blank still hits). */
const BLAST_SPAWN_RADIUS = 0.6;
const BLAST_BREAK_RADIUS = 1.5;

export const BOMBER = registerArchetype<BomberData>({
	id: "bomber",
	band: PORT_BAND_ENEMIES_2,
	data: {
		hp: 2,
		radius: 0.3,
		speed: 4,
		contactDamage: 0,
		spriteId: "enemy.bomber",
		roomEnemy: true,
		aggroRange: 8,
		leashRange: 16,
		lostTicks: secondsToTicks(2),
		alertRange: 4.5,
		fuseTrigger: 1.6,
		fuseTicks: secondsToTicks(FUSE_SECONDS), // 42
		fuseRingRadius: FUSE_RING_RADIUS,
		blast: {
			count: BOMBER_BLAST_COUNT,
			spread: FULL_RING,
			speed: BLAST_SPEED,
			life: BLAST_LIFE,
			damage: HIT_NORMAL,
			kind: BulletKind.ENEMY,
			radius: BLAST_SPAWN_RADIUS,
		},
		blastBreakRadius: BLAST_BREAK_RADIUS,
		chaseStop: 0.55,
		fx: {
			ring: {
				state: AiState.TELEGRAPH,
				radius: FUSE_RING_RADIUS,
				fillTicks: secondsToTicks(FUSE_SECONDS),
				attack: BOMBER_ATTACK_FUSE,
			},
		},
	},
	init(_ctx, a) {
		initRoomEnemy(a);
	},
	step(ctx, a) {
		const d = ctx.data<BomberData>(a);
		// A lit fuse is committed: it runs before calm / leash, so nothing but its death stops the blast.
		if (a.aiState === AiState.TELEGRAPH) {
			fusing(ctx, a, d);
			return;
		}
		if (stepCalm(ctx, a)) return;
		if (shouldLeash(ctx, a)) {
			leash(a);
			return;
		}
		chase(ctx, a, d);
	},
	onHit(ctx, a) {
		engageOnHit(ctx, a);
	},
	onDeath(ctx, a) {
		alertOnDeath(ctx, a);
	},
});

/** Runs straight at its target, stopping chaseStop short; lights the fuse within fuseTrigger of a living target. */
function chase(ctx: SimCtx, a: ActorState, d: BomberData): void {
	const p = ctx.player;
	const tx = p.x - a.x;
	const tz = p.z - a.z;
	const dist2 = tx * tx + tz * tz;
	if (p.dead === 0 && dist2 <= d.fuseTrigger * d.fuseTrigger) {
		faceToward(a, tx, tz);
		a.v[BOMBER_FUSED] = BOMBER_FUSE_LIT;
		ctx.telegraph(a, d.fuseTicks, BOMBER_ATTACK_FUSE);
		return;
	}
	const left = math.sqrt(dist2) - d.chaseStop;
	if (left > 0) {
		const walk = walkStep(ctx, a);
		walkToward(ctx, a, p.x, p.z, walk < left ? walk : left, STEER);
	} else faceToward(a, tx, tz);
}

/** The fuse: stands still facing its target; at 0 it blasts. */
function fusing(ctx: SimCtx, a: ActorState, d: BomberData): void {
	const tp = toPlayer(ctx, a);
	faceToward(a, tp.dirX, tp.dirZ);
	a.aiTicks -= 1;
	if (a.aiTicks > 0) return;
	blast(ctx, a, d, tp.dirX, tp.dirZ);
}

/** The blast: the bullet ring (one bullet along (dirX, dirZ)), breakables in blastBreakRadius, then the quiet death. */
function blast(ctx: SimCtx, a: ActorState, d: BomberData, dirX: number, dirZ: number): void {
	ctx.fireEnemy(a, dirX, dirZ, d.blast);
	slamBreakables(ctx.state, a.x, a.z, d.blastBreakRadius);
	a.attack = 0;
	a.v[BOMBER_FUSED] = BOMBER_DETONATED;
	killActor(ctx, a, true);
}

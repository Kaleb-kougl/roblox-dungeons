/**
 * 'bomber' (Roblox port, docs/NEW_ENEMIES.md; no web source): a frail rusher that blows up. 2 hp, no contact damage.
 * Engaged, it sprints straight at its target (the swarmer's chase through `walkStep`, steering round pillars).
 *
 * Planned (NE2, not built yet): within fuseTrigger of a LIVING player it stops and fuses for fuseTicks (`ctx.telegraph`,
 * attack BOMBER_ATTACK_FUSE; the `ring` hint at its feet, fuseRingRadius, filling), then blasts: `blast` (12 slow
 * bullets @ FULL_RING, spawned blast.radius from its centre so point blank still hits), `slamBreakables` with
 * blastBreakRadius, and it dies with no points, no drop roll and no build procs. Shot or cut first (even mid-fuse,
 * NED4) it fizzles: an ordinary kill, no blast.
 *
 * NE1 skeleton: the data block and a minimal step (calm / leash / engage, then the chase); no fuse, no blast, no draws.
 *
 * View contract: states BOMBER_CHASE (= STATE_ENGAGED) / AiState.TELEGRAPH (the fuse); attack id BOMBER_ATTACK_FUSE;
 * v slot BOMBER_FUSED (1 once the fuse has started).
 */

import { HIT_NORMAL, secondsToTicks } from "../../../playerData";
import { BulletKind, FULL_RING, type BurstSpec } from "../../patterns";
import type { SimCtx } from "../../ctx";
import { walkStep } from "../actorMods";
import { faceToward, walkToward } from "../helpers";
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
/** 1 once the fuse has started (the blast is committed unless it is killed first). */
export const BOMBER_FUSED = 3;

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

/** NE1 skeleton: runs straight at its target, stopping chaseStop short (no fuse yet). */
function chase(ctx: SimCtx, a: ActorState, d: BomberData): void {
	const p = ctx.player;
	const tx = p.x - a.x;
	const tz = p.z - a.z;
	const left = math.sqrt(tx * tx + tz * tz) - d.chaseStop;
	if (left > 0) {
		const walk = walkStep(ctx, a);
		walkToward(ctx, a, p.x, p.z, walk < left ? walk : left, STEER);
	} else faceToward(a, tx, tz);
}

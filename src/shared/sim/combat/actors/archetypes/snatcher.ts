/**
 * 'snatcher' (Roblox port, docs/NEW_ENEMIES_2.md; no web source): a small harmless imp that eats its room's pellets and
 * flees; kill it to get them back. 3 hp, contact damage 0, never attacks. At most one per room and never a room's first
 * buy (NXD9, the dungeon's room pool, NX6); Horde's second wave never buys one.
 *
 * Planned (NX4, not built yet): STEAL, it walks (steer mover) to the nearest live regular pellet of its own room
 * (index order on ties, never the power pellet) and eats it within eatRadius of its centre: the pellet's taken = 2
 * (carried), v[SNATCHER_CARRIED] counts it. FLEE: any living player within fleeRadius -> it runs on shared/dungeon
 * fleeField over its room box (fleeFactor, the Goldling's) until none is within fleeRelease. SWALLOW: at stomach
 * carried pellets or swallowAfterTicks after its first steal (v[SNATCHER_SINCE]), a swallowTicks telegraph (attack
 * SNATCHER_ATTACK_SWALLOW, standing still), then every carried pellet becomes taken = 3 (gone: the room's Sweep is
 * lost, NXD11) and the count resets. Its death returns every taken = 2 pellet of its room to 0 in place. No draws.
 *
 * NX1 skeleton: the data block and a minimal step (calm / leash / engage, then it walks straight away from its target
 * while that player is within fleeRadius, else stands facing it); no pellets, no flee field, no swallow, no draws.
 *
 * View contract: states SNATCHER_STEAL (= STATE_ENGAGED) / SNATCHER_FLEE / AiState.TELEGRAPH (the swallow, aiTicks
 * counts it down); attack id SNATCHER_ATTACK_SWALLOW; v slots SNATCHER_CARRIED (the belly glow's count),
 * SNATCHER_SINCE (ticks since the first steal of this belly), SNATCHER_FLEEING (1 while fleeing).
 */

import { GOLDEN_FLEE } from "shared/dungeon";
import { secondsToTicks } from "../../../playerData";
import { PELLET_PICKUP_RADIUS } from "../../../pellets/pelletsData";
import type { SimCtx } from "../../ctx";
import { walkStep } from "../actorMods";
import { faceToward, moveActor, toPlayer } from "../helpers";
import { PORT_BAND_ENEMIES_3, registerArchetype } from "../registry";
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

export interface SnatcherData extends RoomEnemyData {
	/** Eats a pellet whose centre is within this of its centre (world units: a player's pickup reach). */
	readonly eatRadius: number;
	/** Flees while a living player is within fleeRadius, until none is within fleeRelease (world units). */
	readonly fleeRadius: number;
	readonly fleeRelease: number;
	/** shared/dungeon fleeField's factor (the Goldling's). */
	readonly fleeFactor: number;
	/** Swallows at this many carried pellets, or this many ticks after its first steal. */
	readonly stomach: number;
	readonly swallowAfterTicks: number;
	/** The swallow's telegraph (it stands still: the window to kill it). */
	readonly swallowTicks: number;
}

// --- States and attack ids
/** Stealing: walking to the nearest live pellet of its room. */
export const SNATCHER_STEAL = STATE_ENGAGED;
/** Fleeing on its room's flee field. */
export const SNATCHER_FLEE = AiState.CUSTOM + 1;
/** ActorState.attack while telegraphing the swallow. */
export const SNATCHER_ATTACK_SWALLOW = 1;

// --- v[] slots (0..2 shared)
/** Pellets it carries (taken = 2). */
export const SNATCHER_CARRIED = 3;
/** Ticks since the first steal of this belly (0: nothing carried). */
export const SNATCHER_SINCE = 4;
/** 1 while fleeing. */
export const SNATCHER_FLEEING = 6;

export const SNATCHER = registerArchetype<SnatcherData>({
	id: "snatcher",
	band: PORT_BAND_ENEMIES_3,
	data: {
		hp: 3,
		radius: 0.3,
		speed: 5, // the Goldling's 5.1 less a hair
		contactDamage: 0,
		spriteId: "enemy.snatcher",
		roomEnemy: true,
		aggroRange: 9,
		leashRange: 16,
		lostTicks: 0, // unused, like the summoner's: it flees on purpose, so losing sight never sends it home
		alertRange: 4.5,
		eatRadius: PELLET_PICKUP_RADIUS,
		fleeRadius: 3,
		fleeRelease: 4.5,
		fleeFactor: GOLDEN_FLEE.factor,
		stomach: 5,
		swallowAfterTicks: secondsToTicks(8), // 480
		swallowTicks: secondsToTicks(1), // 60
	},
	init(_ctx, a) {
		initRoomEnemy(a);
	},
	step(ctx, a) {
		const d = ctx.data<SnatcherData>(a);
		if (stepCalm(ctx, a)) return;
		if (shouldLeash(ctx, a)) {
			leash(a);
			return;
		}
		backAway(ctx, a, d);
	},
	onHit(ctx, a) {
		engageOnHit(ctx, a);
	},
	onDeath(ctx, a) {
		alertOnDeath(ctx, a);
	},
});

/** NX1 skeleton: walks straight away from its target while it is within fleeRadius, else stands facing it. */
function backAway(ctx: SimCtx, a: ActorState, d: SnatcherData): void {
	const tp = toPlayer(ctx, a);
	const dirX = tp.dirX;
	const dirZ = tp.dirZ;
	faceToward(a, dirX, dirZ);
	if (tp.dist >= d.fleeRadius) return;
	const stepLen = walkStep(ctx, a);
	moveActor(ctx, a, -dirX * stepLen, -dirZ * stepLen, STEER);
}

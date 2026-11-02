/**
 * 'warbanner' (Roblox port, docs/NEW_ENEMIES.md; no web source): an imp with a banner that stays behind the pack and
 * buffs it. 6 hp, no contact damage. Engaged, it keeps keepMin-keepMax from every living player, staying near its
 * allies' centroid, backing off (`Run Backwards` in the view).
 *
 * Planned (NE6, not built yet): the aura (NED8): every living room enemy (not a boss, turret, dummy or another
 * Warbanner) within auraRadius of a living Warbanner walks at auraWalkPercent and cools down at auraCooldownPercent
 * (actorMods.ts auraWalkPercent / auraCooldownPercent, combined with the affix percent by `combinedPercent`; one aura
 * at most, never a telegraph). Panic (the summoner's): a living player within panicRange -> panicTelegraphTicks
 * (attack WARBANNER_ATTACK_PANIC), the bruiser's gapped ring (`panicRing`), then WARBANNER_BACKOFF for backoffTicks.
 * Never a room's first buy, at most one per room (NE7, NED9).
 *
 * NE1 skeleton: the data block and a minimal step (calm / leash / engage, then keep range from its target straight
 * along the bearing); no aura, no panic, no draws. auraWalkPercent / auraCooldownPercent return 100 until NE6.
 *
 * View contract: states WARBANNER_KEEP (= STATE_ENGAGED) / AiState.TELEGRAPH (the panic) / WARBANNER_BACKOFF; attack id
 * WARBANNER_ATTACK_PANIC; v slots WARBANNER_STRAFE (+1 / -1), WARBANNER_PANIC (the panic latch).
 */

import { secondsToTicks } from "../../../playerData";
import type { BurstSpec } from "../../patterns";
import type { SimCtx } from "../../ctx";
import { walkStep } from "../actorMods";
import { faceToward, moveActor, toPlayer } from "../helpers";
import { PORT_BAND_ENEMIES_2, registerArchetype } from "../registry";
import { AiState, type ActorState } from "../types";
import { BRUISER } from "./bruiser";
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
	},
	init(_ctx, a) {
		initRoomEnemy(a);
		a.v[WARBANNER_STRAFE] = 1;
	},
	step(ctx, a) {
		const d = ctx.data<WarbannerData>(a);
		if (stepCalm(ctx, a)) return;
		if (shouldLeash(ctx, a)) {
			leash(a);
			return;
		}
		keepRange(ctx, a, d);
	},
	onHit(ctx, a) {
		engageOnHit(ctx, a);
	},
	onDeath(ctx, a) {
		alertOnDeath(ctx, a);
	},
});

/** NE1 skeleton: backs off inside keepMin, closes in past keepMax, else stands facing its target (no strafe, no draw). */
function keepRange(ctx: SimCtx, a: ActorState, d: WarbannerData): void {
	const tp = toPlayer(ctx, a);
	const dirX = tp.dirX;
	const dirZ = tp.dirZ;
	faceToward(a, dirX, dirZ);
	const radial = tp.dist < d.keepMin ? -1 : tp.dist > d.keepMax ? 1 : 0;
	if (radial === 0) return;
	const stepLen = walkStep(ctx, a) * radial;
	moveActor(ctx, a, dirX * stepLen, dirZ * stepLen, STEER);
}

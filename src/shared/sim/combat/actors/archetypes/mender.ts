/**
 * 'mender' (Roblox port, docs/NEW_ENEMIES_3.md "Design > Mender"; no web source): a small imp with bone charms that
 * channels a heal beam into the most wounded room enemy near it; a hit on it, a player on the beam or a wall between
 * them cuts the beam. With nobody to heal it plinks its target with slow bolts. 5 hp, contact damage 0.
 *
 * NT1 skeleton: the data (the Design table as named fields, the v slots) and a stub step: idle / walking home /
 * leashing like every room enemy (enemyShared), and once engaged it only faces its target. No heal, no bolt, no
 * movement while engaged, no draw (init draws nothing yet). NT3 builds the behaviour:
 *
 *   Keep range keepMin-keepMax, or stay within healRange of a wounded ally; the pick every pickEveryTicks (the most
 *   wounded eligible ally in healRange and sight: a living room enemy, never a boss, the Goldling, the dummy, a pyre or
 *   another Mender, NTD8 / NT0 finding 4); the link (ctx.telegraph linkTicks), the channel (up to channelTicks, healAmount
 *   every pulseTicks, never above hpMax) and its end rules (the ally full or dead, sight lost, a living player's centre
 *   within PLAYER_RADIUS + beamBlockPad of the beam, any damage on the Mender (then flinchTicks), the time up), then a
 *   channel cooldown; the bolt (no wounded ally, the target in sight within boltRange).
 *
 * Draws (NT3): the first cooldown in init; one per channel end (the next cooldown); one per bolt.
 *
 * View contract: states MENDER_KEEP (= STATE_ENGAGED) / AiState.TELEGRAPH (the link) / MENDER_CHANNEL /
 * MENDER_FLINCH; attack ids MENDER_ATTACK_HEAL / MENDER_ATTACK_BOLT; v slots MENDER_ALLY (the ally's actor id, 0 none:
 * the view draws the beam from it), MENDER_CHANNEL_TICKS, MENDER_PULSE, MENDER_STRAFE (+1 / -1), MENDER_HEALED (hp
 * healed this life).
 */

import { HIT_NORMAL, secondsToTicks } from "../../../playerData";
import { BulletKind, type BurstSpec } from "../../patterns";
import { faceToward, toPlayer } from "../helpers";
import { PORT_BAND_ENEMIES_4, registerArchetype } from "../registry";
import {
	STATE_ENGAGED,
	alertOnDeath,
	engageOnHit,
	initRoomEnemy,
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
	/** Ticks after a channel ends before the next pick (random in [min, max], `enemyCooldown`). */
	readonly channelCooldownMin: number;
	readonly channelCooldownMax: number;
	/** Bolts its target in sight within this (world units) when no ally is wounded. */
	readonly boltRange: number;
	/** Ticks between bolts (random in [min, max]). */
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
/** ActorState.attack on a bolt. */
export const MENDER_ATTACK_BOLT = 2;

// --- v[] slots (0..2 shared)
/** The ally's actor id (0 none): ids are never reused in a run, so the link is exact. */
export const MENDER_ALLY = 3;
/** Channel ticks so far. */
export const MENDER_CHANNEL_TICKS = 4;
/** Ticks to the next heal pulse (and between picks while not channelling). */
export const MENDER_PULSE = 5;
/** Strafe side, +1 or -1. */
export const MENDER_STRAFE = 6;
/** Hp healed this life (scratch, hashed like every v slot; read by the view and NT12). */
export const MENDER_HEALED = 7;

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
	init(_ctx, a) {
		initRoomEnemy(a);
		// No draw for the side: alternate by actor id. NT3 adds the first cooldown's draw.
		a.v[MENDER_STRAFE] = a.id % 2 === 0 ? 1 : -1;
	},
	step(ctx, a) {
		if (stepCalm(ctx, a)) return;
		if (shouldLeash(ctx, a)) {
			leash(a);
			return;
		}
		// NT1 stub: engaged, it only faces its target (NT3: pick, link, channel, bolt).
		const tp = toPlayer(ctx, a);
		faceToward(a, tp.dirX, tp.dirZ);
	},
	onHit(ctx, a) {
		engageOnHit(ctx, a);
	},
	onDeath(ctx, a) {
		alertOnDeath(ctx, a);
	},
});

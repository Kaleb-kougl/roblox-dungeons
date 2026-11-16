/**
 * 'mortar' (Roblox port, docs/NEW_ENEMIES_3.md "Design > Mortar"; no web source): a lean demon at the back of the room
 * that lobs a shell over walls and pillars at where its target is heading; the shell lands as one STRIKE and bursts
 * into a guardable shrapnel ring. 4 hp, contact damage 0.
 *
 * NT1 skeleton: the data (the Design table as named fields, the v slots, the `ring` hint) and a stub step: idle /
 * walking home / leashing like every room enemy (enemyShared), and once engaged it only faces its target. No lob, no
 * movement while engaged, no draw (init draws nothing yet). NT2 builds the behaviour:
 *
 *   Keep range keepMin-keepMax (NT0 finding 12: 6-9) without line of sight; fires only while its target stands in its
 *   own room (NTD3, NT0 finding 10); the draw (ctx.telegraph drawTicks), the landing point (target + one tick of its
 *   motion x leadTicks, clamped to maxLead; a point that is not floor falls back to the target, NT0 finding 5), the
 *   flight (flightTicks, the `ring` hint on v[MORTAR_LAND_X / _Z]), the impact (one `shell` STRIKE, then the `shrapnel`
 *   ring from the point), too close (backs off within tooClose), NTD5's landing after death.
 *
 * Draws (NT2): the first lob cooldown in init, one per lob (the next cooldown). The landing point uses no draw.
 *
 * View contract: states MORTAR_KEEP (= STATE_ENGAGED) / AiState.TELEGRAPH (the draw) / MORTAR_FLIGHT; attack id
 * MORTAR_ATTACK_LOB; v slots MORTAR_LAND_X / _Z (the landing point), MORTAR_FLIGHT_TICKS (flight ticks left),
 * MORTAR_STRAFE (+1 / -1).
 */

import { HIT_NORMAL, secondsToTicks } from "../../../playerData";
import { SIM_DT } from "../../../units";
import { STRIKE_BULLET_RADIUS } from "../../combatData";
import { BulletKind, FULL_RING, type BurstSpec } from "../../patterns";
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

export interface MortarData extends RoomEnemyData {
	/** Preferred distance band to its target (world units; NT0 finding 12). */
	readonly keepMin: number;
	readonly keepMax: number;
	/** Weight of the sideways component of the keep-range move (radial is 1). */
	readonly strafeWeight: number;
	/** Lobs only while its target is within lobRange and at least tooClose away (world units). */
	readonly lobRange: number;
	/** Within this of its target it never lobs and backs off (world units). */
	readonly tooClose: number;
	/** Ticks between lobs (random in [min, max], `enemyCooldown`), and before the first one. */
	readonly lobCooldownMin: number;
	readonly lobCooldownMax: number;
	/** The draw: the telegraph's ticks (the bow drawn skyward). */
	readonly drawTicks: number;
	/** The flight: ticks from the release to the impact (the ring fills over it). */
	readonly flightTicks: number;
	/** The lead: the target's last tick of motion x leadTicks (flightTicks x leadShare), at most maxLead long. */
	readonly leadTicks: number;
	readonly maxLead: number;
	/** The shell: one stationary STRIKE bullet at the landing point (the Stormcaller's rules, NTD4). */
	readonly shell: BurstSpec;
	/** The shell's hold in collision passes (ticks; `shell.pierce` carries it, `shell.life` is the same). */
	readonly shellLifeTicks: number;
	/** The shrapnel: an ordinary enemy ring from the landing point (6 @ FULL_RING, a port arc row). */
	readonly shrapnel: BurstSpec;
}

// --- States and attack ids
/** Keeping range. */
export const MORTAR_KEEP = STATE_ENGAGED;
/** The shell in the air (after the draw's release, until the impact). */
export const MORTAR_FLIGHT = STATE_ENGAGED + 1;
/** ActorState.attack while drawing and while the shell flies. */
export const MORTAR_ATTACK_LOB = 1;

// --- v[] slots (0..2 shared)
/** The landing point (world), fixed at the release. */
export const MORTAR_LAND_X = 3;
export const MORTAR_LAND_Z = 4;
/** Flight ticks left (counted down by the living Mortar and, NTD5, by its corpse). */
export const MORTAR_FLIGHT_TICKS = 5;
/** Strafe side, +1 or -1. */
export const MORTAR_STRAFE = 6;

const FLIGHT_SECONDS = 1;
const LEAD_SHARE = 0.6;
/** Shell hold (ticks). At most the payload's pierce field maximum (7): it rides there (the Stormcaller's strike). */
export const MORTAR_SHELL_TICKS = 6;
const SHRAPNEL_COUNT = 6;

export const MORTAR = registerArchetype<MortarData>({
	id: "mortar",
	band: PORT_BAND_ENEMIES_4,
	data: {
		hp: 4,
		radius: 0.35,
		speed: 2.2,
		contactDamage: 0,
		spriteId: "enemy.mortar",
		roomEnemy: true,
		aggroRange: 10,
		leashRange: 16,
		lostTicks: 0, // unused: it fires over cover, so losing sight never sends it home (NTD3: only shouldLeash)
		alertRange: 4.5,
		keepMin: 6,
		keepMax: 9,
		strafeWeight: 0.8,
		lobRange: 10,
		tooClose: 3,
		lobCooldownMin: secondsToTicks(3.2),
		lobCooldownMax: secondsToTicks(4.2),
		drawTicks: secondsToTicks(0.35), // 21
		flightTicks: secondsToTicks(FLIGHT_SECONDS), // 60
		leadTicks: secondsToTicks(FLIGHT_SECONDS * LEAD_SHARE), // 36
		maxLead: 3,
		shell: {
			count: 1,
			spread: 0,
			speed: 0,
			life: MORTAR_SHELL_TICKS * SIM_DT,
			damage: HIT_NORMAL,
			kind: BulletKind.STRIKE,
			pierce: MORTAR_SHELL_TICKS,
		},
		shellLifeTicks: MORTAR_SHELL_TICKS,
		shrapnel: {
			count: SHRAPNEL_COUNT,
			spread: FULL_RING,
			speed: 3.5,
			life: 1.2,
			damage: HIT_NORMAL,
			kind: BulletKind.ENEMY,
		},
		fx: {
			ring: {
				state: MORTAR_FLIGHT,
				xSlot: MORTAR_LAND_X,
				zSlot: MORTAR_LAND_Z,
				radius: STRIKE_BULLET_RADIUS,
				fillTicks: secondsToTicks(FLIGHT_SECONDS),
				attack: MORTAR_ATTACK_LOB,
			},
		},
	},
	init(_ctx, a) {
		initRoomEnemy(a);
		// No draw for the side: alternate by actor id (the stormcaller's rule). NT2 adds the first cooldown's draw.
		a.v[MORTAR_STRAFE] = a.id % 2 === 0 ? 1 : -1;
	},
	step(ctx, a) {
		if (stepCalm(ctx, a)) return;
		if (shouldLeash(ctx, a)) {
			leash(a);
			return;
		}
		// NT1 stub: engaged, it only faces its target (NT2: keep range, lob, flight, impact).
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

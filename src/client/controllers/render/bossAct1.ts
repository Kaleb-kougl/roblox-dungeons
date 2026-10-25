import {
	BOSS_ACT1_ID,
	BOSS_TELEGRAPH_TICKS,
	BossAttack,
	BossState,
	DOUBLE_RING_ARC,
	FAN,
	FAST_FAN,
	HALF_TURN_COS,
	HALF_TURN_SIN,
	RING_ARC,
	SHOCK2_TURNS,
	SHOCKWAVE,
	SPIRAL_ARMS,
	TURN_COS,
	TURN_SIN,
	V_AUX_X,
	V_AUX_Z,
	V_DIR_X,
	V_DIR_Z,
	V_MARK,
	V_SIGN,
} from "shared/sim";
import type { BossAct1Consts } from "shared/view";

/**
 * The boss.act1 id and the constants the telegraph previews need, imported by name from shared/sim so a rename in
 * the boss module fails the build instead of silently turning previews off.
 */
export interface BossAct1View {
	readonly id: string;
	readonly consts: BossAct1Consts;
}

const VIEW: BossAct1View = {
	id: BOSS_ACT1_ID,
	consts: {
		attack: BossAttack,
		state: { ACTIVE: BossState.ACTIVE, TRANSITION: BossState.TRANSITION },
		telegraphTicks: BOSS_TELEGRAPH_TICKS,
		fan: FAN,
		fastFan: FAST_FAN,
		ringArc: RING_ARC,
		doubleRingArc: DOUBLE_RING_ARC,
		spiralArms: SPIRAL_ARMS,
		shockwave: SHOCKWAVE,
		shock2Turns: SHOCK2_TURNS,
		// presentation only (preview rotation), never fed back into the sim
		turnAngle: math.atan2(TURN_SIN, TURN_COS),
		halfTurnAngle: math.atan2(HALF_TURN_SIN, HALF_TURN_COS),
		slots: { dirX: V_DIR_X, dirZ: V_DIR_Z, auxX: V_AUX_X, auxZ: V_AUX_Z, sign: V_SIGN, mark: V_MARK },
	},
};

/** The boss.act1 id and constants for the telegraph previews. */
export function bossAct1(): BossAct1View | undefined {
	return VIEW;
}

import {
	BOSS_DEMONLORD_ID,
	CHARGE_SHOCKWAVE,
	CLEAVE,
	DEMONLORD_SUMMON,
	DEMONLORD_TELEGRAPH_TICKS,
	DEMONLORD_V_AUX_X,
	DEMONLORD_V_AUX_Z,
	DEMONLORD_V_DIR_X,
	DEMONLORD_V_DIR_Z,
	DEMONLORD_V_MARK,
	DEMONLORD_V_SIGN,
	DOUBLE_CLEAVE_DELAY_TICKS,
	DOUBLE_CLEAVE_STEP,
	DemonlordAttack,
	DemonlordState,
	HELLFIRE_ARC,
} from "shared/sim";
import type { DemonlordConsts } from "shared/view";

/**
 * The boss.demonlord id and the constants his telegraph previews need (docs/BOSS_DEMONLORD.md D6), imported by name
 * from shared/sim like bossAct1.ts, so a rename in the boss module fails the build instead of silently turning
 * previews off.
 */
export interface DemonlordView {
	readonly id: string;
	readonly consts: DemonlordConsts;
}

const VIEW: DemonlordView = {
	id: BOSS_DEMONLORD_ID,
	consts: {
		attack: DemonlordAttack,
		state: { ACTIVE: DemonlordState.ACTIVE },
		telegraphTicks: DEMONLORD_TELEGRAPH_TICKS,
		cleave: CLEAVE,
		hellfireArc: HELLFIRE_ARC,
		shockwave: CHARGE_SHOCKWAVE,
		doubleCleaveDelayTicks: DOUBLE_CLEAVE_DELAY_TICKS,
		doubleCleaveStep: DOUBLE_CLEAVE_STEP,
		summon: { count: DEMONLORD_SUMMON.count, radius: DEMONLORD_SUMMON.radius },
		slots: {
			dirX: DEMONLORD_V_DIR_X,
			dirZ: DEMONLORD_V_DIR_Z,
			auxX: DEMONLORD_V_AUX_X,
			auxZ: DEMONLORD_V_AUX_Z,
			sign: DEMONLORD_V_SIGN,
			mark: DEMONLORD_V_MARK,
		},
	},
};

/** The boss.demonlord id and constants for the telegraph previews. */
export function demonlordView(): DemonlordView {
	return VIEW;
}

/**
 * 'boss.demonlord': the Demon Lord, the second endless boss (Roblox port, docs/BOSS_DEMONLORD.md D4; no web source).
 * A seeded pick puts him or Mother Mayhem ('boss.act1') on each endless boss floor (shared/dungeon bossKindFor); M1,
 * the fixtures and the tutorial keep Mother Mayhem. The display name is the theme string `boss.demonlord.name`, the
 * sprite the logical ID `boss.demonlord`. Band PORT_BAND_BOSSES (registry.ts): index 8, after every web and tutorial
 * archetype.
 *
 * The HUNTER to Mother Mayhem's turret: she holds the room's centre and fills it with patterns, he walks at the player
 * and punishes standing next to him, with a gapped ring at range. Same budget as Mayhem (BOSS_HP 270 hp, damage cap
 * 6/s: TTK >= 45 s; phases at 66 % / 33 %), on the same fight skeleton (./shared.ts: wake / seal, phase floor, immune roars
 * that clear his bullets, recover, reposition, DEBUG_BOSS, adds wither on his death).
 *
 * Fight flow (ActorState.aiState, DemonlordState; the skeleton's states plus CHASE):
 *   DORMANT     immune on the boss room's center until a player is well inside -> bossEngaged, phase 1
 *   TRANSITION  attack = ROAR, immune, own bullets cleared: the intro (phase 1, introTicks; animation `intro`) and each
 *               phase change (phase 2 / 3, transitionTicks; animation `taunt`). Tell them apart by ActorState.phase.
 *   CHASE       attack = CLEAVE or DOUBLE_CLEAVE (the one coming): walks at the bound player (data.chaseSpeed, plain
 *               mover) until within data.cleaveRange or data.chaseTicks run out (aiTicks counts down), then its
 *               TELEGRAPH. A cleave picked while already in range skips the chase. Animation `move`.
 *   TELEGRAPH   ctx.telegraph(a, DEMONLORD_TELEGRAPH_TICKS[attack] >= 30, attack): standing still, every direction
 *               locked in v[] (the view previews exactly where the bullets will go).
 *   ACTIVE      the attack plays out (aiTicks counts up from 0 = the first ACTIVE tick).
 *   RECOVER     standing still, vulnerable (recoverTicks[phase]; chargeRecoverTicks after a charge). Animation `idle`.
 *   REPOSITION  walks back toward the room center when farther than homeRadius from it. Animation `move`.
 *
 * Attacks (ActorState.attack, DemonlordAttack; phase tables DEMONLORD_PHASE_ATTACKS / DEMONLORD_PHASE_FIRST_ATTACK):
 *   CLEAVE         phases 1-2. CHASE, then one fast short arc (CLEAVE: 7 bullets over CLEAVE_SPREAD) along v[DIR]
 *                  on ACTIVE tick 0; ends CLEAVE_HOLD_TICKS later.
 *   HELLFIRE       phases 1-2. A slow ring with 3 gaps: three HELLFIRE_ARC arcs centred 60 / 180 / 300 degrees off
 *                  v[DIR], so the gaps sit on v[DIR] (toward the player, turned up to HELLFIRE_MAX_TURNS TURN steps)
 *                  and +-120 degrees from it. Fired on ACTIVE tick 0; ends HELLFIRE_HOLD_TICKS later.
 *   DOUBLE_CLEAVE  phase 3. CHASE, then a CLEAVE arc along v[DIR] (tick 0), a lunge of DOUBLE_CLEAVE_STEP world units
 *                  along v[DIR] over ticks 1..DOUBLE_CLEAVE_DELAY_TICKS, and a second CLEAVE arc along v[AUX] (v[DIR]
 *                  turned by half a lane, side v[SIGN]) from where the lunge stopped, on tick DOUBLE_CLEAVE_DELAY_TICKS.
 *   CHARGE         phases 2-3 (BRIMSTONE CHARGE). Target point v[AUX] = the player's position at the telegraph, kept
 *                  inside the arena; charges at CHARGE_SPEED (plain mover, stops dead at a wall, at most
 *                  CHARGE_MAX_TICKS); on IMPACT v[MARK] = (ACTIVE tick of impact) + 1 and a CHARGE_SHOCKWAVE ring
 *                  fires, arc centred on v[DIR] (its gap points back the way he came), and breakables in the slam
 *                  radius break. v[MARK] is 0 until the impact tick: the impact tick is the tick it turns non-zero
 *                  (the fx cue keys on it, like Mother Mayhem's slam). Ends CHARGE_IMPACT_HOLD_TICKS after impact.
 *   SUMMON         phase 3 (first of phase 3). On ACTIVE tick 0: up to SUMMON_COUNT swarmers (Mayhem's cap
 *                  DEMONLORD_SUMMON: at most SUMMON_MAX_ALIVE alive in the arena, never past MAX_ACTORS) when v[SIGN]
 *                  = 1; v[SIGN] = 0 (no 'swarmer' archetype, or the cap was already reached at the telegraph), or no
 *                  add spawned (the pool filled up meanwhile): a HELLFIRE ring along v[DIR] instead. Ends
 *                  SUMMON_HOLD_TICKS later. Animation `intro` (the mace raised).
 *   ROAR           not an attack: the intro / transition roar (see TRANSITION).
 * Never the same attack more than BOSS_MAX_REPEAT times in a row; each phase's first attack is its new one.
 *
 * v[] slots (DEMONLORD_V_*):
 *   0, 1  DIR   the attack's locked heading (unit): cleave arc centre, hellfire's facing gap, charge direction, summon /
 *               fallback ring heading. Set when the TELEGRAPH starts.
 *   2, 3  AUX   CHARGE: the target point (world x, z). DOUBLE_CLEAVE: the second arc's heading (unit). Else unused.
 *   4     MARK  CHARGE: impact ACTIVE tick + 1, 0 before the impact (the skeleton also zeroes it on a transition).
 *   5, 6  the skeleton's repeat rule (last attack, times in a row).
 *   7     SIGN  DOUBLE_CLEAVE: +1 / -1, the side the second arc is turned to. SUMMON: 1 summons, 0 the ring fallback.
 *
 * Deterministic: all state in ActorState, randomness via ctx.random*, unit vectors turned by exact (cos, sin) pairs (no
 * trig; the cleave's half-lane turn is the half-angle of the cleave shape's own lane, from the arc table). Burst shapes
 * CLEAVE and HELLFIRE_ARC are port shapes (../../../arcTablePort.ts); CHARGE_SHOCKWAVE reuses Mother Mayhem's
 * shockwave shape (26 bullets, FULL_RING - 1).
 */

import { SIM_DT } from "../../../../units";
import { TURN_COS, TURN_SIN } from "../../../combatData";
import type { SimCtx } from "../../../ctx";
import { BulletKind, FULL_RING, aimAt, halfRotation, rotateDir, type BurstSpec, type Dir } from "../../../patterns";
import { arcTrig } from "../../../projectilePatterns";
import { HIT_HEAVY, HIT_NORMAL, secondsToTicks } from "../../../../playerData";
import type { EncounterRoom } from "../../encounter";
import { faceToward, moveActor, toPlayer, walkToward } from "../../helpers";
import { hasArchetype, registerArchetype, PORT_BAND_BOSSES } from "../../registry";
import type { ActorState } from "../../types";
import { slamBreakables } from "../../../../breakables/breakables";
import {
	BOSS_CUSTOM_STATE,
	BOSS_HP,
	BOSS_NO_ATTACK,
	BOSS_PLAYER_DEAD_WAIT_TICKS,
	BOSS_V_LAST,
	BOSS_V_MARK,
	BOSS_V_REPEAT,
	BossFightState,
	bossRecover,
	filterBossDamage,
	initBossFight,
	noteBossAttack,
	onBossDeath,
	onBossHit,
	pickBossAttack,
	stepBossFight,
	summonAdds,
	summonedAlive,
	type BossFightData,
	type BossFightHooks,
	type BossFightSpec,
	type BossSummonSpec,
} from "./shared";

export const BOSS_DEMONLORD_ID = "boss.demonlord";

// ---------------------------------------------------------------------------------------------
// States, attacks, scratch slots

/** aiState values: the skeleton's (./shared.ts BossFightState) plus CHASE. */
export const DemonlordState = {
	TELEGRAPH: BossFightState.TELEGRAPH,
	DORMANT: BossFightState.DORMANT,
	ACTIVE: BossFightState.ACTIVE,
	RECOVER: BossFightState.RECOVER,
	TRANSITION: BossFightState.TRANSITION,
	REPOSITION: BossFightState.REPOSITION,
	/** Walking at the player before a cleave (attack = the cleave coming). */
	CHASE: BOSS_CUSTOM_STATE,
} as const;

/** ActorState.attack values (render, audio and telemetry read them). */
export const DemonlordAttack = {
	NONE: BOSS_NO_ATTACK,
	/** Chase, then a fast short 7-way arc. Phases 1-2. */
	CLEAVE: 1,
	/** Slow ring with 3 gaps, one facing the player. Phases 1-2. */
	HELLFIRE: 2,
	/** Chase, then two arcs (the second half a lane off) with a lunge between them. Phase 3. */
	DOUBLE_CLEAVE: 3,
	/** Brimstone charge: to the player's position, shockwave ring with a gap on impact. Phases 2-3. */
	CHARGE: 4,
	/** Raises 3 swarmers (fallback: a HELLFIRE ring). Phase 3. */
	SUMMON: 5,
	/** Not an attack: the intro roar (phase 1) and the phase-change taunt (phases 2-3); immune. */
	ROAR: 6,
} as const;

/** Attack names (telemetry; audio cue suffixes `sfx.boss.<name>` where the theme has them). Index = attack id. */
export const DEMONLORD_ATTACK_NAMES: ReadonlyArray<string> = [
	"none",
	"cleave",
	"hellfire",
	"doubleCleave",
	"charge",
	"summon",
	"roar",
];

/** Wind-up per attack, ticks (index = attack id). GDD: every attack telegraphs >= 0.5 s (30 ticks). */
export const DEMONLORD_TELEGRAPH_TICKS: ReadonlyArray<number> = [
	0,
	secondsToTicks(0.6), // CLEAVE 36
	secondsToTicks(0.7), // HELLFIRE 42
	secondsToTicks(0.6), // DOUBLE_CLEAVE 36
	secondsToTicks(0.9), // CHARGE 54
	secondsToTicks(0.8), // SUMMON 48
	0,
];

/** The attacks each phase draws from (index = phase). */
export const DEMONLORD_PHASE_ATTACKS: ReadonlyArray<ReadonlyArray<number>> = [
	[],
	[DemonlordAttack.CLEAVE, DemonlordAttack.HELLFIRE],
	[DemonlordAttack.CLEAVE, DemonlordAttack.HELLFIRE, DemonlordAttack.CHARGE],
	[DemonlordAttack.DOUBLE_CLEAVE, DemonlordAttack.CHARGE, DemonlordAttack.SUMMON],
];
/** The first attack of each phase (after the intro / taunt): the phase's new pattern. */
export const DEMONLORD_PHASE_FIRST_ATTACK: ReadonlyArray<number> = [
	0,
	DemonlordAttack.CLEAVE,
	DemonlordAttack.CHARGE,
	DemonlordAttack.SUMMON,
];

/** v[] slots (see the file comment). */
export const DEMONLORD_V_DIR_X = 0;
export const DEMONLORD_V_DIR_Z = 1;
export const DEMONLORD_V_AUX_X = 2;
export const DEMONLORD_V_AUX_Z = 3;
export const DEMONLORD_V_MARK = BOSS_V_MARK;
export const DEMONLORD_V_LAST = BOSS_V_LAST;
export const DEMONLORD_V_REPEAT = BOSS_V_REPEAT;
export const DEMONLORD_V_SIGN = 7;
// ActorState.cooldown holds the attack forced next (the phase's first attack after a roar), 0 = pick one.

// ---------------------------------------------------------------------------------------------
// Patterns (gameplay data; rule 4: numbers here, never in art)

const DAMAGE = HIT_NORMAL;
const KIND = BulletKind.BOSS;

/** Cleave arc width, radians edge to edge (7 bullets: 0.4 rad, ~23 degree lanes; ~138 degrees in all). */
export const CLEAVE_SPREAD = 2.4;
/** Fast and short-lived: reach = radius + speed x life = 0.5 + 11 x 0.36 ~ 4.5 world units from his centre. */
export const CLEAVE: BurstSpec = {
	count: 7,
	spread: CLEAVE_SPREAD,
	speed: 11,
	life: 0.36,
	damage: DAMAGE,
	kind: KIND,
	radius: 0.5,
};
/** ACTIVE ticks after a cleave's arc (the swing's follow-through, standing still). */
export const CLEAVE_HOLD_TICKS = 15;
/** Double cleave: ticks between the two arcs (the lunge), and how far the lunge goes (world units). */
export const DOUBLE_CLEAVE_DELAY_TICKS = 14;
export const DOUBLE_CLEAVE_STEP = 1.2;

/** Width of each hellfire gap, radians between the gap's two edge bullets (~57 degrees). */
export const HELLFIRE_GAP = 1.0;
/** One of the ring's three arcs: 8 bullets over a third of the ring minus a gap. */
export const HELLFIRE_ARC: BurstSpec = {
	count: 8,
	spread: FULL_RING / 3 - HELLFIRE_GAP,
	speed: 3.4,
	life: 5,
	damage: DAMAGE,
	kind: KIND,
};
/** The facing gap is turned off the player's side by up to this many TURN steps (14.25 degrees each), at random. */
export const HELLFIRE_MAX_TURNS = 1;
export const HELLFIRE_HOLD_TICKS = 20;

/** Charge shockwave gap, radians (~57 degrees), pointing back the way he charged from. Mother Mayhem's shape. */
export const CHARGE_SHOCK_GAP = 1.0;
export const CHARGE_SHOCKWAVE: BurstSpec = {
	count: 26,
	spread: FULL_RING - CHARGE_SHOCK_GAP,
	speed: 5,
	life: 3.2,
	damage: DAMAGE,
	kind: KIND,
};
/** Charge speed, world units per second, and the longest charge (ACTIVE ticks). */
export const CHARGE_SPEED = 14;
export const CHARGE_MAX_TICKS = 45;
/** ACTIVE ticks after the impact before RECOVER. */
export const CHARGE_IMPACT_HOLD_TICKS = 18;

/**
 * Adds: Mother Mayhem's swarmers and cap. He summons wherever the hunt took him, so the cap counts the arena grown by
 * the push radius (an add pushed out through a doorway still counts).
 */
export const DEMONLORD_SUMMON: BossSummonSpec = {
	kind: "swarmer",
	count: 3,
	maxAlive: 3,
	radius: 2.2,
	arenaMargin: 2.2,
};
export const SUMMON_HOLD_TICKS = 30;

/** The charge target is kept this far (plus his radius) inside the arena's bounds. */
const CHARGE_TARGET_MARGIN = 0.4;
/** Charge impact: within one step (plus this slack) of the target. */
const CHARGE_ARRIVE_EPS = 1e-9;
/** Charge impact: a step shorter than this (squared) means a wall stopped him. */
const CHARGE_STUCK2 = 1e-8;
const COIN = 0.5;

// Exact rotations (no trig): 60 degrees (the hellfire arcs), half a cleave lane (the double cleave's second arc).
const COS60 = 0.5;
const SIN60 = math.sqrt(3) / 2;
/** The cleave's lane: the angle between neighbouring bullets of CLEAVE = gen.arc's angle of bullet (count + 1) / 2. */
const CLEAVE_LANE_COS = arcTrig(CLEAVE.count, CLEAVE.spread).cos[(CLEAVE.count + 1) / 2];
const HALF_LANE = halfRotation(CLEAVE_LANE_COS, { x: 0, z: 0 });
export const HALF_LANE_COS = HALF_LANE.x;
export const HALF_LANE_SIN = HALF_LANE.z;

export interface DemonlordData extends BossFightData {
	/** Vulnerable stand-still after a charge, ticks. */
	chargeRecoverTicks: number;
	/** CHASE: walk speed (world units per second), longest chase (ticks), and the distance that ends it. */
	chaseSpeed: number;
	chaseTicks: number;
	cleaveRange: number;
}

export const DEMONLORD_DATA: DemonlordData = {
	// Mother Mayhem's budget (her README "Time to kill"; BOSS_HP, half the web build's 540): hp / cap = 45 s plus the
	// immune roars is the flawless floor.
	hp: BOSS_HP,
	radius: 1.2,
	speed: 3,
	contactDamage: HIT_HEAVY,
	spriteId: "boss.demonlord",
	spriteScale: 1.25,
	boss: true,
	damageCapPerSecond: 6,
	corpseTicks: secondsToTicks(1.5),
	phaseHp: [0.66, 0.33],
	introTicks: secondsToTicks(1),
	transitionTicks: secondsToTicks(1.5),
	recoverTicks: [0, secondsToTicks(1), secondsToTicks(0.9), secondsToTicks(0.8)],
	engageInset: 1.5,
	// A hunter: he follows the player around the arena and only walks home when he has strayed far.
	homeRadius: 7,
	debugDamage: 0.1,
	chargeRecoverTicks: secondsToTicks(1.2),
	chaseSpeed: 4.2,
	chaseTicks: secondsToTicks(1.2),
	cleaveRange: 3,
};

// ---------------------------------------------------------------------------------------------
// Helpers

const dirScratch: Dir = { x: 0, z: 1 };

function clamp(v: number, lo: number, hi: number): number {
	return v < lo ? lo : v > hi ? hi : v;
}

/** (x, z) turned by `steps` TURN steps (sign = direction) into `out`. */
function turnSteps(x: number, z: number, steps: number, out: Dir): Dir {
	out.x = x;
	out.z = z;
	const n = steps < 0 ? -steps : steps;
	const s = steps < 0 ? -TURN_SIN : TURN_SIN;
	for (let i = 0; i < n; i++) rotateDir(out.x, out.z, TURN_COS, s, out);
	return out;
}

function isCleave(attack: number): boolean {
	return attack === DemonlordAttack.CLEAVE || attack === DemonlordAttack.DOUBLE_CLEAVE;
}

/** The hellfire ring: three arcs centred 60, 180 and 300 degrees off (dx, dz), so the gaps sit on (dx, dz) and +-120. */
function fireHellfire(ctx: SimCtx, a: ActorState, dx: number, dz: number): void {
	rotateDir(dx, dz, COS60, SIN60, dirScratch);
	ctx.fireEnemy(a, dirScratch.x, dirScratch.z, HELLFIRE_ARC);
	ctx.fireEnemy(a, -dx, -dz, HELLFIRE_ARC);
	rotateDir(dx, dz, COS60, -SIN60, dirScratch);
	ctx.fireEnemy(a, dirScratch.x, dirScratch.z, HELLFIRE_ARC);
}

/** Locks the attack's directions into v[] and starts its telegraph. */
function startTelegraph(ctx: SimCtx, a: ActorState, room: EncounterRoom | undefined, attack: number): void {
	const tp = toPlayer(ctx, a);
	let dx = tp.dirX;
	let dz = tp.dirZ;
	a.v[DEMONLORD_V_MARK] = 0;
	a.v[DEMONLORD_V_SIGN] = 1;
	switch (attack) {
		case DemonlordAttack.CLEAVE:
			break;
		case DemonlordAttack.DOUBLE_CLEAVE: {
			const sign = ctx.random() < COIN ? -1 : 1;
			a.v[DEMONLORD_V_SIGN] = sign;
			rotateDir(dx, dz, HALF_LANE_COS, sign * HALF_LANE_SIN, dirScratch);
			a.v[DEMONLORD_V_AUX_X] = dirScratch.x;
			a.v[DEMONLORD_V_AUX_Z] = dirScratch.z;
			break;
		}
		case DemonlordAttack.HELLFIRE:
			// The facing gap is on the player's side, turned a little so it is not always dead centre.
			turnSteps(dx, dz, ctx.randomInt(-HELLFIRE_MAX_TURNS, HELLFIRE_MAX_TURNS), dirScratch);
			dx = dirScratch.x;
			dz = dirScratch.z;
			break;
		case DemonlordAttack.CHARGE: {
			// Target: the player's position now, kept inside the arena so the body fits.
			let tx = ctx.player.x;
			let tz = ctx.player.z;
			if (room !== undefined) {
				const m = a.radius + CHARGE_TARGET_MARGIN;
				tx = clamp(tx, room.minX + m, room.maxX - m);
				tz = clamp(tz, room.minZ + m, room.maxZ - m);
			}
			a.v[DEMONLORD_V_AUX_X] = tx;
			a.v[DEMONLORD_V_AUX_Z] = tz;
			aimAt(a.x, a.z, tx, tz, dirScratch, dx, dz);
			dx = dirScratch.x;
			dz = dirScratch.z;
			break;
		}
		case DemonlordAttack.SUMMON:
			a.v[DEMONLORD_V_SIGN] =
				hasArchetype(DEMONLORD_SUMMON.kind) &&
				summonedAlive(ctx, a, DEMONLORD_SUMMON) < DEMONLORD_SUMMON.maxAlive
					? 1
					: 0;
			break;
	}
	a.v[DEMONLORD_V_DIR_X] = dx;
	a.v[DEMONLORD_V_DIR_Z] = dz;
	faceToward(a, dx, dz);
	ctx.telegraph(a, DEMONLORD_TELEGRAPH_TICKS[attack], attack);
}

/** One tick of the running attack; `t` = ticks since its first ACTIVE tick. Returns true when it is over. */
function runAttack(ctx: SimCtx, a: ActorState, t: number): boolean {
	switch (a.attack) {
		case DemonlordAttack.CLEAVE:
			if (t === 0) ctx.fireEnemy(a, a.v[DEMONLORD_V_DIR_X], a.v[DEMONLORD_V_DIR_Z], CLEAVE);
			return t >= CLEAVE_HOLD_TICKS;
		case DemonlordAttack.DOUBLE_CLEAVE: {
			if (t === 0) ctx.fireEnemy(a, a.v[DEMONLORD_V_DIR_X], a.v[DEMONLORD_V_DIR_Z], CLEAVE);
			else if (t <= DOUBLE_CLEAVE_DELAY_TICKS) {
				// The lunge (plain mover: walls stop it), facing kept.
				const k = DOUBLE_CLEAVE_STEP / DOUBLE_CLEAVE_DELAY_TICKS;
				moveActor(ctx, a, a.v[DEMONLORD_V_DIR_X] * k, a.v[DEMONLORD_V_DIR_Z] * k);
			}
			if (t === DOUBLE_CLEAVE_DELAY_TICKS) {
				ctx.fireEnemy(a, a.v[DEMONLORD_V_AUX_X], a.v[DEMONLORD_V_AUX_Z], CLEAVE);
			}
			return t >= DOUBLE_CLEAVE_DELAY_TICKS + CLEAVE_HOLD_TICKS;
		}
		case DemonlordAttack.HELLFIRE:
			if (t === 0) fireHellfire(ctx, a, a.v[DEMONLORD_V_DIR_X], a.v[DEMONLORD_V_DIR_Z]);
			return t >= HELLFIRE_HOLD_TICKS;
		case DemonlordAttack.CHARGE: {
			if (a.v[DEMONLORD_V_MARK] === 0) {
				// Charging (contact damage is HIT_HEAVY, generic). The plain mover: the charge stops dead at a wall.
				const stepLen = CHARGE_SPEED * SIM_DT;
				const x0 = a.x;
				const z0 = a.z;
				const left = walkToward(ctx, a, a.v[DEMONLORD_V_AUX_X], a.v[DEMONLORD_V_AUX_Z], stepLen, false);
				const mx = a.x - x0;
				const mz = a.z - z0;
				if (left <= stepLen + CHARGE_ARRIVE_EPS || t >= CHARGE_MAX_TICKS || mx * mx + mz * mz < CHARGE_STUCK2) {
					a.v[DEMONLORD_V_MARK] = t + 1;
					// Impact: the shockwave's arc is centred on the charge direction, so its gap points back.
					ctx.fireEnemy(a, a.v[DEMONLORD_V_DIR_X], a.v[DEMONLORD_V_DIR_Z], CHARGE_SHOCKWAVE);
					if (ctx.state.breakables !== undefined) slamBreakables(ctx.state, a.x, a.z);
				}
				return false;
			}
			return t + 1 - a.v[DEMONLORD_V_MARK] >= CHARGE_IMPACT_HOLD_TICKS;
		}
		case DemonlordAttack.SUMMON:
			if (t === 0) {
				const dx = a.v[DEMONLORD_V_DIR_X];
				const dz = a.v[DEMONLORD_V_DIR_Z];
				const n = a.v[DEMONLORD_V_SIGN] === 1 ? summonAdds(ctx, a, DEMONLORD_SUMMON, dx, dz) : 0;
				if (n === 0) {
					a.v[DEMONLORD_V_SIGN] = 0;
					fireHellfire(ctx, a, dx, dz);
				}
			}
			return t >= SUMMON_HOLD_TICKS;
		default:
			return true;
	}
}

/** CHASE: walk at the bound player until within range or out of time, then the cleave's telegraph. */
function stepChase(ctx: SimCtx, a: ActorState, d: DemonlordData, room: EncounterRoom | undefined): void {
	if (ctx.player.dead !== 0) {
		bossRecover(a, d, BOSS_PLAYER_DEAD_WAIT_TICKS);
		return;
	}
	const tp = toPlayer(ctx, a);
	if (tp.dist > d.cleaveRange && a.aiTicks > 0) {
		walkToward(ctx, a, ctx.player.x, ctx.player.z, d.chaseSpeed * SIM_DT, false);
		a.aiTicks -= 1;
		return;
	}
	startTelegraph(ctx, a, room, a.attack);
}

// ---------------------------------------------------------------------------------------------
// The archetype

const SPEC: BossFightSpec = { phaseFirstAttack: DEMONLORD_PHASE_FIRST_ATTACK, roarAttack: DemonlordAttack.ROAR };

const HOOKS: BossFightHooks<DemonlordData> = {
	spec: SPEC,
	startNext(ctx, a, d, room) {
		const attack = pickBossAttack(ctx, a, DEMONLORD_PHASE_ATTACKS[a.phase] ?? DEMONLORD_PHASE_ATTACKS[1]);
		noteBossAttack(a, attack);
		if (isCleave(attack) && toPlayer(ctx, a).dist > d.cleaveRange) {
			a.aiState = DemonlordState.CHASE;
			a.aiTicks = d.chaseTicks;
			a.attack = attack;
			a.v[DEMONLORD_V_MARK] = 0;
			return;
		}
		startTelegraph(ctx, a, room, attack);
	},
	runAttack(ctx, a, _d, t) {
		return runAttack(ctx, a, t);
	},
	recoverAfter(d, attack) {
		return attack === DemonlordAttack.CHARGE ? d.chargeRecoverTicks : undefined;
	},
	stepOwnState(ctx, a, d, room) {
		if (a.aiState !== DemonlordState.CHASE) return false;
		stepChase(ctx, a, d, room);
		return true;
	},
};

export const BOSS_DEMONLORD = registerArchetype<DemonlordData>({
	id: BOSS_DEMONLORD_ID,
	data: DEMONLORD_DATA,
	band: PORT_BAND_BOSSES,

	init(_ctx, a) {
		initBossFight(a);
	},

	step(ctx, a) {
		stepBossFight(ctx, a, HOOKS);
	},

	filterDamage(ctx, a, damage) {
		return filterBossDamage(ctx, a, damage);
	},

	onHit(ctx, a) {
		onBossHit(ctx, a, SPEC);
	},

	onDeath(ctx, a) {
		// His summons fall with him.
		onBossDeath(ctx, a);
	},
});

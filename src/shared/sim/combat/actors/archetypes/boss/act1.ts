/**
 * 'boss.act1': the Act I boss (E1.8, M1 "First fight"; source: `src/sim/actors/archetypes/boss/act1.ts`). GDD
 * placeholder: "Mother Mayhem", a burned-forest bramble mother; the display name is the theme string
 * `boss.act1.name`, the sprite the logical ID `boss.act1`. Design, attack table, telegraph lengths and the time-to-kill
 * math: the source's README.md in that folder.
 *
 * Fight flow (ActorState.aiState):
 *   DORMANT     on the boss room's center tile, immune, until the player is well inside the room
 *               -> events.bossEngaged = 1, phase 1 (events.bossPhase = 1), the arena seals (see sealArena)
 *   TRANSITION  roar: immune, own bullets cleared, ROAR "attack" (intro 1 s, phase changes 1.5 s)
 *   TELEGRAPH   ctx.telegraph(a, ticks >= 30, attack): standing still, directions locked in v[] (render previews them)
 *   ACTIVE      the attack plays out (aiTicks counts up from 0 = the first bullet)
 *   RECOVER     standing still and vulnerable (0.8-1 s, 1.2 s after a slam): the melee opening
 *   REPOSITION  walks back toward the room center when a slam left it far away, then the next telegraph
 * Phases change at 66% and 33% hp. Damage never skips a phase: it stops at the threshold, the transition plays
 * (immune), then the next phase's NEW attack is always the first one shown.
 *
 * Deterministic: all state is in ActorState (fields + v[]), randomness via ctx.random*, directions are unit vectors
 * turned by exact (cos, sin) pairs (TURN_COS / TURN_SIN and their sqrt half-angles), no trig.
 *
 * Roblox port (docs/BOSS_DEMONLORD.md D3): the fight skeleton (wake / seal, phase floor, transitions, recover,
 * reposition, summons, DEBUG_BOSS, the damage filter, the adds withering) lives in ./shared.ts, shared with
 * 'boss.demonlord'; this file keeps Mother Mayhem's attacks and every export it had. Same code, same order: the
 * golden boss runs match bit for bit.
 */

import { SIM_DT } from "../../../../units";
import { TURN_COS, TURN_SIN } from "../../../combatData";
import type { SimCtx } from "../../../ctx";
import { BulletKind, FULL_RING, aimAt, halfRotation, rotateDir, type BurstSpec, type Dir } from "../../../patterns";
import { HIT_HEAVY, HIT_NORMAL, secondsToTicks } from "../../../../playerData";
import type { EncounterRoom } from "../../encounter";
import { faceToward, toPlayer, walkToward } from "../../helpers";
import { hasArchetype, registerArchetype } from "../../registry";
import type { ActorState } from "../../types";
import { slamBreakables } from "../../../../breakables/breakables";
import {
	BOSS_HP,
	BOSS_ENGAGE_RANGE_NO_ROOM,
	BOSS_MAX_REPEAT,
	BOSS_V_LAST,
	BOSS_V_MARK,
	BOSS_V_REPEAT,
	BossFightState,
	filterBossDamage,
	initBossFight,
	noteBossAttack,
	onBossDeath,
	onBossHit,
	pickBossAttack,
	stepBossFight,
	summonAdds,
	type BossFightData,
	type BossFightHooks,
	type BossFightSpec,
	type BossSummonSpec,
} from "./shared";

export const BOSS_ACT1_ID = "boss.act1";

// ---------------------------------------------------------------------------------------------
// States, attacks, scratch slots

/** aiState values (AiState.TELEGRAPH = 1 is the shared wind-up state; the rest are this boss's own). */
export const BossState = BossFightState;

/** ActorState.attack values (render, audio and telemetry read them). */
export const BossAttack = {
	NONE: 0,
	/** (a) aimed 5-way fan, 3 volleys. Phases 1-2. */
	FAN: 1,
	/** (b) slow ring with 2 gaps. Phase 1. */
	RING: 2,
	/** (b') remix: two rings, the second one's gaps turned. Phases 2-3. */
	DOUBLE_RING: 3,
	/** (c) rotating 3-arm spiral for 3 s. Phases 2-3. */
	SPIRAL: 4,
	/** (d) charge to the player's position, shockwave ring with a gap; summons swarmers (fallback: a second ring). Phase 3. */
	SLAM: 5,
	/** (a') remix: faster fans, 4 volleys, alternate volleys offset by half a lane. Phase 3. */
	FAST_FAN: 6,
	/** Not an attack: the roar of the intro and of each phase transition (immune). */
	ROAR: 7,
} as const;

/** Attack names (audio cue ids: `sfx.boss.<name>`; ROAR uses the existing `sfx.boss.roar`). Index = attack id. */
export const BOSS_ATTACK_NAMES: ReadonlyArray<string> = [
	"none",
	"fan",
	"ring",
	"doubleRing",
	"spiral",
	"slam",
	"fastFan",
	"roar",
];

/** Wind-up per attack, ticks (index = attack id). GDD: every attack telegraphs >= 0.5 s (30 ticks). */
export const BOSS_TELEGRAPH_TICKS: ReadonlyArray<number> = [
	0,
	secondsToTicks(0.6), // FAN 36
	secondsToTicks(0.7), // RING 42
	secondsToTicks(0.8), // DOUBLE_RING 48
	secondsToTicks(0.8), // SPIRAL 48
	secondsToTicks(0.9), // SLAM 54
	secondsToTicks(0.55), // FAST_FAN 33
	0,
];

/** The attacks each phase draws from (index = phase). Each phase adds one pattern and remixes an old one. */
export const PHASE_ATTACKS: ReadonlyArray<ReadonlyArray<number>> = [
	[],
	[BossAttack.FAN, BossAttack.RING],
	[BossAttack.FAN, BossAttack.DOUBLE_RING, BossAttack.SPIRAL],
	[BossAttack.FAST_FAN, BossAttack.DOUBLE_RING, BossAttack.SPIRAL, BossAttack.SLAM],
];
/** The first attack of each phase (after the intro / transition roar): the phase's new pattern. */
export const PHASE_FIRST_ATTACK: ReadonlyArray<number> = [0, BossAttack.FAN, BossAttack.SPIRAL, BossAttack.SLAM];
/** Never the same attack more than this many times in a row. */
export const MAX_REPEAT = BOSS_MAX_REPEAT;

/** v[] slots. DIR = the attack's locked heading; AUX = second heading (double ring, spiral) or slam target point. */
export const V_DIR_X = 0;
export const V_DIR_Z = 1;
export const V_AUX_X = 2;
export const V_AUX_Z = 3;
/** Slam: tick of impact + 1 (0 while charging). The skeleton zeroes it when a transition starts. */
export const V_MARK = BOSS_V_MARK;
/** Last attack started, and how many times in a row (the skeleton's repeat rule). */
export const V_LAST = BOSS_V_LAST;
export const V_REPEAT = BOSS_V_REPEAT;
/** Fast fan / spiral: turn sign (+1 / -1). Slam: 1 = summons after impact, 0 = a second shockwave instead. */
export const V_SIGN = 7;
// ActorState.cooldown holds the attack forced next (the phase's first attack after a roar), 0 = pick one.

// ---------------------------------------------------------------------------------------------
// Patterns (gameplay data; rule 4: numbers here, never in art)

const BOSS_DAMAGE = HIT_NORMAL;
const BOSS_KIND = BulletKind.BOSS;

/** Fan width, radians edge to edge (5 bullets: 0.25 rad lanes). */
export const FAN_SPREAD = 1.0;
export const FAN: BurstSpec = {
	count: 5,
	spread: FAN_SPREAD,
	speed: 6.5,
	life: 2.5,
	damage: BOSS_DAMAGE,
	kind: BOSS_KIND,
};
export const FAN_VOLLEYS = 3;
export const FAN_VOLLEY_TICKS = 12;
export const FAST_FAN: BurstSpec = {
	count: 5,
	spread: FAN_SPREAD,
	speed: 9.5,
	life: 1.8,
	damage: BOSS_DAMAGE,
	kind: BOSS_KIND,
};
export const FAST_FAN_VOLLEYS = 4;
export const FAST_FAN_VOLLEY_TICKS = 8;

/** Width of each ring gap, radians between the gap's two edge bullets (~52 degrees). */
export const RING_GAP = 0.9;
/** A 2-gap ring is two arcs, centered on dir and -dir, each PI - RING_GAP wide: the gaps sit at +-90 degrees. */
export const RING_ARC: BurstSpec = {
	count: 14,
	spread: math.pi - RING_GAP,
	speed: 3.2,
	life: 5,
	damage: BOSS_DAMAGE,
	kind: BOSS_KIND,
};
/** The ring's gaps are turned off the player's side by up to this many TURN steps (14.25 degrees each), at random. */
export const RING_MAX_TURNS = 3;
export const DOUBLE_RING_ARC: BurstSpec = {
	count: 14,
	spread: math.pi - RING_GAP,
	speed: 3.6,
	life: 4.5,
	damage: BOSS_DAMAGE,
	kind: BOSS_KIND,
};
export const DOUBLE_RING_DELAY_TICKS = 48;
/** The second ring's gaps are turned by this many TURN steps (~43 degrees), direction at random: weave. */
export const DOUBLE_RING_TURNS = 3;

export const SPIRAL_ARMS: BurstSpec = {
	count: 3,
	spread: FULL_RING,
	speed: 4,
	life: 4.5,
	damage: BOSS_DAMAGE,
	kind: BOSS_KIND,
};
export const SPIRAL_TICKS = secondsToTicks(3); // 180
export const SPIRAL_BURST_TICKS = 6;

/** Shockwave gap, radians between the edge bullets (~57 degrees), pointing back the way the boss charged from. */
export const SHOCK_GAP = 1.0;
export const SHOCKWAVE: BurstSpec = {
	count: 26,
	spread: FULL_RING - SHOCK_GAP,
	speed: 4.5,
	life: 3.5,
	damage: BOSS_DAMAGE,
	kind: BOSS_KIND,
};
/** Fallback when no 'swarmer' archetype is registered: a second, slower shockwave, gap turned by 2 TURN steps. */
export const SHOCKWAVE_2: BurstSpec = {
	count: 26,
	spread: FULL_RING - SHOCK_GAP,
	speed: 3.8,
	life: 3.5,
	damage: BOSS_DAMAGE,
	kind: BOSS_KIND,
};
export const SHOCK2_TURNS = 2;
export const SHOCK2_DELAY_TICKS = 24;
/** Charge speed, world units per second, and the longest charge. */
export const SLAM_SPEED = 15;
export const SLAM_MAX_TICKS = 45;
/** Adds after a slam when the archetype exists (the E1.8 swarmer), at most this many alive. */
export const SUMMON_KIND = "swarmer";
export const SUMMON_COUNT = 3;
export const SUMMON_MAX_ALIVE = 3;
export const SUMMON_RADIUS = 2.2;

/** Without encounter rooms (unit tests), the boss wakes when the player comes this close. */
export const ENGAGE_RANGE_NO_ROOM = BOSS_ENGAGE_RANGE_NO_ROOM;
const SUMMON: BossSummonSpec = {
	kind: SUMMON_KIND,
	count: SUMMON_COUNT,
	maxAlive: SUMMON_MAX_ALIVE,
	radius: SUMMON_RADIUS,
};
/** The slam target is kept this far (plus the boss radius) inside the arena's bounds. */
const SLAM_TARGET_MARGIN = 0.4;
/** Slam impact: within one step (plus this slack) of the target. */
const SLAM_ARRIVE_EPS = 1e-9;
/** Slam impact: a charge step shorter than this (squared) means a wall stopped it. */
const SLAM_STUCK2 = 1e-8;
/** Coin flip for turn signs. */
const COIN = 0.5;

// Exact rotations (no trig): half a TURN (~7.1 degrees: spiral step and fast-fan lane offset), 60 and 120 degrees.
const HALF_TURN = halfRotation(TURN_COS, { x: 0, z: 0 });
export const HALF_TURN_COS = HALF_TURN.x;
export const HALF_TURN_SIN = HALF_TURN.z;
const COS60 = 0.5;
const SIN60 = math.sqrt(3) / 2;

/** The skeleton's data (phases, roars, recover, engage inset, home radius, debug damage; ./shared.ts) plus: */
export interface BossAct1Data extends BossFightData {
	/** Vulnerable stand-still after a slam, ticks. */
	slamRecoverTicks: number;
}

export const BOSS_ACT1_DATA: BossAct1Data = {
	// Tuned in the E1.8 integration against the real weapons (README "Time to kill"): hp / cap = 120 s exactly at the web
	// build's WEB_BOSS_HP; the port halves it (BOSS_HP).
	hp: BOSS_HP,
	radius: 1.2,
	speed: 3,
	contactDamage: HIT_HEAVY,
	spriteId: "boss.act1",
	spriteScale: 1.25,
	boss: true,
	damageCapPerSecond: 6,
	corpseTicks: secondsToTicks(1.5),
	phaseHp: [0.66, 0.33],
	introTicks: secondsToTicks(1),
	transitionTicks: secondsToTicks(1.5),
	recoverTicks: [0, secondsToTicks(1), secondsToTicks(0.9), secondsToTicks(0.8)],
	slamRecoverTicks: secondsToTicks(1.2),
	engageInset: 1.5,
	homeRadius: 2.5,
	debugDamage: 0.1,
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

/** The next attack: deterministic rng over the phase's table, never a third repeat in a row. */
function pickAttack(ctx: SimCtx, a: ActorState): number {
	return pickBossAttack(ctx, a, PHASE_ATTACKS[a.phase] ?? PHASE_ATTACKS[1]);
}

/** Locks the attack's directions into v[] and starts its telegraph. */
function startAttack(ctx: SimCtx, a: ActorState, room: EncounterRoom | undefined, attack: number): void {
	const tp = toPlayer(ctx, a);
	const px = ctx.player.x;
	const pz = ctx.player.z;
	let dx = tp.dirX;
	let dz = tp.dirZ;
	a.v[V_MARK] = 0;
	a.v[V_SIGN] = 1;
	switch (attack) {
		case BossAttack.FAN:
			break;
		case BossAttack.FAST_FAN:
			a.v[V_SIGN] = ctx.random() < COIN ? -1 : 1;
			break;
		case BossAttack.RING:
		case BossAttack.DOUBLE_RING: {
			// Arcs centered on the player's side (turned a little), so the gaps (+-90 degrees) are never where they stand.
			turnSteps(dx, dz, ctx.randomInt(-RING_MAX_TURNS, RING_MAX_TURNS), dirScratch);
			dx = dirScratch.x;
			dz = dirScratch.z;
			const sign = ctx.random() < COIN ? -1 : 1;
			turnSteps(dx, dz, sign * DOUBLE_RING_TURNS, dirScratch);
			a.v[V_AUX_X] = dirScratch.x;
			a.v[V_AUX_Z] = dirScratch.z;
			break;
		}
		case BossAttack.SPIRAL: {
			const sign = ctx.random() < COIN ? -1 : 1;
			a.v[V_SIGN] = sign;
			// First arms 60 degrees off the player (arms are 120 degrees apart: the player starts between two of them).
			rotateDir(dx, dz, COS60, sign * SIN60, dirScratch);
			dx = dirScratch.x;
			dz = dirScratch.z;
			a.v[V_AUX_X] = dx;
			a.v[V_AUX_Z] = dz;
			break;
		}
		case BossAttack.SLAM: {
			// Target: the player's position now, kept inside the arena so the body fits.
			let tx = px;
			let tz = pz;
			if (room !== undefined) {
				const m = a.radius + SLAM_TARGET_MARGIN;
				tx = clamp(tx, room.minX + m, room.maxX - m);
				tz = clamp(tz, room.minZ + m, room.maxZ - m);
			}
			a.v[V_AUX_X] = tx;
			a.v[V_AUX_Z] = tz;
			aimAt(a.x, a.z, tx, tz, dirScratch, dx, dz);
			dx = dirScratch.x;
			dz = dirScratch.z;
			a.v[V_SIGN] = hasArchetype(SUMMON_KIND) ? 1 : 0;
			break;
		}
	}
	a.v[V_DIR_X] = dx;
	a.v[V_DIR_Z] = dz;
	faceToward(a, dx, dz);
	noteBossAttack(a, attack);
	ctx.telegraph(a, BOSS_TELEGRAPH_TICKS[attack], attack);
}

function fireRing2Gaps(ctx: SimCtx, a: ActorState, dx: number, dz: number, spec: BurstSpec): void {
	ctx.fireEnemy(a, dx, dz, spec);
	ctx.fireEnemy(a, -dx, -dz, spec);
}

/** `t` is a whole tick count >= 0, so Luau's `%` equals JS's here. */
function volleys(
	ctx: SimCtx,
	a: ActorState,
	t: number,
	spec: BurstSpec,
	n: number,
	every: number,
	offset: boolean,
): boolean {
	if (t % every === 0 && t / every < n) {
		let x = a.v[V_DIR_X];
		let z = a.v[V_DIR_Z];
		if (offset && (t / every) % 2 === 1) {
			rotateDir(x, z, HALF_TURN_COS, a.v[V_SIGN] * HALF_TURN_SIN, dirScratch);
			x = dirScratch.x;
			z = dirScratch.z;
		}
		ctx.fireEnemy(a, x, z, spec);
	}
	return t >= (n - 1) * every;
}

/** Up to SUMMON_COUNT swarmers, at most SUMMON_MAX_ALIVE alive in the arena (./shared.ts summonAdds). */
function summon(ctx: SimCtx, a: ActorState): void {
	summonAdds(ctx, a, SUMMON, a.v[V_DIR_X], a.v[V_DIR_Z]);
}

/** One tick of the running attack; `t` = ticks since its first bullet tick. Returns true when it is over. */
function runAttack(ctx: SimCtx, a: ActorState, t: number): boolean {
	switch (a.attack) {
		case BossAttack.FAN:
			return volleys(ctx, a, t, FAN, FAN_VOLLEYS, FAN_VOLLEY_TICKS, false);
		case BossAttack.FAST_FAN:
			return volleys(ctx, a, t, FAST_FAN, FAST_FAN_VOLLEYS, FAST_FAN_VOLLEY_TICKS, true);
		case BossAttack.RING:
			fireRing2Gaps(ctx, a, a.v[V_DIR_X], a.v[V_DIR_Z], RING_ARC);
			return true;
		case BossAttack.DOUBLE_RING:
			if (t === 0) fireRing2Gaps(ctx, a, a.v[V_DIR_X], a.v[V_DIR_Z], DOUBLE_RING_ARC);
			if (t === DOUBLE_RING_DELAY_TICKS) fireRing2Gaps(ctx, a, a.v[V_AUX_X], a.v[V_AUX_Z], DOUBLE_RING_ARC);
			return t >= DOUBLE_RING_DELAY_TICKS;
		case BossAttack.SPIRAL:
			if (t % SPIRAL_BURST_TICKS === 0 && t < SPIRAL_TICKS) {
				ctx.fireEnemy(a, a.v[V_AUX_X], a.v[V_AUX_Z], SPIRAL_ARMS);
				rotateDir(a.v[V_AUX_X], a.v[V_AUX_Z], HALF_TURN_COS, a.v[V_SIGN] * HALF_TURN_SIN, dirScratch);
				a.v[V_AUX_X] = dirScratch.x;
				a.v[V_AUX_Z] = dirScratch.z;
			}
			return t >= SPIRAL_TICKS - SPIRAL_BURST_TICKS;
		case BossAttack.SLAM: {
			if (a.v[V_MARK] === 0) {
				// Charging (contact damage is HIT_HEAVY, generic).
				const stepLen = SLAM_SPEED * SIM_DT;
				const x0 = a.x;
				const z0 = a.z;
				// The plain mover (no steering): the charge must stop dead at a wall (SLAM_STUCK2).
				const left = walkToward(ctx, a, a.v[V_AUX_X], a.v[V_AUX_Z], stepLen, false);
				const mx = a.x - x0;
				const mz = a.z - z0;
				if (left <= stepLen + SLAM_ARRIVE_EPS || t >= SLAM_MAX_TICKS || mx * mx + mz * mz < SLAM_STUCK2) {
					a.v[V_MARK] = t + 1;
					// Impact: a shockwave whose gap points back the way the boss came (arc centered on the charge direction).
					ctx.fireEnemy(a, a.v[V_DIR_X], a.v[V_DIR_Z], SHOCKWAVE);
					// Breakables (docs/DECOR.md D4): the slam breaks every piece in its radius (none without them).
					if (ctx.state.breakables !== undefined) slamBreakables(ctx.state, a.x, a.z);
				}
				return false;
			}
			const since = t + 1 - a.v[V_MARK];
			if (since === SHOCK2_DELAY_TICKS) {
				if (a.v[V_SIGN] === 1) summon(ctx, a);
				else {
					turnSteps(a.v[V_DIR_X], a.v[V_DIR_Z], SHOCK2_TURNS, dirScratch);
					ctx.fireEnemy(a, dirScratch.x, dirScratch.z, SHOCKWAVE_2);
				}
			}
			return since >= SHOCK2_DELAY_TICKS;
		}
		default:
			return true;
	}
}

// ---------------------------------------------------------------------------------------------
// The archetype

const SPEC: BossFightSpec = { phaseFirstAttack: PHASE_FIRST_ATTACK, roarAttack: BossAttack.ROAR };

const HOOKS: BossFightHooks<BossAct1Data> = {
	spec: SPEC,
	startNext(ctx, a, _d, room) {
		startAttack(ctx, a, room, pickAttack(ctx, a));
	},
	runAttack(ctx, a, _d, t) {
		return runAttack(ctx, a, t);
	},
	recoverAfter(d, attack) {
		return attack === BossAttack.SLAM ? d.slamRecoverTicks : undefined;
	},
	stepOwnState() {
		return false;
	},
};

export const BOSS_ACT1 = registerArchetype<BossAct1Data>({
	id: BOSS_ACT1_ID,
	data: BOSS_ACT1_DATA,

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
		// The brambles wither: adds still alive in the arena die with her.
		onBossDeath(ctx, a);
	},
});

/**
 * 'boss.act1': the Act I boss (E1.8, M1 "First fight"; source: `src/sim/actors/archetypes/boss/act1.ts`). GDD
 * placeholder: "Mother Bramble", a burned-forest bramble mother; the display name is the theme string
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
 */

import { SIM_DT } from "../../../../units";
import { TURN_COS, TURN_SIN } from "../../../combatData";
import type { SimCtx } from "../../../ctx";
import { Button } from "../../../../input";
import { BulletKind, FULL_RING, aimAt, halfRotation, rotateDir, type BurstSpec, type Dir } from "../../../patterns";
import { HIT_HEAVY, HIT_NORMAL, PLAYER_RADIUS, secondsToTicks } from "../../../../playerData";
import type { EncounterRoom } from "../../encounter";
import { partySize, playerAt } from "../../../../party";
import type { PlayerState } from "../../../../state";
import { faceToward, moveActor, toPlayer, walkToward } from "../../helpers";
import { archetypeAt, hasArchetype, registerArchetype } from "../../registry";
import { AiState, NO_KIND, type ActorState, type ArchetypeData } from "../../types";
import { V_HOME_X, V_HOME_Z, engage, isRoomEnemyData } from "../enemyShared";

export const BOSS_ACT1_ID = "boss.act1";

// ---------------------------------------------------------------------------------------------
// States, attacks, scratch slots

/** aiState values (AiState.TELEGRAPH = 1 is the shared wind-up state; the rest are this boss's own). */
export const BossState = {
	TELEGRAPH: AiState.TELEGRAPH,
	DORMANT: AiState.CUSTOM,
	ACTIVE: AiState.CUSTOM + 1,
	RECOVER: AiState.CUSTOM + 2,
	TRANSITION: AiState.CUSTOM + 3,
	REPOSITION: AiState.CUSTOM + 4,
} as const;

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
export const MAX_REPEAT = 2;

/** v[] slots. DIR = the attack's locked heading; AUX = second heading (double ring, spiral) or slam target point. */
export const V_DIR_X = 0;
export const V_DIR_Z = 1;
export const V_AUX_X = 2;
export const V_AUX_Z = 3;
/** Slam: tick of impact + 1 (0 while charging). */
export const V_MARK = 4;
/** Last attack started, and how many times in a row. */
export const V_LAST = 5;
export const V_REPEAT = 6;
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
export const ENGAGE_RANGE_NO_ROOM = 10;
const REPOSITION_MAX_TICKS = 120;
/** REPOSITION ends when the room center is this close (world units). */
const REPOSITION_DONE = 0.5;
/** While the player is dead the boss waits this long between checks (RECOVER). */
const PLAYER_DEAD_WAIT_TICKS = 30;
/** The slam target is kept this far (plus the boss radius) inside the arena's bounds. */
const SLAM_TARGET_MARGIN = 0.4;
/** Slam impact: within one step (plus this slack) of the target. */
const SLAM_ARRIVE_EPS = 1e-9;
/** Slam impact: a charge step shorter than this (squared) means a wall stopped it. */
const SLAM_STUCK2 = 1e-8;
/** Coin flip for turn signs. */
const COIN = 0.5;
const HP_EPS = 1e-6;

// Exact rotations (no trig): half a TURN (~7.1 degrees: spiral step and fast-fan lane offset), 60 and 120 degrees.
const HALF_TURN = halfRotation(TURN_COS, { x: 0, z: 0 });
export const HALF_TURN_COS = HALF_TURN.x;
export const HALF_TURN_SIN = HALF_TURN.z;
const COS60 = 0.5;
const SIN60 = math.sqrt(3) / 2;
const COS120 = -0.5;

export interface BossAct1Data extends ArchetypeData {
	/** Phase 2 starts at hp <= phaseHp[0] * hpMax, phase 3 at hp <= phaseHp[1] * hpMax. */
	phaseHp: ReadonlyArray<number>;
	/** Intro roar after engaging, ticks (immune). */
	introTicks: number;
	/** Phase transition roar, ticks (immune; own bullets cleared). */
	transitionTicks: number;
	/** Vulnerable stand-still after an attack, ticks, per phase (index = phase). */
	recoverTicks: ReadonlyArray<number>;
	/** Vulnerable stand-still after a slam, ticks. */
	slamRecoverTicks: number;
	/** The fight starts when the player is this far inside the boss room's bounds, world units. */
	engageInset: number;
	/** Walk back toward the room center between attacks when farther from it than this, world units. */
	homeRadius: number;
	/** DEBUG_BOSS (J, debug builds only): fraction of hpMax taken off per press. */
	debugDamage: number;
}

export const BOSS_ACT1_DATA: BossAct1Data = {
	// Tuned in the E1.8 integration against the real weapons (README "Time to kill"): hp / cap = 120 s exactly.
	hp: 540,
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

function inRoom(room: EncounterRoom, x: number, z: number, inset: number): boolean {
	return x >= room.minX + inset && x <= room.maxX - inset && z >= room.minZ + inset && z <= room.maxZ - inset;
}

/** The boss's arena: the boss room when the boss stands in it, else whatever room it stands in (undefined: none). */
export function bossArena(ctx: SimCtx, a: Readonly<ActorState>): EncounterRoom | undefined {
	const r = ctx.bossRoom();
	if (r !== undefined && inRoom(r, a.x, a.z, 0)) return r;
	return ctx.roomAt(a.x, a.z);
}

/** hp the current phase may not go below (the next phase's threshold; 0 in the last phase). */
export function phaseFloor(d: BossAct1Data, a: Readonly<ActorState>): number {
	if (a.phase <= 1) return a.hpMax * d.phaseHp[0];
	if (a.phase === 2) return a.hpMax * d.phaseHp[1];
	return 0;
}

function engaged(a: Readonly<ActorState>): boolean {
	return a.aiState !== BossState.DORMANT && a.aiState !== AiState.IDLE;
}

function beginTransition(ctx: SimCtx, a: ActorState, d: BossAct1Data): void {
	ctx.setPhase(a, a.phase + 1);
	a.aiState = BossState.TRANSITION;
	a.aiTicks = d.transitionTicks;
	a.attack = BossAttack.ROAR;
	a.cooldown = PHASE_FIRST_ATTACK[a.phase] ?? 0;
	a.v[V_MARK] = 0;
	// Pillar 2: the slate is wiped while it roars, so the new phase starts readable.
	ctx.combat.enemyBullets.clear(a.emitterId);
}

/** After hp changed: at the phase floor, start the transition (hp snapped onto the threshold). */
function checkPhase(ctx: SimCtx, a: ActorState, d: BossAct1Data): void {
	if (a.alive === 0 || a.phase >= 3 || a.aiState === BossState.TRANSITION || !engaged(a)) return;
	const floor = phaseFloor(d, a);
	if (a.hp <= floor + HP_EPS) {
		a.hp = floor;
		beginTransition(ctx, a, d);
	}
}

/**
 * The room seal: while the fight is on, the player cannot leave the arena's bounds (clamped back inside them, minus
 * the player's radius, every tick). Corridors only meet a room at its edge, so a clamped player always stands on the
 * room's floor (or in the corridor mouth inside the bounds). Pure sim, no collision or config changes.
 */
function sealArena(ctx: SimCtx, room: EncounterRoom | undefined): void {
	if (room === undefined) return;
	// Co-op (M4): every player is sealed in, in index order (a straggler is pulled onto the arena floor).
	const n = partySize(ctx.state);
	for (let i = 0; i < n; i++) sealPlayer(playerAt(ctx.state, i), room);
}

function sealPlayer(p: PlayerState, room: EncounterRoom): void {
	const r = PLAYER_RADIUS;
	p.x = clamp(p.x, room.minX + r, room.maxX - r);
	p.z = clamp(p.z, room.minZ + r, room.maxZ - r);
}

function playerEngages(ctx: SimCtx, a: ActorState, d: BossAct1Data, room: EncounterRoom | undefined): boolean {
	const p = ctx.player;
	if (p.dead !== 0) return false;
	if (room !== undefined) return inRoom(room, p.x, p.z, d.engageInset);
	return toPlayer(ctx, a).dist <= ENGAGE_RANGE_NO_ROOM;
}

/** The next attack: deterministic rng over the phase's table, never a third repeat in a row. */
function pickAttack(ctx: SimCtx, a: ActorState): number {
	const forced = a.cooldown;
	a.cooldown = 0;
	if (forced > 0) return forced;
	const attacks = PHASE_ATTACKS[a.phase] ?? PHASE_ATTACKS[1];
	const banned = a.v[V_REPEAT] >= MAX_REPEAT ? a.v[V_LAST] : -1;
	let n = 0;
	for (let i = 0; i < attacks.size(); i++) if (attacks[i] !== banned) n++;
	let k = ctx.randomInt(0, n - 1);
	for (let i = 0; i < attacks.size(); i++) {
		if (attacks[i] === banned) continue;
		if (k === 0) return attacks[i];
		k--;
	}
	return attacks[0];
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
	if (a.v[V_LAST] === attack) a.v[V_REPEAT] += 1;
	else {
		a.v[V_LAST] = attack;
		a.v[V_REPEAT] = 1;
	}
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

/**
 * Up to SUMMON_COUNT swarmers around the boss, never more than SUMMON_MAX_ALIVE of them alive in the arena (room
 * swarmers elsewhere on the floor do not count), and never past MAX_ACTORS (spawnActor drops the rest). Each one
 * spawns on the boss's center (always floor) and is pushed SUMMON_RADIUS out through the world (moveActor: walls and
 * pits stop it, so it never lands in one), 120 degrees apart starting along the charge direction. Room enemies
 * (data.roomEnemy) come out engaged, homed where they land.
 */
function summon(ctx: SimCtx, a: ActorState): void {
	const kind = ctx.kindOf(SUMMON_KIND);
	const room = bossArena(ctx, a);
	let alive = 0;
	const actors = ctx.actors;
	const r2 = ENGAGE_RANGE_NO_ROOM * ENGAGE_RANGE_NO_ROOM;
	for (let i = 0; i < actors.size(); i++) {
		const o = actors[i];
		if (o.kind !== kind || o.alive === 0) continue;
		const near =
			room !== undefined
				? inRoom(room, o.x, o.z, 0)
				: (o.x - a.x) * (o.x - a.x) + (o.z - a.z) * (o.z - a.z) <= r2;
		if (near) alive++;
	}
	const n = math.min(SUMMON_COUNT, SUMMON_MAX_ALIVE - alive);
	let x = a.v[V_DIR_X];
	let z = a.v[V_DIR_Z];
	for (let i = 0; i < n; i++) {
		const s = ctx.spawnActor(SUMMON_KIND, a.x, a.z);
		if (s === undefined) return; // the actor pool is full
		moveActor(ctx, s, x * SUMMON_RADIUS, z * SUMMON_RADIUS); // prevX / prevZ stay on the boss: drawn bursting out
		if (isRoomEnemyData(ctx.data(s))) {
			s.v[V_HOME_X] = s.x;
			s.v[V_HOME_Z] = s.z;
			engage(s);
		}
		rotateDir(x, z, COS120, SIN60, dirScratch); // 120 degrees
		x = dirScratch.x;
		z = dirScratch.z;
	}
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

function recover(a: ActorState, d: BossAct1Data, ticks?: number): void {
	a.aiState = BossState.RECOVER;
	a.aiTicks = ticks ?? d.recoverTicks[a.phase] ?? d.recoverTicks[1];
	a.attack = BossAttack.NONE;
}

/** Starts the next telegraph (or keeps waiting while the player is dead). The source's `next`. */
function nextAttack(ctx: SimCtx, a: ActorState, d: BossAct1Data, room: EncounterRoom | undefined): void {
	if (ctx.player.dead !== 0) {
		recover(a, d, PLAYER_DEAD_WAIT_TICKS);
		return;
	}
	startAttack(ctx, a, room, pickAttack(ctx, a));
}

/** J (DEBUG_BOSS, debug builds only): 10% of max hp off, bypassing the cap, never past a phase threshold. */
function debugHit(ctx: SimCtx, a: ActorState, d: BossAct1Data): void {
	if (!engaged(a) || a.aiState === BossState.TRANSITION) return;
	const floor = phaseFloor(d, a);
	const hp = a.hp - a.hpMax * d.debugDamage;
	a.hp = floor > hp ? floor : hp;
	if (a.hp > floor + HP_EPS) return;
	if (floor <= 0) ctx.killActor(a);
	else checkPhase(ctx, a, d);
}

// ---------------------------------------------------------------------------------------------
// The archetype

export const BOSS_ACT1 = registerArchetype<BossAct1Data>({
	id: BOSS_ACT1_ID,
	data: BOSS_ACT1_DATA,

	init(_ctx, a) {
		a.aiState = BossState.DORMANT;
	},

	step(ctx, a) {
		const d = ctx.data<BossAct1Data>(a);
		const room = bossArena(ctx, a);

		// Debug cheat (an input bit, so replays reproduce it). Edge against last tick's buttons (weapons update them later).
		const b = ctx.input.buttons;
		if (
			bit32.band(b, Button.DEBUG_BOSS) !== 0 &&
			bit32.band(ctx.combat.weapons.prevButtons, Button.DEBUG_BOSS) === 0
		) {
			debugHit(ctx, a, d);
			if (a.alive === 0) return;
		}

		if (!engaged(a)) {
			a.aiState = BossState.DORMANT;
			if (!playerEngages(ctx, a, d, room)) return;
			ctx.events.bossEngaged = 1;
			ctx.setPhase(a, 1);
			a.aiState = BossState.TRANSITION;
			a.aiTicks = d.introTicks;
			a.attack = BossAttack.ROAR;
			a.cooldown = PHASE_FIRST_ATTACK[1];
		}

		sealArena(ctx, room);

		switch (a.aiState) {
			case BossState.TRANSITION:
				a.aiTicks -= 1;
				if (a.aiTicks <= 0) nextAttack(ctx, a, d, room);
				return;
			case BossState.RECOVER: {
				const tp = toPlayer(ctx, a);
				faceToward(a, tp.dx, tp.dz);
				a.aiTicks -= 1;
				if (a.aiTicks > 0) return;
				if (room !== undefined && ctx.player.dead === 0) {
					const hx = room.cx - a.x;
					const hz = room.cz - a.z;
					if (hx * hx + hz * hz > d.homeRadius * d.homeRadius) {
						a.aiState = BossState.REPOSITION;
						a.aiTicks = REPOSITION_MAX_TICKS;
						return;
					}
				}
				nextAttack(ctx, a, d, room);
				return;
			}
			case BossState.REPOSITION: {
				// The plain mover (no steering), like the charge.
				const left = room !== undefined ? walkToward(ctx, a, room.cx, room.cz, d.speed * SIM_DT, false) : 0;
				if (left <= REPOSITION_DONE) {
					nextAttack(ctx, a, d, room);
					return;
				}
				a.aiTicks -= 1;
				if (a.aiTicks <= 0) nextAttack(ctx, a, d, room);
				return;
			}
			case BossState.TELEGRAPH:
				a.aiTicks -= 1;
				if (a.aiTicks > 0) return;
				a.aiState = BossState.ACTIVE;
				a.aiTicks = 0;
				if (runAttack(ctx, a, 0)) recover(a, d, a.attack === BossAttack.SLAM ? d.slamRecoverTicks : undefined);
				return;
			case BossState.ACTIVE: {
				a.aiTicks += 1;
				const attack = a.attack;
				if (runAttack(ctx, a, a.aiTicks)) {
					recover(a, d, attack === BossAttack.SLAM ? d.slamRecoverTicks : undefined);
				}
				return;
			}
			default:
				recover(a, d);
		}
	},

	filterDamage(ctx, a, damage) {
		if (!engaged(a) || a.aiState === BossState.TRANSITION) return 0;
		const floor = phaseFloor(ctx.data<BossAct1Data>(a), a);
		return a.hp - damage < floor ? a.hp - floor : damage;
	},

	onHit(ctx, a) {
		checkPhase(ctx, a, ctx.data<BossAct1Data>(a));
	},

	onDeath(ctx, a) {
		ctx.events.bossDefeated = 1;
		a.attack = BossAttack.NONE;
		ctx.combat.enemyBullets.clear(a.emitterId);
		// The brambles wither: adds still alive in the arena die with her.
		const room = bossArena(ctx, a);
		if (room === undefined) return;
		const actors = ctx.actors;
		for (let i = 0; i < actors.size(); i++) {
			const o = actors[i];
			if (o === a || o.kind === NO_KIND || o.alive === 0 || archetypeAt(o.kind).data.boss === true) continue;
			if (inRoom(room, o.x, o.z, 0)) ctx.killActor(o);
		}
	},
});

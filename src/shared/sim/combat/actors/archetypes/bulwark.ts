/**
 * 'bulwark' (Roblox port, docs/NEW_ENEMIES_2.md NX2; no web source): an armoured demon behind a round shield that guards
 * its front and the allies behind it. 10 hp, contact damage 0 (its bash lands through its own overlap check,
 * `ctx.hurtPlayerAt`).
 *
 * Engaged (BULWARK_GUARD) it keeps keepMin-keepMax from its target along the target's bearing (the bruiser's approach:
 * out of sight it walks at the target to find a line (STEER) and leashes after lostTicks, v[BULWARK_LOST]), while its
 * facing (= the shield) turns toward the target by at most one (turnCos, turnSin) rotation a tick (2.5 degrees: 150
 * degrees a second; `turnFacing`, a literal rotation, no trig), so a player who circles faster gets behind it. Its
 * cooldown counts down only here. At 0, with line of sight and the target within bashRange, the **bash** telegraph starts
 * (AiState.TELEGRAPH, attack BULWARK_ATTACK_BASH, bashTelegraphTicks): the heading locks toward the target in
 * v[BULWARK_DIR_*] (the `aimLine` hint), the next cooldown is drawn (`enemyCooldown`: the attack's ONE draw; the first is
 * drawn in init) and it stands, its facing turning toward the locked heading. From the telegraph's last tick, BULWARK_BASH:
 * bashLunge / bashLungeTicks along the heading a tick for bashLungeTicks ticks (never scaled, EVD9; the plain mover: a
 * wall stops it), and the first overlap with each living player hurts bashDamage once (the bit in v[BULWARK_HIT_BITS] is
 * set on the first overlap whether or not the hit lands, so a roll through it dodges the whole bash). Then
 * BULWARK_RECOVER for recoverTicks: still, the shield down.
 *
 * **The shield** (../../shield.ts, NX0 "the damageActor callers"): v[BULWARK_GUARDING] is 1 in every state but
 * BULWARK_RECOVER and BULWARK_STAGGER. A guarding Bulwark (not pinned by a Siege Bolt) blocks a hit whose origin is
 * inside its front cone (dot(face, origin - centre) >= frontCos x the distance): a moving player bullet within
 * max(coverRadius, its body's hit radius) of its centre heading into the shield (NXD6: allies behind it are covered), a
 * sword swing from a player in front, a Siege slam's shockwave from in front. A block deals nothing. A blocked sword
 * finisher, heavy arrow or Siege shockwave breaks the guard instead (NXD7, `bulwarkGuardBreak`): BULWARK_STAGGER for
 * staggerTicks, still, the shield down, a telegraphed bash cancelled. Effects that call damageActor directly ignore it.
 *
 * View contract: states BULWARK_GUARD (= STATE_ENGAGED) / AiState.TELEGRAPH (the bash) / BULWARK_BASH /
 * BULWARK_RECOVER / BULWARK_STAGGER (each counts down aiTicks); attack id BULWARK_ATTACK_BASH (telegraph only); facing
 * faceX / faceZ = the shield; v slots BULWARK_LOST (ticks without sight), BULWARK_HIT_BITS (players already hit by this
 * bash, one bit per party index), BULWARK_GUARDING (1 while the shield is up), BULWARK_DIR_X / _Z (the locked bash
 * heading). Blocks and breaks: SimEvents.shieldBlocks / guardBreaks and CombatState.guardEvents (../../shield.ts).
 *
 * @module
 */

import { HIT_NORMAL, PLAYER_RADIUS, secondsToTicks } from "../../../playerData";
import { partySize, playerAt } from "../../../party";
import { rotateDir, type Dir } from "../../patterns";
import type { SimCtx } from "../../ctx";
import { enemyCooldown, walkStep } from "../actorMods";
import { moveActor, toPlayer } from "../helpers";
import { PORT_BAND_ENEMIES_3, registerArchetype } from "../registry";
import { AiState, type ActorState } from "../types";
import {
	STATE_ENGAGED,
	STEER,
	V_AGGRO,
	alertOnDeath,
	engage,
	engageOnHit,
	initRoomEnemy,
	leash,
	shouldLeash,
	stepCalm,
	type RoomEnemyData,
} from "./enemyShared";

/**
 * The Bulwark's tuning on top of the room enemy rules: its keep-range band, how fast the shield turns, what the shield
 * covers, and the bash.
 */
export interface BulwarkData extends RoomEnemyData {
	/** Preferred distance band to its target (world units). */
	readonly keepMin: number;
	/**
	 * The far edge of the band (world units): past it, it walks toward its target; nearer than keepMin it backs off.
	 */
	readonly keepMax: number;
	/** The most its facing turns a tick, as a rotation (cos, sin): a literal, no trig in the sim. */
	readonly turnCos: number;
	/** Sine of the per-tick turn limit, the pair of turnCos. */
	readonly turnSin: number;
	/** The shield's front cone: a hit origin at offset o from its centre is in front when dot(face, o) >= frontCos x |o|. */
	readonly frontCos: number;
	/** NXD6: a player bullet within this of its centre (world units) inside the front cone stops (the cover arc). */
	readonly coverRadius: number;
	/** NXD7: the guard break's stagger (shield down, standing still). */
	readonly staggerTicks: number;
	/** Bashes when its target is this close (world units) and the cooldown is out. */
	readonly bashRange: number;
	/** Ticks between bashes (random in [min, max], `enemyCooldown`; the first drawn at spawn). */
	readonly bashCooldownMin: number;
	/** The longest wait between bashes, ticks (inclusive upper bound of the draw). */
	readonly bashCooldownMax: number;
	/** Bash telegraph ticks (the heading locks at its start) and its warning line's length (world units). */
	readonly bashTelegraphTicks: number;
	/** Length of the bash telegraph's warning line along the locked heading, world units. */
	readonly bashLineLength: number;
	/** The bash's lunge: distance (world units) and ticks it takes. */
	readonly bashLunge: number;
	/** Ticks the lunge lasts: each tick it moves bashLunge / bashLungeTicks along the locked heading. */
	readonly bashLungeTicks: number;
	/** Half hearts of the bash's hit (once per player per bash). */
	readonly bashDamage: number;
	/** Standing with the shield down after a bash (the Knight's opening). */
	readonly recoverTicks: number;
}

// --- States and attack ids
/** Guarding: keeping range with the shield toward its target. */
export const BULWARK_GUARD = STATE_ENGAGED;
/** Lunging along v[BULWARK_DIR_*]. */
export const BULWARK_BASH = AiState.CUSTOM + 1;
/** Shield down after a bash. */
export const BULWARK_RECOVER = AiState.CUSTOM + 2;
/** Guard broken (NXD7): shield down, standing still. */
export const BULWARK_STAGGER = AiState.CUSTOM + 3;
/** ActorState.attack while telegraphing the bash. */
export const BULWARK_ATTACK_BASH = 1;

// --- v[] slots (0..2 shared)
/** Ticks without line of sight to its target (the bruiser's lost counter). */
export const BULWARK_LOST = 3;
/** Players already hit by this bash (bit k = party index k). */
export const BULWARK_HIT_BITS = 4;
/** 1 while the shield is up (guarding), 0 in bash recovery and stagger. */
export const BULWARK_GUARDING = 5;
/** Locked bash heading (unit). */
export const BULWARK_DIR_X = 6;
/** v[7]: the z component of the locked bash heading (unit), the pair of BULWARK_DIR_X. */
export const BULWARK_DIR_Z = 7;

/** Design: the facing turns 2.5 degrees a tick (150 deg/s): cos and sin of 2.5 degrees as literals. */
export const BULWARK_TURN_COS = 0.9990482215818578;
/** Sine of 2.5 degrees as a literal, the pair of BULWARK_TURN_COS. */
export const BULWARK_TURN_SIN = 0.043619387365336;
/** Design: the front cone, dot >= 0.34 x the distance (~140 degrees wide). */
export const BULWARK_FRONT_COS = 0.34;
/** NXD6: the cover arc's reach (world units). */
export const BULWARK_COVER_RADIUS = 1;
const BASH_TELEGRAPH_SECONDS = 0.45;
const BASH_LINE_LENGTH = 1.6;
/** NX1 starting value (the plan gives the lunge's length, not its time): 0.15 s. */
const BASH_LUNGE_SECONDS = 0.15;

/**
 * The registered 'bulwark' archetype: keeps range with its shield turned toward its target, bashes on a cooldown and
 * drops the shield while it recovers or staggers. Its only draws are bash cooldowns (one in init, one per bash
 * telegraph).
 */
export const BULWARK = registerArchetype<BulwarkData>({
	id: "bulwark",
	band: PORT_BAND_ENEMIES_3,
	data: {
		hp: 10,
		radius: 0.45,
		speed: 2,
		contactDamage: 0,
		spriteId: "enemy.bulwark",
		roomEnemy: true,
		aggroRange: 8,
		leashRange: 14,
		lostTicks: secondsToTicks(3),
		alertRange: 4.5,
		keepMin: 2,
		keepMax: 3,
		turnCos: BULWARK_TURN_COS,
		turnSin: BULWARK_TURN_SIN,
		frontCos: BULWARK_FRONT_COS,
		coverRadius: BULWARK_COVER_RADIUS,
		staggerTicks: secondsToTicks(1.5), // 90
		bashRange: 1.8,
		bashCooldownMin: secondsToTicks(2.5),
		bashCooldownMax: secondsToTicks(3.5),
		bashTelegraphTicks: secondsToTicks(BASH_TELEGRAPH_SECONDS), // 27
		bashLineLength: BASH_LINE_LENGTH,
		bashLunge: 1.4,
		bashLungeTicks: secondsToTicks(BASH_LUNGE_SECONDS), // 9
		bashDamage: HIT_NORMAL,
		recoverTicks: secondsToTicks(0.6), // 36
		fx: {
			aimLine: {
				dirX: BULWARK_DIR_X,
				dirZ: BULWARK_DIR_Z,
				length: BASH_LINE_LENGTH,
				boldTicks: secondsToTicks(BASH_TELEGRAPH_SECONDS), // locked from the start: bold throughout
				attack: BULWARK_ATTACK_BASH,
			},
		},
	},
	init(ctx, a) {
		initRoomEnemy(a);
		a.v[BULWARK_GUARDING] = 1;
		const d = ctx.data<BulwarkData>(a);
		a.cooldown = enemyCooldown(ctx, a, d.bashCooldownMin, d.bashCooldownMax);
	},
	step(ctx, a) {
		const d = ctx.data<BulwarkData>(a);
		if (stepCalm(ctx, a)) return;
		if (shouldLeash(ctx, a)) {
			leash(a);
			a.v[BULWARK_GUARDING] = 1; // a leash out of a stagger / recover raises the shield again
			return;
		}
		const st = a.aiState;
		if (st === AiState.TELEGRAPH) windUp(ctx, a, d);
		else if (st === BULWARK_BASH) bashing(ctx, a, d);
		else if (st === BULWARK_RECOVER || st === BULWARK_STAGGER) standing(a);
		else guard(ctx, a, d);
	},
	onHit(ctx, a) {
		engageOnHit(ctx, a);
	},
	onDeath(ctx, a) {
		alertOnDeath(ctx, a);
	},
});

const turnScratch: Dir = { x: 0, z: 1 };
/** A facing shorter than this (squared) is no facing: turnFacing snaps to the target. */
const FACE_EPS2 = 1e-12;

/**
 * Turns `a`'s facing toward the unit direction (tx, tz) by at most the rotation (cos, sin): within that angle it faces
 * (tx, tz) exactly, else it turns one step the side the target is on (patterns.ts rotateDir with +sin turns clockwise,
 * cross(f, f') = -sin; a target straight behind turns counter-clockwise). No trig: a literal rotation pair.
 */
export function turnFacing(a: ActorState, tx: number, tz: number, cos: number, sin: number): void {
	const fx = a.faceX;
	const fz = a.faceZ;
	if (fx * fx + fz * fz <= FACE_EPS2 || fx * tx + fz * tz >= cos) {
		a.faceX = tx;
		a.faceZ = tz;
		return;
	}
	const cross = fx * tz - fz * tx;
	rotateDir(fx, fz, cos, cross >= 0 ? -sin : sin, turnScratch);
	a.faceX = turnScratch.x;
	a.faceZ = turnScratch.z;
}

/** Keeps range with the shield turning toward its target; starts the bash when the cooldown is out. */
function guard(ctx: SimCtx, a: ActorState, d: BulwarkData): void {
	const p = ctx.player;
	const tp = toPlayer(ctx, a);
	const dist = tp.dist;
	const dirX = tp.dirX;
	const dirZ = tp.dirZ;
	const los = ctx.lineOfSight(a.x, a.z, p.x, p.z);
	if (los) {
		a.v[BULWARK_LOST] = 0;
	} else {
		a.v[BULWARK_LOST] += 1;
		if (a.v[BULWARK_LOST] > d.lostTicks) {
			leash(a);
			return;
		}
	}
	if (a.cooldown > 0) a.cooldown--;
	if (los && a.cooldown <= 0 && dist <= d.bashRange) {
		startBash(ctx, a, d, dirX, dirZ);
		return;
	}
	turnFacing(a, dirX, dirZ, d.turnCos, d.turnSin);
	const stepLen = walkStep(ctx, a);
	if (!los) {
		// Finds a line (the bruiser's walk at the target), the shield still turning on its own.
		const k = dist < stepLen ? dist : stepLen;
		moveActor(ctx, a, dirX * k, dirZ * k, STEER);
		return;
	}
	const radial = dist < d.keepMin ? -1 : dist > d.keepMax ? 1 : 0;
	if (radial === 0) return;
	const k = stepLen * radial;
	moveActor(ctx, a, dirX * k, dirZ * k, STEER);
}

/** Locks the heading, draws the next cooldown (the bash's one draw) and telegraphs. */
function startBash(ctx: SimCtx, a: ActorState, d: BulwarkData, dirX: number, dirZ: number): void {
	a.v[BULWARK_DIR_X] = dirX;
	a.v[BULWARK_DIR_Z] = dirZ;
	a.v[BULWARK_HIT_BITS] = 0;
	turnFacing(a, dirX, dirZ, d.turnCos, d.turnSin);
	a.cooldown = enemyCooldown(ctx, a, d.bashCooldownMin, d.bashCooldownMax);
	ctx.telegraph(a, d.bashTelegraphTicks, BULWARK_ATTACK_BASH);
}

/** The telegraph: stands, the shield turning toward the locked heading; on the last tick the lunge starts (and steps). */
function windUp(ctx: SimCtx, a: ActorState, d: BulwarkData): void {
	turnFacing(a, a.v[BULWARK_DIR_X], a.v[BULWARK_DIR_Z], d.turnCos, d.turnSin);
	a.aiTicks--;
	if (a.aiTicks > 0) return;
	a.aiState = BULWARK_BASH;
	a.aiTicks = d.bashLungeTicks;
	a.attack = 0;
	bashing(ctx, a, d);
}

/** One lunge tick (the plain mover, never scaled), then its hits; the last one starts the recover (shield down). */
function bashing(ctx: SimCtx, a: ActorState, d: BulwarkData): void {
	const dirX = a.v[BULWARK_DIR_X];
	const dirZ = a.v[BULWARK_DIR_Z];
	turnFacing(a, dirX, dirZ, d.turnCos, d.turnSin);
	const len = d.bashLunge / d.bashLungeTicks;
	moveActor(ctx, a, dirX * len, dirZ * len);
	bashHits(ctx, a, d);
	a.aiTicks--;
	if (a.aiTicks > 0) return;
	a.aiState = BULWARK_RECOVER;
	a.aiTicks = d.recoverTicks;
	a.v[BULWARK_GUARDING] = 0;
}

/** The first overlap with each living player this bash hurts them once (bit k of v[BULWARK_HIT_BITS]). */
function bashHits(ctx: SimCtx, a: ActorState, d: BulwarkData): void {
	const n = partySize(ctx.state);
	const reach = a.radius + PLAYER_RADIUS;
	const reach2 = reach * reach;
	for (let k = 0; k < n; k++) {
		const bit = bit32.lshift(1, k);
		if (bit32.band(a.v[BULWARK_HIT_BITS], bit) !== 0) continue;
		const p = playerAt(ctx.state, k);
		if (p.dead !== 0) continue;
		const dx = p.x - a.x;
		const dz = p.z - a.z;
		if (dx * dx + dz * dz >= reach2) continue;
		a.v[BULWARK_HIT_BITS] = bit32.bor(a.v[BULWARK_HIT_BITS], bit);
		ctx.hurtPlayerAt(k, d.bashDamage, a.kind);
	}
}

/** Recover / stagger: stands with the shield down, then guards again. */
function standing(a: ActorState): void {
	a.aiTicks--;
	if (a.aiTicks > 0) return;
	a.aiState = BULWARK_GUARD;
	a.aiTicks = 0;
	a.v[BULWARK_GUARDING] = 1;
	a.v[BULWARK_LOST] = 0;
}

/**
 * NXD7: the guard breaks (a blocked sword finisher, heavy arrow or Siege shockwave; ../../shield.ts): engaged if it was
 * calm, BULWARK_STAGGER for staggerTicks with the shield down (a telegraphed bash is cancelled; its drawn cooldown
 * stands). No draw.
 */
export function bulwarkGuardBreak(a: ActorState): void {
	if (a.v[V_AGGRO] === 0) engage(a);
	a.aiState = BULWARK_STAGGER;
	a.aiTicks = BULWARK.data.staggerTicks;
	a.attack = 0;
	a.v[BULWARK_GUARDING] = 0;
}

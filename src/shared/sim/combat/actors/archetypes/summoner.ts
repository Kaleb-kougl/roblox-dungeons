/**
 * 'summoner' (Roblox port, docs/ENEMY_VARIANTS.md EV4; no web source): the endless floors' support enemy, a frail
 * 6 hp caster with no contact damage. Engaged, it keeps the player at 6-9 units like the sniper (backs off when they
 * come close, closes in when they are far, strafes in between and flips when a wall stops it); without line of sight
 * it never walks toward the player (it only backs off if they are inside keepMin), so it stays hidden behind cover
 * once it got there. Actively SEEKING cover (picking spots out of the player's sight) is not built: optional in the
 * plan, skipped.
 *
 * Summon: whenever its cooldown runs out (4.5-5.5 s, `enemyCooldown`), it telegraphs 1.0 s (`ctx.telegraph`,
 * attack SUMMONER_ATTACK_SUMMON; the `ring` hint, a circle at its feet filling over the telegraph), then up to
 * summonPerCast swarmers burst out of its centre (pushed out summonRadius along the player's bearing, then turned by
 * exact 120-degree rotations, like the bosses' `summonAdds`), each with its landing spot as home, engaged and adopted
 * into the summoner's score room (`adoptScoreRoomMember`: the room does not clear while they live). Limits (EVD3, data
 * fields): at most summonMaxAlive of ITS summons alive and summonsPerLife per life. It tracks its own summons by
 * actor id in v[SUMMONER_SUMMON_FIRST ..] (0 = empty; a slot whose actor is dead, freed or reused by another actor, i.e.
 * no live actor carries that id, counts as empty) and the summons left this life in v[SUMMONER_LEFT]. When it can't
 * summon any (cap reached or none left) the cast is skipped (no telegraph); the cooldown is drawn the same way either
 * way, at the moment it decides, so the rng draw count never depends on how many summons live. A summon dropped by a
 * full actor pool (`ctx.spawnActor` undefined: `actorsDropped` counts it) costs nothing.
 *
 * Panic: with the player within panicRange (3) and in sight when the cooldown runs out, it telegraphs 0.5 s instead
 * (attack SUMMONER_ATTACK_PANIC), then fires the bruiser's gapped ring (`BRUISER.data.ring`, gap toward the player
 * turned by a `GAP_TURNS` draw, exactly as the bruiser's slam) and backs off (SUMMONER_BACKOFF: walks straight away
 * from the player for backoffTicks) before keeping range again. One cooldown serves both casts (panic draws its own
 * shorter range); a skipped summon's draw also delays the next panic chance.
 *
 * Wither: on death, every live actor whose id is in its summon slots dies through `ctx.killActor` (they score, feed
 * the combo and roll drops like any kill; at most summonsPerLife per summoner). No other actor is touched: unrelated
 * swarmers, a boss's adds and other summoners' summons live on.
 *
 * Co-op: the actor phase binds the nearest living player (`ctx.player`); nothing else is special.
 *
 * View contract (EV9): states SUMMONER_KEEP (= STATE_ENGAGED) / AiState.TELEGRAPH / SUMMONER_BACKOFF; attack ids
 * SUMMONER_ATTACK_SUMMON (the cast) and SUMMONER_ATTACK_PANIC (the ring) while telegraphing; v slots SUMMONER_LEFT,
 * SUMMONER_SUMMON_FIRST .. + SUMMONER_SUMMON_SLOTS - 1 (summon ids), SUMMONER_STRAFE; `summonerSummonsAlive` counts its
 * live summons from the actor pool. The `ring` hint keys on aiState only, so it is also TELEGRAPH during the panic
 * wind-up: the view must draw the circle only while `attack === SUMMONER_ATTACK_SUMMON` (fillTicks = the summon
 * telegraph; the panic one is 30 ticks).
 *
 * @module
 */

import { secondsToTicks } from "../../../playerData";
import { rotateDir, type BurstSpec, type Dir } from "../../patterns";
import type { SimCtx } from "../../ctx";
import { adoptScoreRoomMember } from "../../../score/score";
import { enemyCooldown, walkStep } from "../actorMods";
import { faceToward, moveActor, toPlayer } from "../helpers";
import { PORT_BAND_ENEMIES, registerArchetype } from "../registry";
import { AiState, NO_KIND, type ActorState } from "../types";
import { BRUISER, GAP_TURNS } from "./bruiser";
import {
	STATE_ENGAGED,
	STEER,
	V_HOME_X,
	V_HOME_Z,
	alertOnDeath,
	engage,
	engageOnHit,
	initRoomEnemy,
	leash,
	shouldLeash,
	stepCalm,
	type RoomEnemyData,
} from "./enemyShared";
import { SWARMER } from "./swarmer";

/**
 * Tuning of the summoner: its keep range and strafe, the summon cast and its limits, and the panic ring. Distances in
 * world units, times in ticks.
 */
export interface SummonerData extends RoomEnemyData {
	/** Preferred distance band to the player (world units). */
	readonly keepMin: number;
	/** Far edge of the keep band (world units): it closes in on the player past this, only with line of sight. */
	readonly keepMax: number;
	/** Strafe direction flips after a random [min, max] ticks (or when a wall stops it). */
	readonly strafeFlipMin: number;
	/**
	 * Longest time before the strafe side flips (ticks, inclusive; one `ctx.randomInt` draw from the sim rng); the
	 * shortest is `strafeFlipMin`.
	 */
	readonly strafeFlipMax: number;
	/** Weight of the sideways component of the move (radial is 1). */
	readonly strafeWeight: number;
	/** Archetype id it summons. */
	readonly summonKind: string;
	/** Summon telegraph (the casting circle fills over it). */
	readonly summonTelegraphTicks: number;
	/** Ticks between casts (random in [min, max]), and before the first one (drawn at spawn). */
	readonly summonCooldownMin: number;
	/**
	 * Longest cooldown drawn at a summon decision, cast or skipped (ticks, inclusive); the shortest is
	 * `summonCooldownMin`.
	 */
	readonly summonCooldownMax: number;
	/** Shortest cooldown before its first decision, drawn at spawn (ticks, inclusive). */
	readonly firstSummonMin: number;
	/** Longest cooldown before its first decision, drawn at spawn (ticks, inclusive). */
	readonly firstSummonMax: number;
	/** EVD3: summons per cast, most of ITS summons alive at once (<= SUMMONER_SUMMON_SLOTS), summons per life. */
	readonly summonPerCast: number;
	/** Most of its own summons alive at once; a cast only tops up to this (and never past SUMMONER_SUMMON_SLOTS). */
	readonly summonMaxAlive: number;
	/** Most summons it makes in one life: v[SUMMONER_LEFT] starts here and counts down per summon. */
	readonly summonsPerLife: number;
	/** How far a summon is pushed out of its centre (world units). */
	readonly summonRadius: number;
	/** Panics when the player is this close (and in sight) as the cooldown runs out. */
	readonly panicRange: number;
	/** The panic's telegraph (ticks): it stands still this long before the panic ring fires. */
	readonly panicTelegraphTicks: number;
	/** Ticks until the next cast after a panic (random in [min, max]). */
	readonly panicCooldownMin: number;
	/** Longest cooldown drawn when it panics (ticks, inclusive); the shortest is `panicCooldownMin`. */
	readonly panicCooldownMax: number;
	/** The panic ring: the bruiser's (same spec object, same arc-table row). */
	readonly panicRing: BurstSpec;
	/** Walking straight away from the player after the panic ring. */
	readonly backoffTicks: number;
}

// --- States and attack ids
/** Keeping range: approach / back off / strafe, count down to the next cast. */
export const SUMMONER_KEEP = STATE_ENGAGED;
/** After the panic ring: walking away from the player for backoffTicks (aiTicks counts down). */
export const SUMMONER_BACKOFF = AiState.CUSTOM + 1;
/** ActorState.attack while telegraphing the summon (the casting circle). */
export const SUMMONER_ATTACK_SUMMON = 1;
/** ActorState.attack while telegraphing the panic ring. */
export const SUMMONER_ATTACK_PANIC = 2;

// --- v[] slots (0..2 shared)
/** Summons left this life (starts at summonsPerLife). */
export const SUMMONER_LEFT = 3;
/** Actor ids of its summons, SUMMONER_SUMMON_SLOTS slots from here (0 = empty). */
export const SUMMONER_SUMMON_FIRST = 4;
/**
 * How many v slots hold summon ids, from SUMMONER_SUMMON_FIRST: the hard cap on its summons alive at once, whatever
 * summonMaxAlive says.
 */
export const SUMMONER_SUMMON_SLOTS = 3;
/** Strafe side, +1 or -1. */
export const SUMMONER_STRAFE = 7;

const SUMMON_TELEGRAPH_SECONDS = 1;
/** Casting circle radius (render): where the summons land. */
const SUMMON_RADIUS = 1.2;
/** A move shorter than this fraction of the step means a wall: flip the strafe side (the sniper's rule). */
const STRAFE_BLOCKED = 0.3;
/** Coin flip for the first strafe side. */
const COIN = 0.5;
/** Exact 120-degree turn (no trig) between summons, as the bosses' summonAdds spaces its adds. */
const TURN120_COS = -0.5;
const TURN120_SIN = math.sqrt(3) / 2;
const dirScratch: Dir = { x: 0, z: 1 };

/**
 * The registered `summoner` archetype (band PORT_BAND_ENEMIES): its data and hooks; its death kills every summon it
 * still tracks.
 */
export const SUMMONER = registerArchetype<SummonerData>({
	id: "summoner",
	band: PORT_BAND_ENEMIES,
	data: {
		hp: 6,
		radius: 0.4,
		speed: 1.8,
		contactDamage: 0,
		spriteId: "enemy.summoner",
		roomEnemy: true,
		aggroRange: 9,
		leashRange: 15,
		lostTicks: 0, // unused: it hides on purpose, so losing sight never sends it home (only leashRange / a dead player)
		alertRange: 4.5,
		keepMin: 6,
		keepMax: 9,
		strafeFlipMin: secondsToTicks(0.8),
		strafeFlipMax: secondsToTicks(2.2),
		strafeWeight: 0.8,
		summonKind: SWARMER.id,
		summonTelegraphTicks: secondsToTicks(SUMMON_TELEGRAPH_SECONDS), // 60
		summonCooldownMin: secondsToTicks(4.5),
		summonCooldownMax: secondsToTicks(5.5),
		firstSummonMin: secondsToTicks(1),
		firstSummonMax: secondsToTicks(2),
		summonPerCast: 2,
		summonMaxAlive: 3,
		summonsPerLife: 6,
		summonRadius: SUMMON_RADIUS,
		panicRange: 3,
		panicTelegraphTicks: secondsToTicks(0.5), // 30
		panicCooldownMin: secondsToTicks(2),
		panicCooldownMax: secondsToTicks(2.8),
		panicRing: BRUISER.data.ring,
		backoffTicks: secondsToTicks(0.8),
		fx: {
			ring: {
				state: AiState.TELEGRAPH,
				radius: SUMMON_RADIUS,
				fillTicks: secondsToTicks(SUMMON_TELEGRAPH_SECONDS),
			},
		},
	},
	init(ctx, a) {
		initRoomEnemy(a);
		const d = ctx.data<SummonerData>(a);
		a.v[SUMMONER_LEFT] = d.summonsPerLife;
		a.v[SUMMONER_STRAFE] = ctx.random() < COIN ? -1 : 1;
		a.cooldown = enemyCooldown(ctx, a, d.firstSummonMin, d.firstSummonMax);
	},
	step(ctx, a) {
		const d = ctx.data<SummonerData>(a);
		if (stepCalm(ctx, a)) return;
		if (shouldLeash(ctx, a)) {
			leash(a);
			return;
		}
		if (a.aiState === AiState.TELEGRAPH) telegraphing(ctx, a, d);
		else if (a.aiState === SUMMONER_BACKOFF) backingOff(ctx, a, d);
		else keepRange(ctx, a, d);
	},
	onHit(ctx, a) {
		engageOnHit(ctx, a);
	},
	onDeath(ctx, a) {
		alertOnDeath(ctx, a);
		wither(ctx, a);
	},
});

/** The live actor carrying `id` (0 = none), or undefined (dead, freed, or the slot reused by another actor). */
function liveActorById(actors: ReadonlyArray<ActorState>, id: number): ActorState | undefined {
	if (id === 0) return undefined;
	for (let i = 0; i < actors.size(); i++) {
		const o = actors[i];
		if (o.id === id && o.kind !== NO_KIND && o.alive !== 0) return o;
	}
	return undefined;
}

/** How many of summoner `a`'s own summons (ids in its summon slots) are alive in `actors`. */
export function summonerSummonsAlive(actors: ReadonlyArray<ActorState>, a: Readonly<ActorState>): number {
	let n = 0;
	for (let k = 0; k < SUMMONER_SUMMON_SLOTS; k++) {
		if (liveActorById(actors, a.v[SUMMONER_SUMMON_FIRST + k]) !== undefined) n++;
	}
	return n;
}

/** How many it may summon right now: per cast, capped by the alive cap (and its id slots) and what is left. */
function summonRoom(ctx: SimCtx, a: Readonly<ActorState>, d: SummonerData): number {
	const cap = math.min(d.summonMaxAlive, SUMMONER_SUMMON_SLOTS);
	const n = math.min(d.summonPerCast, cap - summonerSummonsAlive(ctx.actors, a), a.v[SUMMONER_LEFT]);
	return n > 0 ? n : 0;
}

/** The first summon slot with no live actor (summonRoom > 0 guarantees one), or -1. */
function freeSummonSlot(actors: ReadonlyArray<ActorState>, a: Readonly<ActorState>): number {
	for (let k = 0; k < SUMMONER_SUMMON_SLOTS; k++) {
		const slot = SUMMONER_SUMMON_FIRST + k;
		if (liveActorById(actors, a.v[slot]) === undefined) return slot;
	}
	return -1;
}

function keepRange(ctx: SimCtx, a: ActorState, d: SummonerData): void {
	const p = ctx.player;
	const tp = toPlayer(ctx, a);
	const dist = tp.dist;
	const dirX = tp.dirX;
	const dirZ = tp.dirZ;
	const los = ctx.lineOfSight(a.x, a.z, p.x, p.z);
	if (a.cooldown > 0) a.cooldown--;
	if (a.cooldown <= 0) {
		if (los && dist <= d.panicRange) {
			faceToward(a, dirX, dirZ);
			a.cooldown = enemyCooldown(ctx, a, d.panicCooldownMin, d.panicCooldownMax);
			ctx.telegraph(a, d.panicTelegraphTicks, SUMMONER_ATTACK_PANIC);
			return;
		}
		// Drawn whether or not it can cast: the draw count never depends on how many summons live.
		a.cooldown = enemyCooldown(ctx, a, d.summonCooldownMin, d.summonCooldownMax);
		if (summonRoom(ctx, a, d) > 0) {
			faceToward(a, dirX, dirZ);
			ctx.telegraph(a, d.summonTelegraphTicks, SUMMONER_ATTACK_SUMMON);
			return;
		}
	}
	faceToward(a, dirX, dirZ);
	// Without sight it never closes in or strafes: it only backs off from a player inside keepMin.
	const radial = dist < d.keepMin ? -1 : los && dist > d.keepMax ? 1 : 0;
	const side = los ? a.v[SUMMONER_STRAFE] * d.strafeWeight : 0;
	// Perpendicular to the player direction: (-dirZ, dirX).
	let mx = dirX * radial - dirZ * side;
	let mz = dirZ * radial + dirX * side;
	const m2 = mx * mx + mz * mz;
	if (m2 > 1e-12) {
		const stepLen = walkStep(ctx, a);
		const k = stepLen / math.sqrt(m2);
		mx *= k;
		mz *= k;
		const x0 = a.x;
		const z0 = a.z;
		moveActor(ctx, a, mx, mz);
		const ox = a.x - x0;
		const oz = a.z - z0;
		if (side !== 0 && ox * ox + oz * oz < stepLen * stepLen * STRAFE_BLOCKED * STRAFE_BLOCKED) {
			a.v[SUMMONER_STRAFE] = -a.v[SUMMONER_STRAFE];
		}
	}
	a.aiTicks -= 1;
	if (a.aiTicks <= 0) {
		a.v[SUMMONER_STRAFE] = -a.v[SUMMONER_STRAFE];
		a.aiTicks = ctx.randomInt(d.strafeFlipMin, d.strafeFlipMax);
	}
}

function telegraphing(ctx: SimCtx, a: ActorState, d: SummonerData): void {
	const tp = toPlayer(ctx, a);
	const dirX = tp.dirX;
	const dirZ = tp.dirZ;
	faceToward(a, dirX, dirZ);
	a.aiTicks -= 1;
	if (a.aiTicks > 0) return;
	if (a.attack === SUMMONER_ATTACK_PANIC) {
		panicRing(ctx, a, d, dirX, dirZ);
		a.aiState = SUMMONER_BACKOFF;
		a.aiTicks = d.backoffTicks;
	} else {
		summon(ctx, a, d, dirX, dirZ);
		resumeKeep(ctx, a, d);
	}
	a.attack = 0;
}

function resumeKeep(ctx: SimCtx, a: ActorState, d: SummonerData): void {
	a.aiState = SUMMONER_KEEP;
	a.aiTicks = ctx.randomInt(d.strafeFlipMin, d.strafeFlipMax);
}

/** The bruiser's gapped ring: the gap is the player's bearing (dirX, dirZ) turned by one GAP_TURNS draw. */
function panicRing(ctx: SimCtx, a: ActorState, d: SummonerData, dirX: number, dirZ: number): void {
	const turn = GAP_TURNS[ctx.randomInt(0, GAP_TURNS.size() - 1)];
	rotateDir(dirX, dirZ, turn[0], turn[1], dirScratch);
	ctx.fireEnemy(a, -dirScratch.x, -dirScratch.z, d.panicRing);
}

/** Summons what summonRoom allows, bursting out along (dirX, dirZ) and 120-degree turns of it. */
function summon(ctx: SimCtx, a: ActorState, d: SummonerData, dirX: number, dirZ: number): void {
	const n = summonRoom(ctx, a, d);
	let x = dirX;
	let z = dirZ;
	for (let i = 0; i < n; i++) {
		const slot = freeSummonSlot(ctx.actors, a);
		if (slot < 0) return;
		const s = ctx.spawnActor(d.summonKind, a.x, a.z);
		if (s !== undefined) {
			moveActor(ctx, s, x * d.summonRadius, z * d.summonRadius); // prevX / prevZ stay on it: drawn bursting out
			s.v[V_HOME_X] = s.x;
			s.v[V_HOME_Z] = s.z;
			engage(s);
			adoptScoreRoomMember(ctx.state, a, s);
			a.v[slot] = s.id;
			a.v[SUMMONER_LEFT] -= 1;
		} // else: the actor pool is full (actorsDropped counted it); the summon costs nothing
		rotateDir(x, z, TURN120_COS, TURN120_SIN, dirScratch);
		x = dirScratch.x;
		z = dirScratch.z;
	}
}

function backingOff(ctx: SimCtx, a: ActorState, d: SummonerData): void {
	const tp = toPlayer(ctx, a);
	const dirX = tp.dirX;
	const dirZ = tp.dirZ;
	faceToward(a, dirX, dirZ);
	const stepLen = walkStep(ctx, a);
	moveActor(ctx, a, -dirX * stepLen, -dirZ * stepLen, STEER);
	a.aiTicks -= 1;
	if (a.aiTicks <= 0) resumeKeep(ctx, a, d);
}

/** onDeath: every live summon of its own (by id) dies with it, through killActor. */
function wither(ctx: SimCtx, a: ActorState): void {
	for (let k = 0; k < SUMMONER_SUMMON_SLOTS; k++) {
		const slot = SUMMONER_SUMMON_FIRST + k;
		const o = liveActorById(ctx.actors, a.v[slot]);
		a.v[slot] = 0;
		if (o !== undefined) ctx.killActor(o);
	}
}

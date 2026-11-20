/**
 * 'pyrekeeper' (Roblox port, docs/NEW_ENEMIES_2.md "Design > Pyre-keeper and pyre", NX5; no web source): a hooded
 * demon with a torch staff that hangs back and lights braziers (`pyre`, ./pyre.ts) around the room; they go out when
 * it dies. 6 hp, contact damage 0. At most one per room (NX6).
 *
 * Keep range (the summoner's): keeps keepMin-keepMax from its target (the nearest living player, so from every living
 * player): backs off inside keepMin, closes in past keepMax only in sight, strafes in sight (side v[PYREKEEPER_STRAFE],
 * flipped when a wall stops it and every strafeFlipMin-Max ticks, aiTicks counting it down).
 *
 * A decision each time the cooldown runs out:
 *   PANIC (the summoner's): its target in sight within panicRange -> one cooldown draw (panicCooldownMin-Max), the
 *     telegraph panicTelegraphTicks (attack PYREKEEPER_ATTACK_PANIC, v[PYREKEEPER_PANIC] 1), the bruiser's gapped ring
 *     (one GAP_TURNS draw), then PYREKEEPER_BACKOFF for backoffTicks; the latch clears when it keeps range again.
 *   LIGHT otherwise: exactly TWO draws, always (the cooldown lightCooldownMin-Max, then the start index 0..7), whether
 *     or not it can cast, so the draw count never depends on its pyres or the layout. It casts when fewer than
 *     maxAlive of its pyres live (`pyrekeeperPyresAlive`, a pool scan) and fewer than perLife were lit this life
 *     (v[PYREKEEPER_LIT]): the landing point (`pyrekeeperLanding`) is the first of the eight landingOffsets (unit
 *     literals) at landingDistance from its target, tried in order from the start index, whose cell is valid (cell
 *     centre: FLOOR, so no wall / void / pool / solid decor; no intact piece; no pellet still in play; in the room
 *     holding its home, as the imp's blink; >= landingPlayerClear from every living player and >= landingPyreClear from
 *     every living pyre, any keeper's). None valid: the cast is spent with no pyre and no telegraph. Found: v[PYREKEEPER_LAND_X / _Z] =
 *     the cell centre, the telegraph lightTelegraphTicks (attack PYREKEEPER_ATTACK_LIGHT, the `ring` hint), then the
 *     pyre spawns there (`lightPyre`; v[PYREKEEPER_LIT] + 1, SimEvents.pyresLanded) with its keeper id, a free stagger
 *     slot and its first shot aligned on its living siblings' period (`staggerDelay`). Not re-validated at the spawn: a
 *     player walking onto the point meanwhile is harmless (actors do not block). A full actor pool costs nothing (not
 *     counted, like the summoner's summons).
 * Killed mid-telegraph, the cast is spent: no pyre (onDeath clears `attack`, so the ring hint stops).
 * Death (onDeath): every living pyre whose v[PYRE_KEEPER] is its id withers through ctx.killActor (scored like a kill,
 * the combo fed, no drop roll: the pyre is drop-ineligible; SimEvents.pyresWithered). Its room cannot clear before it
 * dies (it is a member), so its pyres never outlive its room's clear.
 *
 * Its pyres are found from the pool (`kind === pyre && v[PYRE_KEEPER] === id`), not from slots of its own: actor ids
 * are never reused in a run, so the link is exact, and the slots hold the landing point instead (docs/NEW_ENEMIES_2.md
 * NX0 findings). The pool is scanned only at a decision, a spawn and the death.
 *
 * Draws (main stream): the first light cooldown in init (the strafe side comes from the actor id, no draw), two per
 * light decision, two per panic, one per timed strafe flip (and one when it resumes keeping range).
 *
 * View contract: states PYREKEEPER_KEEP (= STATE_ENGAGED) / AiState.TELEGRAPH (the light or the panic) /
 * PYREKEEPER_BACKOFF; attack ids PYREKEEPER_ATTACK_LIGHT / PYREKEEPER_ATTACK_PANIC; v slots PYREKEEPER_LIT (pyres lit
 * this life), PYREKEEPER_LAND_X / _Z (the landing point while the light telegraphs), PYREKEEPER_STRAFE (+1 / -1),
 * PYREKEEPER_PANIC (1 from the panic telegraph to the end of the back-off). The `ring` hint keys on aiState: draw it
 * only while `attack === PYREKEEPER_ATTACK_LIGHT`.
 *
 * @module
 */

import { cellKey, gridToWorld, worldToGrid } from "shared/dungeon";
import { secondsToTicks } from "../../../playerData";
import { partySize, playerAt } from "../../../party";
import { solidCells } from "../../../breakables/cells";
import { PELLET_STOLEN } from "../../../pellets/pelletsData";
import { rotateDir, type BurstSpec, type Dir } from "../../patterns";
import type { SimCtx } from "../../ctx";
import { enemyCooldown, walkStep } from "../actorMods";
import { faceToward, moveActor, toPlayer } from "../helpers";
import { PORT_BAND_ENEMIES_3, archetypeIndex, registerArchetype } from "../registry";
import { AiState, type ActorState } from "../types";
import { BRUISER, GAP_TURNS } from "./bruiser";
import {
	STATE_ENGAGED,
	STEER,
	V_HOME_X,
	V_HOME_Z,
	alertOnDeath,
	engageOnHit,
	initRoomEnemy,
	leash,
	shouldLeash,
	stepCalm,
	type RoomEnemyData,
} from "./enemyShared";
import { PYRE, PYRE_FIRE, PYRE_KEEPER, PYRE_STAGGER } from "./pyre";

export interface PyrekeeperData extends RoomEnemyData {
	/** Preferred distance band to every living player (world units). */
	readonly keepMin: number;
	readonly keepMax: number;
	/** Strafe direction flips after a random [min, max] ticks (or when a wall stops it). */
	readonly strafeFlipMin: number;
	readonly strafeFlipMax: number;
	/** Weight of the sideways component of the move (radial is 1). */
	readonly strafeWeight: number;
	/** Archetype id it lights. */
	readonly pyreKind: string;
	/** Most of ITS pyres alive at once, and pyres per life. */
	readonly maxAlive: number;
	readonly perLife: number;
	/** Ticks between casts (random in [min, max], `enemyCooldown`; the first drawn at spawn). */
	readonly lightCooldownMin: number;
	readonly lightCooldownMax: number;
	/** The light's telegraph (the ring on the landing point fills over it). */
	readonly lightTelegraphTicks: number;
	readonly landingRingRadius: number;
	/** The landing points: LANDING_OFFSETS (unit vectors) at this distance from its target (world units). */
	readonly landingDistance: number;
	readonly landingOffsets: ReadonlyArray<readonly [number, number]>;
	/** A landing point keeps at least this far from every living player and from its other pyres (world units). */
	readonly landingPlayerClear: number;
	readonly landingPyreClear: number;
	/** Panics when a living player is this close (and in sight) as the cooldown runs out. */
	readonly panicRange: number;
	readonly panicTelegraphTicks: number;
	/** Ticks until the next cast after a panic (random in [min, max]). */
	readonly panicCooldownMin: number;
	readonly panicCooldownMax: number;
	/** The panic ring: the bruiser's (same spec object, same arc-table row). */
	readonly panicRing: BurstSpec;
	/** Walking straight away from the player after the panic ring. */
	readonly backoffTicks: number;
}

// --- States and attack ids
/** Keeping range. */
export const PYREKEEPER_KEEP = STATE_ENGAGED;
/** After the panic ring: walking away from the player for backoffTicks. */
export const PYREKEEPER_BACKOFF = AiState.CUSTOM + 1;
/** ActorState.attack while telegraphing the light (the ring on the landing point). */
export const PYREKEEPER_ATTACK_LIGHT = 1;
/** ActorState.attack while telegraphing the panic ring. */
export const PYREKEEPER_ATTACK_PANIC = 2;

// --- v[] slots (0..2 shared)
/** Pyres lit this life (perLife caps it). */
export const PYREKEEPER_LIT = 3;
/** The landing point (world), valid while the light telegraphs. */
export const PYREKEEPER_LAND_X = 4;
export const PYREKEEPER_LAND_Z = 5;
/** Strafe side, +1 or -1. */
export const PYREKEEPER_STRAFE = 6;
/** Panic latch (1 while a panic is pending / running). */
export const PYREKEEPER_PANIC = 7;

/** sqrt(1/2) as a literal (the diagonal compass points; no trig in the sim). */
const DIAGONAL = 0.7071067811865476;
/**
 * The eight compass landing directions (unit vectors), in the order a cast tries them from its drawn start index: N,
 * NE, E, SE, S, SW, W, NW (world +Z is north).
 */
export const PYREKEEPER_LANDING_OFFSETS: ReadonlyArray<readonly [number, number]> = [
	[0, 1],
	[DIAGONAL, DIAGONAL],
	[1, 0],
	[DIAGONAL, -DIAGONAL],
	[0, -1],
	[-DIAGONAL, -DIAGONAL],
	[-1, 0],
	[-DIAGONAL, DIAGONAL],
];
const LIGHT_TELEGRAPH_SECONDS = 0.8;
/** A move shorter than this fraction of the step means a wall: flip the strafe side (the summoner's rule). */
const STRAFE_BLOCKED = 0.3;
const dirScratch: Dir = { x: 0, z: 1 };
const LANDING_RING_RADIUS = 0.8;

export const PYREKEEPER = registerArchetype<PyrekeeperData>({
	id: "pyrekeeper",
	band: PORT_BAND_ENEMIES_3,
	data: {
		hp: 6,
		radius: 0.35,
		speed: 2.4,
		contactDamage: 0,
		spriteId: "enemy.pyrekeeper",
		roomEnemy: true,
		aggroRange: 9,
		leashRange: 15,
		lostTicks: 0, // unused, like the summoner's: it hangs back on purpose, so losing sight never sends it home
		alertRange: 4.5,
		keepMin: 6,
		keepMax: 9,
		strafeFlipMin: secondsToTicks(0.8),
		strafeFlipMax: secondsToTicks(2.2),
		strafeWeight: 0.8,
		pyreKind: PYRE.id,
		maxAlive: 3,
		perLife: 6,
		lightCooldownMin: secondsToTicks(4),
		lightCooldownMax: secondsToTicks(5),
		lightTelegraphTicks: secondsToTicks(LIGHT_TELEGRAPH_SECONDS), // 48
		landingRingRadius: LANDING_RING_RADIUS,
		landingDistance: 3.5,
		landingOffsets: PYREKEEPER_LANDING_OFFSETS,
		landingPlayerClear: 2,
		landingPyreClear: 2,
		panicRange: 2.5,
		panicTelegraphTicks: secondsToTicks(0.5), // 30
		panicCooldownMin: secondsToTicks(2),
		panicCooldownMax: secondsToTicks(2.8),
		panicRing: BRUISER.data.ring,
		backoffTicks: secondsToTicks(0.8),
		fx: {
			ring: {
				state: AiState.TELEGRAPH,
				xSlot: PYREKEEPER_LAND_X,
				zSlot: PYREKEEPER_LAND_Z,
				radius: LANDING_RING_RADIUS,
				fillTicks: secondsToTicks(LIGHT_TELEGRAPH_SECONDS),
				attack: PYREKEEPER_ATTACK_LIGHT,
			},
		},
	},
	init(ctx, a) {
		initRoomEnemy(a);
		const d = ctx.data<PyrekeeperData>(a);
		a.v[PYREKEEPER_LIT] = 0;
		a.v[PYREKEEPER_STRAFE] = a.id % 2 === 0 ? 1 : -1; // no draw: init draws the first cooldown only
		a.v[PYREKEEPER_PANIC] = 0;
		a.cooldown = enemyCooldown(ctx, a, d.lightCooldownMin, d.lightCooldownMax);
	},
	step(ctx, a) {
		const d = ctx.data<PyrekeeperData>(a);
		if (stepCalm(ctx, a)) return;
		if (shouldLeash(ctx, a)) {
			leash(a);
			a.v[PYREKEEPER_PANIC] = 0;
			return;
		}
		if (a.aiState === AiState.TELEGRAPH) telegraphing(ctx, a, d);
		else if (a.aiState === PYREKEEPER_BACKOFF) backingOff(ctx, a, d);
		else keepRange(ctx, a, d);
	},
	onHit(ctx, a) {
		engageOnHit(ctx, a);
	},
	onDeath(ctx, a) {
		alertOnDeath(ctx, a);
		a.attack = 0; // a light telegraph is spent: no pyre, no ring
		wither(ctx, a);
	},
});

/** True when actor `o` is a living pyre of keeper `keeperId`. */
function isPyreOf(o: Readonly<ActorState>, pyreKind: number, keeperId: number): boolean {
	return o.kind === pyreKind && o.alive !== 0 && o.v[PYRE_KEEPER] === keeperId;
}

/** How many of keeper `a`'s pyres are alive in `actors` (a pool scan). */
export function pyrekeeperPyresAlive(actors: ReadonlyArray<ActorState>, a: Readonly<ActorState>): number {
	const kind = archetypeIndex(PYRE.id);
	let n = 0;
	for (let i = 0; i < actors.size(); i++) if (isPyreOf(actors[i], kind, a.id)) n++;
	return n;
}

/** True when keeper `a` may light one more pyre now (alive cap and per-life cap). */
function canLight(ctx: SimCtx, a: Readonly<ActorState>, d: PyrekeeperData): boolean {
	return a.v[PYREKEEPER_LIT] < d.perLife && pyrekeeperPyresAlive(ctx.actors, a) < d.maxAlive;
}

/** True when grid cell (gx, gz) blocks a body (the floor's world: walls, void, pools, solid decor) or holds an intact piece. */
function cellBlocked(ctx: SimCtx, gx: number, gz: number): boolean {
	if (ctx.isBodyBlocked(gridToWorld(gx), gridToWorld(gz))) return true;
	const solid = solidCells(ctx.state);
	return solid !== undefined && solid.has(cellKey(gx, gz));
}

/** True when grid cell (gx, gz) holds a pellet still in play (on the floor, or carried by a Snatcher: it may return). */
function pelletCell(ctx: SimCtx, gx: number, gz: number): boolean {
	const p = ctx.state.pellets;
	if (p === undefined) return false;
	const i = p.byCell.get(cellKey(gx, gz));
	if (i === undefined) return false;
	const taken = p.taken[i];
	return taken === 0 || taken === PELLET_STOLEN;
}

/**
 * True when (x, z) keeps at least `clear` from every living player and from every living pyre, any keeper's (two
 * keepers can share a room: a Horde's second wave copies one).
 */
function landingClear(ctx: SimCtx, d: PyrekeeperData, x: number, z: number): boolean {
	const n = partySize(ctx.state);
	const p2 = d.landingPlayerClear * d.landingPlayerClear;
	for (let i = 0; i < n; i++) {
		const p = playerAt(ctx.state, i);
		if (p.dead !== 0) continue;
		const dx = p.x - x;
		const dz = p.z - z;
		if (dx * dx + dz * dz < p2) return false;
	}
	const kind = archetypeIndex(PYRE.id);
	const q2 = d.landingPyreClear * d.landingPyreClear;
	const actors = ctx.actors;
	for (let i = 0; i < actors.size(); i++) {
		const o = actors[i];
		if (o.kind !== kind || o.alive === 0) continue;
		const dx = o.x - x;
		const dz = o.z - z;
		if (dx * dx + dz * dz < q2) return false;
	}
	return true;
}

/** The landing rules (file header) for grid cell (gx, gz) of keeper `a`. */
export function pyrekeeperLandingValid(ctx: SimCtx, a: Readonly<ActorState>, gx: number, gz: number): boolean {
	if (cellBlocked(ctx, gx, gz) || pelletCell(ctx, gx, gz)) return false;
	const x = gridToWorld(gx);
	const z = gridToWorld(gz);
	const home = ctx.roomAt(a.v[V_HOME_X], a.v[V_HOME_Z]);
	const there = ctx.roomAt(x, z);
	if (home === undefined ? there !== undefined : there === undefined || there.id !== home.id) return false;
	return landingClear(ctx, ctx.data<PyrekeeperData>(a), x, z);
}

/**
 * The landing cell from start index `start` (0..7): writes its centre into v[PYREKEEPER_LAND_X / _Z] and returns true,
 * or false (nothing written) when none of the eight is valid. No draw.
 */
export function pyrekeeperLanding(ctx: SimCtx, a: ActorState, start: number): boolean {
	const d = ctx.data<PyrekeeperData>(a);
	const t = ctx.player;
	const offsets = d.landingOffsets;
	const n = offsets.size();
	for (let k = 0; k < n; k++) {
		const o = offsets[(start + k) % n];
		const gx = worldToGrid(t.x + o[0] * d.landingDistance);
		const gz = worldToGrid(t.z + o[1] * d.landingDistance);
		if (!pyrekeeperLandingValid(ctx, a, gx, gz)) continue;
		a.v[PYREKEEPER_LAND_X] = gridToWorld(gx);
		a.v[PYREKEEPER_LAND_Z] = gridToWorld(gz);
		return true;
	}
	return false;
}

/** ((x mod m) + m) mod m: a non-negative remainder in TS and Luau alike. */
function mod(x: number, m: number): number {
	return ((x % m) + m) % m;
}

/**
 * The new pyre's stagger: its slot (the lowest of 0..maxAlive-1 no living pyre of `a` holds) and the ticks to its first
 * shot (>= litTicks), so it fires shotStaggerTicks x (slot - their slot) after a living sibling on the shared fireTicks
 * period (the first sibling in slot order is the reference; none: litTicks, the shot on the tick it lights). A sibling
 * that has not stepped yet this tick (its slot after the keeper's) fires one tick sooner than its counter reads.
 * Writes the pair into `out` ([slot, ticks]).
 */
function staggerDelay(ctx: SimCtx, a: Readonly<ActorState>, d: PyrekeeperData, out: [number, number]): void {
	const pd = PYRE.data;
	const kind = archetypeIndex(PYRE.id);
	const actors = ctx.actors;
	let used = 0;
	let ref: ActorState | undefined;
	let refIndex = -1;
	for (let i = 0; i < actors.size(); i++) {
		const o = actors[i];
		if (!isPyreOf(o, kind, a.id)) continue;
		used = used | (1 << o.v[PYRE_STAGGER]);
		if (ref === undefined) {
			ref = o;
			refIndex = i;
		}
	}
	let slot = 0;
	while (slot < d.maxAlive - 1 && (used & (1 << slot)) !== 0) slot++;
	out[0] = slot;
	if (ref === undefined) {
		out[1] = pd.litTicks;
		return;
	}
	const keeperIndex = actors.indexOf(a as ActorState);
	const stepped = refIndex < keeperIndex && ref.spawnTick !== ctx.tick;
	const refNext = stepped ? ref.v[PYRE_FIRE] : ref.v[PYRE_FIRE] - 1;
	const want = refNext + (slot - ref.v[PYRE_STAGGER]) * pd.shotStaggerTicks;
	out[1] = pd.litTicks + mod(want - pd.litTicks, pd.fireTicks);
}
const staggerOut: [number, number] = [0, 0];

/** Spawns its pyre on the landing point (the end of the light telegraph). */
function lightPyre(ctx: SimCtx, a: ActorState, d: PyrekeeperData): void {
	staggerDelay(ctx, a, d, staggerOut);
	const s = ctx.spawnActor(d.pyreKind, a.v[PYREKEEPER_LAND_X], a.v[PYREKEEPER_LAND_Z]);
	if (s === undefined) return; // the actor pool is full (actorsDropped counted it): the cast costs nothing
	s.v[PYRE_KEEPER] = a.id;
	s.v[PYRE_STAGGER] = staggerOut[0];
	s.v[PYRE_FIRE] = staggerOut[1];
	a.v[PYREKEEPER_LIT] += 1;
	ctx.events.pyresLanded += 1;
}

function keepRange(ctx: SimCtx, a: ActorState, d: PyrekeeperData): void {
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
			a.v[PYREKEEPER_PANIC] = 1;
			ctx.telegraph(a, d.panicTelegraphTicks, PYREKEEPER_ATTACK_PANIC);
			return;
		}
		// Both drawn at every light decision: the draw count never depends on its pyres or the layout.
		a.cooldown = enemyCooldown(ctx, a, d.lightCooldownMin, d.lightCooldownMax);
		const start = ctx.randomInt(0, d.landingOffsets.size() - 1);
		if (canLight(ctx, a, d) && pyrekeeperLanding(ctx, a, start)) {
			faceToward(a, a.v[PYREKEEPER_LAND_X] - a.x, a.v[PYREKEEPER_LAND_Z] - a.z);
			ctx.telegraph(a, d.lightTelegraphTicks, PYREKEEPER_ATTACK_LIGHT);
			return;
		}
	}
	faceToward(a, dirX, dirZ);
	// Without sight it never closes in or strafes: it only backs off from a player inside keepMin.
	const radial = dist < d.keepMin ? -1 : los && dist > d.keepMax ? 1 : 0;
	const side = los ? a.v[PYREKEEPER_STRAFE] * d.strafeWeight : 0;
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
			a.v[PYREKEEPER_STRAFE] = -a.v[PYREKEEPER_STRAFE];
		}
	}
	a.aiTicks -= 1;
	if (a.aiTicks <= 0) {
		a.v[PYREKEEPER_STRAFE] = -a.v[PYREKEEPER_STRAFE];
		a.aiTicks = ctx.randomInt(d.strafeFlipMin, d.strafeFlipMax);
	}
}

function telegraphing(ctx: SimCtx, a: ActorState, d: PyrekeeperData): void {
	if (a.attack === PYREKEEPER_ATTACK_LIGHT) {
		faceToward(a, a.v[PYREKEEPER_LAND_X] - a.x, a.v[PYREKEEPER_LAND_Z] - a.z);
	} else {
		const tp = toPlayer(ctx, a);
		faceToward(a, tp.dirX, tp.dirZ);
	}
	a.aiTicks -= 1;
	if (a.aiTicks > 0) return;
	if (a.attack === PYREKEEPER_ATTACK_PANIC) {
		const tp = toPlayer(ctx, a);
		panicRing(ctx, a, d, tp.dirX, tp.dirZ);
		a.aiState = PYREKEEPER_BACKOFF;
		a.aiTicks = d.backoffTicks;
	} else {
		lightPyre(ctx, a, d);
		resumeKeep(ctx, a, d);
	}
	a.attack = 0;
}

function resumeKeep(ctx: SimCtx, a: ActorState, d: PyrekeeperData): void {
	a.aiState = PYREKEEPER_KEEP;
	a.aiTicks = ctx.randomInt(d.strafeFlipMin, d.strafeFlipMax);
	a.v[PYREKEEPER_PANIC] = 0;
}

/** The bruiser's gapped ring: the gap is the player's bearing (dirX, dirZ) turned by one GAP_TURNS draw. */
function panicRing(ctx: SimCtx, a: ActorState, d: PyrekeeperData, dirX: number, dirZ: number): void {
	const turn = GAP_TURNS[ctx.randomInt(0, GAP_TURNS.size() - 1)];
	rotateDir(dirX, dirZ, turn[0], turn[1], dirScratch);
	ctx.fireEnemy(a, -dirScratch.x, -dirScratch.z, d.panicRing);
}

function backingOff(ctx: SimCtx, a: ActorState, d: PyrekeeperData): void {
	const tp = toPlayer(ctx, a);
	const dirX = tp.dirX;
	const dirZ = tp.dirZ;
	faceToward(a, dirX, dirZ);
	const stepLen = walkStep(ctx, a);
	moveActor(ctx, a, -dirX * stepLen, -dirZ * stepLen, STEER);
	a.aiTicks -= 1;
	if (a.aiTicks <= 0) resumeKeep(ctx, a, d);
}

/** onDeath: every living pyre that names it withers, through killActor (a pool scan, slot order). */
function wither(ctx: SimCtx, a: ActorState): void {
	const kind = archetypeIndex(PYRE.id);
	const actors = ctx.actors;
	for (let i = 0; i < actors.size(); i++) {
		const o = actors[i];
		if (!isPyreOf(o, kind, a.id)) continue;
		ctx.events.pyresWithered += 1;
		ctx.killActor(o);
	}
}

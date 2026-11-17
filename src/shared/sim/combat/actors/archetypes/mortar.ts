/**
 * 'mortar' (Roblox port, docs/NEW_ENEMIES_3.md "Design > Mortar", NT2; no web source): a lean demon at the back of the
 * room that lobs a shell over walls and pillars at where its target is heading; the shell lands as one STRIKE and
 * bursts into a guardable shrapnel ring. 4 hp, contact damage 0. Built from the Stormcaller's shape (keep range, strafe,
 * STRIKE) and the Bomber's (a ring from a point); a copy, never an import of their steps.
 *
 *   1. Keeping range (MORTAR_KEEP): keeps keepMin-keepMax (6-9, NT0 finding 12) from its target WITHOUT line of sight
 *      (it fires over cover): approach / back off / strafe (the strafe side flips when a wall stops it and after every
 *      lob: no draw); within tooClose (3) it backs straight off at its walk speed and never lobs. It stays in its own
 *      room: a move that would take it out of the room is undone (the strafe side flips); standing outside it (a Siege
 *      pin dragged it) it walks home. It leashes only by home distance (shouldLeash), never for lost sight (NTD3).
 *   2. Lob (cooldown out, the target in the Mortar's room, within lobRange 10 and at least tooClose away): ONE
 *      enemyCooldown draw for the next lob, then the draw (ctx.telegraph drawTicks, MORTAR_ATTACK_LOB), standing still
 *      facing its target.
 *   3. Release (the draw's last tick): if the target has left the room the lob is called off (the cooldown stays
 *      spent: NTD3, it never fires at a target outside its room). Else the landing point is fixed: the target + its last
 *      tick's motion (x - prevX, z - prevZ; NT0 finding 7: the walk or roll step, never a teleport) x leadTicks, the lead
 *      clamped to maxLead (one sqrt). A point whose cell is not floor (ctx.isBodyBlocked: wall, void, pool, solid decor;
 *      or an intact piece's cell, solidCells; NT0 finding 5) falls back to the target's own position. No draw. Then the
 *      flight (MORTAR_FLIGHT, flightTicks): v[MORTAR_FLIGHT_TICKS] counts down (aiTicks with it, so the `ring` hint
 *      fills), the Mortar keeps range meanwhile (no lob) and does not leash until the shell has landed.
 *   4. Impact (the flight's last tick): one `shell` STRIKE at the point (the Stormcaller's rules: no grazes, never
 *      erased, hurts HIT_NORMAL once; counted in events.strikes AND events.shells), then the `shrapnel` ring (6 @
 *      FULL_RING, ordinary enemy bullets: walls and pieces stop them, the guard erases them, they graze) from the point
 *      along the Mortar's facing. Back to keeping range.
 *   5. Dead mid-flight (NTD5, NT0 finding 6): stepCorpse counts the flight down on the corpse and lands the shell on its
 *      planned tick, holding the slot until then; after that the corpse timer frees it as usual. Not a reviver (no
 *      stepDead): score, Vampire Fang and drops see an ordinary kill. A Siege-pinned living Mortar does not step, so its
 *      flight waits while pinned (the ring holds).
 *
 * Room test (NTD3, NT0 finding 10): the room is that of the Mortar's home (its spawn cell) by config.roomIdAt (the
 * exact cell rule: a doorway or corridor cell is outside); without the callback, or a home outside every room, the
 * encounter room whose rectangle holds the home (ctx.roomAt); with no such room (an arena without rooms) everywhere
 * counts as inside. In co-op the target is the nearest living player (NT0 finding 15).
 *
 * Draws: init 1 (the first lob's cooldown, enemyCooldown); each lob 1 (the next cooldown), at the draw's start. The
 * landing point, the fallback and the corpse use no draw, so the draw count never depends on the layout.
 *
 * View contract: states MORTAR_KEEP (= STATE_ENGAGED) / AiState.TELEGRAPH (the draw) / MORTAR_FLIGHT (living or a
 * corpse); attack id MORTAR_ATTACK_LOB (the draw and the flight); v slots MORTAR_LAND_X / _Z (the landing point),
 * MORTAR_FLIGHT_TICKS (flight ticks left), MORTAR_STRAFE (+1 / -1). The impact tick is the one whose events.shells > 0;
 * the shell's payload source is the Mortar's kind + 1.
 */

import { HIT_NORMAL, secondsToTicks } from "../../../playerData";
import { SIM_DT } from "../../../units";
import { solidCells } from "../../../breakables/cells";
import { cellKey, worldToGrid } from "shared/dungeon";
import { STRIKE_BULLET_RADIUS } from "../../combatData";
import { BulletKind, FULL_RING, type BurstSpec } from "../../patterns";
import type { SimCtx } from "../../ctx";
import { enemyCooldown, walkStep } from "../actorMods";
import { faceToward, moveActor, toPlayer, walkToward } from "../helpers";
import { PORT_BAND_ENEMIES_4, registerArchetype } from "../registry";
import { AiState, type ActorState } from "../types";
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
/** A move shorter than this fraction of the step means a wall: flip the strafe side. */
const STRAFE_BLOCKED = 0.3;

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
	init(ctx, a) {
		initRoomEnemy(a);
		const d = ctx.data<MortarData>(a);
		// No draw for the side: alternate by actor id (the stormcaller's rule). One draw: the first lob's cooldown.
		a.v[MORTAR_STRAFE] = a.id % 2 === 0 ? 1 : -1;
		a.cooldown = enemyCooldown(ctx, a, d.lobCooldownMin, d.lobCooldownMax);
	},
	step(ctx, a) {
		const d = ctx.data<MortarData>(a);
		// A shell in the air lands whatever else happens (no leash, no calm state until it has).
		if (a.aiState === MORTAR_FLIGHT) {
			flight(ctx, a, d);
			return;
		}
		if (stepCalm(ctx, a)) return;
		if (shouldLeash(ctx, a)) {
			leash(a);
			return;
		}
		if (a.aiState === AiState.TELEGRAPH) drawing(ctx, a, d);
		else keepRange(ctx, a, d, true);
	},
	stepCorpse(ctx, a) {
		// NTD5: the corpse finishes the flight and lands the shell on its planned tick, holding the slot until then.
		if (a.aiState !== MORTAR_FLIGHT || a.v[MORTAR_FLIGHT_TICKS] <= 0) return false;
		if (!countFlight(a)) return true;
		landShell(ctx, a, ctx.data<MortarData>(a));
		return false;
	},
	onHit(ctx, a) {
		engageOnHit(ctx, a);
	},
	onDeath(ctx, a) {
		alertOnDeath(ctx, a); // a shell in the air still lands (stepCorpse)
	},
});

/**
 * True when (x, z) is inside the Mortar's own room (NTD3; the file comment's room test): the exact cell rule by
 * config.roomIdAt when the home is in a room, else the encounter rectangle holding the home, else (no room at all)
 * true.
 */
export function mortarRoomHolds(ctx: SimCtx, a: Readonly<ActorState>, x: number, z: number): boolean {
	const hx = a.v[V_HOME_X];
	const hz = a.v[V_HOME_Z];
	if (ctx.config.roomIdAt !== undefined) {
		const room = ctx.roomIdAt(hx, hz);
		if (room >= 0) return ctx.roomIdAt(x, z) === room;
	}
	const r = ctx.roomAt(hx, hz);
	if (r === undefined) return true;
	return x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
}

/**
 * True when a shell may land at world (x, z): the cell is floor a body could stand on (not ctx.isBodyBlocked: wall,
 * void, pool, solid decor) and holds no intact piece (solidCells). NT0 finding 5.
 */
export function mortarPointOpen(ctx: SimCtx, x: number, z: number): boolean {
	if (ctx.isBodyBlocked(x, z)) return false;
	const solid = solidCells(ctx.state);
	return solid === undefined || !solid.has(cellKey(worldToGrid(x), worldToGrid(z)));
}

/** Starts a lob: ONE cooldown draw (the next lob's), then the draw's telegraph. */
function startLob(ctx: SimCtx, a: ActorState, d: MortarData, dirX: number, dirZ: number): void {
	a.cooldown = enemyCooldown(ctx, a, d.lobCooldownMin, d.lobCooldownMax);
	faceToward(a, dirX, dirZ);
	ctx.telegraph(a, d.drawTicks, MORTAR_ATTACK_LOB);
}

/** The draw: stands still facing its target; on the last tick the release (or the call-off). */
function drawing(ctx: SimCtx, a: ActorState, d: MortarData): void {
	const p = ctx.player;
	const tp = toPlayer(ctx, a);
	faceToward(a, tp.dirX, tp.dirZ);
	a.aiTicks -= 1;
	if (a.aiTicks > 0) return;
	a.v[MORTAR_STRAFE] = -a.v[MORTAR_STRAFE];
	if (!mortarRoomHolds(ctx, a, p.x, p.z)) {
		// NTD3: the target left the room during the draw; nothing is fired (the cooldown stays spent).
		a.aiState = MORTAR_KEEP;
		a.aiTicks = 0;
		a.attack = 0;
		return;
	}
	// The landing point: the target's last tick of motion x leadTicks, at most maxLead long; not floor -> the target.
	let lx = (p.x - p.prevX) * d.leadTicks;
	let lz = (p.z - p.prevZ) * d.leadTicks;
	const l2 = lx * lx + lz * lz;
	if (l2 > d.maxLead * d.maxLead) {
		const k = d.maxLead / math.sqrt(l2);
		lx *= k;
		lz *= k;
	}
	let x = p.x + lx;
	let z = p.z + lz;
	if (!mortarPointOpen(ctx, x, z)) {
		x = p.x;
		z = p.z;
	}
	a.v[MORTAR_LAND_X] = x;
	a.v[MORTAR_LAND_Z] = z;
	a.v[MORTAR_FLIGHT_TICKS] = d.flightTicks;
	a.aiState = MORTAR_FLIGHT;
	a.aiTicks = d.flightTicks; // the ring hint fills as aiTicks counts down
}

/** One flight tick (v[MORTAR_FLIGHT_TICKS] and aiTicks down by one). True when the shell lands this tick. */
function countFlight(a: ActorState): boolean {
	a.v[MORTAR_FLIGHT_TICKS] -= 1;
	a.aiTicks = a.v[MORTAR_FLIGHT_TICKS];
	return a.v[MORTAR_FLIGHT_TICKS] <= 0;
}

/** The living Mortar's flight tick: keeps range (no lob) and lands the shell on the last tick. */
function flight(ctx: SimCtx, a: ActorState, d: MortarData): void {
	if (countFlight(a)) {
		landShell(ctx, a, d);
		return;
	}
	keepRange(ctx, a, d, false);
}

/**
 * The impact at v[MORTAR_LAND_X / _Z]: one STRIKE (events.strikes and events.shells), then the shrapnel ring from the
 * point along the Mortar's facing. Back to keeping range (a corpse keeps the state; it is never stepped alive again).
 */
function landShell(ctx: SimCtx, a: ActorState, d: MortarData): void {
	const x = a.v[MORTAR_LAND_X];
	const z = a.v[MORTAR_LAND_Z];
	ctx.events.shells += ctx.fireEnemy(a, 0, 1, d.shell, x, z);
	ctx.fireEnemy(a, a.faceX, a.faceZ, d.shrapnel, x, z);
	a.v[MORTAR_FLIGHT_TICKS] = 0;
	a.aiState = MORTAR_KEEP;
	a.aiTicks = 0;
	a.attack = 0;
}

/**
 * Keeping range without line of sight (the stormcaller's reposition): approach / back off / strafe inside its room;
 * within tooClose a straight back-off; lobs when the cooldown is out (`mayLob`: not during a flight) and the target
 * stands in its room within lobRange and at least tooClose away.
 */
function keepRange(ctx: SimCtx, a: ActorState, d: MortarData, mayLob: boolean): void {
	const p = ctx.player;
	const tp = toPlayer(ctx, a);
	const dist = tp.dist;
	const dirX = tp.dirX;
	const dirZ = tp.dirZ;
	if (a.cooldown > 0) a.cooldown--;
	if (
		mayLob &&
		a.cooldown <= 0 &&
		dist <= d.lobRange &&
		dist >= d.tooClose &&
		p.dead === 0 &&
		mortarRoomHolds(ctx, a, p.x, p.z)
	) {
		startLob(ctx, a, d, dirX, dirZ);
		return;
	}
	const stepLen = walkStep(ctx, a);
	if (!mortarRoomHolds(ctx, a, a.x, a.z)) {
		// Outside its own room (a pin dragged it out): walk home first.
		walkToward(ctx, a, a.v[V_HOME_X], a.v[V_HOME_Z], stepLen, STEER);
		return;
	}
	faceToward(a, dirX, dirZ);
	const close = dist < d.tooClose;
	const radial = dist < d.keepMin ? -1 : dist > d.keepMax ? 1 : 0;
	const side = close ? 0 : a.v[MORTAR_STRAFE] * d.strafeWeight;
	// Perpendicular to the target direction: (-dirZ, dirX).
	let mx = dirX * radial - dirZ * side;
	let mz = dirZ * radial + dirX * side;
	const m2 = mx * mx + mz * mz;
	if (m2 <= 1e-12) return;
	const k = stepLen / math.sqrt(m2);
	mx *= k;
	mz *= k;
	const x0 = a.x;
	const z0 = a.z;
	moveActor(ctx, a, mx, mz);
	if (!mortarRoomHolds(ctx, a, a.x, a.z)) {
		// The move would leave its room: undone, and the strafe side flips.
		a.x = x0;
		a.z = z0;
		a.v[MORTAR_STRAFE] = -a.v[MORTAR_STRAFE];
		return;
	}
	const ox = a.x - x0;
	const oz = a.z - z0;
	if (ox * ox + oz * oz < stepLen * stepLen * STRAFE_BLOCKED * STRAFE_BLOCKED) {
		a.v[MORTAR_STRAFE] = -a.v[MORTAR_STRAFE];
	}
}

/**
 * 'snatcher' (Roblox port, docs/NEW_ENEMIES_2.md "Design > Snatcher", NX4; no web source): a small harmless imp that
 * eats its room's pellets and flees; kill it to get them back. 3 hp, contact damage 0, never attacks, never draws (no
 * cooldown: nothing here touches any rng stream). At most one per room and never a room's first buy (NXD9, the
 * dungeon's room pool, NX6); Horde's second wave never buys one (sim/pacts stepPacts.ts telegraphWave).
 *
 * Its pellets are its score record's (sim/pellets snatch.ts snatchRecordOf: the record holding its slot and id), never
 * another room's, and only while that room's pellets are LIVE. Each engaged tick (after stepCalm; it leashes only when
 * every player is dead: it stays in its room by construction, so a distance leash would only cut a flight short):
 *   1. SWALLOW telegraph running (AiState.TELEGRAPH, attack SNATCHER_ATTACK_SWALLOW, aiTicks counting down): it stands
 *      still; at 0 every carried pellet of its record becomes PELLET_DIGESTED (pelletsDigest: gone for good, `left`
 *      unchanged, so the room's Sweep is lost, NXD11), carried and the belly timer reset, back to STEAL.
 *   2. Carrying: v[SNATCHER_SINCE] + 1. At `stomach` carried, or `swallowAfterTicks` after its first steal of this
 *      belly: the swallow telegraph starts (ctx.telegraph, swallowTicks; the window to kill it), flight dropped.
 *   3. FLEE: the nearest living player (the bound target) within fleeRadius -> v[SNATCHER_FLEEING] = 1 until none is
 *      within fleeRelease. Fleeing, it walks toward the next cell of its room's flee field (snatcherField.ts:
 *      shared/dungeon fleeField over the floor rectangle, factor fleeFactor, the Goldling's), never out of the
 *      rectangle (a step that would leave it is undone); no lower cell: it stands. Outside the rectangle (a doorway),
 *      on a cell the field never reached (no player near the room on an open cell) or in no room: it walks straight
 *      away from that player instead (the steer mover).
 *   4. STEAL (not fleeing): it walks (the steer mover) to the nearest stealable pellet of its record (pelletsNearestLive:
 *      taken 0, never the power pellet, ties to the lower index); none (no pellets placed, all taken, not live): it
 *      stands facing its target (flee only, NXD10: no boost stealing).
 *   5. Fleeing or stealing, it then eats every stealable pellet of its record within eatRadius of its centre, in index
 *      order, while it carries fewer than `stomach` (pelletsSteal: taken = PELLET_STOLEN, events.stolen).
 * Death (onDeath): killed as its record's LAST living member (sim/pellets stepPellets.ts pelletRecordFalls: the room
 * clears this tick, stepScore's own test), every PELLET_STOLEN pellet of its record is credited to the killer
 * (ctx.playerIndex, the bound player) as that player's pickup (pelletsCreditCarried: taken = 1, `left` -= 1, the PELLETS
 * points, events.eaten), so the clear's Sweep can still pay (NXD18: the kill lands in stepCombat, before stepPellets and
 * stepScore). Otherwise (another member alive, the horde record waiting for its second wave, or a quiet death: nobody
 * earned it) every one goes back to 0 in place (pelletsReturn, events.returned: collectable again; `left` was never
 * changed). A Snatcher freed without dying (a floor change) takes nothing anywhere: the floor's pellets are replaced.
 *
 * View contract: states SNATCHER_STEAL (= STATE_ENGAGED) / SNATCHER_FLEE / AiState.TELEGRAPH (the swallow, aiTicks
 * counts it down); attack id SNATCHER_ATTACK_SWALLOW; v slots SNATCHER_CARRIED (the belly glow's count),
 * SNATCHER_SINCE (ticks since the first steal of this belly), SNATCHER_FLEEING (1 while fleeing); the pellets' events
 * `stolen` / `returned` / `swallowed` (sim/pellets pellets.ts).
 *
 * @module
 */

import { GOLDEN_FLEE, type EncounterRoom } from "shared/dungeon";
import { secondsToTicks } from "../../../playerData";
import { PELLET_PICKUP_RADIUS, SNATCHER_KIND } from "../../../pellets/pelletsData";
import { pelletRecordFalls, pelletsCreditCarried } from "../../../pellets/stepPellets";
import {
	pelletStealable,
	pelletsDigest,
	pelletsNearestLive,
	pelletsReturn,
	pelletsSteal,
	snatchRecordOf,
} from "../../../pellets/snatch";
import type { SimCtx } from "../../ctx";
import { walkStep } from "../actorMods";
import { faceToward, moveActor, toPlayer, walkToward } from "../helpers";
import { PORT_BAND_ENEMIES_3, registerArchetype } from "../registry";
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
	stepCalm,
	type RoomEnemyData,
} from "./enemyShared";
import { SNATCHER_FLEE_TARGET, snatcherFleeTarget, snatcherInRoomBox } from "./snatcherField";

export interface SnatcherData extends RoomEnemyData {
	/** Eats a pellet whose centre is within this of its centre (world units: a player's pickup reach). */
	readonly eatRadius: number;
	/** Flees while a living player is within fleeRadius, until none is within fleeRelease (world units). */
	readonly fleeRadius: number;
	readonly fleeRelease: number;
	/** shared/dungeon fleeField's factor (the Goldling's). */
	readonly fleeFactor: number;
	/** Swallows at this many carried pellets, or this many ticks after its first steal. */
	readonly stomach: number;
	readonly swallowAfterTicks: number;
	/** The swallow's telegraph (it stands still: the window to kill it). */
	readonly swallowTicks: number;
}

// --- States and attack ids
/** Stealing: walking to the nearest live pellet of its room. */
export const SNATCHER_STEAL = STATE_ENGAGED;
/** Fleeing on its room's flee field. */
export const SNATCHER_FLEE = AiState.CUSTOM + 1;
/** ActorState.attack while telegraphing the swallow. */
export const SNATCHER_ATTACK_SWALLOW = 1;

// --- v[] slots (0..2 shared)
/** Pellets it carries (taken = 2). */
export const SNATCHER_CARRIED = 3;
/** Ticks since the first steal of this belly (0: nothing carried). */
export const SNATCHER_SINCE = 4;
/** 1 while fleeing. */
export const SNATCHER_FLEEING = 6;

export const SNATCHER = registerArchetype<SnatcherData>({
	id: SNATCHER_KIND,
	band: PORT_BAND_ENEMIES_3,
	data: {
		hp: 3,
		radius: 0.3,
		speed: 5, // the Goldling's 5.1 less a hair
		contactDamage: 0,
		spriteId: "enemy.snatcher",
		roomEnemy: true,
		aggroRange: 9,
		leashRange: 16,
		lostTicks: 0, // unused, like the summoner's: it flees on purpose, so losing sight never sends it home
		alertRange: 4.5,
		eatRadius: PELLET_PICKUP_RADIUS,
		fleeRadius: 3,
		fleeRelease: 4.5,
		fleeFactor: GOLDEN_FLEE.factor,
		stomach: 5,
		swallowAfterTicks: secondsToTicks(8), // 480
		swallowTicks: secondsToTicks(1), // 60
	},
	init(_ctx, a) {
		initRoomEnemy(a);
	},
	step(ctx, a) {
		const d = ctx.data<SnatcherData>(a);
		if (stepCalm(ctx, a)) return;
		if (ctx.player.dead !== 0) {
			leash(a);
			return;
		}
		const rec = snatchRecordOf(ctx.state, a);
		if (a.aiState === AiState.TELEGRAPH) {
			a.aiTicks -= 1;
			if (a.aiTicks > 0) return;
			pelletsDigest(ctx.state, rec, a.x, a.z);
			a.v[SNATCHER_CARRIED] = 0;
			a.v[SNATCHER_SINCE] = 0;
			a.aiState = SNATCHER_STEAL;
			a.aiTicks = 0;
			a.attack = 0;
			return;
		}
		if (a.v[SNATCHER_CARRIED] > 0) {
			a.v[SNATCHER_SINCE] += 1;
			if (a.v[SNATCHER_CARRIED] >= d.stomach || a.v[SNATCHER_SINCE] >= d.swallowAfterTicks) {
				a.v[SNATCHER_FLEEING] = 0;
				ctx.telegraph(a, d.swallowTicks, SNATCHER_ATTACK_SWALLOW);
				return;
			}
		}
		const tp = toPlayer(ctx, a);
		if (a.v[SNATCHER_FLEEING] !== 0) {
			if (tp.dist > d.fleeRelease) a.v[SNATCHER_FLEEING] = 0;
		} else if (tp.dist < d.fleeRadius) a.v[SNATCHER_FLEEING] = 1;
		if (a.v[SNATCHER_FLEEING] !== 0) {
			a.aiState = SNATCHER_FLEE;
			flee(ctx, a, d, rec);
		} else {
			a.aiState = SNATCHER_STEAL;
			steal(ctx, a, rec);
		}
		eat(ctx, a, d, rec);
	},
	onHit(ctx, a) {
		engageOnHit(ctx, a);
	},
	onDeath(ctx, a, quiet) {
		alertOnDeath(ctx, a);
		const rec = snatchRecordOf(ctx.state, a);
		// NXD18: killed last, its pellets are the killer's pickups (the room clears this tick); else back on the floor.
		if (!quiet && pelletRecordFalls(ctx.state, rec)) pelletsCreditCarried(ctx.state, rec, ctx.playerIndex);
		else pelletsReturn(ctx.state, rec, a.x, a.z);
		a.v[SNATCHER_CARRIED] = 0;
		a.v[SNATCHER_SINCE] = 0;
	},
});

/** Below this squared length a vector has no direction. */
const EPS2 = 1e-12;

/** The encounter room of record `rec` (its room id), else the room it was placed in, else undefined. */
function roomOf(ctx: SimCtx, a: Readonly<ActorState>, rec: number): EncounterRoom | undefined {
	const r = rec >= 0 ? ctx.state.score?.rooms[rec] : undefined;
	if (r !== undefined) {
		const rooms = ctx.encounter.rooms;
		const byId = rooms[r.room];
		if (byId !== undefined && byId.id === r.room) return byId;
		for (const room of rooms) if (room.id === r.room) return room;
	}
	return ctx.roomAt(a.v[V_HOME_X], a.v[V_HOME_Z]);
}

/** Rule 3's flight (see the file comment). */
function flee(ctx: SimCtx, a: ActorState, d: SnatcherData, rec: number): void {
	const room = roomOf(ctx, a, rec);
	const found = room !== undefined ? snatcherFleeTarget(ctx, room, a.x, a.z, d.fleeFactor) : -1;
	const stepLen = walkStep(ctx, a);
	if (found < 0) {
		// Outside its room's rectangle, an unreached cell, or no room: straight away from the nearest living player.
		const tp = toPlayer(ctx, a);
		faceToward(a, -tp.dirX, -tp.dirZ);
		moveActor(ctx, a, -tp.dirX * stepLen, -tp.dirZ * stepLen, STEER);
		return;
	}
	if (found === 0) {
		const tp = toPlayer(ctx, a);
		faceToward(a, tp.dirX, tp.dirZ);
		return;
	}
	const dx = SNATCHER_FLEE_TARGET.x - a.x;
	const dz = SNATCHER_FLEE_TARGET.z - a.z;
	const d2 = dx * dx + dz * dz;
	if (d2 <= EPS2) return;
	const dist = math.sqrt(d2);
	const k = (dist < stepLen ? dist : stepLen) / dist;
	faceToward(a, dx, dz);
	const x0 = a.x;
	const z0 = a.z;
	moveActor(ctx, a, dx * k, dz * k);
	if (!snatcherInRoomBox(room!, a.x, a.z)) {
		a.x = x0;
		a.z = z0;
	}
}

/** Rule 4: toward the nearest stealable pellet of its record, else it stands facing its target. */
function steal(ctx: SimCtx, a: ActorState, rec: number): void {
	const k = pelletsNearestLive(ctx.state, rec, a.x, a.z);
	if (k < 0) {
		const tp = toPlayer(ctx, a);
		faceToward(a, tp.dirX, tp.dirZ);
		return;
	}
	const p = ctx.state.pellets!;
	walkToward(ctx, a, p.x[k], p.z[k], walkStep(ctx, a), STEER);
}

/** Rule 5: eats every stealable pellet of its record in reach, index order, up to its stomach. */
function eat(ctx: SimCtx, a: ActorState, d: SnatcherData, rec: number): void {
	const p = ctx.state.pellets;
	if (p === undefined || rec < 0) return;
	const r = p.rooms[rec];
	if (r === undefined) return;
	const reach2 = d.eatRadius * d.eatRadius;
	const last = r.first + r.span - 1;
	for (let i = r.first; i <= last; i++) {
		if (a.v[SNATCHER_CARRIED] >= d.stomach) return;
		if (!pelletStealable(ctx.state, rec, i)) continue;
		const dx = p.x[i] - a.x;
		const dz = p.z[i] - a.z;
		if (dx * dx + dz * dz > reach2) continue;
		if (!pelletsSteal(ctx.state, rec, i)) continue;
		if (a.v[SNATCHER_CARRIED] === 0) a.v[SNATCHER_SINCE] = 0;
		a.v[SNATCHER_CARRIED] += 1;
	}
}

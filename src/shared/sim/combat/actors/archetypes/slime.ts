/**
 * The Ooze (Roblox port, docs/ENEMY_VARIANTS.md EV3; no web source): two room enemies in band PORT_BAND_ENEMIES.
 *
 *   `slime`        8 hp, r 0.55, 1.6 u/s, contact HIT_NORMAL. Idle until it sees the player (or is hit, or a packmate
 *                  engages); then it crawls at the player (the swarmer's chase: runs at where it last saw them and
 *                  stops just inside contact range). **Goo trail:** every SLIME_DATA.trailTicks (0.5 s) of ticks on
 *                  which it actually moved, one stationary goo puddle (BulletKind.GOO: speed 0, 3 s, HIT_NORMAL,
 *                  the single-bullet shape 1 @ 0, already in the web arc table) at its trailing edge (trailBack behind
 *                  its centre, against its facing); skipped when that point is not a floor cell (a wall, or an intact
 *                  breakable). **Cap** (EVD14): before dropping, it counts its own live puddles (enemy bullets with its
 *                  emitter id and payload kind GOO) and skips at trailMax (6): a count, not "by construction", because
 *                  the Hourglass boon slows enemy bullet time and stretches puddle lives. No rng anywhere in the trail.
 *                  **Split** (EVD4, onDeath): 2 `slime.small` spawn on its corpse and are pushed out sideways
 *                  (perpendicular to its facing, + then -) through moveActor (walls stop them), take the landing spot
 *                  as home, are engaged and inherit its last sighting of the player, and are adopted into its room
 *                  record (adoptScoreRoomMember), so the room does not CLEAR until they are down too. A full actor
 *                  pool spawns fewer (each refused spawn counts in combat.actorsDropped; never an error).
 *   `slime.small`  3 hp, r 0.35, 2.6 u/s, contact HIT_NORMAL, drawn 0.6x from `enemy.slime`. The same crawl; no
 *                  trail, never splits. Only ever spawned by a split (never bought: it has no ENCOUNTER_COST row).
 *
 * Both are ordinary room enemies: initRoomEnemy, stepCalm (idle / walk home), leash, engageOnHit, alertOnDeath.
 * Kind indices (band PORT_BAND_ENEMIES, ids sorted `imp` < `slime` < `slime.small` < `summoner`): `slime` 10 and
 * `slime.small` 11 once the imp is registered; `slime.small` is always `slime` + 1.
 *
 * For the view (EV9): states SLIME_CRAWL (engaged; walking or holding just inside contact range) plus the shared
 * AiState.IDLE / STATE_RETURN; no telegraph (the crawl and the puddles are the whole tell). v[] slots:
 *   SLIME_TRAIL   ticks of movement left until the next puddle (the trail timer; counts down only on moving ticks,
 *                 reset to trailTicks after every drop attempt). Unused by `slime.small`.
 *   SLIME_LOST    ticks without line of sight while crawling (leashes past lostTicks).
 *   SLIME_LAST_X / SLIME_LAST_Z   where the player was last seen (the crawl's target).
 * The split's smalls start at the corpse (prevX / prevZ there: drawn bursting out) and land splitPush to either side.
 */

import { HIT_NORMAL, secondsToTicks } from "../../../playerData";
import { breakableSlotAt } from "../../../breakables/cells";
import { adoptScoreRoomMember } from "../../../score";
import type { BulletVisitor } from "../../bullets";
import { BulletKind, BulletPayload, type BurstSpec } from "../../patterns";
import type { SimCtx } from "../../ctx";
import { walkStep } from "../actorMods";
import { faceToward, moveActor, walkToward } from "../helpers";
import { PORT_BAND_ENEMIES, registerArchetype } from "../registry";
import type { ActorState } from "../types";
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

/** Data of both slimes. */
export interface SlimeData extends RoomEnemyData {
	/** Stops crawling this far from the player's centre (inside contact range: radius + PLAYER_RADIUS). */
	readonly chaseStop: number;
}

/** Data of the big slime: the goo trail and the split on top of the crawl. */
export interface OozeData extends SlimeData {
	/** Moving ticks between two puddles (the trail timer's reset value). */
	readonly trailTicks: number;
	/** Most of its own puddles alive at once (counted before each drop: EVD14). */
	readonly trailMax: number;
	/** A puddle lands this far behind its centre, against its facing (world units: about its radius). */
	readonly trailBack: number;
	/** A tick counts as moving when it travelled more than this (world units; a slide stalled on a wall does not). */
	readonly trailMinStep: number;
	/** The puddle: one stationary goo bullet (count 1, spread 0: the web table's single-bullet shape). */
	readonly goo: BurstSpec;
	/** Archetype id of the split's children, and how many (EVD4: 2, one generation). */
	readonly splitKind: string;
	readonly splitCount: number;
	/** How far each child is pushed out sideways from the corpse (world units, through the world: walls stop it). */
	readonly splitPush: number;
}

// --- Ids
export const SLIME_ID = "slime";
export const SLIME_SMALL_ID = "slime.small";

// --- States (aiState)
/** Crawling at the player (or at where it was last seen); also holding just inside contact range. */
export const SLIME_CRAWL = STATE_ENGAGED;

// --- v[] slots (0..2 are the shared V_AGGRO / V_HOME_X / V_HOME_Z)
/** Moving ticks left until the next puddle (`slime` only). */
export const SLIME_TRAIL = 3;
/** Ticks without line of sight while crawling. */
export const SLIME_LOST = 4;
/** Where the player was last seen. */
export const SLIME_LAST_X = 5;
export const SLIME_LAST_Z = 6;

/** A puddle's life (seconds) and the trail's period (seconds of movement). */
const GOO_LIFE_SECONDS = 3;
const TRAIL_SECONDS = 0.5;
/** The split's children fan out on both sides: the first child to +perpendicular, the next to -, and so on. */
const SPLIT_SIDES = 2;

/** The puddle (EVD5 / EVD13: drawn as a floor decal, hits at GOO_BULLET_RADIUS by its kind). */
const GOO_PUDDLE: BurstSpec = {
	count: 1,
	spread: 0,
	speed: 0,
	life: GOO_LIFE_SECONDS,
	damage: HIT_NORMAL,
	kind: BulletKind.GOO,
};

/** Data both slimes share (aggro, leash, alerts), apart from their bodies. */
const SLIME_ROOM = {
	roomEnemy: true,
	aggroRange: 7,
	leashRange: 15,
	lostTicks: secondsToTicks(2.5),
	alertRange: 4.5,
	spriteId: "enemy.slime",
	contactDamage: HIT_NORMAL,
} as const;

export const SLIME = registerArchetype<OozeData>({
	id: SLIME_ID,
	band: PORT_BAND_ENEMIES,
	data: {
		...SLIME_ROOM,
		hp: 8,
		radius: 0.55,
		speed: 1.6,
		chaseStop: 0.8, // contact range 0.9
		trailTicks: secondsToTicks(TRAIL_SECONDS), // 30
		trailMax: 6,
		trailBack: 0.55,
		trailMinStep: 0.005,
		goo: GOO_PUDDLE,
		splitKind: SLIME_SMALL_ID,
		splitCount: 2,
		splitPush: 0.6,
	},
	init(ctx, a) {
		initSlime(a);
		a.v[SLIME_TRAIL] = ctx.data<OozeData>(a).trailTicks;
	},
	step(ctx, a) {
		if (stepCalm(ctx, a)) return;
		if (shouldLeash(ctx, a)) {
			leash(a);
			return;
		}
		const d = ctx.data<OozeData>(a);
		const x0 = a.x;
		const z0 = a.z;
		crawl(ctx, a, d);
		if (a.aiState !== SLIME_CRAWL) return; // lost the player: leashed
		const mx = a.x - x0;
		const mz = a.z - z0;
		if (mx * mx + mz * mz <= d.trailMinStep * d.trailMinStep) return; // the trail only runs while it moves
		a.v[SLIME_TRAIL] -= 1;
		if (a.v[SLIME_TRAIL] > 0) return;
		a.v[SLIME_TRAIL] = d.trailTicks;
		dropGoo(ctx, a, d);
	},
	onHit(ctx, a) {
		engageOnHit(ctx, a);
	},
	onDeath(ctx, a) {
		alertOnDeath(ctx, a);
		split(ctx, a, ctx.data<OozeData>(a));
	},
});

export const SLIME_SMALL = registerArchetype<SlimeData>({
	id: SLIME_SMALL_ID,
	band: PORT_BAND_ENEMIES,
	data: {
		...SLIME_ROOM,
		hp: 3,
		radius: 0.35,
		speed: 2.6,
		spriteScale: 0.6,
		chaseStop: 0.6, // contact range 0.7
	},
	init(_ctx, a) {
		initSlime(a);
	},
	step(ctx, a) {
		if (stepCalm(ctx, a)) return;
		if (shouldLeash(ctx, a)) {
			leash(a);
			return;
		}
		crawl(ctx, a, ctx.data<SlimeData>(a));
	},
	onHit(ctx, a) {
		engageOnHit(ctx, a);
	},
	onDeath(ctx, a) {
		alertOnDeath(ctx, a); // never splits
	},
});

/** Room enemy init, with the last sighting on its own spot (an engaged slime that never saw the player holds still). */
function initSlime(a: ActorState): void {
	initRoomEnemy(a);
	a.v[SLIME_LAST_X] = a.x;
	a.v[SLIME_LAST_Z] = a.z;
}

/** The swarmer's chase without the lunge: crawl at where the player was last seen, stopping inside contact range. */
function crawl(ctx: SimCtx, a: ActorState, d: SlimeData): void {
	const p = ctx.player;
	if (ctx.lineOfSight(a.x, a.z, p.x, p.z)) {
		a.v[SLIME_LOST] = 0;
		a.v[SLIME_LAST_X] = p.x;
		a.v[SLIME_LAST_Z] = p.z;
	} else {
		a.v[SLIME_LOST] += 1;
		if (a.v[SLIME_LOST] > d.lostTicks) {
			leash(a);
			return;
		}
	}
	const tx = a.v[SLIME_LAST_X] - a.x;
	const tz = a.v[SLIME_LAST_Z] - a.z;
	const left = math.sqrt(tx * tx + tz * tz) - d.chaseStop;
	if (left > 0) {
		const walk = walkStep(ctx, a);
		walkToward(ctx, a, a.v[SLIME_LAST_X], a.v[SLIME_LAST_Z], walk < left ? walk : left, STEER);
	} else faceToward(a, tx, tz);
}

/** countOwnGoo's visitor state (module scratch: set, visit, read; never kept across calls). */
const gooScratch = { emitter: 0, n: 0 };
const countGooVisit: BulletVisitor = (_i, _pos, payload, emitter) => {
	if (emitter === gooScratch.emitter && BulletPayload.get(payload, "kind") === BulletKind.GOO) gooScratch.n += 1;
	return false;
};

/** Live goo puddles fired by `a` (its emitter id; ids are never reused, so a freed slot's puddles never count). */
export function countOwnGoo(ctx: SimCtx, a: Readonly<ActorState>): number {
	gooScratch.emitter = a.emitterId;
	gooScratch.n = 0;
	ctx.combat.enemyBullets.forEachActive(countGooVisit);
	return gooScratch.n;
}

/** One puddle at the trailing edge, unless that point is not floor or the cap is reached. */
function dropGoo(ctx: SimCtx, a: ActorState, d: OozeData): void {
	const x = a.x - a.faceX * d.trailBack;
	const z = a.z - a.faceZ * d.trailBack;
	if (ctx.isBlocked(x, z)) return;
	const b = ctx.state.breakables;
	if (b !== undefined && breakableSlotAt(b, x, z) >= 0) return;
	if (countOwnGoo(ctx, a) >= d.trailMax) return;
	ctx.fireEnemy(a, a.faceX, a.faceZ, d.goo, x, z);
}

/**
 * The split (onDeath): splitCount children on the corpse, each pushed splitPush sideways (perpendicular to the
 * corpse's facing, alternating sides) through the world, homed where it lands, engaged with the parent's last sighting
 * and adopted into the parent's room record. A refused spawn (full pool) is skipped; spawnActor counts it.
 */
function split(ctx: SimCtx, a: ActorState, d: OozeData): void {
	// Perpendicular to the facing (unit): (faceZ, -faceX).
	const sideX = a.faceZ;
	const sideZ = -a.faceX;
	for (let i = 0; i < d.splitCount; i++) {
		const s = ctx.spawnActor(d.splitKind, a.x, a.z);
		if (s === undefined) continue; // the actor pool is full (combat.actorsDropped += 1)
		const push = i % SPLIT_SIDES === 0 ? d.splitPush : -d.splitPush;
		moveActor(ctx, s, sideX * push, sideZ * push); // prevX / prevZ stay on the corpse: drawn bursting out
		s.faceX = a.faceX;
		s.faceZ = a.faceZ;
		s.v[V_HOME_X] = s.x;
		s.v[V_HOME_Z] = s.z;
		s.v[SLIME_LAST_X] = a.v[SLIME_LAST_X];
		s.v[SLIME_LAST_Z] = a.v[SLIME_LAST_Z];
		engage(s);
		adoptScoreRoomMember(ctx.state, a, s);
	}
}

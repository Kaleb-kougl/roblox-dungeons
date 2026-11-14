/**
 * 'pyrekeeper' (Roblox port, docs/NEW_ENEMIES_2.md; no web source): a hooded demon with a torch staff that hangs back
 * and lights braziers (`pyre`, ./pyre.ts) around the room; they go out when it dies. 6 hp, contact damage 0. Engaged,
 * it keeps keepMin-keepMax from every living player (the summoner's keepRange). At most one per room (NX6).
 *
 * Planned (NX5, not built yet): LIGHT, with fewer than maxAlive of its pyres alive, perLife not spent
 * (v[PYREKEEPER_LIT]) and the cooldown out (lightCooldownMin-Max, `enemyCooldown`), it picks the landing point (the
 * LANDING_OFFSETS compass points at landingDistance from its target, tried in order from a start index drawn once per
 * cast; the first FLOOR cell inside its room, off solid decor / intact pieces / pellets, >= landingPlayerClear from
 * every living player and >= landingPyreClear from its other pyres; none: the cast is spent with no pyre) into
 * v[PYREKEEPER_LAND_*], telegraphs lightTelegraphTicks (attack PYREKEEPER_ATTACK_LIGHT; the `ring` hint on the landing
 * point, landingRingRadius) and spawns a pyre there (its v[PYRE_KEEPER] = this actor's id, its first shot staggered by
 * its index among the keeper's pyres). PANIC (the summoner's): a living player within panicRange and in sight as the
 * cooldown runs out -> panicTelegraphTicks (attack PYREKEEPER_ATTACK_PANIC), the bruiser's gapped ring, then
 * PYREKEEPER_BACKOFF. Its death withers every live pyre that names it. Draws: the first cooldown in init, two per cast
 * (cooldown, start index), the panic's two, the strafe coin and flips.
 *
 * Its pyres are found from the pool (`kind === pyre && v[PYRE_KEEPER] === id`), not from slots of its own: actor ids
 * are never reused in a run, so the link is exact, and the slots hold the landing point instead (docs/NEW_ENEMIES_2.md
 * NX0 findings).
 *
 * NX1 skeleton: the data block and a minimal step (calm / leash / engage, then keep range straight along the target's
 * bearing); no cast, no pyre, no panic, no draws.
 *
 * View contract: states PYREKEEPER_KEEP (= STATE_ENGAGED) / AiState.TELEGRAPH (the light or the panic) /
 * PYREKEEPER_BACKOFF; attack ids PYREKEEPER_ATTACK_LIGHT / PYREKEEPER_ATTACK_PANIC; v slots PYREKEEPER_LIT (pyres lit
 * this life), PYREKEEPER_LAND_X / _Z (the landing point while the light telegraphs), PYREKEEPER_STRAFE (+1 / -1),
 * PYREKEEPER_PANIC (1 from the panic telegraph to the end of the back-off).
 */

import { secondsToTicks } from "../../../playerData";
import type { BurstSpec } from "../../patterns";
import type { SimCtx } from "../../ctx";
import { walkStep } from "../actorMods";
import { faceToward, moveActor, toPlayer } from "../helpers";
import { PORT_BAND_ENEMIES_3, registerArchetype } from "../registry";
import { AiState, type ActorState } from "../types";
import { BRUISER } from "./bruiser";
import {
	STATE_ENGAGED,
	STEER,
	alertOnDeath,
	engageOnHit,
	initRoomEnemy,
	leash,
	shouldLeash,
	stepCalm,
	type RoomEnemyData,
} from "./enemyShared";
import { PYRE } from "./pyre";

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
	init(_ctx, a) {
		initRoomEnemy(a);
	},
	step(ctx, a) {
		const d = ctx.data<PyrekeeperData>(a);
		if (stepCalm(ctx, a)) return;
		if (shouldLeash(ctx, a)) {
			leash(a);
			return;
		}
		keepRange(ctx, a, d);
	},
	onHit(ctx, a) {
		engageOnHit(ctx, a);
	},
	onDeath(ctx, a) {
		alertOnDeath(ctx, a);
	},
});

/** NX1 skeleton: backs off inside keepMin, closes in past keepMax, else stands facing its target (no strafe, no draw). */
function keepRange(ctx: SimCtx, a: ActorState, d: PyrekeeperData): void {
	const tp = toPlayer(ctx, a);
	const dirX = tp.dirX;
	const dirZ = tp.dirZ;
	faceToward(a, dirX, dirZ);
	const radial = tp.dist < d.keepMin ? -1 : tp.dist > d.keepMax ? 1 : 0;
	if (radial === 0) return;
	const stepLen = walkStep(ctx, a) * radial;
	moveActor(ctx, a, dirX * stepLen, dirZ * stepLen, STEER);
}

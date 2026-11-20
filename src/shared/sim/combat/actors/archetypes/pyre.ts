/**
 * 'pyre' (Roblox port, docs/NEW_ENEMIES_2.md "Design > Pyre-keeper and pyre", NX5; no web source): the brazier a
 * Pyre-keeper lights (./pyrekeeper.ts), a runtime child only: never planned, never bought (no ENCOUNTER_COST row),
 * never a room member (NXD13: the room clears without it), never an affix (spawned through ctx.spawnActor), no drop
 * roll (DROP_INELIGIBLE_ARCHETYPES). 4 hp, still (speed 0), contact damage 0. Not a room enemy (no aggro, pack alerts or
 * leash): it fires from the tick it is lit, whatever the room is doing. No draws.
 *
 * Its keeper sets it up on the spawn tick (pyrekeeper.ts `lightPyre`): v[PYRE_KEEPER] = the keeper's actor id (ids are
 * never reused in a run), v[PYRE_STAGGER] = its stagger slot, v[PYRE_FIRE] = the ticks to its first shot (litTicks plus
 * the stagger delay). Each step:
 *   1. Lighting: aiTicks counts litTicks down (0 = lit); v[PYRE_FIRE] >= aiTicks always, so it never fires while it
 *      lights.
 *   2. v[PYRE_FIRE] counts down; at 0 it fires `shot` (one aimed bullet, BulletKind.ENEMY; the view's `flame` look is
 *      NX7's, by the payload's source) at the nearest living player in sight (`pyreTarget`; none: the shot is skipped)
 *      and reloads fireTicks either way, so its phase never drifts.
 * The stagger: a keeper's living pyres hold distinct slots 0..maxAlive-1 and fire shotStaggerTicks x (slot difference)
 * apart on the shared fireTicks period (pyrekeeper.ts `staggerDelay`), so three never fire on one tick.
 * It withers (ctx.killActor: scored, combo, no drop) at its keeper's death (the keeper's onDeath scans the pool for
 * `v[PYRE_KEEPER] === id`). The room clear needs no hook of its own: the keeper is a member of that record, so the
 * record cannot clear before it dies, and its death withers them first (same tick, before stepScore).
 *
 * A pyre spawned without a keeper (specs, NX1's sandbox) has v[PYRE_KEEPER] 0, lights litTicks after it lands and fires
 * from then on (slot 0, no stagger); it never withers.
 *
 * View contract: lit once aiTicks is 0; v slots PYRE_FIRE (ticks to the next shot), PYRE_KEEPER (its keeper's actor
 * id), PYRE_STAGGER (its slot); SimEvents.pyresLanded on its spawn tick, pyresWithered on a wither.
 *
 * @module
 */

import { HIT_NORMAL, secondsToTicks } from "../../../playerData";
import { partySize, playerAt } from "../../../party";
import type { PlayerState } from "../../../state";
import type { SimCtx } from "../../ctx";
import { BulletKind, type BurstSpec } from "../../patterns";
import { faceToward } from "../helpers";
import { PORT_BAND_ENEMIES_3, registerArchetype } from "../registry";
import type { ActorState, ArchetypeData } from "../types";

export interface PyreData extends ArchetypeData {
	/** Lighting: no fire for this many ticks after it lands. */
	readonly litTicks: number;
	/** Ticks between shots, and the first shot's offset per index among its keeper's pyres. */
	readonly fireTicks: number;
	readonly shotStaggerTicks: number;
	/** The fireball: one aimed bullet. */
	readonly shot: BurstSpec;
}

// --- v[] slots (no shared room-enemy layout: it is not a room enemy)
/** Ticks to its next shot. */
export const PYRE_FIRE = 3;
/** Its keeper's actor id (actor ids are never reused in a run; 0 = none). */
export const PYRE_KEEPER = 4;
/** Its stagger slot among its keeper's living pyres (0..maxAlive-1). */
export const PYRE_STAGGER = 5;

export const PYRE = registerArchetype<PyreData>({
	id: "pyre",
	band: PORT_BAND_ENEMIES_3,
	data: {
		hp: 4,
		radius: 0.4,
		speed: 0,
		contactDamage: 0,
		spriteId: "enemy.pyre",
		litTicks: secondsToTicks(0.5), // 30
		fireTicks: secondsToTicks(2), // 120
		shotStaggerTicks: secondsToTicks(0.6), // 36
		shot: {
			count: 1,
			spread: 0,
			speed: 4.5,
			life: 2.5,
			damage: HIT_NORMAL,
			kind: BulletKind.ENEMY,
		},
	},
	init(ctx, a) {
		const d = ctx.data<PyreData>(a);
		a.aiTicks = d.litTicks;
		a.v[PYRE_FIRE] = d.litTicks;
		a.v[PYRE_KEEPER] = 0;
		a.v[PYRE_STAGGER] = 0;
	},
	step(ctx, a) {
		stepPyre(ctx, a, ctx.data<PyreData>(a));
	},
});

/** Below this squared length a vector has no direction. */
const EPS2 = 1e-12;

/**
 * The nearest living player in line of sight of (x, z), ties to the lower index; undefined when none is (solo: the
 * player, when alive and in sight).
 */
export function pyreTarget(ctx: SimCtx, x: number, z: number): PlayerState | undefined {
	const n = partySize(ctx.state);
	let best: PlayerState | undefined;
	let best2 = math.huge;
	for (let i = 0; i < n; i++) {
		const p = playerAt(ctx.state, i);
		if (p.dead !== 0) continue;
		const dx = p.x - x;
		const dz = p.z - z;
		const d2 = dx * dx + dz * dz;
		if (d2 >= best2 || !ctx.lineOfSight(x, z, p.x, p.z)) continue;
		best = p;
		best2 = d2;
	}
	return best;
}

function stepPyre(ctx: SimCtx, a: ActorState, d: PyreData): void {
	if (a.aiTicks > 0) a.aiTicks -= 1;
	a.v[PYRE_FIRE] -= 1;
	if (a.v[PYRE_FIRE] > 0) return;
	a.v[PYRE_FIRE] = d.fireTicks;
	const p = pyreTarget(ctx, a.x, a.z);
	if (p === undefined) return; // no one in sight: the shot is skipped, the period kept
	const dx = p.x - a.x;
	const dz = p.z - a.z;
	const d2 = dx * dx + dz * dz;
	if (d2 <= EPS2) return;
	const inv = 1 / math.sqrt(d2);
	faceToward(a, dx, dz);
	ctx.fireEnemy(a, dx * inv, dz * inv, d.shot);
}

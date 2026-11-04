/**
 * 'golden', the Goldling (Roblox port, docs/FORTUNE.md "The Goldling", Design §3, FD9-FD11; no web source): a small
 * harmless gold creature that appears in a room's fight and runs. Band PORT_BAND_FORTUNE (index 18). 10 hp (endless and
 * party hp scaling apply), radius 0.3, runs at 5.1 u/s, NO contact damage and no attack. It is not a room enemy
 * (data.roomEnemy unset): never a score-record member (the room clears without it), never aggroed, alerted or alerting,
 * never in a Warbanner's aura (`isWarbannerAuraTarget` reads roomEnemy), and its walk never goes through actorMods
 * (no affix: it spawns without one). It never draws the main rng: its only draws (a jink's side) come from its own
 * stream, state.golden.rngState. Spawned by stepGolden (sim/golden), never by a room's planned spawns.
 *
 * Each tick (never on its spawn tick):
 *   1. v[GOLDEN_TICKS_LEFT] - 1 (stepGolden frees it at 0: the escape), v[GOLDEN_JINK_COOLDOWN] - 1 while > 0
 *   2. JINK: a sidestep along the latched unit direction (v[GOLDEN_JINK_X / Z]) at config.jinkSpeed; aiTicks - 1, back
 *      to RUN at 0 or as soon as a wall or its room's edge stops the step (moved under JINK_BLOCKED of it)
 *   3. RUN: the nearest living player (index order on ties) within config.jinkRange with the cooldown out starts a jink
 *      (ONE golden-stream draw rng.int(0, 1) picks the side: perpendicular to that player's bearing, (-bz, bx) x side),
 *      cooldown = jinkCooldownTicks, aiTicks = jinkTicks, and the first sidestep is this tick (2). Else it flees: the
 *      sources are re-read every config.fieldTicks ticks (goldenReadSources), and it walks toward the centre of
 *      fleeStep's cell on the flee field (goldenField) at data.speed; no lower neighbour: it stands.
 * Every move is moveActor (actorMover: walls and intact breakables block) and then kept in its room: a step whose
 * centre would leave the room's walk mask (a doorway, a corridor) is undone. Without state.golden (a stray spawn in a
 * spec) it only counts down and stands.
 *
 * Hooks: onHit with damage > 0 books the hit (goldenOnHit: coins, GE3); onDeath is the catch (goldenOnCaught: the
 * jackpot, GE3). In DROP_INELIGIBLE_ARCHETYPES: its kill never rolls a drop or touches pity.
 *
 * View contract: states GOLDEN_RUN / GOLDEN_JINK; v slots GOLDEN_TICKS_LEFT (ticks to its escape: the shrinking ring),
 * GOLDEN_JINK_COOLDOWN, GOLDEN_HITS (damaging hits taken), GOLDEN_JINK_X / Z.
 */

import { fleeStep, gridToWorld } from "shared/dungeon";
import { rngInt } from "../../../rng";
import { SIM_DT } from "../../../units";
import { partySize, playerAt } from "../../../party";
import { ENDLESS_GOLDEN_CONFIG, type GoldenConfig, type GoldenState } from "../../../golden/golden";
import { GOLDEN_KIND } from "../../../golden/goldenData";
import { goldenBoxCell, goldenField, goldenInRoom, goldenReadSources } from "../../../golden/goldenField";
import { goldenOnCaught, goldenOnHit } from "../../../golden/goldenHooks";
import type { SimCtx } from "../../ctx";
import { faceToward, moveActor } from "../helpers";
import { PORT_BAND_FORTUNE, registerArchetype } from "../registry";
import { AiState, type ActorState, type ArchetypeData } from "../types";

// --- States
/** Fleeing on the field. */
export const GOLDEN_RUN = AiState.CUSTOM;
/** A sidestep (aiTicks left). */
export const GOLDEN_JINK = AiState.CUSTOM + 1;

// --- v[] slots (it is not a room enemy: slots 0..2 are its own)
/** Ticks left before it escapes. */
export const GOLDEN_TICKS_LEFT = 0;
/** Ticks before it may jink again. */
export const GOLDEN_JINK_COOLDOWN = 1;
/** Damaging hits taken. */
export const GOLDEN_HITS = 2;
/** The jink's unit direction. */
export const GOLDEN_JINK_X = 3;
export const GOLDEN_JINK_Z = 4;

/** Body radius (world units): small, like a slimelet. */
export const GOLDEN_RADIUS = 0.3;
/** Run speed (world units / s): under the player's walk (6), well under the roll (11). */
export const GOLDEN_SPEED = 5.1;
/**
 * Base hp (x endless floor / Depth scaling, x party scaling). GE4 (run/goldenCensus.spec.ts): the plan's start 10 took
 * 3 port-sword hits on floor 2 (the plan wanted about 6-8), so 24: 7 hits on floor 2 (25.9 hp), 13 on floor 6.
 */
export const GOLDEN_HP = 24;

/** A jink step that moved less than this fraction of its length ran into a wall or the room's edge: it ends. */
const JINK_BLOCKED = 0.3;
/** Below this squared length a vector has no direction. */
const EPS2 = 1e-12;

export const GOLDEN = registerArchetype<ArchetypeData>({
	id: GOLDEN_KIND,
	band: PORT_BAND_FORTUNE,
	data: {
		hp: GOLDEN_HP,
		radius: GOLDEN_RADIUS,
		speed: GOLDEN_SPEED,
		contactDamage: 0,
		spriteId: "enemy.golden",
	},
	init(ctx, a) {
		a.aiState = GOLDEN_RUN;
		a.v[GOLDEN_TICKS_LEFT] = rulesOf(ctx).escapeTicks;
	},
	step(ctx, a) {
		const cfg = rulesOf(ctx);
		a.v[GOLDEN_TICKS_LEFT] -= 1;
		if (a.v[GOLDEN_JINK_COOLDOWN] > 0) a.v[GOLDEN_JINK_COOLDOWN] -= 1;
		const g = ctx.state.golden;
		if (g === undefined || g.floor === undefined) return;
		if (a.aiState === GOLDEN_JINK) {
			jink(ctx, a, g, cfg);
			return;
		}
		if (tryStartJink(ctx, a, g, cfg)) {
			jink(ctx, a, g, cfg);
			return;
		}
		flee(ctx, a, g, cfg);
	},
	onHit(ctx, a, damage) {
		if (!(damage > 0)) return;
		a.v[GOLDEN_HITS] += 1;
		goldenOnHit(ctx.state, a, ctx.playerIndex);
	},
	onDeath(ctx, a) {
		goldenOnCaught(ctx.state, a, ctx.playerIndex);
	},
});

/** The run's Goldling rules (ENDLESS_GOLDEN_CONFIG for a stray spawn without state.golden). */
function rulesOf(ctx: SimCtx): GoldenConfig {
	return ctx.state.golden?.config ?? ENDLESS_GOLDEN_CONFIG;
}

/**
 * Moves `a` by (dx, dz) through the world (moveActor: walls and intact breakables block) and undoes the step when its
 * centre would leave its room's walk mask. Returns the squared distance moved.
 */
function moveInRoom(ctx: SimCtx, a: ActorState, g: Readonly<GoldenState>, dx: number, dz: number): number {
	const x0 = a.x;
	const z0 = a.z;
	moveActor(ctx, a, dx, dz);
	if (!goldenInRoom(g, a.x, a.z)) {
		a.x = x0;
		a.z = z0;
	}
	const ox = a.x - x0;
	const oz = a.z - z0;
	return ox * ox + oz * oz;
}

/** Rule 3's jink start (see the file comment). Returns true when it started. */
function tryStartJink(ctx: SimCtx, a: ActorState, g: GoldenState, cfg: GoldenConfig): boolean {
	if (a.v[GOLDEN_JINK_COOLDOWN] > 0) return false;
	const n = partySize(ctx.state);
	let best2 = math.huge;
	let bx = 0;
	let bz = 0;
	for (let i = 0; i < n; i++) {
		const p = playerAt(ctx.state, i);
		if (p.dead !== 0) continue;
		const dx = a.x - p.x;
		const dz = a.z - p.z;
		const d2 = dx * dx + dz * dz;
		if (d2 < best2) {
			best2 = d2;
			bx = dx;
			bz = dz;
		}
	}
	if (best2 > cfg.jinkRange * cfg.jinkRange) return false;
	// The bearing from that player to the Goldling (its facing reversed when they coincide).
	if (best2 > EPS2) {
		const inv = 1 / math.sqrt(best2);
		bx *= inv;
		bz *= inv;
	} else {
		bx = -a.faceX;
		bz = -a.faceZ;
	}
	const side = rngInt(g, 0, 1) === 0 ? -1 : 1;
	a.v[GOLDEN_JINK_X] = -bz * side;
	a.v[GOLDEN_JINK_Z] = bx * side;
	a.v[GOLDEN_JINK_COOLDOWN] = cfg.jinkCooldownTicks;
	a.aiState = GOLDEN_JINK;
	a.aiTicks = cfg.jinkTicks;
	return true;
}

/** Rule 2: one sidestep tick. */
function jink(ctx: SimCtx, a: ActorState, g: GoldenState, cfg: GoldenConfig): void {
	const jx = a.v[GOLDEN_JINK_X];
	const jz = a.v[GOLDEN_JINK_Z];
	const stepLen = cfg.jinkSpeed * SIM_DT;
	faceToward(a, jx, jz);
	const moved2 = moveInRoom(ctx, a, g, jx * stepLen, jz * stepLen);
	a.aiTicks -= 1;
	if (a.aiTicks <= 0 || moved2 < stepLen * stepLen * JINK_BLOCKED * JINK_BLOCKED) {
		a.aiState = GOLDEN_RUN;
		a.aiTicks = 0;
	}
}

/** Rule 3's flight down the flee field. */
function flee(ctx: SimCtx, a: ActorState, g: GoldenState, cfg: GoldenConfig): void {
	const tick = ctx.tick;
	if (g.fieldTick < 0 || tick - g.fieldTick >= cfg.fieldTicks) goldenReadSources(ctx.state, g);
	const f = g.floor!;
	const cache = goldenField(ctx.state, g);
	const cell = goldenBoxCell(g, a.x, a.z);
	if (cache === undefined || cell < 0) return;
	const lx = cell % f.w;
	const ly = (cell - lx) / f.w;
	const target = fleeStep(cache.open, f.w, f.h, cache.field, lx, ly);
	if (target < 0) return;
	const tlx = target % f.w;
	const tly = (target - tlx) / f.w;
	const dx = gridToWorld(f.x0 + tlx) - a.x;
	const dz = gridToWorld(f.y0 + tly) - a.z;
	const d2 = dx * dx + dz * dz;
	if (d2 <= EPS2) return;
	const d = math.sqrt(d2);
	const stepLen = ctx.data(a).speed * SIM_DT;
	const k = (d < stepLen ? d : stepLen) / d;
	faceToward(a, dx, dz);
	moveInRoom(ctx, a, g, dx * k, dz * k);
}

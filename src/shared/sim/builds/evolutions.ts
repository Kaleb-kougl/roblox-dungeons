/**
 * The evolutions' rules inside stepCombat (docs/BUILDS.md "Evolutions (level III)", BU5; a Roblox-port feature, no web
 * source). Every rule is reached only with state.builds and does nothing for a player whose boon is below level III
 * (./hooks.ts isEvolved). Storm Crown, Cataclysm and Soul Swarm's source are in ./onKill.ts, Executioner in
 * ./execute.ts, the counters fed from outside combat (Thrill Seeker's grazes, Bulwark's breaks, Lionheart) in
 * ./hooks.ts, Jackpot in ./procs.ts.
 *
 * Hooks called during the phases of stepCombat (generic, so BU6's duos can reuse them):
 *   buildsOnFinisher(ctx, hits, first)   sword.ts, after a finisher's sweep (`hits` actors hit, `first` the first of
 *                                   them). Flurry (Swift Strikes III): FLURRY_CRESCENT from the player along the
 *                                   facing (fireEffect FLURRY, gen 0; first moves this tick, like an arrow). BU6 Storm
 *                                   Blade (./duos.ts stormBladeFinisher): a finisher that hit queues a spark.
 *   buildsFlurryArrow(ctx)          (./hooks.ts: bow.ts cannot import this module) per stream arrow, not the heavy
 *                                   arrow: Flurry counts it in `arrows`; the FLURRY_ARROW_EVERY-th returns true and the
 *                                   bow fires that arrow as FLURRY_ARROW_COUNT @ FLURRY_ARROW_SPREAD (weapon arrows:
 *                                   its pierce, its source; buildsFlurryArrowsFired records it).
 *   buildsOnPierceHit(ctx, a, x, z, source, consumed)   combat.ts piercingBulletHit, after each actor a piercing
 *                                   player bullet damages (at (x, z); `consumed`: it had no pierce left, the hit ends
 *                                   it). Ricochet (Piercing Arrows III): a bow arrow (payload source = the bow's weapon
 *                                   index + 1) whose consuming hit killed queues a split; stepBuilds releases it.
 *   phantomStepOn(state, i) / phantomStepErased(...)   combat.ts enemy bullet walk: Phantom Step (Slippery III)
 *                                   erases an enemy bullet inside player i's hit circle while i rolls with i-frames
 *                                   running (rollTicks > 0 and iframeTicks > 0): no hit, no graze, no score, no parry
 *                                   feed; goo too, quietly (the guard's goo rule); BuildEvents phantomX / Z / Owner.
 *
 * stepBuilds' phases (./procs.ts; phase 6b of stepCombat, inside one effect budget session):
 *   1. stepEvolutions, before the proc drain, in this order:
 *        a. Ricochet splits queued by this tick's player bullet walk: RICOCHET_ARROWS RICOCHET_ARROWs aimed at the
 *           nearest living enemies within RICOCHET_RANGE of the split (fireAimedVolley, never the victim), effect
 *           RICOCHET at the arrow's kill generation (0 for a weapon arrow: their kills proc at gen 1)
 *        b. Soul Swarm steering: every live SOUL_SWARM shard turns toward the nearest living enemy within
 *           SOUL_SWARM_RANGE of it (never the actor it last pierced): v' = |v| x normalize(v / |v| + SOUL_SWARM_TURN x d),
 *           d the unit direction to the target (sqrt only); BulletSimulation.setVelocity. At most atan(SOUL_SWARM_TURN)
 *           of turn per tick
 *        c. novas, players in index order: Overflowing (Deep Flask III) on the drink tick (flaskTicks ===
 *           FLASK_USE_TICKS), radius OVERFLOWING_NOVA_RADIUS; then Bulwark (Warding III), one per pending armor break
 *           (bulwarkPending), BULWARK_NOVA_RADIUS. A nova is melee.ts sweepArc around the player, full circle
 *           (NOVA_HALF_ANGLE_COS), enemy bullets only, goo erased quietly (eraseGoo, the guard's rule), no erase sink
 *           (no parry feed), no guard points; it adds to events.bulletsDeleted like any sweep. Dead or departed
 *           players release nothing (their pending breaks are dropped)
 *        d. Thrill Seeker (Daredevil III): per THRILL_SEEKER_GRAZES grazes counted, THRILL_SEEKER_RING around the
 *           player (EFFECT_DIR heading, effect THRILL_SEEKER, gen 0)
 *   2. the proc drain (./procs.ts)
 *   3. stepMomentum, after the drain (so a spark kill's combo feed counts this tick): for each tier t in
 *      MOMENTUM_TIER_FIRST..MOMENTUM_TIER_LAST whose tenths t x COMBO_DENOMINATOR the combo crossed upward this tick
 *      (ScoreEvents.comboStart < t x 10 <= combo; the combo only rises inside stepCombat), every living Lingering III
 *      owner fires t SOUL_SHARDs aimed from their position (fireAimedVolley within SOUL_SHARDS_RANGE, effect MOMENTUM,
 *      gen 0). Once per crossing: a combo cut and a rise again is a new crossing.
 */
import type { SimCtx } from "../combat/ctx";
import type { SimState } from "../state";
import type { Vec3 } from "../combat/bullets";
import type { ActorState } from "../combat/actors/types";
import { BulletKind, BulletPayload } from "../combat/patterns";
import { sweepArc, sweepGooErased } from "../combat/weapons/melee";
import { weaponIndex } from "../combat/weapons/registry";
import { FLASK_USE_TICKS } from "../playerData";
import { Boon } from "../progression/progressionData";
import { COMBO_DENOMINATOR } from "../score/scoreData";
import type { BuildsState } from "./builds";
import { BUILD_SOURCE_BASE, BuildEffect, sourceEffect } from "./buildsData";
import {
	BULWARK_NOVA_RADIUS,
	EFFECT_DIR_X,
	EFFECT_DIR_Z,
	FLURRY_CRESCENT,
	FlurryKind,
	MOMENTUM_TIER_FIRST,
	MOMENTUM_TIER_LAST,
	NOVA_HALF_ANGLE_COS,
	NovaKind,
	OVERFLOWING_NOVA_RADIUS,
	RICOCHET_ARROW,
	RICOCHET_ARROWS,
	RICOCHET_RANGE,
	RICOCHET_WEAPON_ID,
	SOUL_SHARD,
	SOUL_SHARDS_RANGE,
	SOUL_SWARM_RANGE,
	SOUL_SWARM_TURN,
	THRILL_SEEKER_GRAZES,
	THRILL_SEEKER_RING,
} from "./effectsData";
import { NO_SKIP_ID, fireAimedVolley, fireEffect, nearestEnemy } from "./effects";
import { buildPlayerLeft, buildPlayerStateAt, isEvolved, pushFlurry } from "./hooks";
import { stormBladeFinisher } from "./duos";

const RICOCHET_RANGE2 = RICOCHET_RANGE * RICOCHET_RANGE;
const SOUL_SWARM_RANGE2 = SOUL_SWARM_RANGE * SOUL_SWARM_RANGE;
const SOUL_SHARDS_RANGE2 = SOUL_SHARDS_RANGE * SOUL_SHARDS_RANGE;

/** True when some player of the run owns `boon` evolved. */
function anyEvolved(s: Readonly<BuildsState>, boon: number): boolean {
	for (const p of s.players) if (isEvolved(p, boon)) return true;
	return false;
}

/** Player `i` is present and alive (may release an effect). */
function canRelease(state: Readonly<SimState>, i: number): boolean {
	return !buildPlayerLeft(state, i) && buildPlayerStateAt(state, i).dead === 0;
}

// ---------------------------------------------------------------------------------------------
// Flurry (Swift Strikes III)

/**
 * A sword finisher swept (`hits` actors hit; `first` the first actor it hit, undefined when none); the acting player is
 * ctx's. See the file comment.
 */
export function buildsOnFinisher(ctx: SimCtx, hits: number, first?: Readonly<ActorState>): void {
	const s = ctx.state.builds;
	if (s === undefined) return;
	if (hits > 0) stormBladeFinisher(ctx, first);
	const owner = ctx.playerIndex;
	if (!isEvolved(s.players[owner], Boon.SWIFT_STRIKES)) return;
	const p = ctx.player;
	const n = fireEffect(ctx, owner, p.x, p.z, p.faceX, p.faceZ, FLURRY_CRESCENT, BuildEffect.FLURRY, 0);
	if (n > 0) pushFlurry(s, p.x, p.z, owner, FlurryKind.CRESCENT, n);
}

// ---------------------------------------------------------------------------------------------
// Ricochet (Piercing Arrows III): splits queued during this tick's player bullet walk, released in stepBuilds the
// same tick (same stepCombat call: never kept across ticks, so nothing here needs hashing).

const ricochetX: number[] = [];
const ricochetZ: number[] = [];
const ricochetOwner: number[] = [];
const ricochetGen: number[] = [];
const ricochetSkip: number[] = [];

/** True for the payload source of the bow's own arrows (a weapon source, not a build effect's). */
function isRicochetSource(source: number): boolean {
	return source >= 1 && source < BUILD_SOURCE_BASE && source - 1 === weaponIndex(RICOCHET_WEAPON_ID);
}

/**
 * A piercing player bullet with payload `source` damaged `a` at (x, z), credited to ctx's bound player, generation
 * ctx.procGen; `consumed`: that hit ended it. See the file comment.
 */
export function buildsOnPierceHit(
	ctx: SimCtx,
	a: Readonly<ActorState>,
	x: number,
	z: number,
	source: number,
	consumed: boolean,
): void {
	if (!consumed || a.alive !== 0) return;
	const s = ctx.state.builds;
	if (s === undefined || !isRicochetSource(source)) return;
	const owner = ctx.playerIndex;
	if (!isEvolved(s.players[owner], Boon.PIERCING_ARROWS)) return;
	ricochetX.push(x);
	ricochetZ.push(z);
	ricochetOwner.push(owner);
	ricochetGen.push(ctx.procGen);
	ricochetSkip.push(a.id);
}

function releaseRicochets(ctx: SimCtx, s: BuildsState): void {
	const e = s.events;
	for (let k = 0; k < ricochetX.size(); k++) {
		const owner = ricochetOwner[k];
		if (buildPlayerLeft(ctx.state, owner)) continue;
		const x = ricochetX[k];
		const z = ricochetZ[k];
		const n = fireAimedVolley(
			ctx,
			owner,
			x,
			z,
			RICOCHET_ARROWS,
			RICOCHET_RANGE2,
			ricochetSkip[k],
			RICOCHET_ARROW,
			BuildEffect.RICOCHET,
			ricochetGen[k],
		);
		if (n <= 0) continue;
		e.ricochetX.push(x);
		e.ricochetZ.push(z);
		e.ricochetOwner.push(owner);
		e.ricochetFired.push(n);
	}
	ricochetX.clear();
	ricochetZ.clear();
	ricochetOwner.clear();
	ricochetGen.clear();
	ricochetSkip.clear();
}

// ---------------------------------------------------------------------------------------------
// Soul Swarm steering

/** The ctx while the steering walk runs (synchronous, never re-entered). */
let steerCtx: SimCtx | undefined;
const steerExclude: number[] = [];

function steerVisit(i: number, pos: Readonly<Vec3>, payload: number): boolean {
	if (BulletPayload.get(payload, "kind") !== BulletKind.SHARD) return false;
	if (sourceEffect(BulletPayload.get(payload, "source")) !== BuildEffect.SOUL_SWARM) return false;
	const ctx = steerCtx!;
	steerExclude.clear();
	const lastHit = BulletPayload.get(payload, "lastHit");
	if (lastHit > 0) steerExclude.push(lastHit - 1);
	const k = nearestEnemy(ctx, pos.x, pos.z, SOUL_SWARM_RANGE2, NO_SKIP_ID, steerExclude);
	steerExclude.clear();
	if (k < 0) return false;
	const sim = ctx.combat.playerBullets;
	const v = sim.velocityAt(i);
	const speed = math.sqrt(v.x * v.x + v.z * v.z);
	const a = ctx.actors[k];
	const dx = a.x - pos.x;
	const dz = a.z - pos.z;
	const d = math.sqrt(dx * dx + dz * dz);
	if (!(speed > 0) || !(d > 0)) return false;
	const ux = v.x / speed + SOUL_SWARM_TURN * (dx / d);
	const uz = v.z / speed + SOUL_SWARM_TURN * (dz / d);
	const u = math.sqrt(ux * ux + uz * uz);
	if (!(u > 0)) return false;
	sim.setVelocity(i, (ux / u) * speed, (uz / u) * speed);
	return false;
}

function steerSoulSwarm(ctx: SimCtx, s: Readonly<BuildsState>): void {
	if (!anyEvolved(s, Boon.SOUL_SHARDS)) return;
	steerCtx = ctx;
	ctx.combat.playerBullets.forEachActive(steerVisit);
	steerCtx = undefined;
}

// ---------------------------------------------------------------------------------------------
// Novas (Overflowing, Bulwark)

function nova(ctx: SimCtx, s: BuildsState, i: number, radius: number, kind: number): void {
	const pl = buildPlayerStateAt(ctx.state, i);
	const before = ctx.events.bulletsDeleted;
	sweepArc(
		ctx,
		pl.x,
		pl.z,
		EFFECT_DIR_X,
		EFFECT_DIR_Z,
		radius,
		NOVA_HALF_ANGLE_COS,
		undefined,
		true,
		false,
		undefined,
		undefined,
		undefined,
		true, // goo erased quietly (the guard's rule)
	);
	const e = s.events;
	e.novaX.push(pl.x);
	e.novaZ.push(pl.z);
	e.novaRadius.push(radius);
	e.novaOwner.push(i);
	e.novaKind.push(kind);
	e.novaErased.push(ctx.events.bulletsDeleted - before + sweepGooErased());
}

function releaseNovas(ctx: SimCtx, s: BuildsState): void {
	const state = ctx.state;
	for (let i = 0; i < s.players.size(); i++) {
		const p = s.players[i];
		const live = canRelease(state, i);
		if (live && isEvolved(p, Boon.DEEP_FLASK) && buildPlayerStateAt(state, i).flaskTicks === FLASK_USE_TICKS) {
			nova(ctx, s, i, OVERFLOWING_NOVA_RADIUS, NovaKind.OVERFLOWING);
		}
		while (p.bulwarkPending > 0) {
			p.bulwarkPending -= 1;
			if (live) nova(ctx, s, i, BULWARK_NOVA_RADIUS, NovaKind.BULWARK);
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Thrill Seeker, Momentum

function releaseThrillRings(ctx: SimCtx, s: BuildsState): void {
	const state = ctx.state;
	const e = s.events;
	for (let i = 0; i < s.players.size(); i++) {
		const p = s.players[i];
		while (p.grazes >= THRILL_SEEKER_GRAZES) {
			p.grazes -= THRILL_SEEKER_GRAZES;
			if (!canRelease(state, i)) continue;
			const pl = buildPlayerStateAt(state, i);
			const n = fireEffect(
				ctx,
				i,
				pl.x,
				pl.z,
				EFFECT_DIR_X,
				EFFECT_DIR_Z,
				THRILL_SEEKER_RING,
				BuildEffect.THRILL_SEEKER,
				0,
			);
			if (n <= 0) continue;
			e.thrillX.push(pl.x);
			e.thrillZ.push(pl.z);
			e.thrillOwner.push(i);
			e.thrillFired.push(n);
		}
	}
}

/** stepBuilds phase 3 (see the file comment). */
export function stepMomentum(ctx: SimCtx, s: BuildsState): void {
	const state = ctx.state;
	const score = state.score;
	if (score === undefined) return;
	const from = score.events.comboStart;
	const to = score.combo;
	if (to <= from || !anyEvolved(s, Boon.LINGERING)) return;
	const e = s.events;
	for (let tier = MOMENTUM_TIER_FIRST; tier <= MOMENTUM_TIER_LAST; tier++) {
		const at = tier * COMBO_DENOMINATOR;
		if (!(from < at && at <= to)) continue;
		for (let i = 0; i < s.players.size(); i++) {
			if (!isEvolved(s.players[i], Boon.LINGERING) || !canRelease(state, i)) continue;
			const pl = buildPlayerStateAt(state, i);
			const n = fireAimedVolley(
				ctx,
				i,
				pl.x,
				pl.z,
				tier,
				SOUL_SHARDS_RANGE2,
				NO_SKIP_ID,
				SOUL_SHARD,
				BuildEffect.MOMENTUM,
				0,
			);
			if (n <= 0) continue;
			e.momentumX.push(pl.x);
			e.momentumZ.push(pl.z);
			e.momentumOwner.push(i);
			e.momentumTier.push(tier);
			e.momentumFired.push(n);
		}
	}
}

/** stepBuilds phase 1 (see the file comment). */
export function stepEvolutions(ctx: SimCtx, s: BuildsState): void {
	if (ricochetX.size() > 0) releaseRicochets(ctx, s);
	steerSoulSwarm(ctx, s);
	releaseNovas(ctx, s);
	releaseThrillRings(ctx, s);
}

// ---------------------------------------------------------------------------------------------
// Phantom Step (Slippery III)

/** True when Phantom Step erases enemy bullets overlapping player `i` this tick (see the file comment). */
export function phantomStepOn(state: Readonly<SimState>, i: number): boolean {
	const p = state.builds?.players[i];
	if (!isEvolved(p, Boon.SLIPPERY) || buildPlayerLeft(state, i)) return false;
	const pl = buildPlayerStateAt(state, i);
	return pl.dead === 0 && pl.rollTicks > 0 && pl.iframeTicks > 0;
}

/** Phantom Step erased an enemy bullet at (x, z) over player `i` (goo: quietly, no entry). */
export function phantomStepErased(state: SimState, i: number, goo: boolean, x: number, z: number): void {
	const s = state.builds;
	if (s === undefined || goo) return;
	const e = s.events;
	e.phantomX.push(x);
	e.phantomZ.push(z);
	e.phantomOwner.push(i);
}

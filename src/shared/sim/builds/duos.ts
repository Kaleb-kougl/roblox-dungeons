/**
 * The duo rules inside stepCombat (docs/BUILDS.md "Duo boons", BU6; a Roblox-port feature, no web source). Every rule
 * is reached only with state.builds and does nothing for a player who does not own the duo (./hooks.ts hasDuo; both of
 * its boons owned by the same player, BUD7) or who left. Shrapnel lives in ./onKill.ts (Volatile's ring), Gold Rush and
 * Unshaken in the score path (./hooks.ts, score.ts), Close Call's graze count in ./hooks.ts buildsOnGraze.
 *
 * Arrows: a bow arrow is a player bullet of kind PLAYER whose payload source is the bow's (DUO_ARROW_WEAPON_ID's index
 * + 1) and whose squared speed matches the stream arrow's or the heavy arrow's (BOW_DATA, within ARROW_SPEED_TOLERANCE):
 * stream arrows, heavy arrows and Flurry's triples are arrows; the Ember Wake ring fired with the bow in hand (same
 * source, ROLL_RING_SPEED) and Ricochet's split arrows (effect bolts) are not.
 *
 * Hooks called during the phases of stepCombat:
 *   buildsOnArrowHit(ctx, a, i, payload, passing)   combat.ts, after each actor a player bullet damages (`passing`:
 *                                   a piercing bullet that flies on). For bow arrows:
 *                                   Storm Blade (Chain Spark + Swift Strikes): the hit counts in `bigHits`; every
 *                                   STORM_BLADE_ARROW_HITS-th queues a spark from the enemy hit.
 *                                   Conductor (Chain Spark + Piercing Arrows): a passing arrow queues a one-hop spark
 *                                   from the enemy it passed through.
 *   stormBladeFinisher(ctx, first)  ./evolutions.ts buildsOnFinisher (sword.ts): a finisher that hit (`first`: the
 *                                   first actor its sweep hit) queues a Storm Blade spark from that actor.
 *   chainReactionKill(ctx, s, p, owner, a)   ./procs.ts buildsOnKill, for a kill of generation exactly genMax (whose
 *                                   proc is never queued): Chain Reaction (Volatile + Chain Spark) queues the cross
 *                                   trigger when the kill was by a spark (ctx.procCause SPARK) or a Volatile bolt
 *                                   (BURST).
 * Queues live in module scratch from the hook to stepBuilds of the same stepCombat call (never across ticks, so not
 * hashed), like Ricochet's.
 *
 * stepBuilds' duo phases (./procs.ts, inside the effect budget session):
 *   stepDuosBeforeDrain, after stepEvolutions, before the proc drain:
 *     a. Close Call: per CLOSE_CALL_GRAZES grazes counted (`closeGrazes`), one CLOSE_CALL_SHARD from the player at the
 *        nearest living enemy within CLOSE_CALL_RANGE (fireAimedVolley, effect CLOSE_CALL, gen 0); a dead or departed
 *        owner's shards are dropped, no enemy in range: none
 *     b. Fire Arrows (Ember Wake + Piercing Arrows): every live bow arrow of an owner drops an EMBER_BURST ember where it
 *        is when its age (ticks since it was fired: round((spawn life - life) x SIM_HZ), 1 on the tick it was fired) is
 *        a multiple of FIRE_ARROWS_EMBER_TICKS, at most FIRE_ARROWS_EMBERS_MAX per arrow (ages 6, 12, 18, 24). The
 *        spawn life is the bow's (stream or heavy) found by the speed match, so the counter is the bullet's own life:
 *        no new payload field. Embers in the walk's order (dense slots, backwards). Dragon Bolt (Ballista + Ember
 *        Wake, docs/BUILDS_V2.md BV6) in the same walk: every live HEAVY arrow of an owner drops an ember at every age
 *        that is a multiple of DRAGON_BOLT_EMBER_TICKS for its whole flight (no FIRE_ARROWS_EMBERS_MAX; ember duo
 *        DRAGON_BOLT); an owner of both duos gets Dragon Bolt's schedule on heavy arrows, Fire Arrows' on the rest
 *     c. Blazing Trail (Ember Wake + Slippery): a rolling, living owner drops an ember where they stand when the roll's
 *        elapsed ticks (ROLL_TICKS - rollTicks, 0 on the start tick) are a positive multiple of
 *        BLAZING_TRAIL_EMBER_TICKS (6 embers per roll: elapsed 3 .. 18), players in index order
 *     Embers go through fireEffect (effect EMBER, gen 0, EFFECT_DIR, speed 0): they count in the owner's effect
 *     budget, hit like any non-piercing player bullet (the first enemy that touches one consumes it; payload damage 1
 *     through playerHitDamage; a kill procs at gen 1), stop on walls and intact breakables exactly like other player
 *     bullets, and never touch enemy bullets (no player bullet does).
 *   stepDuosAfterDrain, after the drain (so the kills of these sparks proc next tick, one generation per tick):
 *     d. the queued sparks, in queue order (Thunder Guard's, docs/BUILDS_V2.md BV6: one per bullet a guard erased, at
 *        most THUNDER_GUARD_MAX a guard tick, queued from the sword's guard by ./riposte.ts; each strikes the nearest
 *        living enemy within THUNDER_GUARD_RANGE of the erased bullet for playerHitDamage(owner, THUNDER_GUARD_DAMAGE)
 *        at generation 1, a spark segment with sparkFork THUNDER): Storm Blade fires the owner's Chain Spark as if the enemy hit had died
 *        there (./onKill.ts chainSpark at the owner's level, generation 0: its kills proc at gen 1; the enemy hit is the
 *        victim it skips); Conductor strikes the nearest OTHER living enemy within CONDUCTOR_RANGE of the enemy passed
 *        through (nearestEnemy) for playerHitDamage(owner, CONDUCTOR_DAMAGE), one hop, generation 0 (its kill procs at
 *        gen 1)
 *     e. Chain Reaction's cross triggers: a genMax kill by a spark bursts (Volatile at the owner's level, Shrapnel
 *        included) and one by a Volatile bolt sparks (Chain Spark at the owner's level), both AT generation genMax:
 *        nothing a generation-genMax effect kills ever procs (its kill is genMax + 1), so no effect ever goes past
 *        genMax. Below genMax the ordinary proc already fires both effects for every kill.
 */
import type { SimCtx } from "../combat/ctx";
import type { SimState } from "../state";
import type { Vec3 } from "../combat/bullets";
import type { ActorState } from "../combat/actors/types";
import type { BowData } from "../combat/weapons/defs/bow";
import { BulletKind, BulletPayload } from "../combat/patterns";
import { weaponAt, weaponIndex } from "../combat/weapons/registry";
import { playerBulletOwner } from "../party";
import { ROLL_TICKS } from "../playerData";
import { SIM_HZ } from "../units";
import { Boon } from "../progression/progressionData";
import { playerHitDamage } from "../progression/runMods";
import { buildLevel, type BuildPlayerState, type BuildProc, type BuildsState } from "./builds";
import { BuildEffect, Duo, ProcKind } from "./buildsData";
import {
	ARROW_SPEED_TOLERANCE,
	BLAZING_TRAIL_EMBER_TICKS,
	CLOSE_CALL_GRAZES,
	CLOSE_CALL_RANGE,
	CLOSE_CALL_SHARD,
	CONDUCTOR_DAMAGE,
	CONDUCTOR_RANGE,
	DRAGON_BOLT_EMBER_TICKS,
	DUO_ARROW_WEAPON_ID,
	EFFECT_DIR_X,
	EFFECT_DIR_Z,
	EMBER_BURST,
	FIRE_ARROWS_EMBERS_MAX,
	FIRE_ARROWS_EMBER_TICKS,
	KillCause,
	STORM_BLADE_ARROW_HITS,
	SparkFork,
	THUNDER_GUARD_DAMAGE,
	THUNDER_GUARD_RANGE,
} from "./effectsData";
import { NO_SKIP_ID, fireAimedVolley, fireEffect, nearestEnemy } from "./effects";
import { buildPlayerLeft, buildPlayerStateAt, hasDuo, pushDuoProc } from "./hooks";
import { chainSpark, volatileBurst } from "./onKill";

const CLOSE_CALL_RANGE2 = CLOSE_CALL_RANGE * CLOSE_CALL_RANGE;
const CONDUCTOR_RANGE2 = CONDUCTOR_RANGE * CONDUCTOR_RANGE;
const THUNDER_GUARD_RANGE2 = THUNDER_GUARD_RANGE * THUNDER_GUARD_RANGE;
/** Fire Arrows' last ember age (ticks). */
const FIRE_ARROWS_LAST_AGE = FIRE_ARROWS_EMBER_TICKS * FIRE_ARROWS_EMBERS_MAX;
/** Nothing excluded (nearestEnemy's `exclude`). */
const NO_EXCLUDE: ReadonlyArray<number> = [];

/** True when some player of the run owns `duo`. */
function anyDuo(s: Readonly<BuildsState>, duo: number): boolean {
	for (const p of s.players) if (hasDuo(p, duo)) return true;
	return false;
}

/** Player `i` is present and alive (may release an effect). */
function canRelease(state: Readonly<SimState>, i: number): boolean {
	return !buildPlayerLeft(state, i) && buildPlayerStateAt(state, i).dead === 0;
}

// ---------------------------------------------------------------------------------------------
// Bow arrows

/** The bow's payload source, its arrows' squared speeds and spawn lives (stream, heavy); read once, lazily. */
let arrowSource = -1;
const arrowSpeed2: number[] = [];
const arrowLife: number[] = [];

function readArrows(): void {
	const index = weaponIndex(DUO_ARROW_WEAPON_ID);
	const data = weaponAt(index).data as BowData;
	arrowSource = index + 1;
	arrowSpeed2.push(data.speed * data.speed, data.heavySpeed * data.heavySpeed);
	arrowLife.push(data.life, data.heavyLife);
}

/**
 * The life player bullet `i` (payload `payload`) was fired with when it is a bow arrow (see the file comment), else -1.
 * `vx` / `vz`: its velocity.
 */
export function bowArrowLife(payload: number, vx: number, vz: number): number {
	if (BulletPayload.get(payload, "kind") !== BulletKind.PLAYER) return -1;
	if (arrowSource < 0) readArrows();
	if (BulletPayload.get(payload, "source") !== arrowSource) return -1;
	const v2 = vx * vx + vz * vz;
	for (let k = 0; k < arrowSpeed2.size(); k++) {
		const s2 = arrowSpeed2[k];
		const diff = v2 > s2 ? v2 - s2 : s2 - v2;
		if (diff <= s2 * ARROW_SPEED_TOLERANCE) return arrowLife[k];
	}
	return -1;
}

/** arrowSpeed2 / arrowLife index of the heavy arrow (readArrows: stream, heavy). */
const HEAVY_ARROW = 1;

/**
 * True when player bullet with payload `payload` and velocity (vx, vz) is a heavy (charged) bow arrow: kind PLAYER, the
 * bow's source, the heavy arrow's squared speed (bowArrowLife's test; docs/BUILDS_V2.md BV3: Ballista and Siege Bolt
 * find their arrows by it). Stream and Flurry arrows (16), the bow-held Ember Wake ring (12) and every effect bolt are not.
 */
export function isHeavyArrow(payload: number, vx: number, vz: number): boolean {
	if (BulletPayload.get(payload, "kind") !== BulletKind.PLAYER) return false;
	if (arrowSource < 0) readArrows();
	if (BulletPayload.get(payload, "source") !== arrowSource) return false;
	const s2 = arrowSpeed2[HEAVY_ARROW];
	const v2 = vx * vx + vz * vz;
	const diff = v2 > s2 ? v2 - s2 : s2 - v2;
	return diff <= s2 * ARROW_SPEED_TOLERANCE;
}

// ---------------------------------------------------------------------------------------------
// Sparks queued during the tick (Storm Blade, Conductor), released after the drain

const sparkDuo: number[] = [];
const sparkOwner: number[] = [];
const sparkX: number[] = [];
const sparkZ: number[] = [];
const sparkSlot: number[] = [];
const sparkId: number[] = [];

function queueSpark(ctx: SimCtx, duo: number, owner: number, a: Readonly<ActorState>): void {
	sparkDuo.push(duo);
	sparkOwner.push(owner);
	sparkX.push(a.x);
	sparkZ.push(a.z);
	sparkSlot.push(ctx.actors.indexOf(a as ActorState));
	sparkId.push(a.id);
}

/**
 * Thunder Guard (Riposte + Chain Spark, docs/BUILDS_V2.md BV6): a guard of `owner` erased an enemy bullet at (x, z);
 * ./riposte.ts buildsOnRiposteGuard checks the duo and the cap (THUNDER_GUARD_MAX a guard tick). Released after the
 * drain with the other queued sparks (thunderSpark).
 */
export function queueThunderSpark(owner: number, x: number, z: number): void {
	sparkDuo.push(Duo.THUNDER_GUARD);
	sparkOwner.push(owner);
	sparkX.push(x);
	sparkZ.push(z);
	sparkSlot.push(-1);
	sparkId.push(NO_SKIP_ID);
}

/** A sword finisher hit `first` first (undefined: it hit nothing); the acting player is ctx's. Storm Blade. */
export function stormBladeFinisher(ctx: SimCtx, first: Readonly<ActorState> | undefined): void {
	if (first === undefined) return;
	const owner = ctx.playerIndex;
	if (!hasDuo(ctx.state.builds?.players[owner], Duo.STORM_BLADE) || buildPlayerLeft(ctx.state, owner)) return;
	queueSpark(ctx, Duo.STORM_BLADE, owner, first);
}

/**
 * Player bullet `i` (payload `payload`) damaged `a`, credited to ctx's bound player; `passing`: it is a piercing
 * bullet that flies on. Storm Blade's count and Conductor (see the file comment).
 */
export function buildsOnArrowHit(
	ctx: SimCtx,
	a: Readonly<ActorState>,
	i: number,
	payload: number,
	passing: boolean,
): void {
	const s = ctx.state.builds;
	if (s === undefined) return;
	const owner = ctx.playerIndex;
	const p = s.players[owner];
	const storm = hasDuo(p, Duo.STORM_BLADE);
	const conduct = passing && hasDuo(p, Duo.CONDUCTOR);
	if ((!storm && !conduct) || buildPlayerLeft(ctx.state, owner)) return;
	const v = ctx.combat.playerBullets.velocityAt(i);
	if (bowArrowLife(payload, v.x, v.z) < 0) return;
	if (storm) {
		p.bigHits += 1;
		if (p.bigHits >= STORM_BLADE_ARROW_HITS) {
			p.bigHits -= STORM_BLADE_ARROW_HITS;
			queueSpark(ctx, Duo.STORM_BLADE, owner, a);
		}
	}
	if (conduct) queueSpark(ctx, Duo.CONDUCTOR, owner, a);
}

/** Scratch proc for Storm Blade and Chain Reaction (never re-entered: chainSpark / volatileBurst only queue procs). */
const pseudo: BuildProc = { x: 0, z: 0, owner: 0, gen: 0, slot: 0, id: 0, excess: 0, kind: ProcKind.KILL };

function setPseudo(x: number, z: number, owner: number, gen: number, slot: number, id: number): BuildProc {
	pseudo.x = x;
	pseudo.z = z;
	pseudo.owner = owner;
	pseudo.gen = gen;
	pseudo.slot = slot;
	pseudo.id = id;
	return pseudo;
}

/** Conductor's one hop from (x, z), never the actor with id `skipId`. Returns the enemies struck (0 or 1). */
function conductorSpark(ctx: SimCtx, s: BuildsState, owner: number, x: number, z: number, skipId: number): number {
	const k = nearestEnemy(ctx, x, z, CONDUCTOR_RANGE2, skipId, NO_EXCLUDE);
	if (k < 0) return 0;
	const a = ctx.actors[k];
	const e = s.events;
	e.sparkX1.push(x);
	e.sparkZ1.push(z);
	e.sparkX2.push(a.x);
	e.sparkZ2.push(a.z);
	e.sparkOwner.push(owner);
	e.sparkGen.push(0);
	e.sparkFork.push(0);
	ctx.procGen = 1;
	ctx.procCause = KillCause.SPARK;
	ctx.damageActor(a, playerHitDamage(ctx.state, owner, CONDUCTOR_DAMAGE));
	ctx.procGen = 0;
	ctx.procCause = KillCause.NONE;
	return 1;
}

/**
 * Thunder Guard's spark from an erased bullet at (x, z): the nearest living enemy within THUNDER_GUARD_RANGE
 * (nearestEnemy) takes playerHitDamage(owner, THUNDER_GUARD_DAMAGE), generation 1 (its kill procs at gen 1), one spark
 * segment with sparkFork SparkFork.THUNDER. Returns the enemies struck (0 or 1).
 */
function thunderSpark(ctx: SimCtx, s: BuildsState, owner: number, x: number, z: number): number {
	const k = nearestEnemy(ctx, x, z, THUNDER_GUARD_RANGE2, NO_SKIP_ID, NO_EXCLUDE);
	if (k < 0) return 0;
	const a = ctx.actors[k];
	const e = s.events;
	e.sparkX1.push(x);
	e.sparkZ1.push(z);
	e.sparkX2.push(a.x);
	e.sparkZ2.push(a.z);
	e.sparkOwner.push(owner);
	e.sparkGen.push(0);
	e.sparkFork.push(SparkFork.THUNDER);
	ctx.procGen = 1;
	ctx.procCause = KillCause.SPARK;
	ctx.damageActor(a, playerHitDamage(ctx.state, owner, THUNDER_GUARD_DAMAGE));
	ctx.procGen = 0;
	ctx.procCause = KillCause.NONE;
	return 1;
}

function releaseSparks(ctx: SimCtx, s: BuildsState): void {
	const e = s.events;
	for (let k = 0; k < sparkDuo.size(); k++) {
		const owner = sparkOwner[k];
		const p = s.players[owner];
		if (p === undefined || buildPlayerLeft(ctx.state, owner)) continue;
		const duo = sparkDuo[k];
		const x = sparkX[k];
		const z = sparkZ[k];
		ctx.actingPlayer(owner);
		let struck: number;
		if (duo === Duo.STORM_BLADE) {
			const before = e.sparkX1.size();
			chainSpark(ctx, s, setPseudo(x, z, owner, 0, sparkSlot[k], sparkId[k]), buildLevel(p, Boon.CHAIN_SPARK));
			struck = e.sparkX1.size() - before;
		} else if (duo === Duo.THUNDER_GUARD) {
			struck = thunderSpark(ctx, s, owner, x, z);
		} else {
			struck = conductorSpark(ctx, s, owner, x, z, sparkId[k]);
		}
		if (struck > 0) pushDuoProc(s, duo, owner, x, z, struck);
	}
	sparkDuo.clear();
	sparkOwner.clear();
	sparkX.clear();
	sparkZ.clear();
	sparkSlot.clear();
	sparkId.clear();
}

// ---------------------------------------------------------------------------------------------
// Chain Reaction: cross triggers of genMax kills

const crossOwner: number[] = [];
const crossX: number[] = [];
const crossZ: number[] = [];
const crossSlot: number[] = [];
const crossId: number[] = [];
const crossCause: number[] = [];

/** A kill of generation exactly genMax credited to `owner` (build `p`): see the file comment. */
export function chainReactionKill(
	ctx: SimCtx,
	p: Readonly<BuildPlayerState>,
	owner: number,
	a: Readonly<ActorState>,
): void {
	const cause = ctx.procCause;
	// Only a spark's or a Volatile bolt's kill (an Overkill streak's, KillCause.OVERKILL, never cross-triggers).
	if ((cause !== KillCause.SPARK && cause !== KillCause.BURST) || !hasDuo(p, Duo.CHAIN_REACTION)) return;
	crossOwner.push(owner);
	crossX.push(a.x);
	crossZ.push(a.z);
	crossSlot.push(ctx.actors.indexOf(a as ActorState));
	crossId.push(a.id);
	crossCause.push(cause);
}

function releaseCrosses(ctx: SimCtx, s: BuildsState): void {
	const e = s.events;
	const gen = s.config.genMax;
	// A cross trigger's own kills are genMax + 1 and never queue another, but read the bound live anyway.
	let k = 0;
	while (k < crossOwner.size()) {
		const owner = crossOwner[k];
		const p = s.players[owner];
		if (p !== undefined && !buildPlayerLeft(ctx.state, owner)) {
			const x = crossX[k];
			const z = crossZ[k];
			const q = setPseudo(x, z, owner, gen, crossSlot[k], crossId[k]);
			ctx.actingPlayer(owner);
			let value: number;
			if (crossCause[k] === KillCause.SPARK) {
				value = volatileBurst(ctx, s, q, buildLevel(p, Boon.VOLATILE));
			} else {
				const before = e.sparkX1.size();
				chainSpark(ctx, s, q, buildLevel(p, Boon.CHAIN_SPARK));
				value = e.sparkX1.size() - before;
			}
			if (value > 0) pushDuoProc(s, Duo.CHAIN_REACTION, owner, x, z, value);
		}
		k++;
	}
	crossOwner.clear();
	crossX.clear();
	crossZ.clear();
	crossSlot.clear();
	crossId.clear();
	crossCause.clear();
}

// ---------------------------------------------------------------------------------------------
// Close Call, embers

function releaseCloseCalls(ctx: SimCtx, s: BuildsState): void {
	const state = ctx.state;
	for (let i = 0; i < s.players.size(); i++) {
		const p = s.players[i];
		while (p.closeGrazes >= CLOSE_CALL_GRAZES) {
			p.closeGrazes -= CLOSE_CALL_GRAZES;
			if (!canRelease(state, i)) continue;
			const pl = buildPlayerStateAt(state, i);
			const n = fireAimedVolley(
				ctx,
				i,
				pl.x,
				pl.z,
				1,
				CLOSE_CALL_RANGE2,
				NO_SKIP_ID,
				CLOSE_CALL_SHARD,
				BuildEffect.CLOSE_CALL,
				0,
			);
			if (n > 0) pushDuoProc(s, Duo.CLOSE_CALL, i, pl.x, pl.z, n);
		}
	}
}

/** One ember for `owner` at (x, z) from duo `duo` (fireEffect; a BuildEvents ember entry when it spawned). */
function dropEmber(ctx: SimCtx, s: BuildsState, owner: number, x: number, z: number, duo: number): void {
	const n = fireEffect(ctx, owner, x, z, EFFECT_DIR_X, EFFECT_DIR_Z, EMBER_BURST, BuildEffect.EMBER, 0);
	if (n <= 0) return;
	const e = s.events;
	e.emberX.push(x);
	e.emberZ.push(z);
	e.emberOwner.push(owner);
	e.emberDuo.push(duo);
}

/** Per player (party index): Fire Arrows drops embers from their arrows this tick. */
const fireArrowsOn: boolean[] = [];
/** Per player (party index): Dragon Bolt (docs/BUILDS_V2.md BV6) drops embers from their heavy arrows this tick. */
const dragonBoltOn: boolean[] = [];
/** The ctx while the Fire Arrows walk runs (synchronous, never re-entered). */
let walkCtx: SimCtx | undefined;
/** Embers the walk found (fired after it: the walk never spawns into the pool it walks). */
const emberOwner: number[] = [];
const emberX: number[] = [];
const emberZ: number[] = [];
/** The Duo of each ember the walk found (FIRE_ARROWS or DRAGON_BOLT). */
const emberDuo: number[] = [];

function fireArrowsVisit(i: number, pos: Readonly<Vec3>, payload: number, emitter: number): boolean {
	const owner = playerBulletOwner(emitter);
	const fire = fireArrowsOn[owner] === true;
	const dragon = dragonBoltOn[owner] === true;
	if (!fire && !dragon) return false;
	const sim = walkCtx!.combat.playerBullets;
	const v = sim.velocityAt(i);
	const spawnLife = bowArrowLife(payload, v.x, v.z);
	if (spawnLife < 0) return false;
	const age = math.floor((spawnLife - sim.lifeAt(i)) * SIM_HZ + 0.5);
	// Dragon Bolt (BV6): a heavy arrow drops an ember every DRAGON_BOLT_EMBER_TICKS of its whole flight (no
	// FIRE_ARROWS_EMBERS_MAX); with Fire Arrows too, this schedule replaces Fire Arrows' on heavy arrows (a superset).
	if (dragon && spawnLife === arrowLife[HEAVY_ARROW]) {
		if (age <= 0 || age % DRAGON_BOLT_EMBER_TICKS !== 0) return false;
		pushEmber(owner, pos, Duo.DRAGON_BOLT);
		return false;
	}
	if (!fire) return false;
	if (age <= 0 || age > FIRE_ARROWS_LAST_AGE || age % FIRE_ARROWS_EMBER_TICKS !== 0) return false;
	pushEmber(owner, pos, Duo.FIRE_ARROWS);
	return false;
}

function pushEmber(owner: number, pos: Readonly<Vec3>, duo: number): void {
	emberOwner.push(owner);
	emberX.push(pos.x);
	emberZ.push(pos.z);
	emberDuo.push(duo);
}

function fireArrows(ctx: SimCtx, s: BuildsState): void {
	const fire = anyDuo(s, Duo.FIRE_ARROWS);
	const dragon = anyDuo(s, Duo.DRAGON_BOLT);
	if (!fire && !dragon) return;
	fireArrowsOn.clear();
	dragonBoltOn.clear();
	for (let i = 0; i < s.players.size(); i++) {
		const present = !buildPlayerLeft(ctx.state, i);
		fireArrowsOn.push(hasDuo(s.players[i], Duo.FIRE_ARROWS) && present);
		dragonBoltOn.push(hasDuo(s.players[i], Duo.DRAGON_BOLT) && present);
	}
	walkCtx = ctx;
	ctx.combat.playerBullets.forEachActive(fireArrowsVisit);
	walkCtx = undefined;
	for (let k = 0; k < emberOwner.size(); k++) dropEmber(ctx, s, emberOwner[k], emberX[k], emberZ[k], emberDuo[k]);
	emberOwner.clear();
	emberX.clear();
	emberZ.clear();
	emberDuo.clear();
}

function blazingTrail(ctx: SimCtx, s: BuildsState): void {
	const state = ctx.state;
	for (let i = 0; i < s.players.size(); i++) {
		if (!hasDuo(s.players[i], Duo.BLAZING_TRAIL) || !canRelease(state, i)) continue;
		const pl = buildPlayerStateAt(state, i);
		if (pl.rollTicks <= 0) continue;
		const elapsed = ROLL_TICKS - pl.rollTicks;
		if (elapsed <= 0 || elapsed % BLAZING_TRAIL_EMBER_TICKS !== 0) continue;
		dropEmber(ctx, s, i, pl.x, pl.z, Duo.BLAZING_TRAIL);
	}
}

// ---------------------------------------------------------------------------------------------
// stepBuilds phases

/** stepBuilds, after stepEvolutions, before the proc drain (see the file comment). */
export function stepDuosBeforeDrain(ctx: SimCtx, s: BuildsState): void {
	releaseCloseCalls(ctx, s);
	fireArrows(ctx, s);
	blazingTrail(ctx, s);
}

/** stepBuilds, after the proc drain (see the file comment). */
export function stepDuosAfterDrain(ctx: SimCtx, s: BuildsState): void {
	if (sparkDuo.size() > 0) releaseSparks(ctx, s);
	if (crossOwner.size() > 0) releaseCrosses(ctx, s);
}

/** Drops this module's per-tick scratch (queued sparks, Chain Reaction crosses, the Fire Arrows walk): see
 * resetBuildScratch. */
export function resetDuoScratch(): void {
	sparkDuo.clear();
	sparkOwner.clear();
	sparkX.clear();
	sparkZ.clear();
	sparkSlot.clear();
	sparkId.clear();
	crossOwner.clear();
	crossX.clear();
	crossZ.clear();
	crossSlot.clear();
	crossId.clear();
	crossCause.clear();
	fireArrowsOn.clear();
	dragonBoltOn.clear();
	walkCtx = undefined;
	emberOwner.clear();
	emberX.clear();
	emberZ.clear();
	emberDuo.clear();
}

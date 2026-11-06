/**
 * The three on-kill boons (docs/BUILDS.md "The three on-kill boons", BU4; a Roblox-port feature, no web source):
 * what one proc (./procs.ts) does for each on-kill boon its owner has, at the owner's level. Every number is a
 * level-indexed table in ./effectsData.ts (levelValue / levelEntry: level I is entry 0); level III (BU5) reads the III
 * entries (Storm Crown's 4 hops / 3 damage, Cataclysm's 16 piercing bolts, Soul Swarm's 4 piercing shards) and adds its
 * rule: Storm Crown's fork (below), Soul Swarm's source (BuildEffect.SOUL_SWARM: stepBuilds steers those shards,
 * ./evolutions.ts). Cataclysm's rule is its pierce (VOLATILE_BURSTS[2]).
 *
 *   Chain Spark  instant. From the corpse, `hops` times: the nearest living enemy within CHAIN_SPARK_RANGE of the
 *                current point (squared distance, ties by slot; ./effects.ts nearestEnemy: never the victim, never an
 *                enemy this spark already hit, never one spawned this tick) takes playerHitDamage(owner, damage)
 *                through ctx.damageActor with ctx.procGen = the proc's gen + 1 (its kill procs one generation on);
 *                the next hop starts from that enemy's position (dead or not). No target: the spark stops. One
 *                BuildEvents spark segment per hop that hit (sparkFork 0). Storm Crown (III): after each hop's strike,
 *                the nearest OTHER enemy within range of the hop's start (same skips; never one already struck) takes
 *                playerHitDamage(owner, max(CHAIN_SPARK_FORK_MIN, floor(damage / CHAIN_SPARK_FORK_DIVISOR))): one more
 *                segment from the hop's start, sparkFork 1. Forks never hop on.
 *   Volatile     a ring of VOLATILE_BURSTS[level] bolts from the corpse, heading EFFECT_DIR (fireEffect: effect
 *                VOLATILE, the proc's gen; the bolts hit through playerBulletHit, so playerHitDamage applies there).
 *                Shrapnel (the Volatile + Sharpened duo, BU6): SHRAPNEL_BURSTS[level] instead (same rings, damage
 *                SHRAPNEL_DAMAGE, pierce SHRAPNEL_PIERCE; III SHRAPNEL_CATACLYSM_PIERCE).
 *   Sparks set ctx.procCause = KillCause.SPARK beside ctx.procGen around each strike (Chain Reaction, BU6).
 *   Soul Shards  SOUL_SHARDS_COUNTS[level] shards. Targets: up to that many living enemies within SOUL_SHARDS_RANGE of
 *                the corpse, nearest first (ties by slot, same skips as the spark); shard i flies at target i, the
 *                shards beyond the targets found at the nearest one; each is aimed at spawn (a unit vector by sqrt,
 *                no trig; EFFECT_DIR when the target stands on the corpse; ./effects.ts fireAimedVolley) and flies
 *                straight (BUD11), except Soul Swarm's (III), which steer. No target: no shard.
 *   Overkill     (docs/LEGENDARIES.md LG2; legendary, level I only) instant, Chain Spark's shape: a proc whose `excess`
 *                (the kill's carry, ./execute.ts buildsKillCarry) is at least OVERKILL_MIN_CARRY streaks from the
 *                corpse to the nearest living enemy within OVERKILL_RANGE (nearestEnemy, the spark's skips) and deals
 *                it the carry as is (no playerHitDamage: the carry already is the owner's damage, LGD4) through
 *                ctx.damageActor with ctx.procGen = the proc's gen + 1 and ctx.procCause = KillCause.OVERKILL; that
 *                strike's kill queues its own proc with its own carry, so a chain ripples one generation per tick
 *                and stops at genMax. Bosses can be struck (their cap applies) and never carry; the Goldling can be
 *                struck (LGD12). No target: the carry is lost (no event). One BuildEvents overkill segment per streak.
 *                Skewer (Overkill + Piercing Arrows, LG4): the streak also strikes every other enemy within
 *                SKEWER_RADIUS of the segment from the corpse through the target to OVERKILL_RANGE, each for the full
 *                carry, in slot order, the target last (see overkill).
 *   Supernova    (Overkill + Volatile, LG4): a proc whose carry is at least SUPERNOVA_CARRY (2) bursts one Volatile ring
 *                larger (SUPERNOVA_BURSTS, or SUPERNOVA_SHRAPNEL_BURSTS with Shrapnel: I -> 12, II -> 16, III -> 16
 *                that pierce 2; the existing 12 / 16 @ FULL_RING arc rows only).
 */
import type { SimCtx } from "../combat/ctx";
import { NO_KIND } from "../combat/actors/types";
import { playerHitDamage } from "../progression/runMods";
import { BOON_MAX_LEVEL, levelValue } from "../progression/progressionData";
import type { BuildProc, BuildsState } from "./builds";
import { BuildEffect, Duo } from "./buildsData";
import {
	CHAIN_SPARK_DAMAGE,
	CHAIN_SPARK_FORK_DIVISOR,
	CHAIN_SPARK_FORK_MIN,
	CHAIN_SPARK_HOPS,
	CHAIN_SPARK_RANGE,
	EFFECT_DIR_X,
	EFFECT_DIR_Z,
	KillCause,
	OVERKILL_MIN_CARRY,
	OVERKILL_RANGE,
	SHRAPNEL_BURSTS,
	SKEWER_RADIUS,
	SOUL_SHARDS_COUNTS,
	SOUL_SHARDS_RANGE,
	SOUL_SHARD_SPECS,
	SUPERNOVA_BURSTS,
	SUPERNOVA_CARRY,
	SUPERNOVA_SHRAPNEL_BURSTS,
	VOLATILE_BURSTS,
} from "./effectsData";
import { fireAimedVolley, fireEffect, nearestEnemy } from "./effects";
import { hasDuo, pushDuoProc } from "./hooks";

const CHAIN_SPARK_RANGE2 = CHAIN_SPARK_RANGE * CHAIN_SPARK_RANGE;
const SOUL_SHARDS_RANGE2 = SOUL_SHARDS_RANGE * SOUL_SHARDS_RANGE;
const OVERKILL_RANGE2 = OVERKILL_RANGE * OVERKILL_RANGE;
const SKEWER_RADIUS2 = SKEWER_RADIUS * SKEWER_RADIUS;
/** nearestEnemy's exclude list when nothing but the victim is skipped. */
const NO_EXCLUDE: ReadonlyArray<number> = [];

/** The entry of a per-level table for `level` (1-based, clamped to the table: levelValue for any entry type). */
export function levelEntry<T>(list: ReadonlyArray<T>, level: number): T {
	const i = level < 1 ? 0 : level > list.size() ? list.size() - 1 : level - 1;
	return list[i];
}

/** Scratch: the slots a spark has hit (never re-entered: kills inside only queue procs). */
const hit: number[] = [];

/** Chain Spark for proc `q` at `level` (see the file comment). */
export function chainSpark(ctx: SimCtx, s: BuildsState, q: Readonly<BuildProc>, level: number): void {
	const hops = levelValue(CHAIN_SPARK_HOPS, level);
	const base = levelValue(CHAIN_SPARK_DAMAGE, level);
	const damage = playerHitDamage(ctx.state, q.owner, base);
	// Storm Crown (III): each hop forks to the next nearest enemy from the hop's start for half the base damage
	// (rounded down, at least CHAIN_SPARK_FORK_MIN), through playerHitDamage.
	const fork = level >= BOON_MAX_LEVEL;
	const forkBase = math.floor(base / CHAIN_SPARK_FORK_DIVISOR);
	const forkDamage = playerHitDamage(
		ctx.state,
		q.owner,
		forkBase > CHAIN_SPARK_FORK_MIN ? forkBase : CHAIN_SPARK_FORK_MIN,
	);
	const e = s.events;
	let x = q.x;
	let z = q.z;
	hit.clear();
	for (let h = 0; h < hops; h++) {
		const k = nearestEnemy(ctx, x, z, CHAIN_SPARK_RANGE2, q.id, hit);
		if (k < 0) break;
		const a = ctx.actors[k];
		const tx = a.x;
		const tz = a.z;
		e.sparkX1.push(x);
		e.sparkZ1.push(z);
		e.sparkX2.push(tx);
		e.sparkZ2.push(tz);
		e.sparkOwner.push(q.owner);
		e.sparkGen.push(q.gen);
		e.sparkFork.push(0);
		hit.push(k);
		ctx.procGen = q.gen + 1;
		ctx.procCause = KillCause.SPARK;
		ctx.damageActor(a, damage);
		ctx.procGen = 0;
		ctx.procCause = KillCause.NONE;
		if (fork) {
			const f = nearestEnemy(ctx, x, z, CHAIN_SPARK_RANGE2, q.id, hit);
			if (f >= 0) {
				const b = ctx.actors[f];
				e.sparkX1.push(x);
				e.sparkZ1.push(z);
				e.sparkX2.push(b.x);
				e.sparkZ2.push(b.z);
				e.sparkOwner.push(q.owner);
				e.sparkGen.push(q.gen);
				e.sparkFork.push(1);
				hit.push(f);
				ctx.procGen = q.gen + 1;
				ctx.procCause = KillCause.SPARK;
				ctx.damageActor(b, forkDamage);
				ctx.procGen = 0;
				ctx.procCause = KillCause.NONE;
			}
		}
		x = tx;
		z = tz;
	}
	hit.clear();
}

/**
 * Volatile for proc `q` at `level` (Shrapnel's ring when the owner has the duo; Supernova's one ring larger for a carry
 * of SUPERNOVA_CARRY or more). Returns the bolts spawned.
 */
export function volatileBurst(ctx: SimCtx, s: BuildsState, q: Readonly<BuildProc>, level: number): number {
	const p = s.players[q.owner];
	const shrapnel = hasDuo(p, Duo.SHRAPNEL);
	const supernova = q.excess >= SUPERNOVA_CARRY && hasDuo(p, Duo.SUPERNOVA);
	const bursts = supernova
		? shrapnel
			? SUPERNOVA_SHRAPNEL_BURSTS
			: SUPERNOVA_BURSTS
		: shrapnel
		? SHRAPNEL_BURSTS
		: VOLATILE_BURSTS;
	const n = fireEffect(
		ctx,
		q.owner,
		q.x,
		q.z,
		EFFECT_DIR_X,
		EFFECT_DIR_Z,
		levelEntry(bursts, level),
		BuildEffect.VOLATILE,
		q.gen,
	);
	if (n <= 0) return n;
	const e = s.events;
	e.burstX.push(q.x);
	e.burstZ.push(q.z);
	e.burstOwner.push(q.owner);
	e.burstGen.push(q.gen);
	e.burstFired.push(n);
	if (supernova) pushDuoProc(s, Duo.SUPERNOVA, q.owner, q.x, q.z, n);
	return n;
}

/** Soul Shards for proc `q` at `level`. */
export function soulShards(ctx: SimCtx, s: BuildsState, q: Readonly<BuildProc>, level: number): void {
	const count = levelValue(SOUL_SHARDS_COUNTS, level);
	const spec = levelEntry(SOUL_SHARD_SPECS, level);
	// Soul Swarm (III): its shards carry their own source, so stepBuilds steers them (./evolutions.ts).
	const effect = level >= BOON_MAX_LEVEL ? BuildEffect.SOUL_SWARM : BuildEffect.SOUL_SHARDS;
	const fired = fireAimedVolley(ctx, q.owner, q.x, q.z, count, SOUL_SHARDS_RANGE2, q.id, spec, effect, q.gen);
	if (fired <= 0) return;
	const e = s.events;
	e.shardX.push(q.x);
	e.shardZ.push(q.z);
	e.shardOwner.push(q.owner);
	e.shardGen.push(q.gen);
	e.shardFired.push(fired);
}

/** Scratch: Skewer's line (slots in slot order, the target not among them; never re-entered). */
const skewered: number[] = [];

/**
 * True when (x, z) lies within SKEWER_RADIUS of the segment (x1, z1) -> (x2, z2): the squared distance to the nearest
 * point of the segment, with multiplies and comparisons only (no sqrt, no division): inside the segment's span the
 * squared perpendicular distance times the squared length is |p|^2 |d|^2 - (p . d)^2.
 */
function onSkewerLine(x: number, z: number, x1: number, z1: number, x2: number, z2: number): boolean {
	const dx = x2 - x1;
	const dz = z2 - z1;
	const px = x - x1;
	const pz = z - z1;
	const t = px * dx + pz * dz;
	if (t <= 0) return px * px + pz * pz <= SKEWER_RADIUS2;
	const len2 = dx * dx + dz * dz;
	if (t >= len2) {
		const ex = x - x2;
		const ez = z - z2;
		return ex * ex + ez * ez <= SKEWER_RADIUS2;
	}
	return (px * px + pz * pz) * len2 - t * t <= SKEWER_RADIUS2 * len2;
}

/** One streak strike of `carry` on `a` for proc `q` (one generation on, KillCause.OVERKILL). */
function streakStrike(ctx: SimCtx, q: Readonly<BuildProc>, slot: number, carry: number): void {
	ctx.procGen = q.gen + 1;
	ctx.procCause = KillCause.OVERKILL;
	ctx.damageActor(ctx.actors[slot], carry);
	ctx.procGen = 0;
	ctx.procCause = KillCause.NONE;
}

/**
 * Overkill for proc `q` (see the file comment): the streak of its carry. Skewer (Overkill + Piercing Arrows, LG4, the
 * owner's tuning): the target stays the nearest enemy, and first every other living enemy within SKEWER_RADIUS of the
 * segment from the corpse through the target to OVERKILL_RANGE from the corpse (nearestEnemy's skips, slot order,
 * chosen before any strike) takes the full carry, then the target; a duoProc entry (enemies struck) when the line
 * struck anyone besides the target. The overkill event still ends at the target.
 */
export function overkill(ctx: SimCtx, s: BuildsState, q: Readonly<BuildProc>): void {
	const carry = q.excess;
	if (!(carry >= OVERKILL_MIN_CARRY)) return;
	const k = nearestEnemy(ctx, q.x, q.z, OVERKILL_RANGE2, q.id, NO_EXCLUDE);
	if (k < 0) return;
	const a = ctx.actors[k];
	const tx = a.x;
	const tz = a.z;
	const e = s.events;
	e.overkillX1.push(q.x);
	e.overkillZ1.push(q.z);
	e.overkillX2.push(tx);
	e.overkillZ2.push(tz);
	e.overkillOwner.push(q.owner);
	e.overkillGen.push(q.gen);
	e.overkillCarry.push(carry);
	if (hasDuo(s.players[q.owner], Duo.SKEWER)) {
		// The line: from the corpse through the target out to OVERKILL_RANGE from the corpse (owner's tuning; one
		// sqrt to normalise the direction, as fireAimedVolley aims; a target on the corpse: the segment ends there).
		const dx = tx - q.x;
		const dz = tz - q.z;
		const d = math.sqrt(dx * dx + dz * dz);
		const ex = d > 0 ? q.x + (dx / d) * OVERKILL_RANGE : tx;
		const ez = d > 0 ? q.z + (dz / d) * OVERKILL_RANGE : tz;
		skewered.clear();
		const actors = ctx.actors;
		for (let j = 0; j < actors.size(); j++) {
			const b = actors[j];
			if (j === k || b.kind === NO_KIND || b.alive === 0 || b.id === q.id || b.spawnTick === ctx.tick) continue;
			if (onSkewerLine(b.x, b.z, q.x, q.z, ex, ez)) skewered.push(j);
		}
		const n = skewered.size();
		for (let j = 0; j < n; j++) streakStrike(ctx, q, skewered[j], carry);
		skewered.clear();
		if (n > 0) pushDuoProc(s, Duo.SKEWER, q.owner, q.x, q.z, n + 1);
	}
	streakStrike(ctx, q, k, carry);
}

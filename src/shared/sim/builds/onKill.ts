/**
 * The three on-kill boons (docs/BUILDS.md "The three on-kill boons", BU4; a Roblox-port feature, no web source):
 * what one proc (./procs.ts) does for each on-kill boon its owner has, at the owner's level. Every number is a
 * level-indexed table in ./effectsData.ts (levelValue / levelEntry: level I is entry 0); levels I and II are these
 * rules exactly, level III reads the III entries (Storm Crown's 4 hops / 3 damage, Cataclysm's 16 piercing bolts, Soul
 * Swarm's 4 piercing shards) and its evolution rule (the fork, the steering) is BU5's, added where marked.
 *
 *   Chain Spark  instant. From the corpse, `hops` times: the nearest living enemy within CHAIN_SPARK_RANGE of the
 *                current point (squared distance, ties by slot; ./effects.ts nearestEnemy: never the victim, never an
 *                enemy this spark already hit, never one spawned this tick) takes playerHitDamage(owner, damage)
 *                through ctx.damageActor with ctx.procGen = the proc's gen + 1 (its kill procs one generation on);
 *                the next hop starts from that enemy's position (dead or not). No target: the spark stops. One
 *                BuildEvents spark segment per hop that hit.
 *   Volatile     a ring of VOLATILE_BURSTS[level] bolts from the corpse, heading EFFECT_DIR (fireEffect: effect
 *                VOLATILE, the proc's gen; the bolts hit through playerBulletHit, so playerHitDamage applies there).
 *   Soul Shards  SOUL_SHARDS_COUNTS[level] shards. Targets: up to that many living enemies within SOUL_SHARDS_RANGE of
 *                the corpse, nearest first (ties by slot, same skips as the spark); shard i flies at target i, the
 *                shards beyond the targets found at the nearest one; each is aimed at spawn (a unit vector by sqrt,
 *                no trig; EFFECT_DIR when the target stands on the corpse) and flies straight (BUD11). No target: no
 *                shard.
 */
import type { SimCtx } from "../combat/ctx";
import { playerHitDamage } from "../progression/runMods";
import { levelValue } from "../progression/progressionData";
import type { BuildProc, BuildsState } from "./builds";
import { BuildEffect } from "./buildsData";
import {
	CHAIN_SPARK_DAMAGE,
	CHAIN_SPARK_HOPS,
	CHAIN_SPARK_RANGE,
	EFFECT_DIR_X,
	EFFECT_DIR_Z,
	SOUL_SHARDS_COUNTS,
	SOUL_SHARDS_RANGE,
	SOUL_SHARD_SPECS,
	VOLATILE_BURSTS,
} from "./effectsData";
import { fireEffect, nearestEnemy } from "./effects";

const CHAIN_SPARK_RANGE2 = CHAIN_SPARK_RANGE * CHAIN_SPARK_RANGE;
const SOUL_SHARDS_RANGE2 = SOUL_SHARDS_RANGE * SOUL_SHARDS_RANGE;

/** The entry of a per-level table for `level` (1-based, clamped to the table: levelValue for any entry type). */
export function levelEntry<T>(list: ReadonlyArray<T>, level: number): T {
	const i = level < 1 ? 0 : level > list.size() ? list.size() - 1 : level - 1;
	return list[i];
}

/** Scratch: the slots a spark has hit / the shard targets (never re-entered: kills inside only queue procs). */
const hit: number[] = [];
const targets: number[] = [];

/** Chain Spark for proc `q` at `level` (see the file comment). */
export function chainSpark(ctx: SimCtx, s: BuildsState, q: Readonly<BuildProc>, level: number): void {
	const hops = levelValue(CHAIN_SPARK_HOPS, level);
	const damage = playerHitDamage(ctx.state, q.owner, levelValue(CHAIN_SPARK_DAMAGE, level));
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
		hit.push(k);
		ctx.procGen = q.gen + 1;
		ctx.damageActor(a, damage);
		ctx.procGen = 0;
		// BU5 Storm Crown: the fork to a second target goes here.
		x = tx;
		z = tz;
	}
	hit.clear();
}

/** Volatile for proc `q` at `level`. */
export function volatileBurst(ctx: SimCtx, s: BuildsState, q: Readonly<BuildProc>, level: number): void {
	const n = fireEffect(
		ctx,
		q.owner,
		q.x,
		q.z,
		EFFECT_DIR_X,
		EFFECT_DIR_Z,
		levelEntry(VOLATILE_BURSTS, level),
		BuildEffect.VOLATILE,
		q.gen,
	);
	if (n <= 0) return;
	const e = s.events;
	e.burstX.push(q.x);
	e.burstZ.push(q.z);
	e.burstOwner.push(q.owner);
	e.burstGen.push(q.gen);
	e.burstFired.push(n);
}

/** Soul Shards for proc `q` at `level`. */
export function soulShards(ctx: SimCtx, s: BuildsState, q: Readonly<BuildProc>, level: number): void {
	const count = levelValue(SOUL_SHARDS_COUNTS, level);
	const spec = levelEntry(SOUL_SHARD_SPECS, level);
	targets.clear();
	for (let i = 0; i < count; i++) {
		const k = nearestEnemy(ctx, q.x, q.z, SOUL_SHARDS_RANGE2, q.id, targets);
		if (k < 0) break;
		targets.push(k);
	}
	const found = targets.size();
	if (found === 0) return;
	let fired = 0;
	for (let i = 0; i < count; i++) {
		const a = ctx.actors[targets[i < found ? i : 0]];
		const dx = a.x - q.x;
		const dz = a.z - q.z;
		const d = math.sqrt(dx * dx + dz * dz);
		const dirX = d > 0 ? dx / d : EFFECT_DIR_X;
		const dirZ = d > 0 ? dz / d : EFFECT_DIR_Z;
		// BU5 Soul Swarm: the shard's steering target is recorded here.
		fired += fireEffect(ctx, q.owner, q.x, q.z, dirX, dirZ, spec, BuildEffect.SOUL_SHARDS, q.gen);
	}
	targets.clear();
	if (fired <= 0) return;
	const e = s.events;
	e.shardX.push(q.x);
	e.shardZ.push(q.z);
	e.shardOwner.push(q.owner);
	e.shardGen.push(q.gen);
	e.shardFired.push(fired);
}

/**
 * Riposte (docs/BUILDS_V2.md "Riposte", BV2; rare, offense) and the guard-side duos Thunder Guard, Stillwater and
 * Rebuke (BV6). A Roblox-port feature, no web source. Only with state.builds; nothing here does anything for a player
 * without the boon / duo.
 *
 * The count. `riposteCount` (hashed, per player) counts the enemy bullets the current sword guard erased (the guard's
 * `cancels`, as Bastion's brace count: goo never, strikes are never erased), for Riposte owners. Reset on the guard's
 * start tick, by a roll's start (./hooks.ts buildsOnRollStart: a roll cuts the guard short), by a swap (buildsOnSwap)
 * and by the floor change (builds.ts clearBuildProcs).
 *
 * The counter-wave (BVD1: a hashed BuildWave in state.builds.waves, not bullets). Only a guard that runs its full
 * length fires (BVD3, owner): sword.ts calls buildsOnGuardEnd on the tick its SWORD_V_GUARD counter reaches 0; a roll
 * or a swap zeroes the counter without it, and the count is discarded. With at least RIPOSTE_MIN_ERASED erased the
 * owner's wave goes out from their position along the facing (spawnWave): damage min(riposteCount,
 * RIPOSTE_MAX_COUNT[level]); a crescent (RIPOSTE_WAVE_HALF_ANGLE_COS, WaveKind.FORWARD), or with Counterstrike (level
 * III) and COUNTERSTRIKE_RING_ERASED or more a full ring (WaveKind.RING) plus min(count, max) returns
 * (COUNTERSTRIKE_RETURN shards at the nearest enemies within COUNTERSTRIKE_RANGE, Soul Shards' aim, BuildEffect.RIPOSTE
 * at generation 0), queued in module scratch and fired by stepWaves inside the effect budget session (BVD4; a full
 * budget drops returns, never the wave). At most RIPOSTE_WAVES_MAX waves live; one more is not spawned. BuildEvents
 * wave* / counterCount at the spawn.
 *
 * stepWaves (stepBuilds, first after the budget session opens, before the evolutions' pre-drain phase): a party drops
 * the waves of players who left; Rebuke's roll rings (below) spawn; then every wave in index order grows by speed x
 * SIM_DT (capped at its range) and strikes every living actor not yet in its `hits` whose circle the radius reaches
 * (d - a.radius <= radius) inside its cone (melee's inCone test; an actor containing the origin always counts), in slot
 * order: the id is pushed to `hits`, then ctx.damageActor(a, playerHitDamage(owner, damage)) with ctx.actingPlayer(owner),
 * ctx.procGen 0 (the player's own move: a kill procs at gen 0) and no cause. A wave is removed after the tick its
 * radius reached its range. Waves erase no bullet and hit no breakable (BVD2). Then the queued returns fire.
 *
 * Duos (BV6), all from the guard tick hook buildsOnRiposteGuard (sword.ts, every guard tick, after Bastion's
 * buildsOnGuardCancels):
 *   Thunder Guard (Riposte + Chain Spark): every bullet the tick's guard erased queues a spark (./duos.ts
 *       queueThunderSpark) from the erased bullet's position (the score events' guardX / guardZ the guard's sink
 *       recorded this tick; without a score, the player's position), at most THUNDER_GUARD_MAX a guard tick.
 *   Stillwater (Composure + Riposte): a guard tick of an owner that erased at least one bullet within STILLWATER_TICKS
 *       of a recorded cut (./hooks.ts buildsStillwaterRecord, from stepScore) gives the team combo back (score.ts
 *       stillwaterRestoreCombo: max(now, recorded), timer refilled) and clears the record (stillTick STILL_NONE): once.
 *       Only with state.score.
 *   Rebuke (Bastion + Riposte, BVD14): a brace that restored something (Bastion's brace pushed a PIP or a HEAL) marks
 *       `rebukePending`. In a guard (GUARD) the guard's full-length end fires a full ring (WaveKind.REBUKE) INSTEAD of
 *       the forward wave or Counterstrike's ring, damage min(riposteCount, max) (Counterstrike's returns still fire); a
 *       roll or a swap discards it. In a roll (ROLL, ./hooks.ts buildsOnRollThrough) stepWaves fires the ring the same
 *       tick, damage min(braceCount, max), from any weapon. Once per guard or roll; a brace that restored nothing marks
 *       nothing.
 */
import { jsMin } from "shared/jsmath";
import type { SimCtx } from "../combat/ctx";
import type { SimState } from "../state";
import { NO_KIND } from "../combat/actors/types";
import { hasLeft } from "../party";
import { SIM_DT } from "../units";
import { BOON_MAX_LEVEL, Boon, levelValue } from "../progression/progressionData";
import { playerHitDamage } from "../progression/runMods";
import { stillwaterRestoreCombo } from "../score/score";
import { buildLevel, type BuildPlayerState, type BuildWave, type BuildsState } from "./builds";
import { BuildEffect, Duo } from "./buildsData";
import {
	COUNTERSTRIKE_RANGE,
	COUNTERSTRIKE_RETURN,
	COUNTERSTRIKE_RING_ERASED,
	COUNTERSTRIKE_RING_HALF_ANGLE_COS,
	KillCause,
	RIPOSTE_MAX_COUNT,
	RIPOSTE_MIN_ERASED,
	RIPOSTE_WAVES_MAX,
	RIPOSTE_WAVE_HALF_ANGLE_COS,
	RIPOSTE_WAVE_RANGE,
	RIPOSTE_WAVE_SPEED,
	RebukePending,
	STILLWATER_TICKS,
	STILL_NONE,
	THUNDER_GUARD_MAX,
	WaveKind,
} from "./effectsData";
import { NO_SKIP_ID, fireAimedVolley } from "./effects";
import { queueThunderSpark } from "./duos";
import { buildPlayerLeft, buildPlayerStateAt, hasDuo } from "./hooks";

const COUNTERSTRIKE_RANGE2 = COUNTERSTRIKE_RANGE * COUNTERSTRIKE_RANGE;

/** Player `p`'s Riposte level (0: not owned). */
function riposteLevel(p: Readonly<BuildPlayerState> | undefined): number {
	return p !== undefined ? buildLevel(p, Boon.RIPOSTE) : 0;
}

/**
 * Spawns a counter-wave for `owner` from (x, z) along the unit (dirX, dirZ) with cone `halfCos`, `damage` per enemy
 * (before playerHitDamage) and WaveKind `kind`; `count` is the erased (or braced) count it answers (BuildEvents
 * counterCount). Returns false (nothing spawned, no event) when RIPOSTE_WAVES_MAX waves are live.
 */
export function spawnWave(
	s: BuildsState,
	owner: number,
	x: number,
	z: number,
	dirX: number,
	dirZ: number,
	halfCos: number,
	damage: number,
	kind: number,
	count: number,
): boolean {
	if (s.waves.size() >= RIPOSTE_WAVES_MAX) return false;
	s.waves.push({
		owner,
		x,
		z,
		dirX,
		dirZ,
		halfCos,
		radius: 0,
		range: RIPOSTE_WAVE_RANGE,
		speed: RIPOSTE_WAVE_SPEED,
		damage,
		kind,
		hits: [],
	});
	const e = s.events;
	e.waveX.push(x);
	e.waveZ.push(z);
	e.waveDirX.push(dirX);
	e.waveDirZ.push(dirZ);
	e.waveHalfCos.push(halfCos);
	e.waveRange.push(RIPOSTE_WAVE_RANGE);
	e.waveSpeed.push(RIPOSTE_WAVE_SPEED);
	e.waveOwner.push(owner);
	e.waveDamage.push(damage);
	e.waveKind.push(kind);
	e.counterCount.push(count);
	return true;
}

// ---------------------------------------------------------------------------------------------
// Counterstrike's returns: queued at the guard's end (the weapons phase), fired by stepWaves (module scratch from the
// sword's step to stepBuilds of the same stepCombat call, never across ticks: not hashed; resetRiposteScratch).

const returnOwner: number[] = [];
const returnX: number[] = [];
const returnZ: number[] = [];
const returnCount: number[] = [];

function fireReturns(ctx: SimCtx): void {
	for (let k = 0; k < returnOwner.size(); k++) {
		const owner = returnOwner[k];
		if (buildPlayerLeft(ctx.state, owner)) continue;
		ctx.actingPlayer(owner);
		fireAimedVolley(
			ctx,
			owner,
			returnX[k],
			returnZ[k],
			returnCount[k],
			COUNTERSTRIKE_RANGE2,
			NO_SKIP_ID,
			COUNTERSTRIKE_RETURN,
			BuildEffect.RIPOSTE,
			0,
		);
	}
	resetRiposteScratch();
}

/** Drops the queued returns (resetBuildScratch; fireReturns at the end of each stepWaves). */
export function resetRiposteScratch(): void {
	returnOwner.clear();
	returnX.clear();
	returnZ.clear();
	returnCount.clear();
}

// ---------------------------------------------------------------------------------------------
// The guard (sword.ts)

/**
 * One guard tick of the bound player (ctx.playerIndex): `cancels` enemy bullets erased this tick, `starting` on the
 * guard's first tick, `guardFrom` the size of the score events' guardX before this tick's sweep (its erased positions
 * follow it), `braced` when Bastion's brace (buildsOnGuardCancels, just before) restored something this tick. See the
 * file comment: Riposte's count, Rebuke's mark, Thunder Guard's sparks, Stillwater's restore.
 */
export function buildsOnRiposteGuard(
	ctx: SimCtx,
	cancels: number,
	starting: boolean,
	guardFrom: number,
	braced: boolean,
): void {
	const state = ctx.state;
	const s = state.builds;
	const i = ctx.playerIndex;
	const p = s?.players[i];
	if (s === undefined || p === undefined || riposteLevel(p) <= 0 || buildPlayerLeft(state, i)) return;
	if (starting) {
		p.riposteCount = 0;
		p.rebukePending = RebukePending.NONE;
	}
	p.riposteCount += cancels;
	// Rebuke (BV6): this guard braced; its full-length end fires the ring.
	if (braced && hasDuo(p, Duo.REBUKE)) p.rebukePending = RebukePending.GUARD;
	if (cancels <= 0) return;
	// Thunder Guard (BV6): a spark from each erased bullet, at most THUNDER_GUARD_MAX this tick.
	if (hasDuo(p, Duo.THUNDER_GUARD)) {
		const n = jsMin(cancels, THUNDER_GUARD_MAX);
		const score = state.score;
		const pl = buildPlayerStateAt(state, i);
		for (let k = 0; k < n; k++) {
			if (score !== undefined) {
				queueThunderSpark(i, score.events.guardX[guardFrom + k], score.events.guardZ[guardFrom + k]);
			} else {
				queueThunderSpark(i, pl.x, pl.z);
			}
		}
	}
	// Stillwater (BV6): a recorded cut within STILLWATER_TICKS is given back, once.
	if (hasDuo(p, Duo.STILLWATER) && state.score !== undefined && s.stillTick !== STILL_NONE) {
		if (state.tick - s.stillTick <= STILLWATER_TICKS) stillwaterRestoreCombo(state, s.stillCombo);
		s.stillTick = STILL_NONE;
	}
}

/**
 * The bound player's guard ran its full length (sword.ts: SWORD_V_GUARD reached 0 on this tick). See the file comment:
 * the counter-wave (forward, Counterstrike's ring and returns, or Rebuke's ring). The count is spent either way.
 */
export function buildsOnGuardEnd(ctx: SimCtx): void {
	const state = ctx.state;
	const s = state.builds;
	const i = ctx.playerIndex;
	const p = s?.players[i];
	const level = riposteLevel(p);
	if (s === undefined || p === undefined || level <= 0) return;
	const count = p.riposteCount;
	const rebuke = p.rebukePending === RebukePending.GUARD;
	p.riposteCount = 0;
	if (rebuke) p.rebukePending = RebukePending.NONE;
	if (count < RIPOSTE_MIN_ERASED || buildPlayerLeft(state, i)) return;
	const pl = buildPlayerStateAt(state, i);
	if (pl.dead !== 0) return;
	const damage = jsMin(count, levelValue(RIPOSTE_MAX_COUNT, level));
	const counterstrike = level >= BOON_MAX_LEVEL && count >= COUNTERSTRIKE_RING_ERASED;
	const kind = rebuke ? WaveKind.REBUKE : counterstrike ? WaveKind.RING : WaveKind.FORWARD;
	const halfCos = kind === WaveKind.FORWARD ? RIPOSTE_WAVE_HALF_ANGLE_COS : COUNTERSTRIKE_RING_HALF_ANGLE_COS;
	spawnWave(s, i, pl.x, pl.z, pl.faceX, pl.faceZ, halfCos, damage, kind, count);
	if (counterstrike) {
		returnOwner.push(i);
		returnX.push(pl.x);
		returnZ.push(pl.z);
		returnCount.push(damage);
	}
}

// ---------------------------------------------------------------------------------------------
// stepWaves (stepBuilds)

/** Party: drops the waves of players who left (order kept). */
function dropLeaverWaves(state: Readonly<SimState>, waves: BuildWave[]): void {
	let w = 0;
	const total = waves.size();
	for (let k = 0; k < total; k++) {
		const q = waves[k];
		if (hasLeft(state, q.owner)) continue;
		waves[w] = q;
		w++;
	}
	while (waves.size() > w) waves.pop();
}

/** Rebuke's roll rings: every player whose roll braced this tick (RebukePending.ROLL). */
function rebukeRolls(state: SimState, s: BuildsState): void {
	for (let i = 0; i < s.players.size(); i++) {
		const p = s.players[i];
		if (p.rebukePending !== RebukePending.ROLL) continue;
		p.rebukePending = RebukePending.NONE;
		const level = riposteLevel(p);
		if (level <= 0 || !hasDuo(p, Duo.REBUKE) || buildPlayerLeft(state, i)) continue;
		const pl = buildPlayerStateAt(state, i);
		if (pl.dead !== 0) continue;
		const damage = jsMin(p.braceCount, levelValue(RIPOSTE_MAX_COUNT, level));
		spawnWave(
			s,
			i,
			pl.x,
			pl.z,
			pl.faceX,
			pl.faceZ,
			COUNTERSTRIKE_RING_HALF_ANGLE_COS,
			damage,
			WaveKind.REBUKE,
			p.braceCount,
		);
	}
}

/** One wave's tick: grow, strike (see the file comment). Returns true when it reached its range (remove it). */
function stepWave(ctx: SimCtx, w: BuildWave): boolean {
	const grown = w.radius + w.speed * SIM_DT;
	w.radius = grown > w.range ? w.range : grown;
	const radius = w.radius;
	const damage = playerHitDamage(ctx.state, w.owner, w.damage);
	const actors = ctx.actors;
	ctx.actingPlayer(w.owner);
	for (let k = 0; k < actors.size(); k++) {
		const a = actors[k];
		if (a.kind === NO_KIND || a.alive === 0 || w.hits.includes(a.id)) continue;
		const dx = a.x - w.x;
		const dz = a.z - w.z;
		const d2 = dx * dx + dz * dz;
		const reach = radius + a.radius;
		if (d2 > reach * reach) continue;
		const d = math.sqrt(d2);
		if (d > a.radius && dx * w.dirX + dz * w.dirZ < w.halfCos * d) continue;
		w.hits.push(a.id);
		ctx.procGen = 0;
		ctx.procCause = KillCause.NONE;
		ctx.damageActor(a, damage);
	}
	return w.radius >= w.range;
}

/** stepBuilds' first phase (see the file comment). */
export function stepWaves(ctx: SimCtx, s: BuildsState): void {
	const state = ctx.state;
	if (state.party !== undefined && s.waves.size() > 0) dropLeaverWaves(state, s.waves);
	rebukeRolls(state, s);
	const waves = s.waves;
	if (waves.size() > 0) {
		let w = 0;
		const total = waves.size();
		for (let k = 0; k < total; k++) {
			const wave = waves[k];
			if (stepWave(ctx, wave)) continue;
			waves[w] = wave;
			w++;
		}
		while (waves.size() > w) waves.pop();
		ctx.actingPlayer(0);
	}
	if (returnOwner.size() > 0) {
		fireReturns(ctx);
		ctx.actingPlayer(0);
	}
}

/**
 * The proc engine (docs/BUILDS.md "Chain reactions", BU3; a Roblox-port feature, no web source). Only with
 * state.builds; without it nothing here is reached.
 *
 * Kills (buildsOnKill, from actors.ts damageActor's kill line, before killActor): a kill by player damage pushes a proc
 * { x, z, owner, gen, slot, id } (the corpse, ctx.playerIndex = the bullet's owner / the swinging player / the spark's
 * owner, ctx.procGen, the victim's slot and actor id) onto state.builds.procs, unless
 *   - the victim revives (def.stepDead: turrets) or is in PROC_INELIGIBLE_ARCHETYPES (the training dummy),
 *   - gen >= genMax (BUD5: a generation-3 proc would do nothing, so none is queued),
 *   - the owner left the run, or owns no on-kill effect (ON_KILL_BOONS; BU6 widens hasOnKillEffect).
 * Before the queue test, Jackpot (Bounty III, BU5) counts the kill (any generation; not a reviver's or the dummy's).
 * Withers, boss sweeps and debug kills call killActor directly and never get here.
 *
 * The queue (stepBuilds, inside stepCombat right after the player bullet collisions; the actor phase and stepAffixes ran
 * earlier in the tick): a party drops the procs of players who left, then the evolutions' pre-drain phase runs
 * (./evolutions.ts stepEvolutions), then the oldest min(procsPerTick, queued) procs resolve in queue order and leave
 * the queue, then Momentum (stepMomentum); all of it inside one effect budget session. Procs pushed while they resolve (kills by sparks) wait at the back for
 * the next tick, so a cascade ripples outward one generation per tick and nothing recurses. The rest are never dropped,
 * except by the floor change (endless.ts nextFloor: clearBuildProcs). A frozen draft tick never steps combat, so the
 * queue waits.
 *
 * One proc: ctx.actingPlayer(owner) (its kills are scored for, and read the mods of, the owner), then each on-kill boon
 * the owner has, in boon index order (ON_KILL_BOONS: Chain Spark, Volatile, Soul Shards; ./onKill.ts). Afterwards
 * player 0 is bound again and ctx.procGen is 0.
 */
import { jsMin } from "shared/jsmath";
import type { SimCtx } from "../combat/ctx";
import type { SimState } from "../state";
import type { ActorState, ArchetypeDef } from "../combat/actors/types";
import { hasLeft } from "../party";
import { Boon } from "../progression/progressionData";
import { buildLevel, type BuildPlayerState, type BuildProc, type BuildsState } from "./builds";
import { PROC_INELIGIBLE_ARCHETYPES } from "./buildsData";
import { beginEffectBudget, endEffectBudget } from "./effects";
import { JACKPOT_KILLS } from "./effectsData";
import { stepEvolutions, stepMomentum } from "./evolutions";
import { isEvolved } from "./hooks";
import { chainSpark, soulShards, volatileBurst } from "./onKill";
import { scoreJackpot } from "../score/score";

/** The boons a proc fires, in the order it fires them (boon index order). */
export const ON_KILL_BOONS: ReadonlyArray<number> = [Boon.CHAIN_SPARK, Boon.VOLATILE, Boon.SOUL_SHARDS];

/** True when a kill credited to `p` has anything to fire (an on-kill boon owned). */
export function hasOnKillEffect(p: Readonly<BuildPlayerState>): boolean {
	for (const b of ON_KILL_BOONS) if (buildLevel(p, b) > 0) return true;
	return false;
}

/**
 * Jackpot (Bounty III; BU5): the owner's eligible kill counts in `kills`; every JACKPOT_KILLS-th pays scoreJackpot
 * (JACKPOT_POINTS x the floor, ScoreSource.JACKPOT) and pushes a BuildEvents jackpot pop at the corpse. Counts every
 * kill a proc could come from (whatever its generation), never a reviver's or the dummy's.
 */
function jackpot(state: SimState, s: BuildsState, p: BuildPlayerState, owner: number, a: Readonly<ActorState>): void {
	p.kills += 1;
	if (p.kills < JACKPOT_KILLS) return;
	p.kills -= JACKPOT_KILLS;
	const points = scoreJackpot(state);
	const e = s.events;
	e.jackpotX.push(a.x);
	e.jackpotZ.push(a.z);
	e.jackpotOwner.push(owner);
	e.jackpotPoints.push(points);
}

/**
 * Actor `a` is about to die by player damage (damageActor; `def` its archetype): Jackpot counts it, then its proc is
 * queued (file comment).
 */
export function buildsOnKill(ctx: SimCtx, a: Readonly<ActorState>, def: Readonly<ArchetypeDef>): void {
	const state = ctx.state;
	const s = state.builds;
	if (s === undefined) return;
	if (def.stepDead !== undefined || PROC_INELIGIBLE_ARCHETYPES.includes(def.id)) return;
	const owner = ctx.playerIndex;
	const p = s.players[owner];
	if (p === undefined || hasLeft(state, owner)) return;
	if (isEvolved(p, Boon.BOUNTY)) jackpot(state, s, p, owner, a);
	const gen = ctx.procGen;
	if (gen >= s.config.genMax || !hasOnKillEffect(p)) return;
	s.procs.push({ x: a.x, z: a.z, owner, gen, slot: ctx.actors.indexOf(a), id: a.id });
}

function resolveProc(ctx: SimCtx, s: BuildsState, q: Readonly<BuildProc>): void {
	const p = s.players[q.owner];
	if (p === undefined || q.gen >= s.config.genMax) return;
	ctx.actingPlayer(q.owner);
	for (const b of ON_KILL_BOONS) {
		const level = buildLevel(p, b);
		if (level <= 0) continue;
		if (b === Boon.CHAIN_SPARK) chainSpark(ctx, s, q, level);
		else if (b === Boon.VOLATILE) volatileBurst(ctx, s, q, level);
		else soulShards(ctx, s, q, level);
	}
}

/** Party: drops the queued procs of players who left (order kept). */
function dropLeavers(state: Readonly<SimState>, procs: BuildProc[]): void {
	let w = 0;
	const total = procs.size();
	for (let k = 0; k < total; k++) {
		const q = procs[k];
		if (hasLeft(state, q.owner)) continue;
		procs[w] = q;
		w++;
	}
	while (procs.size() > w) procs.pop();
}

/** The builds phase of stepCombat (file comment). */
export function stepBuilds(ctx: SimCtx): void {
	const state = ctx.state;
	const s = state.builds;
	if (s === undefined) return;
	const procs = s.procs;
	if (state.party !== undefined && procs.size() > 0) dropLeavers(state, procs);
	beginEffectBudget(state);
	// 1. The evolutions before the drain (./evolutions.ts: Ricochet splits, Soul Swarm steering, novas, Thrill Seeker).
	stepEvolutions(ctx, s);
	// 2. The drain.
	const n = jsMin(s.config.procsPerTick, procs.size());
	for (let k = 0; k < n; k++) resolveProc(ctx, s, procs[k]);
	// Dequeue the n resolved; the procs their kills pushed move up to the front.
	const total = procs.size();
	for (let k = n; k < total; k++) procs[k - n] = procs[k];
	for (let k = 0; k < n; k++) procs.pop();
	// 3. Momentum, after the drain (this tick's combo feeds, spark kills included).
	stepMomentum(ctx, s);
	endEffectBudget();
	ctx.actingPlayer(0);
	ctx.procGen = 0;
}

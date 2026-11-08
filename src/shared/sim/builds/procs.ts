/**
 * The proc engine (docs/BUILDS.md "Chain reactions", BU3; a Roblox-port feature, no web source). Only with
 * state.builds; without it nothing here is reached.
 *
 * Kills (buildsOnKill, from actors.ts damageActor's kill line, before killActor): a kill by player damage pushes a proc
 * { x, z, owner, gen, slot, id, excess, kind } (the corpse, ctx.playerIndex = the bullet's owner / the swinging player /
 * the spark's owner, ctx.procGen, the victim's slot and actor id; excess: docs/LEGENDARIES.md LG2's Overkill carry,
 * ctx.killCarry when the owner has Overkill, else 0; kind: ProcKind.KILL, docs/BUILDS_V2.md BV1) onto
 * state.builds.procs, unless
 *   - the victim revives (def.stepDead: turrets) or is in PROC_INELIGIBLE_ARCHETYPES (the training dummy),
 *   - gen >= genMax (BUD5: a generation-3 proc would do nothing, so none is queued; a kill of generation exactly
 *     genMax goes to Chain Reaction's cross trigger instead, ./duos.ts chainReactionKill),
 *   - the owner left the run, or owns no on-kill effect (ON_KILL_BOONS; no duo needs more: the duos that hook kills
 *     own an on-kill boon by definition, Gold Rush scores in score.ts).
 * Before the queue test, Jackpot (Bounty III, BU5) counts the kill (any generation; not a reviver's or the dummy's).
 * Withers, boss sweeps and debug kills call killActor directly and never get here.
 *
 * The queue (stepBuilds, inside stepCombat right after the player bullet collisions; the actor phase and stepAffixes ran
 * earlier in the tick): a party drops the procs of players who left, then the evolutions' pre-drain phase runs
 * (./evolutions.ts stepEvolutions), then the duos' pre-drain phase (./duos.ts stepDuosBeforeDrain: Close Call, Fire
 * Arrows, Blazing Trail), then the oldest min(procsPerTick, queued) procs resolve in queue order and leave the queue,
 * then the duos' sparks and cross triggers (stepDuosAfterDrain: Storm Blade, Conductor, Chain Reaction), then Momentum
 * (stepMomentum); all of it inside one effect budget session. Procs pushed while they resolve (kills by sparks) wait at the back for
 * the next tick, so a cascade ripples outward one generation per tick and nothing recurses. The rest are never dropped,
 * except by the floor change (endless.ts nextFloor: clearBuildProcs). A frozen draft tick never steps combat, so the
 * queue waits.
 *
 * Smashes (docs/BUILDS_V2.md BV5): a piece broken by an owner with Wrecker or Powder Keg queues a ProcKind.SMASH proc
 * (the leaf ./wrecker.ts buildsOnPieceBroken: the cell centre, slot / id -1, excess 0, below genMax); they share the
 * queue, its order, procsPerTick and the floor-change clear with the kills.
 *
 * One proc: ctx.actingPlayer(owner) (its kills are scored for, and read the mods of, the owner), then each on-kill boon
 * the owner has, in boon index order (ON_KILL_BOONS: Chain Spark, Volatile, Soul Shards, Overkill; ./onKill.ts). A smash
 * instead resolves through ./smash.ts resolveSmash (an owner with a smash effect, ./wrecker.ts hasSmashEffect), and
 * fires the on-kill boons too only for a Powder Keg owner (BV6; Overkill does nothing: excess 0). Afterwards player 0
 * is bound again and ctx.procGen is 0.
 */
import { jsMin } from "shared/jsmath";
import type { SimCtx } from "../combat/ctx";
import type { SimState } from "../state";
import type { ActorState, ArchetypeDef } from "../combat/actors/types";
import { hasLeft } from "../party";
import { Boon } from "../progression/progressionData";
import { buildLevel, type BuildPlayerState, type BuildProc, type BuildsState } from "./builds";
import { Duo, PROC_INELIGIBLE_ARCHETYPES, ProcKind } from "./buildsData";
import { beginEffectBudget, endEffectBudget, resetEffectScratch } from "./effects";
import { JACKPOT_KILLS, KillCause } from "./effectsData";
import { resetEvolutionScratch, stepEvolutions, stepMomentum } from "./evolutions";
import { chainReactionKill, resetDuoScratch, stepDuosAfterDrain, stepDuosBeforeDrain } from "./duos";
import { hasDuo, isEvolved, pushDuoProc, stepBraceCooldowns, stepHappyHour } from "./hooks";
import { hasSmashEffect } from "./wrecker";
import { resolveSmash } from "./smash";
import { chainSpark, overkill, soulShards, volatileBurst } from "./onKill";
import { scoreJackpot } from "../score/score";
import { resetRiposteScratch, stepWaves } from "./riposte";
import { resetBallistaScratch, stepBallista } from "./ballista";

/** The boons a proc fires, in the order it fires them (boon index order). */
export const ON_KILL_BOONS: ReadonlyArray<number> = [Boon.CHAIN_SPARK, Boon.VOLATILE, Boon.SOUL_SHARDS, Boon.OVERKILL];

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
	if (gen >= s.config.genMax) {
		// Chain Reaction (BU6): a genMax kill by a spark or a Volatile bolt still cross-triggers, at genMax.
		if (gen === s.config.genMax) chainReactionKill(ctx, p, owner, a);
		return;
	}
	if (!hasOnKillEffect(p)) return;
	// Overkill (docs/LEGENDARIES.md LG2): the kill's carry (damageActor's ctx.killCarry), kept only for an owner of it.
	const excess = buildLevel(p, Boon.OVERKILL) > 0 ? ctx.killCarry : 0;
	s.procs.push({ x: a.x, z: a.z, owner, gen, slot: ctx.actors.indexOf(a), id: a.id, excess, kind: ProcKind.KILL });
}

function resolveProc(ctx: SimCtx, s: BuildsState, q: Readonly<BuildProc>): void {
	const p = s.players[q.owner];
	if (p === undefined || q.gen >= s.config.genMax) return;
	ctx.actingPlayer(q.owner);
	// Builds v2 (BV5): a smash (a broken piece; ./smash.ts: Wrecker's splinters, Demolition). Powder Keg (BV6): the
	// owner's on-kill boons then fire from the piece below, as a kill there would (no victim, no Overkill carry).
	if (q.kind === ProcKind.SMASH) {
		if (!hasSmashEffect(p)) return;
		resolveSmash(ctx, s, q, p);
		if (!hasDuo(p, Duo.POWDER_KEG)) return;
		pushDuoProc(s, Duo.POWDER_KEG, q.owner, q.x, q.z, 1);
	}
	for (const b of ON_KILL_BOONS) {
		const level = buildLevel(p, b);
		if (level <= 0) continue;
		if (b === Boon.CHAIN_SPARK) chainSpark(ctx, s, q, level);
		else if (b === Boon.VOLATILE) volatileBurst(ctx, s, q, level);
		else if (b === Boon.OVERKILL) overkill(ctx, s, q);
		else soulShards(ctx, s, q, level);
	}
}

/** Party: drops the queued procs (kills and smashes alike) of players who left (order kept). */
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
	// Citadel's brace cooldowns (docs/LEGENDARIES.md LGD14): one tick of combat time.
	stepBraceCooldowns(s);
	// Happy Hour (Deep Flask + Bounty, docs/BUILDS_V2.md BV7): its timers, and a drink this tick starts one.
	stepHappyHour(state, s);
	beginEffectBudget(state);
	// 0. Riposte's counter-waves (docs/BUILDS_V2.md BV2; ./riposte.ts): leavers' dropped, Rebuke's roll rings, the
	// waves grow and strike, then Counterstrike's queued returns.
	stepWaves(ctx, s);
	// 1. The evolutions before the drain (./evolutions.ts: Ricochet splits, Soul Swarm steering, novas, Thrill Seeker),
	// then the duos' (./duos.ts: Close Call shards, Fire Arrows / Blazing Trail embers).
	stepEvolutions(ctx, s);
	stepDuosBeforeDrain(ctx, s);
	// 1b. Ballista (docs/BUILDS_V2.md BV3): the bursts this tick's walk queued (gen 0 bolts).
	stepBallista(ctx, s);
	// 2. The drain.
	const n = jsMin(s.config.procsPerTick, procs.size());
	for (let k = 0; k < n; k++) resolveProc(ctx, s, procs[k]);
	// Dequeue the n resolved; the procs their kills pushed move up to the front.
	const total = procs.size();
	for (let k = n; k < total; k++) procs[k - n] = procs[k];
	for (let k = 0; k < n; k++) procs.pop();
	// 2b. The duos' sparks (Storm Blade, Conductor) and Chain Reaction's cross triggers (their kills proc next tick).
	stepDuosAfterDrain(ctx, s);
	// 3. Momentum, after the drain (this tick's combo feeds, spark kills included).
	stepMomentum(ctx, s);
	endEffectBudget();
	ctx.actingPlayer(0);
	ctx.procGen = 0;
	ctx.procCause = KillCause.NONE;
}

/** The state stepCombat last bound (resetBuildScratch). Identity only; never read. */
let scratchOwner: SimState | undefined;

/**
 * Clears every module-level scratch the builds rules fill and empty within one stepCombat (Ricochet, queued duo sparks,
 * Chain Reaction crosses, embers, the effect budget's session, volley targets) when stepCombat is bound to a different
 * state than last time. Nothing here is state: each list is empty at the end of a normal tick, and every kill that queues
 * into them happens inside stepCombat. stepCombat calls it first every tick (with or without builds), so a tick that
 * threw halfway in one run (a validator running several runs in one VM under pcall) can never leak its entries into the
 * next run; within one run nothing is cleared (a no-op either way after a normal tick).
 */
export function resetBuildScratch(state: SimState): void {
	if (state === scratchOwner) return;
	scratchOwner = state;
	resetEvolutionScratch();
	resetDuoScratch();
	resetEffectScratch();
	resetRiposteScratch();
	resetBallistaScratch();
}

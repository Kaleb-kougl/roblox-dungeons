/**
 * Smash procs (docs/BUILDS_V2.md "Wrecker", BV5; a Roblox-port feature, no web source): what one SMASH proc (a piece
 * broken by an owner with Wrecker or Powder Keg, queued by the leaf ./wrecker.ts buildsOnPieceBroken) does when the
 * drain resolves it (./procs.ts resolveProc, the owner bound with ctx.actingPlayer). Only with state.builds.
 *
 *   Demolition  (Wrecker III) first, so the splinters fly at what the blast left standing: one BuildEvents demolition
 *               entry; every living enemy (slot order; not one spawned this tick: nearestEnemy's rule) whose body
 *               reaches within DEMOLITION_RADIUS of the piece's cell centre (centre distance <= radius + body radius)
 *               takes playerHitDamage(owner, DEMOLITION_DAMAGE) through ctx.damageActor with ctx.procGen = gen + 1;
 *               then every intact piece but a chest whose cell centre lies within DEMOLITION_RADIUS breaks
 *               (damageBreakable at full hp, BreakableSource.BUILD, owner, gen + 1), so it queues its own smash one
 *               generation on (a cluster goes off one piece a tick, stopping at genMax: BVD10).
 *   Splinters   WRECKER_SPLINTERS[level] x WRECKER_SPLINTER at the nearest living enemies within WRECKER_RANGE of the
 *               cell centre (Soul Shards' aim, ./effects.ts fireAimedVolley), build effect WRECKER at the proc's gen.
 *   Combo       Demolition: one combo step per exploding piece (score.ts stepCombo: +0.1, the timer refilled, even
 *               from x1.0); levels I-II: the timer refilled, a running combo only (refillComboTimer).
 *   Events      one BuildEvents smash entry per smash (the cell centre, owner, gen, splinters spawned).
 *
 * Powder Keg (the duo, BV6) is ./procs.ts resolveProc's: after this, a smash of an owner with the duo fires their on-kill
 * boons from the piece as a kill there would (slot / id -1: nothing is skipped; excess 0: Overkill carries nothing).
 */
import type { SimCtx } from "../combat/ctx";
import { NO_KIND } from "../combat/actors/types";
import { gridToWorld } from "shared/dungeon";
import { damageBreakable } from "../breakables/breakables";
import { BreakableKind, BreakableSource, NOT_BROKEN } from "../breakables/breakablesData";
import { BOON_MAX_LEVEL, Boon, levelValue } from "../progression/progressionData";
import { playerHitDamage } from "../progression/runMods";
import { refillComboTimer, stepCombo } from "../score/score";
import type { BuildPlayerState, BuildProc, BuildsState } from "./builds";
import { BuildEffect } from "./buildsData";
import {
	DEMOLITION_DAMAGE,
	DEMOLITION_RADIUS,
	KillCause,
	WRECKER_RANGE,
	WRECKER_SPLINTER,
	WRECKER_SPLINTERS,
} from "./effectsData";
import { fireAimedVolley } from "./effects";

const WRECKER_RANGE2 = WRECKER_RANGE * WRECKER_RANGE;
const DEMOLITION_RADIUS2 = DEMOLITION_RADIUS * DEMOLITION_RADIUS;

/** Demolition's blast for smash `q` (file comment). */
function demolition(ctx: SimCtx, s: BuildsState, q: Readonly<BuildProc>): void {
	const e = s.events;
	e.demolitionX.push(q.x);
	e.demolitionZ.push(q.z);
	e.demolitionOwner.push(q.owner);
	const state = ctx.state;
	const damage = playerHitDamage(state, q.owner, DEMOLITION_DAMAGE);
	const actors = ctx.actors;
	for (let k = 0; k < actors.size(); k++) {
		const a = actors[k];
		if (a.kind === NO_KIND || a.alive === 0 || a.spawnTick === ctx.tick) continue;
		const dx = a.x - q.x;
		const dz = a.z - q.z;
		const reach = DEMOLITION_RADIUS + a.radius;
		if (dx * dx + dz * dz > reach * reach) continue;
		ctx.procGen = q.gen + 1;
		ctx.procCause = KillCause.NONE;
		ctx.damageActor(a, damage);
		ctx.procGen = 0;
	}
	const b = state.breakables;
	if (b === undefined || b.intact === 0) return;
	for (let i = 0; i < b.pieces.size(); i++) {
		const p = b.pieces[i];
		// A chest is skipped; a secret's crack goes on to damageBreakable, which knocks (docs/SECRET_ROOMS.md SR2).
		if (p.brokenTick !== NOT_BROKEN || p.kind === BreakableKind.CHEST) continue;
		const dx = gridToWorld(p.x) - q.x;
		const dz = gridToWorld(p.y) - q.z;
		if (dx * dx + dz * dz > DEMOLITION_RADIUS2) continue;
		damageBreakable(state, i, p.hp, BreakableSource.BUILD, q.owner, q.gen + 1);
	}
}

/**
 * Resolves smash proc `q` for its owner `p` (Wrecker's splinters and combo, Demolition's blast; file comment). The
 * owner is already bound (ctx.actingPlayer). Nothing for an owner without Wrecker.
 */
export function resolveSmash(ctx: SimCtx, s: BuildsState, q: Readonly<BuildProc>, p: Readonly<BuildPlayerState>): void {
	const level = p.levels[Boon.WRECKER] ?? 0;
	if (level <= 0) return;
	const evolved = level >= BOON_MAX_LEVEL;
	if (evolved) demolition(ctx, s, q);
	const fired = fireAimedVolley(
		ctx,
		q.owner,
		q.x,
		q.z,
		levelValue(WRECKER_SPLINTERS, level),
		WRECKER_RANGE2,
		q.id,
		WRECKER_SPLINTER,
		BuildEffect.WRECKER,
		q.gen,
	);
	if (evolved) stepCombo(ctx.state);
	else refillComboTimer(ctx.state);
	const e = s.events;
	e.smashX.push(q.x);
	e.smashZ.push(q.z);
	e.smashOwner.push(q.owner);
	e.smashGen.push(q.gen);
	e.smashFired.push(fired);
}

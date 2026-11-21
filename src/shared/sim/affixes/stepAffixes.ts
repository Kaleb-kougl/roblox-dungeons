/**
 * The affix phase of a tick (docs/ENEMY_VARIANTS.md EV7; see ./affixes.ts): stepCombat runs it right after the actor
 * phase (stepActors), only when state.affixes exists. Actor slots in order:
 *   Shielded (alive)   below a full shield: shieldIdleTicks + 1; at shieldRefillTicks the shield refills fully
 *                      (events.shieldRefilled)
 *   Vengeful (corpse)  armed: vengeTicks = telegraph - (tick - armed tick); at 0 it fires the bruiser's gapped ring
 *                      (BRUISER.data.ring) through ctx.fireEnemy from the corpse: the gap faces the nearest living
 *                      player (co-op: ctx.targetNearest(corpse), since the actor phase is over; solo: the player),
 *                      turned by GAP_TURNS[ctx.randomInt(0, 3)] (one main-rng draw, affixed runs only), exactly like
 *                      the bruiser's slam; events.vengefulFired. The corpse is freed by the next stepActors (its corpse
 *                      time has passed: the telegraph outlasts CORPSE_TICKS).
 *
 * @module
 */
import { AffixKind } from "shared/dungeon";
import type { SimCtx } from "../combat/ctx";
import { rotateDir, type Dir } from "../combat/patterns";
import { toPlayer } from "../combat/actors/helpers";
import { NO_KIND } from "../combat/actors/types";
import { BRUISER, GAP_TURNS } from "../combat/actors/archetypes/bruiser";
import { affixEvent } from "./affixes";

const gap: Dir = { x: 0, z: 1 };

/**
 * The affix phase of a tick, run by stepCombat right after stepActors; a no-op without state.affixes. Walks the actor
 * slots in order: counts a damaged Shielded actor's idle ticks and refills its shield, and counts an armed Vengeful
 * corpse down and fires its ring. Mutates the affix slots and pushes AffixEvents; a firing corpse draws one main-rng
 * integer (ctx.randomInt) for the gap's turn, and in co-op the acting player is retargeted per corpse and set back to
 * player 0 at the end.
 */
export function stepAffixes(ctx: SimCtx): void {
	const state = ctx.state;
	const s = state.affixes;
	if (s === undefined) return;
	const c = s.config;
	const actors = ctx.actors;
	const party = state.party !== undefined;
	const n = math.min(actors.size(), s.slots.size());
	for (let i = 0; i < n; i++) {
		const x = s.slots[i];
		if (x.affix === AffixKind.NONE) continue;
		const a = actors[i];
		if (a.kind === NO_KIND || a.id !== x.actorId) continue;
		if (a.alive !== 0) {
			if (x.affix !== AffixKind.SHIELDED || x.shield >= x.shieldMax) continue;
			x.shieldIdleTicks += 1;
			if (x.shieldIdleTicks < c.shieldRefillTicks) continue;
			x.shield = x.shieldMax;
			x.shieldIdleTicks = 0;
			s.events.shieldRefilled.push(affixEvent(i, a, x.affix, x.shield));
			continue;
		}
		if (x.affix !== AffixKind.VENGEFUL || x.vengeTicks <= 0) continue;
		const left = c.vengefulTelegraphTicks - (ctx.tick - x.vengeArmTick);
		x.vengeTicks = left > 0 ? left : 0;
		if (x.vengeTicks > 0) continue;
		if (party) ctx.targetNearest(a);
		const tp = toPlayer(ctx, a);
		const turn = GAP_TURNS[ctx.randomInt(0, GAP_TURNS.size() - 1)];
		rotateDir(tp.dirX, tp.dirZ, turn[0], turn[1], gap);
		const fired = ctx.fireEnemy(a, -gap.x, -gap.z, BRUISER.data.ring);
		s.events.vengefulFired.push(affixEvent(i, a, x.affix, fired));
	}
	if (party) ctx.actingPlayer(0);
}

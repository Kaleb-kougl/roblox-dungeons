/**
 * Overcap points (docs/BUILDS_V2.md "Overcap points", BV9; a Roblox-port rule, no web source). combat/actors/actors.ts
 * damageActor calls buildsOnOvercap right after applyDamageCap whenever the cap dropped part of a hit (only bosses have
 * a cap; after filterDamage and the Shielded absorb, so a phase-invulnerable boss drops nothing), with state.builds:
 * the dropped damage is added to the acting player's `overcap` (ctx.playerIndex: the bullet's owner, the swinging
 * player, an effect's owner through ctx.actingPlayer; hashed), and while it holds 1 or more, 1 is taken and
 * OVERCAP_POINTS are paid into ScoreSource.OVERCAP (score.ts scoreOvercap: the kills' floor scaling through the usual
 * multipliers, never the combo, BVD18). One BuildEvents overcap entry per hit that paid (the boss's position, the
 * hitter, the points of this hit). Without a score state nothing is counted (no score to pay into, BV0 findings).
 *
 * @module
 */
import type { SimCtx } from "../combat/ctx";
import type { ActorState } from "../combat/actors/types";
import { scoreOvercap } from "../score/score";

/** The cap dropped `dropped` (> 0) of a hit on `a` by ctx's acting player (see the file comment). */
export function buildsOnOvercap(ctx: SimCtx, a: Readonly<ActorState>, dropped: number): void {
	const state = ctx.state;
	const s = state.builds;
	if (s === undefined || state.score === undefined || !(dropped > 0)) return;
	const owner = ctx.playerIndex;
	const p = s.players[owner];
	if (p === undefined) return;
	p.overcap += dropped;
	let points = 0;
	let paid = 0;
	while (p.overcap >= 1) {
		p.overcap -= 1;
		points += scoreOvercap(state);
		paid += 1;
	}
	if (paid === 0) return;
	const e = s.events;
	e.overcapX.push(a.x);
	e.overcapZ.push(a.z);
	e.overcapOwner.push(owner);
	e.overcapPoints.push(points);
}

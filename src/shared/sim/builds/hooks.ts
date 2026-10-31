/**
 * Evolution hooks called from outside the combat phase (docs/BUILDS.md "Evolutions (level III)", BU5; a Roblox-port
 * feature, no web source). A LEAF module: it imports only data and the builds state (types), so score.ts and player.ts
 * can call it without a require cycle. Every hook is called only with state.builds, and does nothing for a player whose
 * boon is below level III (the evolution), who left, or (heals) who is dead.
 *
 *   buildsOnGraze(state, grazer)       score.ts scoreBulletVisit, per graze awarded: Thrill Seeker (Daredevil III)
 *                                      counts it in `grazes`; stepBuilds releases a ring per THRILL_SEEKER_GRAZES.
 *                                      The graze hook BU6's Close Call counts from too.
 *   buildsOnArmorBreak(state, i)       player.ts damagePlayer, an armor pip broke: Bulwark (Warding III) counts it in
 *                                      `bulwarkPending`; stepBuilds releases the nova (the same tick for a hit in the
 *                                      bullet walk or the actor phase; the next tick for contact damage, which steps
 *                                      after it).
 *   buildsOnPerfectRoom(state)         score.ts clearRoom, a PERFECT clear: Lionheart (Hearty III) heals every living
 *                                      owner LIONHEART_HEAL_HALF_HEARTS (up to the maximum); BuildEvents lionPlayer /
 *                                      lionHealed for each heal that restored anything.
 *   buildsFlurryArrow(ctx) / buildsFlurryArrowsFired(ctx, x, z, n)   bow.ts (which ./evolutions.ts's melee import
 *                                      would cycle back to): Flurry's arrow count, see ./evolutions.ts.
 */
import { jsMin } from "shared/jsmath";
import type { PlayerState, SimState } from "../state";
import type { SimCtx } from "../combat/ctx";
import { BOON_MAX_LEVEL, Boon } from "../progression/progressionData";
import type { BuildPlayerState, BuildsState } from "./builds";
import { FLURRY_ARROW_EVERY, FlurryKind, LIONHEART_HEAL_HALF_HEARTS } from "./effectsData";

/** True when `p` owns `boon` evolved (level III). */
export function isEvolved(p: Readonly<BuildPlayerState> | undefined, boon: number): boolean {
	return p !== undefined && (p.levels[boon] ?? 0) >= BOON_MAX_LEVEL;
}

/** Player `i`'s PlayerState (read directly: party.ts imports player.ts, which imports this leaf). */
export function buildPlayerStateAt(state: Readonly<SimState>, i: number): PlayerState {
	const party = state.party;
	return party !== undefined ? party.players[i] : state.player;
}

/** True when player `i` left the run (party.ts hasLeft, read directly for the same reason). */
export function buildPlayerLeft(state: Readonly<SimState>, i: number): boolean {
	const party = state.party;
	return party !== undefined && party.left[i] !== 0;
}

/** A graze was awarded to player `grazer` (see the file comment). */
export function buildsOnGraze(state: SimState, grazer: number): void {
	const p = state.builds?.players[grazer];
	if (p === undefined || !isEvolved(p, Boon.DAREDEVIL)) return;
	p.grazes += 1;
}

/** One of player `i`'s armor pips broke (see the file comment). */
export function buildsOnArmorBreak(state: SimState, i: number): void {
	const p = state.builds?.players[i];
	if (p === undefined || !isEvolved(p, Boon.WARDING) || buildPlayerLeft(state, i)) return;
	p.bulwarkPending += 1;
}

/** A room cleared PERFECT (see the file comment). */
export function buildsOnPerfectRoom(state: SimState): void {
	const s = state.builds;
	if (s === undefined) return;
	for (let i = 0; i < s.players.size(); i++) {
		if (!isEvolved(s.players[i], Boon.HEARTY) || buildPlayerLeft(state, i)) continue;
		const pl = buildPlayerStateAt(state, i);
		if (pl.dead !== 0) continue;
		const healed = jsMin(pl.heartsMax, pl.hearts + LIONHEART_HEAL_HALF_HEARTS) - pl.hearts;
		if (healed <= 0) continue;
		pl.hearts += healed;
		s.events.lionPlayer.push(i);
		s.events.lionHealed.push(healed);
	}
}

/** One BuildEvents Flurry entry. */
export function pushFlurry(s: BuildsState, x: number, z: number, owner: number, kind: number, n: number): void {
	const e = s.events;
	e.flurryX.push(x);
	e.flurryZ.push(z);
	e.flurryOwner.push(owner);
	e.flurryKind.push(kind);
	e.flurryFired.push(n);
}

/** The bow fires a stream arrow for the acting player: true when Flurry makes it a triple. See the file comment. */
export function buildsFlurryArrow(ctx: SimCtx): boolean {
	const p = ctx.state.builds?.players[ctx.playerIndex];
	if (p === undefined || !isEvolved(p, Boon.SWIFT_STRIKES)) return false;
	p.arrows += 1;
	if (p.arrows < FLURRY_ARROW_EVERY) return false;
	p.arrows = 0;
	return true;
}

/** The bow fired Flurry's triple from (x, z): `n` arrows spawned (BuildEvents only). */
export function buildsFlurryArrowsFired(ctx: SimCtx, x: number, z: number, n: number): void {
	const s = ctx.state.builds;
	if (s === undefined || n <= 0) return;
	pushFlurry(s, x, z, ctx.playerIndex, FlurryKind.ARROWS, n);
}

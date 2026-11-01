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
 *
 * Duo hooks (docs/BUILDS.md "Duo boons", BU6; nothing for a player without the duo or who left):
 *   buildsOnGraze                      also Close Call (Soul Shards + Daredevil): the graze counts in `closeGrazes`;
 *                                      stepBuilds releases a shard per CLOSE_CALL_GRAZES (./duos.ts).
 *   buildsOnArmorBreak                 also Unshaken (Composure + Warding): the hit was taken on armor, so
 *                                      BuildEvents.unshakenKept += 1 (stepScore leaves it out of the combo cuts) and a
 *                                      duoProc entry at the player.
 *   buildsGoldRush(state, killer) / buildsGoldRushPop(state, killer, x, z, points)   score.ts scoreKill: Gold Rush
 *                                      (Bounty + Lingering) applies to the killer; its duoProc entry.
 *   buildsUnshakenKept(state)          score.ts stepScore: this tick's Unshaken hits.
 */
import { jsMin } from "shared/jsmath";
import type { PlayerState, SimState } from "../state";
import type { SimCtx } from "../combat/ctx";
import { BOON_MAX_LEVEL, Boon } from "../progression/progressionData";
import type { BuildPlayerState, BuildsState } from "./builds";
import { Duo } from "./buildsData";
import { FLURRY_ARROW_EVERY, FlurryKind, LIONHEART_HEAL_HALF_HEARTS } from "./effectsData";

/** True when `p` owns `boon` evolved (level III). */
export function isEvolved(p: Readonly<BuildPlayerState> | undefined, boon: number): boolean {
	return p !== undefined && (p.levels[boon] ?? 0) >= BOON_MAX_LEVEL;
}

/** True when `p` owns duo `duo` (Duo index). */
export function hasDuo(p: Readonly<BuildPlayerState> | undefined, duo: number): boolean {
	return p !== undefined && p.duos.includes(duo);
}

/** One BuildEvents duoProc entry (see BuildEvents). */
export function pushDuoProc(s: BuildsState, duo: number, owner: number, x: number, z: number, value: number): void {
	const e = s.events;
	e.duoProcDuo.push(duo);
	e.duoProcOwner.push(owner);
	e.duoProcX.push(x);
	e.duoProcZ.push(z);
	e.duoProcValue.push(value);
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
	if (p === undefined) return;
	if (isEvolved(p, Boon.DAREDEVIL)) p.grazes += 1;
	if (hasDuo(p, Duo.CLOSE_CALL)) p.closeGrazes += 1;
}

/** One of player `i`'s armor pips broke (see the file comment). */
export function buildsOnArmorBreak(state: SimState, i: number): void {
	const s = state.builds;
	const p = s?.players[i];
	if (s === undefined || p === undefined || buildPlayerLeft(state, i)) return;
	if (isEvolved(p, Boon.WARDING)) p.bulwarkPending += 1;
	if (hasDuo(p, Duo.UNSHAKEN)) {
		s.events.unshakenKept += 1;
		const pl = buildPlayerStateAt(state, i);
		pushDuoProc(s, Duo.UNSHAKEN, i, pl.x, pl.z, 1);
	}
}

/** Gold Rush applies to a kill credited to player `killer` (they own the duo and are present). */
export function buildsGoldRush(state: Readonly<SimState>, killer: number): boolean {
	return hasDuo(state.builds?.players[killer], Duo.GOLD_RUSH) && !buildPlayerLeft(state, killer);
}

/** A Gold Rush kill at (x, z) scored `points` for `killer` (BuildEvents only). */
export function buildsGoldRushPop(state: SimState, killer: number, x: number, z: number, points: number): void {
	const s = state.builds;
	if (s !== undefined) pushDuoProc(s, Duo.GOLD_RUSH, killer, x, z, points);
}

/** This tick's hits taken on armor by Unshaken owners (0 without builds). */
export function buildsUnshakenKept(state: Readonly<SimState>): number {
	return state.builds?.events.unshakenKept ?? 0;
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

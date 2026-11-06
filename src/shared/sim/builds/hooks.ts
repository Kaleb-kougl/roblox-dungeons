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
 *
 * Bastion (docs/LEGENDARIES.md "Bastion", LG3; legendary, level I; nothing for a player without it, who left or is
 * dead). Brace: one guard or one roll that stops BASTION_BRACE_BULLETS enemy bullets restores one armor pip up to
 * armorMax. `braceCount` counts the current guard's or roll's bullets (reset when either starts, and by a swap that is
 * not mid-roll: a swap ends a guard); the brace fires once, on the bullet that reaches the threshold, and only while
 * `braceReady` is 1 (re-armed when a room's enemies spawn and at a floor's start, set by the pick; cleared by a
 * brace). A brace with nothing to restore is NOT spent (owner's tuning, LGD6 revised): braceReady stays set and
 * nothing is pushed, so a later guard or roll restores the pip a hit took; BraceKind.SPENT is never pushed.
 * BuildEvents bracePlayer / braceKind. Duos (LG4): Citadel (Bastion + Warding) lifts the once per room but waits
 * CITADEL_BRACE_COOLDOWN_TICKS after each brace (`braceCooldown`, LGD14); Stone Heart (Bastion + Hearty) heals half
 * a heart when no pip is missing (BraceKind.HEAL, which spends the brace).
 *   buildsOnGuardCancels(state, i, cancels, starting)   sword.ts, every guard tick: `cancels` bullets erased this tick
 *                                      (goo outside it; strikes are never erased), `starting` on the guard's first tick.
 *   bastionRollOn(state, i)            combat.ts, once a tick per player (the bastionRolling mask): player i owns
 *                                      Bastion and rolls with i-frames running (rollTicks > 0 and iframeTicks > 0).
 *   buildsOnRollThrough(state, i)      combat.ts enemy bullet walk: an enemy bullet (not goo, not a strike) not counted
 *                                      before (payload lastHit 0; the walk marks it 1) overlaps rolling player i.
 *   buildsOnRollStart(state, i) / buildsOnSwap(state, i)   weapons.ts: a roll started (Ember Wake's moment) / a swap.
 *   buildsBraceRearm(state)            progression.ts stepRun: a floor's start and a room's enemies spawning.
 */
import { jsMin } from "shared/jsmath";
import type { PlayerState, SimState } from "../state";
import type { SimCtx } from "../combat/ctx";
import { BASTION_BRACE_BULLETS, BOON_MAX_LEVEL, Boon } from "../progression/progressionData";
import type { BuildPlayerState, BuildsState } from "./builds";
import { Duo } from "./buildsData";
import {
	BraceKind,
	FLURRY_ARROW_EVERY,
	FlurryKind,
	CITADEL_BRACE_COOLDOWN_TICKS,
	LIONHEART_HEAL_HALF_HEARTS,
	STONE_HEART_HEAL_HALF_HEARTS,
} from "./effectsData";

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

// ---------------------------------------------------------------------------------------------
// Bastion's brace (see the file comment)

/** True when `p` owns Bastion. */
function hasBastion(p: Readonly<BuildPlayerState> | undefined): boolean {
	return p !== undefined && (p.levels[Boon.BASTION] ?? 0) > 0;
}

/** One BuildEvents brace entry. */
function pushBrace(s: BuildsState, i: number, kind: number): void {
	s.events.bracePlayer.push(i);
	s.events.braceKind.push(kind);
}

/**
 * Player i braces (the count just reached the threshold): see the file comment. Citadel (Bastion + Warding, LG4): no
 * once-per-room limit (braceReady neither needed nor cleared) but a cooldown: none while `braceCooldown` > 0, and a
 * brace that restored something sets it to CITADEL_BRACE_COOLDOWN_TICKS. Stone Heart (Bastion + Hearty, LG4): with no
 * pip missing, STONE_HEART_HEAL_HALF_HEARTS half hearts healed instead (up to the maximum; BraceKind.HEAL), once per
 * room like any brace unless Citadel. Nothing to restore (no pip missing, no heal): not spent, nothing pushed.
 */
function brace(state: SimState, s: BuildsState, p: BuildPlayerState, i: number): void {
	const citadel = hasDuo(p, Duo.CITADEL);
	if (citadel ? p.braceCooldown > 0 : p.braceReady === 0) return;
	const pl = buildPlayerStateAt(state, i);
	let kind: number;
	if (pl.armor < pl.armorMax) {
		pl.armor += 1;
		kind = BraceKind.PIP;
	} else {
		const healed = hasDuo(p, Duo.STONE_HEART)
			? jsMin(pl.heartsMax, pl.hearts + STONE_HEART_HEAL_HALF_HEARTS) - pl.hearts
			: 0;
		if (healed <= 0) return;
		pl.hearts += healed;
		kind = BraceKind.HEAL;
	}
	if (citadel) p.braceCooldown = CITADEL_BRACE_COOLDOWN_TICKS;
	else p.braceReady = 0;
	pushBrace(s, i, kind);
}

/** stepBuilds, every unfrozen tick: Citadel's brace cooldowns count down (see the file comment). */
export function stepBraceCooldowns(s: BuildsState): void {
	for (const p of s.players) if (p.braceCooldown > 0) p.braceCooldown -= 1;
}

/** Adds `n` stopped bullets to player i's brace count; braces on the one that reaches BASTION_BRACE_BULLETS. */
function addBraceCount(state: SimState, s: BuildsState, p: BuildPlayerState, i: number, n: number): void {
	if (n <= 0) return;
	const before = p.braceCount;
	p.braceCount = before + n;
	if (before < BASTION_BRACE_BULLETS && p.braceCount >= BASTION_BRACE_BULLETS) brace(state, s, p, i);
}

/** The Bastion owner i who can count a bullet now (present and alive), else undefined. */
function bastionPlayer(state: Readonly<SimState>, i: number): BuildPlayerState | undefined {
	const p = state.builds?.players[i];
	if (!hasBastion(p) || buildPlayerLeft(state, i) || buildPlayerStateAt(state, i).dead !== 0) return undefined;
	return p;
}

/** A guard tick of player i erased `cancels` enemy bullets (`starting`: the guard's first tick). */
export function buildsOnGuardCancels(state: SimState, i: number, cancels: number, starting: boolean): void {
	const s = state.builds;
	const p = bastionPlayer(state, i);
	if (s === undefined || p === undefined) return;
	if (starting) p.braceCount = 0;
	addBraceCount(state, s, p, i, cancels);
}

/** True when player i's roll counts enemy bullets for the brace this tick (see the file comment). */
export function bastionRollOn(state: Readonly<SimState>, i: number): boolean {
	if (bastionPlayer(state, i) === undefined) return false;
	const pl = buildPlayerStateAt(state, i);
	return pl.rollTicks > 0 && pl.iframeTicks > 0;
}

/** A not-yet-counted enemy bullet overlaps rolling player i (the walk has marked it). */
export function buildsOnRollThrough(state: SimState, i: number): void {
	const s = state.builds;
	const p = bastionPlayer(state, i);
	if (s === undefined || p === undefined) return;
	addBraceCount(state, s, p, i, 1);
}

/** Player i started a roll: a new count (a guard it cut short is over). */
export function buildsOnRollStart(state: SimState, i: number): void {
	const p = state.builds?.players[i];
	if (hasBastion(p)) p!.braceCount = 0;
}

/** Player i swapped weapon sets: a guard in progress ended, so its count is gone (a roll's count is kept). */
export function buildsOnSwap(state: SimState, i: number): void {
	const p = state.builds?.players[i];
	if (hasBastion(p) && buildPlayerStateAt(state, i).rollTicks === 0) p!.braceCount = 0;
}

/** A floor started or a room's enemies spawned: every present Bastion owner's brace is ready again. */
export function buildsBraceRearm(state: SimState): void {
	const s = state.builds;
	if (s === undefined) return;
	for (let i = 0; i < s.players.size(); i++) {
		const p = s.players[i];
		if (hasBastion(p) && !buildPlayerLeft(state, i)) p.braceReady = 1;
	}
}

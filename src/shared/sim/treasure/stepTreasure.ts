/**
 * The vault's lock in the tick (docs/TREASURE.md TR3, Design §2 steps 1-3). stepTreasure runs after stepScore (step.ts
 * 8b, stepParty 9b), so this tick's engagement (endless records engage in stepEndless's attachScoreRoomMembers, M1-style
 * ones inside stepScore), landed hits (ScoreState.hitsTaken, summed in stepScore) and clear are known. Never on a
 * frozen draft tick (step / stepParty return before it), so a draft holds the SWIFT countdown. No rng.
 *
 *   1. SEALED -> ARMED when the vault room's score record has engaged (engageTick >= 0): armTick = state.tick (the
 *      engagement tick: nothing between them runs on a later tick). UNTOUCHED: allowance = vaultAllowance(present
 *      players, Respite level); SWIFT: ticksLeft = swiftTicks(the record's parTicks, Respite level). events.armed.
 *   2. ARMED: UNTOUCHED cracks when the party's hits since the engagement (hitsTaken - hitsAtEngage: the record's own
 *      PERFECT count, armor and Aegis hits included, hits on the engagement tick included) pass the allowance. SWIFT
 *      counts ticksLeft down by one on every tick after the arm tick, BEFORE step 3, and cracks at 0: armed on tick E
 *      with S, a clear on tick T keeps the lock iff T - E < S, which at 100 % (S = parTicks) is exactly when clearRoom
 *      pays FAST (under = parTicks - (T - E) > 0; TR0 correction 4). A crack: tier one lower (never below COMMON),
 *      CRACKED, crackTick, events.cracked. Once: a cracked lock never counts again.
 *   3. The record cleared (this tick, or on the arm tick itself), from ARMED or CRACKED -> UNLOCKED: kept, `spare` =
 *      SWIFT ticksLeft (= FAST's `under` at 100 %) / UNTOUCHED allowance - hits; cracked, `missBy` = SWIFT clear tick -
 *      crack tick / UNTOUCHED hits - allowance. events.unlocked. Step 2 runs first, so a hit (or the countdown's end)
 *      on the clear tick cracks, as PERFECT / FAST see it. A slime's split children are adopted into the record
 *      (score.ts adoptScoreRoomMember), so the room clears, and the chest unlocks, only once they are down too.
 *   4. UNLOCKED (from step 3 this tick too) -> OPENED (TR4): the first living present player (index order) whose
 *      centre is within config.reachTiles of the chest's centre opens it for the party (TRD8; the dead never open).
 *      Every living present player, in index order, gets their own grants, every draw on the treasure stream (this
 *      state, an RngHolder; never state.rngState or the drop stream), fixed counts per case:
 *        LEGENDARY  with builds: bonusDeals[i] += 1 (stepRun step 1 deals it on the next floor change, its first deal
 *                   a guaranteed duo when one is available); without builds: the RARE relic (below). Then
 *                   boosts[LEGENDARY] (1) boost draws.
 *        RARE       one rngInt over unownedRelics(state, i) -> grantRelic (no relicCollected run event, TR0
 *                   correction 14); none left: relicFallbackBoosts (2) boost draws instead.
 *        COMMON     boosts[COMMON] (2) boost draws.
 *      A boost draw is pickBoostKind(treasure); each boost then lands in the lowest free ground slot at the next of
 *      TREASURE.boostOffsets in front of the chest (forward along the facing (fx, fz), side along (-fz, fx); landed in
 *      this open's order), events.dropped + fromChest, or with every slot taken is given straight to that player
 *      (owner answer C1: giveBoost, events.collected with GIVEN_DROP_SLOT). So the draws never depend on the ground.
 *      Then scoreTreasure(points[tier]) once (combo-neutral, TRD11), opened += 1, kept += 1 for an uncracked lock,
 *      legendary += 1 for a Legendary tier, events.opened (the grants, for the view).
 */
import { VaultLock, VaultTier } from "shared/dungeon";
import { rngInt } from "../rng";
import type { SimState } from "../state";
import { hasLeft, partySize, playerAt, presentPlayerCount } from "../party";
import { scaleTicks } from "../progression/runMods";
import { grantRelic, unownedRelics } from "../progression/progression";
import { DEFAULT_PARTY_SIZE } from "../score/scoreData";
import { scoreTreasure, type RoomScore, type ScoreState } from "../score/score";
import { pickBoostKind } from "../drops/drops";
import { giveBoost, landDrop, lowestFreeDropSlot } from "../drops/breakLoot";
import { GIVEN_DROP_SLOT } from "../drops/dropsData";
import { treasureRespiteLevel } from "./respite";
import type { TreasureGrant, TreasureState } from "./treasure";
import {
	TREASURE,
	TREASURE_UNSET,
	VAULT_CRACK_TIERS,
	VAULT_LOWEST_TIER,
	VaultStatus,
	type TreasureConfig,
} from "./treasureData";

/** `list[level]`, the level clamped into the list (an empty list: 0). */
function byLevel(list: ReadonlyArray<number>, level: number): number {
	const n = list.size();
	if (n === 0) return 0;
	return list[math.clamp(level, 0, n - 1)];
}

/** UNTOUCHED's hits allowed: one per present player beyond the first (TRD7), plus Respite's (TRD10). Pure. */
export function vaultAllowance(present: number, level: number, config: Readonly<TreasureConfig>): number {
	return present - 1 + byLevel(config.respiteAllowance, level);
}

/** SWIFT's countdown: `par` x (swiftParPercent + Respite's percent) / 100, round half up (runMods scaleTicks). Pure. */
export function swiftTicks(par: number, level: number, config: Readonly<TreasureConfig>): number {
	return scaleTicks(par, config.swiftParPercent + byLevel(config.respiteSwiftPercent, level));
}

function crack(state: Readonly<SimState>, t: TreasureState): void {
	t.status = VaultStatus.CRACKED;
	t.tier = math.max(VAULT_LOWEST_TIER, t.tier - VAULT_CRACK_TIERS);
	t.crackTick = state.tick;
	t.events.cracked = 1;
}

/** Steps 1-3 on a live lock (SEALED / ARMED / CRACKED), see the file comment. */
function stepLock(state: SimState, t: TreasureState, s: ScoreState, r: RoomScore): void {
	// 1. Arm on the record's engagement.
	let armedNow = false;
	if (t.status === VaultStatus.SEALED) {
		if (r.engageTick < 0) return;
		const level = treasureRespiteLevel(state);
		t.status = VaultStatus.ARMED;
		t.armTick = state.tick;
		if (t.lock === VaultLock.UNTOUCHED)
			t.allowance = vaultAllowance(presentPlayerCount(state) ?? DEFAULT_PARTY_SIZE, level, t.config);
		else t.ticksLeft = swiftTicks(r.parTicks, level, t.config);
		t.events.armed = 1;
		armedNow = true;
	}

	// 2. The lock holds or cracks (once).
	const hits = s.hitsTaken - r.hitsAtEngage;
	if (t.status === VaultStatus.ARMED) {
		if (t.lock === VaultLock.UNTOUCHED) {
			if (hits > t.allowance) crack(state, t);
		} else if (!armedNow) {
			t.ticksLeft -= 1;
			if (t.ticksLeft <= 0) crack(state, t);
		}
	}

	// 3. The clear unlocks.
	if (r.cleared === 0) return;
	const untouched = t.lock === VaultLock.UNTOUCHED;
	if (t.status === VaultStatus.ARMED) t.spare = untouched ? t.allowance - hits : t.ticksLeft;
	else t.missBy = untouched ? hits - t.allowance : state.tick - t.crackTick;
	t.status = VaultStatus.UNLOCKED;
	t.events.unlocked = 1;
}

function within(x: number, z: number, cx: number, cz: number, radius: number): boolean {
	const dx = x - cx;
	const dz = z - cz;
	return dx * dx + dz * dz <= radius * radius;
}

/** Alive and still in the run (a solo player never leaves). */
function livingPresent(state: Readonly<SimState>, i: number): boolean {
	return playerAt(state, i).dead === 0 && !hasLeft(state, i);
}

/** The opener: the first living present player (index order) in reach of the chest's centre; TREASURE_UNSET if none. */
function openerOf(state: Readonly<SimState>, t: Readonly<TreasureState>): number {
	const n = partySize(state);
	for (let i = 0; i < n; i++) {
		if (!livingPresent(state, i)) continue;
		const p = playerAt(state, i);
		if (within(p.x, p.z, t.x, t.z, t.config.reachTiles)) return i;
	}
	return TREASURE_UNSET;
}

/**
 * `count` boost draws for player `i` (into `g`), each landed in front of the chest or given straight to them (C1).
 * `landed` counts this open's landings so far (the offset index); returns it updated.
 */
function grantBoosts(
	state: SimState,
	t: TreasureState,
	i: number,
	count: number,
	g: TreasureGrant,
	landed: number,
): number {
	const d = state.drops;
	const offsets = TREASURE.boostOffsets;
	for (let k = 0; k < count; k++) {
		const kind = pickBoostKind(t);
		g.boosts.push(kind);
		if (d === undefined) {
			g.slots.push(TREASURE_UNSET);
			continue;
		}
		const slot = lowestFreeDropSlot(d);
		if (slot < 0) {
			const p = playerAt(state, i);
			giveBoost(d, i, kind, p.x, p.z);
			g.slots.push(GIVEN_DROP_SLOT);
			continue;
		}
		const o = offsets[landed % offsets.size()];
		const x = t.x + t.fx * o.forward - t.fz * o.side;
		const z = t.z + t.fz * o.forward + t.fx * o.side;
		landDrop(d, slot, kind, x, z, state.tick);
		d.events.fromChest.push(slot);
		g.slots.push(slot);
		landed += 1;
	}
	return landed;
}

/** A Rare share for player `i`: one relic draw over their unowned pool, or (none left) the fallback boosts. */
function grantRelicShare(state: SimState, t: TreasureState, i: number, g: TreasureGrant, landed: number): number {
	const left = unownedRelics(state, i);
	if (left.size() === 0) return grantBoosts(state, t, i, t.config.relicFallbackBoosts, g, landed);
	const relic = left[rngInt(t, 0, left.size() - 1)];
	grantRelic(state, i, relic);
	g.relic = relic;
	return landed;
}

/** Step 4: player `opener` opens the unlocked chest (see the file comment). */
function openChest(state: SimState, t: TreasureState, opener: number): void {
	const config = t.config;
	const tier = t.tier;
	t.status = VaultStatus.OPENED;
	const grants: TreasureGrant[] = [];
	let landed = 0;
	const n = partySize(state);
	for (let i = 0; i < n; i++) {
		if (!livingPresent(state, i)) continue;
		const g: TreasureGrant = { player: i, relic: TREASURE_UNSET, bonusDeal: 0, boosts: [], slots: [] };
		if (tier === VaultTier.LEGENDARY) {
			if (state.builds !== undefined) {
				t.bonusDeals[i] += 1;
				g.bonusDeal = 1;
			} else landed = grantRelicShare(state, t, i, g, landed);
			landed = grantBoosts(state, t, i, config.boosts[tier], g, landed);
		} else if (tier === VaultTier.RARE) {
			landed = grantRelicShare(state, t, i, g, landed);
			landed = grantBoosts(state, t, i, config.boosts[tier], g, landed);
		} else landed = grantBoosts(state, t, i, config.boosts[tier], g, landed);
		grants.push(g);
	}
	const points = scoreTreasure(state, config.points[tier]);
	const kept = t.crackTick === TREASURE_UNSET ? 1 : 0;
	t.opened += 1;
	t.kept += kept;
	if (tier === VaultTier.LEGENDARY) t.legendary += 1;
	t.events.opened = {
		opener,
		tier,
		startTier: t.startTier,
		lock: t.lock,
		kept,
		missBy: t.missBy,
		spare: t.spare,
		points,
		grants,
	};
}

/** End of every unfrozen tick, after stepScore (see the file comment). No-op without state.treasure or a live vault. */
export function stepTreasure(state: SimState): void {
	const t = state.treasure;
	const s = state.score;
	if (t === undefined || s === undefined) return;
	if (t.status === VaultStatus.SEALED || t.status === VaultStatus.ARMED || t.status === VaultStatus.CRACKED) {
		const r = s.rooms[t.record];
		if (r === undefined) return;
		stepLock(state, t, s, r);
	}

	// 4. The open (an unlock and an open on the same tick are fine).
	if (t.status !== VaultStatus.UNLOCKED) return;
	const opener = openerOf(state, t);
	if (opener !== TREASURE_UNSET) openChest(state, t, opener);
}

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
 *   4. UNLOCKED -> OPENED: TR4. Until then an unlocked chest stays UNLOCKED.
 */
import { VaultLock } from "shared/dungeon";
import type { SimState } from "../state";
import { presentPlayerCount } from "../party";
import { scaleTicks } from "../progression/runMods";
import { DEFAULT_PARTY_SIZE } from "../score/scoreData";
import { treasureRespiteLevel } from "./respite";
import type { TreasureState } from "./treasure";
import { VAULT_CRACK_TIERS, VAULT_LOWEST_TIER, VaultStatus, type TreasureConfig } from "./treasureData";

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

/** End of every unfrozen tick, after stepScore (see the file comment). No-op without state.treasure or a live lock. */
export function stepTreasure(state: SimState): void {
	const t = state.treasure;
	const s = state.score;
	if (t === undefined || s === undefined) return;
	if (t.status !== VaultStatus.SEALED && t.status !== VaultStatus.ARMED && t.status !== VaultStatus.CRACKED) return;
	const r = s.rooms[t.record];
	if (r === undefined) return;

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

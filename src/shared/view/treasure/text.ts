/**
 * Every vault text (docs/TREASURE.md TR7; the strings are TR6's TREASURE_STRING_KEYS): the arm toast (TR8 shows it),
 * the lock plate, the crack's tier line, the unlock's kept line, the open's kept / near-miss line and the reward cards,
 * and the KV_TreasureLabel debug label. Pure: every helper takes the theme's string lookup (`str`, the client's
 * `pack.str` or a spec's fake), so it is tested headlessly (text.spec.ts). Numbers: ASCII digits through shared/l10n
 * (seconds with one decimal: formatTenths, points grouped: formatThousands); never upper-cased in code (the strings
 * are written in caps where they are caps).
 */
import { formatThousands, formatTenths } from "shared/l10n";
import { VaultLock } from "shared/dungeon";
import { RELICS, SIM_HZ, TREASURE_UNSET, VaultStatus, type TreasureState } from "shared/sim";
import { TREASURE_LOCKS, TREASURE_TIERS, treasureLockNameKey, treasureTierNameKey } from "shared/theme";
import type { TreasureGrantView, TreasureOpenedEvent } from "./events";

/** A theme string lookup (the client's `pack.str`, or `(k, v) => pack.str(k, v)`). */
export type TreasureStr = (key: string, vars?: Readonly<Record<string, string | number>>) => string;

/** The strings these helpers read (TREASURE_STRING_KEYS, by name). */
export const TREASURE_TEXT_KEYS = {
	toastFloor: "hud.toast.vault",
	toastUntouched: "hud.toast.vaultLock.untouched",
	toastUntouchedParty: "hud.toast.vaultLock.untouchedParty",
	toastSwift: "hud.toast.vaultLock.swift",
	unlocked: "treasure.unlocked",
	spareTime: "treasure.spareTime",
	spareHits: "treasure.spareHits",
	kept: "treasure.kept",
	nearMissTime: "treasure.nearMiss.time",
	nearMissHits: "treasure.nearMiss.hits",
	relic: "treasure.reward.relic",
	draft: "treasure.reward.draft",
	boosts: "treasure.reward.boosts",
	points: "treasure.reward.points",
} as const;

const SECONDS_PER_MINUTE = 60;
const TENTHS_PER_SECOND = 10;
/** A miss that ended on the clear tick still reads as over by the smallest step shown. */
const MIN_MISS_TENTHS = 1;

/** Ticks as whole seconds rounded up, "m:ss" (the SWIFT toast and plate; 0 and below: "0:00"). */
export function vaultClock(ticks: number): string {
	const secs = math.max(0, math.ceil(ticks / SIM_HZ));
	const m = math.floor(secs / SECONDS_PER_MINUTE);
	const s = secs % SECONDS_PER_MINUTE;
	return `${m}:${s < 10 ? "0" : ""}${s}`;
}

/** Ticks as whole tenths of a second, rounded half up (exact integer arithmetic). */
export function ticksToTenths(ticks: number): number {
	return math.floor((math.max(0, ticks) * TENTHS_PER_SECOND + SIM_HZ / 2) / SIM_HZ);
}

/** A lock's name (`treasure.lock.<lock>`: "UNTOUCHED" / "SWIFT"). */
export function lockNameText(s: TreasureStr, lock: number): string {
	return s(treasureLockNameKey(lock));
}

/** A tier's name (the draft's `boon.rarity.<tier>`: the crack's rising line). */
export function tierNameText(s: TreasureStr, tier: number): string {
	return s(treasureTierNameKey(tier));
}

/** A toast line as the HUD's toast store keeps it: a string key and its literal vars (looked up when drawn). */
export interface TreasureToastLine {
	readonly key: string;
	readonly args: Readonly<Record<string, string | number>> | undefined;
}

/**
 * The arm toast's key and vars (TR8, the client store's ToastView): UNTOUCHED solo (allowance 0) "clear the room
 * without a hit", in a party the allowance (`untouchedParty`, `{hits}`); SWIFT the countdown at the arm (`{time}`,
 * m:ss).
 */
export function lockToastLine(lock: number, allowance: number, ticksLeft: number): TreasureToastLine {
	const K = TREASURE_TEXT_KEYS;
	if (lock === VaultLock.SWIFT) return { key: K.toastSwift, args: { time: vaultClock(ticksLeft) } };
	return allowance > 0
		? { key: K.toastUntouchedParty, args: { hits: allowance } }
		: { key: K.toastUntouched, args: undefined };
}

/** The arm toast's text (lockToastLine through the theme's lookup). */
export function lockToastText(s: TreasureStr, lock: number, allowance: number, ticksLeft: number): string {
	const line = lockToastLine(lock, allowance, ticksLeft);
	return s(line.key, line.args);
}

/** What the plate shows: the lock's name, and for SWIFT the countdown (undefined for UNTOUCHED: it shows pips). */
export interface PlateText {
	readonly label: string;
	readonly clock: string | undefined;
}

/** The plate's texts for `lock` with `ticksLeft` (SWIFT). */
export function lockPlateText(s: TreasureStr, lock: number, ticksLeft: number): PlateText {
	return {
		label: lockNameText(s, lock),
		clock: lock === VaultLock.SWIFT ? vaultClock(ticksLeft) : undefined,
	};
}

/** The UNTOUCHED plate's pips: allowance + 1 (the last, outlined, is the hit that cracks), `spent` of them used. */
export interface PlatePips {
	readonly total: number;
	readonly spent: number;
}

export function platePips(allowance: number, hits: number): PlatePips {
	const total = math.max(0, allowance) + 1;
	return { total, spent: math.clamp(hits, 0, total) };
}

/**
 * The unlock's kept line: SWIFT with time to spare `treasure.spareTime` (`{seconds}`, one decimal), UNTOUCHED with hits
 * to spare `treasure.spareHits` (`{hits}`), nothing to spare (a solo UNTOUCHED) `treasure.unlocked`. `{lock}` is the
 * lock's name.
 */
export function unlockLineText(s: TreasureStr, lock: number, spare: number): string {
	const K = TREASURE_TEXT_KEYS;
	const name = lockNameText(s, lock);
	if (spare !== TREASURE_UNSET && spare > 0) {
		if (lock === VaultLock.SWIFT)
			return s(K.spareTime, { lock: name, seconds: formatTenths(ticksToTenths(spare)) });
		return s(K.spareHits, { lock: name, hits: spare });
	}
	return s(K.unlocked, { lock: name });
}

/**
 * The open's near-miss line after a crack: SWIFT "So close: 2.1 s over" (ticks over, one decimal, at least 0.1),
 * UNTOUCHED "So close: 1 too many hits". Undefined when `missBy` is unset.
 */
export function nearMissText(s: TreasureStr, lock: number, missBy: number): string | undefined {
	const K = TREASURE_TEXT_KEYS;
	if (missBy === TREASURE_UNSET || missBy < 0) return undefined;
	if (lock === VaultLock.SWIFT) {
		return s(K.nearMissTime, { seconds: formatTenths(math.max(MIN_MISS_TENTHS, ticksToTenths(missBy))) });
	}
	return s(K.nearMissHits, { hits: math.max(1, missBy) });
}

/** The open's kept line: "Kept Legendary" (`{tier}` the opened tier's name). */
export function keptText(s: TreasureStr, tier: number): string {
	return s(TREASURE_TEXT_KEYS.kept, { tier: tierNameText(s, tier) });
}

/** The line under the cards: kept -> keptText, cracked -> nearMissText (undefined: no line). */
export function openLineText(s: TreasureStr, o: Readonly<TreasureOpenedEvent>): string | undefined {
	return o.kept !== 0 ? keptText(s, o.tier) : nearMissText(s, o.lock, o.missBy);
}

/** What a reward card is: its text and whether it is the points card (its own colour) or a reward (the tier's). */
export interface RewardCardText {
	readonly kind: "relic" | "draft" | "boosts" | "points";
	readonly text: string;
}

/** A relic's name key (`<relic id>.name`, the progression toasts' itemNameKey), or undefined for an unknown index. */
export function relicNameKey(relic: number): string | undefined {
	const def = RELICS[relic];
	return def !== undefined ? `${def.id}.name` : undefined;
}

/** The grant of player `player` in an open, or undefined (dead, left, or spectating someone without one). */
export function grantOf(o: Readonly<TreasureOpenedEvent>, player: number): TreasureGrantView | undefined {
	for (const g of o.grants) if (g.player === player) return g;
	return undefined;
}

/**
 * The reward cards top to bottom for the VIEW player `player` (Rules: a spectator sees the watched player's): their
 * relic (`RELIC · Hourglass`), bonus draft (`BONUS DRAFT next floor`), boosts (`BOOSTS +2`), then the open's points
 * (`+1,200`, the party's; none at 0). A player without a grant sees the points alone.
 */
export function rewardCardTexts(s: TreasureStr, o: Readonly<TreasureOpenedEvent>, player: number): RewardCardText[] {
	const K = TREASURE_TEXT_KEYS;
	const out: RewardCardText[] = [];
	const g = grantOf(o, player);
	if (g !== undefined) {
		const key = g.relic !== TREASURE_UNSET ? relicNameKey(g.relic) : undefined;
		if (key !== undefined) out.push({ kind: "relic", text: s(K.relic, { name: s(key) }) });
		if (g.bonusDeal > 0) out.push({ kind: "draft", text: s(K.draft) });
		if (g.boosts.size() > 0) out.push({ kind: "boosts", text: s(K.boosts, { count: g.boosts.size() }) });
	}
	if (o.points > 0) out.push({ kind: "points", text: s(K.points, { points: formatThousands(o.points) }) });
	return out;
}

const STATUS_NAMES = ["none", "sealed", "armed", "cracked", "unlocked", "opened"];

/**
 * KV_TreasureLabel (developer English, never translated): `<lock> <tier> <status>` plus SWIFT `t=<ticksLeft>` or
 * UNTOUCHED `hits <hits>/<allowance>`, e.g. "untouched legendary armed hits 0/0".
 */
export function treasureDebugText(t: Readonly<TreasureState>, hits: number): string {
	const lock = TREASURE_LOCKS[t.lock] ?? "-";
	const tier = TREASURE_TIERS[t.tier] ?? "-";
	const status = STATUS_NAMES[t.status] ?? tostring(t.status);
	let tail = "";
	if (t.status === VaultStatus.ARMED || t.status === VaultStatus.CRACKED) {
		tail = t.lock === VaultLock.SWIFT ? ` t=${t.ticksLeft}` : ` hits ${hits}/${t.allowance}`;
	}
	return `${lock} ${tier} ${status}${tail}`;
}

/**
 * Roblox port (docs/TREASURE.md TR6, Design §5): the theme's treasure-room (vault) keys: the chest's three looks (asset
 * IDs, the TREASURE slot), the optional light column effect, the colour roles (the chest's and cage's placeholder
 * colours, the floor-only tier colours of conflict C2), the four sounds and the strings. Pure data with no runtime
 * import, like pellets.ts: contract.ts and validate.ts sit near Luau's 200-locals-per-function limit, so none of these
 * lists is imported there: contract.ts names the same IDs inline inside its existing lists (REQUIRED_ASSET_IDS,
 * PORT_AUDIO_EVENTS, FX_IDS, REQUIRED_STRING_KEYS) and holds the TREASURE slot; treasure.spec.ts checks they agree. The
 * colour rules and `treasureReport` are in treasureColors.ts, folded into variantColors.ts' problems (validate.ts takes
 * no new name).
 *
 * Asset ID segments are lowercase (validate.ts isAssetId), so the plan's `treasure.chestOpen` is `treasure.chestopen`
 * (the `sfx.boost.aegisbreak` precedent).
 *
 * Tiers and locks are numbered as shared/dungeon vaultData.ts `VaultTier` (COMMON 0, RARE 1, LEGENDARY 2) and
 * `VaultLock` (UNTOUCHED 0, SWIFT 1); the theme imports nothing outside shared/theme, so treasure.spec.ts pins the
 * orders against the dungeon's tables.
 *
 * @module
 */

import type { ColorRole } from "./types";

/** The chest's tiers, VaultTier order (the draft's rarity names, TRD5). */
export const TREASURE_TIERS = ["common", "rare", "legendary"] as const;
/**
 * A chest tier's name (a TREASURE_TIERS entry). Its position in that list is the dungeon's `VaultTier` number; the name
 * is the last segment of the tier's string key (`boon.rarity.<tier>`) and floor colour role (`treasure.<tier>`).
 */
export type TreasureTier = (typeof TREASURE_TIERS)[number];

/** The vault's locks, VaultLock order (TRD4). */
export const TREASURE_LOCKS = ["untouched", "swift"] as const;
/**
 * A vault lock's name (a TREASURE_LOCKS entry). Its position in that list is the dungeon's `VaultLock` number; the name
 * is the last segment of the lock's string key (`treasure.lock.<lock>`).
 */
export type TreasureLock = (typeof TREASURE_LOCKS)[number];

/**
 * Every treasure asset ID, all REQUIRED (the chest is a gameplay object: it blocks movement and bullets): the closed
 * chest, the open chest (lid up, the rest of the floor after the open), and the cage drawn over the closed chest until
 * the vault unlocks. World art (`image` with `pixelsPerTile`, or `sprites` with `idle`) or the placeholder: a low box,
 * a lid wedge, a row of thin bars (placeholders.ts).
 */
export const TREASURE_IDS: ReadonlyArray<string> = ["treasure.chest", "treasure.chestopen", "treasure.cage"];

/** The closed chest's asset ID (also its colour role, which the open chest shares). */
export const TREASURE_CHEST_ID = "treasure.chest";
/** The open chest's asset ID (colour role `treasure.chest`). */
export const TREASURE_CHEST_OPEN_ID = "treasure.chestopen";
/** The cage's asset ID (also its colour role). */
export const TREASURE_CAGE_ID = "treasure.cage";

/**
 * The open's light column (an optional sprite effect in FX_IDS, like every `fx.*`): drawn when a pack has it, tinted
 * by the opened tier's floor role (TREASURE_FLOOR_ROLES); without it the column is the particle burst alone (TR7).
 */
export const TREASURE_COLUMN_FX_ID = "fx.treasure.column";

/**
 * The placeholder colours of the chest and its cage (TREASURE_IDS' roles; the open chest uses the chest's): a dark
 * red-brown wood (the enemy bullet stays >= 3:1 on it, as on a breakable: bullets stop on the chest) and a light iron
 * (>= 3:1 on every biome floor, so the bars read as "closed"). Held to TREASURE_COLOR_RULES by `treasureReport`.
 */
export const TREASURE_PIECE_ROLES: ReadonlyArray<ColorRole> = ["treasure.chest", "treasure.cage"];

/**
 * The tier colours drawn ON THE FLOOR (the sparkle, the lock plate and its shards, the rising tier line, the column and
 * the ring burst), TREASURE_TIERS order. Conflict C2 (owner, 2026-11-03): the draft's `boon.rare` / `boon.legendary`
 * are under 40 CIE76 from `telegraph`, so the floor takes its own roles, the draft's hues nudged just far enough to
 * pass (`treasureReport`, numbers in docs/TREASURE.md "As built (TR6)"). UI uses keep TREASURE_UI_ROLES.
 */
export const TREASURE_FLOOR_ROLES: ReadonlyArray<ColorRole> = [
	"treasure.common",
	"treasure.rare",
	"treasure.legendary",
];

/**
 * The tier colours in UI (toasts, the reward cards, the minimap mark), TREASURE_TIERS order: the draft's own
 * (contract.ts BOON_RARITY_ROLES), one rarity language across the game (TRD5).
 */
export const TREASURE_UI_ROLES: ReadonlyArray<ColorRole> = ["boon.common", "boon.rare", "boon.legendary"];

/** A tier's floor colour role (`tier`: VaultTier, 0..2). */
export function treasureFloorRole(tier: number): ColorRole {
	return TREASURE_FLOOR_ROLES[tier];
}

/** A tier's UI colour role (`tier`: VaultTier, 0..2). */
export function treasureUiRole(tier: number): ColorRole {
	return TREASURE_UI_ROLES[tier];
}

/** A tier's name (the draft's `boon.rarity.<tier>`: "Common" / "Rare" / "Legendary"; `tier`: VaultTier, 0..2). */
export function treasureTierNameKey(tier: number): string {
	return `boon.rarity.${TREASURE_TIERS[tier]}`;
}

/** A lock's name on the plate and in the lines (`treasure.lock.<lock>`; `lock`: VaultLock, 0..1). */
export function treasureLockNameKey(lock: number): string {
	return `treasure.lock.${TREASURE_LOCKS[lock]}`;
}

/**
 * The treasure sounds (port audio IDs, SILENT in the placeholder), in PORT_AUDIO_EVENTS: the lock cracks (a metal
 * snap), the cage unlocks (a rattle), the chest opens (the sting, pitched by tier), a Legendary's jingle (it ducks the
 * music). Until uploaded they fall back (shared/view/audio SFX_FALLBACK) to `sfx.combo.break` / `sfx.stairwell.open`
 * / `sfx.relic.take` / `sfx.room.perfect`.
 */
export const TREASURE_AUDIO_IDS: ReadonlyArray<string> = [
	"sfx.treasure.crack",
	"sfx.treasure.unlock",
	"sfx.treasure.open",
	"sfx.jingle.treasure",
];

/**
 * Every treasure string a pack must define (REQUIRED_STRING_KEYS), in order:
 *   - the floor-reveal toast (`hud.toast.vault`) and the arm toasts: UNTOUCHED solo, UNTOUCHED in a party (`{hits}`,
 *     the party's allowance; a plan addition: "without a hit" is wrong for a party), SWIFT (`{time}`, the par as m:ss);
 *   - the two lock names (`treasure.lock.<lock>`, the plate's label and the lines' `{lock}`);
 *   - the unlock line of a kept lock: nothing to spare (`treasure.unlocked`, solo UNTOUCHED; a plan addition), time to
 *     spare (`treasure.spareTime`, `{seconds}` with one decimal), hits to spare (`treasure.spareHits`, `{hits}`);
 *   - the open's kept line (`treasure.kept`, `{tier}` the tier's name) and the near-miss lines after a crack
 *     (`treasure.nearMiss.time` `{seconds}`, `treasure.nearMiss.hits` `{hits}`);
 *   - the reward cards: a relic (`{name}`), the bonus draft, boosts (`{count}`), the points (`{points}`; a plan
 *     addition: the card's number goes through a string like `room.clear.fly`).
 * The plan's check mark is spelled "kept": no other string uses a non-ASCII glyph beyond the middle dot, and the
 * fonts per script are not checked for it.
 */
export const TREASURE_STRING_KEYS: ReadonlyArray<string> = [
	"hud.toast.vault",
	"hud.toast.vaultLock.untouched",
	"hud.toast.vaultLock.untouchedParty",
	"hud.toast.vaultLock.swift",
	"treasure.lock.untouched",
	"treasure.lock.swift",
	"treasure.unlocked",
	"treasure.spareTime",
	"treasure.spareHits",
	"treasure.kept",
	"treasure.nearMiss.time",
	"treasure.nearMiss.hits",
	"treasure.reward.relic",
	"treasure.reward.draft",
	"treasure.reward.boosts",
	"treasure.reward.points",
];

/**
 * The run-over breakdown's source row (`score.source.<name>`, shared/sim TREASURE_SCORE_SOURCE_NAMES `treasure`). Like
 * `score.source.pellets`, not in REQUIRED_STRING_KEYS: shared/view/hud SCORE_SOURCE_KEYS lists it and hud.spec.ts checks
 * it exists.
 */
export const TREASURE_SCORE_SOURCE_KEY = "score.source.treasure";

/**
 * Roblox port (docs/SILVER.md SV7): the theme's Silver keys: every string the in-run counter, the run-over rows, the
 * Armory, the main menu, the character screen's lock and the returning-player card need, the four sounds, the colour
 * role and the optional art (the counter's icon, the crate burst's coin sprite). Pure data with no runtime import,
 * like secrets.ts: contract.ts and validate.ts sit near Luau's 200-locals-per-function limit, so contract.ts spreads
 * SILVER_STRING_KEYS inside REQUIRED_STRING_KEYS' function (one import, no other top-level local) and names the sounds
 * inline in PORT_AUDIO_EVENTS and the effect inline in FX_IDS; silver.spec.ts checks they agree. The colour rule and
 * `silverReport` are in silverColors.ts, folded into variantColors.ts' problems (validate.ts takes no new name).
 *
 * The string keys are built inside a function (silverStringKeys) so this module adds one top-level local to the
 * compiled Luau of any module that spreads it.
 *
 * @module
 */

import type { ColorRole } from "./types";

/** The in-run counter's `+N` (a room clear's +2, a floor, a boss ...) and a broken piece's `+N` pop. */
export const SILVER_POP_KEY = "silver.pop";

/** The run-over recap's Silver rows (docs/SILVER.md "Earning": "Run over"). */
export const SILVER_RECAP_KEYS = {
	/** `Silver +{silver}`: the run amount (the rows' sum), counting up. */
	run: "silver.recap.run",
	/** `Prospector +{silver}`: the upgrade's share of the run amount (SVD11 / SVD27: shown exactly). */
	prospector: "silver.recap.prospector",
	/** `Topped up to {silver}`: a short run that cleared two rooms (the minimum). */
	topUp: "silver.recap.topUp",
	/** `First run today +{silver}`. */
	firstRun: "silver.recap.firstRun",
	/** `Daily bonus +{silver}`. */
	daily: "silver.recap.daily",
	/** `Bonuses +{silver}`: the compact panel's one row for the top-up and both day bonuses (and Prospector). */
	bonuses: "silver.recap.bonuses",
	/** `Total {silver}`: the balance after the grant. */
	total: "silver.recap.total",
	/** `{item}: {silver} to go` (the next goal, nextGoals). */
	toGo: "silver.recap.toGo",
	/** `{item}: ready to buy` (the next goal is affordable now). */
	ready: "silver.recap.ready",
	/** `No Silver: unranked run` (an unranked, rejected or non-paying run). */
	none: "silver.recap.none",
} as const;

/** The Armory items' names and descriptions, by catalogue id (shared/wallet ARMORY_CATALOG; append with it). */
export const ARMORY_ITEM_IDS: ReadonlyArray<string> = [
	"vigor",
	"deepFlask",
	"plating",
	"prospector",
	"character.archer",
];

/** `armory.item.<id>`: an Armory item's name (`Vigor`, `The Archer`). */
export function armoryItemNameKey(itemId: string): string {
	return `armory.item.${itemId}`;
}

/** `armory.desc.<id>`: an Armory item's one-line description (`+{percent} %` for Prospector). */
export function armoryItemDescKey(itemId: string): string {
	return `armory.desc.${itemId}`;
}

/** The Armory screen's strings. */
export const ARMORY_KEYS = {
	title: "armory.title",
	/** `Silver {silver}`: the balance (the screen's header, the main menu, the character screen). */
	balance: "armory.balance",
	tabUpgrades: "armory.tab.upgrades",
	tabUnlocks: "armory.tab.unlocks",
	tabCosmetics: "armory.tab.cosmetics",
	/** The greyed screen (and the main menu's button) when the wallet is not loaded this session. */
	unavailable: "armory.unavailable",
	unavailableBody: "armory.unavailable.body",
	/** `{name} {level}`: an item at a level, the level in Roman numerals (`Vigor II`). */
	itemLevel: "armory.item.level",
	/** `Tier {tier}`. */
	tier: "armory.tier",
	/** `{silver} to go`. */
	toGo: "armory.toGo",
	/** The next affordable item's mark and the one after it (SVD24). */
	markNext: "armory.mark.next",
	markAfter: "armory.mark.after",
	owned: "armory.owned",
	maxed: "armory.maxed",
	/** `Level {level}/{max}`. */
	levels: "armory.levels",
	/** The buy button: `Hold to buy` (0.4 s), `Buying...` while the server answers. */
	hold: "armory.hold",
	buying: "armory.buying",
	/** Tier 6+ asks once: `Spend {price} Silver?`, Buy / Cancel. */
	confirm: "armory.confirm",
	confirmYes: "armory.confirm.yes",
	confirmNo: "armory.confirm.no",
	/** The server's answer: `Bought {item}`, `Not enough Silver`, `Purchase failed, try again`. */
	bought: "armory.result.bought",
	poor: "armory.result.poor",
	failed: "armory.result.failed",
	/** SVD9: a purchase applies from the next run. */
	nextRun: "armory.nextRun",
	/** Per-character effect lines (SVD11): `{label} {from} -> {to}`, `{label} {now}` at the top level. */
	effectChange: "armory.effect.change",
	effectNow: "armory.effect.now",
	/** Labels of the effect lines that are not a character's hearts. */
	labelFlask: "armory.label.flask",
	labelArmor: "armory.label.armor",
	labelSilver: "armory.label.silver",
	/** Values: `{n}` hearts, `{n} 1/2`, a lone `1/2`, `+{n} %`. */
	heartsWhole: "armory.value.hearts",
	heartsHalf: "armory.value.heartsHalf",
	heartHalfOnly: "armory.value.heartHalf",
	percent: "armory.value.percent",
	/** The main menu: the button, `First run today: +{silver}` under the balance until claimed. */
	menu: "menu.armory",
	firstRunOpen: "menu.firstRunBonus",
} as const;

/** The character screen's lock (docs/SILVER.md SV18) and the upgrades line under each card. */
export const CHARACTER_LOCK_KEYS = {
	/** `Unlock {price}`: the locked card's buy button. */
	unlock: "character.locked.unlock",
	/** `Need {silver} more`: too poor. */
	need: "character.locked.need",
	/** The wallet is not loaded: only the Knight is offered. */
	unavailable: "character.unavailable",
	/** `Upgrades: {list}` (item levels joined by `·`), or `No upgrades yet`. */
	upgrades: "character.upgrades",
	noUpgrades: "character.upgrades.none",
} as const;

/** The one-time main-menu card for accounts that played before the update (OC12). */
export const SILVER_WELCOME_KEYS = {
	title: "silver.welcome.title",
	body: "silver.welcome.body",
	ok: "silver.welcome.ok",
} as const;

/** Every Silver string a pack must define (REQUIRED_STRING_KEYS, its last ones after the secret rooms'), in order. */
export function silverStringKeys(): string[] {
	const out: string[] = [SILVER_POP_KEY];
	for (const [, k] of pairs(SILVER_RECAP_KEYS)) out.push(k);
	for (const id of ARMORY_ITEM_IDS) out.push(armoryItemNameKey(id));
	for (const id of ARMORY_ITEM_IDS) out.push(armoryItemDescKey(id));
	for (const [, k] of pairs(ARMORY_KEYS)) out.push(k);
	for (const [, k] of pairs(CHARACTER_LOCK_KEYS)) out.push(k);
	for (const [, k] of pairs(SILVER_WELCOME_KEYS)) out.push(k);
	out.sort();
	return out;
}

/** SILVER_STRING_KEYS, sorted (a stable order: a key table's pairs order is not). */
export const SILVER_STRING_KEYS: ReadonlyArray<string> = silverStringKeys();

/** The counter ticks (a room clear, a floor, a boss ...): a soft clink (falls back to sfx.score.tick while silent). */
export const SILVER_GAIN_SOUND = "sfx.silver.gain";
/** A Silver piece broken: the coin clink, climbing for quick breaks (falls back to sfx.breakable.loot). */
export const SILVER_CRATE_SOUND = "sfx.silver.crate";
/** An Armory purchase lands (falls back to sfx.relic.take). */
export const SHOP_BUY_SOUND = "sfx.shop.buy";
/** A purchase refused (falls back to sfx.ui.back). */
export const SHOP_DENY_SOUND = "sfx.shop.deny";

/**
 * The Silver sounds (port audio IDs, SILENT in the placeholder and in vale until clips are picked), in
 * PORT_AUDIO_EVENTS after the secret rooms' three: gain, crate, buy, deny. Until uploaded they fall back (shared/view
 * audio SFX_FALLBACK, one step) to sfx.score.tick / sfx.breakable.loot / sfx.relic.take / sfx.ui.back.
 */
export const SILVER_AUDIO_IDS: ReadonlyArray<string> = [
	SILVER_GAIN_SOUND,
	SILVER_CRATE_SOUND,
	SHOP_BUY_SOUND,
	SHOP_DENY_SOUND,
];

/**
 * Silver's colour role: the counter's number, its `+N`, the pops, the coins' tint and the Armory's prices. A cool
 * silver, held by silverColors.ts SILVER_COLOR_RULES: text-readable on `uiPanel`, >= 40 CIE76 from every danger role
 * (the pops rise among bullets) and from the score's golds (`newBest`, `golden.coin`, `uiAccent`), so Silver never
 * reads as score.
 */
export const SILVER_ROLE: ColorRole = "silver";
export const SILVER_ROLES: ReadonlyArray<ColorRole> = [SILVER_ROLE];

/**
 * The counter's icon (optional free-form ui id, like `ui.icon.coin`): a silver coin with its own shape (not the
 * score's gold coin). Absent: the view draws its fallback (a round silver chip with a dark rim).
 */
export const SILVER_ICON_ID = "ui.icon.silver";

/**
 * The crate burst's coin (an optional sprite effect in FX_IDS, like every `fx.*`): a short greyscale spin tinted by
 * SILVER_ROLE. Absent: the view draws each coin as a small silver disc.
 */
export const SILVER_COINS_FX_ID = "fx.silver.coins";

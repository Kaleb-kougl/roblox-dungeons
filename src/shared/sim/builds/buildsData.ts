/**
 * Builds data (docs/BUILDS.md BU1; a Roblox-port feature, no web source): duo boons, draft card ids, the offer
 * percents and the proc engine's budgets. Data and pure decoders only: ./builds.ts (state, hash), ./cards.ts (offers,
 * grants) and the rules read these, nothing is inline in the logic. The boons themselves, their levels and the per-level
 * tables are in progression/progressionData.ts; the effect bullets' BurstSpecs in ./effectsData.ts.
 *
 * Index tables (DUOS, BUILD_EFFECTS) are APPEND ONLY: their indices are stored in the sim state (and bullet payloads)
 * and hashed.
 *
 * @module
 */
import { BOONS, Boon, Rarity, type RarityId } from "../progression/progressionData";

// --- Duo boons (BUD7: both boons on the same player) ---------------------------------------------------

/** Duo indices (state and hash). Append only. */
export const Duo = {
	FIRE_ARROWS: 0,
	BLAZING_TRAIL: 1,
	STORM_BLADE: 2,
	CONDUCTOR: 3,
	SHRAPNEL: 4,
	CHAIN_REACTION: 5,
	CLOSE_CALL: 6,
	GOLD_RUSH: 7,
	UNSHAKEN: 8,
	// Legendary duos (docs/LEGENDARIES.md "Duos", LG1 data; rules LG4).
	SUPERNOVA: 9,
	SKEWER: 10,
	CITADEL: 11,
	STONE_HEART: 12,
	// Builds v2, wave 1 (docs/BUILDS_V2.md "Duos", BV1 data; rules BV6 / BV7).
	THUNDER_GUARD: 13,
	STILLWATER: 14,
	REBUKE: 15,
	DRAGON_BOLT: 16,
	POWDER_KEG: 17,
	FULL_HEART: 18,
	HAPPY_HOUR: 19,
} as const;
/** A Duo index (0 .. DUO_COUNT - 1): the value stored in `BuildPlayerState.duos` and hashed. */
export type DuoId = (typeof Duo)[keyof typeof Duo];

/**
 * One duo boon's row in DUOS: its theme id and the pair of boons that unlocks it (BUD7: both owned by the same player).
 */
export interface DuoDef {
	/** Theme string keys: `<id>.name`, `<id>.desc`, `<id>.icon`. */
	readonly id: string;
	/** The two boons (Boon indices) a player must own, at any level. */
	readonly a: number;
	/** The second required boon (Boon index), owned at any level. */
	readonly b: number;
}

/**
 * Every duo, by Duo index (docs/BUILDS.md "Duo boons"; 9-12 docs/LEGENDARIES.md "Duos"; 13-19 docs/BUILDS_V2.md
 * "Duos": card ids 77-83).
 */
export const DUOS: ReadonlyArray<DuoDef> = [
	{ id: "duo.fireArrows", a: Boon.EMBER_WAKE, b: Boon.PIERCING_ARROWS },
	{ id: "duo.blazingTrail", a: Boon.EMBER_WAKE, b: Boon.SLIPPERY },
	{ id: "duo.stormBlade", a: Boon.CHAIN_SPARK, b: Boon.SWIFT_STRIKES },
	{ id: "duo.conductor", a: Boon.CHAIN_SPARK, b: Boon.PIERCING_ARROWS },
	{ id: "duo.shrapnel", a: Boon.VOLATILE, b: Boon.SHARPENED },
	{ id: "duo.chainReaction", a: Boon.VOLATILE, b: Boon.CHAIN_SPARK },
	{ id: "duo.closeCall", a: Boon.SOUL_SHARDS, b: Boon.DAREDEVIL },
	{ id: "duo.goldRush", a: Boon.BOUNTY, b: Boon.LINGERING },
	{ id: "duo.unshaken", a: Boon.COMPOSURE, b: Boon.WARDING },
	{ id: "duo.supernova", a: Boon.OVERKILL, b: Boon.VOLATILE },
	{ id: "duo.skewer", a: Boon.OVERKILL, b: Boon.PIERCING_ARROWS },
	{ id: "duo.citadel", a: Boon.BASTION, b: Boon.WARDING },
	{ id: "duo.stoneHeart", a: Boon.BASTION, b: Boon.HEARTY },
	{ id: "duo.thunderGuard", a: Boon.RIPOSTE, b: Boon.CHAIN_SPARK },
	{ id: "duo.stillwater", a: Boon.COMPOSURE, b: Boon.RIPOSTE },
	{ id: "duo.rebuke", a: Boon.BASTION, b: Boon.RIPOSTE },
	{ id: "duo.dragonBolt", a: Boon.BALLISTA, b: Boon.EMBER_WAKE },
	{ id: "duo.powderKeg", a: Boon.WRECKER, b: Boon.VOLATILE },
	{ id: "duo.fullHeart", a: Boon.HEARTY, b: Boon.SHARPENED },
	{ id: "duo.happyHour", a: Boon.DEEP_FLASK, b: Boon.BOUNTY },
];
/** How many duos exist; a valid Duo index is 0 .. DUO_COUNT - 1 (cardDuo rejects anything else). */
export const DUO_COUNT = DUOS.size();

/** A duo card's rarity look (the draft reveal's legendary beat; BU9 gives it its own `boon.duo` frame). */
export const DUO_RARITY: RarityId = Rarity.LEGENDARY;

// --- Draft cards -----------------------------------------------------------------------------------------

/**
 * A draft card id (RunPlayerState.draftOffers, hashed in the "run" group): 0 .. BOON_COUNT - 1 = a boon (New, Upgrade
 * or Evolution follow from the player's current level), DUO_CARD_BASE + duo index = a duo. Boon indices stay far below
 * the base, so appending boons never moves a duo card id.
 */
export const DUO_CARD_BASE = 64;

/** What picking a card does for the player it is offered to (cardKind in ./builds.ts). */
export const CardKind = {
	/** An unowned boon: level I. */
	NEW: 0,
	/** An owned common / rare boon at level I: level II. */
	UPGRADE: 1,
	/** An owned common / rare boon at level II: level III, the evolution. */
	EVOLUTION: 2,
	/** A duo whose two boons the player owns. */
	DUO: 3,
} as const;
/** A CardKind value (0..3): what picking a draft card does for the player it is offered to. */
export type CardKindId = (typeof CardKind)[keyof typeof CardKind];

/** The card id of boon `boon`. */
export function boonCard(boon: number): number {
	return boon;
}

/** The card id of duo `duo`. */
export function duoCard(duo: number): number {
	return DUO_CARD_BASE + duo;
}

/** The boon a card id names, or -1 (a duo card or no card). */
export function cardBoon(card: number): number {
	return card >= 0 && card < BOONS.size() && card % 1 === 0 ? card : -1;
}

/** The duo a card id names, or -1 (a boon card or no card). */
export function cardDuo(card: number): number {
	const d = card - DUO_CARD_BASE;
	return d >= 0 && d < DUO_COUNT && d % 1 === 0 ? d : -1;
}

/** A card's display identity (theme id and rarity look), for the HUD; undefined for no card. */
export interface CardDisplay {
	/** Theme string id (`boon.volatile`, `duo.fireArrows`): `<id>.name`, `<id>.desc`, `<id>.icon`. */
	readonly id: string;
	/** The rarity look the card is drawn with: the boon's own rarity, or DUO_RARITY for a duo card. */
	readonly rarity: RarityId;
}

/** The boon's row (a boon card) or the duo's id with DUO_RARITY (a duo card); undefined for anything else. */
export function cardDisplay(card: number): CardDisplay | undefined {
	const b = cardBoon(card);
	if (b >= 0) return BOONS[b];
	const d = cardDuo(card);
	if (d >= 0) return { id: DUOS[d].id, rarity: DUO_RARITY };
	return undefined;
}

// --- Offers (drawCardOffers, ./cards.ts; starting numbers, tuned in BU13) ---------------------------------

/** Every builds number a run reads, as one object (SimConfig.builds = BUILDS_CONFIG, ./builds.ts). */
export interface BuildRules {
	/** Percent band of the type roll for an upgrade card (after the duo band). */
	readonly upgradePercent: number;
	/** An evolution (an owned boon at level II) weighs this much against an upgrade (level I) in the upgrade pick. */
	readonly evolutionWeight: number;
	/** The duo band: duoPercentBase + duoPercentPerFloor x floors cleared, at most duoPercentMax (BUD3). */
	readonly duoPercentBase: number;
	/** Percentage points added to the duo band per floor cleared (0 floors or fewer add nothing). */
	readonly duoPercentPerFloor: number;
	/** The duo band's ceiling, in percent. */
	readonly duoPercentMax: number;
	/** Upgrade pity: with an upgradable boon owned and no upgrade among the first this many cards, the last card is redrawn. */
	readonly upgradePityCards: number;
	/** Drafts dealt after a boss floor (BUD4: pick, re-deal, pick), and after any other floor. */
	readonly bossFloorDrafts: number;
	/** Drafts dealt after a floor that is not a boss floor (the starting `draftsLeft`). */
	readonly floorDrafts: number;
	/** BUD5: a proc of this generation or higher does nothing. */
	readonly genMax: number;
	/** Procs resolved per tick, oldest first; the rest wait (never dropped but on a floor change). */
	readonly procsPerTick: number;
	/** Effect bullets alive per player (of the PLAYER_BULLET_CAPACITY slots); a burst fires only what fits. */
	readonly effectBulletsMax: number;
	/**
	 * Player bullet slots kept free of effects per player in the party (BU3): an effect bullet only spawns while the
	 * pool holds at most capacity - effectWeaponReserve x party size bullets, so the players' own fire (at most this
	 * many alive each: the bow's stream at its fastest plus an Ember Wake ring, procs.spec.ts) always finds a slot.
	 */
	readonly effectWeaponReserve: number;
}

/** The game's builds rules (docs/BUILDS.md "Offers", "Chain reactions"). */
export const BUILD_RULES: BuildRules = table.freeze({
	upgradePercent: 35,
	evolutionWeight: 2,
	duoPercentBase: 20,
	duoPercentPerFloor: 2,
	duoPercentMax: 40,
	upgradePityCards: 3,
	bossFloorDrafts: 2,
	floorDrafts: 1,
	genMax: 3,
	procsPerTick: 24,
	effectBulletsMax: 160,
	effectWeaponReserve: 32,
});

// --- Effect bullets' payload source (docs/BUILDS.md "Chain reactions") -------------------------------------

/**
 * Player bullet payload `source` values from here up are build effects: BUILD_SOURCE_BASE + effect x
 * BUILD_SOURCE_GENS + gen (effects 0..31, gen 0..3, so 128..255 fits the 8-bit field). Weapon sources stay 1..127.
 */
export const BUILD_SOURCE_BASE = 128;
/** Generations a source can carry (gen 0 .. BUILD_SOURCE_GENS - 1; GEN_MAX's procs never fire, so 0..2 are used). */
export const BUILD_SOURCE_GENS = 4;
/** Effects a source can name. */
export const BUILD_SOURCE_EFFECTS = 32;

/** Build effects that fire bullets (the payload source's effect index). Append only. */
export const BuildEffect = {
	VOLATILE: 0,
	SOUL_SHARDS: 1,
	EMBER: 2,
	FLURRY: 3,
	THRILL_SEEKER: 4,
	RICOCHET: 5,
	MOMENTUM: 6,
	CLOSE_CALL: 7,
	/** Soul Swarm (Soul Shards III): its shards steer (BU5), told apart from straight shards by this source. */
	SOUL_SWARM: 8,
	/** Ballista's bolts (docs/BUILDS_V2.md BV1; the rule is BV3): the last-pierce ring, the wall's back fan. */
	BALLISTA: 9,
	/** Wrecker's splinters (BV1; BV5). */
	WRECKER: 10,
	/** Counterstrike's returns (Riposte III; BV1; BV2). The wave itself is no bullet (BVD1). */
	RIPOSTE: 11,
} as const;
/**
 * A BuildEffect index (0 .. BUILD_SOURCE_EFFECTS - 1): the effect part of an effect bullet's payload source
 * (buildSource).
 */
export type BuildEffectId = (typeof BuildEffect)[keyof typeof BuildEffect];

/** The payload source of effect `effect` at generation `gen`. */
export function buildSource(effect: number, gen: number): number {
	return BUILD_SOURCE_BASE + effect * BUILD_SOURCE_GENS + gen;
}

/** True for a build effect's source (a weapon's source is below BUILD_SOURCE_BASE). */
export function isBuildSource(source: number): boolean {
	return source >= BUILD_SOURCE_BASE && source < BUILD_SOURCE_BASE + BUILD_SOURCE_EFFECTS * BUILD_SOURCE_GENS;
}

/** The effect index of a build source (-1 for a weapon source). */
export function sourceEffect(source: number): number {
	if (!isBuildSource(source)) return -1;
	const k = source - BUILD_SOURCE_BASE;
	return (k - (k % BUILD_SOURCE_GENS)) / BUILD_SOURCE_GENS;
}

/** The generation of a build source (0 for a weapon source: the player's own shot). */
export function sourceGen(source: number): number {
	if (!isBuildSource(source)) return 0;
	return (source - BUILD_SOURCE_BASE) % BUILD_SOURCE_GENS;
}

/**
 * The generation of the proc a kill by a player bullet with payload `source` makes (ctx.procGen, BU3): 0 for a weapon's
 * bullet (the player's own shot, a reflected bullet, an Ember Wake ring), gen + 1 for a build effect of generation gen.
 */
export function killGenOfSource(source: number): number {
	return isBuildSource(source) ? sourceGen(source) + 1 : 0;
}

/**
 * What a queued BuildProc is (docs/BUILDS_V2.md "Wrecker", BV1; hashed as BuildProc.kind, appended). Append only.
 *   KILL   an enemy's death (BU3): x / z the corpse, slot / id the victim
 *   SMASH  a piece broken by an owner with Wrecker or Powder Keg (BV5): x / z the cell centre, slot / id -1
 * BV1: every proc is a KILL; nothing queues a SMASH yet.
 */
export const ProcKind = {
	KILL: 0,
	SMASH: 1,
} as const;
/** A ProcKind value (KILL / SMASH), stored and hashed as `BuildProc.kind`. */
export type ProcKindId = (typeof ProcKind)[keyof typeof ProcKind];

/** Archetype ids whose kills never proc (BU3), besides every reviving archetype (def.stepDead: turrets). */
export const PROC_INELIGIBLE_ARCHETYPES: ReadonlyArray<string> = ["dummy"];

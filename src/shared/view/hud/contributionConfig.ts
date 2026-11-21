/**
 * The co-op contribution card's tunables, title table and string keys (docs/RUN_CONTRIBUTION.md CT3; logic in
 * contribution.ts). Presentation only: nothing here reaches the sim, a hash or the leaderboard. Title thresholds are
 * CT10's tuning levers.
 *
 * @module
 */

/** A player's one positive title (assignTitles). `teammate` is the fallback, never assigned by a lead. */
export type ContribTitle =
	| "heavyHitter"
	| "bossBreaker"
	| "finisher"
	| "guardian"
	| "daredevil"
	| "untouchable"
	| "lastStand"
	| "collector"
	| "teammate";

/** A You-card cell (the highlight grid's cell, in CONTRIB.cellOrder). */
export type ContribCellKind = "damage" | "kills" | "bossDamage" | "parries" | "grazes" | "hits" | "pickups";

/** The contribution views' tunables (`CONTRIB`; `contributionOf` takes another one in specs). */
export interface ContribConfig {
	/** The party size from which a run gets the contribution views (the tab strip). */
	readonly minPartySize: number;
	/** What the shares sum to (whole percent). */
	readonly shareTotal: number;
	/** The You card's cells in the plan's order (a cell whose team total is 0 is dropped). */
	readonly cellOrder: ReadonlyArray<ContribCellKind>;
}

/**
 * The contribution views' tunables as shipped: party runs from 2 players, shares in whole percent summing to 100, and
 * the You card's seven cells in the plan's order.
 */
export const CONTRIB: ContribConfig = {
	minPartySize: 2,
	shareTotal: 100,
	cellOrder: ["damage", "kills", "bossDamage", "parries", "grazes", "hits", "pickups"],
};

/**
 * Every title's "Needs" (docs/RUN_CONTRIBUTION.md Titles). A player must LEAD the stat (strictly; Untouchable: the
 * strict fewest) and pass the rule:
 *   - `min`: the leader's value >= min.
 *   - `above`: the leader's value > above.
 *   - `evenSharePercent`: the leader's share of the team total >= this percent of an even share (100 / party size).
 *   - `minPartyHits`: the party took at least this many hits (Untouchable).
 *   - `minStandPercent`: only players who stood at least this percent of the run (death tick, or the run's last tick
 *     alive, over the last tick) and never left can lead it (Untouchable: an early death or a leaver takes few hits).
 *   - `fullLeadSec`: the score is the lead in seconds over this, capped at 1 (Last Stand: a lead in death ticks is
 *     tiny relative to the tick itself, so the relative lead every other title uses would rarely let it win).
 * Last Stand needs nothing (always one, docs/RUN_CONTRIBUTION.md); Teammate is the fallback.
 */
export interface ContribTitleRule {
	readonly min?: number;
	readonly above?: number;
	readonly evenSharePercent?: number;
	readonly minPartyHits?: number;
	readonly minStandPercent?: number;
	readonly fullLeadSec?: number;
}

/**
 * A title a player earns by leading a stat: every `ContribTitle` but the fallback `teammate`. The keys of
 * `CONTRIB_TITLES`.
 */
export type ContribLeadTitle = Exclude<ContribTitle, "teammate">;

/**
 * Each title's rule (the fields are `ContribTitleRule`'s), read by `assignTitles` for the stat's strict leader: Heavy
 * Hitter leads damage with at least 120 % of an even share, Boss Breaker any boss damage, Finisher 10 kills, Guardian 5
 * parries, Daredevil 30 grazes, Untouchable the fewest hits when the party took at least 3 and the player stood 75 % of
 * the run, Last Stand a lead of 60 s for the full score, Collector 10 pickups. The thresholds are CT10's tuning levers.
 */
export const CONTRIB_TITLES: Readonly<Record<ContribLeadTitle, ContribTitleRule>> = {
	heavyHitter: { evenSharePercent: 120 },
	bossBreaker: { above: 0 },
	finisher: { min: 10 },
	guardian: { min: 5 },
	daredevil: { min: 30 },
	untouchable: { minPartyHits: 3, minStandPercent: 75 },
	lastStand: { fullLeadSec: 60 },
	collector: { min: 10 },
};

/** The titles in table order: the assignment's tie break (an equal score goes to the earlier title). */
export const CONTRIB_TITLE_ORDER: ReadonlyArray<ContribLeadTitle> = [
	"heavyHitter",
	"bossBreaker",
	"finisher",
	"guardian",
	"daredevil",
	"untouchable",
	"lastStand",
	"collector",
];

/** The fallback title (anyone left without a lead). */
export const CONTRIB_FALLBACK_TITLE: ContribTitle = "teammate";

/**
 * Every contribution string key (the theme contract's CONTRIB_STRING_KEYS, docs/RUN_CONTRIBUTION.md CT4; plain strings
 * here). Variables in braces; numbers are passed as numbers unless noted.
 */
export const CONTRIB_STRINGS = {
	/** "You" (the tab strip) */
	tabYou: "run.recap.tab.you",
	/** "Team" */
	tabTeam: "run.recap.tab.team",
	/** "Party" */
	tabParty: "run.recap.tab.party",
	/** "You · {title}" ({title}: the title's display string) */
	youHeader: "run.recap.you.header",
	/** "{pct}% of the team's damage" */
	youShareBar: "run.recap.you.shareBar",
	youDamage: "run.recap.you.damage",
	youKills: "run.recap.you.kills",
	youBossDamage: "run.recap.you.bossDamage",
	youParries: "run.recap.you.parries",
	youGrazes: "run.recap.you.grazes",
	youHits: "run.recap.you.hits",
	youPickups: "run.recap.you.pickups",
	/** "{value} · {pct}%" ({value}: the formatted number) */
	youShare: "run.recap.you.share",
	/** "{boosts} · {pellets}" (both strings: youBoosts / youBoostOne and youPellets / youPelletOne) */
	youPickupsValue: "run.recap.you.pickupsValue",
	/** "{n} boosts" */
	youBoosts: "run.recap.you.boosts",
	/** "1 boost" */
	youBoostOne: "run.recap.you.boostOne",
	/** "{n} pellets" */
	youPellets: "run.recap.you.pellets",
	/** "1 pellet" */
	youPelletOne: "run.recap.you.pelletOne",
	/** "Last to fall · floor {floor} · {time}" ({time}: m:ss, a string) */
	lastToFall: "run.recap.you.lastToFall",
	/** "Stood to the end · {time}" */
	stood: "run.recap.you.stood",
	/** "Fell on floor {floor} · {time}" */
	fell: "run.recap.you.fell",
	/** "Left on floor {floor}" */
	left: "run.recap.you.left",
	/** The Party tab's header row */
	partyDamage: "run.recap.party.damage",
	partyKills: "run.recap.party.kills",
	partyParries: "run.recap.party.parries",
	partyHits: "run.recap.party.hits",
	/** "{pct}%" (the Party tab's damage share column, CT5) */
	partyShare: "run.recap.party.share",
} as const;

/** The title's display string key (`run.recap.title.<title>`). */
export function contribTitleKey(t: ContribTitle): string {
	return `run.recap.title.${t}`;
}

/** The title's one-line description key (`run.recap.titleDesc.<title>`). */
export function contribTitleDescKey(t: ContribTitle): string {
	return `run.recap.titleDesc.${t}`;
}

/** Every title, the fallback last (the string list's order). */
export function contribTitles(): ContribTitle[] {
	const out: ContribTitle[] = [...CONTRIB_TITLE_ORDER];
	out.push(CONTRIB_FALLBACK_TITLE);
	return out;
}

/** Every contribution string key: CONTRIB_STRINGS (sorted), then every title's name and description in title order. */
export function contribStringKeys(): string[] {
	const out: string[] = [];
	for (const [, key] of pairs(CONTRIB_STRINGS as unknown as ReadonlyMap<string, string>)) out.push(key);
	out.sort();
	for (const t of contribTitles()) out.push(contribTitleKey(t));
	for (const t of contribTitles()) out.push(contribTitleDescKey(t));
	return out;
}

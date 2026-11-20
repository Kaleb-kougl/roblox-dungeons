/**
 * The co-op contribution core (docs/RUN_CONTRIBUTION.md CT3): what each player did for the team, from the run's
 * RecapTally (shared/view/fx, CT2). Pure and deterministic: every client steps the same merged log, so every client
 * derives the same rows, shares and titles from its own tally (CTD7). Presentation only. Tunables, the title table and
 * the string keys: contributionConfig.ts.
 *
 *   - `contributionOf`        party runs only (partySize >= CONTRIB.minPartySize; solo: undefined). Rows in index
 *                             order, never sorted (CTD4); a leaver keeps their row and their numbers stay in the team
 *                             totals. Kills are scored kills (pops), damage the hp removed (RecapTally).
 *   - `largestRemainderShares` whole percents summing to CONTRIB.shareTotal: each value's floor share, then the points
 *                             left go one each to the largest remainders (ties: the lower index). A team total of 0
 *                             (or less) gives all zeros.
 *   - Standing                in a wipe the last death (tally.lastDeath, else the latest deathTick, lower index on a
 *                             tie) is `lastToFall` (its floor and death time); a player with a death is `fell`; a player
 *                             who left without dying is `left` (the floor they left on; seconds 0: the tally keeps no
 *                             leave tick); anyone else `stood` (the run's length, tally.lastTick). A wipe is
 *                             `endedInWipe`, by default every player who has not left has a death. Seconds are whole
 *                             seconds of sim time (ticks / SIM_HZ, floored).
 *   - `assignTitles`          one title per player. For each title the stat's strict leader (Untouchable: the strict
 *                             fewest hits among players who never left and stood minStandPercent of the run; Last
 *                             Stand: the last to fall in a wipe, else the strict longest standing), if they pass the
 *                             title's rule (CONTRIB_TITLES), is a candidate with score = the relative lead over the
 *                             next player, (lead - next) / max(lead, 1) (Untouchable: (next - lead) / max(next, 1); Last
 *                             Stand: the lead in seconds / fullLeadSec, capped at 1), in [0, 1]. Greedy: the largest score takes its title, its player and title
 *                             leave the pool, repeat (ties: CONTRIB_TITLE_ORDER, then the lower index). A player left
 *                             without a title is a Teammate. Titles are distinct except Teammate.
 *   - `youCells`              the You card's cells in CONTRIB.cellOrder; a cell whose team total is 0 is dropped (no
 *                             boss damaged: no Boss dmg; no pellets and no boosts: no Pickups; pickups' `boosts` /
 *                             `pellets` are undefined when that part's team total is 0).
 *
 * @module
 */
import { SIM_HZ } from "shared/sim";
import { RECAP_ALIVE_TICK, RECAP_NO_FLOOR, RECAP_NO_PLAYER, type RecapTallySource } from "shared/view/fx";
import {
	CONTRIB,
	CONTRIB_FALLBACK_TITLE,
	CONTRIB_STRINGS,
	CONTRIB_TITLE_ORDER,
	CONTRIB_TITLES,
	type ContribCellKind,
	type ContribConfig,
	type ContribLeadTitle,
	type ContribTitle,
	type ContribTitleRule,
} from "./contributionConfig";
import { formatClock } from "./layout";

// ---------------------------------------------------------------------------------------------------------------
// Types

export type ContribStandingKind = "lastToFall" | "stood" | "fell" | "left";

/** How a player's run ended. `floor`: the death / leave floor (stood: 0); `seconds`: whole seconds of sim time. */
export interface ContribStanding {
	readonly kind: ContribStandingKind;
	readonly floor: number;
	readonly seconds: number;
}

/** One player's line (the Party tab's row; the local player's is the You card). */
export interface ContributionRow {
	readonly index: number;
	/** Display name (names[index], "" when missing). */
	readonly name: string;
	/**
	 * The player's character id (characters[index]; docs/ARCHER.md AR9: the row's icon, characterIcon), undefined when
	 * the input has none for them.
	 */
	readonly character?: string;
	/** The local player's row. */
	readonly local: boolean;
	/** Left the run (tally.leftFloor set; the row is dim). */
	readonly left: boolean;
	readonly title: ContribTitle;
	readonly damage: number;
	/** Whole percent of the team's damage (largest remainder over the party). */
	readonly damageShare: number;
	readonly kills: number;
	readonly killShare: number;
	readonly bossDamage: number;
	readonly bossShare: number;
	readonly parries: number;
	readonly grazes: number;
	readonly hits: number;
	readonly pellets: number;
	readonly boosts: number;
	readonly standing: ContribStanding;
}

/** One You-card cell. `share` on damage / kills / boss damage; `boosts` / `pellets` on pickups (undefined: dropped). */
export interface ContribCell {
	readonly kind: ContribCellKind;
	readonly labelKey: string;
	/** The cell's number (pickups: boosts + pellets). */
	readonly value: number;
	readonly share?: number;
	readonly boosts?: number;
	readonly pellets?: number;
}

export interface RunContribution {
	/** Index order, never sorted. */
	readonly rows: ReadonlyArray<ContributionRow>;
	readonly local: ContributionRow;
	/** The You card's cells in CONTRIB.cellOrder, zero-total cells dropped. */
	readonly youCells: ReadonlyArray<ContribCell>;
	/** Per player, sums to CONTRIB.shareTotal (all 0 when the team dealt nothing): the share bar. */
	readonly damageShares: ReadonlyArray<number>;
	/** The run ended in a wipe (the input's, or derived). */
	readonly wipe: boolean;
}

export interface ContributionInput {
	readonly tally: RecapTallySource;
	readonly partySize: number;
	/** SimController.getLocalPlayerIndex() (CT1: never the view player). Out of range reads as 0. */
	readonly localIndex: number;
	/** Display names by index (RunContext.memberNames). */
	readonly names: ReadonlyArray<string>;
	/** Each player's character id by index (SimController.getPlayerCharacter; docs/ARCHER.md AR9); default none. */
	readonly characters?: ReadonlyArray<string | undefined>;
	/** The run ended in a party wipe; default: every player who has not left has a death. */
	readonly endedInWipe?: boolean;
}

/** One player's stats as the titles read them. */
export interface ContribStats {
	readonly damage: number;
	readonly kills: number;
	readonly bossDamage: number;
	readonly parries: number;
	readonly grazes: number;
	readonly hits: number;
	/** Pellets + boosts. */
	readonly pickups: number;
	/** Last Stand's stat: ticks standing (a death's tick; alive at run over: past every death; left alive: -1). */
	readonly stand: number;
	/** The wipe's last to fall (leads Last Stand outright, so a same-tick death cannot tie it). */
	readonly lastToFall?: boolean;
	/** Left the run (never leads Untouchable). */
	readonly left?: boolean;
	/** Ticks stood (the death tick, else the run's last tick) and the run's length: Untouchable's minStandPercent. */
	readonly stoodTicks?: number;
	readonly runTicks?: number;
}

// ---------------------------------------------------------------------------------------------------------------
// Shares

/** Whole percents (CONTRIB.shareTotal) by largest remainder, summing to the total; ties by lower index; zeros if none. */
export function largestRemainderShares(values: ReadonlyArray<number>, total: number = CONTRIB.shareTotal): number[] {
	const n = values.size();
	const out: number[] = [];
	let sum = 0;
	for (let i = 0; i < n; i++) sum += math.max(0, values[i]);
	if (sum <= 0) {
		for (let i = 0; i < n; i++) out.push(0);
		return out;
	}
	const rem: number[] = [];
	let given = 0;
	for (let i = 0; i < n; i++) {
		const scaled = math.max(0, values[i]) * total;
		const q = math.floor(scaled / sum);
		out.push(q);
		rem.push(scaled - q * sum);
		given += q;
	}
	let left = total - given;
	while (left > 0) {
		let best = -1;
		for (let i = 0; i < n; i++) {
			if (rem[i] < 0) continue;
			if (best < 0 || rem[i] > rem[best]) best = i;
		}
		if (best < 0) break;
		out[best] += 1;
		rem[best] = -1;
		left -= 1;
	}
	return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Standing

function at(list: ReadonlyArray<number>, i: number, fallback: number): number {
	return list[i] ?? fallback;
}

function deathOf(t: RecapTallySource, i: number): number {
	return at(t.deathTick, i, RECAP_ALIVE_TICK);
}

function hasLeftRun(t: RecapTallySource, i: number): boolean {
	return at(t.leftFloor, i, RECAP_NO_FLOOR) !== RECAP_NO_FLOOR;
}

/** Whole seconds of `ticks` sim ticks. */
export function contribSeconds(ticks: number): number {
	return math.floor(math.max(0, ticks) / SIM_HZ);
}

/** Every player who has not left has a death (and someone died). */
function derivedWipe(t: RecapTallySource, n: number): boolean {
	let anyDeath = false;
	for (let i = 0; i < n; i++) {
		if (deathOf(t, i) !== RECAP_ALIVE_TICK) anyDeath = true;
		else if (!hasLeftRun(t, i)) return false;
	}
	return anyDeath;
}

/** The wipe's last to fall: tally.lastDeath when it holds a death, else the latest deathTick (lower index). -1 none. */
function lastToFallOf(t: RecapTallySource, n: number): number {
	const ld = t.lastDeath;
	if (ld !== RECAP_NO_PLAYER && ld >= 0 && ld < n && deathOf(t, ld) !== RECAP_ALIVE_TICK) return ld;
	let best = -1;
	for (let i = 0; i < n; i++) {
		const d = deathOf(t, i);
		if (d === RECAP_ALIVE_TICK) continue;
		if (best < 0 || d > deathOf(t, best)) best = i;
	}
	return best;
}

function standingOf(t: RecapTallySource, i: number, lastToFall: number): ContribStanding {
	const death = deathOf(t, i);
	if (death !== RECAP_ALIVE_TICK) {
		const floor = at(t.deathFloor, i, RECAP_NO_FLOOR);
		return { kind: i === lastToFall ? "lastToFall" : "fell", floor, seconds: contribSeconds(death) };
	}
	if (hasLeftRun(t, i)) return { kind: "left", floor: at(t.leftFloor, i, RECAP_NO_FLOOR), seconds: 0 };
	return { kind: "stood", floor: RECAP_NO_FLOOR, seconds: contribSeconds(t.lastTick) };
}

/** The standing line's string key and variables: `floor` (number), `time` (m:ss, formatClock), `seconds` (number). */
export function contribStandingText(s: ContribStanding): {
	key: string;
	vars: Readonly<Record<string, string | number>>;
} {
	const vars = { floor: s.floor, time: formatClock(s.seconds), seconds: s.seconds };
	switch (s.kind) {
		case "lastToFall":
			return { key: CONTRIB_STRINGS.lastToFall, vars };
		case "stood":
			return { key: CONTRIB_STRINGS.stood, vars };
		case "fell":
			return { key: CONTRIB_STRINGS.fell, vars };
		case "left":
			return { key: CONTRIB_STRINGS.left, vars };
	}
}

// ---------------------------------------------------------------------------------------------------------------
// Titles

type StatOf = (s: ContribStats) => number;

function statFor(title: ContribLeadTitle): StatOf {
	switch (title) {
		case "heavyHitter":
			return (s) => s.damage;
		case "bossBreaker":
			return (s) => s.bossDamage;
		case "finisher":
			return (s) => s.kills;
		case "guardian":
			return (s) => s.parries;
		case "daredevil":
			return (s) => s.grazes;
		case "untouchable":
			return (s) => s.hits;
		case "lastStand":
			return (s) => s.stand;
		case "collector":
			return (s) => s.pickups;
	}
}

/** A title's candidate: its leader and score, or undefined (no strict leader, or the rule fails). */
interface TitleCandidate {
	readonly title: ContribLeadTitle;
	readonly order: number;
	readonly player: number;
	readonly score: number;
}

/** A stat's leader: their value and the best other value (the runner-up's). */
interface Lead {
	readonly player: number;
	readonly lead: number;
	readonly second: number;
}

/** The strict leader of `stat` (fewest: the strict minimum) and the next value, or undefined on a tie / empty. */
function leaderOf(
	stats: ReadonlyArray<ContribStats>,
	stat: StatOf,
	fewest: boolean,
	eligible: (s: ContribStats) => boolean = () => true,
): Lead | undefined {
	const n = stats.size();
	let best = -1;
	for (let i = 0; i < n; i++) {
		if (!eligible(stats[i])) continue;
		const v = stat(stats[i]);
		if (best < 0) best = i;
		else if (fewest ? v < stat(stats[best]) : v > stat(stats[best])) best = i;
	}
	if (best < 0) return undefined;
	const lead = stat(stats[best]);
	let second: number | undefined;
	for (let i = 0; i < n; i++) {
		if (i === best || !eligible(stats[i])) continue;
		const v = stat(stats[i]);
		if (v === lead) return undefined; // a tie for the lead: nobody leads
		if (second === undefined || (fewest ? v < second : v > second)) second = v;
	}
	// Fewest with nobody else (eligible) to compare: no lead (Untouchable is never the only one who stood).
	if (second === undefined && fewest) return undefined;
	// One player alone (never in a party): the lead over nothing.
	return { player: best, lead, second: second ?? (fewest ? lead : 0) };
}

function passes(rule: ContribTitleRule, lead: number, stats: ReadonlyArray<ContribStats>, stat: StatOf): boolean {
	if (rule.min !== undefined && !(lead >= rule.min)) return false;
	if (rule.above !== undefined && !(lead > rule.above)) return false;
	const n = stats.size();
	if (rule.evenSharePercent !== undefined || rule.minPartyHits !== undefined) {
		let total = 0;
		for (const s of stats) total += math.max(0, stat(s));
		if (rule.evenSharePercent !== undefined) {
			// lead / total >= (evenSharePercent / 100) x (1 / n), in integers where the stats are
			if (!(total > 0 && lead * n * CONTRIB.shareTotal >= rule.evenSharePercent * total)) return false;
		}
		if (rule.minPartyHits !== undefined && !(total >= rule.minPartyHits)) return false;
	}
	return true;
}

/** `rule.minStandPercent`: a player who never left and stood at least that share of the run (stats without the facts pass). */
function standsEnough(st: ContribStats, rule: ContribTitleRule): boolean {
	if (rule.minStandPercent === undefined) return true;
	if (st.left === true) return false;
	if (st.stoodTicks === undefined || st.runTicks === undefined || st.runTicks <= 0) return true;
	return st.stoodTicks * CONTRIB.shareTotal >= rule.minStandPercent * st.runTicks;
}

function candidateFor(
	title: ContribLeadTitle,
	order: number,
	stats: ReadonlyArray<ContribStats>,
	rules: Readonly<Record<ContribLeadTitle, ContribTitleRule>>,
): TitleCandidate | undefined {
	const stat = statFor(title);
	const fewest = title === "untouchable";
	let lead: Lead | undefined;
	if (title === "lastStand") {
		// The wipe's last to fall leads outright (a same-tick death would tie it); else the strict longest standing.
		let ltf = -1;
		for (let i = 0; i < stats.size(); i++) if (stats[i].lastToFall === true) ltf = i;
		if (ltf >= 0) {
			let second: number | undefined;
			for (let i = 0; i < stats.size(); i++) {
				if (i === ltf) continue;
				const v = stats[i].stand;
				if (second === undefined || v > second) second = v;
			}
			lead = { player: ltf, lead: stats[ltf].stand, second: math.min(second ?? 0, stats[ltf].stand) };
		} else lead = leaderOf(stats, stat, false);
	} else lead = leaderOf(stats, stat, fewest, (st) => standsEnough(st, rules[title]));
	if (lead === undefined) return undefined;
	const rule = rules[title];
	if (!passes(rule, lead.lead, stats, stat)) return undefined;
	let score: number;
	if (rule.fullLeadSec !== undefined) {
		// Last Stand: the lead in seconds over fullLeadSec, capped at 1 (the same 0..1 scale as the relative leads).
		score = math.clamp((lead.lead - lead.second) / math.max(rule.fullLeadSec * SIM_HZ, 1), 0, 1);
	} else if (fewest) score = (lead.second - lead.lead) / math.max(lead.second, 1);
	else score = (lead.lead - lead.second) / math.max(lead.lead, 1);
	return { title, order, player: lead.player, score };
}

/** One title per player, by index (see the file comment). */
export function assignTitles(
	stats: ReadonlyArray<ContribStats>,
	rules: Readonly<Record<ContribLeadTitle, ContribTitleRule>> = CONTRIB_TITLES,
): ContribTitle[] {
	const n = stats.size();
	const out: ContribTitle[] = [];
	for (let i = 0; i < n; i++) out.push(CONTRIB_FALLBACK_TITLE);
	const candidates: TitleCandidate[] = [];
	for (let k = 0; k < CONTRIB_TITLE_ORDER.size(); k++) {
		const c = candidateFor(CONTRIB_TITLE_ORDER[k], k, stats, rules);
		if (c !== undefined) candidates.push(c);
	}
	// A total order (each title has one candidate), so the sort is deterministic.
	candidates.sort((a, b) => {
		if (a.score !== b.score) return a.score > b.score;
		if (a.order !== b.order) return a.order < b.order;
		return a.player < b.player;
	});
	const taken: boolean[] = [];
	for (let i = 0; i < n; i++) taken.push(false);
	for (const c of candidates) {
		if (taken[c.player]) continue;
		taken[c.player] = true;
		out[c.player] = c.title;
	}
	return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The contribution

function cellLabel(kind: ContribCellKind): string {
	switch (kind) {
		case "damage":
			return CONTRIB_STRINGS.youDamage;
		case "kills":
			return CONTRIB_STRINGS.youKills;
		case "bossDamage":
			return CONTRIB_STRINGS.youBossDamage;
		case "parries":
			return CONTRIB_STRINGS.youParries;
		case "grazes":
			return CONTRIB_STRINGS.youGrazes;
		case "hits":
			return CONTRIB_STRINGS.youHits;
		case "pickups":
			return CONTRIB_STRINGS.youPickups;
	}
}

function perPlayer(list: ReadonlyArray<number>, n: number): number[] {
	const out: number[] = [];
	for (let i = 0; i < n; i++) out.push(list[i] ?? 0);
	return out;
}

/** The You card's cells for row `r` (CONTRIB.cellOrder, zero team totals dropped). */
function youCellsOf(r: ContributionRow, rows: ReadonlyArray<ContributionRow>, cfg: ContribConfig): ContribCell[] {
	const out: ContribCell[] = [];
	let boosts = 0;
	let pellets = 0;
	for (const row of rows) {
		boosts += row.boosts;
		pellets += row.pellets;
	}
	for (const kind of cfg.cellOrder) {
		const labelKey = cellLabel(kind);
		let team = 0;
		switch (kind) {
			case "damage":
				for (const row of rows) team += row.damage;
				if (team > 0) out.push({ kind, labelKey, value: r.damage, share: r.damageShare });
				break;
			case "kills":
				for (const row of rows) team += row.kills;
				if (team > 0) out.push({ kind, labelKey, value: r.kills, share: r.killShare });
				break;
			case "bossDamage":
				for (const row of rows) team += row.bossDamage;
				if (team > 0) out.push({ kind, labelKey, value: r.bossDamage, share: r.bossShare });
				break;
			case "parries":
				for (const row of rows) team += row.parries;
				if (team > 0) out.push({ kind, labelKey, value: r.parries });
				break;
			case "grazes":
				for (const row of rows) team += row.grazes;
				if (team > 0) out.push({ kind, labelKey, value: r.grazes });
				break;
			case "hits":
				for (const row of rows) team += row.hits;
				if (team > 0) out.push({ kind, labelKey, value: r.hits });
				break;
			case "pickups":
				if (boosts + pellets > 0) {
					out.push({
						kind,
						labelKey,
						value: r.boosts + r.pellets,
						boosts: boosts > 0 ? r.boosts : undefined,
						pellets: pellets > 0 ? r.pellets : undefined,
					});
				}
				break;
		}
	}
	return out;
}

/** The pickups cell's text parts in order (boosts, pellets; a dropped part left out), each `{ key, vars }`. */
export function contribPickupParts(cell: ContribCell): Array<{ key: string; vars: Readonly<Record<string, number>> }> {
	const out: Array<{ key: string; vars: Readonly<Record<string, number>> }> = [];
	if (cell.boosts !== undefined) {
		out.push(
			cell.boosts === 1
				? { key: CONTRIB_STRINGS.youBoostOne, vars: {} }
				: { key: CONTRIB_STRINGS.youBoosts, vars: { n: cell.boosts } },
		);
	}
	if (cell.pellets !== undefined) {
		out.push(
			cell.pellets === 1
				? { key: CONTRIB_STRINGS.youPelletOne, vars: {} }
				: { key: CONTRIB_STRINGS.youPellets, vars: { n: cell.pellets } },
		);
	}
	return out;
}

/** The run's contribution, or undefined for a solo run (see the file comment). */
export function contributionOf(input: ContributionInput, cfg: ContribConfig = CONTRIB): RunContribution | undefined {
	const n = input.partySize;
	if (n < cfg.minPartySize) return undefined;
	const t = input.tally;
	const damage = perPlayer(t.damage, n);
	const kills = perPlayer(t.kills, n);
	const bossDamage = perPlayer(t.bossDamage, n);
	const damageShares = largestRemainderShares(damage, cfg.shareTotal);
	const killShares = largestRemainderShares(kills, cfg.shareTotal);
	const bossShares = largestRemainderShares(bossDamage, cfg.shareTotal);
	const wipe = input.endedInWipe ?? derivedWipe(t, n);
	const lastToFall = wipe ? lastToFallOf(t, n) : -1;
	const mine = input.localIndex >= 0 && input.localIndex < n ? input.localIndex : 0;

	const stats: ContribStats[] = [];
	const standings: ContribStanding[] = [];
	for (let i = 0; i < n; i++) {
		const standing = standingOf(t, i, lastToFall);
		standings.push(standing);
		const death = deathOf(t, i);
		// Last Stand's stat: alive at run over stands past every death; a leaver who never died never leads it.
		const stand = death !== RECAP_ALIVE_TICK ? death : hasLeftRun(t, i) ? -1 : t.lastTick + 1;
		stats.push({
			damage: damage[i],
			kills: kills[i],
			bossDamage: bossDamage[i],
			parries: at(t.parries, i, 0),
			grazes: at(t.grazes, i, 0),
			hits: at(t.hits, i, 0),
			pickups: at(t.pellets, i, 0) + at(t.boosts, i, 0),
			stand,
			lastToFall: i === lastToFall,
			left: hasLeftRun(t, i),
			stoodTicks: death !== RECAP_ALIVE_TICK ? death : t.lastTick,
			runTicks: t.lastTick,
		});
	}
	const titles = assignTitles(stats);

	const rows: ContributionRow[] = [];
	for (let i = 0; i < n; i++) {
		rows.push({
			index: i,
			name: input.names[i] ?? "",
			character: input.characters?.[i],
			local: i === mine,
			left: hasLeftRun(t, i),
			title: titles[i],
			damage: damage[i],
			damageShare: damageShares[i],
			kills: kills[i],
			killShare: killShares[i],
			bossDamage: bossDamage[i],
			bossShare: bossShares[i],
			parries: at(t.parries, i, 0),
			grazes: at(t.grazes, i, 0),
			hits: at(t.hits, i, 0),
			pellets: at(t.pellets, i, 0),
			boosts: at(t.boosts, i, 0),
			standing: standings[i],
		});
	}
	const me = rows[mine];
	return { rows, local: me, youCells: youCellsOf(me, rows, cfg), damageShares, wipe };
}

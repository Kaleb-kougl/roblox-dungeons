/**
 * Run-over recap telemetry (docs/RUN_RECAP.md RR9): did the recap move retries? The one event that is a CLIENT fact:
 * how long the run-over panel was open before the player left it, how they left it (Again / Retry Daily / the restart
 * key, Main menu, Back to lobby), the near-miss line it showed, whether it was a record run and whether a press skipped
 * the recap first; a party run adds the team moments the recap counted (TEAM PERFECT rooms, best team streak, SYNC!
 * parries). Retries themselves are already counted from the server's own replays (`SessionEnded` "retried",
 * `SessionRetriesAfterDeath`); this splits them by what the panel showed.
 *
 * The client sends one `runRecap(report)` per run over (client RecapController). The server re-reads it here
 * (`readRunRecapReport`: types, finite numbers, ranges, the near-miss kind from the recap's own list), takes at most one
 * per run session it issued to that player (`RunRecapGate`) and logs `analyticsForRunRecap`. It is never trusted for
 * anything but analytics: no score, record, leaderboard or session decision reads it.
 *
 * Event `RunRecap` (ANALYTICS_EVENT.runRecap). field01 says what the value is:
 *   field01 `retry` / `exit` / `lobby`     value = seconds the panel was open (0..maxSeconds, 0.1 s); field02 the
 *                                          near-miss kind shown (`RUN_RECAP_NEAR_MISS_KINDS` or `none`); field03
 *                                          `plain` / `plainSkipped` / `record` / `recordSkipped`, followed by
 *                                          `/<character>` when the report names the player's character
 *                                          (docs/ARCHER.md AR5: `record/archer`; M1 runs have none)
 *   field01 `teamPerfects` / `bestTeamStreak` / `syncParries`   value = that team total (party runs, `lobby` only)
 *   field01 `views`                        (docs/RUN_CONTRIBUTION.md CT8) value = seconds the You and Party tabs showed
 *                                          (0..2 x maxSeconds, 0.1 s); field02 the tab showing when the panel was left
 *                                          (`you` / `team` / `party`); party runs with the tabs (`lobby`) only
 * Pure and Roblox-API-free.
 */
import { isCharacterId, type CharacterId } from "shared/characters";
import type { RecapNearMissKind, RecapTab } from "shared/view/hud";
import { ANALYTICS_EVENT, type AnalyticsEventSpec } from "./analytics";
import { isFiniteValue } from "./validate";

/** How the run-over panel was left: Again / Retry Daily / the restart key, Main menu, Back to lobby (party runs). */
export type RunRecapClose = "retry" | "exit" | "lobby";

export const RUN_RECAP_CLOSES: ReadonlyArray<RunRecapClose> = ["retry", "exit", "lobby"];

/** No near-miss line was shown. */
export const RUN_RECAP_NO_NEAR_MISS = "none";

export type RunRecapNearMiss = RecapNearMissKind | typeof RUN_RECAP_NO_NEAR_MISS;

/**
 * The near-miss kinds, in shared/view/hud RECAP_NEAR_MISS_ORDER's order (the record below makes the list complete at
 * compile time; recapAnalytics.spec pins the order). Mirrored here because the server never loads the HUD barrel.
 */
const NEAR_MISS_KIND_SET: { readonly [K in RecapNearMissKind]: true } = {
	boss: true,
	score: true,
	recordFloor: true,
	stairs: true,
	fullClear: true,
	nextBoss: true,
};
export const RUN_RECAP_NEAR_MISS_KINDS: ReadonlyArray<RecapNearMissKind> = [
	"boss",
	"score",
	"recordFloor",
	"stairs",
	"fullClear",
	"nextBoss",
];

/** field03 of a close row: record run x skipped first. */
export const RUN_RECAP_FLAGS = {
	plain: "plain",
	plainSkipped: "plainSkipped",
	record: "record",
	recordSkipped: "recordSkipped",
} as const;

/** Between a close row's flags and the character in its field03 (docs/ARCHER.md AR5; the Daily's combo separator). */
export const RUN_RECAP_CHARACTER_SEPARATOR = "/";

/** The party rows' field01 (one row per team total). */
export const RUN_RECAP_TEAM_ROWS = ["teamPerfects", "bestTeamStreak", "syncParries"] as const;

/** A party run's run-over tab (shared/view/hud RecapTab; mirrored, recapAnalytics.spec pins it to RECAP_TABS). */
export type RunRecapTab = RecapTab;

const TAB_SET: { readonly [K in RecapTab]: true } = { you: true, team: true, party: true };
export const RUN_RECAP_TABS: ReadonlyArray<RecapTab> = ["you", "team", "party"];

/** The views row's field01 (docs/RUN_CONTRIBUTION.md CT8). */
export const RUN_RECAP_VIEWS_ROW = "views";

export const RUN_RECAP_TELEMETRY = table.freeze({
	/** Seconds on the panel are clamped to this (a panel left open is still one report). */
	maxSeconds: 600,
	/** Seconds are rounded to tenths (steps per second). */
	secondsPerStep: 10,
	/** A run id longer than this is not one the server issued (GUIDs are 36-38). */
	maxRunIdChars: 64,
	/** Team totals are clamped to this. */
	maxTeamCount: 999,
	/** Run sessions remembered per player for the one-report rule (a report may arrive after the next start). */
	runsRemembered: 4,
});

/** `runRecap` reports per player (sliding window): one per run over, so the run start rate bounds it. */
export const RUN_RECAP_RATE = table.freeze({ count: 10, windowSeconds: 60 });

/** A party run's team moments (client TeamMomentsController.totals). */
export interface RunRecapTeam {
	readonly teamPerfects: number;
	readonly bestTeamStreak: number;
	readonly syncParries: number;
}

/**
 * What a party run's run-over tabs showed (docs/RUN_CONTRIBUTION.md CT8): real seconds the You and the Party tab were
 * on screen (Details over them counts for neither), and the tab showing when the panel was left.
 */
export interface RunRecapViews {
	readonly you: number;
	readonly party: number;
	readonly last: RunRecapTab;
}

/** `runRecap`'s payload (shared/network). */
export interface RunRecapReport {
	/** The run session the recap was for (StartRunReply / partyRunStarted runId). */
	readonly runId: string;
	readonly close: RunRecapClose;
	/** Real seconds from the panel's open to the press that left it. */
	readonly seconds: number;
	readonly nearMiss: RunRecapNearMiss;
	/** New best's record run (NEW BEST! / FIRST RECORD ribbon). */
	readonly record: boolean;
	/** A press skipped the recap's timeline before it was armed (RunOverRetryGate "skip"). */
	readonly skipped: boolean;
	/** Party runs (`lobby`) only; ignored on other closes. */
	readonly team?: RunRecapTeam;
	/** Party runs with the tabs (`lobby`) only; ignored on other closes. */
	readonly views?: RunRecapViews;
	/**
	 * docs/ARCHER.md AR5: the reporting player's character in that run (RunContext.character), absent for a run
	 * without one (M1). A client fact like the rest: analytics only.
	 */
	readonly character?: CharacterId;
}

function asTable(v: unknown): Record<string, unknown> | undefined {
	return typeIs(v, "table") ? (v as Record<string, unknown>) : undefined;
}

function isClose(v: unknown): v is RunRecapClose {
	return v === "retry" || v === "exit" || v === "lobby";
}

function isNearMiss(v: unknown): v is RunRecapNearMiss {
	if (v === RUN_RECAP_NO_NEAR_MISS) return true;
	return typeIs(v, "string") && (NEAR_MISS_KIND_SET as unknown as Record<string, true | undefined>)[v] === true;
}

/** A team count: a non-negative integer, clamped to maxTeamCount; undefined otherwise. */
function teamCount(v: unknown): number | undefined {
	if (!isFiniteValue(v) || v < 0 || v % 1 !== 0) return undefined;
	return math.min(v, RUN_RECAP_TELEMETRY.maxTeamCount);
}

function readTeam(v: unknown): RunRecapTeam | undefined {
	const t = asTable(v);
	if (t === undefined) return undefined;
	const perfects = teamCount(t.teamPerfects);
	const streak = teamCount(t.bestTeamStreak);
	const syncs = teamCount(t.syncParries);
	if (perfects === undefined || streak === undefined || syncs === undefined) return undefined;
	// A streak is a run of team perfects: never longer than their count.
	return { teamPerfects: perfects, bestTeamStreak: math.min(streak, perfects), syncParries: syncs };
}

function isTab(v: unknown): v is RunRecapTab {
	return typeIs(v, "string") && (TAB_SET as unknown as Record<string, true | undefined>)[v] === true;
}

/** A views table: both seconds read as runRecapSeconds (clamped, tenths), the last tab from RUN_RECAP_TABS. */
function readViews(v: unknown): RunRecapViews | undefined {
	const t = asTable(v);
	if (t === undefined) return undefined;
	const you = runRecapSeconds(t.you);
	const party = runRecapSeconds(t.party);
	if (you === undefined || party === undefined || !isTab(t.last)) return undefined;
	return { you, party, last: t.last };
}

/** Seconds clamped to 0..maxSeconds and rounded to tenths; undefined when not finite. */
export function runRecapSeconds(v: unknown): number | undefined {
	if (!isFiniteValue(v)) return undefined;
	const steps = RUN_RECAP_TELEMETRY.secondsPerStep;
	return math.round(math.clamp(v, 0, RUN_RECAP_TELEMETRY.maxSeconds) * steps) / steps;
}

/**
 * `runRecap`'s payload re-read on the server, or undefined (dropped). Rejects: not a table, a run id that is not a
 * 1..maxRunIdChars string, an unknown close or near-miss kind, a non-finite `seconds`, non-boolean flags, a `team`
 * that is present but malformed (counts must be non-negative integers), a `views` that is present but malformed
 * (seconds not finite, an unknown tab), a `character` that is present but no character id. Clamps seconds and counts; a team or views on a solo close (`retry` / `exit`)
 * is dropped, a `lobby` close without them stays valid (no team / views rows).
 */
export function readRunRecapReport(v: unknown): RunRecapReport | undefined {
	const t = asTable(v);
	if (t === undefined) return undefined;
	const runId = t.runId;
	if (!typeIs(runId, "string") || runId.size() === 0 || runId.size() > RUN_RECAP_TELEMETRY.maxRunIdChars) {
		return undefined;
	}
	if (!isClose(t.close) || !isNearMiss(t.nearMiss)) return undefined;
	const seconds = runRecapSeconds(t.seconds);
	if (seconds === undefined) return undefined;
	if (!typeIs(t.record, "boolean") || !typeIs(t.skipped, "boolean")) return undefined;
	let team: RunRecapTeam | undefined;
	if (t.team !== undefined) {
		team = readTeam(t.team);
		if (team === undefined) return undefined;
	}
	let views: RunRecapViews | undefined;
	if (t.views !== undefined) {
		views = readViews(t.views);
		if (views === undefined) return undefined;
	}
	const character = t.character;
	if (character !== undefined && !isCharacterId(character)) return undefined;
	const out: RunRecapReport = {
		runId,
		close: t.close,
		seconds,
		nearMiss: t.nearMiss,
		record: t.record,
		skipped: t.skipped,
		character,
	};
	if (t.close !== "lobby") return out;
	return { ...out, team, views };
}

/** field03 of a close row: the flags, then `/<character>` when there is one (docs/ARCHER.md AR5). */
export function runRecapFlags(record: boolean, skipped: boolean, character?: CharacterId): string {
	let flags: string;
	if (record) flags = skipped ? RUN_RECAP_FLAGS.recordSkipped : RUN_RECAP_FLAGS.record;
	else flags = skipped ? RUN_RECAP_FLAGS.plainSkipped : RUN_RECAP_FLAGS.plain;
	return character !== undefined ? `${flags}${RUN_RECAP_CHARACTER_SEPARATOR}${character}` : flags;
}

/** A views row's value: seconds on You + Party, rounded to tenths. */
export function runRecapViewSeconds(v: Readonly<RunRecapViews>): number {
	const steps = RUN_RECAP_TELEMETRY.secondsPerStep;
	return math.round((v.you + v.party) * steps) / steps;
}

/**
 * The events of one accepted report (see the file comment): the close row, then a party run's three team rows and its
 * views row.
 */
export function analyticsForRunRecap(r: Readonly<RunRecapReport>): AnalyticsEventSpec[] {
	const out: AnalyticsEventSpec[] = [
		{
			kind: "custom",
			name: ANALYTICS_EVENT.runRecap,
			value: r.seconds,
			fields: { field01: r.close, field02: r.nearMiss, field03: runRecapFlags(r.record, r.skipped, r.character) },
		},
	];
	const team = r.close === "lobby" ? r.team : undefined;
	if (team !== undefined) {
		for (const row of RUN_RECAP_TEAM_ROWS) {
			out.push({ kind: "custom", name: ANALYTICS_EVENT.runRecap, value: team[row], fields: { field01: row } });
		}
	}
	const views = r.close === "lobby" ? r.views : undefined;
	if (views !== undefined) {
		out.push({
			kind: "custom",
			name: ANALYTICS_EVENT.runRecap,
			value: runRecapViewSeconds(views),
			fields: { field01: RUN_RECAP_VIEWS_ROW, field02: views.last },
		});
	}
	return out;
}

/**
 * One report per run session (the server side of RR9's rate limit). `issue` records a session the server started
 * for the player (solo or party member); `take` accepts the first report naming one of the player's last
 * `runsRemembered` sessions and refuses every other (unknown, forged or repeated ids). Pure; keys are players.
 */
export class RunRecapGate<K> {
	private readonly runs = new Map<K, Array<{ readonly runId: string; reported: boolean }>>();

	constructor(private readonly remembered: number = RUN_RECAP_TELEMETRY.runsRemembered) {}

	/** The server started run session `runId` with `key` in it. */
	issue(key: K, runId: string): void {
		let list = this.runs.get(key);
		if (list === undefined) {
			list = [];
			this.runs.set(key, list);
		}
		for (const r of list) if (r.runId === runId) return;
		list.push({ runId, reported: false });
		while (list.size() > this.remembered) list.remove(0);
	}

	/** True once for each issued run id of `key` (the report is logged); false otherwise. */
	take(key: K, runId: string): boolean {
		const list = this.runs.get(key);
		if (list === undefined) return false;
		for (const r of list) {
			if (r.runId !== runId) continue;
			if (r.reported) return false;
			r.reported = true;
			return true;
		}
		return false;
	}

	/** Drops a key (player left). */
	forget(key: K): void {
		this.runs.delete(key);
	}

	/** Keys tracked (specs / leak checks). */
	size(): number {
		return this.runs.size();
	}
}

/**
 * The client's tally of a party run's tab views (docs/RUN_CONTRIBUTION.md CT8; client RecapController): real seconds
 * each tab's content showed (`showing` undefined: Details over the tabs, or no tabs) and the tab selected last. Pure.
 */
export class RunRecapViewClock {
	private you = 0;
	private party = 0;
	private last: RunRecapTab = "you";

	/** One frame of `dt` real seconds; `selected` the tab chosen (even under Details); `showing` the one on screen. */
	step(dt: number, selected: RunRecapTab, showing: RunRecapTab | undefined): void {
		this.last = selected;
		const d = math.max(0, dt);
		if (showing === "you") this.you += d;
		else if (showing === "party") this.party += d;
	}

	/** The report's views (seconds as the server will read them: clamped, tenths). */
	views(): RunRecapViews {
		return { you: runRecapSeconds(this.you) ?? 0, party: runRecapSeconds(this.party) ?? 0, last: this.last };
	}
}

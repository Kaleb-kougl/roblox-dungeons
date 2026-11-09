/**
 * The game's AnalyticsService catalog (docs/TUTORIAL_FUNNEL.md TF1): every funnel and custom event name the server
 * logs, with each event's custom field value sets, gathered from their owners (shared/run analytics.ts and
 * dailyAnalytics.ts and recapAnalytics.ts, shared/lobby analytics.ts, which also carries shared/invite's arrival
 * events, and this module's tutorial / onboarding events). Pure data plus counting; analyticsCatalog.spec.ts holds it
 * to Roblox's limits: 10 funnels, 100 custom event names, 8,000 field value combinations per experience, step names
 * <= 32 chars.
 *
 * COUNTING RULE (analyticsEntryCombinations): an entry's combinations are the product, over its three field slots, of
 * the slot's value count, where an unused slot counts 1 and a slot that is sometimes left out counts its values + 1
 * (absent is a value of its own). A funnel's field sets describe its step 1 (the only step Roblox filters on); its
 * other steps log no fields, which adds the one all-absent combination (+1). The catalog's total is the sum over
 * entries: an upper bound, since every entry is counted as if each field varied independently.
 *
 * A field set lists the CURRENT values: a value retired by a later build (an old revision string) still sits in
 * Roblox's table, so the total keeps headroom for that.
 */
import { CHARACTER_IDS } from "shared/characters";
import { LOBBY_VISIBILITIES } from "shared/lobby";
import type { InviteArrivalKind, InviteArrivalOutcome, LobbyInviteAnswer, PartyGroupedHow } from "shared/lobby";
import { LOBBY_ANALYTICS_EVENT } from "shared/lobby";
import {
	ANALYTICS_EVENT,
	BOSS_PROGRESSION_PATH,
	DAILY_ANALYTICS,
	DAILY_RETURNING_VALUES,
	FORFEIT_DEATH_CAUSE,
	RUN_FUNNEL,
	RUN_FUNNEL_STEPS,
	RUN_RECAP_CHARACTER_SEPARATOR,
	RUN_RECAP_CLOSES,
	RUN_RECAP_FLAGS,
	RUN_RECAP_NEAR_MISS_KINDS,
	RUN_RECAP_NO_NEAR_MISS,
	RUN_RECAP_TABS,
	RUN_RECAP_TEAM_ROWS,
	RUN_RECAP_VIEWS_ROW,
	type AnalyticsBucket,
	type RunEndReason,
	type RunRejectCode,
	type SegmentRejectCode,
} from "shared/run";
import { BOSS_FINAL_PHASE, archetypeIds } from "shared/sim";
import { TUTORIAL_DEVICES, TUTORIAL_STEPS } from "shared/tutorial";
import {
	ONBOARDING_FUNNEL,
	TUTORIAL_ANALYTICS_EVENT,
	TUTORIAL_FUNNEL,
	TUTORIAL_FUNNEL_MAX_STEP,
	TUTORIAL_TELEMETRY,
} from "./config";
import { TUTORIAL_ATTEMPT_FUNNEL_STEPS, tutorialFunnelRevision } from "./funnel";
import { NEW_PLAYER_RUN_ENDS, NEW_PLAYER_TUTORIAL_OUTCOMES } from "./newPlayer";
import { ONBOARDING_FUNNEL_STEPS } from "./onboardingFunnel";
import {
	ONBOARDING_ENTRIES,
	ONBOARDING_GATE_REASONS,
	TUTORIAL_ABANDON_KINDS,
	TUTORIAL_CURRENT_STEP_IDS,
	TUTORIAL_ENTRIES,
	TUTORIAL_OUTRO_CHOICES,
	TUTORIAL_OUTRO_LEFT,
	TUTORIAL_PROMPT_IDS,
} from "./reports";

/**
 * custom: LogCustomEvent; funnel: LogFunnelStepEvent (recurring); onboarding: LogOnboardingFunnelStepEvent (one per
 * experience, counted as a funnel); progression: LogProgressionEvent (a path, not a funnel).
 */
export type AnalyticsCatalogKind = "custom" | "funnel" | "onboarding" | "progression";

/** The values one custom field slot can carry. */
export interface AnalyticsFieldSet {
	readonly values: ReadonlyArray<string>;
	/** The slot is sometimes left out (absent then counts as one more value). */
	readonly optional?: boolean;
}

export interface AnalyticsCatalogEntry {
	readonly kind: AnalyticsCatalogKind;
	/** The custom event name, funnel name or progression path (the onboarding funnel has no name: ONBOARDING_CATALOG_NAME). */
	readonly name: string;
	/** The module that logs it. */
	readonly owner: string;
	readonly field01?: AnalyticsFieldSet;
	readonly field02?: AnalyticsFieldSet;
	readonly field03?: AnalyticsFieldSet;
	/** A funnel's step names, in step order. */
	readonly steps?: ReadonlyArray<string>;
}

/** The catalog's label for the (nameless) onboarding funnel. */
export const ONBOARDING_CATALOG_NAME = "Onboarding";

/** Every key of a `{ [K]: true }` record, sorted (a compile-time complete list of a string union's members). */
function membersOf<K extends string>(record: { readonly [P in K]: true }): K[] {
	const out: K[] = [];
	for (const [k] of pairs(record as unknown as ReadonlyMap<K, true>)) out.push(k);
	out.sort((a, b) => a < b);
	return out;
}

/** `values` with duplicates dropped, first occurrence kept. */
function unique(values: ReadonlyArray<string>): string[] {
	const out: string[] = [];
	for (const v of values) if (!out.includes(v)) out.push(v);
	return out;
}

function labels(buckets: ReadonlyArray<AnalyticsBucket>): string[] {
	return buckets.map((b) => b.label);
}

function set(values: ReadonlyArray<string>, optional?: boolean): AnalyticsFieldSet {
	return optional === true ? { values: unique(values), optional } : { values: unique(values) };
}

const RUN_END_REASONS = membersOf<RunEndReason>({ death: true, victory: true, abandoned: true });

const REJECT_CODES = membersOf<RunRejectCode | SegmentRejectCode>({
	bad_submission: true,
	too_large: true,
	too_long: true,
	malformed: true,
	seed_mismatch: true,
	debug_input: true,
	debug_spawn: true,
	config_error: true,
	spawn_mismatch: true,
	replay_error: true,
	hash_mismatch: true,
	summary_mismatch: true,
	bad_segment: true,
	out_of_order: true,
	tick_gap: true,
	segment_too_large: true,
	segment_too_long: true,
	empty_segment: true,
	run_too_long: true,
	clock_ahead: true,
	backlog_full: true,
	run_rejected: true,
	run_closed: true,
	bad_final: true,
	empty_run: true,
	final_tick_mismatch: true,
	score_mismatch: true,
	unknown_run: true,
	expired: true,
	abandoned: true,
	rate_limited: true,
	desync: true,
});

const INVITE_ARRIVAL_OUTCOMES = membersOf<InviteArrivalOutcome>({
	joinedInvite: true,
	joinedOpen: true,
	followedClosed: true,
	arrived: true,
	full: true,
	gone: true,
	inRun: true,
	kickCooldown: true,
	busy: true,
	noData: true,
});
const INVITE_ARRIVAL_KINDS = membersOf<InviteArrivalKind>({ lobby: true, game: true });
const INVITE_ANSWERS = membersOf<LobbyInviteAnswer>({ accept: true, decline: true, expire: true });
const PARTY_GROUPED = membersOf<PartyGroupedHow>({ joined: true, created: true, offered: true });

/** Hit sources (shared/run hitSourceName): every archetype id, or `unknown`. */
function hitSources(): string[] {
	const out = [...archetypeIds()];
	out.push("unknown");
	return out;
}

/** Death causes: a hit source or a forfeit. */
function deathCauses(): string[] {
	const out = hitSources();
	out.push(FORFEIT_DEATH_CAUSE);
	return out;
}

/** RunEnded's phase field: `phase0` .. `phase<the highest boss final phase>`. */
function bossPhases(): string[] {
	let max = 0;
	for (const [, p] of BOSS_FINAL_PHASE) max = math.max(max, p);
	const out: string[] = [];
	for (let p = 0; p <= max; p++) out.push(`phase${p}`);
	return out;
}

/**
 * RunRecap's field03 values: the RUN_RECAP_FLAGS alone (a run without a character: M1) and each with every character
 * (docs/ARCHER.md AR5: `record/archer`).
 */
function flagValues(): string[] {
	const flags: string[] = [];
	for (const [, v] of pairs(RUN_RECAP_FLAGS)) flags.push(v);
	flags.sort((a, b) => a < b);
	const out = [...flags];
	for (const f of flags) for (const c of CHARACTER_IDS) out.push(`${f}${RUN_RECAP_CHARACTER_SEPARATOR}${c}`);
	return out;
}

function lessonIds(): string[] {
	return TUTORIAL_STEPS.map((s) => s.id);
}

function custom(
	name: string,
	owner: string,
	fields: Partial<Record<"field01" | "field02" | "field03", AnalyticsFieldSet>> = {},
): AnalyticsCatalogEntry {
	return { kind: "custom", name, owner, ...fields };
}

function buildCatalog(): ReadonlyArray<AnalyticsCatalogEntry> {
	const run = "shared/run analytics.ts";
	const daily = "shared/run dailyAnalytics.ts";
	const lobby = "shared/lobby analytics.ts";
	const tut = "shared/onboarding";
	const causes = deathCauses();
	const attempts = labels(DAILY_ANALYTICS.attemptBuckets);
	const boards = DAILY_ANALYTICS.boards.map((b) => b as string);
	const combos: string[] = [];
	for (const a of attempts)
		for (const r of DAILY_RETURNING_VALUES) combos.push(`${a}${DAILY_ANALYTICS.comboSeparator}${r}`);
	const revision = [tutorialFunnelRevision()];
	const entries = TUTORIAL_ENTRIES.map((e) => e as string);
	const devices = TUTORIAL_DEVICES.map((d) => d as string);
	const outcomes = NEW_PLAYER_TUTORIAL_OUTCOMES.map((o) => o as string);
	const out: AnalyticsCatalogEntry[] = [
		// --- Runs (server replay)
		{ kind: "funnel", name: RUN_FUNNEL, owner: run, steps: RUN_FUNNEL_STEPS },
		{ kind: "progression", name: BOSS_PROGRESSION_PATH, owner: run, field01: set(causes, true) },
		custom(ANALYTICS_EVENT.runEnded, run, {
			field01: set(RUN_END_REASONS),
			field02: set(bossPhases()),
			field03: set([...causes, "none"]),
		}),
		// docs/ARCHER.md AR5: the replayed player's character (absent: a run without one, M1)
		custom(ANALYTICS_EVENT.runDuration, run, { field01: set(CHARACTER_IDS, true) }),
		custom(ANALYTICS_EVENT.playerDeath, run, { field01: set(causes), field02: set(["boss", "rooms"]) }),
		custom(ANALYTICS_EVENT.runKills, run),
		custom(ANALYTICS_EVENT.hitsTaken, run, { field01: set(hitSources()) }),
		custom(ANALYTICS_EVENT.heartsLost, run),
		custom(ANALYTICS_EVENT.weaponSwaps, run),
		custom(ANALYTICS_EVENT.flasksUsed, run),
		custom(ANALYTICS_EVENT.embersUsed, run),
		custom(ANALYTICS_EVENT.rollsStarted, run),
		custom(ANALYTICS_EVENT.bossAttempt, run, { field01: set(["victory", ...RUN_END_REASONS]) }),
		custom(ANALYTICS_EVENT.runRejected, run, { field01: set(REJECT_CODES) }),
		custom(ANALYTICS_EVENT.sessionEnded, run, { field01: set(["retried", "quitAfterDeath", "noDeaths"]) }),
		custom(ANALYTICS_EVENT.sessionRuns, run),
		custom(ANALYTICS_EVENT.sessionRetriesAfterDeath, run),
		custom(ANALYTICS_EVENT.sessionLongestRetryStreak, run),
		// --- The run-over recap (docs/RUN_RECAP.md RR9): close rows carry fields 2 / 3, team rows field01 only; a party
		// run's views row (docs/RUN_CONTRIBUTION.md CT8) field02 the last tab
		custom(ANALYTICS_EVENT.runRecap, "shared/run recapAnalytics.ts", {
			field01: set([...RUN_RECAP_CLOSES, ...RUN_RECAP_TEAM_ROWS, RUN_RECAP_VIEWS_ROW]),
			field02: set([...RUN_RECAP_NEAR_MISS_KINDS, RUN_RECAP_NO_NEAR_MISS, ...RUN_RECAP_TABS], true),
			field03: set(flagValues(), true),
		}),
		// --- The Daily
		custom(ANALYTICS_EVENT.dailyStart, daily, {
			field01: set(boards),
			field02: set(attempts),
			field03: set(DAILY_RETURNING_VALUES),
		}),
		custom(ANALYTICS_EVENT.dailyRetry, daily, { field01: set(attempts), field02: set(boards) }),
		custom(ANALYTICS_EVENT.dailyFinish, daily, {
			field01: set(labels(DAILY_ANALYTICS.scoreBuckets)),
			field02: set(labels(DAILY_ANALYTICS.floorBuckets)),
			field03: set(combos),
		}),
		// --- Lobbies, invites and parties
		custom(LOBBY_ANALYTICS_EVENT.lobbyCreated, lobby, { field01: set(LOBBY_VISIBILITIES) }),
		custom(LOBBY_ANALYTICS_EVENT.lobbyStarted, lobby, { field01: set(["party", "solo"]) }),
		custom(LOBBY_ANALYTICS_EVENT.inviteSent, lobby, { field01: set(["server", "platform"]) }),
		custom(LOBBY_ANALYTICS_EVENT.inviteAnswered, lobby, { field01: set(INVITE_ANSWERS) }),
		custom(LOBBY_ANALYTICS_EVENT.inviteArrival, lobby, {
			field01: set(INVITE_ARRIVAL_OUTCOMES),
			field02: set(INVITE_ARRIVAL_KINDS),
		}),
		custom(LOBBY_ANALYTICS_EVENT.partyGrouped, lobby, { field01: set(PARTY_GROUPED) }),
		// --- The tutorial and onboarding (docs/TUTORIAL_FUNNEL.md)
		{
			kind: "onboarding",
			name: ONBOARDING_CATALOG_NAME,
			owner: tut,
			steps: ONBOARDING_FUNNEL_STEPS,
			field01: set(ONBOARDING_ENTRIES),
			field02: set(revision),
			field03: set([ONBOARDING_FUNNEL.noExperimentArm]),
		},
		{
			kind: "funnel",
			name: TUTORIAL_FUNNEL,
			owner: tut,
			steps: TUTORIAL_ATTEMPT_FUNNEL_STEPS,
			field01: set(entries),
			field02: set(revision),
			field03: set(devices),
		},
		custom(TUTORIAL_ANALYTICS_EVENT.lessonTime, tut, {
			field01: set(lessonIds()),
			field02: set(entries),
			field03: set(devices),
		}),
		custom(TUTORIAL_ANALYTICS_EVENT.lessonHits, tut, {
			field01: set(lessonIds()),
			field02: set(entries),
			field03: set(devices),
		}),
		custom(TUTORIAL_ANALYTICS_EVENT.stuck, tut, {
			field01: set(TUTORIAL_PROMPT_IDS),
			field02: set(entries),
			field03: set(devices),
		}),
		custom(TUTORIAL_ANALYTICS_EVENT.skipped, tut, {
			field01: set(TUTORIAL_CURRENT_STEP_IDS),
			field02: set(entries),
			field03: set(devices),
		}),
		custom(TUTORIAL_ANALYTICS_EVENT.abandoned, tut, {
			field01: set(TUTORIAL_CURRENT_STEP_IDS),
			field02: set(entries),
			field03: set(TUTORIAL_ABANDON_KINDS),
		}),
		custom(TUTORIAL_ANALYTICS_EVENT.restarted, tut, { field01: set(TUTORIAL_CURRENT_STEP_IDS) }),
		custom(TUTORIAL_ANALYTICS_EVENT.outroChoice, tut, {
			field01: set([...TUTORIAL_OUTRO_CHOICES, TUTORIAL_OUTRO_LEFT]),
			field02: set(entries),
		}),
		custom(TUTORIAL_ANALYTICS_EVENT.onboardingGate, tut, { field01: set(ONBOARDING_GATE_REASONS) }),
		custom(TUTORIAL_ANALYTICS_EVENT.newPlayerRun, tut, {
			field01: set(outcomes),
			field02: set(NEW_PLAYER_RUN_ENDS),
			field03: set(labels(DAILY_ANALYTICS.floorBuckets)),
		}),
		custom(TUTORIAL_ANALYTICS_EVENT.newPlayerRunStarted, tut, { field01: set(outcomes) }),
		custom(TUTORIAL_ANALYTICS_EVENT.newPlayerReturned, tut, { field01: set(outcomes) }),
	];
	return table.freeze(out);
}

/** Every funnel, progression path and custom event the game logs. */
export const ANALYTICS_CATALOG: ReadonlyArray<AnalyticsCatalogEntry> = buildCatalog();

function slotCount(s: AnalyticsFieldSet | undefined): number {
	if (s === undefined) return 1;
	return s.values.size() + (s.optional === true ? 1 : 0);
}

/** One entry's field value combinations (the counting rule in the file comment). */
export function analyticsEntryCombinations(e: Readonly<AnalyticsCatalogEntry>): number {
	const product = slotCount(e.field01) * slotCount(e.field02) * slotCount(e.field03);
	const fieldless = e.kind === "funnel" || e.kind === "onboarding" ? 1 : 0;
	return product + fieldless;
}

/** The catalog's field value combinations: the sum over its entries. */
export function analyticsCatalogCombinations(): number {
	let total = 0;
	for (const e of ANALYTICS_CATALOG) total += analyticsEntryCombinations(e);
	return total;
}

/** The catalog's entries of `kind`. */
export function analyticsCatalogEntries(kind: AnalyticsCatalogKind): AnalyticsCatalogEntry[] {
	return ANALYTICS_CATALOG.filter((e) => e.kind === kind);
}

/** The catalog entry named `name` of `kind`, or undefined. */
export function analyticsCatalogEntry(kind: AnalyticsCatalogKind, name: string): AnalyticsCatalogEntry | undefined {
	return ANALYTICS_CATALOG.find((e) => e.kind === kind && e.name === name);
}

/**
 * The most events one tutorial attempt can log (TutorialFunnelTracker's dedupe makes it exact): step 1 `started`, each
 * lesson step, each lesson's report (time + hits), the stuck reports, one exit (completed / skipped / abandoned /
 * restarted) and the outro.
 */
export function tutorialAttemptEventBound(): number {
	const lessons = TUTORIAL_FUNNEL_MAX_STEP;
	const funnel = 1 + lessons;
	const reports = lessons * 2;
	return funnel + reports + TUTORIAL_TELEMETRY.maxStuckReportsPerAttempt + TUTORIAL_TELEMETRY.exitEventReserve;
}

/** A first attempt's worst case: the attempt's events, every onboarding funnel step and the gate. */
export function firstAttemptEventBound(): number {
	return tutorialAttemptEventBound() + ONBOARDING_FUNNEL_STEPS.size() + 1;
}

/**
 * Run telemetry -> Roblox AnalyticsService events (replaces the web build's F9 playtest export). Pure: it returns
 * event specs and TelemetryService logs them, so the mapping is tested headlessly. Inputs come only from the server's
 * own replay (validate.ts), never from the client.
 *
 * Roblox limits this is designed around: 10 funnels, 100 custom event names, 8,000 combinations of the three custom
 * field values per experience. Every field value here comes from a small fixed set (end reasons, phase numbers,
 * archetype ids, reject codes). The full name table is in docs/SERVER.md.
 */
import { LOCALES, SOURCE_LOCALE, liveLocales, pickLocale, resolveLocaleState } from "shared/l10n";
import { BOSS_ACT1_ID, BOSS_DEMONLORD_ID, SIM_HZ } from "shared/sim";
import type { RunSessionSummary } from "./session";
import type { RunTelemetryRecord } from "./telemetry";
import type { RunRejectCode } from "./validate";
import type { SegmentRejectCode } from "./segments";

/** Breakdown values for AnalyticsCustomFieldKeys CustomField01..03. */
export interface AnalyticsFields {
	field01?: string;
	field02?: string;
	field03?: string;
}

export type AnalyticsEventSpec =
	| { kind: "custom"; name: string; value: number; fields?: AnalyticsFields }
	| { kind: "funnel"; funnel: string; step: number; stepName: string; fields?: AnalyticsFields }
	| {
			kind: "progression";
			status: "Start" | "Complete" | "Fail";
			path: string;
			level: number;
			levelName: string;
			fields?: AnalyticsFields;
	  };

/** The run funnel (one funnel session per validated run). Steps are logged in order, only the ones reached. */
export const RUN_FUNNEL = "M1Run";
export const RUN_FUNNEL_STEPS = ["RunStarted", "FirstKill", "BossEngaged", "BossPhase2", "BossPhase3", "BossDefeated"];

/**
 * The boss fight as a progression level (Start on engage, Complete on the kill, Fail on a death after engaging), on
 * one path. The level is the run's first boss (RunTelemetryRecord.bossId): Mother Bramble keeps level 1
 * "MotherBramble" (M1's only boss; the event M1 has always logged), the Demon Lord (endless floors only) is level 2
 * "DemonLord". The level number names the boss, it is no order: endless floors pick either. A record without a boss id
 * (fixture event streams) or an unlisted boss logs Mother Bramble's level, as before.
 */
export const BOSS_PROGRESSION_PATH = "ActI";
export const BOSS_PROGRESSION_LEVEL = 1;
export const BOSS_PROGRESSION_LEVEL_NAME = "MotherBramble";

export interface BossProgressionLevel {
	readonly level: number;
	readonly levelName: string;
}

const BRAMBLE_LEVEL: BossProgressionLevel = { level: BOSS_PROGRESSION_LEVEL, levelName: BOSS_PROGRESSION_LEVEL_NAME };

/** Boss archetype id -> its progression level (BOSS_PROGRESSION_PATH). */
export const BOSS_PROGRESSION_LEVELS: ReadonlyMap<string, BossProgressionLevel> = new Map([
	[BOSS_ACT1_ID, BRAMBLE_LEVEL],
	[BOSS_DEMONLORD_ID, { level: 2, levelName: "DemonLord" }],
]);

/** The progression level of boss `bossId` (Mother Bramble's for undefined or an unlisted id). */
export function bossProgressionLevel(bossId: string | undefined): BossProgressionLevel {
	const level = bossId !== undefined ? BOSS_PROGRESSION_LEVELS.get(bossId) : undefined;
	return level ?? BRAMBLE_LEVEL;
}

/** Custom event names. */
export const ANALYTICS_EVENT = {
	runEnded: "RunEnded",
	runDuration: "RunDuration",
	playerDeath: "PlayerDeath",
	runKills: "RunKills",
	hitsTaken: "HitsTaken",
	heartsLost: "HeartsLost",
	weaponSwaps: "WeaponSwaps",
	flasksUsed: "FlasksUsed",
	embersUsed: "EmbersUsed",
	rollsStarted: "RollsStarted",
	bossAttempt: "BossAttempt",
	runRejected: "RunRejected",
	sessionEnded: "SessionEnded",
	sessionRuns: "SessionRuns",
	sessionRetriesAfterDeath: "SessionRetriesAfterDeath",
	sessionLongestRetryStreak: "SessionLongestRetryStreak",
	/** The Daily (docs/DAILY.md DS13; dailyAnalytics.ts): an accepted daily session start, per member. */
	dailyStart: "daily_start",
	/** An accepted daily run, per credited member. */
	dailyFinish: "daily_finish",
	/** A daily start that is not the player's first daily start of that day, per member. */
	dailyRetry: "daily_retry",
} as const;

/** Decimal places kept on second values. */
const SECONDS_DECIMALS = 100;

function seconds(ticks: number): number {
	return math.round((ticks / SIM_HZ) * SECONDS_DECIMALS) / SECONDS_DECIMALS;
}

/** Furthest funnel step index (0-based) the run reached. */
export function runFunnelStepsReached(r: Readonly<RunTelemetryRecord>): number[] {
	const reached = [true, r.firstKillTick !== undefined, r.bossEngagedTick !== undefined];
	reached.push(r.bossPhaseReached >= 2, r.bossPhaseReached >= 3, r.bossDefeated);
	const out: number[] = [];
	for (let i = 0; i < reached.size(); i++) if (reached[i]) out.push(i);
	return out;
}

/**
 * The locale fields of the RunStarted funnel step (docs/LOCALIZATION.md L14, LD14): `shown`, the locale the player
 * reads, bucketed to a live code or LOCALE_OTHER (a developer's hidden pick); `language`, the player's Roblox
 * language as the locale it would pick if every locale were live (any LOCALES code but the pseudo-locale, or
 * LOCALE_OTHER), to see demand before a locale goes live. Small fixed sets: at most 19 x 19 combinations.
 */
export interface LocaleAnalytics {
	readonly shown: string;
	readonly language: string;
}

/** The bucket of a locale or language that is not listed. */
export const LOCALE_OTHER = "other";

/** A shown locale's bucket: a live code (English included), else LOCALE_OTHER. */
export function localeBucket(code: string): string {
	return liveLocales().some((l) => l.code === code) ? code : LOCALE_OTHER;
}

/** The Roblox language's bucket: the locale it maps to with every locale live, else LOCALE_OTHER (English only for en-*). */
export function languageBucket(robloxIds: ReadonlyArray<string>): string {
	const code = pickLocale(robloxIds, undefined, { allowHidden: true }).code;
	if (code !== SOURCE_LOCALE) return code;
	const english = robloxIds.some((id) => string.sub(id.lower(), 1, SOURCE_LOCALE.size()) === SOURCE_LOCALE);
	return english ? SOURCE_LOCALE : LOCALE_OTHER;
}

/**
 * The locale fields for a player (the server reads `Player.LocaleId` and the stored Options > Language override;
 * `allowHidden` for developers, who may pick hidden locales in Options; the automatic pick is live-only for everyone,
 * exactly as the client resolves it: shared/l10n resolveLocaleState).
 */
export function localeAnalytics(
	robloxIds: ReadonlyArray<string>,
	override: string | undefined,
	allowHidden: boolean,
): LocaleAnalytics {
	return {
		shown: localeBucket(resolveLocaleState(robloxIds, override, { allowHidden }).code),
		language: languageBucket(robloxIds),
	};
}

/** Every value each locale field can take (specs: fixed sets within Roblox's field limits). */
export function localeAnalyticsValues(): { shown: string[]; language: string[] } {
	const shown = liveLocales().map((l) => l.code);
	shown.push(LOCALE_OTHER);
	const language = LOCALES.filter((l) => l.pseudo === undefined).map((l) => l.code);
	language.push(LOCALE_OTHER);
	return { shown, language };
}

/**
 * Every analytics event for one accepted run, in logging order. With `locale`, the RunStarted funnel step carries
 * field01 = locale.shown and field02 = locale.language (LocaleAnalytics).
 */
export function analyticsForRun(
	r: Readonly<RunTelemetryRecord>,
	locale?: Readonly<LocaleAnalytics>,
): AnalyticsEventSpec[] {
	const out: AnalyticsEventSpec[] = [];
	for (const i of runFunnelStepsReached(r)) {
		const step: AnalyticsEventSpec = {
			kind: "funnel",
			funnel: RUN_FUNNEL,
			step: i + 1,
			stepName: RUN_FUNNEL_STEPS[i],
		};
		if (i === 0 && locale !== undefined) step.fields = { field01: locale.shown, field02: locale.language };
		out.push(step);
	}

	const boss = bossProgressionLevel(r.bossId);
	const level = { path: BOSS_PROGRESSION_PATH, level: boss.level, levelName: boss.levelName };
	if (r.bossEngagedTick !== undefined) {
		out.push({ kind: "progression", status: "Start", ...level });
		if (r.bossDefeated) out.push({ kind: "progression", status: "Complete", ...level });
		else if (r.endReason === "death") {
			out.push({ kind: "progression", status: "Fail", ...level, fields: { field01: r.deathCause ?? "unknown" } });
		}
	}

	const cause = r.deathCause ?? "none";
	out.push({
		kind: "custom",
		name: ANALYTICS_EVENT.runEnded,
		value: seconds(r.aliveTicks),
		fields: { field01: r.endReason, field02: `phase${r.bossPhaseReached}`, field03: cause },
	});
	out.push({ kind: "custom", name: ANALYTICS_EVENT.runDuration, value: seconds(r.ticks) });
	if (r.deathTick !== undefined) {
		const atBoss = r.bossEngagedTick !== undefined && r.bossEngagedTick <= r.deathTick;
		out.push({
			kind: "custom",
			name: ANALYTICS_EVENT.playerDeath,
			value: seconds(r.deathTick),
			fields: { field01: cause, field02: atBoss ? "boss" : "rooms" },
		});
	}
	out.push({ kind: "custom", name: ANALYTICS_EVENT.runKills, value: r.kills });
	// Sorted by source so the order is stable (Map iteration order is not in Luau).
	const sources: string[] = [];
	for (const [k] of r.hitsBySource) sources.push(k);
	sources.sort((a, b) => a < b);
	for (const source of sources) {
		out.push({
			kind: "custom",
			name: ANALYTICS_EVENT.hitsTaken,
			value: r.hitsBySource.get(source) ?? 0,
			fields: { field01: source },
		});
	}
	out.push({ kind: "custom", name: ANALYTICS_EVENT.heartsLost, value: r.heartsLostTotal });
	out.push({ kind: "custom", name: ANALYTICS_EVENT.weaponSwaps, value: r.weaponSwaps });
	out.push({ kind: "custom", name: ANALYTICS_EVENT.flasksUsed, value: r.flasksUsed });
	out.push({ kind: "custom", name: ANALYTICS_EVENT.embersUsed, value: r.embersUsed });
	out.push({ kind: "custom", name: ANALYTICS_EVENT.rollsStarted, value: r.rollsStarted });
	if (r.bossAttempts > 0) {
		out.push({
			kind: "custom",
			name: ANALYTICS_EVENT.bossAttempt,
			value: r.bossAttempts,
			fields: { field01: r.bossDefeated ? "victory" : r.endReason },
		});
	}
	return out;
}

/** The analytics event for a rejected submission (bucketed by reject code only). */
export function analyticsForRejection(code: RunRejectCode | SegmentRejectCode): AnalyticsEventSpec {
	return { kind: "custom", name: ANALYTICS_EVENT.runRejected, value: 1, fields: { field01: code } };
}

/**
 * Events for a player's whole server session (logged when they leave). field01 of SessionEnded: "retried" (some
 * death was followed by another run), "quitAfterDeath" (died and never retried), "noDeaths".
 */
export function analyticsForSession(s: Readonly<RunSessionSummary>): AnalyticsEventSpec[] {
	if (s.runs === 0) return [];
	let retry = "noDeaths";
	if (s.deaths > 0) retry = s.retriesAfterDeath > 0 ? "retried" : "quitAfterDeath";
	return [
		{ kind: "custom", name: ANALYTICS_EVENT.sessionEnded, value: s.aliveSeconds, fields: { field01: retry } },
		{ kind: "custom", name: ANALYTICS_EVENT.sessionRuns, value: s.runs },
		{ kind: "custom", name: ANALYTICS_EVENT.sessionRetriesAfterDeath, value: s.retriesAfterDeath },
		{ kind: "custom", name: ANALYTICS_EVENT.sessionLongestRetryStreak, value: s.longestRetryStreak },
	];
}

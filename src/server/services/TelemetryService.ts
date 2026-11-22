import { OnStart, Service } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { AnalyticsService, Players, Workspace } from "@rbxts/services";
import { serverLogger } from "server/log";
import { Events } from "server/network";
import { DEV_MODE } from "shared/config";
import { ANALYTICS_DEBUG_ATTRIBUTE, TUTORIAL_FUNNEL, describeAnalyticsSpec } from "shared/onboarding";
import {
	RUN_FUNNEL,
	RUN_RECAP_RATE,
	RunRecapGate,
	SlidingWindowLimiter,
	analyticsForDailyFinish,
	analyticsForDailyStart,
	analyticsForRejection,
	analyticsForRun,
	analyticsForRunRecap,
	analyticsForSession,
	localeAnalytics,
	readRunRecapReport,
	summarizeRunSession,
	type AnalyticsEventSpec,
	type AnalyticsFields,
	type LocaleAnalytics,
	type RunTelemetryRecord,
} from "shared/run";
import { languageOverride, resolveDisplaySettings } from "shared/settings";
import { describeEconomyEvent, type EconomyEventSpec } from "shared/wallet";
import { RecordsService } from "./RecordsService";
import { RunValidationService } from "./RunValidationService";
import { SettingsService } from "./SettingsService";

const log = serverLogger("Telemetry");

/**
 * Playtest telemetry on Roblox (replaces the web build's F9 JSON export, docs/PLAYTEST.md): AnalyticsService funnel,
 * progression and custom events, derived SERVER-SIDE from the validated replay of each run (shared/run telemetry.ts
 * and analytics.ts). The client sends no telemetry at all, so it cannot forge any: a rejected run only produces a
 * `RunRejected` event bucketed by reject code. Event names: docs/SERVER.md.
 *
 * Per player it also keeps the session's accepted runs and logs the session events (retry after death, the Fun-gate
 * signal) when the player leaves. A run still validating when its player leaves belongs to that session: the summary
 * waits for it (RunValidationService `waitUntilIdle`), then the player's entry is dropped; nothing is kept for a
 * departed player after that.
 *
 * The one exception to "server-derived only": the tutorial / onboarding telemetry (docs/TUTORIAL_FUNNEL.md):
 * `logTutorial` (the `TutorialAttempt` funnel and its custom events, funnel session id = the attempt id) and
 * `logOnboarding` (the once-per-user onboarding funnel, OnboardingGate, the new-player events), fed by OnboardingService
 * from the client's tutorial remotes, filtered and bounded by shared/onboarding PlayerTutorialTelemetry. It is drop-off
 * data for a practice mode with nothing to win, so it is taken as reported within those bounds (TFD7).
 *
 * Debug echo (TF8): with the Workspace attribute ANALYTICS_DEBUG_ATTRIBUTE (`KV_AnalyticsDebug`) = true (off by
 * default; read on every log, so it can be toggled mid-session) every spec this service logs is also printed
 * (`[Telemetry] ANALYTICS: ...`, shared/onboarding describeAnalyticsSpec), live servers included. Studio sends nothing
 * to AnalyticsService, so this is how a Studio session shows what would be sent.
 *
 * The Daily's events (`daily_start` / `daily_retry` / `daily_finish`, shared/run dailyAnalytics.ts) come from
 * RecordsService `onDailyActivity`: server-side session starts and accepted runs, with the attempt number and the
 * returning flag kept in the records doc.
 *
 * Locale (docs/LOCALIZATION.md L14): each run's RunStarted funnel step carries the player's bucketed locale
 * (shared/run localeAnalytics), from the server's own view: `Player.LocaleId`, the stored Options > Language override
 * (SettingsService) and the developer attribute (DevModeService). The client reports nothing.
 *
 * The run-over recap (docs/RUN_RECAP.md RR9, shared/run recapAnalytics.ts), the second client fact: `runRecap(report)`
 * says how the player left a run-over panel (retry / exit / lobby, seconds open, the near-miss shown, record /
 * skipped, a party run's team moments and, docs/RUN_CONTRIBUTION.md CT8, its tab views). Rate limited
 * (RUN_RECAP_RATE), re-read (readRunRecapReport) and taken at most once per run session RunSessionService issued to the
 * player (`runIssued` -> RunRecapGate), then logged as `RunRecap`.
 * Analytics only: nothing else reads it.
 *
 * Silver's economy (docs/SILVER.md SV10, shared/wallet analytics.ts): WalletService hands over `logEconomy` specs, one
 * `LogEconomyEvent` Source per non-zero part of a grant (the run rows, Prospector and the top-up as Gameplay, the day
 * bonuses as TimedReward) and one Sink per purchase (Shop), plus the `ArmoryPurchase` custom event through
 * `logEvents`. Built from the transaction's result, never from a client claim. Every purchase also logs one `Purchase`
 * (docs/SHOP_ANALYTICS.md: the kind, the currency and the item), from WalletService, SilverShopService and
 * CosmeticPassService.
 */
@Service({})
export class TelemetryService implements OnStart {
	private readonly janitor = new Janitor();
	private readonly sessions = new Map<Player, RunTelemetryRecord[]>();
	/** Players between PlayerRemoving and their session summary: their late runs still join the session. */
	private readonly leaving = new Set<Player>();
	/** Run sessions issued per player, one recap report each (RR9). */
	private readonly recapGate = new RunRecapGate<Player>();
	private readonly recapLimiter = new SlidingWindowLimiter<Player>(
		RUN_RECAP_RATE.count,
		RUN_RECAP_RATE.windowSeconds,
	);

	constructor(
		private readonly runs: RunValidationService,
		private readonly records: RecordsService,
		private readonly settings: SettingsService,
	) {}

	onStart(): void {
		this.janitor.Add(
			this.runs.onRunAccepted((player, run) => {
				if (player.Parent !== undefined || this.leaving.has(player)) {
					const list = this.sessions.get(player) ?? [];
					list.push(run.telemetry);
					this.sessions.set(player, list);
				}
				this.logAll(player, analyticsForRun(run.telemetry, this.localeOf(player)), run.runId);
			}),
		);
		// The Daily (docs/DAILY.md DS13): RecordsService reports each daily start and accepted daily run with the
		// player's attempt number and returning flag (from the records doc's daily activity).
		this.janitor.Add(
			this.records.onDailyActivity((player, event) =>
				this.logAll(
					player,
					event.kind === "start" ? analyticsForDailyStart(event.facts) : analyticsForDailyFinish(event.facts),
					undefined,
				),
			),
		);
		this.janitor.Add(
			this.runs.onRunRejected((player, code) => this.logAll(player, [analyticsForRejection(code)], undefined)),
		);
		this.janitor.Add(Events.runRecap.connect((player, report) => this.runRecap(player, report)));
		this.janitor.Add(
			Players.PlayerRemoving.Connect((player) => {
				this.recapGate.forget(player);
				this.recapLimiter.forget(player);
				this.leaving.add(player);
				task.spawn(() => this.endSession(player));
			}),
		);
	}

	/**
	 * Logs custom / funnel / progression events that are not derived from a run's replay (LobbyService: shared/lobby
	 * analytics.ts). Each failing call is logged and skipped.
	 */
	logEvents(player: Player, specs: ReadonlyArray<AnalyticsEventSpec>): void {
		this.logAll(player, specs, undefined);
	}

	/**
	 * RunSessionService: run session `runId` started with these members (solo: the owner). Each may send one
	 * `runRecap` for it (RR9).
	 */
	runIssued(runId: string, memberIds: ReadonlyArray<number>): void {
		for (const id of memberIds) {
			const player = Players.GetPlayerByUserId(id);
			if (player !== undefined) this.recapGate.issue(player, runId);
		}
	}

	/** `runRecap` (RR9): rate limit, re-read, one per issued run session, then `RunRecap`. */
	private runRecap(player: Player, raw: unknown): void {
		if (player.Parent === undefined || !this.recapLimiter.tryAcquire(player, os.clock())) return;
		const report = readRunRecapReport(raw);
		if (report === undefined) {
			log.warn("BAD_RECAP_REPORT", `${player.UserId}: runRecap dropped`);
			return;
		}
		if (!this.recapGate.take(player, report.runId)) return; // not this player's run, or already reported
		this.logAll(player, analyticsForRunRecap(report), undefined);
	}

	/** The player's locale fields (LocaleAnalytics) as the server sees them. */
	private localeOf(player: Player): LocaleAnalytics {
		const language = resolveDisplaySettings(this.settings.getOverrides(player)?.display).language;
		const dev = player.GetAttribute(DEV_MODE.allowedAttribute) === true;
		return localeAnalytics([player.LocaleId], languageOverride(language, dev), dev);
	}

	/** Waits for the player's runs still validating, then logs the session summary and forgets the player. */
	private endSession(player: Player): void {
		this.runs.waitUntilIdle(player);
		this.leaving.delete(player);
		const list = this.sessions.get(player);
		this.sessions.delete(player);
		if (list) this.logAll(player, analyticsForSession(summarizeRunSession(list)), undefined);
	}

	/**
	 * First-run tutorial telemetry (shared/onboarding funnel.ts specs), funnel session id = the tutorial attempt id.
	 * Callers pass only what TutorialFunnelTracker accepted.
	 */
	logTutorial(player: Player, specs: ReadonlyArray<AnalyticsEventSpec>, attemptId: string): void {
		this.logAll(player, specs, attemptId);
	}

	/**
	 * Onboarding telemetry with no funnel session (shared/onboarding: the onboarding funnel `LogOnboardingFunnelStepEvent`,
	 * OnboardingGate, TutorialOutroChoice, the new-player events). Callers pass only what the trackers accepted.
	 */
	logOnboarding(player: Player, specs: ReadonlyArray<AnalyticsEventSpec>): void {
		this.logAll(player, specs, undefined);
	}

	/**
	 * Silver's economy events (WalletService, shared/wallet grantEconomyEvents / purchaseEconomyEvent), in order; one
	 * failing call never stops the rest. Echoed like every spec under ANALYTICS_DEBUG_ATTRIBUTE.
	 */
	logEconomy(player: Player, specs: ReadonlyArray<EconomyEventSpec>): void {
		const echo = Workspace.GetAttribute(ANALYTICS_DEBUG_ATTRIBUTE) === true;
		for (const spec of specs) {
			if (echo) log.info("ANALYTICS", `${player.UserId} ${describeEconomyEvent(spec)}`);
			const [ok, err] = pcall(() =>
				AnalyticsService.LogEconomyEvent(
					player,
					spec.flow === "Source" ? Enum.AnalyticsEconomyFlowType.Source : Enum.AnalyticsEconomyFlowType.Sink,
					spec.currency,
					spec.amount,
					spec.endingBalance,
					spec.transactionType,
					spec.itemSku,
				),
			);
			if (!ok) log.warn("ANALYTICS_FAILED", `economy event: ${tostring(err)}`);
		}
	}

	/** Logs specs in order; one failing call (bad field, throttling) never stops the rest. */
	protected logAll(player: Player, specs: ReadonlyArray<AnalyticsEventSpec>, funnelSessionId: string | undefined) {
		const echo = Workspace.GetAttribute(ANALYTICS_DEBUG_ATTRIBUTE) === true;
		for (const spec of specs) {
			if (echo) log.info("ANALYTICS", `${player.UserId} ${describeAnalyticsSpec(spec, funnelSessionId)}`);
			const [ok, err] = pcall(() => this.logOne(player, spec, funnelSessionId));
			if (!ok) log.warn("ANALYTICS_FAILED", `${spec.kind} event: ${tostring(err)}`);
		}
	}

	protected logOne(player: Player, spec: AnalyticsEventSpec, funnelSessionId: string | undefined): void {
		const fields = customFields(spec.fields);
		if (spec.kind === "custom") {
			AnalyticsService.LogCustomEvent(player, spec.name, spec.value, fields);
		} else if (spec.kind === "funnel") {
			const sessionId =
				spec.funnel === RUN_FUNNEL || spec.funnel === TUTORIAL_FUNNEL ? funnelSessionId : undefined;
			AnalyticsService.LogFunnelStepEvent(player, spec.funnel, sessionId, spec.step, spec.stepName, fields);
		} else if (spec.kind === "onboarding") {
			AnalyticsService.LogOnboardingFunnelStepEvent(player, spec.step, spec.stepName, fields);
		} else {
			const status =
				spec.status === "Start"
					? Enum.AnalyticsProgressionType.Start
					: spec.status === "Complete"
					? Enum.AnalyticsProgressionType.Complete
					: Enum.AnalyticsProgressionType.Fail;
			AnalyticsService.LogProgressionEvent(player, spec.path, status, spec.level, spec.levelName, fields);
		}
	}
}

/** AnalyticsService's customFields dictionary (keys are AnalyticsCustomFieldKeys names), or undefined. */
function customFields(f: AnalyticsFields | undefined): Record<string, string> | undefined {
	if (!f) return undefined;
	const out: Record<string, string> = {};
	if (f.field01 !== undefined) out[Enum.AnalyticsCustomFieldKeys.CustomField01.Name] = f.field01;
	if (f.field02 !== undefined) out[Enum.AnalyticsCustomFieldKeys.CustomField02.Name] = f.field02;
	if (f.field03 !== undefined) out[Enum.AnalyticsCustomFieldKeys.CustomField03.Name] = f.field03;
	return out;
}

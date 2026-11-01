/**
 * Per-player tutorial / onboarding telemetry orchestration (docs/TUTORIAL_FUNNEL.md TF5, TF7): which tracker gets
 * which message, what a leave logs, how the join entry is settled, and the new-player window's join / run rules. Pure:
 * OnboardingService keeps one PlayerTutorialTelemetry per player per server session, feeds it the remotes (raw, it
 * re-reads them with reports.ts) and the facts it knows (doc load, join intent, clock), and logs the batches it
 * returns through TelemetryService (`logTutorial` with the batch's attempt id, else `logOnboarding`).
 *
 * The JOIN ENTRY (onboarding funnel step 1 field01, OnboardingEntry) comes from the server's `joinIntent`
 * (InviteService -> OnboardingService.joinIntent): `lobby` -> invited, `party` -> party (both final at once: an intent
 * is never downgraded), `none` -> organic, but only once the intent can no longer be upgraded
 * (ONBOARDING_ENTRY_WAIT_SECONDS after join = INVITE.launchDataWaitSeconds + intentUpgradeMarginSeconds; the service
 * calls `poll` then). No intent at all by then: `unknown`. A player who leaves first logs the latest intent's entry,
 * or `unknown` without one (OnboardingFunnelTracker.leaving).
 *
 * Attempt rules beyond the trackers' own (documented choices):
 *   - A start that replaces an open attempt logs TutorialRestarted for it when the new entry is `restart`. Any other
 *     entry replacing an open attempt (a client that lost its attempt without a finish: a dropped or rate-limited
 *     message, a client bug) logs NOTHING for the replaced attempt: it was not a leave or a party run, so neither
 *     TutorialAbandoned kind fits; the attempt funnel still shows where it stopped. `start` reports it
 *     (`replacedUnlogged`) so the service can warn.
 *   - The outro's TutorialOutroChoice value is the SERVER-measured seconds (TutorialFunnelTracker.takeOutro from the
 *     completed finish to the report, on the service's clock), never the client's number: the report's own seconds
 *     are ignored (they include nothing the server cannot see, and cannot be inflated).
 *   - A leave: an open attempt logs TutorialAbandoned `leave`; else an open outro logs TutorialOutroChoice `left`.
 *     A party run taking the player (`partyRun`) logs TutorialAbandoned `partyRun` for an open attempt only.
 *   - The gate report logs OnboardingGate once per session; `gateContradiction` names a reason that contradicts what
 *     the server knows (the service warns but logs it anyway: the client saw what it saw).
 *   - A finish payload that is a bare outcome string (an older client during a rollout) is accepted without a step id.
 */
import { INVITE, type ArrivalJoinIntent } from "shared/invite";
import { LEADERBOARD_DAILY_WORLDS, LEADERBOARD_ELIGIBLE_WORLDS } from "shared/leaderboard";
import type { AnalyticsEventSpec } from "shared/run";
import { isTutorialOutcome, type OnboardingDoc, type TutorialOutcome } from "./doc";
import {
	TutorialFunnelTracker,
	tutorialAbandonedEvents,
	tutorialAttemptStartEvents,
	tutorialFinishEvents,
	tutorialLessonReportEvents,
	tutorialOutroEvents,
	tutorialRestartedEvents,
	tutorialStepEvent,
	tutorialStuckEvents,
	type TutorialAttemptEnd,
} from "./funnel";
import { firstDayPatch, newPlayerReturn, type NewPlayerUpdate } from "./newPlayer";
import { OnboardingFunnelTracker, type OnboardingJoinFacts } from "./onboardingFunnel";
import {
	DEFAULT_TUTORIAL_START_INFO,
	TUTORIAL_OUTRO_LEFT,
	readFinishInfo,
	readLessonReport,
	readOnboardingReport,
	readStuckReport,
	readTutorialStartInfo,
	type OnboardingEntry,
	type OnboardingGateReason,
	type TutorialStartInfo,
} from "./reports";

/**
 * Seconds after join until a `none` join intent is final (InviteService upgrades none -> lobby / party only within
 * INVITE.launchDataWaitSeconds + intentUpgradeMarginSeconds of PlayerAdded): then Joined logs `organic`, or `unknown`
 * when no intent came at all.
 */
export const ONBOARDING_ENTRY_WAIT_SECONDS = INVITE.launchDataWaitSeconds + INVITE.intentUpgradeMarginSeconds;

/** Events to log together; `attemptId` set = the attempt funnel's session id (TelemetryService.logTutorial). */
export interface TelemetryBatch {
	readonly specs: AnalyticsEventSpec[];
	readonly attemptId?: string;
}

/** What OnboardingService knows at the end of the join load. */
export interface PlayerJoinFacts extends OnboardingJoinFacts {
	/** isTutorialDone of the loaded doc (false after a failed load). */
	readonly done: boolean;
}

/** What `start` did. */
export interface TutorialStartResult {
	readonly batches: TelemetryBatch[];
	/** The start info used (the payload's, or DEFAULT_TUTORIAL_START_INFO when it was missing or malformed). */
	readonly info: TutorialStartInfo;
	/** The payload was unusable and the default was assumed. */
	readonly defaulted: boolean;
	/** An open attempt was replaced by a non-restart start and logged nothing (see the module comment). */
	readonly replacedUnlogged?: TutorialAttemptEnd;
}

/** What `finish` did. */
export interface TutorialFinishResult {
	readonly outcome: TutorialOutcome;
	readonly batches: TelemetryBatch[];
	/** The closed attempt, or undefined when none was open. */
	readonly ended?: TutorialAttemptEnd;
}

/** What `report` did. */
export interface OnboardingReportResult {
	readonly batches: TelemetryBatch[];
	/** The report's kind, or undefined when the payload was unusable (dropped). */
	readonly kind?: "loaded" | "gate" | "outro";
	/** For a gate report: why it contradicts what the server knows (logged anyway), or undefined. */
	readonly contradiction?: string;
}

/** The onboarding entry of a join intent: none -> organic, lobby -> invited, party -> party. */
export function onboardingEntryOfIntent(intent: ArrivalJoinIntent): OnboardingEntry {
	return intent === "lobby" ? "invited" : intent === "party" ? "party" : "organic";
}

export function isArrivalJoinIntent(v: unknown): v is ArrivalJoinIntent {
	return v === "none" || v === "lobby" || v === "party";
}

/** What the server knows when a gate report comes in. */
export interface GateFacts {
	/** The join load's facts, or undefined while it has not ended. */
	readonly join?: PlayerJoinFacts;
	/** The latest join intent, or undefined before any. */
	readonly intent?: ArrivalJoinIntent;
}

/**
 * Why gate `reason` contradicts the server's facts, or undefined (also when the server cannot tell: `timeout` and
 * `forced` are never checked; doc facts only once the join load ended):
 *   done        the load succeeded and the doc is not done
 *   tutorial    the load failed (the client must not force it), or the doc is done
 *   loadFailed  the load succeeded
 *   invited     the server sent no `lobby` intent (none, party, or nothing)
 *   party       the server sent no `party` intent
 */
export function gateContradiction(reason: OnboardingGateReason, facts: GateFacts): string | undefined {
	const join = facts.join;
	if (reason === "invited" && facts.intent !== "lobby") return `server intent ${facts.intent ?? "unknown"}`;
	if (reason === "party" && facts.intent !== "party") return `server intent ${facts.intent ?? "unknown"}`;
	if (join === undefined) return undefined;
	if (reason === "done" && join.loaded && !join.done) return "server doc not done";
	if (reason === "tutorial" && !join.loaded) return "server load failed";
	if (reason === "tutorial" && join.done) return "server doc done";
	if (reason === "loadFailed" && join.loaded) return "server load succeeded";
	return undefined;
}

function batch(specs: AnalyticsEventSpec[], attemptId?: string): TelemetryBatch[] {
	if (specs.size() === 0) return [];
	return attemptId !== undefined ? [{ specs, attemptId }] : [{ specs }];
}

/** Appends `more` to `out` in place (roblox-ts: no spread into push). */
function append(out: TelemetryBatch[], more: ReadonlyArray<TelemetryBatch>): void {
	for (const b of more) out.push(b);
}

export class PlayerTutorialTelemetry {
	private readonly attempt = new TutorialFunnelTracker();
	private readonly onboarding = new OnboardingFunnelTracker();
	private joinFacts: PlayerJoinFacts | undefined;
	private intent: ArrivalJoinIntent | undefined;
	private entrySent = false;
	private left = false;

	/** `joinedAt`: the service's clock (seconds) at PlayerAdded; the entry deadline counts from it. */
	constructor(private readonly joinedAt: number, private readonly entryWaitSeconds = ONBOARDING_ENTRY_WAIT_SECONDS) {}

	/** The clock time after which a `none` (or missing) intent settles the entry (call `poll` then). */
	entryDeadline(): number {
		return this.joinedAt + this.entryWaitSeconds;
	}

	/** True while an attempt is open (the player is in the tutorial: busy for lobbies). */
	isInTutorial(): boolean {
		return this.attempt.isActive();
	}

	/** The open attempt's id, or undefined. */
	getAttemptId(): string | undefined {
		return this.attempt.getAttemptId();
	}

	/** The latest join intent (never downgraded), or undefined. */
	getIntent(): ArrivalJoinIntent | undefined {
		return this.intent;
	}

	/** The join load ended (once; later calls are ignored). */
	join(facts: PlayerJoinFacts): TelemetryBatch[] {
		if (this.joinFacts !== undefined || this.left) return [];
		this.joinFacts = { loaded: facts.loaded, fresh: facts.loaded && facts.fresh, done: facts.done };
		return batch(this.onboarding.join(this.joinFacts));
	}

	/**
	 * The server sent a join intent at `now`: `lobby` / `party` settle the entry at once; `none` is kept and settles it
	 * at the deadline (`poll`). A later `none` never replaces a lobby / party intent.
	 */
	joinIntent(intent: unknown, now: number): TelemetryBatch[] {
		if (!isArrivalJoinIntent(intent) || this.left) return [];
		if (this.intent === undefined || this.intent === "none") this.intent = intent;
		if (this.intent !== "none") return this.sendEntry(onboardingEntryOfIntent(this.intent));
		return this.poll(now);
	}

	/** At or after the deadline, settles the entry from the latest intent (`unknown` without one). */
	poll(now: number): TelemetryBatch[] {
		if (this.entrySent || this.left || now < this.entryDeadline()) return [];
		return this.sendEntry(this.intent !== undefined ? onboardingEntryOfIntent(this.intent) : "unknown");
	}

	/** `tutorialStarted(raw)` with the server-generated attempt id (the caller checked busy / party run / budget). */
	start(attemptId: string, raw: unknown): TutorialStartResult {
		const read = readTutorialStartInfo(raw);
		const info = read ?? { entry: DEFAULT_TUTORIAL_START_INFO.entry, device: DEFAULT_TUTORIAL_START_INFO.device };
		const replaced = this.attempt.start(attemptId, info);
		const batches: TelemetryBatch[] = [];
		let replacedUnlogged: TutorialAttemptEnd | undefined;
		if (replaced !== undefined) {
			if (info.entry === "restart") append(batches, batch(tutorialRestartedEvents(replaced), replaced.attemptId));
			else replacedUnlogged = replaced;
		}
		append(batches, batch(tutorialAttemptStartEvents(info), attemptId));
		append(batches, batch(this.onboarding.tutorialStarted(info.entry)));
		return { batches, info, defaulted: read === undefined, replacedUnlogged };
	}

	/** `tutorialStep(step)`: the attempt funnel step (step + 1) when accepted, and the onboarding lesson (step + 3). */
	step(step: unknown): TelemetryBatch[] {
		const attemptId = this.attempt.getAttemptId();
		if (attemptId === undefined || !typeIs(step, "number") || !this.attempt.accept(step)) return [];
		return [...batch([tutorialStepEvent(step)], attemptId), ...batch(this.onboarding.lesson(step))];
	}

	/** `tutorialLesson(raw)`: TutorialLessonTime / TutorialLessonHits, once per lesson per attempt. */
	lesson(raw: unknown): TelemetryBatch[] {
		const r = readLessonReport(raw);
		const info = this.attempt.getInfo();
		const attemptId = this.attempt.getAttemptId();
		if (r === undefined || info === undefined || attemptId === undefined) return [];
		if (!this.attempt.acceptLessonReport(r)) return [];
		return batch(tutorialLessonReportEvents(r, info), attemptId);
	}

	/** `tutorialStuck(raw)`: TutorialStuck, once per prompt per attempt. */
	stuck(raw: unknown): TelemetryBatch[] {
		const r = readStuckReport(raw);
		const info = this.attempt.getInfo();
		const attemptId = this.attempt.getAttemptId();
		if (r === undefined || info === undefined || attemptId === undefined) return [];
		if (!this.attempt.acceptStuckReport(r)) return [];
		return batch(tutorialStuckEvents(r, info), attemptId);
	}

	/** `onboardingReport(raw)` at `now` (the clock `finish` got). */
	report(raw: unknown, now: number): OnboardingReportResult {
		const r = readOnboardingReport(raw);
		if (r === undefined) return { batches: [] };
		if (r.kind === "loaded") return { kind: "loaded", batches: batch(this.onboarding.loaded()) };
		if (r.kind === "gate") {
			const contradiction = gateContradiction(r.reason, { join: this.joinFacts, intent: this.intent });
			return { kind: "gate", batches: batch(this.onboarding.gate(r.reason)), contradiction };
		}
		const outro = this.attempt.takeOutro(now);
		if (outro === undefined) return { kind: "outro", batches: [] };
		return { kind: "outro", batches: batch(tutorialOutroEvents(r.choice, outro.seconds, outro.entry)) };
	}

	/**
	 * `tutorialFinished(raw)` at `now`: notes the step id, closes the attempt (a completion opens the outro), logs the
	 * finish and closes the onboarding funnel (Completed for a completion). Undefined when the payload is unusable
	 * (nothing changes).
	 */
	finish(raw: unknown, now: number): TutorialFinishResult | undefined {
		let outcome: TutorialOutcome;
		const info = readFinishInfo(raw);
		if (info !== undefined) {
			outcome = info.outcome;
			this.attempt.noteStepId(info.stepId);
		} else if (isTutorialOutcome(raw)) {
			outcome = raw;
		} else {
			return undefined;
		}
		const ended = this.attempt.finish(outcome, now);
		const batches: TelemetryBatch[] = [];
		if (ended !== undefined) append(batches, batch(tutorialFinishEvents(outcome, ended), ended.attemptId));
		if (outcome === "completed") append(batches, batch(this.onboarding.completed()));
		else this.onboarding.skipped();
		return { outcome, batches, ended };
	}

	/** A rate-limited finish: the attempt (and any outro) closes unlogged; the player is out of the tutorial. */
	dropAttempt(): void {
		this.attempt.clear();
	}

	/** A party run took the player: an open attempt logs TutorialAbandoned `partyRun`. */
	partyRun(): TelemetryBatch[] {
		const ended = this.attempt.abandon();
		return ended !== undefined ? batch(tutorialAbandonedEvents(ended, "partyRun"), ended.attemptId) : [];
	}

	/**
	 * The player is leaving at `now` (once): Joined if still owed (the latest intent's entry, else `unknown`), then an
	 * open attempt's TutorialAbandoned `leave`, else an open outro's TutorialOutroChoice `left`. Nothing after it.
	 */
	leaving(now: number): TelemetryBatch[] {
		if (this.left) return [];
		const out: TelemetryBatch[] = [];
		if (!this.entrySent && this.intent !== undefined) {
			append(out, this.sendEntry(onboardingEntryOfIntent(this.intent)));
		}
		append(out, batch(this.onboarding.leaving()));
		this.left = true;
		const ended = this.attempt.abandon();
		if (ended !== undefined) {
			append(out, batch(tutorialAbandonedEvents(ended, "leave"), ended.attemptId));
		} else {
			const outro = this.attempt.takeOutro(now);
			if (outro !== undefined)
				append(out, batch(tutorialOutroEvents(TUTORIAL_OUTRO_LEFT, outro.seconds, outro.entry)));
		}
		return out;
	}

	private sendEntry(entry: OnboardingEntry): TelemetryBatch[] {
		if (this.entrySent) return [];
		this.entrySent = true;
		return batch(this.onboarding.entryKnown(entry));
	}
}

// --- the new-player window (TF7) -----------------------------------------------------------------------------------

/**
 * Which session starts / accepted runs count in the new-player window: the ranked worlds (the all-time boards'
 * LEADERBOARD_ELIGIBLE_WORLDS, the endless descent) and the Daily (LEADERBOARD_DAILY_WORLDS); never debug runs, never
 * Studio (RecordsService's rule: Studio counts only on its explicit test path, here the KV_AnalyticsDebug echo, which
 * the caller folds into `studio`). Refused worlds (tutorial, dev) never reach a session start.
 */
export const NEW_PLAYER_RUN_POLICY = table.freeze({
	worlds: table.freeze([...LEADERBOARD_ELIGIBLE_WORLDS, ...LEADERBOARD_DAILY_WORLDS]) as ReadonlyArray<string>,
	countDebug: false,
	countStudio: false,
});

/** A session start's or accepted run's facts for the window rule. */
export interface NewPlayerRunContext {
	readonly worldKind: string;
	readonly debug: boolean;
	/** Studio, and not on the explicit Studio test path (the caller decides). */
	readonly studio: boolean;
}

/** True when a session start / accepted run counts in the new-player window (NEW_PLAYER_RUN_POLICY). */
export function newPlayerRunCounts(ctx: Readonly<NewPlayerRunContext>): boolean {
	if (!NEW_PLAYER_RUN_POLICY.worlds.includes(ctx.worldKind)) return false;
	if (ctx.debug && !NEW_PLAYER_RUN_POLICY.countDebug) return false;
	if (ctx.studio && !NEW_PLAYER_RUN_POLICY.countStudio) return false;
	return true;
}

/**
 * A successful join load on UTC day `today`: firstDay set for a fresh doc (firstDayPatch), then NewPlayerReturned when
 * due (newPlayerReturn, on the patched doc: never on the first day itself). The events and the doc to store, or
 * undefined when nothing changes. Call it only after a SUCCESSFUL load.
 */
export function newPlayerJoin(doc: Readonly<OnboardingDoc>, today: number): NewPlayerUpdate | undefined {
	const patched = firstDayPatch(doc, today);
	const base = patched ?? doc;
	const returned = newPlayerReturn(base, today);
	if (returned !== undefined) return returned;
	return patched !== undefined ? { events: [], doc: patched } : undefined;
}

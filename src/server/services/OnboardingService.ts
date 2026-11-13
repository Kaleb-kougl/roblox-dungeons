import { OnStart, Service } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { HttpService, Players, RunService, Workspace } from "@rbxts/services";
import { serverLogger } from "server/log";
import { Events } from "server/network";
import type { ArrivalJoinIntent } from "shared/invite";
import {
	ANALYTICS_DEBUG_ATTRIBUTE,
	BESTIARY_SEEN_RATE,
	ONBOARDING_AUTOSAVE_SECONDS,
	ONBOARDING_CODEC,
	ONBOARDING_DATASTORE_NAME,
	ONBOARDING_REQUEST_RATE,
	ONBOARDING_RESET_ATTRIBUTE,
	ONBOARDING_RETRY,
	PlayerTutorialTelemetry,
	SECONDS_PER_DAY,
	TUTORIAL_FINISH_RATE,
	TUTORIAL_REPORT_RATE,
	TUTORIAL_START_RATE,
	TUTORIAL_STEP_RATE,
	emptyOnboardingDoc,
	finishedOnboardingDoc,
	isSightingId,
	isTutorialDone,
	isTutorialStepNumber,
	newPlayerJoin,
	newPlayerRunAccepted,
	newPlayerRunCounts,
	newPlayerRunStart,
	onboardingStatusOf,
	seenOf,
	withSeenId,
	type NewPlayerRunFacts,
	type OnboardingDoc,
	type TelemetryBatch,
	type TutorialOutcome,
} from "shared/onboarding";
import { SlidingWindowLimiter, type AnalyticsEventSpec } from "shared/run";
import { PlayerDocCache, playerDataKey, type KeyValueStore } from "shared/settings";
import { DataStoreKeyValue } from "./data/DataStoreKeyValue";
import { RunValidationService } from "./RunValidationService";
import { TelemetryService } from "./TelemetryService";

const log = serverLogger("Onboarding");

/** BindToClose: give up waiting for the last saves after this many seconds (Roblox allows about 30). */
const SHUTDOWN_SAVE_TIMEOUT_SECONDS = 25;
const SHUTDOWN_POLL_SECONDS = 0.1;

/**
 * Where a player's join load stands (joinLoadState): still running (or the player left), finished OK, or failed (the
 * stored doc is unknown this session).
 */
export type OnboardingJoinLoad = "pending" | "loaded" | "failed";

/** A session start or accepted run as RunSessionService hands it to the new-player window (TF7). */
export interface NewPlayerRunSubmission {
	readonly worldKind: string;
	readonly debug: boolean;
	/** The members to count: every member for a start, the credited ones (partyContributors) for an accepted run. */
	readonly memberIds: ReadonlyArray<number>;
}

/**
 * First-run tutorial, server side (docs/TUTORIAL.md §5-6, docs/SERVER.md "Onboarding (tutorial)"): whether a player
 * has done the tutorial, the tutorial funnel, and the in-tutorial flag lobbies read (RunSessionService.busyReason).
 *
 * Persistence is SettingsService's pattern on a second DataStore (ONBOARDING_DATASTORE_NAME, key playerDataKey):
 * loaded on join (with retries) into a PlayerDocCache, `onboardingStatus` sent once the load ends, saved when dirty
 * on leave, on BindToClose and every ONBOARDING_AUTOSAVE_SECONDS. A FAILED load sends `{ loaded: false,
 * tutorialDone: false }` (the client then plays normally; a DataStore outage never drags a veteran through the
 * tutorial) and never overwrites the stored value by itself; only a `tutorialFinished` in that session writes, as
 * with a settings change. `tutorialFinished` records `{ tutorialVersion: ONBOARDING_TUTORIAL_VERSION, outcome, at }`
 * and answers with a fresh status. Trust: completion only skips a practice mode, so the client's word is recorded.
 *
 * In-tutorial: `tutorialStarted` opens a funnel attempt (a server GUID as the funnel session id); the player is
 * `isInTutorial` until `tutorialFinished`, leave, or a party run starting with them (RunSessionService calls
 * `leaveTutorial`). A `tutorialStarted` from a player in an unconcluded party run (the `setPartyRunCheck` predicate) is
 * ignored: their client is in the party run, so it is a late message, and it must not mark them busy for lobbies for
 * the rest of the session.
 *
 * Telemetry (docs/TUTORIAL_FUNNEL.md TF5; docs/SERVER.md "Onboarding (tutorial)"): one shared/onboarding
 * PlayerTutorialTelemetry per player (the attempt funnel `TutorialAttempt`, the once-per-user onboarding funnel, the
 * custom events; every rule lives there and is specced headlessly). This service only feeds it and logs its batches
 * through TelemetryService: the join load (`join`), the join intent (`joinIntent`, called by InviteService whenever it
 * sends `joinIntent`; the entry settles at the latest ONBOARDING_ENTRY_WAIT_SECONDS after join via a delayed `poll`),
 * the tutorial remotes, `leaveTutorial` (TutorialAbandoned `partyRun`) and the leave (PlayerRemoving, before the
 * player's state is dropped: Joined if still owed, TutorialAbandoned `leave` or the outro's `left`). The per-player
 * telemetry state is created by whichever comes first, PlayerAdded or InviteService's `joinIntent` (its PlayerAdded
 * handler may run before this service's), so an early intent is kept.
 *
 * New-player window (TF7, shared/onboarding newPlayer.ts): on a successful join load, `newPlayerJoin` (firstDay for a
 * fresh doc, NewPlayerReturned when due) is logged and written; RunSessionService calls `newPlayerRunStarted` per
 * session start (every member) and `newPlayerRunAccepted` per accepted run (the credited members), counted only for
 * NEW_PLAYER_RUN_POLICY's worlds, never debug runs, never Studio unless the KV_AnalyticsDebug echo is on (the explicit
 * Studio test path, as RecordsService's fake). Writes go through the cache like every change and never after a failed
 * join load; a member with no cached doc is skipped. A run can validate AFTER its player left (RunSessionService keeps
 * a finishing run's replay going), so the leave does not drop the doc at once: it saves it, then HOLDS the cached doc
 * and the Player (`departed`) until RunValidationService `waitUntilIdle(player)` (TelemetryService's session summary
 * rule), and only then releases it (saved again when dirty). A run accepted meanwhile logs NewPlayerRun against the held
 * Player and writes the held doc. A rejoin to this server while held reuses the held entry (the newer session owns it:
 * the old hold then leaves it in place). Party members who left are not counted as validating by RunValidationService
 * (only a solo run's finishing owner is), so a party run concluding after a member left still skips that member.
 *
 * Studio only: Workspace attribute ONBOARDING_RESET_ATTRIBUTE (`KV_ResetOnboarding`) = true resets a joining
 * player's loaded doc to empty (saved like any change), so every Studio join is a first join.
 *
 * First sightings (docs/ENEMY_VARIANTS.md EV12): the doc's optional `seen` list (shared/onboarding sightings.ts,
 * under doc version 1). `onboardingStatus` carries it; `bestiarySeen(id)` adds a known id (anything else is ignored;
 * an id already seen changes nothing, so it is idempotent and writes nothing), through the same cache as every
 * change (saved when dirty: autosave, leave, shutdown), never after a FAILED join load (that would overwrite the
 * unknown stored doc, tutorial state included). Updates are merge-safe: a finish keeps `seen` (finishedOnboardingDoc
 * with the cached doc's seenOf) and a sighting keeps the tutorial fields (withSeenId), each read from the cache right
 * before its set with no yield in between.
 * CodexService reads `seen` once for its one-time seed (claude/codex-plan.md), through getDoc once
 * joinLoadState says the join load finished OK.
 *
 * Remotes are re-validated (types, step range; a step's funnel name comes from the shared step list, never from the
 * client; a sighting id against SIGHTING_IDS) and rate limited per player
 * (ONBOARDING_REQUEST_RATE for requests, TUTORIAL_START_RATE for starts, TUTORIAL_FINISH_RATE for finished,
 * TUTORIAL_STEP_RATE for steps, TUTORIAL_REPORT_RATE for `tutorialLesson` / `tutorialStuck` / `onboardingReport`
 * together, BESTIARY_SEEN_RATE for sightings); a rate-limited request or finish still answers with the cached status
 * when loaded, a rate-limited finish still closes the open attempt (no telemetry, nothing written), and a
 * rate-limited start still opens one, unlogged (busy for lobbies, no telemetry). Telemetry volume per player per
 * session is also capped in the pure layer (TUTORIAL_TELEMETRY.maxAttemptsLoggedPerSession / maxEventsPerSession), so
 * a client looping restarts cannot drain the game-wide AnalyticsService budget. Races as in SettingsService: the join load and
 * an early request share one read, and a player who left while a handler yielded is dropped, not cached.
 */
@Service({})
export class OnboardingService implements OnStart {
	private readonly janitor = new Janitor();
	private readonly cache: PlayerDocCache<OnboardingDoc>;
	private readonly requestLimiter = new SlidingWindowLimiter<Player>(
		ONBOARDING_REQUEST_RATE.count,
		ONBOARDING_REQUEST_RATE.windowSeconds,
	);
	private readonly startLimiter = new SlidingWindowLimiter<Player>(
		TUTORIAL_START_RATE.count,
		TUTORIAL_START_RATE.windowSeconds,
	);
	private readonly stepLimiter = new SlidingWindowLimiter<Player>(
		TUTORIAL_STEP_RATE.count,
		TUTORIAL_STEP_RATE.windowSeconds,
	);
	private readonly finishLimiter = new SlidingWindowLimiter<Player>(
		TUTORIAL_FINISH_RATE.count,
		TUTORIAL_FINISH_RATE.windowSeconds,
	);
	private readonly seenLimiter = new SlidingWindowLimiter<Player>(
		BESTIARY_SEEN_RATE.count,
		BESTIARY_SEEN_RATE.windowSeconds,
	);
	private readonly reportLimiter = new SlidingWindowLimiter<Player>(
		TUTORIAL_REPORT_RATE.count,
		TUTORIAL_REPORT_RATE.windowSeconds,
	);
	/** RunSessionService: true while the player is in a party run that is not concluded (setPartyRunCheck). */
	private inPartyRun: (player: Player) => boolean = () => false;
	/** Per player: the tutorial / onboarding telemetry (attempt open = in the tutorial). */
	private readonly trackers = new Map<Player, PlayerTutorialTelemetry>();
	/** Players whose doc is reset to empty once it is loaded (Studio, KV_ResetOnboarding at join). */
	private readonly resetPending = new Set<Player>();
	/** Players whose join load finished (loadAndSend), and whether it succeeded (joinLoadState). */
	private readonly joinLoads = new Map<Player, boolean>();
	/** Players who left, by UserId, whose cached doc is held until their runs finished validating (see above). */
	private readonly departed = new Map<number, Player>();
	private closing = false;

	constructor(private readonly telemetry: TelemetryService, private readonly runs: RunValidationService) {
		this.cache = new PlayerDocCache(
			this.createStore(),
			ONBOARDING_CODEC,
			ONBOARDING_RETRY,
			(s) => task.wait(s),
			(waiter) => task.spawn(waiter),
		);
	}

	onStart(): void {
		this.janitor.Add(Players.PlayerAdded.Connect((player) => this.playerAdded(player)));
		for (const player of Players.GetPlayers()) task.spawn(() => this.playerAdded(player));
		this.janitor.Add(Players.PlayerRemoving.Connect((player) => this.release(player)));

		this.janitor.Add(
			Events.requestOnboarding.connect((player) => {
				if (player.Parent === undefined) return;
				if (!this.allow(this.requestLimiter, player, "request")) {
					this.resync(player);
					return;
				}
				if (this.loadFor(player) !== undefined) this.send(player);
			}),
		);
		this.janitor.Add(
			Events.tutorialStarted.connect((player, info) => {
				if (player.Parent === undefined) return;
				if (this.inPartyRun(player)) {
					log.info("TUTORIAL_START_IGNORED", `${player.UserId}: in a party run`);
					return;
				}
				// Over the start budget: the attempt still opens (busy for lobbies), unlogged.
				const silent = !this.allow(this.startLimiter, player, "tutorialStarted telemetry");
				const attemptId = HttpService.GenerateGUID(false);
				const r = this.trackerFor(player).start(attemptId, info, silent);
				if (r.defaulted) log.warn("BAD_START_INFO", `${player.UserId}: tutorialStarted info defaulted`);
				const replaced = r.replacedUnlogged;
				if (replaced !== undefined) {
					log.warn(
						"ATTEMPT_REPLACED",
						`${player.UserId}: attempt ${replaced.attemptId} replaced by a ${r.info.entry} start (not logged)`,
					);
				}
				this.logBatches(player, r.batches);
				log.info(
					"TUTORIAL_STARTED",
					`${player.UserId} attempt ${attemptId} (${r.info.entry}, ${r.info.device}` +
						`${r.logged ? "" : ", unlogged"})`,
				);
			}),
		);
		this.janitor.Add(
			Events.tutorialStep.connect((player, step) => {
				if (player.Parent === undefined || !this.allow(this.stepLimiter, player, "tutorialStep")) return;
				if (!isTutorialStepNumber(step)) return;
				const tracker = this.trackers.get(player);
				if (tracker !== undefined) this.logBatches(player, tracker.step(step));
			}),
		);
		this.janitor.Add(
			Events.tutorialLesson.connect((player, report) => {
				if (player.Parent === undefined || !this.allow(this.reportLimiter, player, "tutorialLesson")) return;
				const tracker = this.trackers.get(player);
				if (tracker !== undefined) this.logBatches(player, tracker.lesson(report));
			}),
		);
		this.janitor.Add(
			Events.tutorialStuck.connect((player, report) => {
				if (player.Parent === undefined || !this.allow(this.reportLimiter, player, "tutorialStuck")) return;
				const tracker = this.trackers.get(player);
				if (tracker !== undefined) this.logBatches(player, tracker.stuck(report));
			}),
		);
		this.janitor.Add(
			Events.onboardingReport.connect((player, report) => {
				if (player.Parent === undefined || !this.allow(this.reportLimiter, player, "onboardingReport")) return;
				const r = this.trackerFor(player).report(report, this.now());
				if (r.kind === undefined) {
					log.warn("BAD_REPORT", `${player.UserId}: onboardingReport dropped`);
					return;
				}
				if (r.contradiction !== undefined) {
					log.warn("GATE_CONTRADICTS", `${player.UserId}: gate report kept, but ${r.contradiction}`);
				}
				this.logBatches(player, r.batches);
			}),
		);
		this.janitor.Add(
			Events.tutorialFinished.connect((player, info) => {
				if (player.Parent === undefined) return;
				if (!this.allow(this.finishLimiter, player, "tutorialFinished")) {
					// Not recorded, but the player is out of the tutorial (never stuck busy for lobbies).
					this.trackers.get(player)?.dropAttempt();
					this.resync(player);
					return;
				}
				this.finish(player, info);
			}),
		);
		this.janitor.Add(
			Events.bestiarySeen.connect((player, id) => {
				if (player.Parent === undefined || !this.allow(this.seenLimiter, player, "bestiarySeen")) return;
				if (!isSightingId(id)) {
					log.warn("BAD_SIGHTING", `${player.UserId}: bestiarySeen dropped`);
					return;
				}
				this.markSeen(player, id);
			}),
		);

		const autosave = task.spawn(() => {
			for (;;) {
				task.wait(ONBOARDING_AUTOSAVE_SECONDS);
				if (this.closing) return;
				for (const key of this.cache.keys()) if (this.cache.isDirty(key)) this.saveKey(key);
			}
		});
		this.janitor.Add(() => task.cancel(autosave));
		game.BindToClose(() => this.saveAllOnClose());
	}

	/**
	 * True while `player` is playing the tutorial (between `tutorialStarted` and `tutorialFinished` / leave).
	 * RunSessionService treats them as busy for lobbies (create, join, invites, run starts).
	 */
	isInTutorial(player: Player): boolean {
		return this.trackers.get(player)?.isInTutorial() ?? false;
	}

	/**
	 * A party run started with `player` (RunSessionService.startLobbyRun): their client switched to it, so any open
	 * tutorial attempt ends here (no `tutorialFinished` will come for it), logged as TutorialAbandoned `partyRun`.
	 */
	leaveTutorial(player: Player): void {
		const tracker = this.trackers.get(player);
		if (tracker === undefined || !tracker.isInTutorial()) return;
		this.logBatches(player, tracker.partyRun());
		log.info("TUTORIAL_LEFT", `${player.UserId}: a party run started`);
	}

	/**
	 * InviteService: the `joinIntent` it just sent this player (the first resolve, an upgrade, a re-send). Feeds the
	 * onboarding funnel's join entry (none -> organic once final, lobby -> invited, party -> party). Never yields.
	 */
	joinIntent(player: Player, intent: ArrivalJoinIntent): void {
		if (player.Parent === undefined) return;
		// InviteService's PlayerAdded handler may run before ours: create the state so the intent is kept (playerAdded
		// then finds it and schedules the entry deadline from it).
		this.logBatches(player, this.trackerFor(player).joinIntent(intent, this.now()));
	}

	/**
	 * RunSessionService: a session started (`memberIds`: every member). NewPlayerRunStarted for each member in the
	 * new-player window, when the run counts (newPlayerRunCounts). Never yields; nothing is written.
	 */
	newPlayerRunStarted(run: NewPlayerRunSubmission): void {
		if (!this.newPlayerRunCounts(run)) return;
		for (const userId of run.memberIds) {
			const player = Players.GetPlayerByUserId(userId);
			if (player === undefined) continue;
			const doc = this.knownDoc(player);
			if (doc !== undefined) this.logOnboarding(player, newPlayerRunStart(doc));
		}
	}

	/**
	 * RunSessionService: an ACCEPTED run (`memberIds`: the credited members), with its end reason and deepest floor.
	 * NewPlayerRun for each credited member in the window, and the doc's run count written (cache: saved when dirty).
	 * Never yields.
	 */
	newPlayerRunAccepted(run: NewPlayerRunSubmission, facts: NewPlayerRunFacts): void {
		if (!this.newPlayerRunCounts(run)) return;
		for (const userId of run.memberIds) {
			// A member who left while the run validated: the held Player and doc (release / holdUntilIdle).
			const player = Players.GetPlayerByUserId(userId) ?? this.departed.get(userId);
			if (player === undefined) continue;
			const doc = this.knownDoc(player);
			if (doc === undefined) continue;
			const update = newPlayerRunAccepted(doc, facts);
			if (update === undefined) continue;
			this.cache.set(playerDataKey(userId), update.doc);
			this.logOnboarding(player, update.events);
			log.info("NEW_PLAYER_RUN", `${userId}: run ${update.doc.newRuns ?? 0} (${facts.endReason})`);
		}
	}

	/** RunSessionService: is the player in an unconcluded party run (their late `tutorialStarted` is ignored)? */
	setPartyRunCheck(check: (player: Player) => boolean): void {
		this.inPartyRun = check;
	}

	/** This player's onboarding doc, or undefined before it is loaded. */
	getDoc(player: Player): Readonly<OnboardingDoc> | undefined {
		return this.cache.get(playerDataKey(player.UserId));
	}

	/**
	 * Whether this player's JOIN load has finished OK (claude/codex-plan.md R13: CodexService's one-time seed reads
	 * `seen` from getDoc only after "loaded", and leaves its seed for the next join on "failed"). Decided when the join
	 * load ended (any Studio reset applied), and kept for the session even if a later save succeeds (a failed join
	 * load's cached doc is defaults, not the stored doc). "pending" while it runs and after the leave. Never yields.
	 */
	joinLoadState(player: Player): OnboardingJoinLoad {
		const ok = this.joinLoads.get(player);
		if (ok === undefined) return "pending";
		return ok ? "loaded" : "failed";
	}

	/** The store (a seam: a test or tool can subclass the service with an in-memory KeyValueStore). */
	protected createStore(): KeyValueStore {
		return new DataStoreKeyValue(ONBOARDING_DATASTORE_NAME);
	}

	protected now(): number {
		return os.clock();
	}

	private allow(limiter: SlidingWindowLimiter<Player>, player: Player, what: string): boolean {
		if (limiter.tryAcquire(player, this.now())) return true;
		log.warn("RATE_LIMITED", `${player.UserId}: ${what} dropped`);
		return false;
	}

	private trackerFor(player: Player): PlayerTutorialTelemetry {
		let tracker = this.trackers.get(player);
		if (tracker === undefined) {
			tracker = new PlayerTutorialTelemetry(this.now());
			this.trackers.set(player, tracker);
		}
		return tracker;
	}

	/** Logs each batch: attempt batches with their funnel session id, the rest as onboarding telemetry. */
	private logBatches(player: Player, batches: ReadonlyArray<TelemetryBatch>): void {
		for (const b of batches) {
			if (b.attemptId !== undefined) this.telemetry.logTutorial(player, b.specs, b.attemptId);
			else this.telemetry.logOnboarding(player, b.specs);
		}
	}

	private logOnboarding(player: Player, specs: ReadonlyArray<AnalyticsEventSpec>): void {
		if (specs.size() > 0) this.telemetry.logOnboarding(player, specs);
	}

	/** The run counts in the new-player window: NEW_PLAYER_RUN_POLICY; Studio only with the KV_AnalyticsDebug echo. */
	private newPlayerRunCounts(run: NewPlayerRunSubmission): boolean {
		const studio = RunService.IsStudio() && Workspace.GetAttribute(ANALYTICS_DEBUG_ATTRIBUTE) !== true;
		return newPlayerRunCounts({ worldKind: run.worldKind, debug: run.debug, studio });
	}

	/** The player's cached doc when the join load succeeded (never after a failed one), else undefined. Never yields. */
	private knownDoc(player: Player): Readonly<OnboardingDoc> | undefined {
		const key = playerDataKey(player.UserId);
		if (this.cache.loadFailed(key)) return undefined;
		return this.cache.get(key);
	}

	/** PlayerAdded: the telemetry state (its entry deadline counts from now), then the join load. */
	private playerAdded(player: Player): void {
		if (player.Parent === undefined) return;
		const tracker = this.trackerFor(player);
		task.delay(math.max(0, tracker.entryDeadline() - this.now()), () => {
			if (this.trackers.get(player) === tracker && player.Parent !== undefined) {
				this.logBatches(player, tracker.poll(this.now()));
			}
		});
		this.loadAndSend(player);
	}

	private resetRequested(): boolean {
		return RunService.IsStudio() && Workspace.GetAttribute(ONBOARDING_RESET_ATTRIBUTE) === true;
	}

	private loadAndSend(player: Player): void {
		if (this.resetRequested()) this.resetPending.add(player);
		const doc = this.loadFor(player);
		if (doc === undefined) return;
		const key = playerDataKey(player.UserId);
		const loaded = !this.cache.loadFailed(key);
		if (!loaded) {
			log.warn("LOAD_FAILED", `${player.UserId}: onboarding unknown this session (tutorial not forced)`);
		} else {
			// The new-player window (no yield between the read and the set): firstDay, NewPlayerReturned.
			const update = newPlayerJoin(doc, math.floor(os.time() / SECONDS_PER_DAY));
			if (update !== undefined) {
				this.cache.set(key, update.doc);
				this.logOnboarding(player, update.events);
			}
		}
		this.joinLoads.set(player, loaded);
		const tracker = this.trackers.get(player);
		if (tracker !== undefined) {
			const fresh = loaded && doc.tutorialVersion === 0;
			this.logBatches(player, tracker.join({ loaded, fresh, done: loaded && isTutorialDone(doc) }));
		}
		this.send(player);
	}

	/**
	 * The player's doc, loading it if needed (may yield). Undefined when the player left while it yielded: their
	 * entry is dropped then. Applies a pending Studio reset once the load succeeded (never after a failed load: that
	 * would overwrite the unknown stored value). Reads the cache afresh after the load, because a concurrent caller
	 * resumed inside it may have applied the reset already.
	 */
	private loadFor(player: Player): OnboardingDoc | undefined {
		const key = playerDataKey(player.UserId);
		this.cache.load(key, [player.UserId]);
		if (player.Parent === undefined) {
			this.release(player);
			return undefined;
		}
		if (this.resetPending.delete(player) && !this.cache.loadFailed(key)) {
			this.cache.set(key, emptyOnboardingDoc());
			log.info("RESET", `${player.UserId}: onboarding reset (${ONBOARDING_RESET_ATTRIBUTE})`);
		}
		return this.cache.get(key);
	}

	private finish(player: Player, info: unknown): void {
		// Telemetry first (no yield): the attempt closes now, so the player is no longer in the tutorial.
		const r = this.trackerFor(player).finish(info, this.now());
		if (r === undefined) {
			log.warn("BAD_OUTCOME", `${player.UserId}: tutorialFinished dropped`);
			return;
		}
		this.logBatches(player, r.batches);
		this.recordFinish(player, r.outcome);
	}

	/** Writes the finished doc (after the join load) and answers with the status. */
	private recordFinish(player: Player, outcome: TutorialOutcome): void {
		if (this.loadFor(player) === undefined) return;
		const key = playerDataKey(player.UserId);
		// Merge: the sightings and the new-player fields stay (read right before the set, no yield in between).
		const current = this.cache.get(key);
		this.cache.set(key, finishedOnboardingDoc(outcome, os.time(), seenOf(current), current));
		log.info("TUTORIAL_FINISHED", `${player.UserId}: ${outcome}`);
		this.send(player);
	}

	/**
	 * Records first sighting `id` (a known id): the cached doc plus `id`, every tutorial field kept. Nothing when it was
	 * seen already, the player left, or the join load failed (the stored doc is unknown: never overwrite it).
	 */
	private markSeen(player: Player, id: string): void {
		if (this.loadFor(player) === undefined) return;
		const key = playerDataKey(player.UserId);
		if (this.cache.loadFailed(key)) return;
		const doc = this.cache.get(key);
		if (doc === undefined) return;
		const updated = withSeenId(doc, id);
		if (updated !== doc && this.cache.set(key, updated)) log.info("SIGHTING", `${player.UserId}: ${id}`);
	}

	/** Answers a dropped request with the cached status, if loaded. */
	private resync(player: Player): void {
		if (this.cache.get(playerDataKey(player.UserId)) !== undefined) this.send(player);
	}

	/** Sends the status of the cached doc (`loaded` = the join load succeeded, or a later save did). */
	private send(player: Player): void {
		if (player.Parent === undefined) return;
		const key = playerDataKey(player.UserId);
		Events.onboardingStatus.fire(player, onboardingStatusOf(this.cache.get(key), !this.cache.loadFailed(key)));
	}

	/**
	 * The player left (PlayerRemoving, or a load that resumed after the leave): the leave-time telemetry now (Joined if
	 * owed, TutorialAbandoned `leave` / the outro's `left`), the per-player state dropped, and the cached doc saved and
	 * held until their runs finished validating (holdUntilIdle).
	 */
	private release(player: Player): void {
		const tracker = this.trackers.get(player);
		if (tracker !== undefined) this.logBatches(player, tracker.leaving(this.now()));
		this.requestLimiter.forget(player);
		this.startLimiter.forget(player);
		this.stepLimiter.forget(player);
		this.finishLimiter.forget(player);
		this.seenLimiter.forget(player);
		this.reportLimiter.forget(player);
		this.trackers.delete(player);
		this.resetPending.delete(player);
		this.joinLoads.delete(player);
		this.holdUntilIdle(player);
	}

	/**
	 * Saves the departed player's cached doc now (a rejoin elsewhere reads the latest), keeps it and the Player in
	 * `departed` while RunValidationService still validates one of their runs (NewPlayerRun, newPlayerRunAccepted), then
	 * releases it (saved again when dirty). Once per Player. A rejoin to this server meanwhile: the new session owns the
	 * entry (its own leave holds it again), so this hold leaves it in place.
	 */
	private holdUntilIdle(player: Player): void {
		const userId = player.UserId;
		const key = playerDataKey(userId);
		if (this.cache.get(key) === undefined || this.departed.get(userId) === player) return;
		this.departed.set(userId, player);
		task.spawn(() => {
			if (this.cache.save(key) === "failed") log.warn("SAVE_FAILED", `${userId}: onboarding not saved on leave`);
			this.runs.waitUntilIdle(player);
			if (this.departed.get(userId) !== player) return; // a newer session of this user holds it now
			this.departed.delete(userId);
			if (Players.GetPlayerByUserId(userId) !== undefined) return; // back in this server: their entry again
			if (this.cache.release(key) === "failed") {
				log.warn("SAVE_FAILED", `${userId}: onboarding not saved after the leave`);
			}
		});
	}

	private saveKey(key: string): void {
		if (this.cache.save(key) === "failed") log.warn("SAVE_FAILED", `${key}: autosave failed, will retry`);
	}

	/** Saves every dirty player in parallel and waits (bounded) for the writes. */
	private saveAllOnClose(): void {
		this.closing = true;
		let pending = 0;
		for (const key of this.cache.keys()) {
			if (!this.cache.isDirty(key)) continue;
			pending++;
			task.spawn(() => {
				this.saveKey(key);
				pending--;
			});
		}
		const deadline = this.now() + SHUTDOWN_SAVE_TIMEOUT_SECONDS;
		while (pending > 0 && this.now() < deadline) task.wait(SHUTDOWN_POLL_SECONDS);
		if (pending > 0) log.warn("SHUTDOWN_SAVE_TIMEOUT", `${pending} onboarding saves still pending`);
	}
}

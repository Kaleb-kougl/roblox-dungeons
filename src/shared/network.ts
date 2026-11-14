import { Networking } from "@flamework/networking";
import type { CharacterId, UpgradeLevels } from "shared/characters";
import type { CodexClaim, CodexStatus } from "shared/codex";
import type { DailyRunResult, DailyStatus } from "shared/daily";
import type { LeaderboardRequest, LeaderboardView } from "shared/leaderboard";
import type { ArrivalJoinIntent, ArrivalToastKey } from "shared/invite";
import type {
	OnboardingReport,
	OnboardingStatus,
	TutorialFinishInfo,
	TutorialLessonReport,
	TutorialStartInfo,
	TutorialStuckReport,
} from "shared/onboarding";
import type { RecordsStatus, RunRecordsResult } from "shared/records";
import type {
	LobbyCreateRequest,
	LobbyInviteSource,
	LobbyNameId,
	LobbyPhase,
	LobbyRefusal,
	LobbySummary,
	LobbyVisibility,
	LobbyWorld,
} from "shared/lobby";
import type {
	RunFinal,
	RunRecapReport,
	RunRejectCode,
	RunScore,
	RunSegment,
	RunSubmission,
	RunSummary,
	SegmentRejectCode,
	SegmentVerdict,
	StartRunReply,
	StartRunRequest,
} from "shared/run";
import type { SettingsOverrides } from "shared/settings";
import type { SilverGrantBreakdown, SilverShopReport, WalletStatus } from "shared/wallet";

/**
 * Typed remotes between client and server (task 9). The only shared contract between `client/` and `server/`.
 *
 * Flamework generates a runtime type guard for every parameter below, so a payload of the wrong SHAPE never reaches a
 * handler. The guard does not bound values (string lengths, NaN, ranges): the server re-checks those
 * (`validateRun`'s shape and size checks, `sanitizeSettingsPatch`). Keep the types tight; never widen one to
 * `unknown`.
 *
 * Request / reply as an event pair (the pattern of the user's other Flamework project): the client fires a request,
 * the server answers with its own event. Every client -> server event is rate limited per player in its service
 * (limits in shared/run `RUN_SUBMIT_RATE`, shared/settings `SETTINGS_REQUEST_RATE` and shared/onboarding
 * `ONBOARDING_REQUEST_RATE` / `TUTORIAL_START_RATE` / `TUTORIAL_FINISH_RATE` / `TUTORIAL_STEP_RATE` /
 * `TUTORIAL_REPORT_RATE`, shared/records `RECORDS_REQUEST_RATE`,
 * shared/daily `DAILY_REQUEST_RATE`, shared/run `RUN_RECAP_RATE`, shared/codex `CODEX.claimRate` for each of
 * `requestCodex` / `codexClaim` / `codexViewed`, shared/wallet `WALLET.requestRate` for each of `requestWallet` /
 * `walletBuy` / `walletEquip`, shared/wallet `SILVER_SHOP.reportRate` for each of `silverShopReport` / `silverShopFakeBuy`).
 *
 * Bind side-specific handlers with `GlobalEvents.createServer` (src/server/network.ts) and `GlobalEvents.createClient`
 * (the client's network module, task 8), never here.
 */

/** Why the server did not even validate a submission. */
export type RunVerdictGate = "rate_limited" | "busy";

/** The server's answer to `submitRun`. Its summary is the server's own replay, never the client's claim. */
export interface RunVerdict {
	ok: boolean;
	/** Echo of the submission's claimed hash, so the client can match verdicts to runs. */
	claimedHash: string;
	code?: RunRejectCode | RunVerdictGate;
	reason?: string;
	/** hashState of the server's replay ("" when it did not replay). */
	serverHash: string;
	summary: RunSummary;
	/** Server-generated id of an accepted run (also the analytics funnel session id). */
	runId?: string;
}

/**
 * Co-op (M4, shared/lockstep): a party run is starting. Sent to EVERY member of the lobby whose Start began it
 * (shared/lobby); a client starts the run only for the lobby it is in (`lobbyId`), finds its player index as
 * `members.indexOf(LocalPlayer.UserId)` and plays the run in lockstep (merged frames from `lockstepFrames` only).
 */
export interface PartyRunStart {
	runId: string;
	seed: number;
	worldKind: string;
	/** UserIds in player index order (owner first). */
	members: number[];
	/**
	 * docs/ARCHER.md AR5: each member's character in the same order (the session's RunSession.characters, the lobby's
	 * picks): every client builds the run with `buildWorldSetup(worldKind, seed, { partySize, characters })`, exactly
	 * the server's validator setup. Empty for a world without characters.
	 */
	characters: CharacterId[];
	/**
	 * docs/SILVER.md SV6: each member's Armory upgrade levels in the same order (RunSession.upgrades): every client
	 * passes them as `buildWorldSetup`'s `upgrades`, exactly the validator's setup. Empty for a world without upgrades
	 * (shared/run upgradesApply false).
	 */
	upgrades: UpgradeLevels[];
	/** Members whose wallet was unknown at the start (they play with no upgrades; RunSession.upgradesUnknown). */
	upgradesUnknown: number[];
	/**
	 * The lobby whose Start began this run (shared/lobby). A client switches to the run only when this is the lobby it
	 * is in.
	 */
	lobbyId: string;
}

/** A member's view of the lobby they are in (`lobbyState`). Clocks differ, so the countdown is a duration. */
export interface LobbyView {
	lobbyId: string;
	nameId: LobbyNameId;
	hostId: number;
	visibility: LobbyVisibility;
	/** The world its run is played in: "endless" or "daily" (shared/lobby LobbyWorld; the host's `lobbySetWorld`). */
	worldKind: LobbyWorld;
	phase: LobbyPhase;
	/** Join order (the run's player order). */
	members: number[];
	ready: number[];
	/**
	 * docs/ARCHER.md AR5: each member's character pick, same index as `members` (DEFAULT_CHARACTER until they pick;
	 * kept when they un-ready, the world changes or a run ends). The party run starts with these.
	 */
	characters: CharacterId[];
	/** Seconds left on the start countdown (phase "countdown" only). */
	countdownIn?: number;
	/** Players with a live invite to this lobby (shown as "Invited"; no duplicate invites). */
	invited: number[];
	/**
	 * Where each `invited` entry's invite came from, same index (shared/lobby LobbyInviteSource): "platform" (Roblox's
	 * invite prompt; the player may not be in this server yet) reads "Invited (Roblox)".
	 */
	invitedSources: LobbyInviteSource[];
}

/** `lobbyState`: the lobby this player is in, or none. */
export interface LobbyStateUpdate {
	lobby?: LobbyView;
}

/**
 * `lobbyRunStart`: the countdown of this player's ONE-member lobby ended. The client starts a ranked solo run at once
 * (`startRun` with the lobby's `worldKind`: shared/play RANKED_WORLD_KIND or the Daily); the server binds this
 * player's next solo start in that world to the lobby, and the lobby returns to `forming` when that run is decided (any
 * outcome, a restart included), when the player leaves, or when no start came within shared/lobby
 * LOBBY_SERVICE.soloStartTimeoutSeconds. A party lobby gets `partyRunStarted` (with `lobbyId`) instead.
 */
export interface LobbySoloRunStart {
	lobbyId: string;
	kind: "solo";
	/** The lobby's world: the `startRun` world kind. */
	worldKind: LobbyWorld;
	/** docs/ARCHER.md AR5: the member's lobby pick, the `startRun` request's `characterId`. */
	characterId: CharacterId;
}

/** One live invite this player received (`lobbyInvites` carries the whole current list). */
export interface LobbyInviteView {
	inviteId: string;
	lobbyId: string;
	nameId: LobbyNameId;
	hostId: number;
	fromUserId: number;
	/** Seconds until it expires. */
	expiresIn: number;
	/** How it was sent (shared/lobby LobbyInviteSource). */
	source: LobbyInviteSource;
}

/**
 * Something the player should be told about (a toast):
 *   refused             their own request was refused (`code`, `reason`; `requestKind` names the request)
 *   kicked              the host removed them (`lobbyId`)
 *   hostChanged         they are the new host (`lobbyId`)
 *   countdownCancelled  a start countdown stopped (`reason`)
 *   inviteExpired / inviteDropped   an invite they received is gone (`lobbyId`)
 *   followed            a friend followed them into this server but cannot join their (closed) lobby (`userId`)
 *   inviteArrived       a friend they invited through Roblox arrived (`userId`; docs/INVITES.md)
 *   partyLobby          their Roblox Party was grouped into a lobby on arrival: they were moved into it (`lobbyId`,
 *                       `userId` = a party mate there; docs/INVITES.md "Roblox Party"). Mid-session grouping is no
 *                       notice: it is a party invite (`lobbyInvites`, source "party")
 *   arrival             an arrival could not be placed: `key` is the theme string id of the toast
 */
export interface LobbyNotice {
	kind:
		| "refused"
		| "kicked"
		| "hostChanged"
		| "countdownCancelled"
		| "inviteExpired"
		| "inviteDropped"
		| "followed"
		| "inviteArrived"
		| "partyLobby"
		| "arrival";
	requestKind?: string;
	code?: LobbyRefusal;
	reason?: string;
	lobbyId?: string;
	userId?: number;
	/** `arrival` only: the toast's theme string id. */
	key?: ArrivalToastKey;
}

/** `invitePrompt`: open Roblox's invite prompt; `withLobby` attaches the sender's lobby (they must be a member). */
export interface InvitePromptRequest {
	withLobby: boolean;
}

/**
 * `invitePromptOnClient`: the server built the options but the prompt must be opened on the client (INVITE.promptSide
 * "client", decided by spike I0). The client creates an ExperienceInviteOptions with exactly these and calls
 * PromptGameInvite for the local player.
 */
export interface InvitePromptOptions {
	launchData: string;
	inviteMessageId?: string;
}

/**
 * `inviteEligible`: Studio's KV_FakeInviteEligible answer only. The real check is the client's own
 * CanSendGameInviteAsync (Roblox refuses it on the server).
 */
export interface InviteEligibility {
	canSend: boolean;
}

/**
 * `joinIntent`: what the server did with this player's arrival (docs/INVITES.md §4), from the state after applying
 * it. Sent soon after join (after the first resolve), again with every `inviteEligible` answer (the last value), and
 * again when an arrival or party action places the player later while the first one said `none` (within
 * INVITE.launchDataWaitSeconds + intentUpgradeMarginSeconds of join): it may arrive more than once and can upgrade
 * none -> lobby / party, never downgrade. The client's first-join choice waits for it (at most
 * INVITE.intentWaitSeconds) and re-checks the latest value when it dispatches: `lobby` / `party` skip the automatic
 * first-run tutorial (ID6).
 */
export interface JoinIntent {
	kind: ArrivalJoinIntent;
}

/** Where a validated segmented run went on the leaderboards: "posted", "ineligible:<reason>", "failed". */
export type LeaderboardPostStatus = string;

/**
 * The server's verdict on a whole segmented run (`finishRun`, or an earlier rejection / expiry). Summary, score and
 * floor are the server's own replay, never the client's claim.
 */
export interface RunFinishVerdict {
	runId: string;
	ok: boolean;
	code?: SegmentRejectCode | RunVerdictGate;
	reason?: string;
	/** The segment that failed, and the tick window where the replay diverged (when known). */
	failedSegment?: number;
	matchedThroughTick?: number;
	mismatchAtTick?: number;
	verifiedTicks: number;
	serverHash: string;
	summary: RunSummary;
	score: RunScore;
	/** Accepted runs: what happened on the leaderboards ("queued", "ineligible:<reason>"). */
	leaderboard?: LeaderboardPostStatus;
	/**
	 * Personal records (docs/NEW_BEST.md): THIS recipient's outcome of an accepted run that counted toward records
	 * (shared/records RECORDS_POLICY) and was merged into their loaded records. Per recipient: in a party run each
	 * member's verdict carries their own (a member not credited, or whose records are unknown, gets none). Absent on
	 * rejected / expired / ineligible runs, after a failed join load, and in Studio without KV_FakeRecords.
	 */
	records?: RunRecordsResult;
	/**
	 * Daily runs (docs/DAILY.md DS5): THIS recipient's entry on the run's daily board (its start day and ruleset):
	 * posted / improved / previous from the personal-best write, rank (exact, top rows) or percentile (estimate) and
	 * entrants after it (shared/daily DailyRunResult). Accepted daily runs only; `posted: false` when the run did not
	 * post (see `leaderboard`), the recipient was not credited, or the write did not land within DAILY_VERDICT.waitSeconds.
	 * The verdict of a posting daily run waits for its writes (up to that long).
	 */
	daily?: DailyRunResult;
	/**
	 * Silver (docs/SILVER.md SV4): THIS recipient's grant of an accepted run that pays (shared/silver silverEligibility),
	 * PREDICTED from the server's session copy of their wallet (the team's run rows, their own Prospector and day
	 * bonuses), so the verdict is not held for the write. The `wallet` push after the grant's transaction carries the
	 * settled breakdown (`WalletStatus.grant`, same runId); it differs only when another server took a day bonus first.
	 * Absent on rejected / expired / non-paying runs and for members not credited.
	 */
	silver?: SilverGrantBreakdown;
}

export interface ClientToServerEvents {
	/**
	 * A finished run (death, victory, or abandoned with R / quit): seed, spawn flag, the RLE input recording and the
	 * hash and summary the client claims. The server replays it and answers with `runVerdict`. Sent once per run.
	 */
	submitRun(submission: RunSubmission): void;
	/**
	 * Segmented runs (M3): asks the server for a run session. The SERVER picks the seed; answered with `runStarted`
	 * ({ runId, seed }). Segments and the final submit name that runId.
	 */
	startRun(request: StartRunRequest): void;
	/** One segment of the live run (normally one per floor). Answered with `segmentVerdict` once replayed. */
	submitSegment(segment: RunSegment): void;
	/** The end of the run, after its last segment. Answered with `runFinished`. */
	finishRun(final: RunFinal): void;
	/**
	 * Top rows of a board plus the caller's best; answered with `leaderboard`. `{ board, scope }`: the all-time boards
	 * ("alltime") or the daily board of "today" / "yesterday" by the server's clock and ruleset; `friends: true` (daily
	 * scopes only) asks for the caller's friends on it (shared/leaderboard LeaderboardRequest). Invalid requests are
	 * dropped; rate limited (LEADERBOARD_REQUEST_RATE).
	 */
	getLeaderboard(request: LeaderboardRequest): void;
	/** Asks for this player's saved settings (every group); answered with `settingsChanged`. */
	requestSettings(): void;
	/**
	 * Changes settings groups (shared/settings doc.ts): every group present REPLACES the stored one (`{}` clears it),
	 * absent groups are kept; invalid keys / values / bindings are dropped. Answered with `settingsChanged`.
	 */
	updateSettings(patch: SettingsOverrides): void;
	/** Every group back to the defaults (reducedMotion follows the system again); answered with `settingsChanged`. */
	resetSettings(): void;
	/**
	 * Co-op lockstep (M4): this player's inputs for ticks firstTick.. of party run `runId` (shared/lockstep wire.ts
	 * input batch: 10 bytes per frame). Sent as merged frames are stepped, for tick (stepped + lead).
	 */
	lockstepInput(runId: string, firstTick: number, data: buffer): void;
	/**
	 * Co-op lockstep: hashState after each tick in `ticks` (every HASH_REPORT_EVERY_TICKS ticks; `hashes[k]` is
	 * `ticks[k]`'s). One call carries every report due: new ones and resends of those the server has not acknowledged
	 * (the ack comes with `lockstepFrames`). At most MAX_HASH_BATCH. The server compares them.
	 */
	lockstepHash(runId: string, ticks: number[], hashes: string[]): void;
	/** Co-op lockstep: the final claim once this client's sim shows the whole party down. */
	lockstepFinal(final: RunFinal): void;
	/**
	 * Leave run (party): this player leaves party run `runId` for good, as if they had disconnected (their character
	 * dies for the rest of the run; the others play on). A solo run's leave is in its own recording (the forfeit bit).
	 */
	lockstepLeave(runId: string): void;
	/**
	 * Lobbies (shared/lobby). Every request is answered by the state it changes (`lobbyState`, `lobbyList`,
	 * `lobbyInvites`) or by a `lobbyNotice` of kind "refused". All are rate limited.
	 */
	lobbyCreate(request: LobbyCreateRequest): void;
	lobbyJoin(lobbyId: string): void;
	lobbyLeave(): void;
	/** Host only. */
	lobbyKick(userId: number): void;
	/** Host only. */
	lobbySetVisibility(visibility: string): void;
	/** Host only; a LOBBY_NAMES id. */
	lobbySetName(nameId: string): void;
	/**
	 * Host only, while the lobby is forming: its world, a shared/lobby LOBBY_WORLDS kind ("endless" / "daily"). A change
	 * clears every Ready. Answered by `lobbyState` (or a refusal).
	 */
	lobbySetWorld(worldKind: string): void;
	/** Host only. */
	lobbyTransferHost(userId: number): void;
	/** Any member. */
	lobbyInvite(userId: number): void;
	lobbyAnswerInvite(inviteId: string, accept: boolean): void;
	/**
	 * Any member: Ready on / off with their character pick (a shared/characters CharacterId; docs/ARCHER.md AR5). The
	 * pick is stored either way and shown on their row (`LobbyView.characters`); a pick change while ready un-readies.
	 */
	lobbySetReady(ready: boolean, characterId: string): void;
	/** Host only: begins the start countdown (every member ready; one member is enough). */
	lobbyStart(): void;
	/** Asks for `lobbyList` now (the browser opened); the server also pushes it while lobbies change. */
	lobbyRequestList(): void;
	/**
	 * Roblox invites (docs/INVITES.md): open Roblox's invite prompt, with the sender's lobby attached or not. Rate
	 * limited (INVITE_PROMPT_RATE); a refusal is a `lobbyNotice` "refused" with requestKind "invitePrompt". Depending
	 * on INVITE.promptSide the server prompts itself or answers with `invitePromptOnClient`.
	 */
	invitePrompt(request: InvitePromptRequest): void;
	/**
	 * Roblox invites: the friends picked in a prompt the client opened or saw close (SocialService
	 * .GameInvitePromptClosed on the client). Recorded as platform invites to the sender's lobby; the server ignores
	 * ids it already recorded from its own GameInvitePromptClosed. No reply beyond the lobby pushes.
	 */
	inviteRecipients(userIds: number[]): void;
	/** Roblox invites: resend `joinIntent` (and, in Studio, the `inviteEligible` fake). Eligibility is checked on the client. */
	inviteEligibility(): void;
	/** Onboarding: asks whether this player has done the tutorial; answered with `onboardingStatus`. */
	requestOnboarding(): void;
	/**
	 * Onboarding: the client started a Practice Descent (first run, Restart tutorial, or a replay). Begins a new
	 * funnel attempt and marks the player in-tutorial (busy for lobby run starts) until `tutorialFinished` or leave.
	 * No reply. `info` (docs/TUTORIAL_FUNNEL.md §6): how the attempt began (`entry`) and the input device then; the
	 * server re-reads it (shared/onboarding readTutorialStartInfo) and falls back to DEFAULT_TUTORIAL_START_INFO.
	 */
	tutorialStarted(info: TutorialStartInfo): void;
	/**
	 * Onboarding telemetry: lesson `step` (an integer 1..TUTORIAL_FUNNEL_MAX_STEP, the shared/tutorial step number:
	 * TutorialView.newFunnelSteps) has been reached. The server names it from the shared step list (the step's id).
	 * Only strictly increasing steps within the current attempt are logged. No reply.
	 */
	tutorialStep(step: number): void;
	/**
	 * Onboarding: the tutorial was completed or skipped (`info.outcome`), with the director's current step id
	 * (`info.stepId`, TUTORIAL_NO_STEP_ID when none). Recorded as done; answered with `onboardingStatus`.
	 */
	tutorialFinished(info: TutorialFinishInfo): void;
	/**
	 * Tutorial telemetry (docs/TUTORIAL_FUNNEL.md §4, §6): one lesson's time and harmless hits (TutorialView
	 * .newLessonReports), once per lesson per attempt. Re-read with readLessonReport, rate limited
	 * (TUTORIAL_REPORT_RATE). No reply.
	 */
	tutorialLesson(report: TutorialLessonReport): void;
	/** Tutorial telemetry: one stuck episode (TutorialView.newStuckReports / flushMetrics), once per prompt per attempt. No reply. */
	tutorialStuck(report: TutorialStuckReport): void;
	/**
	 * Onboarding telemetry: `loaded` (the join loading screen released), `gate` (the first-join choice dispatched, with
	 * its reason) once per session, `outro` (the tutorial outro closed: the choice and seconds on it) once per attempt.
	 * Re-read with readOnboardingReport, rate limited (TUTORIAL_REPORT_RATE). No reply.
	 */
	onboardingReport(report: OnboardingReport): void;
	/**
	 * First sightings (docs/ENEMY_VARIANTS.md EV12): this client showed the first-sighting toast for `id` (a
	 * shared/onboarding SIGHTING_IDS entry). Recorded in this player's onboarding doc: unknown ids are ignored, a known
	 * one is idempotent, rate limited (BESTIARY_SEEN_RATE), never written after a failed join load. No reply (the next
	 * `onboardingStatus` carries it in `seen`).
	 */
	bestiarySeen(id: string): void;
	/** Personal records (docs/NEW_BEST.md): asks for this player's records; answered with `records`. */
	requestRecords(): void;
	/**
	 * Run-over recap telemetry (docs/RUN_RECAP.md RR9): how this player left the run-over panel of run session
	 * `report.runId` (retry / exit / lobby), the seconds it was open, the near-miss kind shown, record / skipped, and a
	 * party run's team moments and tab views (docs/RUN_CONTRIBUTION.md CT8). Re-read with shared/run readRunRecapReport, rate limited (RUN_RECAP_RATE), at most one
	 * per run session the server issued to this player (RunRecapGate); logged as `RunRecap` by TelemetryService and
	 * used for nothing else. No reply.
	 */
	runRecap(report: RunRecapReport): void;
	/** The Daily (docs/DAILY.md): asks for today's status; answered with `dailyStatus`. Rate limited. */
	requestDaily(): void;
	/**
	 * The Codex (claude/codex-plan.md): asks for this player's Codex; answered with `codexStatus` once the join load and
	 * seed ended (an earlier request is answered by the join-end push). Rate limited (CODEX.claimRate).
	 */
	requestCodex(): void;
	/**
	 * The Codex: entries this client saw or found (`tier` 1 seen / 2 found, `floor` the floor it was found on). At most
	 * CODEX.claimMaxItems items (a longer call is refused whole), ids checked against the catalog, idempotent (a lower
	 * tier never wins); the server stamps the day. Ignored before the join load and seed ended and after a failed load
	 * (the client waits for a loaded `codexStatus` and resends). Rate limited (CODEX.claimRate). No reply.
	 */
	codexClaim(items: CodexClaim[]): void;
	/**
	 * The Codex: the player looked at these entries (their NEW dots clear). At most CODEX.viewedMaxIds ids, ignored
	 * before the load as `codexClaim`. Rate limited (CODEX.claimRate). No reply.
	 */
	codexViewed(ids: string[]): void;
	/**
	 * Silver (docs/SILVER.md "Remotes"): asks for this player's wallet; answered with `wallet` once the join load ended
	 * (an earlier request is answered by the join-end push). Rate limited (WALLET.requestRate).
	 */
	requestWallet(): void;
	/**
	 * The Armory: buy the next level of catalogue item `itemId` (shared/wallet ARMORY_CATALOG). The price is the
	 * server's (the item's tier); refused when the wallet is not loaded, while another request of this player is in
	 * flight, or by the stored doc (unknown / maxed / poor / prerequisite). Answered with `wallet` (`result`). Rate
	 * limited (WALLET.requestRate).
	 */
	walletBuy(itemId: string): void;
	/**
	 * The Armory: put owned cosmetic `itemId` into `slot` (WALLET.noItem "" empties it). Answered with `wallet`
	 * (`result`). Rate limited (WALLET.requestRate).
	 */
	walletEquip(slot: string, itemId: string): void;
	/**
	 * The Silver shop's funnel telemetry (docs/SILVER_SHOP.md SH7): one client step of the Get Silver panel (opened /
	 * prompted / bought / cancelled / settled / pricesFailed, where it was opened from, the pack). Re-read with
	 * shared/wallet readSilverShopReport, rate limited (SILVER_SHOP.reportRate), logged as `SilverShop` and used for
	 * nothing else (purchases are granted only from Roblox's receipts). No reply.
	 */
	silverShopReport(report: SilverShopReport): void;
	/**
	 * Studio only (docs/SILVER_SHOP.md SH3): a fake purchase of shown pack `packId` while the Workspace attribute
	 * KV_FakeShop gives fake prices, granted through the same receipt transform with a fake purchase id (shared/wallet
	 * fakeSilverReceipt) and answered like a real one (`wallet` with `purchase`). Ignored on live servers and with the
	 * fake off. Rate limited (SILVER_SHOP.reportRate).
	 */
	silverShopFakeBuy(packId: string): void;
}

export interface ServerToClientEvents {
	/** The verdict on one `submitRun`. */
	runVerdict(verdict: RunVerdict): void;
	/** The answer to `startRun`. */
	runStarted(reply: StartRunReply): void;
	/** One segment replayed (ok) or refused / mismatched (the run is then rejected: `runFinished` follows). */
	segmentVerdict(verdict: SegmentVerdict): void;
	/** The verdict on a whole segmented run (also sent when it is rejected or expires before `finishRun`). */
	runFinished(verdict: RunFinishVerdict): void;
	/**
	 * The answer to `getLeaderboard` (its `scope` / `friends` echo the request). A friends view with `pending` lookups is
	 * pushed again as they resolve.
	 */
	leaderboard(view: LeaderboardView): void;
	/**
	 * This player's stored overrides, every group (only what they changed). The client resolves them against its
	 * defaults (`resolveJuiceSettings(overrides.juice, GuiService.ReducedMotionEnabled)`, `applyControlsOverrides`,
	 * ...). Also sent once after join.
	 */
	settingsChanged(overrides: SettingsOverrides): void;
	/**
	 * Onboarding: whether this player has done the current tutorial. Sent once after the join load (`loaded: false`,
	 * `tutorialDone: false` when that load failed: the client must then NOT force the tutorial), and in answer to
	 * `requestOnboarding` and `tutorialFinished`.
	 */
	onboardingStatus(status: OnboardingStatus): void;
	/**
	 * Personal records (docs/NEW_BEST.md): this player's best score and deepest floor per board. Sent once after the
	 * join load (and the one-time seed) ends (`loaded: false` when that load failed: the client then shows no target),
	 * again after a verdict raised a record, and in answer to `requestRecords`.
	 */
	records(status: RecordsStatus): void;
	/**
	 * The Daily (docs/DAILY.md): today's day, label, seed, ruleset and reset time (shared/daily DailyStatus), plus this
	 * player's entries today (`mine`) and yesterday's podium (`podium`) when known. Sent in answer to `requestDaily`
	 * (at once, then again once the board reads are in), pushed to every player when the UTC day changes, and to each
	 * member after a daily run's verdict (DailyService).
	 */
	dailyStatus(status: DailyStatus): void;
	/**
	 * The Codex (claude/codex-plan.md): this player's entries, NEW dots and seed marker (shared/codex CodexStatus,
	 * `codexDocOfStatus` reads it back). Sent once after the join load and the one-time seed end (`loaded: false` when
	 * the load failed: the Codex is unavailable this session) and in answer to `requestCodex`; never before.
	 */
	codexStatus(status: CodexStatus): void;
	/**
	 * Silver (docs/SILVER.md SV3): this player's wallet (shared/wallet WalletStatus: balance, owned levels, equipped,
	 * whether today's first-run and Daily bonuses are still open, the next goals). Sent once after the join load
	 * (`loaded: false` when it failed: the Armory is greyed and only the Knight is offered this session), after every
	 * transaction of theirs (a purchase or equip: `result`; a run's grant: `grant`, the settled breakdown), and in
	 * answer to `requestWallet`.
	 */
	wallet(status: WalletStatus): void;
	/** Co-op (M4): a party run starts (every member gets it, only after every member accepted the invite). */
	partyRunStarted(start: PartyRunStart): void;
	/** Lobbies: the lobbies this player may see and join (never closed ones), sorted. Throttled. */
	lobbyList(summaries: LobbySummary[]): void;
	/** Lobbies: the lobby this player is in changed (or they left / were removed: `lobby` undefined). */
	lobbyState(update: LobbyStateUpdate): void;
	/** Lobbies: every live invite this player has received. */
	lobbyInvites(invites: LobbyInviteView[]): void;
	lobbyNotice(notice: LobbyNotice): void;
	/** Roblox invites: the answer to `inviteEligibility`. */
	inviteEligible(eligibility: InviteEligibility): void;
	/** Roblox invites: open the invite prompt on the client with these options (INVITE.promptSide "client"). */
	invitePromptOnClient(options: InvitePromptOptions): void;
	/** Roblox invites and parties: how this player's arrival was handled (see JoinIntent; may come more than once). */
	joinIntent(intent: JoinIntent): void;
	/** Lobbies: a one-member lobby's run starts; the client starts a ranked solo run (see LobbySoloRunStart). */
	lobbyRunStart(start: LobbySoloRunStart): void;
	/**
	 * Co-op lockstep: merged frames for ticks firstTick.. (shared/lockstep wire.ts merged batch). The ONLY input a party
	 * client's sim ever steps with. `hashAck`: the highest tick whose hash reports the server decided (the client stops
	 * resending those). The verdict comes as `runFinished` to every member (code "desync" on a desync). `echo`: how early
	 * this member's own lowest-slack input since the last echo reached the server (wire.ts `encodeInputEcho`, against `firstTick`;
	 * docs/FRAME_PACING.md Design 9). Each member gets only its own echo (one fire per member, FPD14); the merged `data`
	 * is the same for everyone. A malformed echo is ignored, never fatal.
	 */
	lockstepFrames(runId: string, firstTick: number, data: buffer, hashAck: number, echo: buffer): void;
}

export const GlobalEvents = Networking.createEvent<ClientToServerEvents, ServerToClientEvents>();

import { Networking } from "@flamework/networking";
import type { LeaderboardBoard, LeaderboardView } from "shared/leaderboard";
import type {
	LobbyCreateRequest,
	LobbyNameId,
	LobbyPhase,
	LobbyRefusal,
	LobbySummary,
	LobbyVisibility,
} from "shared/lobby";
import type {
	RunFinal,
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
 * (limits in shared/run `RUN_SUBMIT_RATE` and shared/settings `SETTINGS_REQUEST_RATE`).
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
	phase: LobbyPhase;
	/** Join order (the run's player order). */
	members: number[];
	ready: number[];
	/** Seconds left on the start countdown (phase "countdown" only). */
	countdownIn?: number;
	/** Players with a live invite to this lobby (shown as "Invited"; no duplicate invites). */
	invited: number[];
}

/** `lobbyState`: the lobby this player is in, or none. */
export interface LobbyStateUpdate {
	lobby?: LobbyView;
}

/**
 * `lobbyRunStart`: the countdown of this player's ONE-member lobby ended. The client starts a ranked solo run at once
 * (`startRun` with shared/play RANKED_WORLD_KIND); the server binds this player's next ranked start to the lobby, and
 * the lobby returns to `forming` when that run is decided (any outcome, a restart included), when the player leaves,
 * or when no start came within shared/lobby LOBBY_SERVICE.soloStartTimeoutSeconds. A party lobby gets
 * `partyRunStarted` (with `lobbyId`) instead.
 */
export interface LobbySoloRunStart {
	lobbyId: string;
	kind: "solo";
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
}

/**
 * Something the player should be told about (a toast):
 *   refused             their own request was refused (`code`, `reason`; `requestKind` names the request)
 *   kicked              the host removed them (`lobbyId`)
 *   hostChanged         they are the new host (`lobbyId`)
 *   countdownCancelled  a start countdown stopped (`reason`)
 *   inviteExpired / inviteDropped   an invite they received is gone (`lobbyId`)
 *   followed            a friend followed them into this server but cannot join their (closed) lobby (`userId`)
 */
export interface LobbyNotice {
	kind: "refused" | "kicked" | "hostChanged" | "countdownCancelled" | "inviteExpired" | "inviteDropped" | "followed";
	requestKind?: string;
	code?: LobbyRefusal;
	reason?: string;
	lobbyId?: string;
	userId?: number;
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
	/** Top rows of a board plus the caller's best; answered with `leaderboard`. */
	getLeaderboard(board: LeaderboardBoard): void;
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
	/** Host only. */
	lobbyTransferHost(userId: number): void;
	/** Any member. */
	lobbyInvite(userId: number): void;
	lobbyAnswerInvite(inviteId: string, accept: boolean): void;
	lobbySetReady(ready: boolean): void;
	/** Host only: begins the start countdown (every member ready; one member is enough). */
	lobbyStart(): void;
	/** Asks for `lobbyList` now (the browser opened); the server also pushes it while lobbies change. */
	lobbyRequestList(): void;
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
	/** The answer to `getLeaderboard`. */
	leaderboard(view: LeaderboardView): void;
	/**
	 * This player's stored overrides, every group (only what they changed). The client resolves them against its
	 * defaults (`resolveJuiceSettings(overrides.juice, GuiService.ReducedMotionEnabled)`, `applyControlsOverrides`,
	 * ...). Also sent once after join.
	 */
	settingsChanged(overrides: SettingsOverrides): void;
	/** Co-op (M4): a party run starts (every member gets it, only after every member accepted the invite). */
	partyRunStarted(start: PartyRunStart): void;
	/** Lobbies: the lobbies this player may see and join (never closed ones), sorted. Throttled. */
	lobbyList(summaries: LobbySummary[]): void;
	/** Lobbies: the lobby this player is in changed (or they left / were removed: `lobby` undefined). */
	lobbyState(update: LobbyStateUpdate): void;
	/** Lobbies: every live invite this player has received. */
	lobbyInvites(invites: LobbyInviteView[]): void;
	lobbyNotice(notice: LobbyNotice): void;
	/** Lobbies: a one-member lobby's run starts; the client starts a ranked solo run (see LobbySoloRunStart). */
	lobbyRunStart(start: LobbySoloRunStart): void;
	/**
	 * Co-op lockstep: merged frames for ticks firstTick.. (shared/lockstep wire.ts merged batch). The ONLY input a party
	 * client's sim ever steps with. `hashAck`: the highest tick whose hash reports the server decided (the client stops
	 * resending those). The verdict comes as `runFinished` to every member (code "desync" on a desync).
	 */
	lockstepFrames(runId: string, firstTick: number, data: buffer, hashAck: number): void;
}

export const GlobalEvents = Networking.createEvent<ClientToServerEvents, ServerToClientEvents>();

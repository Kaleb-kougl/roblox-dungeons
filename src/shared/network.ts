import { Networking } from "@flamework/networking";
import type { LeaderboardBoard, LeaderboardView } from "shared/leaderboard";
import type {
	PartyInviteRequest,
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
import type { JuiceOverrides } from "shared/settings";

/**
 * Typed remotes between client and server (task 9). The only shared contract between `client/` and `server/`.
 *
 * Flamework generates a runtime type guard for every parameter below, so a payload of the wrong SHAPE never reaches a
 * handler. The guard does not bound values (string lengths, NaN, ranges): the server re-checks those
 * (`validateRun`'s shape and size checks, `sanitizeJuiceOverrides`). Keep the types tight; never widen one to
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
 * Co-op (M4, shared/lockstep): a party run is starting. Sent to EVERY member once every one of them accepted the
 * host's invite (`partyInvite` / `partyRespond`); a client starts the run only for the invite it accepted or hosts
 * (`inviteId`), finds its player index as `members.indexOf(LocalPlayer.UserId)` and plays the run in lockstep (merged
 * frames from `lockstepFrames` only).
 */
export interface PartyRunStart {
	runId: string;
	seed: number;
	worldKind: string;
	/** UserIds in player index order (owner first). */
	members: number[];
	/**
	 * The invite every member accepted (`partyInvite` / `partyRespond`). A client switches to the run only when this
	 * is the invite it accepted (or hosts).
	 */
	inviteId: string;
}

/**
 * Co-op consent (shared/run partyInvites.ts): what became of an invite, sent to its members.
 *   invited    to each invited player: answer with partyRespond(inviteId, accept)
 *   pending    to the host on creation (requestId echoed), then to everyone after each accept (`accepted`)
 *   ready / started   everyone accepted; the run starts (`partyRunStarted` follows)
 *   declined / cancelled / expired   it will not start (`reason`)
 *   refused    to the sender only: the invite request or the answer was refused (`code`, `reason`)
 */
export interface PartyInviteUpdate {
	/** "" for a refused invite request (no invite was created). */
	inviteId: string;
	status: "invited" | "pending" | "ready" | "started" | "declined" | "cancelled" | "expired" | "refused";
	hostId: number;
	/** Host first. */
	members: number[];
	accepted: number[];
	/** Seconds until it expires (pending / invited). */
	expiresIn?: number;
	requestId?: number;
	code?: string;
	reason?: string;
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
	/** Asks for this player's saved juice settings; answered with `settingsChanged`. */
	requestSettings(): void;
	/** Changes some juice settings (invalid keys / values are dropped); answered with `settingsChanged`. */
	updateSettings(patch: JuiceOverrides): void;
	/** Back to the defaults (reducedMotion follows the system again); answered with `settingsChanged`. */
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
	/** Co-op consent: invite the named players to a party run (answered with `partyInviteUpdate`). */
	partyInvite(request: PartyInviteRequest): void;
	/** Co-op consent: accept or decline invite `inviteId` (answered with `partyInviteUpdate`). */
	partyRespond(inviteId: string, accept: boolean): void;
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
	 * This player's stored juice overrides (only the keys they changed). The client resolves them against its
	 * defaults: `resolveJuiceSettings(overrides, GuiService.ReducedMotionEnabled)`. Also sent once after join.
	 */
	settingsChanged(overrides: JuiceOverrides): void;
	/** Co-op (M4): a party run starts (every member gets it, only after every member accepted the invite). */
	partyRunStarted(start: PartyRunStart): void;
	/** Co-op consent: an invite's state changed (see PartyInviteUpdate). */
	partyInviteUpdate(update: PartyInviteUpdate): void;
	/**
	 * Co-op lockstep: merged frames for ticks firstTick.. (shared/lockstep wire.ts merged batch). The ONLY input a party
	 * client's sim ever steps with. `hashAck`: the highest tick whose hash reports the server decided (the client stops
	 * resending those). The verdict comes as `runFinished` to every member (code "desync" on a desync).
	 */
	lockstepFrames(runId: string, firstTick: number, data: buffer, hashAck: number): void;
}

export const GlobalEvents = Networking.createEvent<ClientToServerEvents, ServerToClientEvents>();

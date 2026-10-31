import { OnStart, Service } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { HttpService, Players, RunService } from "@rbxts/services";
import { dailyClockNow, dailySeed } from "server/config";
import { serverLogger } from "server/log";
import { Events } from "server/network";
import { partyContributors, type LeaderboardMember } from "shared/leaderboard";
import { LobbyRunTracker, type LobbyRunStart } from "shared/lobby";
import type { LeaderboardPostStatus, RunFinishVerdict } from "shared/network";
import type { RunRecordsResult } from "shared/records";
import {
	DEFAULT_RUN_SCORE,
	MAX_RUN_ID_CHARS,
	MAX_RUN_SEED,
	REPLAY_BUDGET_SECONDS,
	REPLAY_TURN_MAX_TICKS,
	RUN_SESSION_SWEEP_SECONDS,
	RUN_START_RATE,
	ReplayBudget,
	RunSessionRegistry,
	SEGMENT_BUDGET_CHECK_TICKS,
	SEGMENT_REPLAY_SLICE_TICKS,
	SEGMENT_SUBMIT_RATE,
	SlidingWindowLimiter,
	replayTurn,
	truncateReason,
	type RunFinal,
	type RunSegment,
	type RunSession,
	type SegmentVerdict,
	type SegmentedRunResult,
	type StartContext,
	type StartRunReply,
	type StartRunRequest,
} from "shared/run";
import {
	DEFAULT_LOCKSTEP,
	LOCKSTEP_FINAL_RATE,
	LOCKSTEP_HASH_RATE,
	LOCKSTEP_INPUT_RATE,
	LOCKSTEP_LEAVE_RATE,
	LockstepSession,
	type LockstepStepResult,
} from "shared/lockstep";
import { LeaderboardService } from "./LeaderboardService";
import { OnboardingService } from "./OnboardingService";
import { RecordsService } from "./RecordsService";
import { RunValidationService } from "./RunValidationService";

const log = serverLogger("RunSession");

/** Per-session data the pure registry does not keep. */
interface SessionMeta {
	/** Members with their names, captured at start (they may leave before the run is posted). */
	readonly members: LeaderboardMember[];
	/** RunValidationService.trackExternal release, while the final validates. */
	release?: () => void;
	pumping: boolean;
	/**
	 * Party runs, captured when the lockstep session handed its final to the validator: per member the first tick of
	 * their leave frame (NOT_LEFT: never), for the co-op credit (shared/leaderboard partyContributors).
	 */
	leftFromTick?: number[];
}

const NOT_LEFT = -1;

/** `verdict` with one recipient's personal records result (a copy; the verdict itself when there is none). */
function withRecords(verdict: RunFinishVerdict, records: RunRecordsResult | undefined): RunFinishVerdict {
	return records === undefined ? verdict : { ...verdict, records };
}

/** A lobby's run is over (`reason` is for the log). */
export type LobbyRunEndedListener = (lobbyId: string, reason: string) => void;

/** `startLobbyRun`'s answer: a refusal sends the lobby back to `forming` with the reason. */
export type LobbyRunStartResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Segmented runs (M3 / M5; pure logic in shared/run runSessions.ts and segments.ts, docs/SERVER.md "Segmented
 * runs"). The server keeps its own SimState per active run and advances it as segments arrive, so a run of any
 * length (up to MAX_SEGMENTED_RUN_TICKS) is validated while it is played, and the score comes from the server.
 *
 *   startRun       rate limit (RUN_START_RATE) -> registry.start: the server picks the seed, builds the world,
 *                  replaces the player's open session -> `runStarted { runId, seed }`
 *   submitSegment  owner check -> rate limit (SEGMENT_SUBMIT_RATE; over it rejects the run) -> validator.offer
 *                  (cheap checks) -> a pump replays it through RunValidationService's replay queue (one segment per
 *                  queue turn, ReplayBudget yields) -> `segmentVerdict` per segment
 *   finishRun      validator.finish -> decided once the last segment is replayed -> `runFinished` (accepted runs
 *                  go to LeaderboardService and RecordsService, and fire RunValidationService's accepted listeners:
 *                  telemetry). The verdict carries each recipient's own personal records result (`records`).
 *
 * A rejection at any point rejects the whole run (`runFinished` with the code, failed segment and tick window).
 * Open sessions expire (sweep every RUN_SESSION_SWEEP_SECONDS) and are dropped when their player leaves; a session
 * whose final arrived keeps validating after its player left (counted for TelemetryService's waitUntilIdle).
 *
 * Co-op (M4, shared/lockstep, docs/SERVER.md "Co-op lockstep (M4)"): a party run starts only from a lobby's Start
 * (LobbyService -> `startLobbyRun`, the lobby's members are the consent; the registry refuses a party without it, and
 * members of an unconcluded party run are `busy`). It also gets a LockstepSession; every member gets
 * `partyRunStarted` (with the lobbyId). Each Heartbeat steps it (finalizing merged frames on the
 * server clock) and broadcasts `lockstepFrames` to the members; their `lockstepInput` / `lockstepHash` /
 * `lockstepFinal` go to it. It feeds its OWN merged log to the session's validator (clients' `submitSegment` /
 * `finishRun` are refused for party runs), so the verdict and the Co-op board post use the server's replayed score.
 * A member leaving (the server, or the run with `lockstepLeave`) makes them dead for the rest of the run (the owner
 * leaving does not abandon it). A desync ends the run unranked (`runFinished` code "desync" to every member).
 *
 * Lobby runs (shared/lobby LobbyRunTracker): a one-member lobby's run is the next solo session its player starts in
 * the lobby's world (endless or the Daily) after `lobbyRunStart`. Whenever a lobby's run ends (its session concluded
 * with any outcome, its solo player left, or no solo start came in time) the `onLobbyRunEnded` listeners hear the
 * lobbyId (LobbyService -> `runEnded`). A lobby's party run is created in the lobby's world too.
 *
 * A player playing the first-run tutorial (OnboardingService `isInTutorial`) is busy for lobbies too
 * (`busyReason` adds `tutorialBusyReason`): they cannot create or join a lobby or be invited, a lobby Start or a due
 * countdown with them in it is refused / cancelled (`busy`), and `startLobbyRun` re-checks every member, so a lobby
 * never pulls anyone out of the tutorial. Once a party run starts, its members are out of the tutorial
 * (OnboardingService `leaveTutorial`), and a late `tutorialStarted` from a member of an unconcluded party run is
 * ignored (`setPartyRunCheck`). The tutorial world itself is never a server run (shared/run SERVER_REFUSED_WORLDS:
 * every session start, lobby starts included, answers `unknown_world`).
 */
@Service({})
export class RunSessionService implements OnStart {
	private readonly janitor = new Janitor();
	private readonly random = new Random();
	private readonly registry = new RunSessionRegistry({
		newRunId: () => HttpService.GenerateGUID(false),
		pickSeed: () => this.random.NextInteger(0, MAX_RUN_SEED),
		// The Daily (docs/DAILY.md): one seed per UTC day from the server-only secret (DSD8).
		dailySeed: (day) => dailySeed(day),
	});
	private readonly meta = new Map<RunSession, SessionMeta>();
	private readonly startLimiter = new SlidingWindowLimiter<Player>(
		RUN_START_RATE.count,
		RUN_START_RATE.windowSeconds,
	);
	private readonly segmentLimiter = new SlidingWindowLimiter<Player>(
		SEGMENT_SUBMIT_RATE.count,
		SEGMENT_SUBMIT_RATE.windowSeconds,
	);
	/** Co-op lockstep sessions by runId, with their run session. */
	private readonly lockstep = new Map<string, { readonly coop: LockstepSession; readonly session: RunSession }>();
	private readonly inputLimiter = new SlidingWindowLimiter<Player>(
		LOCKSTEP_INPUT_RATE.count,
		LOCKSTEP_INPUT_RATE.windowSeconds,
	);
	private readonly hashLimiter = new SlidingWindowLimiter<Player>(
		LOCKSTEP_HASH_RATE.count,
		LOCKSTEP_HASH_RATE.windowSeconds,
	);
	private readonly finalLimiter = new SlidingWindowLimiter<Player>(
		LOCKSTEP_FINAL_RATE.count,
		LOCKSTEP_FINAL_RATE.windowSeconds,
	);
	private readonly leaveLimiter = new SlidingWindowLimiter<Player>(
		LOCKSTEP_LEAVE_RATE.count,
		LOCKSTEP_LEAVE_RATE.windowSeconds,
	);
	/** Which lobby each run belongs to (LobbyService hears when it ends). */
	private readonly lobbyRuns = new LobbyRunTracker();
	private readonly lobbyRunEndedListeners = new Set<LobbyRunEndedListener>();

	constructor(
		private readonly runs: RunValidationService,
		private readonly leaderboards: LeaderboardService,
		private readonly onboarding: OnboardingService,
		private readonly records: RecordsService,
	) {}

	onStart(): void {
		// BindToClose: the leaderboard flush waits for runs that may still post.
		this.leaderboards.setPendingPosts(() => this.pendingPosts());
		this.records.setPendingRuns(() => this.pendingPosts());
		// A late `tutorialStarted` from a member of a party run must not mark them in the tutorial.
		this.onboarding.setPartyRunCheck((p) => this.registry.busyReason(p.UserId) !== undefined);
		this.janitor.Add(
			Events.startRun.connect((player, request) => {
				if (player.Parent === undefined) return;
				const reply = this.start(player, request);
				if (player.Parent !== undefined) Events.runStarted.fire(player, reply);
			}),
		);
		this.janitor.Add(
			Events.submitSegment.connect((player, segment) => {
				if (player.Parent !== undefined) this.submitSegment(player, segment);
			}),
		);
		this.janitor.Add(
			Events.finishRun.connect((player, final) => {
				if (player.Parent !== undefined) this.finish(player, final);
			}),
		);
		this.janitor.Add(
			Events.lockstepInput.connect((player, runId, firstTick, data) => {
				if (!this.inputLimiter.tryAcquire(player, os.clock())) return;
				this.lockstep.get(runId)?.coop.submitInput(player.UserId, firstTick, data);
			}),
		);
		this.janitor.Add(
			Events.lockstepHash.connect((player, runId, ticks, hashes) => {
				// Batched (one call per client pump, throttled, resent until acknowledged): a dropped call is recovered.
				if (!this.hashLimiter.tryAcquire(player, os.clock())) return;
				this.lockstep.get(runId)?.coop.reportHashes(player.UserId, ticks, hashes);
			}),
		);
		this.janitor.Add(
			Events.lockstepFinal.connect((player, final) => {
				const runId = typeIs(final, "table") && typeIs(final.runId, "string") ? final.runId : "";
				// Its own limiter (an honest client sends one per run): never starved by hash traffic, never silent.
				if (!this.finalLimiter.tryAcquire(player, os.clock())) {
					log.warn("FINAL_DROPPED", `${player.UserId} run ${runId}: over LOCKSTEP_FINAL_RATE`);
					return;
				}
				const why = this.lockstep.get(runId)?.coop.reportFinal(player.UserId, final);
				if (why !== undefined && why !== "duplicate") {
					log.warn("FINAL_IGNORED", `${player.UserId} run ${runId}: ${why}`);
				}
			}),
		);
		this.janitor.Add(
			Events.lockstepLeave.connect((player, runId) => {
				if (player.Parent === undefined) return; // PlayerRemoving already released them
				if (!this.leaveLimiter.tryAcquire(player, os.clock())) return;
				this.leaveParty(player.UserId, runId);
			}),
		);
		this.janitor.Add(RunService.Heartbeat.Connect(() => this.stepLockstep()));
		this.janitor.Add(
			Players.PlayerRemoving.Connect((player) => {
				this.startLimiter.forget(player);
				this.segmentLimiter.forget(player);
				this.inputLimiter.forget(player);
				this.hashLimiter.forget(player);
				this.finalLimiter.forget(player);
				this.leaveLimiter.forget(player);
				// Co-op: the player is dead for the rest of every party run they are in (the run goes on), and free to
				// join another run once back.
				for (const [, entry] of this.lockstep) entry.coop.leave(player.UserId);
				this.registry.releaseFromParties(player.UserId);
				// Their solo lobby run (pending or bound) is over.
				for (const lobbyId of this.lobbyRuns.playerRemoving(player.UserId)) {
					this.lobbyRunEnded(lobbyId, "the player left");
				}
				const open = this.registry.openSession(player.UserId);
				if (open !== undefined && this.lockstep.has(open.runId)) return;
				const dropped = this.registry.dropOpen(player.UserId);
				if (dropped !== undefined) this.meta.delete(dropped);
			}),
		);
		const sweep = task.spawn(() => {
			for (;;) {
				task.wait(RUN_SESSION_SWEEP_SECONDS);
				for (const { session, result } of this.registry.sweep(os.clock())) {
					this.conclude(Players.GetPlayerByUserId(session.ownerId), session, result);
				}
			}
		});
		this.janitor.Add(() => task.cancel(sweep));
	}

	/** Creates a run session (public so a Studio command bar can drive it). A party starts only from a lobby. */
	start(player: Player, request: StartRunRequest): StartRunReply {
		const requestId = typeIs(request, "table") && typeIs(request.requestId, "number") ? request.requestId : 0;
		if (!this.startLimiter.tryAcquire(player, os.clock())) {
			return { requestId, ok: false, code: "rate_limited", reason: "too many runs started; try again later" };
		}
		const r = this.createSession(player, request, undefined);
		if (!r.ok) return { requestId, ok: false, code: r.code, reason: r.reason };
		const s = r.session;
		return {
			requestId,
			ok: true,
			runId: s.runId,
			seed: s.seed,
			worldKind: s.worldKind,
			atBossDoor: s.atBossDoor,
			members: [...s.members],
			daily: s.daily !== undefined ? { day: s.daily.day, ruleset: s.daily.ruleset } : undefined,
		};
	}

	private startContext(partyConsent: ReadonlyArray<number> | undefined): StartContext {
		const limits = this.runs.limits();
		return {
			now: os.clock(),
			unixNow: dailyClockNow(),
			isInServer: (id) => Players.GetPlayerByUserId(id) !== undefined,
			allowBossDoorSpawn: limits.allowBossDoorSpawn,
			allowDebugInput: limits.allowDebugInput,
			partyConsent,
		};
	}

	/** registry.start + the service's bookkeeping (meta, the replaced session concluded as abandoned). */
	private createSession(
		player: Player,
		request: StartRunRequest,
		partyConsent: ReadonlyArray<number> | undefined,
	):
		| { readonly ok: true; readonly session: RunSession }
		| { readonly ok: false; readonly code: StartRunReply["code"]; readonly reason: string } {
		const r = this.registry.start(player.UserId, request, this.startContext(partyConsent));
		if (!r.ok) {
			log.warn("START_REFUSED", `${player.UserId} ${r.code}: ${r.reason}`);
			return r;
		}
		const s = r.session;
		// The replaced open session (a solo restart) is concluded properly: the client hears runFinished("abandoned")
		// for it. A party run is never replaced (start answers busy, or, for an owner who left it, only detaches it:
		// its lockstep session goes on and concludes it for the others).
		if (r.replaced !== undefined) this.conclude(player, r.replaced, r.replaced.validator.getResult()!);
		const members: LeaderboardMember[] = s.members.map((id) => {
			const p = Players.GetPlayerByUserId(id);
			const m: LeaderboardMember = { userId: id, name: p !== undefined ? p.DisplayName : `#${id}` };
			if (id === s.ownerId && s.classId !== undefined) m.classId = s.classId;
			return m;
		});
		this.meta.set(s, { members, pumping: false });
		// The Daily's activity (docs/DAILY.md DS13): an attempt per member, `daily_start` / `daily_retry`. Never yields.
		const day = s.daily?.day;
		if (day !== undefined) {
			const [dailyOk, dailyErr] = pcall(() =>
				this.records.dailyStarted({
					runId: s.runId,
					day,
					memberIds: s.members,
					partySize: s.members.size(),
					debug: s.debug,
				}),
			);
			if (!dailyOk) log.warn("DAILY_START_FAILED", `run ${s.runId}: ${tostring(dailyErr)}`);
		}
		// A solo lobby run: the player's next solo start in the lobby's world after lobbyRunStart is the lobby's run.
		if (s.members.size() === 1) {
			const lobbyId = this.lobbyRuns.soloStarted(s.ownerId, s.runId, s.worldKind);
			if (lobbyId !== undefined) log.info("LOBBY_RUN", `run ${s.runId} is lobby ${lobbyId}'s solo run`);
		}
		log.info(
			"STARTED",
			`${player.UserId} run ${s.runId} world ${s.worldKind} seed ${s.seed} party ${s.members.size()}` +
				(s.daily !== undefined ? ` day ${s.daily.day} ruleset ${s.daily.ruleset}` : "") +
				(s.debug ? " (debug)" : ""),
		);
		return { ok: true, session: s };
	}

	// --- lobbies (LobbyService) -----------------------------------------------------------------

	/**
	 * Why the player cannot group up now, or undefined: a member of an unconcluded party run, or playing the
	 * tutorial (`tutorialBusyReason`). Solo runs are not busy.
	 */
	busyReason(userId: number): string | undefined {
		return this.registry.busyReason(userId) ?? this.tutorialBusyReason(userId);
	}

	/** Why `userId` cannot join a lobby run because of the tutorial (they are playing it), or undefined. */
	private tutorialBusyReason(userId: number): string | undefined {
		const p = Players.GetPlayerByUserId(userId);
		return p !== undefined && this.onboarding.isInTutorial(p) ? `player ${userId} is in the tutorial` : undefined;
	}

	/** Calls `listener` whenever a lobby's run is over (see the class comment). Returns the unsubscribe. */
	onLobbyRunEnded(listener: LobbyRunEndedListener): () => void {
		this.lobbyRunEndedListeners.add(listener);
		return () => this.lobbyRunEndedListeners.delete(listener);
	}

	/**
	 * A lobby's countdown ended (LobbyService, `Lobbies.tick`). Party: the run is created with the members (join
	 * order, the first is the owner) as consent, each member's open SOLO session is concluded first ("abandoned":
	 * they chose to leave it), and the lockstep run is announced (`partyRunStarted` with the lobbyId). Solo: the one
	 * member's client is told to start a ranked run (`lobbyRunStart`); that start is bound to the lobby. Both in the
	 * lobby's world (`start.worldKind`: endless or the Daily, whose seed is resolved now, at start time, like solo).
	 */
	startLobbyRun(start: LobbyRunStart): LobbyRunStartResult {
		// A member who readied and then started the tutorial is not pulled out of it (Lobbies.tick checks busyReason
		// too; this guards the handoff itself).
		for (const id of start.kind === "solo" ? [start.userId] : start.members) {
			const busy = this.tutorialBusyReason(id);
			if (busy !== undefined) return { ok: false, reason: `could not start: ${busy}` };
		}
		if (start.kind === "solo") {
			const player = Players.GetPlayerByUserId(start.userId);
			if (player === undefined) return { ok: false, reason: "the player left" };
			const replaced = this.lobbyRuns.expectSolo(start.userId, start.lobbyId, os.clock(), start.worldKind);
			if (replaced !== undefined) this.lobbyRunEnded(replaced, "another lobby run was requested");
			Events.lobbyRunStart.fire(player, { lobbyId: start.lobbyId, kind: "solo", worldKind: start.worldKind });
			log.info(
				"LOBBY_SOLO",
				`${start.userId} lobby ${start.lobbyId}: solo run requested (world ${start.worldKind})`,
			);
			return { ok: true };
		}
		const members = start.members;
		const owner = Players.GetPlayerByUserId(members[0]);
		if (owner === undefined) return { ok: false, reason: "a member left" };
		const others: number[] = [];
		for (let i = 1; i < members.size(); i++) others.push(members[i]);
		const r = this.createSession(owner, { requestId: 0, worldKind: start.worldKind, party: others }, members);
		if (!r.ok) return { ok: false, reason: `could not start: ${r.reason}` };
		const s = r.session;
		this.lobbyRuns.party(s.runId, start.lobbyId);
		// Every member's client switches to the party run: none of them is in the tutorial any more.
		for (const p of this.memberPlayers(s)) this.onboarding.leaveTutorial(p);
		for (const id of others) {
			const open = this.registry.openSession(id);
			if (open === undefined || open.members.size() > 1) continue;
			this.conclude(
				Players.GetPlayerByUserId(id),
				open,
				this.registry.close(open, "abandoned", "joined a party run"),
			);
		}
		this.startLockstep(s, start.lobbyId);
		return { ok: true };
	}

	/**
	 * `lockstepLeave`: `userId` leaves party run `runId` for good, as on PlayerRemoving for that run (dead for the rest
	 * of it, released so they are no longer busy), but stays in the server and in their lobby. Only a member of that
	 * live run; idempotent. The owner too: their next start leaves the party run running (registry.start detaches it).
	 */
	leaveParty(userId: number, runId: string): void {
		if (!typeIs(runId, "string")) return;
		const entry = this.lockstep.get(runId);
		if (entry === undefined || !entry.session.members.includes(userId)) return;
		if (entry.session.released.has(userId)) return;
		entry.coop.leave(userId);
		this.registry.releaseMember(entry.session, userId);
		log.info("PARTY_LEAVE", `${userId} left party run ${runId}`);
	}

	private lobbyRunEnded(lobbyId: string, reason: string): void {
		for (const listener of this.lobbyRunEndedListeners) {
			const [ok, err] = pcall(() => listener(lobbyId, reason));
			if (!ok) log.warn("LOBBY_LISTENER_FAILED", `lobby ${lobbyId}: ${tostring(err)}`);
		}
	}

	// --- co-op lockstep -------------------------------------------------------------------------

	/** A party run: its lockstep session (server clock from now), announced to every member. */
	private startLockstep(s: RunSession, lobbyId: string): void {
		const spawn = s.setup.spawn ?? { x: 0, z: 0 };
		const coop = new LockstepSession({
			runId: s.runId,
			seed: s.seed,
			spawn,
			members: s.members,
			validator: s.validator,
			startedAt: os.clock(),
			tunables: { ...DEFAULT_LOCKSTEP, allowDebugInput: s.debug },
		});
		this.lockstep.set(s.runId, { coop, session: s });
		const start = {
			runId: s.runId,
			seed: s.seed,
			worldKind: s.worldKind,
			members: [...s.members],
			// The old invite flow's field (removed with it, task L7): the lobby id, so it is never a stale invite's.
			lobbyId,
		};
		for (const p of this.memberPlayers(s)) Events.partyRunStarted.fire(p, start);
	}

	/** The members of `s` still in this server. */
	private memberPlayers(s: RunSession): Player[] {
		const out: Player[] = [];
		for (const id of s.members) {
			const p = Players.GetPlayerByUserId(id);
			if (p !== undefined) out.push(p);
		}
		return out;
	}

	/** Sessions whose verdict may still post (BindToClose waits for them): finals replaying, parties claiming. */
	private pendingPosts(): number {
		let n = 0;
		for (const [session] of this.meta) if (session.validator.getStatus() === "finishing") n++;
		for (const [, { coop }] of this.lockstep) if (coop.getStatus() === "finishing") n++;
		return n;
	}

	/** Heartbeat: solo lobby starts that never came, then every party run's clock, broadcasts, validator feed and ending. */
	private stepLockstep(): void {
		const now = os.clock();
		if (this.lobbyRuns.hasPending()) {
			for (const lobbyId of this.lobbyRuns.sweep(now)) this.lobbyRunEnded(lobbyId, "the solo run never started");
		}
		if (this.lockstep.size() === 0) return;
		const done: string[] = [];
		for (const [runId, { coop, session }] of this.lockstep) {
			// Concluded elsewhere (expiry, an error path): never keep broadcasting a run that no longer exists.
			if (!this.meta.has(session)) {
				done.push(runId);
				continue;
			}
			const [ok, out] = pcall(() => coop.step(now));
			if (!ok) {
				log.warn("LOCKSTEP_ERROR", `run ${runId}: ${tostring(out)}`);
				done.push(runId);
				const result = session.validator.abort("replay_error", truncateReason(`lockstep: ${tostring(out)}`));
				this.conclude(Players.GetPlayerByUserId(session.ownerId), session, result);
				continue;
			}
			const r = out as LockstepStepResult;
			if (r.broadcasts.size() > 0) {
				const players = this.memberPlayers(session);
				for (const b of r.broadcasts)
					Events.lockstepFrames.fire(players, runId, b.firstTick, b.data, r.ackTick);
			}
			for (const i of r.dropped) {
				log.warn("STALLED", `run ${runId}: player ${session.members[i]} dropped`);
				this.registry.releaseMember(session, session.members[i]);
			}
			const owner = Players.GetPlayerByUserId(session.ownerId);
			if (r.ended !== undefined) {
				log.warn(
					r.ended.code === "desync" ? "DESYNC" : "PARTY_ENDED",
					`run ${runId} tick ${r.ended.tick}: ${r.ended.reason}`,
				);
				done.push(runId);
				const result = session.validator.getResult();
				if (result !== undefined) this.conclude(owner, session, result);
				continue;
			}
			if (r.segmentsOffered > 0) this.registry.touch(session, now);
			if (r.submitted) {
				// Co-op credit: who was still in the run, captured from the server's own relay.
				const relay = coop.getRelay();
				const left: number[] = [];
				for (let i = 0; i < session.members.size(); i++) left.push(relay.leftFromTick(i) ?? NOT_LEFT);
				const meta = this.meta.get(session);
				if (meta !== undefined) meta.leftFromTick = left;
				this.registry.markFinishing(session);
				done.push(runId);
				const decided = session.validator.getResult();
				if (decided !== undefined) {
					this.conclude(owner, session, decided);
					continue;
				}
			}
			if (r.segmentsOffered > 0 || r.submitted) this.pump(owner, session);
		}
		for (const runId of done) this.lockstep.delete(runId);
	}

	private submitSegment(player: Player, segment: RunSegment): void {
		const runId = typeIs(segment, "table") && typeIs(segment.runId, "string") ? segment.runId : "";
		const session = this.registry.get(runId, player.UserId);
		if (session !== undefined && this.lockstep.has(runId)) {
			log.warn(
				"SEGMENT_IGNORED",
				`${player.UserId} run ${runId}: party runs are validated from the server's log`,
			);
			return;
		}
		if (session === undefined) {
			const index = typeIs(segment, "table") && typeIs(segment.index, "number") ? segment.index : -1;
			Events.segmentVerdict.fire(player, {
				runId: runId.sub(1, MAX_RUN_ID_CHARS),
				index,
				ok: false,
				code: "unknown_run",
				reason: "no such run (finished, expired or not yours)",
				startTick: 0,
				endTick: 0,
				serverHash: "",
			});
			return;
		}
		const now = os.clock();
		if (!this.segmentLimiter.tryAcquire(player, now)) {
			const result = this.registry.close(session, "rate_limited", "too many segments");
			this.conclude(player, session, result);
			return;
		}
		this.registry.touch(session, now);
		const offer = session.validator.offer(segment, now);
		if (!offer.ok) {
			this.fireSegment(player, offer.verdict);
			const result = session.validator.getResult();
			if (result !== undefined) this.conclude(player, session, result);
			return;
		}
		this.pump(player, session);
	}

	private finish(player: Player, final: RunFinal): void {
		const runId = typeIs(final, "table") && typeIs(final.runId, "string") ? final.runId : "";
		const session = this.registry.get(runId, player.UserId);
		if (session !== undefined && this.lockstep.has(runId)) return; // party runs end through lockstepFinal
		if (session === undefined) {
			Events.runFinished.fire(player, {
				runId: runId.sub(1, MAX_RUN_ID_CHARS),
				ok: false,
				code: "unknown_run",
				reason: "no such run (already decided, expired or not yours)",
				verifiedTicks: 0,
				serverHash: "",
				summary: { ticks: 0, kills: 0, bossDefeated: false, died: false },
				score: { ...DEFAULT_RUN_SCORE },
			});
			return;
		}
		const decided = session.validator.finish(final, os.clock());
		if (decided !== undefined) {
			this.conclude(player, session, decided);
			return;
		}
		if (session.validator.getStatus() !== "finishing") return; // a duplicate finish: the first one stands
		this.registry.markFinishing(session);
		const meta = this.meta.get(session);
		if (meta !== undefined && meta.release === undefined) meta.release = this.runs.trackExternal(player);
		this.pump(player, session);
	}

	/** Replays the session's queued segments through the shared replay queue, one segment per queue turn. */
	private pump(player: Player | undefined, session: RunSession): void {
		const meta = this.meta.get(session);
		if (meta === undefined || meta.pumping) return;
		meta.pumping = true;
		task.spawn(() => {
			const v = session.validator;
			let result: SegmentedRunResult | undefined;
			while (result === undefined && v.hasWork()) {
				const [ok, out] = pcall(() =>
					this.runs.runInReplayQueue(() => {
						const budget = new ReplayBudget(
							REPLAY_BUDGET_SECONDS,
							() => os.clock(),
							() => task.wait(),
						);
						const hooks = {
							onCheckpoint: () => budget.checkpoint(),
							checkpointEvery: SEGMENT_BUDGET_CHECK_TICKS,
						};
						// One fair turn: one segment at most, and at most REPLAY_TURN_MAX_TICKS of it (a long segment
						// resumes on the next turn, behind the runs queued meanwhile).
						const turn = replayTurn(v, SEGMENT_REPLAY_SLICE_TICKS, REPLAY_TURN_MAX_TICKS, hooks);
						for (const verdict of turn.verdicts) this.fireSegment(player, verdict);
						return turn.result;
					}),
				);
				result = ok
					? (out as SegmentedRunResult | undefined)
					: v.abort("replay_error", truncateReason(`internal error: ${tostring(out)}`));
			}
			meta.pumping = false;
			// An abort (expiry, leave) while replaying was concluded by whoever aborted it.
			if (result !== undefined && this.meta.has(session)) this.conclude(player, session, result);
		});
	}

	/** A run was decided: forget the session, report it, post it, answer the client. */
	private conclude(player: Player | undefined, session: RunSession, result: SegmentedRunResult): void {
		const meta = this.meta.get(session);
		if (meta === undefined) return; // already concluded
		this.meta.delete(session);
		this.registry.remove(session);
		// A lobby's run (any outcome): the lobby goes back to forming (its members are no longer busy by now).
		const lobbyId = this.lobbyRuns.concluded(session.runId);
		if (lobbyId !== undefined) this.lobbyRunEnded(lobbyId, `run ${session.runId} concluded`);
		let leaderboard: LeaderboardPostStatus | undefined;
		let records: Map<number, RunRecordsResult> | undefined;
		const s = result.summary;
		if (result.ok) {
			log.info(
				"ACCEPTED",
				`${session.ownerId} run ${session.runId} world ${session.worldKind} seed ${session.seed} hash ` +
					`${result.serverHash} ticks ${s.ticks} kills ${s.kills} score ${result.score.score} floor ` +
					`${result.score.floor}`,
			);
			if (player !== undefined && result.telemetry !== undefined) {
				this.runs.reportAccepted(player, {
					runId: session.runId,
					seed: session.seed,
					serverHash: result.serverHash,
					summary: s,
					telemetry: result.telemetry,
					acceptedAt: os.time(),
				});
			}
			// Co-op credit: only members who contributed (present until the end, or through one full floor).
			let credited = meta.members;
			if (session.members.size() > 1) {
				const left = meta.leftFromTick ?? [];
				const flags = partyContributors(
					(i) => (left[i] === undefined || left[i] === NOT_LEFT ? undefined : left[i]),
					session.members.size(),
					result.verifiedTicks,
					result.firstFloorChangeTick,
				);
				credited = meta.members.filter((_, i) => flags[i]);
			}
			const [ok, status] = pcall(() =>
				this.leaderboards.post({
					runId: session.runId,
					worldKind: session.worldKind,
					members: credited,
					partySize: session.members.size(),
					score: result.score.score,
					floor: result.score.floor,
					at: os.time(),
					debug: session.debug,
					died: s.died,
					bossDefeated: s.bossDefeated,
				}),
			);
			leaderboard = ok ? (status as LeaderboardPostStatus) : "failed";
			if (!ok) log.warn("POST_FAILED", `run ${session.runId}: ${tostring(status)}`);
			// Personal records (docs/NEW_BEST.md): the same credited members, the server's replay numbers. Never yields.
			const [recordsOk, applied] = pcall(() =>
				this.records.applyRun({
					runId: session.runId,
					worldKind: session.worldKind,
					memberIds: credited.map((m) => m.userId),
					partySize: session.members.size(),
					score: result.score.score,
					floor: result.score.floor,
					at: os.time(),
					debug: session.debug,
					died: s.died,
					bossDefeated: s.bossDefeated,
					daily: session.daily,
				}),
			);
			if (recordsOk) records = applied as Map<number, RunRecordsResult>;
			else log.warn("RECORDS_FAILED", `run ${session.runId}: ${tostring(applied)}`);
		} else {
			const code = result.code ?? "replay_error";
			log.warn(
				"REJECTED",
				`${session.ownerId} run ${session.runId} ${code}: ${result.reason ?? ""}` +
					(result.failedSegment !== undefined ? ` (segment ${result.failedSegment})` : ""),
			);
			// A restart or a leave is not a rejection worth an analytics event.
			if (player !== undefined && code !== "abandoned")
				this.runs.reportRejected(player, code, result.reason ?? code);
		}
		meta.release?.();
		this.lockstep.delete(session.runId);
		const verdict: RunFinishVerdict = {
			runId: session.runId,
			ok: result.ok,
			code: result.code,
			reason: result.reason,
			failedSegment: result.failedSegment,
			matchedThroughTick: result.matchedThroughTick,
			mismatchAtTick: result.mismatchAtTick,
			verifiedTicks: result.verifiedTicks,
			serverHash: result.serverHash,
			summary: s,
			score: result.score,
			leaderboard,
		};
		// Co-op: every member still here hears the verdict (owner included), each with their own records result.
		if (session.members.size() > 1) {
			for (const p of this.memberPlayers(session)) {
				Events.runFinished.fire(p, withRecords(verdict, records?.get(p.UserId)));
			}
			return;
		}
		if (player === undefined || player.Parent === undefined) return;
		Events.runFinished.fire(player, withRecords(verdict, records?.get(player.UserId)));
	}

	private fireSegment(player: Player | undefined, verdict: SegmentVerdict): void {
		if (player !== undefined && player.Parent !== undefined) Events.segmentVerdict.fire(player, verdict);
	}
}

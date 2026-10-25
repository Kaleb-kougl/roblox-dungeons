import { OnStart, Service } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { HttpService, Players, RunService } from "@rbxts/services";
import { serverLogger } from "server/log";
import { Events } from "server/network";
import { partyContributors, type LeaderboardMember } from "shared/leaderboard";
import type { LeaderboardPostStatus, PartyInviteUpdate, RunFinishVerdict } from "shared/network";
import {
	DEFAULT_RUN_SCORE,
	DEFAULT_RUN_SESSION_LIMITS,
	MAX_RUN_ID_CHARS,
	MAX_RUN_SEED,
	PARTY_INVITE_RATE,
	PARTY_INVITE_TTL_SECONDS,
	PartyInvites,
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
	type PartyInvite,
	type PartyInviteContext,
	type PartyInviteRequest,
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
	LockstepSession,
	type LockstepStepResult,
} from "shared/lockstep";
import { LeaderboardService } from "./LeaderboardService";
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
 *                  go to LeaderboardService and fire RunValidationService's accepted listeners: telemetry)
 *
 * A rejection at any point rejects the whole run (`runFinished` with the code, failed segment and tick window).
 * Open sessions expire (sweep every RUN_SESSION_SWEEP_SECONDS) and are dropped when their player leaves; a session
 * whose final arrived keeps validating after its player left (counted for TelemetryService's waitUntilIdle).
 *
 * Co-op (M4, shared/lockstep, docs/SERVER.md "Co-op lockstep (M4)"): a party run starts only from an invite every
 * member accepted (`partyInvite` / `partyRespond`, shared/run PartyInvites; the registry refuses a party without that
 * consent, and members of an unconcluded party run are `busy`). It also gets a LockstepSession; every member gets
 * `partyRunStarted` (with the inviteId). Each Heartbeat steps it (finalizing merged frames on the
 * server clock) and broadcasts `lockstepFrames` to the members; their `lockstepInput` / `lockstepHash` /
 * `lockstepFinal` go to it. It feeds its OWN merged log to the session's validator (clients' `submitSegment` /
 * `finishRun` are refused for party runs), so the verdict and the Co-op board post use the server's replayed score.
 * A member leaving makes them dead for the rest of the run (the owner leaving does not abandon it). A desync ends the
 * run unranked (`runFinished` code "desync" to every member).
 */
@Service({})
export class RunSessionService implements OnStart {
	private readonly janitor = new Janitor();
	private readonly random = new Random();
	private readonly registry = new RunSessionRegistry({
		newRunId: () => HttpService.GenerateGUID(false),
		pickSeed: () => this.random.NextInteger(0, MAX_RUN_SEED),
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
	/** Co-op consent: a party run starts only from an invite every member accepted. */
	private readonly invites = new PartyInvites({
		newId: () => HttpService.GenerateGUID(false),
		ttlSeconds: PARTY_INVITE_TTL_SECONDS,
		limits: DEFAULT_RUN_SESSION_LIMITS,
	});
	private readonly inviteLimiter = new SlidingWindowLimiter<Player>(
		PARTY_INVITE_RATE.count,
		PARTY_INVITE_RATE.windowSeconds,
	);

	constructor(private readonly runs: RunValidationService, private readonly leaderboards: LeaderboardService) {}

	onStart(): void {
		// BindToClose: the leaderboard flush waits for runs that may still post.
		this.leaderboards.setPendingPosts(() => this.pendingPosts());
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
			Events.partyInvite.connect((player, request) => {
				if (player.Parent !== undefined) this.invite(player, request);
			}),
		);
		this.janitor.Add(
			Events.partyRespond.connect((player, inviteId, accept) => {
				if (player.Parent !== undefined) this.respond(player, inviteId, accept);
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
				this.inviteLimiter.forget(player);
				for (const invite of this.invites.removePlayer(player.UserId)) this.notifyInvite(invite);
				// Co-op: the player is dead for the rest of every party run they are in (the run goes on), and free to
				// join another run once back.
				for (const [, entry] of this.lockstep) entry.coop.leave(player.UserId);
				this.registry.releaseFromParties(player.UserId);
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

	/** Creates a run session (public so a Studio command bar can drive it). A party here needs an accepted invite. */
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
		};
	}

	private startContext(partyConsent: ReadonlyArray<number> | undefined): StartContext {
		const limits = this.runs.limits();
		return {
			now: os.clock(),
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
		// The replaced open session (a solo restart; a party run is never replaced: start answers busy) is concluded
		// properly: the client hears runFinished("abandoned") for it.
		if (r.replaced !== undefined) this.conclude(player, r.replaced, r.replaced.validator.getResult()!);
		const members: LeaderboardMember[] = s.members.map((id) => {
			const p = Players.GetPlayerByUserId(id);
			const m: LeaderboardMember = { userId: id, name: p !== undefined ? p.DisplayName : `#${id}` };
			if (id === s.ownerId && s.classId !== undefined) m.classId = s.classId;
			return m;
		});
		this.meta.set(s, { members, pumping: false });
		log.info(
			"STARTED",
			`${player.UserId} run ${s.runId} world ${s.worldKind} seed ${s.seed} party ${s.members.size()}` +
				(s.debug ? " (debug)" : ""),
		);
		return { ok: true, session: s };
	}

	// --- co-op consent (invites) ----------------------------------------------------------------

	private inviteContext(): PartyInviteContext {
		return {
			now: os.clock(),
			isInServer: (id) => Players.GetPlayerByUserId(id) !== undefined,
			busyReason: (id) => this.registry.busyReason(id),
		};
	}

	private inviteUpdate(invite: PartyInvite, status: PartyInviteUpdate["status"]): PartyInviteUpdate {
		return {
			inviteId: invite.inviteId,
			status,
			hostId: invite.hostId,
			members: [...invite.members],
			accepted: [...invite.accepted],
			expiresIn: math.max(0, invite.expiresAt - os.clock()),
			reason: invite.reason,
		};
	}

	/** Tells every member still here what became of `invite` (its current status). */
	private notifyInvite(invite: PartyInvite): void {
		const update = this.inviteUpdate(invite, invite.status);
		for (const id of invite.members) {
			const p = Players.GetPlayerByUserId(id);
			if (p !== undefined) Events.partyInviteUpdate.fire(p, update);
		}
	}

	private refuseInvite(player: Player, inviteId: string, code: string, reason: string, requestId?: number): void {
		log.warn("INVITE_REFUSED", `${player.UserId} ${code}: ${reason}`);
		Events.partyInviteUpdate.fire(player, {
			inviteId: typeIs(inviteId, "string") ? inviteId.sub(1, MAX_RUN_ID_CHARS) : "",
			status: "refused",
			hostId: player.UserId,
			members: [],
			accepted: [],
			requestId,
			code,
			reason,
		});
	}

	/** `partyInvite`: the host asks the named players (public for Studio command bars). */
	invite(player: Player, request: PartyInviteRequest): void {
		const requestId = typeIs(request, "table") && typeIs(request.requestId, "number") ? request.requestId : 0;
		if (!this.inviteLimiter.tryAcquire(player, os.clock())) {
			this.refuseInvite(player, "", "rate_limited", "too many invites; try again later", requestId);
			return;
		}
		const r = this.invites.invite(player.UserId, request, this.inviteContext());
		if (!r.ok) {
			this.refuseInvite(player, "", r.code, r.reason, requestId);
			return;
		}
		if (r.replaced !== undefined) this.notifyInvite(r.replaced);
		const invite = r.invite;
		log.info("INVITED", `${player.UserId} invite ${invite.inviteId}: ${invite.members.join(",")}`);
		Events.partyInviteUpdate.fire(player, { ...this.inviteUpdate(invite, "pending"), requestId });
		const invited = this.inviteUpdate(invite, "invited");
		for (const id of invite.members) {
			if (id === invite.hostId) continue;
			const p = Players.GetPlayerByUserId(id);
			if (p !== undefined) Events.partyInviteUpdate.fire(p, invited);
		}
	}

	/** `partyRespond`: a member accepts or declines; the last accept starts the run. */
	respond(player: Player, inviteId: string, accept: boolean): void {
		if (!this.inviteLimiter.tryAcquire(player, os.clock())) {
			this.refuseInvite(player, inviteId, "rate_limited", "too many answers; try again later");
			return;
		}
		const r = this.invites.respond(player.UserId, inviteId, accept, this.inviteContext());
		if (!r.ok) {
			this.refuseInvite(player, inviteId, r.code, r.reason);
			if (r.invite !== undefined && r.invite.status !== "pending") this.notifyInvite(r.invite);
			return;
		}
		const invite = r.invite;
		if (invite.status !== "ready") {
			this.notifyInvite(invite);
			return;
		}
		this.startParty(invite);
	}

	/**
	 * Every member accepted: the party run is created with their consent, each member's open SOLO session is
	 * concluded first ("abandoned", runFinished: they chose to leave it), and the lockstep run is announced.
	 */
	private startParty(invite: PartyInvite): void {
		const host = Players.GetPlayerByUserId(invite.hostId);
		if (host === undefined) {
			const gone = this.invites.cancel(invite.inviteId, "the host left");
			if (gone !== undefined) this.notifyInvite(gone);
			return;
		}
		const others: number[] = [];
		for (const id of invite.members) if (id !== invite.hostId) others.push(id);
		const r = this.createSession(
			host,
			{ requestId: 0, worldKind: invite.worldKind, party: others },
			invite.members,
		);
		if (!r.ok) {
			const failed = this.invites.cancel(invite.inviteId, `could not start: ${r.reason}`);
			if (failed !== undefined) this.notifyInvite(failed);
			return;
		}
		const s = r.session;
		for (const id of others) {
			const open = this.registry.openSession(id);
			if (open === undefined || open.members.size() > 1) continue;
			this.conclude(
				Players.GetPlayerByUserId(id),
				open,
				this.registry.close(open, "abandoned", "joined a party run"),
			);
		}
		this.notifyInvite({ ...invite, status: "started" });
		for (const other of this.invites.started(invite.inviteId)) this.notifyInvite(other);
		this.startLockstep(s, invite.inviteId);
	}

	// --- co-op lockstep -------------------------------------------------------------------------

	/** A party run: its lockstep session (server clock from now), announced to every member. */
	private startLockstep(s: RunSession, inviteId: string): void {
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
		const start = { runId: s.runId, seed: s.seed, worldKind: s.worldKind, members: [...s.members], inviteId };
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

	/** Heartbeat: invite expiry, then every party run's clock, broadcasts, validator feed and ending. */
	private stepLockstep(): void {
		const now = os.clock();
		if (this.invites.size() > 0) for (const invite of this.invites.sweep(now)) this.notifyInvite(invite);
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
		let leaderboard: LeaderboardPostStatus | undefined;
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
		// Co-op: every member still here hears the verdict (owner included).
		if (session.members.size() > 1) {
			for (const p of this.memberPlayers(session)) Events.runFinished.fire(p, verdict);
			return;
		}
		if (player === undefined || player.Parent === undefined) return;
		Events.runFinished.fire(player, verdict);
	}

	private fireSegment(player: Player | undefined, verdict: SegmentVerdict): void {
		if (player !== undefined && player.Parent !== undefined) Events.segmentVerdict.fire(player, verdict);
	}
}

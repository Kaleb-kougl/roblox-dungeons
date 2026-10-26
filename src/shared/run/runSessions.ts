/**
 * Server-side run sessions (M3): `startRun` creates one, with a seed the SERVER picks, and every segment and the
 * final submit name its runId. Players never choose seeds, and a runId is only good for its owner.
 *
 * Per player: at most one OPEN session (a new start drops the old open one: a restart; a party run the owner left is
 * only detached, never dropped, see `start`), plus up to
 * `maxFinishingPerPlayer` sessions still validating their last segment (one more start answers `busy`). Open
 * sessions expire after `idleSeconds` without a segment or `maxAgeSeconds` in all (`sweep`).
 *
 * Pure and Roblox-API-free: the runId generator, the seed picker and the clock are injected (HttpService GUIDs,
 * Random and os.clock on the server; counters in tests). The world comes from the registry (worlds.ts).
 */
import { isValidRunSeed, type RunSetup } from "./config";
import {
	DEFAULT_RUN_SESSION_LIMITS,
	DEFAULT_SEGMENT_LIMITS,
	MAX_CLASS_ID_CHARS,
	MAX_WORLD_KIND_CHARS,
	type RunSessionLimits,
	type SegmentLimits,
} from "./limits";
import type { RunScoreReader } from "./score";
import { SegmentedValidator, type SegmentRejectCode, type SegmentedRunResult } from "./segments";
import { errorMessage, isFiniteValue, truncateReason } from "./validate";
import { buildWorldSetup, isRunWorldKind, isServerRunWorld, type RunWorldKind } from "./worlds";

/** `startRun` (shared/network). */
export interface StartRunRequest {
	/** Echoed in the reply so the client matches it to its request. */
	requestId: number;
	/** A registered world kind (worlds.ts). */
	worldKind: string;
	/** Other party members' UserIds (co-op; omit or empty for solo). Each must be in this server. */
	party?: number[];
	/** Debug start at the boss door (refused unless the limits allow it). */
	atBossDoor?: boolean;
	/** The owner's class id, stored with leaderboard entries (optional, display only). */
	classId?: string;
}

export type StartRunRejectCode =
	| "bad_request"
	| "unknown_world"
	| "debug_spawn"
	| "bad_party"
	| "busy"
	| "config_error"
	| "rate_limited";

/** `runStarted` (shared/network): the server's answer to `startRun`. */
export interface StartRunReply {
	requestId: number;
	ok: boolean;
	runId?: string;
	seed?: number;
	worldKind?: string;
	atBossDoor?: boolean;
	/** Party members (owner first). */
	members?: number[];
	code?: StartRunRejectCode;
	reason?: string;
}

export interface RunSession {
	readonly runId: string;
	readonly seed: number;
	readonly worldKind: RunWorldKind;
	readonly ownerId: number;
	/** Owner first; size 1 = solo. */
	readonly members: ReadonlyArray<number>;
	readonly classId: string | undefined;
	readonly atBossDoor: boolean;
	/** Debug limits were in force (debug input or boss door allowed): never posts to a leaderboard. */
	readonly debug: boolean;
	/** Session start (the registry's clock, seconds). */
	readonly createdAt: number;
	/** Last segment (or the start). */
	lastActivity: number;
	readonly setup: RunSetup;
	readonly validator: SegmentedValidator;
	/**
	 * Party runs: members no longer in the run (left the server, dropped as stalled). They are free to start or join
	 * another run although this one is still being played (`busyReason`).
	 */
	readonly released: Set<number>;
}

/** What the caller knows about the start that the registry cannot (who is in the server, what is allowed). */
export interface StartContext {
	readonly now: number;
	/** The UserId is a player in this server. */
	readonly isInServer: (userId: number) => boolean;
	readonly allowBossDoorSpawn: boolean;
	/** Debug input allowed for this run (Studio tooling): also marks the session `debug`. */
	readonly allowDebugInput: boolean;
	/**
	 * Co-op consent: the members (owner first) of a lobby whose host pressed Start (shared/lobby). A start
	 * whose party has 2+ members is refused unless its resolved party is exactly this list: a client's `startRun` can
	 * never name a party on its own.
	 */
	readonly partyConsent?: ReadonlyArray<number>;
}

export type StartRunResult =
	| { readonly ok: true; readonly session: RunSession; readonly replaced: RunSession | undefined }
	| { readonly ok: false; readonly code: StartRunRejectCode; readonly reason: string };

export interface RunSessionDeps {
	readonly newRunId: () => string;
	/** A seed in [0, 2^32). */
	readonly pickSeed: () => number;
	readonly limits?: RunSessionLimits;
	readonly segmentLimits?: SegmentLimits;
	readonly readScore?: RunScoreReader;
}

function isUserId(v: unknown): v is number {
	return isFiniteValue(v) && v > 0 && math.floor(v) === v;
}

/**
 * The party for a start: the owner first, then the requested members (deduplicated, owner skipped). Every member
 * must be a player in this server and the party at most `maxParty`. Returns the members or a reason.
 */
export function resolveParty(
	ownerId: number,
	requested: ReadonlyArray<number> | undefined,
	isInServer: (userId: number) => boolean,
	maxParty: number,
): ReadonlyArray<number> | string {
	const members = [ownerId];
	if (requested === undefined) return members;
	if (!typeIs(requested, "table")) return "party must be an array";
	const list = requested as ReadonlyArray<unknown>;
	if (list.size() > maxParty) return `party over ${maxParty} players`;
	for (let i = 0; i < list.size(); i++) {
		const id = list[i];
		if (!isUserId(id)) return `party member ${i} is not a UserId`;
		if (id === ownerId || members.includes(id)) continue;
		if (!isInServer(id)) return `party member ${id} is not in this server`;
		members.push(id);
	}
	if (members.size() > maxParty) return `party over ${maxParty} players`;
	return members;
}

/** The run's party is exactly the invite's members, in order (what RunSessionRegistry.start checks). */
export function sameParty(a: ReadonlyArray<number>, b: ReadonlyArray<number>): boolean {
	if (a.size() !== b.size()) return false;
	for (let i = 0; i < a.size(); i++) if (a[i] !== b[i]) return false;
	return true;
}

function requestShape(r: StartRunRequest): string | undefined {
	if (!typeIs(r, "table")) return "request is not an object";
	if (!isFiniteValue(r.requestId)) return "requestId must be a number";
	if (!typeIs(r.worldKind, "string") || r.worldKind.size() === 0 || r.worldKind.size() > MAX_WORLD_KIND_CHARS) {
		return "worldKind must be a short string";
	}
	if (r.atBossDoor !== undefined && !typeIs(r.atBossDoor, "boolean")) return "atBossDoor must be a boolean";
	if (r.classId !== undefined && (!typeIs(r.classId, "string") || r.classId.size() > MAX_CLASS_ID_CHARS)) {
		return "classId must be a short string";
	}
	return undefined;
}

/** A party run (2+ members) still being played or decided: never replaced by its owner's new start. */
function isUnconcludedParty(s: RunSession): boolean {
	if (s.members.size() < 2) return false;
	const status = s.validator.getStatus();
	return status === "open" || status === "finishing";
}

/** All run sessions of one server (see the file comment). */
export class RunSessionRegistry {
	private readonly byId = new Map<string, RunSession>();
	/** Each player's open session. */
	private readonly openByOwner = new Map<number, RunSession>();
	private readonly limits: RunSessionLimits;
	private readonly segmentLimits: SegmentLimits;

	constructor(private readonly deps: RunSessionDeps) {
		this.limits = deps.limits ?? DEFAULT_RUN_SESSION_LIMITS;
		this.segmentLimits = deps.segmentLimits ?? DEFAULT_SEGMENT_LIMITS;
	}

	/**
	 * Creates a session for `ownerId`: request shape, world kind (registered, not SERVER_REFUSED_WORLDS), debug
	 * spawn, party, `busy`, then the world (built from a server-picked seed). Replaces (and returns) the owner's open
	 * solo session, which is aborted as `abandoned`; an unconcluded party run the owner was released from is detached
	 * instead (not returned).
	 */
	start(ownerId: number, request: StartRunRequest, ctx: StartContext): StartRunResult {
		const shape = requestShape(request);
		if (shape !== undefined) return { ok: false, code: "bad_request", reason: `bad request: ${shape}` };
		if (!isRunWorldKind(request.worldKind)) {
			return { ok: false, code: "unknown_world", reason: `unknown world kind ${request.worldKind}` };
		}
		if (!isServerRunWorld(request.worldKind)) {
			return { ok: false, code: "unknown_world", reason: `world ${request.worldKind} is played locally only` };
		}
		const atBossDoor = request.atBossDoor === true;
		if (atBossDoor && !ctx.allowBossDoorSpawn) {
			return { ok: false, code: "debug_spawn", reason: "debug spawn: runs from the boss door are not accepted" };
		}
		const party = resolveParty(ownerId, request.party, ctx.isInServer, this.limits.maxPartySize);
		if (typeIs(party, "string")) return { ok: false, code: "bad_party", reason: `bad party: ${party}` };
		if (party.size() > 1 && (ctx.partyConsent === undefined || !sameParty(ctx.partyConsent, party))) {
			return {
				ok: false,
				code: "bad_party",
				reason: "bad party: a party run starts only from an invite every member accepted",
			};
		}
		// Nobody may be in an unconcluded party run (the owner's own included: a restart while the party's verdict is
		// still being decided would leave its lockstep session without a run).
		for (const id of party) {
			const busy = this.busyReason(id);
			if (busy !== undefined) return { ok: false, code: "busy", reason: busy };
		}
		if (this.finishingCount(ownerId) >= this.limits.maxFinishingPerPlayer) {
			return { ok: false, code: "busy", reason: "previous runs are still being checked" };
		}

		const seed = this.deps.pickSeed();
		if (!isValidRunSeed(seed)) return { ok: false, code: "config_error", reason: "config error: bad seed picked" };
		// Co-op (M4): the world is built for the whole party (enemy hp / room budgets scale with its size).
		const [built, setupOrErr] = pcall(() =>
			buildWorldSetup(request.worldKind, seed, { atBossDoor, partySize: party.size() }),
		);
		if (!built) {
			return {
				ok: false,
				code: "config_error",
				reason: truncateReason(`config error: ${errorMessage(setupOrErr)}`),
			};
		}
		const setup = setupOrErr as RunSetup;
		const runId = this.deps.newRunId();
		const segmentLimits: SegmentLimits = ctx.allowDebugInput
			? { ...this.segmentLimits, allowDebugInput: true }
			: this.segmentLimits;
		const session: RunSession = {
			runId,
			seed,
			worldKind: request.worldKind,
			ownerId,
			members: party,
			classId: request.classId,
			atBossDoor,
			debug: ctx.allowDebugInput || atBossDoor,
			createdAt: ctx.now,
			lastActivity: ctx.now,
			setup,
			released: new Set(),
			validator: new SegmentedValidator({
				runId,
				seed,
				worldKind: request.worldKind,
				setup,
				createdAt: ctx.now,
				limits: segmentLimits,
				readScore: this.deps.readScore,
			}),
		};
		// The owner's open session: a solo one is replaced (a restart, aborted as `abandoned`). A party run still being
		// played or decided is never replaced: its owner can only get here released from it (left it, or stalled; else
		// `busy` above), and the others play on. It is only detached (no longer the owner's open session); its
		// lockstep session concludes it.
		const previous = this.openByOwner.get(ownerId);
		const replaced = previous !== undefined && !isUnconcludedParty(previous) ? previous : undefined;
		if (replaced !== undefined) this.close(replaced, "abandoned", "a new run started");
		this.byId.set(runId, session);
		this.openByOwner.set(ownerId, session);
		return { ok: true, session, replaced };
	}

	/** The session `runId` if `ownerId` owns it. */
	get(runId: string, ownerId: number): RunSession | undefined {
		const s = typeIs(runId, "string") ? this.byId.get(runId) : undefined;
		return s !== undefined && s.ownerId === ownerId ? s : undefined;
	}

	/** The owner's open session, if any. */
	openSession(ownerId: number): RunSession | undefined {
		return this.openByOwner.get(ownerId);
	}

	/**
	 * Why `userId` cannot start or join a run now: they are a member (not released) of a party run that is still
	 * being played or decided (its validator has not accepted / rejected it yet). Undefined when free. A solo open
	 * session is not "busy": a new start replaces it (a restart).
	 */
	busyReason(userId: number): string | undefined {
		for (const [, s] of this.byId) {
			if (s.members.size() < 2 || !s.members.includes(userId) || s.released.has(userId)) continue;
			const status = s.validator.getStatus();
			if (status === "open" || status === "finishing") {
				return `player ${userId} is in party run ${s.runId} (not concluded yet)`;
			}
		}
		return undefined;
	}

	/** A party member is out of the run (left / stalled): busyReason no longer counts them. */
	releaseMember(session: RunSession, userId: number): void {
		if (session.members.includes(userId)) session.released.add(userId);
	}

	/** The player left the server: released from every party run they are in. */
	releaseFromParties(userId: number): void {
		for (const [, s] of this.byId) if (s.members.size() > 1) this.releaseMember(s, userId);
	}

	/**
	 * The owner's sessions that finished and are still validating. A party run its owner was released from (left)
	 * does not count: they are out of it, as free as the other leavers.
	 */
	finishingCount(ownerId: number): number {
		let n = 0;
		for (const [, s] of this.byId) {
			if (s.ownerId !== ownerId || s.released.has(ownerId)) continue;
			if (s.validator.getStatus() === "finishing") n++;
		}
		return n;
	}

	/** Records activity (a segment arrived). */
	touch(session: RunSession, now: number): void {
		session.lastActivity = now;
	}

	/** The session's final arrived: it is no longer the owner's open session (a new start will not replace it). */
	markFinishing(session: RunSession): void {
		if (this.openByOwner.get(session.ownerId) === session) this.openByOwner.delete(session.ownerId);
	}

	/** Forgets a decided session. */
	remove(session: RunSession): void {
		this.byId.delete(session.runId);
		if (this.openByOwner.get(session.ownerId) === session) this.openByOwner.delete(session.ownerId);
	}

	/** Aborts (if undecided) and forgets a session. */
	close(session: RunSession, code: SegmentRejectCode, reason: string): SegmentedRunResult {
		const result = session.validator.abort(code, reason);
		this.remove(session);
		return result;
	}

	/** Expires open sessions idle or too old at `now`; returns them with their (expired) results. */
	sweep(now: number): Array<{ session: RunSession; result: SegmentedRunResult }> {
		const out: Array<{ session: RunSession; result: SegmentedRunResult }> = [];
		const expired: RunSession[] = [];
		for (const [, s] of this.byId) {
			if (s.validator.getStatus() !== "open") continue;
			if (now - s.lastActivity > this.limits.idleSeconds || now - s.createdAt > this.limits.maxAgeSeconds) {
				expired.push(s);
			}
		}
		for (const s of expired) {
			const idle = now - s.lastActivity > this.limits.idleSeconds;
			out.push({
				session: s,
				result: this.close(s, "expired", idle ? "expired: no segment for too long" : "expired: run too old"),
			});
		}
		return out;
	}

	/** The owner left: their open session is dropped (`abandoned`); finishing ones keep validating. */
	dropOpen(ownerId: number): RunSession | undefined {
		const s = this.openByOwner.get(ownerId);
		if (s !== undefined) this.close(s, "abandoned", "player left");
		return s;
	}

	/** Sessions tracked (open + finishing). */
	size(): number {
		return this.byId.size();
	}
}

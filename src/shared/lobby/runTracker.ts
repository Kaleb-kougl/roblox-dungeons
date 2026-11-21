/**
 * Which lobby each run belongs to, so the lobby hears when its run is over (`Lobbies.runEnded`). RunSessionService
 * owns one and reports what happens to run sessions; every method returns the lobbies whose run just ENDED.
 *
 *   party      the server created the party run itself (`startLobbyRun`): runId -> lobby at once.
 *   solo       the server asked the one member's client to start a ranked run in the lobby's world (`lobbyRunStart`).
 *              The lobby waits (pending) for that player's next solo session start in that world (`soloStarted`
 *              binds it; a start in another world does not); no start within `soloStartTimeoutSeconds` (`sweep`)
 *              ends the lobby run.
 *   concluded  any outcome of a bound session (accepted, rejected, abandoned by a restart, expired) ends its lobby run.
 *   playerRemoving  a pending or bound SOLO lobby run of the leaving player ends (a party run goes on without them).
 *
 * Pure (the clock is passed in).
 *
 * @module
 */
import { LOBBY, LOBBY_SERVICE } from "./config";

interface PendingSolo {
	readonly lobbyId: string;
	readonly deadline: number;
	/** The world the lobby's run must be started in. */
	readonly worldKind: string;
}

/**
 * The tracker itself (see the file comment), one per server, owned by RunSessionService. `soloStartTimeoutSeconds` is
 * how long a requested solo lobby run may stay unstarted before `sweep` ends it (default
 * LOBBY_SERVICE.soloStartTimeoutSeconds, 30 s); times are whatever clock the caller passes as `now`.
 */
export class LobbyRunTracker {
	/** runId -> lobbyId (bound party and solo runs). */
	private readonly byRun = new Map<string, string>();
	/** Solo owner -> their bound runId. */
	private readonly soloRunOf = new Map<number, string>();
	private readonly pending = new Map<number, PendingSolo>();

	constructor(private readonly soloStartTimeoutSeconds = LOBBY_SERVICE.soloStartTimeoutSeconds) {}

	/** A lobby's party run started as `runId`. */
	party(runId: string, lobbyId: string): void {
		this.byRun.set(runId, lobbyId);
	}

	/**
	 * A solo lobby run was requested from `userId`'s client. Returns the lobby of an earlier pending start of theirs
	 * that this replaces (ended), if any.
	 */
	expectSolo(
		userId: number,
		lobbyId: string,
		now: number,
		worldKind: string = LOBBY.defaultWorld,
	): string | undefined {
		const before = this.pending.get(userId);
		this.pending.set(userId, { lobbyId, deadline: now + this.soloStartTimeoutSeconds, worldKind });
		return before !== undefined && before.lobbyId !== lobbyId ? before.lobbyId : undefined;
	}

	/**
	 * `ownerId` started a solo session `runId` in `worldKind`: bound to their pending lobby run when it is that lobby's
	 * world (another world's start is not the lobby's run). Returns that lobby.
	 */
	soloStarted(ownerId: number, runId: string, worldKind: string = LOBBY.defaultWorld): string | undefined {
		const p = this.pending.get(ownerId);
		if (p === undefined || p.worldKind !== worldKind) return undefined;
		this.pending.delete(ownerId);
		this.byRun.set(runId, p.lobbyId);
		this.soloRunOf.set(ownerId, runId);
		return p.lobbyId;
	}

	/** Session `runId` was decided (any outcome) or dropped: its lobby run ended. */
	concluded(runId: string): string | undefined {
		const lobbyId = this.byRun.get(runId);
		if (lobbyId === undefined) return undefined;
		this.byRun.delete(runId);
		for (const [ownerId, id] of this.soloRunOf) {
			if (id === runId) {
				this.soloRunOf.delete(ownerId);
				break;
			}
		}
		return lobbyId;
	}

	/** The player left the server: their pending or bound solo lobby run ended. */
	playerRemoving(userId: number): string[] {
		const out: string[] = [];
		const p = this.pending.get(userId);
		if (p !== undefined) {
			this.pending.delete(userId);
			out.push(p.lobbyId);
		}
		const runId = this.soloRunOf.get(userId);
		if (runId !== undefined) {
			const lobbyId = this.concluded(runId);
			if (lobbyId !== undefined) out.push(lobbyId);
		}
		return out;
	}

	/** Pending solo starts past their deadline (ended), in UserId order. */
	sweep(now: number): string[] {
		const due: number[] = [];
		for (const [userId, p] of this.pending) if (now >= p.deadline) due.push(userId);
		due.sort((a, b) => a < b);
		const out: string[] = [];
		for (const userId of due) {
			out.push(this.pending.get(userId)!.lobbyId);
			this.pending.delete(userId);
		}
		return out;
	}

	hasPending(): boolean {
		return this.pending.size() > 0;
	}

	/** The lobby bound to `runId`, if any. */
	lobbyOfRun(runId: string): string | undefined {
		return this.byRun.get(runId);
	}

	/** Bound runs (for leak checks). */
	size(): number {
		return this.byRun.size();
	}
}

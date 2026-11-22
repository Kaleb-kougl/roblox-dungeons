/**
 * Run submission and verdict bookkeeping (docs/SIM_CONTROLLER.md step 5; SimController's `submitted` /
 * `lastSubmittedDied` / `awaiting` / `rankedRuns` fields and its submit methods, bodies unchanged): one
 * {@link RunSubmissions} the controller owns. A solo run is submitted once at its end (`submit`: the old whole-run
 * `submitRun`, or a ranked run's last segment and `finishRun`), a ranked run's segments are uploaded as they are cut
 * (`uploadSegments`), and the records claims of finished ranked runs are kept while their verdicts are pending
 * (`pendingRunClaims`). It reads the controller through {@link SubmissionHost} only.
 *
 * What stays in SimController: `onRunFinished` (a ranked verdict can end the co-op run and stop it for the menu) and
 * the frame's own calls, in their order.
 *
 * @module
 */
import { Events } from "client/network";
import { clientStore, selectDailyStatus, type VerdictView } from "client/store";
import { DAILY_WORLD_KIND } from "shared/daily";
import type { RunVerdict } from "shared/network";
import { oversizeSubmission, shouldSubmitRun, unsubmittedReason, type RunEnding } from "shared/play";
import { RECORDS_POLICY } from "shared/records";
import { errorMessage, type RunFinal, type RunSubmission, type RunWorldKind, type SegmentVerdict } from "shared/run";
import { partySize, type SimState } from "shared/sim";
import { boardFor, type PendingRunClaim } from "shared/view/hud";
import type { RunContext } from "./context";

/** What {@link RunSubmissions} reads of its controller (SimController's own public getters). */
export interface SubmissionHost {
	/** The current run's context, or undefined with no run. */
	getContext(): RunContext | undefined;
	/** KV_Debug as read at the current (or last) run's start. */
	isDebugRun(): boolean;
}

/**
 * A finished ranked run of `world` may raise the new-best baseline while its verdict is pending (pendingRunClaims):
 * not with KV_Debug, and only in a world whose runs count toward personal records (shared/records RECORDS_POLICY: a
 * Daily run never does, docs/DAILY.md DSD6).
 */
function claimsRecords(debug: boolean, world: RunWorldKind): boolean {
	return !debug && RECORDS_POLICY.eligibleWorlds.includes(world);
}

/**
 * A finished ranked Daily run may raise the next daily run's best-today baseline while its verdict is pending
 * (docs/DAILY.md DS10: pendingRunClaims with `daily`, the day): not with KV_Debug (it never posts).
 */
function claimsDaily(debug: boolean, world: RunWorldKind): boolean {
	return !debug && world === DAILY_WORLD_KIND;
}

/** The submissions and ranked runs of one client session (see the file comment). One per SimController. */
export class RunSubmissions {
	/** The current run was submitted (or decided never to be): `submit` runs once. Reset at every run start. */
	submitted = false;
	/** The last run submitted ended in a death: the next run is a retry and is submitted even if abandoned early. */
	private lastSubmittedDied = false;
	/** claimedHash -> run counter of submissions waiting for a verdict. */
	private readonly awaiting = new Map<string, { run: number; ending: string }>();
	/**
	 * Ranked runs started this session: runId -> run counter, (once finished) ending, and `claim`: the run's board and
	 * final score / floor while its records may still be on the way (docs/NEW_BEST.md: the client's own numbers once
	 * the final claim was sent and the verdict is pending, the server's once accepted with a records result; cleared
	 * on a rejection or an accepted run that did not count). See pendingRunClaims.
	 */
	readonly rankedRuns = new Map<
		string,
		{ run: number; ending?: string; decided: boolean; claim?: PendingRunClaim }
	>();

	constructor(private readonly host: SubmissionHost) {}

	/**
	 * Earlier ranked runs of this session whose records may not be in the client's records yet (docs/NEW_BEST.md
	 * "pending runs"): finished, final claim sent, verdict pending (the client's own score and floor), or accepted with
	 * a records result (the server's numbers). Never debug runs (KV_Debug: they never count), rejected runs or accepted
	 * runs that did not count. NewBestController folds them into a new run's baseline (shared/view/hud withPendingRuns).
	 */
	pendingRunClaims(): ReadonlyArray<PendingRunClaim> {
		const out = new Array<PendingRunClaim>();
		for (const [, entry] of this.rankedRuns) if (entry.claim !== undefined) out.push(entry.claim);
		return out;
	}

	/**
	 * Submits the current run once (death, victory, or abandoned by a restart). Short abandoned runs are not sent
	 * (shared/play `shouldSubmitRun`), and a run over the server's caps is kept and shown as rejected locally
	 * (`oversizeSubmission`): the server would reject it unread, after the upload.
	 */
	submit(ending: RunEnding): void {
		const ctx = this.host.getContext();
		if (ctx === undefined || this.submitted) return;
		this.submitted = true;
		const run = ctx.live;
		if (run === undefined) return; // co-op runs end through lockstepFinal (coopFrame)
		if (run.ticks() === 0) return;
		// Tutorial runs are local practice; stress configs are never built by the server; a KV_Scoring run on an M1
		// world would never match the server's unscored replay.
		const never = unsubmittedReason(ctx);
		if (never !== undefined) {
			clientStore.setVerdict({ status: "skipped", run: ctx.counter, ending, code: never });
			return;
		}
		if (!shouldSubmitRun(ending, run.ticks(), this.lastSubmittedDied)) {
			// A ranked session left open is replaced (abandoned) by the next startRun.
			clientStore.setVerdict({ status: "skipped", run: ctx.counter, ending, code: "short" });
			return;
		}
		this.lastSubmittedDied = ending === "death";
		if (ctx.runId !== undefined) {
			this.finishRanked(ctx, ending);
			return;
		}
		const [ok, result] = pcall(() => run.submission());
		if (!ok) {
			warn(`[Sim] could not build the submission: ${errorMessage(result)}`);
			clientStore.setVerdict({ status: "skipped", run: ctx.counter, ending, code: "error" });
			return;
		}
		// docs/ARCHER.md AR5: the server's replay builds the world with the run's character (absent: none, M1).
		const built = result as RunSubmission;
		const submission: RunSubmission =
			ctx.character !== undefined ? { ...built, characterId: ctx.character } : built;
		const kept = oversizeSubmission(submission);
		if (kept !== undefined) {
			warn(
				`[Sim] run ${ctx.counter} (${ending}) ${kept.reason}: ${buffer.len(submission.recording)} bytes, ` +
					`${submission.claimed.ticks} ticks`,
			);
			clientStore.setVerdict({
				status: "rejected",
				run: ctx.counter,
				ending,
				code: kept.code,
				reason: kept.reason,
				claimedHash: submission.claimedHash,
			});
			return;
		}
		this.awaiting.set(submission.claimedHash, { run: ctx.counter, ending });
		clientStore.setVerdict({ status: "pending", run: ctx.counter, ending, claimedHash: submission.claimedHash });
		Events.submitRun.fire(submission);
		print(
			`[Sim] submitted run ${ctx.counter} (${ending}): ${submission.claimed.ticks} ticks, ` +
				`${buffer.len(submission.recording)} bytes, hash ${submission.claimedHash}`,
		);
	}

	/** A finished run's records claim: its board, final score and floor (pendingRunClaims). */
	private claimOf(state: Readonly<SimState>): PendingRunClaim {
		return {
			board: boardFor(partySize(state)),
			score: state.score?.total ?? 0,
			floor: state.endless?.floor ?? 0,
		};
	}

	/**
	 * A finished ranked run's claim for pendingRunClaims, or undefined: an endless run's records claim, a Daily run's
	 * best-today claim tagged with its day (the daily status of the run's own seed; none when that status is gone, e.g.
	 * the day changed: the next run's baseline is a new day's anyway), nothing for any other world or KV_Debug.
	 */
	finishedClaim(ctx: RunContext, state: Readonly<SimState>): PendingRunClaim | undefined {
		if (claimsRecords(this.host.isDebugRun(), ctx.world)) return this.claimOf(state);
		if (!claimsDaily(this.host.isDebugRun(), ctx.world)) return undefined;
		const status = selectDailyStatus(clientStore.getState());
		if (status === undefined || status.seed !== ctx.seed) return undefined;
		return { ...this.claimOf(state), daily: status.day };
	}

	/** Sends the segments the run cut (ranked runs that the server has not rejected yet). */
	uploadSegments(ctx: RunContext): void {
		const runId = ctx.runId;
		const live = ctx.live;
		if (runId === undefined || live === undefined) return;
		const segments = live.takeSegments();
		if (this.rankedRuns.get(runId)?.decided === true) return; // rejected mid-run: the rest is unranked
		for (const segment of segments) Events.submitSegment.fire(segment);
	}

	/**
	 * A segment of a ranked run was verified: its frames are no longer needed (a ranked run never falls back to
	 * submitRun), so the recording is trimmed to the unverified tail. Not with KV_Debug: F8's replay check replays the
	 * whole recording.
	 */
	onSegmentVerified(v: SegmentVerdict): void {
		const ctx = this.host.getContext();
		if (ctx === undefined || ctx.runId === undefined || ctx.runId !== v.runId || this.host.isDebugRun()) return;
		ctx.live?.releaseVerifiedFrames(v.endTick);
	}

	/** The end of a ranked run: the last segment, then `finishRun` (answered by `runFinished`). */
	private finishRanked(ctx: RunContext, ending: RunEnding): void {
		const runId = ctx.runId!;
		const live = ctx.live;
		const entry = this.rankedRuns.get(runId);
		if (live === undefined || entry === undefined || entry.decided) return; // already rejected (the verdict shows it)
		entry.ending = ending;
		const [ok, result] = pcall(() => live.final());
		this.uploadSegments(ctx);
		if (!ok || result === undefined) {
			warn(`[Sim] could not build the final claim: ${errorMessage(result)}`);
			clientStore.setVerdict({ status: "skipped", run: ctx.counter, ending, code: "error" });
			return;
		}
		const final = result as RunFinal;
		clientStore.setVerdict({ status: "pending", run: ctx.counter, ending, claimedHash: final.claimedHash });
		entry.claim = this.finishedClaim(ctx, live.state);
		Events.finishRun.fire(final);
		print(
			`[Sim] finished ranked run ${ctx.counter} (${ending}): ${final.finalTick} ticks in ` +
				`${live.segmentCount()} segments, hash ${final.claimedHash}`,
		);
	}

	onVerdict(v: RunVerdict): void {
		const pending = this.awaiting.get(v.claimedHash);
		if (pending === undefined) return;
		this.awaiting.delete(v.claimedHash);
		const view: VerdictView = {
			status: v.ok ? "accepted" : "rejected",
			run: pending.run,
			ending: pending.ending,
			code: v.code,
			reason: v.reason,
			claimedHash: v.claimedHash,
			serverHash: v.serverHash,
		};
		clientStore.setVerdict(view);
		const line = `[Sim] verdict for run ${pending.run}: ${v.ok ? "ACCEPTED" : `REJECTED ${v.code ?? ""}`} ${
			v.reason ?? ""
		}`;
		if (v.ok) print(line);
		else warn(line);
	}
}

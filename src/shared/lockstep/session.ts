/**
 * The server side of one co-op lockstep run (M4), pure: the RunSessionService owns one per party run and only wires
 * remotes and the clock to it. docs/SERVER.md "Co-op lockstep (M4)".
 *
 *   clock        step(now) finalizes the ticks real time has reached since the start (at most maxTicksPerStep per
 *                call), through the relay (relay.ts: deadlines, repeat-last, leavers), into the merged log (log.ts),
 *                and returns merged batches to broadcast (wire.ts) every `broadcastEvery` ticks
 *   inputs       submitInput(userId, firstTick, data, now?): the player's raw input batch for future ticks. The
 *                frame with the lowest slack (how early it arrived, docs/FRAME_PACING.md Design 9) of all the
 *                player's batches since the last broadcast goes back to that player only, as the input echo of the
 *                next broadcast (`MergedBroadcast.echoes`); inputStats(i) totals each batch's
 *   hashes       reportHashes(userId, ticks, hashes): batched reports (every `hashEvery` ticks), resent by the client
 *                until acknowledged (`ackTick`, the highest decided tick, goes out with every broadcast); the ledger
 *                (ledger.ts) agrees them in order. A disagreement is a DESYNC: logged with its tick and the hashes by
 *                player, the run ends unranked (the validator is aborted with "desync"). A player silent past
 *                `reportTimeoutTicks` is dropped (also while final claims are being collected).
 *   validation   every `segmentTicks` agreed ticks the log's slice goes to the run's SegmentedValidator as a segment
 *                whose claimed end / checkpoint hashes are the CONSENSUS hashes: the server's own replay of its own
 *                log must reproduce what the clients agreed on (a mismatch rejects the run: hash_mismatch)
 *   the end      each client sends its RunFinal when its sim shows the whole party down (reportFinal). Once EVERY
 *                present player claimed the same final (tick, hash, summary, score, floor), the last slice and the
 *                final go to the validator; its verdict (the server's replayed score) is what gets posted. Claims
 *                that differ, a player who does not claim within `finalTimeoutTicks`, or no consensus on the
 *                checkpoints below the final within `finalCheckpointTimeoutTicks`, end the run unranked ("desync").
 *                A malformed claim (runFinalProblem) is never recorded. Everyone gone: "abandoned".
 *
 * Players are the session's members in order (index 0 = the owner, as in RunSession.members).
 */
import { SIM_HZ, type InputFrame } from "shared/sim";
import {
	checkpointCount,
	runFinalProblem,
	type RunFinal,
	type RunSegment,
	type SegmentRejectCode,
	type SegmentedValidator,
} from "shared/run";
import { DEFAULT_LOCKSTEP, type LockstepTunables } from "./config";
import { HashLedger, type HashDesync, type ReportProblem } from "./ledger";
import { PartyRunLog } from "./log";
import { LockstepRelay, type SubmitResult } from "./relay";
import { MergedEncoder, decodeInputBatch, encodeInputEcho, type InputEcho } from "./wire";

export type LockstepStatus = "running" | "finishing" | "submitted" | "ended";

export interface MergedBroadcast {
	readonly firstTick: number;
	readonly data: buffer;
	/**
	 * Per player index: that player's input echo (wire.ts `encodeInputEcho`, against this broadcast's firstTick): the
	 * input frame received from them since the previous broadcast that arrived with the lowest slack (the first frame
	 * of the latest-arriving batch, as a rule), or "none" (with the lates since, if any). Each goes to its own player
	 * only (docs/FRAME_PACING.md FPD14).
	 */
	readonly echoes: ReadonlyArray<buffer>;
}

/** A player's input timing over the whole run (ticks), for the server's end-of-run log line. */
export interface InputStats {
	/** Batches recorded (accepted or late). */
	readonly samples: number;
	/** Late frames. */
	readonly lates: number;
	/** The smallest batch slack (each batch's lowest: its first frame's; 0 without samples). */
	readonly slackMin: number;
	/** The mean batch slack (0 without samples). */
	readonly slackMean: number;
}

export interface LockstepEnd {
	readonly code: SegmentRejectCode;
	readonly reason: string;
	/** The tick the problem is about (the desync tick; the last finalized tick otherwise). */
	readonly tick: number;
	readonly desync?: HashDesync;
}

export interface LockstepStepResult {
	readonly broadcasts: ReadonlyArray<MergedBroadcast>;
	/** Segments offered to the validator by this call (the service then pumps the validator). */
	readonly segmentsOffered: number;
	/** The validator got the run's final this call (its verdict comes from the replay). */
	readonly submitted: boolean;
	/** The run ended without a validator verdict to wait for (desync, abandoned, a refused segment). */
	readonly ended?: LockstepEnd;
	/** Players dropped by this call (stalled), by index. */
	readonly dropped: ReadonlyArray<number>;
	/**
	 * The hash ack: the highest tick the ledger decided (every report at or below it is no longer needed). The service
	 * sends it with every merged broadcast; clients resend their reports above it.
	 */
	readonly ackTick: number;
}

export interface LockstepSessionParams {
	readonly runId: string;
	readonly seed: number;
	readonly spawn: { readonly x: number; readonly z: number };
	/** UserIds in player index order (owner first). */
	readonly members: ReadonlyArray<number>;
	/** The run session's validator (built from the party's setup: config.party.size = members.size()). */
	readonly validator: SegmentedValidator;
	/** Session start (seconds, the clock every `now` uses). */
	readonly startedAt: number;
	readonly tunables?: LockstepTunables;
}

function claimKey(f: Readonly<RunFinal>): string {
	const c = f.claimed;
	return `${f.finalTick}|${f.claimedHash}|${c.ticks}|${c.kills}|${c.bossDefeated}|${c.died}|${c.score}|${c.floor}`;
}

export class LockstepSession {
	readonly runId: string;
	readonly members: ReadonlyArray<number>;
	readonly size: number;
	private readonly tunables: LockstepTunables;
	private readonly validator: SegmentedValidator;
	private readonly startedAt: number;
	private readonly relay: LockstepRelay;
	private readonly log: PartyRunLog;
	private readonly ledger: HashLedger;
	private readonly encoder: MergedEncoder;
	private status: LockstepStatus = "running";
	private unsent: InputFrame[][] = [];
	private unsentFirst = 0;
	private segmentStart = 0;
	private segmentIndex = 0;
	private readonly claims = new Map<number, RunFinal>();
	private firstClaimTick: number | undefined;
	private claimedFinalTick: number | undefined;
	private endInfo: LockstepEnd | undefined;
	/** Per player: the lowest-slack frame received since the last echo (its tick and slack), and the late frames since. */
	private readonly echoPending: boolean[] = [];
	private readonly echoTick: number[] = [];
	private readonly echoSlack: number[] = [];
	private readonly echoLates: number[] = [];
	/** Per player, the whole run: recorded batches, late frames, smallest and summed slack. */
	private readonly statSamples: number[] = [];
	private readonly statLates: number[] = [];
	private readonly statSlackMin: number[] = [];
	private readonly statSlackSum: number[] = [];

	constructor(params: LockstepSessionParams) {
		this.runId = params.runId;
		this.members = [...params.members];
		this.size = this.members.size();
		this.tunables = params.tunables ?? DEFAULT_LOCKSTEP;
		this.validator = params.validator;
		this.startedAt = params.startedAt;
		const t = this.tunables;
		if (t.checkpointEvery % t.hashEvery !== 0 || t.segmentTicks % t.checkpointEvery !== 0) {
			error("LockstepSession: checkpointEvery and segmentTicks must be multiples of hashEvery", 0);
		}
		this.relay = new LockstepRelay(this.size, t);
		this.log = new PartyRunLog(params.seed, params.spawn, this.size);
		this.ledger = new HashLedger(this.size, t.hashEvery, t.reportTimeoutTicks);
		this.encoder = new MergedEncoder(this.size);
		for (let i = 0; i < this.size; i++) {
			this.echoPending.push(false);
			this.echoTick.push(0);
			this.echoSlack.push(0);
			this.echoLates.push(0);
			this.statSamples.push(0);
			this.statLates.push(0);
			this.statSlackMin.push(0);
			this.statSlackSum.push(0);
		}
	}

	getStatus(): LockstepStatus {
		return this.status;
	}

	/** Why the run ended without a verdict (desync / abandoned), once it did. */
	getEnd(): LockstepEnd | undefined {
		return this.endInfo;
	}

	/** Player index of `userId`, or -1. */
	indexOf(userId: number): number {
		return this.members.indexOf(userId);
	}

	/** Ticks finalized (and broadcast or about to be). */
	finalizedTicks(): number {
		return this.relay.finalizedTicks();
	}

	isPresent(i: number): boolean {
		return this.relay.isPresent(i);
	}

	/** The relay (stats, tests). */
	getRelay(): LockstepRelay {
		return this.relay;
	}

	/** The merged log (tests: what the clients were sent). */
	getLog(): PartyRunLog {
		return this.log;
	}

	getLedger(): HashLedger {
		return this.ledger;
	}

	// --- client messages ---------------------------------------------------------------------------

	/**
	 * A player's input batch for ticks firstTick.. (wire.ts input batch). Undefined result: not a member / not running.
	 * `now` (the clock `startedAt` uses) places the receipt within the tick being finalized: without it the receipt is
	 * at finalizedTicks(). A batch with any frame accepted or late is recorded for the player's next echo: its lowest
	 * slack is its first frame's, X + 1 - R for X = firstTick, R = finalizedTicks() + clamp(pos - finalizedTicks(), 0,
	 * 1) with pos the real-time tick position (a stalled server's backlog never counts against the client); it
	 * replaces the pending frame since the last echo only when its slack is lower (the input that waited longest is
	 * the one the client's lead must cover; later batches carry later ticks, so the echoed ticks still increase from
	 * one echo to the next). Its late frames add up until the echo goes out. docs/FRAME_PACING.md Design 9.
	 */
	submitInput(userId: number, firstTick: number, data: unknown, now?: number): SubmitResult | undefined {
		const i = this.indexOf(userId);
		if (i < 0 || this.status === "ended" || this.status === "submitted") return undefined;
		if (!typeIs(firstTick, "number") || firstTick < 0 || firstTick % 1 !== 0) return undefined;
		const frames = decodeInputBatch(data, this.tunables.maxBatchFrames);
		if (frames === undefined) return { accepted: 0, late: 0, refused: 1 };
		const finalized = this.relay.finalizedTicks();
		const result = this.relay.submit(i, firstTick, frames);
		if (result.accepted + result.late > 0) {
			let receipt = finalized;
			if (now !== undefined) {
				const pos = (now - this.startedAt) * SIM_HZ;
				const into = pos - finalized;
				if (into === into) receipt = finalized + math.clamp(into, 0, 1);
			}
			const slack = firstTick + 1 - receipt;
			if (!this.echoPending[i] || slack < this.echoSlack[i]) {
				this.echoPending[i] = true;
				this.echoTick[i] = firstTick;
				this.echoSlack[i] = slack;
			}
			this.echoLates[i] += result.late;
			const n = this.statSamples[i];
			this.statSlackMin[i] = n === 0 ? slack : math.min(this.statSlackMin[i], slack);
			this.statSlackSum[i] += slack;
			this.statSamples[i] = n + 1;
			this.statLates[i] += result.late;
		}
		return result;
	}

	/** Player `i`'s input timing over the whole run so far (zeros for a player with no samples or a bad index). */
	inputStats(i: number): InputStats {
		const n = this.statSamples[i] ?? 0;
		if (n === 0) return { samples: 0, lates: this.statLates[i] ?? 0, slackMin: 0, slackMean: 0 };
		return {
			samples: n,
			lates: this.statLates[i],
			slackMin: this.statSlackMin[i],
			slackMean: this.statSlackSum[i] / n,
		};
	}

	/** A player's hashState after `tick`. */
	reportHash(userId: number, tick: number, hash: string): ReportProblem | "not_member" | undefined {
		const i = this.indexOf(userId);
		if (i < 0) return "not_member";
		if (!typeIs(tick, "number") || tick > this.relay.finalizedTicks()) return "bad_tick";
		return this.ledger.report(i, tick, hash);
	}

	/**
	 * A batch of a player's hash reports (one `lockstepHash` call: new reports and resends of unacknowledged ones).
	 * At most `maxHashBatch` are read; resends of decided ticks are harmless ("already_decided"). Returns how many
	 * were recorded, or undefined for a malformed batch / a non-member.
	 */
	reportHashes(userId: number, ticks: unknown, hashes: unknown): number | undefined {
		if (this.indexOf(userId) < 0 || !typeIs(ticks, "table") || !typeIs(hashes, "table")) return undefined;
		const t = ticks as ReadonlyArray<unknown>;
		const h = hashes as ReadonlyArray<unknown>;
		if (t.size() !== h.size() || t.size() > this.tunables.maxHashBatch) return undefined;
		let recorded = 0;
		for (let k = 0; k < t.size(); k++) {
			const tick = t[k];
			const hash = h[k];
			if (!typeIs(tick, "number") || !typeIs(hash, "string")) return recorded;
			if (this.reportHash(userId, tick, hash) === undefined) recorded++;
		}
		return recorded;
	}

	/** The hash ack (see LockstepStepResult.ackTick). */
	ackTick(): number {
		return this.ledger.decidedThrough();
	}

	/** A player's final claim (its sim shows the party down). Returns why it was ignored, if it was. */
	reportFinal(userId: number, final: RunFinal): string | undefined {
		const i = this.indexOf(userId);
		if (i < 0) return "not a member";
		if (!this.relay.isPresent(i)) return "player left";
		if (this.status !== "running" && this.status !== "finishing") return "run not open";
		// Shape first (NaN / fractional / negative ticks, hashes, every claimed number): a malformed claim is never
		// recorded, so it can neither open the claim window nor turn into a bad_final verdict for the whole party.
		const problem = runFinalProblem(final);
		if (problem !== undefined) return `bad final: ${problem}`;
		if (final.runId !== this.runId) return "bad final: not this run";
		if (final.finalTick > this.relay.finalizedTicks()) return "bad tick: not finalized yet";
		if (final.finalTick < this.segmentStart || final.finalTick <= 0) return "bad tick: before the open segment";
		if (this.claims.has(i)) return "duplicate";
		this.claims.set(i, final);
		if (this.firstClaimTick === undefined) {
			this.firstClaimTick = this.relay.finalizedTicks();
			this.claimedFinalTick = final.finalTick;
			this.status = "finishing";
		}
		return undefined;
	}

	/** A player left (quit or disconnected): dead with no input from the next tick, never revived. */
	leave(userId: number): void {
		const i = this.indexOf(userId);
		if (i >= 0) this.relay.leave(i);
	}

	// --- the clock ---------------------------------------------------------------------------------

	step(now: number): LockstepStepResult {
		const broadcasts: MergedBroadcast[] = [];
		const dropped: number[] = [];
		let segmentsOffered = 0;
		let submitted = false;
		if (this.status === "ended" || this.status === "submitted") {
			return { broadcasts, segmentsOffered, submitted, ended: this.endInfo, dropped, ackTick: this.ackTick() };
		}
		const t = this.tunables;

		// 1. Finalize the ticks real time has reached.
		const due = math.floor((now - this.startedAt) * SIM_HZ) - this.relay.finalizedTicks();
		const n = math.min(due, t.maxTicksPerStep);
		for (let k = 0; k < n; k++) {
			if (this.unsent.size() === 0) this.unsentFirst = this.relay.finalizedTicks();
			const merged = this.relay.finalizeNext();
			this.log.append(merged);
			this.unsent.push(merged);
		}
		if (this.unsent.size() >= t.broadcastEvery) broadcasts.push(this.flush());

		// 2. Agree hashes in order, up to a claimed final (nobody reports past it); drop stalled players. Stall
		// detection runs on the real server clock even after a claim, so a member silent below the final tick is
		// dropped (marked left from the current tick, past the final: the claimed run is unchanged) instead of
		// holding the decision forever.
		const finalized = this.relay.finalizedTicks();
		const horizon = this.claimedFinalTick ?? finalized;
		for (let guard = 0; guard <= this.size; guard++) {
			const d = this.ledger.decide((i) => this.relay.isPresent(i), finalized, horizon);
			if (d.desync !== undefined) {
				return this.endWith(broadcasts, segmentsOffered, dropped, this.desyncEnd(d.desync));
			}
			if (d.stalled.size() === 0) break;
			for (const i of d.stalled) {
				this.relay.leave(i);
				dropped.push(i);
			}
		}
		if (this.relay.presentCount() === 0) {
			return this.endWith(broadcasts, segmentsOffered, dropped, {
				code: "abandoned",
				reason: "every player left",
				tick: this.relay.finalizedTicks(),
			});
		}

		// 3. Agreed segments to the validator.
		for (;;) {
			const stop = this.segmentStart + t.segmentTicks;
			if (stop > this.ledger.decidedThrough()) break;
			if (this.claimedFinalTick !== undefined && stop >= this.claimedFinalTick) break;
			const hash = this.ledger.consensus(stop)!;
			const refused = this.offer(stop, hash, now);
			if (refused !== undefined) return this.endWith(broadcasts, segmentsOffered, dropped, refused);
			segmentsOffered++;
		}

		// 4. The final, once every present player claimed it (or the claim window ran out).
		if (this.status === "finishing") {
			const outcome = this.finalOutcome();
			if (outcome === "wait") {
				// Keep finalizing meanwhile: a lying claimant must not freeze the honest players.
			} else if (outcome.ok) {
				if (this.unsent.size() > 0) broadcasts.push(this.flush());
				const final = outcome.final;
				if (final.finalTick > this.segmentStart) {
					const refused = this.offer(final.finalTick, final.claimedHash, now);
					if (refused !== undefined) return this.endWith(broadcasts, segmentsOffered, dropped, refused);
					segmentsOffered++;
				}
				// The validator decides now (nothing queued) or once its pump replays the last segment.
				this.validator.finish(final, now);
				this.status = "submitted";
				submitted = true;
			} else {
				return this.endWith(broadcasts, segmentsOffered, dropped, outcome.end);
			}
		}
		return { broadcasts, segmentsOffered, submitted, dropped, ackTick: this.ackTick() };
	}

	/** Flushes the unsent merged frames as one broadcast, with every player's pending echo (then cleared). */
	private flush(): MergedBroadcast {
		const firstTick = this.unsentFirst;
		const echoes: buffer[] = [];
		for (let i = 0; i < this.size; i++) {
			const echo: InputEcho = {
				tick: this.echoPending[i] ? this.echoTick[i] : undefined,
				slack: this.echoPending[i] ? this.echoSlack[i] : 0,
				lates: this.echoLates[i],
			};
			echoes.push(encodeInputEcho(echo, firstTick));
			this.echoPending[i] = false;
			this.echoLates[i] = 0;
		}
		const b = { firstTick, data: this.encoder.encode(this.unsent), echoes };
		this.unsent = [];
		return b;
	}

	private desyncEnd(d: HashDesync): LockstepEnd {
		const parts: string[] = [];
		for (let i = 0; i < d.hashes.size(); i++) if (d.hashes[i] !== "") parts.push(`p${i}=${d.hashes[i]}`);
		const who = d.outliers.map((i) => `p${i}`).join(",");
		return {
			code: "desync",
			reason: `desync at tick ${d.tick}: ${parts.join(" ")} (diverged: ${who})`,
			tick: d.tick,
			desync: d,
		};
	}

	/** The consensus hashes of the checkpoint ticks strictly inside (start, stop), or undefined if one is missing. */
	private checkpoints(start: number, stop: number): string[] | undefined {
		const every = this.tunables.checkpointEvery;
		const out: string[] = [];
		const want = checkpointCount(start, stop, every);
		let t = (math.floor(start / every) + 1) * every;
		while (out.size() < want) {
			const h = this.ledger.consensus(t);
			if (h === undefined) return undefined;
			out.push(h);
			t += every;
		}
		return out;
	}

	/** Offers [segmentStart, stop) with claimed end hash `hash`; returns the end info if the validator refused it. */
	private offer(stop: number, hash: string, now: number): LockstepEnd | undefined {
		const start = this.segmentStart;
		const checkpointHashes = this.checkpoints(start, stop);
		if (checkpointHashes === undefined) {
			return { code: "replay_error", reason: `no consensus for a checkpoint in [${start}, ${stop})`, tick: stop };
		}
		const segment: RunSegment = {
			runId: this.runId,
			index: this.segmentIndex,
			startTick: start,
			recording: this.log.encodeSlice(start, stop),
			claimedEndHash: hash,
			checkpointHashes,
		};
		const offer = this.validator.offer(segment, now);
		if (!offer.ok) {
			return {
				code: offer.verdict.code ?? "replay_error",
				reason: offer.verdict.reason ?? "segment refused",
				tick: stop,
			};
		}
		this.segmentIndex++;
		this.segmentStart = stop;
		this.log.releaseBefore(stop);
		this.ledger.forgetThrough(start);
		return undefined;
	}

	private finalOutcome():
		| "wait"
		| { readonly ok: true; readonly final: RunFinal }
		| { readonly ok: false; readonly end: LockstepEnd } {
		let first: RunFinal | undefined;
		let missing = 0;
		for (let i = 0; i < this.size; i++) {
			if (!this.relay.isPresent(i)) continue;
			const c = this.claims.get(i);
			if (c === undefined) {
				missing++;
				continue;
			}
			if (first === undefined) first = c;
			else if (claimKey(c) !== claimKey(first)) {
				return {
					ok: false,
					end: {
						code: "desync",
						reason: `final claims differ: ${claimKey(first)} vs ${claimKey(c)}`,
						tick: c.finalTick,
					},
				};
			}
		}
		if (missing > 0) {
			const waited = this.relay.finalizedTicks() - (this.firstClaimTick ?? 0);
			if (waited < this.tunables.finalTimeoutTicks) return "wait";
			return {
				ok: false,
				end: {
					code: "desync",
					reason: `final claim missing from ${missing} player(s) after ${waited} ticks`,
					tick: this.claimedFinalTick ?? 0,
				},
			};
		}
		if (first === undefined) return "wait";
		// Every checkpoint before the final must be agreed (the ledger decides up to the claimed tick). Not forever:
		// past the deadline the run ends unranked with a log line instead of hanging until the session expires.
		if (this.checkpoints(this.segmentStart, first.finalTick) === undefined) {
			const waited = this.relay.finalizedTicks() - (this.firstClaimTick ?? 0);
			if (waited < this.tunables.finalCheckpointTimeoutTicks) return "wait";
			return {
				ok: false,
				end: {
					code: "desync",
					reason:
						`no hash consensus below the final tick ${first.finalTick} after ${waited} ticks ` +
						`(decided through ${this.ledger.decidedThrough()})`,
					tick: first.finalTick,
				},
			};
		}
		return { ok: true, final: first };
	}

	private endWith(
		broadcasts: MergedBroadcast[],
		segmentsOffered: number,
		dropped: number[],
		stop: LockstepEnd,
	): LockstepStepResult {
		this.status = "ended";
		this.endInfo = stop;
		this.validator.abort(stop.code, stop.reason);
		return { broadcasts, segmentsOffered, submitted: false, ended: stop, dropped, ackTick: this.ackTick() };
	}
}

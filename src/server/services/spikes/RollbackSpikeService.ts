import { OnStart, Service } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { DataStoreService, HttpService, Players, RunService, Workspace } from "@rbxts/services";
import { serverLogger } from "server/log";
import { Events } from "server/network";
import { DAILY } from "shared/daily";
import type { LockstepSession } from "shared/lockstep";
import { ANALYTICS_DEBUG_ATTRIBUTE, describeAnalyticsSpec } from "shared/onboarding";
import { truncateReason, type RunSession } from "shared/run";
import {
	ROLLBACK_CAPTURE,
	ROLLBACK_PROBE_ROWS,
	RollbackCaptureRecorder,
	RollbackProbeIntake,
	rollbackCaptureAllowed,
	rollbackCaptureChunkKey,
	rollbackCaptureMetaKey,
	rollbackProbeAllowed,
	type RollbackCaptureEnd,
	type RollbackCaptureSetup,
	type RollbackDueRow,
	type RollbackIntakeContext,
} from "shared/spikes";
import { DataStoreKeyValue } from "../data/DataStoreKeyValue";
import { TelemetryService } from "../TelemetryService";
import { watchServerSpikeFlag } from "./spikeFlags";

const log = serverLogger("Rollback");
const NOT_LEFT = -1;
const MS_PER_SEC = 1000;

/** One party run being captured: its recorder and what its meta is built from. */
interface CaptureEntry {
	readonly recorder: RollbackCaptureRecorder;
	readonly session: RunSession;
	readonly coop: LockstepSession;
	/** A thread is encoding the recorder's queued blocks (one per resumption). */
	encoding: boolean;
}

/**
 * The rollback spike's server half (docs/ROLLBACK_SPIKE.md Design 5-7, task R4). Off unless the Workspace attribute
 * `KV_RollbackCapture` (shared/spikes ROLLBACK_CAPTURE.attribute, SPIKE_DEFAULTS.rollbackCapture) is true, Studio
 * included.
 *
 * Summary intake (the `rollbackProbe(kind, payload)` remote; only while the switch is on): shared/spikes
 * RollbackProbeIntake decides, per player: the gate (rollbackProbeAllowed: Studio, a DEV_MODE-allowed player, or anyone
 * in a private server a DEV_MODE-allowed player owns; the same player attribute ROLLBACK_CAPTURE.probeAllowedAttribute
 * tells the client its probe may run), rate limits before anything is read or logged, the strict readers, session ids
 * bound to their first player, then
 *   - one `[Rollback] CPU:` / `[Rollback] LIVE:` line in the server log;
 *   - the player's row buffer: at most one row a minute per player in DataStore `KV_RollbackProbe_v1` (key
 *     `<writerId>/<n>`, the writer id a GUID this server made for the player; RollbackProbeRow: that minute's
 *     summaries), polled every ROLLBACK_PROBE_ROWS.pollSeconds, written when the player leaves too, tagged with the
 *     player's UserId, skipped while the SetIncrementAsync budget is under ROLLBACK_PROBE_ROWS.budgetReserve. Every
 *     DataStore call is pcall'd; in Studio the first failure (no "Studio Access to API Services") turns the store off
 *     for the session with one line;
 *   - published places only (not Studio): AnalyticsService events through TelemetryService.logSpike (`RollbackCpu`,
 *     `RollbackProbe`; shared/onboarding analyticsCatalog lists both) within ROLLBACK_ANALYTICS_RATE. In Studio,
 *     `KV_AnalyticsDebug` prints them.
 *
 * Capture (Design 6): RunSessionService asks `beginCapture` when a party run's lockstep session starts. With the
 * switch on and the party allowed (rollbackCaptureAllowed: Studio, every member a developer, or a developer's private
 * server) it gets a recorder, which it pulls after every lockstep step (`tapCapture`: the merged log releases ticks
 * once validated, so the recorder reads them first; a pull only copies frame references). Each finished block
 * (ROLLBACK_CAPTURE.blockTicks) is encoded by a deferred thread, one block per resumption with a yield between, never
 * inside the step. The capture ends in `forgetLockstep`, the one place every party run's lockstep part ends (a
 * verdict, a desync, abandonment, an error, a conclusion from elsewhere). `endCapture` then, in its own thread, waits up
 * to verdictWaitSeconds for the validator's verdict (the final hash the harness replays to), encodes what is left
 * (RollbackCaptureRecorder.finish, yielding between blocks and chunks; no user ids in the data) and writes
 * `<runId>/<i>` chunks, then `<runId>/meta`, to `KV_RollbackCapture_v1`, tagged with the party's UserIds, logging the
 * size. With the switch off nothing is created (beginCapture returns undefined); turning it off mid-run abandons every
 * open recorder. BindToClose: the verdict waits end at once (those captures are written with status "shutdown"), the
 * captures still open are written the same way, every buffered probe row is written, and the writes (all counted in
 * `writing`) are waited for, at most shutdownWaitSeconds.
 */
@Service({})
export class RollbackSpikeService implements OnStart {
	private enabled = false;
	private readonly intake = new Janitor();
	private intakeOn = false;
	/** BindToClose ran: verdict waits end, everything left is written. */
	private closing = false;
	private readonly captures = new Map<RollbackCaptureRecorder, CaptureEntry>();
	private readonly probes = new RollbackProbeIntake<Player>(() => HttpService.GenerateGUID(false));
	/** Per player: the capture policy's answer (rollbackProbeAllowed), decided once per player. */
	private readonly allowed = new Map<Player, boolean>();
	private readonly captureStore = new DataStoreKeyValue(ROLLBACK_CAPTURE.captureStore);
	private readonly probeStore = new DataStoreKeyValue(ROLLBACK_CAPTURE.probeStore);
	/** Studio only: a store write failed (no API access), so no more are tried this session. */
	private readonly storeOff = new Set<DataStoreKeyValue>();
	private writing = 0;

	constructor(private readonly telemetry: TelemetryService) {}

	onStart(): void {
		watchServerSpikeFlag("rollbackCapture", (on) => this.setEnabled(on));
		game.BindToClose(() => this.flushOnClose());
	}

	// --- capture (RunSessionService) ------------------------------------------------------------

	/** A party run's lockstep session started: its recorder, or undefined (switch off, or a party not captured). */
	beginCapture(session: RunSession, coop: LockstepSession): RollbackCaptureRecorder | undefined {
		if (!this.enabled) return undefined;
		const allowed = rollbackCaptureAllowed({
			studio: RunService.IsStudio(),
			memberIds: session.members,
			privateServerOwnerId: game.PrivateServerOwnerId,
			creatorId: game.CreatorId,
			creatorIsUser: game.CreatorType === Enum.CreatorType.User,
		});
		if (!allowed) {
			log.info("CAPTURE_SKIPPED", `run ${session.runId}: not every member is a developer (docs/DEV_MODE.md)`);
			return undefined;
		}
		const recorder = new RollbackCaptureRecorder(coop.getLog());
		this.captures.set(recorder, { recorder, session, coop, encoding: false });
		log.info(
			"CAPTURE_START",
			`run ${session.runId} world ${session.worldKind} seed ${session.seed} party ${session.members.size()}`,
		);
		return recorder;
	}

	/**
	 * After a lockstep step: the recorder reads the ticks the step finalized (frame references only). A finished block
	 * starts the entry's encoder thread, which encodes the queued blocks one per resumption (task.wait between) until
	 * none is left or the capture ended.
	 */
	tapCapture(recorder: RollbackCaptureRecorder): void {
		const entry = this.captures.get(recorder);
		if (entry === undefined) return;
		const [ok, err] = pcall(() => recorder.pull());
		if (!ok) log.warn("CAPTURE_TAP_FAILED", tostring(err));
		if (entry.encoding || recorder.queuedBlocks() === 0) return;
		entry.encoding = true;
		task.defer(() => {
			while (this.captures.get(recorder) === entry) {
				const [fine, more] = pcall(() => recorder.encodePending(1));
				if (!fine) log.warn("CAPTURE_ENCODE_FAILED", tostring(more));
				if (!fine || more !== true) break;
				task.wait();
			}
			entry.encoding = false;
		});
	}

	/** The run's lockstep part ended: the capture is written from its own thread. */
	endCapture(recorder: RollbackCaptureRecorder): void {
		const entry = this.captures.get(recorder);
		if (entry === undefined) return;
		this.tapCapture(recorder);
		this.captures.delete(recorder);
		this.writing++;
		task.spawn(() => {
			const [ok, err] = pcall(() => this.writeCapture(entry, false));
			if (!ok) log.warn("CAPTURE_FAILED", `run ${entry.session.runId}: ${tostring(err)}`);
			this.writing--;
		});
	}

	private setupOf(session: RunSession): RollbackCaptureSetup {
		const setup: RollbackCaptureSetup = {
			worldKind: session.worldKind,
			seed: session.seed,
			partySize: session.members.size(),
			atBossDoor: session.atBossDoor,
			debug: session.debug,
			ruleset: DAILY.ruleset,
			placeVersion: game.PlaceVersion,
		};
		const daily = session.daily;
		return daily !== undefined ? { ...setup, daily: { day: daily.day, ruleset: daily.ruleset } } : setup;
	}

	private endOf(entry: CaptureEntry, shutdown: boolean): RollbackCaptureEnd {
		const result = entry.session.validator.getResult();
		const relay = entry.coop.getRelay();
		const left: number[] = [];
		for (let i = 0; i < entry.coop.size; i++) left.push(relay.leftFromTick(i) ?? NOT_LEFT);
		const ending: RollbackCaptureEnd = {
			status: shutdown ? "shutdown" : entry.coop.getStatus(),
			verifiedTicks: result?.verifiedTicks ?? 0,
			serverHash: result?.serverHash ?? "",
			leftFromTick: left,
		};
		if (result === undefined) return ending;
		const reason = result.reason !== undefined ? truncateReason(result.reason) : undefined;
		return {
			...ending,
			ok: result.ok,
			code: result.code,
			reason: reason !== undefined ? reason.sub(1, ROLLBACK_CAPTURE.maxReasonChars) : undefined,
		};
	}

	/**
	 * Waits for the verdict (unless the server is closing: the wait ends at once and a capture without a verdict is
	 * written with status "shutdown"), encodes the rest of the capture with yields and writes chunks, then the meta.
	 */
	private writeCapture(entry: CaptureEntry, shutdown: boolean): void {
		const runId = entry.session.runId;
		const validator = entry.session.validator;
		let waited = 0;
		while (!shutdown && !this.closing && validator.getResult() === undefined) {
			if (waited >= ROLLBACK_CAPTURE.verdictWaitSeconds) break;
			waited += task.wait(ROLLBACK_CAPTURE.verdictPollSeconds);
		}
		const closed = shutdown || (this.closing && validator.getResult() === undefined);
		const t0 = os.clock();
		let pauses = 0;
		const cap = entry.recorder.finish(
			this.setupOf(entry.session),
			{ runId, capturedAt: os.time(), end: this.endOf(entry, closed) },
			ROLLBACK_CAPTURE.chunkChars,
			() => {
				pauses++;
				task.wait();
			},
		);
		if (cap === undefined) {
			log.warn("CAPTURE_EMPTY", `run ${runId}: no ticks (${entry.recorder.getProblem() ?? "nothing logged"})`);
			return;
		}
		const m = cap.meta;
		const encodeMs = (os.clock() - t0) * MS_PER_SEC;
		const members = entry.session.members;
		const problem = m.info.problem !== undefined ? ` (${m.info.problem})` : "";
		log.info(
			"CAPTURE_ENCODED",
			`run ${runId}: ${m.ticks} ticks x ${m.players} players, ${m.bytes} bytes (${string.format(
				"%.2f",
				m.bytes / m.ticks / m.players,
			)} per tick per player), ${m.chunks} chunk(s), ${string.format("%.1f", encodeMs)} ms over ${
				pauses + 1
			} slice(s); end ${m.info.end?.status ?? "?"} ok ${tostring(m.info.end?.ok)} hash ${
				m.info.end?.serverHash ?? ""
			}${problem}`,
		);
		for (let i = 0; i < cap.chunks.size(); i++) {
			if (!this.write(this.captureStore, rollbackCaptureChunkKey(runId, i), cap.chunks[i], members)) {
				log.warn("CAPTURE_NOT_WRITTEN", `run ${runId}: chunk ${i} failed, no meta written`);
				return;
			}
		}
		if (this.write(this.captureStore, rollbackCaptureMetaKey(runId), cap.meta, members)) {
			log.info(
				"CAPTURE_WRITTEN",
				`run ${runId} -> ${ROLLBACK_CAPTURE.captureStore} (${m.chunks} chunk(s) + meta)`,
			);
		}
	}

	/**
	 * One SetAsync under pcall, tagged with the UserIds whose data it holds (right-to-erasure tooling); false (logged)
	 * when it failed or the store is off.
	 */
	private write(store: DataStoreKeyValue, key: string, value: unknown, userIds: ReadonlyArray<number>): boolean {
		if (this.storeOff.has(store)) return false;
		const [ok, err] = pcall(() => store.set(key, value, userIds));
		if (ok) return true;
		if (RunService.IsStudio()) {
			this.storeOff.add(store);
			log.warn(
				"STORE_OFF",
				`${key}: ${tostring(err)}; no more DataStore writes this session (Game Settings > Security > ` +
					`Enable Studio Access to API Services)`,
			);
		} else {
			log.warn("STORE_WRITE_FAILED", `${key}: ${tostring(err)}`);
		}
		return false;
	}

	// --- the switch -----------------------------------------------------------------------------

	private setEnabled(on: boolean): void {
		if (on !== this.enabled) {
			this.enabled = on;
			log.info(on ? "ON" : "OFF", `${ROLLBACK_CAPTURE.attribute} ${on ? "on: capturing party runs" : "off"}`);
			if (!on) {
				for (const [recorder, entry] of this.captures) {
					recorder.abandon("the switch went off");
					log.info("CAPTURE_DROPPED", `run ${entry.session.runId}: ${ROLLBACK_CAPTURE.attribute} off`);
				}
				this.captures.clear();
			}
		}
		this.setIntake(on);
	}

	/** Intake on: the remote, the per-player gate and its attribute, the row poll. Off: rows flushed, all undone. */
	private setIntake(on: boolean): void {
		if (on === this.intakeOn) return;
		this.intakeOn = on;
		if (!on) {
			this.intake.Cleanup();
			this.writeRows(this.probes.dueRows(os.clock(), this.rowContext(), true));
			for (const player of Players.GetPlayers()) {
				player.SetAttribute(ROLLBACK_CAPTURE.probeAllowedAttribute, undefined);
			}
			this.allowed.clear();
			return;
		}
		this.intake.Add(Events.rollbackProbe.connect((player, kind, payload) => this.probe(player, kind, payload)));
		for (const player of Players.GetPlayers()) this.admit(player);
		this.intake.Add(Players.PlayerAdded.Connect((player) => this.admit(player)));
		this.intake.Add(
			Players.PlayerRemoving.Connect((player) => {
				this.allowed.delete(player);
				const row = this.probes.takeRow(player, this.rowContext());
				if (row !== undefined) this.writeRows([row]);
			}),
		);
		const poll = task.spawn(() => {
			for (;;) {
				task.wait(ROLLBACK_PROBE_ROWS.pollSeconds);
				this.writeRows(this.probes.dueRows(os.clock(), this.rowContext()));
			}
		});
		this.intake.Add(() => {
			if (coroutine.status(poll) !== "dead") task.cancel(poll);
		}, true);
	}

	/** The capture policy for one player, published as the player attribute the client's probe waits for. */
	private admit(player: Player): void {
		const ok = rollbackProbeAllowed({
			studio: RunService.IsStudio(),
			userId: player.UserId,
			privateServerOwnerId: game.PrivateServerOwnerId,
			creatorId: game.CreatorId,
			creatorIsUser: game.CreatorType === Enum.CreatorType.User,
		});
		this.allowed.set(player, ok);
		player.SetAttribute(ROLLBACK_CAPTURE.probeAllowedAttribute, ok ? true : undefined);
	}

	// --- summary intake -------------------------------------------------------------------------

	private probe(player: Player, rawKind: unknown, payload: unknown): void {
		if (!this.intakeOn || player.Parent === undefined) return;
		const allowed = this.allowed.get(player) === true;
		const out = this.probes.take(player, player.UserId, allowed, rawKind, payload, os.clock());
		if (!out.taken) {
			if (out.warn !== undefined) log.warn("BAD_PROBE", out.warn);
			return;
		}
		log.info(out.kind === "cpu" ? "CPU" : "LIVE", out.line);
		if (out.analytics.size() === 0) return;
		if (!RunService.IsStudio()) {
			this.telemetry.logSpike(player, out.analytics);
		} else if (Workspace.GetAttribute(ANALYTICS_DEBUG_ATTRIBUTE) === true) {
			for (const spec of out.analytics) log.info("ANALYTICS_STUDIO", `(not sent) ${describeAnalyticsSpec(spec)}`);
		}
	}

	private rowContext(): RollbackIntakeContext {
		return { unixTime: os.time(), placeVersion: game.PlaceVersion };
	}

	/** Each row from its own thread (counted in `writing`), unless the request budget is under the reserve. */
	private writeRows(rows: ReadonlyArray<RollbackDueRow<Player>>): void {
		for (const r of rows) {
			const [ok, budget] = pcall(() =>
				DataStoreService.GetRequestBudgetForRequestType(Enum.DataStoreRequestType.SetIncrementAsync),
			);
			if (ok && typeIs(budget, "number") && budget < ROLLBACK_PROBE_ROWS.budgetReserve) {
				log.warn(
					"PROBE_ROW_SKIPPED",
					`${r.key}: DataStore budget ${budget} under the reserve ${ROLLBACK_PROBE_ROWS.budgetReserve}; ` +
						`${r.row.cpu.size()} cpu / ${r.row.live.size()} live summaries not stored (the log has them)`,
				);
				continue;
			}
			this.writing++;
			task.spawn(() => {
				this.write(this.probeStore, r.key, r.row, [r.userId]);
				this.writing--;
			});
		}
	}

	// --- shutdown -------------------------------------------------------------------------------

	private flushOnClose(): void {
		this.closing = true;
		this.writeRows(this.probes.dueRows(os.clock(), this.rowContext(), true));
		const open: CaptureEntry[] = [];
		for (const [, entry] of this.captures) open.push(entry);
		this.captures.clear();
		for (const entry of open) {
			this.writing++;
			task.spawn(() => {
				const [ok, err] = pcall(() => this.writeCapture(entry, true));
				if (!ok) log.warn("CAPTURE_FAILED", `run ${entry.session.runId}: ${tostring(err)}`);
				this.writing--;
			});
		}
		const t0 = os.clock();
		while (this.writing > 0 && os.clock() - t0 < ROLLBACK_CAPTURE.shutdownWaitSeconds) task.wait();
		if (this.writing > 0) log.warn("CLOSE_TIMEOUT", `${this.writing} capture write(s) still running`);
	}
}

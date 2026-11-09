import { OnStart, Service } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { Players, RunService, Workspace } from "@rbxts/services";
import { serverLogger } from "server/log";
import { Events } from "server/network";
import { DAILY } from "shared/daily";
import type { LockstepSession } from "shared/lockstep";
import { ANALYTICS_DEBUG_ATTRIBUTE, describeAnalyticsSpec } from "shared/onboarding";
import { SlidingWindowLimiter, truncateReason, type AnalyticsEventSpec, type RunSession } from "shared/run";
import {
	ROLLBACK_CAPTURE,
	ROLLBACK_PROBE_RATE,
	ROLLBACK_PROBE_ROW_VERSION,
	RollbackCaptureRecorder,
	analyticsForLiveSummary,
	analyticsForProbeSummary,
	describeLiveSummary,
	describeProbeSummary,
	readLiveSummary,
	readProbeSummary,
	rollbackCaptureAllowed,
	rollbackCaptureChunkKey,
	rollbackCaptureMetaKey,
	rollbackProbeKey,
	type RollbackCaptureEnd,
	type RollbackCaptureSetup,
	type RollbackProbeKind,
	type RollbackProbeRow,
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
}

/**
 * The rollback spike's server half (docs/ROLLBACK_SPIKE.md Design 5-7, task R4). Off unless the Workspace attribute
 * `KV_RollbackCapture` (shared/spikes ROLLBACK_CAPTURE.attribute, SPIKE_DEFAULTS.rollbackCapture) is true.
 *
 * Summary intake (the `rollbackProbe(kind, payload)` remote; while the switch is on, and always in Studio): rate
 * limited per player and kind (ROLLBACK_PROBE_RATE), re-read (readProbeSummary / readLiveSummary: anything malformed is
 * dropped with a warning), then
 *   - one `[Rollback] CPU:` / `[Rollback] LIVE:` line in the server log (describeProbeSummary / describeLiveSummary);
 *   - one row in DataStore `KV_RollbackProbe_v1`, key `<sessionId>/<kind>/<windowIndex>` (RollbackProbeRow), from its
 *     own thread. Every DataStore call is pcall'd; in Studio the first failure (no "Studio Access to API Services")
 *     turns the store off for the session with one line;
 *   - published places only (not Studio): AnalyticsService events through TelemetryService.logSpike (`RollbackCpu`,
 *     `RollbackProbe`; shared/onboarding analyticsCatalog lists both). In Studio, `KV_AnalyticsDebug` prints them.
 *
 * Capture (Design 6): RunSessionService asks `beginCapture` when a party run's lockstep session starts. With the
 * switch on and the party allowed (rollbackCaptureAllowed: Studio, every member a developer, or a developer's private
 * server) it gets a recorder, which it pulls after every lockstep step (`tapCapture`: the merged log releases ticks
 * once validated, so the recorder reads them first) and ends in `forgetLockstep`, the one place every party run's
 * lockstep part ends (a verdict, a desync, abandonment, an error, a conclusion from elsewhere). `endCapture` then, in
 * its own thread, waits up to verdictWaitSeconds for the validator's verdict (the final hash the harness replays to),
 * encodes the run (shared/spikes RollbackCaptureRecorder.finish: the recording codec in blocks, base64 chunks under the
 * DataStore value limit; no user ids) and writes `<runId>/<i>` chunks, then `<runId>/meta`, to `KV_RollbackCapture_v1`,
 * logging the size. With the switch off nothing is created (beginCapture returns undefined); turning it off mid-run
 * abandons every open recorder. BindToClose writes the captures still open (status "shutdown") and waits for the
 * writes, at most shutdownWaitSeconds.
 */
@Service({})
export class RollbackSpikeService implements OnStart {
	private enabled = false;
	private readonly intake = new Janitor();
	private intakeOn = false;
	private readonly captures = new Map<RollbackCaptureRecorder, CaptureEntry>();
	private readonly limiters: { readonly [K in RollbackProbeKind]: SlidingWindowLimiter<Player> } = {
		cpu: new SlidingWindowLimiter<Player>(ROLLBACK_PROBE_RATE.cpu.count, ROLLBACK_PROBE_RATE.cpu.windowSeconds),
		live: new SlidingWindowLimiter<Player>(ROLLBACK_PROBE_RATE.live.count, ROLLBACK_PROBE_RATE.live.windowSeconds),
	};
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
		this.captures.set(recorder, { recorder, session, coop });
		log.info(
			"CAPTURE_START",
			`run ${session.runId} world ${session.worldKind} seed ${session.seed} party ${session.members.size()}`,
		);
		return recorder;
	}

	/** After a lockstep step: the recorder reads the ticks the step finalized. */
	tapCapture(recorder: RollbackCaptureRecorder): void {
		if (!this.captures.has(recorder)) return;
		const [ok, err] = pcall(() => recorder.pull());
		if (!ok) log.warn("CAPTURE_TAP_FAILED", tostring(err));
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

	/** Waits for the verdict (unless shutting down), encodes the capture and writes chunks, then the meta. */
	private writeCapture(entry: CaptureEntry, shutdown: boolean): void {
		const runId = entry.session.runId;
		if (!shutdown) {
			let waited = 0;
			while (entry.session.validator.getResult() === undefined && waited < ROLLBACK_CAPTURE.verdictWaitSeconds) {
				waited += task.wait(ROLLBACK_CAPTURE.verdictPollSeconds);
			}
		}
		const t0 = os.clock();
		const cap = entry.recorder.finish(this.setupOf(entry.session), {
			runId,
			capturedAt: os.time(),
			end: this.endOf(entry, shutdown),
		});
		if (cap === undefined) {
			log.warn("CAPTURE_EMPTY", `run ${runId}: no ticks (${entry.recorder.getProblem() ?? "nothing logged"})`);
			return;
		}
		const m = cap.meta;
		const encodeMs = (os.clock() - t0) * MS_PER_SEC;
		const problem = m.info.problem !== undefined ? ` (${m.info.problem})` : "";
		log.info(
			"CAPTURE_ENCODED",
			`run ${runId}: ${m.ticks} ticks x ${m.players} players, ${m.bytes} bytes (${string.format(
				"%.2f",
				m.bytes / m.ticks / m.players,
			)} per tick per player), ${m.chunks} chunk(s), ${string.format("%.1f", encodeMs)} ms; end ${
				m.info.end?.status ?? "?"
			} ok ${tostring(m.info.end?.ok)} hash ${m.info.end?.serverHash ?? ""}${problem}`,
		);
		for (let i = 0; i < cap.chunks.size(); i++) {
			if (!this.write(this.captureStore, rollbackCaptureChunkKey(runId, i), cap.chunks[i])) {
				log.warn("CAPTURE_NOT_WRITTEN", `run ${runId}: chunk ${i} failed, no meta written`);
				return;
			}
		}
		if (this.write(this.captureStore, rollbackCaptureMetaKey(runId), cap.meta)) {
			log.info(
				"CAPTURE_WRITTEN",
				`run ${runId} -> ${ROLLBACK_CAPTURE.captureStore} (${m.chunks} chunk(s) + meta)`,
			);
		}
	}

	/** One SetAsync under pcall; false (logged) when it failed or the store is off. */
	private write(store: DataStoreKeyValue, key: string, value: unknown): boolean {
		if (this.storeOff.has(store)) return false;
		const [ok, err] = pcall(() => store.set(key, value));
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
		this.setIntake(on || RunService.IsStudio());
	}

	private setIntake(on: boolean): void {
		if (on === this.intakeOn) return;
		this.intakeOn = on;
		if (!on) {
			this.intake.Cleanup();
			return;
		}
		this.intake.Add(Events.rollbackProbe.connect((player, kind, payload) => this.probe(player, kind, payload)));
		this.intake.Add(
			Players.PlayerRemoving.Connect((player) => {
				this.limiters.cpu.forget(player);
				this.limiters.live.forget(player);
			}),
		);
	}

	// --- summary intake -------------------------------------------------------------------------

	private probe(player: Player, rawKind: unknown, payload: unknown): void {
		if (!this.intakeOn || player.Parent === undefined) return;
		const kind: RollbackProbeKind | undefined = rawKind === "cpu" ? "cpu" : rawKind === "live" ? "live" : undefined;
		if (kind === undefined) {
			log.warn(
				"BAD_PROBE",
				`${player.UserId}: unknown kind ${tostring(rawKind).sub(1, ROLLBACK_CAPTURE.maxIdChars)}`,
			);
			return;
		}
		if (!this.limiters[kind].tryAcquire(player, os.clock())) return;
		let specs: AnalyticsEventSpec[];
		let row: RollbackProbeRow;
		let key: string;
		if (kind === "cpu") {
			const s = readProbeSummary(payload);
			if (s === undefined) {
				log.warn("BAD_PROBE", `${player.UserId}: a malformed cpu summary was dropped`);
				return;
			}
			log.info("CPU", `${player.UserId} ${describeProbeSummary(s)}`);
			specs = analyticsForProbeSummary(s);
			row = this.rowOf(kind, s);
			key = rollbackProbeKey(kind, s.sessionId, s.windowIndex);
		} else {
			const s = readLiveSummary(payload);
			if (s === undefined) {
				log.warn("BAD_PROBE", `${player.UserId}: a malformed live summary was dropped`);
				return;
			}
			log.info("LIVE", `${player.UserId} ${describeLiveSummary(s)}`);
			specs = analyticsForLiveSummary(s);
			row = this.rowOf(kind, s);
			key = rollbackProbeKey(kind, s.sessionId, s.windowIndex);
		}
		task.spawn(() => this.write(this.probeStore, key, row));
		if (!RunService.IsStudio()) {
			this.telemetry.logSpike(player, specs);
		} else if (Workspace.GetAttribute(ANALYTICS_DEBUG_ATTRIBUTE) === true) {
			for (const spec of specs) log.info("ANALYTICS_STUDIO", `(not sent) ${describeAnalyticsSpec(spec)}`);
		}
	}

	private rowOf(kind: RollbackProbeKind, summary: RollbackProbeRow["summary"]): RollbackProbeRow {
		return { v: ROLLBACK_PROBE_ROW_VERSION, kind, at: os.time(), placeVersion: game.PlaceVersion, summary };
	}

	// --- shutdown -------------------------------------------------------------------------------

	private flushOnClose(): void {
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

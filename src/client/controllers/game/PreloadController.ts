import { Controller, OnInit, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { ContentProvider, RunService, UserInputService, Workspace } from "@rbxts/services";
import { Events } from "client/network";
import { clientStore } from "client/store";
import { isTenFootInterface } from "client/ui";
import { RUN_ATTRIBUTES } from "shared/play";
import type { ContentRef, ThemePack } from "shared/theme";
import {
	ART_READINESS,
	ArtReadiness,
	LoadWaiters,
	PRELOAD,
	PRELOAD_BOSS_IDS,
	PreloadProgress,
	PreloadQueue,
	bossContentIds,
	loadingReleased,
	parseStandInsForce,
	preloadChunkSize,
	preloadDeviceOf,
	preloadPlan,
	skipVisible,
	type PreloadDevice,
	type PreloadLane,
} from "shared/view";
import { isSpikeEnabled } from "../spikes/spikeFlags";
import { SimController, type RunContext } from "./SimController";
import { ThemeController } from "./ThemeController";

const LOG = "[Preload]";
const READY_LOG = "[Ready]";
const SECONDS = "%.2f";

/** Why the loading screen released (the log line). */
type ReleaseReason = "core" | "skip" | "timeout" | "attribute";

/**
 * One `PreloadAsync` entry for a content id (docs/PRELOAD.md D4, PRELOAD.entryMode): "instance" builds a
 * never-parented ImageLabel (Image) or Sound (SoundId) for it, destroyed once its chunk resolved; "string" passes
 * the content id itself.
 */
function toPreloadEntry(ref: ContentRef): Instance | string {
	if (PRELOAD.entryMode === "string") return ref.contentId;
	if (ref.media === "sound") {
		const sound = new Instance("Sound");
		sound.SoundId = ref.contentId;
		return sound;
	}
	const image = new Instance("ImageLabel");
	image.Image = ref.contentId;
	return image;
}

function seconds(t: number): string {
	return string.format(SECONDS, t);
}

/**
 * A `whenLoaded` wait (docs/STAGE_ASSETS.md SA4): its progress for the stage bars, and a way to drop it. Read it as
 * often as you like (a small scan per call); a wait that fired reports [total, total].
 */
export interface LoadHandle {
	/** [content ids resolved (ok or failed), distinct content ids waited for]. */
	progress(): [done: number, total: number];
	/** The listener has run (or was run synchronously). False after a cancel. */
	isDone(): boolean;
	/** Drops the wait: the listener never runs. The ids stay queued. No-op once done. */
	cancel(): void;
}

/** This device's class for the chunk size (shared/view preloadDeviceOf; InputController's touch rule). */
function readPreloadDevice(): PreloadDevice {
	return preloadDeviceOf({
		tenFoot: isTenFootInterface(),
		touchEnabled: UserInputService.TouchEnabled,
		keyboardEnabled: UserInputService.KeyboardEnabled,
		gamepadEnabled: UserInputService.GamepadEnabled,
	});
}

/**
 * Asset preloading and the join loading screen's clock (docs/PRELOAD.md P3). Presentation only: it downloads what
 * the theme pack names, never touches the sim, the lockstep wire or a hash.
 *
 *   plan       onInit (right after ThemeController, loadOrder 1): shared/view preloadPlan(pack) -> the core tier
 *              (what the main menu, the tutorial and floor 1 can show or play), then the later tier (bosses, other
 *              music, ambience, biomes 2-5), both queued on the back lane in download order.
 *   queue      shared/view PreloadQueue: three FIFO lanes (front, next, back: docs/STAGE_ASSETS.md SA4) and a
 *              session-wide seen set, so a content id is requested once per session (a push to a higher lane moves an
 *              id still waiting in a lower one). ONE worker thread takes up to `chunkSizeByDevice[device]` entries at a
 *              time (shared/view preloadChunkSize; device read once at start: console = a ten-foot interface, touch =
 *              touch without keyboard or gamepad, else desktop), small so a front request gets in between chunks.
 *              With PRELOAD.fetchStatusPrecheck it first asks ContentProvider:GetAssetFetchStatus (pcall; a failing
 *              call turns the pre-check off for the session) and resolves an id already Success in the engine
 *              without a fetch; the rest it turns into entries (toPreloadEntry) for ContentProvider:PreloadAsync.
 *              Each callback status counts (Success = ok, anything else failed: one warn per id, counted as done for
 *              the waits). An entry the callback never names (an instance's content id may come back spelled
 *              differently) counts as ok once its chunk returned. With every lane empty the worker sleeps on a
 *              BindableEvent that `request` fires.
 *   request    `request(refs, lane = "front", label?)`: run starts and floor changes (AudioController.preload: the
 *              run's sound effects, the floor's music / ambience, the boss track), the boss push below, and the
 *              stage manifest's prefetch on `next`.
 *   readiness  (docs/STAGE_ASSETS.md SA16) ONE shared/view ArtReadiness over the pack, every `assetIdList()` id tracked
 *              at start (so `flippedSince` lists every pack id). Success -> markReady, a failure -> markFailed; the
 *              first failure is re-queued ONCE on the back lane (PreloadQueue.retry, past the seen set) when
 *              `retryDue` hands it out (ART_READINESS.retryAfterSec, checked on Heartbeat), the second is final (a
 *              stand-in for the session). `getReadiness()`, `isArtReady(id)`, `onReadinessChanged(cb)` (cb(epoch) on
 *              the Heartbeat after a change, at most once per frame, each in its own thread; returns the
 *              unsubscribe). Workspace `KV_StandInsForce` (RUN_ATTRIBUTES.standInsForce, read live) -> setForced.
 *              Logs: under KV_Debug `[Ready] <id> ready (<n> content ids)` per flip; always one summary line once
 *              every tracked id is ready.
 *   latency    Studio only, Workspace `KV_FakeAssetLatency` (seconds, read live): the worker waits that long before
 *              each PreloadAsync chunk and skips the fetch-status pre-check; `whenLoaded` re-fetches each of its refs
 *              that already resolved, once per id per session (LoadWaiters.forget + PreloadQueue.retry on the front
 *              lane), so gates see a real wait against Studio's cache. ArtReadiness is not reset by it (a ready id
 *              stays ready: a swap never goes back); use KV_StandInsForce for stand-ins.
 *   boss push  every run start and endless floor change onto a boss floor (RunContext.endlessFloor(floor).layout
 *              .bossKind): bossContentIds(pack, kind) to the front lane, labelled with the boss's theme id.
 *   screen     PreloadProgress over the core ids only; elapsed time from onInit; `skip()` (the screen's Skip
 *              button, once shared/view skipVisible) sets `skipped`. Released = shared/view loadingReleased (core
 *              done, Skip or PRELOAD.timeoutSec), checked once per Heartbeat, which also pushes the progress to the
 *              Reflex `loading` slice (only on a change) until the release, then disconnects. Workspace
 *              `KV_SkipLoading` (RUN_ATTRIBUTES.skipLoading, read once) releases at once; an empty core tier (the
 *              placeholder pack) releases in onInit. `whenReleased(cb)` runs cb once released (at once if it is;
 *              each in its own thread), `isReleased()`. The release sends `onboardingReport({ kind: "loaded" })`
 *              once per session (docs/TUTORIAL_FUNNEL.md TF6: the onboarding funnel's `Loaded`).
 *   loaded    `whenLoaded(refs, cb, label?)` (docs/STAGE_LOADER.md SL6, the stage loader's assets wait): cb once every
 *              one of `refs` resolved (ok or failed), synchronously at once if they all have, else in its own thread
 *              when the last one does; refs not yet resolved go through `request(refs, "front", label)` (never
 *              requested: queued on the front lane; waiting in a lower lane: moved up). Returns a LoadHandle
 *              (`progress()` [done, total], `isDone()`, `cancel()`). shared/view LoadWaiters keeps the session's
 *              resolved ids and the open waits.
 *   spike      with the P0 spike on at join (KV_SpikePreload, docs/SPIKES.md) the worker waits until the spike's
 *              timed batches ran (`releaseSpikeHold`), so its download times are not cache hits of this queue.
 *   P6         PRELOAD.warmCoreImages (the warm draw) is not implemented: it waits for the P0 spike's verdict.
 *
 * Log lines start with `[Preload]`: the plan's sizes at start, `core <n> / <n> in <t> s` once the core tier
 * resolved, the release (and why), `later done ...` when the initial plan drained, `front: <label>` / `next: <label>`
 * per front / next request that queued anything new, `retry <id>` per retried id.
 */
@Controller({ loadOrder: 1 })
export class PreloadController implements OnInit, OnStart {
	private readonly janitor = new Janitor<{ heartbeat: RBXScriptConnection; readiness: RBXScriptConnection }>();
	private readonly queue = new PreloadQueue();
	private readonly wake = new Instance("BindableEvent");
	private pack: ThemePack | undefined;
	private startedAt = 0;
	/** The worker sleeps on `wake` (both lanes were empty). */
	private idle = false;
	/** The P0 spike holds the worker until its own batches ran. */
	private spikeHold = false;
	private workerStarted = false;

	private core = new PreloadProgress(0);
	private readonly coreIds = new Set<string>();
	private readonly laterIds = new Set<string>();
	private laterTotal = 0;
	private laterLeft = 0;
	private laterLogged = false;
	private coreLogged = false;
	private failedCount = 0;

	private skipped = false;
	private released = false;
	private readonly releaseListeners = new Array<() => void>();
	/** Resolved content ids and the open whenLoaded waits. */
	private readonly waiters = new LoadWaiters<() => void>();
	/** The last progress pushed to the store (-1: none yet). */
	private lastDone = -1;
	private lastSkipVisible = false;

	/** Entries per PreloadAsync call on this device. */
	private chunkSize = PRELOAD.chunkSizeByDevice.desktop;
	/** The fetch-status pre-check is on (PRELOAD.fetchStatusPrecheck, off after a failing call). */
	private precheck = PRELOAD.fetchStatusPrecheck;
	/** Art readiness (SA16); built in onInit from the pack. */
	private readiness = new ArtReadiness({
		contentIds(): ReadonlyArray<ContentRef> {
			return [];
		},
	});
	/** The refs of content ids that failed once, for their one retry. */
	private readonly retryRefs = new Map<string, ContentRef>();
	/** KV_FakeAssetLatency: ids `whenLoaded` already re-fetched once. */
	private readonly fakedOnce = new Set<string>();
	private readonly readinessListeners = new Array<(epoch: number) => void>();
	/** The epoch the readiness listeners and the flip log last saw. */
	private readinessEpoch = 0;
	private readySummaryLogged = false;
	private finalFailures = 0;
	private prechecked = 0;

	constructor(private readonly theme: ThemeController, private readonly sim: SimController) {}

	onInit(): void {
		this.janitor.Add(this.wake);
		this.startedAt = os.clock();
		const pack = this.theme.getPack();
		this.pack = pack;
		const plan = preloadPlan(pack);
		for (const ref of plan.core) this.coreIds.add(ref.contentId);
		for (const ref of plan.later) this.laterIds.add(ref.contentId);
		this.laterTotal = plan.later.size();
		this.laterLeft = this.laterTotal;
		this.core = new PreloadProgress(plan.core.size());
		this.queue.push(plan.core, "back");
		this.queue.push(plan.later, "back");
		const device = readPreloadDevice();
		this.chunkSize = preloadChunkSize(device);
		print(
			`${LOG} core ${plan.core.size()} entries, later ${plan.later.size()} (${PRELOAD.entryMode} entries, ` +
				`chunks of ${this.chunkSize} on ${device})`,
		);
		this.initReadiness(pack);

		if (Workspace.GetAttribute(RUN_ATTRIBUTES.skipLoading) === true) {
			this.release("attribute");
		} else if (this.core.complete()) {
			this.release("core");
		} else {
			this.janitor.Add(
				RunService.Heartbeat.Connect(() => this.checkRelease()),
				"Disconnect",
				"heartbeat",
			);
			this.pushProgress(0);
		}

		this.spikeHold = isSpikeEnabled("preload");
		if (this.spikeHold) print(`${LOG} KV_SpikePreload: the queue waits for the spike's batches`);
		else this.startWorker();
	}

	onStart(): void {
		this.sim.onRunStarted((ctx) => this.pushBoss(ctx));
		this.sim.onFloorChanged((ctx) => this.pushBoss(ctx));
	}

	/**
	 * Queues `refs` (each content id once per session) on `lane`: "front" (default) is served before anything on the
	 * back lane and moves ids still waiting there. `label` names the request in the log.
	 */
	request(refs: ReadonlyArray<ContentRef>, lane: PreloadLane = "front", label?: string): void {
		const count = this.queue.push(refs, lane);
		if (lane !== "back" && count > 0) {
			print(`${LOG} ${lane}: ${label ?? "request"} (${count} of ${refs.size()} queued, the rest already seen)`);
		}
		if (count > 0) this.wakeWorker();
	}

	/** The screen's Skip button: releases the screen once Skip is offered (shared/view skipVisible). */
	skip(): void {
		if (this.released || !skipVisible(os.clock() - this.startedAt)) return;
		this.skipped = true;
		this.checkRelease();
	}

	/** Calls `listener` once the loading screen released (at once if it already has). */
	whenReleased(listener: () => void): void {
		if (this.released) task.spawn(listener);
		else this.releaseListeners.push(listener);
	}

	isReleased(): boolean {
		return this.released;
	}

	/**
	 * Calls `listener` once every one of `refs` resolved (ok or failed): synchronously now if they all have, else in its
	 * own thread when the last one does. Refs not resolved yet are requested on the front lane (`label` in the log; an
	 * id already queued or in flight is not queued again, one waiting in the back lane moves up).
	 */
	whenLoaded(refs: ReadonlyArray<ContentRef>, listener: () => void, label?: string): LoadHandle {
		if (this.fakeLatency() > 0) this.fakeUnresolve(refs, label);
		const ids = new Array<string>();
		const distinct = new Set<string>();
		for (const ref of refs) {
			if (distinct.has(ref.contentId)) continue;
			distinct.add(ref.contentId);
			ids.push(ref.contentId);
		}
		const total = ids.size();
		let done = false;
		let cancelled = false;
		// one closure per wait: LoadWaiters finds a wait by its payload's identity
		const payload = () => {
			if (cancelled) return;
			done = true;
			listener();
		};
		const waiters = this.waiters;
		const handle: LoadHandle = {
			progress(): [done: number, total: number] {
				if (done) return [total, total];
				const open = waiters.progress(payload);
				if (open !== undefined) return open;
				let n = 0;
				for (const id of ids) if (waiters.isResolved(id)) n += 1;
				return [n, total];
			},
			isDone(): boolean {
				return done;
			},
			cancel(): void {
				if (done || cancelled) return;
				cancelled = true;
				waiters.cancel(payload);
			},
		};
		if (this.waiters.wait(ids, payload)) {
			payload();
			return handle;
		}
		this.request(refs, "front", label);
		return handle;
	}

	// --- readiness (docs/STAGE_ASSETS.md SA16) -----------------------------------------------------

	/** The session's art readiness (stand-ins until an id's content downloaded). */
	getReadiness(): ArtReadiness {
		return this.readiness;
	}

	/** `getReadiness().isReady(logicalId)`: the id's art is in (no content ids: true), and no KV_StandInsForce match. */
	isArtReady(logicalId: string): boolean {
		return this.readiness.isReady(logicalId);
	}

	/**
	 * Calls `listener(epoch)` on the Heartbeat after the readiness changed (content landed, failed for good, or the
	 * KV_StandInsForce force changed), at most once per frame, each listener in its own thread. Read
	 * `getReadiness().flippedSince(lastEpoch)` for what changed. Returns the unsubscribe (idempotent).
	 */
	onReadinessChanged(listener: (epoch: number) => void): () => void {
		this.readinessListeners.push(listener);
		return () => {
			const i = this.readinessListeners.indexOf(listener);
			if (i >= 0) this.readinessListeners.remove(i);
		};
	}

	/** The P0 spike (PreloadSpikeController) ran its timed batches: the queue may start. */
	releaseSpikeHold(): void {
		if (!this.spikeHold) return;
		this.spikeHold = false;
		print(`${LOG} spike done: the queue starts`);
		this.startWorker();
	}

	// --- the worker ------------------------------------------------------------------------------

	private startWorker(): void {
		if (this.workerStarted) return;
		this.workerStarted = true;
		task.spawn(() => this.work());
	}

	/** The worker loop: a chunk at a time, front lane first; asleep on `wake` while both lanes are empty. */
	private work(): void {
		while (this.workerStarted) {
			const batch = this.queue.take(this.chunkSize);
			if (batch.size() === 0) {
				this.idle = true;
				this.wake.Event.Wait();
				this.idle = false;
				continue;
			}
			const latency = this.fakeLatency();
			const toFetch = latency <= 0 && this.precheck ? this.precheckBatch(batch) : batch;
			if (toFetch.size() === 0) continue;
			if (latency > 0) task.wait(latency);
			this.fetch(toFetch);
		}
	}

	private wakeWorker(): void {
		if (this.idle) this.wake.Fire();
	}

	/**
	 * The fetch-status pre-check: ids already `Success` in the engine resolve ok without a fetch; the rest are returned.
	 * A failing call (an engine without the API) turns the pre-check off for the session.
	 */
	private precheckBatch(batch: ReadonlyArray<ContentRef>): Array<ContentRef> {
		const out = new Array<ContentRef>();
		for (const ref of batch) {
			if (!this.precheck) {
				out.push(ref);
				continue;
			}
			const [ok, status] = pcall(() => ContentProvider.GetAssetFetchStatus(ref.contentId));
			if (!ok) {
				this.precheck = false;
				warn(`${LOG} GetAssetFetchStatus failed (${tostring(status)}): the pre-check is off`);
				out.push(ref);
			} else if (status === Enum.AssetFetchStatus.Success) {
				this.prechecked += 1;
				this.resolved(ref, true);
			} else {
				out.push(ref);
			}
		}
		return out;
	}

	/** KV_FakeAssetLatency in seconds (Studio only; 0 = off). */
	private fakeLatency(): number {
		if (!RunService.IsStudio()) return 0;
		const value = Workspace.GetAttribute(RUN_ATTRIBUTES.fakeAssetLatency);
		return typeIs(value, "number") && value > 0 ? value : 0;
	}

	/** KV_FakeAssetLatency: `refs` already resolved are fetched once more (once per id per session), on the front lane. */
	private fakeUnresolve(refs: ReadonlyArray<ContentRef>, label: string | undefined): void {
		let count = 0;
		for (const ref of refs) {
			const id = ref.contentId;
			if (this.fakedOnce.has(id) || !this.waiters.isResolved(id)) continue;
			this.fakedOnce.add(id);
			this.waiters.forget(id);
			if (this.queue.retry(ref, "front")) count += 1;
		}
		if (count === 0) return;
		print(`${LOG} ${RUN_ATTRIBUTES.fakeAssetLatency}: ${label ?? "wait"} re-fetches ${count} resolved ids`);
		this.wakeWorker();
	}

	/** One PreloadAsync call for `batch`; every entry counts as resolved once it returns. */
	private fetch(batch: ReadonlyArray<ContentRef>): void {
		const entries = batch.map((ref) => toPreloadEntry(ref));
		const statuses = new Map<string, Enum.AssetFetchStatus>();
		const [ok, err] = pcall(() =>
			ContentProvider.PreloadAsync(entries, (contentId, status) => statuses.set(contentId, status)),
		);
		for (const e of entries) if (typeIs(e, "Instance")) e.Destroy();
		if (!ok) warn(`${LOG} PreloadAsync failed for ${batch.size()} entries: ${tostring(err)}`);
		for (const ref of batch) {
			const status = statuses.get(ref.contentId);
			const good = ok && (status === undefined || status === Enum.AssetFetchStatus.Success);
			this.resolved(ref, good);
			if (!good) {
				warn(`${LOG} ${ref.media} ${ref.contentId}: ${status?.Name ?? "error"} (${this.failureNote(ref)})`);
			}
		}
	}

	/** The warn line's tail for a failed fetch of `ref` (after `resolved` recorded it). */
	private failureNote(ref: ContentRef): string {
		const r = this.readiness;
		if (r.status(ref.contentId) === "ready") return "already in: ignored";
		if (r.isFinalFailure(ref.contentId)) return "final: a stand-in for the session";
		return `retry in ${ART_READINESS.retryAfterSec} s`;
	}

	private resolved(ref: ContentRef, ok: boolean): void {
		const id = ref.contentId;
		if (ok) {
			this.readiness.markReady(id);
		} else {
			this.failedCount += 1;
			const wasFinal = this.readiness.isFinalFailure(id);
			this.readiness.markFailed(id, os.clock());
			if (this.readiness.isFinalFailure(id)) {
				if (!wasFinal) this.finalFailures += 1;
			} else if (this.readiness.status(id) === "failed") {
				this.retryRefs.set(id, ref);
			}
		}
		for (const listener of this.waiters.resolve(id)) task.spawn(listener);
		if (this.coreIds.has(id)) {
			this.coreIds.delete(id);
			this.core.resolve(ok);
			if (this.core.complete() && !this.coreLogged) {
				this.coreLogged = true;
				const t = seconds(os.clock() - this.startedAt);
				print(
					`${LOG} core ${this.core.done()} / ${this.core.total()} in ${t} s (${this.core.failed()} failed)`,
				);
			}
		} else if (this.laterIds.has(id)) {
			this.laterIds.delete(id);
			this.laterLeft -= 1;
			if (this.laterLeft <= 0 && !this.laterLogged) {
				this.laterLogged = true;
				print(
					`${LOG} later done: ${this.laterTotal} entries in ${seconds(os.clock() - this.startedAt)} s ` +
						`(${this.failedCount} failed in all so far)`,
				);
			}
		}
	}

	// --- readiness internals ---------------------------------------------------------------------

	private initReadiness(pack: ThemePack): void {
		this.readiness = new ArtReadiness(pack);
		for (const id of pack.assetIdList()) this.readiness.track(id);
		this.readForce();
		this.readinessEpoch = this.readiness.epoch();
		this.janitor.Add(
			Workspace.GetAttributeChangedSignal(RUN_ATTRIBUTES.standInsForce).Connect(() => this.readForce()),
		);
		this.janitor.Add(
			RunService.Heartbeat.Connect(() => this.stepReadiness()),
			"Disconnect",
			"readiness",
		);
	}

	private readForce(): void {
		const raw = Workspace.GetAttribute(RUN_ATTRIBUTES.standInsForce);
		const force = parseStandInsForce(raw);
		const before = this.readiness.epoch();
		this.readiness.setForced(force);
		if (this.readiness.epoch() === before) return;
		const what = force === undefined ? "off" : force === "all" ? "every id" : force.join(", ");
		print(`${READY_LOG} ${RUN_ATTRIBUTES.standInsForce}: stand-ins for ${what}`);
	}

	/** Once per Heartbeat: due retries back on the queue, then the change listeners, the flip log and the summary. */
	private stepReadiness(): void {
		const r = this.readiness;
		if (r.retriesPending() > 0) {
			let queued = 0;
			for (const id of r.retryDue(os.clock())) {
				const ref = this.retryRefs.get(id);
				if (ref === undefined) continue;
				if (this.queue.retry(ref, "back")) {
					queued += 1;
					print(`${LOG} retry ${ref.media} ${id}`);
				}
			}
			if (queued > 0) this.wakeWorker();
		}
		const epoch = r.epoch();
		if (epoch === this.readinessEpoch) return;
		if (Workspace.GetAttribute(RUN_ATTRIBUTES.debug) === true) {
			for (const id of r.flippedSince(this.readinessEpoch)) {
				if (r.isReady(id)) print(`${READY_LOG} ${id} ready (${r.contentCount(id)} content ids)`);
				else print(`${READY_LOG} ${id} stand-in (forced)`);
			}
		}
		this.readinessEpoch = epoch;
		if (!this.readySummaryLogged) {
			const [ready, tracked] = r.trackedCounts();
			if (ready >= tracked) {
				this.readySummaryLogged = true;
				print(
					`${READY_LOG} all ${tracked} ids ready in ${seconds(os.clock() - this.startedAt)} s ` +
						`(${this.prechecked} already in the engine, ${this.finalFailures} content ids failed for good)`,
				);
			}
		}
		for (const listener of [...this.readinessListeners]) task.spawn(listener, epoch);
	}

	// --- the screen ------------------------------------------------------------------------------

	/** Once per Heartbeat until the release: the release rule, then the store's progress. */
	private checkRelease(): void {
		if (this.released) return;
		const elapsed = os.clock() - this.startedAt;
		const coreDone = this.core.complete();
		if (loadingReleased({ coreDone, elapsedSec: elapsed, skipped: this.skipped })) {
			this.release(coreDone ? "core" : this.skipped ? "skip" : "timeout");
			return;
		}
		this.pushProgress(elapsed);
	}

	private pushProgress(elapsed: number): void {
		const done = this.core.done();
		const skip = skipVisible(elapsed);
		if (done === this.lastDone && skip === this.lastSkipVisible) return;
		this.lastDone = done;
		this.lastSkipVisible = skip;
		clientStore.setLoadingProgress({
			fraction: this.core.fraction(),
			done,
			total: this.core.total(),
			skipVisible: skip,
		});
	}

	private release(reason: ReleaseReason): void {
		if (this.released) return;
		this.released = true;
		this.janitor.Remove("heartbeat");
		const elapsed = seconds(os.clock() - this.startedAt);
		const counts = `core ${this.core.done()} / ${this.core.total()}`;
		if (reason === "attribute") {
			print(`${LOG} ${RUN_ATTRIBUTES.skipLoading}: no loading screen (${counts}; the queue still runs)`);
		} else if (reason === "core") {
			print(`${LOG} screen released at ${elapsed} s: core done`);
		} else {
			print(
				`${LOG} screen released by ${reason === "skip" ? "Skip" : "the timeout"} at ${elapsed} s (${counts})`,
			);
		}
		clientStore.setLoadingProgress({
			fraction: this.core.fraction(),
			done: this.core.done(),
			total: this.core.total(),
			skipVisible: false,
		});
		clientStore.setLoadingReleased();
		// Onboarding funnel step 2 `Loaded` (docs/TUTORIAL_FUNNEL.md §2): once per session (`released` latches), for
		// every release kind (core, Skip, timeout, KV_SkipLoading).
		Events.onboardingReport.fire({ kind: "loaded" });
		for (const listener of this.releaseListeners) task.spawn(listener);
		this.releaseListeners.clear();
	}

	// --- the boss push ---------------------------------------------------------------------------

	/** A run start or floor change onto an endless boss floor: that boss's sheets to the front lane. */
	private pushBoss(ctx: RunContext): void {
		const pack = this.pack;
		if (pack === undefined || ctx.endlessFloor === undefined || ctx.floor <= 0) return;
		const kind = ctx.endlessFloor(ctx.floor).layout.bossKind;
		if (kind === undefined) return;
		const refs = bossContentIds(pack, kind);
		if (refs.size() === 0) return;
		this.request(refs, "front", PRELOAD_BOSS_IDS[kind] ?? kind);
	}
}

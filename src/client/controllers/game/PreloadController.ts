import { Controller, OnInit, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { ContentProvider, RunService, Workspace } from "@rbxts/services";
import { Events } from "client/network";
import { clientStore } from "client/store";
import { RUN_ATTRIBUTES } from "shared/play";
import type { ContentRef, ThemePack } from "shared/theme";
import {
	LoadWaiters,
	PRELOAD,
	PRELOAD_BOSS_IDS,
	PreloadProgress,
	PreloadQueue,
	bossContentIds,
	loadingReleased,
	preloadPlan,
	skipVisible,
	type PreloadLane,
} from "shared/view";
import { isSpikeEnabled } from "../spikes/spikeFlags";
import { SimController, type RunContext } from "./SimController";
import { ThemeController } from "./ThemeController";

const LOG = "[Preload]";
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
 * Asset preloading and the join loading screen's clock (docs/PRELOAD.md P3). Presentation only: it downloads what
 * the theme pack names, never touches the sim, the lockstep wire or a hash.
 *
 *   plan       onInit (right after ThemeController, loadOrder 1): shared/view preloadPlan(pack) -> the core tier
 *              (what the main menu, the tutorial and floor 1 can show or play), then the later tier (bosses, other
 *              music, ambience, biomes 2-5), both queued on the back lane in download order.
 *   queue      shared/view PreloadQueue: two FIFO lanes (front first) and a session-wide seen set, so a content id
 *              is requested once per session (a front push moves an id still waiting in the back lane). ONE worker
 *              thread takes up to PRELOAD.chunkSize entries at a time (small, so a front request gets in between
 *              chunks), turns each into its entry (toPreloadEntry) and calls ContentProvider:PreloadAsync; each
 *              callback status counts (Success = ok, anything else failed: one warn per id, counted as done, never
 *              retried: the engine fetches it again on first use). An entry the callback never names (an instance's
 *              content id may come back spelled differently) counts as ok once its chunk returned. With both lanes
 *              empty the worker sleeps on a BindableEvent that `request` fires.
 *   request    `request(refs, lane = "front", label?)`: run starts and floor changes (AudioController.preload: the
 *              run's sound effects, the floor's music / ambience, the boss track) and the boss push below.
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
 *              requested: queued on the front lane; waiting in the back lane: moved up). shared/view LoadWaiters keeps
 *              the session's resolved ids and the open waits.
 *   spike      with the P0 spike on at join (KV_SpikePreload, docs/SPIKES.md) the worker waits until the spike's
 *              timed batches ran (`releaseSpikeHold`), so its download times are not cache hits of this queue.
 *   P6         PRELOAD.warmCoreImages (the warm draw) is not implemented: it waits for the P0 spike's verdict.
 *
 * Log lines start with `[Preload]`: the plan's sizes at start, `core <n> / <n> in <t> s` once the core tier
 * resolved, the release (and why), `later done ...` when the initial plan drained, `front: <label>` per front request that queued anything new.
 */
@Controller({ loadOrder: 1 })
export class PreloadController implements OnInit, OnStart {
	private readonly janitor = new Janitor<{ heartbeat: RBXScriptConnection }>();
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
		print(
			`${LOG} core ${plan.core.size()} entries, later ${plan.later.size()} (${PRELOAD.entryMode} entries, ` +
				`chunks of ${PRELOAD.chunkSize})`,
		);

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
		if (lane === "front" && count > 0) {
			print(`${LOG} front: ${label ?? "request"} (${count} of ${refs.size()} queued, the rest already seen)`);
		}
		if (count > 0 && this.idle) this.wake.Fire();
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
	whenLoaded(refs: ReadonlyArray<ContentRef>, listener: () => void, label?: string): void {
		const ids = refs.map((ref) => ref.contentId);
		if (this.waiters.wait(ids, listener)) {
			listener();
			return;
		}
		this.request(refs, "front", label);
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
			const batch = this.queue.take(PRELOAD.chunkSize);
			if (batch.size() === 0) {
				this.idle = true;
				this.wake.Event.Wait();
				this.idle = false;
				continue;
			}
			this.fetch(batch);
		}
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
			if (!good) warn(`${LOG} ${ref.media} ${ref.contentId}: ${status?.Name ?? "error"} (not retried)`);
			this.resolved(ref, good);
		}
	}

	private resolved(ref: ContentRef, ok: boolean): void {
		if (!ok) this.failedCount += 1;
		const id = ref.contentId;
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

import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { ContentProvider, Players, RunService, Workspace } from "@rbxts/services";
import { logInfo, logWarn } from "client/log";
import { createKvScreenGui } from "client/ui";
import { PRELOAD_SPIKE, SPIKE_ATTRIBUTES } from "shared/config";
import type { ContentRef, PreloadMedia } from "shared/theme";
import { PreloadController } from "../game/PreloadController";
import { ThemeController } from "../game/ThemeController";
import { watchSpikeFlag } from "./spikeFlags";

const LOG = "[PreloadSpike]";
const MS = "%.1f";

/** How a batch hands its ids to PreloadAsync: the content id strings, or never-parented instances. */
type EntryKind = "strings" | "instances";

function ms(sec: number): string {
	return string.format(MS, sec * PRELOAD_SPIKE.msPerSec);
}

function entryFor(ref: ContentRef, kind: EntryKind): Instance | string {
	if (kind === "strings") return ref.contentId;
	if (ref.media === "sound") {
		const s = new Instance("Sound");
		s.SoundId = ref.contentId;
		return s;
	}
	const image = new Instance("ImageLabel");
	image.Image = ref.contentId;
	return image;
}

/**
 * Spike P0 (docs/PRELOAD.md P0, docs/SPIKES.md "Spike P0"): does `ContentProvider:PreloadAsync` fetch images and
 * sounds from bare content id strings, or only through instances (decision D4), and does the first draw of a
 * downloaded sheet hitch (D5, the P6 warm draw)?
 *
 * Off unless `KV_SpikePreload` (or SPIKE_DEFAULTS.preload) is true; set it before Play, so PreloadController's own
 * queue holds until the batches ran (otherwise they would be cache hits of its core tier). Once per enable:
 *
 *   1. four timed batches: (a) the knight's sheets (PRELOAD_SPIKE.imageAssetId) as strings, (b) the same as
 *      never-parented ImageLabels, (c) up to PRELOAD_SPIKE.soundCount sfx content ids as strings, (d) as Sounds.
 *      Each callback prints `<batch> <content id> <status> +<ms>`; each batch `<batch>: <n> entries in <ms> ms`.
 *      CAVEAT (printed): the engine caches, so the second batch of a pair is usually a cache hit of the first;
 *      `KV_SpikePreloadInstancesFirst` = true runs (b) before (a) and (d) before (c), so two plays compare both orders.
 *      Studio's local cache hides download time too: the real numbers come from a fresh device.
 *   2. PreloadController.releaseSpikeHold: the queue starts.
 *   3. the first-draw probe: PRELOAD_SPIKE.baselineFrames frames timed (os.clock delta per RenderStepped), then the
 *      first knight sheet in a 1x1 ImageLabel (its own ScreenGui above the loading screen) for
 *      PRELOAD_SPIKE.holdFrames frames, each frame's delta printed against the baseline's mean and worst; then the
 *      label goes. Watch the MicroProfiler (Ctrl+F6) for an upload spike on that frame.
 *
 * Setting the flag false cancels a run in progress and removes what it made (one Janitor).
 */
@Controller({})
export class PreloadSpikeController implements OnStart {
	private session?: Janitor;

	constructor(private readonly theme: ThemeController, private readonly preload: PreloadController) {}

	onStart(): void {
		watchSpikeFlag("preload", (enabled) => (enabled ? this.start() : this.stop()));
	}

	private stop(): void {
		this.session?.Destroy();
		this.session = undefined;
		this.preload.releaseSpikeHold();
	}

	private start(): void {
		if (this.session !== undefined) return;
		const session = new Janitor();
		this.session = session;
		const thread = task.spawn(() => this.run(session));
		session.Add(() => {
			if (coroutine.status(thread) === "suspended") task.cancel(thread);
		}, true);
	}

	private run(session: Janitor): void {
		const pack = this.theme.getPack();
		const images = pack.contentIds(PRELOAD_SPIKE.imageAssetId);
		const sounds = this.soundRefs();
		const instancesFirst = Workspace.GetAttribute(PRELOAD_SPIKE.instancesFirstAttribute) === true;
		const order: ReadonlyArray<EntryKind> = instancesFirst ? ["instances", "strings"] : ["strings", "instances"];
		logInfo(
			`${LOG} ${images.size()} ${PRELOAD_SPIKE.imageAssetId} sheets, ${sounds.size()} sfx; order ${order[0]} ` +
				`then ${order[1]} (${PRELOAD_SPIKE.instancesFirstAttribute} = ${tostring(instancesFirst)})`,
		);
		logInfo(
			`${LOG} CAVEAT: the engine caches each id, so the second batch of each pair is usually a cache hit of the ` +
				`first; flip ${PRELOAD_SPIKE.instancesFirstAttribute} and play again to compare. Studio's local cache ` +
				`hides download time: take the real numbers on a fresh device.`,
		);
		for (const kind of order) this.batch(`images/${kind}`, images, kind, "image");
		for (const kind of order) this.batch(`sounds/${kind}`, sounds, kind, "sound");
		this.preload.releaseSpikeHold();
		if (images.size() > 0) this.probe(session, images[0]);
		else logInfo(`${LOG} no ${PRELOAD_SPIKE.imageAssetId} sheet uploaded: no first-draw probe`);
	}

	/** Up to PRELOAD_SPIKE.soundCount sound content ids of PRELOAD_SPIKE.soundPrefix ids, in logical-id order. */
	private soundRefs(): Array<ContentRef> {
		const pack = this.theme.getPack();
		const out = new Array<ContentRef>();
		const prefix = PRELOAD_SPIKE.soundPrefix;
		for (const id of pack.assetIdList()) {
			if (id.sub(1, prefix.size()) !== prefix) continue;
			for (const ref of pack.contentIds(id)) {
				if (out.size() >= PRELOAD_SPIKE.soundCount) return out;
				if (ref.media === "sound") out.push(ref);
			}
		}
		return out;
	}

	private batch(label: string, refs: ReadonlyArray<ContentRef>, kind: EntryKind, media: PreloadMedia): void {
		if (refs.size() === 0) {
			logInfo(`${LOG} ${label}: nothing uploaded (${media})`);
			return;
		}
		const entries = refs.map((ref) => entryFor(ref, kind));
		const t0 = os.clock();
		const [ok, err] = pcall(() =>
			ContentProvider.PreloadAsync(entries, (contentId, status) =>
				logInfo(`${LOG} ${label} ${contentId} ${status.Name} +${ms(os.clock() - t0)} ms`),
			),
		);
		const wall = os.clock() - t0;
		for (const e of entries) if (typeIs(e, "Instance")) e.Destroy();
		if (!ok) logWarn(`${LOG} ${label}: PreloadAsync raised ${tostring(err)}`);
		logInfo(`${LOG} ${label}: ${refs.size()} entries in ${ms(wall)} ms`);
	}

	/** The first-draw probe: baseline frame times, then the sheet on screen for holdFrames frames. */
	private probe(session: Janitor, sheet: ContentRef): void {
		const gui = session.Add(createKvScreenGui("KV_SpikePreload"));
		gui.ResetOnSpawn = false;
		gui.DisplayOrder = PRELOAD_SPIKE.displayOrder;
		const label = new Instance("ImageLabel");
		label.Size = UDim2.fromOffset(PRELOAD_SPIKE.probeSizePx, PRELOAD_SPIKE.probeSizePx);
		label.BackgroundTransparency = 1;
		label.Parent = gui;
		gui.Parent = Players.LocalPlayer.WaitForChild("PlayerGui");

		const baseline = new Array<number>();
		let last = os.clock();
		let held = 0;
		session.Add(
			RunService.RenderStepped.Connect(() => {
				const now = os.clock();
				const dt = now - last;
				last = now;
				if (baseline.size() < PRELOAD_SPIKE.baselineFrames) {
					baseline.push(dt);
					if (baseline.size() === PRELOAD_SPIKE.baselineFrames) {
						let sum = 0;
						let worst = 0;
						for (const d of baseline) {
							sum += d;
							worst = math.max(worst, d);
						}
						logInfo(
							`${LOG} baseline ${baseline.size()} frames: mean ${ms(sum / baseline.size())} ms, ` +
								`worst ${ms(worst)} ms; showing ${sheet.contentId}`,
						);
						label.Image = sheet.contentId;
					}
					return;
				}
				if (held >= PRELOAD_SPIKE.holdFrames) return;
				held += 1;
				logInfo(`${LOG} probe frame ${held}: ${ms(dt)} ms`);
				if (held === PRELOAD_SPIKE.holdFrames) {
					label.Destroy();
					logInfo(`${LOG} done (set ${SPIKE_ATTRIBUTES.preload} false to clean up)`);
				}
			}),
		);
	}
}

/**
 * The stage loader's pure core (docs/STAGE_LOADER.md SL1, SL4, SL0): the cover shown while a stage (a dungeon floor) is
 * generated and its views are rebuilt, at a run start (Play solo, a restart, the tutorial, a party run) and at every
 * floor change. Presentation only: plain numbers fed by the client's StageController, never a clock, never the sim.
 * Tunables: STAGE_LOADER in stageLoaderConfig.ts; string keys: STAGE_STRINGS in stageStrings.ts.
 *
 *   StageLoad        one cover's step machine. Kinds: "runStart" (solo, incl. the tutorial: the sim is held),
 *                    "coopStart" (a party run: never held, the lockstep keeps stepping) and "floorChange" (the card).
 *                    Phases, in order, skipping those that do not apply:
 *                      waitingServer  a ranked run start: "Starting run..." until `serverAnswered()`
 *                      forging        solo run start: the run (floor 1) is built under the cover ("forge" work)
 *                      building       the run-start / floor-change listeners rebuild the views ("notify" work), then
 *                                     on a run start the next floor(s) are pre-generated ("pregen" work)
 *                      assets         a solo run start's stage manifest (docs/STAGE_ASSETS.md SA5 / SA19:
 *                                     `assetsDone()`, progress through `setAssetProgress`): with stand-ins
 *                                     (`assets.standIns`, revision 2) at most `softWaitSec` ("soft": the rest draws
 *                                     as stand-ins until it lands); without, until `hardCapSec` or a Skip
 *                                     (`skipAssets`, offered after `skipAfterSec`). Floor changes and co-op covers
 *                                     pass it at once ("none": SAD4 / SAD8, the manifest still goes to the front)
 *                      settling       `settleFrames` rendered frames, and the card's / start's minimum time (or
 *                                     longer: `holdAtLeast`, a run start's roster line, docs/DAILY.md DS2)
 *                      revealing      the fade (`fadeSec`; a cut under reduced motion): the sim runs again, the
 *                                     input stays blocked until the cover is gone
 *                      done
 *                    A floor change whose world is live under the card (`worldLive`: no local draft opened) skips the
 *                    card's minimum: the cover lasts the rebuild and the settle frames only.
 *                    Covered work (`due()`) runs one item per frame, and only once the cover was drawn: its commit
 *                    reported (`coverShown()`) and `coverDrawFrames` frames passed since (or `coverAckCapSec` without
 *                    a report). `maxCoverSec` counts from the server's answer (from the cut without one), the assets
 *                    phase excluded: past it the waits are skipped (work still runs, one item per frame) and the
 *                    cover lifts.
 *   stageMerge       what a new cover request does to the current one: "new", "continue" (the server answered the
 *                    waiting run start) or "absorb" (a floor change while the run-start listeners are still pending:
 *                    they read the newest context when they run, so the floor change needs nothing of its own)
 *   floorChangeStaged  whether a floor change gets the card (not the tutorial's ending change past its last floor)
 *   pregenTarget     which floor to pre-generate now (SD1: floor n + 1 once floor n's draft has been open a rendered
 *                    frame, outside covered work and the fade, once per run and floor); PregenTracker keeps the
 *                    per-run bookkeeping (draft frames, floors built) and the run start's targets
 *   listenerLabel / formatListenerTimes  the KV_Debug listener timing line (SL0)
 *
 * @module
 */
import { STAGE_LOADER, type StageLoaderConfig, type StageStep } from "./stageLoaderConfig";
import { STAGE_STRINGS } from "./stageStrings";

/**
 * What a cover is for: `runStart` a solo run start (the tutorial included; the sim is held under it), `coopStart` a
 * party run's start (never held: the lockstep keeps stepping), `floorChange` the card between floors.
 */
export type StageKind = "runStart" | "coopStart" | "floorChange";
/**
 * Where a StageLoad is, in order (phases that do not apply are skipped; see the file comment): waiting for the server,
 * forging the run, rebuilding the views, waiting for assets, settling, fading out, done.
 */
export type StagePhase = "waitingServer" | "forging" | "building" | "assets" | "settling" | "revealing" | "done";
/** Covered work the driver runs when `due()` says so, then reports (forged / built / pregenerated). */
export type StageWorkItem = "forge" | "notify" | "pregen";
/**
 * How the assets wait ended: still waiting (or not reached yet); every asset resolved; the soft wait ran out (stand-ins
 * draw the rest); the player skipped it or a cap lifted it (no stand-ins; or maxCoverSec tripped before it); not waited
 * for (floor changes, co-op).
 */
export type StageAssetWait = "pending" | "ready" | "soft" | "skipped" | "capped" | "none";

/** A theme string key and its vars (`{floor}`). */
export interface StageLabel {
	readonly key: string;
	readonly vars: { readonly floor: number };
}

/**
 * What a new StageLoad is told about its cover besides its kind: which optional phases apply and the floor it loads.
 * Every field is optional; absent means the phase or behaviour is off. Given by the client's StageController.
 */
export interface StageLoadOptions {
	/** A ranked run start: the cover waits for the server's answer first (runStart only). */
	readonly waitServer?: boolean;
	/** Solo run start: the run itself is built under the cover ("forge" work; runStart only). */
	readonly forge?: boolean;
	/** Solo run start: the next floor(s) are pre-generated under the cover after the views ("pregen" work; runStart only). */
	readonly pregen?: boolean;
	/** The floor being loaded: the label's `{floor}` (0: not a numbered floor, e.g. the greybox). */
	readonly floor?: number;
	/**
	 * Floor change only: the world is live under the card (the local player's draft did not open: nothing to offer), so
	 * the cover lasts the view rebuild and the settle frames only: no minimum card time (SD5 kept: no hold on floor
	 * changes; no floor change waits for assets anyway).
	 */
	readonly worldLive?: boolean;
}

const ALL_STEPS: ReadonlyArray<StageStep> = ["server", "forge", "build", "pregen", "assets", "settle"];

/** One cover: see the file comment. Fed `frame(dt)` once per rendered frame and the events below. */
export class StageLoad {
	readonly kind: StageKind;
	private floorNo: number;
	private readonly cfg: StageLoaderConfig;
	private current: StagePhase;
	private readonly forgeWanted: boolean;
	private readonly pregenWanted: boolean;
	private readonly worldLive: boolean;
	private readonly steps = new Set<StageStep>();
	private acked = false;
	private drawnFrames = 0;
	private sinceStartSec = 0;
	private coverSec = 0;
	/** coverSec without the assets phase: what maxCoverSec caps. */
	private capSec = 0;
	private phaseSec = 0;
	private settledFrames = 0;
	private notified = false;
	private pregenDone = false;
	private assetsReady = false;
	private assetWaitEnd: StageAssetWait = "pending";
	private assetsDoneCount = 0;
	private assetsTotal = 0;
	private skipAsked = false;
	private overCap = false;
	private workedThisFrame = false;
	private heldSec = 0;

	constructor(kind: StageKind, options: StageLoadOptions = {}, cfg: StageLoaderConfig = STAGE_LOADER) {
		this.kind = kind;
		this.cfg = cfg;
		this.floorNo = options.floor ?? 0;
		const start = kind === "runStart";
		const waitServer = start && options.waitServer === true;
		this.forgeWanted = start && options.forge === true;
		this.pregenWanted = start && options.pregen === true;
		this.worldLive = kind === "floorChange" && options.worldLive === true;
		if (!waitServer) this.steps.add("server");
		if (!this.forgeWanted) this.steps.add("forge");
		if (!this.pregenWanted) this.steps.add("pregen");
		this.current = waitServer ? "waitingServer" : this.forgeWanted ? "forging" : "building";
	}

	// --- events --------------------------------------------------------------------------------

	/** One rendered frame of `dt` seconds (negative counts as 0): timers, frame counts, then the phase rules. */
	frame(dt: number): void {
		const d = math.max(dt, 0);
		this.workedThisFrame = false;
		this.sinceStartSec += d;
		this.phaseSec += d;
		if (this.current !== "waitingServer") this.coverSec += d;
		if (this.current !== "waitingServer" && this.current !== "assets") this.capSec += d;
		if (this.acked) this.drawnFrames += 1;
		if (this.current === "settling") this.settledFrames += 1;
		if (this.current !== "waitingServer" && this.capSec >= this.cfg.maxCoverSec) this.overCap = true;
		this.advance();
	}

	/**
	 * The cover is on screen from the coming render on (StageController reports it in a render step before the render,
	 * or at the start of the frame after a report from outside one). Idempotent: frames count from the first report.
	 */
	coverShown(): void {
		this.acked = true;
	}

	/**
	 * The ranked run start's answer (or the unranked fallback) arrived: the cover's cap starts counting now. `floor`: the
	 * floor the answer's world starts on (the label's `{floor}`), when known only now.
	 */
	serverAnswered(floor?: number): void {
		if (this.current !== "waitingServer") return;
		if (floor !== undefined) this.floorNo = floor;
		this.steps.add("server");
		this.coverSec = 0;
		this.capSec = 0;
		this.enter(this.forgeWanted ? "forging" : "building");
	}

	/** The "forge" work ran (the solo run and its floor 1 were built). */
	forged(): void {
		if (this.current !== "forging") return;
		this.steps.add("forge");
		this.workedThisFrame = true;
		this.enter("building");
	}

	/** The "notify" work ran (every run-start / floor-change listener rebuilt its view). */
	built(): void {
		if (this.current !== "building" || this.notified) return;
		this.notified = true;
		this.steps.add("build");
		this.workedThisFrame = true;
		this.advance();
	}

	/** The "pregen" work ran (run start: the next floor(s) generated). */
	pregenerated(): void {
		if (this.current !== "building" || !this.notified || this.pregenDone) return;
		this.pregenDone = true;
		this.steps.add("pregen");
		this.workedThisFrame = true;
		this.advance();
	}

	/**
	 * Something worth reading went on the cover (a run start's roster line, docs/DAILY.md DS2): the reveal waits until
	 * the cover has been up at least `sec` seconds (coverSeconds: from the server's answer, from the cut without one),
	 * on top of the settle frames; maxCoverSec still lifts it. Only ever lengthens the minimum; a world live under the
	 * card keeps none.
	 */
	holdAtLeast(sec: number): void {
		this.heldSec = math.max(this.heldSec, sec);
		this.advance();
	}

	/** Every asset the floor waits for resolved (may arrive before the assets phase: it then passes at once). */
	assetsDone(): void {
		this.assetsReady = true;
		if (this.assetsTotal > 0) this.assetsDoneCount = this.assetsTotal;
		this.advance();
	}

	/**
	 * The manifest's progress (content ids resolved, distinct content ids waited for; PreloadController's LoadHandle).
	 * `done` never goes back (a re-fetch under the fake latency) and is clamped to `total`.
	 */
	setAssetProgress(done: number, total: number): void {
		const t = math.max(total, 0);
		this.assetsTotal = t;
		this.assetsDoneCount = math.clamp(math.max(this.assetsDoneCount, done), 0, t);
	}

	/** Without stand-ins: the player asks to stop waiting (honoured once canSkipAssets). */
	skipAssets(): void {
		if (!this.canSkipAssets()) return;
		this.skipAsked = true;
		this.advance();
	}

	// --- queries -------------------------------------------------------------------------------

	phase(): StagePhase {
		return this.current;
	}

	/** The floor being loaded (the label's `{floor}`; 0 for none). */
	floor(): number {
		return this.floorNo;
	}

	isDone(): boolean {
		return this.current === "done";
	}

	/** The work to run now (one item per frame, behind a drawn cover), or undefined. */
	due(): StageWorkItem | undefined {
		if (this.workedThisFrame || !this.coverReady()) return undefined;
		if (this.current === "forging") return "forge";
		if (this.current !== "building") return undefined;
		if (!this.notified) return "notify";
		if (this.pregenWanted && !this.pregenDone) return "pregen";
		return undefined;
	}

	/** The run-start / floor-change listeners have not run yet (a floor change now is absorbed: stageMerge). */
	notifyPending(): boolean {
		return !this.notified && this.current !== "revealing" && this.current !== "done";
	}

	/** Cover opacity in [0, 1]: opaque until the reveal, then the fade (gone at once under reduced motion). */
	coverOpacity(reducedMotion: boolean): number {
		if (this.current === "done") return 0;
		if (this.current !== "revealing") return 1;
		if (reducedMotion || this.cfg.fadeSec <= 0) return 0;
		return math.clamp(1 - this.phaseSec / this.cfg.fadeSec, 0, 1);
	}

	/** The solo sim is held (no tick, no pause menu): a run start until its reveal. Never co-op, never a floor change. */
	holdSim(): boolean {
		return this.kind === "runStart" && this.covering();
	}

	/**
	 * Input goes nowhere (menu-owns-input) until the cover is gone, the fade included (a press while it is still mostly
	 * opaque would confirm a draft nearly blind). Under reduced motion StageController ends the load as the reveal starts.
	 */
	blocksInput(): boolean {
		return this.current !== "done";
	}

	/** The assets wait applies: a solo run start only (docs/STAGE_ASSETS.md SAD4 / SAD8: never a floor change or co-op). */
	waitsForAssets(): boolean {
		return this.kind === "runStart";
	}

	/** [done, total] of the manifest as last reported (setAssetProgress; [total, total] once assetsDone). */
	assetProgress(): [done: number, total: number] {
		return [this.assetsDoneCount, this.assetsTotal];
	}

	/**
	 * The cover shows "Loading {done} / {total}": the assets wait has run `showProgressAfterSec` and something is still
	 * missing (a cached floor never flashes it).
	 */
	showAssetProgress(): boolean {
		return (
			this.current === "assets" &&
			this.waitsForAssets() &&
			!this.assetsReady &&
			this.assetsDoneCount < this.assetsTotal &&
			this.phaseSec >= this.cfg.assets.showProgressAfterSec
		);
	}

	/** Without stand-ins, the wait may be skipped now (it has run `skipAfterSec`). Never with stand-ins (1.5 s cap). */
	canSkipAssets(): boolean {
		const a = this.cfg.assets;
		return !a.standIns && this.current === "assets" && this.waitsForAssets() && this.phaseSec >= a.skipAfterSec;
	}

	/**
	 * The run-start bar in [0, 1]: the weights of the steps done (or not applying), the assets step's share filling with
	 * the manifest's progress while it waits; 1 from the reveal on. Monotonic.
	 */
	fraction(): number {
		if (!this.covering()) return 1;
		let f = 0;
		for (const step of ALL_STEPS) if (this.steps.has(step)) f += this.cfg.weights[step];
		if (this.current === "assets" && this.assetsTotal > 0) {
			f += (this.cfg.weights.assets * this.assetsDoneCount) / this.assetsTotal;
		}
		return math.clamp(f, 0, 1);
	}

	/** The cover's line: "Starting run...", "Forging floor {floor}...", "Building..." or the card's "Floor {floor}". */
	label(): StageLabel {
		const vars = { floor: this.floorNo };
		if (this.current === "waitingServer") return { key: STAGE_STRINGS.starting, vars };
		if (this.kind === "floorChange") return { key: STAGE_STRINGS.floorCard, vars };
		if (this.current === "forging" && this.floorNo > 0) return { key: STAGE_STRINGS.forging, vars };
		return { key: STAGE_STRINGS.building, vars };
	}

	/** Seconds since the cut (the server wait included). */
	elapsedSec(): number {
		return this.sinceStartSec;
	}

	/** Seconds the cover has been up since the server's answer (since the cut without one): what maxCoverSec caps. */
	coverSeconds(): number {
		return this.coverSec;
	}

	/** Seconds in the current phase. */
	phaseSeconds(): number {
		return this.phaseSec;
	}

	/** How the assets wait ended ("pending" until it did). */
	assetWait(): StageAssetWait {
		return this.assetWaitEnd;
	}

	/** maxCoverSec was reached. */
	capped(): boolean {
		return this.overCap;
	}

	// --- rules ---------------------------------------------------------------------------------

	private covering(): boolean {
		return this.current !== "revealing" && this.current !== "done";
	}

	private coverReady(): boolean {
		if (this.overCap) return true;
		if (this.acked && this.drawnFrames >= this.cfg.coverDrawFrames) return true;
		return this.sinceStartSec >= this.cfg.coverAckCapSec;
	}

	/** How the assets phase ends now, or undefined while it waits (see the file comment). */
	private assetsEnd(): StageAssetWait | undefined {
		const a = this.cfg.assets;
		if (!this.waitsForAssets()) return "none";
		if (this.assetsReady) return "ready";
		if (this.overCap) return "capped";
		if (a.standIns) return this.phaseSec >= a.softWaitSec ? "soft" : undefined;
		if (this.skipAsked) return "skipped";
		return this.phaseSec >= a.hardCapSec ? "capped" : undefined;
	}

	private enter(phase: StagePhase): void {
		this.current = phase;
		this.phaseSec = 0;
		this.settledFrames = 0;
		this.advance();
	}

	/** The time / frame / event rules, until the phase is stable. */
	private advance(): void {
		const cfg = this.cfg;
		const c = this.current;
		if (c === "building") {
			if (this.notified && (this.pregenDone || !this.pregenWanted)) this.enter("assets");
		} else if (c === "assets") {
			const ending = this.assetsEnd();
			if (ending !== undefined) {
				this.assetWaitEnd = ending;
				this.steps.add("assets");
				this.enter("settling");
			}
		} else if (c === "settling") {
			const base = this.kind === "floorChange" ? cfg.minCardSec : cfg.minStartSec;
			const minSec = this.worldLive ? 0 : math.max(base, this.heldSec);
			if (this.overCap || (this.settledFrames >= cfg.settleFrames && this.coverSec >= minSec)) {
				this.steps.add("settle");
				this.enter("revealing");
			}
		} else if (c === "revealing") {
			if (this.phaseSec >= cfg.fadeSec) this.enter("done");
		}
	}
}

/** What a new cover request does with the current stage load (see the file comment). */
export type StageMerge = "new" | "continue" | "absorb";

/**
 * What a request for an `incoming` cover does while `current` may still be up (see the file comment): `continue` when a
 * run start arrives for a run start still waiting for the server, `absorb` when a floor change arrives while a start's
 * view rebuild has not run yet (it needs no cover of its own), else `new` (also with no current cover or a finished
 * one).
 */
export function stageMerge(current: StageLoad | undefined, incoming: StageKind): StageMerge {
	if (current === undefined || current.isDone()) return "new";
	if (incoming === "runStart" && current.kind === "runStart" && current.phase() === "waitingServer")
		return "continue";
	if (incoming === "floorChange" && current.kind !== "floorChange" && current.notifyPending()) return "absorb";
	return "new";
}

/**
 * A floor change gets the card, except a tutorial run's change past its last floor (`tutorialLastFloor`): that one
 * ends the tutorial (the run freezes under the outro, docs/TUTORIAL.md), so its views rebuild at once, uncovered.
 */
export function floorChangeStaged(floor: number, tutorial: boolean, tutorialLastFloor: number): boolean {
	return !(tutorial && floor > tutorialLastFloor);
}

/**
 * What `pregenTarget` reads to decide whether to build the next floor now. PregenTracker fills it once per rendered
 * frame.
 */
export interface PregenInput {
	/** The current floor (0: not an endless-style run). */
	readonly floor: number;
	/** The last floor worth building (the tutorial's last floor), or undefined (endless: no end). */
	readonly lastFloor: number | undefined;
	/** The local player's draft is open. */
	readonly draftOpen: boolean;
	/** Rendered frames it has been open on this floor. */
	readonly draftFrames: number;
	/** Floor + 1 was already built this run (pre-generated). */
	readonly nextBuilt: boolean;
	/** The current stage load's phase, or undefined with none. */
	readonly stage: StagePhase | undefined;
}

/**
 * The floor to pre-generate now (SD1), or undefined: floor n + 1 while floor n's draft is open (a frozen world under a
 * menu) once it has been open `pregenAfterDraftFrames` rendered frames, not while covered work is pending or during
 * the fade (a stall there would show), once per floor and run, never past `lastFloor`.
 */
export function pregenTarget(i: PregenInput, cfg: StageLoaderConfig = STAGE_LOADER): number | undefined {
	if (i.floor <= 0 || i.nextBuilt || !i.draftOpen || i.draftFrames < cfg.pregenAfterDraftFrames) return undefined;
	const s = i.stage;
	if (s !== undefined && s !== "assets" && s !== "settling" && s !== "done") return undefined;
	const target = i.floor + 1;
	if (i.lastFloor !== undefined && target > i.lastFloor) return undefined;
	return target;
}

/**
 * Per-run pre-generation bookkeeping (one per run, `lastFloor` as in PregenInput): the run start's targets, the draft's
 * frame count per floor, and which floors were built here (the floor-change log tells pre-generated from mid-tick).
 */
export class PregenTracker {
	private readonly builtFloors = new Set<number>();
	private draftFloor = -1;
	private draftFrames = 0;

	constructor(readonly lastFloor: number | undefined) {}

	/** Run start on `floor`: the floors to build under the cover (endless: the next; the tutorial: up to its last). */
	startTargets(floor: number): Array<number> {
		const out = new Array<number>();
		if (floor <= 0) return out;
		const last = this.lastFloor ?? floor + 1;
		for (let f = floor + 1; f <= last; f++) if (!this.builtFloors.has(f)) out.push(f);
		return out;
	}

	/** One rendered frame on `floor`: counts the draft's frames, then pregenTarget. */
	frame(floor: number, draftOpen: boolean, stage: StagePhase | undefined): number | undefined {
		if (floor !== this.draftFloor) {
			this.draftFloor = floor;
			this.draftFrames = 0;
		}
		if (draftOpen) this.draftFrames += 1;
		return pregenTarget({
			floor,
			lastFloor: this.lastFloor,
			draftOpen,
			draftFrames: this.draftFrames,
			nextBuilt: this.builtFloors.has(floor + 1),
			stage,
		});
	}

	markBuilt(floor: number): void {
		this.builtFloors.add(floor);
	}

	/** `floor` was pre-generated here this run. */
	wasBuilt(floor: number): boolean {
		return this.builtFloors.has(floor);
	}
}

/** A listener's label for the SL0 timing line: its script's name (`debug.info(f, "s")`) without "Controller". */
export function listenerLabel(source: string): string {
	let name = source;
	const parts = source.split(".");
	if (parts.size() > 0) name = parts[parts.size() - 1];
	const suffix = "Controller";
	if (name.size() > suffix.size() && name.sub(-suffix.size()) === suffix) {
		name = name.sub(1, name.size() - suffix.size());
	}
	return name;
}

/**
 * How long one run-start or floor-change listener took, for the KV_Debug timing line (`formatListenerTimes`): its label
 * (`listenerLabel`) and its time in milliseconds.
 */
export interface ListenerTime {
	readonly label: string;
	readonly ms: number;
}

/** "World 38.2 ms, Decor 21.0 ms, ..." in call order (SL0). */
export function formatListenerTimes(times: ReadonlyArray<ListenerTime>): string {
	return times.map((t) => `${t.label} ${string.format("%.1f", t.ms)} ms`).join(", ");
}

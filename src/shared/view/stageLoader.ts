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
 *                      assets         the floor's front-lane assets (`assetsDone()`), at most `assetCapSec`
 *                      settling       `settleFrames` rendered frames, and the card's / start's minimum time (or
 *                                     longer: `holdAtLeast`, a run start's roster line, docs/DAILY.md DS2)
 *                      revealing      the fade (`fadeSec`; a cut under reduced motion): the sim runs again, the
 *                                     input stays blocked until the cover is gone
 *                      done
 *                    A floor change whose world is live under the card (`worldLive`: no local draft opened) skips the
 *                    assets wait and the card's minimum: the cover lasts the rebuild and the settle frames only.
 *                    Covered work (`due()`) runs one item per frame, and only once the cover was drawn: its commit
 *                    reported (`coverShown()`) and `coverDrawFrames` frames passed since (or `coverAckCapSec` without
 *                    a report). `maxCoverSec` counts from the server's answer (from the cut without one): past it the
 *                    waits are skipped (work still runs, one item per frame) and the cover lifts.
 *   stageMerge       what a new cover request does to the current one: "new", "continue" (the server answered the
 *                    waiting run start) or "absorb" (a floor change while the run-start listeners are still pending:
 *                    they read the newest context when they run, so the floor change needs nothing of its own)
 *   floorChangeStaged  whether a floor change gets the card (not the tutorial's ending change past its last floor)
 *   pregenTarget     which floor to pre-generate now (SD1: floor n + 1 once floor n's draft has been open a rendered
 *                    frame, outside covered work and the fade, once per run and floor); PregenTracker keeps the
 *                    per-run bookkeeping (draft frames, floors built) and the run start's targets
 *   listenerLabel / formatListenerTimes  the KV_Debug listener timing line (SL0)
 */
import { STAGE_LOADER, type StageLoaderConfig, type StageStep } from "./stageLoaderConfig";
import { STAGE_STRINGS } from "./stageStrings";

export type StageKind = "runStart" | "coopStart" | "floorChange";
export type StagePhase = "waitingServer" | "forging" | "building" | "assets" | "settling" | "revealing" | "done";
/** Covered work the driver runs when `due()` says so, then reports (forged / built / pregenerated). */
export type StageWorkItem = "forge" | "notify" | "pregen";
/** How the assets wait ended: still waiting (or not reached yet), every asset resolved, the cap, or not waited for. */
export type StageAssetWait = "pending" | "ready" | "capped" | "skipped";

/** A theme string key and its vars (`{floor}`). */
export interface StageLabel {
	readonly key: string;
	readonly vars: { readonly floor: number };
}

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
	 * the cover lasts the view rebuild and the settle frames only: no assets wait, no minimum card time (SD5 kept: no
	 * hold on floor changes).
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
	private phaseSec = 0;
	private settledFrames = 0;
	private notified = false;
	private pregenDone = false;
	private assetsReady = false;
	private assetWaitEnd: StageAssetWait = "pending";
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
		if (this.acked) this.drawnFrames += 1;
		if (this.current === "settling") this.settledFrames += 1;
		if (this.current !== "waitingServer" && this.coverSec >= this.cfg.maxCoverSec) this.overCap = true;
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

	/** The assets wait applies (not a floor change whose world is live under the card). */
	waitsForAssets(): boolean {
		return !this.worldLive;
	}

	/** The run-start bar in [0, 1]: the weights of the steps done (or not applying); 1 from the reveal on. Monotonic. */
	fraction(): number {
		if (!this.covering()) return 1;
		let f = 0;
		for (const step of ALL_STEPS) if (this.steps.has(step)) f += this.cfg.weights[step];
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
			if (this.worldLive) {
				this.assetWaitEnd = "skipped";
				this.steps.add("assets");
				this.enter("settling");
			} else if (this.assetsReady) {
				this.assetWaitEnd = "ready";
				this.steps.add("assets");
				this.enter("settling");
			} else if (this.overCap || this.phaseSec >= cfg.assetCapSec) {
				this.assetWaitEnd = "capped";
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

export interface ListenerTime {
	readonly label: string;
	readonly ms: number;
}

/** "World 38.2 ms, Decor 21.0 ms, ..." in call order (SL0). */
export function formatListenerTimes(times: ReadonlyArray<ListenerTime>): string {
	return times.map((t) => `${t.label} ${string.format("%.1f", t.ms)} ms`).join(", ");
}

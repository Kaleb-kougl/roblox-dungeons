/**
 * TutorialDirector (docs/TUTORIAL.md "Architecture §3"; a Roblox-port feature, no web source): the tutorial script's
 * pure state machine. The client calls `update(frame)` once per rendered frame, after the frame's sim ticks, with the
 * live sim state (read only), the frame's accumulated events (LiveRun.frameEvents), the raw input buttons sampled for
 * the frame and its real delta; it returns the TutorialView the HUD, the marker and the funnel read. It never writes
 * the sim, and for a given frame sequence it always produces the same views (no clock, no randomness).
 *
 * What it reads, per frame (state wherever the state keeps the fact, so a frame that ran several ticks, or none,
 * loses nothing; events only for the three acts the state does not count):
 *   state.endless     floor, Depth (the boss kill), roomsEntered (a lesson room entered: its prompt shows)
 *   state.score       per-room clear records (room cleared), per-source award counts (kills, grazes, guard cancels)
 *   state.run         relics, curses and boons owned; the shrine zone (atShrine)
 *   state.tutorial    harmlessHits (the harmless-hit callout and the ghost half heart); the guard lock (the block
 *                     lesson's hold prompt while its bruiser waits at 1 hp, and the `guard` skill once released); the
 *                     pellet lock (the pellet lesson's hold prompt while its sniper waits at 1 hp for the last pellets,
 *                     and the `sweep` skill once released; docs/PELLETS.md PL13)
 *   state.combat      the weapon set in hand (the bow), the bow slot's heavy-arrow tick, the boss actor
 *   state.drops       the ground drops and the player's running boosts (docs/BOOSTS.md B9: the `boost` step, done
 *                     when combat B's guaranteed Fury is picked up or waived when it fades, its `drop` marker, and the
 *                     boost row's ring on the pickup)
 *   events            flaskUsed, rollStarted, emberUsed
 *   buttons           the FIRE press edge (the objective card's Continue), like the draft's confirm
 *   mapSeen /         client facts (docs/TUTORIAL_MAP.md §2): the full map was seen this frame (flow.ts tutorialMapSeen)
 *   mapAvailable      and the full map can be shown at all; the `map` step's rule. The map is not a sim button
 *
 * Steps (steps.ts TUTORIAL_STEPS) latch done the first frame their rule holds, in any order; a lesson-room step can
 * only complete once its room has been entered, and its skills count from that frame. The CURRENT step is the lowest
 * unfinished one: the marker points at it and the progress dots count up to it; the funnel counts the leading steps
 * practised (done, not skipped), so it stops at the first skipped step. The PROMPT is the current
 * step's, except inside an entered, unfinished lesson room (that lesson's: lessons hold up out of order) and before a
 * lesson room is entered (the follow-the-marker prompt). The `boost` step also holds up out of order: while a drop
 * lies and it is open but not current, its prompt and `drop` marker show (outside an entered, unfinished lesson room;
 * never under the objective card). A step still unfinished when the run leaves its floor is marked skipped, except
 * the `map` step (docs/TUTORIAL_MAP.md TMD3): it is WAIVED (done, not skipped, TutorialView.waived) when floor 1 is left
 * unopened, or while it is current with the map unavailable, so the funnel keeps counting the later steps. Its
 * `next` marker borrows the marker of the next open lesson (TMD4); it has no lesson room, so its prompt shows while it
 * is current outside an entered, unfinished lesson room. A step's rule sees it as current when every step before it
 * is done, counting the ones latched earlier in the same frame (so the map waives on the frame combat F completes
 * when it is unavailable, never showing its prompt). The tutorial is finished on the floor TUTORIAL.lastFloor ->
 * lastFloor + 1 change (step `finish`); anything still open then is skipped too.
 *
 * Metrics (docs/TUTORIAL_FUNNEL.md §5): every update() ends by feeding its TutorialMetrics (metrics.ts: the lesson
 * clock and the stuck episode are defined there) the frame and the resolved view; the frame's reports land in
 * newLessonReports / newStuckReports, and flushMetrics() ends an open stuck episode before a skip.
 *
 * The view object is reused: update() mutates and returns the same TutorialView (and its arrays) every frame. Copy
 * what you keep; `revision` grows whenever anything but the marker's position changed (push to Reflex on change).
 */
import { TUTORIAL } from "shared/config";
import { tutorialRoom, type TutorialRoom } from "shared/run";
import {
	BOOST_COUNT,
	BOW,
	BOW_V_HEAVY_TICK,
	Button,
	ENDLESS_FIRST_DEPTH,
	NO_BOOST,
	NO_KIND,
	SOLO_PLAYER,
	ScoreSource,
	archetypeAt,
	atShrine,
	boostTicksLeft,
	dropsGround,
	isTutorialGuardHolding,
	isTutorialGuardReleased,
	isTutorialPelletHolding,
	isTutorialPelletReleased,
	weaponIndex,
	weaponsAt,
	type ActorState,
	type EndlessFloorWorld,
	type SimConfig,
	type SimEvents,
	type SimState,
} from "shared/sim";
import {
	TUTORIAL_BOOST_HIGHLIGHT,
	TUTORIAL_CALLOUTS,
	TUTORIAL_FOLLOW_PROMPT,
	TUTORIAL_STEPS,
	type TutorialCallout,
	type TutorialHighlight,
	type TutorialMarkerKind,
	type TutorialSkill,
	type TutorialStep,
} from "./steps";
import {
	TutorialMetrics,
	type TutorialLessonReport,
	type TutorialMetricsOptions,
	type TutorialStuckReport,
} from "./metrics";

/** One rendered frame, as the director sees it. */
export interface TutorialFrame {
	/** The live sim state after this frame's ticks. Read only. */
	readonly state: Readonly<SimState>;
	/** The run's SimConfig (buildTutorialRunConfig().config): the floor worlds (stairwell, rooms, shrine zone). */
	readonly config: Readonly<SimConfig>;
	/** The frame's accumulated sim events (LiveRun.frameEvents; all defaults on a frame that ran no tick). */
	readonly events: Readonly<Pick<SimEvents, "flaskUsed" | "rollStarted" | "emberUsed">>;
	/** InputFrame.buttons sampled for this frame (raw, before any masking): the FIRE edge for Continue. */
	readonly buttons: number;
	/** Real seconds since the previous frame (card and highlight timers). */
	readonly dt: number;
	/**
	 * The full map was seen this frame (docs/TUTORIAL_MAP.md §3, flow.ts tutorialMapSeen: the full map open; on touch
	 * also the solo pause overlay's map, latched by the client while paused and handed over on the next update). The
	 * `map` step's rule.
	 */
	readonly mapSeen: boolean;
	/**
	 * The full map can be shown (the client's Reflex `game.map.available`: false until the floor's map image exists,
	 * and where it cannot be created). While false, a current `map` step is waived instead of asking for the
	 * impossible.
	 */
	readonly mapAvailable: boolean;
}

/** The world marker, resolved. */
export interface TutorialMarker {
	readonly kind: TutorialMarkerKind;
	/** World XZ of the target. */
	readonly x: number;
	readonly z: number;
}

/** What the HUD, the marker and the funnel read. Reused and mutated by every update() (see the file comment). */
export interface TutorialView {
	/** False once finished. */
	active: boolean;
	/** The floor 2 -> 3 change happened (step `finish`): stop the run, show the outro, send tutorialFinished. */
	finished: boolean;
	/** The current step (lowest unfinished), 0-based; stepCount once finished. */
	stepIndex: number;
	stepCount: number;
	/** The current step's id ("" once finished). */
	stepId: string;
	/** The step whose prompt shows (stepIndex, an out-of-order lesson room's step, or the waiting `boost` step); -1 none. */
	promptStepIndex: number;
	/** The prompt id to show ("" none): theme key tutorialPromptKey(prompt, device). */
	prompt: string;
	/** The objective card is up (Continue = FIRE). */
	card: "objective" | undefined;
	/** The HUD element to ring now (a fresh callout's, else the prompt step's), or undefined. */
	highlight: TutorialHighlight | undefined;
	/** Where the world marker points (the current step's target; the out-of-order `boost` step's drop), or undefined. */
	marker: TutorialMarker | undefined;
	/** Per step (TUTORIAL_STEPS order): done (practised, waived or skipped), and skipped (left behind unfinished). */
	readonly done: boolean[];
	readonly skipped: boolean[];
	/**
	 * Per step: waived (done by its rule without being practised: the `map` step left unopened on a floor change or
	 * unavailable while current, docs/TUTORIAL_MAP.md TMD3). Never skipped, so the funnel counts past it; no lesson
	 * report (metrics.ts). The `boost` fade and the `ember` none-left waivers do not set it.
	 */
	readonly waived: boolean[];
	/** Steps done (progress dots). */
	stepsDone: number;
	/** Callout string keys that fired this frame, in order (toasts). */
	readonly callouts: string[];
	/** A harmless hit landed this frame and is among the first TUTORIAL.ghostHeartHits: flash the ghost half heart. */
	ghostHeart: boolean;
	/**
	 * Funnel: leading steps practised, i.e. done and not skipped (the highest step number the player has reached; 0
	 * none). Stops at the first skipped step for good. Never decreases.
	 */
	funnelStepReached: number;
	/** Funnel step numbers newly reached this frame, ascending (send each as tutorialStep). */
	readonly newFunnelSteps: number[];
	/**
	 * Metrics (metrics.ts): lessons that latched done and practised this frame, each once per run, with the seconds
	 * their clock ran and the harmless hits meanwhile (send each as tutorialLesson). Not counted in `revision`: read
	 * it every update.
	 */
	readonly newLessonReports: TutorialLessonReport[];
	/** Metrics: stuck episodes (>= TUTORIAL.stuckSeconds on one prompt, no progress) that ended this frame. Not in `revision`. */
	readonly newStuckReports: TutorialStuckReport[];
	/** Grows whenever any field other than the marker's x / z (and the metrics reports) changed. */
	revision: number;
}

/** TutorialDirector construction options (all optional; defaults are the game's). */
export type TutorialDirectorOptions = TutorialMetricsOptions;

/** Per-step progress (lesson baselines are taken the frame the room is first seen entered). */
interface StepProgress {
	entered: boolean;
	rolled: boolean;
	guardBase: number;
	guarded: boolean;
	sawBow: boolean;
	heavyBase: number;
	heavy: boolean;
	embered: boolean;
	/** Skill `sweep`: the score's SWEEP count when the room was entered, and a Sweep counted since. */
	sweepBase: number;
	swept: boolean;
	relicsBase: number;
	cursesBase: number;
	sawShrine: boolean;
	/** Rule `boost`: a drop has been seen lying on the step's floor. */
	sawDrop: boolean;
}

function newProgress(): StepProgress {
	return {
		entered: false,
		rolled: false,
		guardBase: 0,
		guarded: false,
		sawBow: false,
		heavyBase: 0,
		heavy: false,
		embered: false,
		sweepBase: 0,
		swept: false,
		relicsBase: 0,
		cursesBase: 0,
		sawShrine: false,
		sawDrop: false,
	};
}

/** The tutorial's first floor (the lesson rooms). */
const FLOOR_1 = 1;

function scoreCount(state: Readonly<SimState>, source: number): number {
	return state.score?.counts[source] ?? 0;
}

function bossOf(state: Readonly<SimState>): ActorState | undefined {
	for (const a of state.combat.actors) if (a.kind !== NO_KIND && archetypeAt(a.kind).data.boss === true) return a;
	return undefined;
}

/** True while any boost runs on the (solo) player. */
function boostRunning(state: Readonly<SimState>): boolean {
	for (let k = 0; k < BOOST_COUNT; k++) if (boostTicksLeft(state, SOLO_PLAYER, k) > 0) return true;
	return false;
}

/** The ground drop nearest the player (lowest slot on a tie), or undefined when none lies on the floor. */
function nearestDrop(state: Readonly<SimState>): { x: number; z: number } | undefined {
	const p = state.player;
	let best: { x: number; z: number } | undefined;
	let bestD = math.huge;
	for (const g of dropsGround(state)) {
		if (g.kind === NO_BOOST) continue;
		const dx = g.x - p.x;
		const dz = g.z - p.z;
		const d = dx * dx + dz * dz;
		if (d < bestD) {
			bestD = d;
			best = g;
		}
	}
	return best;
}

export class TutorialDirector {
	private readonly view: TutorialView;
	private readonly progress: StepProgress[] = [];
	/** Each step's floor-1 room (undefined for steps without a lesson room). */
	private readonly rooms = new Map<number, TutorialRoom>();
	private readonly firedCallouts = new Set<string>();
	private readonly bowIndex = weaponIndex(BOW.id);
	private prevButtons = 0;
	private cardSeconds = 0;
	private walked = 0;
	private lastX: number | undefined;
	private lastZ = 0;
	private lastFloor = 0;
	private lastHarmless = 0;
	private highlightSeconds = 0;
	private calloutHighlight: TutorialHighlight | undefined;
	/** The boost row's pickup ring (TUTORIAL_BOOST_HIGHLIGHT) has been rung (once per tutorial). */
	private boostRung = false;
	private sig = "";
	private readonly metrics: TutorialMetrics;

	constructor(options: TutorialDirectorOptions = {}) {
		this.metrics = new TutorialMetrics(options);
		const n = TUTORIAL_STEPS.size();
		const done: boolean[] = [];
		const skipped: boolean[] = [];
		const waived: boolean[] = [];
		for (let i = 0; i < n; i++) {
			const s = TUTORIAL_STEPS[i];
			this.progress.push(newProgress());
			if (s.lesson !== undefined) this.rooms.set(i, tutorialRoom(s.lesson));
			done.push(false);
			skipped.push(false);
			waived.push(false);
		}
		this.view = {
			active: true,
			finished: false,
			stepIndex: 0,
			stepCount: n,
			stepId: TUTORIAL_STEPS[0].id,
			promptStepIndex: 0,
			prompt: TUTORIAL_STEPS[0].prompt,
			card: TUTORIAL_STEPS[0].card,
			highlight: undefined,
			marker: undefined,
			done,
			skipped,
			waived,
			stepsDone: 0,
			callouts: [],
			ghostHeart: false,
			funnelStepReached: 0,
			newFunnelSteps: [],
			newLessonReports: this.metrics.newLessonReports,
			newStuckReports: this.metrics.newStuckReports,
			revision: 0,
		};
	}

	/** The last view (as update() returned it). */
	getView(): Readonly<TutorialView> {
		return this.view;
	}

	/** One rendered frame (see the file comment). Returns the reused view. */
	update(frame: TutorialFrame): TutorialView {
		const v = this.view;
		v.callouts.clear();
		v.newFunnelSteps.clear();
		v.ghostHeart = false;
		const state = frame.state;
		const floor = state.endless?.floor ?? FLOOR_1;
		const fireEdge =
			bit32.band(frame.buttons, Button.FIRE) !== 0 && bit32.band(this.prevButtons, Button.FIRE) === 0;
		this.prevButtons = frame.buttons;
		this.trackWalk(state, floor);

		if (!v.finished) {
			const world = frame.config.endless?.worldForFloor(floor);
			const n = TUTORIAL_STEPS.size();
			// Current for its rule: every step before it done (those latched earlier in this loop included).
			let lowestOpen = true;
			for (let i = 0; i < n; i++) {
				if (v.done[i]) continue;
				const step = TUTORIAL_STEPS[i];
				// The rule first, so a rule that waives on a floor change (`map`) wins over the generic skip.
				if (this.evaluate(i, step, frame, floor, world, fireEdge, lowestOpen)) {
					v.done[i] = true;
				} else if (floor > step.floor) {
					v.done[i] = true;
					v.skipped[i] = true;
				}
				if (!v.done[i]) lowestOpen = false;
			}
			if (floor > TUTORIAL.lastFloor) this.finish();
			this.fireCallouts(state, frame.dt);
		}
		this.resolve(frame, floor);
		this.metrics.update(frame, v);
		return v;
	}

	/**
	 * Ends the open stuck episode (metrics.ts) and returns its report when it lasted >= TUTORIAL.stuckSeconds and its
	 * prompt has not reported yet; else an empty list. The client calls it right before a skip (the finish needs no
	 * flush: its frame clears the prompt, which ends the episode in that update's newStuckReports).
	 */
	flushMetrics(): TutorialStuckReport[] {
		return this.metrics.flush();
	}

	// --- steps ------------------------------------------------------------------------------

	private trackWalk(state: Readonly<SimState>, floor: number): void {
		const p = state.player;
		if (this.lastX !== undefined && floor === this.lastFloor) {
			const dx = p.x - this.lastX;
			const dz = p.z - this.lastZ;
			this.walked += math.sqrt(dx * dx + dz * dz);
		}
		this.lastX = p.x;
		this.lastZ = p.z;
		this.lastFloor = floor;
	}

	/** True when lesson room `room` is entered (floor 1 only; the entrance-less steps never ask). */
	private roomEntered(state: Readonly<SimState>, room: TutorialRoom, floor: number): boolean {
		return floor === FLOOR_1 && (state.endless?.roomsEntered[room.roomId] ?? 0) !== 0;
	}

	private roomCleared(state: Readonly<SimState>, room: TutorialRoom, floor: number): boolean {
		if (floor !== FLOOR_1) return false;
		const rooms = state.score?.rooms;
		if (rooms === undefined) return false;
		for (const r of rooms) if (r.room === room.roomId) return r.cleared !== 0;
		return false;
	}

	/** The bow slot's heavy-arrow tick (0 none), or 0 without a bow. */
	private heavyTick(state: Readonly<SimState>): number {
		for (const set of weaponsAt(state, SOLO_PLAYER).sets) {
			if (set.weapon === this.bowIndex) return set.v[BOW_V_HEAVY_TICK];
		}
		return 0;
	}

	/**
	 * docs/ARCHER.md AR4 (a bridge until AR6 removes the bow lesson): the tutorial is the Knight, who carries no bow, so
	 * the `bow` / `heavyArrow` skills are waived (done) for a player without one. With a bow carried, as before.
	 */
	private carriesBow(state: Readonly<SimState>): boolean {
		for (const set of weaponsAt(state, SOLO_PLAYER).sets) if (set.weapon === this.bowIndex) return true;
		return false;
	}

	private bowInHand(state: Readonly<SimState>): boolean {
		const w = weaponsAt(state, SOLO_PLAYER);
		return w.sets[w.activeSet]?.weapon === this.bowIndex;
	}

	/** Lesson baselines on the frame the room is first seen entered, then per-frame skill tracking. */
	private trackLesson(i: number, frame: TutorialFrame): void {
		const pr = this.progress[i];
		const state = frame.state;
		const me = state.run?.players[SOLO_PLAYER];
		if (!pr.entered) {
			pr.entered = true;
			pr.guardBase = scoreCount(state, ScoreSource.GUARD);
			pr.sweepBase = scoreCount(state, ScoreSource.SWEEP);
			pr.heavyBase = this.heavyTick(state);
			pr.relicsBase = me?.relics.size() ?? 0;
			pr.cursesBase = me?.curses.size() ?? 0;
		}
		const e = frame.events;
		if (e.rollStarted > 0) pr.rolled = true;
		if (e.emberUsed > 0) pr.embered = true;
		if (scoreCount(state, ScoreSource.GUARD) > pr.guardBase) pr.guarded = true;
		if (scoreCount(state, ScoreSource.SWEEP) > pr.sweepBase) pr.swept = true;
		if (this.bowInHand(state)) pr.sawBow = true;
		if (this.heavyTick(state) !== pr.heavyBase) pr.heavy = true;
	}

	private skillDone(pr: StepProgress, skill: TutorialSkill, state: Readonly<SimState>, cleared: boolean): boolean {
		switch (skill) {
			case "roll":
				return pr.rolled;
			case "guard":
				// Never waived: the sim holds the room's enemies until a block (guard lock), so it cannot clear without.
				return pr.guarded || isTutorialGuardReleased(state);
			case "bow":
				return pr.sawBow || !this.carriesBow(state);
			case "heavyArrow":
				return pr.heavy || !this.carriesBow(state);
			case "ember":
				return pr.embered || (cleared && state.player.embers === 0); // none left to burn
			case "sweep":
				// Never waived: the sim holds the room's enemies until its last pellet is taken (pellet lock).
				return pr.swept || isTutorialPelletReleased(state);
		}
	}

	/**
	 * True while the sim holds `step`'s lesson enemies at 1 hp (its holdPrompt shows): the block lesson's guard lock
	 * (a `guard` skill) or the pellet lesson's sweep lock (a `sweep` skill).
	 */
	private holding(step: TutorialStep, state: Readonly<SimState>): boolean {
		const rule = step.rule;
		if (rule.kind !== "clear") return false;
		if (rule.skills.includes("guard") && isTutorialGuardHolding(state)) return true;
		return rule.skills.includes("sweep") && isTutorialPelletHolding(state);
	}

	private evaluate(
		i: number,
		step: TutorialStep,
		frame: TutorialFrame,
		floor: number,
		world: Readonly<EndlessFloorWorld> | undefined,
		fireEdge: boolean,
		current: boolean,
	): boolean {
		const state = frame.state;
		const rule = step.rule;
		const room = this.rooms.get(i);
		if (room !== undefined) {
			if (!this.progress[i].entered && !this.roomEntered(state, room, floor)) {
				return rule.kind === "floor" && floor >= rule.floor;
			}
			this.trackLesson(i, frame);
		}
		const pr = this.progress[i];
		const me = state.run?.players[SOLO_PLAYER];
		switch (rule.kind) {
			case "objective": {
				if (!current) return false;
				this.cardSeconds += frame.dt;
				return fireEdge && this.cardSeconds >= TUTORIAL.objectiveCardMinSeconds;
			}
			case "move":
				return this.walked >= TUTORIAL.moveTiles;
			case "flask":
				return frame.events.flaskUsed > 0;
			case "clear": {
				if (room === undefined) return false;
				const cleared = this.roomCleared(state, room, floor);
				if (!cleared) return false;
				for (const skill of rule.skills) if (!this.skillDone(pr, skill, state, cleared)) return false;
				return true;
			}
			case "relic":
				return me !== undefined && me.relics.size() > pr.relicsBase;
			case "curse": {
				if (me !== undefined && me.curses.size() > pr.cursesBase) return true;
				const inZone = world !== undefined && floor === FLOOR_1 && atShrine(state, frame.config, SOLO_PLAYER);
				if (inZone) pr.sawShrine = true;
				return pr.sawShrine && !inZone;
			}
			case "floor":
				return floor >= rule.floor;
			case "boon":
				return floor >= step.floor && me !== undefined && me.boons.size() > 0 && me.draftOpen === 0;
			case "boss":
				return floor >= step.floor && (state.endless?.depth ?? ENDLESS_FIRST_DEPTH) > ENDLESS_FIRST_DEPTH;
			case "boost": {
				if (boostRunning(state)) return true; // picked up (on its landing frame too)
				if (floor !== step.floor) return false; // a floor change clears the ground: left behind, not faded
				const lying = nearestDrop(state) !== undefined;
				if (lying) pr.sawDrop = true;
				return pr.sawDrop && !lying; // faded untaken: waived
			}
			case "map": {
				if (frame.mapSeen) return true;
				// Left behind unopened, or nothing to open while it is the lesson: waived (done, never skipped).
				if (floor > step.floor || (current && !frame.mapAvailable)) {
					this.view.waived[i] = true;
					return true;
				}
				return false;
			}
		}
	}

	private finish(): void {
		const v = this.view;
		v.finished = true;
		v.active = false;
		for (let i = 0; i < v.done.size(); i++) {
			if (!v.done[i]) {
				v.done[i] = true;
				v.skipped[i] = true;
			}
		}
	}

	// --- callouts ---------------------------------------------------------------------------

	private calloutDue(c: TutorialCallout, state: Readonly<SimState>): boolean {
		const t = c.trigger;
		switch (t.kind) {
			case "firstKill":
				return scoreCount(state, ScoreSource.KILLS) + scoreCount(state, ScoreSource.BOSS) > 0;
			case "harmlessHit":
				return (state.tutorial?.harmlessHits ?? 0) > 0;
			case "graze":
				return scoreCount(state, ScoreSource.GRAZES) > 0;
			case "bossPhase": {
				const boss = bossOf(state);
				return boss !== undefined && boss.phase >= t.phase;
			}
		}
	}

	private fireCallouts(state: Readonly<SimState>, dt: number): void {
		const v = this.view;
		if (this.highlightSeconds > 0) {
			this.highlightSeconds -= dt;
			if (this.highlightSeconds <= 0) this.calloutHighlight = undefined;
		}
		for (const c of TUTORIAL_CALLOUTS) {
			if (this.firedCallouts.has(c.id) || !this.calloutDue(c, state)) continue;
			this.firedCallouts.add(c.id);
			v.callouts.push(c.key);
			if (c.highlight !== undefined) {
				this.calloutHighlight = c.highlight;
				this.highlightSeconds = TUTORIAL.calloutHighlightSeconds;
			}
		}
		// The pickup (the `boost` step done): ring the boost row, over any callout fired on the same frame.
		if (!this.boostRung && boostRunning(state)) {
			this.boostRung = true;
			this.calloutHighlight = TUTORIAL_BOOST_HIGHLIGHT;
			this.highlightSeconds = TUTORIAL.calloutHighlightSeconds;
		}
		const harmless = state.tutorial?.harmlessHits ?? 0;
		if (harmless > this.lastHarmless && this.lastHarmless < TUTORIAL.ghostHeartHits) v.ghostHeart = true;
		this.lastHarmless = harmless;
	}

	// --- the view ---------------------------------------------------------------------------

	/** The not-done lesson step whose entered room the player stands in, or -1. */
	private lessonHere(frame: TutorialFrame, floor: number, world: Readonly<EndlessFloorWorld> | undefined): number {
		if (floor !== FLOOR_1 || world === undefined) return -1;
		const p = frame.state.player;
		const id = world.roomIdAt(p.x, p.z);
		if (id < 0) return -1;
		const v = this.view;
		for (let i = 0; i < TUTORIAL_STEPS.size(); i++) {
			const room = this.rooms.get(i);
			if (!v.done[i] && room !== undefined && room.roomId === id && this.progress[i].entered) return i;
		}
		return -1;
	}

	/** An open `drop`-marker step after `current` while a drop lies (it holds up out of order), or -1. */
	private dropStepWaiting(current: number, state: Readonly<SimState>): number {
		const v = this.view;
		for (let i = current + 1; i < TUTORIAL_STEPS.size(); i++) {
			if (!v.done[i] && TUTORIAL_STEPS[i].marker.kind === "drop")
				return nearestDrop(state) !== undefined ? i : -1;
		}
		return -1;
	}

	private resolve(frame: TutorialFrame, floor: number): void {
		const v = this.view;
		const n = TUTORIAL_STEPS.size();
		let current = 0;
		while (current < n && v.done[current]) current++;
		let stepsDone = 0;
		for (let i = 0; i < n; i++) if (v.done[i]) stepsDone++;
		v.stepsDone = stepsDone;
		// Funnel: leading steps practised (done and not skipped). It stops for good at the first skipped step: a skip
		// never credits a lesson, and later completions never jump past it (done / skipped only ever latch on).
		let practised = 0;
		while (practised < n && v.done[practised] && !v.skipped[practised]) practised++;
		while (v.funnelStepReached < practised) {
			v.funnelStepReached++;
			v.newFunnelSteps.push(v.funnelStepReached);
		}
		v.stepIndex = current;
		const world = frame.config.endless?.worldForFloor(floor);
		if (current >= n || v.finished) {
			v.stepId = "";
			v.promptStepIndex = -1;
			v.prompt = "";
			v.card = undefined;
			v.highlight = undefined;
			v.marker = undefined;
		} else {
			const step = TUTORIAL_STEPS[current];
			v.stepId = step.id;
			v.card = step.card;
			let shown = current;
			let marked = current;
			let prompt = step.prompt;
			if (step.card === undefined) {
				const here = this.lessonHere(frame, floor, world);
				const waiting = here < 0 ? this.dropStepWaiting(current, frame.state) : -1;
				if (here >= 0) {
					shown = here;
					prompt = TUTORIAL_STEPS[here].prompt;
				} else if (waiting >= 0) {
					// The boost step out of order (an earlier step still open when combat B's Fury landed): its prompt
					// and its marker on the drop until it is taken or fades. Mid-lesson the fight keeps its own.
					shown = waiting;
					marked = waiting;
					prompt = TUTORIAL_STEPS[waiting].prompt;
				} else if (step.lesson !== undefined && !this.progress[current].entered && !step.promptBeforeEntry) {
					prompt = TUTORIAL_FOLLOW_PROMPT;
				}
			}
			// The block lesson's bruiser (or the pellet lesson's sniper) held at 1 hp: say why it will not fall.
			const hold = TUTORIAL_STEPS[shown].holdPrompt;
			if (
				hold !== undefined &&
				prompt === TUTORIAL_STEPS[shown].prompt &&
				this.holding(TUTORIAL_STEPS[shown], frame.state)
			) {
				prompt = hold;
			}
			v.promptStepIndex = shown;
			v.prompt = prompt;
			v.highlight =
				this.calloutHighlight ??
				(prompt !== TUTORIAL_FOLLOW_PROMPT ? TUTORIAL_STEPS[shown].highlight : undefined);
			v.marker = this.markerFor(marked, frame, floor, world);
		}
		const sig = `${v.stepIndex}|${v.promptStepIndex}|${v.prompt}|${v.card}|${v.highlight}|${v.marker?.kind}|${v.stepsDone}|${v.finished}`;
		if (sig !== this.sig || v.callouts.size() > 0 || v.newFunnelSteps.size() > 0 || v.ghostHeart) {
			this.sig = sig;
			v.revision++;
		}
	}

	private markerFor(
		i: number,
		frame: TutorialFrame,
		floor: number,
		world: Readonly<EndlessFloorWorld> | undefined,
	): TutorialMarker | undefined {
		const step = TUTORIAL_STEPS[i];
		const kind = step.marker.kind;
		if (kind === "none") return undefined;
		if (kind === "next") {
			// The next open step with a marker of its own, resolved as for that step (docs/TUTORIAL_MAP.md TMD4).
			const v = this.view;
			for (let j = i + 1; j < TUTORIAL_STEPS.size(); j++) {
				const k = TUTORIAL_STEPS[j].marker.kind;
				if (v.done[j] || k === "none" || k === "next") continue;
				return this.markerFor(j, frame, floor, world);
			}
			return undefined;
		}
		if (kind === "drop") {
			const drop = nearestDrop(frame.state);
			return drop !== undefined ? { kind, x: drop.x, z: drop.z } : undefined;
		}
		const room = this.rooms.get(i);
		const entered = this.progress[i].entered;
		if (room !== undefined && floor === FLOOR_1) {
			if (!entered) return { kind, x: room.door.x, z: room.door.z };
			if (kind === "door") {
				const p = frame.state.player;
				const inside = world !== undefined && world.roomIdAt(p.x, p.z) === room.roomId;
				return inside ? undefined : { kind, x: room.center.x, z: room.center.z };
			}
			if (kind === "stairwell" && world !== undefined) return { kind, x: world.stairX, z: world.stairZ };
			return { kind, x: room.center.x, z: room.center.z };
		}
		if (kind === "boss") {
			const boss = bossOf(frame.state);
			if (boss !== undefined && boss.alive !== 0) return { kind, x: boss.x, z: boss.z };
		}
		if (world === undefined) return undefined;
		return { kind, x: world.stairX, z: world.stairZ };
	}
}

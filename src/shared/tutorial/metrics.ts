/**
 * TutorialMetrics (docs/TUTORIAL_FUNNEL.md §5, task TF4; a Roblox-port feature, no web source): per-lesson time and
 * harmless hits, and "stuck" episodes, measured from the frames the TutorialDirector sees. Pure: no clock, no
 * randomness; for a given frame sequence it always reports the same numbers. The director owns one and feeds it at
 * the end of every update(), after the view is resolved (the director is never updated while the game is paused, so
 * a pause adds nothing; a frame with dt 0 adds no time either).
 *
 * Attribution. A frame's dt (and the harmless hits its ticks landed) is the time the player spent looking at the
 * PREVIOUS frame's view, so it is charged to what that view showed (before the first frame: the constructor's view,
 * the objective card). Then this frame's newly done steps report, and the new view becomes what the next frame's dt
 * is charged to.
 *
 * Lesson clock. Step i's clock runs on a frame when, in the view the frame is charged to, step i was the current step
 * (`stepIndex`, the lowest unfinished one) OR the step whose prompt was shown (`promptStepIndex`: an out-of-order
 * lesson room the player stands in, or the waiting `boost` step). Both may run on one frame (each gets the dt and the
 * hits). No clock runs under the objective card but `objective`'s: the card is up exactly while `objective` is
 * current, and it is then also the prompt step. No clock runs once the tutorial finished. A step's report:
 *   step     its funnel number (TUTORIAL_STEPS number, 1..TUTORIAL_STEP_COUNT)
 *   seconds  the sum of dt over the frames its clock ran, rounded to 1 / TUTORIAL.metricsResolution s
 *   hits     the harmless hits (state.tutorial.harmlessHits deltas) landed on frames its clock ran
 * reported once per step per run, on the frame it latches done and practised: a step done by its rule (a `boost`
 * that faded untaken and an `ember` waived with none left count: they are done, not skipped), never a skipped one
 * (left behind on a floor change, or still open at the finish) and never a waived one (TutorialView.waived: the `map`
 * step left unopened or unavailable, docs/TUTORIAL_MAP.md §4, so its reports count real opens). A step done while its clock never ran (the flask
 * drunk under the objective card) reports 0 seconds.
 *
 * Stuck episode. An episode is a stretch of frames showing the same prompt id (TutorialView.prompt, never "") with no
 * progress; its clock is the sum of the dt charged to it (the dt of a frame is added before that frame's progress or
 * prompt change ends it). Progress is any of: a step newly done (practised or skipped), a lesson room newly entered
 * (state.endless.roomsEntered), a kill (score sources `kills` + `boss`), a flask drunk, a roll, an Ember burnt
 * (the frame's events), a guard cancel (score source `guard`), a relic, a curse or a boon gained, a floor change (the
 * first frame only seeds the state counters: the spawn's own room entered on tick 1 is not progress). An
 * episode ends on progress or on a prompt change (the finish clears the prompt, so it ends there too); one that lasted
 * >= TUTORIAL.stuckSeconds reports { prompt, seconds } (rounded like lesson seconds), at most once per prompt id per
 * run. flush() ends the open episode for a client leaving early (a skip): call it right before sending the skip.
 *
 * @module
 */
import { TUTORIAL } from "shared/config";
import { SOLO_PLAYER, ScoreSource, type SimState } from "shared/sim";
import { TUTORIAL_STEPS } from "./steps";

/** One lesson's measurement (TutorialView.newLessonReports). */
export interface TutorialLessonReport {
	/** The step's funnel number (TutorialStep.number, 1..TUTORIAL_STEP_COUNT). */
	readonly step: number;
	/** Real seconds its clock ran, rounded to 1 / TUTORIAL.metricsResolution. */
	readonly seconds: number;
	/** Harmless hits landed while its clock ran. */
	readonly hits: number;
}

/** One stuck episode (TutorialView.newStuckReports). */
export interface TutorialStuckReport {
	/** The prompt id shown (TUTORIAL_PROMPT_IDS). */
	readonly prompt: string;
	/** The episode's real seconds (>= the stuck threshold), rounded to 1 / TUTORIAL.metricsResolution. */
	readonly seconds: number;
}

export interface TutorialMetricsOptions {
	/** The stuck threshold, real seconds (default TUTORIAL.stuckSeconds). */
	readonly stuckSeconds?: number;
}

/** What one metrics frame reads from the director's resolved view. */
export interface TutorialMetricsView {
	readonly stepIndex: number;
	readonly promptStepIndex: number;
	readonly prompt: string;
	readonly finished: boolean;
	readonly done: ReadonlyArray<boolean>;
	readonly skipped: ReadonlyArray<boolean>;
	/** Per step: waived (TutorialView.waived): done without a lesson report. */
	readonly waived: ReadonlyArray<boolean>;
}

/** What one metrics frame reads from the frame itself. */
export interface TutorialMetricsFrame {
	readonly state: Readonly<SimState>;
	readonly events: { readonly flaskUsed: number; readonly rollStarted: number; readonly emberUsed: number };
	readonly dt: number;
}

/** Seconds rounded to 1 / TUTORIAL.metricsResolution (a whole number of steps divided, so 0.3 stays 0.3). */
export function roundTutorialSeconds(seconds: number): number {
	const r = TUTORIAL.metricsResolution;
	return math.round(seconds * r) / r;
}

/** The progress counters (any change between two frames is progress). */
interface ProgressCounters {
	stepsDone: number;
	roomsEntered: number;
	kills: number;
	guards: number;
	relics: number;
	curses: number;
	boons: number;
	floor: number;
}

function newCounters(): ProgressCounters {
	return { stepsDone: 0, roomsEntered: 0, kills: 0, guards: 0, relics: 0, curses: 0, boons: 0, floor: 0 };
}

function scoreCount(state: Readonly<SimState>, source: number): number {
	return state.score?.counts[source] ?? 0;
}

export class TutorialMetrics {
	/** Reused every update (see TutorialView.newLessonReports / newStuckReports). */
	readonly newLessonReports: TutorialLessonReport[] = [];
	readonly newStuckReports: TutorialStuckReport[] = [];
	private readonly stuckSeconds: number;
	private readonly seconds: number[] = [];
	private readonly hits: number[] = [];
	private readonly reported: boolean[] = [];
	private readonly stuckReported = new Set<string>();
	/** The view the next frame's dt is charged to (initially the constructor view: the objective card). */
	private chargeCurrent = 0;
	private chargePrompt = 0;
	private lastHarmless = 0;
	private episodePrompt: string;
	private episodeSeconds = 0;
	private readonly counters = newCounters();
	private countersSeeded = false;

	constructor(options: TutorialMetricsOptions = {}) {
		this.stuckSeconds = options.stuckSeconds ?? TUTORIAL.stuckSeconds;
		for (let i = 0; i < TUTORIAL_STEPS.size(); i++) {
			this.seconds.push(0);
			this.hits.push(0);
			this.reported.push(false);
		}
		this.episodePrompt = TUTORIAL_STEPS[0].prompt;
	}

	/** One frame, after the director resolved `view` (see the file comment). */
	update(frame: TutorialMetricsFrame, view: TutorialMetricsView): void {
		this.newLessonReports.clear();
		this.newStuckReports.clear();
		const dt = frame.dt > 0 ? frame.dt : 0;
		const harmless = frame.state.tutorial?.harmlessHits ?? 0;
		const hitDelta = harmless > this.lastHarmless ? harmless - this.lastHarmless : 0;
		this.lastHarmless = harmless;

		// Lesson clocks: charged to the previous view's current step and prompt step (once when they are the same).
		this.charge(this.chargeCurrent, dt, hitDelta);
		if (this.chargePrompt !== this.chargeCurrent) this.charge(this.chargePrompt, dt, hitDelta);
		const n = TUTORIAL_STEPS.size();
		for (let i = 0; i < n; i++) {
			if (this.reported[i] || !view.done[i]) continue;
			this.reported[i] = true;
			if (view.skipped[i] || view.waived[i]) continue;
			this.newLessonReports.push({
				step: TUTORIAL_STEPS[i].number,
				seconds: roundTutorialSeconds(this.seconds[i]),
				hits: this.hits[i],
			});
		}

		// Stuck episodes.
		if (this.episodePrompt !== "") this.episodeSeconds += dt;
		const progress = this.progressed(frame, view);
		if (progress || view.prompt !== this.episodePrompt) {
			this.endEpisode(this.newStuckReports);
			this.episodePrompt = view.prompt;
		}

		const live = !view.finished && view.stepIndex < n;
		this.chargeCurrent = live ? view.stepIndex : -1;
		this.chargePrompt = live ? view.promptStepIndex : -1;
	}

	/**
	 * Ends the open stuck episode (a client leaving early: call right before a skip). Returns its report when it lasted
	 * >= the threshold and its prompt has not reported yet (then the episode restarts from 0 s, so a second flush
	 * returns nothing), else nothing.
	 */
	flush(): TutorialStuckReport[] {
		const out: TutorialStuckReport[] = [];
		this.endEpisode(out);
		return out;
	}

	private charge(i: number, dt: number, hitDelta: number): void {
		if (i < 0 || i >= this.seconds.size() || this.reported[i]) return;
		this.seconds[i] += dt;
		this.hits[i] += hitDelta;
	}

	private endEpisode(out: TutorialStuckReport[]): void {
		const prompt = this.episodePrompt;
		const seconds = this.episodeSeconds;
		this.episodeSeconds = 0;
		if (prompt === "" || seconds < this.stuckSeconds || this.stuckReported.has(prompt)) return;
		this.stuckReported.add(prompt);
		out.push({ prompt, seconds: roundTutorialSeconds(seconds) });
	}

	/** True when any progress fact moved this frame (see the file comment). Updates the counters. */
	private progressed(frame: TutorialMetricsFrame, view: TutorialMetricsView): boolean {
		const state = frame.state;
		const c = this.counters;
		let stepsDone = 0;
		for (const d of view.done) if (d) stepsDone++;
		let roomsEntered = 0;
		const entered = state.endless?.roomsEntered;
		if (entered !== undefined) for (const r of entered) if (r !== 0) roomsEntered++;
		const kills = scoreCount(state, ScoreSource.KILLS) + scoreCount(state, ScoreSource.BOSS);
		const guards = scoreCount(state, ScoreSource.GUARD);
		const me = state.run?.players[SOLO_PLAYER];
		const relics = me?.relics.size() ?? 0;
		const curses = me?.curses.size() ?? 0;
		const boons = me?.boons.size() ?? 0;
		const floor = state.endless?.floor ?? 0;
		const e = frame.events;
		// The first frame seeds the state counters (the spawn's own room entered, floor 1); steps count from none done.
		const moved =
			stepsDone !== c.stepsDone ||
			(this.countersSeeded &&
				(roomsEntered !== c.roomsEntered ||
					kills !== c.kills ||
					guards !== c.guards ||
					relics !== c.relics ||
					curses !== c.curses ||
					boons !== c.boons ||
					floor !== c.floor));
		this.countersSeeded = true;
		c.stepsDone = stepsDone;
		c.roomsEntered = roomsEntered;
		c.kills = kills;
		c.guards = guards;
		c.relics = relics;
		c.curses = curses;
		c.boons = boons;
		c.floor = floor;
		return moved || e.flaskUsed > 0 || e.rollStarted > 0 || e.emberUsed > 0;
	}
}

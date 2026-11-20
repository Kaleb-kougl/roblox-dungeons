/**
 * The run-over recap's clocks per tab (docs/RUN_CONTRIBUTION.md CT7): one object RecapController steps instead of a
 * bare RecapTimeline, so a party run's `You | Team | Party` tabs each count up the way the plan says. Pure.
 *
 *   untabbed  (solo, or a party run without a contribution) exactly one RecapTimeline: the near-miss line and the
 *             highlights, as before. The "team" tab's cells are its highlight rows.
 *   tabbed    `main` holds the near-miss line (above the tabs on every tab) and the arm; the You cells count on their
 *             own timeline from where the highlights would have (RECAP.highlightsStartSec, or after new best's rows on
 *             a record run); the Team tab's highlights count up the first time Team opens (from
 *             CONTRIB_UI.teamOpenDelaySec after the open); Party never counts (rows show final). Leaving a tab settles
 *             it silently, so every later open of any tab shows final values.
 *   frame     one merged RecapFrame: tick / lands from every clock (shared/view/audio recapCue still plays at most one
 *             sound a frame), the arm from `main`, settled when `main` and the shown tab's clock are.
 *   presses   `press()` / `skip()` (RunOverRetryGate's target): a skip settles the near-miss line and the tab showing
 *             (each with its own land; recapCue keeps it to one sound); once armed, a press answers "retry".
 *   reduced   finals with one land per clock (the timeline's own rule).
 *   renewed   a verdict with other numbers: every existing clock rebuilt at its old time, settled stays settled (rows
 *             already due show final, silently), the tab kept; a Team tab never opened stays unopened.
 *
 * @module
 */
import { RECAP, type RecapConfig } from "./recapConfig";
import {
	RecapTimeline,
	type RecapFrame,
	type RecapRowSpec,
	type RecapRowState,
	type RecapTimelineOptions,
} from "./recap";
import { CONTRIB_UI, RECAP_FIRST_TAB, type RecapTab } from "./contributionUi";

/**
 * What a `RecapViews` is built from: whether the tabs are drawn, the rows each clock counts and the timeline options
 * they share. Times are real seconds from the run-over frame.
 */
export interface RecapViewsOptions {
	/** A party run's tabs are drawn (recapTabsShown). */
	readonly tabbed: boolean;
	/** The near-miss line's row (undefined: none). */
	readonly nearMiss: RecapRowSpec | undefined;
	/** The highlights' rows (the Team tab's when tabbed). */
	readonly highlights: ReadonlyArray<RecapRowSpec>;
	/** The You cells' rows (tabbed only). */
	readonly you: ReadonlyArray<RecapRowSpec>;
	/** A record run: when NB's record rows have rolled (recapRecordRowsSec). */
	readonly recordRowsSec?: number;
	readonly reducedMotion: boolean;
	/** Start at this clock (RecapTimelineOptions.atSec). */
	readonly atSec?: number;
}

/** One clock and how it was built (for a silent settle or a re-derive). */
interface Clock {
	timeline: RecapTimeline;
	readonly options: RecapTimelineOptions;
}

/** `c` settled silently: its rows final, no land (a tab left behind). */
function settledCopy(c: Clock, cfg: RecapConfig): Clock {
	const t = c.timeline;
	if (t.isSettled()) return c;
	const atSec = math.max(t.elapsed(), t.settleSec);
	return { timeline: new RecapTimeline({ ...c.options, atSec }, cfg), options: c.options };
}

/** `options` at `old`'s clock; a settled old one stays settled (rows due final, silent). */
function renewedClock(options: RecapTimelineOptions, old: RecapTimeline | undefined, cfg: RecapConfig): Clock {
	if (old === undefined) return { timeline: new RecapTimeline(options, cfg), options };
	let t = new RecapTimeline({ ...options, atSec: old.elapsed() }, cfg);
	if (old.isSettled() && !t.isSettled()) {
		t = new RecapTimeline({ ...options, atSec: math.max(old.elapsed(), t.settleSec) }, cfg);
	}
	return { timeline: t, options };
}

/**
 * The run-over recap's clocks, one object the client's RecapController steps with real seconds each frame (the file
 * header has the rules): the near-miss line's timeline, and in a party run one clock for the You cells and one for the
 * Team tab's highlights, started when that tab first opens. `step` returns one merged frame of sound edges, the arm and
 * settled; `press` answers `skip` until the retry is armed and `retry` after; `renewed` rebuilds it for a verdict with
 * other numbers at the same clock times.
 */
export class RecapViews {
	readonly tabbed: boolean;
	/** The near-miss line (row `main.nearMissRow`), the arm; untabbed also the highlights. */
	readonly main: RecapTimeline;
	private readonly cfg: RecapConfig;
	private readonly mainOptions: RecapTimelineOptions;
	private readonly teamRows: ReadonlyArray<RecapRowSpec>;
	private readonly reduced: boolean;
	private you: Clock | undefined;
	private team: Clock | undefined;
	private current: RecapTab;
	private readonly out: RecapFrame = { tick: false, lands: 0, armed: false, armedNow: false, settled: false };

	constructor(options: RecapViewsOptions, cfg: RecapConfig = RECAP, prior?: RecapViews) {
		this.cfg = cfg;
		this.tabbed = options.tabbed;
		this.reduced = options.reducedMotion;
		this.teamRows = options.highlights;
		this.mainOptions = {
			nearMiss: options.nearMiss,
			highlights: options.tabbed ? [] : options.highlights,
			recordRowsSec: options.recordRowsSec,
			reducedMotion: options.reducedMotion,
			atSec: options.atSec,
		};
		this.current = !options.tabbed ? "team" : prior !== undefined && prior.tabbed ? prior.current : RECAP_FIRST_TAB;
		if (prior === undefined) {
			this.main = new RecapTimeline(this.mainOptions, cfg);
			if (options.tabbed) {
				const you = this.youOptions(options);
				this.you = { timeline: new RecapTimeline({ ...you, atSec: options.atSec }, cfg), options: you };
			}
		} else {
			const main = renewedClock({ ...this.mainOptions, atSec: undefined }, prior.main, cfg);
			this.main = main.timeline;
			if (options.tabbed) this.you = renewedClock(this.youOptions(options), prior.you?.timeline, cfg);
			if (options.tabbed && prior.team !== undefined) {
				this.team = renewedClock(
					{ ...prior.team.options, highlights: options.highlights },
					prior.team.timeline,
					cfg,
				);
			}
		}
		this.out.armed = this.main.isArmed();
		this.out.settled = this.isSettled();
	}

	/** The same views with new content (a verdict re-derive): see the file comment. */
	renewed(options: RecapViewsOptions): RecapViews {
		return new RecapViews(options, this.cfg, this);
	}

	private youOptions(o: RecapViewsOptions): RecapTimelineOptions {
		return {
			nearMiss: undefined,
			highlights: o.you,
			recordRowsSec: o.recordRowsSec,
			reducedMotion: o.reducedMotion,
		};
	}

	/** The tab showing (untabbed: "team", the highlights). */
	tab(): RecapTab {
		return this.current;
	}

	/** Switches tabs (tabbed only): the tab left settles silently; Team's first open starts its count-up. */
	setTab(tab: RecapTab): void {
		if (!this.tabbed || tab === this.current) return;
		const leaving = this.current;
		if (leaving === "you" && this.you !== undefined) this.you = settledCopy(this.you, this.cfg);
		if (leaving === "team" && this.team !== undefined) this.team = settledCopy(this.team, this.cfg);
		this.current = tab;
		if (tab === "team" && this.team === undefined) {
			const options: RecapTimelineOptions = {
				nearMiss: undefined,
				highlights: this.teamRows,
				reducedMotion: this.reduced,
				highlightsAtSec: CONTRIB_UI.teamOpenDelaySec,
			};
			this.team = { timeline: new RecapTimeline(options, this.cfg), options };
		}
		this.out.settled = this.isSettled();
	}

	/** Seconds since the run-over frame (the main clock). */
	elapsed(): number {
		return this.main.elapsed();
	}

	isArmed(): boolean {
		return this.main.isArmed();
	}

	/** The near-miss line and the shown tab's cells are final. */
	isSettled(): boolean {
		if (!this.main.isSettled()) return false;
		const t = this.shownClock();
		return t === undefined || t.isSettled();
	}

	/** The near-miss line's row (undefined: none). */
	nearMissRow(): RecapRowState | undefined {
		const i = this.main.nearMissRow;
		return i >= 0 ? this.main.rows[i] : undefined;
	}

	/**
	 * Cell `i`'s row on `tab` (undefined: none, or Team not opened yet). Untabbed: "team" reads the main timeline's
	 * highlight rows. Party has no rows (final values).
	 */
	cellRow(tab: RecapTab, i: number): RecapRowState | undefined {
		if (!this.tabbed) return tab === "team" ? this.main.rows[this.main.firstHighlightRow + i] : undefined;
		if (tab === "you") return this.you?.timeline.rows[i];
		if (tab === "team") return this.team?.timeline.rows[i];
		return undefined;
	}

	/** The clock `tab`'s cell rows run on (their fades read it): You / Team their own, else the main clock. */
	tabElapsed(tab: RecapTab): number {
		if (this.tabbed && tab === "you" && this.you !== undefined) return this.you.timeline.elapsed();
		if (this.tabbed && tab === "team") return this.team?.timeline.elapsed() ?? 0;
		return this.main.elapsed();
	}

	/** The Team tab has been opened (its clock exists). Untabbed: always (the highlights are on the main clock). */
	teamOpened(): boolean {
		return !this.tabbed || this.team !== undefined;
	}

	/** One rendered frame of `dt` real seconds: every clock steps, their edges merged (see the file comment). */
	step(dt: number): RecapFrame {
		const out = this.out;
		const m = this.main.step(dt);
		let tick = m.tick;
		let lands = m.lands;
		for (const c of [this.you, this.team]) {
			if (c === undefined) continue;
			const f = c.timeline.step(dt);
			tick = tick || f.tick;
			lands += f.lands;
		}
		out.tick = tick;
		out.lands = lands;
		out.armed = m.armed;
		out.armedNow = m.armedNow;
		out.settled = this.isSettled();
		return out;
	}

	/** Settles the near-miss line and the shown tab (each lands once on the next step when it had not). */
	skip(): void {
		this.main.skip();
		this.shownClock()?.skip();
		this.out.settled = this.isSettled();
	}

	/** A confirm / FIRE press: "retry" once armed; before that it skips (RRD6) and answers "skip". */
	press(): "skip" | "retry" {
		if (this.main.isArmed()) return "retry";
		this.skip();
		return "skip";
	}

	private shownClock(): RecapTimeline | undefined {
		if (!this.tabbed) return undefined;
		if (this.current === "you") return this.you?.timeline;
		if (this.current === "team") return this.team?.timeline;
		return undefined;
	}
}

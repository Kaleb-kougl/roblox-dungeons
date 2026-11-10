/**
 * The rollback spike's misprediction metrics (docs/ROLLBACK_SPIKE.md Design 3, task R2): counts per room type
 * (combat / boss / walk, ROLLBACK_ROOM_TYPES) under the 20 ROLLBACK_LIVE_METRICS names, so the live worker (R4b) builds
 * a LiveSummary's `rooms` straight from them (`toLiveSummaryCounts`, `leadSeen`), plus truth-error and correction
 * distributions per entity type (mean / p95 / max, for the offline report). Pure and allocation-light; model.ts counts,
 * this only accumulates and reports.
 *
 * What each metric counts (one count per entity and event; the model decides, see model.ts):
 *   enemyCorr010..100   an enemy's drawn position moved >= 0.1 / 0.25 / 0.5 / 1.0 tiles between two consecutive frames'
 *                       predictions of the same tick (one count per enemy per frame, cumulative buckets); only living
 *                       enemies on screen (within viewRadiusTiles of the observer), as the distributions
 *   mateCorr010..100    the same for living teammates on screen
 *   enemyErr050 / 100   a living enemy on screen drawn >= 0.5 / 1.0 tiles from where the truth has it, per enemy per
 *                       drawn tick
 *   undoneKill / Death / Pickup / Erase   shown in the drawn prediction, absent from the truth (within the event slack)
 *   lateEvent           in the truth, never drawn before it was confirmed (today's behaviour; NOT a glitch)
 *   phantomBullet       a bullet one frame shows and the next frame's prediction of the same tick does not (it blinks
 *                       out, or appears already along its path)
 *   heartPhantom / heartMissed   a drawn hit on the observing player the truth does not have / the reverse
 *   cheapPhantomBullet / cheapLateBullet   the cheap plan (docs/LOCAL_PREDICTION.md, bullets advanced ballistically
 *                       from the confirmed state): a bullet it draws that the truth does not have / a true bullet it
 *                       does not draw (every bullet spawned in the unconfirmed span appears late). Comparison only
 *
 * ROLLBACK_GLITCH_METRICS are the rollback glitches the sanity rules hold at zero (perfect guesses; L = 0).
 */
import {
	ROLLBACK_LIVE_METRICS,
	ROLLBACK_ROOM_TYPES,
	type RollbackLeadSeen,
	type RollbackLiveMetric,
	type RollbackLiveRoom,
	type RollbackMetricCounts,
	type RollbackRoomType,
} from "shared/spikes";
import { SIM_HZ } from "shared/sim";
import { ROLLBACK_SPIKE } from "./config";

const MODEL = ROLLBACK_SPIKE.model;
const SECONDS_PER_MINUTE = 60;
const METRIC_COUNT = ROLLBACK_LIVE_METRICS.size();
const ROOM_COUNT = ROLLBACK_ROOM_TYPES.size();

/** Index of each metric in ROLLBACK_LIVE_METRICS. */
export const METRIC_INDEX: ReadonlyMap<RollbackLiveMetric, number> = (() => {
	const m = new Map<RollbackLiveMetric, number>();
	for (let i = 0; i < METRIC_COUNT; i++) m.set(ROLLBACK_LIVE_METRICS[i], i);
	return m;
})();

/** The metric's index (errors on a name not in the list). */
export function metricIndex(name: RollbackLiveMetric): number {
	const i = METRIC_INDEX.get(name);
	if (i === undefined) error(`unknown rollback metric ${name}`, 0);
	return i;
}

/** Not glitches: late events (today's behaviour) and the cheap plan's comparison numbers. */
const NOT_GLITCHES: ReadonlyArray<RollbackLiveMetric> = ["lateEvent", "cheapPhantomBullet", "cheapLateBullet"];
/** The rollback glitches (17 of the 20 metrics): zero with perfect guesses and with L = 0 (Design 3 sanity rules). */
export const ROLLBACK_GLITCH_METRICS: ReadonlyArray<RollbackLiveMetric> = ROLLBACK_LIVE_METRICS.filter(
	(m) => !NOT_GLITCHES.includes(m),
);

/** Entity types of the distributions. */
export const ErrorEntity = {
	ENEMY: 0,
	MATE: 1,
	SELF: 2,
	BULLET: 3,
} as const;
export const ERROR_ENTITY_NAMES: ReadonlyArray<string> = ["enemy", "mate", "self", "bullet"];
/** The event kinds in digest.ts DIGEST_EVENT_KINDS order (the event counters' slots). */
export const EVENT_KIND_NAMES: ReadonlyArray<string> = ["kill", "death", "pickup", "erase", "hit"];

/** A distance histogram (tiles): fixed bins of errorBinTiles up to errorMaxTiles (the last bin holds the rest). */
export class ErrorHistogram {
	readonly bins: number[];
	count = 0;
	sum = 0;
	max = 0;
	/** Samples above 0 (an error at all). */
	nonzero = 0;

	constructor() {
		this.bins = table.create(math.ceil(MODEL.errorMaxTiles / MODEL.errorBinTiles) + 1, 0);
	}

	add(v: number): void {
		const last = this.bins.size() - 1;
		const b = math.min(math.floor(v / MODEL.errorBinTiles), last);
		this.bins[b] += 1;
		this.count++;
		this.sum += v;
		if (v > this.max) this.max = v;
		if (v > 0) this.nonzero++;
	}

	mean(): number {
		return this.count > 0 ? this.sum / this.count : 0;
	}

	/** The q-quantile (upper edge of its bin; 0 for an empty histogram or a quantile that is exactly 0). */
	quantile(q: number): number {
		if (this.count === 0) return 0;
		const want = q * this.count;
		let seen = 0;
		for (let b = 0; b < this.bins.size(); b++) {
			seen += this.bins[b];
			if (seen >= want) return b === 0 && this.max === 0 ? 0 : math.min((b + 1) * MODEL.errorBinTiles, this.max);
		}
		return this.max;
	}

	merge(o: ErrorHistogram): void {
		for (let b = 0; b < this.bins.size(); b++) this.bins[b] += o.bins[b];
		this.count += o.count;
		this.sum += o.sum;
		this.nonzero += o.nonzero;
		if (o.max > this.max) this.max = o.max;
	}

	reset(): void {
		for (let b = 0; b < this.bins.size(); b++) this.bins[b] = 0;
		this.count = 0;
		this.sum = 0;
		this.max = 0;
		this.nonzero = 0;
	}
}

/** Counts per room type and metric, play seconds, the lead seen, distributions and the model's own counters. */
export class RollbackMetrics {
	/** Play seconds per room type (ROLLBACK_ROOM_TYPES order); draft ticks are not play. */
	readonly seconds: number[];
	/** counts[room][metric] (ROLLBACK_LIVE_METRICS order). */
	readonly counts: number[][];
	draftTicks = 0;
	/** Client frames seen, predictions made, ticks stepped in predictions. */
	frames = 0;
	predictions = 0;
	predictedTicks = 0;
	/** Digest capacity overflows (bullets / events dropped) over all digests written. */
	bulletOverflow = 0;
	eventOverflow = 0;
	/**
	 * What was there to get wrong: events in the truth digests and in the drawn digests, per DIGEST_EVENT_KINDS slot
	 * (kill, death, pickup, erase, hit), and bullets in the truth digests (within the view) over `truthTicks`.
	 */
	readonly truthEvents: number[];
	readonly drawnEvents: number[];
	truthBullets = 0;
	truthTicks = 0;
	/** Per frame: L (guessed span) and D (playout depth) seen. */
	leadSamples = 0;
	lSum = 0;
	lMax = 0;
	dSum = 0;
	dMax = 0;
	/** Prediction vs truth, per ErrorEntity. */
	readonly truthError: ErrorHistogram[];
	/** Consecutive frames' predictions of the same tick, per ErrorEntity (bullets: matched ones). */
	readonly correction: ErrorHistogram[];
	/**
	 * The cheap plan's view vs the truth, per ErrorEntity: enemies and teammates where the confirmed state has them,
	 * bullets advanced ballistically (matched ones); its own knight is predicted from known inputs, as rollback's.
	 */
	readonly cheapError: ErrorHistogram[];

	constructor() {
		this.seconds = table.create(ROOM_COUNT, 0);
		this.truthEvents = table.create(EVENT_KIND_NAMES.size(), 0);
		this.drawnEvents = table.create(EVENT_KIND_NAMES.size(), 0);
		this.counts = [];
		for (let r = 0; r < ROOM_COUNT; r++) this.counts.push(table.create(METRIC_COUNT, 0));
		this.truthError = [];
		this.correction = [];
		this.cheapError = [];
		for (let e = 0; e < ERROR_ENTITY_NAMES.size(); e++) {
			this.truthError.push(new ErrorHistogram());
			this.correction.push(new ErrorHistogram());
			this.cheapError.push(new ErrorHistogram());
		}
	}

	/** Counts `n` of metric index `metric` in room `room` (a RoomKind; a draft room counts nowhere). */
	count(room: number, metric: number, n = 1): void {
		if (room < 0 || room >= ROOM_COUNT) return;
		this.counts[room][metric] += n;
	}

	/** One tick of play in `room` (a draft tick counts as draft). */
	addTick(room: number): void {
		if (room < 0 || room >= ROOM_COUNT) {
			this.draftTicks++;
			return;
		}
		this.seconds[room] += 1 / SIM_HZ;
	}

	sampleLead(l: number, d: number): void {
		this.leadSamples++;
		this.lSum += l;
		this.dSum += d;
		if (l > this.lMax) this.lMax = l;
		if (d > this.dMax) this.dMax = d;
	}

	/** Metric `metric` over every room type (or one). */
	total(metric: RollbackLiveMetric, room?: RollbackRoomType): number {
		const m = metricIndex(metric);
		if (room !== undefined) return this.counts[ROLLBACK_ROOM_TYPES.indexOf(room)][m];
		let n = 0;
		for (let r = 0; r < ROOM_COUNT; r++) n += this.counts[r][m];
		return n;
	}

	totalSeconds(room?: RollbackRoomType): number {
		if (room !== undefined) return this.seconds[ROLLBACK_ROOM_TYPES.indexOf(room)];
		let s = 0;
		for (let r = 0; r < ROOM_COUNT; r++) s += this.seconds[r];
		return s;
	}

	/** Per minute of play (all rooms, or one); 0 without play. */
	perMinute(metric: RollbackLiveMetric, room?: RollbackRoomType): number {
		const s = this.totalSeconds(room);
		return s > 0 ? (this.total(metric, room) * SECONDS_PER_MINUTE) / s : 0;
	}

	/** Every glitch metric's total (the sanity rules expect 0). */
	glitchTotal(): number {
		let n = 0;
		for (const m of ROLLBACK_GLITCH_METRICS) n += this.total(m);
		return n;
	}

	/** A LiveSummary's `rooms`: per room type with play or counts, its seconds and its nonzero counts. */
	toLiveSummaryCounts(): { [K in RollbackRoomType]?: RollbackLiveRoom } {
		const out: { [K in RollbackRoomType]?: RollbackLiveRoom } = {};
		for (let r = 0; r < ROOM_COUNT; r++) {
			const counts: { [K in RollbackLiveMetric]?: number } = {};
			let any = false;
			for (let m = 0; m < METRIC_COUNT; m++) {
				const n = this.counts[r][m];
				if (n === 0) continue;
				counts[ROLLBACK_LIVE_METRICS[m]] = n;
				any = true;
			}
			if (!any && this.seconds[r] <= 0) continue;
			out[ROLLBACK_ROOM_TYPES[r]] = { seconds: this.seconds[r], counts: counts as RollbackMetricCounts };
		}
		return out;
	}

	/** A LiveSummary's `lead`. */
	leadSeen(): RollbackLeadSeen {
		const n = math.max(1, this.leadSamples);
		return { lMean: this.lSum / n, lMax: this.lMax, dMean: this.dSum / n, dMax: this.dMax };
	}

	/** Adds `o` (another pass or window) into this one. */
	merge(o: RollbackMetrics): void {
		for (let r = 0; r < ROOM_COUNT; r++) {
			this.seconds[r] += o.seconds[r];
			for (let m = 0; m < METRIC_COUNT; m++) this.counts[r][m] += o.counts[r][m];
		}
		this.draftTicks += o.draftTicks;
		for (let k = 0; k < EVENT_KIND_NAMES.size(); k++) {
			this.truthEvents[k] += o.truthEvents[k];
			this.drawnEvents[k] += o.drawnEvents[k];
		}
		this.truthBullets += o.truthBullets;
		this.truthTicks += o.truthTicks;
		this.frames += o.frames;
		this.predictions += o.predictions;
		this.predictedTicks += o.predictedTicks;
		this.bulletOverflow += o.bulletOverflow;
		this.eventOverflow += o.eventOverflow;
		this.leadSamples += o.leadSamples;
		this.lSum += o.lSum;
		this.dSum += o.dSum;
		if (o.lMax > this.lMax) this.lMax = o.lMax;
		if (o.dMax > this.dMax) this.dMax = o.dMax;
		for (let e = 0; e < this.truthError.size(); e++) {
			this.truthError[e].merge(o.truthError[e]);
			this.correction[e].merge(o.correction[e]);
			this.cheapError[e].merge(o.cheapError[e]);
		}
	}

	/** Back to empty (a live window's end). */
	reset(): void {
		for (let r = 0; r < ROOM_COUNT; r++) {
			this.seconds[r] = 0;
			for (let m = 0; m < METRIC_COUNT; m++) this.counts[r][m] = 0;
		}
		this.draftTicks = 0;
		for (let k = 0; k < EVENT_KIND_NAMES.size(); k++) {
			this.truthEvents[k] = 0;
			this.drawnEvents[k] = 0;
		}
		this.truthBullets = 0;
		this.truthTicks = 0;
		this.frames = 0;
		this.predictions = 0;
		this.predictedTicks = 0;
		this.bulletOverflow = 0;
		this.eventOverflow = 0;
		this.leadSamples = 0;
		this.lSum = 0;
		this.lMax = 0;
		this.dSum = 0;
		this.dMax = 0;
		for (let e = 0; e < this.truthError.size(); e++) {
			this.truthError[e].reset();
			this.correction[e].reset();
			this.cheapError[e].reset();
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Report

function fmt(v: number): string {
	return string.format("%.2f", v);
}

/** "n | mean | p95 | max" (and "| nonzero"). */
function histCells(h: ErrorHistogram, nonzero: boolean): string {
	const base = `${h.count} | ${fmt(h.mean())} | ${fmt(h.quantile(0.95))} | ${fmt(h.max)}`;
	return nonzero ? `${base} | ${h.nonzero}` : base;
}

/** The header of docs/ROLLBACK_SPIKE.md's misprediction Results table. */
export const RESULTS_TABLE_HEADER = [
	"| Input | L | D | Strategy | Enemy corr. >= 0.5 /min | Undone kills /min | Phantom bullets /min | Teammate corr. >= 1 /min | Cheap plan: phantom / late bullets /min |",
	"|---|---|---|---|---|---|---|---|---|",
].join("\n");

/** One row of that table. */
export function formatResultsRow(input: string, l: number, d: number, strategy: string, m: RollbackMetrics): string {
	return `| ${input} | ${l} | ${d} | ${strategy} | ${fmt(m.perMinute("enemyCorr050"))} | ${fmt(
		m.perMinute("undoneKill"),
	)} | ${fmt(m.perMinute("phantomBullet"))} | ${fmt(m.perMinute("mateCorr100"))} | ${fmt(
		m.perMinute("cheapPhantomBullet"),
	)} / ${fmt(m.perMinute("cheapLateBullet"))} |`;
}

/** A table header with one column per ROLLBACK_LIVE_METRICS name (per minute) after `lead` (e.g. "Input | L"). */
export function metricsTableHeader(lead: string): string {
	const cols = lead.split("|").size();
	let head = `| ${lead} | play s |`;
	let rule = "|";
	for (let k = 0; k <= cols; k++) rule += "---|";
	for (const metric of ROLLBACK_LIVE_METRICS) {
		head += ` ${metric} |`;
		rule += "---|";
	}
	return `${head}\n${rule}`;
}

/** One row of metricsTableHeader's table: every metric per minute of play (all room types). */
export function formatMetricsRow(lead: string, m: RollbackMetrics): string {
	let row = `| ${lead} | ${string.format("%.0f", m.totalSeconds())} |`;
	for (const metric of ROLLBACK_LIVE_METRICS) row += ` ${fmt(m.perMinute(metric))} |`;
	return row;
}

/** Every metric per minute, by room type, then the distributions and the model's counters (the offline report). */
export function formatReport(title: string, m: RollbackMetrics): string {
	const lines: string[] = [];
	lines.push(`## ${title}`);
	let head = "| metric |";
	let rule = "|---|";
	for (const room of ROLLBACK_ROOM_TYPES) {
		head += ` ${room} (${fmt(m.totalSeconds(room))} s) |`;
		rule += "---|";
	}
	head += ` all (${fmt(m.totalSeconds())} s) | count |`;
	rule += "---|---|";
	lines.push(head, rule);
	for (const metric of ROLLBACK_LIVE_METRICS) {
		let row = `| ${metric} |`;
		for (const room of ROLLBACK_ROOM_TYPES) row += ` ${fmt(m.perMinute(metric, room))} |`;
		row += ` ${fmt(m.perMinute(metric))} | ${m.total(metric)} |`;
		lines.push(row);
	}
	lines.push(
		"",
		"| error (tiles) | truth n | mean | p95 | max | nonzero | corr. n | mean | p95 | max | cheap n | mean | p95 | max |",
	);
	lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
	for (let e = 0; e < ERROR_ENTITY_NAMES.size(); e++) {
		lines.push(
			`| ${ERROR_ENTITY_NAMES[e]} | ${histCells(m.truthError[e], true)} | ${histCells(
				m.correction[e],
				false,
			)} | ${histCells(m.cheapError[e], false)} |`,
		);
	}
	let events = "events (truth / drawn):";
	for (let k = 0; k < EVENT_KIND_NAMES.size(); k++) {
		events += ` ${EVENT_KIND_NAMES[k]} ${m.truthEvents[k]} / ${m.drawnEvents[k]}`;
	}
	lines.push("", `${events}; bullets in view per tick ${fmt(m.truthTicks > 0 ? m.truthBullets / m.truthTicks : 0)}`);
	const lead = m.leadSeen();
	lines.push(
		"",
		`frames ${m.frames}, predictions ${m.predictions}, predicted ticks ${m.predictedTicks}, draft ticks ${
			m.draftTicks
		}, L mean ${fmt(lead.lMean)} max ${lead.lMax}, D mean ${fmt(lead.dMean)} max ${lead.dMax}, overflow bullets ${
			m.bulletOverflow
		} events ${m.eventOverflow}`,
	);
	return lines.join("\n");
}

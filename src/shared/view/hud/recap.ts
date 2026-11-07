/**
 * The run-over recap's pure core (docs/RUN_RECAP.md RR2): what the run-over panel says about how close the run came
 * (one near-miss line), what it did well (up to four highlights) and when each piece shows (the timeline). Presentation
 * only (RRD1): every number comes from the client's final state / snapshot, new best's frozen baseline and the view
 * collectors (shared/view/fx RecapTally, Part B's TeamMoments); nothing is written back. Tunables, the highlight table
 * and the string keys: recapConfig.ts.
 *
 *   - `RunRecapInput`  plain data the client's RecapController (RR6) gathers at run over (no Roblox types).
 *   - `nearMissFor`    the first candidate that applies, in the fixed order (RRD2) boss > score > recordFloor > stairs >
 *                      fullClear > nextBoss. Record runs (RRD3) drop the score candidate on a score record and the
 *                      recordFloor one on a deepest record; the first remaining one shows dim (under NB's rows); FIRST
 *                      RECORD shows none. Score / recordFloor need a `known` baseline (unknown, unranked and none skip
 *                      them); a daily run compares the score with best today (RRD11) and has no recordFloor. Dev runs
 *                      and other worlds (tutorial, M1): none.
 *   - `pickHighlights` RECAP_HIGHLIGHTS in priority order, notable ones only (entries sharing a priority are one slot),
 *                      at most RECAP.maxHighlights, filled to RECAP.minHighlights with Kills / Rooms cleared (RRD4).
 *                      Co-op labels the party's values `team` and the view player's own `you`. Other worlds: none.
 *   - `stairsPathTiles` the walking distance (4-neighbour BFS steps over FLOOR, shared/dungeon pathField) from the death
 *                      position to the open stairwell; undefined when closed (a boss floor's before the kill) or
 *                      unreachable. Run over only (one field per call).
 *   - `RecapTimeline`  stepped with real seconds: which rows show, each row's counted value (integer steps), the sound
 *                      edges (`tick` at most once a frame, `lands` per row landing; reduced motion: no count, one land
 *                      at the end), `armed` after RECAP.retryArmSec (RRD6), `skip()` (jump to settled, one land),
 *                      `press()` (skip before the arm, retry after). Record runs start the highlights (and the dim
 *                      line) after NB's rows. A verdict that changes the numbers re-derives silently: a new timeline at
 *                      the old one's clock (`atSec`), rows already due shown final with no sound.
 */
import { pathDistance, pathField, type Dungeon } from "shared/dungeon";
import { COMBO_MIN, ENDLESS_FIRST_DEPTH, ScoreSource } from "shared/sim";
import type { RecapTallySource } from "shared/view/fx";
import { COMBO_TIERS, comboTier } from "./comboConfig";
import { floorTarget, scoreTarget, type RunBaseline, type RunOverRecords } from "./newBest";
import {
	RECAP,
	RECAP_FILL,
	RECAP_HIGHLIGHTS,
	RECAP_STRINGS,
	type RecapConfig,
	type RecapHighlightDef,
	type RecapHighlightId,
} from "./recapConfig";

// ---------------------------------------------------------------------------------------------------------------
// Input

/** The run's world as the recap sees it: endless and daily get the full recap, dev highlights only, other nothing. */
export type RecapWorld = "endless" | "daily" | "dev" | "other";

/** The final score (shared/sim ScoreState fits as is). `points` / `counts` are ScoreSource-indexed; see their size(). */
export interface RecapScoreInput {
	readonly total: number;
	/** The run's peak combo, tenths (ScoreState.maxCombo). */
	readonly maxCombo: number;
	readonly points: ReadonlyArray<number>;
	readonly counts: ReadonlyArray<number>;
}

/** The boss at the death tick (HudSnapshot: `bossVisible` = engaged and alive; RR0 1). */
export interface RecapBossInput {
	/** phase > 0 (the fight began). */
	readonly engaged: boolean;
	readonly alive: boolean;
	/** bossFraction(s.bossHp, s.bossHpMax). */
	readonly hpFraction: number;
	/** The boss archetype id (`boss.act1`); its name is the theme string `<id>.name`. */
	readonly bossId: string;
}

/** The view player's build (docs/BUILDS.md): duos taken, boons evolved (level III). Zeros without builds. */
export interface RecapBuildsInput {
	readonly duos: number;
	readonly evolutions: number;
}

/** Part B's co-op moments (docs/RUN_RECAP.md CM1). Zeros in solo runs and until Part B lands. */
export interface RecapTeamInput {
	/** TEAM PERFECT clears (= counts[PERFECT] in a party run, CMD1; not read here, telemetry RR9). */
	readonly teamPerfects: number;
	readonly bestTeamStreak: number;
	readonly syncParries: number;
}

export const NO_TEAM_MOMENTS: RecapTeamInput = table.freeze({ teamPerfects: 0, bestTeamStreak: 0, syncParries: 0 });

/** The run's vault chests (docs/TREASURE.md, shared/sim treasureRunSummary: the party's opens, kept locks, Legendaries). */
export interface RecapChestsInput {
	readonly opened: number;
	readonly kept: number;
	readonly legendary: number;
}

/** Everything the recap reads, gathered once at run over (and again on a verdict with other numbers). */
export interface RunRecapInput {
	readonly world: RecapWorld;
	/** Players in the run (>= 2: a party run, co-op labels and rows). */
	readonly partySize: number;
	/** The view player (getViewPlayerIndex; solo 0): the tally's and the builds' player. */
	readonly viewIndex: number;
	readonly score: RecapScoreInput;
	/** Kills (the snapshot's `kills`). */
	readonly kills: number;
	/** The floor the run ended on, and the Depth then (state.endless). */
	readonly floor: number;
	readonly depth: number;
	/** The Depth the run started at (a dev run's EndlessConfig.startDepth); default ENDLESS_FIRST_DEPTH. */
	readonly startDepth?: number;
	readonly builds: RecapBuildsInput;
	/** The death floor is a boss floor (shared/dungeon isBossFloor). */
	readonly bossFloor: boolean;
	/** The boss at the death tick (undefined: none on the floor). */
	readonly boss: RecapBossInput | undefined;
	/** floor + 1 is a boss floor: its boss's archetype id (its seeded pick, bossKindFor); else undefined. */
	readonly nextBossId: string | undefined;
	/** stairsPathTiles from the death position (undefined: closed, unreachable or not computed). */
	readonly stairsTiles: number | undefined;
	/** The death floor's encounter rooms (shared/sim floorRoomTally: [cleared, total]): cleared, and left. */
	readonly roomsCleared: number;
	readonly roomsUncleared: number;
	/** New best's frozen baseline (a daily run's: best today). */
	readonly baseline: RunBaseline;
	/** runOverRecords(baseline, score, floor, server?): which records this run set, FIRST RECORD. */
	readonly records: RunOverRecords;
	/** A daily run's best today, when the caller has a fresher one than the baseline's; default the baseline's score. */
	readonly dailyBestToday?: number;
	/** The run's RecapTally (RunView.recapTally). */
	readonly tally: RecapTallySource;
	/** Part B's team moments; default NO_TEAM_MOMENTS. */
	readonly team?: RecapTeamInput;
	/** The run's chests (treasureRunSummary); undefined: a run without treasure rooms (no Chests highlight at all). */
	readonly chests?: RecapChestsInput;
}

/** A score source's count, 0 when the run has no such source (JACKPOT / PELLETS / SWEEP exist in some runs only). */
function countOf(s: RecapScoreInput, source: number): number {
	return source < s.counts.size() ? s.counts[source] : 0;
}

function pointsOf(s: RecapScoreInput, source: number): number {
	return source < s.points.size() ? s.points[source] : 0;
}

function hasSource(s: RecapScoreInput, source: number): boolean {
	return source < s.counts.size();
}

/** Bosses killed: every boss kill raises Depth by one (RR0 2). */
export function bossKillsOf(depth: number, startDepth: number = ENDLESS_FIRST_DEPTH): number {
	return math.max(0, depth - startDepth);
}

/** No-hit awards (RR0 2): counts[BOSS] = boss kills + no-hit awards, so counts[BOSS] - kills (0..kills). */
export function bossNoHitAwards(bossCount: number, depth: number, startDepth: number = ENDLESS_FIRST_DEPTH): number {
	const kills = bossKillsOf(depth, startDepth);
	return math.clamp(bossCount - kills, 0, kills);
}

/** The boss name's theme string key (BossBar's `<id>.name`). */
export function recapBossNameKey(bossId: string): string {
	return `${bossId}.name`;
}

// ---------------------------------------------------------------------------------------------------------------
// The near-miss line

export type RecapNearMissKind = "boss" | "score" | "recordFloor" | "stairs" | "fullClear" | "nextBoss";

/** The near-miss line. Text: str(key, { ...vars, boss: str(bossKey) }) (bossKey only for boss / nextBoss). */
export interface RecapNearMiss {
	readonly kind: RecapNearMissKind;
	readonly key: string;
	/** The string's number variables (pct / gap / tiles + next / rooms; none for recordFloor / nextBoss). */
	readonly vars: Readonly<Record<string, number>>;
	/** `{boss}`'s theme string key (the boss's name). */
	readonly bossKey?: string;
	/** The variable that counts up on the timeline (undefined: no number, no count, no sound). */
	readonly countVar?: string;
	/** Shown dim (a record run's sub-line under NB's rows). */
	readonly dim: boolean;
}

const PERCENT = 100;

/** The boss's hp fraction as the line's whole percent, at least 1 (a living boss never reads 0 %). */
export function recapBossPercent(fraction: number): number {
	return math.max(1, math.floor(fraction * PERCENT + 0.5));
}

function hasRecordRow(records: RunOverRecords, kind: "score" | "floor"): boolean {
	for (const r of records.rows) if (r.kind === kind) return true;
	return false;
}

/** The score the run is compared with (known baselines only; a daily run's best today), else undefined. */
function scoreToBeat(input: RunRecapInput): number | undefined {
	const b = input.baseline;
	if (b.kind !== "known") return undefined;
	if (input.world === "daily" && input.dailyBestToday !== undefined) {
		return input.dailyBestToday > 0 ? input.dailyBestToday : undefined;
	}
	return scoreTarget(b);
}

/** The near-miss candidate `kind` for this run, or undefined when it does not apply (record rules aside). */
function candidate(kind: RecapNearMissKind, input: RunRecapInput, cfg: RecapConfig): RecapNearMiss | undefined {
	const dim = input.records.record;
	switch (kind) {
		case "boss": {
			const b = input.boss;
			if (!input.bossFloor || b === undefined || !b.engaged || !b.alive) return undefined;
			if (!(b.hpFraction > 0 && b.hpFraction <= cfg.bossHpFraction)) return undefined;
			return {
				kind,
				key: RECAP_STRINGS.nearBoss,
				vars: { pct: recapBossPercent(b.hpFraction) },
				bossKey: recapBossNameKey(b.bossId),
				countVar: "pct",
				dim,
			};
		}
		case "score": {
			const best = scoreToBeat(input);
			if (best === undefined) return undefined;
			const gap = best - input.score.total;
			if (gap <= 0 || gap > best * cfg.nearScoreFraction) return undefined;
			return { kind, key: RECAP_STRINGS.nearScore, vars: { gap }, countVar: "gap", dim };
		}
		case "recordFloor": {
			if (input.world === "daily" || input.baseline.kind !== "known") return undefined;
			const deepest = floorTarget(input.baseline);
			if (deepest === undefined || input.floor !== deepest) return undefined;
			return { kind, key: RECAP_STRINGS.nearRecordFloor, vars: {}, dim };
		}
		case "stairs": {
			const tiles = input.stairsTiles;
			if (input.bossFloor || tiles === undefined || tiles < 0 || tiles > cfg.stairsNearTiles) return undefined;
			return {
				kind,
				key: RECAP_STRINGS.nearStairs,
				vars: { tiles, next: input.floor + 1 },
				countVar: "tiles",
				dim,
			};
		}
		case "fullClear": {
			const left = input.roomsUncleared;
			if (input.bossFloor || left < 1 || left > cfg.roomsLeftMax || input.roomsCleared < 1) return undefined;
			if (left === 1) return { kind, key: RECAP_STRINGS.nearFullClearOne, vars: { rooms: left }, dim };
			return { kind, key: RECAP_STRINGS.nearFullClear, vars: { rooms: left }, countVar: "rooms", dim };
		}
		case "nextBoss": {
			const id = input.nextBossId;
			if (id === undefined || id === "") return undefined;
			return { kind, key: RECAP_STRINGS.nearNextBoss, vars: {}, bossKey: recapBossNameKey(id), dim };
		}
	}
}

/** The candidates in RRD2's order. */
export const RECAP_NEAR_MISS_ORDER: ReadonlyArray<RecapNearMissKind> = [
	"boss",
	"score",
	"recordFloor",
	"stairs",
	"fullClear",
	"nextBoss",
];

/** The run's near-miss line, or undefined (see the file comment). */
export function nearMissFor(input: RunRecapInput, cfg: RecapConfig = RECAP): RecapNearMiss | undefined {
	if (input.world !== "endless" && input.world !== "daily") return undefined;
	const records = input.records;
	if (records.record && records.first) return undefined;
	const scoreRecord = records.record && hasRecordRow(records, "score");
	const floorRecord = records.record && hasRecordRow(records, "floor");
	for (const kind of RECAP_NEAR_MISS_ORDER) {
		if (kind === "score" && scoreRecord) continue;
		if (kind === "recordFloor" && floorRecord) continue;
		const c = candidate(kind, input, cfg);
		if (c !== undefined) return c;
	}
	return undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Highlights

/** How the counted value prints: a plain integer (the caller's thousands format), or combo tenths (formatCombo). */
export type RecapValueFormat = "int" | "combo";

/** One highlight cell. */
export interface RecapHighlight {
	readonly id: RecapHighlightId;
	/** The label's string key. */
	readonly key: string;
	/** The final value (counted up from `from` on the timeline). */
	readonly value: number;
	readonly from: number;
	readonly format: RecapValueFormat;
	/** The value's text template (`{n} of {total}`: {n} = the counted value), with `vars`; undefined: the number alone. */
	readonly valueKey?: string;
	readonly vars?: Readonly<Record<string, number>>;
	/** Co-op: `team` (the party's value) / `you` (the view player's own); undefined: no label (solo, or the label says). */
	readonly scope: "team" | "you" | undefined;
	/** Combo: the tier's colour role (COMBO_TIERS role). */
	readonly colourRole?: string;
	/** Combo: the tier name's string key (`hud.combo.dominating`). */
	readonly tierKey?: string;
}

interface Candidate {
	readonly value: number;
	readonly notable: boolean;
	readonly from?: number;
	readonly format?: RecapValueFormat;
	readonly valueKey?: string;
	readonly vars?: Readonly<Record<string, number>>;
	readonly colourRole?: string;
	readonly tierKey?: string;
}

function plain(value: number, min: number): Candidate {
	return { value, notable: value >= min };
}

/** The value and notable test of highlight `def` for this run (undefined: not in this run at all). */
function evaluate(def: RecapHighlightDef, input: RunRecapInput, coop: boolean): Candidate | undefined {
	const s = input.score;
	const team = input.team ?? NO_TEAM_MOMENTS;
	const kills = bossKillsOf(input.depth, input.startDepth);
	switch (def.id) {
		case "bossNoHit":
			return plain(bossNoHitAwards(countOf(s, ScoreSource.BOSS), input.depth, input.startDepth), def.min);
		case "bosses":
			return plain(kills, def.min);
		case "combo": {
			const tier = comboTier(s.maxCombo);
			const t = COMBO_TIERS[tier];
			return {
				value: s.maxCombo,
				notable: tier >= def.min,
				from: COMBO_MIN,
				format: "combo",
				colourRole: t.role,
				tierKey: t.nameKey,
			};
		}
		case "perfect": {
			const n = countOf(s, ScoreSource.PERFECT);
			const total = countOf(s, ScoreSource.ROOMS);
			const share = def.minShare !== undefined && total > 0 && n > 0 && n >= total * def.minShare;
			return { value: n, notable: n >= def.min || share, valueKey: RECAP_STRINGS.hlOfTotal, vars: { total } };
		}
		case "teamStreak":
			return plain(team.bestTeamStreak, def.min);
		case "duos":
			return plain(input.builds.duos, def.min);
		case "evolved":
			return plain(input.builds.evolutions, def.min);
		case "parries":
			return plain(input.tally.parries[input.viewIndex] ?? 0, def.min);
		case "syncParries":
			return plain(team.syncParries, def.min);
		case "sweeps":
			return hasSource(s, ScoreSource.SWEEP) ? plain(countOf(s, ScoreSource.SWEEP), def.min) : undefined;
		case "chests":
			return input.chests !== undefined ? plain(input.chests.opened, def.min) : undefined;
		case "grazes":
			return plain(coop ? input.tally.grazes[input.viewIndex] ?? 0 : countOf(s, ScoreSource.GRAZES), def.min);
		case "jackpots":
			return hasSource(s, ScoreSource.JACKPOT) ? plain(countOf(s, ScoreSource.JACKPOT), def.min) : undefined;
		case "speed":
			return {
				value: pointsOf(s, ScoreSource.FAST),
				notable: countOf(s, ScoreSource.FAST) >= def.min,
				valueKey: RECAP_STRINGS.hlPoints,
			};
		case "kills":
			return plain(input.kills, def.min);
		case "rooms":
			return plain(countOf(s, ScoreSource.ROOMS), def.min);
	}
}

function cellOf(def: RecapHighlightDef, c: Candidate, coop: boolean): RecapHighlight {
	return {
		id: def.id,
		key: coop && def.coopKey !== undefined ? def.coopKey : def.key,
		value: c.value,
		from: c.from ?? 0,
		format: c.format ?? "int",
		valueKey: c.valueKey,
		vars: c.vars,
		scope: coop && def.coop !== "label" ? def.coop : undefined,
		colourRole: c.colourRole,
		tierKey: c.tierKey,
	};
}

/** The run's highlights, in order (see the file comment). */
export function pickHighlights(input: RunRecapInput, cfg: RecapConfig = RECAP): RecapHighlight[] {
	const out: RecapHighlight[] = [];
	if (input.world === "other") return out;
	const coop = input.partySize >= 2;
	let takenPriority = -1;
	for (const def of RECAP_HIGHLIGHTS) {
		if (out.size() >= cfg.maxHighlights) break;
		if (def.priority === takenPriority || (def.coopOnly === true && !coop)) continue;
		const c = evaluate(def, input, coop);
		if (c === undefined || !c.notable) continue;
		out.push(cellOf(def, c, coop));
		takenPriority = def.priority;
	}
	for (const def of RECAP_FILL) {
		if (out.size() >= cfg.minHighlights) break;
		const c = evaluate(def, input, coop);
		if (c !== undefined) out.push(cellOf(def, c, coop));
	}
	return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Stairs distance

/** The death floor's grid and stairwell (EndlessFloorWorld's stairX / stairZ, state.endless.stairsOpen). */
export interface RecapStairsFloor {
	readonly dungeon: Dungeon;
	readonly stairX: number;
	readonly stairZ: number;
	readonly stairsOpen: boolean;
	/** Cells (y * W + x) left out like walls (e.g. unbroken breakables); absent: none. */
	readonly blocked?: ReadonlySet<number>;
}

/**
 * Walking distance in tiles (BFS steps) from world (x, z) to the open stairwell; undefined when the stairs are closed
 * or nothing connects them. Allocates one field of W x H: call it once, at run over.
 */
export function stairsPathTiles(floor: RecapStairsFloor, x: number, z: number): number | undefined {
	if (!floor.stairsOpen) return undefined;
	const f = pathField(floor.dungeon, floor.stairX, floor.stairZ, undefined, floor.blocked);
	if (f.gx < 0) return undefined;
	const d = pathDistance(f, x, z);
	return d === math.huge ? undefined : d;
}

// ---------------------------------------------------------------------------------------------------------------
// Timeline

/** One row to show: counts from `from` to `to` (integers) when `counted`, else just appears. */
export interface RecapRowSpec {
	readonly from: number;
	readonly to: number;
	readonly counted: boolean;
}

/** The near-miss line's row (counted when it has a number). */
export function recapNearMissRow(n: RecapNearMiss): RecapRowSpec {
	const v = n.countVar !== undefined ? n.vars[n.countVar] ?? 0 : 0;
	return { from: 0, to: v, counted: n.countVar !== undefined };
}

/** A highlight's row. */
export function recapHighlightRow(h: RecapHighlight): RecapRowSpec {
	return { from: h.from, to: h.value, counted: true };
}

export interface RecapTimelineOptions {
	/** The near-miss line's row (undefined: no line). */
	readonly nearMiss: RecapRowSpec | undefined;
	readonly highlights: ReadonlyArray<RecapRowSpec>;
	/** A record run: how long NB's record rows take (seconds from the run-over frame). Undefined: not a record run. */
	readonly recordRowsSec?: number;
	/** No count-up: values show final, one land at the end. */
	readonly reducedMotion: boolean;
	/** Start at this clock (a verdict's silent re-derive): rows already due show final, with no sound. Default 0. */
	readonly atSec?: number;
}

/** One row's state (read after step). */
export interface RecapRowState {
	readonly startSec: number;
	readonly endSec: number;
	readonly from: number;
	readonly to: number;
	readonly counted: boolean;
	visible: boolean;
	/** The counted value now (`from` until it shows; `to` once landed). */
	value: number;
	landed: boolean;
}

/** One step's output (reused: valid until the next step). */
export interface RecapFrame {
	/** Play sfx.score.tick (a counted value moved; at most one a frame). */
	tick: boolean;
	/** Play sfx.score.land this many times (rows that landed this frame; 1 at the end under reduced motion or a skip). */
	lands: number;
	/** A confirm / FIRE press retries now (RRD6). */
	armed: boolean;
	/** Armed on this step (the focus ring brightens). */
	armedNow: boolean;
	/** Every row shows its final value. */
	settled: boolean;
}

/** The recap's clock (see the file comment). */
export class RecapTimeline {
	/** Row 0 is the near-miss line when there is one (`nearMissRow`), then the highlights in order. */
	readonly rows: RecapRowState[] = [];
	/** The near-miss line's row index (-1: none); highlight i is row firstHighlightRow + i. */
	readonly nearMissRow: number;
	readonly firstHighlightRow: number;
	/** When every row has landed (reduced motion: shown), seconds. */
	readonly settleSec: number;

	private readonly cfg: RecapConfig;
	private readonly reduced: boolean;
	private readonly out: RecapFrame = { tick: false, lands: 0, armed: false, armedNow: false, settled: false };
	private t: number;
	private skipped = false;
	private skipLand = false;
	private endLanded = false;

	constructor(options: RecapTimelineOptions, cfg: RecapConfig = RECAP) {
		this.cfg = cfg;
		this.reduced = options.reducedMotion;
		const rowsSec = options.recordRowsSec;
		const record = rowsSec !== undefined;
		const base = rowsSec !== undefined ? rowsSec + cfg.afterRecordRowsSec : cfg.highlightsStartSec;
		const nm = options.nearMiss;
		this.nearMissRow = nm !== undefined ? 0 : -1;
		if (nm !== undefined) this.addRow(nm, record ? base : cfg.nearMissDelaySec, cfg.countSec);
		this.firstHighlightRow = this.rows.size();
		for (let i = 0; i < options.highlights.size(); i++) {
			this.addRow(options.highlights[i], base + i * cfg.highlightGapSec, cfg.highlightCountSec);
		}
		let settle = 0;
		for (const r of this.rows) settle = math.max(settle, r.endSec);
		this.settleSec = settle;
		this.t = math.max(0, options.atSec ?? 0);
		// Rows already due (a re-derive): final, landed, silent.
		for (const r of this.rows) {
			if (this.t < r.startSec) continue;
			r.visible = true;
			if (this.reduced || this.t >= r.endSec) {
				r.value = r.to;
				r.landed = true;
			} else {
				r.value = countedValue(r, this.t);
			}
		}
		this.endLanded = this.t >= this.settleSec && this.rows.size() > 0;
		this.out.armed = this.t >= cfg.retryArmSec;
		this.out.settled = this.t >= this.settleSec;
	}

	/** Seconds since the run-over frame. */
	elapsed(): number {
		return this.t;
	}

	isSettled(): boolean {
		return this.out.settled;
	}

	isArmed(): boolean {
		return this.out.armed;
	}

	/** One rendered frame of `dt` real seconds. */
	step(dt: number): RecapFrame {
		const out = this.out;
		out.tick = false;
		out.lands = 0;
		const wasArmed = out.armed;
		this.t += math.max(0, dt);
		out.armed = this.t >= this.cfg.retryArmSec;
		out.armedNow = out.armed && !wasArmed;
		if (this.skipped) {
			if (this.skipLand) out.lands = 1;
			this.skipLand = false;
			out.settled = true;
			return out;
		}
		const t = this.t;
		let moved = false;
		let allShown = true;
		for (const r of this.rows) {
			if (t < r.startSec) {
				allShown = false;
				continue;
			}
			r.visible = true;
			if (r.landed) continue;
			if (this.reduced) {
				r.value = r.to;
				r.landed = true;
				continue;
			}
			if (t >= r.endSec) {
				r.value = r.to;
				r.landed = true;
				if (r.counted) out.lands += 1;
				continue;
			}
			const v = countedValue(r, t);
			if (v !== r.value) {
				r.value = v;
				moved = true;
			}
		}
		out.tick = moved;
		if (this.reduced && allShown && !this.endLanded && this.rows.size() > 0) {
			this.endLanded = true;
			if (this.hasCounted()) out.lands = 1;
		}
		out.settled = t >= this.settleSec;
		return out;
	}

	/** Jump to the settled state: every row final; one land on the next step (when something had not landed). */
	skip(): void {
		if (this.skipped || this.out.settled) return;
		this.skipped = true;
		// Reduced motion lands once at the end; otherwise each counted row lands on its own.
		let pending = this.reduced && !this.endLanded && this.hasCounted();
		for (const r of this.rows) {
			if (!this.reduced && r.counted && !r.landed) pending = true;
			r.visible = true;
			r.value = r.to;
			r.landed = true;
		}
		this.skipLand = pending;
		this.endLanded = true;
		this.out.settled = true;
	}

	/** A confirm / FIRE press: "retry" once armed; before that it skips the timeline (RRD6) and answers "skip". */
	press(): "skip" | "retry" {
		if (this.out.armed) return "retry";
		this.skip();
		return "skip";
	}

	private addRow(spec: RecapRowSpec, start: number, dur: number): void {
		const endSec = spec.counted && !this.reduced ? start + dur : start;
		this.rows.push({
			startSec: start,
			endSec,
			from: spec.from,
			to: spec.to,
			counted: spec.counted,
			visible: false,
			value: spec.from,
			landed: false,
		});
	}

	private hasCounted(): boolean {
		for (const r of this.rows) if (r.counted) return true;
		return false;
	}
}

/** Row `r`'s counted value at `t` (integer steps from `from` toward `to`). */
function countedValue(r: RecapRowState, t: number): number {
	const dur = r.endSec - r.startSec;
	if (dur <= 0 || t >= r.endSec) return r.to;
	const u = math.clamp((t - r.startSec) / dur, 0, 1);
	const span = r.to - r.from;
	return r.from + (span >= 0 ? math.floor(span * u) : math.ceil(span * u));
}

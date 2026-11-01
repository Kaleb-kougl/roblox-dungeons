// docs/NEW_BEST.md NB3: the frozen run baseline (records -> unranked / unknown / none / known, the debug override), the
// NewBestTracker (target row thresholds, the crossing once on the SHOWN score, held under the stage cover, none after
// run over, the deepest edge on the first floor past the record only, the timelines, reduced motion) and the pure
// helpers (row text, stairwell line, run-over records / rows / roll / save chip, best line, confetti paths).
import { describe, expect, it } from "@rbxts/jest-globals";
import { RANKED_WORLD_KIND } from "shared/play";
import type { StringVars } from "shared/theme";
import { HUD_TEST_TOP_INSET, HUD_TEST_VIEWPORTS, clearZoneRect } from "./footprint";
import {
	NO_NEW_BEST_CUES,
	NewBestTracker,
	baselineFrom,
	baselineRecord,
	bestText,
	boardFor,
	confettiPieceAt,
	debugBaseline,
	floorTarget,
	isRecordRun,
	newBestRowText,
	parseNewBestDebug,
	recordRollEdges,
	recordRollValue,
	recordRowText,
	recordSavedKey,
	runOverRecords,
	runOverRibbonKey,
	scoreTarget,
	stageBestLine,
	type ConfettiPiece,
	type NewBestFrame,
	type NewBestRecordsInput,
	type RunBaseline,
	withPendingRuns,
} from "./newBest";
import { NEW_BEST, NEW_BEST_ROLE } from "./newBestConfig";
import { NEW_BEST_STRINGS } from "./newBestStrings";

const STEP = 1 / 60;
const EPS = 1e-9;
const ENDLESS = RANKED_WORLD_KIND;

const known = (score: number, floor: number, board: "solo" | "coop" = "solo"): RunBaseline => ({
	kind: "known",
	board,
	score,
	floor,
});
const none = (score = 0, floor = 0): RunBaseline => ({ kind: "none", board: "solo", score, floor });

interface Over {
	shown?: number;
	score?: number;
	floor?: number;
	covered?: boolean;
	runOver?: boolean;
	reducedMotion?: boolean;
	dt?: number;
}

/** Steps a tracker one frame as NewBestController would. The true score defaults to the shown one. */
function step(t: NewBestTracker, o: Over = {}): NewBestFrame {
	const shown = o.shown ?? 0;
	return t.frame({
		dt: o.dt ?? STEP,
		shownScore: shown,
		score: o.score ?? shown,
		floor: o.floor ?? 1,
		underCover: o.covered ?? false,
		runOver: o.runOver ?? false,
		reducedMotion: o.reducedMotion ?? false,
	});
}

/** A fake ThemePack.str: the key, then each var in a fixed order ("hud.best.toGo|points=12"). */
const VAR_ORDER = ["points", "floor", "n", "old", "new", "delta", "score"];
function str(key: string, vars?: StringVars): string {
	let out = key;
	if (vars !== undefined) {
		for (const name of VAR_ORDER) {
			const v = vars[name];
			if (v !== undefined) out += `|${name}=${v}`;
		}
	}
	return out;
}
const grouped = (n: number) => `<${n}>`;

describe("new best: config", () => {
	it("holds the plan's numbers", () => {
		expect([NEW_BEST.minScore, NEW_BEST.reachFraction, NEW_BEST.pulseHz]).toEqual([1000, 0.1, 1]);
		expect([NEW_BEST.slam.fromScale, NEW_BEST.slam.sec]).toEqual([1.6, 0.12]);
		expect([NEW_BEST.confetti.inRun.count, NEW_BEST.confetti.inRun.lifeSec]).toEqual([40, 1.2]);
		expect(NEW_BEST.confetti.runOver.lifeSec > NEW_BEST.confetti.inRun.lifeSec).toBe(true);
		expect(NEW_BEST.runOver.rowDelaySec).toBe(0.3);
		expect(NEW_BEST.debugAttribute).toBe("KV_NewBestDebug");
		expect(NEW_BEST_ROLE).toBe("newBest");
	});
});

describe("new best: baseline", () => {
	const records: NewBestRecordsInput = {
		loaded: true,
		solo: { score: 48210, floor: 9 },
		coop: { score: 3000, floor: 4 },
	};

	it("is unranked outside the ranked world or in an unscored run", () => {
		expect(baselineFrom(records, 1, "tutorial", true)).toEqual({ kind: "unranked" });
		expect(baselineFrom(records, 1, "game", true)).toEqual({ kind: "unranked" });
		expect(baselineFrom(records, 1, ENDLESS, false)).toEqual({ kind: "unranked" });
	});

	it("is unknown while the records are missing or failed to load", () => {
		expect(baselineFrom(undefined, 1, ENDLESS, true)).toEqual({ kind: "unknown", board: "solo" });
		expect(baselineFrom({ loaded: false }, 3, ENDLESS, true)).toEqual({ kind: "unknown", board: "coop" });
	});

	it("solo runs read the solo record, party runs the co-op record (boards)", () => {
		expect([boardFor(1), boardFor(2), boardFor(4)]).toEqual(["solo", "coop", "coop"]);
		expect(baselineFrom(records, 1, ENDLESS, true)).toEqual(known(48210, 9));
		expect(baselineFrom(records, 2, ENDLESS, true)).toEqual(known(3000, 4, "coop"));
	});

	it("no record on the board, or a best under minScore, is none (its numbers kept)", () => {
		expect(baselineFrom({ loaded: true }, 1, ENDLESS, true)).toEqual(none());
		expect(baselineFrom({ loaded: true, solo: { score: 999, floor: 3 } }, 1, ENDLESS, true)).toEqual(none(999, 3));
		expect(baselineFrom({ loaded: true, solo: { score: 1000, floor: 3 } }, 1, ENDLESS, true)).toEqual(
			known(1000, 3),
		);
		// junk counts as no record
		const junk = { loaded: true, solo: { score: -5, floor: 0 / 0 } } as NewBestRecordsInput;
		expect(baselineFrom(junk, 1, ENDLESS, true)).toEqual(none());
	});

	it("targets: a known baseline's score and floor when > 0, else none", () => {
		expect([scoreTarget(known(5000, 3)), floorTarget(known(5000, 3))]).toEqual([5000, 3]);
		expect([scoreTarget(known(0, 3)), floorTarget(known(5000, 0))]).toEqual([undefined, undefined]);
		for (const b of [
			none(999, 3),
			{ kind: "unknown", board: "solo" } as RunBaseline,
			{ kind: "unranked" } as RunBaseline,
		])
			expect([b.kind, scoreTarget(b), floorTarget(b)]).toEqual([b.kind, undefined, undefined]);
	});

	it("a records update mid-run never moves the tracker's baseline (frozen at construction)", () => {
		const live = { loaded: true, solo: { score: 2000, floor: 3 } };
		const t = new NewBestTracker(baselineFrom(live, 1, ENDLESS, true));
		live.solo.score = 99999;
		live.solo.floor = 50;
		expect(step(t, { shown: 1500 }).gap).toBe(501);
		expect(step(t, { shown: 2001 }).scoreCrossed).toBe(true);
		expect(t.look.recordFloor).toBe(3);
	});
});

describe("new best: pending runs (withPendingRuns)", () => {
	const records: NewBestRecordsInput = {
		loaded: true,
		solo: { score: 48210, floor: 9 },
		coop: { score: 3000, floor: 4 },
	};

	it("folds a pending run on the same board into the baseline, max per field", () => {
		// R-restart right after a 61,930 run on floor 8: the next run aims at 61,930 and floor 9.
		const folded = withPendingRuns(records, "solo", [{ board: "solo", score: 61930, floor: 8 }]);
		expect(folded).toEqual({ loaded: true, solo: { score: 61930, floor: 9 }, coop: { score: 3000, floor: 4 } });
		expect(baselineFrom(folded, 1, ENDLESS, true)).toEqual(known(61930, 9));
		// Two pending runs: each field takes the higher.
		const two = withPendingRuns(records, "solo", [
			{ board: "solo", score: 50000, floor: 12 },
			{ board: "solo", score: 55000, floor: 3 },
		]);
		expect(two?.solo).toEqual({ score: 55000, floor: 12 });
	});

	it("ignores other boards and lower runs (the records themselves when nothing changes)", () => {
		expect(withPendingRuns(records, "solo", [{ board: "coop", score: 90000, floor: 20 }])).toBe(records);
		expect(withPendingRuns(records, "solo", [{ board: "solo", score: 100, floor: 2 }])).toBe(records);
		expect(withPendingRuns(records, "solo", [])).toBe(records);
		const coop = withPendingRuns(records, "coop", [{ board: "coop", score: 4000, floor: 1 }]);
		expect(coop).toEqual({ loaded: true, solo: { score: 48210, floor: 9 }, coop: { score: 4000, floor: 4 } });
	});

	it("turns a first record into a target once a pending run set one", () => {
		const first = withPendingRuns({ loaded: true }, "solo", [{ board: "solo", score: 2500, floor: 3 }]);
		expect(baselineFrom(first, 1, ENDLESS, true)).toEqual(known(2500, 3));
		// Junk claims count as nothing.
		const junk = withPendingRuns({ loaded: true }, "solo", [{ board: "solo", score: 0 / 0, floor: -1 }]);
		expect(baselineFrom(junk, 1, ENDLESS, true)).toEqual(none());
	});

	it("leaves unknown records unknown", () => {
		const claim = [{ board: "solo" as const, score: 61930, floor: 8 }];
		expect(withPendingRuns(undefined, "solo", claim)).toBe(undefined);
		const failed = { loaded: false };
		expect(withPendingRuns(failed, "solo", claim)).toBe(failed);
		expect(baselineFrom(withPendingRuns(failed, "solo", claim), 1, ENDLESS, true)).toEqual({
			kind: "unknown",
			board: "solo",
		});
	});
});

describe("new best: KV_NewBestDebug", () => {
	it("parses score, floor, both, first and unknown", () => {
		expect(parseNewBestDebug("score:500")).toEqual({ kind: "set", score: 500, floor: 0 });
		expect(parseNewBestDebug("floor:2")).toEqual({ kind: "set", score: 0, floor: 2 });
		expect(parseNewBestDebug(" Score:2000, floor:3 ")).toEqual({ kind: "set", score: 2000, floor: 3 });
		expect(parseNewBestDebug("first")).toEqual({ kind: "first" });
		expect(parseNewBestDebug("unknown")).toEqual({ kind: "unknown" });
	});

	it("anything else is no override", () => {
		for (const v of [
			undefined,
			5,
			true,
			"",
			"score",
			"score:",
			"score:-1",
			"score:1.5",
			"score:abc",
			"lives:3",
			"score:1,",
		])
			expect([v, parseNewBestDebug(v)]).toEqual([v, undefined]);
	});

	it("forces the baseline: first is no record, a set is known with exactly those numbers (no minScore rule)", () => {
		expect(debugBaseline({ kind: "first" }, "solo")).toEqual(none());
		expect(debugBaseline({ kind: "unknown" }, "coop")).toEqual({ kind: "unknown", board: "coop" });
		expect(debugBaseline({ kind: "set", score: 500, floor: 0 }, "solo")).toEqual(known(500, 0));
		const t = new NewBestTracker(debugBaseline({ kind: "set", score: 500, floor: 0 }, "solo"));
		expect(step(t, { shown: 100 }).line).toBe("chasing");
		// floor 0 = no floor target: no deepest edge, no record floor
		expect(step(t, { shown: 100, floor: 7 }).deepestReached).toBe(false);
		expect(t.look.recordFloor).toBe(0);
	});
});

describe("new best: tracker target row", () => {
	it("no baseline (none / unknown / unranked): an empty row and no edge, whatever the score and floor", () => {
		const bases: RunBaseline[] = [none(), none(999, 3), { kind: "unknown", board: "solo" }, { kind: "unranked" }];
		for (const b of bases) {
			const t = new NewBestTracker(b);
			for (let f = 1; f <= 12; f++) {
				const look = step(t, { shown: f * 10000, floor: f });
				expect([
					b.kind,
					look.line,
					look.scoreCrossed,
					look.deepestReached,
					look.deeperYet,
					look.fanfare,
				]).toEqual([b.kind, "none", false, false, false, false]);
				expect([b.kind, look.goldMix, look.confettiAge, look.shoutAge, look.recordFloor]).toEqual([
					b.kind,
					0,
					-1,
					-1,
					0,
				]);
			}
		}
	});

	it("chasing, within reach (gap <= 10 % of the best), passed; the gap is what the shown score still needs", () => {
		const t = new NewBestTracker(known(10000, 9));
		const at = (shown: number) => {
			const l = step(t, { shown });
			return [l.line, l.gap, l.margin];
		};
		expect(at(0)).toEqual(["chasing", 10001, 0]);
		expect(at(8999)).toEqual(["chasing", 1002, 0]);
		expect(at(9000)).toEqual(["chasing", 1001, 0]);
		expect(at(9001)).toEqual(["reach", 1000, 0]);
		expect(at(10000)).toEqual(["reach", 1, 0]);
		expect(at(10001)).toEqual(["passed", 0, 1]);
		expect(at(13120)).toEqual(["passed", 0, 3120]);
	});

	it("the reach pulse runs at NEW_BEST.pulseHz (0 at entry, 1 at half a period) and only while within reach", () => {
		const t = new NewBestTracker(known(10000, 9));
		expect(step(t, { shown: 5000 }).pulse).toBe(0);
		expect(step(t, { shown: 9500, dt: 0 }).pulse).toBe(0);
		// a quarter period in 0.05 s frames (each under NEW_BEST.maxFrameDtSec)
		const frame = 0.05;
		const quarter = math.round(1 / (4 * NEW_BEST.pulseHz) / frame);
		const advance = (n: number, reducedMotion = false) => {
			let look = t.look;
			for (let i = 0; i < n; i++) look = step(t, { shown: 9500, dt: frame, reducedMotion });
			return look.pulse;
		};
		expect(advance(quarter)).toBeCloseTo(0.5, 9);
		expect(advance(quarter)).toBeCloseTo(1, 9);
		// kept under reduced motion (a colour, not a movement)
		expect(advance(2 * quarter, true)).toBeCloseTo(0, 9);
		expect(step(t, { shown: 10001 }).pulse).toBe(0);
	});
});

describe("new best: the crossing", () => {
	it("fires once per run, the frame the shown score first exceeds the best", () => {
		const t = new NewBestTracker(known(2000, 9));
		expect(step(t, { shown: 1999 }).scoreCrossed).toBe(false);
		expect(step(t, { shown: 2000 }).scoreCrossed).toBe(false);
		const look = step(t, { shown: 2001 });
		expect([look.scoreCrossed, look.fanfare, look.deepestReached]).toEqual([true, true, false]);
		for (let i = 0; i < 120; i++) {
			const l = step(t, { shown: 2001 + i * 50 });
			expect([i, l.scoreCrossed, l.fanfare]).toEqual([i, false, false]);
		}
	});

	it("follows the SHOWN score: a room bonus held by the roller crosses when it lands, not when the sim awards it", () => {
		const t = new NewBestTracker(known(10000, 9));
		// the sim's total is past the best, the panel still shows 9,500 (bonus held)
		const held = step(t, { shown: 9500, score: 12000 });
		expect([held.line, held.scoreCrossed, held.goldMix]).toEqual(["reach", false, 0]);
		// the run already holds a record on the true numbers (the run-over jingle never waits for the roller)
		expect(held.recordRun).toBe(true);
		const landed = step(t, { shown: 10600, score: 12000 });
		expect([landed.line, landed.scoreCrossed]).toEqual(["passed", true]);
	});

	it("under the stage cover it waits for the first uncovered frame (the reveal)", () => {
		const t = new NewBestTracker(known(2000, 9));
		const covered = step(t, { shown: 2500, covered: true });
		expect([covered.line, covered.scoreCrossed, covered.fanfare, covered.goldMix]).toEqual([
			"passed",
			false,
			false,
			0,
		]);
		expect(step(t, { shown: 2600, covered: true }).scoreCrossed).toBe(false);
		const reveal = step(t, { shown: 2600 });
		expect([reveal.scoreCrossed, reveal.fanfare, reveal.goldMix, reveal.whiteFlash]).toEqual([true, true, 1, 1]);
		expect(step(t, { shown: 2700 }).scoreCrossed).toBe(false);
	});

	it("never fires after run over; one held by the cover is dropped by the run over", () => {
		const over = new NewBestTracker(known(2000, 9));
		expect(step(over, { shown: 2500, runOver: true }).scoreCrossed).toBe(false);
		expect(step(over, { shown: 2600 }).scoreCrossed).toBe(false);
		const held = new NewBestTracker(known(2000, 9));
		step(held, { shown: 2500, covered: true });
		expect(step(held, { shown: 2500, covered: true, runOver: true }).scoreCrossed).toBe(false);
		expect(step(held, { shown: 2500, runOver: true }).scoreCrossed).toBe(false);
		expect(held.look.goldMix).toBe(0);
	});

	it("co-op compares the team score with the co-op best", () => {
		const records = { loaded: true, solo: { score: 50000, floor: 9 }, coop: { score: 3000, floor: 4 } };
		const t = new NewBestTracker(baselineFrom(records, 3, ENDLESS, true));
		expect(step(t, { shown: 2999 }).line).toBe("reach");
		expect(step(t, { shown: 3001 }).scoreCrossed).toBe(true);
	});

	it("the timelines: slam 1.6 -> 1 over 0.12 s, white flash 1 -> 0 over flashSec, gold held, one shine, the shout and confetti", () => {
		const t = new NewBestTracker(known(2000, 9));
		const look = step(t, { shown: 2001 });
		expect(look.slamScale).toBeCloseTo(NEW_BEST.slam.fromScale, 9);
		expect([look.whiteFlash, look.goldMix, look.shoutAge, look.confettiAge]).toEqual([1, 1, 0, 0]);
		expect(look.confettiSeed).toBe(1);
		let elapsed = 0;
		let sawShine = false;
		let shineEnded = false;
		while (elapsed < NEW_BEST.shout.lifeSec + 0.2) {
			const l = step(t, { shown: 2001, dt: STEP });
			elapsed += STEP;
			if (elapsed >= NEW_BEST.slam.sec + EPS) expect([elapsed, l.slamScale]).toEqual([elapsed, 1]);
			if (elapsed >= NEW_BEST.flashSec + EPS) expect([elapsed, l.whiteFlash]).toEqual([elapsed, 0]);
			expect(l.goldMix).toBe(1);
			if (l.shine >= 0) {
				expect(shineEnded).toBe(false);
				sawShine = true;
			} else if (sawShine) shineEnded = true;
			if (elapsed >= NEW_BEST.confetti.inRun.lifeSec + EPS)
				expect([elapsed, l.confettiAge]).toEqual([elapsed, -1]);
			if (elapsed >= NEW_BEST.shout.lifeSec + EPS) expect([elapsed, l.shoutAge]).toEqual([elapsed, -1]);
		}
		expect([sawShine, shineEnded]).toEqual([true, true]);
	});

	it("reduced motion: no slam, shine or confetti; the gold, the flash, the shout and the fanfare stay", () => {
		const t = new NewBestTracker(known(2000, 9));
		const look = step(t, { shown: 2001, reducedMotion: true });
		expect([look.scoreCrossed, look.fanfare, look.slamScale, look.shine, look.confettiAge]).toEqual([
			true,
			true,
			1,
			-1,
			-1,
		]);
		expect([look.goldMix, look.whiteFlash, look.shoutAge]).toEqual([1, 1, 0]);
		const later = step(t, { shown: 2001, dt: 0.1, reducedMotion: true });
		expect([later.slamScale, later.shine, later.confettiAge]).toEqual([1, -1, -1]);
	});

	it("clamps a long frame to NEW_BEST.maxFrameDtSec", () => {
		const t = new NewBestTracker(known(2000, 9));
		step(t, { shown: 2001 });
		expect(step(t, { shown: 2001, dt: 5 }).confettiAge).toBeCloseTo(NEW_BEST.maxFrameDtSec, 9);
	});
});

describe("new best: the deepest floor", () => {
	it("deepestReached on the first floor past the record only, deeperYet on each later new floor", () => {
		const t = new NewBestTracker(known(50000, 3));
		expect(t.look.recordFloor).toBe(3);
		for (const f of [1, 2, 3]) {
			const l = step(t, { floor: f });
			expect([f, l.deepestReached, l.deeperYet, l.fanfare, l.deeper]).toEqual([f, false, false, false, false]);
		}
		const first = step(t, { floor: 4 });
		expect([first.deepestReached, first.deeperYet, first.fanfare, first.deeper]).toEqual([true, false, true, true]);
		expect(first.confettiAge).toBe(0);
		// the same floor again: nothing
		expect(step(t, { floor: 4 }).deepestReached).toBe(false);
		const later = step(t, { floor: 5 });
		expect([later.deepestReached, later.deeperYet, later.fanfare]).toEqual([false, true, false]);
		expect(step(t, { floor: 6 }).deeperYet).toBe(true);
		expect(step(t, { floor: 6 }).deeperYet).toBe(false);
	});

	it("a floor change under the cover plays at the reveal (deepest and deeper yet alike)", () => {
		const t = new NewBestTracker(known(50000, 3));
		step(t, { floor: 3 });
		expect(step(t, { floor: 4, covered: true }).deepestReached).toBe(false);
		expect(step(t, { floor: 4, covered: true }).deepestReached).toBe(false);
		const reveal = step(t, { floor: 4 });
		expect([reveal.deepestReached, reveal.fanfare]).toEqual([true, true]);
		expect(step(t, { floor: 5, covered: true }).deeperYet).toBe(false);
		expect(step(t, { floor: 5 }).deeperYet).toBe(true);
	});

	it("none after run over", () => {
		const t = new NewBestTracker(known(50000, 3));
		step(t, { floor: 3 });
		step(t, { floor: 4, covered: true });
		expect(step(t, { floor: 4, runOver: true }).deepestReached).toBe(false);
		expect(step(t, { floor: 4 }).deepestReached).toBe(false);
	});

	it("the crossing and the deepest edge on one frame are one fanfare (and one confetti burst)", () => {
		const t = new NewBestTracker(known(2000, 3));
		step(t, { shown: 1000, floor: 3, covered: true });
		const both = step(t, { shown: 2500, floor: 4 });
		expect([both.scoreCrossed, both.deepestReached, both.fanfare, both.confettiSeed]).toEqual([
			true,
			true,
			true,
			1,
		]);
		// a later burst gets a new seed
		const t2 = new NewBestTracker(known(2000, 3));
		step(t2, { shown: 2500, floor: 3 });
		expect(step(t2, { shown: 2500, floor: 4 }).confettiSeed).toBe(2);
	});
});

describe("new best: recordRun (the run-over jingle swap)", () => {
	it("known: past the best score or the deepest floor on the true numbers; below both: no", () => {
		const b = known(10000, 5);
		expect([isRecordRun(b, 10000, 5), isRecordRun(b, 10001, 1), isRecordRun(b, 0, 6)]).toEqual([false, true, true]);
		// a debug baseline without a floor target never counts the floor (and vice versa)
		expect([isRecordRun(known(2000, 0), 100, 9), isRecordRun(known(0, 2), 99999, 2)]).toEqual([false, false]);
	});

	it("none: any run above the stored numbers (a first record always); unknown / unranked: never", () => {
		expect([
			isRecordRun(none(), 0, 1),
			isRecordRun(none(999, 3), 500, 3),
			isRecordRun(none(999, 3), 1000, 1),
		]).toEqual([true, false, true]);
		expect(isRecordRun({ kind: "unknown", board: "solo" }, 99999, 99)).toBe(false);
		expect(isRecordRun({ kind: "unranked" }, 99999, 99)).toBe(false);
	});

	it("the tracker reports it every frame; NO_NEW_BEST_CUES plays nothing", () => {
		const t = new NewBestTracker(known(10000, 5));
		expect(step(t, { shown: 0, score: 9000, floor: 5 }).recordRun).toBe(false);
		expect(step(t, { shown: 0, score: 9000, floor: 6, runOver: true }).recordRun).toBe(true);
		expect(NO_NEW_BEST_CUES).toEqual({ fanfare: false, recordFloor: 0, recordRun: false });
	});
});

describe("new best: text", () => {
	it("the target row: empty, N TO BEST (compact -N), NEW BEST +N (compact NEW BEST), numbers through the formatter", () => {
		const K = NEW_BEST_STRINGS;
		expect(newBestRowText({ line: "none", gap: 0, margin: 0 }, false, str)).toBe("");
		expect(newBestRowText({ line: "chasing", gap: 12340, margin: 0 }, false, str, grouped)).toBe(
			`${K.toGo}|points=<12340>`,
		);
		expect(newBestRowText({ line: "reach", gap: 1240, margin: 0 }, true, str, grouped)).toBe(
			`${K.toGoShort}|points=<1240>`,
		);
		expect(newBestRowText({ line: "passed", gap: 0, margin: 3120 }, false, str, grouped)).toBe(
			`${K.over}|points=<3120>`,
		);
		expect(newBestRowText({ line: "passed", gap: 0, margin: 3120 }, true, str)).toBe(K.newBest);
		// plain digits by default
		expect(newBestRowText({ line: "chasing", gap: 7, margin: 0 }, false, str)).toBe(`${K.toGo}|points=7`);
	});

	it("the stairwell card's line: floors to go (one key for every n), record floor, NEW DEEPEST then Deepest yet (gold); none without a floor target", () => {
		const K = NEW_BEST_STRINGS;
		const b = known(5000, 9);
		expect(stageBestLine(7, b, false)).toEqual({ key: K.stageToGo, args: { floor: 9, n: 2 }, gold: false });
		expect(stageBestLine(8, b, false)).toEqual({ key: K.stageToGo, args: { floor: 9, n: 1 }, gold: false });
		expect(stageBestLine(9, b, false)).toEqual({ key: K.stageRecordFloor, args: undefined, gold: false });
		expect(stageBestLine(10, b, false)).toEqual({ key: K.stageNewDeepest, args: undefined, gold: true });
		expect(stageBestLine(11, b, true)).toEqual({ key: K.stageDeeperYet, args: undefined, gold: true });
		for (const nb of [none(), known(5000, 0), { kind: "unknown", board: "solo" } as RunBaseline])
			expect(stageBestLine(3, nb, false)).toBe(undefined);
	});
});

describe("new best: run over", () => {
	it("known: the improved fields as rows (score first), with their deltas; neither is no record", () => {
		const b = known(48210, 9);
		expect(runOverRecords(b, 61930, 11)).toEqual({
			record: true,
			first: false,
			fromServer: false,
			rows: [
				{ kind: "score", from: 48210, to: 61930, delta: 13720 },
				{ kind: "floor", from: 9, to: 11, delta: 2 },
			],
		});
		expect(runOverRecords(b, 50000, 9).rows).toEqual([{ kind: "score", from: 48210, to: 50000, delta: 1790 }]);
		expect(runOverRecords(b, 40000, 10).rows).toEqual([{ kind: "floor", from: 9, to: 10, delta: 1 }]);
		expect(runOverRecords(b, 48210, 9)).toEqual({ record: false, first: false, fromServer: false, rows: [] });
	});

	it("none: a first record from no record, a NEW BEST over a low best, nothing below it", () => {
		const first = runOverRecords(none(), 800, 2);
		expect([first.record, first.first, first.rows.size()]).toEqual([true, true, 2]);
		const low = runOverRecords(none(999, 3), 1500, 3);
		expect([low.record, low.first, low.rows]).toEqual([
			true,
			false,
			[{ kind: "score", from: 999, to: 1500, delta: 501 }],
		]);
		expect(runOverRecords(none(999, 3), 500, 2).record).toBe(false);
	});

	it("the server's verdict records win (an unknown baseline celebrates from them); unranked never", () => {
		const server = { scoreImproved: true, floorImproved: false, previous: { score: 40000, floor: 12 } };
		const fromServer = runOverRecords(known(48210, 9), 61930, 11, server);
		expect(fromServer).toEqual({
			record: true,
			first: false,
			fromServer: true,
			rows: [{ kind: "score", from: 40000, to: 61930, delta: 21930 }],
		});
		expect(runOverRecords({ kind: "unknown", board: "solo" }, 61930, 11).record).toBe(false);
		expect(runOverRecords({ kind: "unknown", board: "solo" }, 61930, 11, server).record).toBe(true);
		const notImproved = { scoreImproved: false, floorImproved: false, previous: { score: 1, floor: 1 } };
		expect(runOverRecords(known(100, 1), 61930, 11, notImproved)).toEqual({
			record: false,
			first: false,
			fromServer: true,
			rows: [],
		});
		const firstOnServer = { scoreImproved: true, floorImproved: true, previous: { score: 0, floor: 0 } };
		expect(runOverRecords(known(100, 1), 500, 2, firstOnServer).first).toBe(true);
		expect(runOverRecords({ kind: "unranked" }, 61930, 11, server).record).toBe(false);
	});

	it("the ribbon, the rows' text and roll, the save chip", () => {
		const K = NEW_BEST_STRINGS;
		const rec = runOverRecords(known(48210, 9), 61930, 11);
		expect(runOverRibbonKey(rec)).toBe(K.ribbon);
		expect(runOverRibbonKey(runOverRecords(none(), 10, 1))).toBe(K.first);
		expect(runOverRibbonKey(runOverRecords(known(48210, 9), 1, 1))).toBe(undefined);
		expect(recordRowText(rec.rows[0], 61930, str, grouped)).toBe(
			`${K.scoreRow}|old=<48210>|new=<61930>|delta=<13720>`,
		);
		// floors are never run through the score formatter
		expect(recordRowText(rec.rows[1], 10, str, grouped)).toBe(`${K.floorRow}|old=9|new=10|delta=1`);

		const R = NEW_BEST.runOver;
		const row = rec.rows[0];
		expect(recordRollValue(row, 0, 0)).toBe(row.from);
		expect(recordRollValue(row, 0, R.rowDelaySec)).toBe(row.from);
		const mid = recordRollValue(row, 0, R.rowDelaySec + R.rollSec / 2);
		expect(mid > row.from && mid < row.to).toBe(true);
		expect(mid).toBe(math.floor(mid));
		expect(recordRollValue(row, 0, R.rowDelaySec + R.rollSec)).toBe(row.to);
		// the second row starts rowGapSec later
		expect(recordRollValue(rec.rows[1], 1, R.rowDelaySec + R.rowGapSec)).toBe(9);
		expect(recordRollValue(rec.rows[1], 1, R.rowDelaySec + R.rowGapSec + R.rollSec)).toBe(11);
		let last = row.from;
		for (let t = 0; t <= 3; t += STEP) {
			const v = recordRollValue(row, 0, t);
			expect(v >= last).toBe(true);
			last = v;
		}

		const server = runOverRecords(known(48210, 9), 61930, 11, {
			scoreImproved: true,
			floorImproved: true,
			previous: { score: 48210, floor: 9 },
		});
		expect(recordSavedKey(server, "accepted")).toBe(K.saved);
		expect(recordSavedKey(rec, "accepted")).toBe(undefined); // waiting for the server's records
		expect(recordSavedKey(rec, "pending")).toBe(undefined);
		expect(recordSavedKey(rec, "rejected")).toBe(K.unsaved);
		expect(recordSavedKey(rec, "skipped")).toBe(undefined);
		const noRecord = runOverRecords(known(48210, 9), 1, 1);
		expect([recordSavedKey(noRecord, "accepted"), recordSavedKey(noRecord, "rejected")]).toEqual([
			undefined,
			undefined,
		]);
	});

	it("the dim Best line (run over, pause, menu)", () => {
		const K = NEW_BEST_STRINGS;
		expect(bestText({ score: 48210, floor: 9 }, K.target, str, grouped)).toBe(`${K.target}|floor=9|score=<48210>`);
		expect(bestText({ score: 48210, floor: 9 }, K.menu, str)).toBe(`${K.menu}|floor=9|score=48210`);
		expect(bestText(undefined, K.target, str)).toBe("");
		expect(bestText({ score: 0, floor: 3 }, K.target, str)).toBe("");
		expect(baselineRecord(known(48210, 9))).toEqual({ score: 48210, floor: 9 });
		expect(baselineRecord(none(999, 3))).toEqual({ score: 999, floor: 3 });
		expect(baselineRecord({ kind: "unknown", board: "solo" })).toBe(undefined);
	});
});

describe("new best: confetti", () => {
	const C = NEW_BEST.confetti;

	it("in-run pieces never enter the clear zone's columns (every test viewport, with and without the top bar)", () => {
		const out: ConfettiPiece = { x: 0, y: 0, sizePx: 0, rotationDeg: 0, transparency: 0, tone: 0 };
		const bad: string[] = [];
		for (const vp of HUD_TEST_VIEWPORTS) {
			for (const inset of [0, HUD_TEST_TOP_INSET]) {
				const zone = clearZoneRect(vp.x, vp.y, inset);
				let alive = 0;
				for (const seed of [1, 2, 7]) {
					for (let i = 0; i < C.inRun.count; i++) {
						for (let t = 0; t < C.inRun.lifeSec; t += 0.05) {
							const p = confettiPieceAt(seed, i, t, vp.x, vp.y, zone, false, out);
							if (p === undefined) continue;
							alive++;
							const half = p.sizePx / 2;
							const leftOfZone = p.x + half <= zone.x - C.edgeMarginPx + EPS;
							const rightOfZone = p.x - half >= zone.x + zone.w + C.edgeMarginPx - EPS;
							const onScreen = p.x - half >= -EPS && p.x + half <= vp.x + EPS;
							const sane =
								p.transparency >= 0 &&
								p.transparency <= 1 &&
								p.sizePx >= C.minSizePx &&
								p.sizePx <= C.maxSizePx;
							// one expect per bad piece only (an expect per sample would take seconds headlessly)
							if (!(leftOfZone || rightOfZone) || !onScreen || !sane)
								bad.push(
									`${vp.x}x${vp.y}+${inset} seed ${seed} piece ${i} t ${t}: x ${p.x} size ${p.sizePx}`,
								);
						}
					}
				}
				expect([vp.x, vp.y, inset, alive > 0]).toEqual([vp.x, vp.y, inset, true]);
			}
		}
		expect(bad).toEqual([]);
	});

	it("even pieces fall left of the zone, odd ones right; each starts above the top and falls", () => {
		const zone = clearZoneRect(1920, 1080);
		const a = confettiPieceAt(3, 4, C.inRun.lifeSec - 0.01, 1920, 1080, zone, false)!;
		const b = confettiPieceAt(3, 5, C.inRun.lifeSec - 0.01, 1920, 1080, zone, false)!;
		expect([a.x < zone.x, b.x > zone.x + zone.w]).toEqual([true, true]);
		let prevY = -math.huge;
		let started = false;
		for (let t = 0; t < C.inRun.lifeSec; t += STEP) {
			const p = confettiPieceAt(9, 0, t, 1920, 1080, zone, false);
			if (p === undefined) {
				expect(started).toBe(false);
				continue;
			}
			if (!started) expect(p.y <= 0).toBe(true);
			started = true;
			expect(p.y > prevY).toBe(true);
			prevY = p.y;
		}
		expect(started).toBe(true);
	});

	it("not in the air before its start or after the burst's life; deterministic per seed and piece", () => {
		const zone = clearZoneRect(1280, 720);
		expect(confettiPieceAt(1, 0, -0.01, 1280, 720, zone, false)).toBe(undefined);
		expect(confettiPieceAt(1, 0, C.inRun.lifeSec, 1280, 720, zone, false)).toBe(undefined);
		expect(confettiPieceAt(1, 0, C.runOver.lifeSec - 0.01, 1280, 720, zone, true)).never.toBe(undefined);
		expect(confettiPieceAt(4, 3, 0.6, 1280, 720, zone, false)).toEqual(
			confettiPieceAt(4, 3, 0.6, 1280, 720, zone, false),
		);
		const p1 = confettiPieceAt(4, 3, 0.6, 1280, 720, zone, false)!;
		const p2 = confettiPieceAt(5, 3, 0.6, 1280, 720, zone, false);
		expect(p2 === undefined || p2.x !== p1.x || p2.sizePx !== p1.sizePx).toBe(true);
		// each piece fades out over the last fadeShare of its own flight, starting fully opaque
		expect(confettiPieceAt(4, 3, C.inRun.lifeSec - 1e-3, 1280, 720, zone, false)!.transparency > 0.9).toBe(true);
	});

	it("a band too narrow for a piece has none (no piece is squeezed into the zone)", () => {
		const wide = { x: 2, y: 0, w: 96, h: 100 };
		for (let i = 0; i < C.inRun.count; i++) {
			for (let t = 0; t < C.inRun.lifeSec; t += 0.1)
				expect(confettiPieceAt(1, i, t, 100, 100, wide, false)).toBe(undefined);
		}
	});

	it("run over: full screen, pieces over the middle too", () => {
		const zone = clearZoneRect(1920, 1080);
		let middle = 0;
		for (let i = 0; i < C.runOver.count; i++) {
			const p = confettiPieceAt(2, i, C.runOver.lifeSec / 2, 1920, 1080, zone, true);
			if (p !== undefined && p.x > zone.x && p.x < zone.x + zone.w) middle++;
		}
		expect(middle > 0).toBe(true);
	});
});

describe("recordRollEdges (NB9: the run-over roll's tick / land sounds)", () => {
	const R = NEW_BEST.runOver;

	it("one start and one landing per row, at recordRollValue's times", () => {
		const startAt = R.rowDelaySec;
		expect(recordRollEdges(2, 0, startAt - STEP)).toEqual({ started: 0, landed: 0 });
		expect(recordRollEdges(2, startAt - STEP, startAt)).toEqual({ started: 1, landed: 0 });
		expect(recordRollEdges(2, startAt, startAt + R.rowGapSec)).toEqual({ started: 1, landed: 0 });
		expect(recordRollEdges(2, startAt + R.rowGapSec, startAt + R.rollSec)).toEqual({ started: 0, landed: 1 });
		expect(recordRollEdges(2, startAt + R.rollSec, startAt + R.rowGapSec + R.rollSec)).toEqual({
			started: 0,
			landed: 1,
		});
		// The second row lands when its value reaches row.to.
		const row = { kind: "floor" as const, from: 9, to: 11, delta: 2 };
		expect(recordRollValue(row, 1, startAt + R.rowGapSec + R.rollSec)).toBe(row.to);
	});

	it("summed over frames (or one long hitch) every edge counts exactly once; no rows, no edges", () => {
		let started = 0;
		let landed = 0;
		let prev = 0;
		for (let t = STEP; t <= 4; t += STEP) {
			const e = recordRollEdges(2, prev, t);
			started += e.started;
			landed += e.landed;
			prev = t;
		}
		expect([started, landed]).toEqual([2, 2]);
		expect(recordRollEdges(2, 0, 10)).toEqual({ started: 2, landed: 2 });
		expect(recordRollEdges(0, 0, 10)).toEqual({ started: 0, landed: 0 });
		const out = { started: 9, landed: 9 };
		expect(recordRollEdges(1, 10, 11, out)).toBe(out);
		expect(out).toEqual({ started: 0, landed: 0 });
	});
});

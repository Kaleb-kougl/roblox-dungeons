import type { VerdictView } from "client/store";
import {
	baselineRecord,
	dailyServerRecords,
	isDailyBaseline,
	runOverRecords,
	type NewBestRecord,
	type NewBestVerdictStatus,
	type RunBaseline,
	type RunOverRecords,
} from "shared/view/hud";

/** The run over's new-best view (runOverBest): the record and the verdict as the save chip reads it. */
export interface RunOverBest {
	/** The run's baseline belongs to this run and is ranked (else nothing new-best is drawn: the old panel). */
	readonly ranked: boolean;
	readonly records: RunOverRecords;
	readonly status: NewBestVerdictStatus;
	/** The record to show in the dim `Best ...` line of a run with no record (the server's previous wins), or none. */
	readonly target: NewBestRecord | undefined;
	/** A daily run (docs/DAILY.md DS10): best today, its strings (ribbon, record row, target line). */
	readonly daily: boolean;
}

const UNRANKED: RunOverBest = {
	ranked: false,
	records: { record: false, first: false, fromServer: false, rows: [] },
	status: "pending",
	target: undefined,
	daily: false,
};

/**
 * The run-over panel's new-best state (docs/NEW_BEST.md NB9), the same for the panel (RunOverPanel) and the controller
 * that rolls its rows and throws its confetti (NewBestController), so both always agree: shared/view/hud runOverRecords
 * from the run's frozen `baseline` (only when it belongs to `run`, the RunInfo.run on screen) and the run's final
 * `score` / `floor` (the HUD snapshot), or, once an ACCEPTED verdict for this run carried the server's records, from
 * those and the server's own final numbers (the server wins). The verdict's status for recordSavedKey: pending until
 * this run's verdict arrives (none / pending), then accepted / rejected / skipped. A daily run's baseline (best today,
 * docs/DAILY.md DS10) reads the verdict's `daily` (improved / previous: dailyServerRecords) in place of its records.
 */
export function runOverBest(
	baseline: RunBaseline,
	baselineRun: number,
	run: number,
	verdict: VerdictView,
	score: number,
	floor: number,
): RunOverBest {
	if (baselineRun !== run || baseline.kind === "unranked") return UNRANKED;
	const current = verdict.run === run;
	const status: NewBestVerdictStatus =
		!current || verdict.status === "none" || verdict.status === "pending" ? "pending" : verdict.status;
	const daily = isDailyBaseline(baseline);
	const accepted = current && verdict.status === "accepted";
	const server = !accepted ? undefined : daily ? dailyServerRecords(verdict.daily) : verdict.records;
	const records =
		server !== undefined
			? runOverRecords(baseline, verdict.serverScore ?? score, verdict.serverFloor ?? floor, server)
			: runOverRecords(baseline, score, floor);
	const target = server !== undefined ? server.previous : baselineRecord(baseline);
	return { ranked: true, records, status, target, daily };
}

/**
 * The rollback spike's opt-in sweep (docs/ROLLBACK_SPIKE.md Design 2, 4, task R2): L x D x guess strategy over a
 * recordPartyRun bot run, the noisy bot's run and every capture present, printing docs/ROLLBACK_SPIKE.md's Results rows.
 * Off by default (one trivial test). Turn it on with the runner flag (no rebuild needed after the first build):
 *
 *   npm run build && npm run test:only -- lockstep/rollbackSpike/model.sweep --flag rollbackSweep
 *
 * (scripts/lune/run-tests.luau puts `--flag` names in `_G.KV_SPEC_FLAGS`), or set `ROLLBACK_SPIKE.model.sweep.enabled`
 * (config.ts) for Studio. It takes minutes: sizes in `ROLLBACK_SPIKE.model.sweep`.
 *
 * Windows: each bot run whole (`windowFrames` 0, the default: floor 1 walked and fought, the drafts, floor 5's rooms
 * and boss), or two of `windowFrames` (its first floor 1 fight and its boss fight), merged, for observing players
 * 0 .. `players` - 1;
 * a capture one from its start (`captureFrames`), after its replay matched the server's hash. Captures are the
 * gitignored modules scripts/gen-fixtures.js writes from `captures/*.json` (captureModules.ts): none, none swept.
 */
import { describe, expect, it } from "@rbxts/jest-globals";
import { ROLLBACK_GUESS_STRATEGIES } from "shared/spikes";
import { recordNoisyPartyRun, recordPartyRun } from "shared/run/testing";
import { recordingPartySize, type Recording, type SimConfig } from "shared/sim";
import {
	RESULTS_TABLE_HEADER,
	ROLLBACK_SPIKE,
	RollbackMetrics,
	RoomKind,
	captureModelInput,
	firstTickWhere,
	formatMetricsRow,
	formatResultsRow,
	loadCaptureModules,
	metricsTableHeader,
	roomTypeOf,
	runModelOverRecording,
	sharedRootOf,
} from ".";

const SWEEP = ROLLBACK_SPIKE.model.sweep;
/** The runner flag that turns the sweep on (scripts/lune/run-tests.luau `--flag`). */
const SWEEP_FLAG = "rollbackSweep";

function specFlag(name: string): boolean {
	const flags = (_G as unknown as { KV_SPEC_FLAGS?: { readonly [k: string]: boolean } }).KV_SPEC_FLAGS;
	return flags !== undefined && flags[name] === true;
}

const ENABLED = SWEEP.enabled || specFlag(SWEEP_FLAG);

interface SweepInput {
	readonly name: string;
	readonly config: Readonly<SimConfig>;
	readonly recording: Recording;
	readonly windows: ReadonlyArray<readonly [number, number]>;
	readonly log: ReadonlyArray<string>;
}

/** A bot run's windows: the whole run (windowFrames 0), else its first floor 1 fight and its boss fight. */
function botWindows(config: Readonly<SimConfig>, recording: Recording): Array<readonly [number, number]> {
	const out: Array<readonly [number, number]> = [];
	if (SWEEP.windowFrames <= 0) {
		out.push([0, recording.frames.size()]);
		return out;
	}
	const fight = firstTickWhere(config, recording, (s) => roomTypeOf(s, 0) === RoomKind.COMBAT);
	if (fight !== undefined) out.push([fight, fight + SWEEP.windowFrames]);
	const boss = firstTickWhere(config, recording, (s) => roomTypeOf(s, 0) === RoomKind.BOSS);
	if (boss !== undefined) out.push([boss, boss + SWEEP.windowFrames]);
	return out;
}

function inputs(): SweepInput[] {
	const out: SweepInput[] = [];
	const b = recordPartyRun(SWEEP.seed, SWEEP.partySize);
	out.push({
		name: "bot",
		config: b.setup.config,
		recording: b.recording,
		windows: botWindows(b.setup.config, b.recording),
		log: b.log,
	});
	const nz = recordNoisyPartyRun(SWEEP.seed, SWEEP.partySize);
	out.push({
		name: "noisy bot",
		config: nz.setup.config,
		recording: nz.recording,
		windows: botWindows(nz.setup.config, nz.recording),
		log: nz.log,
	});
	for (const { name, capture } of loadCaptureModules(sharedRootOf(script as LuaSourceContainer), print)) {
		const input = captureModelInput(capture);
		if (input === undefined) {
			print(`[R2 sweep] capture ${name}: unknown world ${capture.setup.worldKind}, skipped`);
			continue;
		}
		if (input.hashOk === false) {
			print(`[R2 sweep] capture ${name}: replay does not match the server's hash, skipped`);
			continue;
		}
		const s = capture.setup;
		out.push({
			name: `capture ${name}`,
			config: input.config,
			recording: input.recording,
			windows: [[0, math.min(input.ticks, SWEEP.captureFrames)]],
			log: [`${s.worldKind} seed ${s.seed}, ${s.partySize} players, ${input.ticks} ticks, hash ${input.hashOk}`],
		});
	}
	return out;
}

describe("rollback spike sweep (R2, opt-in)", () => {
	if (!ENABLED) {
		it(`is off (runner --flag ${SWEEP_FLAG}, or ROLLBACK_SPIKE.model.sweep.enabled)`, () => {
			expect(ENABLED).toBe(false);
		});
		return;
	}

	it("prints the Results rows: L x D x strategy over the bot runs and captures", () => {
		const t0 = os.clock();
		const rows: string[] = [];
		const wide: string[] = [];
		for (const input of inputs()) {
			const players = math.min(SWEEP.players, recordingPartySize(input.recording));
			print(
				`[R2 sweep] ${input.name} (${input.recording.frames.size()} ticks; ${input.log.join(
					"; ",
				)}): windows ${input.windows.map((w) => `${w[0]}+${w[1] - w[0]}`).join(", ")}`,
			);
			for (const l of SWEEP.leads) {
				for (const d of SWEEP.depths) {
					for (const strategy of ROLLBACK_GUESS_STRATEGIES) {
						const merged = new RollbackMetrics();
						let sec = 0;
						for (let p = 0; p < players; p++) {
							for (const [from, to] of input.windows) {
								const r = runModelOverRecording(input.config, input.recording, {
									playerIndex: p,
									L: l,
									D: d,
									strategy,
									fromTick: from,
									toTick: to,
								});
								merged.merge(r.metrics);
								sec += r.runtimeSec;
							}
						}
						const row = formatResultsRow(input.name, l, d, strategy, merged);
						rows.push(row);
						wide.push(formatMetricsRow(`${input.name} | ${l} | ${d} | ${strategy}`, merged));
						print(
							`${row}  (${string.format("%.0f", sec)} s, ${string.format(
								"%.0f",
								merged.totalSeconds(),
							)} s play)`,
						);
					}
				}
			}
		}
		print(
			[
				"",
				RESULTS_TABLE_HEADER,
				...rows,
				"",
				metricsTableHeader("Input | L | D | Strategy"),
				...wide,
				"",
				string.format("[R2 sweep] %.0f s", os.clock() - t0),
			].join("\n"),
		);
		expect(rows.size()).toBeGreaterThan(0);
	});
});

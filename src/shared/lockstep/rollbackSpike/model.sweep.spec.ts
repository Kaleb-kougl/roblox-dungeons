/**
 * The rollback spike's opt-in sweep (docs/ROLLBACK_SPIKE.md Design 2, 4, task R2): L x D x guess strategy over a
 * recordPartyRun bot run, the noisy bot's run and every capture present, printing docs/ROLLBACK_SPIKE.md's Results rows.
 * Off by default (one trivial test): turn on `ROLLBACK_SPIKE.model.sweep.enabled` (config.ts), `npm run build`, then
 * `npm run test:only -- lockstep/rollbackSpike/model.sweep`. It takes minutes (the generic copy costs ~25 ms a frame
 * here): sizes in `ROLLBACK_SPIKE.model.sweep`.
 *
 * Windows: each bot run contributes two (its first floor 1 fight and its boss fight, `windowFrames` each, merged);
 * a capture one from its start (`captureFrames`). Captures are the gitignored modules scripts/gen-fixtures.js writes
 * from `captures/*.json` (shared/fixtures-generated/captures/<runId>), found at run time: none, none swept.
 */
import { describe, expect, it } from "@rbxts/jest-globals";
import { ROLLBACK_GUESS_STRATEGIES, decodeCapture, type DecodedCapture } from "shared/spikes";
import { buildWorldSetup, isRunWorldKind } from "shared/run";
import { recordNoisyPartyRun, recordPartyRun } from "shared/run/testing";
import type { Recording, SimConfig } from "shared/sim";
import {
	RESULTS_TABLE_HEADER,
	ROLLBACK_SPIKE,
	RollbackMetrics,
	RoomKind,
	firstTickWhere,
	formatResultsRow,
	roomTypeOf,
	runModelOverRecording,
} from ".";

const SWEEP = ROLLBACK_SPIKE.model.sweep;

interface SweepInput {
	readonly name: string;
	readonly config: Readonly<SimConfig>;
	readonly recording: Recording;
	readonly windows: ReadonlyArray<readonly [number, number]>;
	readonly log: ReadonlyArray<string>;
}

/** The capture modules gen-fixtures wrote (shared/fixtures-generated/captures), decoded. */
function loadCaptures(): Array<{ readonly name: string; readonly capture: DecodedCapture }> {
	const out: Array<{ readonly name: string; readonly capture: DecodedCapture }> = [];
	const root = script.Parent?.Parent?.Parent;
	const folder = root?.FindFirstChild("fixtures-generated")?.FindFirstChild("captures");
	if (folder === undefined) return out;
	for (const child of folder.GetChildren()) {
		if (child.ClassName !== "ModuleScript") continue;
		const mod = require(child as ModuleScript) as { default: { meta: unknown; chunks: unknown } };
		const capture = decodeCapture(mod.default.meta, mod.default.chunks);
		if (capture === undefined) {
			print(`[R2 sweep] capture ${child.Name}: does not decode, skipped`);
			continue;
		}
		out.push({ name: child.Name, capture });
	}
	return out;
}

/** The bot run's two windows: its first floor 1 fight and its boss fight. */
function botWindows(config: Readonly<SimConfig>, recording: Recording): Array<readonly [number, number]> {
	const out: Array<readonly [number, number]> = [];
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
	for (const { name, capture } of loadCaptures()) {
		const s = capture.setup;
		if (!isRunWorldKind(s.worldKind)) continue;
		const setup = buildWorldSetup(s.worldKind, s.seed, { atBossDoor: s.atBossDoor, partySize: s.partySize });
		const ticks = math.min(capture.recording.frames.size(), capture.info.end?.verifiedTicks ?? math.huge);
		out.push({
			name: `capture ${name}`,
			config: setup.config,
			recording: capture.recording,
			windows: [[0, math.min(ticks, SWEEP.captureFrames)]],
			log: [`${s.worldKind} seed ${s.seed}, ${s.partySize} players, ${capture.recording.frames.size()} ticks`],
		});
	}
	return out;
}

describe("rollback spike sweep (R2, opt-in)", () => {
	if (!SWEEP.enabled) {
		it("is off (ROLLBACK_SPIKE.model.sweep.enabled)", () => {
			expect(SWEEP.enabled).toBe(false);
		});
		return;
	}

	it("prints the Results rows: L x D x strategy over the bot runs and captures", () => {
		const t0 = os.clock();
		const rows: string[] = [];
		for (const input of inputs()) {
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
						for (const [from, to] of input.windows) {
							const r = runModelOverRecording(input.config, input.recording, {
								playerIndex: 0,
								L: l,
								D: d,
								strategy,
								fromTick: from,
								toTick: to,
							});
							merged.merge(r.metrics);
							sec += r.runtimeSec;
						}
						const row = formatResultsRow(input.name, l, d, strategy, merged);
						rows.push(row);
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
		print(["", RESULTS_TABLE_HEADER, ...rows, "", string.format("[R2 sweep] %.0f s", os.clock() - t0)].join("\n"));
		expect(rows.size()).toBeGreaterThan(0);
	});
});

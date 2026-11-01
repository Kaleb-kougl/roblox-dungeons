// Builds offer statistics (docs/BUILDS.md BU13 item 3): 1000 simulated runs per pick policy ("greedy": an evolution,
// else a duo, else an upgrade, else the first card; "random"; "duo-seeking": greedy, but a new boon that completes a duo
// before an upgrade) on the real offer function and BUILD_RULES, tallied by floor 6 and floor 11 (shared/run/testing
// buildOffers.ts), then a sensitivity table of the BuildRules levers (by floor 11). Printed: the tables in the doc.
// Loose bounds only: every run is tallied, the greedy policy evolves at least as often as the random one, and the
// pity-off check never disagrees (simulateOffers throws).
import { describe, expect, it } from "@rbxts/jest-globals";
import { BUILD_RULES, type BuildRules } from "shared/sim";
import {
	formatBossDuo,
	formatOfferRow,
	formatPicks,
	offerHeader,
	simulateOffers,
	type PickPolicy,
} from "shared/run/testing";

const RUNS = 1000;
const CHECKPOINTS = [6, 11];
const POLICIES: ReadonlyArray<PickPolicy> = ["greedy", "random", "duo-seeking"];
/** BuildRules levers for the sensitivity table (each one change from BUILD_RULES). */
const VARIANTS: ReadonlyArray<readonly [string, Partial<BuildRules>]> = [
	["upgradePercent 25", { upgradePercent: 25 }],
	["upgradePercent 45", { upgradePercent: 45 }],
	["evolutionWeight 1", { evolutionWeight: 1 }],
	["evolutionWeight 3", { evolutionWeight: 3 }],
	["duoPercentBase 30", { duoPercentBase: 30 }],
	["upgradePityCards huge (no pity)", { upgradePityCards: math.huge }],
];

describe(`builds offers: ${RUNS} simulated runs per policy`, () => {
	it("by floor 6 and 11 (printed)", () => {
		print(`[builds tune] offers, ${RUNS} runs per policy`);
		print(`[builds tune] ${offerHeader()}`);
		const stats = POLICIES.map((p) => simulateOffers(p, RUNS, CHECKPOINTS));
		for (const st of stats) for (const t of st.checkpoints) print(`[builds tune] ${formatOfferRow(st.policy, t)}`);
		for (const st of stats) print(`[builds tune] ${formatBossDuo(st.policy, st)}`);
		for (const st of stats) print(`[builds tune] ${formatPicks(st.policy, st)}`);
		for (const st of stats) for (const t of st.checkpoints) expect(t.runs).toBe(RUNS);
		const last = CHECKPOINTS.size() - 1;
		expect(stats[0].checkpoints[last].evolutions >= stats[1].checkpoints[last].evolutions).toBe(true);
	});

	it("levers: one BuildRules change at a time, by floor 11 (printed)", () => {
		print(`[builds tune] offer levers, ${RUNS} runs per policy, by floor 11`);
		print(`[builds tune] | rules ${offerHeader()}`);
		for (const [label, change] of VARIANTS) {
			const rules: BuildRules = { ...BUILD_RULES, ...change };
			for (const policy of ["greedy", "random"] as const) {
				const st = simulateOffers(policy, RUNS, [11], rules);
				print(`[builds tune] | ${label} ${formatOfferRow(policy, st.checkpoints[0])}`);
				expect(st.checkpoints[0].runs).toBe(RUNS);
			}
		}
	});
});

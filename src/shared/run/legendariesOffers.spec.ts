// Offer statistics with four legendaries (docs/LEGENDARIES.md LG7): BU13's 1000 simulated runs per pick policy on the
// real offer function and BUILD_RULES (shared/run/testing buildOffers.ts), by floor 6 and 11, now with Overkill and
// Bastion in the legendary pool and their four duos; plus the legendary tallies (legendaries owned, runs owning and
// drafts offering each legendary) and Greed's deal for the build at the checkpoint. Printed: the tables in the doc,
// compared there with BU13's recorded numbers. Loose bounds only: every run is tallied, every legendary is offered in
// some draft, and a Greed deal never holds more than PACT_LEGENDARY_CARDS cards.
import { describe, expect, it } from "@rbxts/jest-globals";
import { PACT_LEGENDARY_CARDS } from "shared/sim";
import {
	formatBossDuo,
	formatLegendaryRow,
	formatOfferRow,
	formatPicks,
	legendaryBoons,
	legendaryHeader,
	offerHeader,
	simulateOffers,
	type PickPolicy,
} from "shared/run/testing";

const RUNS = 1000;
const CHECKPOINTS = [6, 11];
const POLICIES: ReadonlyArray<PickPolicy> = ["greedy", "random", "duo-seeking"];

describe(`legendaries offers: ${RUNS} simulated runs per policy`, () => {
	it("by floor 6 and 11, with the legendary tallies and Greed's deal (printed)", () => {
		const stats = POLICIES.map((p) => simulateOffers(p, RUNS, CHECKPOINTS));
		print(`[legendaries tune] offers, ${RUNS} runs per policy`);
		print(`[legendaries tune] ${offerHeader()}`);
		for (const st of stats)
			for (const t of st.checkpoints) print(`[legendaries tune] ${formatOfferRow(st.policy, t)}`);
		for (const st of stats) print(`[legendaries tune] ${formatBossDuo(st.policy, st)}`);
		for (const st of stats) print(`[legendaries tune] ${formatPicks(st.policy, st)}`);
		print(`[legendaries tune] legendaries, ${RUNS} runs per policy`);
		print(`[legendaries tune] ${legendaryHeader()}`);
		for (const st of stats)
			for (const t of st.checkpoints) print(`[legendaries tune] ${formatLegendaryRow(st.policy, t)}`);
		expect(legendaryBoons().size()).toBe(4);
		for (const st of stats) {
			for (const t of st.checkpoints) {
				expect(t.runs).toBe(RUNS);
				expect(t.greedCards <= t.greedDeals * PACT_LEGENDARY_CARDS).toBe(true);
			}
			const last = st.checkpoints[st.checkpoints.size() - 1];
			for (const b of legendaryBoons()) expect([b, last.draftsOfferingBoon[b] > 0]).toEqual([b, true]);
		}
	});
});

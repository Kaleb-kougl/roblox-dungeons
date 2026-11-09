// docs/ARCHER.md AR13: offer statistics per character pool against the old two-weapon pool. (1) BU13's simulated
// drafts (shared/run/testing buildOffers.ts simulateOffers, the real drawCardOffers / drawLegendaryOffers and
// BUILD_RULES, 1000 runs per policy) with no mask (both weapons), the Knight's mask and the Archer's (sim
// eligibleBoonMask of the character's loadout): evolutions and duos by floor 6 / 11, the legendaries, Greed's deal and
// its pool (an empty pool dims the Pact of Greed). (2) Relics: each pool's size (relicEligible) and the relic sources a
// run meets (pedestals: TREASURE rooms; vaults whose tier is Rare, kept uncracked) on real endless floors 1-10 of
// solo runs 1-20, so the floor a player taking every relic empties each pool. Printed: the tables in the doc.
import { describe, expect, it } from "@rbxts/jest-globals";
import { VaultTier } from "shared/dungeon";
import { RELIC_COUNT, RELICS, createSimState, eligibleBoonMask, relicEligible } from "shared/sim";
import { characterLoadout, type CharacterId } from "shared/characters";
import { buildEndlessRunConfig } from "shared/run";
import {
	formatBossDuo,
	formatLegendaryRow,
	formatOfferRow,
	legendaryHeader,
	offerHeader,
	simulateOffers,
	type PickPolicy,
} from "shared/run/testing";

const RUNS = 1000;
const CHECKPOINTS = [6, 11];
const POLICIES: ReadonlyArray<PickPolicy> = ["greedy", "random", "duo-seeking"];
const POOLS: ReadonlyArray<readonly [string, CharacterId | undefined]> = [
	["both weapons", undefined],
	["Knight", "knight"],
	["Archer", "archer"],
];
const RELIC_RUNS = 20;
const RELIC_FLOORS = 10;

function maskOf(id: CharacterId | undefined): boolean[] | undefined {
	return id === undefined
		? undefined
		: eligibleBoonMask(createSimState(1, 0, 0, { loadout: characterLoadout(id) }), 0, []);
}

const pct = (a: number, b: number) => (b > 0 ? string.format("%.1f%%", (100 * a) / b) : "-");

describe(`AR13 offers per character pool (${RUNS} simulated runs per policy)`, () => {
	it("evolutions, duos, legendaries and Greed by floor 6 / 11 (printed)", () => {
		const t0 = os.clock();
		print(`[archer tune] offers, ${RUNS} runs per policy and pool`);
		print(`[archer tune] | pool ${offerHeader()} Greed pool empty / mean size |`);
		const legendary: string[] = [];
		const evo11: number[] = [];
		for (const policy of POLICIES) {
			for (const [label, id] of POOLS) {
				const st = simulateOffers(policy, RUNS, CHECKPOINTS, undefined, maskOf(id));
				for (const t of st.checkpoints) {
					expect(t.runs).toBe(RUNS);
					print(
						`[archer tune] | ${label} ${formatOfferRow(policy, t)} ${pct(
							t.greedPoolEmpty,
							t.runs,
						)} / ${string.format("%.2f", t.greedPoolSize / t.runs)} |`,
					);
					legendary.push(`| ${label} ${formatLegendaryRow(policy, t)}`);
				}
				print(`[archer tune] ${label}: ${formatBossDuo(policy, st)}`);
				if (policy === "greedy") evo11.push(st.checkpoints[1].evolutions);
			}
		}
		print(`[archer tune] | pool ${legendaryHeader()}`);
		for (const line of legendary) print(`[archer tune] ${line}`);
		print(`[archer tune] offers: ${string.format("%.1f", os.clock() - t0)} s`);
		expect(evo11.size()).toBe(POOLS.size());
	});

	it("relic pools and the relic sources on real floors (printed)", () => {
		const t0 = os.clock();
		for (const [label, id] of POOLS) {
			const s = createSimState(1, 0, 0, id === undefined ? {} : { loadout: characterLoadout(id) });
			const names: string[] = [];
			for (let r = 0; r < RELIC_COUNT; r++) if (relicEligible(s, 0, r)) names.push(RELICS[r].id);
			print(`[archer tune] relic pool ${label}: ${names.size()} (${names.join(", ")})`);
		}
		// Per run: relic sources by the end of each floor (pedestals + Rare vaults).
		const sourcesBy: number[][] = [];
		for (let run = 1; run <= RELIC_RUNS; run++) {
			const setup = buildEndlessRunConfig(run, 1);
			const row: number[] = [];
			let n = 0;
			for (let floor = 1; floor <= RELIC_FLOORS; floor++) {
				const w = setup.endlessFloor(floor);
				for (const room of w.config.encounter?.rooms ?? []) if (room.type === "treasure") n++;
				if (w.vault !== undefined && w.vault.tier === VaultTier.RARE) n++;
				row.push(n);
			}
			sourcesBy.push(row);
		}
		const at = (floor: number) => {
			let sum = 0;
			for (const row of sourcesBy) sum += row[floor - 1];
			return sum / RELIC_RUNS;
		};
		print(
			`[archer tune] relic sources (pedestals + Rare vaults) per run, mean by the end of floor 1 / 2 / 3 / 5 / 10: ` +
				`${[1, 2, 3, 5, 10].map((f) => string.format("%.2f", at(f))).join(" / ")} (solo runs 1-${RELIC_RUNS})`,
		);
		for (const pool of [3, 4]) {
			const emptied: number[] = [];
			let never = 0;
			for (const row of sourcesBy) {
				let f = -1;
				for (let k = 0; k < row.size() && f < 0; k++) if (row[k] >= pool) f = k + 1;
				if (f < 0) never++;
				else emptied.push(f);
			}
			emptied.sort((a, b) => a < b);
			const median = emptied.size() > 0 ? emptied[math.floor(emptied.size() / 2)] : -1;
			print(
				`[archer tune] a pool of ${pool} relics, every one taken: emptied by floor 3 in ${pct(
					emptied.filter((f) => f <= 3).size(),
					RELIC_RUNS,
				)}, by floor ${RELIC_FLOORS} in ${pct(
					emptied.size(),
					RELIC_RUNS,
				)} (median floor ${median}; never ${never})`,
			);
		}
		print(`[archer tune] relics: ${string.format("%.1f", os.clock() - t0)} s`);
		expect(sourcesBy.size()).toBe(RELIC_RUNS);
	});
});

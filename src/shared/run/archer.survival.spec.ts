// docs/ARCHER.md AR13: endless survival per character (shared/run/testing survivalBot.ts: an honest solo descent, every
// room with planned spawns fought, the boss fought without debug hits, greedy drafts) for the Knight, the Archer (the
// bot's bow mode: kites, charges heavy shots back to back, rolls through volleys) and the old two-weapon player, the
// same run seeds for each, until death or floor 20. OPT-IN CENSUS: without the runner's `--census` flag
// (npm run test:only -- --census run/archer.survival) it runs a smoke sample (2 seeds to floor 3); with it,
// CENSUS_SEEDS. Printed: the tables in the doc. Loose bounds only: every run ends (dies or reaches the cap).
import { describe, expect, it } from "@rbxts/jest-globals";
import { SIM_HZ } from "shared/sim";
import {
	SURVIVAL_BANDS,
	censusRequested,
	summarizeSurvival,
	survivalRun,
	type SurvivalRun,
	type TuneCharacter,
} from "shared/run/testing";

const FULL = censusRequested();
const CENSUS_SEEDS = 12;
const SEEDS: number[] = [];
for (let k = 1; k <= (FULL ? CENSUS_SEEDS : 2); k++) SEEDS.push(k);
const MAX_FLOOR = FULL ? 20 : 3;

const f1 = (x: number) => string.format("%.1f", x);
const f2 = (x: number) => string.format("%.2f", x);

describe(`AR13 endless survival per character (${
	FULL ? "census" : "smoke"
}: seeds 1-${SEEDS.size()}, to floor ${MAX_FLOOR})`, () => {
	for (const who of ["knight", "archer", "both"] as ReadonlyArray<TuneCharacter>) {
		it(`${who} (printed)`, () => {
			const t0 = os.clock();
			const runs: SurvivalRun[] = [];
			for (const seed of SEEDS) {
				const r = survivalRun(seed, who, { maxFloor: MAX_FLOOR });
				runs.push(r);
				print(
					`[archer survival] ${who} seed ${seed}: floor ${r.floorReached}${
						r.died ? ` (died in ${r.deathIn})` : ""
					}, rooms ${r.rooms.size()}, bosses ${r.bosses
						.filter((b) => b.killed)
						.size()} / ${r.bosses.size()}, ` +
						`stuck ${r.stuck}, boons ${r.boons}, duos ${r.duos}, ${f1(r.ticks / SIM_HZ)} s sim`,
				);
				expect(r.died || r.floorReached === MAX_FLOOR + 1).toBe(true);
			}
			const sum = summarizeSurvival(who, runs, MAX_FLOOR);
			const alive = [2, 5, 6, 10, 11, 15, 16, 20, 21]
				.filter((f) => f <= MAX_FLOOR + 1)
				.map((f) => `f${f} ${sum.aliveAt[f]}`)
				.join(", ");
			print(
				`[archer survival] ${who}: runs ${sum.runs}, floor reached mean ${f1(sum.meanFloor)} / median ${f1(
					sum.medianFloor,
				)}, deaths ${sum.deaths} (room ${sum.deathsIn.room}, boss ${sum.deathsIn.boss}, travel ${
					sum.deathsIn.travel
				}); alive entering ${alive}`,
			);
			const bands = SURVIVAL_BANDS.map(
				([a, b], i) =>
					`f${a}-${b}: ${sum.bandRooms[i]} rooms, hits / room ${
						sum.bandRooms[i] > 0 ? f2(sum.bandHits[i] / sum.bandRooms[i]) : "-"
					}, s / room ${sum.bandRooms[i] > 0 ? f1(sum.bandSeconds[i] / sum.bandRooms[i]) : "-"}, cleared ${
						sum.bandCleared[i]
					}`,
			).join("; ");
			print(`[archer survival] ${who} rooms: ${bands}`);
			print(
				`[archer survival] ${who} bosses: ${sum.bossKills} / ${sum.bossFights} killed, hits / fight ${
					sum.bossFights > 0 ? f1(sum.bossHits / sum.bossFights) : "-"
				}, s / fight ${sum.bossFights > 0 ? f1(sum.bossSeconds / sum.bossFights) : "-"}; rolls ${
					sum.rolls
				}, guards ${sum.guards}, heavy arrows ${sum.heavies}, stuck floors ${sum.stuck}; ${f1(
					sum.ticks / SIM_HZ,
				)} s sim in ${f1(os.clock() - t0)} s`,
			);
			expect(sum.runs).toBe(SEEDS.size());
		});
	}
});

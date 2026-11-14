// docs/SILVER.md SV1: the Silver census. The honest solo Knight descent of shared/run/testing survivalBot.ts (every
// room fought, the boss without debug hits, greedy drafts), until death or the floor cap, observed tick by tick
// (Driver.onStep): Silver's run rows at the end of every floor (as if the run died there, every room of it cleared),
// at the run's real end, and the tick the second room cleared (the fastest paying run). OPT-IN CENSUS: without the
// runner's `--census` flag (npm run test:only -- --census run/silverCensus) it runs a smoke sample (2 seeds to floor
// 3); with it, CENSUS_SEEDS seeds to CENSUS_FLOOR. Runs at today's hearts and character tables (the heart cut, Vigor
// and crate Silver are other tracks: crates read 0 until SC2). Printed: Silver per run and per floor, the pacing table
// (runs / days to afford each ladder tier for floor-1-2 / 3 / 5 / 10 players, with and without the day bonuses) and
// the farm table (Silver per hour of the fastest two-room run vs normal play). Loose bounds only.
import { describe, expect, it } from "@rbxts/jest-globals";
import { SIM_HZ, ScoreSource, type SimState } from "shared/sim";
import { SILVER, runSilver, silverRunInputOf, type RunSilver, type SilverRunInput } from "shared/silver";
import { ARMORY_TIERS } from "shared/wallet";
import { censusRequested, survivalRun } from "shared/run/testing";

const FULL = censusRequested();
const CENSUS_SEEDS = 16;
const CENSUS_FLOOR = 10;
/** Immortal runs (to CENSUS_FLOOR) for the floor-5 and floor-10 profiles. */
const IMMORTAL_SEEDS = 6;
const SEEDS: number[] = [];
for (let k = 1; k <= (FULL ? CENSUS_SEEDS : 2); k++) SEEDS.push(k);
const MAX_FLOOR = FULL ? CENSUS_FLOOR : 3;
/** Seconds between two runs a real player spends outside the sim (run over, Again, the stage cover). */
const RESTART_SECONDS = 15;
/** Runs in "a day" (docs/SILVER.md: three short runs and the day bonuses, one of them the Daily). */
const RUNS_PER_DAY = 3;
const SECONDS_PER_HOUR = 3600;

const f0 = (x: number) => string.format("%.0f", x);
const f1 = (x: number) => string.format("%.1f", x);

interface FloorEnd {
	readonly silver: RunSilver;
	/** Sim ticks from the run's start to the floor change. */
	readonly tick: number;
}

interface CensusRun {
	readonly seed: number;
	readonly floorReached: number;
	readonly died: boolean;
	readonly final: RunSilver;
	readonly ticks: number;
	/** Per floor k: the rows had the run died at the end of floor k (the floor left, not descended). */
	readonly ends: Map<number, FloorEnd>;
	/** The tick the second room cleared (undefined: never). */
	readonly twoRoomTick?: number;
}

function censusRun(seed: number, immortal = false): CensusRun {
	let kills = 0;
	let last: SimState | undefined;
	let twoRoomTick: number | undefined;
	const ends = new Map<number, FloorEnd>();
	const r = survivalRun(seed, "knight", {
		maxFloor: MAX_FLOOR,
		immortal,
		onStep: (s) => {
			last = s;
			kills += s.events.enemiesKilled;
			const rooms = s.score?.counts[ScoreSource.ROOMS] ?? 0;
			if (twoRoomTick === undefined && rooms >= SILVER.minimumRooms) twoRoomTick = s.tick;
			if (s.events.floorChanged !== 0 && s.endless !== undefined) {
				const left = s.endless.floor - 1;
				const input: SilverRunInput = { ...silverRunInputOf(s, { kills }), floor: left };
				ends.set(left, { silver: runSilver(input), tick: s.tick });
			}
		},
	});
	const final = runSilver(silverRunInputOf(last!, { kills }));
	return { seed, floorReached: r.floorReached, died: r.died, final, ticks: r.ticks, ends, twoRoomTick };
}

function rowsText(x: RunSilver): string {
	return x.rows
		.filter((r) => r.silver > 0)
		.map((r) => `${r.row} ${r.count}/${r.silver}`)
		.join(", ");
}

function mean(xs: ReadonlyArray<number>): number {
	if (xs.size() === 0) return 0;
	let s = 0;
	for (const x of xs) s += x;
	return s / xs.size();
}

interface FloorEnds {
	/** Mean run amount dying at the end of floor k (index k; index 0 = 0). */
	readonly amount: number[];
	/** Mean ticks to the end of floor k. */
	readonly tick: number[];
}

function floorEnds(runs: ReadonlyArray<CensusRun>, label: string): FloorEnds {
	const amount: number[] = [0];
	const tick: number[] = [0];
	const line: string[] = [];
	for (let f = 1; f <= MAX_FLOOR; f++) {
		const amounts: number[] = [];
		const ticks: number[] = [];
		const crates: number[] = [];
		for (const c of runs) {
			const e = c.ends.get(f);
			if (e === undefined) continue;
			amounts.push(e.silver.amount);
			ticks.push(e.tick);
			crates.push(e.silver.rows.find((r) => r.row === "crates")?.silver ?? 0);
		}
		if (amounts.size() === 0) break;
		amount.push(mean(amounts));
		tick.push(mean(ticks));
		line.push(
			`f${f} ${f0(mean(amounts))} @ ${f0(mean(ticks) / SIM_HZ)} s, crates ${f0(
				mean(crates),
			)} (${amounts.size()})`,
		);
	}
	print(`[silver census] ${label}: run amount dying at the end of floor k: ${line.join("; ")}`);
	return { amount, tick };
}

/** Runs to afford the cumulative ladder up to each tier at `perRun` Silver a run, with or without the day bonuses. */
function pacing(perRun: number, bonuses: boolean): number[] {
	const out: number[] = [];
	let need = 0;
	for (const price of ARMORY_TIERS) {
		need += price;
		let silver = 0;
		let runs = 0;
		while (silver < need && runs < 100000) {
			if (bonuses && runs % RUNS_PER_DAY === 0) silver += SILVER.firstRunBonus + SILVER.dailyBonus;
			silver += perRun;
			runs++;
		}
		out.push(runs);
	}
	return out;
}

describe(`SV1 Silver census (${
	FULL ? "census" : "smoke"
}: Knight seeds 1-${SEEDS.size()}, to floor ${MAX_FLOOR})`, () => {
	it("Silver per run, per floor, the pacing and farm tables (printed)", () => {
		const t0 = os.clock();
		const runs: CensusRun[] = [];
		for (const seed of SEEDS) {
			const c = censusRun(seed);
			runs.push(c);
			print(
				`[silver census] seed ${seed}: ${c.died ? `died on floor ${c.floorReached}` : "reached the cap"}, ` +
					`${f0(c.ticks / SIM_HZ)} s sim, run amount ${c.final.amount} (sum ${c.final.sum}, top-up ${
						c.final.topUp
					}): ${rowsText(c.final)}`,
			);
			expect(c.final.amount >= 0).toBe(true);
			expect(c.died || c.floorReached === MAX_FLOOR + 1).toBe(true);
		}
		// Silver by death floor: the real ends of the runs.
		const byFloor = new Map<number, number[]>();
		for (const c of runs) {
			const list = byFloor.get(c.floorReached) ?? [];
			list.push(c.final.amount);
			byFloor.set(c.floorReached, list);
		}
		const deathLine: string[] = [];
		for (let f = 1; f <= MAX_FLOOR + 1; f++) {
			const list = byFloor.get(f);
			if (list !== undefined) deathLine.push(`f${f} ${f0(mean(list))} (${list.size()})`);
		}
		print(`[silver census] run amount by death floor: ${deathLine.join(", ")}`);
		// The end of every floor (every room cleared, the floor not descended): the honest runs, then immortal runs
		// (hearts topped up every tick: the bot rarely survives the floor-5 boss) for the deeper floors.
		const honest = floorEnds(runs, "honest");
		const deep: CensusRun[] = [];
		for (let k = 0; k < (FULL ? IMMORTAL_SEEDS : 1); k++) deep.push(censusRun(SEEDS[k], true));
		const immortal = floorEnds(deep, "immortal");
		// Player profiles (docs/SILVER.md targets): a death mid-floor k is about half way between the ends of k - 1 and k.
		const mid = (e: FloorEnds, k: number) => (k < e.amount.size() ? (e.amount[k - 1] + e.amount[k]) / 2 : 0);
		const profiles: Array<[string, number, number]> = [
			["floor 1-2", mid(honest, 2), 45],
			["floor 3", mid(honest, 3), 75],
			["floor 5 + boss (immortal)", 5 < immortal.amount.size() ? immortal.amount[5] : 0, 160],
			["floor 10 (immortal)", mid(immortal, 10), 500],
		];
		const endAt = honest.amount;
		const endTick = honest.tick;
		for (const [name, amount, target] of profiles) {
			if (amount <= 0) continue;
			const off = (amount / target - 1) * 100;
			const day = RUNS_PER_DAY * amount;
			print(
				`[silver census] ${name}: ${f0(amount)} a run (target ${target}, ${f1(
					off,
				)} %); a day of ${RUNS_PER_DAY}: ${f0(day)}, ${f0(
					day + SILVER.firstRunBonus + SILVER.dailyBonus,
				)} with the day bonuses`,
			);
			const plain = pacing(amount, false);
			const bonus = pacing(amount, true);
			const cells: string[] = [];
			for (let t = 0; t < ARMORY_TIERS.size(); t++) {
				cells.push(
					`T${t + 1} ${ARMORY_TIERS[t]}: ${plain[t]} runs / ${bonus[t]} runs ${f1(
						bonus[t] / RUNS_PER_DAY,
					)} d`,
				);
			}
			print(`[silver census] pacing ${name} (cumulative ladder; no bonus / with bonuses): ${cells.join("; ")}`);
		}
		// Farm table: Silver per hour.
		const twoRoom: number[] = [];
		for (const c of runs) if (c.twoRoomTick !== undefined) twoRoom.push(c.twoRoomTick / SIM_HZ);
		const fastest = twoRoom.size() > 0 ? math.min(...twoRoom) : 0;
		const farm = fastest > 0 ? (SILVER.runMinimum * SECONDS_PER_HOUR) / (fastest + RESTART_SECONDS) : 0;
		const meanTwo = mean(twoRoom);
		const farmMean = meanTwo > 0 ? (SILVER.runMinimum * SECONDS_PER_HOUR) / (meanTwo + RESTART_SECONDS) : 0;
		let silver = 0;
		let seconds = 0;
		for (const c of runs) {
			silver += c.final.amount;
			seconds += c.ticks / SIM_HZ + RESTART_SECONDS;
		}
		const normal = seconds > 0 ? (silver * SECONDS_PER_HOUR) / seconds : 0;
		const f3 =
			3 < endAt.size() && endTick[3] > 0
				? (endAt[3] * SECONDS_PER_HOUR) / (endTick[3] / SIM_HZ + RESTART_SECONDS)
				: 0;
		print(
			`[silver census] farm (Silver / hour, ${RESTART_SECONDS} s between runs): fastest two-room run ${f0(
				farm,
			)} (${f1(fastest)} s), mean two-room run ${f0(farmMean)} (${f1(meanTwo)} s), die-at-once 0, ` +
				`play to the end of floor 3 ${f0(f3)}, normal play (the census runs) ${f0(normal)}; ` +
				`${f1(os.clock() - t0)} s`,
		);
		expect(runs.size()).toBe(SEEDS.size());
	});
});

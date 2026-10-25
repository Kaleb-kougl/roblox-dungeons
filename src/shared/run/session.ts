/**
 * Per-player session numbers from the runs a player submitted during one server session (Roblox port of the run
 * loop of project-kaleb-vale src/playtest/aggregate.mjs `summarizeSession` @ 42897e2). The Fun-gate signal is the
 * same: does a player who died start another run?
 *
 * Port notes: the web build knew the tester's exit (Retry / Quit) from the UI. Here a death counts as "retried" when
 * the same player submitted another run after it in the session, and a death that was the session's last run ends
 * the retry streak (the web build's "died, then quit"). Retry delays and fun-gate answers are not available.
 */
import { SIM_HZ } from "shared/sim";
import type { RunTelemetryRecord } from "./telemetry";

export interface RunSessionSummary {
	runs: number;
	deaths: number;
	victories: number;
	/** Deaths followed by another run. */
	retriesAfterDeath: number;
	retryAfterDeathRate: number | undefined;
	longestRetryStreak: number;
	aliveSeconds: number;
	playSeconds: number;
	timeToFirstDeathSec: number | undefined;
	deathsPerMinute: number;
	bestRunSeconds: number;
	kills: number;
	hitsTaken: number;
	heartsLostTotal: number;
}

const ROUND_2 = 100;
const ROUND_3 = 1000;
const SECONDS_PER_MINUTE = 60;

function round(v: number, scale: number): number {
	return math.round(v * scale) / scale;
}

export function summarizeRunSession(records: ReadonlyArray<Readonly<RunTelemetryRecord>>): RunSessionSummary {
	let deaths = 0;
	let victories = 0;
	let retriesAfterDeath = 0;
	let streak = 0;
	let longestRetryStreak = 0;
	let alive = 0;
	let play = 0;
	let ticksToFirstDeath: number | undefined;
	let bestRunTicks = 0;
	let kills = 0;
	let hitsTaken = 0;
	let heartsLostTotal = 0;
	const n = records.size();
	for (let i = 0; i < n; i++) {
		const run = records[i];
		const died = run.deathTick !== undefined;
		play += run.ticks;
		if (ticksToFirstDeath === undefined && died) ticksToFirstDeath = alive + run.aliveTicks;
		alive += run.aliveTicks;
		bestRunTicks = math.max(bestRunTicks, run.aliveTicks);
		if (died) deaths++;
		if (run.endReason === "victory") victories++;
		if (died && i < n - 1) {
			retriesAfterDeath++;
			streak++;
			longestRetryStreak = math.max(longestRetryStreak, streak);
		} else if (died) {
			streak = 0;
		}
		kills += run.kills;
		hitsTaken += run.hitsTaken;
		heartsLostTotal += run.heartsLostTotal;
	}
	const aliveMinutes = alive / SIM_HZ / SECONDS_PER_MINUTE;
	return {
		runs: n,
		deaths,
		victories,
		retriesAfterDeath,
		retryAfterDeathRate: deaths > 0 ? round(retriesAfterDeath / deaths, ROUND_3) : undefined,
		longestRetryStreak,
		aliveSeconds: round(alive / SIM_HZ, ROUND_2),
		playSeconds: round(play / SIM_HZ, ROUND_2),
		timeToFirstDeathSec: ticksToFirstDeath === undefined ? undefined : round(ticksToFirstDeath / SIM_HZ, ROUND_2),
		deathsPerMinute: aliveMinutes > 0 ? round(deaths / aliveMinutes, ROUND_2) : 0,
		bestRunSeconds: round(bestRunTicks / SIM_HZ, ROUND_2),
		kills,
		hitsTaken,
		heartsLostTotal,
	};
}

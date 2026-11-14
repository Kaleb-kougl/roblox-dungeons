/**
 * Silver's run amount (docs/SILVER.md "Earn table", SV1, SVD2): a pure integer function of what the replayed run did.
 * The server computes it from its OWN replay inside the validator's final check (shared/run segments.ts `readSilver`,
 * SVD28); the client may compute the same from its live state for a dimmed preview. Never imported by the sim.
 *
 * Rows (each read exactly as docs/SILVER.md "SV0 findings" says):
 *   rooms      state.score.counts[ROOMS]: one per room record cleared (the boss room has none; a Horde room and its
 *              runtime children are one record), x roomPay
 *   crates     the broken Silver pieces' stacks (state.silver.total, track SC; crateSilverOf)
 *   floors     floors descended from, state.endless.floor - the start floor; floor n pays floorBase + n
 *   bosses     boss kills = Depth - the start Depth (shared/view hud bossKillsOf; counts[BOSS] also counts no-hit awards,
 *              so it is not a kill count); the k-th pays bossPerDepth x (startDepth + k), the Depth it reached
 *   vaults     state.treasure.opened, x vaultOpened
 *   secrets    secretsRunSummary(state).found (never counts[SECRET], which also counts the chest's points), x secretFound
 *   goldlings  state.golden.caught (counts[GOLDEN] counts every coin hit), x goldlingCaught
 *   kills      RunSummary.kills, one Silver per killsPerSilver (floored)
 *
 * The minimum: a run that cleared at least `minimumRooms` rooms is topped up to `runMinimum` (SVD25); a run that
 * cleared fewer is paid what it earned. Prospector and the day bonuses are applied at the grant (shared/wallet
 * applyGrant), never here.
 */
import { ENDLESS_FIRST_FLOOR } from "shared/dungeon";
import {
	ENDLESS_FIRST_DEPTH,
	ScoreSource,
	endlessStartFloor,
	secretsRunSummary,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { SILVER, SILVER_ROWS, type SilverRowId, type SilverTunables } from "./config";

/** What a run did, as the earn rows read it. Plain non-negative integers. */
export interface SilverRunInput {
	/** Room records cleared (counts[ROOMS]). */
	roomsCleared: number;
	/** Silver from broken barrels and crates (state.silver.total). */
	crateSilver: number;
	/** The floor the run started on (1; a dev run's startFloor). */
	startFloor: number;
	/** The floor the run ended on. */
	floor: number;
	/** The Depth the run started at (1; a dev run's startDepth). */
	startDepth: number;
	/** The Depth the run ended at (+1 per boss kill). */
	depth: number;
	vaultsOpened: number;
	secretsFound: number;
	goldlingsCaught: number;
	kills: number;
}

/** One earn row of a run: its count and the Silver it pays. */
export interface SilverRow {
	row: SilverRowId;
	count: number;
	silver: number;
}

/** A run's Silver (before Prospector and the day bonuses). Plain data: it rides the verdict. */
export interface RunSilver {
	/** Every row, in SILVER_ROWS order (zeros included). */
	rows: SilverRow[];
	/** The rows' sum. */
	sum: number;
	/** The run cleared at least SILVER.minimumRooms rooms: it qualifies for the minimum. */
	qualifies: boolean;
	/** What the minimum adds (0 unless it qualifies and the sum is below SILVER.runMinimum). */
	topUp: number;
	/** sum + topUp: the run amount. */
	amount: number;
}

/** The input of a run that did nothing (an idle run). */
export function emptySilverRunInput(): SilverRunInput {
	return {
		roomsCleared: 0,
		crateSilver: 0,
		startFloor: ENDLESS_FIRST_FLOOR,
		floor: ENDLESS_FIRST_FLOOR,
		startDepth: ENDLESS_FIRST_DEPTH,
		depth: ENDLESS_FIRST_DEPTH,
		vaultsOpened: 0,
		secretsFound: 0,
		goldlingsCaught: 0,
		kills: 0,
	};
}

/** A non-negative integer (NaN, negatives and fractions floored to it; never throws). */
function count(n: number): number {
	if (!typeIs(n, "number") || n !== n || n === math.huge) return 0;
	return math.max(0, math.floor(n));
}

/** Silver for descending from floors startFloor .. floor - 1: the sum of floorBase + n. */
function floorSilver(startFloor: number, floor: number, t: SilverTunables): number {
	let silver = 0;
	for (let n = startFloor; n < floor; n++) silver += t.floorBase + n;
	return silver;
}

/** Silver for `kills` boss kills from `startDepth`: the k-th pays bossPerDepth x (startDepth + k). */
function bossSilver(startDepth: number, kills: number, t: SilverTunables): number {
	let silver = 0;
	for (let k = 1; k <= kills; k++) silver += t.bossPerDepth * (startDepth + k);
	return silver;
}

/** The pure, integer earn function (module comment). */
export function runSilver(input: Readonly<SilverRunInput>, t: SilverTunables = SILVER): RunSilver {
	const rooms = count(input.roomsCleared);
	const startFloor = math.max(ENDLESS_FIRST_FLOOR, count(input.startFloor));
	const floors = math.max(0, count(input.floor) - startFloor);
	const startDepth = math.max(ENDLESS_FIRST_DEPTH, count(input.startDepth));
	const bosses = math.max(0, count(input.depth) - startDepth);
	const vaults = count(input.vaultsOpened);
	const secrets = count(input.secretsFound);
	const goldlings = count(input.goldlingsCaught);
	const kills = count(input.kills);
	const crates = count(input.crateSilver);
	const values: Record<SilverRowId, readonly [number, number]> = {
		rooms: [rooms, rooms * t.roomPay],
		crates: [crates, crates],
		floors: [floors, floorSilver(startFloor, startFloor + floors, t)],
		bosses: [bosses, bossSilver(startDepth, bosses, t)],
		vaults: [vaults, vaults * t.vaultOpened],
		secrets: [secrets, secrets * t.secretFound],
		goldlings: [goldlings, goldlings * t.goldlingCaught],
		kills: [kills, math.floor(kills / t.killsPerSilver)],
	};
	const rows: SilverRow[] = [];
	let sum = 0;
	for (const row of SILVER_ROWS) {
		const [n, silver] = values[row];
		rows.push({ row, count: n, silver });
		sum += silver;
	}
	const qualifies = rooms >= t.minimumRooms;
	const topUp = qualifies ? math.max(0, t.runMinimum - sum) : 0;
	return { rows, sum, qualifies, topUp, amount: sum + topUp };
}

/** The Silver a row of `run` pays (0 when absent). */
export function silverRowOf(run: Readonly<RunSilver>, row: SilverRowId): number {
	for (const r of run.rows) if (r.row === row) return r.silver;
	return 0;
}

/**
 * Silver from broken barrels and crates. SC2 seam: state.silver.total (track SC adds `state.silver`); until then no
 * piece holds Silver, so every run reads 0.
 */
export function crateSilverOf(_state: Readonly<SimState>): number {
	// SC2 seam: state.silver.total
	return 0;
}

/**
 * Every row's input from a replayed state (the module comment's reads). `config` (the run's SimConfig) gives a dev
 * run's start floor and Depth; without it an endless run starts on floor 1 at Depth 1. A state without endless mode
 * descends no floor and kills no boss.
 */
export function silverRunInputOf(
	state: Readonly<SimState>,
	summary: { readonly kills: number },
	config?: Readonly<SimConfig>,
): SilverRunInput {
	const counts = state.score?.counts;
	const rooms = counts !== undefined && ScoreSource.ROOMS < counts.size() ? counts[ScoreSource.ROOMS] : 0;
	const endless = state.endless;
	const startFloor = config?.endless !== undefined ? endlessStartFloor(config.endless) : ENDLESS_FIRST_FLOOR;
	const startDepth = config?.endless?.startDepth ?? ENDLESS_FIRST_DEPTH;
	return {
		roomsCleared: rooms,
		crateSilver: crateSilverOf(state),
		startFloor: endless !== undefined ? startFloor : ENDLESS_FIRST_FLOOR,
		floor: endless !== undefined ? endless.floor : ENDLESS_FIRST_FLOOR,
		startDepth: endless !== undefined ? startDepth : ENDLESS_FIRST_DEPTH,
		depth: endless !== undefined ? endless.depth : ENDLESS_FIRST_DEPTH,
		vaultsOpened: state.treasure?.opened ?? 0,
		secretsFound: secretsRunSummary(state).found,
		goldlingsCaught: state.golden?.caught ?? 0,
		kills: summary.kills,
	};
}

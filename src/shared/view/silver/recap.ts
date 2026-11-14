/**
 * The run-over panel's Silver rows (docs/SILVER.md SV8, "Earning": "Run over"). Pure: the client's RunOverPanel draws
 * silverRecapModel; headlessly tested (recap.spec.ts).
 *
 *   rows        `Silver +46` (counting up, silverCountUp), then only when they apply `Prospector +4`, `Topped up to 20`,
 *               `First run today +50`, `Daily bonus +50`; then `Total 310`; then the next goal (`Vigor II: 66 to go`,
 *               or `... ready to buy`). Compact (a landscape phone): the bonuses, the top-up and Prospector fold into
 *               one `Bonuses +N` row.
 *   figures     the settled breakdown when the wallet's push for this run arrived (WalletStatus.grant, same runId), else
 *               the verdict's prediction (RunFinishVerdict.silver), else the client's own figures from its live state
 *               (silverClientFigures: runSilver on the view's state plus the bonuses its wallet says are open), DIMMED
 *               until one of the server's two arrives
 *   none        `No Silver: unranked run` for a run that cannot pay (the unranked fallback, debug, stress), a rejected
 *               one, or an accepted one the server granted nothing for (no prediction in the verdict)
 *   hidden      the tutorial, dev runs, M1 and every other world that never pays (nothing drawn)
 *
 * The goal: the cheapest next level (WalletStatus.goals' first), its `to go` against the balance after this run.
 */
import { SILVER, type RunSilver, type SilverTunables } from "shared/silver";
import { SILVER_RECAP_KEYS, type StringVars } from "shared/theme";
import {
	prospectorBonus,
	UPGRADE_ITEM,
	type SilverGrantBreakdown,
	type WalletGoal,
	type WalletStatus,
} from "shared/wallet";
import { SILVER_RECAP } from "./config";
import { armoryItemLabel, type SilverStr } from "./names";
import { statusBalance, statusLevel } from "./wallet";

/** What a run paid or will pay, row by row (the client's figures or a server breakdown). */
export interface SilverFigures {
	/** The run amount (the rows' sum). */
	readonly sum: number;
	readonly prospector: number;
	readonly topUp: number;
	readonly firstRun: number;
	readonly daily: number;
	/** Everything the grant adds. */
	readonly total: number;
	/** The balance after it. */
	readonly balance: number;
}

/**
 * The client's own figures for `run` (runSilver on its live state) with its wallet `status` (Prospector's level and
 * which bonuses are still open; an unknown wallet: both open, as the server's own prediction for an unknown doc), a
 * Daily finish (`daily`) adding the Daily bonus.
 */
export function silverClientFigures(
	run: Readonly<RunSilver>,
	status: Readonly<WalletStatus> | undefined,
	daily: boolean,
	t: SilverTunables = SILVER,
): SilverFigures {
	const sum = math.max(0, run.sum);
	const prospector = prospectorBonus(sum, statusLevel(status, UPGRADE_ITEM.prospector), t);
	const topUp = run.qualifies ? math.max(0, t.runMinimum - (sum + prospector)) : 0;
	const loaded = status !== undefined && status.loaded;
	const firstRun = !loaded || status!.firstRunBonusOpen !== false ? t.firstRunBonus : 0;
	const dailyBonus = daily && (!loaded || status!.dailyBonusOpen !== false) ? t.dailyBonus : 0;
	const total = sum + prospector + topUp + firstRun + dailyBonus;
	return { sum, prospector, topUp, firstRun, daily: dailyBonus, total, balance: statusBalance(status) + total };
}

/** A server breakdown as figures. */
export function silverFiguresOf(b: Readonly<SilverGrantBreakdown>): SilverFigures {
	return {
		sum: b.sum,
		prospector: b.prospector,
		topUp: b.topUp,
		firstRun: b.firstRunBonus,
		daily: b.dailyBonus,
		total: b.total,
		balance: b.balance,
	};
}

/** One Silver row. */
export type SilverRecapRowId = "run" | "prospector" | "topUp" | "firstRun" | "daily" | "bonuses" | "total" | "goal";

export interface SilverRecapRow {
	readonly id: SilverRecapRowId;
	readonly key: string;
	readonly vars: StringVars;
}

export type SilverRecapModel =
	| { readonly kind: "hidden" }
	| { readonly kind: "none"; readonly key: string }
	| {
			readonly kind: "rows";
			readonly rows: ReadonlyArray<SilverRecapRow>;
			/** The client's own figures, shown dimmed until the server's arrive. */
			readonly dim: boolean;
			/** The run row's number (the count-up's target). */
			readonly runAmount: number;
	  };

/** What the run-over panel knows (see the file comment). */
export interface SilverRecapInput {
	/** The run's world pays Silver at all (endless / the Daily; never the tutorial, dev or M1). */
	readonly paidWorld: boolean;
	/** The client's facts say the run can pay (silverRunPays: not unranked, debug or stress). */
	readonly pays: boolean;
	/** The verdict's status for this run. */
	readonly verdict: "none" | "pending" | "accepted" | "rejected" | "skipped";
	/** The client's own figures (absent: no live state was frozen). */
	readonly client?: SilverFigures;
	/** RunFinishVerdict.silver. */
	readonly predicted?: SilverGrantBreakdown;
	/** WalletStatus.grant for this run (same runId). */
	readonly settled?: SilverGrantBreakdown;
	/** The latest wallet goals (WalletStatus.goals). */
	readonly goals?: ReadonlyArray<WalletGoal>;
	/** The compact run-over panel (a landscape phone): the bonuses fold into one row. */
	readonly compact: boolean;
}

/** The rows (see the file comment). */
export function silverRecapModel(input: Readonly<SilverRecapInput>, s: SilverStr): SilverRecapModel {
	if (!input.paidWorld) return { kind: "hidden" };
	const none = { kind: "none" as const, key: SILVER_RECAP_KEYS.none };
	if (input.settled === undefined) {
		if (!input.pays || input.verdict === "rejected" || input.verdict === "skipped") return none;
		if (input.verdict === "accepted" && input.predicted === undefined) return none;
	}
	const server = input.settled ?? input.predicted;
	const f = server !== undefined ? silverFiguresOf(server) : input.client;
	if (f === undefined) return none;
	const rows: SilverRecapRow[] = [{ id: "run", key: SILVER_RECAP_KEYS.run, vars: { silver: f.sum } }];
	if (input.compact) {
		const bonuses = f.prospector + f.topUp + f.firstRun + f.daily;
		if (bonuses > 0) rows.push({ id: "bonuses", key: SILVER_RECAP_KEYS.bonuses, vars: { silver: bonuses } });
	} else {
		if (f.prospector > 0)
			rows.push({ id: "prospector", key: SILVER_RECAP_KEYS.prospector, vars: { silver: f.prospector } });
		if (f.topUp > 0) rows.push({ id: "topUp", key: SILVER_RECAP_KEYS.topUp, vars: { silver: SILVER.runMinimum } });
		if (f.firstRun > 0)
			rows.push({ id: "firstRun", key: SILVER_RECAP_KEYS.firstRun, vars: { silver: f.firstRun } });
		if (f.daily > 0) rows.push({ id: "daily", key: SILVER_RECAP_KEYS.daily, vars: { silver: f.daily } });
	}
	rows.push({ id: "total", key: SILVER_RECAP_KEYS.total, vars: { silver: f.balance } });
	const goal = input.goals?.[0];
	if (goal !== undefined) {
		const toGo = math.max(0, goal.price - f.balance);
		const item = armoryItemLabel(goal.itemId, goal.level, s);
		rows.push(
			toGo > 0
				? { id: "goal", key: SILVER_RECAP_KEYS.toGo, vars: { item, silver: toGo } }
				: { id: "goal", key: SILVER_RECAP_KEYS.ready, vars: { item } },
		);
	}
	return { kind: "rows", rows, dim: server === undefined, runAmount: f.sum };
}

/** The run row's shown number `elapsedSec` after the panel opened: an ease-out count from 0 to `target`. */
export function silverCountUp(elapsedSec: number, target: number, reducedMotion = false): number {
	if (reducedMotion || !(target > 0)) return math.max(0, target);
	const t = math.clamp((elapsedSec - SILVER_RECAP.delaySec) / SILVER_RECAP.countSec, 0, 1);
	const ease = 1 - (1 - t) * (1 - t);
	return math.floor(target * ease + 0.5);
}

/** The block's height (reference px) for `rows` rows: one line each at `lineH` with `gap` between. */
export function silverRecapHeight(rows: number, lineH: number, gap: number): number {
	return rows <= 0 ? 0 : rows * lineH + (rows - 1) * gap;
}

/** A run-over layout (shared/view/hud RecapLayout's names). */
export type SilverRecapLayout = "wide" | "narrow" | "compact";

/**
 * The rows as drawn lines, SILVER_RECAP.perLine[layout] a line (`Silver +46 · First run today +50`, `Total 310 · Vigor
 * II: 66 to go`): never more than SILVER_RECAP.maxLines[layout] lines.
 */
export function silverRecapLines(rows: ReadonlyArray<SilverRecapRow>, layout: SilverRecapLayout): SilverRecapRow[][] {
	const out: SilverRecapRow[][] = [];
	const per = SILVER_RECAP.perLine[layout];
	for (const r of rows) {
		const last = out[out.size() - 1];
		if (last !== undefined && last.size() < per) last.push(r);
		else out.push([r]);
	}
	return out;
}

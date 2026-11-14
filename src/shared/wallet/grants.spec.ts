import { describe, expect, it } from "@rbxts/jest-globals";
import { DAILY_WORLD_KIND, dailyDayStart } from "shared/daily";
import { DEV_WORLD_KIND, ENDLESS_WORLD_KIND, TUTORIAL_WORLD_KIND } from "shared/run";
import { emptySilverRunInput, runSilver } from "shared/silver";
import {
	applyGrant,
	decodeWalletDoc,
	emptyWalletDoc,
	planRunGrants,
	predictRunGrants,
	walletBalance,
	walletTransaction,
	type RunGrantFacts,
	type WalletDoc,
} from "shared/wallet";

const DAY = 316;
const NOON = dailyDayStart(DAY) + 43200;
const SILVER_RUN = runSilver({ ...emptySilverRunInput(), roomsCleared: 3, floor: 3, kills: 270 }); // 46

function facts(patch: Partial<RunGrantFacts>): RunGrantFacts {
	return {
		runId: "run-1",
		ok: true,
		silver: SILVER_RUN,
		worldKind: ENDLESS_WORLD_KIND,
		debug: false,
		studio: false,
		creditedIds: [11],
		unixNow: NOON,
		...patch,
	};
}

/** Runs the plan's grant for each member on a per-user stored map (the transactions). */
function settle(plan: ReturnType<typeof planRunGrants>, stored: Map<number, unknown>): Map<number, number> {
	const totals = new Map<number, number>();
	for (const id of plan.userIds) {
		const out = walletTransaction(stored.get(id), { kind: "grant", grant: plan.grant!, ctx: plan.ctx });
		if (out.write !== undefined) stored.set(id, out.write);
		totals.set(id, out.breakdown?.total ?? 0);
	}
	return totals;
}

describe("planRunGrants (SV4)", () => {
	it("a solo endless run: one grant, the day at the grant, no Daily day", () => {
		const plan = planRunGrants(facts({}));
		expect(plan.skip).toBe(undefined);
		expect([...plan.userIds]).toEqual([11]);
		expect(plan.ctx).toEqual({ day: DAY });
		expect(plan.grant?.daily).toBe(false);
		expect(plan.grant?.run.sum).toBe(46);
	});

	it("a party run: every credited member gets the team's run amount plus their own bonuses and Prospector", () => {
		const plan = planRunGrants(facts({ creditedIds: [11, 22, 33] }));
		const stored = new Map<number, unknown>();
		const claimed = emptyWalletDoc();
		claimed.runDay = DAY; // 22 already had today's first run
		claimed.own.set("prospector", 2);
		stored.set(22, { v: 1, earned: 0, spent: 0, own: { prospector: 2 }, runs: [], runDay: DAY });
		const totals = settle(plan, stored);
		expect(totals.get(11)).toBe(46 + 50);
		expect(totals.get(22)).toBe(46 + 4); // Prospector II, no first-run bonus
		expect(totals.get(33)).toBe(46 + 50);
		// the prediction from the session copies agrees
		const docs = new Map<number, WalletDoc>([[22, claimed]]);
		const predicted = predictRunGrants(plan, (id) => docs.get(id));
		expect([predicted.get(11)?.total, predicted.get(22)?.total, predicted.get(33)?.total]).toEqual([96, 50, 96]);
	});

	it("an abandoned but validated run pays (the caller passes every accepted run)", () => {
		expect(planRunGrants(facts({})).skip).toBe(undefined);
	});

	it("rejected runs, runs without Silver and nobody credited grant nothing", () => {
		expect(planRunGrants(facts({ ok: false })).skip).toBe("rejected");
		const noSilver: RunGrantFacts = {
			runId: "run-1",
			ok: true,
			worldKind: ENDLESS_WORLD_KIND,
			debug: false,
			studio: false,
			creditedIds: [11],
			unixNow: NOON,
		};
		expect(planRunGrants(noSilver).skip).toBe("noSilver");
		expect(planRunGrants(facts({ creditedIds: [] })).skip).toBe("nobody");
		expect(planRunGrants(facts({ ok: false })).userIds.size()).toBe(0);
	});

	it("debug, dev, the tutorial, M1 and unfaked Studio never pay", () => {
		expect(planRunGrants(facts({ debug: true })).skip).toBe("debug");
		expect(planRunGrants(facts({ studio: true })).skip).toBe("studio");
		for (const w of [DEV_WORLD_KIND, TUTORIAL_WORLD_KIND, "game", "greybox", "dungeonNoEncounter"]) {
			expect(planRunGrants(facts({ worldKind: w })).skip).toBe("world");
		}
	});

	it("a Daily run: both bonuses; the Daily's on its start day", () => {
		const plan = planRunGrants(facts({ worldKind: DAILY_WORLD_KIND, daily: { day: DAY, ruleset: 19 } }));
		expect(plan.ctx).toEqual({ day: DAY, dailyDay: DAY });
		expect(plan.grant?.daily).toBe(true);
		const stored = new Map<number, unknown>();
		expect(settle(plan, stored).get(11)).toBe(46 + 50 + 50);
	});

	it("across midnight: a Daily started on DAY and granted on DAY + 1 pays DAY's Daily bonus and DAY + 1's first run", () => {
		const stored = new Map<number, unknown>();
		// earlier on DAY: an endless run took DAY's first-run bonus
		settle(planRunGrants(facts({ runId: "early" })), stored);
		const afterMidnight = dailyDayStart(DAY + 1) + 5;
		const plan = planRunGrants(
			facts({
				runId: "late",
				worldKind: DAILY_WORLD_KIND,
				daily: { day: DAY, ruleset: 19 },
				unixNow: afterMidnight,
			}),
		);
		expect(plan.ctx).toEqual({ day: DAY + 1, dailyDay: DAY });
		expect(settle(plan, stored).get(11)).toBe(46 + 50 + 50);
		const doc = decodeWalletDoc(stored.get(11));
		expect([doc.runDay, doc.dailyDay]).toEqual([DAY + 1, DAY]);
		// the next Daily on DAY + 1 still gets DAY + 1's Daily bonus, not a second first-run bonus
		const later = planRunGrants(
			facts({
				runId: "next",
				worldKind: DAILY_WORLD_KIND,
				daily: { day: DAY + 1, ruleset: 19 },
				unixNow: afterMidnight,
			}),
		);
		expect(settle(later, stored).get(11)).toBe(46 + 50);
	});

	it("a Daily key on an endless run is ignored (no Daily bonus)", () => {
		const plan = planRunGrants(facts({ daily: { day: DAY, ruleset: 19 } }));
		expect([plan.ctx.dailyDay, plan.grant?.daily]).toEqual([undefined, false]);
	});

	it("a re-concluded session grants once", () => {
		const plan = planRunGrants(facts({}));
		const stored = new Map<number, unknown>();
		const first = settle(plan, stored);
		const second = settle(plan, stored);
		expect([first.get(11), second.get(11)]).toEqual([96, 0]);
		expect(walletBalance(decodeWalletDoc(stored.get(11)))).toBe(96);
		const r = applyGrant(decodeWalletDoc(stored.get(11)), plan.grant!, plan.ctx);
		expect(r.ok).toBe(false);
	});
});

// Daily activity in the records doc (docs/DAILY.md DS13): the optional `daily` field's codec, its two merges (max for
// whole-doc writes, sum for delta writes) under concurrent servers and day changes, and the server's ledger (attempt
// numbers, returning flag, what each write carries).
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	DAILY_ACTIVITY_POLICY,
	DailyActivityLedger,
	RECORDS_CODEC,
	RECORDS_DOC_VERSION,
	RECORDS_POLICY,
	addDailyActivity,
	applyDailyDelta,
	decodeDailyActivity,
	decodeRecordsDoc,
	emptyRecordsDoc,
	encodeRecordsDoc,
	finishedDailyOn,
	mergeDailyActivity,
	mergeRecordDocs,
	mergeRecords,
	mergeStoredDailyDelta,
	mergeStoredRecords,
	recordsEligibility,
	sameRecordsDoc,
	seedFromDetails,
	type DailyActivity,
	type DailyActivityDelta,
	type DailyBase,
	type RecordsContext,
	type RecordsDoc,
} from "shared/records";

const AT = 1_700_000_000;
const DAY = 304;

function withEndless(): RecordsDoc {
	return {
		v: RECORDS_DOC_VERSION,
		endless: {
			solo: { score: 48210, scoreAt: AT, scoreRunId: "run-a", floor: 9, floorAt: AT, floorRunId: "run-b" },
		},
		seeded: true,
	};
}

/** A key's stored value under UpdateAsync: each write runs its transform on the current value (undefined = cancel). */
class FakeKey {
	value: unknown;
	writes = 0;
	constructor(value?: unknown) {
		this.value = value;
	}
	update(transform: (stored: unknown) => unknown): void {
		const out = transform(this.value);
		if (out !== undefined) {
			this.value = out;
			this.writes++;
		}
	}
	delta(d: DailyActivityDelta): void {
		this.update((stored) => mergeStoredDailyDelta(stored, d));
	}
	saveDoc(doc: RecordsDoc): void {
		this.update((stored) => mergeStoredRecords(stored, doc));
	}
	daily(): DailyActivity | undefined {
		return decodeRecordsDoc(this.value).daily;
	}
}

describe("daily field codec", () => {
	it("an old doc without `daily` decodes exactly as before and re-encodes without it", () => {
		const old = withEndless();
		const decoded = decodeRecordsDoc(old);
		expect(decoded.daily).toBe(undefined);
		expect(decoded).toEqual(old);
		expect(encodeRecordsDoc(decoded)).toEqual(old);
		expect(sameRecordsDoc(decoded, old)).toBe(true);
	});

	it("round trips a full field and a field without finished days", () => {
		const full = {
			...withEndless(),
			daily: { day: DAY, starts: 3, lastFinishedDay: DAY, prevFinishedDay: DAY - 2 },
		};
		expect(decodeRecordsDoc(encodeRecordsDoc(full))).toEqual(full);
		expect(RECORDS_CODEC.decode(RECORDS_CODEC.encode(full))).toEqual(full);
		const bare = { ...emptyRecordsDoc(), daily: { day: DAY, starts: 1 } };
		expect(decodeRecordsDoc(encodeRecordsDoc(bare))).toEqual(bare);
		expect(sameRecordsDoc(full, withEndless())).toBe(false);
	});

	it("malformed or unknown values read as absent, without touching the rest of the doc", () => {
		const bad: unknown[] = [
			"x",
			5,
			true,
			{},
			{ day: DAY },
			{ starts: 2 },
			{ day: -1, starts: 1 },
			{ day: 1.5, starts: 1 },
			{ day: DAY, starts: -1 },
			{ day: DAY, starts: 0 / 0 },
			{ day: DAY, starts: math.huge },
			{ day: "304", starts: 1 },
		];
		for (const daily of bad) {
			const doc = decodeRecordsDoc({ ...withEndless(), daily });
			expect(doc.daily).toBe(undefined);
			expect(doc.endless.solo?.score).toBe(48210);
			expect(doc.seeded).toBe(true);
		}
	});

	it("bad finished days are dropped on their own; prev must sit below last", () => {
		expect(decodeDailyActivity({ day: DAY, starts: 2, lastFinishedDay: "x", prevFinishedDay: 3 })).toEqual({
			day: DAY,
			starts: 2,
		});
		expect(decodeDailyActivity({ day: DAY, starts: 2, lastFinishedDay: 9, prevFinishedDay: 9 })).toEqual({
			day: DAY,
			starts: 2,
			lastFinishedDay: 9,
		});
		expect(decodeDailyActivity({ day: DAY, starts: 2, lastFinishedDay: 9, prevFinishedDay: 2.5 })).toEqual({
			day: DAY,
			starts: 2,
			lastFinishedDay: 9,
		});
		expect(decodeDailyActivity({ day: DAY, starts: 0, lastFinishedDay: 9, prevFinishedDay: 7, extra: 1 })).toEqual({
			day: DAY,
			starts: 0,
			lastFinishedDay: 9,
			prevFinishedDay: 7,
		});
	});

	it("still doc version 1", () => {
		const doc = encodeRecordsDoc({ ...emptyRecordsDoc(), daily: { day: DAY, starts: 1 } });
		expect(doc.v).toBe(1);
	});
});

describe("daily merges", () => {
	it("max-merge: later day wins, same day keeps the higher count, finished days are the top two", () => {
		const a: DailyActivity = { day: DAY, starts: 2, lastFinishedDay: DAY - 1, prevFinishedDay: DAY - 3 };
		const b: DailyActivity = { day: DAY, starts: 5, lastFinishedDay: DAY, prevFinishedDay: DAY - 1 };
		expect(mergeDailyActivity(a, b)).toEqual({
			day: DAY,
			starts: 5,
			lastFinishedDay: DAY,
			prevFinishedDay: DAY - 1,
		});
		expect(mergeDailyActivity(b, a)).toEqual(mergeDailyActivity(a, b));
		expect(mergeDailyActivity(a, a)).toEqual(a);
		const tomorrow: DailyActivity = { day: DAY + 1, starts: 1 };
		expect(mergeDailyActivity(b, tomorrow)).toEqual({
			day: DAY + 1,
			starts: 1,
			lastFinishedDay: DAY,
			prevFinishedDay: DAY - 1,
		});
		expect(mergeDailyActivity(undefined, undefined)).toBe(undefined);
		expect(mergeDailyActivity(a, undefined)).toEqual(a);
	});

	it("sum: same day adds, an older day's count is dropped", () => {
		const a: DailyActivity = { day: DAY, starts: 2 };
		expect(addDailyActivity(a, { day: DAY, starts: 3 })).toEqual({ day: DAY, starts: 5 });
		expect(addDailyActivity(a, { day: DAY - 1, starts: 3, lastFinishedDay: DAY - 1 })).toEqual({
			day: DAY,
			starts: 2,
			lastFinishedDay: DAY - 1,
		});
		expect(applyDailyDelta(undefined, { day: DAY, starts: 1, finishedDay: DAY })).toEqual({
			day: DAY,
			starts: 1,
			lastFinishedDay: DAY,
		});
	});

	it("two servers, same day: both servers' starts land (delta writes sum inside UpdateAsync)", () => {
		const key = new FakeKey({ ...withEndless(), daily: { day: DAY, starts: 1 } });
		// Both servers loaded starts = 1, then each counted two more starts and finished one run.
		key.delta({ day: DAY, starts: 2, finishedDay: DAY });
		key.delta({ day: DAY, starts: 2, finishedDay: DAY });
		expect(key.daily()).toEqual({ day: DAY, starts: 5, lastFinishedDay: DAY });
		// The endless records and the seed marker are untouched.
		const doc = decodeRecordsDoc(key.value);
		expect(doc.endless).toEqual(withEndless().endless);
		expect(doc.seeded).toBe(true);
	});

	it("a whole-doc save carrying a stale `daily` (the doc as loaded) never lowers or doubles it", () => {
		const loaded = { ...withEndless(), daily: { day: DAY, starts: 1 } };
		const key = new FakeKey(loaded);
		key.delta({ day: DAY, starts: 3, finishedDay: DAY });
		// A record write of the session's doc (its `daily` still as loaded).
		const better = mergeRecords(loaded, "solo", { score: 60000, floor: 10, at: AT + 5, runId: "run-z" }).doc;
		expect(better.daily).toEqual(loaded.daily);
		key.saveDoc(better);
		expect(key.daily()).toEqual({ day: DAY, starts: 4, lastFinishedDay: DAY });
		expect(decodeRecordsDoc(key.value).endless.solo?.score).toBe(60000);
	});

	it("day change: a stale server's delta for yesterday keeps today's count and adds its finished day", () => {
		const key = new FakeKey({ ...emptyRecordsDoc(), daily: { day: DAY, starts: 1, lastFinishedDay: DAY - 2 } });
		key.delta({ day: DAY + 1, starts: 1 });
		expect(key.daily()).toEqual({ day: DAY + 1, starts: 1, lastFinishedDay: DAY - 2 });
		key.delta({ day: DAY, starts: 4, finishedDay: DAY });
		expect(key.daily()).toEqual({ day: DAY + 1, starts: 1, lastFinishedDay: DAY, prevFinishedDay: DAY - 2 });
		key.delta({ day: DAY + 1, starts: 2, finishedDay: DAY + 1 });
		expect(key.daily()).toEqual({ day: DAY + 1, starts: 3, lastFinishedDay: DAY + 1, prevFinishedDay: DAY });
	});

	it("delta transform: cancels when nothing changes, on a newer doc version or a malformed delta", () => {
		const stored = { ...emptyRecordsDoc(), daily: { day: DAY, starts: 2, lastFinishedDay: DAY } };
		expect(mergeStoredDailyDelta(stored, { day: DAY, starts: 0, finishedDay: DAY })).toBe(undefined);
		expect(mergeStoredDailyDelta({ v: RECORDS_DOC_VERSION + 1, endless: {} }, { day: DAY, starts: 1 })).toBe(
			undefined,
		);
		expect(mergeStoredDailyDelta(stored, { day: DAY, starts: -1 })).toBe(undefined);
		expect(mergeStoredDailyDelta(stored, "junk")).toBe(undefined);
		// A junk stored value is replaced by a doc holding just the activity.
		expect(mergeStoredDailyDelta("junk", { day: DAY, starts: 1 })).toEqual({
			v: RECORDS_DOC_VERSION,
			endless: {},
			daily: { day: DAY, starts: 1 },
		});
	});

	it("whole-doc merges and the seed keep `daily`; mergeStoredRecords writes a doc whose only news is `daily`", () => {
		const stored = { ...emptyRecordsDoc(), daily: { day: DAY, starts: 2 } };
		const merged = mergeRecordDocs(stored, seedFromDetails({}));
		expect(merged.daily).toEqual({ day: DAY, starts: 2 });
		expect(merged.seeded).toBe(true);
		expect(mergeStoredRecords(stored, emptyRecordsDoc())).toBe(undefined);
		expect(mergeStoredRecords(undefined, stored)).toEqual(stored);
	});
});

describe("DailyActivityLedger", () => {
	const known = (activity?: DailyActivity): DailyBase => ({ known: true, activity });
	const unknown: DailyBase = { known: false, activity: undefined };

	it("first start vs retries: attempt numbers count the stored starts plus this server's", () => {
		const ledger = new DailyActivityLedger();
		const base = known({ day: DAY, starts: 2 });
		expect(ledger.started(1, DAY, "r1", base).attempt).toBe(3);
		expect(ledger.started(1, DAY, "r2", base).attempt).toBe(4);
		const fresh = new DailyActivityLedger();
		expect(fresh.started(1, DAY, "r1", known()).attempt).toBe(1);
		expect(fresh.started(1, DAY, "r2", known()).attempt).toBe(2);
		// Yesterday's stored count does not count today.
		expect(new DailyActivityLedger().started(1, DAY, "r1", known({ day: DAY - 1, starts: 7 })).attempt).toBe(1);
	});

	it("returning flag: finished a daily yesterday (stored or seen here), unknown without a base", () => {
		const ledger = new DailyActivityLedger();
		expect(
			ledger.started(1, DAY, "a", known({ day: DAY - 1, starts: 1, lastFinishedDay: DAY - 1 })).returning,
		).toBe(true);
		expect(
			ledger.started(2, DAY, "b", known({ day: DAY - 2, starts: 1, lastFinishedDay: DAY - 2 })).returning,
		).toBe(false);
		expect(ledger.started(3, DAY, "c", known()).returning).toBe(false);
		expect(ledger.started(4, DAY, "d", unknown).returning).toBe(undefined);
		// After finishing today, yesterday's finish is still found (prevFinishedDay).
		const both = known({ day: DAY, starts: 1, lastFinishedDay: DAY, prevFinishedDay: DAY - 1 });
		expect(ledger.started(5, DAY, "e", both).returning).toBe(true);
		// A finish seen on this server yesterday makes it true even with an unknown base.
		const here = new DailyActivityLedger();
		here.started(6, DAY - 1, "y", unknown);
		here.finished(6, DAY - 1, "y", unknown);
		expect(here.started(6, DAY, "t", unknown)).toEqual({ attempt: 1, returning: true });
	});

	it("a finish carries its start's attempt and the unwritten starts; then nothing is pending", () => {
		const ledger = new DailyActivityLedger();
		const base = known({ day: DAY, starts: 1 });
		ledger.started(1, DAY, "r1", base);
		ledger.started(1, DAY, "r2", base);
		const fin = ledger.finished(1, DAY, "r1", base);
		expect(fin.attempt).toBe(2);
		expect(fin.returning).toBe(false);
		expect(fin.delta).toEqual({ day: DAY, starts: 2, finishedDay: DAY });
		expect(ledger.flush(1)).toBe(undefined);
		const fin2 = ledger.finished(1, DAY, "r2", base);
		expect(fin2.attempt).toBe(3);
		expect(fin2.delta).toEqual({ day: DAY, starts: 0, finishedDay: DAY });
		expect(ledger.view(1, base)).toEqual({ day: DAY, starts: 3, lastFinishedDay: DAY });
	});

	it("flush gives the starts no finish wrote, once", () => {
		const ledger = new DailyActivityLedger();
		ledger.started(1, DAY, "r1", known());
		ledger.started(1, DAY, "r2", known());
		expect(ledger.flush(1)).toEqual({ day: DAY, starts: 2 });
		expect(ledger.flush(1)).toBe(undefined);
		expect(ledger.flush(99)).toBe(undefined);
		ledger.forget(1);
		expect(ledger.userIds()).toEqual([]);
	});

	it("midnight: a new day's start drops the old day's unwritten starts; a finish of yesterday's run after it", () => {
		const ledger = new DailyActivityLedger();
		ledger.started(1, DAY, "late", known());
		ledger.started(1, DAY + 1, "new", known());
		const fin = ledger.finished(1, DAY, "late", known());
		expect(fin.attempt).toBe(1);
		// Today's unwritten start rides along; the finished day is the run's own day.
		expect(fin.delta).toEqual({ day: DAY + 1, starts: 1, finishedDay: DAY });
		expect(ledger.started(1, DAY + 1, "again", known()).attempt).toBe(2);
		// Next day, it counts as returning (finished on DAY).
		expect(ledger.started(1, DAY + 1, "x", known()).returning).toBe(true);
	});

	it("a finish whose start was never counted here is attempt >= 1", () => {
		const ledger = new DailyActivityLedger();
		expect(ledger.finished(1, DAY, "elsewhere", known({ day: DAY, starts: 3 })).attempt).toBe(3);
		expect(new DailyActivityLedger().finished(1, DAY, "elsewhere", unknown).attempt).toBe(1);
	});

	it("ledger writes on two servers add up in the store", () => {
		const key = new FakeKey({ ...emptyRecordsDoc(), daily: { day: DAY, starts: 1 } });
		const base = known(decodeRecordsDoc(key.value).daily);
		const a = new DailyActivityLedger();
		const b = new DailyActivityLedger();
		a.started(1, DAY, "a1", base);
		b.started(1, DAY, "b1", base);
		b.started(1, DAY, "b2", base);
		key.delta(a.finished(1, DAY, "a1", base).delta);
		key.delta(b.flush(1)!);
		expect(key.daily()).toEqual({ day: DAY, starts: 4, lastFinishedDay: DAY });
		expect(finishedDailyOn(key.daily(), DAY)).toBe(true);
	});
});

describe("DAILY_ACTIVITY_POLICY", () => {
	const ctx = (over: Partial<RecordsContext> = {}): RecordsContext => ({
		worldKind: "daily",
		partySize: 1,
		debug: false,
		studio: false,
		privateServer: false,
		died: true,
		bossDefeated: false,
		...over,
	});

	it("the Daily only, abandoned and private servers count, debug and Studio do not", () => {
		expect(recordsEligibility(ctx(), DAILY_ACTIVITY_POLICY)).toBe(undefined);
		expect(recordsEligibility(ctx({ died: false }), DAILY_ACTIVITY_POLICY)).toBe(undefined);
		expect(recordsEligibility(ctx({ privateServer: true }), DAILY_ACTIVITY_POLICY)).toBe(undefined);
		expect(recordsEligibility(ctx({ worldKind: "endless" }), DAILY_ACTIVITY_POLICY)).toBe("world");
		expect(recordsEligibility(ctx({ debug: true }), DAILY_ACTIVITY_POLICY)).toBe("debug");
		expect(recordsEligibility(ctx({ studio: true }), DAILY_ACTIVITY_POLICY)).toBe("studio");
	});

	it("RECORDS_POLICY still refuses daily runs (DSD6)", () => {
		expect(recordsEligibility(ctx())).toBe("world");
		expect(RECORDS_POLICY.eligibleWorlds.includes("daily")).toBe(false);
	});
});

// Personal records (docs/NEW_BEST.md NB1): the doc codec, the max-merge, the store transform, the seed from the
// leaderboard details, the eligibility policy, the client status and the Studio fake.
import { describe, expect, it } from "@rbxts/jest-globals";
import { planPosts } from "shared/leaderboard";
import {
	RECORDS_CODEC,
	RECORDS_DATASTORE_NAME,
	RECORDS_DOC_VERSION,
	RECORDS_FAKE_RUN_ID,
	RECORDS_POLICY,
	bestOf,
	decodeRecordsDoc,
	docOfRun,
	emptyRecordsDoc,
	encodeRecordsDoc,
	isEmptyRecords,
	mergeRecordDocs,
	mergeRecords,
	mergeStoredRecords,
	parseFakeRecords,
	recordsEligibility,
	recordsStatusOf,
	runRecordsResult,
	sameRecordsDoc,
	seedFromDetails,
	type RecordsContext,
	type RecordsDoc,
} from "shared/records";
import { PlayerDocCache, type KeyValueStore } from "shared/settings";

const AT = 1_700_000_000;
const NO_RETRY = { attempts: 1, baseDelaySeconds: 0 };

function sampleDoc(): RecordsDoc {
	return {
		v: RECORDS_DOC_VERSION,
		endless: {
			solo: { score: 48210, scoreAt: AT, scoreRunId: "run-a", floor: 9, floorAt: AT + 10, floorRunId: "run-b" },
			coop: { score: 0, scoreAt: 0, scoreRunId: "", floor: 3, floorAt: AT, floorRunId: "run-c" },
		},
	};
}

function details(score: number, floor: number, runId: string, partySize = 1): unknown {
	const members: { userId: number; name: string }[] = [];
	for (let i = 1; i <= partySize; i++) members.push({ userId: i, name: `p${i}` });
	return planPosts({ runId, worldKind: "endless", members, score, floor, at: AT })[0].details;
}

class MemoryStore implements KeyValueStore {
	readonly data = new Map<string, unknown>();
	failGets = false;
	writes = 0;
	get(key: string): unknown {
		if (this.failGets) error("store down", 0);
		return this.data.get(key);
	}
	set(key: string, value: unknown): void {
		this.writes++;
		// The server's store is a merge write (UpdateAsync + mergeStoredRecords); mirror it.
		const merged = mergeStoredRecords(this.data.get(key), value as RecordsDoc);
		if (merged !== undefined) this.data.set(key, merged);
	}
}

describe("records doc codec", () => {
	it("round-trips a doc and names its store", () => {
		const doc = sampleDoc();
		const back = decodeRecordsDoc(encodeRecordsDoc(doc));
		expect(back).toEqual(doc);
		expect(sameRecordsDoc(back, doc)).toBe(true);
		expect(RECORDS_DATASTORE_NAME).toBe("KV_Records_v1");
		expect(RECORDS_CODEC.equals(RECORDS_CODEC.decode(RECORDS_CODEC.encode(doc)), doc)).toBe(true);
		expect(isEmptyRecords(RECORDS_CODEC.empty())).toBe(true);
	});

	it("reads missing, garbage and other versions as empty", () => {
		const bad: unknown[] = [
			undefined,
			"records",
			7,
			true,
			{},
			{ endless: sampleDoc().endless },
			{ v: RECORDS_DOC_VERSION + 1, endless: sampleDoc().endless },
			{ v: "1", endless: sampleDoc().endless },
			{ v: RECORDS_DOC_VERSION, endless: "x" },
			{ v: RECORDS_DOC_VERSION, endless: { solo: 5, coop: "y" } },
			{ v: RECORDS_DOC_VERSION, endless: { solo: { score: -1, floor: 1.5 } } },
			{ v: RECORDS_DOC_VERSION, endless: { solo: { score: 0 / 0, floor: math.huge } } },
		];
		for (const raw of bad) expect(decodeRecordsDoc(raw)).toEqual(emptyRecordsDoc());
	});

	it("decodes each board and field on its own", () => {
		const doc = decodeRecordsDoc({
			v: RECORDS_DOC_VERSION,
			endless: {
				solo: { score: 100, scoreAt: "later", scoreRunId: 5, floor: -2, floorAt: AT, floorRunId: "r" },
				coop: "junk",
				extra: { score: 1, floor: 1 },
			},
		});
		expect(doc.endless.solo).toEqual({
			score: 100,
			scoreAt: 0,
			scoreRunId: "",
			floor: 0,
			floorAt: 0,
			floorRunId: "",
		});
		expect(doc.endless.coop).toBeUndefined();
		const encoded = encodeRecordsDoc(doc) as unknown as { endless: Record<string, unknown> };
		expect(encoded.endless.extra).toBeUndefined();
	});
});

describe("mergeRecords", () => {
	const run = (score: number, floor: number, runId = "new") => ({ score, floor, at: AT + 100, runId });

	it("raises the score only", () => {
		const doc = sampleDoc();
		const m = mergeRecords(doc, "solo", run(50000, 8));
		expect(m.scoreImproved).toBe(true);
		expect(m.floorImproved).toBe(false);
		expect(m.previous).toEqual({ score: 48210, floor: 9 });
		expect(m.doc.endless.solo).toEqual({
			score: 50000,
			scoreAt: AT + 100,
			scoreRunId: "new",
			floor: 9,
			floorAt: AT + 10,
			floorRunId: "run-b",
		});
		expect(m.doc.endless.coop).toEqual(doc.endless.coop);
		// The input is untouched.
		expect(doc.endless.solo!.score).toBe(48210);
	});

	it("raises the floor only", () => {
		const m = mergeRecords(sampleDoc(), "solo", run(100, 12));
		expect([m.scoreImproved, m.floorImproved]).toEqual([false, true]);
		expect(m.doc.endless.solo!.score).toBe(48210);
		expect(m.doc.endless.solo!.scoreRunId).toBe("run-a");
		expect(m.doc.endless.solo!.floor).toBe(12);
		expect(m.doc.endless.solo!.floorRunId).toBe("new");
	});

	it("raises both", () => {
		const m = mergeRecords(sampleDoc(), "coop", run(900, 4));
		expect([m.scoreImproved, m.floorImproved]).toEqual([true, true]);
		expect(m.previous).toEqual({ score: 0, floor: 3 });
		expect(bestOf(m.doc, "coop")).toEqual({ score: 900, floor: 4 });
		expect(runRecordsResult("coop", m)).toEqual({
			board: "coop",
			scoreImproved: true,
			floorImproved: true,
			previous: { score: 0, floor: 3 },
		});
	});

	it("neither, a tie or lower never wins and returns the same doc", () => {
		const doc = sampleDoc();
		for (const r of [run(48210, 9), run(100, 2), run(0, 0), run(-5, 0 / 0), run(48211.5, 9.5)]) {
			const m = mergeRecords(doc, "solo", r);
			expect(m.scoreImproved).toBe(false);
			expect(m.floorImproved).toBe(false);
			expect(m.doc).toBe(doc);
		}
	});

	it("starts a first record from nothing", () => {
		const m = mergeRecords(emptyRecordsDoc(), "solo", run(1200, 2));
		expect(m.previous).toEqual({ score: 0, floor: 0 });
		expect([m.scoreImproved, m.floorImproved]).toEqual([true, true]);
		expect(m.doc).toEqual(docOfRun("solo", run(1200, 2)));
		// A floor-only first record (score 0).
		const f = mergeRecords(emptyRecordsDoc(), "coop", run(0, 1));
		expect([f.scoreImproved, f.floorImproved]).toEqual([false, true]);
		expect(f.doc.endless.coop!.scoreRunId).toBe("");
	});
});

describe("mergeRecordDocs / mergeStoredRecords", () => {
	it("merges per board and field; ties keep the first doc", () => {
		const a = sampleDoc();
		const b: RecordsDoc = {
			v: RECORDS_DOC_VERSION,
			endless: {
				solo: {
					score: 48210,
					scoreAt: AT + 999,
					scoreRunId: "tie",
					floor: 11,
					floorAt: AT + 5,
					floorRunId: "deep",
				},
			},
		};
		const m = mergeRecordDocs(a, b);
		expect(m.endless.solo).toEqual({
			score: 48210,
			scoreAt: AT,
			scoreRunId: "run-a",
			floor: 11,
			floorAt: AT + 5,
			floorRunId: "deep",
		});
		expect(m.endless.coop).toEqual(a.endless.coop);
	});

	it("never lowers a stored record and skips writes that change nothing", () => {
		const stored = encodeRecordsDoc(sampleDoc());
		expect(mergeStoredRecords(stored, docOfRun("solo", { score: 10, floor: 1, at: AT, runId: "x" }))).toBe(
			undefined,
		);
		const up = mergeStoredRecords(stored, docOfRun("solo", { score: 60000, floor: 1, at: AT, runId: "x" }));
		expect(up).toBeDefined();
		expect(bestOf(up!, "solo")).toEqual({ score: 60000, floor: 9 });
		expect(bestOf(up!, "coop")).toEqual({ score: 0, floor: 3 });
	});

	it("writes over nothing or junk, cancels over a newer version", () => {
		const incoming = docOfRun("coop", { score: 5, floor: 2, at: AT, runId: "x" });
		expect(mergeStoredRecords(undefined, incoming)).toEqual(incoming);
		expect(mergeStoredRecords("junk", incoming)).toEqual(incoming);
		expect(mergeStoredRecords(undefined, emptyRecordsDoc())).toBe(undefined);
		expect(mergeStoredRecords({ v: RECORDS_DOC_VERSION + 1, endless: {} }, incoming)).toBe(undefined);
		// A valid but empty stored doc gets the record.
		expect(mergeStoredRecords(encodeRecordsDoc(emptyRecordsDoc()), incoming)).toEqual(incoming);
	});
});

describe("seeded marker", () => {
	it("decodes old docs without it as unseeded and round-trips it", () => {
		const old = decodeRecordsDoc(encodeRecordsDoc(sampleDoc()));
		expect(old.seeded).toBeUndefined();
		const seeded: RecordsDoc = { ...sampleDoc(), seeded: true };
		const back = decodeRecordsDoc(encodeRecordsDoc(seeded));
		expect(back.seeded).toBe(true);
		expect(back).toEqual(seeded);
		// Anything but true is unseeded.
		for (const v of [false, 1, "true"]) {
			expect(decodeRecordsDoc({ ...encodeRecordsDoc(sampleDoc()), seeded: v }).seeded).toBeUndefined();
		}
		// A seeded doc with no boards is still empty of records, but differs from the unseeded empty doc.
		const bare = decodeRecordsDoc({ v: RECORDS_DOC_VERSION, endless: {}, seeded: true });
		expect(isEmptyRecords(bare)).toBe(true);
		expect(sameRecordsDoc(bare, emptyRecordsDoc())).toBe(false);
		expect(RECORDS_CODEC.equals(bare, emptyRecordsDoc())).toBe(false);
	});

	it("survives every merge once either side has it", () => {
		const seeded: RecordsDoc = { ...sampleDoc(), seeded: true };
		const run = docOfRun("solo", { score: 90000, floor: 1, at: AT, runId: "x" });
		expect(mergeRecordDocs(seeded, run).seeded).toBe(true);
		expect(mergeRecordDocs(run, seeded).seeded).toBe(true);
		expect(mergeRecordDocs(run, sampleDoc()).seeded).toBeUndefined();
		expect(mergeRecords(seeded, "solo", { score: 90000, floor: 1, at: AT, runId: "x" }).doc.seeded).toBe(true);
		// A merge write of a run alone over a seeded stored doc keeps the marker.
		const stored = mergeStoredRecords(encodeRecordsDoc(seeded), run);
		expect(stored!.seeded).toBe(true);
		expect(bestOf(stored!, "solo")).toEqual({ score: 90000, floor: 9 });
		// A run-alone write over nothing is not seeded, so the next join still seeds.
		expect(mergeStoredRecords(undefined, run)!.seeded).toBeUndefined();
	});

	it("is written alone (no leaderboard entry) and only once", () => {
		const bare = seedFromDetails({});
		expect(bare.seeded).toBe(true);
		// Over nothing, an unseeded empty doc or junk: written, so the next join does not read the board again.
		expect(mergeStoredRecords(undefined, bare)).toEqual(bare);
		expect(mergeStoredRecords(encodeRecordsDoc(emptyRecordsDoc()), bare)).toEqual(bare);
		expect(mergeStoredRecords("junk", bare)).toEqual(bare);
		// Over a doc that already has it: no write.
		expect(mergeStoredRecords(encodeRecordsDoc(bare), bare)).toBe(undefined);
		expect(mergeStoredRecords(encodeRecordsDoc({ ...sampleDoc(), seeded: true }), bare)).toBe(undefined);
		// Over unseeded records: the marker is added, the records kept.
		const up = mergeStoredRecords(encodeRecordsDoc(sampleDoc()), bare);
		expect(up!.seeded).toBe(true);
		expect(bestOf(up!, "solo")).toEqual({ score: 48210, floor: 9 });
	});

	it("seeds a non-empty doc by max-merge (a run written before the seed)", () => {
		// The join load failed earlier and a verdict wrote the run alone; the leaderboard best is higher.
		const before = docOfRun("solo", { score: 5000, floor: 12, at: AT + 50, runId: "late" });
		const seeded = mergeRecordDocs(before, seedFromDetails({ solo: details(48210, 9, "lb-solo") }));
		expect(seeded.seeded).toBe(true);
		expect(seeded.endless.solo).toEqual({
			score: 48210,
			scoreAt: AT,
			scoreRunId: "lb-solo",
			floor: 12,
			floorAt: AT + 50,
			floorRunId: "late",
		});
	});
});

describe("seedFromDetails", () => {
	it("seeds solo only", () => {
		const doc = seedFromDetails({ solo: details(48210, 9, "lb-solo") });
		expect(doc.endless.solo).toEqual({
			score: 48210,
			scoreAt: AT,
			scoreRunId: "lb-solo",
			floor: 9,
			floorAt: AT,
			floorRunId: "lb-solo",
		});
		expect(doc.endless.coop).toBeUndefined();
		expect(doc.seeded).toBe(true);
	});

	it("seeds both boards", () => {
		const doc = seedFromDetails({ solo: details(100, 2, "s"), coop: details(700, 5, "c", 3) });
		expect(bestOf(doc, "solo")).toEqual({ score: 100, floor: 2 });
		expect(bestOf(doc, "coop")).toEqual({ score: 700, floor: 5 });
	});

	it("skips malformed details per board", () => {
		const doc = seedFromDetails({ solo: { score: 5, floor: 1 }, coop: details(300, 4, "c", 2) });
		expect(doc.endless.solo).toBeUndefined();
		expect(bestOf(doc, "coop")).toEqual({ score: 300, floor: 4 });
		expect(isEmptyRecords(seedFromDetails({}))).toBe(true);
		expect(isEmptyRecords(seedFromDetails({ solo: "x", coop: 7 }))).toBe(true);
	});
});

describe("recordsEligibility", () => {
	const base: RecordsContext = {
		worldKind: "endless",
		partySize: 1,
		debug: false,
		studio: false,
		privateServer: false,
		died: true,
		bossDefeated: false,
	};

	it("counts endless deaths and abandoned runs, on private servers too", () => {
		expect(recordsEligibility(base)).toBe(undefined);
		expect(recordsEligibility({ ...base, died: false })).toBe(undefined);
		expect(recordsEligibility({ ...base, died: false, bossDefeated: true })).toBe(undefined);
		expect(recordsEligibility({ ...base, privateServer: true })).toBe(undefined);
		expect(RECORDS_POLICY.countAbandoned).toBe(true);
		expect(RECORDS_POLICY.writeFromStudio).toBe(false);
	});

	it("refuses other worlds, Studio and debug runs", () => {
		expect(recordsEligibility({ ...base, worldKind: "game" })).toBe("world");
		expect(recordsEligibility({ ...base, worldKind: "tutorial" })).toBe("world");
		expect(recordsEligibility({ ...base, studio: true })).toBe("studio");
		expect(recordsEligibility({ ...base, studio: true }, { ...RECORDS_POLICY, writeFromStudio: true })).toBe(
			undefined,
		);
		expect(recordsEligibility({ ...base, debug: true })).toBe("debug");
	});

	it("checks the party like the leaderboard", () => {
		expect(recordsEligibility({ ...base, partySize: 0 })).toBe("party");
		expect(recordsEligibility({ ...base, partySize: 99 })).toBe("party");
		expect(recordsEligibility({ ...base, partySize: 3, contributors: 2 })).toBe(undefined);
		expect(recordsEligibility({ ...base, partySize: 2, contributors: 1 })).toBe("contributors");
		expect(recordsEligibility({ ...base, died: false }, { ...RECORDS_POLICY, countAbandoned: false })).toBe(
			"abandoned",
		);
	});
});

describe("recordsStatusOf", () => {
	it("sends the boards only when loaded", () => {
		expect(recordsStatusOf(sampleDoc(), true)).toEqual({
			loaded: true,
			solo: { score: 48210, floor: 9 },
			coop: { score: 0, floor: 3 },
		});
		expect(recordsStatusOf(sampleDoc(), false)).toEqual({ loaded: false });
		expect(recordsStatusOf(undefined, true)).toEqual({ loaded: true });
		expect(recordsStatusOf(emptyRecordsDoc(), true)).toEqual({ loaded: true });
	});
});

describe("parseFakeRecords", () => {
	it("parses boards, 0:0 as none, keywords", () => {
		const fake = parseFakeRecords("solo:48210:9,coop:0:0");
		expect(fake).toBeDefined();
		expect(fake!.loaded).toBe(true);
		expect(fake!.doc.endless.solo).toEqual({
			score: 48210,
			scoreAt: 0,
			scoreRunId: RECORDS_FAKE_RUN_ID,
			floor: 9,
			floorAt: 0,
			floorRunId: RECORDS_FAKE_RUN_ID,
		});
		expect(fake!.doc.endless.coop).toBeUndefined();
		expect(bestOf(parseFakeRecords(" Coop : 12 : 3 ")!.doc, "coop")).toEqual({ score: 12, floor: 3 });
		expect(parseFakeRecords("none")).toEqual({ loaded: true, doc: emptyRecordsDoc() });
		expect(parseFakeRecords("UNKNOWN")).toEqual({ loaded: false, doc: emptyRecordsDoc() });
	});

	it("is no fake for anything else", () => {
		for (const v of [
			undefined,
			5,
			true,
			"",
			"  ",
			"solo",
			"solo:1",
			"solo:1:2:3",
			"duo:1:2",
			"solo:-1:2",
			"solo:1.5:2",
			"solo:1:2,",
		]) {
			expect(parseFakeRecords(v)).toBe(undefined);
		}
	});
});

describe("records PlayerDocCache", () => {
	it("a failed load never writes by itself; a merge write never lowers", () => {
		const store = new MemoryStore();
		store.data.set("u_1", encodeRecordsDoc(sampleDoc()));
		store.failGets = true;
		const failed = new PlayerDocCache(store, RECORDS_CODEC, NO_RETRY, () => {});
		expect(isEmptyRecords(failed.load("u_1"))).toBe(true);
		expect(failed.loadFailed("u_1")).toBe(true);
		expect(failed.release("u_1")).toBe("clean");
		expect(store.writes).toBe(0);

		// Even a lower doc saved through the merge store keeps the stored records.
		store.failGets = false;
		const cache = new PlayerDocCache(store, RECORDS_CODEC, NO_RETRY, () => {});
		cache.load("u_2");
		cache.set("u_2", docOfRun("solo", { score: 10, floor: 1, at: AT, runId: "x" }));
		store.data.set("u_2", encodeRecordsDoc(sampleDoc())); // another server wrote a better record meanwhile
		expect(cache.save("u_2")).toBe("saved");
		expect(bestOf(decodeRecordsDoc(store.data.get("u_2")), "solo")).toEqual({ score: 48210, floor: 9 });
	});
});

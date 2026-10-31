// First sightings in the onboarding doc (docs/ENEMY_VARIANTS.md EV12, plan change 9): the optional `seen` list under
// doc version 1 (old docs decode exactly as before, tutorial state intact), round trips, malformed input, the merge
// helpers (a finish keeps sightings, a sighting keeps the tutorial), the status, and the ids vs the theme's lines.
import { describe, expect, it } from "@rbxts/jest-globals";
import { BESTIARY_STRING_KEYS } from "shared/theme";
import { PlayerDocCache, type KeyValueStore } from "shared/settings";
import {
	AFFIX_SIGHTING_IDS,
	BESTIARY_SEEN_RATE,
	ONBOARDING_CODEC,
	ONBOARDING_DOC_VERSION,
	ONBOARDING_TUTORIAL_VERSION,
	SEEN_SCAN_LIMIT,
	SIGHTING_IDS,
	decodeOnboardingDoc,
	emptyOnboardingDoc,
	encodeOnboardingDoc,
	finishedOnboardingDoc,
	isSightingId,
	isTutorialDone,
	normalizeSeen,
	onboardingStatusOf,
	sameOnboardingDoc,
	seenOf,
	sightingStringKey,
	withSeenId,
	withSighting,
	type OnboardingDoc,
} from ".";

const AT = 1_700_000_000;
const NO_RETRY = { attempts: 1, baseDelaySeconds: 0 };
const KEY = "u_1";
const noWait = () => {};

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
		this.data.set(key, value);
	}
}

describe("sighting ids", () => {
	it("are the theme's bestiary lines, archetypes then affixes (AffixKind order)", () => {
		expect(SIGHTING_IDS.map(sightingStringKey)).toEqual([...BESTIARY_STRING_KEYS]);
		expect([...AFFIX_SIGHTING_IDS]).toEqual(["affix.hulking", "affix.swift", "affix.shielded", "affix.vengeful"]);
		for (const id of AFFIX_SIGHTING_IDS) expect(SIGHTING_IDS).toContain(id);
		expect(SEEN_SCAN_LIMIT).toBe(2 * SIGHTING_IDS.size());
		expect([BESTIARY_SEEN_RATE.count, BESTIARY_SEEN_RATE.windowSeconds]).toEqual([10, 10]);
	});

	it("isSightingId accepts known ids only", () => {
		for (const id of SIGHTING_IDS) expect(isSightingId(id)).toBe(true);
		for (const v of ["slime.small", "Imp", "bestiary.imp", "affix.", "", 1, undefined, {}, ["imp"]])
			expect(isSightingId(v)).toBe(false);
	});

	it("normalizeSeen: known ids, once each, canonical order; anything else contributes nothing", () => {
		expect(normalizeSeen(["affix.swift", "imp", "imp", "nope", 3, "summoner"])).toEqual([
			"imp",
			"summoner",
			"affix.swift",
		]);
		for (const raw of [undefined, "imp", 7, true, {}, { imp: true }]) expect(normalizeSeen(raw)).toEqual([]);
		// At most SEEN_SCAN_LIMIT entries are read.
		const long: string[] = [];
		for (let i = 0; i < SEEN_SCAN_LIMIT; i++) long.push("bogus");
		long.push("imp");
		expect(normalizeSeen(long)).toEqual([]);
		expect(withSighting(["slime"], "imp")).toEqual(["imp", "slime"]);
		expect(withSighting(["slime"], "nope")).toEqual(["slime"]);
	});
});

describe("onboarding doc: seen under version 1", () => {
	it("the doc version is still 1 (a bump would send every player through the tutorial again)", () => {
		expect(ONBOARDING_DOC_VERSION).toBe(1);
	});

	it("an old doc (no seen) decodes exactly as before: tutorial state intact, nothing seen", () => {
		const old = { v: 1, tutorialVersion: 1, outcome: "completed", at: AT };
		const doc = decodeOnboardingDoc(old);
		expect(doc).toEqual({ tutorialVersion: 1, outcome: "completed", at: AT });
		expect(doc.seen).toBe(undefined);
		expect(seenOf(doc)).toEqual([]);
		expect(isTutorialDone(doc)).toBe(true);
		expect(onboardingStatusOf(doc, true)).toEqual({ loaded: true, tutorialDone: true });
		// Re-encoded unchanged (no `seen` key appears).
		expect(encodeOnboardingDoc(doc)).toEqual(old);
		const skipped = decodeOnboardingDoc({ v: 1, tutorialVersion: 1, outcome: "skipped", at: AT });
		expect(isTutorialDone(skipped)).toBe(true);
	});

	it("round-trips a doc with sightings; encode writes them canonical, decode reads them back", () => {
		const doc = finishedOnboardingDoc("completed", AT, ["affix.vengeful", "imp"]);
		expect(doc.seen).toEqual(["imp", "affix.vengeful"]);
		const stored = encodeOnboardingDoc(doc);
		expect(stored).toEqual({
			v: ONBOARDING_DOC_VERSION,
			tutorialVersion: ONBOARDING_TUTORIAL_VERSION,
			outcome: "completed",
			at: AT,
			seen: ["imp", "affix.vengeful"],
		});
		const back = decodeOnboardingDoc(stored);
		expect(back).toEqual(doc);
		expect(sameOnboardingDoc(back, doc)).toBe(true);
		// A player who never finished the tutorial can have sightings too (e.g. it was forced off with KV_Tutorial).
		const fresh = withSeenId(emptyOnboardingDoc(), "slime");
		expect(decodeOnboardingDoc(encodeOnboardingDoc(fresh))).toEqual({
			tutorialVersion: 0,
			outcome: "skipped",
			at: 0,
			seen: ["slime"],
		});
	});

	it("a malformed seen alone reads as nothing seen and keeps the tutorial fields", () => {
		const bad: unknown[] = ["imp", 5, true, { imp: 1 }, [1, 2], ["nope"], [undefined]];
		for (const seen of bad) {
			const doc = decodeOnboardingDoc({ v: 1, tutorialVersion: 1, outcome: "completed", at: AT, seen });
			expect(doc).toEqual({ tutorialVersion: 1, outcome: "completed", at: AT });
			expect(isTutorialDone(doc)).toBe(true);
		}
		// Unknown and duplicate ids are dropped, the rest kept in order.
		const mixed = decodeOnboardingDoc({
			v: 1,
			tutorialVersion: 1,
			outcome: "skipped",
			at: AT,
			seen: ["summoner", "slime.small", "imp", "summoner", 9],
		});
		expect(mixed.seen).toEqual(["imp", "summoner"]);
		// A bad tutorial field still empties the doc, sightings included (the safe direction, as before).
		expect(
			decodeOnboardingDoc({ v: 1, tutorialVersion: "1", outcome: "completed", at: AT, seen: ["imp"] }),
		).toEqual(emptyOnboardingDoc());
		expect(decodeOnboardingDoc({ v: 2, tutorialVersion: 1, outcome: "completed", at: AT, seen: ["imp"] })).toEqual(
			emptyOnboardingDoc(),
		);
	});

	it("equals compares the sightings too; the empty doc has none", () => {
		const a = finishedOnboardingDoc("completed", AT);
		expect(sameOnboardingDoc(a, withSeenId(a, "imp"))).toBe(false);
		expect(sameOnboardingDoc(withSeenId(a, "imp"), withSeenId(a, "imp"))).toBe(true);
		expect(sameOnboardingDoc(withSeenId(a, "imp"), withSeenId(a, "slime"))).toBe(false);
		expect(ONBOARDING_CODEC.equals(ONBOARDING_CODEC.empty(), emptyOnboardingDoc())).toBe(true);
		expect(emptyOnboardingDoc().seen).toBe(undefined);
	});
});

describe("onboarding doc: merge-safe updates", () => {
	it("withSeenId keeps every tutorial field, adds canonically, and is idempotent (same object back)", () => {
		const doc = finishedOnboardingDoc("skipped", AT);
		const one = withSeenId(doc, "summoner");
		expect(one).toEqual({
			tutorialVersion: ONBOARDING_TUTORIAL_VERSION,
			outcome: "skipped",
			at: AT,
			seen: ["summoner"],
		});
		expect(doc.seen).toBe(undefined); // the input is untouched
		const two = withSeenId(one, "imp");
		expect(two.seen).toEqual(["imp", "summoner"]);
		expect(withSeenId(two, "imp")).toBe(two);
		expect(withSeenId(two, "not.an.id")).toBe(two);
	});

	it("a finish keeps the sightings seen before it (seenOf the current doc)", () => {
		const before = withSeenId(withSeenId(emptyOnboardingDoc(), "imp"), "affix.swift");
		const after = finishedOnboardingDoc("completed", AT, seenOf(before));
		expect(after).toEqual({
			tutorialVersion: ONBOARDING_TUTORIAL_VERSION,
			outcome: "completed",
			at: AT,
			seen: ["imp", "affix.swift"],
		});
		expect(finishedOnboardingDoc("completed", AT).seen).toBe(undefined);
	});

	it("the status carries the sightings only when there are some", () => {
		const doc = withSeenId(finishedOnboardingDoc("completed", AT), "slime");
		expect(onboardingStatusOf(doc, true)).toEqual({ loaded: true, tutorialDone: true, seen: ["slime"] });
		expect(onboardingStatusOf(undefined, true)).toEqual({ loaded: true, tutorialDone: false });
	});
});

describe("onboarding doc in PlayerDocCache: sightings", () => {
	it("a sighting on an old stored doc is written once, tutorial kept; a repeat writes nothing", () => {
		const store = new MemoryStore();
		store.data.set(KEY, { v: 1, tutorialVersion: 1, outcome: "completed", at: AT });
		const cache = new PlayerDocCache<OnboardingDoc>(store, ONBOARDING_CODEC, NO_RETRY, noWait);
		const doc = cache.load(KEY, [1]);
		expect(cache.set(KEY, withSeenId(doc, "imp"))).toBe(true);
		expect(cache.isDirty(KEY)).toBe(true);
		expect(cache.save(KEY)).toBe("saved");
		expect(store.data.get(KEY)).toEqual({ v: 1, tutorialVersion: 1, outcome: "completed", at: AT, seen: ["imp"] });
		cache.set(KEY, withSeenId(cache.get(KEY)!, "imp"));
		expect(cache.isDirty(KEY)).toBe(false);
		expect(cache.release(KEY)).toBe("clean");
		expect(store.writes).toBe(1);

		const later = new PlayerDocCache<OnboardingDoc>(store, ONBOARDING_CODEC, NO_RETRY, noWait);
		const loaded = later.load(KEY, [1]);
		expect(isTutorialDone(loaded)).toBe(true);
		expect(seenOf(loaded)).toEqual(["imp"]);
	});

	it("a player who has seen nothing keeps the old stored shape (a finish writes no seen key)", () => {
		const store = new MemoryStore();
		const cache = new PlayerDocCache<OnboardingDoc>(store, ONBOARDING_CODEC, NO_RETRY, noWait);
		cache.load(KEY, [1]);
		cache.set(KEY, finishedOnboardingDoc("skipped", AT, seenOf(cache.get(KEY))));
		expect(cache.release(KEY)).toBe("saved");
		expect(store.data.get(KEY)).toEqual({ v: 1, tutorialVersion: 1, outcome: "skipped", at: AT });
	});
});

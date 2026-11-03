// Onboarding (first-run tutorial, docs/TUTORIAL.md §5-6): the stored document's codec, the done rule, the
// PlayerDocCache failure rule with this codec, the new-player doc fields (docs/TUTORIAL_FUNNEL.md TF2), and the
// tutorial attempt funnel filter.
import { describe, expect, it } from "@rbxts/jest-globals";
import { TUTORIAL_STEPS, TUTORIAL_STEP_COUNT } from "shared/tutorial";
import {
	MAX_TUTORIAL_STEP_NAME_CHARS,
	NEW_PLAYER,
	ONBOARDING_CODEC,
	ONBOARDING_DOC_VERSION,
	ONBOARDING_TUTORIAL_VERSION,
	TUTORIAL_FUNNEL,
	TUTORIAL_FUNNEL_COMPLETED_STEP,
	TUTORIAL_FUNNEL_MAX_STEP,
	TUTORIAL_SKIPPED_EVENT,
	TutorialFunnelTracker,
	decodeOnboardingDoc,
	emptyOnboardingDoc,
	encodeOnboardingDoc,
	finishedOnboardingDoc,
	isTutorialDone,
	isTutorialOutcome,
	isTutorialStepNumber,
	SIGHTING_IDS,
	newPlayerFieldsOf,
	onboardingStatusOf,
	sameOnboardingDoc,
	seenOf,
	tutorialFunnelStepName,
	tutorialFinishEvents,
	tutorialStepEvent,
	withNewPlayerFields,
	withSeenId,
	type OnboardingDoc,
	type TutorialStartInfo,
} from "shared/onboarding";
import { PlayerDocCache, type KeyValueStore } from "shared/settings";

const AT = 1_700_000_000;
const NO_RETRY = { attempts: 1, baseDelaySeconds: 0 };

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

describe("onboarding doc codec", () => {
	it("round-trips a finished doc", () => {
		for (const outcome of ["completed", "skipped"] as const) {
			const doc = finishedOnboardingDoc(outcome, AT);
			const back = decodeOnboardingDoc(encodeOnboardingDoc(doc));
			expect(back).toEqual(doc);
			expect(sameOnboardingDoc(back, doc)).toBe(true);
		}
		expect(encodeOnboardingDoc(finishedOnboardingDoc("completed", AT))).toEqual({
			v: ONBOARDING_DOC_VERSION,
			tutorialVersion: ONBOARDING_TUTORIAL_VERSION,
			outcome: "completed",
			at: AT,
		});
	});

	it("reads missing, garbage and old shapes as the empty doc", () => {
		const empty = emptyOnboardingDoc();
		expect(empty.tutorialVersion).toBe(0);
		const bad: unknown[] = [
			undefined,
			"done",
			7,
			true,
			{},
			{ tutorialVersion: 1, outcome: "completed", at: AT }, // no doc version
			{ v: ONBOARDING_DOC_VERSION + 1, tutorialVersion: 1, outcome: "completed", at: AT },
			{ v: ONBOARDING_DOC_VERSION, tutorialVersion: "1", outcome: "completed", at: AT },
			{ v: ONBOARDING_DOC_VERSION, tutorialVersion: 0 / 0, outcome: "completed", at: AT },
			{ v: ONBOARDING_DOC_VERSION, tutorialVersion: math.huge, outcome: "completed", at: AT },
			{ v: ONBOARDING_DOC_VERSION, tutorialVersion: 1.5, outcome: "completed", at: AT },
			{ v: ONBOARDING_DOC_VERSION, tutorialVersion: -1, outcome: "completed", at: AT },
			{ v: ONBOARDING_DOC_VERSION, tutorialVersion: 1, outcome: "won", at: AT },
			{ v: ONBOARDING_DOC_VERSION, tutorialVersion: 1 },
		];
		for (const raw of bad) expect(decodeOnboardingDoc(raw)).toEqual(empty);
	});

	it("a bad timestamp alone keeps the done flag", () => {
		for (const at of [0 / 0, -5, "yesterday", undefined]) {
			const doc = decodeOnboardingDoc({ v: ONBOARDING_DOC_VERSION, tutorialVersion: 1, outcome: "skipped", at });
			expect(doc).toEqual({ tutorialVersion: 1, outcome: "skipped", at: 0 });
			expect(isTutorialDone(doc)).toBe(true);
		}
	});

	it("equals compares every field", () => {
		const a = finishedOnboardingDoc("completed", AT);
		expect(sameOnboardingDoc(a, { ...a, at: AT + 1 })).toBe(false);
		expect(sameOnboardingDoc(a, { ...a, outcome: "skipped" })).toBe(false);
		expect(sameOnboardingDoc(a, { ...a, tutorialVersion: 2 })).toBe(false);
		expect(ONBOARDING_CODEC.equals(ONBOARDING_CODEC.empty(), emptyOnboardingDoc())).toBe(true);
	});

	it("done = the stored version is the current one or later; the status follows it", () => {
		expect(isTutorialDone(emptyOnboardingDoc())).toBe(false);
		expect(isTutorialDone(finishedOnboardingDoc("skipped", AT))).toBe(true);
		expect(isTutorialDone({ tutorialVersion: ONBOARDING_TUTORIAL_VERSION - 1, outcome: "completed", at: AT })).toBe(
			false,
		);
		expect(isTutorialDone({ tutorialVersion: ONBOARDING_TUTORIAL_VERSION + 1, outcome: "completed", at: AT })).toBe(
			true,
		);
		expect(onboardingStatusOf(finishedOnboardingDoc("completed", AT), true)).toEqual({
			loaded: true,
			tutorialDone: true,
		});
		expect(onboardingStatusOf(emptyOnboardingDoc(), false)).toEqual({ loaded: false, tutorialDone: false });
		expect(onboardingStatusOf(undefined, true)).toEqual({ loaded: true, tutorialDone: false });
	});

	it("outcome check", () => {
		expect(isTutorialOutcome("completed")).toBe(true);
		expect(isTutorialOutcome("skipped")).toBe(true);
		expect(isTutorialOutcome("Completed")).toBe(false);
		expect(isTutorialOutcome(1)).toBe(false);
	});
});

describe("onboarding doc in PlayerDocCache", () => {
	const KEY = "u_1";
	const noWait = () => {};

	it("a new player loads empty; a finish is written once; the next session loads it as done", () => {
		const store = new MemoryStore();
		const cache = new PlayerDocCache<OnboardingDoc>(store, ONBOARDING_CODEC, NO_RETRY, noWait);
		expect(isTutorialDone(cache.load(KEY, [1]))).toBe(false);
		expect(cache.release(KEY)).toBe("clean");
		expect(store.writes).toBe(0);

		const second = new PlayerDocCache<OnboardingDoc>(store, ONBOARDING_CODEC, NO_RETRY, noWait);
		second.load(KEY, [1]);
		second.set(KEY, finishedOnboardingDoc("skipped", AT));
		expect(second.release(KEY)).toBe("saved");
		expect(store.writes).toBe(1);

		const third = new PlayerDocCache<OnboardingDoc>(store, ONBOARDING_CODEC, NO_RETRY, noWait);
		expect(third.load(KEY, [1])).toEqual(finishedOnboardingDoc("skipped", AT));
	});

	it("a failed load runs on the empty doc and never overwrites the stored value by itself", () => {
		const store = new MemoryStore();
		store.data.set(KEY, encodeOnboardingDoc(finishedOnboardingDoc("completed", AT)));
		store.failGets = true;
		const cache = new PlayerDocCache<OnboardingDoc>(store, ONBOARDING_CODEC, NO_RETRY, noWait);
		const doc = cache.load(KEY, [1]);
		expect(cache.loadFailed(KEY)).toBe(true);
		expect(onboardingStatusOf(doc, !cache.loadFailed(KEY))).toEqual({ loaded: false, tutorialDone: false });
		expect(cache.release(KEY)).toBe("clean");
		expect(store.writes).toBe(0);
		expect(store.data.get(KEY)).toEqual(encodeOnboardingDoc(finishedOnboardingDoc("completed", AT)));
	});

	it("the dev reset (empty doc set over a loaded one) is saved like any change", () => {
		const store = new MemoryStore();
		store.data.set(KEY, encodeOnboardingDoc(finishedOnboardingDoc("completed", AT)));
		const cache = new PlayerDocCache<OnboardingDoc>(store, ONBOARDING_CODEC, NO_RETRY, noWait);
		cache.load(KEY, [1]);
		cache.set(KEY, emptyOnboardingDoc());
		expect(isTutorialDone(cache.get(KEY)!)).toBe(false);
		expect(cache.release(KEY)).toBe("saved");
		expect(decodeOnboardingDoc(store.data.get(KEY))).toEqual(emptyOnboardingDoc());
	});
});

describe("onboarding doc: new-player fields (TF2)", () => {
	const base = { v: ONBOARDING_DOC_VERSION, tutorialVersion: 1, outcome: "completed", at: AT };

	it("old docs decode without them; the stored shape is unchanged without them", () => {
		const doc = decodeOnboardingDoc(base);
		expect(doc.firstDay).toBe(undefined);
		expect(doc.newRuns).toBe(undefined);
		expect(doc.returned).toBe(undefined);
		expect(encodeOnboardingDoc(doc)).toEqual(base);
	});

	it("round-trips every field; equals compares each", () => {
		const doc: OnboardingDoc = {
			...finishedOnboardingDoc("skipped", AT),
			firstDay: 20_000,
			newRuns: 2,
			returned: true,
		};
		const stored = encodeOnboardingDoc(doc);
		expect(stored.firstDay).toBe(20_000);
		expect(stored.newRuns).toBe(2);
		expect(stored.returned).toBe(true);
		const back = ONBOARDING_CODEC.decode(stored);
		expect(back).toEqual(doc);
		expect(ONBOARDING_CODEC.equals(back, doc)).toBe(true);
		expect(sameOnboardingDoc(doc, { ...doc, firstDay: 20_001 })).toBe(false);
		expect(sameOnboardingDoc(doc, { ...doc, newRuns: 3 })).toBe(false);
		expect(sameOnboardingDoc(doc, { ...doc, returned: undefined })).toBe(false);
		expect(sameOnboardingDoc(doc, { ...doc, firstDay: undefined })).toBe(false);
		// newRuns 0 and returned false are kept (written as stored).
		const zero: OnboardingDoc = { ...emptyOnboardingDoc(), firstDay: 5, newRuns: 0, returned: false };
		expect(decodeOnboardingDoc(encodeOnboardingDoc(zero))).toEqual(zero);
	});

	it("a malformed field decodes as absent and never touches the rest", () => {
		const bad: Array<[string, unknown]> = [
			["firstDay", -1],
			["firstDay", 1.5],
			["firstDay", 0 / 0],
			["firstDay", math.huge],
			["firstDay", "20000"],
			["newRuns", -1],
			["newRuns", NEW_PLAYER.runs + 1],
			["newRuns", 0.5],
			["newRuns", true],
			["returned", 1],
			["returned", "yes"],
		];
		for (const [key, value] of bad) {
			const raw: Record<string, unknown> = { ...base, firstDay: 7, newRuns: 1, returned: true };
			raw[key] = value;
			const doc = decodeOnboardingDoc(raw);
			expect((doc as unknown as Record<string, unknown>)[key]).toBe(undefined);
			expect(isTutorialDone(doc)).toBe(true);
			expect(doc.outcome).toBe("completed");
			for (const other of ["firstDay", "newRuns", "returned"]) {
				if (other === key) continue;
				expect((doc as unknown as Record<string, unknown>)[other]).toBe(raw[other]);
			}
		}
	});

	it("finishing and sightings keep the new-player fields", () => {
		const doc: OnboardingDoc = { ...emptyOnboardingDoc(), firstDay: 9, newRuns: 1 };
		const finished = finishedOnboardingDoc("completed", AT, seenOf(doc), doc);
		expect(finished.firstDay).toBe(9);
		expect(finished.newRuns).toBe(1);
		expect(finished.returned).toBe(undefined);
		expect(finishedOnboardingDoc("completed", AT).firstDay).toBe(undefined);
		const seen = withSeenId(doc, SIGHTING_IDS[0]);
		expect(seen.firstDay).toBe(9);
		expect(seen.newRuns).toBe(1);
		const patched = withNewPlayerFields(finished, { returned: true });
		expect(patched).toEqual({ ...finished, returned: true });
		expect(newPlayerFieldsOf({ firstDay: -3, newRuns: 2, returned: false })).toEqual({
			newRuns: 2,
			returned: false,
		});
	});
});

describe("tutorial attempt funnel filter", () => {
	const INFO: TutorialStartInfo = { entry: "firstJoin", device: "keyboard" };

	it("drops steps outside an attempt", () => {
		const t = new TutorialFunnelTracker();
		expect(t.isActive()).toBe(false);
		expect(t.accept(1)).toBe(false);
		expect(t.finish()).toBe(undefined);
		expect(t.start("a", INFO)).toBe(undefined);
		expect(t.finish()).toEqual({
			attemptId: "a",
			lastStep: 0,
			entry: "firstJoin",
			device: "keyboard",
			stepId: TUTORIAL_STEPS[0].id,
			logged: true,
		});
		expect(t.accept(1)).toBe(false);
	});

	it("accepts only strictly increasing integer steps in 1..max", () => {
		const t = new TutorialFunnelTracker(5);
		t.start("a", INFO);
		expect(t.getAttemptId()).toBe("a");
		const tries = [0, -1, 1.5, 0 / 0, math.huge, 6, 1, 1, 3, 2, 3, 5, 4, 5];
		const accepted: number[] = [];
		for (const s of tries) if (t.accept(s)) accepted.push(s);
		expect(accepted).toEqual([1, 3, 5]);
		expect(t.getLastStep()).toBe(5);
		expect(t.finish()?.lastStep).toBe(5);
		expect(t.isActive()).toBe(false);
	});

	it("a restart without a new attempt logs nothing again; a new attempt starts over", () => {
		const t = new TutorialFunnelTracker(5);
		t.start("a", INFO);
		expect(t.accept(1)).toBe(true);
		expect(t.accept(2)).toBe(true);
		// The client restarted its tutorial but did not send tutorialStarted: same attempt, repeats are dropped.
		expect(t.accept(1)).toBe(false);
		expect(t.accept(2)).toBe(false);
		expect(t.accept(3)).toBe(true);
		// "Restart tutorial" sends tutorialStarted: a new attempt (new funnel session) counts from 1 again, and the
		// replaced attempt comes back closed (logged as restarted).
		const replaced = t.start("b", { entry: "restart", device: "gamepad" });
		expect(replaced?.attemptId).toBe("a");
		expect(replaced?.lastStep).toBe(3);
		expect(replaced?.stepId).toBe(TUTORIAL_STEPS[3].id);
		expect(t.getLastStep()).toBe(0);
		expect(t.accept(1)).toBe(true);
		const ended = t.finish();
		expect(ended?.attemptId).toBe("b");
		expect(ended?.entry).toBe("restart");
		expect(ended?.device).toBe("gamepad");
	});

	it("clear drops the attempt (player left)", () => {
		const t = new TutorialFunnelTracker();
		t.start("a", INFO);
		t.accept(2);
		t.clear();
		expect(t.isActive()).toBe(false);
		expect(t.getLastStep()).toBe(0);
	});

	it("step numbers and names are bounded", () => {
		expect(isTutorialStepNumber(1)).toBe(true);
		expect(isTutorialStepNumber(TUTORIAL_FUNNEL_MAX_STEP)).toBe(true);
		expect(isTutorialStepNumber(TUTORIAL_FUNNEL_MAX_STEP + 1)).toBe(false);
		expect(isTutorialStepNumber("1")).toBe(false);
		expect(TUTORIAL_FUNNEL_MAX_STEP).toBe(TUTORIAL_STEP_COUNT);
		// Names come from the shared step list by number (the client sends only the number).
		for (const s of TUTORIAL_STEPS) {
			expect(tutorialFunnelStepName(s.number)).toBe(s.id);
			expect(s.id.size() <= MAX_TUTORIAL_STEP_NAME_CHARS).toBe(true);
			expect(s.id.match("^[%w_]+$")[0] !== undefined).toBe(true);
		}
		expect(tutorialFunnelStepName(0)).toBe("step0");
		expect(tutorialFunnelStepName(TUTORIAL_FUNNEL_MAX_STEP + 1)).toBe(`step${TUTORIAL_FUNNEL_MAX_STEP + 1}`);
	});

	it("events: started is step 1, lesson n is n + 1, completed follows the last lesson; a skip is a custom event", () => {
		expect(TUTORIAL_FUNNEL).toBe("TutorialAttempt");
		expect(tutorialStepEvent(3)).toEqual({
			kind: "funnel",
			funnel: TUTORIAL_FUNNEL,
			step: 4,
			stepName: TUTORIAL_STEPS[2].id,
		});
		const ended = {
			attemptId: "a",
			lastStep: 4,
			entry: "menu" as const,
			device: "touch" as const,
			stepId: "roll",
			logged: true,
		};
		expect(tutorialFinishEvents("completed", ended)).toEqual([
			{ kind: "funnel", funnel: TUTORIAL_FUNNEL, step: TUTORIAL_FUNNEL_COMPLETED_STEP, stepName: "completed" },
		]);
		expect(TUTORIAL_FUNNEL_COMPLETED_STEP).toBe(TUTORIAL_FUNNEL_MAX_STEP + 2);
		// Pinned for the 18-lesson tutorial (revision 3, docs/PELLETS.md PL13): lessons are steps 2..19.
		expect(TUTORIAL_FUNNEL_MAX_STEP).toBe(18);
		expect(TUTORIAL_FUNNEL_COMPLETED_STEP).toBe(20);
		expect(tutorialFinishEvents("skipped", ended)).toEqual([
			{
				kind: "custom",
				name: TUTORIAL_SKIPPED_EVENT,
				value: 4,
				fields: { field01: "roll", field02: "menu", field03: "touch" },
			},
		]);
	});
});

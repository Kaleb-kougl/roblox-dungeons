// The once-per-user onboarding funnel (docs/TUTORIAL_FUNNEL.md §2, TF3): open only for fresh players, Joined after the
// entry (or `unknown` on a leave), bypassed players stop at Joined, strictly increasing steps, skip / complete close,
// a menu replay never logs, the gate once per session.
import { describe, expect, it } from "@rbxts/jest-globals";
import type { AnalyticsEventSpec } from "shared/run";
import { TUTORIAL_STEPS, TUTORIAL_STEP_COUNT } from "shared/tutorial";
import {
	MAX_TUTORIAL_STEP_NAME_CHARS,
	ONBOARDING_FUNNEL,
	ONBOARDING_FUNNEL_STEPS,
	OnboardingFunnelTracker,
	TUTORIAL_ANALYTICS_EVENT,
	onboardingJoinedEvent,
	onboardingLessonStep,
} from "shared/onboarding";

const FRESH = { loaded: true, fresh: true };

/** The onboarding step numbers of `specs` (fails on any other kind). */
function steps(specs: ReadonlyArray<AnalyticsEventSpec>): number[] {
	return specs.map((s) => {
		if (s.kind !== "onboarding") error(`not an onboarding step: ${s.kind}`, 0);
		return s.step;
	});
}

describe("onboarding funnel steps", () => {
	it("Joined, Loaded, TutorialStarted, the lessons, Completed; names unique and short", () => {
		expect(ONBOARDING_FUNNEL_STEPS.size()).toBe(TUTORIAL_STEP_COUNT + 4);
		expect(ONBOARDING_FUNNEL_STEPS[0]).toBe("Joined");
		expect(ONBOARDING_FUNNEL_STEPS[1]).toBe("Loaded");
		expect(ONBOARDING_FUNNEL_STEPS[2]).toBe("TutorialStarted");
		for (const s of TUTORIAL_STEPS) {
			expect(onboardingLessonStep(s.number)).toBe(s.number + 3);
			expect(ONBOARDING_FUNNEL_STEPS[onboardingLessonStep(s.number) - 1]).toBe(s.id);
		}
		expect(ONBOARDING_FUNNEL.completed.step).toBe(TUTORIAL_STEP_COUNT + 4);
		// Pinned for the 18-lesson tutorial (revision 3, docs/PELLETS.md PL13): lessons are steps 4..21.
		expect(TUTORIAL_STEP_COUNT).toBe(18);
		expect(ONBOARDING_FUNNEL.completed.step).toBe(22);
		expect(ONBOARDING_FUNNEL_STEPS[ONBOARDING_FUNNEL.completed.step - 1]).toBe("Completed");
		const seen = new Set<string>();
		for (const n of ONBOARDING_FUNNEL_STEPS) {
			expect(seen.has(n)).toBe(false);
			seen.add(n);
			expect(n.size() <= MAX_TUTORIAL_STEP_NAME_CHARS).toBe(true);
		}
	});

	it("Joined carries entry, revision and the experiment arm", () => {
		expect(onboardingJoinedEvent("organic")).toEqual({
			kind: "onboarding",
			step: 1,
			stepName: "Joined",
			fields: { field01: "organic", field02: "t1r3", field03: "none" },
		});
	});
});

describe("onboarding funnel tracker", () => {
	it("a fresh organic player through the whole tutorial", () => {
		const t = new OnboardingFunnelTracker();
		expect(t.join(FRESH)).toEqual([]);
		expect(t.entryKnown("organic")).toEqual([onboardingJoinedEvent("organic")]);
		expect(steps(t.loaded())).toEqual([2]);
		expect(t.loaded()).toEqual([]);
		expect(steps(t.tutorialStarted("firstJoin"))).toEqual([3]);
		const logged: number[] = [];
		for (let n = 1; n <= TUTORIAL_STEP_COUNT; n++) for (const s of steps(t.lesson(n))) logged.push(s);
		expect(logged.size()).toBe(TUTORIAL_STEP_COUNT);
		expect(logged[0]).toBe(4);
		expect(steps(t.completed())).toEqual([TUTORIAL_STEP_COUNT + 4]);
		expect(t.isOpen()).toBe(false);
		expect(t.lesson(1)).toEqual([]);
		expect(t.completed()).toEqual([]);
		expect(t.leaving()).toEqual([]);
	});

	it("join and entry in either order; steps before Joined wait and log right after it", () => {
		const t = new OnboardingFunnelTracker();
		expect(t.entryKnown("organic")).toEqual([]);
		expect(t.loaded()).toEqual([]);
		const out = t.join(FRESH);
		expect(steps(out)).toEqual([1, 2]);
		const u = new OnboardingFunnelTracker();
		u.join(FRESH);
		u.loaded();
		u.tutorialStarted("firstJoin");
		u.lesson(1);
		expect(steps(u.entryKnown("organic"))).toEqual([1, 2, 3, 4]);
	});

	it("strictly increasing; a restart inside the first session never logs a lower step again", () => {
		const t = new OnboardingFunnelTracker();
		t.join(FRESH);
		t.entryKnown("organic");
		t.loaded();
		t.tutorialStarted("firstJoin");
		expect(steps(t.lesson(1))).toEqual([4]);
		expect(steps(t.lesson(3))).toEqual([6]);
		expect(t.lesson(2)).toEqual([]);
		// Restart tutorial: a `restart` entry never logs TutorialStarted; repeated lessons are dropped.
		expect(t.tutorialStarted("restart")).toEqual([]);
		expect(t.lesson(1)).toEqual([]);
		expect(t.lesson(3)).toEqual([]);
		expect(steps(t.lesson(4))).toEqual([7]);
		for (const bad of [0, -1, 1.5, 0 / 0, TUTORIAL_STEP_COUNT + 1]) expect(t.lesson(bad)).toEqual([]);
	});

	it("a leave before the entry logs Joined unknown (and what waited); a rejoin starts a new session tracker", () => {
		const t = new OnboardingFunnelTracker();
		t.join(FRESH);
		t.loaded();
		const out = t.leaving();
		expect(out[0]).toEqual(onboardingJoinedEvent("unknown"));
		expect(steps(out)).toEqual([1, 2]);
		expect(t.entryKnown("organic")).toEqual([]);
		expect(t.loaded()).toEqual([]);
		// Next session, still fresh (a leave never closes the doc): the same once-per-user funnel keeps filling.
		const rejoined = new OnboardingFunnelTracker();
		rejoined.join(FRESH);
		expect(steps(rejoined.entryKnown("organic"))).toEqual([1]);
		rejoined.tutorialStarted("firstJoin");
		expect(steps(rejoined.lesson(2))).toEqual([5]);
	});

	it("a leave without a load (or after Joined) logs nothing more", () => {
		const t = new OnboardingFunnelTracker();
		expect(t.leaving()).toEqual([]);
		const u = new OnboardingFunnelTracker();
		u.join(FRESH);
		u.entryKnown("organic");
		expect(u.leaving()).toEqual([]);
	});

	it("a skip closes with nothing; a completion closes after Completed", () => {
		const t = new OnboardingFunnelTracker();
		t.join(FRESH);
		t.entryKnown("organic");
		t.tutorialStarted("firstJoin");
		t.lesson(1);
		t.skipped();
		expect(t.isOpen()).toBe(false);
		expect(t.lesson(2)).toEqual([]);
		expect(t.completed()).toEqual([]);
		expect(t.tutorialStarted("firstJoin")).toEqual([]);
	});

	it("bypassed players (invited / party) log Joined only", () => {
		for (const entry of ["invited", "party"] as const) {
			const t = new OnboardingFunnelTracker();
			t.join(FRESH);
			t.loaded();
			expect(t.entryKnown(entry)).toEqual([onboardingJoinedEvent(entry)]);
			expect(t.loaded()).toEqual([]);
			expect(t.tutorialStarted("firstJoin")).toEqual([]);
			expect(t.lesson(1)).toEqual([]);
			expect(t.completed()).toEqual([]);
			expect(t.isOpen()).toBe(false);
		}
	});

	it("not fresh or not loaded: nothing at all (a menu replay never touches the funnel)", () => {
		for (const facts of [
			{ loaded: true, fresh: false },
			{ loaded: false, fresh: true },
			{ loaded: false, fresh: false },
		]) {
			const t = new OnboardingFunnelTracker();
			t.loaded();
			expect(t.join(facts)).toEqual([]);
			expect(t.entryKnown("organic")).toEqual([]);
			expect(t.loaded()).toEqual([]);
			expect(t.tutorialStarted("firstJoin")).toEqual([]);
			expect(t.tutorialStarted("menu")).toEqual([]);
			expect(t.lesson(1)).toEqual([]);
			expect(t.completed()).toEqual([]);
			expect(t.leaving()).toEqual([]);
		}
		// A fresh player's menu replay (not a first join) does not log TutorialStarted.
		const t = new OnboardingFunnelTracker();
		t.join(FRESH);
		t.entryKnown("organic");
		expect(t.tutorialStarted("menu")).toEqual([]);
		expect(t.tutorialStarted("again")).toEqual([]);
	});

	it("the gate logs once per session, for any player", () => {
		const t = new OnboardingFunnelTracker();
		expect(t.gate("loadFailed")).toEqual([
			{
				kind: "custom",
				name: TUTORIAL_ANALYTICS_EVENT.onboardingGate,
				value: 1,
				fields: { field01: "loadFailed" },
			},
		]);
		expect(t.gate("tutorial")).toEqual([]);
		const done = new OnboardingFunnelTracker();
		done.join({ loaded: true, fresh: false });
		expect(done.gate("done").size()).toBe(1);
	});
});

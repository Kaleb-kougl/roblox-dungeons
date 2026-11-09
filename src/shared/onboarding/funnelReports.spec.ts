// Tutorial telemetry (docs/TUTORIAL_FUNNEL.md TF3): the report readers on untrusted payloads, the attempt tracker's
// entry / device / current step / report dedupe / event budget / outro, and the attempt event builders.
import { describe, expect, it } from "@rbxts/jest-globals";
import { TUTORIAL_FOLLOW_PROMPT, TUTORIAL_STEPS } from "shared/tutorial";
import {
	DEFAULT_TUTORIAL_START_INFO,
	ONBOARDING_TUTORIAL_VERSION,
	TUTORIAL_ANALYTICS_EVENT,
	TUTORIAL_FUNNEL,
	TUTORIAL_FUNNEL_COMPLETED_STEP,
	TUTORIAL_FUNNEL_MAX_STEP,
	TUTORIAL_FUNNEL_REVISION,
	TUTORIAL_NO_STEP_ID,
	TUTORIAL_PROMPT_IDS,
	TUTORIAL_TELEMETRY,
	TutorialFunnelTracker,
	isTutorialPromptId,
	readFinishInfo,
	readLessonReport,
	readOnboardingReport,
	readStuckReport,
	readTutorialStartInfo,
	tutorialAbandonedEvents,
	tutorialAttemptStartEvents,
	tutorialFunnelRevision,
	tutorialLessonReportEvents,
	tutorialOutroEvents,
	tutorialRestartedEvents,
	tutorialStepEvent,
	tutorialStuckEvents,
	type TutorialStartInfo,
} from "shared/onboarding";

const INFO: TutorialStartInfo = { entry: "firstJoin", device: "touch" };
const GARBAGE: unknown[] = [undefined, 1, "x", true, [], { kind: 1 }];

describe("report readers", () => {
	it("start info: entry and device from their sets", () => {
		expect(readTutorialStartInfo({ entry: "again", device: "gamepad", extra: 1 })).toEqual({
			entry: "again",
			device: "gamepad",
		});
		for (const bad of [
			...GARBAGE,
			{ entry: "again" },
			{ entry: "Again", device: "gamepad" },
			{ entry: "menu", device: "mouse" },
		]) {
			expect(readTutorialStartInfo(bad)).toBe(undefined);
		}
		expect(DEFAULT_TUTORIAL_START_INFO).toEqual({ entry: "firstJoin", device: "keyboard" });
	});

	it("lesson report: integer step in range, integer hits >= 0, finite seconds; clamped and rounded", () => {
		expect(readLessonReport({ step: 3, seconds: 12.345, hits: 2 })).toEqual({ step: 3, seconds: 12.3, hits: 2 });
		expect(readLessonReport({ step: 1, seconds: 0.25, hits: 0 })?.seconds).toBe(0.3);
		expect(readLessonReport({ step: TUTORIAL_FUNNEL_MAX_STEP, seconds: 1e9, hits: 1e9 })).toEqual({
			step: TUTORIAL_FUNNEL_MAX_STEP,
			seconds: TUTORIAL_TELEMETRY.maxLessonSeconds,
			hits: TUTORIAL_TELEMETRY.maxLessonHits,
		});
		expect(readLessonReport({ step: 2, seconds: -4, hits: 0 })?.seconds).toBe(0);
		const bad: unknown[] = [
			...GARBAGE,
			{ step: 0, seconds: 1, hits: 0 },
			{ step: TUTORIAL_FUNNEL_MAX_STEP + 1, seconds: 1, hits: 0 },
			{ step: 1.5, seconds: 1, hits: 0 },
			{ step: "1", seconds: 1, hits: 0 },
			{ step: 1, seconds: 0 / 0, hits: 0 },
			{ step: 1, seconds: math.huge, hits: 0 },
			{ step: 1, seconds: 1, hits: -1 },
			{ step: 1, seconds: 1, hits: 0.5 },
			{ step: 1, seconds: 1, hits: 0 / 0 },
			{ step: 1, seconds: 1, hits: math.huge },
			{ step: 1, seconds: 1 },
		];
		for (const b of bad) expect(readLessonReport(b)).toBe(undefined);
	});

	it("stuck report: a known prompt id (step prompts, hold prompts, follow), clamped seconds", () => {
		expect(TUTORIAL_PROMPT_IDS.includes(TUTORIAL_FOLLOW_PROMPT)).toBe(true);
		expect(TUTORIAL_PROMPT_IDS.includes("guardHold")).toBe(true);
		for (const s of TUTORIAL_STEPS) expect(isTutorialPromptId(s.prompt)).toBe(true);
		const seen = new Set<string>();
		for (const p of TUTORIAL_PROMPT_IDS) {
			expect(seen.has(p)).toBe(false);
			seen.add(p);
		}
		expect(isTutorialPromptId("nope")).toBe(false);
		expect(readStuckReport({ prompt: "guardHold", seconds: 21.04 })).toEqual({ prompt: "guardHold", seconds: 21 });
		expect(readStuckReport({ prompt: "follow", seconds: 5000 })?.seconds).toBe(TUTORIAL_TELEMETRY.maxStuckSeconds);
		for (const b of [...GARBAGE, { prompt: "nope", seconds: 1 }, { prompt: "follow", seconds: 0 / 0 }]) {
			expect(readStuckReport(b)).toBe(undefined);
		}
	});

	it("finish info: outcome and a step id or the sentinel", () => {
		expect(readFinishInfo({ outcome: "skipped", stepId: "roll" })).toEqual({ outcome: "skipped", stepId: "roll" });
		expect(readFinishInfo({ outcome: "completed", stepId: TUTORIAL_NO_STEP_ID })).toEqual({
			outcome: "completed",
			stepId: TUTORIAL_NO_STEP_ID,
		});
		for (const s of TUTORIAL_STEPS) expect(s.id).never.toBe(TUTORIAL_NO_STEP_ID);
		for (const b of [
			...GARBAGE,
			{ outcome: "won", stepId: "roll" },
			{ outcome: "skipped", stepId: "Roll" },
			{ outcome: "skipped", stepId: "" },
		]) {
			expect(readFinishInfo(b)).toBe(undefined);
		}
	});

	it("onboarding report: loaded, gate with a known reason, outro with a known choice", () => {
		expect(readOnboardingReport({ kind: "loaded", junk: 1 })).toEqual({ kind: "loaded" });
		expect(readOnboardingReport({ kind: "gate", reason: "timeout" })).toEqual({ kind: "gate", reason: "timeout" });
		expect(readOnboardingReport({ kind: "outro", choice: "again", seconds: 4.26 })).toEqual({
			kind: "outro",
			choice: "again",
			seconds: 4.3,
		});
		expect(readOnboardingReport({ kind: "outro", choice: "menu", seconds: 1e7 })).toEqual({
			kind: "outro",
			choice: "menu",
			seconds: TUTORIAL_TELEMETRY.maxOutroSeconds,
		});
		const bad: unknown[] = [
			...GARBAGE,
			{ kind: "gate", reason: "bored" },
			{ kind: "outro", choice: "left", seconds: 1 },
			{ kind: "outro", choice: "again" },
			{ kind: "outro", choice: "again", seconds: 0 / 0 },
			{ kind: "other" },
		];
		for (const b of bad) expect(readOnboardingReport(b)).toBe(undefined);
	});
});

describe("attempt tracker: entry, device, current step, dedupe, budget, outro", () => {
	it("keeps the start info and the current step (noted id or the step after the last funnel step, whichever is later)", () => {
		const t = new TutorialFunnelTracker();
		expect(t.getStepId()).toBe(undefined);
		expect(t.noteStepId("roll")).toBe(false);
		t.start("a", INFO);
		expect(t.getInfo()).toEqual(INFO);
		expect(t.getStepId()).toBe(TUTORIAL_STEPS[0].id);
		t.accept(1);
		t.accept(2);
		expect(t.getStepId()).toBe(TUTORIAL_STEPS[2].id);
		expect(t.noteStepId("bogus")).toBe(false);
		expect(t.noteStepId(TUTORIAL_STEPS[6].id)).toBe(true);
		expect(t.getStepId()).toBe(TUTORIAL_STEPS[6].id);
		// A noted id never moves back.
		expect(t.noteStepId(TUTORIAL_STEPS[4].id)).toBe(true);
		expect(t.getStepId()).toBe(TUTORIAL_STEPS[6].id);
		for (let s = 3; s <= TUTORIAL_FUNNEL_MAX_STEP; s++) t.accept(s);
		expect(t.getStepId()).toBe(TUTORIAL_NO_STEP_ID);
		expect(t.finish()?.stepId).toBe(TUTORIAL_NO_STEP_ID);
	});

	it("lesson reports once per step, stuck reports once per prompt and at most the cap, nothing outside an attempt", () => {
		const t = new TutorialFunnelTracker();
		expect(t.acceptLessonReport({ step: 1, seconds: 1, hits: 0 })).toBe(false);
		t.start("a", INFO);
		expect(t.acceptLessonReport({ step: 1, seconds: 1, hits: 0 })).toBe(true);
		expect(t.acceptLessonReport({ step: 1, seconds: 2, hits: 3 })).toBe(false);
		expect(t.acceptLessonReport({ step: 0, seconds: 2, hits: 3 })).toBe(false);
		// Out of order is fine (lesson rooms finish in any order).
		expect(t.acceptLessonReport({ step: 5, seconds: 2, hits: 3 })).toBe(true);
		expect(t.acceptLessonReport({ step: 3, seconds: 2, hits: 3 })).toBe(true);
		expect(t.acceptStuckReport({ prompt: "nope", seconds: 20 })).toBe(false);
		let accepted = 0;
		for (const p of TUTORIAL_PROMPT_IDS) {
			if (t.acceptStuckReport({ prompt: p, seconds: 20 })) accepted++;
			expect(t.acceptStuckReport({ prompt: p, seconds: 30 })).toBe(false);
		}
		expect(accepted).toBe(TUTORIAL_TELEMETRY.maxStuckReportsPerAttempt);
		// A new attempt resets the dedupe.
		t.start("b", INFO);
		expect(t.acceptLessonReport({ step: 1, seconds: 1, hits: 0 })).toBe(true);
		expect(t.acceptStuckReport({ prompt: TUTORIAL_PROMPT_IDS[0], seconds: 20 })).toBe(true);
	});

	it("an honest full attempt (every step, report, stuck cap, exit and outro) stays within the event budget", () => {
		const t = new TutorialFunnelTracker();
		t.start("a", INFO);
		for (let s = 1; s <= TUTORIAL_FUNNEL_MAX_STEP; s++) {
			expect(t.accept(s)).toBe(true);
			expect(t.acceptLessonReport({ step: s, seconds: 10, hits: 1 })).toBe(true);
		}
		let stuck = 0;
		for (const p of TUTORIAL_PROMPT_IDS) if (t.acceptStuckReport({ prompt: p, seconds: 20 })) stuck++;
		expect(stuck).toBe(TUTORIAL_TELEMETRY.maxStuckReportsPerAttempt);
		expect(t.finish("completed", 100)).never.toBe(undefined);
		expect(t.takeOutro(112.34)).toEqual({ entry: "firstJoin", seconds: 12.3 });
		expect(t.getEventCount() <= TUTORIAL_TELEMETRY.maxEventsPerAttempt).toBe(true);
		expect(t.getEventCount()).toBe(
			1 + TUTORIAL_FUNNEL_MAX_STEP * 3 + TUTORIAL_TELEMETRY.maxStuckReportsPerAttempt + 2,
		);
	});

	it("the outro opens only after a completion, once, and closes on the next start", () => {
		const t = new TutorialFunnelTracker();
		t.start("a", INFO);
		t.finish("skipped", 5);
		expect(t.takeOutro(9)).toBe(undefined);
		t.start("b", { entry: "again", device: "keyboard" });
		t.finish("completed");
		expect(t.isActive()).toBe(false);
		expect(t.takeOutro(50)).toEqual({ entry: "again", seconds: 0 });
		expect(t.takeOutro(50)).toBe(undefined);
		t.start("c", INFO);
		t.finish("completed", 10);
		t.start("d", INFO);
		expect(t.takeOutro(20)).toBe(undefined);
		expect(t.abandon()?.attemptId).toBe("d");
		expect(t.takeOutro(20)).toBe(undefined);
		// The left-on-outro value is clamped (a fresh tracker: `t` is past the session's logged-attempt cap).
		const u = new TutorialFunnelTracker();
		u.start("e", INFO);
		u.finish("completed", 0);
		expect(u.takeOutro(1e9)?.seconds).toBe(TUTORIAL_TELEMETRY.maxOutroSeconds);
	});
});

describe("attempt tracker: session budget", () => {
	/** One honest-looking attempt: every step and lesson report, then a completion and its outro. */
	function fullAttempt(t: TutorialFunnelTracker, id: string): void {
		t.start(id, INFO);
		for (let s = 1; s <= TUTORIAL_FUNNEL_MAX_STEP; s++) {
			t.accept(s);
			t.acceptLessonReport({ step: s, seconds: 5, hits: 1 });
		}
		t.finish("completed", 0);
		t.takeOutro(1);
	}

	it("logs the first maxAttemptsLoggedPerSession attempts; later ones open and close unlogged", () => {
		const t = new TutorialFunnelTracker();
		for (let i = 1; i <= TUTORIAL_TELEMETRY.maxAttemptsLoggedPerSession; i++) {
			const replaced = t.start(`a${i}`, { entry: "restart", device: "keyboard" });
			if (i > 1) expect(replaced?.logged).toBe(true);
			expect(t.isLogged()).toBe(true);
			expect(t.accept(1)).toBe(true);
		}
		const logged = t.getSessionEventCount();
		const replaced = t.start("x", { entry: "restart", device: "keyboard" });
		expect(replaced?.logged).toBe(true); // the last logged attempt's exit still counts
		expect(t.getSessionEventCount()).toBe(logged + 1);
		// Past the cap: open (busy for lobbies), progress kept, nothing accepted for logging.
		expect(t.isActive()).toBe(true);
		expect(t.isLogged()).toBe(false);
		expect(t.acceptStep(1)).toBe("silent");
		expect(t.acceptStep(1)).toBe(undefined);
		expect(t.acceptStep(3)).toBe("silent");
		expect(t.accept(4)).toBe(false);
		expect(t.getLastStep()).toBe(4);
		expect(t.acceptLessonReport({ step: 2, seconds: 1, hits: 0 })).toBe(false);
		expect(t.acceptStuckReport({ prompt: TUTORIAL_PROMPT_IDS[0], seconds: 20 })).toBe(false);
		const ended = t.finish("completed", 10);
		expect(ended?.logged).toBe(false);
		expect(ended?.lastStep).toBe(4);
		expect(t.isActive()).toBe(false);
		expect(t.takeOutro(20)).toBe(undefined); // no outro after an unlogged attempt
		expect(t.getSessionEventCount()).toBe(logged + 1);
	});

	it("a silent start opens an unlogged attempt without using the attempt cap", () => {
		const t = new TutorialFunnelTracker();
		t.start("s", INFO, true);
		expect(t.isActive()).toBe(true);
		expect(t.isLogged()).toBe(false);
		expect(t.getSessionEventCount()).toBe(0);
		expect(t.abandon()?.logged).toBe(false);
		for (let i = 1; i <= TUTORIAL_TELEMETRY.maxAttemptsLoggedPerSession; i++) {
			t.start(`a${i}`, INFO);
			expect(t.isLogged()).toBe(true);
		}
	});

	it("an endless restart loop logs at most maxEventsPerSession attempt events", () => {
		const t = new TutorialFunnelTracker();
		for (let i = 0; i < 50; i++) fullAttempt(t, `a${i}`);
		expect(t.getSessionEventCount() <= TUTORIAL_TELEMETRY.maxEventsPerSession).toBe(true);
		expect(t.getSessionEventCount()).toBe(
			TUTORIAL_TELEMETRY.maxAttemptsLoggedPerSession * (1 + TUTORIAL_FUNNEL_MAX_STEP * 3 + 2),
		);
	});

	it("the session event cap keeps the exit reserve: a logged attempt's exit and outro always fit", () => {
		const limits = {
			maxEventsPerAttempt: 80,
			exitEventReserve: 2,
			maxAttemptsLoggedPerSession: 10,
			maxEventsPerSession: 12,
		};
		const t = new TutorialFunnelTracker(TUTORIAL_FUNNEL_MAX_STEP, limits);
		t.start("a", INFO);
		let accepted = 0;
		for (let s = 1; s <= TUTORIAL_FUNNEL_MAX_STEP; s++) if (t.accept(s)) accepted++;
		// 12 - 2 reserved = 10: the start and 9 steps.
		expect(accepted).toBe(9);
		expect(t.getSessionEventCount()).toBe(10);
		expect(t.finish("completed", 0)?.logged).toBe(true);
		expect(t.takeOutro(5)).toEqual({ entry: "firstJoin", seconds: 5 });
		expect(t.getSessionEventCount()).toBe(12);
		// No room for another logged start (1 + the reserve).
		t.start("b", INFO);
		expect(t.isLogged()).toBe(false);
		expect(t.abandon()?.logged).toBe(false);
		expect(t.getSessionEventCount()).toBe(12);
	});
});

describe("attempt event builders", () => {
	const ended = {
		attemptId: "a",
		lastStep: 7,
		entry: "restart" as const,
		device: "gamepad" as const,
		stepId: "guard",
		logged: true,
	};

	it("start: funnel step 1 with entry / revision / device", () => {
		expect(tutorialFunnelRevision()).toBe(`t${ONBOARDING_TUTORIAL_VERSION}r${TUTORIAL_FUNNEL_REVISION}`);
		expect(tutorialFunnelRevision()).toBe("t1r4");
		expect(tutorialAttemptStartEvents(INFO)).toEqual([
			{
				kind: "funnel",
				funnel: TUTORIAL_FUNNEL,
				step: 1,
				stepName: "started",
				fields: { field01: "firstJoin", field02: "t1r4", field03: "touch" },
			},
		]);
		expect(tutorialStepEvent(TUTORIAL_FUNNEL_MAX_STEP)).toEqual({
			kind: "funnel",
			funnel: TUTORIAL_FUNNEL,
			step: TUTORIAL_FUNNEL_COMPLETED_STEP - 1,
			stepName: TUTORIAL_STEPS[TUTORIAL_FUNNEL_MAX_STEP - 1].id,
		});
	});

	it("lesson report: time always, hits only when > 0", () => {
		const fields = { field01: TUTORIAL_STEPS[1].id, field02: "firstJoin", field03: "touch" };
		expect(tutorialLessonReportEvents({ step: 2, seconds: 8.5, hits: 0 }, INFO)).toEqual([
			{ kind: "custom", name: TUTORIAL_ANALYTICS_EVENT.lessonTime, value: 8.5, fields },
		]);
		expect(tutorialLessonReportEvents({ step: 2, seconds: 8.5, hits: 3 }, INFO)).toEqual([
			{ kind: "custom", name: TUTORIAL_ANALYTICS_EVENT.lessonTime, value: 8.5, fields },
			{ kind: "custom", name: TUTORIAL_ANALYTICS_EVENT.lessonHits, value: 3, fields },
		]);
	});

	it("stuck, abandoned, restarted, outro", () => {
		expect(tutorialStuckEvents({ prompt: "guardHold", seconds: 25 }, INFO)).toEqual([
			{
				kind: "custom",
				name: "TutorialStuck",
				value: 25,
				fields: { field01: "guardHold", field02: "firstJoin", field03: "touch" },
			},
		]);
		expect(tutorialAbandonedEvents(ended, "partyRun")).toEqual([
			{
				kind: "custom",
				name: "TutorialAbandoned",
				value: 7,
				fields: { field01: "guard", field02: "restart", field03: "partyRun" },
			},
		]);
		expect(tutorialRestartedEvents(ended)).toEqual([
			{ kind: "custom", name: "TutorialRestarted", value: 7, fields: { field01: "guard" } },
		]);
		expect(tutorialOutroEvents("left", 12, "firstJoin")).toEqual([
			{
				kind: "custom",
				name: "TutorialOutroChoice",
				value: 12,
				fields: { field01: "left", field02: "firstJoin" },
			},
		]);
	});
});

// Per-player tutorial / onboarding telemetry (docs/TUTORIAL_FUNNEL.md TF5, TF7, TF8): which tracker gets which
// message, the join entry from the server's join intent (with its deadline and the leave fallback), what a leave and a
// party run log, restarts, the server-measured outro, gate contradictions, the new-player window's run rule and join
// helper, and the debug echo's lines.
import { describe, expect, it } from "@rbxts/jest-globals";
import type { AnalyticsEventSpec } from "shared/run";
import { TUTORIAL_PROMPT_IDS, TUTORIAL_STEPS, TUTORIAL_STEP_COUNT } from "shared/tutorial";
import {
	ANALYTICS_DEBUG_ATTRIBUTE,
	NEW_PLAYER,
	ONBOARDING_ENTRY_WAIT_SECONDS,
	ONBOARDING_FUNNEL,
	PlayerTutorialTelemetry,
	TUTORIAL_ANALYTICS_EVENT,
	TUTORIAL_FUNNEL,
	TUTORIAL_FUNNEL_COMPLETED_STEP,
	describeAnalyticsSpec,
	emptyOnboardingDoc,
	finishedOnboardingDoc,
	gateContradiction,
	newPlayerJoin,
	newPlayerRunCounts,
	onboardingEntryOfIntent,
	type TelemetryBatch,
} from "shared/onboarding";

const T0 = 100;
const DEADLINE = T0 + ONBOARDING_ENTRY_WAIT_SECONDS;
const FRESH = { loaded: true, fresh: true, done: false };
const VETERAN = { loaded: true, fresh: false, done: true };
const FAILED = { loaded: false, fresh: false, done: false };
const START = { entry: "firstJoin", device: "keyboard" };

/** Every spec of `batches`, flattened. */
function specs(batches: ReadonlyArray<TelemetryBatch>): AnalyticsEventSpec[] {
	const out: AnalyticsEventSpec[] = [];
	for (const b of batches) for (const s of b.specs) out.push(s);
	return out;
}

/** One short label per spec: `o<step>` onboarding, `a<step>` attempt funnel, else the custom event name. */
function labels(batches: ReadonlyArray<TelemetryBatch>): string[] {
	return specs(batches).map((s) => {
		if (s.kind === "onboarding") return `o${s.step}`;
		if (s.kind === "funnel") return `a${s.step}`;
		if (s.kind === "custom") return s.name;
		return s.kind;
	});
}

/** A fresh player whose entry already settled organic and whose doc loaded. */
function freshOrganic(): PlayerTutorialTelemetry {
	const t = new PlayerTutorialTelemetry(T0);
	t.join(FRESH);
	t.joinIntent("none", T0 + 1);
	t.poll(DEADLINE);
	return t;
}

describe("join entry", () => {
	it("maps intents to entries", () => {
		expect(onboardingEntryOfIntent("none")).toBe("organic");
		expect(onboardingEntryOfIntent("lobby")).toBe("invited");
		expect(onboardingEntryOfIntent("party")).toBe("party");
		expect(ONBOARDING_ENTRY_WAIT_SECONDS).toBe(15);
	});

	it("none waits for the deadline; steps before Joined queue in order", () => {
		const t = new PlayerTutorialTelemetry(T0);
		expect(t.entryDeadline()).toBe(DEADLINE);
		expect(labels(t.join(FRESH))).toEqual([]);
		expect(labels(t.joinIntent("none", T0 + 1))).toEqual([]);
		expect(labels(t.report({ kind: "loaded" }, T0 + 2).batches)).toEqual([]);
		// The attempt funnel never waits; onboarding step 3 does.
		expect(labels(t.start("A", START).batches)).toEqual(["a1"]);
		expect(labels(t.poll(DEADLINE - 1))).toEqual([]);
		const joined = specs(t.poll(DEADLINE));
		expect(joined.map((s) => (s.kind === "onboarding" ? s.step : -1))).toEqual([1, 2, 3]);
		expect(joined[0].fields?.field01).toBe("organic");
		expect(labels(t.poll(DEADLINE + 5))).toEqual([]);
	});

	it("lobby / party settle at once and bypass the rest (TFD3); never downgraded", () => {
		const t = new PlayerTutorialTelemetry(T0);
		t.join(FRESH);
		const joined = specs(t.joinIntent("lobby", T0 + 1));
		expect(joined.size()).toBe(1);
		expect(joined[0].fields?.field01).toBe("invited");
		expect(labels(t.joinIntent("none", T0 + 2))).toEqual([]);
		expect(t.getIntent()).toBe("lobby");
		expect(labels(t.report({ kind: "loaded" }, T0 + 3).batches)).toEqual([]);
		expect(labels(t.start("A", START).batches)).toEqual(["a1"]);
		expect(labels(t.step(1))).toEqual(["a2"]);

		const p = new PlayerTutorialTelemetry(T0);
		p.joinIntent("none", T0 + 1);
		expect(specs(p.joinIntent("party", T0 + 4))).toEqual([]); // the doc load has not ended yet
		expect(specs(p.join(FRESH))[0].fields?.field01).toBe("party");
	});

	it("an upgrade before the deadline wins over none", () => {
		const t = new PlayerTutorialTelemetry(T0);
		t.join(FRESH);
		t.joinIntent("none", T0 + 1);
		expect(specs(t.joinIntent("party", T0 + 12))[0].fields?.field01).toBe("party");
		expect(labels(t.poll(DEADLINE))).toEqual([]);
	});

	it("no intent by the deadline: unknown; a later intent changes nothing", () => {
		const t = new PlayerTutorialTelemetry(T0);
		t.join(FRESH);
		expect(specs(t.poll(DEADLINE))[0].fields?.field01).toBe("unknown");
		expect(labels(t.joinIntent("lobby", DEADLINE + 1))).toEqual([]);
	});

	it("a leave before the deadline logs the latest intent's entry, or unknown without one", () => {
		const a = new PlayerTutorialTelemetry(T0);
		a.join(FRESH);
		a.joinIntent("none", T0 + 1);
		expect(specs(a.leaving(T0 + 3))[0].fields?.field01).toBe("organic");
		const b = new PlayerTutorialTelemetry(T0);
		b.join(FRESH);
		expect(specs(b.leaving(T0 + 3))[0].fields?.field01).toBe("unknown");
		// Nothing after the leave.
		expect(labels(b.poll(DEADLINE))).toEqual([]);
		expect(labels(b.joinIntent("lobby", T0 + 4))).toEqual([]);
		expect(labels(b.leaving(T0 + 5))).toEqual([]);
	});

	it("a failed load or a done doc logs no onboarding funnel; a failed load never reopens", () => {
		for (const facts of [FAILED, VETERAN]) {
			const t = new PlayerTutorialTelemetry(T0);
			t.join(facts);
			t.joinIntent("none", T0);
			expect(labels(t.poll(DEADLINE))).toEqual([]);
			expect(labels(t.start("A", START).batches)).toEqual(["a1"]);
			expect(labels(t.join(FRESH))).toEqual([]);
			expect(labels(t.leaving(T0 + 30))).toEqual([TUTORIAL_ANALYTICS_EVENT.abandoned]);
		}
		// fresh without loaded is not fresh.
		const t = new PlayerTutorialTelemetry(T0);
		t.join({ loaded: false, fresh: true, done: false });
		expect(labels(t.poll(DEADLINE))).toEqual([]);
	});
});

describe("attempt and onboarding together", () => {
	it("a fresh player's first attempt: every step in both funnels, completed, outro", () => {
		const t = freshOrganic();
		expect(labels(t.report({ kind: "loaded" }, 120).batches)).toEqual(["o2"]);
		const start = t.start("A", START);
		expect(start.defaulted).toBe(false);
		expect(start.batches[0].attemptId).toBe("A");
		expect(labels(start.batches)).toEqual(["a1", "o3"]);
		expect(t.isInTutorial()).toBe(true);
		for (const s of TUTORIAL_STEPS) {
			const b = t.step(s.number);
			expect(labels(b)).toEqual([`a${s.number + 1}`, `o${s.number + 3}`]);
			expect(b[0].attemptId).toBe("A");
			expect(b[1].attemptId).toBe(undefined);
		}
		expect(labels(t.step(3))).toEqual([]);
		const fin = t.finish({ outcome: "completed", stepId: "none" }, 200)!;
		expect(fin.outcome).toBe("completed");
		expect(labels(fin.batches)).toEqual([
			`a${TUTORIAL_FUNNEL_COMPLETED_STEP}`,
			`o${ONBOARDING_FUNNEL.completed.step}`,
		]);
		expect(TUTORIAL_FUNNEL_COMPLETED_STEP).toBe(TUTORIAL_STEP_COUNT + 2);
		expect(t.isInTutorial()).toBe(false);
		// The outro's value is the server's seconds since the completion, not the client's.
		const outro = specs(t.report({ kind: "outro", choice: "firstRun", seconds: 999 }, 212.34).batches);
		expect(outro).toEqual([
			{
				kind: "custom",
				name: TUTORIAL_ANALYTICS_EVENT.outroChoice,
				value: 12.3,
				fields: { field01: "firstRun", field02: "firstJoin" },
			},
		]);
		expect(labels(t.report({ kind: "outro", choice: "menu", seconds: 1 }, 213).batches)).toEqual([]);
		expect(labels(t.leaving(300))).toEqual([]);
	});

	it("a skip logs TutorialSkipped with the client's step id and closes the onboarding funnel", () => {
		const t = freshOrganic();
		t.start("A", START);
		t.step(1);
		t.step(2);
		const fin = t.finish({ outcome: "skipped", stepId: TUTORIAL_STEPS[4].id }, 150)!;
		expect(specs(fin.batches)).toEqual([
			{
				kind: "custom",
				name: TUTORIAL_ANALYTICS_EVENT.skipped,
				value: 2,
				fields: { field01: TUTORIAL_STEPS[4].id, field02: "firstJoin", field03: "keyboard" },
			},
		]);
		// A later attempt (menu) never touches the onboarding funnel; no outro after a skip.
		expect(labels(t.start("B", { entry: "menu", device: "touch" }).batches)).toEqual(["a1"]);
		expect(labels(t.step(1))).toEqual(["a2"]);
		expect(labels(t.report({ kind: "outro", choice: "menu", seconds: 1 }, 160).batches)).toEqual([]);
	});

	it("a restart logs TutorialRestarted for the replaced attempt; lessons repeat in the new one only", () => {
		const t = freshOrganic();
		t.start("A", START);
		t.step(1);
		t.step(2);
		const r = t.start("B", { entry: "restart", device: "gamepad" });
		expect(r.replacedUnlogged).toBe(undefined);
		expect(r.batches[0].attemptId).toBe("A");
		expect(specs(r.batches)[0]).toEqual({
			kind: "custom",
			name: TUTORIAL_ANALYTICS_EVENT.restarted,
			value: 2,
			fields: { field01: TUTORIAL_STEPS[2].id },
		});
		expect(labels(r.batches)).toEqual([TUTORIAL_ANALYTICS_EVENT.restarted, "a1"]);
		expect(r.batches[1].attemptId).toBe("B");
		// The attempt funnel counts again from 1; the once-per-user funnel only past its last step.
		expect(labels(t.step(1))).toEqual(["a2"]);
		expect(labels(t.step(2))).toEqual(["a3"]);
		expect(labels(t.step(3))).toEqual(["a4", "o6"]);
	});

	it("a non-restart start replacing an open attempt logs nothing for it (reported to the service)", () => {
		const t = freshOrganic();
		t.start("A", START);
		t.step(1);
		const r = t.start("B", { entry: "menu", device: "keyboard" });
		expect(r.replacedUnlogged?.attemptId).toBe("A");
		expect(r.replacedUnlogged?.lastStep).toBe(1);
		expect(labels(r.batches)).toEqual(["a1"]);
	});

	it("a malformed start defaults to a keyboard first join", () => {
		const t = new PlayerTutorialTelemetry(T0);
		const r = t.start("A", { entry: "nope", device: "keyboard" });
		expect(r.defaulted).toBe(true);
		expect(r.info).toEqual({ entry: "firstJoin", device: "keyboard" });
		expect(t.start("B", undefined).defaulted).toBe(true);
	});

	it("steps and reports outside an attempt are dropped", () => {
		const t = freshOrganic();
		expect(labels(t.step(1))).toEqual([]);
		expect(labels(t.lesson({ step: 1, seconds: 3, hits: 0 }))).toEqual([]);
		expect(labels(t.stuck({ prompt: TUTORIAL_PROMPT_IDS[0], seconds: 30 }))).toEqual([]);
		expect(labels(t.step("1"))).toEqual([]);
	});

	it("lesson and stuck reports: read, bounded, once per lesson / prompt per attempt", () => {
		const t = freshOrganic();
		t.start("A", { entry: "firstJoin", device: "touch" });
		const lesson = t.lesson({ step: 2, seconds: 12.34, hits: 3 });
		expect(lesson[0].attemptId).toBe("A");
		expect(specs(lesson)).toEqual([
			{
				kind: "custom",
				name: TUTORIAL_ANALYTICS_EVENT.lessonTime,
				value: 12.3,
				fields: { field01: TUTORIAL_STEPS[1].id, field02: "firstJoin", field03: "touch" },
			},
			{
				kind: "custom",
				name: TUTORIAL_ANALYTICS_EVENT.lessonHits,
				value: 3,
				fields: { field01: TUTORIAL_STEPS[1].id, field02: "firstJoin", field03: "touch" },
			},
		]);
		expect(labels(t.lesson({ step: 2, seconds: 1, hits: 0 }))).toEqual([]);
		expect(labels(t.lesson({ step: 3, seconds: 1, hits: 0 }))).toEqual([TUTORIAL_ANALYTICS_EVENT.lessonTime]);
		expect(labels(t.lesson({ step: 0, seconds: 1, hits: 0 }))).toEqual([]);
		expect(labels(t.lesson("junk"))).toEqual([]);
		const prompt = TUTORIAL_PROMPT_IDS[0];
		expect(labels(t.stuck({ prompt, seconds: 25 }))).toEqual([TUTORIAL_ANALYTICS_EVENT.stuck]);
		expect(labels(t.stuck({ prompt, seconds: 40 }))).toEqual([]);
		expect(labels(t.stuck({ prompt: "invented", seconds: 40 }))).toEqual([]);
	});

	it("finish payloads: a bare outcome is accepted (rollout), junk is dropped and changes nothing", () => {
		const t = freshOrganic();
		t.start("A", START);
		expect(t.finish({ outcome: "won", stepId: "none" }, 120)).toBe(undefined);
		expect(t.finish({ outcome: "skipped", stepId: "invented" }, 120)).toBe(undefined);
		expect(t.isInTutorial()).toBe(true);
		const fin = t.finish("skipped", 121)!;
		expect(fin.ended?.attemptId).toBe("A");
		expect(labels(fin.batches)).toEqual([TUTORIAL_ANALYTICS_EVENT.skipped]);
		// A finish with no open attempt still closes the onboarding funnel (Completed while it is open).
		const u = freshOrganic();
		expect(labels(u.finish({ outcome: "completed", stepId: "none" }, 130)!.batches)).toEqual([
			`o${ONBOARDING_FUNNEL.completed.step}`,
		]);
	});

	it("a rate-limited finish drops the attempt unlogged", () => {
		const t = freshOrganic();
		t.start("A", START);
		t.dropAttempt();
		expect(t.isInTutorial()).toBe(false);
		expect(labels(t.leaving(200))).toEqual([]);
	});
});

describe("exits", () => {
	it("leaving mid-attempt: TutorialAbandoned leave with the current step", () => {
		const t = freshOrganic();
		t.start("A", { entry: "firstJoin", device: "gamepad" });
		t.step(1);
		const out = t.leaving(300);
		expect(out[0].attemptId).toBe("A");
		expect(specs(out)).toEqual([
			{
				kind: "custom",
				name: TUTORIAL_ANALYTICS_EVENT.abandoned,
				value: 1,
				fields: { field01: TUTORIAL_STEPS[1].id, field02: "firstJoin", field03: "leave" },
			},
		]);
	});

	it("leaving on the outro: TutorialOutroChoice left, server seconds", () => {
		const t = freshOrganic();
		t.start("A", { entry: "again", device: "keyboard" });
		t.finish({ outcome: "completed", stepId: "none" }, 200);
		expect(specs(t.leaving(245))).toEqual([
			{
				kind: "custom",
				name: TUTORIAL_ANALYTICS_EVENT.outroChoice,
				value: 45,
				fields: { field01: "left", field02: "again" },
			},
		]);
	});

	it("a party run takes the attempt: TutorialAbandoned partyRun; nothing without one", () => {
		const t = freshOrganic();
		expect(labels(t.partyRun())).toEqual([]);
		t.start("A", START);
		const out = specs(t.partyRun());
		expect(out.size()).toBe(1);
		expect(out[0].fields?.field03).toBe("partyRun");
		expect(t.isInTutorial()).toBe(false);
		expect(labels(t.leaving(400))).toEqual([]);
	});

	it("the joined-on-leave flush comes before the abandon", () => {
		const t = new PlayerTutorialTelemetry(T0);
		t.join(FRESH);
		t.start("A", START);
		expect(labels(t.leaving(T0 + 5))).toEqual(["o1", "o3", TUTORIAL_ANALYTICS_EVENT.abandoned]);
	});
});

describe("gate", () => {
	it("once per session, any player; contradictions are reported, not dropped", () => {
		const t = new PlayerTutorialTelemetry(T0);
		t.join(FRESH);
		t.joinIntent("none", T0);
		const r = t.report({ kind: "gate", reason: "done" }, T0 + 1);
		expect(r.kind).toBe("gate");
		expect(r.contradiction).toBe("server doc not done");
		expect(specs(r.batches)).toEqual([
			{ kind: "custom", name: TUTORIAL_ANALYTICS_EVENT.onboardingGate, value: 1, fields: { field01: "done" } },
		]);
		expect(labels(t.report({ kind: "gate", reason: "tutorial" }, T0 + 2).batches)).toEqual([]);
		expect(t.report({ kind: "gate", reason: "bogus" }, T0 + 2).kind).toBe(undefined);
		const f = new PlayerTutorialTelemetry(T0);
		f.join(FAILED);
		expect(labels(f.report({ kind: "gate", reason: "loadFailed" }, T0).batches)).toEqual([
			TUTORIAL_ANALYTICS_EVENT.onboardingGate,
		]);
	});

	it("gateContradiction", () => {
		expect(gateContradiction("tutorial", { join: FRESH, intent: "none" })).toBe(undefined);
		expect(gateContradiction("tutorial", { join: FAILED })).toBe("server load failed");
		expect(gateContradiction("tutorial", { join: VETERAN })).toBe("server doc done");
		expect(gateContradiction("done", { join: VETERAN })).toBe(undefined);
		expect(gateContradiction("done", { join: FAILED })).toBe(undefined);
		expect(gateContradiction("loadFailed", { join: FAILED })).toBe(undefined);
		expect(gateContradiction("loadFailed", { join: FRESH })).toBe("server load succeeded");
		expect(gateContradiction("invited", { intent: "lobby" })).toBe(undefined);
		expect(gateContradiction("invited", { intent: "none" })).toBe("server intent none");
		expect(gateContradiction("party", {})).toBe("server intent unknown");
		expect(gateContradiction("party", { intent: "party" })).toBe(undefined);
		expect(gateContradiction("timeout", { join: VETERAN, intent: "lobby" })).toBe(undefined);
		expect(gateContradiction("forced", { join: VETERAN })).toBe(undefined);
		expect(gateContradiction("done", {})).toBe(undefined);
	});

	it("a bad report kind is dropped", () => {
		const t = new PlayerTutorialTelemetry(T0);
		expect(t.report({ kind: "nope" }, T0).kind).toBe(undefined);
		expect(t.report(undefined, T0).batches).toEqual([]);
		expect(t.report({ kind: "outro", choice: "firstRun", seconds: 1 }, T0)).toEqual({ kind: "outro", batches: [] });
	});
});

describe("new-player window helpers", () => {
	it("ranked (endless) and daily runs count; debug, Studio and other worlds never", () => {
		expect(newPlayerRunCounts({ worldKind: "endless", debug: false, studio: false })).toBe(true);
		expect(newPlayerRunCounts({ worldKind: "daily", debug: false, studio: false })).toBe(true);
		expect(newPlayerRunCounts({ worldKind: "endless", debug: true, studio: false })).toBe(false);
		expect(newPlayerRunCounts({ worldKind: "endless", debug: false, studio: true })).toBe(false);
		for (const w of ["game", "tutorial", "dev", "greybox"]) {
			expect(newPlayerRunCounts({ worldKind: w, debug: false, studio: false })).toBe(false);
		}
	});

	it("newPlayerJoin: firstDay on a fresh join, a return on a later day, nothing otherwise", () => {
		const DAY = 20_400;
		const fresh = emptyOnboardingDoc();
		expect(newPlayerJoin(fresh, DAY)).toEqual({ events: [], doc: { ...fresh, firstDay: DAY } });
		const day1 = { ...fresh, firstDay: DAY };
		expect(newPlayerJoin(day1, DAY)).toBe(undefined);
		const back = newPlayerJoin(day1, DAY + 2)!;
		expect(back.doc.returned).toBe(true);
		expect(back.events).toEqual([
			{
				kind: "custom",
				name: TUTORIAL_ANALYTICS_EVENT.newPlayerReturned,
				value: 2,
				fields: { field01: "none" },
			},
		]);
		expect(newPlayerJoin(back.doc, DAY + 3)).toBe(undefined);
		expect(newPlayerJoin(day1, DAY + NEW_PLAYER.returnDays + 1)).toBe(undefined);
		expect(newPlayerJoin(finishedOnboardingDoc("completed", 1), DAY)).toBe(undefined);
	});

	it("finishing keeps the new-player fields (the service passes the current doc)", () => {
		const doc = { ...emptyOnboardingDoc(), firstDay: 5, newRuns: 2, returned: true };
		const done = finishedOnboardingDoc("completed", 77, [], doc);
		expect([done.firstDay, done.newRuns, done.returned]).toEqual([5, 2, true]);
	});
});

describe("analytics debug echo", () => {
	it("one line per spec kind", () => {
		expect(ANALYTICS_DEBUG_ATTRIBUTE).toBe("KV_AnalyticsDebug");
		expect(
			describeAnalyticsSpec({ kind: "custom", name: "X", value: 2.5, fields: { field01: "a", field03: "c" } }),
		).toBe("custom X = 2.5 [f1=a f3=c]");
		expect(describeAnalyticsSpec({ kind: "funnel", funnel: TUTORIAL_FUNNEL, step: 3, stepName: "move" }, "S")).toBe(
			"funnel TutorialAttempt #3 move (session S)",
		);
		expect(describeAnalyticsSpec({ kind: "onboarding", step: 1, stepName: "Joined", fields: {} })).toBe(
			"onboarding #1 Joined",
		);
		expect(
			describeAnalyticsSpec({
				kind: "progression",
				status: "Start",
				path: "ActI",
				level: 1,
				levelName: "MotherBramble",
			}),
		).toBe("progression Start ActI #1 MotherBramble");
	});
});

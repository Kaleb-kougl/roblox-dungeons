// The new-player window (docs/TUTORIAL_FUNNEL.md §7, TF7's pure part): firstDay on a fresh join, run numbers counted
// at acceptance, the window closing after NEW_PLAYER.runs runs, one return event within NEW_PLAYER.returnDays.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	NEW_PLAYER,
	TUTORIAL_ANALYTICS_EVENT,
	emptyOnboardingDoc,
	finishedOnboardingDoc,
	firstDayPatch,
	isInNewPlayerWindow,
	newPlayerReturn,
	newPlayerRunAccepted,
	newPlayerRunStart,
	newPlayerTutorialOutcome,
	type OnboardingDoc,
} from "shared/onboarding";

const DAY = 20_400;
const AT = 1_762_000_000;

describe("new-player window", () => {
	it("firstDay is set on a fresh join only", () => {
		const fresh = emptyOnboardingDoc();
		expect(firstDayPatch(fresh, DAY)).toEqual({ ...fresh, firstDay: DAY });
		expect(firstDayPatch({ ...fresh, firstDay: DAY - 1 }, DAY)).toBe(undefined);
		expect(firstDayPatch(finishedOnboardingDoc("skipped", AT), DAY)).toBe(undefined);
		for (const bad of [-1, 1.5, 0 / 0, math.huge]) expect(firstDayPatch(fresh, bad)).toBe(undefined);
	});

	it("the tutorial outcome field", () => {
		expect(newPlayerTutorialOutcome(emptyOnboardingDoc())).toBe("none");
		expect(newPlayerTutorialOutcome(finishedOnboardingDoc("completed", AT))).toBe("completed");
		expect(newPlayerTutorialOutcome(finishedOnboardingDoc("skipped", AT))).toBe("skipped");
	});

	it("no firstDay: never in the window", () => {
		const veteran = finishedOnboardingDoc("completed", AT);
		expect(isInNewPlayerWindow(veteran)).toBe(false);
		expect(newPlayerRunStart(veteran)).toEqual([]);
		expect(newPlayerRunAccepted(veteran, { endReason: "death", floor: 3 })).toBe(undefined);
		expect(newPlayerReturn(veteran, DAY + 1)).toBe(undefined);
	});

	it("runs 1..3 are counted at acceptance; a start repeats the number until a run validates; a fourth logs nothing", () => {
		let doc: OnboardingDoc = { ...finishedOnboardingDoc("completed", AT), firstDay: DAY };
		const started: number[] = [];
		const accepted: number[] = [];
		for (let i = 0; i < NEW_PLAYER.runs + 1; i++) {
			// A start whose run never validates: the same number again on the next start.
			for (const e of newPlayerRunStart(doc)) if (e.kind === "custom") started.push(e.value);
			for (const e of newPlayerRunStart(doc)) if (e.kind === "custom") started.push(e.value);
			const update = newPlayerRunAccepted(doc, { endReason: "death", floor: 6 });
			if (update === undefined) continue;
			for (const e of update.events) if (e.kind === "custom") accepted.push(e.value);
			doc = update.doc;
		}
		expect(started).toEqual([1, 1, 2, 2, 3, 3]);
		expect(accepted).toEqual([1, 2, 3]);
		expect(doc.newRuns).toBe(NEW_PLAYER.runs);
		expect(isInNewPlayerWindow(doc)).toBe(false);
		expect(doc.firstDay).toBe(DAY);
		expect(doc.tutorialVersion).toBe(1);
	});

	it("event fields", () => {
		const doc: OnboardingDoc = { ...finishedOnboardingDoc("skipped", AT), firstDay: DAY, newRuns: 1 };
		expect(newPlayerRunStart(doc)).toEqual([
			{
				kind: "custom",
				name: TUTORIAL_ANALYTICS_EVENT.newPlayerRunStarted,
				value: 2,
				fields: { field01: "skipped" },
			},
		]);
		expect(newPlayerRunAccepted(doc, { endReason: "victory", floor: 12 })?.events).toEqual([
			{
				kind: "custom",
				name: TUTORIAL_ANALYTICS_EVENT.newPlayerRun,
				value: 2,
				fields: { field01: "skipped", field02: "victory", field03: "10-14" },
			},
		]);
		expect(newPlayerRunAccepted(doc, { endReason: "abandoned", floor: 1 })?.events[0]).toEqual({
			kind: "custom",
			name: TUTORIAL_ANALYTICS_EVENT.newPlayerRun,
			value: 2,
			fields: { field01: "skipped", field02: "abandoned", field03: "1" },
		});
	});

	it("returned: once, on a later day within returnDays", () => {
		const doc: OnboardingDoc = { ...emptyOnboardingDoc(), firstDay: DAY };
		expect(newPlayerReturn(doc, DAY)).toBe(undefined);
		expect(newPlayerReturn(doc, DAY - 1)).toBe(undefined);
		expect(newPlayerReturn(doc, DAY + NEW_PLAYER.returnDays + 1)).toBe(undefined);
		expect(newPlayerReturn(doc, 1.5)).toBe(undefined);
		const update = newPlayerReturn(doc, DAY + 2);
		expect(update?.events).toEqual([
			{ kind: "custom", name: TUTORIAL_ANALYTICS_EVENT.newPlayerReturned, value: 2, fields: { field01: "none" } },
		]);
		expect(update?.doc).toEqual({ ...doc, returned: true });
		expect(newPlayerReturn(update!.doc, DAY + 3)).toBe(undefined);
		expect(newPlayerReturn(doc, DAY + NEW_PLAYER.returnDays)?.events[0]).toEqual({
			kind: "custom",
			name: TUTORIAL_ANALYTICS_EVENT.newPlayerReturned,
			value: NEW_PLAYER.returnDays,
			fields: { field01: "none" },
		});
	});
});

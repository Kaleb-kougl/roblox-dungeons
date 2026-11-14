// The analytics catalog (docs/TUTORIAL_FUNNEL.md TF1): every name the game logs within Roblox's limits, bounded field
// value sets, the combination total under 8,000 (counting rule in analyticsCatalog.ts), the tutorial attempt's event
// bound under maxEventsPerAttempt, and the tutorial builders' output inside the catalog's sets.
import { describe, expect, it } from "@rbxts/jest-globals";
import { CHARACTER_IDS, type CharacterId } from "shared/characters";
import { LOBBY_ANALYTICS_EVENT } from "shared/lobby";
import {
	ANALYTICS_EVENT,
	RUN_RECAP_CLOSES,
	RUN_RECAP_NEAR_MISS_KINDS,
	RUN_RECAP_NO_NEAR_MISS,
	RUN_RECAP_TABS,
	RunTelemetry,
	analyticsForRun,
	analyticsForRunRecap,
	type AnalyticsEventSpec,
	type RunRecapNearMiss,
} from "shared/run";
import { TUTORIAL_DEVICES, TUTORIAL_STEPS } from "shared/tutorial";
import { ARMORY_CATALOG, WALLET_ANALYTICS_EVENT, armoryPurchaseEvent, itemPrice } from "shared/wallet";
import {
	ANALYTICS_CATALOG,
	MAX_TUTORIAL_STEP_NAME_CHARS,
	NEW_PLAYER_RUN_ENDS,
	ONBOARDING_CATALOG_NAME,
	ONBOARDING_GATE_REASONS,
	OnboardingFunnelTracker,
	TUTORIAL_ABANDON_KINDS,
	TUTORIAL_ANALYTICS_EVENT,
	TUTORIAL_CURRENT_STEP_IDS,
	TUTORIAL_ENTRIES,
	TUTORIAL_FUNNEL,
	TUTORIAL_FUNNEL_MAX_STEP,
	TUTORIAL_OUTRO_CHOICES,
	TUTORIAL_PROMPT_IDS,
	TUTORIAL_TELEMETRY,
	analyticsCatalogCombinations,
	analyticsCatalogEntries,
	analyticsCatalogEntry,
	analyticsEntryCombinations,
	finishedOnboardingDoc,
	firstAttemptEventBound,
	newPlayerReturn,
	newPlayerRunAccepted,
	newPlayerRunStart,
	tutorialAbandonedEvents,
	tutorialAttemptEventBound,
	tutorialAttemptStartEvents,
	tutorialFinishEvents,
	tutorialLessonReportEvents,
	tutorialOutroEvents,
	tutorialRestartedEvents,
	tutorialStepEvent,
	tutorialStuckEvents,
	type AnalyticsCatalogEntry,
	type AnalyticsFieldSet,
	type OnboardingDoc,
	type TutorialAttemptEnd,
} from "shared/onboarding";

/** Roblox AnalyticsService limits (per experience). */
const ROBLOX_MAX_CUSTOM_EVENT_NAMES = 100;
const ROBLOX_MAX_FUNNELS = 10;
const ROBLOX_MAX_FUNNEL_STEPS = 100;
const ROBLOX_MAX_FIELD_COMBINATIONS = 8000;

function fieldSets(e: AnalyticsCatalogEntry): AnalyticsFieldSet[] {
	const out: AnalyticsFieldSet[] = [];
	for (const s of [e.field01, e.field02, e.field03]) if (s !== undefined) out.push(s);
	return out;
}

/** The catalog entry a spec belongs to. */
function entryOf(spec: AnalyticsEventSpec): AnalyticsCatalogEntry | undefined {
	if (spec.kind === "custom") return analyticsCatalogEntry("custom", spec.name);
	if (spec.kind === "funnel") return analyticsCatalogEntry("funnel", spec.funnel);
	if (spec.kind === "onboarding") return analyticsCatalogEntry("onboarding", ONBOARDING_CATALOG_NAME);
	return analyticsCatalogEntry("progression", spec.path);
}

/** Fails unless every field of every spec is in its catalog set (and funnel step names in its step list). */
function expectInCatalog(specs: ReadonlyArray<AnalyticsEventSpec>): void {
	for (const spec of specs) {
		const e = entryOf(spec);
		expect(e).never.toBe(undefined);
		if (e === undefined) continue;
		const f = spec.fields;
		const slots: Array<[string | undefined, AnalyticsFieldSet | undefined]> = [
			[f?.field01, e.field01],
			[f?.field02, e.field02],
			[f?.field03, e.field03],
		];
		for (const [value, s] of slots) {
			if (value === undefined) continue;
			expect(s).never.toBe(undefined);
			expect(s?.values.includes(value)).toBe(true);
		}
		if (spec.kind === "funnel" || spec.kind === "onboarding") {
			expect(e.steps?.[spec.step - 1]).toBe(spec.stepName);
		}
	}
}

describe("analytics catalog limits", () => {
	it("custom event names: unique, every owner's names listed, at most 100", () => {
		const custom = analyticsCatalogEntries("custom");
		const names = new Set<string>();
		for (const e of custom) {
			expect(names.has(e.name)).toBe(false);
			names.add(e.name);
		}
		for (const [, n] of pairs(ANALYTICS_EVENT)) expect(names.has(n)).toBe(true);
		for (const [, n] of pairs(LOBBY_ANALYTICS_EVENT)) expect(names.has(n)).toBe(true);
		for (const [, n] of pairs(TUTORIAL_ANALYTICS_EVENT)) expect(names.has(n)).toBe(true);
		for (const [, n] of pairs(WALLET_ANALYTICS_EVENT)) expect(names.has(n)).toBe(true);
		// 36 before the run-over recap's RunRecap (docs/RUN_RECAP.md RR9); its views row (docs/RUN_CONTRIBUTION.md CT8) is
		// a row kind on that event, not a new name. 38 with Silver's ArmoryPurchase (docs/SILVER.md SV10), 39 with the
		// Silver shop's SilverShop (docs/SILVER_SHOP.md SH7).
		expect(custom.size()).toBe(39);
		expect(custom.size() <= ROBLOX_MAX_CUSTOM_EVENT_NAMES).toBe(true);
	});

	it("funnels: at most 10 (the onboarding funnel counted), step names unique and short", () => {
		const funnels = [...analyticsCatalogEntries("funnel"), ...analyticsCatalogEntries("onboarding")];
		expect(funnels.size()).toBe(3);
		expect(funnels.size() <= ROBLOX_MAX_FUNNELS).toBe(true);
		const names = new Set<string>();
		for (const f of funnels) {
			expect(names.has(f.name)).toBe(false);
			names.add(f.name);
			const steps = f.steps ?? [];
			expect(steps.size() > 0 && steps.size() <= ROBLOX_MAX_FUNNEL_STEPS).toBe(true);
			const seen = new Set<string>();
			for (const s of steps) {
				expect(seen.has(s)).toBe(false);
				seen.add(s);
				expect(s.size() > 0 && s.size() <= MAX_TUTORIAL_STEP_NAME_CHARS).toBe(true);
			}
		}
		expect(names.has(TUTORIAL_FUNNEL)).toBe(true);
		expect(analyticsCatalogEntry("funnel", TUTORIAL_FUNNEL)?.steps?.size()).toBe(TUTORIAL_FUNNEL_MAX_STEP + 2);
		expect(analyticsCatalogEntry("onboarding", ONBOARDING_CATALOG_NAME)?.steps?.size()).toBe(
			TUTORIAL_FUNNEL_MAX_STEP + 4,
		);
	});

	it("every field value set is finite, non-empty and unique", () => {
		for (const e of ANALYTICS_CATALOG) {
			for (const s of fieldSets(e)) {
				expect(s.values.size() > 0).toBe(true);
				const seen = new Set<string>();
				for (const v of s.values) {
					expect(typeIs(v, "string") && v.size() > 0).toBe(true);
					expect(seen.has(v)).toBe(false);
					seen.add(v);
				}
			}
		}
	});

	it("field value combinations: the sum over entries stays under 8,000", () => {
		const total = analyticsCatalogCombinations();
		let sum = 0;
		for (const e of ANALYTICS_CATALOG) sum += analyticsEntryCombinations(e);
		expect(total).toBe(sum);
		expect(total <= ROBLOX_MAX_FIELD_COMBINATIONS).toBe(true);
		// The tutorial's own entries, by the rule: lessons x entries x devices, etc.
		const entries = TUTORIAL_ENTRIES.size();
		const devices = TUTORIAL_DEVICES.size();
		const lessons = TUTORIAL_STEPS.size();
		const current = TUTORIAL_CURRENT_STEP_IDS.size();
		const n = (name: string) => analyticsEntryCombinations(analyticsCatalogEntry("custom", name)!);
		expect(n(TUTORIAL_ANALYTICS_EVENT.lessonTime)).toBe(lessons * entries * devices);
		expect(n(TUTORIAL_ANALYTICS_EVENT.stuck)).toBe(TUTORIAL_PROMPT_IDS.size() * entries * devices);
		expect(n(TUTORIAL_ANALYTICS_EVENT.skipped)).toBe(current * entries * devices);
		expect(n(TUTORIAL_ANALYTICS_EVENT.abandoned)).toBe(current * entries * TUTORIAL_ABANDON_KINDS.size());
		expect(n(TUTORIAL_ANALYTICS_EVENT.outroChoice)).toBe((TUTORIAL_OUTRO_CHOICES.size() + 1) * entries);
		expect(n(TUTORIAL_ANALYTICS_EVENT.onboardingGate)).toBe(ONBOARDING_GATE_REASONS.size());
		expect(analyticsEntryCombinations(analyticsCatalogEntry("funnel", TUTORIAL_FUNNEL)!)).toBe(
			entries * 1 * devices + 1,
		);
		print(`[analyticsCatalog] field value combinations: ${total} of ${ROBLOX_MAX_FIELD_COMBINATIONS}`);
	});

	it("one tutorial attempt logs at most maxEventsPerAttempt events, a first attempt included", () => {
		const lessons = TUTORIAL_FUNNEL_MAX_STEP;
		expect(tutorialAttemptEventBound()).toBe(
			1 + lessons + 2 * lessons + TUTORIAL_TELEMETRY.maxStuckReportsPerAttempt + 2,
		);
		expect(firstAttemptEventBound()).toBe(tutorialAttemptEventBound() + lessons + 4 + 1);
		expect(firstAttemptEventBound() <= TUTORIAL_TELEMETRY.maxEventsPerAttempt).toBe(true);
		// Pinned for the 17-lesson tutorial (docs/ARCHER.md AR6, revision 4): 60 per attempt, 82 for a first one, cap 84.
		expect(lessons).toBe(17);
		expect(tutorialAttemptEventBound()).toBe(60);
		expect(firstAttemptEventBound()).toBe(82);
		expect(TUTORIAL_TELEMETRY.maxEventsPerAttempt).toBe(84);
		// The session backstop is the attempt cap's worth of full attempts.
		expect(TUTORIAL_TELEMETRY.maxEventsPerSession).toBe(
			TUTORIAL_TELEMETRY.maxAttemptsLoggedPerSession * TUTORIAL_TELEMETRY.maxEventsPerAttempt,
		);
		expect(TUTORIAL_TELEMETRY.maxEventsPerSession).toBe(252);
		print(
			`[analyticsCatalog] events per attempt: ${tutorialAttemptEventBound()}, first attempt ${firstAttemptEventBound()} of ${
				TUTORIAL_TELEMETRY.maxEventsPerAttempt
			}`,
		);
	});
});

describe("run-over recap events stay inside the catalog", () => {
	it("every close, near-miss kind, flag pair, character and a party run's team rows", () => {
		const kinds: RunRecapNearMiss[] = [...RUN_RECAP_NEAR_MISS_KINDS, RUN_RECAP_NO_NEAR_MISS];
		// docs/ARCHER.md AR5: no character (M1) and every character.
		const characters: Array<CharacterId | undefined> = [undefined, ...CHARACTER_IDS];
		for (const close of RUN_RECAP_CLOSES)
			for (const nearMiss of kinds)
				for (const record of [false, true])
					for (const skipped of [false, true])
						for (const character of characters) {
							const team = { teamPerfects: 3, bestTeamStreak: 2, syncParries: 1 };
							for (const last of RUN_RECAP_TABS) {
								// docs/RUN_CONTRIBUTION.md CT8: a party run's views row, every last tab.
								const views = { you: 3, party: 1, last };
								const specs = analyticsForRunRecap({
									runId: "r",
									close,
									seconds: 2,
									nearMiss,
									record,
									skipped,
									team,
									views,
									character,
								});
								expect(specs.size()).toBe(close === "lobby" ? 5 : 1);
								expectInCatalog(specs);
							}
						}
		// 7 field01 values (3 closes, 3 team rows, views) x (7 near-miss values + 3 tabs + absent) x (4 flags, each alone
		// and with each of the 2 characters, + absent).
		expect(CHARACTER_IDS.size()).toBe(2);
		expect(analyticsEntryCombinations(analyticsCatalogEntry("custom", ANALYTICS_EVENT.runRecap)!)).toBe(
			7 * 11 * 13,
		);
		const close = analyticsForRunRecap({
			runId: "r",
			close: "retry",
			seconds: 2,
			nearMiss: "boss",
			record: true,
			skipped: false,
			character: "archer",
		})[0];
		expect(close.kind === "custom" && close.fields?.field03).toBe("record/archer");
	});

	it("RunDuration carries the run's character (docs/ARCHER.md AR5), none for a run without one", () => {
		for (const character of [undefined, ...CHARACTER_IDS]) {
			const rec = new RunTelemetry(6, undefined, character).finish();
			expect(rec.character).toBe(character);
			const specs = analyticsForRun(rec);
			expectInCatalog(specs);
			const duration = specs.find((e) => e.kind === "custom" && e.name === ANALYTICS_EVENT.runDuration);
			expect(duration === undefined || duration.kind !== "custom" ? "missing" : duration.fields?.field01).toBe(
				character,
			);
		}
		expect(analyticsEntryCombinations(analyticsCatalogEntry("custom", ANALYTICS_EVENT.runDuration)!)).toBe(3);
	});

	it("ArmoryPurchase (docs/SILVER.md SV10): every catalogue item at every level it has", () => {
		for (const item of ARMORY_CATALOG) {
			for (let level = 1; level <= item.tiers.size(); level++) {
				const price = itemPrice(item.id, level)!;
				expectInCatalog([
					armoryPurchaseEvent({ itemId: item.id, level, tier: item.tiers[level - 1], price, balance: 0 }),
				]);
			}
		}
	});
});

describe("tutorial builders stay inside the catalog", () => {
	it("attempt events for every entry, device, step and prompt", () => {
		for (const entry of TUTORIAL_ENTRIES) {
			for (const device of TUTORIAL_DEVICES) {
				const info = { entry, device };
				expectInCatalog(tutorialAttemptStartEvents(info));
				for (const s of TUTORIAL_STEPS) {
					expectInCatalog([tutorialStepEvent(s.number)]);
					expectInCatalog(tutorialLessonReportEvents({ step: s.number, seconds: 3, hits: 2 }, info));
				}
				for (const prompt of TUTORIAL_PROMPT_IDS)
					expectInCatalog(tutorialStuckEvents({ prompt, seconds: 20 }, info));
				for (const stepId of TUTORIAL_CURRENT_STEP_IDS) {
					const ended: TutorialAttemptEnd = {
						attemptId: "a",
						lastStep: 3,
						entry,
						device,
						stepId,
						logged: true,
					};
					expectInCatalog(tutorialFinishEvents("completed", ended));
					expectInCatalog(tutorialFinishEvents("skipped", ended));
					expectInCatalog(tutorialRestartedEvents(ended));
					for (const kind of TUTORIAL_ABANDON_KINDS) expectInCatalog(tutorialAbandonedEvents(ended, kind));
				}
				for (const choice of TUTORIAL_OUTRO_CHOICES) expectInCatalog(tutorialOutroEvents(choice, 4, entry));
				expectInCatalog(tutorialOutroEvents("left", 4, entry));
			}
		}
	});

	it("onboarding funnel, gate and new-player events", () => {
		for (const entry of ["organic", "invited", "party", "unknown"] as const) {
			const t = new OnboardingFunnelTracker();
			t.join({ loaded: true, fresh: true });
			const out: AnalyticsEventSpec[] = [
				...t.entryKnown(entry),
				...t.loaded(),
				...t.tutorialStarted("firstJoin"),
			];
			for (let n = 1; n <= TUTORIAL_FUNNEL_MAX_STEP; n++) for (const e of t.lesson(n)) out.push(e);
			for (const e of t.completed()) out.push(e);
			expectInCatalog(out);
		}
		for (const reason of ONBOARDING_GATE_REASONS) expectInCatalog(new OnboardingFunnelTracker().gate(reason));
		for (const outcome of ["completed", "skipped"] as const) {
			const doc: OnboardingDoc = { ...finishedOnboardingDoc(outcome, 1), firstDay: 10 };
			expectInCatalog(newPlayerRunStart(doc));
			for (const endReason of NEW_PLAYER_RUN_ENDS) {
				for (const floor of [1, 3, 7, 12, 17, 25]) {
					expectInCatalog(newPlayerRunAccepted(doc, { endReason, floor })?.events ?? []);
				}
			}
			expectInCatalog(newPlayerReturn(doc, 13)?.events ?? []);
		}
	});
});

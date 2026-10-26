// The client's tutorial flow (docs/TUTORIAL.md §4): the first-run gate (KV_Tutorial, the server's onboarding status,
// the timeout), the TutorialView -> HUD state copy the Reflex slice keeps, and the beat before the outro card.
import { describe, expect, it } from "@rbxts/jest-globals";
import { TUTORIAL } from "shared/config";
import { LiveRun } from "shared/play";
import { buildTutorialRunConfig } from "shared/run";
import { Button, EMPTY_INPUT, SIM_DT } from "shared/sim";
import {
	EMPTY_TUTORIAL_HUD,
	FirstRunGate,
	TUTORIAL_STEP_COUNT,
	TutorialDirector,
	TutorialOutroBeat,
	firstRunChoice,
	tutorialAttribute,
	tutorialDeviceFor,
	tutorialHudEqual,
	tutorialHudFrom,
	tutorialProgress,
	type TutorialView,
} from ".";

const NEW_PLAYER = { loaded: true, tutorialDone: false };
const VETERAN = { loaded: true, tutorialDone: true };
const LOAD_FAILED = { loaded: false, tutorialDone: false };

describe("firstRunChoice", () => {
	it("a loaded doc that is not done starts the tutorial; done or a failed load starts the normal flow", () => {
		expect(firstRunChoice({ forced: undefined, status: NEW_PLAYER, waitedSeconds: 0 })).toBe("tutorial");
		expect(firstRunChoice({ forced: undefined, status: VETERAN, waitedSeconds: 0 })).toBe("normal");
		expect(firstRunChoice({ forced: undefined, status: LOAD_FAILED, waitedSeconds: 0 })).toBe("normal");
	});

	it("waits for the status up to the timeout, then plays the normal flow", () => {
		const t = TUTORIAL.statusTimeoutSeconds;
		expect(t).toBeGreaterThan(0);
		expect(firstRunChoice({ forced: undefined, status: undefined, waitedSeconds: 0 })).toBe("wait");
		expect(firstRunChoice({ forced: undefined, status: undefined, waitedSeconds: t * 0.99 })).toBe("wait");
		expect(firstRunChoice({ forced: undefined, status: undefined, waitedSeconds: t })).toBe("normal");
		expect(firstRunChoice({ forced: undefined, status: undefined, waitedSeconds: 1, timeoutSeconds: 1 })).toBe(
			"normal",
		);
	});

	it("KV_Tutorial forces either way, without waiting for the server", () => {
		expect(firstRunChoice({ forced: true, status: undefined, waitedSeconds: 0 })).toBe("tutorial");
		expect(firstRunChoice({ forced: true, status: VETERAN, waitedSeconds: 0 })).toBe("tutorial");
		expect(firstRunChoice({ forced: true, status: LOAD_FAILED, waitedSeconds: 0 })).toBe("tutorial");
		expect(firstRunChoice({ forced: false, status: undefined, waitedSeconds: 0 })).toBe("normal");
		expect(firstRunChoice({ forced: false, status: NEW_PLAYER, waitedSeconds: 0 })).toBe("normal");
	});

	it("reads only a boolean KV_Tutorial", () => {
		expect(tutorialAttribute(true)).toBe(true);
		expect(tutorialAttribute(false)).toBe(false);
		expect(tutorialAttribute(undefined)).toBe(undefined);
		expect(tutorialAttribute("true")).toBe(undefined);
		expect(tutorialAttribute(1)).toBe(undefined);
	});
});

describe("FirstRunGate", () => {
	it("latches the first decision; a later status changes nothing", () => {
		const gate = new FirstRunGate(2);
		expect(gate.poll(0.5, undefined)).toBe("wait");
		expect(gate.decided()).toBe(undefined);
		gate.receive(NEW_PLAYER);
		expect(gate.poll(0.016, undefined)).toBe("tutorial");
		gate.receive(VETERAN); // tutorialFinished's answer, later in the session
		expect(gate.poll(0.016, undefined)).toBe("tutorial");
		expect(gate.decided()).toBe("tutorial");
	});

	it("times out on summed frame time (negative or zero deltas add nothing)", () => {
		const gate = new FirstRunGate(1);
		for (let i = 0; i < 9; i++) expect(gate.poll(0.1, undefined)).toBe("wait");
		expect(gate.poll(-5, undefined)).toBe("wait");
		expect(gate.poll(0, undefined)).toBe("wait");
		expect(gate.poll(0.1 + 1e-9, undefined)).toBe("normal");
		gate.receive(NEW_PLAYER); // too late: the normal flow is already on
		expect(gate.poll(0.1, undefined)).toBe("normal");
		expect(gate.waitedSeconds()).toBeCloseTo(1, 6);
	});

	it("keeps its own copy of the status", () => {
		const gate = new FirstRunGate(1);
		const status = { loaded: true, tutorialDone: false };
		gate.receive(status);
		status.tutorialDone = true;
		expect(gate.poll(0, undefined)).toBe("tutorial");
	});

	it("KV_Tutorial = false decides on the first poll", () => {
		const gate = new FirstRunGate(1);
		expect(gate.poll(0, false)).toBe("normal");
	});
});

/** A tutorial LiveRun with a director, one SIM_DT frame per step. */
function harness() {
	const setup = buildTutorialRunConfig();
	const run = new LiveRun({
		seed: TUTORIAL.runSeed,
		spawnX: setup.spawn!.x,
		spawnZ: setup.spawn!.z,
		config: setup.config,
		atBossDoor: false,
	});
	const director = new TutorialDirector();
	const step = (buttons = 0): TutorialView => {
		run.frame(SIM_DT, { ...EMPTY_INPUT, buttons });
		return director.update({
			state: run.state,
			config: setup.config,
			events: run.frameEvents,
			buttons,
			dt: SIM_DT,
		});
	};
	return { step };
}

describe("tutorialHudFrom", () => {
	it("copies the reused view: the copy stays put while the view moves on", () => {
		const h = harness();
		const first = tutorialHudFrom(h.step());
		expect(first.card).toBe("objective");
		expect(first.prompt).toBe("objective");
		expect(first.stepIndex).toBe(0);
		expect(first.stepCount).toBe(TUTORIAL_STEP_COUNT);
		expect(first.stepsDone).toBe(0);
		expect(first.markerKind).toBe(undefined);
		expect(first.finished).toBe(false);
		// Hold the card past its minimum, then press FIRE (an edge): the card goes, the move lesson shows.
		const frames = math.ceil(TUTORIAL.objectiveCardMinSeconds / SIM_DT) + 1;
		let view = h.step();
		for (let i = 0; i < frames; i++) view = h.step();
		view = h.step(Button.FIRE);
		const dismissed = tutorialHudFrom(view);
		expect(dismissed.card).toBe(undefined);
		expect(dismissed.prompt).toBe("move");
		expect(dismissed.stepIndex).toBe(1);
		expect(dismissed.stepsDone).toBe(1);
		expect(tutorialHudEqual(first, dismissed)).toBe(false);
		// The first copy did not follow the view.
		expect(first.card).toBe("objective");
		expect(tutorialHudEqual(dismissed, tutorialHudFrom(view))).toBe(true);
	});

	it("equality covers every field", () => {
		const base = { ...EMPTY_TUTORIAL_HUD, stepCount: 15 };
		expect(tutorialHudEqual(base, { ...base })).toBe(true);
		expect(tutorialHudEqual(base, { ...base, stepIndex: 1 })).toBe(false);
		expect(tutorialHudEqual(base, { ...base, stepCount: 14 })).toBe(false);
		expect(tutorialHudEqual(base, { ...base, stepsDone: 1 })).toBe(false);
		expect(tutorialHudEqual(base, { ...base, prompt: "move" })).toBe(false);
		expect(tutorialHudEqual(base, { ...base, card: "objective" })).toBe(false);
		expect(tutorialHudEqual(base, { ...base, highlight: "flask" })).toBe(false);
		expect(tutorialHudEqual(base, { ...base, markerKind: "door" })).toBe(false);
		expect(tutorialHudEqual(base, { ...base, finished: true })).toBe(false);
	});

	it("progress counts steps done over the step count; prompts follow the HUD's device", () => {
		expect(tutorialProgress({ ...EMPTY_TUTORIAL_HUD, stepsDone: 3, stepCount: 15 })).toEqual({
			step: 3,
			count: 15,
		});
		expect(tutorialProgress({ ...EMPTY_TUTORIAL_HUD, stepsDone: 16, stepCount: 15 })).toEqual({
			step: 15,
			count: 15,
		});
		expect(tutorialDeviceFor("keyboard")).toBe("keyboard");
		expect(tutorialDeviceFor("gamepad")).toBe("gamepad");
	});
});

describe("TutorialOutroBeat", () => {
	it("fires once when the delay has passed, then stays due", () => {
		expect(TUTORIAL.outroDelaySeconds).toBeGreaterThan(0);
		const beat = new TutorialOutroBeat(1);
		expect(beat.update(0.5)).toBe(false);
		expect(beat.update(-1)).toBe(false);
		expect(beat.due()).toBe(false);
		expect(beat.update(0.5)).toBe(true);
		expect(beat.due()).toBe(true);
		expect(beat.update(0.5)).toBe(false);
		expect(beat.due()).toBe(true);
	});

	it("one long frame is enough", () => {
		const beat = new TutorialOutroBeat();
		expect(beat.update(TUTORIAL.outroDelaySeconds * 2)).toBe(true);
	});
});

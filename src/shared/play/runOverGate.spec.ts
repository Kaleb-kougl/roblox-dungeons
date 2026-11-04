// docs/RUN_RECAP.md RR7 (RRD6): the run-over retry gate: Again / confirm / FIRE skip the recap before the arm and
// retry after it, the restart key retries at once, one retry per run over, FIRE edges primed at the open.
import { describe, expect, it } from "@rbxts/jest-globals";
import { Button } from "shared/sim";
import { RECAP, RecapTimeline, type RecapTimelineOptions } from "shared/view/hud";
import { RunOverRetryGate } from "./runOverGate";

const OPTIONS: RecapTimelineOptions = {
	nearMiss: { from: 0, to: 8, counted: true },
	highlights: [
		{ from: 0, to: 214, counted: true },
		{ from: 0, to: 11, counted: true },
	],
	reducedMotion: false,
};

function opened(fireDown = false): RunOverRetryGate {
	const gate = new RunOverRetryGate();
	gate.open(fireDown);
	return gate;
}

describe("RunOverRetryGate (RR7)", () => {
	it("before the arm Again, confirm and FIRE skip the timeline to settled; no retry", () => {
		for (const source of ["again", "confirm", "fire"] as const) {
			const t = new RecapTimeline(OPTIONS);
			t.step(RECAP.retryArmSec / 2);
			const gate = opened();
			expect([source, gate.press(source, t, true)]).toEqual([source, "skip"]);
			expect(t.isSettled()).toBe(true);
			expect(gate.hasRetried()).toBe(false);
			// The skip lands once on the next step.
			expect(t.step(0).lands).toBe(1);
		}
	});

	it("after the arm (0.6 s) the same presses retry", () => {
		for (const source of ["again", "confirm", "fire"] as const) {
			const t = new RecapTimeline(OPTIONS);
			t.step(RECAP.retryArmSec);
			expect([source, opened().press(source, t, true)]).toEqual([source, "retry"]);
		}
	});

	it("the bound restart key retries at once, even at 0 s", () => {
		const t = new RecapTimeline(OPTIONS);
		const gate = opened();
		expect(gate.press("restartKey", t, true)).toBe("retry");
		expect(t.isSettled()).toBe(false);
	});

	it("a mash through the death skips, then the first press after the arm retries, once", () => {
		const t = new RecapTimeline(OPTIONS);
		const gate = opened();
		const out: string[] = [];
		for (let i = 0; i < 5; i++) {
			t.step(0.1);
			out.push(gate.press("fire", t, true));
		}
		t.step(0.2);
		out.push(gate.press("fire", t, true));
		out.push(gate.press("again", t, true));
		out.push(gate.press("restartKey", t, true));
		expect(out).toEqual(["skip", "skip", "skip", "skip", "skip", "retry", "none", "none"]);
	});

	it("a new run over (open) clears the retry latch", () => {
		const gate = opened();
		const t = new RecapTimeline(OPTIONS);
		t.step(1);
		expect(gate.press("again", t, true)).toBe("retry");
		gate.open(false);
		const t2 = new RecapTimeline(OPTIONS);
		t2.step(1);
		expect(gate.press("again", t2, true)).toBe("retry");
	});

	it("no recap on screen: Again retries at once as before, confirm / FIRE do nothing", () => {
		expect(opened().press("again", undefined, true)).toBe("retry");
		expect(opened().press("confirm", undefined, true)).toBe("none");
		expect(opened().press("fire", undefined, true)).toBe("none");
	});

	it("a party run never retries from here: a press only skips the timeline", () => {
		const t = new RecapTimeline(OPTIONS);
		t.step(RECAP.retryArmSec + 0.05);
		const gate = opened();
		expect(gate.press("fire", t, false)).toBe("skip");
		expect(t.isSettled()).toBe(true);
		expect(gate.press("again", undefined, false)).toBe("none");
		expect(gate.hasRetried()).toBe(false);
	});

	it("FIRE: an edge counts; a FIRE held at the open must be let go first; a press over a GUI is none", () => {
		const held = opened(true);
		expect(held.fireEdge(Button.FIRE, false)).toBe(false);
		expect(held.fireEdge(0, false)).toBe(false);
		expect(held.fireEdge(Button.FIRE, false)).toBe(true);
		expect(held.fireEdge(Button.FIRE, false)).toBe(false);
		const free = opened(false);
		expect(free.fireEdge(Button.FIRE, true)).toBe(false); // a click on Main menu / Details
		expect(free.fireEdge(0, false)).toBe(false);
		expect(free.fireEdge(Button.FIRE, false)).toBe(true);
		// Other buttons are not FIRE.
		const other = opened(false);
		expect(other.fireEdge(Button.ALT, false)).toBe(false);
	});
});

// The tutorial's HUD / marker presentation (docs/TUTORIAL.md §4): the highlight ring and marker pulses (static under
// reduced motion), the ghost half heart's fade and the tutorial verdict line (the pause overlay's tutorial buttons:
// shared/view/menu menu.spec.ts).
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	DEFAULT_BINDINGS,
	rebind,
	unsubmittedReason,
	type Bindings,
	type BindingDevice,
	type GameAction,
} from "shared/play";
import { PLACEHOLDER_MANIFEST, ThemePack } from "shared/theme";
import { TUTORIAL_DEVICES, TUTORIAL_STRINGS, tutorialPromptIds, tutorialPromptKey } from "shared/tutorial";
import {
	PAUSE_HINT,
	TUTORIAL_VERDICT_CODE,
	TUTORIAL_VIEW,
	ghostHeartTransparency,
	highlightRingLook,
	tutorialLeaderboardHint,
	tutorialPromptVars,
	tutorialMarkerLook,
	verdictKey,
} from "shared/view/hud";

const V = TUTORIAL_VIEW;

/** `b` with `action`'s primary on `device` rebound to `input` (must be allowed). */
function rebound(b: Bindings, device: BindingDevice, action: GameAction, input: string): Bindings {
	const r = rebind(b, device, action, 0, input);
	if (!r.ok) error(`rebind refused: ${r.reason}`, 0);
	return r.bindings;
}
const HALF_RING = V.ringPeriodSeconds / 2;
const HALF_MARKER = V.markerPeriodSeconds / 2;

describe("highlightRingLook", () => {
	it("pulses from dim and thin to bright and thick every period", () => {
		const start = highlightRingLook(0, 1);
		expect(start.thickness).toBeCloseTo(V.ringThickness, 9);
		expect(start.transparency).toBeCloseTo(V.ringTransparencyDim, 9);
		const peak = highlightRingLook(HALF_RING, 1);
		expect(peak.thickness).toBeCloseTo(V.ringThickness + V.ringPulseThickness, 9);
		expect(peak.transparency).toBeCloseTo(V.ringTransparencyBright, 9);
		const again = highlightRingLook(V.ringPeriodSeconds, 1);
		expect(again.thickness).toBeCloseTo(start.thickness, 9);
		for (let t = 0; t <= 3; t += 0.05) {
			const l = highlightRingLook(t, 1);
			expect(l.transparency >= V.ringTransparencyBright - 1e-9).toBe(true);
			expect(l.transparency <= V.ringTransparencyDim + 1e-9).toBe(true);
		}
	});

	it("is a static bright ring under reduced motion (motionScale 0)", () => {
		for (const t of [0, 0.3, HALF_RING, 2.7]) {
			const l = highlightRingLook(t, 0);
			expect(l.thickness).toBe(V.ringThickness);
			expect(l.transparency).toBe(V.ringTransparencyBright);
		}
	});
});

describe("tutorialMarkerLook", () => {
	it("bobs above its rest lift and fades a little, once per period", () => {
		expect(tutorialMarkerLook(0, 1).liftTiles).toBeCloseTo(V.markerLiftTiles, 9);
		expect(tutorialMarkerLook(HALF_MARKER, 1).liftTiles).toBeCloseTo(V.markerLiftTiles + V.markerBobTiles, 9);
		expect(tutorialMarkerLook(HALF_MARKER, 1).transparency).toBeCloseTo(V.markerTransparencyDim, 9);
	});

	it("stands still under reduced motion", () => {
		for (const t of [0, 0.4, HALF_MARKER, 5]) {
			const l = tutorialMarkerLook(t, 0);
			expect(l.liftTiles).toBe(V.markerLiftTiles);
			expect(l.transparency).toBe(V.markerTransparency);
		}
	});
});

describe("ghostHeartTransparency", () => {
	it("appears nearly opaque and fades out over ghostHeartSeconds", () => {
		expect(ghostHeartTransparency(0)).toBe(V.ghostHeartStartTransparency);
		const mid = ghostHeartTransparency(V.ghostHeartSeconds / 2);
		expect(mid > V.ghostHeartStartTransparency && mid < 1).toBe(true);
		expect(ghostHeartTransparency(V.ghostHeartSeconds)).toBe(1);
		expect(ghostHeartTransparency(100)).toBe(1);
		expect(ghostHeartTransparency(-1)).toBe(V.ghostHeartStartTransparency);
	});
});

describe("the tutorial verdict line", () => {
	it("a skipped tutorial run reads the tutorial's own line; other skips keep the generic one", () => {
		expect(unsubmittedReason({ tutorial: true, stress: 0, scoring: false })).toBe(TUTORIAL_VERDICT_CODE);
		expect(verdictKey("skipped", TUTORIAL_VERDICT_CODE)).toBe(TUTORIAL_STRINGS.verdict);
		expect(verdictKey("skipped", "stress")).toBe("hud.verdict.skipped");
		expect(verdictKey("pending", TUTORIAL_VERDICT_CODE)).toBe("hud.verdict.pending");
		const pack = new ThemePack(PLACEHOLDER_MANIFEST);
		expect(pack.str(TUTORIAL_STRINGS.verdict)).toBe("Practice: not submitted (tutorial)");
	});

	it("the outro names where the leaderboard opens on each device", () => {
		expect(tutorialLeaderboardHint().keyboard).toBe("B");
		expect(tutorialLeaderboardHint().gamepad).toBe(PAUSE_HINT.gamepad);
		expect(tutorialLeaderboardHint(rebound(DEFAULT_BINDINGS, "kbm", "leaderboard", "G")).keyboard).toBe("G");
	});
});

describe("tutorialPromptVars", () => {
	const pack = new ThemePack(PLACEHOLDER_MANIFEST);

	it("default bindings give the old static prompts' key names", () => {
		const kb = tutorialPromptVars("keyboard");
		expect([kb.move, kb.fire, kb.alt, kb.roll, kb.flask, kb.swap, kb.ember, kb.skill1, kb.left, kb.right]).toEqual([
			"WASD",
			"Click",
			"Right click",
			"Space",
			"F",
			"E",
			"Q",
			"1",
			"A",
			"D",
		]);
		const pad = tutorialPromptVars("gamepad");
		expect([pad.move, pad.fire, pad.alt, pad.roll, pad.flask, pad.swap, pad.ember, pad.skill1]).toEqual([
			"Left stick",
			"RT",
			"LT",
			"LB",
			"D-pad up",
			"Y",
			"RB",
			"A",
		]);
		expect(pack.str(tutorialPromptKey("flask", "keyboard"), kb)).toBe(
			"You're wounded. Drink your flask: F. You get 3 per floor, refilled on every new floor.",
		);
		expect(pack.str(tutorialPromptKey("draft", "gamepad"), pad)).toBe("Pick a boon: Left stick, then RT.");
		expect(pack.str(tutorialPromptKey("draft", "keyboard"), kb)).toBe("Pick a boon: A / D, then Click.");
	});

	it("a rebound key shows in the prompts; multi-character move keys are listed", () => {
		const b = rebound(rebound(DEFAULT_BINDINGS, "kbm", "flask", "G"), "kbm", "moveUp", "Up");
		const kb = tutorialPromptVars("keyboard", b);
		expect(kb.flask).toBe("G");
		expect(kb.move).toBe("Up arrow / A / S / D");
		expect(pack.str(tutorialPromptKey("flask", "touch"), tutorialPromptVars("touch", b))).toBe(
			"You're wounded. Drink your flask: G. You get 3 per floor, refilled on every new floor.",
		);
		expect(tutorialPromptVars("gamepad", rebound(DEFAULT_BINDINGS, "pad", "roll", "ButtonX")).roll).toBe("X");
	});

	it("every prompt template is filled: no {placeholder} is left on any device", () => {
		for (const id of tutorialPromptIds()) {
			for (const d of TUTORIAL_DEVICES) {
				const text = pack.str(tutorialPromptKey(id, d), tutorialPromptVars(d));
				expect([id, d, text.find("{", 1, true)[0]]).toEqual([id, d, undefined]);
			}
		}
	});
});

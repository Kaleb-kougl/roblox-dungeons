// The tutorial's HUD / marker presentation (docs/TUTORIAL.md §4): the highlight ring and marker pulses (static under
// reduced motion), the ghost half heart's fade and the tutorial verdict line (the pause overlay's tutorial buttons:
// shared/view/menu menu.spec.ts), and the guidance arrow's look, chevron geometry, image size and on-screen test.
import { describe, expect, it } from "@rbxts/jest-globals";
import { STUDS_PER_TILE } from "shared/config";
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
import { MARKING_VIEW } from "shared/view";
import {
	pauseHint,
	TUTORIAL_VERDICT_CODE,
	TUTORIAL_VIEW,
	ghostHeartTransparency,
	highlightRingLook,
	tutorialLeaderboardHint,
	tutorialPromptVars,
	tutorialArrowArm,
	tutorialArrowImageSize,
	tutorialArrowLook,
	tutorialArrowOnScreen,
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

describe("tutorialArrowLook", () => {
	const HALF_ARROW = V.arrowPeriodSeconds / 2;

	it("slides forward by arrowSlideTiles and back once per period; fully shown it is arrowTransparency", () => {
		expect(tutorialArrowLook(0, 1).slideTiles).toBeCloseTo(0, 9);
		expect(tutorialArrowLook(HALF_ARROW, 1).slideTiles).toBeCloseTo(V.arrowSlideTiles, 9);
		expect(tutorialArrowLook(V.arrowPeriodSeconds, 1).slideTiles).toBeCloseTo(0, 9);
		for (let t = 0; t <= 3; t += 0.05) {
			const l = tutorialArrowLook(t, 1);
			expect(l.slideTiles >= -1e-9 && l.slideTiles <= V.arrowSlideTiles + 1e-9).toBe(true);
			expect(l.transparency).toBe(V.arrowTransparency);
		}
	});

	it("stands still under reduced motion (motionScale 0); motion and alpha clamp to 0..1", () => {
		for (const t of [0, 0.4, HALF_ARROW, 5]) expect(tutorialArrowLook(t, 0).slideTiles).toBe(0);
		expect(tutorialArrowLook(HALF_ARROW, 3).slideTiles).toBeCloseTo(V.arrowSlideTiles, 9);
		expect(tutorialArrowLook(HALF_ARROW, -1).slideTiles).toBe(0);
		expect(tutorialArrowLook(HALF_ARROW, 0.5).slideTiles).toBeCloseTo(V.arrowSlideTiles / 2, 9);
	});

	it("fades with alpha: invisible (1) at alpha 0, arrowTransparency at alpha 1, clamped outside", () => {
		expect(tutorialArrowLook(0, 1, 0).transparency).toBe(1);
		expect(tutorialArrowLook(0, 1, 1).transparency).toBe(V.arrowTransparency);
		expect(tutorialArrowLook(0, 1, 0.5).transparency).toBeCloseTo(1 - (1 - V.arrowTransparency) / 2, 9);
		expect(tutorialArrowLook(0, 1, -2).transparency).toBe(1);
		expect(tutorialArrowLook(0, 1, 4).transparency).toBe(V.arrowTransparency);
		// Reduced motion keeps the fade.
		expect(tutorialArrowLook(0, 0, 0.5).transparency).toBeCloseTo(1 - (1 - V.arrowTransparency) / 2, 9);
	});

	it("tunables: the uiAccent role, an optional ui.* image, a positive size, and a hold longer than the fade", () => {
		expect(V.arrowRole).toBe("uiAccent");
		expect(V.arrowImageId).toBe("ui.arrow.tutorial");
		expect(V.arrowOrbitTiles > V.arrowLengthTiles / 2).toBe(true);
		expect(V.arrowWidthTiles > V.arrowBarTiles && V.arrowBarTiles > 0).toBe(true);
		expect(V.arrowHoldSeconds >= V.arrowFadeSeconds).toBe(true);
		expect(V.arrowScreenInset > 0 && V.arrowScreenInset < 0.5).toBe(true);
		// The placeholder pack has no arrow image: the client draws the Part chevron.
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: () => undefined });
		expect(pack.image(V.arrowImageId)).toBe(undefined);
	});
});

describe("the guidance arrow's chevron, image and on-screen test", () => {
	it("each arm runs from its tail corner to the tip", () => {
		const L = V.arrowLengthTiles;
		const W = V.arrowWidthTiles;
		const arm = tutorialArrowArm();
		const half = arm.lengthTiles / 2;
		const sx = math.sin(arm.yaw) * half;
		const sz = math.cos(arm.yaw) * half;
		// +x arm: tail (W / 2, -L / 2), tip (0, L / 2).
		expect(arm.centreAcrossTiles - sx).toBeCloseTo(W / 2, 9);
		expect(-sz).toBeCloseTo(-L / 2, 9);
		expect(arm.centreAcrossTiles + sx).toBeCloseTo(0, 9);
		expect(sz).toBeCloseTo(L / 2, 9);
		expect(arm.yaw < 0 && arm.yaw > -math.pi / 2).toBe(true);
		const flat = tutorialArrowArm(1, 0);
		expect(flat.lengthTiles).toBe(1);
		expect(flat.centreAcrossTiles).toBeCloseTo(0, 12);
		expect(flat.yaw).toBeCloseTo(0, 12);
	});

	it("lies under the markings and off the floor", () => {
		const S = STUDS_PER_TILE;
		const centre = MARKING_VIEW.liftTiles * S * V.arrowLiftFraction;
		expect(centre + V.arrowThicknessStuds / 2 < MARKING_VIEW.liftTiles * S).toBe(true);
		expect(centre - V.arrowThicknessStuds / 2 > 0).toBe(true);
	});

	it("the image keeps its aspect inside the chevron's box", () => {
		const [a, b] = tutorialArrowImageSize(64, 64);
		expect(a).toBeCloseTo(math.min(V.arrowWidthTiles, V.arrowLengthTiles), 9);
		expect(b).toBeCloseTo(a, 9);
		const [w, h] = tutorialArrowImageSize(32, 128);
		expect(h).toBeCloseTo(V.arrowLengthTiles, 9);
		expect(w).toBeCloseTo(V.arrowLengthTiles / 4, 9);
		expect(tutorialArrowImageSize(0, 10)).toEqual([V.arrowWidthTiles, V.arrowLengthTiles]);
	});

	it("on screen: in front of the camera and inside the inset viewport", () => {
		const w = 1000;
		const h = 500;
		const i = V.arrowScreenInset;
		expect(tutorialArrowOnScreen(500, 250, 10, w, h)).toBe(true);
		expect(tutorialArrowOnScreen(500, 250, -10, w, h)).toBe(false); // behind the camera
		expect(tutorialArrowOnScreen(500, 250, 0, w, h)).toBe(false);
		expect(tutorialArrowOnScreen(w * i, h * i, 1, w, h)).toBe(true); // on the inset edge
		expect(tutorialArrowOnScreen(w * i - 1, 250, 1, w, h)).toBe(false);
		expect(tutorialArrowOnScreen(w * (1 - i) + 1, 250, 1, w, h)).toBe(false);
		expect(tutorialArrowOnScreen(500, h * i - 1, 1, w, h)).toBe(false);
		expect(tutorialArrowOnScreen(500, h * (1 - i) + 1, 1, w, h)).toBe(false);
		expect(tutorialArrowOnScreen(0 / 0, 250, 1, w, h)).toBe(false);
		expect(tutorialArrowOnScreen(500, 250, 1, 0, h)).toBe(false);
		expect(tutorialArrowOnScreen(5, 5, 1, w, h, 0)).toBe(true);
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
		expect(tutorialLeaderboardHint().gamepad).toBe(pauseHint().gamepad);
		expect(pauseHint().gamepad).toBe("Start");
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
		// Touch prompts name the on-screen control and never show key names.
		expect(pack.str(tutorialPromptKey("flask", "touch"), tutorialPromptVars("touch", b))).toBe(
			"You're wounded. Drink your flask: tap Flask. You get 3 per floor, refilled on every new floor.",
		);
		expect(tutorialPromptVars("gamepad", rebound(DEFAULT_BINDINGS, "pad", "roll", "ButtonX")).roll).toBe("X");
	});

	it("with a string lookup, named keys and the list separator come from input.* strings (docs/LOCALIZATION.md L1)", () => {
		const b = rebound(DEFAULT_BINDINGS, "kbm", "moveUp", "Up");
		const s = (key: string) => pack.str(key);
		// The placeholder pack's English reads exactly as without a lookup.
		for (const d of TUTORIAL_DEVICES) expect(tutorialPromptVars(d, b, s)).toEqual(tutorialPromptVars(d, b));
		const fake = (key: string) => `<${key}>`;
		const kb = tutorialPromptVars("keyboard", b, fake);
		expect(kb.move).toBe("<input.key.Up><input.separator>A<input.separator>S<input.separator>D");
		expect(kb.fire).toBe("<input.key.MouseButton1>");
		expect(tutorialPromptVars("gamepad", b, fake).move).toBe("<input.key.Thumbstick1>");
		expect(tutorialLeaderboardHint(b, fake)).toEqual({ keyboard: "B", gamepad: "<input.key.ButtonStart>" });
	});

	it("runs translated one-character move keys together by characters, not bytes", () => {
		const b = rebound(DEFAULT_BINDINGS, "kbm", "moveUp", "Up");
		const arrows = (key: string) => (key === "input.key.Up" ? "↑" : key === "input.separator" ? " · " : key);
		expect(tutorialPromptVars("keyboard", b, arrows).move).toBe("↑ASD");
		const word = (key: string) => (key === "input.key.Up" ? "Вверх" : key === "input.separator" ? " · " : key);
		expect(tutorialPromptVars("keyboard", b, word).move).toBe("Вверх · A · S · D");
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

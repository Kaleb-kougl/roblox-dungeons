// The tutorial's highlight ring on touch (shared/view/hud touchTutorial): which control each prompt rings, that the
// table matches the placeholder pack's touch prompts, the pause button's rule and the ring's pulse clock.
import { describe, expect, it } from "@rbxts/jest-globals";
import { tutorialPromptIds, tutorialPromptKey } from "shared/tutorial";
import { PLACEHOLDER_MANIFEST, ThemePack } from "shared/theme";
import {
	TOUCH_LAYOUT,
	TOUCH_TUTORIAL_RINGS,
	TouchRingTracker,
	highlightRingLook,
	pauseButtonRinged,
	touchButtonLabelKey,
	touchRingLookFor,
	touchTutorialRing,
	type TouchTutorialRing,
} from "shared/view/hud";

const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: () => undefined });

/** The placeholder pack's touch text of prompt `id`, lower-cased. */
function touchText(id: string): string {
	return pack.str(tutorialPromptKey(id, "touch")).lower();
}

function contains(text: string, part: string): boolean {
	return text.find(part, 1, true)[0] !== undefined;
}

/** Every ring in the table, as [prompt, control]. */
function tableRings(): Array<[string, TouchTutorialRing]> {
	const out: Array<[string, TouchTutorialRing]> = [];
	for (const [prompt, ring] of pairs(TOUCH_TUTORIAL_RINGS as unknown as Map<string, TouchTutorialRing>)) {
		out.push([prompt, ring]);
	}
	return out;
}

const T0 = 100;
const MOTION = 1;
/**
 * A time well inside one pulse (TUTORIAL_VIEW.ringPeriodSeconds 1.1): the look differs from t = 0. A power of two, so
 * (T0 + k + LATER) - (T0 + k) is exactly LATER and the looks compare exactly.
 */
const LATER = 0.25;

describe("touchTutorialRing", () => {
	it("rings the control each prompt's touch text names", () => {
		expect(touchTutorialRing("objective")).toBe("attack");
		expect(touchTutorialRing("move")).toBe("move");
		expect(touchTutorialRing("flask")).toBe("flask");
		expect(touchTutorialRing("attack")).toBe("attack");
		expect(touchTutorialRing("roll")).toBe("roll");
		expect(touchTutorialRing("guard")).toBe("alt");
		expect(touchTutorialRing("guardHold")).toBe("alt");
		expect(touchTutorialRing("ember")).toBe("ember");
		expect(touchTutorialRing("map")).toBe("pause");
		expect(touchTutorialRing("curse")).toBe("shrine");
	});

	it("rings nothing for no prompt, an unknown id, or a prompt that names no control", () => {
		for (const id of ["", "nope", "follow", "hits", "boost", "pellets", "pelletsHold", "relic", "draft", "boss"]) {
			expect([id, touchTutorialRing(id)]).toEqual([id, undefined]);
		}
		for (const id of ["stairwell", "finish"]) expect([id, touchTutorialRing(id)]).toEqual([id, undefined]);
	});

	it("every ringed prompt is one the director can show, with a touch string in the placeholder pack", () => {
		const ids = tutorialPromptIds();
		for (const [prompt] of tableRings()) {
			expect([prompt, ids.includes(prompt)]).toEqual([prompt, true]);
			expect([prompt, pack.hasString(tutorialPromptKey(prompt, "touch"))]).toEqual([prompt, true]);
		}
	});

	it("every ringed control exists: a button of the play cluster, the move stick or the pause button", () => {
		const buttons = new Set<string>();
		for (const spec of TOUCH_LAYOUT.play) buttons.add(spec.id);
		for (const [prompt, ring] of tableRings()) {
			const known = ring === "move" || ring === "pause" || buttons.has(ring);
			expect([prompt, ring, known]).toEqual([prompt, ring, true]);
		}
	});

	it("every prompt whose touch text says 'tap X' / 'hold (the) X' for a button rings that button", () => {
		for (const id of tutorialPromptIds()) {
			const text = touchText(id);
			for (const spec of TOUCH_LAYOUT.play) {
				const label = pack.str(touchButtonLabelKey(spec.id)).lower();
				const named =
					contains(text, `tap ${label}`) ||
					contains(text, `hold ${label}`) ||
					contains(text, `hold the ${label}`);
				if (named) expect([id, touchTutorialRing(id)]).toEqual([id, spec.id]);
			}
		}
	});

	it("a ringed button's label, or the pause button, is named in the prompt's touch text", () => {
		for (const [prompt, ring] of tableRings()) {
			if (ring === "move") continue; // "drag on the left side of the screen": the move stick has no label
			const text = touchText(prompt);
			const name = ring === "pause" ? "pause button" : pack.str(touchButtonLabelKey(ring)).lower();
			expect([prompt, contains(text, name)]).toEqual([prompt, true]);
		}
	});

	it("the move prompt's touch text is about dragging on the screen's left side", () => {
		expect(contains(touchText("move"), "drag")).toBe(true);
	});
});

describe("pauseButtonRinged", () => {
	it("rings the pause button for the map prompt on touch only", () => {
		expect(pauseButtonRinged("map", true)).toBe(true);
		expect(pauseButtonRinged("map", false)).toBe(false);
	});

	it("never for another prompt or none", () => {
		for (const id of ["", "flask", "attack", "move", "curse", "draft"]) {
			expect([id, pauseButtonRinged(id, true)]).toEqual([id, false]);
		}
	});
});

describe("TouchRingTracker", () => {
	it("no ring without a prompt that names a control", () => {
		const t = new TouchRingTracker();
		expect(t.frame("", T0, MOTION)).toBe(undefined);
		expect(t.frame("hits", T0 + 1, MOTION)).toBe(undefined);
		expect(t.frame("draft", T0 + 2, MOTION)).toBe(undefined);
	});

	it("starts the pulse when the ring appears and runs it on while the prompt stays", () => {
		const t = new TouchRingTracker();
		t.frame("", T0 - 5, MOTION);
		expect(t.frame("flask", T0, MOTION)).toEqual({ target: "flask", look: highlightRingLook(0, MOTION) });
		expect(t.frame("flask", T0 + LATER, MOTION)).toEqual({
			target: "flask",
			look: highlightRingLook(LATER, MOTION),
		});
	});

	it("the first frame's look differs from a later one (it pulses)", () => {
		const t = new TouchRingTracker();
		const first = t.frame("roll", T0, MOTION);
		const later = t.frame("roll", T0 + LATER, MOTION);
		expect(first?.look).never.toEqual(later?.look);
	});

	it("restarts the pulse on a prompt naming another control", () => {
		const t = new TouchRingTracker();
		t.frame("attack", T0, MOTION);
		t.frame("attack", T0 + LATER, MOTION);
		expect(t.frame("roll", T0 + 2, MOTION)).toEqual({ target: "roll", look: highlightRingLook(0, MOTION) });
		expect(t.frame("roll", T0 + 2 + LATER, MOTION)).toEqual({
			target: "roll",
			look: highlightRingLook(LATER, MOTION),
		});
	});

	it("keeps the pulse when the next prompt names the same control (guard -> guardHold)", () => {
		const t = new TouchRingTracker();
		t.frame("guard", T0, MOTION);
		expect(t.frame("guardHold", T0 + LATER, MOTION)).toEqual({
			target: "alt",
			look: highlightRingLook(LATER, MOTION),
		});
	});

	it("restarts the pulse after a gap with no ring (attack -> follow -> attack)", () => {
		const t = new TouchRingTracker();
		t.frame("objective", T0, MOTION);
		t.frame("follow", T0 + 1, MOTION);
		expect(t.frame("attack", T0 + 1 + LATER, MOTION)).toEqual({
			target: "attack",
			look: highlightRingLook(0, MOTION),
		});
	});

	it("reduced motion: a static ring", () => {
		const t = new TouchRingTracker();
		const still = highlightRingLook(0, 0);
		expect(t.frame("ember", T0, 0)?.look).toEqual(still);
		expect(t.frame("ember", T0 + LATER, 0)?.look).toEqual(still);
		expect(t.frame("ember", T0 + 0.55, 0)?.look).toEqual(still);
	});
});

describe("touchRingLookFor", () => {
	it("gives the frame's look only to the ringed control", () => {
		const frame = new TouchRingTracker().frame("curse", T0, MOTION);
		expect(touchRingLookFor(frame, "shrine")).toEqual(highlightRingLook(0, MOTION));
		for (const other of ["attack", "alt", "roll", "ember", "flask", "swap", "move", "pause"] as const) {
			expect([other, touchRingLookFor(frame, other)]).toEqual([other, undefined]);
		}
	});

	it("nothing without a frame", () => {
		expect(touchRingLookFor(undefined, "flask")).toBe(undefined);
		expect(touchRingLookFor(undefined, "move")).toBe(undefined);
	});
});

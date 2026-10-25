// The Options screen's rebinding flow (task L4b client): capture -> bind / swap prompt / refusal, which events a
// capture takes, the countdown, the input test strip and the held-input gate.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	DEFAULT_BINDINGS,
	HeldInputGate,
	REBIND,
	captureEvent,
	captureSecondsLeft,
	planRebind,
	pressedActions,
	rebind,
	type Bindings,
} from "shared/play";

function bound(
	b: Bindings,
	...steps: Array<[Parameters<typeof rebind>[1], Parameters<typeof rebind>[2], 0 | 1, string]>
) {
	let out = b;
	for (const [device, action, slot, input] of steps) {
		const r = rebind(out, device, action, slot, input);
		if (!r.ok) error(`setup rebind refused: ${r.reason}`, 0);
		out = r.bindings;
	}
	return out;
}

describe("planRebind", () => {
	it("binds a free input at once; the same input is a no-op", () => {
		const plan = planRebind(DEFAULT_BINDINGS, { device: "kbm", action: "swap", slot: 0 }, "G");
		expect(plan.kind).toBe("apply");
		if (plan.kind === "apply") expect(plan.bindings.kbm.swap).toEqual(["G"]);
		expect(planRebind(DEFAULT_BINDINGS, { device: "kbm", action: "swap", slot: 0 }, "E")).toEqual({ kind: "same" });
		expect(planRebind(DEFAULT_BINDINGS, { device: "pad", action: "swap", slot: 0 }, "ButtonY")).toEqual({
			kind: "same",
		});
	});

	it("asks before taking another action's input; Swap gives that action this slot's old input", () => {
		const plan = planRebind(DEFAULT_BINDINGS, { device: "kbm", action: "flask", slot: 0 }, "Q");
		expect(plan.kind).toBe("conflict");
		if (plan.kind !== "conflict") return;
		expect(plan.holder).toEqual({ action: "ember", slot: 0 });
		expect(plan.bindings.kbm.flask).toEqual(["Q"]);
		expect(plan.bindings.kbm.ember).toEqual(["F"]);
		const pad = planRebind(DEFAULT_BINDINGS, { device: "pad", action: "fire", slot: 0 }, "ButtonL2");
		expect(pad.kind).toBe("conflict");
		if (pad.kind === "conflict") {
			expect(pad.holder.action).toBe("alt");
			expect([pad.bindings.pad.fire, pad.bindings.pad.alt]).toEqual(["ButtonL2", "ButtonR2"]);
		}
	});

	it("an action's own other slot swaps without a prompt", () => {
		const plan = planRebind(DEFAULT_BINDINGS, { device: "kbm", action: "moveUp", slot: 0 }, "Up");
		expect(plan.kind).toBe("apply");
		if (plan.kind === "apply") expect(plan.bindings.kbm.moveUp).toEqual(["Up", "W"]);
	});

	it("an empty secondary taking a secondary asks, then clears it from the holder", () => {
		const plan = planRebind(DEFAULT_BINDINGS, { device: "kbm", action: "roll", slot: 1 }, "Left");
		expect(plan.kind).toBe("conflict");
		if (plan.kind !== "conflict") return;
		expect(plan.holder).toEqual({ action: "moveLeft", slot: 1 });
		expect(plan.bindings.kbm.roll).toEqual(["Space", "Left"]);
		expect(plan.bindings.kbm.moveLeft).toEqual(["A"]);
	});

	it("refuses reserved and unknown inputs, and a swap that would leave the holder unbound", () => {
		const target = { device: "kbm", action: "roll", slot: 0 } as const;
		expect(planRebind(DEFAULT_BINDINGS, target, "Escape")).toEqual({ kind: "refused", reason: "reserved" });
		expect(planRebind(DEFAULT_BINDINGS, target, "P")).toEqual({ kind: "refused", reason: "reserved" });
		expect(planRebind(DEFAULT_BINDINGS, target, "Thumbstick1")).toEqual({ kind: "refused", reason: "unknown" });
		expect(planRebind(DEFAULT_BINDINGS, { device: "pad", action: "roll", slot: 0 }, "ButtonStart")).toEqual({
			kind: "refused",
			reason: "reserved",
		});
		// Q is ember's only input; taking it into roll's EMPTY secondary would leave ember with nothing.
		expect(planRebind(DEFAULT_BINDINGS, { device: "kbm", action: "roll", slot: 1 }, "Q")).toEqual({
			kind: "refused",
			reason: "onlyInput",
		});
	});

	it("works from a rebound layout (the plan reads the bindings it is given)", () => {
		const b = bound(DEFAULT_BINDINGS, ["kbm", "swap", 0, "G"]);
		expect(planRebind(b, { device: "kbm", action: "flask", slot: 0 }, "E").kind).toBe("apply");
		const plan = planRebind(b, { device: "kbm", action: "flask", slot: 0 }, "G");
		expect(plan.kind).toBe("conflict");
	});
});

describe("captureEvent", () => {
	it("keyboard / mouse capture takes keys and mouse buttons; Escape cancels", () => {
		expect(captureEvent("kbm", "Keyboard", "G")).toEqual({ kind: "input", name: "G" });
		expect(captureEvent("kbm", "MouseButton3", "Unknown")).toEqual({ kind: "input", name: "MouseButton3" });
		expect(captureEvent("kbm", "Keyboard", "Escape")).toEqual({ kind: "cancel" });
		expect(captureEvent("kbm", "Keyboard", "Unknown")).toEqual({ kind: "ignore" });
		expect(captureEvent("kbm", "Gamepad1", "ButtonA")).toEqual({ kind: "ignore" });
		expect(captureEvent("kbm", "MouseMovement", "Unknown")).toEqual({ kind: "ignore" });
		expect(captureEvent("kbm", "Keyboard", "P")).toEqual({ kind: "input", name: "P" }); // refused later, with a note
	});

	it("gamepad capture takes pad buttons (any pad); keyboard Escape still cancels", () => {
		expect(captureEvent("pad", "Gamepad1", "ButtonX")).toEqual({ kind: "input", name: "ButtonX" });
		expect(captureEvent("pad", "Gamepad2", "ButtonR2")).toEqual({ kind: "input", name: "ButtonR2" });
		expect(captureEvent("pad", "Gamepad1", "Thumbstick1")).toEqual({ kind: "ignore" });
		expect(captureEvent("pad", "Keyboard", "G")).toEqual({ kind: "ignore" });
		expect(captureEvent("pad", "MouseButton1", "Unknown")).toEqual({ kind: "ignore" });
		expect(captureEvent("pad", "Keyboard", "Escape")).toEqual({ kind: "cancel" });
	});
});

describe("capture countdown, test strip, held-input gate", () => {
	it("counts whole seconds down from REBIND.captureTimeoutSeconds to 0", () => {
		expect(REBIND.captureTimeoutSeconds).toBe(5);
		expect([0, 0.2, 1, 4.5, 5, 7, -1].map((t) => captureSecondsLeft(t))).toEqual([5, 5, 4, 1, 0, 0, 5]);
	});

	it("lights the actions whose inputs are held, per device", () => {
		expect(pressedActions(DEFAULT_BINDINGS, "kbm", new Set(["W", "Space", "MouseButton1", "Z"]))).toEqual([
			"moveUp",
			"fire",
			"roll",
		]);
		expect(pressedActions(DEFAULT_BINDINGS, "kbm", new Set(["Up"]))).toEqual(["moveUp"]);
		expect(pressedActions(DEFAULT_BINDINGS, "pad", new Set(["ButtonA", "DPadDown", "W"]))).toEqual([
			"skill1",
			"restart",
		]);
		const b = bound(DEFAULT_BINDINGS, ["kbm", "roll", 0, "LeftShift"]);
		expect(pressedActions(b, "kbm", new Set(["Space", "LeftShift"]))).toEqual(["roll"]);
		expect(pressedActions(b, "kbm", new Set(["Space"]))).toEqual([]);
	});

	it("a held input stays released until let go once", () => {
		const gate = new HeldInputGate();
		gate.block(new Set(["G", "W"]));
		const frame1 = new Set(["G", "W", "A"]);
		gate.filter(frame1);
		expect(frame1.has("G") || frame1.has("W")).toBe(false);
		expect(frame1.has("A")).toBe(true);
		const frame2 = new Set(["G"]); // W released
		gate.filter(frame2);
		expect(frame2.size()).toBe(0);
		expect([gate.isBlocked("G"), gate.isBlocked("W")]).toEqual([true, false]);
		gate.filter(new Set<string>()); // G released
		const frame3 = new Set(["G", "W"]);
		gate.filter(frame3);
		expect(frame3.size()).toBe(2);
	});
});

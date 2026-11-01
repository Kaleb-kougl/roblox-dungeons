// Key rebinding (task L4b): the default layout reproduces the pre-rebinding tables, the rebind / swap rules, the
// overrides sanitizer, labels, and that a rebound layout gives the same sim bits as the default one.
import { describe, expect, it } from "@rbxts/jest-globals";
import { Button, DEBUG_DROP_BUTTON, DEBUG_FLOOR_BUTTON } from "shared/sim";
import { INPUT_KEY_STRING_KEYS, PLACEHOLDER_MANIFEST, ThemePack } from "shared/theme";
import {
	LEADERBOARD_KEY,
	PAUSE_INPUTS,
	SETTINGS_INPUTS,
	SETTINGS_KEY,
	SETTINGS_PAD_CLOSE_KEY,
	pauseHint,
	settingsHint,
} from "shared/view/hud";
import {
	DEFAULT_BINDINGS,
	FIXED_INPUTS,
	INPUT_KEY_STRING_NAMES,
	InputDeviceTracker,
	KBM_ACTIONS,
	KBM_KEY_NAMES,
	KBM_MOUSE_NAMES,
	KEY_BINDINGS,
	MOUSE_BINDINGS,
	MOVE_KEYS,
	PAD_ACTIONS,
	PAD_BINDINGS,
	PAD_BUTTON_NAMES,
	PAD_RESTART_KEY,
	ACTION_BUTTONS,
	REBIND,
	REPLAY_CHECK_KEYS,
	RESERVED_KBM_INPUTS,
	RESERVED_PAD_INPUTS,
	RESTART_KEY,
	actionLabel,
	applyControlsOverrides,
	boundKeyNames,
	boundMouseButtonNames,
	boundPadButtonNames,
	clearSlot,
	diffControlsOverrides,
	draftHint,
	driverKeyAction,
	inputKeyStringKey,
	inputLabel,
	inputsFor,
	isMapInput,
	isPadActive,
	isValidBindings,
	leaderboardHint,
	mapDevicesToInput,
	mapHint,
	rebind,
	resetDevice,
	restartHint,
	sanitizeControlsOverrides,
	shrineHint,
	spectateHint,
	swapHint,
	type BindingDevice,
	type BindingSlot,
	type Bindings,
	type DeviceSnapshot,
	type GameAction,
	type GamepadSnapshot,
	type RebindResult,
} from "shared/play";

/** The pre-L4b hard-coded tables (inputMapping.ts KEY_BINDINGS / MOVE_KEYS / MOUSE_BINDINGS / PAD_BINDINGS). */
const OLD_KEY_BINDINGS = new Map<string, number>([
	["Space", Button.ROLL],
	["Q", Button.EMBER],
	["One", Button.SKILL1],
	["Two", Button.SKILL2],
	["Three", Button.SKILL3],
	["Four", Button.SKILL4],
	["F", Button.FLASK],
	["E", Button.SWAP],
	["P", Button.PAUSE],
	["K", Button.DEBUG_HIT],
	["J", Button.DEBUG_BOSS],
	["N", DEBUG_FLOOR_BUTTON],
	// docs/BOOSTS.md B6: the debug boost drop (a port bit, KV_Debug only), added after rebinding; M until the full map
	// took M (docs/MINIMAP.md MD11), Semicolon since
	["Semicolon", DEBUG_DROP_BUTTON],
]);
const OLD_MOVE_KEYS = { up: ["W", "Up"], down: ["S", "Down"], left: ["A", "Left"], right: ["D", "Right"] };
const OLD_MOUSE_BINDINGS = new Map<string, number>([
	["MouseButton1", Button.FIRE],
	["MouseButton2", Button.ALT],
]);
const OLD_PAD_BINDINGS = new Map<string, number>([
	["ButtonR2", Button.FIRE],
	["ButtonL2", Button.ALT],
	["ButtonL1", Button.ROLL],
	["ButtonR1", Button.EMBER],
	["ButtonA", Button.SKILL1],
	["ButtonB", Button.SKILL2],
	["ButtonX", Button.SKILL3],
	["ButtonY", Button.SWAP],
	["DPadRight", Button.SKILL4],
	["DPadUp", Button.FLASK],
	["ButtonStart", Button.PAUSE],
]);

function expectSameMap(actual: ReadonlyMap<string, number>, expected: ReadonlyMap<string, number>): void {
	expect(actual.size()).toBe(expected.size());
	for (const [name, bit] of expected) expect([name, actual.get(name)]).toEqual([name, bit]);
}

function sorted(names: ReadonlyArray<string>): Array<string> {
	const out = [...names];
	out.sort();
	return out;
}

/** A layout as comparable text, one entry per action and device. */
function layout(b: Bindings): Array<string> {
	const out = new Array<string>();
	for (const action of KBM_ACTIONS) out.push(`kbm.${action}=${inputsFor(b, "kbm", action).join(",")}`);
	for (const action of PAD_ACTIONS) out.push(`pad.${action}=${inputsFor(b, "pad", action).join(",")}`);
	return out;
}

function ok(r: RebindResult): Bindings {
	if (!r.ok) error(`refused: ${r.reason}`, 0);
	return r.bindings;
}

function refusal(r: RebindResult): string | undefined {
	return r.ok ? undefined : r.reason;
}

describe("DEFAULT_BINDINGS", () => {
	it("reproduces the pre-rebinding tables exactly", () => {
		expectSameMap(KEY_BINDINGS, OLD_KEY_BINDINGS);
		expectSameMap(MOUSE_BINDINGS, OLD_MOUSE_BINDINGS);
		expectSameMap(PAD_BINDINGS, OLD_PAD_BINDINGS);
		expect([...MOVE_KEYS.up]).toEqual(OLD_MOVE_KEYS.up);
		expect([...MOVE_KEYS.down]).toEqual(OLD_MOVE_KEYS.down);
		expect([...MOVE_KEYS.left]).toEqual(OLD_MOVE_KEYS.left);
		expect([...MOVE_KEYS.right]).toEqual(OLD_MOVE_KEYS.right);
		expect([RESTART_KEY, PAD_RESTART_KEY]).toEqual(["R", "DPadDown"]);
		expect([...REPLAY_CHECK_KEYS]).toEqual(["F8", "L"]);
	});

	it("bound key / button lists are the old ones", () => {
		const oldKeys = new Array<string>();
		for (const [name] of OLD_KEY_BINDINGS) oldKeys.push(name);
		for (const names of [OLD_MOVE_KEYS.up, OLD_MOVE_KEYS.down, OLD_MOVE_KEYS.left, OLD_MOVE_KEYS.right]) {
			for (const n of names) oldKeys.push(n);
		}
		oldKeys.push("R", "F8", "L", "M"); // M: the full map toggle (docs/MINIMAP.md M9), no sim bits
		expect(sorted(boundKeyNames())).toEqual(sorted(oldKeys));
		const oldPad = new Array<string>();
		for (const [name] of OLD_PAD_BINDINGS) oldPad.push(name);
		oldPad.push("DPadDown", "DPadLeft"); // D-pad left: the full map toggle (docs/MINIMAP.md M9)
		expect(sorted(boundPadButtonNames())).toEqual(sorted(oldPad));
		expect(sorted(boundMouseButtonNames())).toEqual(["MouseButton1", "MouseButton2"]);
	});

	it("is a valid layout, and its hints are today's hint texts", () => {
		expect(isValidBindings(DEFAULT_BINDINGS)).toBe(true);
		// The texts the HUD showed from constants before the hints followed the bindings.
		expect(swapHint()).toEqual({ keyboard: "E", gamepad: "Y" });
		expect(restartHint()).toEqual({ keyboard: "R", gamepad: "D-pad down" });
		expect(shrineHint()).toEqual({ keyboard: "1", gamepad: "A" });
		expect(leaderboardHint()).toEqual({ keyboard: LEADERBOARD_KEY, gamepad: "B" });
		expect(draftHint()).toEqual({
			keyboard: { left: "A", right: "D", confirm: "Click" },
			gamepad: { left: "Stick left", right: "Stick right", confirm: "RT" },
		});
		expect(spectateHint()).toEqual({
			keyboard: { next: "Click", previous: "Right click" },
			gamepad: { next: "RT", previous: "LT" },
		});
		expect(PAUSE_INPUTS).toEqual({ keyboard: FIXED_INPUTS.pause, gamepad: FIXED_INPUTS.padPause });
		expect(SETTINGS_INPUTS).toEqual({ keyboard: FIXED_INPUTS.settings, gamepad: FIXED_INPUTS.padMenuClose });
		expect(pauseHint()).toEqual({ keyboard: "P", gamepad: "Start" });
		expect(settingsHint()).toEqual({ keyboard: "O", gamepad: "B" });
	});

	it("labels named keys through input.key.* strings, English identical to INPUT_LABELS (docs/LOCALIZATION.md L1)", () => {
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: () => undefined });
		const s = (key: string) => pack.str(key);
		const seen = new Set<string>();
		for (const name of INPUT_KEY_STRING_NAMES) {
			expect(seen.has(name)).toBe(false);
			seen.add(name);
			expect([name, pack.hasString(inputKeyStringKey(name))]).toEqual([name, true]);
			expect([name, inputLabel(name, s)]).toEqual([name, inputLabel(name)]);
		}
		// Every input a player can bind or see, and the theme's required list, agree with the names.
		expect([...INPUT_KEY_STRING_KEYS]).toEqual([
			...INPUT_KEY_STRING_NAMES.map(inputKeyStringKey),
			"input.separator",
		]);
		for (const name of [...KBM_KEY_NAMES, ...KBM_MOUSE_NAMES, ...PAD_BUTTON_NAMES]) {
			const label = inputLabel(name);
			// A label that is a word (two letters or more, not an F-key or pad shorthand) must be translatable.
			const wordy = label.match("%a%a%a")[0] !== undefined && label.match("^F%d+$")[0] === undefined;
			if (wordy) expect([name, seen.has(name)]).toEqual([name, true]);
		}
		// A lookup that translates: named keys follow it, letters and digits never ask.
		const asked: string[] = [];
		const fake = (key: string) => {
			asked.push(key);
			return `<${key}>`;
		};
		expect(inputLabel("LeftShift", fake)).toBe("<input.key.LeftShift>");
		expect(inputLabel("Q", fake)).toBe("Q");
		expect(inputLabel("One", fake)).toBe("1");
		expect(pauseHint(fake)).toEqual({ keyboard: "P", gamepad: "<input.key.ButtonStart>" });
		expect(draftHint(DEFAULT_BINDINGS, fake).gamepad.left).toBe("<input.key.StickLeft>");
		expect(spectateHint(DEFAULT_BINDINGS, fake).keyboard.next).toBe("<input.key.MouseButton1>");
		expect(asked.includes("input.key.Q")).toBe(false);
	});

	it("the fixed keys match the HUD's and are all reserved", () => {
		expect(FIXED_INPUTS.settings).toBe(SETTINGS_KEY);
		expect(FIXED_INPUTS.padMenuClose).toBe(SETTINGS_PAD_CLOSE_KEY);
		expect(DEFAULT_BINDINGS.kbm.leaderboard).toEqual([LEADERBOARD_KEY]);
		const fixedKeys = [FIXED_INPUTS.pause, FIXED_INPUTS.settings, FIXED_INPUTS.debugHit, FIXED_INPUTS.debugBoss];
		const debugKeys = [FIXED_INPUTS.debugFloor, FIXED_INPUTS.debugDrop];
		for (const k of [...fixedKeys, ...debugKeys, ...REPLAY_CHECK_KEYS, "Escape", "Tab", "Slash", "F9"]) {
			expect([k, RESERVED_KBM_INPUTS.includes(k)]).toEqual([k, true]);
		}
		for (const k of [FIXED_INPUTS.padPause, "ButtonSelect", "Thumbstick1", "Thumbstick2"]) {
			expect([k, RESERVED_PAD_INPUTS.includes(k)]).toEqual([k, true]);
		}
		expect(REBIND.captureTimeoutSeconds).toBe(5);
	});

	it("keyboard and pad name lists do not overlap (one KeyCode enum, two devices)", () => {
		for (const n of PAD_BUTTON_NAMES)
			expect([n, KBM_KEY_NAMES.includes(n) || KBM_MOUSE_NAMES.includes(n)]).toEqual([n, false]);
	});
});

describe("rebind", () => {
	it("binds a free input", () => {
		const b = ok(rebind(DEFAULT_BINDINGS, "kbm", "roll", 0, "LeftShift"));
		expect(inputsFor(b, "kbm", "roll")).toEqual(["LeftShift"]);
		expect(isValidBindings(b)).toBe(true);
		const r = rebind(DEFAULT_BINDINGS, "kbm", "roll", 0, "LeftShift");
		expect(r.ok && r.swappedWith).toBe(undefined);
		// the input is the same: nothing changes
		const same = rebind(DEFAULT_BINDINGS, "kbm", "roll", 0, "Space");
		expect(same.ok && same.bindings).toBe(DEFAULT_BINDINGS);
	});

	it("takes an input from another action by swapping (keyboard / mouse and pad)", () => {
		const r = rebind(DEFAULT_BINDINGS, "kbm", "fire", 0, "Q");
		const b = ok(r);
		expect(inputsFor(b, "kbm", "fire")).toEqual(["Q"]);
		expect(inputsFor(b, "kbm", "ember")).toEqual(["MouseButton1"]);
		expect(r.ok && r.swappedWith).toEqual({ action: "ember", slot: 0, input: "MouseButton1" });
		expect(isValidBindings(b)).toBe(true);

		const p = rebind(DEFAULT_BINDINGS, "pad", "roll", 0, "ButtonA");
		const pb = ok(p);
		expect([pb.pad.roll, pb.pad.skill1]).toEqual(["ButtonA", "ButtonL1"]);
		expect(p.ok && p.swappedWith).toEqual({ action: "skill1", slot: 0, input: "ButtonL1" });
		expect(layout(resetDevice(pb, "pad"))).toEqual(layout(DEFAULT_BINDINGS));
	});

	it("swaps into and out of secondaries", () => {
		// a secondary swaps with another action's secondary
		const b = ok(rebind(DEFAULT_BINDINGS, "kbm", "moveUp", 1, "Left"));
		expect([inputsFor(b, "kbm", "moveUp"), inputsFor(b, "kbm", "moveLeft")]).toEqual([
			["W", "Left"],
			["A", "Up"],
		]);
		// an EMPTY secondary takes another action's primary: that action's secondary is promoted
		const r = rebind(DEFAULT_BINDINGS, "kbm", "roll", 1, "W");
		const c = ok(r);
		expect([inputsFor(c, "kbm", "roll"), inputsFor(c, "kbm", "moveUp")]).toEqual([["Space", "W"], ["Up"]]);
		expect(r.ok && r.swappedWith).toEqual({ action: "moveUp", slot: 0, input: undefined });
		// ...and another action's secondary: it is cleared
		const d = ok(rebind(DEFAULT_BINDINGS, "kbm", "roll", 1, "Down"));
		expect([inputsFor(d, "kbm", "roll"), inputsFor(d, "kbm", "moveDown")]).toEqual([["Space", "Down"], ["S"]]);
		// a primary takes another action's secondary: that secondary becomes this primary's old input
		const e = ok(rebind(DEFAULT_BINDINGS, "kbm", "roll", 0, "Down"));
		expect([inputsFor(e, "kbm", "roll"), inputsFor(e, "kbm", "moveDown")]).toEqual([["Down"], ["S", "Space"]]);
		for (const x of [b, c, d, e]) expect(isValidBindings(x)).toBe(true);
	});

	it("refuses to leave another action without a primary", () => {
		// roll's secondary is empty and Q is Ember's only input
		expect(refusal(rebind(DEFAULT_BINDINGS, "kbm", "roll", 1, "Q"))).toBe("onlyInput");
		// into a filled slot it swaps instead
		expect(refusal(rebind(DEFAULT_BINDINGS, "kbm", "roll", 0, "Q"))).toBe(undefined);
	});

	it("moving an input between the slots of one action swaps them", () => {
		const b = ok(rebind(DEFAULT_BINDINGS, "kbm", "moveUp", 0, "Up"));
		expect(inputsFor(b, "kbm", "moveUp")).toEqual(["Up", "W"]);
		const one = ok(clearSlot(DEFAULT_BINDINGS, "kbm", "moveUp", 1));
		const c = ok(rebind(one, "kbm", "moveUp", 1, "W"));
		expect(inputsFor(c, "kbm", "moveUp")).toEqual(["W"]);
	});

	it("refuses reserved, unknown and non-rebindable targets", () => {
		for (const k of ["Escape", "Tab", "Slash", "F9", "P", "O", "K", "J", "N", "Semicolon", "F8", "L"]) {
			expect([k, refusal(rebind(DEFAULT_BINDINGS, "kbm", "fire", 0, k))]).toEqual([k, "reserved"]);
		}
		for (const k of ["ButtonStart", "ButtonSelect", "Thumbstick1", "Thumbstick2"]) {
			expect([k, refusal(rebind(DEFAULT_BINDINGS, "pad", "fire", 0, k))]).toEqual([k, "reserved"]);
		}
		expect(refusal(rebind(DEFAULT_BINDINGS, "kbm", "fire", 0, "Banana"))).toBe("unknown");
		expect(refusal(rebind(DEFAULT_BINDINGS, "kbm", "fire", 0, "ButtonA"))).toBe("unknown");
		expect(refusal(rebind(DEFAULT_BINDINGS, "pad", "fire", 0, "W"))).toBe("unknown");
		expect(refusal(rebind(DEFAULT_BINDINGS, "pad", "fire", 0, "MouseButton1"))).toBe("unknown");
		expect(refusal(rebind(DEFAULT_BINDINGS, "pad", "moveUp", 0, "DPadLeft"))).toBe("notRebindable");
		expect(refusal(rebind(DEFAULT_BINDINGS, "pad", "leaderboard", 0, "DPadLeft"))).toBe("notRebindable");
		expect(refusal(rebind(DEFAULT_BINDINGS, "kbm", "pause" as GameAction, 0, "G"))).toBe("notRebindable");
		expect(refusal(rebind(DEFAULT_BINDINGS, "pad", "fire", 1, "DPadLeft"))).toBe("badSlot");
		expect(refusal(rebind(DEFAULT_BINDINGS, "kbm", "fire", 2 as BindingSlot, "G"))).toBe("badSlot");
	});

	it("never binds an input twice and every action keeps a primary (random rebind sequences)", () => {
		const kbmInputs = [...KBM_KEY_NAMES, ...KBM_MOUSE_NAMES, "Escape", "Tab", "Banana"];
		const padInputs = [...PAD_BUTTON_NAMES, "ButtonStart", "Thumbstick1"];
		let seed = 12345;
		const pick = (n: number) => {
			seed = (seed * 48271) % 2147483647;
			return seed % n;
		};
		let b = DEFAULT_BINDINGS;
		let applied = 0;
		for (let i = 0; i < 2000; i++) {
			const device: BindingDevice = pick(3) === 0 ? "pad" : "kbm";
			const actions: ReadonlyArray<GameAction> = device === "kbm" ? KBM_ACTIONS : PAD_ACTIONS;
			const inputs = device === "kbm" ? kbmInputs : padInputs;
			const action = actions[pick(actions.size())];
			const slot: BindingSlot = device === "kbm" && pick(2) === 1 ? 1 : 0;
			const r =
				pick(8) === 0
					? clearSlot(b, device, action, slot)
					: rebind(b, device, action, slot, inputs[pick(inputs.size())]);
			if (r.ok) {
				b = r.bindings;
				applied++;
			}
			expect(isValidBindings(b)).toBe(true);
		}
		expect(applied).toBeGreaterThan(500);
	});
});

describe("clearSlot and resetDevice", () => {
	it("clears a keyboard secondary, never a primary or a pad button", () => {
		const b = ok(clearSlot(DEFAULT_BINDINGS, "kbm", "moveUp", 1));
		expect(inputsFor(b, "kbm", "moveUp")).toEqual(["W"]);
		expect(boundKeyNames(b).includes("Up")).toBe(false);
		expect(refusal(clearSlot(DEFAULT_BINDINGS, "kbm", "moveUp", 0))).toBe("primaryRequired");
		expect(refusal(clearSlot(DEFAULT_BINDINGS, "pad", "fire", 0))).toBe("primaryRequired");
		expect(refusal(clearSlot(DEFAULT_BINDINGS, "pad", "moveUp", 0))).toBe("notRebindable");
		// an empty secondary: nothing to do
		const again = clearSlot(b, "kbm", "moveUp", 1);
		expect(again.ok && again.bindings).toBe(b);
	});

	it("resets one device only", () => {
		const b = ok(rebind(ok(rebind(DEFAULT_BINDINGS, "kbm", "fire", 0, "G")), "pad", "fire", 0, "ButtonA"));
		const kbmReset = resetDevice(b, "kbm");
		expect(inputsFor(kbmReset, "kbm", "fire")).toEqual(["MouseButton1"]);
		expect(kbmReset.pad.fire).toBe("ButtonA");
		const padReset = resetDevice(b, "pad");
		expect(inputsFor(padReset, "kbm", "fire")).toEqual(["G"]);
		expect(padReset.pad.fire).toBe("ButtonR2");
	});
});

describe("controls overrides", () => {
	it("stores only what differs, and round-trips", () => {
		expect(diffControlsOverrides(DEFAULT_BINDINGS)).toEqual({});
		let b = ok(rebind(DEFAULT_BINDINGS, "kbm", "fire", 0, "Q")); // swaps with ember
		b = ok(clearSlot(b, "kbm", "moveDown", 1));
		b = ok(rebind(b, "pad", "roll", 0, "ButtonL3"));
		const o = diffControlsOverrides(b);
		expect(o).toEqual({
			kbm: { fire: ["Q"], ember: ["MouseButton1"], moveDown: ["S"] },
			pad: { roll: "ButtonL3" },
		});
		expect(layout(applyControlsOverrides(DEFAULT_BINDINGS, o))).toEqual(layout(b));
		expect(layout(applyControlsOverrides(DEFAULT_BINDINGS, {}))).toEqual(layout(DEFAULT_BINDINGS));
	});

	it("drops unknown actions, unknown / reserved names and malformed slots", () => {
		const o = sanitizeControlsOverrides({
			kbm: {
				fire: ["G"],
				pause: ["H"], // not an action
				roll: ["Banana"], // unknown name
				alt: ["Escape"], // reserved
				flask: ["P"], // fixed
				swap: ["T", "T"], // twice in one action
				ember: ["Y", "U", "I"], // three slots
				skill1: "Z", // not a list
				skill2: [7], // not a name
				skill3: ["Three"], // the default
			},
			pad: { fire: "ButtonStart", alt: "W", roll: 3, moveUp: "ButtonL3", skill4: "ButtonL3" },
			junk: true,
		});
		expect(o).toEqual({ kbm: { fire: ["G"] }, pad: { skill4: "ButtonL3" } });
		for (const raw of [undefined, 5, "x", [], { kbm: 1, pad: "y" }])
			expect(sanitizeControlsOverrides(raw)).toEqual({});
	});

	it("drops overrides that would bind an input twice (consistent swaps survive)", () => {
		// Q alone would also stay Ember's default: dropped
		expect(sanitizeControlsOverrides({ kbm: { fire: ["Q"] } })).toEqual({});
		// the swapped pair is consistent
		expect(sanitizeControlsOverrides({ kbm: { fire: ["Q"], ember: ["MouseButton1"] } })).toEqual({
			kbm: { fire: ["Q"], ember: ["MouseButton1"] },
		});
		// two overrides on one input: both dropped; then ember's default no longer clashes
		expect(sanitizeControlsOverrides({ kbm: { fire: ["G"], roll: ["G"] }, pad: { fire: "ButtonA" } })).toEqual({});
		// a chain: fire takes Q (ember's), ember takes Space (roll's), roll keeps its default -> all fall back
		expect(sanitizeControlsOverrides({ kbm: { fire: ["Q"], ember: ["Space"] } })).toEqual({});
		// a secondary clash drops only the override involved
		expect(sanitizeControlsOverrides({ kbm: { roll: ["Space", "W"], flask: ["V"] } })).toEqual({
			kbm: { flask: ["V"] },
		});
	});

	it("never yields an unbound action or a duplicate (random untrusted overrides)", () => {
		const names = [...KBM_KEY_NAMES, ...KBM_MOUSE_NAMES, ...PAD_BUTTON_NAMES, "Escape", "ButtonStart", "?"];
		let seed = 777;
		const pick = (n: number) => {
			seed = (seed * 48271) % 2147483647;
			return seed % n;
		};
		for (let i = 0; i < 300; i++) {
			const kbm: Record<string, unknown> = {};
			const pad: Record<string, unknown> = {};
			for (const action of KBM_ACTIONS) {
				const roll = pick(4);
				if (roll === 1) kbm[action] = [names[pick(names.size())]];
				else if (roll === 2) kbm[action] = [names[pick(names.size())], names[pick(names.size())]];
			}
			for (const action of PAD_ACTIONS) if (pick(2) === 1) pad[action] = names[pick(names.size())];
			const b = applyControlsOverrides(DEFAULT_BINDINGS, { kbm, pad });
			expect(isValidBindings(b)).toBe(true);
			expect(layout(applyControlsOverrides(DEFAULT_BINDINGS, diffControlsOverrides(b)))).toEqual(layout(b));
		}
	});
});

describe("labels", () => {
	it("names inputs as the HUD hints do", () => {
		const cases: Array<[string, string]> = [
			["MouseButton1", "Click"],
			["MouseButton2", "Right click"],
			["One", "1"],
			["Four", "4"],
			["ButtonR2", "RT"],
			["ButtonL1", "LB"],
			["ButtonA", "A"],
			["DPadUp", "D-pad up"],
			["DPadDown", "D-pad down"],
			["Space", "Space"],
			["Q", "Q"],
			["F5", "F5"],
			["ButtonStart", "Start"],
		];
		for (const [name, label] of cases) expect([name, inputLabel(name)]).toEqual([name, label]);
		expect(actionLabel(DEFAULT_BINDINGS, "kbm", "fire")).toBe("Click");
		expect(actionLabel(DEFAULT_BINDINGS, "pad", "flask")).toBe("D-pad up");
		expect(actionLabel(DEFAULT_BINDINGS, "pad", "moveUp")).toBe("");
	});

	it("hints follow a rebound layout", () => {
		let b = ok(rebind(DEFAULT_BINDINGS, "kbm", "swap", 0, "C"));
		b = ok(rebind(b, "pad", "swap", 0, "DPadLeft"));
		b = ok(rebind(b, "kbm", "skill1", 0, "G"));
		b = ok(rebind(b, "kbm", "moveLeft", 0, "Left")); // swaps the slots: Left primary
		b = ok(rebind(b, "pad", "fire", 0, "ButtonR1")); // swaps with ember
		expect(swapHint(b)).toEqual({ keyboard: "C", gamepad: "D-pad left" });
		expect(shrineHint(b)).toEqual({ keyboard: "G", gamepad: "A" });
		expect(draftHint(b).keyboard).toEqual({ left: "Left arrow", right: "D", confirm: "Click" });
		expect(draftHint(b).gamepad.confirm).toBe("RB");
		expect(spectateHint(b).gamepad).toEqual({ next: "RB", previous: "LT" });
		b = ok(rebind(b, "kbm", "alt", 0, "F"));
		expect(spectateHint(b).keyboard).toEqual({ next: "Click", previous: "F" });
	});
});

// ---------------------------------------------------------------------------------------------
// Mapping a rebound layout

function snap(keys: string[], mouse: string[] = [], pad?: GamepadSnapshot): DeviceSnapshot {
	return {
		kbm: { keys: new Set(keys), mouseButtons: new Set(mouse) },
		pad,
		aimDevice: "mouse",
		pointerAimX: 3,
		pointerAimZ: -4,
	};
}

function pad(buttons: string[], triggers: [number, number] = [0, 0], leftX = 0): GamepadSnapshot {
	return {
		leftX,
		leftY: 0,
		rightX: 0,
		rightY: 0,
		leftTrigger: triggers[0],
		rightTrigger: triggers[1],
		buttons: new Set(buttons),
	};
}

describe("mapping a rebound layout", () => {
	// A full custom layout: every rebindable keyboard action moved (with swaps), and the pad shuffled.
	let custom = DEFAULT_BINDINGS;
	const steps: Array<[BindingDevice, GameAction, BindingSlot, string]> = [
		["kbm", "moveUp", 0, "I"],
		["kbm", "moveDown", 0, "G"],
		["kbm", "moveLeft", 0, "H"],
		["kbm", "moveRight", 0, "U"], // not M: M is the map (taking it would swap it)
		["kbm", "moveUp", 1, "Y"],
		["kbm", "fire", 0, "Q"], // ember takes MouseButton1
		["kbm", "roll", 0, "MouseButton3"],
		["kbm", "alt", 1, "LeftShift"],
		["kbm", "flask", 0, "Two"], // skill2 takes F
		["kbm", "swap", 0, "C"],
		["kbm", "restart", 0, "Backspace"],
		["pad", "skill1", 0, "ButtonR2"], // fire takes ButtonA
		["pad", "roll", 0, "ButtonR1"], // ember takes ButtonL1
		["pad", "restart", 0, "ButtonL3"], // a free button (D-pad left is the map)
	];
	for (const [device, action, slot, input] of steps) custom = ok(rebind(custom, device, action, slot, input));

	/** The same presses on both layouts: [default inputs, custom inputs]. */
	const presses: Array<[DeviceSnapshot, DeviceSnapshot]> = [
		[snap(["W"]), snap(["I"])],
		[snap(["Up", "D"]), snap(["Y", "U"])],
		[snap(["S", "A"]), snap(["G", "H"])],
		[snap(["Space", "Q", "F", "E"], ["MouseButton1"]), snap(["C", "Two", "Q"], ["MouseButton1", "MouseButton3"])],
		[snap([], ["MouseButton1", "MouseButton2"]), snap(["Q", "LeftShift"])],
		[snap(["One", "Two", "Three", "Four", "P"]), snap(["One", "F", "Three", "Four", "P"])],
		[snap(["K", "J", "N", "Semicolon"]), snap(["K", "J", "N", "Semicolon"])],
		// pad: RT analog fire -> A; A skill1 -> RT analog; LB roll -> RB; RB ember -> LB
		[snap([], [], pad([], [0, 0.8])), snap([], [], pad(["ButtonA"]))],
		[snap([], [], pad(["ButtonA"])), snap([], [], pad([], [0, 0.8]))],
		[snap([], [], pad(["ButtonA"])), snap([], [], pad(["ButtonR2"]))],
		[
			snap([], [], pad(["ButtonL1", "ButtonStart"], [0.9, 0], 0.7)),
			snap([], [], pad(["ButtonR1", "ButtonStart"], [0.9, 0], 0.7)),
		],
		[snap([], [], pad(["ButtonR1"])), snap([], [], pad(["ButtonL1"]))],
		[snap(["W", "D"], [], pad([], [0, 0.3], -0.5)), snap(["I", "U"], [], pad([], [0, 0.3], -0.5))],
	];

	it("the custom layout is valid", () => {
		expect(isValidBindings(custom)).toBe(true);
	});

	it("gives the same frames (bit for bit) as the default layout pressed with the equivalent inputs", () => {
		for (let i = 0; i < presses.size(); i++) {
			const [d, c] = presses[i];
			const expected = mapDevicesToInput(d);
			const actual = mapDevicesToInput(c, undefined, custom);
			expect([i, actual]).toEqual([i, expected]);
		}
	});

	it("the old inputs no longer act (except where the custom layout reuses them)", () => {
		expect(mapDevicesToInput(snap(["W", "Space", "E"]), undefined, custom).buttons).toBe(0);
		expect(mapDevicesToInput(snap(["W"]), undefined, custom).moveX).toBe(0);
		// a trigger bound to skill 1 still uses the analog threshold
		expect(mapDevicesToInput(snap([], [], pad([], [0, 0.3])), undefined, custom).buttons).toBe(0);
		expect(mapDevicesToInput(snap([], [], pad([], [0, 0.6])), undefined, custom).buttons).toBe(Button.SKILL1);
	});

	it("driver keys, bound names and the pad tracker follow the layout", () => {
		expect(driverKeyAction("Backspace", false, false, custom)).toBe("reset");
		expect(driverKeyAction("R", false, false, custom)).toBe(undefined);
		expect(driverKeyAction("ButtonL3", false, false, custom)).toBe(undefined);
		expect(driverKeyAction("ButtonL3", false, true, custom)).toBe("reset");
		expect(driverKeyAction("DPadDown", false, true, custom)).toBe(undefined);
		expect(driverKeyAction("L", true, false, custom)).toBe("replayCheck");

		const keys = boundKeyNames(custom);
		for (const k of [
			"I",
			"Y",
			"G",
			"H",
			"U",
			"M",
			"Semicolon",
			"Q",
			"LeftShift",
			"Two",
			"F",
			"C",
			"Backspace",
			"P",
			"K",
			"F8",
		]) {
			expect([k, keys.includes(k)]).toEqual([k, true]);
		}
		for (const k of ["W", "Space", "E", "R", "B", "MouseButton3"])
			expect([k, keys.includes(k)]).toEqual([k, false]);
		expect(sorted(boundMouseButtonNames(custom))).toEqual(["MouseButton1", "MouseButton2", "MouseButton3"]);
		expect(boundPadButtonNames(custom).includes("ButtonL3")).toBe(true);
		expect(boundPadButtonNames(custom).includes("DPadDown")).toBe(false);

		// flask moves from D-pad up to the free left stick click: D-pad up no longer counts as using the pad
		const flaskLeft = ok(rebind(DEFAULT_BINDINGS, "pad", "flask", 0, "ButtonL3"));
		const t = new InputDeviceTracker();
		t.bindings = flaskLeft;
		t.padSampled(pad(["DPadUp"]));
		expect(t.device).toBe("keyboard");
		t.padSampled(pad(["ButtonL3"]));
		expect(t.device).toBe("gamepad");
		expect(isPadActive(pad(["DPadUp"]))).toBe(true);
		expect(isPadActive(pad(["DPadUp"]), undefined, flaskLeft)).toBe(false);
	});
});

// ---------------------------------------------------------------------------------------------
// The full map toggle (docs/MINIMAP.md M9)

describe("the map action (docs/MINIMAP.md M9)", () => {
	it("is on both devices after leaderboard / restart, defaults M / D-pad left, and the defaults stay duplicate-free", () => {
		expect(KBM_ACTIONS[KBM_ACTIONS.size() - 1]).toBe("map");
		expect(KBM_ACTIONS.indexOf("map")).toBe(KBM_ACTIONS.indexOf("leaderboard") + 1);
		expect(PAD_ACTIONS[PAD_ACTIONS.size() - 1]).toBe("map");
		expect(PAD_ACTIONS.indexOf("map")).toBe(PAD_ACTIONS.indexOf("restart") + 1);
		expect(DEFAULT_BINDINGS.kbm.map).toEqual(["M"]);
		expect(DEFAULT_BINDINGS.pad.map).toBe("DPadLeft");
		expect(PAD_BUTTON_NAMES.includes("DPadLeft")).toBe(true);
		expect(KBM_KEY_NAMES.includes("M")).toBe(true);
		for (const device of ["kbm", "pad"] as const) {
			const seen = new Set<string>();
			const actions: ReadonlyArray<GameAction> = device === "kbm" ? KBM_ACTIONS : PAD_ACTIONS;
			for (const action of actions) {
				for (const input of inputsFor(DEFAULT_BINDINGS, device, action)) {
					expect([device, input, seen.has(input)]).toEqual([device, input, false]);
					seen.add(input);
				}
			}
		}
		expect(isValidBindings(DEFAULT_BINDINGS)).toBe(true);
		expect(mapHint()).toEqual({ keyboard: "M", gamepad: "D-pad left" });
	});

	it("presses no sim button: not in ACTION_BUTTONS, and M / D-pad left map to an empty frame", () => {
		expect(ACTION_BUTTONS.has("map")).toBe(false);
		expect(KEY_BINDINGS.has("M")).toBe(false);
		expect(PAD_BINDINGS.has("DPadLeft")).toBe(false);
		const keys = mapDevicesToInput(snap(["M"]));
		expect([keys.buttons, keys.moveX, keys.moveZ]).toEqual([0, 0, 0]);
		expect(mapDevicesToInput(snap([], [], pad(["DPadLeft"]))).buttons).toBe(0);
		// Not a driver key either (no restart, no replay check), with or without debug keys or a paused run.
		expect(driverKeyAction("M", true, true)).toBe(undefined);
		expect(driverKeyAction("DPadLeft", true, true)).toBe(undefined);
	});

	it("isMapInput follows the layout; the map keys are polled and sunk like the other game keys", () => {
		expect([isMapInput("M"), isMapInput("DPadLeft"), isMapInput("B"), isMapInput("Semicolon")]).toEqual([
			true,
			true,
			false,
			false,
		]);
		let b = ok(rebind(DEFAULT_BINDINGS, "kbm", "map", 0, "G"));
		b = ok(rebind(b, "kbm", "map", 1, "MouseButton3"));
		b = ok(rebind(b, "pad", "map", 0, "ButtonL3"));
		expect([isMapInput("M", b), isMapInput("G", b), isMapInput("MouseButton3", b)]).toEqual([false, true, true]);
		expect([isMapInput("DPadLeft", b), isMapInput("ButtonL3", b)]).toEqual([false, true]);
		expect(mapHint(b)).toEqual({ keyboard: "G", gamepad: "LS" });
		expect(boundKeyNames().includes("M")).toBe(true);
		expect(boundPadButtonNames().includes("DPadLeft")).toBe(true);
		expect(boundKeyNames(b).includes("G")).toBe(true);
		expect(boundMouseButtonNames(b).includes("MouseButton3")).toBe(true);
	});

	it("an old stored override set without `map` reads the defaults M / D-pad left", () => {
		const old = { kbm: { fire: ["G"], swap: ["C"] }, pad: { swap: "ButtonX", skill3: "ButtonY" } };
		const b = applyControlsOverrides(DEFAULT_BINDINGS, old);
		expect(inputsFor(b, "kbm", "map")).toEqual(["M"]);
		expect(inputsFor(b, "pad", "map")).toEqual(["DPadLeft"]);
		expect(isValidBindings(b)).toBe(true);
		expect(sanitizeControlsOverrides(old)).toEqual(old);
		// An old override that took D-pad left (free before the map) keeps it: the new map yields and takes the input
		// the overriding action vacated (flask's D-pad up).
		const tookLeft = applyControlsOverrides(DEFAULT_BINDINGS, { pad: { flask: "DPadLeft" } });
		expect([tookLeft.pad.flask, tookLeft.pad.map]).toEqual(["DPadLeft", "DPadUp"]);
		expect(sanitizeControlsOverrides({ pad: { flask: "DPadLeft" } })).toEqual({
			pad: { flask: "DPadLeft", map: "DPadUp" },
		});
		expect(isValidBindings(tookLeft)).toBe(true);
	});

	it("migration: an old D-pad left override never cascades (the map yields; vacated input taken -> L3)", () => {
		// skill4 took D-pad left and skill3 took skill4's D-pad right: before the yield rule skill4 fell back to D-pad
		// right and knocked skill3 out too. Now both keep theirs; the vacated D-pad right is taken, so the map goes to
		// the first free fallback, the left stick click.
		const old = { pad: { skill4: "DPadLeft", skill3: "DPadRight" } };
		const b = applyControlsOverrides(DEFAULT_BINDINGS, old);
		expect([b.pad.skill4, b.pad.skill3, b.pad.map]).toEqual(["DPadLeft", "DPadRight", "ButtonL3"]);
		expect(isValidBindings(b)).toBe(true);
		expect(sanitizeControlsOverrides(old)).toEqual({
			pad: { skill3: "DPadRight", skill4: "DPadLeft", map: "ButtonL3" },
		});
		// Both stick clicks taken too: R3.
		const busy = { pad: { skill4: "DPadLeft", skill3: "DPadRight", skill2: "ButtonL3" } };
		expect(applyControlsOverrides(DEFAULT_BINDINGS, busy).pad.map).toBe("ButtonR3");
		// The rule is idempotent: the sanitized doc sanitizes to itself.
		const clean = sanitizeControlsOverrides(old);
		expect(sanitizeControlsOverrides(clean)).toEqual(clean);
		// A stored map override is the player's choice: no yield (D-pad left is free then, so skill4 keeps it).
		expect(sanitizeControlsOverrides({ pad: { map: "ButtonL3", skill4: "DPadLeft" } })).toEqual({
			pad: { skill4: "DPadLeft", map: "ButtonL3" },
		});
		// Valid current bindings are untouched (a rebind onto D-pad left swaps, so the map has an override then).
		const swapped = ok(rebind(DEFAULT_BINDINGS, "pad", "skill4", 0, "DPadLeft"));
		expect(sanitizeControlsOverrides({ kbm: swapped.kbm, pad: swapped.pad })).toEqual({
			pad: { skill4: "DPadLeft", map: "DPadRight" },
		});
	});

	it("migration: a stored Semicolon (reserved since MD11) is dropped without cascading", () => {
		// Only slot Semicolon: skill1 yields. Its default One is skill2's stored override, so skill1 takes skill2's
		// vacated Two instead of knocking skill2 out (before: skill1 fell back to One and skill2 was dropped too).
		const old = { kbm: { skill1: ["Semicolon"], skill2: ["One"] } };
		const b = applyControlsOverrides(DEFAULT_BINDINGS, old);
		expect([b.kbm.skill1, b.kbm.skill2]).toEqual([["Two"], ["One"]]);
		expect(isValidBindings(b)).toBe(true);
		expect(sanitizeControlsOverrides(old)).toEqual({ kbm: { skill1: ["Two"], skill2: ["One"] } });
		// Alone it just falls back to the default (nothing clashes).
		expect(sanitizeControlsOverrides({ kbm: { skill1: ["Semicolon"] } })).toEqual({});
		// Semicolon in one slot of two: the other slot is kept (moved up to primary).
		expect(sanitizeControlsOverrides({ kbm: { skill1: ["Semicolon", "Five"] } })).toEqual({
			kbm: { skill1: ["Five"] },
		});
		expect(sanitizeControlsOverrides({ kbm: { skill1: ["Five", "Semicolon"] } })).toEqual({
			kbm: { skill1: ["Five"] },
		});
		// The vacated input taken as well: the first free fallback letter.
		const busy = { kbm: { skill1: ["Semicolon"], skill2: ["One"], skill3: ["Two"] } };
		expect(applyControlsOverrides(DEFAULT_BINDINGS, busy).kbm.skill1).toEqual(["G"]);
		// A new binding onto Semicolon is still refused.
		expect(refusal(rebind(DEFAULT_BINDINGS, "kbm", "skill1", 0, "Semicolon"))).toBe("reserved");
	});

	it("the debug boost drop moved off M to Semicolon, which is reserved; M is bindable again", () => {
		expect(FIXED_INPUTS.debugDrop).toBe("Semicolon");
		expect(RESERVED_KBM_INPUTS.includes("Semicolon")).toBe(true);
		expect(RESERVED_KBM_INPUTS.includes("M")).toBe(false);
		expect(KEY_BINDINGS.get("Semicolon")).toBe(DEBUG_DROP_BUTTON);
		expect(refusal(rebind(DEFAULT_BINDINGS, "kbm", "fire", 0, "Semicolon"))).toBe("reserved");
		expect(refusal(rebind(DEFAULT_BINDINGS, "kbm", "map", 0, "Semicolon"))).toBe("reserved");
		// M taken by another action swaps with the map.
		const r = rebind(DEFAULT_BINDINGS, "kbm", "flask", 0, "M");
		expect(r.ok && r.swappedWith).toEqual({ action: "map", slot: 0, input: "F" });
		expect(inputLabel("Semicolon")).toBe(";");
	});
});

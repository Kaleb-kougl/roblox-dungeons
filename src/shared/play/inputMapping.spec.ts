// Port of project-kaleb-vale src/sim/devices.test.ts @ 42897e2 (the pure mapping), with the Roblox remaps
// (Tab -> E, Escape -> P), Enum.KeyCode names, and Roblox's up-positive thumbstick Y.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	AXIS_MAX,
	Button,
	DEBUG_DROP_BUTTON,
	DEBUG_FLOOR_BUTTON,
	DRAFT_COLUMN_CENTRE,
	DRAFT_COLUMN_LEFT,
	DRAFT_COLUMN_RIGHT,
	DRAFT_SCREEN_RIGHT_X,
	DRAFT_SCREEN_RIGHT_Z,
	SHRINE_BUTTON,
	SQRT1_2,
	draftColumn,
	quantizeInput,
} from "shared/sim";
import { LEADERBOARD_KEY, SETTINGS_KEY } from "shared/view/hud";
import {
	ALL_DEBUG_BUTTONS,
	DEBUG_BUTTONS,
	KEY_BINDINGS,
	MOVE_KEYS,
	REPLAY_CHECK_KEYS,
	RESTART_KEY,
	InputDeviceTracker,
	applyRadialDeadzone,
	boundKeyNames,
	boundPadButtonNames,
	CLOSED_RESTART_WINDOW,
	driverKeyAction,
	keyboardMoveVector,
	keyDevice,
	mapDevicesToInput,
	maskDebugButtons,
	screenToWorld,
	type DeviceSnapshot,
	type GamepadSnapshot,
	type RestartWindow,
	type TouchSnapshot,
} from "shared/play";

const S = SQRT1_2;
const Q = math.round(S * AXIS_MAX); // 707

interface SnapOptions {
	keys?: string[];
	mouse?: string[];
	pad?: GamepadSnapshot;
	aimDevice?: DeviceSnapshot["aimDevice"];
	pointerAimX?: number;
	pointerAimZ?: number;
	touch?: TouchSnapshot;
}

function snap(o: SnapOptions = {}): DeviceSnapshot {
	return {
		kbm: { keys: new Set(o.keys ?? []), mouseButtons: new Set(o.mouse ?? []) },
		pad: o.pad,
		aimDevice: o.aimDevice ?? "none",
		pointerAimX: o.pointerAimX ?? 0,
		pointerAimZ: o.pointerAimZ ?? 0,
		touch: o.touch,
	};
}

function pad(
	sticks: [number, number, number, number] = [0, 0, 0, 0],
	buttons: string[] = [],
	triggers: [number, number] = [0, 0],
): GamepadSnapshot {
	return {
		leftX: sticks[0],
		leftY: sticks[1],
		rightX: sticks[2],
		rightY: sticks[3],
		leftTrigger: triggers[0],
		rightTrigger: triggers[1],
		buttons: new Set(buttons),
	};
}

function hypot(x: number, y: number): number {
	return math.sqrt(x * x + y * y);
}

describe("keyboard", () => {
	it("normalizes diagonals to unit length", () => {
		const v = keyboardMoveVector(new Set(["W", "D"]));
		expect(hypot(v.x, v.y)).toBeCloseTo(1, 12);
		expect(v.x).toBeCloseTo(S, 12);
		expect(v.y).toBeCloseTo(S, 12);
		expect(keyboardMoveVector(new Set(["W", "S"]))).toEqual({ x: 0, y: 0 });
	});

	it('rotates "up" (W) by the camera yaw to world (-1, -1)/sqrt2', () => {
		const f = mapDevicesToInput(snap({ keys: ["W"] }));
		expect(math.abs(f.moveX + Q)).toBeLessThanOrEqual(1);
		expect(math.abs(f.moveZ + Q)).toBeLessThanOrEqual(1);
		const w = screenToWorld(0, 1);
		expect(w.x).toBeCloseTo(-S, 12);
		expect(w.z).toBeCloseTo(-S, 12);
	});

	it("maps the other directions consistently (right = (1, -1)/sqrt2, down = (1, 1)/sqrt2)", () => {
		const d = mapDevicesToInput(snap({ keys: ["D"] }));
		expect([d.moveX, d.moveZ]).toEqual([Q, -Q]);
		const s = mapDevicesToInput(snap({ keys: ["S"] }));
		expect([s.moveX, s.moveZ]).toEqual([Q, Q]);
		const wd = mapDevicesToInput(snap({ keys: ["W", "D"] }));
		expect(wd.moveX).toBe(0);
		expect(wd.moveZ).toBe(-AXIS_MAX);
	});

	it("arrow keys move like WASD", () => {
		const a = mapDevicesToInput(snap({ keys: ["Up", "Right"] }));
		const b = mapDevicesToInput(snap({ keys: ["W", "D"] }));
		expect([a.moveX, a.moveZ]).toEqual([b.moveX, b.moveZ]);
	});

	it("maps keyboard and mouse buttons with the Roblox remaps (E swap, P pause)", () => {
		const f = mapDevicesToInput(
			snap({ keys: ["Space", "Q", "One", "Four", "F", "E", "P"], mouse: ["MouseButton1", "MouseButton2"] }),
		);
		expect(f.buttons).toBe(
			Button.ROLL +
				Button.EMBER +
				Button.SKILL1 +
				Button.SKILL4 +
				Button.FLASK +
				Button.SWAP +
				Button.PAUSE +
				Button.FIRE +
				Button.ALT,
		);
	});

	it("Tab and Escape are not bound (Roblox reserves them)", () => {
		expect(mapDevicesToInput(snap({ keys: ["Tab", "Escape"] })).buttons).toBe(0);
	});
});

describe("gamepad", () => {
	it("applies a 0.2 radial deadzone with rescale", () => {
		expect(applyRadialDeadzone(0.15, 0.1)).toEqual({ x: 0, y: 0 });
		expect(applyRadialDeadzone(0.2, 0)).toEqual({ x: 0, y: 0 });
		expect(applyRadialDeadzone(0.6, 0).x).toBeCloseTo(0.5, 12);
		expect(applyRadialDeadzone(1, 0).x).toBeCloseTo(1, 12);
		const d = applyRadialDeadzone(0.6, 0.6); // radial, not per-axis
		expect(d.x).toBeCloseTo(d.y, 12);
		expect(hypot(d.x, d.y)).toBeLessThanOrEqual(1);
		expect(mapDevicesToInput(snap({ pad: pad([0.1, 0.15, 0, 0]) })).moveX).toBe(0);
	});

	it("left stick up (Roblox: +Y) matches W", () => {
		const f = mapDevicesToInput(snap({ pad: pad([0, 1, 0, 0]) }));
		expect([f.moveX, f.moveZ]).toEqual([-Q, -Q]);
	});

	it("keyboard + stick are clamped to unit length", () => {
		const f = mapDevicesToInput(snap({ keys: ["W"], pad: pad([0, 1, 0, 0]) }));
		expect(hypot(f.moveX, f.moveZ)).toBeLessThanOrEqual(AXIS_MAX + 1);
	});

	it("Y swaps weapons; dpad left is unbound; dpad right is skill 4", () => {
		expect(mapDevicesToInput(snap({ pad: pad(undefined, ["ButtonY"]) })).buttons).toBe(Button.SWAP);
		expect(mapDevicesToInput(snap({ pad: pad(undefined, ["DPadLeft"]) })).buttons).toBe(0);
		expect(mapDevicesToInput(snap({ pad: pad(undefined, ["DPadRight"]) })).buttons).toBe(Button.SKILL4);
	});

	it("maps pad buttons (web bindings); triggers by analog value or as held buttons", () => {
		const f = mapDevicesToInput(
			snap({
				pad: pad(
					undefined,
					[
						"ButtonL1",
						"ButtonR1",
						"ButtonA",
						"ButtonB",
						"ButtonX",
						"ButtonY",
						"DPadUp",
						"DPadRight",
						"ButtonStart",
					],
					[0.3, 0.8],
				),
			}),
		);
		expect(bit32.band(f.buttons, Button.FIRE)).toBe(Button.FIRE);
		expect(bit32.band(f.buttons, Button.ALT)).toBe(0); // LT at 0.3 is below the threshold
		expect(f.buttons).toBe(
			Button.FIRE +
				Button.ROLL +
				Button.EMBER +
				Button.SKILL1 +
				Button.SKILL2 +
				Button.SKILL3 +
				Button.SKILL4 +
				Button.FLASK +
				Button.SWAP +
				Button.PAUSE,
		);
		expect(mapDevicesToInput(snap({ pad: pad(undefined, ["ButtonL2"]) })).buttons).toBe(Button.ALT);
	});
});

describe("aim", () => {
	it("mouse aim is the normalized world pointer vector", () => {
		const f = mapDevicesToInput(snap({ aimDevice: "mouse", pointerAimX: 3, pointerAimZ: -4 }));
		expect([f.aimX, f.aimZ]).toEqual([600, -800]);
	});

	it("right stick aim is rotated to world, zero inside the deadzone", () => {
		const f = mapDevicesToInput(snap({ aimDevice: "stick", pad: pad([0, 0, 0, 1]) }));
		expect([f.aimX, f.aimZ]).toEqual([-Q, -Q]);
		const g = mapDevicesToInput(snap({ aimDevice: "stick", pad: pad([0, 0, 0.1, 0.1]) }));
		expect([g.aimX, g.aimZ]).toEqual([0, 0]);
	});

	it("no aim device -> zero aim; NaN pointer -> zero aim", () => {
		expect(mapDevicesToInput(snap({ pointerAimX: 3, pointerAimZ: 4 })).aimX).toBe(0);
		const f = mapDevicesToInput(snap({ aimDevice: "mouse", pointerAimX: 0 / 0, pointerAimZ: 1 }));
		expect([f.aimX, f.aimZ]).toEqual([0, 1000]);
	});
});

describe("InputDeviceTracker (web InputSampler's device logic)", () => {
	it("the latest aim device wins; releasing the stick keeps stick aim until the mouse moves", () => {
		const t = new InputDeviceTracker();
		expect(t.aimDevice).toBe("none");
		t.mouseMoved();
		expect(t.aimDevice).toBe("mouse");
		t.padSampled(pad([0, 0, 1, 0]));
		expect(t.aimDevice).toBe("stick");
		t.padSampled(pad());
		expect(t.aimDevice).toBe("stick");
		t.mouseMoved();
		expect(t.aimDevice).toBe("mouse");
		t.padSampled(pad([0, 0, 0.5, 0]));
		t.mouseClicked();
		expect(t.aimDevice).toBe("mouse");
	});

	it("tracks the last-used device for UI hints: an active pad -> gamepad, a key or click -> keyboard", () => {
		const t = new InputDeviceTracker();
		expect(t.device).toBe("keyboard");
		t.padSampled(pad()); // connected pad at rest
		expect(t.device).toBe("keyboard");
		t.padSampled(pad(undefined, ["ButtonA"]));
		expect(t.device).toBe("gamepad");
		t.keyPressed();
		expect(t.device).toBe("keyboard");
		t.padSampled(pad([0.5, 0, 0, 0]));
		expect(t.device).toBe("gamepad");
		t.mouseClicked();
		expect(t.device).toBe("keyboard");
	});

	it("a pad press outside a sample (the menus) makes the gamepad the device, the aim device unchanged", () => {
		const t = new InputDeviceTracker();
		t.mouseMoved();
		t.padPressed();
		expect(t.device).toBe("gamepad");
		expect(t.aimDevice).toBe("mouse");
		t.keyPressed();
		expect(t.device).toBe("keyboard");
	});
});

describe("debug gating and driver keys", () => {
	it("strips K / J bits unless debug keys are on", () => {
		const all = bit32.bor(Button.FIRE, DEBUG_BUTTONS);
		expect(maskDebugButtons(all, false)).toBe(Button.FIRE);
		expect(maskDebugButtons(all, true)).toBe(all);
		const f = mapDevicesToInput(snap({ keys: ["K", "J"] }));
		expect(f.buttons).toBe(DEBUG_BUTTONS);
	});

	it("strips the port's debug bits too: the floor skip (N) and the boost drop (Semicolon, docs/BOOSTS.md B6)", () => {
		const f = mapDevicesToInput(snap({ keys: ["N", "Semicolon"] }));
		expect(f.buttons).toBe(bit32.bor(DEBUG_FLOOR_BUTTON, DEBUG_DROP_BUTTON));
		expect(maskDebugButtons(bit32.bor(Button.FIRE, f.buttons), false)).toBe(Button.FIRE);
		expect(bit32.band(ALL_DEBUG_BUTTONS, DEBUG_DROP_BUTTON)).toBe(DEBUG_DROP_BUTTON);
	});

	it("R restarts once the run is over or in a dev run; the pad restart when over or paused; F8 only with debug keys", () => {
		const playing: RestartWindow = { over: false, paused: false, devRun: false };
		const paused: RestartWindow = { over: false, paused: true, devRun: false };
		const over: RestartWindow = { over: true, paused: false, devRun: false };
		const dev: RestartWindow = { over: false, paused: false, devRun: true };
		expect(driverKeyAction("R", false, playing)).toBe(undefined);
		expect(driverKeyAction("R", false, paused)).toBe(undefined);
		expect(driverKeyAction("R", false, over)).toBe("reset");
		expect(driverKeyAction("R", false, dev)).toBe("reset");
		expect(driverKeyAction("R", false, CLOSED_RESTART_WINDOW)).toBe(undefined);
		expect(driverKeyAction("DPadDown", false, playing)).toBe(undefined);
		expect(driverKeyAction("DPadDown", false, dev)).toBe(undefined);
		expect(driverKeyAction("DPadDown", false, paused)).toBe("reset");
		expect(driverKeyAction("DPadDown", false, over)).toBe("reset");
		expect(driverKeyAction("F8", false, playing)).toBe(undefined);
		expect(driverKeyAction("F8", true, playing)).toBe("replayCheck");
		expect(driverKeyAction("L", true, playing)).toBe("replayCheck");
		expect(driverKeyAction("L", false, playing)).toBe(undefined);
		expect(driverKeyAction("W", true, over)).toBe(undefined);
	});

	it("lists every key and pad button it reads (for polling and sinking)", () => {
		const keys = boundKeyNames();
		for (const k of ["W", "A", "S", "D", "Space", "E", "P", "R", "F8"]) expect(keys.includes(k)).toBe(true);
		expect(keys.includes("Tab")).toBe(false);
		const buttons = boundPadButtonNames();
		for (const b of ["ButtonR2", "ButtonY", "ButtonStart", "DPadDown"]) expect(buttons.includes(b)).toBe(true);
	});
});

describe("menu keys vs game bindings (slice)", () => {
	it("N is the endless debug floor skip, Semicolon the debug boost drop; the leaderboard key clashes with no other binding", () => {
		expect(KEY_BINDINGS.get("N")).toBe(DEBUG_FLOOR_BUTTON);
		expect(KEY_BINDINGS.get("Semicolon")).toBe(DEBUG_DROP_BUTTON);
		expect(KEY_BINDINGS.get("M")).toBe(undefined); // the full map toggle (docs/MINIMAP.md M9): no sim bits
		const taken = new Set<string>([RESTART_KEY, SETTINGS_KEY, ...REPLAY_CHECK_KEYS]);
		for (const [name] of KEY_BINDINGS) taken.add(name);
		for (const keys of [MOVE_KEYS.up, MOVE_KEYS.down, MOVE_KEYS.left, MOVE_KEYS.right]) {
			for (const k of keys) taken.add(k);
		}
		expect(taken.has(LEADERBOARD_KEY)).toBe(false);
	});
});

describe("M2 boon draft and curse shrine controls", () => {
	it("the sim's draft axis is the camera's screen-right in world space (D / A / W / S pick right / left / centre)", () => {
		const right = screenToWorld(1, 0);
		expect(DRAFT_SCREEN_RIGHT_X).toBeCloseTo(right.x, 12);
		expect(DRAFT_SCREEN_RIGHT_Z).toBeCloseTo(right.z, 12);
		const column = (keys: string[]) => draftColumn(mapDevicesToInput(snap({ keys })));
		expect([column(["D"]), column(["A"]), column(["W"]), column(["S"]), column([])]).toEqual([
			DRAFT_COLUMN_RIGHT,
			DRAFT_COLUMN_LEFT,
			DRAFT_COLUMN_CENTRE,
			DRAFT_COLUMN_CENTRE,
			DRAFT_COLUMN_CENTRE,
		]);
		// Diagonals keep their horizontal side (0.707 of full deflection, past the 0.5 dead zone).
		expect([column(["W", "D"]), column(["S", "A"])]).toEqual([DRAFT_COLUMN_RIGHT, DRAFT_COLUMN_LEFT]);
	});

	it("the shrine's button (SKILL1) is key 1 and gamepad A, and confirm is the attack (FIRE)", () => {
		expect(KEY_BINDINGS.get("One")).toBe(SHRINE_BUTTON);
		expect(mapDevicesToInput(snap({ keys: ["One"] })).buttons).toBe(SHRINE_BUTTON);
		expect(mapDevicesToInput(snap({ mouse: ["MouseButton1"] })).buttons).toBe(Button.FIRE);
	});
});

describe("touch as a device (MB4)", () => {
	it("a touch move is the same frame as a left stick pushed fully up, bit for bit", () => {
		const t: TouchSnapshot = { moveX: 0, moveY: 1, aimX: 0, aimZ: 0, buttons: 0 };
		expect(mapDevicesToInput(snap({ touch: t }))).toEqual(mapDevicesToInput(snap({ pad: pad([0, 1, 0, 0]) })));
	});

	it("touch aim is world space and normalized when touch is the aim device", () => {
		const t: TouchSnapshot = { moveX: 0, moveY: 0, aimX: 3, aimZ: 4, buttons: 0 };
		const f = mapDevicesToInput(snap({ aimDevice: "touch", touch: t }));
		const q = quantizeInput(0, 0, 0.6, 0.8, 0);
		expect([f.aimX, f.aimZ]).toEqual([q.aimX, q.aimZ]);
		expect(mapDevicesToInput(snap({ touch: t })).aimX).toBe(0); // not the aim device: no aim
	});

	it("touch buttons are ORed with the mouse's", () => {
		const t: TouchSnapshot = { moveX: 0, moveY: 0, aimX: 0, aimZ: 0, buttons: Button.ROLL };
		expect(mapDevicesToInput(snap({ mouse: ["MouseButton1"], touch: t })).buttons).toBe(Button.ROLL + Button.FIRE);
	});

	it("a snapshot without touch is unchanged (the mouse aim case with touch: undefined)", () => {
		const f = mapDevicesToInput({
			...snap({ aimDevice: "mouse", pointerAimX: 3, pointerAimZ: -4 }),
			touch: undefined,
		});
		expect([f.aimX, f.aimZ]).toEqual([600, -800]);
	});

	it("the tracker: touched() is the touch device, touchAimed() the touch aim; keys and the mouse take them back", () => {
		const t = new InputDeviceTracker();
		t.touched();
		expect(t.device).toBe("touch");
		t.touchAimed();
		expect(t.aimDevice).toBe("touch");
		t.keyPressed();
		expect(t.device).toBe("keyboard");
		t.mouseMoved();
		expect(t.aimDevice).toBe("mouse");
	});

	it("keyDevice reads the keyboard's hint tables for touch", () => {
		expect(keyDevice("touch")).toBe("keyboard");
		expect(keyDevice("keyboard")).toBe("keyboard");
		expect(keyDevice("gamepad")).toBe("gamepad");
	});
});

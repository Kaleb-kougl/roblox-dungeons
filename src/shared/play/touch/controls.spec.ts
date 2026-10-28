// Headless spec for the touch state machine (docs/MOBILE_IMPL.md MB3). Frames are 1/60 s; the stick radius is 100 px.
import { describe, expect, it } from "@rbxts/jest-globals";
import { TOUCH } from "shared/config";
import { Button, DRAFT_COLUMN_CENTRE, DRAFT_COLUMN_LEFT, DRAFT_COLUMN_RIGHT } from "shared/sim";
import { screenToWorld } from "../inputMapping";
import {
	TOUCH_CONTROL_BITS,
	TouchControls,
	draftScreenX,
	shapeMove,
	stickVector,
	type TouchFrameEnv,
} from "./controls";

const DT = 1 / 60;
const RADIUS = 100;

function makeEnv(over: Partial<TouchFrameEnv> = {}): TouchFrameEnv {
	return {
		dt: DT,
		stickRadiusPx: RADIUS,
		autoTarget: true,
		facingX: 0,
		facingZ: 1,
		autoAim: () => undefined,
		draftOpen: false,
		draftReady: false,
		...over,
	};
}

function frames(c: TouchControls, env: TouchFrameEnv, n: number) {
	let last = c.frame(env);
	for (let i = 1; i < n; i++) last = c.frame(env);
	return last;
}

describe("stickVector", () => {
	it("maps a drag to screen right / up, clamped to length 1", () => {
		const up = stickVector(100, 100, 100, 50, RADIUS);
		expect(up.x).toBeCloseTo(0);
		expect(up.y).toBeCloseTo(0.5);
		const far = stickVector(100, 100, 100, -200, RADIUS);
		expect(far.x).toBeCloseTo(0);
		expect(far.y).toBeCloseTo(1);
	});

	it("gives no vector for a radius of 0", () => {
		const v = stickVector(0, 0, 50, 50, 0);
		expect(v.x).toBe(0);
		expect(v.y).toBe(0);
	});
});

describe("shapeMove", () => {
	it("walks nowhere inside the deadzone", () => {
		const v = shapeMove({ x: TOUCH.move.deadzone * 0.5, y: 0 });
		expect(v.x).toBe(0);
		expect(v.y).toBe(0);
	});

	it("reaches full speed at runFraction and rises monotonically between", () => {
		const full = shapeMove({ x: TOUCH.move.runFraction, y: 0 });
		expect(full.x).toBeCloseTo(1);
		const a = shapeMove({ x: 0.2, y: 0 }).x;
		const b = shapeMove({ x: 0.4, y: 0 }).x;
		const c = shapeMove({ x: 0.6, y: 0 }).x;
		expect(a < b).toBe(true);
		expect(b < c).toBe(true);
		expect(c < 1).toBe(true);
	});
});

describe("draftScreenX", () => {
	it("maps the card columns to a screen axis of -1, 0, +1", () => {
		expect(draftScreenX(DRAFT_COLUMN_LEFT)).toBe(-1);
		expect(draftScreenX(DRAFT_COLUMN_CENTRE)).toBe(0);
		expect(draftScreenX(DRAFT_COLUMN_RIGHT)).toBe(1);
	});
});

describe("TouchControls", () => {
	it("walks with the move stick and stops when it lifts", () => {
		const c = new TouchControls();
		const e = makeEnv();
		c.begin(1, "move", 100, 100);
		c.move(1, 100, 30);
		const held = c.frame(e);
		expect(held.moveY > 0).toBe(true);
		expect(held.moveX).toBeCloseTo(0);
		c.end(1);
		const lifted = c.frame(e);
		expect(lifted.moveX).toBe(0);
		expect(lifted.moveY).toBe(0);
	});

	it("keeps a quick tap's button for minPressSec after the lift", () => {
		const c = new TouchControls();
		const e = makeEnv();
		c.begin(2, "roll", 0, 0);
		c.end(2);
		expect(c.frame(e).buttons).toBe(Button.ROLL);
		expect(frames(c, e, 5).buttons).toBe(0);
	});

	it("ignores a second press on a control that a live finger holds", () => {
		const c = new TouchControls();
		c.begin(1, "attack", 0, 0);
		c.begin(2, "attack", 50, 50);
		const v = c.stickView("attack");
		expect(v).toBeDefined();
		expect(v!.x0).toBe(0);
	});

	it("aims at the auto-target from the centre ring, and at the facing when the setting is off", () => {
		const c = new TouchControls();
		c.begin(1, "attack", 100, 100);
		const on = c.frame(makeEnv({ autoAim: () => ({ x: 3, z: 4 }) }));
		expect(on.aimX).toBe(3);
		expect(on.aimZ).toBe(4);
		expect(on.buttons).toBe(Button.FIRE);
		expect(c.lastAimWasAuto()).toBe(true);

		const off = c.frame(makeEnv({ autoTarget: false, autoAim: () => ({ x: 3, z: 4 }) }));
		expect(off.aimX).toBe(0);
		expect(off.aimZ).toBe(1);
		expect(c.lastAimWasAuto()).toBe(false);
	});

	it("stays on the manual aim once the stick leaves the ring, even back in the centre", () => {
		const c = new TouchControls();
		const e = makeEnv();
		c.begin(1, "attack", 100, 100);
		c.move(1, 160, 100);
		const out = c.frame(e);
		const w = screenToWorld(1, 0);
		expect(out.aimX).toBeCloseTo(w.x);
		expect(out.aimZ).toBeCloseTo(w.z);
		c.move(1, 100, 100);
		const back = c.frame(e);
		expect(back.aimX).toBeCloseTo(w.x);
		expect(back.aimZ).toBeCloseTo(w.z);
		expect(c.lastAimWasAuto()).toBe(false);
	});

	it("holds the last aim for aimLatchSec after the lift, then gives no aim", () => {
		const c = new TouchControls();
		const e = makeEnv();
		c.begin(1, "attack", 100, 100);
		c.move(1, 160, 100);
		c.frame(e);
		c.end(1);
		frames(c, e, 6);
		const w = screenToWorld(1, 0);
		const held = c.frame(e);
		expect(held.aimX).toBeCloseTo(w.x);
		expect(held.aimZ).toBeCloseTo(w.z);
		const spent = frames(c, e, 30);
		expect(spent.aimX).toBe(0);
		expect(spent.aimZ).toBe(0);
	});

	it("lets the most recent of Attack / Alt aim, and sets both button bits", () => {
		const c = new TouchControls();
		const e = makeEnv({ autoAim: () => ({ x: 3, z: 4 }) });
		c.begin(1, "attack", 100, 100);
		c.move(1, 40, 100);
		c.begin(2, "alt", 100, 100);
		const s = c.frame(e);
		expect(s.buttons).toBe(Button.FIRE | Button.ALT);
		expect(s.aimX).toBe(3);
		expect(s.aimZ).toBe(4);
	});

	it("maps the other action controls to their sim bits", () => {
		expect(TOUCH_CONTROL_BITS.get("spectateNext")).toBe(Button.FIRE);
		expect(TOUCH_CONTROL_BITS.get("spectatePrev")).toBe(Button.ALT);
		expect(TOUCH_CONTROL_BITS.get("shrine")).toBe(Button.SKILL1);
		expect(TOUCH_CONTROL_BITS.has("move")).toBe(false);
	});

	it("holds the stick toward a queued draft column, and pulses FIRE on a ready card", () => {
		const c = new TouchControls();
		c.queueDraftPick(DRAFT_COLUMN_LEFT);
		const waiting = c.frame(makeEnv({ draftOpen: true, draftReady: false }));
		expect(waiting.moveX).toBeCloseTo(-1);
		expect(waiting.buttons).toBe(0);

		const first = c.frame(makeEnv({ draftOpen: true, draftReady: true }));
		expect(first.buttons & Button.FIRE).toBe(Button.FIRE);
		const pause = frames(c, makeEnv({ draftOpen: true, draftReady: true }), 14);
		expect(pause.buttons & Button.FIRE).toBe(0);
		let fired = false;
		for (let i = 0; i < 40; i++) {
			if ((c.frame(makeEnv({ draftOpen: true, draftReady: true })).buttons & Button.FIRE) !== 0) fired = true;
		}
		expect(fired).toBe(true);
	});

	it("drops the draft pick once the draft closes", () => {
		const c = new TouchControls();
		c.queueDraftPick(DRAFT_COLUMN_RIGHT);
		expect(c.hasDraftPick()).toBe(true);
		c.frame(makeEnv({ draftOpen: false }));
		expect(c.hasDraftPick()).toBe(false);
	});

	it("reset drops the fingers and the aim latch but keeps a queued draft pick", () => {
		const c = new TouchControls();
		const e = makeEnv();
		c.begin(1, "attack", 100, 100);
		c.move(1, 160, 100);
		c.frame(e);
		c.queueDraftPick(DRAFT_COLUMN_LEFT);
		c.reset();
		expect(c.hasDraftPick()).toBe(true);
		expect(c.isHeld("attack")).toBe(false);
		expect(c.stickView("attack")).toBeUndefined();
		const s = c.frame(e);
		expect(s.buttons).toBe(0);
		expect(s.aimX).toBe(0);
		expect(s.aimZ).toBe(0);
	});
});

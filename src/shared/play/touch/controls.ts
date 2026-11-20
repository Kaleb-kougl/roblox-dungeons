/**
 * Touch controls state machine (docs/MOBILE_IMPL.md MB3, docs/MOBILE.md): fingers in, one TouchSnapshot per frame out.
 * Pure: no Roblox API, so controls.spec.ts runs it headlessly. The client's TouchControlsController feeds it touch
 * events and the frame environment, and the InputController merges its snapshot with the other devices.
 *
 * @module
 */
import { TOUCH } from "shared/config";
import { Button, DRAFT_COLUMN_CENTRE } from "shared/sim";
import { clampUnit, screenToWorld, type Vec2 } from "../inputMapping";

export type TouchControlId =
	| "move"
	| "attack"
	| "alt"
	| "roll"
	| "ember"
	| "flask"
	| "swap"
	| "shrine"
	| "spectateNext"
	| "spectatePrev";

/** Sim button bit per control (move: none). Spectate's Next / Prev are FIRE / ALT: SimController's spectateCommand reads them. */
export const TOUCH_CONTROL_BITS: ReadonlyMap<TouchControlId, number> = new Map<TouchControlId, number>([
	["attack", Button.FIRE],
	["alt", Button.ALT],
	["roll", Button.ROLL],
	["ember", Button.EMBER],
	["flask", Button.FLASK],
	["swap", Button.SWAP],
	["shrine", Button.SKILL1],
	["spectateNext", Button.FIRE],
	["spectatePrev", Button.ALT],
]);

/** One frame of touch input: move screen-relative (right, up), aim in WORLD space (x, z; (0, 0) = none), button bits. */
export interface TouchSnapshot {
	readonly moveX: number;
	readonly moveY: number;
	readonly aimX: number;
	readonly aimZ: number;
	readonly buttons: number;
}

export interface WorldVec {
	readonly x: number;
	readonly z: number;
}

export interface TouchFrameEnv {
	/** Seconds since the previous frame() (already clamped by the caller). */
	readonly dt: number;
	readonly stickRadiusPx: number;
	/** The auto-target setting (DisplaySettings.touchAutoTarget). */
	readonly autoTarget: boolean;
	/** The player's facing (world), used when there is no auto-target. */
	readonly facingX: number;
	readonly facingZ: number;
	/** World vector player -> auto-target, or undefined. Called at most once per frame, only when a centre stick needs it. */
	readonly autoAim: () => WorldVec | undefined;
	readonly draftOpen: boolean;
	readonly draftReady: boolean;
	/**
	 * The open draft's deal (shared/play touch `draftStatus(...).deal`): a queued pick belongs to the deal it was tapped
	 * on and is dropped when this changes (a re-deal keeps the draft open, so it would otherwise confirm the same column
	 * on the new cards).
	 */
	readonly draftDeal: number;
}

/** Where a stick is drawn (raw touch px): the touch-down point and the current finger. */
export interface StickView {
	readonly x0: number;
	readonly y0: number;
	readonly x: number;
	readonly y: number;
}

interface Finger {
	readonly id: number;
	readonly control: TouchControlId;
	/** Begin order (TouchControls.seq): the most recent held Attack / Alt aims. */
	readonly order: number;
	readonly x0: number;
	readonly y0: number;
	x: number;
	y: number;
	heldSec: number;
	ended: boolean;
	/** Attack / Alt: left the centre ring once; stays manual until lifted. */
	manual: boolean;
	dirX: number;
	dirY: number;
}

const NO_VEC: Vec2 = { x: 0, y: 0 };
const NO_AIM: WorldVec = { x: 0, z: 0 };

/**
 * Stick vector (screen right, up), clamped to length 1: the drag from the touch-down point, over radiusPx. Screen y grows
 * down, so a finger moved up gives a positive y. A radius of 0 or less gives no vector.
 */
export function stickVector(x0: number, y0: number, x: number, y: number, radiusPx: number): Vec2 {
	if (!(radiusPx > 0)) return NO_VEC;
	return clampUnit((x - x0) / radiusPx, (y0 - y) / radiusPx);
}

/** Radial deadzone and ramp for the move stick: below TOUCH.move.deadzone nothing; full speed at runFraction. */
export function shapeMove(v: Vec2): Vec2 {
	const len = math.sqrt(v.x * v.x + v.y * v.y);
	const deadzone = TOUCH.move.deadzone;
	if (!(len > deadzone)) return NO_VEC;
	const k = math.min(1, (len - deadzone) / (TOUCH.move.runFraction - deadzone)) / len;
	return { x: v.x * k, y: v.y * k };
}

/** Card column (DRAFT_COLUMN_LEFT / CENTRE / RIGHT) -> the draft's screen x: -1, 0, +1 (the stick's right axis). */
export function draftScreenX(column: number): number {
	return column - DRAFT_COLUMN_CENTRE;
}

/**
 * The touch state: fingers held per control, the Attack / Alt aim latch, and a queued draft pick. Fingers are kept in an
 * array (begin order), never a Map, because Luau does not iterate a Map in insertion order.
 */
export class TouchControls {
	private fingers = new Array<Finger>();
	private seq = 0;
	private latchX = 0;
	private latchZ = 0;
	private latchSec = 0;
	private draftColumn: number | undefined;
	/** The deal the queued pick was tapped on (env.draftDeal on its first frame); undefined until that frame. */
	private draftDeal: number | undefined;
	private draftPulseSec = 0;
	private draftCooldownSec = 0;
	private autoAimed = false;

	/** A finger went down on a control. Ignored if the id is already down, or a live finger holds the control. */
	begin(id: number, control: TouchControlId, x: number, y: number): void {
		if (this.byId(id) !== undefined || this.liveOn(control) !== undefined) return;
		this.seq += 1;
		this.fingers.push({
			id,
			control,
			order: this.seq,
			x0: x,
			y0: y,
			x,
			y,
			heldSec: 0,
			ended: false,
			manual: false,
			dirX: 0,
			dirY: 0,
		});
	}

	/** A finger moved. */
	move(id: number, x: number, y: number): void {
		for (const f of this.fingers) {
			if (f.id === id && !f.ended) {
				f.x = x;
				f.y = y;
			}
		}
	}

	/** A finger lifted. It keeps its button bit until TOUCH.minPressSec has passed (see frame). */
	end(id: number): void {
		for (const f of this.fingers) {
			if (f.id === id) f.ended = true;
		}
	}

	/** Drops every finger and the aim latch. A queued draft pick survives (the draft is still open). */
	reset(): void {
		this.fingers = new Array<Finger>();
		this.latchSec = 0;
		this.autoAimed = false;
	}

	/** Queues a card pick: the stick is held toward the column while the draft is open, then a FIRE pulse taps it. */
	queueDraftPick(column: number): void {
		this.draftColumn = column;
		this.draftDeal = undefined;
		this.draftPulseSec = 0;
		this.draftCooldownSec = 0;
	}

	hasDraftPick(): boolean {
		return this.draftColumn !== undefined;
	}

	/** A finger is on the control, lifted or not (a press still counts for TOUCH.minPressSec after the lift). */
	isHeld(control: TouchControlId): boolean {
		for (const f of this.fingers) {
			if (f.control === control) return true;
		}
		return false;
	}

	/** The drawn stick for a control: the first finger still down on it, or undefined. */
	stickView(control: TouchControlId): StickView | undefined {
		const f = this.liveOn(control);
		if (f === undefined) return undefined;
		return { x0: f.x0, y0: f.y0, x: f.x, y: f.y };
	}

	/** Whether the aim returned by the last frame() came from the auto-target. */
	lastAimWasAuto(): boolean {
		return this.autoAimed;
	}

	/** One sample: advances every finger by env.dt and returns this frame's snapshot. */
	frame(env: TouchFrameEnv): TouchSnapshot {
		const dt = env.dt;
		this.autoAimed = false;
		let moveX = 0;
		let moveY = 0;
		let buttons = 0;
		const aimFinger = this.latestAimFinger();
		for (const f of this.fingers) {
			f.heldSec += dt;
			buttons = bit32.bor(buttons, TOUCH_CONTROL_BITS.get(f.control) ?? 0);
			if (f.control === "move" && !f.ended) {
				const v = shapeMove(stickVector(f.x0, f.y0, f.x, f.y, env.stickRadiusPx));
				moveX = v.x;
				moveY = v.y;
			}
		}

		let aim: WorldVec | undefined;
		if (aimFinger !== undefined) aim = this.aimFrom(aimFinger, env);
		if (aim !== undefined) {
			this.latchX = aim.x;
			this.latchZ = aim.z;
			this.latchSec = TOUCH.aimLatchSec;
		} else if (this.latchSec > 0) {
			aim = { x: this.latchX, z: this.latchZ };
			this.latchSec -= dt;
		} else {
			aim = NO_AIM;
		}

		if (this.draftColumn !== undefined) {
			// The pick is spent once its deal is gone: the draft closed, or a pick re-dealt it (the draft stays open).
			if (!env.draftOpen || (this.draftDeal !== undefined && env.draftDeal !== this.draftDeal)) {
				this.draftColumn = undefined;
				this.draftDeal = undefined;
			} else {
				this.draftDeal = env.draftDeal;
			}
		}
		const column = this.draftColumn;
		if (column !== undefined) {
			moveX = draftScreenX(column);
			moveY = 0;
			if (this.draftPulseSec > 0) {
				buttons = bit32.bor(buttons, Button.FIRE);
				this.draftPulseSec -= dt;
			} else if (this.draftCooldownSec > 0) {
				this.draftCooldownSec -= dt;
			} else if (env.draftReady) {
				buttons = bit32.bor(buttons, Button.FIRE);
				this.draftPulseSec = TOUCH.draft.pulseSec - dt;
				this.draftCooldownSec = TOUCH.draft.retrySec;
			}
		}

		let i = 0;
		while (i < this.fingers.size()) {
			const f = this.fingers[i];
			if (f.ended && f.heldSec >= TOUCH.minPressSec) {
				this.fingers.remove(i);
			} else {
				i += 1;
			}
		}
		return { moveX, moveY, aimX: aim.x, aimZ: aim.z, buttons };
	}

	/** The aim a centre or manual Attack / Alt stick gives this frame (sets the manual latch and the auto flag). */
	private aimFrom(f: Finger, env: TouchFrameEnv): WorldVec {
		const v = stickVector(f.x0, f.y0, f.x, f.y, env.stickRadiusPx);
		const len = math.sqrt(v.x * v.x + v.y * v.y);
		if (len > TOUCH.action.centreFraction) {
			f.manual = true;
			f.dirX = v.x / len;
			f.dirY = v.y / len;
		}
		if (f.manual) {
			const w = screenToWorld(f.dirX, f.dirY);
			return { x: w.x, z: w.z };
		}
		if (env.autoTarget) {
			const target = env.autoAim();
			if (target !== undefined && (target.x !== 0 || target.z !== 0)) {
				this.autoAimed = true;
				return target;
			}
		}
		return { x: env.facingX, z: env.facingZ };
	}

	/** The most recently begun Attack / Alt finger (still counted until it is removed): the one that aims. */
	private latestAimFinger(): Finger | undefined {
		let best: Finger | undefined;
		for (const f of this.fingers) {
			if ((f.control === "attack" || f.control === "alt") && (best === undefined || f.order > best.order)) {
				best = f;
			}
		}
		return best;
	}

	private byId(id: number): Finger | undefined {
		for (const f of this.fingers) {
			if (f.id === id) return f;
		}
		return undefined;
	}

	private liveOn(control: TouchControlId): Finger | undefined {
		for (const f of this.fingers) {
			if (f.control === control && !f.ended) return f;
		}
		return undefined;
	}
}

/**
 * The vault's HUD toasts (docs/TREASURE.md TR8, Player experience "Finding the room" / "The lock"): which toast lines
 * the client's TreasureToastController pushes this frame into the HUD's toast store (ToastPanel, top centre).
 *
 *   floor    `hud.toast.vault` ("A vault lies on this floor", TREASURE_VIEW.toast.floorSec) once per floor (the run's
 *            counter and the state's floor), on the first frame it may show (`canShow`: the stage cover is gone, no
 *            boon draft is open, the solo run is not paused), so it never stacks on the stairwell card's new-best line
 *            and never hides under the draft. Only while the vault is still SEALED: a floor whose vault already armed
 *            (a spectator's first frame, a dev start inside a room) or that has none is settled without a toast.
 *   lock     one arm toast per armed event of the frame (`hud.toast.vaultLock.*` through lockToastLine: the solo
 *            UNTOUCHED line, the party's allowance, the SWIFT countdown at the arm; TREASURE_VIEW.toast.lockSec), on its
 *            frame: the room is live, so it never waits.
 *
 * Pure (no Instances), tested headlessly (toasts.spec.ts). Presentation only: reads the state and the frame's events.
 *
 * @module
 */
import { VaultStatus, type SimState } from "shared/sim";
import { TREASURE_VIEW } from "./config";
import type { TreasureFrameSource } from "./events";
import { TREASURE_TEXT_KEYS, lockToastLine, type TreasureToastLine } from "./text";

/** One toast to push: its line and how long it shows (seconds). */
export interface VaultToast extends TreasureToastLine {
	readonly seconds: number;
}

/** What one frame's toasts depend on. */
export interface VaultToastInput {
	/** The run's identity (the client's RunContext.counter: a restart is a new run). */
	readonly run: number;
	readonly state: Readonly<SimState>;
	/** The frame's vault events (RunView.treasure). */
	readonly frame: TreasureFrameSource;
	/** A floor toast may show now: no stage cover, no open boon draft, not paused. */
	readonly canShow: boolean;
}

/** The floor of `state` (0 without an endless floor). */
function floorOf(state: Readonly<SimState>): number {
	return state.endless !== undefined ? state.endless.floor : 0;
}

/** See the file comment. */
export class VaultToastTracker {
	private settledRun = -1;
	private settledFloor = -1;
	private readonly out: VaultToast[] = [];

	/** Forget the settled floor (a run exit): the next run's first floor is new. */
	reset(): void {
		this.settledRun = -1;
		this.settledFloor = -1;
	}

	/** This frame's toasts, in push order (a reused array: read it before the next call). */
	frame(input: VaultToastInput): ReadonlyArray<VaultToast> {
		const out = this.out;
		out.clear();
		const state = input.state;
		const floor = floorOf(state);
		if (input.run !== this.settledRun || floor !== this.settledFloor) {
			const t = state.treasure;
			const sealed = t !== undefined && t.status === VaultStatus.SEALED;
			if (!sealed) this.settle(input.run, floor);
			else if (input.canShow) {
				this.settle(input.run, floor);
				out.push({
					key: TREASURE_TEXT_KEYS.toastFloor,
					args: undefined,
					seconds: TREASURE_VIEW.toast.floorSec,
				});
			}
		}
		for (const e of input.frame.armed) {
			const line = lockToastLine(e.lock, e.allowance, e.ticksLeft);
			out.push({ key: line.key, args: line.args, seconds: TREASURE_VIEW.toast.lockSec });
		}
		return out;
	}

	private settle(run: number, floor: number): void {
		this.settledRun = run;
		this.settledFloor = floor;
	}
}

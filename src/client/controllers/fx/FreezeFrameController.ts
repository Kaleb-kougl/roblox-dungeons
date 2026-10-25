import { Controller, OnStart } from "@flamework/core";
import {
	NUDGE_MS,
	applyFreezeEvent,
	freezeFrameOn,
	nudgeFor,
	nudgeOffset,
	type NudgeKind,
	type NudgeOffset,
} from "shared/view/fx";
import { SimController } from "../game/SimController";
import { FxTrackerController } from "./FxTrackerController";

/** Longest real frame the nudge timer advances by (web FreezeFrame: min(delta, 0.1)). */
const MAX_NUDGE_DT = 0.1;
const MS = 1000;

/**
 * Freeze frame on kill (port of project-kaleb-vale src/fx/freeze/FreezeFrame.tsx @ 42897e2). Three jobs:
 *   1. Tracker events -> hitstop requests on the SimController's clock (shared/view/fx freezeRules): kill 50 ms,
 *      elite / heavy kill 80 ms, boss phase 2/3 120 ms, boss death 250 ms + 0.5 s slow motion; 'reset' clears. The
 *      clock applies longest-wins, the clamp and the 150 ms / 1 s rate cap; LiveRun turns it into sim pacing.
 *   2. Settings: freezeFrameOn false (freezeFrame off or reducedMotion) -> requests are ignored and a running freeze /
 *      slow-mo is cleared at once.
 *   3. The 1-render-pixel camera nudge on boss phase 2/3 and the boss death (the web build's only screen shake; off
 *      under reducedMotion). CameraController adds `getNudge()` to the camera after its texel snap.
 */
@Controller({})
export class FreezeFrameController implements OnStart {
	private nudgeKind: NudgeKind = "none";
	private nudgeElapsedMs = 0;
	private readonly nudge: NudgeOffset = { x: 0, y: 0 };

	constructor(private readonly sim: SimController, private readonly fx: FxTrackerController) {}

	onStart(): void {
		this.fx.onEvent((e, settings) => {
			applyFreezeEvent(e, this.sim.hitstop, settings);
			if (e.type === "reset") {
				this.nudgeKind = "none";
				return;
			}
			const k = nudgeFor(e, settings);
			// A death nudge is never cut short by a phase one.
			if (k !== "none" && !(this.nudgeKind === "death" && k === "phase")) {
				this.nudgeKind = k;
				this.nudgeElapsedMs = 0;
			}
		});
		this.fx.onFrame((_, settings, dt) => {
			const clock = this.sim.hitstop;
			if (clock.isActive() && !freezeFrameOn(settings)) clock.clear();
			this.advanceNudge(dt, settings.reducedMotion);
		});
	}

	/** This frame's camera nudge in whole render pixels (x right, y up); (0, 0) almost always. */
	getNudge(): Readonly<NudgeOffset> {
		return this.nudge;
	}

	private advanceNudge(dt: number, reducedMotion: boolean): void {
		if (this.nudgeKind === "none" || reducedMotion) {
			this.nudgeKind = "none";
			this.nudge.x = 0;
			this.nudge.y = 0;
			return;
		}
		this.nudgeElapsedMs += math.min(math.max(dt, 0), MAX_NUDGE_DT) * MS;
		if (this.nudgeElapsedMs >= NUDGE_MS[this.nudgeKind]) this.nudgeKind = "none";
		nudgeOffset(this.nudgeKind, this.nudgeElapsedMs, this.nudge);
	}
}

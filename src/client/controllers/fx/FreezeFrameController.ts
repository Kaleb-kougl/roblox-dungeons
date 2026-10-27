import { Controller, OnStart } from "@flamework/core";
import type { JuiceSettings } from "shared/settings";
import { partySize } from "shared/sim";
import { StateWatch } from "shared/view";
import {
	NUDGE_MS,
	applyFreezeEvent,
	applyHurtFreeze,
	freezeFrameOn,
	hurtKindLanded,
	hurtNudgeFor,
	newFrameAdvance,
	nudgeFor,
	nudgeOffset,
	nudgeReplaces,
	screenShakeOn,
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
 * Port additions (docs/FEEL.md J3, J8):
 *   4. A heavy landed hit (FxEvent.heavy, not capped) freezes 40 ms and kicks the camera 1 texel; solo only (in co-op
 *      a teammate's finisher would kick everyone's camera). The view player's hurt edges (its own StateWatch, the
 *      view index as audio uses it) jolt the camera 2 texels; a heart or lethal hit also freezes 40 ms, solo only.
 *      Nudge priority death > hurt > phase > heavy (nudgeReplaces). The screenShake setting turns every nudge off.
 *   5. Co-op: the server's merged frames pace the sim (simPacerFor gives no pacer), so nothing else spends this
 *      clock's time; it is drained here every frame, so a kill's freeze (or the boss death's slow motion) holds the
 *      particles and sprite effects that scale by `hitstop.timeScale()` for its length only, never for good.
 */
@Controller({})
export class FreezeFrameController implements OnStart {
	private nudgeKind: NudgeKind = "none";
	private nudgeElapsedMs = 0;
	private readonly nudge: NudgeOffset = { x: 0, y: 0 };
	/** The view player's hurt edges (docs/FEEL.md J1). */
	private readonly watch = new StateWatch();
	private readonly coopAdvance = newFrameAdvance();

	constructor(private readonly sim: SimController, private readonly fx: FxTrackerController) {}

	onStart(): void {
		this.fx.onEvent((e, settings) => {
			if (e.type === "reset") {
				applyFreezeEvent(e, this.sim.hitstop, settings);
				this.watch.reset();
				this.nudgeKind = "none";
				return;
			}
			// Hits only freeze / kick when heavy; in co-op the hitter may be a teammate: solo only.
			if (e.type === "hit" && !this.solo()) return;
			applyFreezeEvent(e, this.sim.hitstop, settings);
			this.startNudge(nudgeFor(e, settings));
		});
		this.fx.onFrame((_, settings, dt) => {
			const clock = this.sim.hitstop;
			this.hurtFrame(settings);
			if (clock.isActive() && !freezeFrameOn(settings)) clock.clear();
			if (clock.isActive() && !this.solo()) clock.frame(dt, this.coopAdvance);
			this.advanceNudge(dt, settings);
		});
	}

	/** This frame's camera nudge in whole render pixels (x right, y up); (0, 0) almost always. */
	getNudge(): Readonly<NudgeOffset> {
		return this.nudge;
	}

	private solo(): boolean {
		const state = this.sim.getState();
		return state === undefined || partySize(state) <= 1;
	}

	/** A new nudge replaces the running one only when it ranks at least as high (a death is never cut short). */
	private startNudge(k: NudgeKind): void {
		if (!nudgeReplaces(this.nudgeKind, k)) return;
		this.nudgeKind = k;
		this.nudgeElapsedMs = 0;
	}

	/** The view player's hurt edge this frame: the jolt, and in solo the freeze. */
	private hurtFrame(settings: Readonly<JuiceSettings>): void {
		const state = this.sim.getState();
		if (state === undefined) return;
		const view = this.sim.getViewPlayerIndex();
		this.watch.update(state, view);
		if (view >= this.watch.players()) return;
		const kind = hurtKindLanded(this.watch.hurtKind[view], this.sim.getFrameEvents()?.playerHits);
		if (kind === "none") return;
		this.startNudge(hurtNudgeFor(kind, settings));
		if (partySize(state) <= 1) applyHurtFreeze(kind, this.sim.hitstop, settings);
	}

	private advanceNudge(dt: number, settings: Readonly<JuiceSettings>): void {
		if (this.nudgeKind === "none" || !screenShakeOn(settings)) {
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

import { Controller, OnStart } from "@flamework/core";
import { clientStore } from "client/store";
import { BUILDS_V2_FX, HappyHourFx, comboQuiet } from "shared/view/fx";
import { PROGRESSION_VIEW } from "shared/view/hud";
import { SimController } from "../game/SimController";
import { FxTrackerController } from "./FxTrackerController";

/**
 * Happy Hour (docs/BUILDS_V2.md BV11d; Studio checklist 12): the ONE shared/view/fx HappyHourFx of the client, stepped
 * once per rendered frame (an FxTrackerController frame handler, after the frame's ticks: every drink of the frame is
 * in RunView.builds.happyHours) with the local player and comboQuiet.
 *
 *   - The toast: when the local player's drink started (or restarted) Happy Hour this frame, `hud.toast.happyHour`
 *     through the toast path (clientStore.pushToast, ToastPanel; BraceFxController's construction) for
 *     happyHour.toast.seconds, ids counting down from happyHour.toast.idBase. A teammate's drink shows nothing.
 *   - The pop tint: ScorePopController asks `isOn(viewPlayer, tick)` per frame and colours the kill pops
 *     ScorePopTone.HAPPY (happyPopTone) in happyHour.popRole while it is on. The FxTracker step runs before the score
 *     pops' render step every frame, so a drink's own frame already tints.
 * Presentation only: read-only on the sim.
 */
@Controller({})
export class HappyHourController implements OnStart {
	private readonly planner = new HappyHourFx();
	private serial = 0;

	constructor(private readonly sim: SimController, private readonly fx: FxTrackerController) {}

	onStart(): void {
		this.fx.onFrame(() => this.frame());
		this.sim.onRunExited(() => this.planner.resetAll());
	}

	/** Player `player`'s Happy Hour runs at tick `tick` (from the drinks seen so far this run). */
	isOn(player: number, tick: number): boolean {
		return this.planner.isOn(player, tick);
	}

	private frame(): void {
		const ctx = this.sim.getContext();
		if (ctx === undefined) return;
		const run = ctx.run;
		const quiet = comboQuiet(this.sim.isInputCovered(), this.sim.isRunOver());
		if (this.planner.frame(run.builds, run.state, this.sim.getLocalPlayerIndex(), quiet)) this.toast();
	}

	private toast(): void {
		const t = BUILDS_V2_FX.happyHour.toast;
		this.serial++;
		clientStore.pushToast(
			{ id: t.idBase - this.serial, key: t.key, until: os.clock() + t.seconds },
			PROGRESSION_VIEW.maxToasts,
		);
	}
}

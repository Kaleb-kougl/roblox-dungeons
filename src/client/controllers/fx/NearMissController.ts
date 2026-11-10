import { Controller, OnStart } from "@flamework/core";
import type { JuiceSettings } from "shared/settings";
import { NearMissDirector, comboQuiet, type NearMissFrame } from "shared/view/fx";
import { SimController } from "../game/SimController";
import { FxTrackerController } from "./FxTrackerController";

/** Called once per rendered frame with that frame's near-miss output (reused object: read it now, never keep it). */
export type NearMissFrameHandler = (
	frame: Readonly<NearMissFrame>,
	settings: Readonly<JuiceSettings>,
	realDt: number,
) => void;

/**
 * Grazes and parries (docs/GRAZE_PARRY.md): the ONE NearMissDirector of the client. Once per rendered frame (an
 * FxTrackerController frame handler, after the frame's sim ticks) it steps the director with the run view's
 * `nearMiss` source (RunView.nearMiss, collected per tick), the live state, the view player
 * (SimController.getViewPlayerIndex: the watched teammate while spectating), the quiet gate (comboQuiet over the stage
 * cover and the run's end, as the combo uses), the juice settings and a forward-only real-time clock, then hands the
 * frame to every subscriber (sparks, the PARRY! flash and freeze, audio) in subscription order. Subscribing here
 * instead of reading `latest()` from another frame handler means no consumer depends on Flamework's start order.
 *
 * With no run the director is reset and nothing is dispatched. Presentation only: read-only on the sim.
 */
@Controller({})
export class NearMissController implements OnStart {
	private readonly director = new NearMissDirector();
	private readonly handlers = new Array<NearMissFrameHandler>();
	private last: Readonly<NearMissFrame> | undefined;
	private frames = 0;

	constructor(private readonly sim: SimController, private readonly fx: FxTrackerController) {}

	onStart(): void {
		this.fx.onFrame((_, settings, dt) => this.frame(settings, dt));
	}

	/** Every rendered frame's near-miss output, after the director stepped. */
	onFrame(handler: NearMissFrameHandler): void {
		this.handlers.push(handler);
	}

	/** The NearMissFrame of the latest rendered frame (undefined before the first run frame or with no run). */
	latest(): Readonly<NearMissFrame> | undefined {
		return this.last;
	}

	/** Rendered frames dispatched so far (consumers compare it to consume each frame once). */
	frameId(): number {
		return this.frames;
	}

	private frame(settings: Readonly<JuiceSettings>, dt: number): void {
		const ctx = this.sim.getContext();
		if (ctx === undefined) {
			if (this.last !== undefined) this.director.resetAll();
			this.last = undefined;
			return;
		}
		const quiet = comboQuiet(this.sim.isInputCovered(), this.sim.isRunOver());
		const out = this.director.frame(
			ctx.run.nearMiss,
			ctx.run.state,
			this.sim.getViewPlayerIndex(),
			quiet,
			settings,
			os.clock(),
			this.sim.drawnPlayerOf,
		);
		this.last = out;
		this.frames++;
		for (const handler of this.handlers) handler(out, settings, dt);
	}
}

import { Controller, OnStart } from "@flamework/core";
import { RunService } from "@rbxts/services";
import { clientStore, selectJuice } from "client/store";
import type { JuiceSettings } from "shared/settings";
import { RENDER_ORDER } from "shared/view";
import { HitTracker, type FxEvent, type FxEventBuffer } from "shared/view/fx";
import { SimController } from "../game/SimController";

const RENDER_STEP = "KV_FxTracker";

/** Called for every FX event of a frame, in emission order. The event is pooled: copy fields, never keep it. */
export type FxEventHandler = (e: FxEvent, settings: Readonly<JuiceSettings>) => void;
/** Called once per frame after every event was dispatched (the frame's events are still readable). */
export type FxFrameHandler = (events: FxEventBuffer, settings: Readonly<JuiceSettings>, realDt: number) => void;

/**
 * The juice layer's event source (port of project-kaleb-vale src/fx/FxTracker.tsx @ 42897e2, the provider half). Once
 * per rendered frame, right after the SimController ran the frame's ticks (RENDER_ORDER.fxAfterSim), the pure
 * HitTracker (shared/view/fx) diffs the live actors against its snapshot and the frame's events go to every
 * subscriber: health bars, damage numbers, particles, the freeze frame (event handlers) and audio (frame handler).
 *
 * The effective juice settings (Reflex `selectJuice`) are read once per frame and handed to every handler. Read-only
 * on the sim; nothing here feeds back into step() (the freeze frame only paces the loop: SimController.hitstop).
 */
@Controller({})
export class FxTrackerController implements OnStart {
	readonly tracker = new HitTracker();
	private readonly handlers = new Array<FxEventHandler>();
	private readonly frameHandlers = new Array<FxFrameHandler>();

	constructor(private readonly sim: SimController) {}

	onStart(): void {
		RunService.BindToRenderStep(RENDER_STEP, Enum.RenderPriority.Input.Value + RENDER_ORDER.fxAfterSim, (dt) =>
			this.frame(dt),
		);
	}

	/** Every FX event (reset, hit, killed, spawned, capped, bossPhase, bossDefeated). */
	onEvent(handler: FxEventHandler): void {
		this.handlers.push(handler);
	}

	/** Once per frame, after the events. */
	onFrame(handler: FxFrameHandler): void {
		this.frameHandlers.push(handler);
	}

	/** The effective juice settings now (memoized selector over the store). */
	settings(): Readonly<JuiceSettings> {
		return selectJuice(clientStore.getState());
	}

	private frame(dt: number): void {
		const ctx = this.sim.getContext();
		if (ctx === undefined) return;
		const settings = this.settings();
		const events = this.tracker.events;
		const n = this.tracker.update(ctx.run.state, ctx.run.getAlpha(), ctx.config.encounter);
		for (let i = 0; i < n; i++) {
			const e = events.at(i);
			for (const handler of this.handlers) handler(e, settings);
		}
		for (const handler of this.frameHandlers) handler(events, settings, dt);
	}
}

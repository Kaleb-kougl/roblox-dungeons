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
 * Frame handler phases (onFrame): a lower phase runs first; handlers of one phase run in registration order (which
 * follows Flamework's start order, so no handler may depend on it). `scoreRoll`: RoomClearController's frame, whose
 * score roller produces the frame's shown score, with NewBestController's tracker stepped inside it (docs/NEW_BEST.md
 * NB7), so the new-best frame is ready before every `normal` handler: NearMissController (and AudioController's sound
 * frame, its subscriber, which hands the new-best cues to the cue mapper) and ComboController (the NEW BEST! shout).
 * `teamMoments` (before scoreRoll): TeamMomentsController steps the co-op moments' room-clear half (docs/RUN_RECAP.md
 * CM2), so RoomClearController's stamp reads this frame's TEAM PERFECT streak. `haptics` (after normal):
 * HapticsController's play frame (docs/HAPTICS.md HP4), which reads the parry cue NearMissController dispatched this
 * frame and the hurt edge of the same frame, so a cue starts on its freeze's frame.
 */
export const FX_FRAME_PHASE = { teamMoments: -2, scoreRoll: -1, normal: 0, haptics: 1 } as const;

interface PhasedFrameHandler {
	readonly phase: number;
	readonly handler: FxFrameHandler;
}

/**
 * The juice layer's event source (port of the web build's src/fx/FxTracker.tsx @ 42897e2, the provider half). Once
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
	private readonly frameHandlers = new Array<PhasedFrameHandler>();

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

	/** Once per frame, after the events, in `phase` order (FX_FRAME_PHASE; default normal). */
	onFrame(handler: FxFrameHandler, phase: number = FX_FRAME_PHASE.normal): void {
		const list = this.frameHandlers;
		let at = list.size();
		while (at > 0 && list[at - 1].phase > phase) at--;
		list.insert(at, { phase, handler });
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
		for (const h of this.frameHandlers) h.handler(events, settings, dt);
	}
}

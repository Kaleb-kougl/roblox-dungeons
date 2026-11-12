import { Controller, OnStart } from "@flamework/core";
import { clientStore, selectStageCovered } from "client/store";
import { FLOOR_MODIFIER_UI, resetFloorModifierUi } from "client/ui";
import { FloorModifier } from "shared/dungeon";
import type { JuiceSettings } from "shared/settings";
import { FLOOR_MODIFIER_VIEW, ModifierPayoff, chipPulse, modifierPayoffInput } from "shared/view";
import { SimController, floorModifierOf, type RunContext } from "../game/SimController";
import { FxTrackerController } from "./FxTrackerController";

/**
 * The floor modifier chip's payoff pulse (docs/FLOOR_MODIFIERS.md FM6). Once per rendered frame (an FxTrackerController
 * frame handler, after the frame's ticks) it builds shared/view modifierPayoffInput from the run view (RunContext.run:
 * the frame's Goldling, vault, pellet and boost events, the sim state for Blood Moon's elite room) and the floor's
 * modifier (SimController floorModifierOf: the floor layout's, the same RunInfo.floorModifier the chip shows), steps
 * the once-per-floor ModifierPayoff latch and, on its one true frame, starts the chip's pulse (shared/view chipPulse
 * into the client/ui FLOOR_MODIFIER_UI bindings). A payoff under the stage cover (a live world under a floor card)
 * waits for the cover to lift, so the pulse is seen. The latch moves to each new floor by itself (its first frame there
 * pays nothing: its events may be the old floor's); a run start resets it to the run's floor, a floor change makes sure
 * it is on the new floor, a run exit clears the pulse. Reduced motion: no pulse (chipPulse at rest). Presentation only:
 * read-only on the sim.
 */
@Controller({})
export class FloorModifierController implements OnStart {
	private readonly payoff = new ModifierPayoff();
	/** os.clock() of the pulse's start (undefined: no pulse). */
	private pulseStart: number | undefined;
	/** The floor paid off under the stage cover: the pulse starts once the cover is gone. */
	private pending = false;

	constructor(private readonly sim: SimController, private readonly fx: FxTrackerController) {}

	onStart(): void {
		this.sim.onRunStarted((ctx) => this.newRun(ctx));
		this.sim.onFloorChanged((ctx) => this.newFloor(ctx));
		this.sim.onRunExited(() => this.clear());
		this.fx.onFrame((_, settings) => this.frame(settings));
	}

	private newRun(ctx: RunContext): void {
		this.payoff.reset(ctx.floor);
		this.clear();
	}

	private newFloor(ctx: RunContext): void {
		// Normally already there: the latch moved on the new floor's first frame (a reset now could pay it twice).
		if (this.payoff.currentFloor() === ctx.floor) return;
		this.payoff.reset(ctx.floor);
		this.clear();
	}

	private clear(): void {
		this.pending = false;
		this.pulseStart = undefined;
		resetFloorModifierUi();
	}

	private frame(settings: Readonly<JuiceSettings>): void {
		const ctx = this.sim.getContext();
		if (ctx === undefined) return;
		const before = this.payoff.currentFloor();
		const input = modifierPayoffInput(ctx.run, floorModifierOf(ctx, ctx.run.state.endless?.floor ?? ctx.floor));
		const paid = this.payoff.frame(input);
		if (this.payoff.currentFloor() !== before) this.clear(); // a new floor: the old floor's pulse is over
		const covered = selectStageCovered(clientStore.getState());
		if (paid) this.pending = true;
		if (this.pending && !covered && input.modifier !== FloorModifier.NONE) {
			this.pending = false;
			this.pulseStart = os.clock();
		}
		this.draw(settings.reducedMotion);
	}

	private draw(reducedMotion: boolean): void {
		const start = this.pulseStart;
		if (start === undefined) return;
		const since = os.clock() - start;
		if (since >= FLOOR_MODIFIER_VIEW.chipPulse.durationSec) {
			this.pulseStart = undefined;
			resetFloorModifierUi();
			return;
		}
		const look = chipPulse(since, reducedMotion);
		FLOOR_MODIFIER_UI.pulseScale.write(look.scale);
		FLOOR_MODIFIER_UI.pulseTransparency.write(look.transparency);
	}
}

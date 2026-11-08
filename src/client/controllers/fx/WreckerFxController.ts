import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { Workspace } from "@rbxts/services";
import { clientStore, selectDisplay } from "client/store";
import type { BuildFxLevel, JuiceSettings } from "shared/settings";
import type { ColorRole } from "shared/theme";
import { WreckerFx, comboQuiet, type WreckerFxFrame } from "shared/view/fx";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { FxTrackerController } from "./FxTrackerController";
import { ParticleController } from "./ParticleController";
import { fxFolder } from "./fxHelpers";
import { NeonPartPool, placeWaveOneRing } from "./neonPartPool";

const FOLDER_NAME = "KV_WreckerFx";

/**
 * Wrecker and Demolition (docs/BUILDS_V2.md BV11d; Studio checklist 7, 11, 12): the ONE shared/view/fx WreckerFx of the
 * client. Once per rendered frame (an FxTrackerController frame handler, after the frame's sim ticks, so a frame that
 * ran several ticks has every one of their records in RunView.builds) it steps the planner with the run view's
 * `builds`, the live state, the view player, the quiet gate (comboQuiet over the stage cover and the run's end), the
 * juice settings plus Options > Display > Build effects and the run's alpha (the planner ages on sim time), then draws:
 *
 *   - rings: every WreckerFx ring (a smash pop in build.shard at each smashed piece, a Demolition blast out to the
 *     sim's DEMOLITION_RADIUS in build.ember) as pooled flat Neon chords (placeWaveOneRing), sized by the ring's block,
 *     a teammate's at teammateOpacity (the planner's fade). WreckerFx's planner holds only these two looks: the Siege
 *     Bolt's shock ring is BowFx's (its own WaveOneRings, the bow effects' controller), so nothing is drawn twice;
 *   - chips: per WreckerFx chip burst (Full with particles on, at most smash.chipsPerFrame a frame, the view player's
 *     first) ParticleController.buildSmashChips in the chip shape the planner gives (smashChipShape).
 * Reduced: the planner's segment counts, no chips (Demolition's blast stays: it is the chain's reach). The smash's sound
 * is the audio cue mapper's (sfx.build.smash, the build voice). One BulkMoveTo per frame. With no run the planner is
 * reset and every part parked. Presentation only: read-only on the sim.
 */
@Controller({})
export class WreckerFxController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly planner = new WreckerFx();
	private readonly colors = new Map<ColorRole, Color3>();
	private readonly moveParts = new Array<BasePart>();
	private readonly moveCFrames = new Array<CFrame>();
	private settings: { juice: Readonly<JuiceSettings>; buildFx: BuildFxLevel } | undefined;
	private rings: NeonPartPool | undefined;
	private hadRun = false;

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
		private readonly particles: ParticleController,
	) {}

	onStart(): void {
		const folder = this.janitor.Add(fxFolder(FOLDER_NAME));
		this.rings = new NeonPartPool(folder, "WreckerRing", Enum.PartType.Block);
		this.fx.onFrame((_, juice) => this.frame(juice));
	}

	/** Pooled ring parts. */
	getPoolSize(): number {
		return this.rings?.size() ?? 0;
	}

	private color(role: ColorRole): Color3 {
		let c = this.colors.get(role);
		if (c === undefined) {
			c = this.theme.getPack().color(role);
			this.colors.set(role, c);
		}
		return c;
	}

	private frame(juice: Readonly<JuiceSettings>): void {
		const ctx = this.sim.getContext();
		if (ctx === undefined) {
			if (this.hadRun) {
				this.planner.resetAll();
				this.draw(undefined);
			}
			this.hadRun = false;
			return;
		}
		this.hadRun = true;
		const buildFx = selectDisplay(clientStore.getState()).buildFx;
		let settings = this.settings;
		if (settings === undefined) {
			settings = { juice, buildFx };
			this.settings = settings;
		}
		settings.juice = juice;
		settings.buildFx = buildFx;
		const run = ctx.run;
		const out = this.planner.frame(
			run.builds,
			run.state,
			this.sim.getViewPlayerIndex(),
			comboQuiet(this.sim.isInputCovered(), this.sim.isRunOver()),
			settings,
			run.getAlpha(),
		);
		for (const c of out.chips) this.particles.buildSmashChips(c.x, c.z, out.chipShape, c.seed);
		this.draw(out);
	}

	private draw(out: Readonly<WreckerFxFrame> | undefined): void {
		const pool = this.rings;
		if (pool === undefined) return;
		const mp = this.moveParts;
		const mc = this.moveCFrames;
		mp.clear();
		mc.clear();
		pool.begin();
		if (out !== undefined) for (const r of out.rings) placeWaveOneRing(pool, r, this.color(r.role), mp, mc);
		pool.end(mp, mc);
		if (mp.size() > 0) Workspace.BulkMoveTo(mp, mc, Enum.BulkMoveMode.FireCFrameChanged);
	}
}

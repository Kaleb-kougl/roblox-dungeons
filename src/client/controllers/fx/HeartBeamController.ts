import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { Workspace } from "@rbxts/services";
import { clientStore, selectDisplay } from "client/store";
import type { BuildFxLevel, JuiceSettings } from "shared/settings";
import { floorStudsY, studsX, studsZ } from "shared/view";
import { BUILD_FX_VIEW, BUILDS_V2_FX, HeartBeamFx, comboQuiet, type HeartBeamView } from "shared/view/fx";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { FxTrackerController } from "./FxTrackerController";
import { fxFolder } from "./fxHelpers";
import { NeonPartPool } from "./neonPartPool";

const FOLDER_NAME = "KV_HeartBeam";
/** The core is the beam's role mixed toward white (BUILDS_V2_FX.heartBeam.coreWhiteMix). */
const WHITE = new Color3(1, 1, 1);

/**
 * Full Heart's beam (docs/BUILDS_V2.md BV11d; Studio checklist 11, 12): the ONE shared/view/fx HeartBeamFx of the
 * client, stepped once per rendered frame (an FxTrackerController frame handler, after the frame's ticks) with the run
 * view's `builds`, the live state, the view player, comboQuiet, the juice settings plus Build effects and the run's
 * alpha (sim time). Each HeartBeamView is drawn as the Overkill streak is (BuildFxController, docs/LEGENDARIES.md LG6):
 * ONE straight Neon segment player -> the line's end, `widthStuds` square, in heartBeam.role (boon.duo) at 1 - fade
 * transparency (the planner's hold-then-fade, a teammate's at teammateOpacity), with a thinner core (coreShare of the
 * width, the role mixed coreWhiteMix toward white) whose top is the streak's coreLiftStuds over the beam's when `core`
 * (Full only). It lies heartBeam.liftStuds
 * over the floor, under the bullets. The sound is the cue mapper's (sfx.build.beam). One BulkMoveTo per frame; with no
 * run the planner is reset and every part parked. Presentation only: read-only on the sim.
 */
@Controller({})
export class HeartBeamController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly planner = new HeartBeamFx();
	private readonly moveParts = new Array<BasePart>();
	private readonly moveCFrames = new Array<CFrame>();
	private settings: { juice: Readonly<JuiceSettings>; buildFx: BuildFxLevel } | undefined;
	private beams: NeonPartPool | undefined;
	private beamColor: Color3 | undefined;
	private coreColor: Color3 | undefined;
	private hadRun = false;

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
	) {}

	onStart(): void {
		const folder = this.janitor.Add(fxFolder(FOLDER_NAME));
		this.beams = new NeonPartPool(folder, "HeartBeam", Enum.PartType.Block);
		this.fx.onFrame((_, juice) => this.frame(juice));
	}

	/** Pooled beam parts (segments and cores). */
	getPoolSize(): number {
		return this.beams?.size() ?? 0;
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
		const beams = this.planner.frame(
			run.builds,
			run.state,
			this.sim.getViewPlayerIndex(),
			comboQuiet(this.sim.isInputCovered(), this.sim.isRunOver()),
			settings,
			run.getAlpha(),
		);
		this.draw(beams);
	}

	private colorsOf(): [Color3, Color3] {
		let beam = this.beamColor;
		let core = this.coreColor;
		if (beam === undefined || core === undefined) {
			const b = BUILDS_V2_FX.heartBeam;
			beam = this.theme.getPack().color(b.role);
			core = beam.Lerp(WHITE, b.coreWhiteMix);
			this.beamColor = beam;
			this.coreColor = core;
		}
		return [beam, core];
	}

	private draw(beams: ReadonlyArray<HeartBeamView> | undefined): void {
		const pool = this.beams;
		if (pool === undefined) return;
		const mp = this.moveParts;
		const mc = this.moveCFrames;
		mp.clear();
		mc.clear();
		pool.begin();
		if (beams !== undefined && beams.size() > 0) {
			const b = BUILDS_V2_FX.heartBeam;
			const y = floorStudsY() + b.liftStuds;
			const [color, coreColor] = this.colorsOf();
			for (const beam of beams) {
				if (beam.fade <= 0) continue;
				const a = new Vector3(studsX(beam.x1), y, studsZ(beam.z1));
				const c = new Vector3(studsX(beam.x2), y, studsZ(beam.z2));
				const len = a.sub(c).Magnitude;
				if (len <= 0) continue;
				const alpha = 1 - beam.fade;
				const mid = a.add(c).mul(0.5);
				const w = beam.widthStuds;
				pool.place(CFrame.lookAt(mid, c), new Vector3(w, w, len), color, alpha, mp, mc);
				if (!beam.core) continue;
				const core = w * b.coreShare;
				// The core's top a hair (the Overkill streak's coreLiftStuds) over the beam's, so the camera sees it.
				const lift = new Vector3(0, (w - core) / 2 + BUILD_FX_VIEW.overkill.coreLiftStuds, 0);
				pool.place(
					CFrame.lookAt(mid.add(lift), c.add(lift)),
					new Vector3(core, core, len),
					coreColor,
					alpha,
					mp,
					mc,
				);
			}
		}
		pool.end(mp, mc);
		if (mp.size() > 0) Workspace.BulkMoveTo(mp, mc, Enum.BulkMoveMode.FireCFrameChanged);
	}
}

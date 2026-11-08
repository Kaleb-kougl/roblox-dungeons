import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { Workspace } from "@rbxts/services";
import { clientStore, selectDisplay } from "client/store";
import { STUDS_PER_TILE } from "shared/config";
import type { BuildFxLevel, JuiceSettings } from "shared/settings";
import type { ColorRole } from "shared/theme";
import { floorStudsY, studsX, studsZ } from "shared/view";
import {
	BUILDS_V2_FX,
	CounterWaveFx,
	comboQuiet,
	counterWaveStrip,
	floorShoutText,
	newCounterWaveStrip,
	type CounterWaveFrame,
	type CounterWaveStrip,
	type CounterWaveView,
	type FloorShoutRequest,
} from "shared/view/fx";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { FxPartPool } from "./BuildFxController";
import { ComboController } from "./ComboController";
import { FxTrackerController } from "./FxTrackerController";
import { fxFolder } from "./fxHelpers";

const FOLDER_NAME = "KV_CounterWaves";

/**
 * Riposte's counter-waves on the floor (docs/BUILDS_V2.md BV11b; Studio checklist 1, 3, 4, 8, 11, 12). Once per rendered
 * frame (an FxTrackerController frame handler, after the frame's sim ticks) it steps the ONE CounterWaveFx (shared/view
 * fx) with the run view's `builds` source (RunView.builds, collected per tick), the live state, the view player, the
 * quiet gate (comboQuiet over the stage cover and the run's end), the juice settings plus Options > Display > Build
 * effects and the run's alpha, then draws what it returns:
 *
 *   - every live wave (Riposte's FORWARD crescent, Counterstrike's RING, Rebuke's REBUKE ring; one look, told apart by
 *     their cone) as `segments` pooled flat Neon chords along its arc in its role (build.counter), the band
 *     (counterWaveStrip: bandTiles behind the edge, which is the sim's strike radius) over a wider, fainter glow (Full
 *     only), at the wave's fade (a teammate's carries teammateOpacity), flat on the floor under the bullets
 *     (BUILDS_V2_FX.counter lifts, the build rings' layer);
 *   - COUNTER xN: the planner's shout (the view player's wave only) through ComboController.requestShout at
 *     FLOOR_SHOUT_PRIORITY.counter, so it sits in the combo shout's slot and never covers a bullet (CD9).
 *
 * Counterstrike's returns are ordinary player bullets (BulletKind.SHARD, BuildEffect.RIPOSTE source) and draw as shards
 * through the bullet pools; the counter sound and the parry ladder are the audio cue mapper's. A run start, a floor
 * change and a run exit forget every wave and park every part. One BulkMoveTo per frame. Presentation only: read-only
 * on the sim.
 */
@Controller({})
export class CounterWaveController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly waves = new CounterWaveFx();
	private readonly colors = new Map<ColorRole, Color3>();
	private readonly moveParts = new Array<BasePart>();
	private readonly moveCFrames = new Array<CFrame>();
	private readonly strip: CounterWaveStrip = newCounterWaveStrip();
	/** The planner's settings, refreshed every frame (no allocation). */
	private settings: { juice: Readonly<JuiceSettings>; buildFx: BuildFxLevel } | undefined;
	private bands: FxPartPool | undefined;
	private glows: FxPartPool | undefined;

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
		private readonly combo: ComboController,
	) {}

	onStart(): void {
		const folder = this.janitor.Add(fxFolder(FOLDER_NAME));
		this.glows = new FxPartPool(folder, "CounterGlow", Enum.PartType.Block);
		this.bands = new FxPartPool(folder, "CounterBand", Enum.PartType.Block);
		this.fx.onFrame((_, juice) => this.frame(juice));
		this.sim.onRunStarted(() => this.clear());
		this.sim.onFloorChanged(() => this.clear());
		this.sim.onRunExited(() => this.clear());
	}

	/** Pooled parts (band chords, glow chords). */
	getPoolSizes(): [number, number] {
		return [this.bands?.size() ?? 0, this.glows?.size() ?? 0];
	}

	private color(role: ColorRole): Color3 {
		let c = this.colors.get(role);
		if (c === undefined) {
			c = this.theme.getPack().color(role);
			this.colors.set(role, c);
		}
		return c;
	}

	/** Forgets every wave and parks every part. */
	private clear(): void {
		this.waves.resetAll();
		this.draw(undefined);
	}

	private frame(juice: Readonly<JuiceSettings>): void {
		const ctx = this.sim.getContext();
		if (ctx === undefined) return;
		const buildFx = selectDisplay(clientStore.getState()).buildFx;
		let settings = this.settings;
		if (settings === undefined) {
			settings = { juice, buildFx };
			this.settings = settings;
		}
		settings.juice = juice;
		settings.buildFx = buildFx;
		const quiet = comboQuiet(this.sim.isInputCovered(), this.sim.isRunOver());
		const out = this.waves.frame(
			ctx.run.builds,
			ctx.run.state,
			this.sim.getViewPlayerIndex(),
			quiet,
			settings,
			ctx.run.getAlpha(),
		);
		if (out.shout !== undefined) this.shout(out.shout);
		this.draw(out);
	}

	private shout(s: Readonly<FloorShoutRequest>): void {
		const pack = this.theme.getPack();
		this.combo.requestShout(floorShoutText(pack, s), this.color(s.role), s.lifeSec, s.priority);
	}

	private draw(out: Readonly<CounterWaveFrame> | undefined): void {
		const bands = this.bands;
		const glows = this.glows;
		if (bands === undefined || glows === undefined) return;
		const mp = this.moveParts;
		const mc = this.moveCFrames;
		mp.clear();
		mc.clear();
		bands.begin();
		glows.begin();
		if (out !== undefined)
			for (const w of out.waves) {
				if (w.glow) this.drawStrip(w, true, glows);
				this.drawStrip(w, false, bands);
			}
		bands.end(mp, mc);
		glows.end(mp, mc);
		if (mp.size() > 0) Workspace.BulkMoveTo(mp, mc, Enum.BulkMoveMode.FireCFrameChanged);
	}

	/** One strip (counterWaveStrip) of wave `w`: `segments` flat chords along its arc, each along the arc's tangent. */
	private drawStrip(w: Readonly<CounterWaveView>, glow: boolean, pool: FxPartPool): void {
		const s = counterWaveStrip(w, glow, this.strip);
		if (s.chordTiles <= 0) return;
		const c = BUILDS_V2_FX.counter;
		const y = floorStudsY() + s.liftStuds;
		const cx = studsX(w.x);
		const cz = studsZ(w.z);
		const mid = s.midTiles * STUDS_PER_TILE;
		const size = new Vector3(s.widthTiles * STUDS_PER_TILE, c.thicknessStuds, s.chordTiles * STUDS_PER_TILE);
		const color = this.color(w.role);
		for (let i = 0; i < w.segments; i++) {
			const angle = s.startRad + s.stepRad * (i + 0.5);
			const cos = math.cos(angle);
			const sin = math.sin(angle);
			// The chord runs along the tangent: look along (-sin, cos); its width (X) is radial.
			const cf = CFrame.lookAlong(new Vector3(cx + mid * cos, y, cz + mid * sin), new Vector3(-sin, 0, cos));
			pool.place(cf, size, color, s.transparency, this.moveParts, this.moveCFrames);
		}
	}
}

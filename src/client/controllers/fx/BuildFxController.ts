import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { Workspace } from "@rbxts/services";
import { clientStore, selectDisplay } from "client/store";
import { STUDS_PER_TILE } from "shared/config";
import type { BuildFxLevel, JuiceSettings } from "shared/settings";
import type { ColorRole } from "shared/theme";
import { floorStudsY, studsX, studsZ } from "shared/view";
import {
	BUILD_FX_VIEW,
	FX_VIEW,
	BuildFxDirector,
	buildRingBlock,
	comboQuiet,
	type BuildFxFrame,
	type RingView,
} from "shared/view/fx";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { renderPart } from "../render/placeholders";
import { FxTrackerController } from "./FxTrackerController";
import { ParticleController } from "./ParticleController";
import { fxFolder } from "./fxHelpers";

/** Called once per rendered frame with that frame's build-effects output (reused object: read it now, never keep it). */
export type BuildFxFrameHandler = (frame: Readonly<BuildFxFrame>) => void;

const PARKED = new CFrame(FX_VIEW.parkedStuds[0], FX_VIEW.parkedStuds[1], FX_VIEW.parkedStuds[2]);
/** A Cylinder's axis is X: turned to Y, it lies flat on the floor (the execute disc). */
const FLAT = CFrame.Angles(0, 0, math.pi / 2);
const FULL_TURN = 2 * math.pi;
/** Transparency writes are quantized to this step (a write only on a change). */
const ALPHA_QUANTUM = 0.05;
const FOLDER_NAME = "KV_BuildFx";

/** One pooled Neon part and the properties last written to it. */
interface FxPart {
	readonly part: Part;
	color: Color3 | undefined;
	alpha: number;
	size: Vector3 | undefined;
}

/** A grow-only pool of Neon parts used front to back each frame; the ones past this frame's count are parked. */
class FxPartPool {
	private readonly parts = new Array<FxPart>();
	private used = 0;
	private lastUsed = 0;

	constructor(
		private readonly folder: Folder,
		private readonly name: string,
		private readonly shape: Enum.PartType,
	) {}

	begin(): void {
		this.used = 0;
	}

	/** The next part, styled; its CFrame goes into the frame's move lists. */
	place(
		cf: CFrame,
		size: Vector3,
		color: Color3,
		transparency: number,
		moveParts: BasePart[],
		moveCFrames: CFrame[],
	): void {
		if (this.used >= this.parts.size()) {
			const part = renderPart("Part", false);
			part.Name = this.name;
			part.Shape = this.shape;
			part.Material = Enum.Material.Neon;
			part.CFrame = PARKED;
			part.Parent = this.folder;
			this.parts.push({ part, color: undefined, alpha: -1, size: undefined });
		}
		const p = this.parts[this.used];
		this.used++;
		if (p.color !== color) {
			p.color = color;
			p.part.Color = color;
		}
		const a = math.round(transparency / ALPHA_QUANTUM) * ALPHA_QUANTUM;
		if (a !== p.alpha) {
			p.alpha = a;
			p.part.Transparency = a;
		}
		if (p.size !== size) {
			p.size = size;
			p.part.Size = size;
		}
		moveParts.push(p.part);
		moveCFrames.push(cf);
	}

	/** Parks every part this frame left unused. */
	end(moveParts: BasePart[], moveCFrames: CFrame[]): void {
		for (let i = this.used; i < this.lastUsed; i++) {
			moveParts.push(this.parts[i].part);
			moveCFrames.push(PARKED);
		}
		this.lastUsed = this.used;
	}

	size(): number {
		return this.parts.size();
	}
}

/**
 * Build effects (docs/BUILDS.md BU8, its follow-up and the BU6 view): the ONE BuildFxDirector of the client, the NearMissController shape. Once per
 * rendered frame (an FxTrackerController frame handler, after the frame's sim ticks) it steps the director with the run
 * view's `builds` source (RunView.builds, collected per tick), the live state, the view player, the quiet gate
 * (comboQuiet over the stage cover and the run's end), the juice settings plus Options > Display > Build effects
 * (`buildFx`) and a forward-only real-time clock, then draws the frame and hands it to every subscriber:
 *
 *   - spark beams: each beam's jagged polyline as pooled thin Neon segments in build.spark, fading out (BEAM_SEC); a
 *     Storm Crown fork thinner (beam.forkThicknessShare);
 *   - spark bursts / Phantom Step erase sparks: ParticleController.buildSparkBurst / buildPhantomBurst at each new
 *     target / erased bullet (Full or Reduced shape; none with particles off);
 *   - rings: novas, origin flares (Momentum / Thrill Seeker / Flurry / Ricochet, and BU6's Storm Blade / Conductor /
 *     Chain Reaction / Close Call in boon.duo), the evolve / duo flare, the Lionheart pulse and Unshaken's shield glint
 *     on the knight, as pooled flat segments around the circle in the ring's role, sized by its look's block
 *     (buildRingBlock);
 *   - execute flashes: a flat Neon disc in BUILD_FX_VIEW.execute.role, popping out and fading.
 * The Jackpot pop and Gold Rush's kill pop are the score pops' (ScorePopController reads RunView.builds.jackpots /
 * goldRush). Duo sparks and embers need nothing here: they come through as ordinary spark segments and ember bullets.
 *
 * Everything sits on the floor plane under the bullets (segment lifts in BUILD_FX_VIEW). One BulkMoveTo per frame.
 * With no run the director is reset and every part parked. Presentation only: read-only on the sim.
 */
@Controller({})
export class BuildFxController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly director = new BuildFxDirector();
	private readonly handlers = new Array<BuildFxFrameHandler>();
	private readonly colors = new Map<ColorRole, Color3>();
	private readonly moveParts = new Array<BasePart>();
	private readonly moveCFrames = new Array<CFrame>();
	/** The director's settings, refreshed every frame (no allocation). */
	private settings: { juice: Readonly<JuiceSettings>; buildFx: BuildFxLevel } | undefined;
	private beams: FxPartPool | undefined;
	private rings: FxPartPool | undefined;
	private flashes: FxPartPool | undefined;
	private hadRun = false;

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
		private readonly particles: ParticleController,
	) {}

	onStart(): void {
		const folder = this.janitor.Add(fxFolder(FOLDER_NAME));
		this.beams = new FxPartPool(folder, "SparkBeam", Enum.PartType.Block);
		this.rings = new FxPartPool(folder, "Ring", Enum.PartType.Block);
		this.flashes = new FxPartPool(folder, "Execute", Enum.PartType.Cylinder);
		this.fx.onFrame((_, juice) => this.frame(juice));
	}

	/** Every rendered frame's build-effects output, after the director stepped. */
	onFrame(handler: BuildFxFrameHandler): void {
		this.handlers.push(handler);
	}

	/** Pooled parts (beam segments, ring segments, execute discs). */
	getPoolSizes(): [number, number, number] {
		return [this.beams?.size() ?? 0, this.rings?.size() ?? 0, this.flashes?.size() ?? 0];
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
				this.director.resetAll();
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
		const quiet = comboQuiet(this.sim.isInputCovered(), this.sim.isRunOver());
		const out = this.director.frame(
			ctx.run.builds,
			ctx.run.state,
			this.sim.getViewPlayerIndex(),
			quiet,
			settings,
			os.clock(),
		);
		for (const b of out.sparkBursts) this.particles.buildSparkBurst(b.x, b.z, out.burstShape, b.seed);
		for (const b of out.phantomBursts) this.particles.buildPhantomBurst(b.x, b.z, out.phantomShape, b.seed);
		this.draw(out);
		for (const handler of this.handlers) handler(out);
	}

	private draw(out: Readonly<BuildFxFrame> | undefined): void {
		const beams = this.beams;
		const rings = this.rings;
		const flashes = this.flashes;
		if (beams === undefined || rings === undefined || flashes === undefined) return;
		const mp = this.moveParts;
		const mc = this.moveCFrames;
		mp.clear();
		mc.clear();
		beams.begin();
		rings.begin();
		flashes.begin();
		if (out !== undefined) {
			this.drawBeams(out, beams);
			for (const r of out.rings) this.drawRing(r, rings);
			this.drawFlashes(out, flashes);
		}
		beams.end(mp, mc);
		rings.end(mp, mc);
		flashes.end(mp, mc);
		if (mp.size() > 0) Workspace.BulkMoveTo(mp, mc, Enum.BulkMoveMode.FireCFrameChanged);
	}

	private drawBeams(out: Readonly<BuildFxFrame>, pool: FxPartPool): void {
		const b = BUILD_FX_VIEW.beam;
		const y = floorStudsY() + b.liftStuds;
		const color = this.color("build.spark");
		for (const beam of out.beams) {
			const pts = beam.points;
			const alpha = 1 - beam.fade;
			const thickness = beam.fork ? b.thicknessStuds * b.forkThicknessShare : b.thicknessStuds;
			for (let i = 1; i < pts.size(); i++) {
				const a = new Vector3(studsX(pts[i - 1].x), y, studsZ(pts[i - 1].z));
				const c = new Vector3(studsX(pts[i].x), y, studsZ(pts[i].z));
				const len = a.sub(c).Magnitude;
				if (len <= 0) continue;
				const cf = CFrame.lookAt(a.add(c).mul(0.5), c);
				pool.place(cf, new Vector3(thickness, thickness, len), color, alpha, this.moveParts, this.moveCFrames);
			}
		}
	}

	/** A ring of `r.segments` flat segments (chords) around (r.x, r.z) at r.radius. */
	private drawRing(r: Readonly<RingView>, pool: FxPartPool): void {
		const look = buildRingBlock(r.look);
		const n = r.segments;
		const radius = r.radius * STUDS_PER_TILE;
		if (n <= 0 || radius <= 0) return;
		const y = floorStudsY() + look.liftStuds;
		const cx = studsX(r.x);
		const cz = studsZ(r.z);
		const chord = 2 * radius * math.sin(math.pi / n);
		const size = new Vector3(look.widthStuds, look.thicknessStuds, chord);
		const color = this.color(r.role);
		const alpha = 1 - r.fade;
		for (let i = 0; i < n; i++) {
			const angle = (FULL_TURN * (i + 0.5)) / n;
			const px = cx + radius * math.cos(angle);
			const pz = cz + radius * math.sin(angle);
			// The chord runs along the tangent: look along (-sin, cos).
			const cf = CFrame.lookAlong(new Vector3(px, y, pz), new Vector3(-math.sin(angle), 0, math.cos(angle)));
			pool.place(cf, size, color, alpha, this.moveParts, this.moveCFrames);
		}
	}

	private drawFlashes(out: Readonly<BuildFxFrame>, pool: FxPartPool): void {
		const e = BUILD_FX_VIEW.execute;
		const y = floorStudsY() + e.liftStuds + e.thicknessStuds / 2;
		const color = this.color(e.role);
		for (const f of out.flashes) {
			const d = e.diameterTiles * STUDS_PER_TILE * f.scale;
			const cf = new CFrame(studsX(f.x), y, studsZ(f.z)).mul(FLAT);
			pool.place(cf, new Vector3(e.thicknessStuds, d, d), color, 1 - f.fade, this.moveParts, this.moveCFrames);
		}
	}
}

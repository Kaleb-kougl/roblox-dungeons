import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { RunService } from "@rbxts/services";
import { HUD_FONT } from "client/ui/theme";
import { RENDER_ORDER } from "shared/view";
import {
	FX_VIEW,
	SCORE_POP_BASE_PX,
	SCORE_POP_FOLDER,
	SCORE_POP_GLYPH_PX,
	ScorePopPool,
	SimClock,
	motionScale,
	scorePopAlpha,
	scorePopRise,
} from "shared/view/fx";
import { HUD_STRINGS } from "shared/view/hud";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { FxTrackerController } from "./FxTrackerController";
import { attachmentHolder, floorPoint, fxFolder } from "./fxHelpers";

const RENDER_STEP = "KV_ScorePops";
const PX = FX_VIEW.pxStuds;
const HIDDEN = 1;

/** One pooled pop: a BillboardGui with a TextLabel in the HUD font. */
class PopView {
	readonly att: Attachment;
	readonly gui: BillboardGui;
	readonly label: TextLabel;
	shown = false;
	text = "";
	alpha = -1;
	rise = -1;

	constructor(holder: BasePart, parent: Instance, index: number, color: Color3, stroke: Color3) {
		this.att = new Instance("Attachment");
		this.att.Name = `Pop${index}`;
		this.att.Parent = holder;
		const gui = new Instance("BillboardGui");
		gui.Name = `Pop${index}`;
		gui.Adornee = this.att;
		gui.AlwaysOnTop = true;
		gui.LightInfluence = 0;
		gui.MaxDistance = math.huge;
		gui.Enabled = false;
		const label = new Instance("TextLabel");
		label.BackgroundTransparency = HIDDEN;
		label.Size = UDim2.fromScale(1, 1);
		label.Font = HUD_FONT;
		label.TextScaled = true;
		label.TextColor3 = color;
		label.TextStrokeColor3 = stroke;
		label.Parent = gui;
		this.gui = gui;
		this.label = label;
		gui.Parent = parent;
	}

	hide(): void {
		if (!this.shown) return;
		this.shown = false;
		this.gui.Enabled = false;
	}
}

/**
 * Floating score pops (M2 scoring): "+points" (theme string hud.score.pop, uiAccent) over the spot each enemy died,
 * rising and fading (shared/view/fx scorePops.ts). Only scored runs produce pops (LiveRun.scorePops); off with the
 * damageNumbers setting; no rise under reducedMotion. Ages on sim time: pops hold still during pause and the freeze
 * frame. Read-only on the sim.
 */
@Controller({})
export class ScorePopController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly pool = new ScorePopPool();
	private readonly clock = new SimClock();
	private readonly views = new Array<PopView>();

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
	) {}

	onStart(): void {
		const pack = this.theme.getPack();
		const folder = this.janitor.Add(fxFolder(SCORE_POP_FOLDER));
		const holder = attachmentHolder(folder, "Anchors");
		const color = pack.color("uiAccent");
		const stroke = pack.color("background");
		for (let i = 0; i < this.pool.capacity; i++) this.views.push(new PopView(holder, folder, i, color, stroke));

		this.sim.onRunStarted(() => {
			this.pool.clear();
			this.clock.reset();
		});
		RunService.BindToRenderStep(RENDER_STEP, Enum.RenderPriority.Camera.Value + RENDER_ORDER.viewsAfterCamera, () =>
			this.frame(),
		);
		this.janitor.Add(() => RunService.UnbindFromRenderStep(RENDER_STEP), true);
	}

	private frame(): void {
		const ctx = this.sim.getContext();
		if (ctx === undefined) return;
		const run = ctx.run;
		const now = this.clock.update(run.state.tick, this.sim.getAlpha());
		const settings = this.fx.settings();
		const pool = this.pool;
		if (!settings.damageNumbers) {
			pool.clear();
		} else {
			for (const p of run.scorePops) pool.add(p.x, p.z, p.points, now);
		}
		pool.expire(now);
		const motion = motionScale(settings);
		for (let i = 0; i < pool.capacity; i++) {
			const view = this.views[i];
			const alpha = pool.live[i] !== 0 ? scorePopAlpha(now - pool.born[i]) : 0;
			if (alpha <= 0) {
				view.hide();
				continue;
			}
			const text = this.theme.getPack().str(HUD_STRINGS.scorePop, { points: pool.points[i] });
			if (text !== view.text) {
				view.text = text;
				view.label.Text = text;
				const w = math.max(text.size(), 1) * SCORE_POP_GLYPH_PX.w;
				view.gui.Size = new UDim2(w * PX, 0, SCORE_POP_GLYPH_PX.h * PX, 0);
			}
			view.att.WorldPosition = floorPoint(pool.x[i], pool.z[i]);
			const rise = scorePopRise(now - pool.born[i], motion);
			if (!view.shown || rise !== view.rise) {
				view.rise = rise;
				view.gui.StudsOffset = new Vector3(0, (SCORE_POP_BASE_PX + rise + SCORE_POP_GLYPH_PX.h / 2) * PX, 0);
			}
			if (!view.shown) {
				view.shown = true;
				view.gui.Enabled = true;
			}
			if (alpha !== view.alpha) {
				view.alpha = alpha;
				view.label.TextTransparency = HIDDEN - alpha;
				view.label.TextStrokeTransparency = HIDDEN - alpha * (HIDDEN - FX_VIEW.numberStroke);
			}
		}
	}
}

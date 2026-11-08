import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { RunService } from "@rbxts/services";
import { createKvBillboardGui } from "client/ui";
import { currentHudFont, onLocaleChanged } from "client/ui/theme";
import { charCount } from "shared/l10n";
import { RENDER_ORDER } from "shared/view";
import {
	BUILDS_V2_FX,
	FX_VIEW,
	OvercapPops,
	SCORE_POP_BASE_PX,
	SCORE_POP_GLYPH_PX,
	comboQuiet,
	motionScale,
	overcapPopRise,
	type OvercapPopView,
} from "shared/view/fx";
import { HUD_STRINGS, overcapPopBox, overcapPopDucked, overcapPopOpacity, type ShoutBox } from "shared/view/hud";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { FxTrackerController } from "./FxTrackerController";
import { attachmentHolder, floorPoint, fxFolder } from "./fxHelpers";

const RENDER_STEP = "KV_OvercapPops";
const FOLDER_NAME = "KV_OvercapPops";
const PX = FX_VIEW.pxStuds;
const HIDDEN = 1;

/** One pooled overcap pop: a BillboardGui with a TextLabel in the HUD font (ScorePopController's PopView). */
class OvercapPopLabel {
	readonly att: Attachment;
	readonly gui: BillboardGui;
	readonly label: TextLabel;
	shown = false;
	text = "";
	chars = 1;
	alpha = -1;
	rise = -1;
	/** The pop and version its label was built for (rebuilt when either changes). */
	pop: OvercapPopView | undefined;
	version = -1;

	constructor(holder: BasePart, parent: Instance, name: string, color: Color3, stroke: Color3) {
		this.att = new Instance("Attachment");
		this.att.Name = name;
		this.att.Parent = holder;
		const gui = createKvBillboardGui(name);
		gui.Adornee = this.att;
		gui.AlwaysOnTop = true;
		gui.LightInfluence = 0;
		gui.MaxDistance = math.huge;
		gui.Enabled = false;
		const label = new Instance("TextLabel");
		label.BackgroundTransparency = HIDDEN;
		label.Size = UDim2.fromScale(1, 1);
		label.Font = currentHudFont();
		label.TextScaled = true;
		label.TextColor3 = color;
		label.TextStrokeColor3 = stroke;
		label.Parent = gui;
		this.gui = gui;
		this.label = label;
		gui.Parent = parent;
	}

	hide(): void {
		this.pop = undefined;
		if (!this.shown) return;
		this.shown = false;
		this.gui.Enabled = false;
	}
}

/**
 * Overcap pops (docs/BUILDS_V2.md BV11d; Studio checklist 10, 12): the ONE shared/view/fx OvercapPops of the client,
 * stepped once per rendered frame in the score pops' render step slot (after the camera; the sim's ticks and their
 * RunView.builds.overcaps are in) with the live state, the view player, comboQuiet and the run's alpha (sim time).
 * Each merged pop is drawn in the score pops' billboard machinery (ScorePopController's construction): a bare "+N"
 * (`hud.score.pop`) in BUILDS_V2_FX.overcap.role (build.overcap) at overcap.scale of the kill pops' glyphs, overcap.liftPx
 * over the kill pops' start and rising overcapPopRise (none under reduced motion), its opacity overcapPopOpacity: the
 * score pops' fade, a teammate's at teammateOpacity, and OVERCAP_POP_DUCK.opacity while an enemy bullet lies under the
 * floor box the label covers on screen (overcapPopBox / overcapPopDucked: never over a boss bullet). The label is
 * rebuilt only when the pop or its `version` changes (a merge grew the number). Off with the damageNumbers setting,
 * like every score pop. The run-over breakdown's Overcap row is BV9's (scoreBreakdownRows). Presentation only.
 */
@Controller({})
export class OvercapPopController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly planner = new OvercapPops();
	private readonly labels = new Array<OvercapPopLabel>();
	private readonly box: ShoutBox = { x: 0, z: 0, rightX: 0, rightZ: 0, halfWidth: 0, halfDepth: 0 };

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
	) {}

	onStart(): void {
		const pack = this.theme.getPack();
		const folder = this.janitor.Add(fxFolder(FOLDER_NAME));
		const holder = attachmentHolder(folder, "Anchors");
		const color = pack.color(BUILDS_V2_FX.overcap.role);
		const stroke = pack.color("background");
		for (let i = 0; i < BUILDS_V2_FX.overcap.maxAlive; i++)
			this.labels.push(new OvercapPopLabel(holder, folder, `Overcap${i}`, color, stroke));
		// A locale switch (docs/LOCALIZATION.md L6): every label's font, and the text rebuilt on the next frame.
		this.janitor.Add(
			onLocaleChanged(() => {
				const font = currentHudFont();
				for (const l of this.labels) {
					l.label.Font = font;
					l.version = -1;
				}
			}),
		);
		this.sim.onRunStarted(() => this.planner.resetAll());
		RunService.BindToRenderStep(RENDER_STEP, Enum.RenderPriority.Camera.Value + RENDER_ORDER.viewsAfterCamera, () =>
			this.frame(),
		);
		this.janitor.Add(() => RunService.UnbindFromRenderStep(RENDER_STEP), true);
	}

	private frame(): void {
		const ctx = this.sim.getContext();
		const settings = this.fx.settings();
		if (ctx === undefined || !settings.damageNumbers) {
			this.planner.resetAll();
			for (const l of this.labels) l.hide();
			return;
		}
		const run = ctx.run;
		const state = run.state;
		const pops = this.planner.frame(
			run.builds,
			state,
			this.sim.getViewPlayerIndex(),
			comboQuiet(this.sim.isInputCovered(), this.sim.isRunOver()),
			run.getAlpha(),
		);
		const motion = motionScale(settings);
		const o = BUILDS_V2_FX.overcap;
		const glyphW = SCORE_POP_GLYPH_PX.w * o.scale;
		const glyphH = SCORE_POP_GLYPH_PX.h * o.scale;
		const bullets = state.combat.enemyBullets;
		for (let i = 0; i < this.labels.size(); i++) {
			const view = this.labels[i];
			const p = pops[i];
			if (p === undefined) {
				view.hide();
				continue;
			}
			if (view.pop !== p || view.version !== p.version) {
				view.pop = p;
				view.version = p.version;
				const text = this.theme.getPack().str(HUD_STRINGS.scorePop, { points: p.points });
				if (text !== view.text) {
					view.text = text;
					view.label.Text = text;
					// Characters, not bytes: the template is translated (a UTF-8 letter is 2-4 bytes).
					view.chars = math.max(charCount(text), 1);
					view.gui.Size = new UDim2(view.chars * glyphW * PX, 0, glyphH * PX, 0);
				}
			}
			view.att.WorldPosition = floorPoint(p.x, p.z);
			const rise = overcapPopRise(p.ageSec, motion);
			if (!view.shown || rise !== view.rise) {
				view.rise = rise;
				view.gui.StudsOffset = new Vector3(0, (SCORE_POP_BASE_PX + o.liftPx + rise + glyphH / 2) * PX, 0);
			}
			const ducked = overcapPopDucked(overcapPopBox(this.box, p.x, p.z, view.chars, rise), bullets);
			const alpha = overcapPopOpacity(p.ageSec, p.mine, ducked);
			if (alpha <= 0) {
				view.hide();
				continue;
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

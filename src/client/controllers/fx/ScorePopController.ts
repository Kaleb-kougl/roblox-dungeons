import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { RunService } from "@rbxts/services";
import { createKvBillboardGui } from "client/ui";
import { currentHudFont, onLocaleChanged } from "client/ui/theme";
import { RENDER_ORDER } from "shared/view";
import {
	BUILD_FX_VIEW,
	FX_VIEW,
	SCORE_POP_BASE_PX,
	SCORE_POP_FOLDER,
	SCORE_POP_GLYPH_PX,
	ScorePopPool,
	SimClock,
	motionScale,
	scorePopAlpha,
	scorePopRise,
	scorePopTones,
	type ScorePopTone,
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
	/** The ScorePopTone its label is coloured for. */
	tone = 0;

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
		if (!this.shown) return;
		this.shown = false;
		this.gui.Enabled = false;
	}
}

/** One pool of pops and its views: the kill pops, or the Jackpot's big gold ones. */
interface PopLayer {
	readonly pool: ScorePopPool;
	readonly views: PopView[];
	/** Text colour per ScorePopTone (index 0 = KILL; a tone without an entry uses it). */
	readonly colors: Color3[];
	/** Glyph scale and extra start height (render px) of this layer. */
	readonly scale: number;
	readonly liftPx: number;
}

/**
 * Floating score pops (M2 scoring): "+points" (theme string hud.score.pop, uiAccent) over the spot each enemy died,
 * rising and fading (shared/view/fx scorePops.ts). Only scored runs produce pops (LiveRun.scorePops); off with the
 * damageNumbers setting; no rise under reducedMotion. Ages on sim time: pops hold still during pause and the freeze
 * frame. Read-only on the sim.
 *
 * Jackpot (docs/BUILDS.md BU8 follow-up): every RunView.builds.jackpots record pops the same "+points" in a second,
 * small pool (BUILD_FX_VIEW.jackpot: maxAlive, glyph scale, extra lift, boon.legendary's gold), with the same life,
 * fade, rise and damageNumbers gate.
 *
 * Gold Rush (docs/BUILDS.md BU6): a kill pop that matches a RunView.builds.goldRush record (scorePopTones) is that
 * kill's own pop, in the kill pool, coloured BUILD_FX_VIEW.goldRush.role instead of uiAccent (never a second pop).
 */
@Controller({})
export class ScorePopController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly clock = new SimClock();
	private readonly kills: PopLayer = { pool: new ScorePopPool(), views: [], colors: [], scale: 1, liftPx: 0 };
	private readonly jackpots: PopLayer = {
		pool: new ScorePopPool(BUILD_FX_VIEW.jackpot.maxAlive),
		views: [],
		colors: [],
		scale: BUILD_FX_VIEW.jackpot.scale,
		liftPx: BUILD_FX_VIEW.jackpot.liftPx,
	};
	/** The kill pops' tones this frame (scorePopTones, reused). */
	private readonly tones: ScorePopTone[] = [];

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
	) {}

	onStart(): void {
		const pack = this.theme.getPack();
		const folder = this.janitor.Add(fxFolder(SCORE_POP_FOLDER));
		const holder = attachmentHolder(folder, "Anchors");
		const stroke = pack.color("background");
		const kills = this.kills;
		kills.colors.push(pack.color("uiAccent"), pack.color(BUILD_FX_VIEW.goldRush.role));
		for (let i = 0; i < kills.pool.capacity; i++)
			kills.views.push(new PopView(holder, folder, `Pop${i}`, kills.colors[0], stroke));
		const jackpots = this.jackpots;
		const gold = pack.color(BUILD_FX_VIEW.jackpot.role);
		jackpots.colors.push(gold);
		for (let i = 0; i < jackpots.pool.capacity; i++)
			jackpots.views.push(new PopView(holder, folder, `Jackpot${i}`, gold, stroke));
		// A locale switch (docs/LOCALIZATION.md L6): every label's font (the text is read on each show).
		this.janitor.Add(
			onLocaleChanged(() => {
				const font = currentHudFont();
				for (const view of [...kills.views, ...jackpots.views]) view.label.Font = font;
			}),
		);

		this.sim.onRunStarted(() => {
			kills.pool.clear();
			jackpots.pool.clear();
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
		const kills = this.kills;
		const jackpots = this.jackpots;
		if (!settings.damageNumbers) {
			kills.pool.clear();
			jackpots.pool.clear();
		} else {
			const pops = run.scorePops;
			const tones = scorePopTones(pops, run.builds.goldRush, this.tones);
			for (let i = 0; i < pops.size(); i++) kills.pool.add(pops[i].x, pops[i].z, pops[i].points, now, tones[i]);
			for (const j of run.builds.jackpots) jackpots.pool.add(j.x, j.z, j.amount, now);
		}
		const motion = motionScale(settings);
		this.drawLayer(kills, now, motion);
		this.drawLayer(jackpots, now, motion);
	}

	private drawLayer(layer: PopLayer, now: number, motion: number): void {
		const pool = layer.pool;
		pool.expire(now);
		const glyphW = SCORE_POP_GLYPH_PX.w * layer.scale;
		const glyphH = SCORE_POP_GLYPH_PX.h * layer.scale;
		for (let i = 0; i < pool.capacity; i++) {
			const view = layer.views[i];
			const alpha = pool.live[i] !== 0 ? scorePopAlpha(now - pool.born[i]) : 0;
			if (alpha <= 0) {
				view.hide();
				continue;
			}
			const text = this.theme.getPack().str(HUD_STRINGS.scorePop, { points: pool.points[i] });
			if (text !== view.text) {
				view.text = text;
				view.label.Text = text;
				const w = math.max(text.size(), 1) * glyphW;
				view.gui.Size = new UDim2(w * PX, 0, glyphH * PX, 0);
			}
			view.att.WorldPosition = floorPoint(pool.x[i], pool.z[i]);
			const rise = scorePopRise(now - pool.born[i], motion);
			if (!view.shown || rise !== view.rise) {
				view.rise = rise;
				view.gui.StudsOffset = new Vector3(0, (SCORE_POP_BASE_PX + layer.liftPx + rise + glyphH / 2) * PX, 0);
			}
			const tone = pool.tone[i];
			if (tone !== view.tone) {
				view.tone = tone;
				view.label.TextColor3 = layer.colors[tone] ?? layer.colors[0];
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

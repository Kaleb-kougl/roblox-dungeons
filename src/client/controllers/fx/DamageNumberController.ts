import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { RunService } from "@rbxts/services";
import { HUD_FONT } from "client/ui/theme";
import { RENDER_ORDER } from "shared/view";
import {
	CAP_HEIGHT,
	CAP_SIDE_PX,
	DamageNumberPool,
	FX_VIEW,
	NumberStyle,
	SimClock,
	motionScale,
	numberAlpha,
	numberBaseY,
	numberRise,
	numberScale,
	numberText,
	type ActorSizeCache,
} from "shared/view/fx";
import { HUD_STRINGS } from "shared/view/hud";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { FxTrackerController } from "./FxTrackerController";
import { attachmentHolder, floorPoint, fxFolder, placeholderSizeCache } from "./fxHelpers";

const RENDER_STEP = "KV_DamageNumbers";
const PX = FX_VIEW.pxStuds;
const HIDDEN = 1;

/** One pooled number: a BillboardGui with a TextLabel in the HUD font. */
class NumberView {
	readonly att: Attachment;
	readonly gui: BillboardGui;
	readonly label: TextLabel;
	shown = false;
	text = "";
	style = -1;
	scale = -1;
	alpha = -1;
	dx = 0 / 0;
	dy = 0 / 0;

	constructor(holder: BasePart, parent: Instance, index: number, stroke: Color3) {
		this.att = new Instance("Attachment");
		this.att.Name = `Number${index}`;
		this.att.Parent = holder;
		const gui = new Instance("BillboardGui");
		gui.Name = `Number${index}`;
		gui.Adornee = this.att;
		gui.AlwaysOnTop = true;
		gui.LightInfluence = 0;
		gui.MaxDistance = math.huge;
		gui.Enabled = false;
		const label = new Instance("TextLabel");
		label.BackgroundTransparency = 1;
		label.Size = UDim2.fromScale(1, 1);
		label.Font = HUD_FONT;
		label.TextScaled = true;
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
 * Floating damage numbers (port of project-kaleb-vale src/fx/numbers/DamageNumbersView.tsx @ 42897e2): a pool of
 * NUMBER_POOL_SIZE BillboardGuis (one TextLabel each, the HUD font token; the theme's `ui.font.digits` strip is a
 * placeholder, so digits are drawn as text):
 *
 *   'hit'     a number (damageNumber; damageHeavy at 2x for heavy hits) pops over the actor's head, rises and fades;
 *             hits on the same actor within MERGE_WINDOW add up in one number (shared/view/fx numbers.ts). Bosses too.
 *   capped    a 'capped' event or a capped boss hit shows a small damageCapped "CAP" (theme string fx.cap) beside the
 *             boss, at most once per CAP_THROTTLE.
 *
 * On when the damageNumbers setting is; under reducedMotion numbers appear and fade in place (no jitter, rise or pop).
 * Ages on sim time (SimClock): numbers hold still during pause and the freeze frame. Read-only on the sim.
 */
@Controller({})
export class DamageNumberController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly pool = new DamageNumberPool();
	private readonly clock = new SimClock();
	private readonly views = new Array<NumberView>();
	private sizes: ActorSizeCache | undefined;
	private colors: Color3[] = [];
	private capText = "";

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
	) {}

	onStart(): void {
		const pack = this.theme.getPack();
		this.sizes = placeholderSizeCache(pack);
		// Indexed by NumberStyle: NORMAL, HEAVY, CAP.
		this.colors = [pack.color("damageNumber"), pack.color("damageHeavy"), pack.color("damageCapped")];
		this.capText = pack.str(HUD_STRINGS.cap);
		const folder = this.janitor.Add(fxFolder(FX_VIEW.numberFolder));
		const holder = attachmentHolder(folder, "Anchors");
		const stroke = pack.color("background");
		for (let i = 0; i < this.pool.capacity; i++) this.views.push(new NumberView(holder, folder, i, stroke));

		this.fx.onEvent((e, settings) => {
			if (e.type === "reset") {
				this.pool.clear();
				this.clock.reset();
				return;
			}
			if (e.type !== "hit" && e.type !== "capped") return;
			if (!settings.damageNumbers) return;
			const now = this.clock.update(this.sim.getState()?.tick ?? 0, this.sim.getAlpha());
			if (e.type === "capped") {
				this.showCap(e.slot, e.actorId, e.kind, e.x, e.z, now);
				return;
			}
			const size = this.sizes!.get(e.kind);
			const baseY = numberBaseY(size.h, size.boss);
			this.pool.hit(e.slot, e.actorId, e.x, e.z, e.damage, e.heavy, baseY, now, motionScale(settings));
			if (e.capped && e.boss) this.showCap(e.slot, e.actorId, e.kind, e.x, e.z, now);
		});

		RunService.BindToRenderStep(RENDER_STEP, Enum.RenderPriority.Camera.Value + RENDER_ORDER.viewsAfterCamera, () =>
			this.frame(),
		);
		this.janitor.Add(() => RunService.UnbindFromRenderStep(RENDER_STEP), true);
	}

	private showCap(slot: number, actorId: number, kind: number, x: number, z: number, now: number): void {
		const size = this.sizes!.get(kind);
		const dx = math.floor(size.w / 2) + CAP_SIDE_PX;
		this.pool.cap(slot, actorId, x, z, dx, math.round(size.h * CAP_HEIGHT), now);
	}

	private frame(): void {
		const state = this.sim.getState();
		if (state === undefined) return;
		const now = this.clock.update(state.tick, this.sim.getAlpha());
		const settings = this.fx.settings();
		const pool = this.pool;
		if (!settings.damageNumbers) pool.clear();
		const motion = motionScale(settings);
		pool.expire(now);
		for (let i = 0; i < pool.capacity; i++) {
			const view = this.views[i];
			if (pool.live[i] === 0) {
				view.hide();
				continue;
			}
			const age = now - pool.born[i];
			const alpha = numberAlpha(age);
			if (alpha <= 0) {
				view.hide();
				continue;
			}
			const style = pool.style[i];
			const scale = numberScale(style, age, motion);
			const dy = pool.dy[i] + numberRise(age, motion);
			const dx = pool.dx[i];
			view.att.WorldPosition = floorPoint(pool.x[i], pool.z[i]);
			if (!view.shown) {
				view.shown = true;
				view.gui.Enabled = true;
			}
			const text = numberText(style, pool.value[i], this.capText);
			const textChanged = text !== view.text;
			const sizeChanged = textChanged || scale !== view.scale;
			if (textChanged) view.label.Text = text;
			if (style !== view.style) view.label.TextColor3 = this.colors[style] ?? this.colors[NumberStyle.NORMAL];
			const glyphs = math.max(text.size(), 1);
			const w = glyphs * FX_VIEW.glyphAdvancePx * scale;
			const h = FX_VIEW.glyphHeightPx * scale;
			if (sizeChanged) view.gui.Size = new UDim2(w * PX, 0, h * PX, 0);
			view.text = text;
			view.style = style;
			view.scale = scale;
			if (sizeChanged || dx !== view.dx || dy !== view.dy) {
				// CAP sits beside the boss (left-aligned at dx); numbers are centred on the anchor.
				const cx = style === NumberStyle.CAP ? dx + w / 2 : dx;
				view.gui.StudsOffset = new Vector3(cx * PX, (dy + h / 2) * PX, 0);
				view.dx = dx;
				view.dy = dy;
			}
			if (alpha !== view.alpha) {
				view.alpha = alpha;
				view.label.TextTransparency = HIDDEN - alpha;
				view.label.TextStrokeTransparency = HIDDEN - alpha * (HIDDEN - FX_VIEW.numberStroke);
			}
		}
	}
}

import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { RunService } from "@rbxts/services";
import { createKvBillboardGui } from "client/ui";
import { HUD_FONT } from "client/ui/theme";
import { AffixKind, affixThemeIndex } from "shared/dungeon";
import { MAX_ACTORS, NO_KIND, archetypeAt, roomAt } from "shared/sim";
import { AFFIX_IDS, ENEMY_SHIELD_ROLE, affixRole, type ThemePack } from "shared/theme";
import {
	RENDER_ORDER,
	affixChipKey,
	affixChipRect,
	affixDrawScale,
	affixSlotView,
	createBarRect,
	eliteView,
	shieldRowRect,
	type BarRect,
} from "shared/view";
import {
	FX_VIEW,
	HealthBarSlots,
	SimClock,
	barGeometry,
	createBarGeometry,
	motionScale,
	pipLeft,
	segmentWidth,
	type ActorSizeCache,
	type BarGeometry,
} from "shared/view/fx";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { FxTrackerController } from "./FxTrackerController";
import { attachmentHolder, floorPoint, fxFolder, placeholderSizeCache } from "./fxHelpers";

const RENDER_STEP = "KV_HealthBars";
const PX = FX_VIEW.pxStuds;
/** Most pips a bar shows (PIP_MAX_HP). */
const MAX_PIPS = 4;
const HIDDEN = 1;

interface BarColors {
	readonly fill: Color3;
	readonly chip: Color3;
	readonly back: Color3;
	readonly elite: Color3;
	readonly flash: Color3;
	/** Elite affixes (docs/ENEMY_VARIANTS.md EV9): the shield row, and `affix.<id>` per AFFIX_IDS index (the chip). */
	readonly shield: Color3;
	readonly affix: ReadonlyArray<Color3>;
}

/** What a bar shows of its actor's affix this frame (reused). */
interface BarAffix {
	/** AFFIX_IDS index (-1: none) and the chip's text. */
	index: number;
	text: string;
	/** Shielded: shield / shieldMax (shieldMax 0: no shield row). */
	shield: number;
	shieldMax: number;
}

function frame(parent: Instance, name: string, color: Color3): Frame {
	const f = new Instance("Frame");
	f.Name = name;
	f.BorderSizePixel = 0;
	f.BackgroundColor3 = color;
	f.Parent = parent;
	return f;
}

/** One pooled bar: a BillboardGui at the actor's feet (camera-space offset up to the bar), plate + chip + fill / pips. */
class BarView {
	readonly att: Attachment;
	readonly gui: BillboardGui;
	private readonly plate: Frame;
	private readonly inner: Frame;
	private readonly chip: Frame;
	private readonly fill: Frame;
	private readonly pips: Frame[] = [];
	private shown = false;
	// Layout cache (rebuilt only when it changes).
	private layoutPips = -1;
	private layoutInnerW = -1;
	private layoutPlateBottom = -1;
	private layoutElite = false;
	private lastDx = 0 / 0;
	private lastVis = -1;
	private lastChipW = -1;
	private lastFillW = -1;
	private lastFlash = false;
	private lastHp = -1;
	private lastChipHp = -1;
	/** The affix rows (docs/ENEMY_VARIANTS.md EV9): the name chip over the bar and the shield row on the plate. */
	private readonly affixLabel: TextLabel;
	private readonly shieldRow: Frame;
	private readonly rect: BarRect = createBarRect();
	private lastAffix = -2;
	private lastShieldW = -1;
	private lastShieldRow = false;
	private lastAffixVis = -1;

	constructor(holder: BasePart, parent: Instance, index: number, colors: BarColors) {
		this.att = new Instance("Attachment");
		this.att.Name = `Bar${index}`;
		this.att.Parent = holder;
		const gui = createKvBillboardGui(`Bar${index}`);
		gui.Adornee = this.att;
		gui.AlwaysOnTop = true;
		gui.LightInfluence = 0;
		gui.ResetOnSpawn = false;
		gui.ClipsDescendants = false;
		gui.MaxDistance = math.huge;
		gui.Enabled = false;
		gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling;
		this.gui = gui;
		this.plate = frame(gui, "Plate", colors.back);
		this.plate.Size = UDim2.fromScale(1, 1);
		this.inner = frame(gui, "Inner", colors.back);
		this.inner.ZIndex = 2;
		this.chip = frame(gui, "Chip", colors.chip);
		this.chip.ZIndex = 3;
		this.fill = frame(gui, "Fill", colors.fill);
		this.fill.ZIndex = 4;
		for (let p = 0; p < MAX_PIPS; p++) {
			const pip = frame(gui, `Pip${p}`, colors.fill);
			pip.ZIndex = 3;
			pip.Visible = false;
			this.pips.push(pip);
		}
		this.shieldRow = frame(gui, "Shield", colors.shield);
		this.shieldRow.ZIndex = 5;
		this.shieldRow.Visible = false;
		const label = new Instance("TextLabel");
		label.Name = "Affix";
		label.BackgroundTransparency = HIDDEN;
		label.BorderSizePixel = 0;
		label.Font = HUD_FONT;
		label.TextScaled = true;
		label.TextStrokeColor3 = colors.back;
		label.ZIndex = 6;
		label.Visible = false;
		label.Parent = gui;
		this.affixLabel = label;
		gui.Parent = parent;
	}

	/**
	 * The affix rows over the bar: the shield row (enemyShield, shield / shieldMax of the inner row) on top of the plate
	 * and the name chip above it in the affix's colour (shared/view shieldRowRect / affixChipRect). Written on change.
	 */
	private drawAffix(g: Readonly<BarGeometry>, affix: Readonly<BarAffix>, vis: number, colors: BarColors): void {
		const hasRow = affix.shieldMax > 0;
		const rowW = hasRow ? shieldRowRect(g, affix.shield, affix.shieldMax, this.rect).w : 0;
		if (rowW !== this.lastShieldW || hasRow !== this.lastShieldRow) {
			this.lastShieldW = rowW;
			this.shieldRow.Visible = rowW > 0;
			if (rowW > 0) {
				const r = this.rect;
				this.place(this.shieldRow, g, r.left, r.bottom, r.w, r.h);
			}
		}
		if (affix.index !== this.lastAffix || hasRow !== this.lastShieldRow) {
			this.lastAffix = affix.index;
			const shown = affix.index >= 0;
			this.affixLabel.Visible = shown;
			if (shown) {
				this.affixLabel.Text = affix.text;
				this.affixLabel.TextColor3 = colors.affix[affix.index] ?? colors.flash;
				const r = affixChipRect(g, hasRow, this.rect);
				this.place(this.affixLabel, g, r.left, r.bottom, r.w, r.h);
			}
		}
		this.lastShieldRow = hasRow;
		if (vis !== this.lastAffixVis) {
			this.lastAffixVis = vis;
			this.shieldRow.BackgroundTransparency = HIDDEN - vis;
			this.affixLabel.TextTransparency = HIDDEN - vis;
			this.affixLabel.TextStrokeTransparency = HIDDEN - vis;
		}
	}

	hide(): void {
		if (!this.shown) return;
		this.shown = false;
		this.gui.Enabled = false;
	}

	/** Place a child rect (px, relative to the feet anchor, y up) inside the plate. */
	private place(f: GuiObject, g: Readonly<BarGeometry>, left: number, bottom: number, w: number, h: number): void {
		const top = g.plateBottom + g.plateH;
		f.Position = UDim2.fromScale((left - g.plateLeft) / g.plateW, (top - (bottom + h)) / g.plateH);
		f.Size = UDim2.fromScale(w / g.plateW, h / g.plateH);
	}

	private layout(g: Readonly<BarGeometry>, elite: boolean, colors: BarColors): void {
		if (
			this.layoutPips === g.pips &&
			this.layoutInnerW === g.innerW &&
			this.layoutPlateBottom === g.plateBottom &&
			this.layoutElite === elite
		) {
			return;
		}
		this.layoutPips = g.pips;
		this.layoutInnerW = g.innerW;
		this.layoutPlateBottom = g.plateBottom;
		this.layoutElite = elite;
		this.gui.Size = new UDim2(g.plateW * PX, 0, g.plateH * PX, 0);
		this.plate.BackgroundColor3 = elite ? colors.elite : colors.back;
		this.inner.Visible = elite;
		if (elite) this.place(this.inner, g, g.innerLeft, g.innerBottom, g.innerW, g.plateH - 2);
		const usePips = g.pips > 0;
		this.chip.Visible = !usePips;
		this.fill.Visible = !usePips;
		for (let p = 0; p < MAX_PIPS; p++) {
			const pip = this.pips[p];
			pip.Visible = usePips && p < g.pips;
			if (pip.Visible) this.place(pip, g, pipLeft(g, p), g.innerBottom, g.pipW, g.plateH - 2);
		}
		this.lastChipW = -1;
		this.lastFillW = -1;
		this.lastHp = -1;
		this.lastVis = -1;
		this.lastDx = 0 / 0;
		this.lastAffix = -2;
		this.lastShieldW = -1;
		this.lastAffixVis = -1;
	}

	draw(
		pos: Vector3,
		g: Readonly<BarGeometry>,
		elite: boolean,
		hp: number,
		chip: number,
		hpMax: number,
		vis: number,
		dx: number,
		flash: boolean,
		colors: BarColors,
		affix: Readonly<BarAffix>,
	): void {
		this.layout(g, elite, colors);
		this.drawAffix(g, affix, vis, colors);
		this.att.WorldPosition = pos;
		if (!this.shown) {
			this.shown = true;
			this.gui.Enabled = true;
		}
		if (dx !== this.lastDx) {
			this.lastDx = dx;
			this.gui.StudsOffset = new Vector3(
				(g.plateLeft + g.plateW / 2 + dx) * PX,
				(g.plateBottom + g.plateH / 2) * PX,
				0,
			);
		}
		const visChanged = vis !== this.lastVis;
		if (visChanged) {
			this.lastVis = vis;
			this.plate.BackgroundTransparency = HIDDEN - vis;
			this.inner.BackgroundTransparency = HIDDEN - vis;
			this.chip.BackgroundTransparency = HIDDEN - vis;
			this.fill.BackgroundTransparency = HIDDEN - vis;
		}
		if (g.pips > 0) {
			if (!visChanged && hp === this.lastHp && chip === this.lastChipHp && flash === this.lastFlash) return;
			this.lastHp = hp;
			this.lastChipHp = chip;
			this.lastFlash = flash;
			for (let p = 0; p < g.pips; p++) {
				const pip = this.pips[p];
				if (hp > p) {
					pip.BackgroundColor3 = flash ? colors.flash : colors.fill;
					pip.BackgroundTransparency = HIDDEN - vis;
				} else if (chip > p) {
					pip.BackgroundColor3 = colors.chip;
					pip.BackgroundTransparency = HIDDEN - vis;
				} else {
					pip.BackgroundColor3 = colors.fill;
					pip.BackgroundTransparency = HIDDEN - vis * FX_VIEW.emptyPipAlpha;
				}
			}
			return;
		}
		const chipW = segmentWidth(g.innerW, chip, hpMax);
		const fillW = segmentWidth(g.innerW, hp, hpMax);
		if (chipW !== this.lastChipW || fillW !== this.lastFillW) {
			this.lastChipW = chipW;
			this.lastFillW = fillW;
			this.chip.Visible = chipW > fillW;
			if (chipW > fillW)
				this.place(this.chip, g, g.innerLeft + fillW, g.innerBottom, chipW - fillW, g.plateH - 2);
			this.fill.Visible = fillW > 0;
			if (fillW > 0) this.place(this.fill, g, g.innerLeft, g.innerBottom, fillW, g.plateH - 2);
		}
		if (flash !== this.lastFlash) {
			this.lastFlash = flash;
			this.fill.BackgroundColor3 = flash ? colors.flash : colors.fill;
		}
	}
}

/**
 * Enemy health bars (port of project-kaleb-vale src/fx/bars/HealthBarsView.tsx @ 42897e2), one pooled BillboardGui
 * per actor slot over the actor's feet, offset up the screen (camera-space StudsOffset) to the placeholder's top edge:
 *
 *   bar   enemyHealthBack plate (1 px outline), enemyHealthChip trailing chunk, enemyHealth fill: 2 px tall, width
 *         BAR_WIDTH_RATIO of the drawn width, BAR_GAP px above the drawn top (1 px = FX_VIEW.pxStuds studs)
 *   pips  enemies with hpMax <= 4 (swarmers, snipers): one pip per hp, filled / chip / empty (dim)
 *   elite enemyHealthElite outline around a dark inner row (elite room OR an elite affix, docs/ENEMY_VARIANTS.md EV9)
 *   affix the affix's name chip above the bar in `affix.<id>` (`affix.<id>.name`) and, for Shielded, a 1 px shield row
 *         in enemyShield on top of the plate (shield / shieldMax); a Hulking bar sits over its 1.2x body
 *
 * On a hit the fill drops at once, the chip holds then drains (shared/view/fx barState), the fill flashes for 2 frames
 * (uiText) and the bar shakes 1 px (not under reducedMotion). Shown per the healthBars setting ('always' | 'onDamage' |
 * 'off'); dead actors keep theirs only while the chip drains; bosses never (the HUD boss bar has theirs). Ages on sim
 * time (SimClock), so bars hold still in pause and hitstop. Read-only on the sim.
 */
@Controller({})
export class HealthBarController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly slots = new HealthBarSlots(MAX_ACTORS);
	private readonly clock = new SimClock();
	private readonly geom = createBarGeometry();
	private readonly views = new Array<BarView>();
	private sizes: ActorSizeCache | undefined;
	private colors: BarColors | undefined;
	/** The affix chip texts (`affix.<id>.name`, AFFIX_IDS order) and this frame's affix of the bar being drawn. */
	private affixTexts = new Array<string>();
	private readonly affix: BarAffix = { index: -1, text: "", shield: 0, shieldMax: 0 };

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
	) {}

	onStart(): void {
		const pack: ThemePack = this.theme.getPack();
		this.sizes = placeholderSizeCache(pack);
		const colors: BarColors = {
			fill: pack.color("enemyHealth"),
			chip: pack.color("enemyHealthChip"),
			back: pack.color("enemyHealthBack"),
			elite: pack.color("enemyHealthElite"),
			flash: pack.color("uiText"),
			shield: pack.color(ENEMY_SHIELD_ROLE),
			affix: AFFIX_IDS.map((id) => pack.color(affixRole(id))),
		};
		this.colors = colors;
		this.affixTexts = AFFIX_IDS.map((_, i) => pack.str(affixChipKey(i + 1)!));
		const folder = this.janitor.Add(fxFolder(FX_VIEW.barFolder));
		const holder = attachmentHolder(folder, "Anchors");
		for (let i = 0; i < MAX_ACTORS; i++) this.views.push(new BarView(holder, folder, i, colors));

		this.fx.onEvent((e) => {
			switch (e.type) {
				case "reset":
					this.slots.clear();
					this.clock.reset();
					break;
				case "spawned":
					this.slots.release(e.slot); // re-adopted with live values in the frame pass
					break;
				case "hit": {
					if (e.boss) break;
					const now = this.clock.update(this.sim.getState()?.tick ?? 0, this.sim.getAlpha());
					this.slots.hit(e.slot, e.actorId, e.damage, e.hpAfter, e.hpMax, now, e.elite);
					this.slots.x[e.slot] = e.x;
					this.slots.z[e.slot] = e.z;
					break;
				}
				case "killed":
					this.slots.kill(e.slot, e.actorId);
					break;
				default:
					break;
			}
		});

		RunService.BindToRenderStep(RENDER_STEP, Enum.RenderPriority.Camera.Value + RENDER_ORDER.viewsAfterCamera, () =>
			this.frame(),
		);
		this.janitor.Add(() => RunService.UnbindFromRenderStep(RENDER_STEP), true);
	}

	private frame(): void {
		const ctx = this.sim.getContext();
		const sizes = this.sizes;
		const colors = this.colors;
		if (ctx === undefined || sizes === undefined || colors === undefined) return;
		const state = ctx.run.state;
		const alpha = ctx.run.getAlpha();
		const now = this.clock.update(state.tick, alpha);
		const settings = this.fx.settings();
		const mode = settings.healthBars;
		const motion = motionScale(settings);
		const encounter = ctx.config.encounter;
		const actors = state.combat.actors;
		const slots = this.slots;
		const n = math.min(actors.size(), MAX_ACTORS);

		for (let i = 0; i < MAX_ACTORS; i++) {
			const view = this.views[i];
			const a = i < n ? actors[i] : undefined;
			const present = a !== undefined && a.kind !== NO_KIND;
			// Sync the slot with the live actor (keyed by id: a reused slot never inherits the old bar).
			const affixSlot = present ? affixSlotView(state, i, a.id) : undefined;
			const affix = affixSlot?.affix ?? AffixKind.NONE;
			if (present) {
				if (slots.id[i] !== a.id || (slots.alive[i] === 0 && a.alive !== 0)) {
					// Elite plate: an elite room (runtime spawns there too, EVD15) OR an affix (EVD12).
					const eliteRoom = encounter !== undefined && roomAt(encounter, a.x, a.z)?.type === "elite";
					slots.adopt(i, a.id, a.hp, a.hpMax, a.alive !== 0, eliteView(eliteRoom, affix));
				} else if (a.alive !== 0 && a.hp > slots.hp[i]) {
					slots.heal(i, a.hp);
				}
				slots.x[i] = a.prevX + (a.x - a.prevX) * alpha;
				slots.z[i] = a.prevZ + (a.z - a.prevZ) * alpha;
			} else if (slots.id[i] !== 0 && !slots.draining(i, now)) {
				slots.release(i); // freed and fully drained
			}
			if (slots.id[i] === 0 || mode === "off") {
				view.hide();
				continue;
			}
			const size = sizes.get(present ? a.kind : -1);
			const vis = size.boss ? 0 : slots.visibility(i, mode, now);
			if (vis <= 0) {
				view.hide();
				continue;
			}
			// Hulking is drawn 1.2x: its bar sits over the bigger body.
			const scale =
				present && affix === AffixKind.HULKING ? affixDrawScale(a.radius, archetypeAt(a.kind).data.radius) : 1;
			const g = barGeometry(math.round(size.w * scale), math.ceil(size.h * scale), slots.hpMax[i], this.geom);
			const ba = this.affix;
			const k = present && a.alive !== 0 ? affixThemeIndex(affix) : -1;
			ba.index = k;
			ba.text = k >= 0 ? this.affixTexts[k] ?? "" : "";
			const shieldSlot = k >= 0 && affix === AffixKind.SHIELDED ? affixSlot : undefined;
			ba.shield = shieldSlot !== undefined ? shieldSlot.shield : 0;
			ba.shieldMax = shieldSlot !== undefined ? shieldSlot.shieldMax : 0;
			view.draw(
				floorPoint(slots.x[i], slots.z[i]),
				g,
				slots.elite[i] === 1,
				slots.hp[i],
				slots.chip(i, now),
				slots.hpMax[i],
				vis,
				slots.shake(i, now, motion),
				slots.flashing(i, now),
				colors,
				ba,
			);
		}
	}
}

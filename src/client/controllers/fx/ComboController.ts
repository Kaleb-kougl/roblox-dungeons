import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { Workspace } from "@rbxts/services";
import { COMBO_UI, HUD_FONT, resetComboUi } from "client/ui";
import { CAMERA_YAW_DEG, STUDS_PER_TILE } from "shared/config";
import { COMBO_MIN, TILE_SIZE, partySize, playerAt, teamComboWindowTicks, type SimState } from "shared/sim";
import type { JuiceSettings } from "shared/settings";
import type { ColorRole, ThemePack } from "shared/theme";
import { degToRad, floorStudsY, lerp, studsX, studsZ } from "shared/view";
import { FX_SPRITE_VIEW, FX_VIEW, screenShakeOn } from "shared/view/fx";
import {
	COMBO_BROKEN_ROLE,
	COMBO_DEBUG,
	COMBO_FLASH_ROLES,
	COMBO_SHOUT,
	COMBO_SHOUT_DRAW,
	COMBO_STRINGS,
	COMBO_TIERS,
	COMBO_TOP_TIER,
	ComboDisplay,
	ComboShout,
	HUD_STRINGS,
	comboDropText,
	comboMultRichText,
	comboShoutText,
	floorAxes,
	formatCombo,
	shoutBoxAt,
	shoutCanvasSize,
	shoutDucked,
	type ComboDisplayCut,
	type ComboDisplayEvents,
	type ComboDisplayFrame,
	type ComboDisplayInput,
	type ComboDisplayReset,
	type ShoutBox,
} from "shared/view/hud";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { renderPart } from "../render/placeholders";
import { FreezeFrameController } from "./FreezeFrameController";
import { FxTrackerController } from "./FxTrackerController";
import { fxFolder } from "./fxHelpers";

const HIDDEN = 1;
const PARKED = new CFrame(FX_VIEW.parkedStuds[0], FX_VIEW.parkedStuds[1], FX_VIEW.parkedStuds[2]);
const CAMERA_YAW = CFrame.Angles(0, degToRad(CAMERA_YAW_DEG), 0);
const AXES = floorAxes();
const NO_CUTS: ReadonlyArray<ComboDisplayCut> = [];

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** What KV_ComboDebug can force (COMBO_DEBUG). */
type ComboDebugKind = "tier" | "break" | "small" | "lapse" | "cut";

/**
 * The combo's per-frame view (docs/COMBO.md CB7). Once per rendered frame (an FxTrackerController frame handler, after
 * the frame's sim ticks) on a scored run it steps ONE ComboDisplay (shared/view/hud combo.ts) with the real frame dt,
 * the live `state.score` combo and timer, the team's combo window (shared/sim teamComboWindowTicks, as the snapshot
 * reads it), the frame's combo events (`RunView.combo`, CB1), the stage cover (SimController.isInputCovered: the cover
 * and its fade), the end of the run (the solo LiveRun's outcome / the co-op client's isOver) and the juice settings
 * (reduced motion; Screen shake through screenShakeOn), then:
 *   - writes COMBO_UI (client/ui/hud comboUi.ts), the score panel's combo row and meter bindings, each only when its
 *     value changed: theme strings (the multiplier, the tier slot, the crack's drop) are rebuilt only when what they
 *     show changed, colours are the display's role lerped toward combo.broken by greyMix (the meter's pulse a further
 *     lerp toward uiText), and the shatter's pieces take the fill and colour of the frame before the break;
 *   - on the `kick` edge asks FreezeFrameController for the `comboBreak` camera nudge (1 texel down, below hurt);
 *   - on a `tierUp` edge starts the floor shout (CD9): "RAMPAGE!" (the tier's name + COMBO_SHOUT_DRAW.bang) painted on
 *     the floor COMBO_SHOUT.offsetTiles up-screen of the view player's feet (SimController.getViewPlayerIndex: the
 *     watched teammate while spectating), following them, timed by ComboShout (shared/view/hud comboDraw.ts: fade,
 *     slide, duck). It is ONE SurfaceGui on the Top face of a thin invisible floor Part, built once and reused (a new
 *     tier-up replaces a showing one), on FxSpriteController's "floor" placement (yawed by the camera, its own layer
 *     just under the sprite effects' layers: COMBO_SHOUT_DRAW.layerStepsBelowEffects), so every bullet, telegraph,
 *     marking, effect and body draws over it. While it shows, one shoutDucked pass over the enemy bullet pool per frame
 *     ducks it. The stage cover and the run's end drop it.
 * An unscored run (no state.score) or no run shows nothing: the display, the shout and COMBO_UI go back to neutral
 * (ScorePanel hides itself on unscored runs as before). Presentation only, read-only on the sim. Studio aid:
 * COMBO_DEBUG.attribute (KV_ComboDebug, off by default) forces a tier-up / break / lapse / cut.
 */
@Controller({})
export class ComboController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly display = new ComboDisplay();
	private readonly shout = new ComboShout();
	private readonly box: ShoutBox = { x: 0, z: 0, rightX: 0, rightZ: 0, halfWidth: 0, halfDepth: 0 };
	private readonly input: Mutable<ComboDisplayInput>;
	private readonly debugEvents: Mutable<ComboDisplayEvents> = {
		startCombo: COMBO_MIN,
		endCombo: COMBO_MIN,
		peak: COMBO_MIN,
		kills: 0,
		grazes: 0,
		cuts: NO_CUTS,
		ended: undefined,
	};
	private readonly debugCut: Mutable<ComboDisplayCut> = { before: COMBO_MIN, after: COMBO_MIN };
	private readonly debugReset: Mutable<ComboDisplayReset> = { lost: COMBO_MIN, peak: COMBO_MIN, fight: false };
	private debugPending: ComboDebugKind | undefined;
	private debugTier = 0;
	private pack: ThemePack | undefined;
	/** Something non-neutral was drawn (cleared by off()). */
	private on = false;
	// --- the last values the strings were built from (strings only rebuild on change) ---
	private multTenths = -1;
	private multStruck = false;
	private slotKind = "";
	private slotTier = -1;
	private slotTenths = -1;
	private dropTenths = -1;
	// --- the frame before: the shatter's pieces start from it ---
	private prevFill = 0;
	private prevFillColor = new Color3();
	private prevShards = -1;
	// --- the shout's instances (one, reused) and what they last showed ---
	private part: Part | undefined;
	private surface: SurfaceGui | undefined;
	private label: TextLabel | undefined;
	private shownTier = 0;
	private shownOpacity = -1;
	private shoutVisible = false;

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
		private readonly freeze: FreezeFrameController,
	) {
		this.input = {
			dt: 0,
			combo: COMBO_MIN,
			comboTimer: 0,
			windowTicks: 0,
			events: this.debugEvents,
			covered: false,
			runOver: false,
			reducedMotion: false,
			screenShake: true,
		};
	}

	onStart(): void {
		this.pack = this.theme.getPack();
		this.buildShout(this.pack);
		this.sim.onRunStarted(() => this.off(true));
		this.sim.onRunExited(() => this.off(true));
		this.fx.onFrame((_, settings, dt) => this.frame(settings, dt));
		const readDebug = () => this.readDebug();
		this.janitor.Add(Workspace.GetAttributeChangedSignal(COMBO_DEBUG.attribute).Connect(readDebug));
	}

	// --- the frame ---------------------------------------------------------------------------------

	private frame(settings: Readonly<JuiceSettings>, dt: number): void {
		const ctx = this.sim.getContext();
		const state = ctx?.run.state;
		const score = state?.score;
		if (ctx === undefined || state === undefined || score === undefined) {
			this.off(false);
			return;
		}
		this.on = true;
		const runOver = ctx.live !== undefined ? ctx.live.outcome() !== "playing" : ctx.coop?.isOver() === true;
		const covered = this.sim.isInputCovered();
		const input = this.input;
		input.dt = dt;
		input.combo = score.combo;
		input.comboTimer = score.comboTimer;
		input.windowTicks = teamComboWindowTicks(state);
		input.events = this.takeDebugEvents(score.combo) ?? ctx.run.combo;
		input.covered = covered;
		input.runOver = runOver;
		input.reducedMotion = settings.reducedMotion;
		input.screenShake = screenShakeOn(settings);
		const look = this.display.frame(input);
		this.drawUi(look);
		if (look.kick) this.freeze.requestNudge("comboBreak");
		if (covered || runOver) this.shout.clear();
		else if (look.tierUp > 0) this.shout.start(look.tierUp);
		this.drawShout(state, ctx.run.getAlpha(), dt, settings.reducedMotion);
	}

	/** Back to neutral (no run, an unscored run; `force`: a run start / exit even if nothing showed). */
	private off(force: boolean): void {
		if (!this.on && !force) return;
		this.on = false;
		this.display.clear();
		this.shout.clear();
		this.hideShout();
		resetComboUi();
		this.multTenths = -1;
		this.multStruck = false;
		this.slotKind = "";
		this.slotTier = -1;
		this.slotTenths = -1;
		this.dropTenths = -1;
		this.prevFill = 0;
		this.prevShards = -1;
		this.debugPending = undefined;
	}

	// --- COMBO_UI -----------------------------------------------------------------------------------

	private drawUi(look: ComboDisplayFrame): void {
		const pack = this.pack;
		if (pack === undefined) return;
		const U = COMBO_UI;
		const grey = pack.color(COMBO_BROKEN_ROLE as ColorRole);
		const base = pack.color(look.role as ColorRole);
		const color = look.greyMix > 0 ? base.Lerp(grey, math.clamp(look.greyMix, 0, 1)) : base;

		if (look.tenths !== this.multTenths || look.struck !== this.multStruck) {
			this.multTenths = look.tenths;
			this.multStruck = look.struck;
			U.multText.write(comboMultRichText(this.multiplier(pack, look.tenths), look.struck));
		}
		U.multColor.write(color);
		U.scale.write(look.scale);
		U.shakePx.write(look.shakePx);
		U.shine.write(look.shine);

		if (look.slot !== this.slotKind || look.slotTier !== this.slotTier || look.slotTenths !== this.slotTenths) {
			this.slotKind = look.slot;
			this.slotTier = look.slotTier;
			this.slotTenths = look.slotTenths;
			U.slotText.write(this.slotText(pack, look));
		}
		const tierRole = COMBO_TIERS[look.slotTier]?.role ?? look.role;
		U.slotColor.write(
			look.slot === "lost" ? grey : look.slot === "tier" ? pack.color(tierRole as ColorRole) : color,
		);
		U.slotTransparency.write(HIDDEN - look.slotAlpha);

		if (look.dropProgress >= 0 && look.dropTenths !== this.dropTenths) {
			this.dropTenths = look.dropTenths;
			U.dropText.write(comboDropText(this.multiplier(pack, look.dropTenths)));
		}
		U.drop.write(look.dropProgress);

		const fillColor = look.pulse > 0 ? color.Lerp(pack.color(COMBO_FLASH_ROLES.tierUp), look.pulse) : color;
		U.fill.write(look.fill);
		U.fillColor.write(fillColor);
		U.dim.write(look.dim);
		U.flashColor.write(pack.color(look.flashRole));
		U.flashAlpha.write(look.flashAlpha);

		// The shatter starts from the fill as it was the frame before the break (the break frame's fill is 0).
		if (look.shards >= 0 && this.prevShards < 0) {
			U.shardFill.write(this.prevFill);
			U.shardColor.write(this.prevFillColor);
		}
		U.shards.write(look.shards);
		this.prevShards = look.shards;
		if (look.shards < 0) {
			this.prevFill = look.fill;
			this.prevFillColor = fillColor;
		}
	}

	/** HUD_STRINGS.combo of `tenths` ("x1.3"). */
	private multiplier(pack: ThemePack, tenths: number): string {
		return pack.str(HUD_STRINGS.combo, { combo: formatCombo(tenths) });
	}

	private slotText(pack: ThemePack, look: ComboDisplayFrame): string {
		switch (look.slot) {
			case "tier": {
				const key = COMBO_TIERS[look.slotTier]?.nameKey;
				return key !== undefined ? pack.str(key) : "";
			}
			case "lost":
				return pack.str(COMBO_STRINGS.lost);
			case "best":
				return pack.str(COMBO_STRINGS.best, { combo: formatCombo(look.slotTenths) });
			default:
				return "";
		}
	}

	// --- the floor shout ------------------------------------------------------------------------------

	private buildShout(pack: ThemePack): void {
		const folder = this.janitor.Add(fxFolder(COMBO_SHOUT_DRAW.folderName));
		const part = renderPart("Part", false);
		part.Name = "Shout";
		part.Transparency = HIDDEN;
		part.Size = new Vector3(
			COMBO_SHOUT.widthTiles * STUDS_PER_TILE,
			FX_SPRITE_VIEW.thicknessStuds,
			COMBO_SHOUT.depthTiles * STUDS_PER_TILE,
		);
		part.CFrame = PARKED;
		const [w, h] = shoutCanvasSize();
		const surface = new Instance("SurfaceGui");
		surface.Face = Enum.NormalId.Top;
		surface.SizingMode = Enum.SurfaceGuiSizingMode.FixedSize;
		surface.CanvasSize = new Vector2(w, h);
		surface.AlwaysOnTop = false;
		surface.LightInfluence = COMBO_SHOUT_DRAW.lightInfluence;
		surface.ResetOnSpawn = false;
		surface.Enabled = false;
		const label = new Instance("TextLabel");
		label.Name = "Text";
		label.Size = UDim2.fromScale(1, 1);
		label.BackgroundTransparency = HIDDEN;
		label.BorderSizePixel = 0;
		label.Font = HUD_FONT;
		label.TextScaled = true;
		label.TextStrokeColor3 = pack.color("background");
		label.TextTransparency = HIDDEN;
		label.TextStrokeTransparency = HIDDEN;
		label.Parent = surface;
		surface.Parent = part;
		part.Parent = folder;
		this.part = part;
		this.surface = surface;
		this.label = label;
	}

	private drawShout(state: Readonly<SimState>, alpha: number, dt: number, reducedMotion: boolean): void {
		const look = this.shout.look;
		const view = this.sim.getViewPlayerIndex();
		if (!look.active || view >= partySize(state)) {
			if (look.active) this.shout.clear();
			this.hideShout();
			return;
		}
		const p = playerAt(state, view);
		const feetX = lerp(p.prevX, p.x, alpha);
		const feetZ = lerp(p.prevZ, p.z, alpha);
		// The box where the shout stands now (its slide so far): one bullet pass, only while a shout shows.
		let up = (COMBO_SHOUT.offsetTiles + look.slideTiles) * TILE_SIZE;
		shoutBoxAt(this.box, feetX + AXES.upX * up, feetZ + AXES.upZ * up, AXES.rightX, AXES.rightZ);
		const ducked = shoutDucked(this.box, state.combat.enemyBullets);
		const tier = look.tier;
		this.shout.frame(dt, ducked, reducedMotion);
		if (!look.active) {
			this.hideShout();
			return;
		}
		up = (COMBO_SHOUT.offsetTiles + look.slideTiles) * TILE_SIZE;
		const part = this.part;
		const surface = this.surface;
		const label = this.label;
		const pack = this.pack;
		if (part === undefined || surface === undefined || label === undefined || pack === undefined) return;
		if (tier !== this.shownTier) {
			this.shownTier = tier;
			const def = COMBO_TIERS[math.clamp(tier, 0, COMBO_TOP_TIER)];
			label.Text = def.nameKey !== undefined ? comboShoutText(pack.str(def.nameKey)) : "";
			label.TextColor3 = pack.color(def.role as ColorRole);
		}
		if (look.opacity !== this.shownOpacity) {
			this.shownOpacity = look.opacity;
			label.TextTransparency = HIDDEN - look.opacity;
			label.TextStrokeTransparency = HIDDEN - look.opacity * (HIDDEN - COMBO_SHOUT_DRAW.strokeTransparency);
		}
		const V = FX_SPRITE_VIEW;
		const top = floorStudsY() + V.liftStuds - COMBO_SHOUT_DRAW.layerStepsBelowEffects * V.layerStepStuds;
		part.CFrame = new CFrame(
			studsX(feetX + AXES.upX * up),
			top - V.thicknessStuds / 2,
			studsZ(feetZ + AXES.upZ * up),
		).mul(CAMERA_YAW);
		if (!this.shoutVisible) {
			this.shoutVisible = true;
			surface.Enabled = true;
		}
	}

	private hideShout(): void {
		if (!this.shoutVisible) return;
		this.shoutVisible = false;
		this.shownTier = 0;
		this.shownOpacity = -1;
		if (this.surface !== undefined) this.surface.Enabled = false;
		if (this.part !== undefined) this.part.CFrame = PARKED;
	}

	// --- KV_ComboDebug (Studio check aid, off by default) --------------------------------------------

	private readDebug(): void {
		const raw = Workspace.GetAttribute(COMBO_DEBUG.attribute);
		if (!typeIs(raw, "string")) return;
		const tier = tonumber(raw);
		if (tier !== undefined) {
			if (tier >= 1 && tier <= COMBO_TOP_TIER && tier === math.floor(tier)) {
				this.debugPending = "tier";
				this.debugTier = tier;
			}
			return;
		}
		if (raw === "break" || raw === "small" || raw === "lapse" || raw === "cut") this.debugPending = raw;
	}

	/** The forced events for this frame (consumed once), or undefined (the run's own). */
	private takeDebugEvents(combo: number): ComboDisplayEvents | undefined {
		const kind = this.debugPending;
		if (kind === undefined) return undefined;
		this.debugPending = undefined;
		const e = this.debugEvents;
		e.startCombo = combo;
		e.endCombo = combo;
		e.peak = combo;
		e.kills = 0;
		e.grazes = 0;
		e.cuts = NO_CUTS;
		e.ended = undefined;
		const D = COMBO_DEBUG;
		if (kind === "tier") {
			e.startCombo = COMBO_MIN;
			e.peak = math.max(combo, COMBO_TIERS[this.debugTier].min);
			e.kills = 1;
		} else if (kind === "cut") {
			this.debugCut.before = D.lostTenths;
			this.debugCut.after = D.cutToTenths;
			e.cuts = [this.debugCut];
		} else {
			const r = this.debugReset;
			r.lost = kind === "small" ? D.smallLostTenths : D.lostTenths;
			r.peak = r.lost;
			r.fight = kind !== "lapse";
			e.ended = r;
		}
		return e;
	}
}

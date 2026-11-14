import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { Players, RunService, Workspace } from "@rbxts/services";
import { clientStore } from "client/store";
import { SILVER_UI, createKvBillboardGui, createKvScreenGui, silverCounterTarget } from "client/ui";
import { currentHudFont, onLocaleChanged } from "client/ui/theme";
import { charCount } from "shared/l10n";
import { SILVER_PAYING_WORLDS, runSilver, silverRunInputOf } from "shared/silver";
import { SILVER_POP_KEY, SILVER_ROLE } from "shared/theme";
import { RENDER_ORDER } from "shared/view";
import { SFX } from "shared/view/audio";
import { FX_VIEW, SCORE_POP_BASE_PX, SCORE_POP_GLYPH_PX, motionScale } from "shared/view/fx";
import { OVERCAP_POP_DUCK, overcapPopBox, overcapPopDucked, type ShoutBox } from "shared/view/hud";
import {
	SILVER_BURST_VIEW,
	SILVER_COUNTER,
	SilverCounterChip,
	SilverCrateFx,
	SilverTracker,
	silverClientFigures,
	silverCoinFlight,
	silverCoinHop,
	silverCounterShown,
	silverCounterWidth,
	silverPopLook,
	silverRunPays,
	type SilverCoinView,
	type SilverRunFacts,
} from "shared/view/silver";
import { DAILY_WORLD_KIND } from "shared/daily";
import { AudioController } from "../audio/AudioController";
import { SimController, type RunContext } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { FxTrackerController } from "./FxTrackerController";
import { attachmentHolder, floorPoint, fxFolder } from "./fxHelpers";

const RENDER_STEP = "KV_SilverHud";
const FOLDER_NAME = "KV_SilverPops";
const PX = FX_VIEW.pxStuds;
const HIDDEN = 1;
const HALF = 0.5;

/** One pooled `+N` pop: a BillboardGui with a TextLabel in the HUD font (the score pops' construction). */
class PopLabel {
	readonly att: Attachment;
	readonly gui: BillboardGui;
	readonly label: TextLabel;
	shown = false;
	born = 0;
	x = 0;
	z = 0;
	chars = 1;

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

/** One pooled coin: a small round frame in the coin layer. */
interface CoinDot {
	readonly frame: Frame;
	view: SilverCoinView | undefined;
	born: number;
}

/**
 * Silver on the HUD and in the world (docs/SILVER.md SV8): the live counter and the crate burst, once per rendered
 * frame after the camera (the frame's ticks and their RunView.silver breaks are in).
 *
 *   counter  on runs that pay (shared/view/silver silverCounterShown, decided at the run's start and put in the store
 *            for ScorePanel): SilverTracker on the run's own reads (silverRunInputOf on the view's state and floor
 *            config, the view's kills) -> SILVER_UI.text; every gain -> the `+N` chip beside it (SilverCounterChip) and,
 *            for anything but a crate, sfx.silver.gain (at most once per SILVER_COUNTER.gainSoundGapSec); the counter's
 *            width -> SILVER_UI.counterW (the floor line takes the rest of row 5)
 *   burst    SilverCrateFx on the frame's breaks (every run with Silver pieces, dev runs too: KV_SilverDebug): a `+N`
 *            pop per break in the world (a billboard in `silver`, rising and fading by silverPopLook, at
 *            OVERCAP_POP_DUCK.opacity while an enemy bullet lies under it), coins that hop off the piece and fly to the
 *            counter's icon (or the top-right corner with no counter: a dev run) in a ScreenGui layer, and the clink
 *            (sfx.silver.crate at the chain's pitch); reduced motion: the pop and the counter only (no coins)
 *   run over the client's figures are frozen into the store (setSilverRun) for the run-over rows, once per run
 *
 * The coin layer is a GUI over the world: small (SILVER_BURST_VIEW.coinPx), short and capped (maxCoinsPerFrame, alive
 * at most maxAliveCoins). Presentation only; read-only on the sim.
 */
@Controller({})
export class SilverHudController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly tracker = new SilverTracker();
	private readonly chip = new SilverCounterChip();
	private readonly burst = new SilverCrateFx();
	private readonly pops = new Array<PopLabel>();
	private readonly coins = new Array<CoinDot>();
	private readonly box: ShoutBox = { x: 0, z: 0, rightX: 0, rightZ: 0, halfWidth: 0, halfDepth: 0 };
	private coinLayer!: ScreenGui;
	private counterOn = false;
	private facts: SilverRunFacts | undefined;
	private frozenRun = -1;
	private lastGainSound = -math.huge;
	private nextPop = 0;

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
		private readonly audio: AudioController,
	) {}

	onStart(): void {
		const pack = this.theme.getPack();
		const folder = this.janitor.Add(fxFolder(FOLDER_NAME));
		const holder = attachmentHolder(folder, "Anchors");
		const color = pack.color(SILVER_ROLE);
		const stroke = pack.color("background");
		for (let i = 0; i < SILVER_BURST_VIEW.maxAlivePops; i++)
			this.pops.push(new PopLabel(holder, folder, `SilverPop${i}`, color, stroke));
		this.coinLayer = this.janitor.Add(
			createKvScreenGui("KV_SilverCoins", {
				ResetOnSpawn: false,
				IgnoreGuiInset: false,
				ScreenInsets: Enum.ScreenInsets.None,
				DisplayOrder: SILVER_BURST_VIEW.coinDisplayOrder,
				Parent: Players.LocalPlayer.WaitForChild("PlayerGui"),
			}),
		);
		for (let i = 0; i < SILVER_BURST_VIEW.maxAliveCoins; i++) {
			const frame = new Instance("Frame");
			frame.Name = `Coin${i}`;
			frame.AnchorPoint = new Vector2(HALF, HALF);
			frame.Size = UDim2.fromOffset(SILVER_BURST_VIEW.coinPx, SILVER_BURST_VIEW.coinPx);
			frame.BackgroundColor3 = color;
			frame.BorderSizePixel = 0;
			frame.Visible = false;
			const corner = new Instance("UICorner");
			corner.CornerRadius = new UDim(HALF, 0);
			corner.Parent = frame;
			const rim = new Instance("UIStroke");
			rim.Color = stroke;
			rim.Parent = frame;
			frame.Parent = this.coinLayer;
			this.coins.push({ frame, view: undefined, born: 0 });
		}
		this.janitor.Add(
			onLocaleChanged(() => {
				const font = currentHudFont();
				for (const p of this.pops) p.label.Font = font;
			}),
		);
		this.sim.onRunStarted((ctx) => this.startRun(ctx));
		this.sim.onRunExited(() => this.clear());
		RunService.BindToRenderStep(RENDER_STEP, Enum.RenderPriority.Camera.Value + RENDER_ORDER.viewsAfterCamera, () =>
			this.frame(),
		);
		this.janitor.Add(() => RunService.UnbindFromRenderStep(RENDER_STEP), true);
	}

	private startRun(ctx: RunContext): void {
		this.clear();
		this.facts = {
			world: ctx.world,
			tutorial: ctx.tutorial,
			dev: ctx.dev,
			stress: ctx.stress,
			debug: this.sim.isDebugRun(),
			unranked: ctx.runId === undefined,
			hasSilver: ctx.run.state.silver !== undefined,
		};
		this.counterOn = silverCounterShown(this.facts);
		clientStore.setSilverCounterShown(this.counterOn);
		clientStore.setSilverRun(undefined);
	}

	private clear(): void {
		this.tracker.reset();
		this.chip.reset();
		this.burst.reset();
		this.counterOn = false;
		this.frozenRun = -1;
		clientStore.setSilverCounterShown(false);
		SILVER_UI.text.set("0");
		SILVER_UI.chipText.set("");
		SILVER_UI.chipTransparency.set(HIDDEN);
		for (const p of this.pops) p.hide();
		for (const c of this.coins) {
			c.view = undefined;
			c.frame.Visible = false;
		}
	}

	private frame(): void {
		const ctx = this.sim.getContext();
		if (ctx === undefined) return;
		const now = os.clock();
		const run = ctx.run;
		const motion = motionScale(this.fx.settings());
		if (this.counterOn) this.stepCounter(ctx, now);
		else if (this.sim.isRunOver() && this.frozenRun !== ctx.counter)
			this.freeze(ctx, silverRunInputOf(run.state, { kills: run.kills }, ctx.config));
		const out = this.burst.frame(run.silver, now, motion);
		for (const p of out.pops) this.spawnPop(p.x, p.z, p.amount, now);
		for (const c of out.coins) this.spawnCoin(c, now);
		if (out.clink !== undefined)
			this.audio.playCue(SFX.silverCrate, SILVER_BURST_VIEW.clinkVolume, out.clink.speed);
		this.stepPops(ctx, now);
		this.stepCoins(now);
	}

	private stepCounter(ctx: RunContext, now: number): void {
		const run = ctx.run;
		const input = silverRunInputOf(run.state, { kills: run.kills }, ctx.config);
		const f = this.tracker.update(input);
		SILVER_UI.text.set(tostring(f.total));
		SILVER_UI.counterW.set(math.ceil(silverCounterWidth(tostring(f.total).size())));
		if (f.gained > 0) {
			this.chip.add(f.gained, now);
			let other = false;
			for (const g of f.gains) if (g.row !== "crates") other = true;
			if (other && now - this.lastGainSound >= SILVER_COUNTER.gainSoundGapSec) {
				this.lastGainSound = now;
				this.audio.playCue(SFX.silverGain, SILVER_COUNTER.gainVolume, 0);
			}
		}
		const look = this.chip.look(now);
		SILVER_UI.chipText.set(
			look.amount > 0 ? this.theme.getPack().str(SILVER_POP_KEY, { silver: look.amount }) : "",
		);
		SILVER_UI.chipTransparency.set(look.transparency);
		if (this.sim.isRunOver() && this.frozenRun !== ctx.counter) this.freeze(ctx, input);
	}

	/** The run is over: the client's figures for the run-over rows (once per run). */
	private freeze(ctx: RunContext, input: ReturnType<typeof silverRunInputOf>): void {
		this.frozenRun = ctx.counter;
		const facts = this.facts;
		if (facts === undefined) return;
		const daily = ctx.world === DAILY_WORLD_KIND;
		const wallet = clientStore.getState().wallet.status;
		clientStore.setSilverRun({
			run: ctx.counter,
			runId: ctx.runId,
			paidWorld: SILVER_PAYING_WORLDS.includes(ctx.world) && !ctx.tutorial && !ctx.dev,
			pays: silverRunPays(facts),
			daily,
			client: silverClientFigures(runSilver(input), wallet, daily),
		});
	}

	private spawnPop(x: number, z: number, amount: number, now: number): void {
		const p = this.pops[this.nextPop];
		this.nextPop = (this.nextPop + 1) % this.pops.size();
		const text = this.theme.getPack().str(SILVER_POP_KEY, { silver: amount });
		p.label.Text = text;
		p.chars = math.max(charCount(text), 1);
		const s = SILVER_BURST_VIEW.popScale;
		p.gui.Size = new UDim2(p.chars * SCORE_POP_GLYPH_PX.w * s * PX, 0, SCORE_POP_GLYPH_PX.h * s * PX, 0);
		p.x = x;
		p.z = z;
		p.born = now;
		p.att.WorldPosition = floorPoint(x, z);
		p.shown = true;
		p.gui.Enabled = true;
	}

	private stepPops(ctx: RunContext, now: number): void {
		const bullets = ctx.run.state.combat.enemyBullets;
		for (const p of this.pops) {
			if (!p.shown) continue;
			const look = silverPopLook(now - p.born);
			if (!look.alive) {
				p.hide();
				continue;
			}
			// The pop is the reduced burst: it rises under reduced motion too (silverPopLook).
			const rise = look.riseStuds;
			p.gui.StudsOffset = new Vector3(0, SCORE_POP_BASE_PX * PX + rise, 0);
			const ducked = overcapPopDucked(overcapPopBox(this.box, p.x, p.z, p.chars, rise / PX), bullets);
			const alpha = (1 - look.transparency) * (ducked ? OVERCAP_POP_DUCK.opacity : 1);
			p.label.TextTransparency = HIDDEN - alpha;
			p.label.TextStrokeTransparency = HIDDEN - alpha * (HIDDEN - FX_VIEW.numberStroke);
		}
	}

	private spawnCoin(view: SilverCoinView, now: number): void {
		for (const c of this.coins) {
			if (c.view !== undefined) continue;
			c.view = view;
			c.born = now;
			return;
		}
	}

	/** The coins: the hop in the world (projected to the GUI), then the flight to the counter's icon. */
	private stepCoins(now: number): void {
		const camera = Workspace.CurrentCamera;
		if (camera === undefined) return;
		const layer = this.coinLayer.AbsolutePosition;
		const target = silverCounterTarget();
		const goal =
			target !== undefined
				? target.AbsolutePosition.add(target.AbsoluteSize.mul(HALF))
				: new Vector2(
						this.coinLayer.AbsoluteSize.X - SILVER_BURST_VIEW.cornerInsetPx,
						SILVER_BURST_VIEW.cornerInsetPx,
				  ).add(layer);
		for (const c of this.coins) {
			const v = c.view;
			if (v === undefined) continue;
			const age = now - c.born;
			const hop = silverCoinHop(age);
			const along = hop.along;
			const wx = v.x + (v.landX - v.x) * along;
			const wz = v.z + (v.landZ - v.z) * along;
			const [screen] = camera.WorldToScreenPoint(floorPoint(wx, wz).add(new Vector3(0, hop.heightStuds, 0)));
			let p = new Vector2(screen.X, screen.Y);
			const f = silverCoinFlight(age, v.flyDelaySec);
			if (f >= 1) {
				c.view = undefined;
				c.frame.Visible = false;
				continue;
			}
			if (f > 0) p = p.Lerp(goal, f);
			c.frame.Position = UDim2.fromOffset(p.X - layer.X, p.Y - layer.Y);
			c.frame.Visible = true;
		}
	}
}

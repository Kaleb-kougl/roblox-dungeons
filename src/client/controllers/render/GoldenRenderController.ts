import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { RunService, Workspace } from "@rbxts/services";
import { DEV_MONO_FONT, createKvBillboardGui } from "client/ui";
import { STUDS_PER_TILE } from "shared/config";
import { RUN_ATTRIBUTES } from "shared/play";
import { GOLDEN_RADIUS, GoldenStatus, SIM_HZ, partySize, type SimState } from "shared/sim";
import { GOLDEN_COIN_FX_ID, GOLDEN_COIN_ROLE, type FxId, type ThemePack } from "shared/theme";
import { RENDER_ORDER, SPRITE_VIEW, floorStudsY, lerp, studsX, studsZ } from "shared/view";
import { burstSeed } from "shared/view/fx";
import {
	GOLDEN_VIEW,
	GoldenAppearQueue,
	goldenBlipSlot,
	goldenCatchFreezeMs,
	goldenCatchNudges,
	goldenDebugText,
	goldenEscapeTicks,
	goldenEscapedText,
	goldenRingColourMix,
	goldenRingLook,
	goldenRingRadius,
	goldenRingSegments,
	goldenShoutText,
	goldenTicksLeft,
	newGoldenRingLook,
	type GoldenFrameSource,
} from "shared/view/golden";
import { FLOOR_SHOUT_PRIORITY } from "shared/view/hud";
import { ComboController } from "../fx/ComboController";
import { FreezeFrameController } from "../fx/FreezeFrameController";
import { FxSpriteController } from "../fx/FxSpriteController";
import { FxTrackerController } from "../fx/FxTrackerController";
import { ParticleController } from "../fx/ParticleController";
import { PreloadController } from "../game/PreloadController";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { DashLayer } from "./DashLayer";
import { renderPart } from "./placeholders";

const HIDDEN = 1;
const V = GOLDEN_VIEW;

/**
 * The Goldling's presentation (docs/FORTUNE.md "Player experience -> The Goldling", FO8), read-only on the sim. Once
 * per rendered frame (render step KV_Golden, after the camera) it reads the run view's Goldling events of the frame
 * (`RunView.golden`, shared/view/golden events.ts) and the hashed state, and hands each beat to the view that owns its
 * construction:
 *
 *   appear    a gold flash where it came out, its piece's cell centre (ParticleController.goldenBurst
 *             GOLDEN_VIEW.appear.burst + goldenAppearRing, in golden.coin) and the floor shout `fx.golden.shout`
 *             ("GOLDLING!"), both GOLDEN_VIEW.appear.afterBreakSec of sim time after the release tick
 *             (GoldenAppearQueue, docs/GOLDLING_RUMOURS.md GR4: the piece's own break, BreakableRenderController's,
 *             shows first, then the coins burst out of it); the shout in the combo shout's slot
 *             (ComboController.requestShout at FLOOR_SHOUT_PRIORITY.goldenAppear: the combo shout's SurfaceGui under
 *             every bullet, <= COMBO_SHOUT.maxOpacity, ducking near enemy bullets, held under the stage cover). Its
 *             body is the actor pipeline's (ActorRenderController); its first-sighting toast SightingController's.
 *   running  the timer ring: a DashLayer of fixed-size floor pieces (folder KV_Golden), radius goldenRingRadius, the
 *             share of its time left (goldenRingLook: ticks left / the config's escapeTicks, whole pieces), clockwise on
 *             screen from screen-up; in the last warnSec it pulses and blinks toward warnRole (one Color3 per colour
 *             step, built once), and under reduced motion holds the warning colour still. The body's flicker is
 *             ActorRenderController's, the minimap blip MinimapController's.
 *   hits      a coin burst per damaging hit: FxSpriteController.goldenCoin when the pack has `fx.golden.coin`, else
 *             ParticleController.goldenBurst GOLDEN_VIEW.coins in golden.coin. The `+N` pops are ScorePopController's,
 *             the climbing hit sound the audio cue mapper's.
 *   caught    a coin fountain (GOLDEN_VIEW.fountain particles, plus the coin sprite at fountainFxScale when the pack
 *             has it), the solo freeze (goldenCatchFreezeMs: the view player's own catch, solo, Freeze frame setting;
 *             through SimController's hitstop clock), the `stamp` nudge on the view player's catch
 *             (FreezeFrameController.requestNudge: the Screen shake setting). The jackpot's big pop is
 *             ScorePopController's, the boosts' hop BoostDropRenderController's, the jackpot sound the mapper's.
 *   escaped   a dive puff in the archetype's colour (GOLDEN_VIEW.puff) and the floor line `fx.golden.escaped` with the
 *             floor's banked coins in the combo shout's slot (FLOOR_SHOUT_PRIORITY.goldenEscaped).
 *
 * Settings: Particles (every burst through the particle system's levels; none at Off), reduced motion (no ring pulse,
 * no flicker: colour only; the appear ring flashes in place), Screen shake (the nudge), Freeze frame (the freeze).
 * Co-op: every client steps the same sim, so every client sees the same Goldling and its beats; the freeze is solo
 * only and the nudge is the catcher's. A new run, a run exit or no run: the ring and label are parked / removed.
 *
 * Studio aid: KV_GoldenLabel (Workspace boolean, Studio or KV_Debug, off by default): one developer label
 * (goldenDebugText: status, ticks left / escapeTicks, hp) over the running Goldling, else over the view player while a
 * Goldling is due or done this floor. Janitor cleanup.
 */
@Controller({})
export class GoldenRenderController implements OnStart {
	private readonly janitor = new Janitor();
	private pack: ThemePack | undefined;
	private ring: DashLayer | undefined;
	/** The ring's colour per warning step (goldenRingColourMix), built once. */
	private readonly ringColors = new Array<Color3>();
	private readonly look = newGoldenRingLook();
	private coinColor = new Color3();
	/**
	 * The pack has `fx.golden.coin` (the hit's coin burst is that sprite, not particles); coinArt() also needs it
	 * downloaded (docs/STAGE_ASSETS.md SA18: until then the particle burst is the stand-in, so a hit always shows).
	 */
	private coinFx = false;
	private folder: Folder | undefined;
	private debug = false;
	private label: { anchor: Part; label: TextLabel; text: string } | undefined;
	/** Appearances waiting for their beat after the piece's break (GR4). */
	private readonly appears = new GoldenAppearQueue();

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
		private readonly particles: ParticleController,
		private readonly sprites: FxSpriteController,
		private readonly combo: ComboController,
		private readonly freeze: FreezeFrameController,
		private readonly preload: PreloadController,
	) {}

	/** The coin burst is the sprite: the pack has it and it has downloaded (SA18). */
	private coinArt(): boolean {
		return this.coinFx && this.preload.isArtReady(GOLDEN_COIN_FX_ID);
	}

	onStart(): void {
		const pack = this.theme.getPack();
		this.pack = pack;
		this.coinColor = pack.color(GOLDEN_COIN_ROLE);
		this.coinFx = pack.fx(GOLDEN_COIN_FX_ID as FxId) !== undefined;
		const warn = pack.color(V.warn.warnRole);
		for (let k = 0; k <= V.warn.colourSteps; k++)
			this.ringColors.push(this.coinColor.Lerp(warn, goldenRingColourMix(k)));
		const folder = this.janitor.Add(new Instance("Folder"));
		folder.Name = V.folderName;
		folder.Parent = Workspace;
		this.folder = folder;
		const dash = V.ring.dash;
		// Fixed-size pieces: one piece is the ring's chord at the archetype's radius (nothing scales it: no affix, no
		// Hulking); the pulse opens hairline gaps between them (at most pulseAmp of a piece).
		const pieceStuds = ((2 * math.pi * goldenRingRadius(GOLDEN_RADIUS)) / V.ring.pieces) * STUDS_PER_TILE;
		this.ring = new DashLayer(folder, "GoldenRing", {
			width: dash.width,
			height: dash.height,
			length: pieceStuds,
			gap: 0,
			color: this.ringColors[0],
			material: Enum.Material.Neon,
			transparency: V.ring.transparency,
			liftStuds: V.ring.liftStuds,
		});
		this.janitor.Add(() => this.ring?.destroy());

		this.readDebug();
		this.janitor.Add(Workspace.GetAttributeChangedSignal(V.debugAttribute).Connect(() => this.readDebug()));
		this.janitor.Add(Workspace.GetAttributeChangedSignal(RUN_ATTRIBUTES.debug).Connect(() => this.readDebug()));
		this.janitor.Add(() => this.removeLabel());
		this.sim.onRunStarted(() => {
			this.removeLabel();
			this.appears.clear();
		});
		this.sim.onRunExited(() => {
			this.removeLabel();
			this.appears.clear();
		});
		this.sim.onFloorChanged(() => this.appears.clear());

		RunService.BindToRenderStep(
			V.renderStep,
			Enum.RenderPriority.Camera.Value + RENDER_ORDER.viewsAfterCamera,
			() => this.frame(),
		);
		this.janitor.Add(() => RunService.UnbindFromRenderStep(V.renderStep), true);
	}

	private frame(): void {
		const ring = this.ring;
		if (ring === undefined) return;
		ring.begin();
		const ctx = this.sim.getContext();
		const state = ctx?.run.state;
		if (ctx === undefined || state === undefined || state.golden === undefined) {
			ring.finish();
			this.removeLabel();
			return;
		}
		debug.profilebegin(V.profileLabel);
		const alpha = this.sim.getAlpha();
		this.beats(ctx.run.golden, state, (state.tick + alpha) / SIM_HZ);
		this.drawRing(ring, state, alpha);
		ring.finish();
		this.updateLabel(state, alpha);
		debug.profileend();
	}

	// --- the frame's beats ---------------------------------------------------------------------------------

	private beats(ev: GoldenFrameSource, state: Readonly<SimState>, simSec: number): void {
		const pack = this.pack;
		if (pack === undefined) return;
		const str = (key: string, vars?: Readonly<Record<string, string | number>>) => pack.str(key, vars);
		const settings = this.fx.settings();
		this.appears.push(ev.appeared);
		for (const a of this.appears.due(simSec)) {
			this.particles.goldenBurst(
				a.x,
				a.z,
				V.appear.burst,
				false,
				burstSeed(a.actorId, a.tick, V.appear.seedSalt),
			);
			this.particles.goldenAppearRing(a.x, a.z);
			this.combo.requestShout(
				goldenShoutText(str),
				this.coinColor,
				V.shoutSec,
				FLOOR_SHOUT_PRIORITY.goldenAppear,
			);
		}
		for (let i = 0; i < ev.hits.size(); i++) {
			const h = ev.hits[i];
			if (this.coinArt()) this.sprites.goldenCoin(h.x, h.z);
			else this.particles.goldenBurst(h.x, h.z, V.coins, false, burstSeed(i, h.tick, V.coinSeedSalt));
		}
		const view = this.sim.getViewPlayerIndex();
		for (const c of ev.caught) {
			this.particles.goldenBurst(c.x, c.z, V.fountain, false, burstSeed(c.player, c.tick, V.fountainSeedSalt));
			if (this.coinArt()) this.sprites.goldenCoin(c.x, c.z, V.fountainFxScale);
			const ms = goldenCatchFreezeMs(c.player, view, partySize(state), settings);
			if (ms > 0) this.sim.hitstop.request(ms, settings);
			if (goldenCatchNudges(c.player, view)) this.freeze.requestNudge("stamp");
		}
		for (const e of ev.escaped) {
			this.particles.goldenBurst(e.x, e.z, V.puff, true, burstSeed(e.coins, e.tick, V.puffSeedSalt));
			this.combo.requestShout(
				goldenEscapedText(str, e.coins),
				this.coinColor,
				V.escapedSec,
				FLOOR_SHOUT_PRIORITY.goldenEscaped,
			);
		}
	}

	// --- the timer ring -------------------------------------------------------------------------------------

	private drawRing(ring: DashLayer, state: Readonly<SimState>, alpha: number): void {
		const slot = goldenBlipSlot(state);
		if (slot < 0) return;
		const a = state.combat.actors[slot];
		const simSec = (state.tick + alpha) / SIM_HZ;
		const look = goldenRingLook(
			goldenTicksLeft(state, slot),
			goldenEscapeTicks(state),
			simSec,
			this.fx.settings().reducedMotion,
			this.look,
		);
		if (look.pieces <= 0) return;
		ring.setColor(this.ringColors[look.colourStep] ?? this.ringColors[0]);
		goldenRingSegments(
			ring,
			lerp(a.prevX, a.x, alpha),
			lerp(a.prevZ, a.z, alpha),
			goldenRingRadius(a.radius) * look.radiusScale,
			look.pieces,
		);
	}

	// --- KV_GoldenLabel (Studio check aid, off by default) ---------------------------------------------------

	/** On in Studio or with KV_Debug, while the Workspace attribute is true. */
	private readDebug(): void {
		const allowed = RunService.IsStudio() || Workspace.GetAttribute(RUN_ATTRIBUTES.debug) === true;
		this.debug = allowed && Workspace.GetAttribute(V.debugAttribute) === true;
		if (!this.debug) this.removeLabel();
	}

	private updateLabel(state: Readonly<SimState>, alpha: number): void {
		if (!this.debug) return;
		const g = state.golden;
		const text = goldenDebugText(state);
		if (g === undefined || text === undefined || g.status === GoldenStatus.NONE) {
			this.removeLabel();
			return;
		}
		const slot = goldenBlipSlot(state);
		let x: number;
		let z: number;
		if (slot >= 0) {
			const a = state.combat.actors[slot];
			x = lerp(a.prevX, a.x, alpha);
			z = lerp(a.prevZ, a.z, alpha);
		} else {
			const n = partySize(state);
			// docs/LOCAL_PREDICTION.md LP5: as drawn (the predicted local player; the merged one otherwise).
			const p = this.sim.getDrawnPlayer(state, math.clamp(this.sim.getViewPlayerIndex(), 0, math.max(n - 1, 0)));
			x = lerp(p.prevX, p.x, alpha);
			z = lerp(p.prevZ, p.z, alpha);
		}
		const l = this.label ?? this.buildLabel();
		if (l === undefined) return;
		if (l.text !== text) {
			l.text = text;
			l.label.Text = text;
		}
		l.anchor.CFrame = new CFrame(studsX(x), floorStudsY(), studsZ(z));
	}

	private buildLabel(): { anchor: Part; label: TextLabel; text: string } | undefined {
		const pack = this.pack;
		const folder = this.folder;
		if (pack === undefined || folder === undefined) return undefined;
		const anchor = renderPart("Part", false);
		anchor.Name = "GoldenDebug";
		anchor.Transparency = HIDDEN;
		anchor.Size = new Vector3(SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds);
		const gui = createKvBillboardGui("GoldenDebug");
		gui.Size = UDim2.fromOffset(V.debugWidthPx, V.debugHeightPx);
		gui.StudsOffsetWorldSpace = new Vector3(0, V.debugLiftStuds, 0);
		gui.AlwaysOnTop = true;
		gui.ResetOnSpawn = false;
		gui.Adornee = anchor;
		const label = new Instance("TextLabel");
		label.BackgroundTransparency = HIDDEN;
		label.BorderSizePixel = 0;
		label.Size = UDim2.fromScale(1, 1);
		label.Font = DEV_MONO_FONT;
		label.TextSize = V.debugTextSize;
		label.TextColor3 = pack.color(V.debugRole);
		label.TextStrokeTransparency = 0;
		label.Text = "";
		label.Parent = gui;
		gui.Parent = anchor;
		anchor.Parent = folder;
		this.label = { anchor, label, text: "" };
		return this.label;
	}

	private removeLabel(): void {
		const l = this.label;
		if (l === undefined) return;
		this.label = undefined;
		l.anchor.Destroy();
	}
}

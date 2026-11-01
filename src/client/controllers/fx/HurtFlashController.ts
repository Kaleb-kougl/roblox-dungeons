import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { Players, Workspace } from "@rbxts/services";
import { createKvScreenGui } from "client/ui";
import type { JuiceSettings } from "shared/settings";
import { StateWatch } from "shared/view";
import {
	FEEL_HURT,
	HurtFlash,
	LowHealthPulse,
	edgeTransparency,
	hurtEdgeDepthPx,
	hurtKindLanded,
	lowHealthAt,
	motionScale,
	quantizeEdgeTransparency,
} from "shared/view/fx";
import { HUD_VIEW } from "shared/view/hud";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { FxTrackerController } from "./FxTrackerController";

const GUI_NAME = "KV_HurtFlash";
const CLEAR = 1;
/** UIGradient rotations (degrees) that run each edge's gradient from the screen edge inwards (keypoint 0 at the edge). */
const EDGES = [
	{ name: "Top", rotation: 90, anchor: new Vector2(0, 0), position: UDim2.fromScale(0, 0), horizontal: true },
	{ name: "Bottom", rotation: 270, anchor: new Vector2(0, 1), position: UDim2.fromScale(0, 1), horizontal: true },
	{ name: "Left", rotation: 0, anchor: new Vector2(0, 0), position: UDim2.fromScale(0, 0), horizontal: false },
	{ name: "Right", rotation: 180, anchor: new Vector2(1, 0), position: UDim2.fromScale(1, 0), horizontal: false },
] as const;

/**
 * The hurt flash and the low-health pulse (docs/FEEL.md J2 / J11, JD7 / JD11 / JD13): red screen edges in colour role
 * `uiHealth` under the HUD (a ScreenGui at HUD_VIEW.hudDisplayOrder - FEEL_HURT.displayOrderBelowHud, full screen, no
 * insets). Four edge Frames, each with a UIGradient from opaque at the screen edge to clear at FEEL_HURT.edgeFraction
 * of the short side; the Frames' BackgroundTransparency carries the look. No image asset, so no theme asset ID.
 *
 * Once per frame (an FxTrackerController frame handler, after the frame's sim ticks) its own StateWatch reads the view
 * player's hurt edge (SimController.getViewPlayerIndex: the watched teammate while spectating, at
 * FEEL_HURT.spectateScale), starts a HurtFlash on it (shared/view/fx hurtFlash.ts), advances the LowHealthPulse
 * (lowHealth.ts) and draws the larger opacity of the two (never the sum). Real time (os.clock / the frame dt): fades
 * run through pause and hitstop. A switch of the view player, a new run or the end of a run clears both. Written only
 * while something shows (the ScreenGui is disabled otherwise). Presentation only, read only on the sim.
 */
@Controller({})
export class HurtFlashController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly watch = new StateWatch();
	private readonly flash = new HurtFlash();
	private readonly pulse = new LowHealthPulse();
	private readonly edges = new Array<Frame>();
	private gui: ScreenGui | undefined;
	private viewSeen = -1;
	private shown = false;
	private written = CLEAR;
	private depth = -1;

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
	) {}

	onStart(): void {
		this.gui = this.janitor.Add(this.build());
		this.sim.onRunStarted(() => this.clear());
		this.fx.onEvent((e) => {
			if (e.type === "reset") this.clear();
		});
		this.fx.onFrame((_, settings, dt) => this.frame(settings, dt));
	}

	private build(): ScreenGui {
		const gui = createKvScreenGui(GUI_NAME);
		gui.ResetOnSpawn = false;
		gui.IgnoreGuiInset = true;
		gui.ScreenInsets = Enum.ScreenInsets.None;
		gui.DisplayOrder = HUD_VIEW.hudDisplayOrder - FEEL_HURT.displayOrderBelowHud;
		gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling;
		gui.Enabled = false;
		const color = this.theme.getPack().color("uiHealth");
		const fade = new NumberSequence(0, CLEAR);
		for (const edge of EDGES) {
			const frame = new Instance("Frame");
			frame.Name = edge.name;
			frame.AnchorPoint = edge.anchor;
			frame.Position = edge.position;
			frame.Size = edge.horizontal ? new UDim2(1, 0, 0, 1) : new UDim2(0, 1, 1, 0);
			frame.BackgroundColor3 = color;
			frame.BackgroundTransparency = CLEAR;
			frame.BorderSizePixel = 0;
			frame.Active = false;
			frame.Interactable = false;
			frame.Selectable = false;
			const gradient = new Instance("UIGradient");
			gradient.Rotation = edge.rotation;
			gradient.Transparency = fade;
			gradient.Parent = frame;
			frame.Parent = gui;
			this.edges.push(frame);
		}
		gui.Parent = Players.LocalPlayer.WaitForChild("PlayerGui");
		return gui;
	}

	private clear(): void {
		this.watch.reset();
		this.flash.clear();
		this.pulse.reset();
		this.viewSeen = -1;
		this.draw(CLEAR);
	}

	private frame(settings: Readonly<JuiceSettings>, dt: number): void {
		const state = this.sim.getState();
		if (state === undefined) {
			if (this.shown) this.clear();
			return;
		}
		const view = this.sim.getViewPlayerIndex();
		if (view !== this.viewSeen) {
			// Another player to follow (spectating switched): their state starts fresh, the old flash ends.
			this.flash.clear();
			this.pulse.reset();
			this.viewSeen = view;
		}
		this.watch.update(state, view);
		if (view >= this.watch.players()) {
			this.draw(CLEAR);
			return;
		}
		const now = os.clock();
		const kind = hurtKindLanded(this.watch.hurtKind[view], this.sim.getFrameEvents()?.playerHits);
		if (kind !== "none") this.flash.start(kind, now);
		const spectating = view !== this.sim.getLocalPlayerIndex();
		const pulse = this.pulse.update(lowHealthAt(state, view), dt, motionScale(settings), spectating);
		this.draw(edgeTransparency(this.flash.transparency(now, spectating), pulse));
	}

	/** Writes the edges only when the quantized transparency or the screen's short side changed. */
	private draw(transparency: number): void {
		const gui = this.gui;
		if (gui === undefined) return;
		const t = quantizeEdgeTransparency(transparency);
		if (t >= CLEAR) {
			if (this.shown) {
				this.shown = false;
				gui.Enabled = false;
			}
			return;
		}
		const camera = Workspace.CurrentCamera;
		const size = camera !== undefined ? camera.ViewportSize : gui.AbsoluteSize;
		const depth = hurtEdgeDepthPx(size.X, size.Y);
		if (depth !== this.depth) {
			this.depth = depth;
			for (let i = 0; i < this.edges.size(); i++) {
				this.edges[i].Size = EDGES[i].horizontal ? new UDim2(1, 0, 0, depth) : new UDim2(0, depth, 1, 0);
			}
		}
		if (t !== this.written) {
			this.written = t;
			for (const frame of this.edges) frame.BackgroundTransparency = t;
		}
		if (!this.shown) {
			this.shown = true;
			gui.Enabled = true;
		}
	}
}

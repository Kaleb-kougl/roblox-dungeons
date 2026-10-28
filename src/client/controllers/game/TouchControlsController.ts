import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { GuiService, Players, RunService, UserInputService, Workspace } from "@rbxts/services";
import {
	clientStore,
	selectDisplay,
	selectGameActive,
	selectInputDevice,
	selectMapView,
	selectMenuOpen,
	selectRobloxMenuOpen,
	selectSnapshot,
} from "client/store";
import { HUD_FONT, role, str } from "client/ui";
import { STUDS_PER_TILE, TOUCH } from "shared/config";
import type { DisplaySettings } from "shared/settings";
import {
	stickVector,
	touchMode,
	type GameSnapshot,
	type TouchControlId,
	type TouchControls,
	type TouchMode,
} from "shared/play";
import { RENDER_ORDER, floorStudsY, studsX, studsZ } from "shared/view";
import {
	TOUCH_LAYOUT,
	touchButtonLabelKey,
	touchLayout,
	type TouchButtonId,
	type TouchLayoutResult,
} from "shared/view/hud";
import { InputController } from "./InputController";
import { SimController } from "./SimController";

const RENDER_STEP = "KV_TouchControls";
const GUI_NAME = "KV_TouchControls";
const TARGET_NAME = "KV_TouchTarget";
const HALF = 0.5;
/** Fully transparent (an idle part of a surface). */
const HIDDEN = 1;
/** Sentinel for a cached value not written yet. */
const NOT_SET = -1;
const PERCENT = 100;
/** A Cylinder's axis is X: turn it upright (as RunMarkerController does). */
const UPRIGHT = CFrame.Angles(0, 0, math.pi * HALF);

/** One button: its frame, its knob (Attack / Alt), and the values last written (only changes are written). */
interface Control {
	readonly id: TouchButtonId;
	readonly button: TextButton;
	readonly knob: Frame | undefined;
	/** The label without the count (the theme string of touch.<id>). */
	readonly name: string;
	/** Placed by the current layout (the mode's buttons). */
	placed: boolean;
	fillT: number;
	textT: number;
	label: string;
}

/** Every GUI object and target marker the controller owns (built once in onStart). */
interface Ui {
	readonly gui: ScreenGui;
	readonly controls: Map<TouchButtonId, Control>;
	readonly moveZone: TextButton;
	readonly moveBase: Frame;
	readonly moveRing: UIStroke;
	readonly moveKnob: Frame;
	readonly markerFolder: Folder;
	readonly marker: Part;
}

/** Rounds a Frame or TextButton into a circle (a corner radius of one half). */
function roundCorners(parent: GuiObject): void {
	const corner = new Instance("UICorner");
	corner.CornerRadius = new UDim(HALF, 0);
	corner.Parent = parent;
}

/** A stick's knob: a centred circle at TOUCH_LAYOUT.knobShare of its parent; the offset is set each frame. */
function makeKnob(parent: GuiObject): Frame {
	const knob = new Instance("Frame");
	knob.Name = "Knob";
	knob.AnchorPoint = new Vector2(HALF, HALF);
	knob.Position = UDim2.fromScale(HALF, HALF);
	knob.Size = UDim2.fromScale(TOUCH_LAYOUT.knobShare, TOUCH_LAYOUT.knobShare);
	knob.BackgroundColor3 = role("uiAccent");
	knob.BorderSizePixel = 0;
	roundCorners(knob);
	knob.Parent = parent;
	return knob;
}

function makeControl(id: TouchButtonId, gui: ScreenGui): Control {
	const name = str(touchButtonLabelKey(id));
	const button = new Instance("TextButton");
	button.Name = id;
	button.Text = name;
	button.TextScaled = true;
	button.Font = HUD_FONT;
	button.TextColor3 = role("uiText");
	button.BackgroundColor3 = role("uiPanel");
	button.AutoButtonColor = false;
	button.Selectable = false;
	button.Visible = false;
	roundCorners(button);
	const knob = id === "attack" || id === "alt" ? makeKnob(button) : undefined;
	button.Parent = gui;
	return { id, button, knob, name, placed: false, fillT: NOT_SET, textT: NOT_SET, label: name };
}

/** Puts every placed circle, the move zone and the move base's size where the layout says (on a layout change). */
function place(ui: Ui, layout: TouchLayoutResult): void {
	for (const [, c] of ui.controls) c.placed = false;
	for (const p of layout.buttons) {
		const c = ui.controls.get(p.id);
		if (c === undefined) continue;
		c.placed = true;
		c.button.Position = UDim2.fromOffset(p.cx - p.r, p.cy - p.r);
		c.button.Size = UDim2.fromOffset(p.r * 2, p.r * 2);
	}
	const zone = layout.moveZone;
	ui.moveZone.Visible = zone !== undefined;
	if (zone !== undefined) {
		ui.moveZone.Position = UDim2.fromOffset(zone.x, zone.y);
		ui.moveZone.Size = UDim2.fromOffset(zone.w, zone.h);
	}
	const home = layout.moveHome;
	if (home !== undefined) ui.moveBase.Size = UDim2.fromOffset(home.r * 2, home.r * 2);
}

/**
 * The on-screen touch controls (docs/MOBILE_IMPL.md MB9, docs/MOBILE.md): on a touch-capable device it turns Roblox's
 * stock touch GUI off, locks the screen to landscape and draws the move stick, the Attack / Alt sticks and the buttons.
 * Touches go to the InputController's TouchControls machine (MB3) as fingers; the surface shown each frame follows
 * touchMode (MB6), and the auto-target ring is drawn in the world (KV_TouchTarget).
 *
 * Presentation only: it reads the store and the sim and never writes the sim. Everything it makes lives in the
 * Janitor; the render step (KV_TouchControls, before the sim samples input) is unbound with it.
 */
@Controller({})
export class TouchControlsController implements OnStart {
	private readonly janitor = new Janitor();
	/** A Roblox touch InputObject -> the finger number the touch machine knows it by. */
	private readonly fingerIds = new Map<InputObject, number>();
	private nextFinger = 1;
	private ui: Ui | undefined;
	private layout: TouchLayoutResult | undefined;
	private layoutKey = "";
	private mode: TouchMode = "hidden";

	constructor(private readonly input: InputController, private readonly sim: SimController) {}

	onStart(): void {
		if (!UserInputService.TouchEnabled) return;
		this.ui = this.build();
		RunService.BindToRenderStep(RENDER_STEP, Enum.RenderPriority.Input.Value + RENDER_ORDER.touchBeforeSim, () =>
			this.frame(),
		);
		this.janitor.Add(() => RunService.UnbindFromRenderStep(RENDER_STEP), true);
	}

	// --- build (once) ----------------------------------------------------------------------------------

	private build(): Ui {
		GuiService.TouchControlsEnabled = false;
		const playerGui = Players.LocalPlayer.WaitForChild("PlayerGui") as PlayerGui;
		playerGui.ScreenOrientation = Enum.ScreenOrientation.LandscapeSensor;

		const gui = new Instance("ScreenGui");
		gui.Name = GUI_NAME;
		gui.ResetOnSpawn = false;
		gui.ScreenInsets = Enum.ScreenInsets.CoreUISafeInsets;
		gui.DisplayOrder = TOUCH_LAYOUT.displayOrder;
		gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling;
		gui.Enabled = false;
		gui.Parent = playerGui;
		this.janitor.Add(gui, "Destroy");

		const moveZone = new Instance("TextButton");
		moveZone.Name = "MoveZone";
		moveZone.Text = "";
		moveZone.BackgroundTransparency = HIDDEN;
		moveZone.AutoButtonColor = false;
		moveZone.Selectable = false;
		moveZone.Visible = false;
		moveZone.Parent = gui;

		const moveBase = new Instance("Frame");
		moveBase.Name = "MoveBase";
		moveBase.BackgroundTransparency = HIDDEN;
		moveBase.BorderSizePixel = 0;
		moveBase.Visible = false;
		roundCorners(moveBase);
		const moveRing = new Instance("UIStroke");
		moveRing.Color = role("uiText");
		moveRing.Thickness = TOUCH_LAYOUT.ringStroke;
		moveRing.Parent = moveBase;
		const moveKnob = makeKnob(moveBase);
		moveBase.Parent = gui;

		const controls = new Map<TouchButtonId, Control>();
		for (const spec of TOUCH_LAYOUT.play) controls.set(spec.id, makeControl(spec.id, gui));
		for (const spec of TOUCH_LAYOUT.spectate) controls.set(spec.id, makeControl(spec.id, gui));

		const markerFolder = new Instance("Folder");
		markerFolder.Name = TARGET_NAME;
		this.janitor.Add(markerFolder, "Destroy");
		const marker = new Instance("Part");
		marker.Name = "Ring";
		marker.Anchored = true;
		marker.CanCollide = false;
		marker.CanQuery = false;
		marker.CanTouch = false;
		marker.CastShadow = false;
		marker.Locked = true;
		marker.Shape = Enum.PartType.Cylinder;
		marker.Material = Enum.Material.SmoothPlastic;
		marker.Color = role("uiAccent");
		marker.Transparency = TOUCH.marker.transparency;
		const diameter = TOUCH.marker.radiusTiles * 2 * STUDS_PER_TILE;
		marker.Size = new Vector3(TOUCH.marker.heightTiles * STUDS_PER_TILE, diameter, diameter);
		marker.Parent = markerFolder;

		// Presses: a touch that starts on a control or the move zone becomes a finger.
		this.janitor.Add(
			moveZone.InputBegan.Connect((io) => this.begin(io, "move")),
			"Disconnect",
		);
		for (const [id, c] of controls) {
			this.janitor.Add(
				c.button.InputBegan.Connect((io) => this.begin(io, id)),
				"Disconnect",
			);
		}
		this.janitor.Add(
			UserInputService.TouchMoved.Connect((io) => this.moved(io)),
			"Disconnect",
		);
		this.janitor.Add(
			UserInputService.TouchEnded.Connect((io) => this.ended(io)),
			"Disconnect",
		);

		return { gui, controls, moveZone, moveBase, moveRing, moveKnob, markerFolder, marker };
	}

	// --- touches -----------------------------------------------------------------------------------------

	private begin(io: InputObject, id: TouchControlId): void {
		if (io.UserInputType !== Enum.UserInputType.Touch) return;
		const n = this.nextFinger;
		this.nextFinger += 1;
		this.fingerIds.set(io, n);
		this.input.getTouch().begin(n, id, io.Position.X, io.Position.Y);
	}

	private moved(io: InputObject): void {
		const n = this.fingerIds.get(io);
		if (n !== undefined) this.input.getTouch().move(n, io.Position.X, io.Position.Y);
	}

	private ended(io: InputObject): void {
		const n = this.fingerIds.get(io);
		if (n === undefined) return;
		this.input.getTouch().end(n);
		this.fingerIds.delete(io);
	}

	// --- per frame ---------------------------------------------------------------------------------------

	private frame(): void {
		const ui = this.ui;
		const camera = Workspace.CurrentCamera;
		if (ui === undefined || camera === undefined) return;
		const store = clientStore.getState();
		const snapshot = selectSnapshot(store);
		const display = selectDisplay(store);
		const mode = touchMode({
			device: selectInputDevice(store),
			gameActive: selectGameActive(store),
			menuOpen: selectMenuOpen(store),
			robloxMenuOpen: selectRobloxMenuOpen(store),
			mapOpen: selectMapView(store).open,
			frozen: this.sim.isFrozen(),
			draftOpen: snapshot.draftOpen,
			spectating: snapshot.spectating,
		});
		if (mode !== this.mode) {
			this.mode = mode;
			if (mode === "hidden") this.fingerIds.clear();
		}
		this.input.setTouchMode(mode);
		ui.gui.Enabled = mode !== "hidden";

		this.layoutIfChanged(ui, camera.ViewportSize, mode, display);
		const layout = this.layout;
		if (layout === undefined) return;
		const touch = this.input.getTouch();
		this.updateButtons(ui, layout, snapshot, display, touch);
		this.updateMove(ui, layout, display, touch);
		this.updateTarget(ui);
	}

	/** Re-lays the controls when anything they depend on changed (the viewport, the GUI, the settings, the mode). */
	private layoutIfChanged(ui: Ui, viewport: Vector2, mode: TouchMode, display: DisplaySettings): void {
		const safe = ui.gui.AbsoluteSize;
		const key = `${viewport.X},${viewport.Y},${safe.X},${safe.Y},${display.hudScale},${display.touchSize},${display.touchLeftHanded},${mode}`;
		if (key === this.layoutKey) return;
		this.layoutKey = key;
		const layout = touchLayout(
			viewport.X,
			viewport.Y,
			safe.X,
			safe.Y,
			display.hudScale,
			display.touchSize,
			display.touchLeftHanded,
			mode === "spectate" ? "spectate" : "play",
		);
		this.layout = layout;
		this.input.setTouchStickRadiusPx(layout.stickRadiusPx);
		place(ui, layout);
	}

	/** Fill and text opacity, the held boost, the Accept button's visibility, the Ember / Flask counts, the knobs. */
	private updateButtons(
		ui: Ui,
		layout: TouchLayoutResult,
		snapshot: GameSnapshot,
		display: DisplaySettings,
		touch: TouchControls,
	): void {
		const opacity = display.touchOpacity / PERCENT;
		const fill = opacity * TOUCH_LAYOUT.fillAlpha;
		const textT = 1 - opacity;
		for (const [, c] of ui.controls) {
			const held = touch.isHeld(c.id);
			const fillT = 1 - (held ? math.min(1, fill * TOUCH_LAYOUT.pressedFillBoost) : fill);
			if (c.fillT !== fillT) {
				c.fillT = fillT;
				c.button.BackgroundTransparency = fillT;
			}
			if (c.textT !== textT) {
				c.textT = textT;
				c.button.TextTransparency = textT;
				if (c.knob !== undefined) c.knob.BackgroundTransparency = textT;
			}

			const visible = c.placed && (c.id !== "shrine" || snapshot.atShrine);
			if (c.button.Visible !== visible) c.button.Visible = visible;

			const count = c.id === "ember" ? ` ${snapshot.embers}` : c.id === "flask" ? ` ${snapshot.flask}` : "";
			const label = c.name + count;
			if (c.label !== label) {
				c.label = label;
				c.button.Text = label;
			}

			if (c.knob !== undefined) {
				const stick = touch.stickView(c.id);
				let dx = 0;
				let dy = 0;
				if (stick !== undefined) {
					const v = stickVector(stick.x0, stick.y0, stick.x, stick.y, layout.stickRadiusPx);
					dx = v.x * layout.stickRadiusPx;
					dy = -v.y * layout.stickRadiusPx;
				}
				c.knob.Position = new UDim2(HALF, dx, HALF, dy);
			}
		}
	}

	/**
	 * The move stick: the base sits where the finger went down (converted to GUI space) with the knob at the drag, or at
	 * the idle ring (moveHome) at half opacity when no finger is on it.
	 */
	private updateMove(ui: Ui, layout: TouchLayoutResult, display: DisplaySettings, touch: TouchControls): void {
		const home = layout.moveHome;
		ui.moveBase.Visible = home !== undefined;
		if (home === undefined) return;
		const opacity = display.touchOpacity / PERCENT;
		const stick = touch.stickView("move");
		let x = home.cx;
		let y = home.cy;
		let alpha = opacity * TOUCH_LAYOUT.idleShare;
		let kx = 0;
		let ky = 0;
		if (stick !== undefined) {
			x = stick.x0 - ui.gui.AbsolutePosition.X + TOUCH_LAYOUT.guiOffset.x;
			y = stick.y0 - ui.gui.AbsolutePosition.Y + TOUCH_LAYOUT.guiOffset.y;
			alpha = opacity;
			const v = stickVector(stick.x0, stick.y0, stick.x, stick.y, layout.stickRadiusPx);
			kx = v.x * layout.stickRadiusPx;
			ky = -v.y * layout.stickRadiusPx;
		}
		ui.moveBase.Position = UDim2.fromOffset(x - home.r, y - home.r);
		ui.moveKnob.Position = new UDim2(HALF, kx, HALF, ky);
		ui.moveRing.Transparency = 1 - alpha;
		ui.moveKnob.BackgroundTransparency = 1 - alpha;
	}

	/** The auto-target ring under the target (InputController.getTouchTarget), in the world; hidden without one. */
	private updateTarget(ui: Ui): void {
		const target = this.input.getTouchTarget();
		if (target === undefined) {
			if (ui.markerFolder.Parent !== undefined) ui.markerFolder.Parent = undefined;
			return;
		}
		if (ui.markerFolder.Parent !== Workspace) ui.markerFolder.Parent = Workspace;
		const height = TOUCH.marker.heightTiles * STUDS_PER_TILE;
		ui.marker.CFrame = new CFrame(studsX(target.x), floorStudsY() + height * HALF, studsZ(target.z)).mul(UPRIGHT);
	}
}

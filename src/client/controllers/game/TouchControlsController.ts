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
import { HUD_FONT, role, str, themePack } from "client/ui";
import { STUDS_PER_TILE, TOUCH } from "shared/config";
import type { DisplaySettings } from "shared/settings";
import type { ImageRef } from "shared/theme";
import { stickVector, touchMode, type GameSnapshot, type TouchControls, type TouchMode } from "shared/play";
import { RENDER_ORDER, floorStudsY, studsX, studsZ } from "shared/view";
import {
	HUD_SKIN,
	TOUCH_LAYOUT,
	pickTouchTarget,
	skinHasOf,
	touchArtId,
	touchArtSize,
	touchArtTransparency,
	touchButtonLabelKey,
	touchCountIcon,
	touchFace,
	touchLayout,
	touchStickParts,
	type ScreenRect,
	type TouchArtControl,
	type TouchFace,
	type TouchButtonId,
	type TouchLayoutResult,
	type TouchTargetId,
} from "shared/view/hud";
import { InputController } from "./InputController";
import { SimController } from "./SimController";

const RENDER_STEP = "KV_TouchControls";
const GUI_NAME = "KV_TouchControls";
/** The in-run HUD's ScreenGui (client/ui/hud GameHud): the corner panels the controls keep clear of sit in it. */
const HUD_GUI_NAME = "KV_GameHud";
/** A label's text stroke opacity, as a share of the text's (it keeps the words readable over a light floor). */
const STROKE_SHARE = 0.6;
const TARGET_NAME = "KV_TouchTarget";
const HALF = 0.5;
/** Fully transparent (an idle part of a surface). */
const HIDDEN = 1;
/** Sentinel for a cached value not written yet. */
const NOT_SET = -1;
const PERCENT = 100;
/** A Cylinder's axis is X: turn it upright (as RunMarkerController does). */
const UPRIGHT = CFrame.Angles(0, 0, math.pi * HALF);
/** Draw order inside a control (ZIndexBehavior Sibling): the ring art, the icon, the label over them, the knob on top. */
const ART_Z = { art: 1, icon: 2, label: 3, knob: 4 } as const;

/** A control's ring / button art (docs/UI_ART.md UA13): the ImageLabel and the art's width in px (its rect). */
interface ControlArt {
	readonly image: ImageLabel;
	readonly artPx: number;
}

/** One button: its frame, its knob (Attack / Alt), and the values last written (only changes are written). */
interface Control {
	readonly id: TouchButtonId;
	readonly button: TextButton;
	readonly knob: Frame | undefined;
	/** The ring / button art when the pack has it (docs/UI_ART.md UA13); undefined: the flat circle. */
	readonly art: ControlArt | undefined;
	/** The label, in its box inside the control (shared/view/hud touchFace), TextScaled under `textSize`'s cap. */
	readonly text: TextLabel;
	readonly textSize: UITextSizeConstraint;
	/** Flask / Ember with the art: the flask / candle icon shown with the count instead of the word (touchCountIcon). */
	readonly icon: ControlArt | undefined;
	/** The icon art's size, art px (touchFace fits it at a whole multiple). */
	readonly iconArt: { readonly w: number; readonly h: number } | undefined;
	/** Flask / Ember: the label carries the count. */
	readonly counted: boolean;
	/** The face the last layout gave it (what the label shows: word, word and count, or the count by the icon). */
	face: TouchFace["kind"];
	/** The label without the count (the theme string of touch.<id>). */
	readonly name: string;
	/** Placed by the current layout (the mode's buttons). */
	placed: boolean;
	fillT: number;
	textT: number;
	label: string;
}

/**
 * A touch whose InputBegan fired since the last frame, on one control or (a corner where two buttons' hit squares
 * overlap) several: frame() gives it to exactly one (pickTouchTarget). (x, y) is the touch-down point (raw touch px).
 */
interface PendingTouch {
	readonly candidates: TouchTargetId[];
	readonly x: number;
	readonly y: number;
	ended: boolean;
}

/** The touch is over: lifted (End) or taken by the system (Cancel, which fires no TouchEnded). */
function touchOver(io: InputObject): boolean {
	const s = io.UserInputState;
	return s === Enum.UserInputState.End || s === Enum.UserInputState.Cancel;
}

/** Every GUI object and target marker the controller owns (built once in onStart). */
interface Ui {
	readonly gui: ScreenGui;
	readonly controls: Map<TouchButtonId, Control>;
	readonly moveZone: TextButton;
	readonly moveBase: Frame;
	readonly moveRing: UIStroke;
	/** The move base's ring art (docs/UI_ART.md UA13), replacing moveRing when the pack has it. */
	readonly moveArt: ControlArt | undefined;
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

/** The theme image a control draws (shared/view/hud touchArtId), or undefined: the flat circle. */
function artRef(control: TouchArtControl): ImageRef | undefined {
	const pack = themePack();
	if (pack === undefined) return undefined;
	const id = touchArtId(skinHasOf(pack), control);
	return id !== undefined ? pack.image(id) : undefined;
}

/**
 * A control's ring / button art: an ImageLabel of the icon-atlas cut (ImageRectOffset / ImageRectSize), Pixelated,
 * centred, under the label; sized on a layout change (place: touchArtSize), its transparency per frame.
 */
function makeArt(parent: GuiObject, ref: ImageRef): ControlArt {
	const image = new Instance("ImageLabel");
	image.Name = "Skin";
	image.Image = ref.assetId;
	const r = ref.rect;
	if (r !== undefined) {
		image.ImageRectOffset = new Vector2(r.x, r.y);
		image.ImageRectSize = new Vector2(r.w, r.h);
	}
	image.ResampleMode = Enum.ResamplerMode.Pixelated;
	image.AnchorPoint = new Vector2(HALF, HALF);
	image.Position = UDim2.fromScale(HALF, HALF);
	image.BackgroundTransparency = HIDDEN;
	image.BorderSizePixel = 0;
	image.Active = false;
	image.ZIndex = ART_Z.art;
	image.Parent = parent;
	return { image, artPx: r?.w ?? ref.w };
}

/**
 * A control's label: a TextLabel in the box touchFace gives it (set in place), TextScaled under a UITextSizeConstraint,
 * with a soft dark stroke, so the word never spills past its control (it filled the whole square before).
 */
function makeLabel(button: TextButton, name: string): [TextLabel, UITextSizeConstraint] {
	const label = new Instance("TextLabel");
	label.Name = "Label";
	label.BackgroundTransparency = HIDDEN;
	label.Active = false;
	label.Text = name;
	label.TextScaled = true;
	label.Font = HUD_FONT;
	label.TextColor3 = role("uiText");
	label.TextStrokeColor3 = role("uiPanel");
	label.ZIndex = ART_Z.label;
	const size = new Instance("UITextSizeConstraint");
	size.MinTextSize = HUD_SKIN.touch.minText;
	size.Parent = label;
	label.Parent = button;
	return [label, size];
}

/** The icon a Flask / Ember control shows with its count (touchCountIcon), or undefined: the word. */
function countIconRef(id: TouchButtonId, skinned: boolean): ImageRef | undefined {
	const pack = themePack();
	if (pack === undefined) return undefined;
	const iconId = touchCountIcon(skinHasOf(pack), id, skinned);
	return iconId !== undefined ? pack.image(iconId) : undefined;
}

function makeControl(id: TouchButtonId, gui: ScreenGui): Control {
	const name = str(touchButtonLabelKey(id));
	const button = new Instance("TextButton");
	button.Name = id;
	button.Text = "";
	button.BackgroundColor3 = role("uiPanel");
	button.AutoButtonColor = false;
	button.Selectable = false;
	button.Visible = false;
	roundCorners(button);
	const ref = artRef(id);
	const art = ref !== undefined ? makeArt(button, ref) : undefined;
	// Skinned (docs/UI_ART.md UA13): no flat fill under the art.
	if (art !== undefined) button.BackgroundTransparency = HIDDEN;
	const [text, textSize] = makeLabel(button, name);
	const iconRef = countIconRef(id, art !== undefined);
	let icon: ControlArt | undefined;
	let iconArt: { w: number; h: number } | undefined;
	if (iconRef !== undefined) {
		icon = makeArt(button, iconRef);
		icon.image.Name = "Icon";
		icon.image.ZIndex = ART_Z.icon;
		iconArt = { w: iconRef.rect?.w ?? iconRef.w, h: iconRef.rect?.h ?? iconRef.h };
	}
	const knob = id === "attack" || id === "alt" ? makeKnob(button) : undefined;
	if (knob !== undefined) knob.ZIndex = ART_Z.knob;
	button.Parent = gui;
	return {
		id,
		button,
		knob,
		art,
		text,
		textSize,
		icon,
		iconArt,
		counted: id === "flask" || id === "ember",
		face: "word",
		name,
		placed: false,
		fillT: NOT_SET,
		textT: NOT_SET,
		label: name,
	};
}

/** Puts a control's label (and icon) where touchFace says for a `diameter` px control. */
function placeFace(c: Control, diameter: number, artSize: number | undefined): void {
	const face = touchFace(c.id, diameter, artSize, c.counted, c.iconArt);
	c.face = face.kind;
	c.text.Position = UDim2.fromOffset(face.text.x, face.text.y);
	c.text.Size = UDim2.fromOffset(face.text.w, face.text.h);
	c.text.TextWrapped = face.wrap;
	c.textSize.MaxTextSize = face.maxText;
	c.label = ""; // rewrite the text for the new face (updateButtons)
	if (c.icon !== undefined) {
		const b = face.icon;
		c.icon.image.Visible = b !== undefined;
		if (b !== undefined) {
			c.icon.image.AnchorPoint = new Vector2(0, 0);
			c.icon.image.Position = UDim2.fromOffset(b.x, b.y);
			c.icon.image.Size = UDim2.fromOffset(b.w, b.h);
		}
	}
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
		let side: number | undefined;
		if (c.art !== undefined) {
			side = touchArtSize(p.r * 2, c.art.artPx);
			c.art.image.Size = UDim2.fromOffset(side, side);
		}
		placeFace(c, p.r * 2, side);
	}
	const zone = layout.moveZone;
	ui.moveZone.Visible = zone !== undefined;
	if (zone !== undefined) {
		ui.moveZone.Position = UDim2.fromOffset(zone.x, zone.y);
		ui.moveZone.Size = UDim2.fromOffset(zone.w, zone.h);
	}
	const home = layout.moveHome;
	if (home !== undefined) {
		ui.moveBase.Size = UDim2.fromOffset(home.r * 2, home.r * 2);
		if (ui.moveArt !== undefined) {
			const side = touchArtSize(home.r * 2, ui.moveArt.artPx);
			ui.moveArt.image.Size = UDim2.fromOffset(side, side);
		}
	}
}

/**
 * The on-screen touch controls (docs/MOBILE_IMPL.md MB9, docs/MOBILE.md): on a touch-capable device it turns Roblox's
 * stock touch GUI off, locks the screen to landscape and draws the move stick, the Attack / Alt sticks and the buttons.
 * Touches go to the InputController's TouchControls machine (MB3) as fingers; the surface shown each frame follows
 * touchMode (MB6), and the auto-target ring is drawn in the world (KV_TouchTarget).
 *
 * One touch is one finger on one control. InputBegan fires on every control whose hit square holds the touch (the
 * squares of neighbouring circles overlap at the corners), so a press is collected as pending and resolved once in
 * frame(), before the sim samples. A finger whose end the events missed (a cancelled touch fires no TouchEnded) is
 * ended by its InputObject's UserInputState. Either leak used to leave a control held for good: the machine ignores
 * new touches on a control a live finger holds.
 *
 * With the UI art (docs/UI_ART.md UA13) the sticks draw ui.stick.ring and the buttons ui.touch.button (the largest
 * whole multiple of the art inside the circle, shared/view/hud touchArtSize, at the flat fill's alpha; touchOpacity /
 * touchSize apply as before); without it, the flat circles. Either way each label sits in its box inside the control
 * (touchFace: TextScaled, capped), Flask / Ember show their icon and count when skinned, and a stick shows its word at
 * rest and its knob while held (touchStickParts). The controls keep clear of the corner panels' boxes, measured in
 * the HUD's own ScreenGui (touchLayout `hud`).
 *
 * Presentation only: it reads the store and the sim and never writes the sim. Everything it makes lives in the
 * Janitor; the render step (KV_TouchControls, before the sim samples input) is unbound with it.
 */
@Controller({})
export class TouchControlsController implements OnStart {
	private readonly janitor = new Janitor();
	/** A Roblox touch InputObject -> the finger number the touch machine knows it by. */
	private readonly fingerIds = new Map<InputObject, number>();
	/** Touches begun since the last frame, not yet a finger (see PendingTouch). */
	private readonly pending = new Map<InputObject, PendingTouch>();
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

	/** The HUD ScreenGui's rect in the touch GUI's space (the corner panels sit in it), or undefined: not mounted. */
	private hudFrame(ui: Ui): ScreenRect | undefined {
		const playerGui = ui.gui.Parent;
		const hud = playerGui?.FindFirstChild(HUD_GUI_NAME);
		if (hud === undefined || !hud.IsA("ScreenGui")) return undefined;
		const o = ui.gui.AbsolutePosition;
		const p = hud.AbsolutePosition;
		const size = hud.AbsoluteSize;
		if (!(size.X > 0 && size.Y > 0)) return undefined;
		return { x: p.X - o.X, y: p.Y - o.Y, w: size.X, h: size.Y };
	}

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
		const moveRef = artRef("move");
		const moveArt = moveRef !== undefined ? makeArt(moveBase, moveRef) : undefined;
		// Skinned (docs/UI_ART.md UA13): the ring art replaces the stroke.
		if (moveArt !== undefined) moveRing.Enabled = false;
		const moveKnob = makeKnob(moveBase);
		if (moveArt !== undefined) moveKnob.ZIndex = ART_Z.knob;
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

		return { gui, controls, moveZone, moveBase, moveRing, moveArt, moveKnob, markerFolder, marker };
	}

	// --- touches -----------------------------------------------------------------------------------------

	/** A touch began on a control: collected until frame() picks its one control (a second control's event joins it). */
	private begin(io: InputObject, id: TouchTargetId): void {
		if (io.UserInputType !== Enum.UserInputType.Touch) return;
		if (this.fingerIds.has(io)) return; // already a finger: a later InputBegan for the same touch
		const p = this.pending.get(io);
		if (p === undefined) {
			this.pending.set(io, { candidates: [id], x: io.Position.X, y: io.Position.Y, ended: false });
		} else if (!p.candidates.includes(id)) {
			p.candidates.push(id);
		}
	}

	private moved(io: InputObject): void {
		const n = this.fingerIds.get(io);
		if (n !== undefined) this.input.getTouch().move(n, io.Position.X, io.Position.Y);
	}

	private ended(io: InputObject): void {
		const p = this.pending.get(io);
		if (p !== undefined) p.ended = true; // a tap within one frame: it still begins (and presses) in frame()
		const n = this.fingerIds.get(io);
		if (n === undefined) return;
		this.input.getTouch().end(n);
		this.fingerIds.delete(io);
	}

	/** Each pending touch becomes ONE finger, on the control pickTouchTarget gives it; a lifted one ends at once. */
	private resolvePending(ui: Ui, layout: TouchLayoutResult, touch: TouchControls): void {
		if (this.pending.size() === 0) return;
		const origin = ui.gui.AbsolutePosition;
		for (const [io, p] of this.pending) {
			const gx = p.x - origin.X + TOUCH_LAYOUT.guiOffset.x;
			const gy = p.y - origin.Y + TOUCH_LAYOUT.guiOffset.y;
			const id = pickTouchTarget(layout, p.candidates, gx, gy);
			if (id === undefined) continue;
			const n = this.nextFinger;
			this.nextFinger += 1;
			this.fingerIds.set(io, n);
			touch.begin(n, id, p.x, p.y);
			if (p.ended || touchOver(io)) {
				touch.end(n);
				this.fingerIds.delete(io);
			} else {
				touch.move(n, io.Position.X, io.Position.Y); // any drag since the touch went down
			}
		}
		this.pending.clear();
	}

	/** Ends every finger whose touch is over without a TouchEnded (cancelled by the system, or the event was missed). */
	private sweepEnded(): void {
		const over = new Array<InputObject>();
		for (const [io] of this.fingerIds) if (touchOver(io)) over.push(io);
		for (const io of over) this.ended(io);
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
			// setTouchMode drops every finger on any change (play <-> spectate too): forget their touches with them.
			this.fingerIds.clear();
			this.pending.clear();
		}
		this.input.setTouchMode(mode);
		ui.gui.Enabled = mode !== "hidden";

		this.layoutIfChanged(ui, camera.ViewportSize, mode, display);
		const layout = this.layout;
		if (layout === undefined) return;
		const touch = this.input.getTouch();
		this.sweepEnded();
		this.resolvePending(ui, layout, touch);
		this.updateButtons(ui, layout, snapshot, display, touch);
		this.updateMove(ui, layout, display, touch);
		this.updateTarget(ui);
	}

	/** Re-lays the controls when anything they depend on changed (the viewport, the GUI, the settings, the mode). */
	private layoutIfChanged(ui: Ui, viewport: Vector2, mode: TouchMode, display: DisplaySettings): void {
		const safe = ui.gui.AbsoluteSize;
		const hud = this.hudFrame(ui);
		const hudKey = hud !== undefined ? `${hud.x},${hud.y},${hud.w},${hud.h}` : "-";
		const key = `${viewport.X},${viewport.Y},${safe.X},${safe.Y},${hudKey},${display.hudScale},${display.touchSize},${display.touchLeftHanded},${mode}`;
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
			hud,
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
			if (c.art !== undefined) {
				// Skinned: the art's opacity follows the setting and the press (touchArtTransparency).
				const artT = touchArtTransparency(opacity, held);
				if (c.fillT !== artT) {
					c.fillT = artT;
					c.art.image.ImageTransparency = artT;
				}
			} else if (c.fillT !== fillT) {
				c.fillT = fillT;
				c.button.BackgroundTransparency = fillT;
			}
			if (c.textT !== textT) {
				c.textT = textT;
				c.text.TextTransparency = textT;
				c.text.TextStrokeTransparency = 1 - opacity * STROKE_SHARE;
				if (c.knob !== undefined) c.knob.BackgroundTransparency = textT;
				if (c.icon !== undefined) c.icon.image.ImageTransparency = textT;
			}

			const visible = c.placed && (c.id !== "shrine" || snapshot.atShrine);
			if (c.button.Visible !== visible) c.button.Visible = visible;

			const count = c.id === "ember" ? `${snapshot.embers}` : c.id === "flask" ? `${snapshot.flask}` : "";
			const label = c.face === "iconCount" ? count : c.face === "wordCount" ? `${c.name} ${count}` : c.name;
			if (c.label !== label) {
				c.label = label;
				c.text.Text = label;
			}

			if (c.knob !== undefined) {
				// A stick: its word at rest, its knob while held (touchStickParts).
				const parts = touchStickParts(held);
				if (c.knob.Visible !== parts.knob) c.knob.Visible = parts.knob;
				if (c.text.Visible !== parts.label) c.text.Visible = parts.label;
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
		if (ui.moveArt !== undefined) ui.moveArt.image.ImageTransparency = touchArtTransparency(alpha, false);
		else ui.moveRing.Transparency = 1 - alpha;
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

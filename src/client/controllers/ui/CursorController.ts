import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { GuiService, Players, RunService, UserInputService, Workspace } from "@rbxts/services";
import { clientStore, selectCursorMenuContext, selectDisplay, selectInputDevice, selectJuice } from "client/store";
import { createKvScreenGui } from "client/ui";
import { RUN_ATTRIBUTES } from "shared/play";
import { cursorArt, type CursorArt, type CursorStateArt } from "shared/theme";
import { CURSOR_VIEW, cursorMode, cursorPlacement, cursorScale, cursorVisualId, type CursorMode } from "shared/view";
import { PreloadController } from "../game/PreloadController";
import { ThemeController } from "../game/ThemeController";

const GUI_NAME = "KV_Cursor";
const LABEL_NAME = "Gauntlet";
/** The render step's name (RunService.BindToRenderStep / UnbindFromRenderStep). */
const RENDER_STEP = "KV_Cursor";
/** A mouse press that squeezes the gauntlet (and, like a mouse move, brings the pointer back from a gamepad). */
const MOUSE_BUTTONS: ReadonlySet<Enum.UserInputType> = new Set([
	Enum.UserInputType.MouseButton1,
	Enum.UserInputType.MouseButton2,
]);

/**
 * The menus' gauntlet cursor (docs/CURSOR.md section 4, tasks C4 / C5) and the ONE writer of
 * `UserInputService.MouseIconEnabled` (MouseIconController's gamepad rule moved in here; that controller is gone).
 *
 * One ScreenGui `KV_Cursor` (CURSOR_VIEW.displayOrder, above every game layer; IgnoreGuiInset + ScreenInsets.None, so
 * `GetMouseLocation()` maps 1:1 onto it) holds one ImageLabel (never Active, never a button: it never eats a click,
 * Pixelated at whole-number scales). A `Last`-priority render step reads the mouse and the mode inputs, asks shared/view
 * `cursorMode` for the pointer (custom: the gauntlet; system: Roblox's; hidden: none), then writes
 * `MouseIconEnabled = mode === "system"` and the label's `Visible = mode === "custom"` in that same step, so a context
 * switch never shows both pointers or neither. Every property is written only when it differs; MouseIconEnabled is
 * compared against the engine's value every frame, so it is re-asserted if anything (the Roblox menu) changed it.
 *
 * Mode inputs: the art (`cursorArt(pack)`, undefined for a placeholder `ui.cursor`) and its readiness
 * (PreloadController, the drawn state's logical id: Roblox's pointer until it has downloaded); the menu context
 * (client/store `selectCursorMenuContext`); UserInputService MouseEnabled / TouchEnabled (touch-only = touch and no
 * mouse); the gamepad rule (hidden while the store's `inputDevice` is `gamepad`, back on a real mouse move or a mouse
 * click); the Roblox menu (GuiService.MenuOpened / MenuClosed); window focus (WindowFocused / WindowFocusReleased); the
 * kill switch Workspace attribute `KV_SystemCursor` (RUN_ATTRIBUTES.systemCursor, read on change).
 *
 * Hover (C5): in a menu context only, at CURSOR_VIEW.hoverPollHz, `PlayerGui:GetGuiObjectsAtPosition` under the mouse:
 * over a visible, Active, Interactable GuiButton outside KV_Cursor the yellow gauntlet (`ui.cursor.hover`, while its
 * art is ready; else the white one). Press: MouseButton1 / 2 while custom starts the squeeze about the fingertip
 * (cursorPlacement), whether or not the click was game-processed (menu clicks are), never under reduced motion.
 * Size: the display setting `cursorSize` and the viewport's height (cursorScale), live. Presentation only. Janitor:
 * the render step unbound, the gui destroyed, MouseIconEnabled back to its value before start.
 */
@Controller({})
export class CursorController implements OnStart {
	private readonly janitor = new Janitor();
	private art: CursorArt | undefined;
	private gui: ScreenGui | undefined;
	private label: ImageLabel | undefined;
	private playerGui: PlayerGui | undefined;

	// Mode inputs kept by events.
	private padHidden = false;
	private robloxMenuOpen = false;
	private windowFocused = true;
	private killSwitch = false;
	private normalReady = false;
	private hoverReady = false;

	// The last step's mode (the press squeeze runs only while custom), hover poll and press.
	private lastMode: CursorMode = "system";
	private overButton = false;
	private nextHoverPoll = 0;
	private pressStart: number | undefined;

	// What was last written to the label (written only on change).
	private drawn: CursorStateArt | undefined;
	private shownLast: boolean | undefined;
	private xLast = math.huge;
	private yLast = math.huge;
	private wLast = -1;
	private hLast = -1;

	constructor(private readonly theme: ThemeController, private readonly preload: PreloadController) {}

	onStart(): void {
		const before = UserInputService.MouseIconEnabled;
		this.janitor.Add(() => {
			UserInputService.MouseIconEnabled = before;
		}, true);

		this.art = cursorArt(this.theme.getPack());
		this.build();
		this.watchInputs();
		this.refreshReadiness();
		this.janitor.Add(
			this.preload.onReadinessChanged(() => this.refreshReadiness()),
			true,
		);

		RunService.BindToRenderStep(RENDER_STEP, Enum.RenderPriority.Last.Value, () => this.step());
		this.janitor.Add(() => RunService.UnbindFromRenderStep(RENDER_STEP), true);
	}

	private build(): void {
		const gui = createKvScreenGui(GUI_NAME);
		gui.ResetOnSpawn = false;
		gui.IgnoreGuiInset = true;
		gui.ScreenInsets = Enum.ScreenInsets.None;
		gui.DisplayOrder = CURSOR_VIEW.displayOrder;
		gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling;
		const label = new Instance("ImageLabel");
		label.Name = LABEL_NAME;
		label.BackgroundTransparency = 1;
		label.BorderSizePixel = 0;
		label.Active = false;
		label.Interactable = false;
		label.Selectable = false;
		label.ResampleMode = Enum.ResamplerMode.Pixelated;
		label.ScaleType = Enum.ScaleType.Stretch;
		label.Visible = false;
		label.Parent = gui;
		this.shownLast = false;
		this.playerGui = Players.LocalPlayer.WaitForChild("PlayerGui") as PlayerGui;
		gui.Parent = this.playerGui;
		this.gui = this.janitor.Add(gui);
		this.label = label;
	}

	private watchInputs(): void {
		// The gamepad rule (was MouseIconController): no pointer while on a pad, back on a real mouse move or a click.
		this.janitor.Add(
			clientStore.subscribe(selectInputDevice, (device) => {
				this.padHidden = device === "gamepad";
			}),
		);
		this.padHidden = selectInputDevice(clientStore.getState()) === "gamepad";
		this.janitor.Add(
			UserInputService.InputChanged.Connect((input) => {
				// A real move only: a zero-delta MouseMovement must not bring the pointer back under a pad.
				if (input.UserInputType !== Enum.UserInputType.MouseMovement) return;
				if (input.Delta.X !== 0 || input.Delta.Y !== 0) this.padHidden = false;
			}),
		);
		this.janitor.Add(
			UserInputService.InputBegan.Connect((input) => {
				if (!MOUSE_BUTTONS.has(input.UserInputType)) return;
				this.padHidden = false;
				// The squeeze whether or not the click was game-processed (a menu button's click is).
				if (this.lastMode === "custom" && !selectJuice(clientStore.getState()).reducedMotion) {
					this.pressStart = os.clock();
				}
			}),
		);
		// The Roblox menu: CoreGui draws its own cursor above ours.
		this.robloxMenuOpen = GuiService.MenuIsOpen;
		this.janitor.Add(GuiService.MenuOpened.Connect(() => (this.robloxMenuOpen = true)));
		this.janitor.Add(GuiService.MenuClosed.Connect(() => (this.robloxMenuOpen = false)));
		// Window focus: no gauntlet frozen at the window's edge while the game is in the background.
		this.janitor.Add(UserInputService.WindowFocused.Connect(() => (this.windowFocused = true)));
		this.janitor.Add(UserInputService.WindowFocusReleased.Connect(() => (this.windowFocused = false)));
		// The kill switch, read on change.
		const readKill = () => (this.killSwitch = Workspace.GetAttribute(RUN_ATTRIBUTES.systemCursor) === true);
		readKill();
		this.janitor.Add(Workspace.GetAttributeChangedSignal(RUN_ATTRIBUTES.systemCursor).Connect(readKill));
	}

	private refreshReadiness(): void {
		const art = this.art;
		this.normalReady = art !== undefined && this.preload.isArtReady(art.normal.id);
		this.hoverReady = art !== undefined && this.preload.isArtReady(art.hover.id);
	}

	private step(): void {
		const label = this.label;
		if (label === undefined) return;
		const art = this.art;
		const state = clientStore.getState();
		const menuContext = selectCursorMenuContext(state);
		const mouseEnabled = UserInputService.MouseEnabled;
		const mouse = UserInputService.GetMouseLocation();

		// Hover (C5): only in a menu context, throttled; outside one the white gauntlet's state is kept clear.
		if (menuContext && art !== undefined && mouseEnabled) {
			const now = os.clock();
			if (now >= this.nextHoverPoll) {
				this.nextHoverPoll = now + 1 / CURSOR_VIEW.hoverPollHz;
				this.overButton = this.buttonAt(mouse);
			}
		} else {
			this.overButton = false;
			this.nextHoverPoll = 0;
		}

		// The drawn state: the hover art only once it has downloaded, else the plain gauntlet.
		const hover = cursorVisualId({ overButton: this.overButton }) === CURSOR_VIEW.hoverVisualId;
		const useHover = hover && this.hoverReady;
		const stateArt = art === undefined ? undefined : useHover ? art.hover : art.normal;
		const mode = cursorMode({
			hasCustomArt: art !== undefined,
			artReady: useHover ? this.hoverReady : this.normalReady,
			menuContext,
			mouseEnabled,
			touchOnly: UserInputService.TouchEnabled && !mouseEnabled,
			onGamepad: this.padHidden,
			robloxMenuOpen: this.robloxMenuOpen,
			windowFocused: this.windowFocused,
			killSwitch: this.killSwitch,
		});
		this.lastMode = mode;

		// The two pointers, written in the same step (never both, never neither).
		const system = mode === "system";
		if (UserInputService.MouseIconEnabled !== system) UserInputService.MouseIconEnabled = system;
		const shown = mode === "custom" && stateArt !== undefined;
		if (shown && stateArt !== undefined) this.place(label, stateArt, mouse);
		else this.pressStart = undefined;
		if (this.shownLast !== shown) {
			label.Visible = shown;
			this.shownLast = shown;
		}
	}

	/** The art, size and position of the label for this frame (each written only when it changed). */
	private place(label: ImageLabel, stateArt: CursorStateArt, mouse: Vector2): void {
		if (this.drawn !== stateArt) {
			label.Image = stateArt.assetId;
			const rect = stateArt.rect;
			label.ImageRectOffset = rect !== undefined ? new Vector2(rect.x, rect.y) : Vector2.zero;
			label.ImageRectSize = rect !== undefined ? new Vector2(rect.w, rect.h) : Vector2.zero;
			this.drawn = stateArt;
		}
		let pressT: number | undefined;
		if (this.pressStart !== undefined) {
			pressT = os.clock() - this.pressStart;
			if (pressT > CURSOR_VIEW.pressSec) {
				this.pressStart = undefined;
				pressT = undefined;
			}
		}
		const camera = Workspace.CurrentCamera;
		const viewportHeight = camera !== undefined ? camera.ViewportSize.Y : 0;
		const scale = cursorScale(viewportHeight, selectDisplay(clientStore.getState()).cursorSize);
		const p = cursorPlacement(
			{ x: mouse.X, y: mouse.Y },
			stateArt.pivot,
			{ x: stateArt.size.w, y: stateArt.size.h },
			scale,
			pressT,
		);
		if (p.x !== this.xLast || p.y !== this.yLast) {
			label.Position = UDim2.fromOffset(p.x, p.y);
			this.xLast = p.x;
			this.yLast = p.y;
		}
		if (p.width !== this.wLast || p.height !== this.hLast) {
			label.Size = UDim2.fromOffset(p.width, p.height);
			this.wLast = p.width;
			this.hLast = p.height;
		}
	}

	/**
	 * A visible, Active, Interactable GuiButton under the mouse, outside the cursor's own ScreenGui.
	 *
	 * GUI inset (docs/CURSOR.md C0 (c), unconfirmed headlessly): Roblox documents GetGuiObjectsAtPosition in the space
	 * of InputObject.Position, which excludes the top bar inset, while GetMouseLocation() includes it; so the inset is
	 * taken off here (as TooltipController does for its pointer). If the Studio check finds the call wants the raw
	 * mouse position (the hover shifting by the top bar's height), drop the subtraction.
	 */
	private buttonAt(mouse: Vector2): boolean {
		const playerGui = this.playerGui;
		const gui = this.gui;
		if (playerGui === undefined || gui === undefined) return false;
		const inset = GuiService.GetGuiInset()[0];
		const hits = playerGui.GetGuiObjectsAtPosition(mouse.X - inset.X, mouse.Y - inset.Y);
		for (const hit of hits) {
			if (!hit.IsA("GuiButton")) continue;
			if (!hit.Visible || !hit.Active || !hit.Interactable) continue;
			if (hit.IsDescendantOf(gui)) continue;
			return true;
		}
		return false;
	}
}

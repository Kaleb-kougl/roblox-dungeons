import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { GuiService, Players, RunService, UserInputService, Workspace } from "@rbxts/services";
import { logInfo } from "client/log";
import {
	clientStore,
	selectBindings,
	selectInputCaptured,
	selectInputDevice,
	selectRobloxMenuOpen,
	selectStageCovered,
	type ClientState,
} from "client/store";
import { PAD_HOLD_UI, type FocusScopeHandle, type FocusScopeRegistry } from "client/ui";
import {
	CorePromptGuard,
	FocusMemory,
	GAMEPAD_MENU,
	GAMEPAD_MENU_ATTRIBUTES,
	NO_SELECTION_IMAGE_NAME,
	PAD_KEYS,
	PadHoldGate,
	ScrollEndLatch,
	focusAction,
	menuPadAction,
	padBackMeaning,
	padConfirmFeedback,
	padScrollStep,
	pickFocusScope,
	scrollMaxY,
	scrollToShow,
	type FocusContext,
	type FocusPath,
	type FocusScopeEntry,
	type FocusSelection,
	type MenuPadInput,
} from "shared/view/menu";
import { HapticsController } from "../fx/HapticsController";
import { InputController } from "../game/InputController";
import { watchSpikeFlag } from "../spikes/spikeFlags";

/** One registered scope: its handle and its mount order (unique: the registry's key). */
interface ScopeRecord {
	readonly handle: FocusScopeHandle;
	readonly mountOrder: number;
}

const STOP = Enum.SelectionBehavior.Stop;

/** `obj` and every GuiObject above it Visible, up to a LayerCollector that is Enabled and under PlayerGui. */
function guiShown(obj: Instance, playerGui: Instance | undefined): boolean {
	let node: Instance | undefined = obj;
	while (node !== undefined) {
		if (node.IsA("GuiObject")) {
			if (!node.Visible) return false;
		} else if (node.IsA("LayerCollector")) {
			return node.Enabled && playerGui !== undefined && node.IsDescendantOf(playerGui);
		}
		node = node.Parent;
	}
	return false;
}

/** The Names from `root` (exclusive) down to `obj` (inclusive); undefined when `obj` is not under `root`. */
function namesUnder(obj: Instance, root: Instance): FocusPath | undefined {
	if (obj === root || !obj.IsDescendantOf(root)) return undefined;
	const names = new Array<string>();
	let node: Instance | undefined = obj;
	while (node !== undefined && node !== root) {
		names.unshift(node.Name);
		node = node.Parent;
	}
	return names;
}

/** The first Instance at `path` under `root` (by Names), or undefined. */
function resolvePath(root: Instance, path: FocusPath): Instance | undefined {
	let node: Instance | undefined = root;
	for (const name of path) {
		if (node === undefined) return undefined;
		node = node.FindFirstChild(name);
	}
	return node;
}

/**
 * The product of every UIScale above `obj` (the HUD's and MenuFit's): a ScrollingFrame's CanvasPosition is taken to
 * be in unscaled (reference) px, its Absolute* sizes in screen px (GM5; the Studio check confirms the units).
 */
function uiScaleAbove(obj: Instance): number {
	let scale = 1;
	let node: Instance | undefined = obj.Parent;
	while (node !== undefined && !node.IsA("LayerCollector")) {
		const ui = node.FindFirstChildOfClass("UIScale");
		if (ui !== undefined && ui.Scale > 0) scale *= ui.Scale;
		node = node.Parent;
	}
	return scale;
}

/** The nearest vertically scrolling ScrollingFrame above `obj`, below `root` (exclusive), or undefined. */
function scrollParentOf(obj: Instance, root: Instance): ScrollingFrame | undefined {
	let node: Instance | undefined = obj.Parent;
	while (node !== undefined && node !== root) {
		if (node.IsA("ScrollingFrame") && node.ScrollingDirection !== Enum.ScrollingDirection.X) return node;
		node = node.Parent;
	}
	return undefined;
}

/** B is held on any connected pad (behind pcall: the call throws for a pad that went away). */
function padBDown(): boolean {
	const [ok, pads] = pcall(() => UserInputService.GetConnectedGamepads());
	if (!ok) return false;
	for (const pad of pads) {
		const [okDown, down] = pcall(() => UserInputService.IsGamepadButtonDown(pad, Enum.KeyCode.ButtonB));
		if (okDown && down) return true;
	}
	return false;
}

/** GuiService's CoreGui selection, which @rbxts/types leaves out (the engine may refuse a game script the read). */
interface CoreSelection {
	readonly SelectedCoreObject?: Instance;
}

/**
 * A Roblox CoreGui object has the gamepad selection (a prompt navigates CoreGui). Behind pcall: where the engine refuses
 * the read, this is false and only our invite prompt's own open / closed tracking holds the menus back.
 */
function coreSelected(): boolean {
	const [ok, obj] = pcall(() => (GuiService as unknown as CoreSelection).SelectedCoreObject);
	return ok && obj !== undefined;
}

/**
 * Gamepad menus: focus scopes, recovery and memory (docs/GAMEPAD_MENUS.md sections 1-3, GM2-GM4; the rules are pure in
 * shared/view/menu focus.ts / padActions.ts). Components register their surfaces through client/ui useFocusScope /
 * FocusScope (this controller is the FocusScopesContext registry HudController and LoadingController provide).
 *
 *   owner     the topmost active scope (pickFocusScope: FOCUS_LAYERS, then the latest mounted) whose root is drawn;
 *             nobody under the stage cover or during a rebind capture (store `options.inputCaptured`)
 *   scopes    every drawn root becomes a SelectionGroup that stops on all four sides (nothing is reached by wandering
 *             off an edge, GMD2), its default button gets GAMEPAD_MENU.defaultSelectionOrder
 *   selection on a SelectedObject change, a scope mount / unmount / change, a device change, and every frame on a
 *             gamepad: focusAction. A usable selection stays (and, with a memory key, is remembered by its Names
 *             under the root: session only, GMD9); a missing / outside / hidden / unselectable one goes to the
 *             remembered button if it still resolves, else the default (else GuiService:Select(root)); off the
 *             gamepad, or with no owner, it is cleared (GMD6). Nothing is touched while the Roblox menu is open,
 *             during a rebind capture (RebindController owns GuiNavigationEnabled then), while KV_PadSpike runs, or
 *             while a Roblox CoreGui prompt has the pad (CorePromptGuard: GuiService.SelectedCoreObject set, or our
 *             invite prompt open until GameInvitePromptClosed; then GAMEPAD_MENU.corePromptGraceSec more).
 *   look      PlayerGui.SelectionImageObject is an empty, fully transparent Frame (GMD7: MenuButton's ring / corners
 *             are the only focus look), restored on cleanup and while the pad spike runs
 *   pad       B (InputBegan; Backspace stays MenuController's keyboard path) and InputController.onMenuPadInput (the
 *             bumpers, triggers, X / Y, right-stick steps) go to the owner as menuPadAction(owner surface, key, its
 *             pad context): one press, one owner, one action (GM3). Never during a rebind capture, the Roblox menu
 *             or a CoreGui prompt. A shortcut on the player's pad restart key yields to the restart (padContext
 *             `restartPad`). The key that drove an action is blocked for the game until released
 *             (InputController.blockHeldPadInputs), so a B / X that closes a menu never reaches the run.
 *   scroll    (GM5) a scope's `scrollRef` list scrolls by GAMEPAD_MENU.scrollStepPx per right-stick step (padScrollStep,
 *             clamped), with MENU_HAPTICS.listEnd once per arrival at an end (ScrollEndLatch); a newly selected
 *             button inside a ScrollingFrame and outside its window is scrolled into view (followSelection:
 *             scrollToShow with GAMEPAD_MENU.followMarginPx), harmless where the engine already does it
 *   haptics   (GM9) a MenuButton activation right after ButtonA (buttonPressed) ticks `confirm` or buzzes `disabled`
 *             (HapticsController: gamepad and vibration On only)
 *   hold B    (GM9, GMD13) while a scope whose B means holdExit (the run over) owns the pad, B's held state is polled
 *             every frame into PadHoldGate (a B held when it took the pad must be let go first; an early release
 *             empties it); PAD_HOLD_UI carries the fill to the Exit button; completing sends `holdExit` to the scope
 *             (it does what Exit does) and ticks `holdComplete`. A B press there dispatches nothing.
 *   debug     Workspace attribute KV_FocusDebug (GAMEPAD_MENU_ATTRIBUTES.focusDebug, off by default): owner changes,
 *             the selections made (full paths) and the pad actions dispatched.
 */
@Controller({})
export class FocusController implements OnStart, FocusScopeRegistry {
	private readonly janitor = new Janitor();
	private readonly scopes = new Array<ScopeRecord>();
	private readonly memory = new FocusMemory();
	/** The button each scope last gave the default SelectionOrder (reset when its default changes). */
	private readonly defaults = new Map<number, GuiObject>();
	private nextMountOrder = 0;
	private owner: ScopeRecord | undefined;
	private started = false;
	private dirty = true;
	private deferred = false;
	private spikeOn = false;
	private debug = false;
	private playerGui: PlayerGui | undefined;
	/** Puts the original SelectionImageObject back (set while the empty one is in place). */
	private restoreImage: (() => void) | undefined;
	/** os.clock() of the last ButtonA press (the confirm haptic's window), or undefined. */
	private lastAPress: number | undefined;
	/** The selection followSelection last handled (it runs once per newly selected button). */
	private followed: GuiObject | undefined;
	/** The main list's end latch (reset when the owner changes). */
	private readonly scrollEnds = new ScrollEndLatch();
	/** Hold B to exit: the gate and the scope it was opened for. */
	private readonly hold = new PadHoldGate();
	private holdOwner: ScopeRecord | undefined;
	/** A Roblox CoreGui prompt has the pad (the menus leave it alone meanwhile). */
	private readonly corePrompt = new CorePromptGuard();

	constructor(private readonly input: InputController, private readonly haptics: HapticsController) {}

	onStart(): void {
		this.playerGui = Players.LocalPlayer.WaitForChild("PlayerGui") as PlayerGui;
		this.debug = Workspace.GetAttribute(GAMEPAD_MENU_ATTRIBUTES.focusDebug) === true;
		this.janitor.Add(
			Workspace.GetAttributeChangedSignal(GAMEPAD_MENU_ATTRIBUTES.focusDebug).Connect(() => {
				this.debug = Workspace.GetAttribute(GAMEPAD_MENU_ATTRIBUTES.focusDebug) === true;
			}),
		);
		this.started = true;
		this.janitor.Add(() => this.restoreSelectionImage(), true);
		this.janitor.Add(watchSpikeFlag("pad", (on) => this.setSpike(on)));
		this.janitor.Add(GuiService.GetPropertyChangedSignal("SelectedObject").Connect(() => this.changed()));
		this.janitor.Add(clientStore.subscribe(selectInputDevice, () => this.changed()));
		this.janitor.Add(clientStore.subscribe(selectStageCovered, () => this.changed()));
		this.janitor.Add(clientStore.subscribe(selectInputCaptured, () => this.changed()));
		this.janitor.Add(
			RunService.RenderStepped.Connect((dt) => {
				if (this.dirty || selectInputDevice(clientStore.getState()) === "gamepad") this.evaluate();
				this.stepHold(dt);
			}),
		);
		this.janitor.Add(
			UserInputService.InputBegan.Connect((input) => {
				const name = input.KeyCode.Name;
				if (name === PAD_KEYS.a) this.lastAPress = os.clock();
				if (name !== PAD_KEYS.b) return;
				this.dispatch({ keyName: PAD_KEYS.b, x: 0, y: 0 });
			}),
		);
		this.janitor.Add(() => PAD_HOLD_UI.set(0), true);
		this.janitor.Add(this.input.onMenuPadInput((input) => this.dispatch(input)));
		this.changed();
	}

	// --- FocusScopeRegistry ---------------------------------------------------------------------

	register(handle: FocusScopeHandle): () => void {
		this.nextMountOrder += 1;
		const record: ScopeRecord = { handle, mountOrder: this.nextMountOrder };
		this.scopes.push(record);
		this.changed();
		return () => {
			const i = this.scopes.indexOf(record);
			if (i >= 0) this.scopes.remove(i);
			this.defaults.delete(record.mountOrder);
			this.changed();
		};
	}

	/** Something the decision reads changed: check again once this frame's changes are in (deferred). */
	changed(): void {
		this.dirty = true;
		if (!this.started || this.deferred) return;
		this.deferred = true;
		task.defer(() => {
			this.deferred = false;
			if (this.dirty) this.evaluate();
		});
	}

	/** Our invite prompt (PromptGameInvite) was requested: the menus leave the pad to it until it closes. */
	invitePromptOpened(): void {
		this.corePrompt.invitePromptOpened(os.clock());
		this.changed();
	}

	/** Our invite prompt closed (GameInvitePromptClosed), failed or was refused. */
	invitePromptClosed(): void {
		this.corePrompt.invitePromptClosed();
		this.changed();
	}

	buttonPressed(disabled: boolean): void {
		// Deferred: the engine may fire Activated before UserInputService.InputBegan reports the A press that caused it.
		task.defer(() => {
			const since = this.lastAPress !== undefined ? os.clock() - this.lastAPress : undefined;
			const device = selectInputDevice(clientStore.getState());
			const feedback = padConfirmFeedback(device, since, GAMEPAD_MENU.confirmPressWindowSec, disabled);
			if (feedback === "none") return;
			// One A press, one cue (a button that re-renders and fires again within the window never buzzes twice).
			this.lastAPress = undefined;
			this.haptics.play(feedback);
		});
	}

	// --- internals ------------------------------------------------------------------------------

	/** A Roblox CoreGui prompt has the pad now, or went within GAMEPAD_MENU.corePromptGraceSec (CorePromptGuard). */
	private corePromptBusy(): boolean {
		const m = GAMEPAD_MENU;
		return this.corePrompt.busy(os.clock(), coreSelected(), m.invitePromptHoldSec, m.corePromptGraceSec);
	}

	private context(state: ClientState): FocusContext {
		return {
			stageCovered: selectStageCovered(state),
			rebindCapturing: selectInputCaptured(state),
			device: selectInputDevice(state),
		};
	}

	/** Prepares every drawn root (SelectionGroup, Stop, the default's order) and picks the owner. */
	private pickOwner(ctx: FocusContext): ScopeRecord | undefined {
		const entries = new Array<FocusScopeEntry>();
		for (const record of this.scopes) {
			const options = record.handle.options();
			const root = record.handle.root();
			const drawn = root !== undefined && guiShown(root, this.playerGui);
			if (drawn) this.prepare(record, root);
			entries.push({
				id: options.id,
				layer: options.layer,
				mountOrder: record.mountOrder,
				active: drawn && options.active !== false,
			});
		}
		const picked = pickFocusScope(entries, ctx);
		if (picked === undefined) return undefined;
		for (const record of this.scopes) if (record.mountOrder === picked.mountOrder) return record;
		return undefined;
	}

	private prepare(record: ScopeRecord, root: GuiObject): void {
		if (!root.SelectionGroup) root.SelectionGroup = true;
		if (root.SelectionBehaviorUp !== STOP) root.SelectionBehaviorUp = STOP;
		if (root.SelectionBehaviorDown !== STOP) root.SelectionBehaviorDown = STOP;
		if (root.SelectionBehaviorLeft !== STOP) root.SelectionBehaviorLeft = STOP;
		if (root.SelectionBehaviorRight !== STOP) root.SelectionBehaviorRight = STOP;
		const def = record.handle.options().defaultRef?.current;
		const last = this.defaults.get(record.mountOrder);
		if (last !== undefined && last !== def) {
			if (last.Parent !== undefined && last.SelectionOrder === GAMEPAD_MENU.defaultSelectionOrder) {
				last.SelectionOrder = 0;
			}
			this.defaults.delete(record.mountOrder);
		}
		if (def === undefined) return;
		if (def.SelectionOrder !== GAMEPAD_MENU.defaultSelectionOrder) {
			def.SelectionOrder = GAMEPAD_MENU.defaultSelectionOrder;
		}
		this.defaults.set(record.mountOrder, def);
	}

	private evaluate(): void {
		this.dirty = false;
		const state = clientStore.getState();
		const ctx = this.context(state);
		const owner = this.pickOwner(ctx);
		if (owner !== this.owner) {
			this.owner = owner;
			this.scrollEnds.reset();
			if (this.debug) {
				const o = owner?.handle.options();
				logInfo(`[Focus] owner ${o !== undefined ? `${o.id} (${o.layer} / ${o.surface})` : "none"}`);
			}
		}
		// The Roblox menu navigates CoreGui; the pad spike drives the selection itself.
		if (this.spikeOn || selectRobloxMenuOpen(state)) return;
		// A CoreGui prompt (an invite prompt) has the pad: no recovery stealing it back; check again once it went.
		if (this.corePromptBusy()) {
			this.dirty = true;
			return;
		}
		const root = owner?.handle.root();
		const options = owner?.handle.options();
		const selected = GuiService.SelectedObject;
		let selection: FocusSelection | undefined;
		if (selected !== undefined) {
			selection = {
				insideOwner: root !== undefined && (selected === root || selected.IsDescendantOf(root)),
				visible: guiShown(selected, this.playerGui),
				selectable: selected.Selectable,
			};
		}
		const memoryKey = options?.memoryKey;
		if (
			root !== undefined &&
			memoryKey !== undefined &&
			selected !== undefined &&
			selection !== undefined &&
			selection.insideOwner &&
			selection.visible &&
			selection.selectable
		) {
			this.memory.remember(memoryKey, namesUnder(selected, root));
		}
		const remembered = root !== undefined && memoryKey !== undefined ? this.recall(memoryKey, root) : undefined;
		const action = focusAction({
			...ctx,
			owner: owner !== undefined && options !== undefined ? this.entryOf(owner) : undefined,
			selection,
			memoryAvailable: remembered !== undefined,
		});
		if (action === "keep") {
			if (root !== undefined && selected !== undefined && selection?.insideOwner === true) {
				this.followSelection(selected, root);
			}
			return;
		}
		if (action === "clear") {
			this.select(undefined, "clear");
			return;
		}
		if (action === "restoreMemory" && remembered !== undefined) {
			this.select(remembered, "memory");
			return;
		}
		if (root === undefined) return;
		const def = options?.defaultRef?.current;
		if (def !== undefined && this.usable(def, root)) {
			this.select(def, "default");
			return;
		}
		pcall(() => GuiService.Select(root));
		if (this.debug && GuiService.SelectedObject !== selected) {
			logInfo(
				`[Focus] Select(${root.GetFullName()}) -> ${GuiService.SelectedObject?.GetFullName() ?? "nothing"}`,
			);
		}
	}

	private entryOf(record: ScopeRecord): FocusScopeEntry {
		const o = record.handle.options();
		return { id: o.id, layer: o.layer, mountOrder: record.mountOrder, active: o.active };
	}

	/** A selectable, drawn GuiObject under `root`. */
	private usable(obj: Instance, root: GuiObject): obj is GuiObject {
		return obj.IsA("GuiObject") && obj.Selectable && obj.IsDescendantOf(root) && guiShown(obj, this.playerGui);
	}

	/** The remembered button for `key` when it still resolves under `root` to a usable one. */
	private recall(key: string, root: GuiObject): GuiObject | undefined {
		const path = this.memory.recall(key);
		if (path === undefined) return undefined;
		const obj = resolvePath(root, path);
		return obj !== undefined && this.usable(obj, root) ? obj : undefined;
	}

	private select(obj: GuiObject | undefined, why: string): void {
		if (GuiService.SelectedObject === obj) return;
		GuiService.SelectedObject = obj;
		if (this.debug) logInfo(`[Focus] ${why}: ${obj !== undefined ? obj.GetFullName() : "nothing selected"}`);
	}

	/** A menu pad press (B, or InputController's menu pad input) for the owner, through its surface's table. */
	private dispatch(input: MenuPadInput): void {
		const state = clientStore.getState();
		if (selectInputCaptured(state) || selectRobloxMenuOpen(state) || this.corePromptBusy()) return;
		const owner = this.pickOwner(this.context(state));
		if (owner === undefined) return;
		const o = owner.handle.options();
		// The player's pad restart wins over a shortcut on the same key (padShortcutYields; the driver key fires).
		const ctx = { ...(o.padContext ?? {}), restartPad: selectBindings(state).pad.restart };
		const action = menuPadAction(o.surface, input.keyName, ctx);
		if (action.kind === "none" || action.kind === "select") return;
		// Hold B: the press itself does nothing (GMD5); stepHold sends holdExit once the hold completes.
		if (action.kind === "holdExit") return;
		if (this.debug) logInfo(`[Focus] ${input.keyName} on ${o.id} (${o.surface}): ${action.kind}`);
		if (action.kind === "scroll") {
			const list = o.scrollRef?.current;
			if (list !== undefined) {
				if (list.IsA("ScrollingFrame")) this.scrollList(list, input.y);
				return;
			}
		}
		// The button that drove the action reads released for the game until let go (it may hand control back to it).
		if (input.keyName !== PAD_KEYS.rightStick) this.input.blockHeldPadInputs([input.keyName]);
		o.onPadAction?.(action, input);
	}

	/** GM5: one right-stick step on `list` (up: toward its start), the list end's tick once per arrival. */
	private scrollList(list: ScrollingFrame, stickY: number): void {
		const k = uiScaleAbove(list);
		const maxY = scrollMaxY(list.AbsoluteCanvasSize.Y / k, list.AbsoluteWindowSize.Y / k);
		const result = padScrollStep(list.CanvasPosition.Y, maxY, stickY, GAMEPAD_MENU.scrollStepPx);
		if (result.moved) list.CanvasPosition = new Vector2(list.CanvasPosition.X, result.y);
		if (this.scrollEnds.step(result)) this.haptics.play("listEnd");
	}

	/**
	 * GM5 followSelection: a newly selected button inside a vertical ScrollingFrame (under the owner's root) and outside
	 * its window is scrolled into view, GAMEPAD_MENU.followMarginPx inside it (scrollToShow). Once per selection, so it
	 * never fights the right stick; a frame the engine already scrolled is left as it is (scrollToShow moves nothing).
	 */
	private followSelection(selected: GuiObject, root: GuiObject): void {
		if (selected === this.followed) return;
		this.followed = selected;
		const list = scrollParentOf(selected, root);
		if (list === undefined) return;
		const k = uiScaleAbove(list);
		const canvasY = list.CanvasPosition.Y;
		const itemTop = (selected.AbsolutePosition.Y - list.AbsolutePosition.Y) / k + canvasY;
		const y = scrollToShow(
			canvasY,
			itemTop,
			selected.AbsoluteSize.Y / k,
			list.AbsoluteWindowSize.Y / k,
			GAMEPAD_MENU.followMarginPx,
			list.AbsoluteCanvasSize.Y / k,
		);
		if (y !== canvasY) list.CanvasPosition = new Vector2(list.CanvasPosition.X, y);
	}

	/** GM9 hold B to exit: polls B while a holdExit scope owns the pad (see the class comment). */
	private stepHold(dt: number): void {
		const state = clientStore.getState();
		const owner = this.owner;
		const holds =
			owner !== undefined &&
			padBackMeaning(owner.handle.options().surface) === "holdExit" &&
			!selectInputCaptured(state) &&
			!selectRobloxMenuOpen(state) &&
			!this.spikeOn &&
			!this.corePromptBusy();
		if (!holds || owner === undefined) {
			if (this.holdOwner !== undefined) {
				this.holdOwner = undefined;
				this.hold.close();
			}
			PAD_HOLD_UI.set(0);
			return;
		}
		const down = padBDown();
		if (this.holdOwner !== owner) {
			this.holdOwner = owner;
			this.hold.open(down);
		}
		const step = this.hold.step(down, dt, GAMEPAD_MENU.holdExitSec);
		PAD_HOLD_UI.set(this.hold.progress(GAMEPAD_MENU.holdExitSec));
		if (step !== "complete") return;
		const o = owner.handle.options();
		if (this.debug) logInfo(`[Focus] hold B complete on ${o.id} (${o.surface}): holdExit`);
		this.haptics.play("holdComplete");
		o.onPadAction?.({ kind: "holdExit" }, { keyName: PAD_KEYS.b, x: 0, y: 0 });
	}

	/** The pad spike (KV_PadSpike) takes over the selection and the selection image while it runs. */
	private setSpike(on: boolean): void {
		this.spikeOn = on;
		if (on) this.restoreSelectionImage();
		else this.hideSelectionImage();
	}

	/** GMD7: Roblox's default selection box is replaced by an empty, fully transparent Frame. */
	private hideSelectionImage(): void {
		const playerGui = this.playerGui;
		if (playerGui === undefined || this.restoreImage !== undefined) return;
		const original = playerGui.SelectionImageObject;
		const empty = new Instance("Frame");
		empty.Name = NO_SELECTION_IMAGE_NAME;
		empty.BackgroundTransparency = 1;
		empty.BorderSizePixel = 0;
		empty.Size = UDim2.fromScale(1, 1);
		playerGui.SelectionImageObject = empty;
		this.restoreImage = () => {
			if (playerGui.SelectionImageObject === empty) playerGui.SelectionImageObject = original;
			empty.Destroy();
		};
	}

	private restoreSelectionImage(): void {
		const restore = this.restoreImage;
		this.restoreImage = undefined;
		restore?.();
	}
}

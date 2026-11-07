import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { GuiService, Players, RunService, UserInputService, Workspace } from "@rbxts/services";
import {
	clientStore,
	selectInputCaptured,
	selectInputDevice,
	selectRobloxMenuOpen,
	selectStageCovered,
	type ClientState,
} from "client/store";
import type { FocusScopeHandle, FocusScopeRegistry } from "client/ui";
import {
	FocusMemory,
	GAMEPAD_MENU,
	GAMEPAD_MENU_ATTRIBUTES,
	PAD_KEYS,
	focusAction,
	menuPadAction,
	pickFocusScope,
	type FocusContext,
	type FocusPath,
	type FocusScopeEntry,
	type FocusSelection,
	type MenuPadInput,
} from "shared/view/menu";
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
 *             during a rebind capture (RebindController owns GuiNavigationEnabled then), or while KV_PadSpike runs.
 *   look      PlayerGui.SelectionImageObject is an empty, fully transparent Frame (GMD7: MenuButton's ring / corners
 *             are the only focus look), restored on cleanup and while the pad spike runs
 *   pad       B (InputBegan; Backspace stays MenuController's keyboard path) and InputController.onMenuPadInput (the
 *             bumpers, triggers, X / Y, right-stick steps) go to the owner as menuPadAction(owner surface, key, its
 *             pad context): one press, one owner, one action (GM3). Never during a rebind capture or the Roblox menu.
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

	constructor(private readonly input: InputController) {}

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
			RunService.RenderStepped.Connect(() => {
				if (this.dirty || selectInputDevice(clientStore.getState()) === "gamepad") this.evaluate();
			}),
		);
		this.janitor.Add(
			UserInputService.InputBegan.Connect((input) => {
				if (input.KeyCode.Name !== PAD_KEYS.b) return;
				this.dispatch({ keyName: PAD_KEYS.b, x: 0, y: 0 });
			}),
		);
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

	// --- internals ------------------------------------------------------------------------------

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
			if (this.debug) {
				const o = owner?.handle.options();
				print(`[Focus] owner ${o !== undefined ? `${o.id} (${o.layer} / ${o.surface})` : "none"}`);
			}
		}
		// The Roblox menu navigates CoreGui; the pad spike drives the selection itself.
		if (this.spikeOn || selectRobloxMenuOpen(state)) return;
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
		if (action === "keep") return;
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
			print(`[Focus] Select(${root.GetFullName()}) -> ${GuiService.SelectedObject?.GetFullName() ?? "nothing"}`);
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
		if (this.debug) print(`[Focus] ${why}: ${obj !== undefined ? obj.GetFullName() : "nothing selected"}`);
	}

	/** A menu pad press (B, or InputController's menu pad input) for the owner, through its surface's table. */
	private dispatch(input: MenuPadInput): void {
		const state = clientStore.getState();
		if (selectInputCaptured(state) || selectRobloxMenuOpen(state)) return;
		const owner = this.pickOwner(this.context(state));
		if (owner === undefined) return;
		const o = owner.handle.options();
		const action = menuPadAction(o.surface, input.keyName, o.padContext ?? {});
		if (action.kind === "none" || action.kind === "select") return;
		if (this.debug) print(`[Focus] ${input.keyName} on ${o.id} (${o.surface}): ${action.kind}`);
		o.onPadAction?.(action, input);
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
		empty.Name = "KV_NoSelectionImage";
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

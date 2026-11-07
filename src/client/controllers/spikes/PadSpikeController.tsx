import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import React from "@rbxts/react";
import { ReflexProvider } from "@rbxts/react-reflex";
import { createRoot } from "@rbxts/react-roblox";
import { GuiService, HapticService, Players, RunService, UserInputService, Workspace } from "@rbxts/services";
import { clientStore } from "client/store";
import { DEV_MONO_FONT, MenuButton, createKvScreenGui } from "client/ui";
import { PAD_SPIKE } from "shared/config";
import { NO_SELECTION_IMAGE_NAME } from "shared/view/menu";
import { watchSpikeFlag } from "./spikeFlags";

const GUI_NAME = "KV_PadSpike";
const TRAP_GUI_NAME = "KV_PadSpikeTrap";
const PROBE_GUI_NAME = "KV_PadSpikeInsetProbe";
const HIDDEN = 1;
const FULL = 1;
const PAIR_FORMAT = "%.0f, %.0f";
const GAMEPAD_PREFIX = "Gamepad";
const BUTTON_PREFIX = "Button";
/** The Select(root) row: A and B keep the default SelectionOrder. */
const DEFAULT_ORDER = 0;

function rgb(c: ReadonlyArray<number>): Color3 {
	return Color3.fromRGB(c[0], c[1], c[2]);
}

function yn(value: boolean): string {
	return value ? "yes" : "no";
}

function pair(v: Vector2): string {
	return string.format(PAIR_FORMAT, v.X, v.Y);
}

function startsWith(s: string, prefix: string): boolean {
	return string.sub(s, 1, prefix.size()) === prefix;
}

/** The value read by `read`, as text, or the error it raised (an API this engine or these types may lack). */
function tryRead(read: () => unknown): string {
	const [ok, value] = pcall(read);
	if (!ok) return `error: ${value}`;
	if (typeIs(value, "EnumItem")) return value.Name;
	if (typeIs(value, "boolean")) return yn(value);
	return tostring(value);
}

/** A GuiObject for the log: `<root gui>/<name>`, flagged when unparented (destroyed) or hidden. */
function describe(obj: GuiObject | undefined): string {
	if (obj === undefined) return "nil";
	const root = obj.FindFirstAncestorWhichIsA("LayerCollector");
	const where = root !== undefined ? root.Name : "(no gui)";
	const parented = obj.Parent !== undefined ? "" : " (unparented)";
	const visible = obj.Visible ? "" : " (hidden)";
	return `${where}/${obj.Name}${parented}${visible}`;
}

function enumItemByName<T extends EnumItem>(items: ReadonlyArray<T>, name: string): T | undefined {
	return items.find((item) => item.Name === name);
}

/** SelectionGroup on `frame`, its four SelectionBehavior* Stop (or Escape). */
function setGroup(frame: GuiObject, group: boolean, stop: boolean): void {
	const behavior = stop ? Enum.SelectionBehavior.Stop : Enum.SelectionBehavior.Escape;
	frame.SelectionGroup = group;
	frame.SelectionBehaviorUp = behavior;
	frame.SelectionBehaviorDown = behavior;
	frame.SelectionBehaviorLeft = behavior;
	frame.SelectionBehaviorRight = behavior;
}

/**
 * Spike GM0 (docs/GAMEPAD_MENUS.md GM0, docs/SPIKES.md "Spike GM0"): gamepad GUI navigation in Studio and on a
 * console. One ScreenGui with a column per question (1 the default selection image vs an empty SelectionImageObject
 * over a plain button and a real MenuButton; 2 a ScrollingFrame of buttons and a selectable text-only one, their
 * CanvasPosition logged; 3 buttons that destroy / hide / unselect themselves; 5 `GuiService:Select(row)` with a
 * negative SelectionOrder on the third button; 6 the pad glyphs; 7 HapticService and HapticEffect; 8 the console
 * signals and the safe-area insets), a status + log column, and a second ScreenGui at another DisplayOrder holding a
 * SelectionGroup with SelectionBehavior* Stop (4). Every selection change and every pad button press is logged (9:
 * Start / Select also on release). Every line is printed with the `[PadSpike]` prefix.
 *
 * Off unless `KV_PadSpike` (or SPIKE_DEFAULTS.pad) is true; turning it off unmounts and destroys everything it made,
 * puts the selection image back and stops the motors (one Janitor).
 */
@Controller({})
export class PadSpikeController implements OnStart {
	private session?: Janitor;
	private readonly logTail = new Array<string>();
	private logLabel?: TextLabel;

	onStart(): void {
		watchSpikeFlag("pad", (enabled) => (enabled ? this.start() : this.stop()));
	}

	private stop(): void {
		this.session?.Destroy();
		this.session = undefined;
		this.logLabel = undefined;
		this.logTail.clear();
	}

	private log(line: string): void {
		print(`${PAD_SPIKE.logPrefix} ${line}`);
		this.logTail.push(line);
		while (this.logTail.size() > PAD_SPIKE.logLines) this.logTail.remove(0);
		if (this.logLabel !== undefined) this.logLabel.Text = this.logTail.join("\n");
	}

	private start(): void {
		if (this.session !== undefined) return;
		const janitor = new Janitor();
		this.session = janitor;
		const cfg = PAD_SPIKE;
		const textColor = rgb(cfg.textColor);
		const panelColor = rgb(cfg.panelColor);
		const buttonColor = rgb(cfg.buttonColor);
		const playerGui = Players.LocalPlayer.WaitForChild("PlayerGui") as PlayerGui;
		const alive = () => this.session === janitor;
		const nextFrame = (fn: () => void) => {
			task.spawn(() => {
				RunService.Heartbeat.Wait();
				if (alive()) fn();
			});
		};
		const selected = () => describe(GuiService.SelectedObject);
		const navFlags = () =>
			`GuiNavigationEnabled ${tryRead(() => GuiService.GuiNavigationEnabled)}  ` +
			`AutoSelectGuiEnabled ${tryRead(() => GuiService.AutoSelectGuiEnabled)}`;

		// ---- Builders (plain Instances; English developer text, AutoLocalize off on both roots) ----
		const listLayout = (parent: Instance, horizontal: boolean) => {
			const layout = new Instance("UIListLayout");
			layout.FillDirection = horizontal ? Enum.FillDirection.Horizontal : Enum.FillDirection.Vertical;
			layout.SortOrder = Enum.SortOrder.LayoutOrder;
			layout.Padding = new UDim(0, cfg.gap);
			layout.Parent = parent;
		};
		const textStyle = (t: TextLabel | TextButton) => {
			t.Font = DEV_MONO_FONT;
			t.TextSize = cfg.textSize;
			t.TextColor3 = textColor;
			t.TextWrapped = true;
			t.BorderSizePixel = 0;
		};
		const label = (parent: Instance, text: string, order: number): TextLabel => {
			const l = new Instance("TextLabel");
			l.Name = `Label${order}`;
			l.LayoutOrder = order;
			l.Size = new UDim2(FULL, 0, 0, cfg.buttonHeight);
			l.AutomaticSize = Enum.AutomaticSize.Y;
			l.BackgroundTransparency = HIDDEN;
			textStyle(l);
			l.TextXAlignment = Enum.TextXAlignment.Left;
			l.Text = text;
			l.Parent = parent;
			return l;
		};
		const button = (parent: Instance, text: string, order: number, onPress: (b: TextButton) => void) => {
			const b = new Instance("TextButton");
			b.Name = text;
			b.LayoutOrder = order;
			b.Size = new UDim2(FULL, 0, 0, cfg.buttonHeight);
			b.BackgroundColor3 = buttonColor;
			b.AutoButtonColor = true;
			b.Selectable = true;
			textStyle(b);
			b.Text = text;
			b.Parent = parent;
			janitor.Add(b.Activated.Connect(() => onPress(b)));
			return b;
		};
		const panel = (parent: Instance, name: string, order: number, width: number): Frame => {
			const f = new Instance("Frame");
			f.Name = name;
			f.LayoutOrder = order;
			f.Size = new UDim2(0, width, 0, 0);
			f.AutomaticSize = Enum.AutomaticSize.Y;
			f.BackgroundColor3 = panelColor;
			f.BackgroundTransparency = cfg.backdropTransparency;
			f.BorderSizePixel = 0;
			const padding = new Instance("UIPadding");
			padding.PaddingTop = new UDim(0, cfg.gap);
			padding.PaddingBottom = new UDim(0, cfg.gap);
			padding.PaddingLeft = new UDim(0, cfg.gap);
			padding.PaddingRight = new UDim(0, cfg.gap);
			padding.Parent = f;
			listLayout(f, false);
			f.Parent = parent;
			return f;
		};
		const box = (parent: Instance, name: string, order: number): Frame => {
			const f = new Instance("Frame");
			f.Name = name;
			f.LayoutOrder = order;
			f.Size = new UDim2(FULL, 0, 0, 0);
			f.AutomaticSize = Enum.AutomaticSize.Y;
			f.BackgroundTransparency = HIDDEN;
			listLayout(f, false);
			f.Parent = parent;
			return f;
		};
		const grid = (parent: Instance, name: string, order: number, columns: number, height: number): Frame => {
			const f = new Instance("Frame");
			f.Name = name;
			f.LayoutOrder = order;
			f.Size = new UDim2(FULL, 0, 0, 0);
			f.AutomaticSize = Enum.AutomaticSize.Y;
			f.BackgroundTransparency = HIDDEN;
			const layout = new Instance("UIGridLayout");
			layout.SortOrder = Enum.SortOrder.LayoutOrder;
			layout.CellSize = new UDim2(FULL / columns, -cfg.gap, 0, height);
			layout.CellPadding = new UDim2(0, cfg.gap, 0, cfg.gap);
			layout.Parent = f;
			f.Parent = parent;
			return f;
		};
		const scroller = (parent: Instance, name: string, order: number, height: number, selectable: boolean) => {
			const s = new Instance("ScrollingFrame");
			s.Name = name;
			s.LayoutOrder = order;
			s.Size = new UDim2(FULL, 0, 0, height);
			s.CanvasSize = new UDim2();
			s.AutomaticCanvasSize = Enum.AutomaticSize.Y;
			s.ScrollingDirection = Enum.ScrollingDirection.Y;
			s.ScrollBarThickness = cfg.scrollBarPx;
			s.BackgroundTransparency = HIDDEN;
			s.BorderSizePixel = 0;
			s.Selectable = selectable;
			s.Parent = parent;
			return s;
		};

		const gui = createKvScreenGui(GUI_NAME, {
			ResetOnSpawn: false,
			DisplayOrder: cfg.displayOrder,
			ZIndexBehavior: Enum.ZIndexBehavior.Sibling,
			ScreenInsets: Enum.ScreenInsets.CoreUISafeInsets,
		});
		const root = new Instance("Frame");
		root.Name = "Root";
		root.Position = UDim2.fromOffset(cfg.margin, cfg.margin);
		root.AutomaticSize = Enum.AutomaticSize.XY;
		root.BackgroundTransparency = HIDDEN;
		listLayout(root, true);
		root.Parent = gui;
		let isolated = true;
		setGroup(root, isolated, isolated);

		// ---- Column 1: 1. selection image, 3. destroyed / hidden selection ----
		const c1 = panel(root, "Q1Q3", 1, cfg.columnWidth);
		label(c1, "1. selection image over a button", 1);
		// FocusController's empty frame is not an original (it destroys it when the spike starts): read it as none.
		const current = playerGui.SelectionImageObject;
		const originalImage = current?.Name === NO_SELECTION_IMAGE_NAME ? undefined : current;
		const emptyImage = new Instance("Frame");
		emptyImage.Name = "EmptySelectionImage";
		emptyImage.BackgroundTransparency = HIDDEN;
		emptyImage.BorderSizePixel = 0;
		emptyImage.Size = UDim2.fromScale(FULL, FULL);
		let empty = false;
		const firstButton = button(c1, "SelectionImageObject: default", 2, (b) => {
			empty = !empty;
			playerGui.SelectionImageObject = empty ? emptyImage : originalImage;
			b.Text = `SelectionImageObject: ${empty ? "empty" : "default"}`;
			this.log(`1. PlayerGui.SelectionImageObject = ${empty ? "an empty transparent Frame" : "the original"}`);
		});
		button(c1, "plain TextButton", 3, () => this.log("1. plain TextButton activated"));
		const host = new Instance("Frame");
		host.Name = "MenuButtonHost";
		host.LayoutOrder = 4;
		host.Size = new UDim2(FULL, 0, 0, cfg.buttonHeight);
		host.BackgroundTransparency = HIDDEN;
		host.Parent = c1;
		const reactRoot = createRoot(host);
		reactRoot.render(
			<ReflexProvider producer={clientStore}>
				<MenuButton
					text="real MenuButton"
					name="MenuButton"
					order={0}
					size={new Vector2(cfg.columnWidth - 2 * cfg.gap, cfg.buttonHeight)}
					onActivated={() => this.log("1. real MenuButton activated")}
				/>
			</ReflexProvider>,
		);
		button(c1, "Isolate spike: on", 5, (b) => {
			isolated = !isolated;
			setGroup(root, isolated, isolated);
			b.Text = `Isolate spike: ${isolated ? "on" : "off"}`;
			this.log(`isolate: the spike root's SelectionGroup + Stop ${isolated ? "on" : "off"}`);
		});

		label(c1, "3. press: the button destroys / hides / unselects itself", 6);
		const victims = box(c1, "Victims", 7);
		const victimAction = (what: string, act: (b: TextButton) => void) => (b: TextButton) => {
			this.log(`3. ${what}: before ${selected()}`);
			act(b);
			this.log(`3. ${what}: right after ${selected()}`);
			nextFrame(() => this.log(`3. ${what}: next frame ${selected()}`));
		};
		const buildVictims = () => {
			for (const child of victims.GetChildren()) if (child.IsA("TextButton")) child.Destroy();
			button(
				victims,
				"Destroy me",
				1,
				victimAction("destroy", (b) => b.Destroy()),
			);
			button(
				victims,
				"Hide me (Visible = false)",
				2,
				victimAction("hide", (b) => (b.Visible = false)),
			);
			button(
				victims,
				"Unselect me (Selectable = false)",
				3,
				victimAction("unselectable", (b) => (b.Selectable = false)),
			);
		};
		buildVictims();
		button(c1, "Rebuild the three above", 8, () => {
			buildVictims();
			this.log("3. rebuilt");
		});

		// ---- 4. The trap: a Stop SelectionGroup in a second ScreenGui at another DisplayOrder ----
		const trapGui = createKvScreenGui(TRAP_GUI_NAME, {
			ResetOnSpawn: false,
			DisplayOrder: cfg.trapDisplayOrder,
			ZIndexBehavior: Enum.ZIndexBehavior.Sibling,
			ScreenInsets: Enum.ScreenInsets.CoreUISafeInsets,
		});
		const trap = panel(trapGui, "Trap", 0, cfg.columnWidth);
		trap.AnchorPoint = new Vector2(FULL, FULL);
		trap.Position = new UDim2(FULL, -cfg.margin, FULL, -cfg.margin);
		let trapStop = true;
		setGroup(trap, true, trapStop);
		let leavingTrap = false;
		label(trap, `4. trap: SelectionGroup, DisplayOrder ${cfg.trapDisplayOrder} (spike ${cfg.displayOrder})`, 1);
		const trapFirst = button(trap, "trap 1", 2, () => this.log("4. trap 1 activated"));
		button(trap, "trap 2", 3, () => this.log("4. trap 2 activated"));
		button(trap, "Behavior: Stop", 4, (b) => {
			trapStop = !trapStop;
			setGroup(trap, true, trapStop);
			b.Text = `Behavior: ${trapStop ? "Stop" : "Escape"}`;
			this.log(`4. trap SelectionBehavior* = ${trapStop ? "Stop" : "Escape"}`);
		});
		button(trap, "Leave (select the spike)", 5, () => {
			leavingTrap = true;
			GuiService.SelectedObject = firstButton;
		});
		const selectFirst = () => {
			GuiService.SelectedObject = firstButton;
			this.log(`selection put on the spike's first button: ${selected()}`);
		};

		// ---- Column 2: 2. scrolling, 5. Select(root), 4. trap entry ----
		const c2 = panel(root, "Q2Q5", 2, cfg.columnWidth);
		label(c2, `2a. ${cfg.listButtons} buttons in a ScrollingFrame`, 1);
		const buttonList = scroller(c2, "ButtonList", 2, cfg.listHeight, false);
		listLayout(buttonList, false);
		for (let i = 1; i <= cfg.listButtons; i++)
			button(buttonList, `row ${i}`, i, () => this.log(`2a. row ${i} activated`));
		label(c2, "2b. text only, Selectable ScrollingFrame", 3);
		const textList = scroller(c2, "TextList", 4, cfg.textListHeight, true);
		const lines = new Array<string>();
		for (let i = 1; i <= cfg.textLines; i++) lines.push(`text line ${i}`);
		const body = new Instance("TextLabel");
		body.Name = "Body";
		body.Size = new UDim2(FULL, -cfg.scrollBarPx, 0, 0);
		body.AutomaticSize = Enum.AutomaticSize.Y;
		body.BackgroundTransparency = HIDDEN;
		textStyle(body);
		body.TextXAlignment = Enum.TextXAlignment.Left;
		body.TextYAlignment = Enum.TextYAlignment.Top;
		body.Text = lines.join("\n");
		body.Parent = textList;
		janitor.Add(textList.SelectionGained.Connect(() => this.log("2b. text list SelectionGained")));
		janitor.Add(textList.SelectionLost.Connect(() => this.log("2b. text list SelectionLost")));
		const watchCanvas = (frame: ScrollingFrame, tag: string) => {
			let changedAt: number | undefined;
			janitor.Add(frame.GetPropertyChangedSignal("CanvasPosition").Connect(() => (changedAt = os.clock())));
			janitor.Add(
				RunService.Heartbeat.Connect(() => {
					if (changedAt === undefined || os.clock() - changedAt < cfg.canvasSettleSec) return;
					changedAt = undefined;
					this.log(`${tag} CanvasPosition ${pair(frame.CanvasPosition)} (selected ${selected()})`);
				}),
			);
		};
		watchCanvas(buttonList, "2a.");
		watchCanvas(textList, "2b.");

		label(c2, `5. Select(row): C has SelectionOrder ${cfg.selectRootOrder}`, 5);
		const row = grid(c2, "SelectRow", 6, 3, cfg.buttonHeight);
		button(row, "A", 1, () => this.log("5. A activated"));
		button(row, "B", 2, () => this.log("5. B activated"));
		const third = button(row, "C", 3, () => this.log("5. C activated"));
		third.SelectionOrder = cfg.selectRootOrder;
		button(c2, `C order: ${cfg.selectRootOrder}`, 7, (b) => {
			third.SelectionOrder = third.SelectionOrder === DEFAULT_ORDER ? cfg.selectRootOrder : DEFAULT_ORDER;
			b.Text = `C order: ${third.SelectionOrder}`;
			this.log(`5. C SelectionOrder = ${third.SelectionOrder}`);
		});
		button(c2, "GuiService:Select(row)", 8, () => {
			const [ok, err] = pcall(() => GuiService.Select(row));
			this.log(`5. Select(row) ${ok ? "ok" : `error ${err}`}: right after ${selected()}`);
			nextFrame(() => this.log(`5. Select(row): next frame ${selected()}`));
		});
		label(c2, "4. the trap (bottom right)", 9);
		button(c2, "Enter the trap", 10, () => {
			GuiService.SelectedObject = trapFirst;
			this.log(`4. entered the trap: ${selected()}`);
		});

		// ---- Column 3: 6. glyphs, 7. haptics, 8. console signals ----
		const c3 = panel(root, "Q6Q7Q8", 3, cfg.columnWidth);
		label(c3, "6. GetImageForKeyCode / GetStringForKeyCode", 1);
		const glyphGrid = grid(c3, "Glyphs", 2, cfg.glyphColumns, cfg.glyphSize);
		const glyphCells = new Array<{ key: Enum.KeyCode; image: ImageLabel; text: TextLabel }>();
		const keyCodes = Enum.KeyCode.GetEnumItems();
		cfg.glyphKeys.forEach((name, i) => {
			const key = enumItemByName(keyCodes, name);
			if (key === undefined) {
				this.log(`6. no Enum.KeyCode.${name}`);
				return;
			}
			const cell = new Instance("Frame");
			cell.Name = name;
			cell.LayoutOrder = i;
			cell.BackgroundTransparency = HIDDEN;
			cell.Parent = glyphGrid;
			const image = new Instance("ImageLabel");
			image.Name = "Glyph";
			image.Size = UDim2.fromOffset(cfg.glyphSize, cfg.glyphSize);
			image.BackgroundTransparency = HIDDEN;
			image.ScaleType = Enum.ScaleType.Fit;
			image.Parent = cell;
			const text = new Instance("TextLabel");
			text.Name = "Name";
			text.Position = UDim2.fromOffset(cfg.glyphSize + cfg.gap, 0);
			text.Size = new UDim2(FULL, -(cfg.glyphSize + cfg.gap), FULL, 0);
			text.BackgroundTransparency = HIDDEN;
			textStyle(text);
			text.TextXAlignment = Enum.TextXAlignment.Left;
			text.Parent = cell;
			glyphCells.push({ key, image, text });
		});
		const readGlyphs = () => {
			const pads = UserInputService.GetConnectedGamepads().map((p) => p.Name);
			this.log(
				`6. PreferredInput ${tryRead(() => UserInputService.PreferredInput)}  ` +
					`gamepads [${pads.join(", ")}]  LastInputType ${UserInputService.GetLastInputType().Name}`,
			);
			for (const cell of glyphCells) {
				const [okImage, image] = pcall(() => UserInputService.GetImageForKeyCode(cell.key));
				const text = tryRead(() => UserInputService.GetStringForKeyCode(cell.key));
				const short = tryRead(() =>
					UserInputService.GetStringForKeyCode(cell.key, Enum.KeyCodeStringFormat.Abbreviated),
				);
				cell.image.Image = okImage ? image : "";
				cell.text.Text = `${cell.key.Name}: ${text}`;
				this.log(
					`6. ${cell.key.Name}: image "${
						okImage ? image : `error ${image}`
					}" string "${text}" abbreviated "${short}"`,
				);
			}
		};
		button(c3, "Re-read glyphs", 3, readGlyphs);

		label(c3, "7. haptics (the navigation pad)", 4);
		const navPad = (): Enum.UserInputType => {
			const pads = UserInputService.GetNavigationGamepads();
			if (pads.size() > 0) return pads[0];
			const connected = UserInputService.GetConnectedGamepads();
			return connected.size() > 0 ? connected[0] : Enum.UserInputType.Gamepad1;
		};
		const motors = Enum.VibrationMotor.GetEnumItems();
		const logSupport = () => {
			const pad = navPad();
			const parts = motors.map((m) => `${m.Name} ${tryRead(() => HapticService.IsMotorSupported(pad, m))}`);
			this.log(
				`7. ${pad.Name} IsVibrationSupported ${tryRead(() => HapticService.IsVibrationSupported(pad))}; ` +
					`IsMotorSupported: ${parts.join(", ")}`,
			);
		};
		const buzz = (motor: Enum.VibrationMotor, strength: number) => {
			const pad = navPad();
			const [ok, err] = pcall(() => HapticService.SetMotor(pad, motor, strength));
			this.log(
				`7. SetMotor(${pad.Name}, ${motor.Name}, ${strength}) for ${cfg.motorSec} s: ${
					ok ? "ok" : `error ${err}`
				}`,
			);
			task.delay(cfg.motorSec, () => {
				pcall(() => HapticService.SetMotor(pad, motor, 0));
			});
		};
		const motorGrid = grid(c3, "Motors", 5, 2, cfg.buttonHeight);
		button(motorGrid, "Log support", 0, logSupport);
		let motorOrder = 1;
		for (const motorName of cfg.motors) {
			const motor = enumItemByName(motors, motorName);
			if (motor === undefined) continue;
			for (const strength of cfg.motorStrengths) {
				button(motorGrid, `${motorName} ${strength}`, motorOrder, () => buzz(motor, strength));
				motorOrder += 1;
			}
		}
		const effectGrid = grid(c3, "Effects", 6, 2, cfg.buttonHeight);
		cfg.hapticTypes.forEach((typeName, i) => {
			button(effectGrid, typeName, i, () => {
				const [ok, err] = pcall(() => {
					const kind = enumItemByName(Enum.HapticEffectType.GetEnumItems(), typeName);
					if (kind === undefined) error(`no Enum.HapticEffectType.${typeName}`, 0);
					const effect = new Instance("HapticEffect");
					effect.Type = kind;
					effect.Parent = gui;
					effect.Play();
					task.delay(cfg.effectLifeSec, () => effect.Destroy());
				});
				this.log(`7. HapticEffect ${typeName} Play(): ${ok ? "ok" : `error ${err}`}`);
			});
		});
		const pressButton = button(c3, "PressHapticEffect = UIClick", 7, () =>
			this.log("7. PressHapticEffect button activated"),
		);
		const [okPress, errPress] = pcall(() => {
			const effect = new Instance("HapticEffect");
			effect.Type = Enum.HapticEffectType.UIClick;
			effect.Parent = pressButton;
			pressButton.PressHapticEffect = effect;
		});

		label(c3, "8. console signals", 8);
		const logConsole = () => {
			const [inset, insetBottom] = GuiService.GetGuiInset();
			const viewport = Workspace.CurrentCamera?.ViewportSize;
			this.log(
				`8. IsTenFootInterface ${tryRead(() => GuiService.IsTenFootInterface())}  ` +
					`ViewportDisplaySize ${tryRead(() => GuiService.ViewportDisplaySize)}  ` +
					`GetGuiInset ${pair(inset)} / ${pair(insetBottom)}  ` +
					`viewport ${viewport !== undefined ? pair(viewport) : "nil"}`,
			);
			// One probe ScreenGui per ScreenInsets mode: where does a full-size frame land (the safe area)?
			for (const mode of Enum.ScreenInsets.GetEnumItems()) {
				const probeGui = createKvScreenGui(PROBE_GUI_NAME, { ScreenInsets: mode });
				const frame = new Instance("Frame");
				frame.Size = UDim2.fromScale(FULL, FULL);
				frame.BackgroundTransparency = HIDDEN;
				frame.Parent = probeGui;
				probeGui.Parent = playerGui;
				janitor.Add(probeGui);
				nextFrame(() => {
					this.log(
						`8. ScreenInsets ${mode.Name}: pos ${pair(frame.AbsolutePosition)} size ${pair(
							frame.AbsoluteSize,
						)}`,
					);
					probeGui.Destroy();
				});
			}
		};
		button(c3, "Log console signals", 9, logConsole);

		// ---- Column 4: status and the log tail ----
		const c4 = panel(root, "Log", 4, cfg.logWidth);
		const status = label(c4, "", 1);
		const logLabel = label(c4, "", 2);
		logLabel.TextYAlignment = Enum.TextYAlignment.Top;
		this.logLabel = logLabel;
		let statusAt = 0;
		janitor.Add(
			RunService.Heartbeat.Connect(() => {
				const now = os.clock();
				if (now - statusAt < cfg.statusRefreshSec) return;
				statusAt = now;
				status.Text =
					`selected: ${selected()}\n` +
					`PreferredInput ${tryRead(() => UserInputService.PreferredInput)}  ` +
					`LastInputType ${UserInputService.GetLastInputType().Name}\n` +
					`${navFlags()}\n` +
					`GamepadEnabled ${yn(UserInputService.GamepadEnabled)}  ` +
					`${cfg.reselectKey}: select the spike`;
			}),
		);

		// ---- Selection changes (4: does the D-pad escape the trap?) ----
		let previous = GuiService.SelectedObject;
		janitor.Add(
			GuiService.GetPropertyChangedSignal("SelectedObject").Connect(() => {
				const now = GuiService.SelectedObject;
				const wasInTrap = previous !== undefined && previous.IsDescendantOf(trap);
				const inTrap = now !== undefined && now.IsDescendantOf(trap);
				let note = "";
				if (wasInTrap && !inTrap) {
					if (leavingTrap) note = "  (4. left by the Leave button)";
					else if (now === undefined) note = "  (4. trap: selection cleared)";
					else note = "  (4. trap ESCAPED)";
				}
				leavingTrap = false;
				this.log(`selected ${describe(previous)} -> ${describe(now)}${note}`);
				previous = now;
			}),
		);

		// ---- 9. Pad presses (Start / Select also on release), and the reselect key ----
		const watched = new Set<string>(cfg.watchKeys);
		const isPad = (input: InputObject) => startsWith(input.UserInputType.Name, GAMEPAD_PREFIX);
		janitor.Add(
			UserInputService.InputBegan.Connect((input, processed) => {
				const name = input.KeyCode.Name;
				if (input.UserInputType === Enum.UserInputType.Keyboard && name === cfg.reselectKey) {
					selectFirst();
					return;
				}
				if (!isPad(input)) return;
				if (watched.has(name)) {
					this.log(
						`9. ${name} InputBegan (${input.UserInputType.Name}) gameProcessed ${yn(
							processed,
						)}; selected ${selected()}`,
					);
					nextFrame(() => this.log(`9. ${name} next frame: selected ${selected()}; ${navFlags()}`));
				} else if (startsWith(name, BUTTON_PREFIX)) {
					this.log(`pad ${name} began, gameProcessed ${yn(processed)}`);
				}
			}),
		);
		janitor.Add(
			UserInputService.InputEnded.Connect((input, processed) => {
				if (!isPad(input) || !watched.has(input.KeyCode.Name)) return;
				this.log(`9. ${input.KeyCode.Name} InputEnded gameProcessed ${yn(processed)}; selected ${selected()}`);
			}),
		);
		janitor.Add(
			UserInputService.GamepadConnected.Connect((pad) => {
				this.log(`gamepad connected: ${pad.Name}`);
				readGlyphs();
			}),
		);
		janitor.Add(
			UserInputService.GamepadDisconnected.Connect((pad) => this.log(`gamepad disconnected: ${pad.Name}`)),
		);
		const [okPreferred, preferredSignal] = pcall(() => UserInputService.GetPropertyChangedSignal("PreferredInput"));
		if (okPreferred) {
			janitor.Add(
				preferredSignal.Connect(() =>
					this.log(`PreferredInput -> ${tryRead(() => UserInputService.PreferredInput)}`),
				),
			);
		}

		// One task, so the order is fixed: unmount the React tree, restore what the spike changed, destroy its guis.
		janitor.Add(() => {
			reactRoot.unmount();
			if (playerGui.SelectionImageObject === emptyImage) playerGui.SelectionImageObject = originalImage;
			const sel = GuiService.SelectedObject;
			if (sel !== undefined && (sel.IsDescendantOf(gui) || sel.IsDescendantOf(trapGui))) {
				GuiService.SelectedObject = undefined;
			}
			for (const pad of UserInputService.GetConnectedGamepads()) {
				for (const m of motors) pcall(() => HapticService.SetMotor(pad, m, 0));
			}
			gui.Destroy();
			trapGui.Destroy();
			emptyImage.Destroy();
		}, true);

		gui.Parent = playerGui;
		trapGui.Parent = playerGui;
		this.log(`on: ${GUI_NAME} + ${TRAP_GUI_NAME} (docs/SPIKES.md "Spike GM0")`);
		this.log(`7. PressHapticEffect setup: ${okPress ? "ok" : `error ${errPress}`}`);
		this.log(`navigation: ${navFlags()}`);
		readGlyphs();
		logSupport();
		logConsole();
		if (UserInputService.GamepadEnabled) selectFirst();
	}
}

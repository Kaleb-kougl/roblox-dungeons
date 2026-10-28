import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { GuiService, Players, RunService, Stats, UserInputService } from "@rbxts/services";
import { MONO_FONT } from "client/ui";
import { TOUCH_SPIKE } from "shared/config";
import { watchSpikeFlag } from "./spikeFlags";

const GUI_NAME = "KV_TouchSpike";
const NUMBER_FORMAT = "%.1f";
const PAIR_FORMAT = "%.1f, %.1f";
const CENTRE = 0.5;

/** One active finger: its number (assigned the first time TouchStarted sees its InputObject) and that TouchStarted's flag. */
interface Finger {
	n: number;
	processed: boolean;
}

function fmt(n: number): string {
	return string.format(NUMBER_FORMAT, n);
}

function pair(x: number, y: number): string {
	return string.format(PAIR_FORMAT, x, y);
}

function yn(value: boolean): string {
	return value ? "yes" : "no";
}

/**
 * Touch spike MB1 (docs/MOBILE_IMPL.md MB1, docs/SPIKES.md "Spike MB0"): a debug overlay for the device test. It reads
 * the input flags, fps and memory, numbers every active finger, and runs a probe square that checks whether a touch
 * reaches a GuiObject as the same InputObject that TouchStarted gave, and what the offset between touch and GUI space is.
 *
 * Off unless `KV_TouchSpike` (or SPIKE_DEFAULTS.touch) is true; turning it off destroys everything it made (one Janitor).
 */
@Controller({})
export class TouchSpikeController implements OnStart {
	private session?: Janitor;

	onStart(): void {
		watchSpikeFlag("touch", (enabled) => (enabled ? this.start() : this.stop()));
	}

	private stop(): void {
		this.session?.Destroy();
		this.session = undefined;
	}

	private start(): void {
		if (this.session) {
			return;
		}
		const janitor = new Janitor();
		this.session = janitor;

		const playerGui = Players.LocalPlayer.WaitForChild("PlayerGui") as PlayerGui;
		const gui = new Instance("ScreenGui");
		gui.Name = GUI_NAME;
		gui.ResetOnSpawn = false;
		gui.ScreenInsets = Enum.ScreenInsets.CoreUISafeInsets;
		gui.DisplayOrder = TOUCH_SPIKE.displayOrder;
		gui.Parent = playerGui;
		janitor.Add(gui);

		const info = new Instance("TextLabel");
		info.Name = "Info";
		info.AnchorPoint = new Vector2(CENTRE, 0);
		info.Position = UDim2.fromScale(CENTRE, 0);
		info.Size = UDim2.fromScale(1, 0);
		info.AutomaticSize = Enum.AutomaticSize.Y;
		info.BackgroundTransparency = TOUCH_SPIKE.backgroundTransparency;
		info.TextColor3 = Color3.fromRGB(255, 255, 255);
		info.TextSize = TOUCH_SPIKE.textSize;
		info.Font = MONO_FONT;
		info.TextXAlignment = Enum.TextXAlignment.Center;
		info.TextYAlignment = Enum.TextYAlignment.Top;
		info.TextWrapped = false;
		info.Text = "";
		info.Parent = gui;

		const probe = new Instance("TextButton");
		probe.Name = "Probe";
		probe.AnchorPoint = new Vector2(0, 1);
		probe.Position = UDim2.fromScale(0, 1);
		probe.Size = UDim2.fromOffset(TOUCH_SPIKE.probeSize, TOUCH_SPIKE.probeSize);
		probe.BackgroundTransparency = TOUCH_SPIKE.backgroundTransparency;
		probe.AutoButtonColor = false;
		probe.Text = "";
		probe.Parent = gui;

		// Every touch InputObject TouchStarted has seen and not yet ended, by identity (a Map keyed by the object).
		const fingers = new Map<InputObject, Finger>();
		let nextFinger = 0;
		janitor.Add(
			UserInputService.TouchStarted.Connect((input, processed) => {
				if (fingers.has(input)) {
					return;
				}
				nextFinger += 1;
				fingers.set(input, { n: nextFinger, processed });
			}),
		);
		janitor.Add(
			UserInputService.TouchEnded.Connect((input) => {
				fingers.delete(input);
			}),
		);

		// Probe: is the touch the same InputObject TouchStarted gave for that finger, and where is it in GUI space?
		let probeLine = "probe same object: (tap the square)\nprobe offset: (tap the square)";
		janitor.Add(
			probe.InputBegan.Connect((input) => {
				if (input.UserInputType !== Enum.UserInputType.Touch) {
					return;
				}
				const same = fingers.has(input);
				const offsetX = input.Position.X - probe.AbsolutePosition.X;
				const offsetY = input.Position.Y - probe.AbsolutePosition.Y;
				probeLine = `probe same object: ${yn(same)}\nprobe offset: ${pair(offsetX, offsetY)}`;
			}),
		);

		let frames = 0;
		let windowStart = os.clock();
		let fps = 0;

		/** The whole overlay text, rebuilt once per refresh window. */
		const build = (): string => {
			const lines = new Array<string>();
			lines.push(
				`Touch ${yn(UserInputService.TouchEnabled)}  Mouse ${yn(UserInputService.MouseEnabled)}  ` +
					`Keyboard ${yn(UserInputService.KeyboardEnabled)}  Gamepad ${yn(UserInputService.GamepadEnabled)}`,
			);
			lines.push(
				`GuiService.TouchControlsEnabled ${yn(GuiService.TouchControlsEnabled)}  ` +
					`Orientation ${playerGui.CurrentScreenOrientation.Name}`,
			);
			lines.push(
				`fps ${fmt(fps)}  mem ${fmt(Stats.GetTotalMemoryUsageMb())} MB  ` +
					`texture ${fmt(Stats.GetMemoryUsageMbForTag(Enum.DeveloperMemoryTag.GraphicsTexture))} MB`,
			);
			const mouse = UserInputService.GetMouseLocation();
			lines.push(
				`Mouse1 down ${yn(UserInputService.IsMouseButtonPressed(Enum.UserInputType.MouseButton1))}  ` +
					`mouse ${pair(mouse.X, mouse.Y)}`,
			);
			const [inset] = GuiService.GetGuiInset();
			lines.push(
				`ScreenGui pos ${pair(gui.AbsolutePosition.X, gui.AbsolutePosition.Y)}  ` +
					`size ${pair(gui.AbsoluteSize.X, gui.AbsoluteSize.Y)}  GetGuiInset ${pair(inset.X, inset.Y)}`,
			);

			// Fingers, in number order (Map iteration is not insertion order).
			const active = new Array<{ n: number; input: InputObject; processed: boolean }>();
			fingers.forEach((finger, input) => {
				active.push({ n: finger.n, input, processed: finger.processed });
			});
			active.sort((a, b) => a.n < b.n);
			let shown = 0;
			for (const f of active) {
				if (shown >= TOUCH_SPIKE.maxFingerLines) {
					break;
				}
				lines.push(
					`finger ${f.n}  pos ${pair(f.input.Position.X, f.input.Position.Y)}  gameProcessed ${yn(
						f.processed,
					)}`,
				);
				shown += 1;
			}
			if (active.size() > shown) {
				lines.push(`... ${active.size() - shown} more finger(s)`);
			}
			lines.push(probeLine);
			return lines.join("\n");
		};

		janitor.Add(
			RunService.RenderStepped.Connect(() => {
				frames += 1;
				const now = os.clock();
				const elapsed = now - windowStart;
				if (elapsed < TOUCH_SPIKE.refreshSec) {
					return;
				}
				fps = frames / elapsed;
				frames = 0;
				windowStart = now;
				info.Text = build();
			}),
		);
	}
}

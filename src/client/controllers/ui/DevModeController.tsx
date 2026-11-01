import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import React from "@rbxts/react";
import { createRoot, type Root } from "@rbxts/react-roblox";
import { Players, RunService, UserInputService, Workspace } from "@rbxts/services";
import { DevPanel, type DevPanelProps, createKvScreenGui } from "client/ui";
import { DEV_MODE, DEV_PANEL_VIEW } from "shared/config";
import { isBossFloor } from "shared/dungeon";
import { RUN_ATTRIBUTES } from "shared/play";
import { clampDevFloor, isValidRunSeed } from "shared/run";
import { SimController } from "../game/SimController";

const GUI_NAME = "KV_DevMode";

/** What the panel last rendered from the run (a re-render only when one of these changed). */
interface Shown {
	open: boolean;
	floor: number;
	seed: number;
	god: boolean;
	godPending: boolean;
	runFloor: number | undefined;
}

/**
 * Developer mode's client (docs/DEV_MODE.md): mounts the DEV chip and panel only once the server has set
 * DEV_MODE.allowedAttribute on the local player (DevModeService: Studio, an allowlisted UserId or the place's
 * creator), and only then listens to its keys: DEV_MODE.panelKey (F2) opens / closes the panel, DEV_PANEL_VIEW.godKey
 * (F3) flips god mode. Go starts a dev run (SimController.startDev: the chosen floor of the endless run on the panel's
 * seed, local, never submitted); in a dev run R / Restart restart it at once (SimController.handleReset) and the god
 * toggle goes through the sim (DEV_GOD_BUTTON). Nothing exists for other players: no GUI, no input connection.
 * Seed: KV_Seed when set, else a random one (New draws another). The run is not paused while the panel is open.
 */
@Controller({})
export class DevModeController implements OnStart {
	private readonly janitor = new Janitor();
	private root: Root | undefined;
	private open = false;
	private floor: number = clampDevFloor(DEV_MODE.defaultFloor);
	private seed = 0;
	private god: boolean = DEV_MODE.defaultInvulnerable;
	private readonly random = new Random();
	private shown: Shown | undefined;
	private pollTimer = 0;

	constructor(private readonly sim: SimController) {}

	onStart(): void {
		if (!DEV_MODE.enabled) return;
		const player = Players.LocalPlayer;
		const check = () => {
			if (player.GetAttribute(DEV_MODE.allowedAttribute) === true) this.mount();
		};
		player.GetAttributeChangedSignal(DEV_MODE.allowedAttribute).Connect(check);
		check();
	}

	private mount(): void {
		if (this.root !== undefined) return;
		this.seed = this.initialSeed();
		this.open = Workspace.GetAttribute(DEV_MODE.openOnJoinAttribute) === true;
		const gui = createKvScreenGui(GUI_NAME);
		gui.ResetOnSpawn = false;
		gui.DisplayOrder = DEV_MODE.displayOrder;
		gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling;
		gui.Parent = Players.LocalPlayer.WaitForChild("PlayerGui");
		this.janitor.Add(gui);
		const root = createRoot(gui);
		this.root = root;
		this.janitor.Add(() => root.unmount());
		this.janitor.Add(
			UserInputService.InputBegan.Connect((input, processed) => {
				if (processed || UserInputService.GetFocusedTextBox() !== undefined) return;
				const key = input.KeyCode.Name;
				if (key === DEV_MODE.panelKey) this.toggleOpen();
				else if (key === DEV_PANEL_VIEW.godKey) this.toggleGod();
			}),
		);
		this.janitor.Add(
			RunService.Heartbeat.Connect((dt) => {
				this.pollTimer += dt;
				if (this.pollTimer < DEV_PANEL_VIEW.pollSeconds) return;
				this.pollTimer = 0;
				this.render();
			}),
		);
		print(`[DevMode] allowed: ${DEV_MODE.panelKey} opens the dev panel`);
		this.render(true);
	}

	/** KV_Seed when it holds a valid run seed, else a random one. */
	private initialSeed(): number {
		const raw = Workspace.GetAttribute(RUN_ATTRIBUTES.seed);
		return isValidRunSeed(raw) ? raw : this.randomSeed();
	}

	private randomSeed(): number {
		return this.random.NextInteger(0, DEV_PANEL_VIEW.maxRandomSeed);
	}

	private toggleOpen(): void {
		this.open = !this.open;
		this.render();
	}

	/** In a dev run: through the sim (recorded); otherwise the option the next Go uses. */
	private toggleGod(): void {
		if (this.sim.isDevRun()) this.sim.toggleGodMode();
		else this.god = !this.god;
		this.render();
	}

	private go(): void {
		const god = this.currentGod();
		this.god = god;
		this.sim.startDev({ startFloor: this.floor, invulnerable: god }, this.seed);
		this.render();
	}

	/** God mode as the panel shows it: the dev run's (with a pending toggle applied), else the option. */
	private currentGod(): boolean {
		const running = this.sim.getGodMode();
		if (running === undefined) return this.god;
		return running !== this.sim.isGodTogglePending();
	}

	private setFloor(floor: number): void {
		this.floor = clampDevFloor(floor);
		this.render(true);
	}

	private setSeedText(text: string): void {
		const n = tonumber(text);
		if (n !== undefined && isValidRunSeed(n)) this.seed = n;
		this.render(true); // an invalid entry snaps back to the current seed
	}

	/** Re-renders when what the panel shows changed (or `force`: a text box must snap back). */
	private render(force = false): void {
		const root = this.root;
		if (root === undefined) return;
		const ctx = this.sim.getContext();
		const runFloor = ctx?.dev === true ? ctx.floor : undefined;
		const running = this.sim.getGodMode();
		const view: Shown = {
			open: this.open,
			floor: this.floor,
			seed: this.seed,
			god: running ?? this.god,
			godPending: this.sim.isGodTogglePending(),
			runFloor,
		};
		const last = this.shown;
		if (
			!force &&
			last !== undefined &&
			last.open === view.open &&
			last.floor === view.floor &&
			last.seed === view.seed &&
			last.god === view.god &&
			last.godPending === view.godPending &&
			last.runFloor === view.runFloor
		) {
			return;
		}
		this.shown = view;
		const props: DevPanelProps = {
			...view,
			floorIsBoss: isBossFloor(view.floor),
			onToggleOpen: () => this.toggleOpen(),
			onFloorDelta: (delta) => this.setFloor(this.floor + delta),
			onFloorText: (text) => this.setFloor(tonumber(text) ?? this.floor),
			onSeedText: (text) => this.setSeedText(text),
			onReroll: () => {
				this.seed = this.randomSeed();
				this.render();
			},
			onToggleGod: () => this.toggleGod(),
			onGo: () => this.go(),
			onRestart: () => this.sim.requestRestart(),
		};
		root.render(<DevPanel {...props} />);
	}
}

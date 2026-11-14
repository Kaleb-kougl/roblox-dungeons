import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import React from "@rbxts/react";
import { createRoot, type Root } from "@rbxts/react-roblox";
import { Players, RunService, UserInputService, Workspace } from "@rbxts/services";
import { DevPanel, type DevPanelProps, createKvScreenGui } from "client/ui";
import { DEV_MODE, DEV_PANEL_VIEW } from "shared/config";
import { isBossFloor } from "shared/dungeon";
import { RUN_ATTRIBUTES } from "shared/play";
import {
	FLOOR_MODIFIER_ATTRIBUTE,
	SECRET_DEBUG_ATTRIBUTE,
	TREASURE_DEBUG_ATTRIBUTE,
	clampDevFloor,
	isValidRunSeed,
	parseFloorModifierOverride,
	parseSecretDebug,
	parseTreasureDebug,
} from "shared/run";
import { SimController } from "../game/SimController";
import { MenuController } from "./MenuController";

const GUI_NAME = "KV_DevMode";

/** What the panel last rendered from the run (a re-render only when one of these changed). */
interface Shown {
	open: boolean;
	floor: number;
	seed: number;
	god: boolean;
	godPending: boolean;
	bothWeapons: boolean;
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
 * Characters (docs/ARCHER.md AR7): Go opens the character screen first (MenuController.devStart; its Confirm starts
 * the dev run as the pick), and "Both weapons" (AR4, `DevRunOptions.bothWeapons`) arms the sword and the bow with the
 * pick's roll; R / Restart keep both.
 * Treasure rooms (docs/TREASURE.md TR5): Go reads the Workspace string KV_TreasureDebug ("every,legendary,untouched",
 * shared/run parseTreasureDebug) into the dev run's vault override; R / Restart keep it. Floor modifiers
 * (docs/FLOOR_MODIFIERS.md FM4): Go reads the Workspace attribute KV_FloorModifier (a kind's key in any case, "blood
 * moon", or a FloorModifier id; shared/run parseFloorModifierOverride) into the dev run's modifier override (that kind
 * on every floor where it is eligible); R / Restart keep it. Secret rooms (docs/SECRET_ROOMS.md SR5): Go reads the
 * Workspace string KV_SecretDebug ("every", "every legendary", "rare"; shared/run parseSecretDebug) into the dev run's
 * secret override; R / Restart keep it. Dev runs are never counted.
 */
@Controller({})
export class DevModeController implements OnStart {
	private readonly janitor = new Janitor();
	private root: Root | undefined;
	private open = false;
	private floor: number = clampDevFloor(DEV_MODE.defaultFloor);
	private seed = 0;
	private god: boolean = DEV_MODE.defaultInvulnerable;
	/** The next Go's "Both weapons" (docs/ARCHER.md AR4: DEFAULT_LOADOUT with the picked character's roll). */
	private bothWeapons = false;
	private readonly random = new Random();
	private shown: Shown | undefined;
	private pollTimer = 0;

	constructor(private readonly sim: SimController, private readonly menu: MenuController) {}

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
		const raw = Workspace.GetAttribute(TREASURE_DEBUG_ATTRIBUTE);
		const vault = parseTreasureDebug(typeIs(raw, "string") ? raw : undefined);
		// docs/FLOOR_MODIFIERS.md FM4 / FM5: KV_FloorModifier ("gilded", "blood moon", a FloorModifier id) forces
		// that kind
		const modifier = parseFloorModifierOverride(Workspace.GetAttribute(FLOOR_MODIFIER_ATTRIBUTE));
		// docs/SECRET_ROOMS.md SR5 / Design 12: KV_SecretDebug ("every", "every legendary", "rare") forces / fixes the
		// floors' secret rooms
		const rawSecret = Workspace.GetAttribute(SECRET_DEBUG_ATTRIBUTE);
		const secret = parseSecretDebug(typeIs(rawSecret, "string") ? rawSecret : undefined);
		const options = {
			startFloor: this.floor,
			invulnerable: god,
			vault,
			modifier,
			secret,
			bothWeapons: this.bothWeapons,
		};
		const seed = this.seed;
		// docs/ARCHER.md AR7: the character screen first; its Confirm starts the run as the pick.
		this.menu.devStart((character) => this.sim.startDev(options, seed, character));
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
			bothWeapons: this.bothWeapons,
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
			last.bothWeapons === view.bothWeapons &&
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
			onToggleBothWeapons: () => {
				this.bothWeapons = !this.bothWeapons;
				this.render();
			},
			onGo: () => this.go(),
			onRestart: () => this.sim.requestRestart(),
		};
		root.render(<DevPanel {...props} />);
	}
}

import { Controller, OnStart } from "@flamework/core";
import React from "@rbxts/react";
import { ReflexProvider } from "@rbxts/react-reflex";
import { createRoot } from "@rbxts/react-roblox";
import { Players } from "@rbxts/services";
import { clientStore } from "client/store";
import { SpikeHud } from "client/ui";

const GUI_NAME = "KV_SpikeHud";
const DISPLAY_ORDER = 100;

/**
 * Mounts the spike HUD (React + Reflex) into its own ScreenGui. Always mounted; it renders
 * nothing while no spike is active, so it costs nothing in a normal session.
 */
@Controller({})
export class SpikeHudController implements OnStart {
	onStart(): void {
		const playerGui = Players.LocalPlayer.WaitForChild("PlayerGui");
		const screenGui = new Instance("ScreenGui");
		screenGui.Name = GUI_NAME;
		screenGui.ResetOnSpawn = false;
		screenGui.DisplayOrder = DISPLAY_ORDER;
		screenGui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling;
		screenGui.Parent = playerGui;

		const root = createRoot(screenGui);
		root.render(
			<ReflexProvider producer={clientStore}>
				<SpikeHud />
			</ReflexProvider>,
		);
	}
}

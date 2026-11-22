import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import React from "@rbxts/react";
import { ReflexProvider } from "@rbxts/react-reflex";
import { createRoot } from "@rbxts/react-roblox";
import { Players } from "@rbxts/services";
import { logInfo } from "client/log";
import { clientStore } from "client/store";
import { UiArtSpike, useHudScale, createKvScreenGui } from "client/ui";
import { UI_ART_SPIKE } from "shared/config";
import { watchSpikeFlag } from "./spikeFlags";

const GUI_NAME = "KV_UiArtSpike";

/** The spike's content under the HUD's UIScale (the same scale the menus and the HUD draw at). */
function ScaledSpike() {
	const scale = useHudScale();
	return (
		<>
			<uiscale key="Scale" Scale={scale} />
			<UiArtSpike key="Spike" />
		</>
	);
}

/**
 * Spike UA1 (docs/UI_ART.md UA1, docs/SPIKES.md "Spike UA1"): the UI art primitives (snapped SlicedImage, ArtImage,
 * FocusCorners) on screen in their own ScreenGui at the HUD's UIScale, to answer the four UA1 questions in Studio at
 * several window sizes and HUD scales.
 *
 * Off unless `KV_UiArtSpike` (or SPIKE_DEFAULTS.uiArt) is true; turning it off unmounts and destroys everything it made
 * (one Janitor).
 */
@Controller({})
export class UiArtSpikeController implements OnStart {
	private session?: Janitor;

	onStart(): void {
		watchSpikeFlag("uiArt", (enabled) => (enabled ? this.start() : this.stop()));
	}

	private stop(): void {
		this.session?.Destroy();
		this.session = undefined;
	}

	private start(): void {
		if (this.session !== undefined) return;
		const janitor = new Janitor();
		this.session = janitor;
		const gui = createKvScreenGui(GUI_NAME);
		gui.ResetOnSpawn = false;
		gui.DisplayOrder = UI_ART_SPIKE.displayOrder;
		gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling;
		gui.ScreenInsets = Enum.ScreenInsets.CoreUISafeInsets;
		gui.Parent = Players.LocalPlayer.WaitForChild("PlayerGui");
		const root = createRoot(gui);
		root.render(
			<ReflexProvider producer={clientStore}>
				<ScaledSpike />
			</ReflexProvider>,
		);
		// One task, so the order is fixed: unmount the tree, then destroy its ScreenGui.
		janitor.Add(() => {
			root.unmount();
			gui.Destroy();
		}, true);
		logInfo(`[UiArtSpike] on: ${GUI_NAME} (docs/SPIKES.md "Spike UA1")`);
	}
}

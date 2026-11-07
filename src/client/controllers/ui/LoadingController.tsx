import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import React from "@rbxts/react";
import { ReflexProvider } from "@rbxts/react-reflex";
import { createPortal, createRoot } from "@rbxts/react-roblox";
import { Players } from "@rbxts/services";
import { clientStore } from "client/store";
import { FocusScopesContext, LoadingScreen, LocaleRoot } from "client/ui";
import { SFX } from "shared/view/audio";
import { AudioController } from "../audio/AudioController";
import { InputController } from "../game/InputController";
import { PreloadController } from "../game/PreloadController";
import { FocusController } from "./FocusController";

const ROOT_NAME = "KV_LoadingRoot";

/**
 * Mounts the join loading screen (client/ui/loading LoadingScreen, docs/PRELOAD.md P4) into PlayerGui through a
 * portal, early (loadOrder 2: right after PreloadController, before the HUD and the menus mount), unless the screen
 * already released (KV_SkipLoading, or nothing to load: the placeholder pack). Skip (click, Enter, pad A) plays
 * sfx.ui.click and calls PreloadController.skip (the click never reaches the game: InputController
 * suppressMouseUntilRelease); its Skip is a `loading` focus scope (FocusController, FocusScopesContext). Once the
 * release's fade ran, the React root unmounts and its folder goes (Janitor).
 * Presentation only.
 */
@Controller({ loadOrder: 2 })
export class LoadingController implements OnStart {
	private readonly janitor = new Janitor();

	constructor(
		private readonly preload: PreloadController,
		private readonly audio: AudioController,
		private readonly input: InputController,
		private readonly focus: FocusController,
	) {}

	onStart(): void {
		if (this.preload.isReleased()) return;
		const playerGui = Players.LocalPlayer.WaitForChild("PlayerGui");
		const container = new Instance("Folder");
		container.Name = ROOT_NAME;
		const root = createRoot(container);
		// One cleanup, in order: the React tree first, then its folder.
		this.janitor.Add(() => {
			root.unmount();
			container.Destroy();
		}, true);
		const onSkip = () => {
			if (this.preload.isReleased()) return;
			this.input.suppressMouseUntilRelease();
			this.audio.playUi(SFX.uiClick);
			this.preload.skip();
		};
		// Unmount outside React's commit (the fade's last Heartbeat calls this).
		const onFaded = () => task.defer(() => this.janitor.Cleanup());
		root.render(
			createPortal(
				<ReflexProvider producer={clientStore}>
					<FocusScopesContext.Provider value={this.focus}>
						<LocaleRoot>
							<LoadingScreen onSkip={onSkip} onFaded={onFaded} />
						</LocaleRoot>
					</FocusScopesContext.Provider>
				</ReflexProvider>,
				playerGui,
			),
		);
	}
}

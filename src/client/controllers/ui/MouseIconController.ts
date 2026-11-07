import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { UserInputService } from "@rbxts/services";
import { clientStore, selectInputDevice } from "client/store";

/**
 * Hides the mouse pointer while the player is on a gamepad (docs/CURSOR.md "Picking up a gamepad hides it; moving the
 * mouse brings it back"). Nothing in the game set `UserInputService.MouseIconEnabled`, so the engine kept drawing its
 * pointer while a pad drove the run: a white dot over the floor. Hidden when the store's `inputDevice` becomes
 * `gamepad`; shown again on the first mouse move or click, or when the device turns back to keyboard / touch (the
 * device tracker only flips to keyboard on a key or a click, so a mouse move is watched here). Presentation only. The
 * value before start comes back on cleanup (Janitor).
 */
@Controller({})
export class MouseIconController implements OnStart {
	private readonly janitor = new Janitor();

	onStart(): void {
		const before = UserInputService.MouseIconEnabled;
		this.janitor.Add(() => {
			UserInputService.MouseIconEnabled = before;
		}, true);

		this.janitor.Add(clientStore.subscribe(selectInputDevice, (device) => this.setShown(device !== "gamepad")));
		this.janitor.Add(
			UserInputService.InputChanged.Connect((input) => {
				// A real move only: a zero-delta MouseMovement must not bring the pointer back under a pad.
				if (input.UserInputType !== Enum.UserInputType.MouseMovement) return;
				if (input.Delta.X !== 0 || input.Delta.Y !== 0) this.setShown(true);
			}),
		);
		this.janitor.Add(
			UserInputService.InputBegan.Connect((input) => {
				const t = input.UserInputType;
				if (t === Enum.UserInputType.MouseButton1 || t === Enum.UserInputType.MouseButton2) this.setShown(true);
			}),
		);
		if (clientStore.getState().game.inputDevice === "gamepad") this.setShown(false);
	}

	private setShown(shown: boolean): void {
		if (UserInputService.MouseIconEnabled !== shown) UserInputService.MouseIconEnabled = shown;
	}
}

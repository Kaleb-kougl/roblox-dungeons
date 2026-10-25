import { Controller, OnStart } from "@flamework/core";
import { Players } from "@rbxts/services";

const ROOT_PART = "HumanoidRootPart";
const ROOT_WAIT_SEC = 5;

/**
 * The player is a sim entity, not a Humanoid. The cleanest fix is no character at all: `Players.CharacterAutoLoads =
 * false`, which only the server (or the place file / Rojo project) can set; docs/CLIENT.md asks for it. Until then
 * this client-side guard makes a spawned character inert: its controls are sunk by the InputController's
 * ContextActionService binding, the camera is ours (Scriptable), the world sits above the template Baseplate so the
 * character is hidden under the backdrop, and its root is anchored locally so it never falls into the void and
 * respawns in a loop (the client owns its character's physics, so this holds without the server).
 */
@Controller({})
export class CharacterController implements OnStart {
	onStart(): void {
		const player = Players.LocalPlayer;
		player.CharacterAdded.Connect((character) => this.pin(character));
		if (player.Character !== undefined) this.pin(player.Character);
	}

	private pin(character: Model): void {
		task.spawn(() => {
			const root = character.WaitForChild(ROOT_PART, ROOT_WAIT_SEC);
			if (root !== undefined && root.IsA("BasePart")) root.Anchored = true;
		});
	}
}

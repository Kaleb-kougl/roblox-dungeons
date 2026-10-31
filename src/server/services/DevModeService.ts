import { OnStart, Service } from "@flamework/core";
import { Players, RunService } from "@rbxts/services";
import { serverLogger } from "server/log";
import { DEV_MODE } from "shared/config";
import { devModeAllowed } from "shared/devmode";

const log = serverLogger("DevMode");

/**
 * Developer mode's gate (docs/DEV_MODE.md): on join, sets the player attribute DEV_MODE.allowedAttribute (true) on
 * every player shared/devmode `devModeAllowed` lets in (Studio, a listed UserId, or the user-owned place's creator;
 * nobody while DEV_MODE.enabled is false). Players who may not get no attribute at all. A player attribute set by the
 * server replicates to every client; one a client sets on itself stays local, and only unlocks a local practice run
 * (dev runs are never submitted, and the server refuses the `dev` world).
 */
@Service({})
export class DevModeService implements OnStart {
	onStart(): void {
		if (!DEV_MODE.enabled) return;
		Players.PlayerAdded.Connect((player) => this.grant(player));
		for (const player of Players.GetPlayers()) this.grant(player);
	}

	private grant(player: Player): void {
		const allowed = devModeAllowed({
			studio: RunService.IsStudio(),
			userId: player.UserId,
			creatorId: game.CreatorId,
			creatorIsUser: game.CreatorType === Enum.CreatorType.User,
		});
		if (!allowed) return;
		player.SetAttribute(DEV_MODE.allowedAttribute, true);
		log.info("ALLOWED", `${player.Name} (${player.UserId})`);
	}
}

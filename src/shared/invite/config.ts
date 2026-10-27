/**
 * Roblox invite and party tunables (docs/INVITES.md §6). Data only: launchData.ts, arrival.ts and the server's
 * InviteService read these (CLAUDE.md "No magic numbers"). The platform invite cap and TTL are lobby rules and live
 * in shared/lobby LOBBY (`maxPlatformInvitesPerMember`, `platformInviteTimeoutSeconds`).
 */
import type { LobbyVisibility } from "shared/lobby";

/** Where `SocialService:PromptGameInvite` is called (spike I0 decides; "server" until it says otherwise). */
export type InvitePromptSide = "server" | "client";

export interface InviteConfig {
	/** See InvitePromptSide. "client": the server sends `invitePromptOnClient` with the options it built. */
	readonly promptSide: InvitePromptSide;
	/** Longest `ExperienceInviteOptions.LaunchData` Roblox accepts; `encodeInviteLaunch` asserts it. */
	readonly launchDataMaxChars: number;
	/** `Player:GetJoinData().LaunchData` can take a few seconds to appear: it is polled this often... */
	readonly launchDataPollSeconds: number;
	/** ...for at most this long after `PlayerAdded`, and only while nothing else placed the player. */
	readonly launchDataWaitSeconds: number;
	/**
	 * The client's first-join choice (tutorial or menu) waits at most this long for the server's `joinIntent`, so a
	 * slow server never stalls a normal join.
	 */
	readonly intentWaitSeconds: number;
	/** One `SocialService:CanSendGameInviteAsync` answer per player is reused for this long. */
	readonly eligibilityCacheSeconds: number;
	/** Visibility of a lobby made for a Roblox Party on arrival (ID5: Closed; the host can change it). */
	readonly partyLobbyVisibility: LobbyVisibility;
	/**
	 * `game.GameId` -> the Notification String id (`ExperienceInviteOptions.InviteMessageId`) made for that
	 * experience in Creator Dashboard. A universe without one uses Roblox's default invite text.
	 */
	readonly notificationStringIds: ReadonlyMap<number, string>;
}

export const INVITE: InviteConfig = table.freeze({
	promptSide: "server" as InvitePromptSide,
	launchDataMaxChars: 200,
	launchDataPollSeconds: 1,
	launchDataWaitSeconds: 10,
	intentWaitSeconds: 2,
	eligibilityCacheSeconds: 300,
	partyLobbyVisibility: "closed" as LobbyVisibility,
	// Empty until task I8 (owner): the live and test experiences' Notification String ids go here.
	notificationStringIds: new Map<number, string>() as ReadonlyMap<number, string>,
});

/** Per player: `invitePrompt` calls (sliding window; over it the request is dropped with a `rateLimited` notice). */
export const INVITE_PROMPT_RATE = table.freeze({ count: 5, windowSeconds: 60 });

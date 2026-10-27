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
	/**
	 * The server sends a fresh `joinIntent` (none -> lobby / party) when an arrival or party action places a player
	 * this long after their PlayerAdded at most: INVITE.launchDataWaitSeconds plus this margin, which covers the client's
	 * join loading screen (its first-join choice is dispatched only when the screen releases, docs/PRELOAD.md).
	 */
	readonly intentUpgradeMarginSeconds: number;
	/**
	 * A prompt's record (its lobby, for crediting recipients) is dropped after this long (or once its recipients
	 * came), so a later Roblox-menu invite is never credited to a stale lobby.
	 */
	readonly promptRecordSeconds: number;
	/**
	 * An ExperienceInviteOptions passed to PromptGameInvite is kept until the prompt closes
	 * (GameInvitePromptClosed), or destroyed after this long if it never reports closing.
	 */
	readonly promptOptionsSeconds: number;
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
	intentUpgradeMarginSeconds: 5,
	promptRecordSeconds: 300,
	promptOptionsSeconds: 300,
	eligibilityCacheSeconds: 300,
	partyLobbyVisibility: "closed" as LobbyVisibility,
	// Empty until task I8 (owner): the live and test experiences' Notification String ids go here.
	notificationStringIds: new Map<number, string>() as ReadonlyMap<number, string>,
});

/** Per player: `invitePrompt` calls (sliding window; over it the request is dropped with a `rateLimited` notice). */
export const INVITE_PROMPT_RATE = table.freeze({ count: 5, windowSeconds: 60 });
/**
 * Per player: `inviteRecipients` relays (one per prompt the client saw close; extra calls are dropped quietly, the
 * server's own GameInvitePromptClosed still records the prompt).
 */
export const INVITE_RECIPIENTS_RATE = table.freeze({ count: 10, windowSeconds: 60 });
/** Per player: `inviteEligibility` requests (extra calls are dropped quietly; the answer is cached anyway). */
export const INVITE_ELIGIBILITY_RATE = table.freeze({ count: 10, windowSeconds: 60 });

/**
 * Studio-only test inputs for InviteService (read only under `RunService:IsStudio()`, ignored on live servers, off
 * unless set; docs/SERVER.md "Roblox invites and parties"). A Player attribute wins over the Workspace one, which is
 * the default for every player (set it before Play to cover the join itself).
 */
export const INVITE_STUDIO_ATTRIBUTES = table.freeze({
	/** Player or Workspace, string: stands in for `GetJoinData().LaunchData` (negative test UserIds allowed). */
	fakeLaunchData: "KV_FakeLaunchData",
	/** Player or Workspace, string: stands in for `Player.PartyId` ("" = no party). */
	fakePartyId: "KV_FakePartyId",
	/** Workspace, boolean: forces the `inviteEligible` answer. */
	fakeInviteEligible: "KV_FakeInviteEligible",
	/**
	 * Player or Workspace, string of UserIds joined by `fakeRecipientsSeparator` ("-2,-3"): after each `invitePrompt`
	 * the server acts as if the prompt closed with these recipients (Studio never fires GameInvitePromptClosed).
	 */
	fakeInviteRecipients: "KV_FakeInviteRecipients",
	fakeRecipientsSeparator: ",",
});

/// <reference types="types" />
/**
 * Local corrections to @rbxts/types (1.0.957) for the social APIs docs/INVITES.md builds on (task I0). A global
 * script (no import / export), so these interfaces merge into the generated ones; tsconfig's default `include` picks
 * the file up and rbxtsc emits nothing for it.
 *
 * Checked against the generated types (2026-10-27):
 * - `ExperienceInviteOptions` (creatable; `PromptMessage`, `InviteUser: number`, `InviteMessageId`, `LaunchData`),
 *   `SocialService.PromptGameInvite(player, options?: Instance)`, `CanSendGameInviteAsync(player, recipientId?:
 *   number)`, `GameInvitePromptClosed(senderPlayer, recipientIds: Array<number>)`, `Player.PartyId` (read-only
 *   string) and `Player.GetJoinData().LaunchData?: string` (`PlayerJoinInfo`) are present and usable as is. None of
 *   them takes the `User` datatype, so LobbyService's `asUserParam` workaround is not needed here.
 * - `GetPlayersByPartyId` returns `Array<Instance>` (the engine returns Players) and `GetPartyAsync` returns
 *   `Array<unknown>`: the overloads below give them real element types.
 *
 * Overload order: TypeScript tries the members of the LATER merged declaration first. A root file like this one is
 * normally processed before the automatic `typeRoots` packages, which would leave the generated `Instance` /
 * `unknown` overloads first and these unreachable; the `reference types` line above loads @rbxts/types before this
 * file, so these overloads come first and win (checked with tsc: without the reference,
 * `const p: Array<Player> = SocialService.GetPlayersByPartyId(id)` fails). The invite spike's server
 * (`InviteSpikeService`) uses both without casts, so the typecheck pins this.
 */

/**
 * One entry of `SocialService:GetPartyAsync(partyId)`: a party member who is currently in this experience (any
 * server), ordered by when they accepted the party. Keys from the SocialService reference; the I0 spike
 * (docs/SPIKES.md "Spike I0") dumps the raw entries so a missing or extra key shows up there.
 */
interface SocialPartyMemberData {
	/** The member's `Player.UserId`. */
	readonly UserId: number;
	/** The `DataModel.PlaceId` of the place the member is in. */
	readonly PlaceId: number;
	/** The `DataModel.JobId` of the server the member is in. */
	readonly JobId: string;
	/** The `DataModel.PrivateServerId` of that server ("" for a public server). */
	readonly PrivateServerId: string;
	/** The reserved server access code of that server ("" if it is not reserved). */
	readonly ReservedServerAccessCode: string;
}

interface SocialService {
	/** The connected Players whose `Player.PartyId` is `partyId` (generated type: `Array<Instance>`). */
	GetPlayersByPartyId(this: SocialService, partyId: string): Array<Player>;
	/**
	 * Members of the party who are in this experience, in any server, ordered by when they accepted the party
	 * (generated type: `Array<unknown>`). Yields and can throw: call it inside `pcall`.
	 */
	GetPartyAsync(this: SocialService, partyId: string): Array<SocialPartyMemberData>;
}

/**
 * Lobby events -> AnalyticsService custom events (TelemetryService logs them; names in docs/SERVER.md "Telemetry").
 * Pure, like shared/run analytics.ts; every field value comes from a small fixed set.
 *
 * @module
 */
import type { AnalyticsEventSpec } from "shared/run";
import type { LobbyVisibility } from "./config";

/**
 * The custom event names the lobby and invite builders below log under, one per kind of event. These are the names that
 * appear in Roblox analytics, so changing one starts a new series.
 */
export const LOBBY_ANALYTICS_EVENT = {
	lobbyCreated: "LobbyCreated",
	lobbyStarted: "LobbyStarted",
	inviteSent: "LobbyInviteSent",
	inviteAnswered: "LobbyInviteAnswered",
	inviteArrival: "InviteArrival",
	partyGrouped: "PartyGrouped",
} as const;

/**
 * How an in-server lobby invite ended, `LobbyInviteAnswered`'s field 01: the invitee accepted it, declined it, or let
 * it time out.
 */
export type LobbyInviteAnswer = "accept" | "decline" | "expire";

/** How a `LobbyInviteSent` went out: the lobby's in-server invite list, or Roblox's invite prompt. */
export type LobbyInviteSentSource = "server" | "platform";

/**
 * What became of a player who arrived from a Roblox invite (docs/INVITES.md §7; shared/invite arrival.ts):
 *   joinedInvite    joined a lobby through a live invite (platform or party)
 *   joinedOpen      joined the LaunchData lobby without an invite (Open, or the host's friend)
 *   followedClosed  the LaunchData lobby is closed to them: the sender heard `followed`
 *   arrived         a menu (game) invite: they arrived, the sender heard `inviteArrived`
 *   full / gone / inRun / kickCooldown   the lobby could not take them (a toast)
 *   busy            they were already busy or in a lobby when the LaunchData came (a toast)
 *   noData          no LaunchData and no invite, though Roblox says someone referred them (`ReferredByPlayerId`:
 *                   Roblox's own menu invite, or the data never came)
 */
export type InviteArrivalOutcome =
	| "joinedInvite"
	| "joinedOpen"
	| "followedClosed"
	| "arrived"
	| "full"
	| "gone"
	| "inRun"
	| "kickCooldown"
	| "busy"
	| "noData";
/** The LaunchData kind (shared/invite InviteLaunch): a lobby invite or a menu (game) invite. */
export type InviteArrivalKind = "lobby" | "game";

/** How a Roblox Party was grouped on arrival: joined a mate's lobby, a party lobby was made, or only offered (toast). */
export type PartyGroupedHow = "joined" | "created" | "offered";

/** Logged for the host. Field 01: the visibility. */
export function analyticsForLobbyCreated(visibility: LobbyVisibility): AnalyticsEventSpec {
	return { kind: "custom", name: LOBBY_ANALYTICS_EVENT.lobbyCreated, value: 1, fields: { field01: visibility } };
}

/** Logged for the host when the countdown ends and the run is handed off. Value: the lobby size. */
export function analyticsForLobbyStarted(size: number): AnalyticsEventSpec {
	return {
		kind: "custom",
		name: LOBBY_ANALYTICS_EVENT.lobbyStarted,
		value: size,
		fields: { field01: size > 1 ? "party" : "solo" },
	};
}

/**
 * Logged for the sender. Value: the recipients (1 for an in-server invite; the invites one prompt made). Field 01:
 * the source. Platform recipients over `InviteArrival` is the invite conversion rate.
 */
export function analyticsForInviteSent(source: LobbyInviteSentSource, recipients: number): AnalyticsEventSpec {
	return { kind: "custom", name: LOBBY_ANALYTICS_EVENT.inviteSent, value: recipients, fields: { field01: source } };
}

/** Logged for the invitee. Field 01: the answer (an expiry counts as one). */
export function analyticsForInviteAnswered(answer: LobbyInviteAnswer): AnalyticsEventSpec {
	return { kind: "custom", name: LOBBY_ANALYTICS_EVENT.inviteAnswered, value: 1, fields: { field01: answer } };
}

/** Logged for the arriving player. Field 01: the outcome; field 02: the LaunchData kind. */
export function analyticsForInviteArrival(outcome: InviteArrivalOutcome, kind: InviteArrivalKind): AnalyticsEventSpec {
	return {
		kind: "custom",
		name: LOBBY_ANALYTICS_EVENT.inviteArrival,
		value: 1,
		fields: { field01: outcome, field02: kind },
	};
}

/** Logged for the player whose arrival grouped the party. Value: the party members grouped; field 01: how. */
export function analyticsForPartyGrouped(size: number, how: PartyGroupedHow): AnalyticsEventSpec {
	return { kind: "custom", name: LOBBY_ANALYTICS_EVENT.partyGrouped, value: size, fields: { field01: how } };
}

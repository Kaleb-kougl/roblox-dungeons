/**
 * Lobby events -> AnalyticsService custom events (TelemetryService logs them; names in docs/SERVER.md "Telemetry").
 * Pure, like shared/run analytics.ts; every field value comes from a small fixed set.
 */
import type { AnalyticsEventSpec } from "shared/run";
import type { LobbyVisibility } from "./config";

export const LOBBY_ANALYTICS_EVENT = {
	lobbyCreated: "LobbyCreated",
	lobbyStarted: "LobbyStarted",
	inviteSent: "LobbyInviteSent",
	inviteAnswered: "LobbyInviteAnswered",
} as const;

export type LobbyInviteAnswer = "accept" | "decline" | "expire";

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

/** Logged for the sender. */
export function analyticsForInviteSent(): AnalyticsEventSpec {
	return { kind: "custom", name: LOBBY_ANALYTICS_EVENT.inviteSent, value: 1 };
}

/** Logged for the invitee. Field 01: the answer (an expiry counts as one). */
export function analyticsForInviteAnswered(answer: LobbyInviteAnswer): AnalyticsEventSpec {
	return { kind: "custom", name: LOBBY_ANALYTICS_EVENT.inviteAnswered, value: 1, fields: { field01: answer } };
}

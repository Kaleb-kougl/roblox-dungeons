import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { Players, RunService, SocialService, Workspace } from "@rbxts/services";
import { Events } from "client/network";
import { clientStore, selectSelectedCharacter } from "client/store";
import { isCharacterId, type CharacterId } from "shared/characters";
import { INVITE, INVITE_STUDIO_ATTRIBUTES } from "shared/invite";
import { LOBBY, type LobbyVisibility, type LobbyWorld } from "shared/lobby";
import type { InvitePromptOptions, LobbyNotice } from "shared/network";
import {
	MENU_VIEW,
	eligibilityDue,
	knownLobbyTitle,
	lobbyStartAccepted,
	nextLobbyName,
	noticeSpec,
} from "shared/view/menu";
import { SimController } from "../game/SimController";
import { FocusController } from "./FocusController";

/**
 * Lobbies, client side (task L5; the server owns the lobbies, shared/lobby the model). Wires the lobby remotes into
 * the Reflex `lobby` slice: `lobbyList` (the browse list), `lobbyState` (this player's lobby, with its arrival time
 * for the countdown), `lobbyInvites` (received invites, likewise) and `lobbyNotice` (a toast: refusal codes read
 * `lobby.err.*`, the rest `lobby.notice.*`, shared/view/menu noticeSpec). Keeps the players in this server for the
 * invite list and every display name (the Player in this server, no web lookups). Sends the lobby requests for the
 * menu screens.
 *
 * Run handoff (L6): `lobbyRunStart` (a one-player lobby's countdown ended) starts a ranked solo run in the lobby's
 * world (endless or the Daily) for the lobby this client is in; `partyRunStarted` is taken by SimController under the
 * same rule (lobbyStartAccepted). Neither takes over a tutorial run being played (SimController.inRunningTutorial).
 *
 * Roblox invites (docs/INVITES.md I5): `invitePrompt` for the lobby room's "Invite friends (Roblox)" and the main
 * menu's "Invite friends"; eligibility (a client-side `CanSendGameInviteAsync`: Roblox refuses it on the server) and
 * `inviteEligibility` (the server answers with `joinIntent` when this player's arrival is already resolved, so it is
 * the join-intent request) once at start and again when a menu opens and the last check is
 * INVITE.eligibilityCacheSeconds old; the answer, Studio's `inviteEligible` and `joinIntent` into the slice (TutorialController's
 * first-join gate reads the intent). INVITE.promptSide "client": `invitePromptOnClient` opens the prompt here
 * (ExperienceInviteOptions with the server's LaunchData / InviteMessageId, pcall; kept until the local
 * GameInvitePromptClosed or INVITE.promptOptionsSeconds, then destroyed). The local player's
 * `SocialService.GameInvitePromptClosed` recipients always go back as `inviteRecipients` (the server dedupes), at
 * most LOBBY.maxPlatformInvitesPerMember of them. FocusController is told when the prompt is requested and when it
 * closes, fails or is refused (its CorePromptGuard: the menus leave the pad to the prompt meanwhile).
 */
@Controller({})
export class LobbyController implements OnStart {
	private readonly janitor = new Janitor();
	private noticeSerial = 0;
	/** The client-side prompt's options, kept until the prompt closes (or INVITE.promptOptionsSeconds). */
	private promptOptions: ExperienceInviteOptions | undefined;
	/** os.clock() of the last `inviteEligibility` sent (undefined: never). */
	private eligibilityAskedAt: number | undefined;
	/** A CanSendGameInviteAsync is in flight (its answer covers a second ask). */
	private eligibilityPending = false;

	constructor(private readonly sim: SimController, private readonly focus: FocusController) {}

	onStart(): void {
		this.janitor.Add(Events.lobbyList.connect((list) => clientStore.setLobbyList(list)));
		this.janitor.Add(Events.lobbyState.connect((u) => clientStore.setMyLobby(u.lobby, os.clock())));
		this.janitor.Add(Events.lobbyInvites.connect((list) => clientStore.setLobbyInvites(list, os.clock())));
		this.janitor.Add(Events.lobbyNotice.connect((notice) => this.showNotice(notice)));
		this.janitor.Add(Events.inviteEligible.connect((e) => clientStore.setInviteEligible(e.canSend === true)));
		this.janitor.Add(
			Events.joinIntent.connect((intent) => {
				// Sent after the first resolve, again with every inviteEligibility answer, and once more when the
				// server placed this player later (none -> lobby / party).
				const before = clientStore.getState().lobby.joinIntent;
				if (before !== intent.kind) print(`[Invite] join intent: ${before ?? "(none yet)"} -> ${intent.kind}`);
				clientStore.setJoinIntent(intent.kind);
			}),
		);
		this.janitor.Add(Events.invitePromptOnClient.connect((options) => this.promptOnClient(options)));
		const [okClosed, closedErr] = pcall(() =>
			this.janitor.Add(
				SocialService.GameInvitePromptClosed.Connect((sender, recipientIds) => {
					if (sender !== Players.LocalPlayer) return;
					this.focus.invitePromptClosed();
					this.dropPromptOptions();
					this.relayRecipients(recipientIds);
				}),
			),
		);
		if (!okClosed) warn(`[Invite] GameInvitePromptClosed is not available here: ${tostring(closedErr)}`);
		this.refreshEligibility();
		this.janitor.Add(
			Events.lobbyRunStart.connect((start) => {
				if (start.kind !== "solo") return;
				const mine = clientStore.getState().lobby.mine?.lobbyId;
				if (!lobbyStartAccepted(start.lobbyId, mine)) {
					warn(`[Lobby] ignored the solo start of lobby ${start.lobbyId}: not this client's lobby`);
					return;
				}
				if (this.sim.inRunningTutorial()) {
					// The server refuses lobby starts while this player is in the tutorial; a late one never takes it over
					// (the lobby goes back to forming when no ranked start comes).
					warn(`[Lobby] ignored the solo start of lobby ${start.lobbyId}: in the tutorial`);
					return;
				}
				print(`[Lobby] lobby ${start.lobbyId}: starting a ranked solo run (world ${start.worldKind})`);
				// docs/ARCHER.md AR5: as the character this member readied with (the selected one if the pick is odd).
				const character = isCharacterId(start.characterId) ? start.characterId : undefined;
				this.sim.startSolo(start.lobbyId, start.worldKind, character);
			}),
		);

		const refreshPlayers = () =>
			clientStore.setServerPlayers(Players.GetPlayers().map((p) => ({ userId: p.UserId, name: p.DisplayName })));
		refreshPlayers();
		this.janitor.Add(Players.PlayerAdded.Connect(refreshPlayers));
		this.janitor.Add(Players.PlayerRemoving.Connect(() => task.defer(refreshPlayers)));
		this.janitor.Add(
			RunService.Heartbeat.Connect(() => {
				if (clientStore.getState().lobby.notices.size() > 0) clientStore.expireLobbyNotices(os.clock());
			}),
		);
	}

	private showNotice(notice: LobbyNotice): void {
		const state = clientStore.getState().lobby;
		const players = state.players;
		const nameOf = (id: number) => players.find((p) => p.userId === id)?.name ?? `#${id}`;
		const s = noticeSpec(notice, nameOf, (id) => knownLobbyTitle(id, state.mine, state.list, nameOf));
		const seconds = s.inviteUserId !== undefined ? MENU_VIEW.actionNoticeSeconds : MENU_VIEW.noticeSeconds;
		this.noticeSerial++;
		clientStore.pushLobbyNotice(
			{
				id: this.noticeSerial,
				key: s.key,
				vars: s.vars,
				lobby: s.lobby,
				inviteUserId: s.inviteUserId,
				until: os.clock() + seconds,
			},
			MENU_VIEW.maxNotices,
		);
		if (notice.kind === "refused" && notice.requestKind === "invitePrompt") this.focus.invitePromptClosed();
		if (notice.kind === "refused") {
			warn(`[Lobby] ${notice.requestKind ?? "request"} refused (${notice.code ?? "?"}): ${notice.reason ?? ""}`);
		}
	}

	// --- Roblox invites (docs/INVITES.md I5) -----------------------------------------------------

	/**
	 * Re-checks invite eligibility (and asks the server for the join intent) unless the last check is still fresh.
	 * `SocialService:CanSendGameInviteAsync` must be called from a LocalScript (a published place's server answers
	 * "Must be called from a local script."), so the check runs here; the server only resends `joinIntent` (and, in
	 * Studio, the `KV_FakeInviteEligible` answer). A failed call leaves the answer unknown, so the buttons stay
	 * enabled: Roblox's prompt is the final word.
	 */
	refreshEligibility(): void {
		const now = os.clock();
		if (!eligibilityDue(this.eligibilityAskedAt, now, INVITE.eligibilityCacheSeconds)) return;
		this.eligibilityAskedAt = now;
		Events.inviteEligibility.fire();
		if (
			RunService.IsStudio() &&
			typeIs(Workspace.GetAttribute(INVITE_STUDIO_ATTRIBUTES.fakeInviteEligible), "boolean")
		) {
			return; // the server answers with the forced value
		}
		if (this.eligibilityPending) return;
		this.eligibilityPending = true;
		task.spawn(() => {
			const [ok, result] = pcall(() => SocialService.CanSendGameInviteAsync(Players.LocalPlayer));
			this.eligibilityPending = false;
			if (!ok) {
				warn(`[Invite] CanSendGameInviteAsync failed: ${tostring(result)}`);
				return;
			}
			clientStore.setInviteEligible(result === true);
		});
	}

	/** Roblox's invite prompt: with this player's lobby attached (the lobby room) or not (the main menu). */
	invitePrompt(withLobby: boolean): void {
		this.focus.invitePromptOpened();
		Events.invitePrompt.fire({ withLobby });
	}

	/** INVITE.promptSide "client": the server built the options, the prompt opens for the local player here. */
	private promptOnClient(options: InvitePromptOptions): void {
		const launchData = options.launchData;
		if (!typeIs(launchData, "string")) return;
		this.dropPromptOptions();
		const opts = new Instance("ExperienceInviteOptions");
		opts.LaunchData = launchData;
		const messageId = options.inviteMessageId;
		if (typeIs(messageId, "string") && messageId !== "") opts.InviteMessageId = messageId;
		this.promptOptions = opts;
		task.delay(INVITE.promptOptionsSeconds, () => {
			if (this.promptOptions === opts) this.promptOptions = undefined;
			opts.Destroy();
		});
		this.focus.invitePromptOpened();
		const [ok, err] = pcall(() => SocialService.PromptGameInvite(Players.LocalPlayer, opts));
		if (!ok) {
			warn(`[Invite] PromptGameInvite failed: ${tostring(err)}`);
			this.focus.invitePromptClosed();
			this.dropPromptOptions();
		}
	}

	private dropPromptOptions(): void {
		this.promptOptions?.Destroy();
		this.promptOptions = undefined;
	}

	/** The local player's prompt closed: its recipients (integers only, at most the platform cap) to the server. */
	private relayRecipients(recipientIds: unknown): void {
		if (!typeIs(recipientIds, "table")) return;
		const ids: number[] = [];
		for (const id of recipientIds as unknown[]) {
			if (ids.size() >= LOBBY.maxPlatformInvitesPerMember) break;
			if (typeIs(id, "number") && id % 1 === 0 && !ids.includes(id)) ids.push(id);
		}
		if (ids.size() === 0) return;
		print(`[Invite] prompt closed: ${ids.size()} recipient(s)`);
		Events.inviteRecipients.fire(ids);
	}

	// --- requests (the menu screens) ------------------------------------------------------------

	requestList(): void {
		Events.lobbyRequestList.fire();
	}

	/** A new lobby; `worldKind` names its world (default the server's: endless; the Daily: docs/DAILY.md DS9). */
	create(visibility: LobbyVisibility, worldKind?: LobbyWorld): void {
		Events.lobbyCreate.fire(worldKind !== undefined ? { visibility, worldKind } : { visibility });
	}

	join(lobbyId: string): void {
		Events.lobbyJoin.fire(lobbyId);
	}

	leave(): void {
		Events.lobbyLeave.fire();
	}

	kick(userId: number): void {
		Events.lobbyKick.fire(userId);
	}

	transferHost(userId: number): void {
		Events.lobbyTransferHost.fire(userId);
	}

	setVisibility(visibility: LobbyVisibility): void {
		Events.lobbySetVisibility.fire(visibility);
	}

	/** Host, while forming: the lobby's world (endless / the Daily); a change clears every Ready. */
	setWorld(worldKind: LobbyWorld): void {
		Events.lobbySetWorld.fire(worldKind);
	}

	/** Host: the next preset name (LOBBY_NAMES order). */
	rename(): void {
		const mine = clientStore.getState().lobby.mine;
		if (mine !== undefined) Events.lobbySetName.fire(nextLobbyName(mine.nameId));
	}

	invite(userId: number): void {
		Events.lobbyInvite.fire(userId);
	}

	/** Answers an invite; its toast goes at once (the server's next `lobbyInvites` confirms). */
	answerInvite(inviteId: string, accept: boolean): void {
		Events.lobbyAnswerInvite.fire(inviteId, accept);
		const state = clientStore.getState().lobby;
		clientStore.setLobbyInvites(
			state.invites.filter((i) => i.inviteId !== inviteId),
			state.invitesAt,
		);
	}

	/**
	 * Ready on / off with a character pick (docs/ARCHER.md AR5): `characterId`, default the selected character
	 * (client/store selectSelectedCharacter). The server stores the pick either way (shown on this member's row); a pick
	 * change while ready un-readies. This does not change the selected character (SettingsController
	 * .setSelectedCharacter does).
	 */
	setReady(ready: boolean, characterId?: CharacterId): void {
		const pick = characterId ?? selectSelectedCharacter(clientStore.getState());
		Events.lobbySetReady.fire(ready, pick);
	}

	start(): void {
		Events.lobbyStart.fire();
	}
}

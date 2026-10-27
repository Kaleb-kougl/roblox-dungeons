import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { Players, ReplicatedStorage, SocialService, Workspace } from "@rbxts/services";
import { clientStore, InviteSpikeRequest, selectInviteSpikeRequest } from "client/store";
import { INVITE_SPIKE, InviteSpikeAction, SPIKE_ATTRIBUTES } from "shared/config";
import {
	describeFields,
	describeValue,
	inviteSpikeLaunchData,
	makeInviteSpikeOptions,
	pickInviteSpikeRecipient,
} from "shared/spikes";
import { watchSpikeFlag } from "./spikeFlags";

const LOG = "[InviteSpike/client]";
const SECONDS = "%.2f";

function since(t0: number): string {
	return `+${string.format(SECONDS, os.clock() - t0)} s`;
}

/**
 * Spike I0, client half (docs/INVITES.md I0, docs/SPIKES.md "Spike I0"). Off unless `KV_InviteSpike` (or
 * SPIKE_DEFAULTS.invites) is true; the server half (server/services/spikes InviteSpikeService) reads the same flag.
 * While on:
 *
 * - logs this client's own view at start: `Player.PartyId` and `GetJoinData()` inside pcall (both may be
 *   server-only or Roblox Security);
 * - connects `SocialService.GameInvitePromptClosed` here too (which side fires is an I0 question);
 * - the spike HUD's buttons (store `requestInviteSpike`): `promptClient` = PromptGameInvite from the client with the
 *   same ExperienceInviteOptions as the server's, `canSendClient` = CanSendGameInviteAsync without and with a
 *   recipient, the server actions go over the spike RemoteEvent (ReplicatedStorage `KV_InviteSpike/Request`, made by
 *   the server at runtime), `dump` does both sides;
 * - every line (`[InviteSpike/client]` in the output, `cli` / `srv` on the HUD) lands in the HUD's last
 *   INVITE_SPIKE.hudLines, so a phone or console tester can read the server's lines without the dev console.
 *
 * Setting the flag false disconnects everything and destroys the prompt options (one Janitor).
 */
@Controller({})
export class InviteSpikeController implements OnStart {
	private session?: Janitor;
	private remote?: RemoteEvent;
	private options?: ExperienceInviteOptions;

	onStart(): void {
		watchSpikeFlag("invites", (enabled) => (enabled ? this.start() : this.stop()));
	}

	private stop(): void {
		if (this.session === undefined) return;
		this.session.Destroy();
		this.session = undefined;
		this.remote = undefined;
		clientStore.setInviteSpikeActive(false);
	}

	private start(): void {
		if (this.session !== undefined) return;
		const session = new Janitor();
		this.session = session;
		clientStore.setInviteSpikeActive(true);
		session.Add(() => {
			this.options?.Destroy();
			this.options = undefined;
		}, true);

		const [okSignal, signalErr] = pcall(() =>
			session.Add(
				SocialService.GameInvitePromptClosed.Connect((sender, recipientIds) => {
					this.line(
						"PROMPT_CLOSED",
						`(client signal) ${sender.Name} (${sender.UserId}) recipientIds (${typeOf(
							recipientIds,
						)}) = ${describeValue(recipientIds)}`,
					);
					this.options?.Destroy();
					this.options = undefined;
				}),
			),
		);
		if (!okSignal) this.warnLine("PROMPT_CLOSED_ERR", `connect on the client: ${tostring(signalErr)}`);

		let lastSeq = selectInviteSpikeRequest(clientStore.getState())?.seq ?? 0;
		session.Add(
			clientStore.subscribe(selectInviteSpikeRequest, (request?: InviteSpikeRequest) => {
				if (request === undefined || request.seq === lastSeq) return;
				lastSeq = request.seq;
				task.spawn(() => this.run(request.action));
			}),
			true,
		);

		const thread = task.spawn(() => {
			this.dumpSelf("start");
			this.connectRemote(session);
		});
		session.Add(() => {
			if (coroutine.status(thread) === "suspended") task.cancel(thread);
		}, true);
	}

	private line(event: string, message: string): void {
		print(`${LOG} ${event}: ${message}`);
		clientStore.pushInviteSpikeLine(`cli ${event}: ${message}`);
	}

	private warnLine(event: string, message: string): void {
		warn(`${LOG} ${event}: ${message}`);
		clientStore.pushInviteSpikeLine(`cli ${event}: ${message}`);
	}

	/** Waits for the server's spike folder and remote, then shows every server line on the HUD. */
	private connectRemote(session: Janitor): void {
		const folder = ReplicatedStorage.WaitForChild(INVITE_SPIKE.folderName, INVITE_SPIKE.remoteWaitSec);
		const remote = folder?.WaitForChild(INVITE_SPIKE.remoteName, INVITE_SPIKE.remoteWaitSec);
		if (remote === undefined || !remote.IsA("RemoteEvent")) {
			this.warnLine(
				"NO_SERVER",
				`no ${INVITE_SPIKE.folderName}/${INVITE_SPIKE.remoteName} after ${INVITE_SPIKE.remoteWaitSec} s: is ` +
					`${SPIKE_ATTRIBUTES.invites} on for the server (set it in the place, or from the server)?`,
			);
			return;
		}
		this.remote = remote;
		session.Add(
			remote.OnClientEvent.Connect((message: unknown) => {
				if (typeIs(message, "string")) clientStore.pushInviteSpikeLine(message);
			}),
		);
		session.Add(
			remote.Destroying.Connect(() => {
				this.remote = undefined;
			}),
		);
		this.line("SERVER", "spike remote found: server lines follow");
		remote.FireServer("hello");
	}

	private run(action: InviteSpikeAction): void {
		if (action === "promptClient") this.prompt();
		else if (action === "canSendClient") this.canSend();
		else {
			if (action === "dump") this.dumpSelf("dump");
			if (this.remote === undefined) {
				this.warnLine("NO_SERVER", `${action}: the server spike remote is not here`);
				return;
			}
			this.remote.FireServer(action);
			this.line("REQUEST", `${action} sent to the server`);
		}
	}

	/** What the client itself can read: PartyId and GetJoinData (both may refuse on the client). */
	private dumpSelf(why: string): void {
		const player = Players.LocalPlayer;
		const [okParty, partyId] = pcall(() => player.PartyId);
		this.line("CLIENT", `${why}: ${player.Name} (${player.UserId}) place ${game.PlaceId} job ${game.JobId}`);
		if (okParty) this.line("PARTY_ID", `${why}: (${typeOf(partyId)}) ${describeValue(partyId)}`);
		else this.warnLine("PARTY_ID_ERR", `${why}: ${tostring(partyId)}`);
		const [okJoin, data] = pcall(() => player.GetJoinData());
		if (!okJoin) {
			this.warnLine("JOIN_DATA_ERR", `${why}: ${tostring(data)}`);
			return;
		}
		const fields = describeFields(data);
		this.line("JOIN_DATA", `${why}: ${fields.size()} keys`);
		for (const field of fields) this.line("JOIN_DATA", `  ${field}`);
	}

	private recipient(): number | undefined {
		const others = new Array<number>();
		for (const p of Players.GetPlayers()) if (p !== Players.LocalPlayer) others.push(p.UserId);
		return pickInviteSpikeRecipient(Workspace.GetAttribute(INVITE_SPIKE.recipientAttribute), others);
	}

	/** Client-side PromptGameInvite with the same options the server builds (LaunchData side `c`). */
	private prompt(): void {
		const player = Players.LocalPlayer;
		const launch = inviteSpikeLaunchData("client", player.UserId, DateTime.now().ToIsoDate());
		const messageId = Workspace.GetAttribute(INVITE_SPIKE.messageIdAttribute);
		this.options?.Destroy();
		this.options = undefined;
		const [built, options] = pcall(() => makeInviteSpikeOptions(launch, undefined, messageId));
		if (!built) {
			this.warnLine("PROMPT_OPTIONS_ERR", tostring(options));
			return;
		}
		this.options = options;
		const detail = `LaunchData ${launch.size()} chars ${describeValue(launch)}`;
		const [ok, err] = pcall(() => SocialService.PromptGameInvite(player, options));
		if (ok) this.line("PROMPT_CLIENT", `returned; ${detail}`);
		else this.warnLine("PROMPT_CLIENT_ERR", `${tostring(err)}; ${detail}`);
	}

	private canSend(): void {
		const player = Players.LocalPlayer;
		const t = os.clock();
		const [ok, result] = pcall(() => SocialService.CanSendGameInviteAsync(player));
		this.line(
			"CAN_SEND_CLIENT",
			`no recipient ${since(t)}: ${ok ? describeValue(result) : `error ${tostring(result)}`}`,
		);
		const recipient = this.recipient();
		if (recipient === undefined) {
			this.line(
				"CAN_SEND_CLIENT",
				`with recipient: skipped (no 2nd player, no ${INVITE_SPIKE.recipientAttribute})`,
			);
			return;
		}
		const t2 = os.clock();
		const [ok2, result2] = pcall(() => SocialService.CanSendGameInviteAsync(player, recipient));
		this.line(
			"CAN_SEND_CLIENT",
			`recipient ${recipient} ${since(t2)}: ${ok2 ? describeValue(result2) : `error ${tostring(result2)}`}`,
		);
	}
}

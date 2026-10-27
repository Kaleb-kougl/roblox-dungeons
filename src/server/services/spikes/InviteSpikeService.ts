import { OnStart, Service } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { Players, ReplicatedStorage, RunService, SocialService, Workspace } from "@rbxts/services";
import { serverLogger } from "server/log";
import { INVITE_SPIKE, SPIKE_ATTRIBUTES } from "shared/config";
import {
	describeFields,
	describeValue,
	inviteSpikeLaunchData,
	isInviteSpikeServerAction,
	makeInviteSpikeOptions,
	parseInviteSpikeLaunchData,
	pickInviteSpikeRecipient,
} from "shared/spikes";
import { watchServerSpikeFlag } from "./spikeFlags";

const log = serverLogger("InviteSpike");
const SECONDS = "%.2f";
const MS_PER_SEC = 1000;

function since(t0: number): string {
	return `+${string.format(SECONDS, os.clock() - t0)} s`;
}

function who(player: Player): string {
	return `${player.Name} (${player.UserId})`;
}

function here(userId: number): string {
	return Players.GetPlayerByUserId(userId) !== undefined ? "IS in this server" : "is NOT in this server";
}

/** Seconds from a spike LaunchData's ISO time to now, or "?" if it does not parse. */
function ageOf(isoTime: string): string {
	const [ok, sent] = pcall(() => DateTime.fromIsoDate(isoTime));
	if (!ok || sent === undefined) return "?";
	const ageMs = DateTime.now().UnixTimestampMillis - sent.UnixTimestampMillis;
	return string.format(SECONDS, ageMs / MS_PER_SEC);
}

/**
 * One run of the server half of the invites spike: the spike folder and RemoteEvent, the per-player watches, the
 * prompt options it keeps alive until the prompt closes. `destroy` removes all of it (one Janitor).
 */
class InviteSpikeSession {
	private readonly janitor = new Janitor();
	private readonly remote: RemoteEvent;
	private readonly watches = new Map<Player, Janitor>();
	private readonly options = new Map<Player, ExperienceInviteOptions>();
	private readonly lastRequest = new Map<Player, number>();
	private readonly arrivals = new Map<Player, Array<string>>();
	private closed = false;

	constructor() {
		const folder = new Instance("Folder");
		folder.Name = INVITE_SPIKE.folderName;
		const remote = new Instance("RemoteEvent");
		remote.Name = INVITE_SPIKE.remoteName;
		remote.Parent = folder;
		this.remote = remote;
		this.janitor.Add(folder);
		this.janitor.Add(() => {
			for (const [, watch] of this.watches) watch.Destroy();
			this.watches.clear();
			for (const [, options] of this.options) options.Destroy();
			this.options.clear();
		}, true);

		this.janitor.Add(Players.PlayerAdded.Connect((player) => this.track(player, false)));
		this.janitor.Add(Players.PlayerRemoving.Connect((player) => this.untrack(player)));
		this.janitor.Add(
			SocialService.GameInvitePromptClosed.Connect((sender, recipientIds) => {
				this.line(
					"PROMPT_CLOSED",
					`(server signal) ${who(sender)} recipientIds (${typeOf(recipientIds)}) = ${describeValue(
						recipientIds,
					)}`,
				);
				this.options.get(sender)?.Destroy();
				this.options.delete(sender);
			}),
		);
		this.janitor.Add(remote.OnServerEvent.Connect((player, action) => this.request(player, action)));
		folder.Parent = ReplicatedStorage;

		this.line(
			"ON",
			`place ${game.PlaceId} game ${game.GameId} job ${game.JobId} private ${describeValue(
				game.PrivateServerId,
			)} studio ${tostring(RunService.IsStudio())} players ${Players.GetPlayers().size()}/${Players.MaxPlayers}`,
		);
		for (const player of Players.GetPlayers()) this.track(player, true);
	}

	destroy(): void {
		this.line("OFF", `${SPIKE_ATTRIBUTES.invites} off: removing the spike remote`);
		this.closed = true;
		this.janitor.Destroy();
	}

	/** Server output plus every client's spike HUD. */
	private line(event: string, message: string): void {
		log.info(event, message);
		if (!this.closed) this.remote.FireAllClients(`srv ${event}: ${message}`);
	}

	private warnLine(event: string, message: string): void {
		log.warn(event, message);
		if (!this.closed) this.remote.FireAllClients(`srv ${event}: ${message}`);
	}

	/** A line about one player's arrival: also kept (INVITE_SPIKE.replayLines) for that client's `hello`. */
	private lineFor(player: Player, event: string, message: string): void {
		this.keep(player, `srv ${event}: ${message}`);
		this.line(event, message);
	}

	private warnLineFor(player: Player, event: string, message: string): void {
		this.keep(player, `srv ${event}: ${message}`);
		this.warnLine(event, message);
	}

	private keep(player: Player, text: string): void {
		let kept = this.arrivals.get(player);
		if (kept === undefined) {
			kept = [];
			this.arrivals.set(player, kept);
		}
		if (kept.size() >= INVITE_SPIKE.replayLines) kept.remove(0);
		kept.push(text);
	}

	/**
	 * The client asks once its HUD is listening: its own arrival lines were broadcast before it could hear them
	 * (PlayerAdded runs before the client has loaded), so they are sent again to it alone.
	 */
	private replay(player: Player): void {
		const kept = this.arrivals.get(player) ?? [];
		this.remote.FireClient(
			player,
			`srv REPLAY: ${kept.size()} lines about ${who(player)} from before you listened`,
		);
		for (const text of kept) this.remote.FireClient(player, `${text} (replay)`);
	}

	private track(player: Player, late: boolean): void {
		if (this.watches.has(player)) return;
		const watch = new Janitor();
		this.watches.set(player, watch);
		const t0 = os.clock();
		this.lineFor(
			player,
			"PLAYER_ADDED",
			`${who(player)} players ${Players.GetPlayers().size()}/${Players.MaxPlayers}` +
				(late ? " (here before the spike started: timings are not from PlayerAdded)" : ""),
		);
		const thread = task.spawn(() => {
			this.dumpJoinData(player, t0, "PlayerAdded");
			this.readParty(player, t0, "PlayerAdded");
			this.pollLaunchData(player, t0);
		});
		watch.Add(() => {
			if (coroutine.status(thread) === "suspended") task.cancel(thread);
		}, true);
		const [ok, signal] = pcall(() => player.GetPropertyChangedSignal("PartyId"));
		if (ok) {
			watch.Add(signal.Connect(() => task.spawn(() => this.readParty(player, t0, "PartyId changed"))));
		} else {
			this.warnLineFor(
				player,
				"PARTY_SIGNAL_ERR",
				`${who(player)}: GetPropertyChangedSignal("PartyId") ${tostring(signal)}`,
			);
		}
	}

	private untrack(player: Player): void {
		this.line("PLAYER_REMOVING", who(player));
		this.watches.get(player)?.Destroy();
		this.watches.delete(player);
		this.options.get(player)?.Destroy();
		this.options.delete(player);
		this.lastRequest.delete(player);
		this.arrivals.delete(player);
	}

	private dumpJoinData(player: Player, t0: number, why: string): void {
		const [ok, data] = pcall(() => player.GetJoinData());
		if (!ok) {
			this.warnLineFor(player, "JOIN_DATA_ERR", `${who(player)} ${why} ${since(t0)}: ${tostring(data)}`);
			return;
		}
		const fields = describeFields(data);
		this.lineFor(player, "JOIN_DATA", `${who(player)} ${why} ${since(t0)}: ${fields.size()} keys`);
		for (const field of fields) this.lineFor(player, "JOIN_DATA", `${who(player)}   ${field}`);
		const referrer = data.ReferredByPlayerId;
		if (typeIs(referrer, "number"))
			this.lineFor(player, "REFERRED_BY", `${who(player)}: ${referrer} ${here(referrer)}`);
		if (typeIs(data.LaunchData, "string") && data.LaunchData !== "") this.reportLaunch(player, data.LaunchData);
	}

	private launchDataOf(player: Player): string | undefined {
		const [ok, data] = pcall(() => player.GetJoinData());
		return ok ? data.LaunchData : undefined;
	}

	/** INVITE_SPIKE.launchDataWatchSec of polls: when LaunchData first reads non-empty, measured from PlayerAdded. */
	private pollLaunchData(player: Player, t0: number): void {
		const first = this.launchDataOf(player);
		if (first !== undefined && first !== "") {
			this.lineFor(
				player,
				"LAUNCH_DATA",
				`${who(player)} non-empty at PlayerAdded ${since(t0)}: ${describeValue(first)}`,
			);
			return;
		}
		const polls = math.floor(INVITE_SPIKE.launchDataWatchSec / INVITE_SPIKE.launchDataPollSec);
		for (let i = 1; i <= polls; i++) {
			task.wait(INVITE_SPIKE.launchDataPollSec);
			if (player.Parent === undefined) return;
			const value = this.launchDataOf(player);
			if (value !== undefined && value !== "") {
				this.lineFor(
					player,
					"LAUNCH_DATA",
					`${who(player)} first non-empty ${since(t0)} (poll ${i}): ${describeValue(value)}`,
				);
				this.reportLaunch(player, value);
				return;
			}
		}
		this.lineFor(
			player,
			"LAUNCH_DATA",
			`${who(player)} still empty after ${
				INVITE_SPIKE.launchDataWatchSec
			} s (expected unless they came from an invite)`,
		);
	}

	/** Length, and for a spike LaunchData: which side prompted, whether the inviter is here, seconds since the prompt. */
	private reportLaunch(player: Player, value: string): void {
		const over = value.size() > INVITE_SPIKE.launchDataMaxChars ? ` OVER ${INVITE_SPIKE.launchDataMaxChars}` : "";
		const launch = parseInviteSpikeLaunchData(value);
		if (launch === undefined) {
			this.lineFor(
				player,
				"LAUNCH_PARSED",
				`${who(player)}: ${value.size()} chars${over}, not a spike LaunchData`,
			);
			return;
		}
		this.lineFor(
			player,
			"LAUNCH_PARSED",
			`${who(player)}: ${value.size()} chars${over}; ${launch.side} prompt by ${launch.inviterId} ` +
				`(${here(launch.inviterId)}), sent ${ageOf(launch.isoTime)} s ago`,
		);
	}

	private readParty(player: Player, t0: number, why: string): void {
		const [ok, partyId] = pcall(() => player.PartyId);
		if (!ok) {
			this.warnLineFor(player, "PARTY_ID_ERR", `${who(player)} ${why} ${since(t0)}: ${tostring(partyId)}`);
			return;
		}
		this.lineFor(
			player,
			"PARTY_ID",
			`${who(player)} ${why} ${since(t0)}: (${typeOf(partyId)}) ${describeValue(partyId)}`,
		);
		if (!typeIs(partyId, "string") || partyId === "") return;

		const [okHere, mates] = pcall(() => SocialService.GetPlayersByPartyId(partyId));
		if (okHere) {
			this.lineFor(
				player,
				"PARTY_PLAYERS",
				`${partyId}: ${mates.size()} in this server: ${mates.map(who).join(", ")}`,
			);
		} else {
			this.warnLineFor(player, "PARTY_PLAYERS_ERR", `${partyId}: ${tostring(mates)}`);
		}
		const t = os.clock();
		const [okAll, members] = pcall(() => SocialService.GetPartyAsync(partyId));
		if (!okAll) {
			this.warnLineFor(player, "PARTY_ASYNC_ERR", `${partyId} ${since(t)}: ${tostring(members)}`);
			return;
		}
		this.lineFor(player, "PARTY_ASYNC", `${partyId} ${since(t)}: ${members.size()} entries (accept order)`);
		members.forEach((member, i) => {
			// The declared shape is unverified until I0: a missing UserId must not stop the dump.
			const userId: unknown = typeIs(member, "table") ? member.UserId : undefined;
			const where = typeIs(userId, "number") ? here(userId) : "no numeric UserId";
			this.lineFor(player, "PARTY_ASYNC", `  ${i + 1}: ${describeValue(member)} (${where})`);
		});
	}

	private recipientFor(player: Player): number | undefined {
		const others = new Array<number>();
		for (const p of Players.GetPlayers()) if (p !== player) others.push(p.UserId);
		return pickInviteSpikeRecipient(Workspace.GetAttribute(INVITE_SPIKE.recipientAttribute), others);
	}

	private request(player: Player, action: unknown): void {
		if (!isInviteSpikeServerAction(action)) {
			this.warnLine("BAD_REQUEST", `${who(player)}: ${describeValue(action)}`);
			return;
		}
		const now = os.clock();
		const last = this.lastRequest.get(player);
		if (last !== undefined && now - last < INVITE_SPIKE.requestCooldownSec) {
			this.warnLine("RATE_LIMITED", `${who(player)}: ${action}`);
			return;
		}
		this.lastRequest.set(player, now);
		if (action === "hello") this.replay(player);
		else if (action === "promptServer") this.prompt(player, false);
		else if (action === "promptServerOne") this.prompt(player, true);
		else if (action === "canSendServer") this.canSend(player);
		else if (action === "dump") {
			this.dumpJoinData(player, now, "dump");
			this.readParty(player, now, "dump");
		}
	}

	/** Server-side PromptGameInvite with ExperienceInviteOptions; `one`: InviteUser = the recipient. */
	private prompt(player: Player, one: boolean): void {
		const recipient = one ? this.recipientFor(player) : undefined;
		if (one && recipient === undefined) {
			this.warnLine(
				"PROMPT_SKIPPED",
				`no recipient: set ${INVITE_SPIKE.recipientAttribute} or have a 2nd player`,
			);
			return;
		}
		const launch = inviteSpikeLaunchData("server", player.UserId, DateTime.now().ToIsoDate());
		const messageId = Workspace.GetAttribute(INVITE_SPIKE.messageIdAttribute);
		this.options.get(player)?.Destroy();
		this.options.delete(player);
		const [built, options] = pcall(() => makeInviteSpikeOptions(launch, recipient, messageId));
		if (!built) {
			this.warnLine("PROMPT_OPTIONS_ERR", `${who(player)}: ${tostring(options)}`);
			return;
		}
		this.options.set(player, options);
		const detail =
			`LaunchData ${launch.size()} chars ${describeValue(launch)}` +
			(recipient !== undefined ? ` InviteUser ${recipient}` : "") +
			(typeIs(messageId, "string") ? ` InviteMessageId ${messageId}` : "");
		const [ok, err] = pcall(() => SocialService.PromptGameInvite(player, options));
		if (ok) this.line("PROMPT_SERVER", `${who(player)}: returned; ${detail}`);
		else this.warnLine("PROMPT_SERVER_ERR", `${who(player)}: ${tostring(err)}; ${detail}`);
	}

	private canSend(player: Player): void {
		const t = os.clock();
		const [ok, result] = pcall(() => SocialService.CanSendGameInviteAsync(player));
		this.line(
			"CAN_SEND_SERVER",
			`${who(player)} no recipient ${since(t)}: ${ok ? describeValue(result) : `error ${tostring(result)}`}`,
		);
		const recipient = this.recipientFor(player);
		if (recipient === undefined) {
			this.line(
				"CAN_SEND_SERVER",
				`with recipient: skipped (no 2nd player, no ${INVITE_SPIKE.recipientAttribute})`,
			);
			return;
		}
		const t2 = os.clock();
		const [ok2, result2] = pcall(() => SocialService.CanSendGameInviteAsync(player, recipient));
		this.line(
			"CAN_SEND_SERVER",
			`${who(player)} recipient ${recipient} ${since(t2)}: ${
				ok2 ? describeValue(result2) : `error ${tostring(result2)}`
			}`,
		);
	}
}

/**
 * Spike I0, server half (docs/INVITES.md I0, docs/SPIKES.md "Spike I0"): what the Roblox invite and party APIs do in
 * a published place. Off unless `KV_InviteSpike` (or SPIKE_DEFAULTS.invites) is true. While on:
 *
 * - every PlayerAdded (and every player already here when it starts): `GetJoinData()` dumped key by key with types,
 *   `ReferredByPlayerId` checked against this server, `LaunchData` polled every INVITE_SPIKE.launchDataPollSec for
 *   launchDataWatchSec (when it first reads non-empty, from PlayerAdded; a spike LaunchData also says who prompted,
 *   whether they are here and how long ago), `PartyId` read inside pcall now and on its changed signal, and for a
 *   party `GetPlayersByPartyId` and pcall'd `GetPartyAsync` dumped;
 * - `SocialService.GameInvitePromptClosed` logged with the sender and recipientIds;
 * - a RemoteEvent (ReplicatedStorage `KV_InviteSpike/Request`, made here at runtime, not in shared/network) takes the
 *   client HUD's requests (INVITE_SPIKE_SERVER_ACTIONS): a server-side PromptGameInvite (ExperienceInviteOptions with
 *   PromptMessage, LaunchData, optional InviteUser / InviteMessageId), CanSendGameInviteAsync without and with a
 *   recipient, a fresh dump. Every line goes to the server output and to every client's spike HUD.
 *
 * Turning the flag off destroys the folder, every watch and every options object.
 */
@Service({})
export class InviteSpikeService implements OnStart {
	private session?: InviteSpikeSession;

	onStart(): void {
		watchServerSpikeFlag("invites", (enabled) => (enabled ? this.start() : this.stop()));
	}

	private start(): void {
		if (this.session !== undefined) return;
		this.session = new InviteSpikeSession();
	}

	private stop(): void {
		this.session?.destroy();
		this.session = undefined;
	}
}

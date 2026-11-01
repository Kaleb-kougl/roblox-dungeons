import { OnStart, Service } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { Players, RunService, SocialService, Workspace } from "@rbxts/services";
import { serverLogger } from "server/log";
import { Events } from "server/network";
import {
	INVITE,
	INVITE_ELIGIBILITY_RATE,
	INVITE_PROMPT_RATE,
	INVITE_RECIPIENTS_RATE,
	INVITE_STUDIO_ATTRIBUTES,
	arrivalPlacements,
	decodeInviteLaunch,
	encodeInviteLaunch,
	inviteArrivalOutcome,
	inviteRecipientList,
	joinIntentNow,
	parseFakeRecipients,
	partyAcceptOrder,
	partyOffers,
	resolveArrival,
	shouldUpgradeJoinIntent,
	type ArrivalInput,
	type ArrivalJoinIntent,
	type ArrivalPlacement,
	type InviteLaunch,
} from "shared/invite";
import {
	LOBBY,
	analyticsForInviteArrival,
	analyticsForInviteSent,
	analyticsForPartyGrouped,
	type InviteArrivalOutcome,
	type LobbyRefusal,
	type PartyGroupedHow,
} from "shared/lobby";
import type { InvitePromptOptions, InvitePromptRequest } from "shared/network";
import { SlidingWindowLimiter, type AnalyticsEventSpec } from "shared/run";
import { LobbyService } from "./LobbyService";
import { OnboardingService } from "./OnboardingService";
import { TelemetryService } from "./TelemetryService";

const log = serverLogger("Invite");

const RATE_LIMITED_REASON = "too many invite prompts; try again later";
const NOT_MEMBER_REASON = "not in a lobby";
const IN_RUN_REASON = "the lobby is in a run";
const BAD_REQUEST_REASON = "request must be { withLobby: boolean }";

/** The lobby (or none: a menu invite) one `invitePrompt` was for, and when it was made (INVITE.promptRecordSeconds). */
interface PromptRecord {
	readonly lobbyId?: string;
	readonly at: number;
}

/** One GetPartyAsync in flight: the resolves waiting for it. */
interface PartyFetch {
	readonly waiters: thread[];
}

/** InviteService's per-player state; `janitor` holds the player's threads and the PartyId watches. */
interface InviteMember {
	readonly player: Player;
	readonly janitor: Janitor;
	/** Server join order (party fallback order). */
	readonly joinSeq: number;
	/** os.clock() at PlayerAdded (the joinIntent upgrade window). */
	readonly addedAt: number;
	partyId?: string;
	/** The latest decoded LaunchData (every resolve reads it). */
	launch?: InviteLaunch;
	/** A non-empty LaunchData was seen (decodable or not): no more polling. */
	launchSeen: boolean;
	/** The last `joinIntent` sent (undefined until the first resolve is done). */
	intent?: ArrivalJoinIntent;
	/** How an arrival (this player's or a party mate's) put them into a lobby. */
	placement?: ArrivalPlacement;
	/** True while the LaunchData wait is running. */
	waitingForLaunch: boolean;
	/** InviteArrival logged (at most once per join). */
	arrivalLogged: boolean;
	/** A resolve is in flight on some thread (at most one per player)... */
	resolving: boolean;
	/** ...and another was asked for meanwhile: the running one loops once more. */
	resolveAgain: boolean;
	prompt?: PromptRecord;
	/** The server-side prompt's options, kept until the prompt closes (or INVITE.promptOptionsSeconds). */
	options?: ExperienceInviteOptions;
	eligibility?: { readonly canSend: boolean; readonly at: number };
	eligibilityPending: boolean;
}

function isStudio(): boolean {
	return RunService.IsStudio();
}

/** Studio: a Player attribute, else the Workspace one (the default for every player). */
function studioAttribute(player: Player, name: string): unknown {
	const own = player.GetAttribute(name);
	return own !== undefined ? own : Workspace.GetAttribute(name);
}

/** The player's LaunchData text ("" when none): Studio's KV_FakeLaunchData, else `GetJoinData().LaunchData`. */
function launchText(player: Player): string {
	if (isStudio()) {
		const fake = studioAttribute(player, INVITE_STUDIO_ATTRIBUTES.fakeLaunchData);
		if (typeIs(fake, "string") && fake !== "") return fake;
	}
	const [ok, data] = pcall(() => player.GetJoinData());
	if (!ok || !typeIs(data, "table")) return "";
	const text = data.LaunchData;
	return typeIs(text, "string") ? text : "";
}

/** `GetJoinData().ReferredByPlayerId` (Roblox says someone invited or referred them), when positive. */
function referrerOf(player: Player): number | undefined {
	const [ok, data] = pcall(() => player.GetJoinData());
	if (!ok || !typeIs(data, "table")) return undefined;
	const id = data.ReferredByPlayerId;
	return typeIs(id, "number") && id > 0 ? id : undefined;
}

/**
 * The player's Roblox Party id, or undefined for none. Studio: KV_FakePartyId only. Live: `Player.PartyId` read in
 * pcall (the reference lists it Roblox Security; a failed read means no party).
 */
function partyIdOf(player: Player): string | undefined {
	if (isStudio()) {
		const fake = studioAttribute(player, INVITE_STUDIO_ATTRIBUTES.fakePartyId);
		return typeIs(fake, "string") && fake !== "" ? fake : undefined;
	}
	const [ok, id] = pcall(() => player.PartyId);
	return ok && typeIs(id, "string") && id !== "" ? id : undefined;
}

/**
 * Roblox friend invites and Roblox Party grouping, server side (docs/INVITES.md I4, I6, I7; docs/SERVER.md "Roblox
 * invites and parties"). The pure rules are shared/invite (`resolveArrival`, serviceRules.ts); every lobby change
 * goes through LobbyService (`platformInvites`, `applyArrival`, `partyInviteOffer`, `notify`), never `Lobbies`.
 *
 * - **Prompt** (`invitePrompt`, INVITE_PROMPT_RATE): `withLobby` needs a lobby that is not in a run; LaunchData from
 *   `encodeInviteLaunch` (`lobby` with the lobby id, or `game`), `InviteMessageId` from INVITE.notificationStringIds
 *   for this `game.GameId`. INVITE.promptSide "server": `SocialService:PromptGameInvite` here (pcall; a failure falls
 *   back to the client path); "client": `invitePromptOnClient` with the options. The prompt is remembered per player
 *   (which lobby, or none) for INVITE.promptRecordSeconds or until its recipients come.
 * - **Recipients**: `SocialService.GameInvitePromptClosed` and the client relay `inviteRecipients`
 *   (INVITE_RECIPIENTS_RATE) feed one handler: the first valid report for a live prompt record (inviteRecipientList,
 *   LOBBY.maxPlatformInvitesPerMember) consumes it; a lobby prompt whose lobby the sender is still in becomes platform
 *   invites (players already in this server are refused: they get `lobbyInvite`), a menu prompt logs one
 *   `LobbyInviteSent` (platform). A second report of the same prompt finds no record and does nothing.
 * - **Eligibility** (`inviteEligibility`, INVITE_ELIGIBILITY_RATE): one pcall'd `CanSendGameInviteAsync` per player
 *   per INVITE.eligibilityCacheSeconds -> `inviteEligible` (false on error). It also re-sends the last `joinIntent`
 *   (the client asks at startup, in case it missed the first push).
 * - **Arrival** (PlayerAdded, and players here at start): `resolveArrival` on the live invites, the LaunchData and
 *   the party mates here (accept order from one pcall'd `GetPartyAsync` per party on a thread of its own, else join
 *   order), applied through LobbyService; at most one resolve per player in flight (another request makes it loop
 *   once more). `joinIntent` after the first resolve, from the state after applying (in a lobby: how they were
 *   placed). Nothing placed them and no LaunchData yet: it is polled every INVITE.launchDataPollSeconds for
 *   INVITE.launchDataWaitSeconds (stopping once they are in a lobby) and a late one is resolved again. Whenever an
 *   arrival places a player whose last `joinIntent` was "none" within launchDataWaitSeconds +
 *   intentUpgradeMarginSeconds of their join, a fresh `joinIntent` goes out (shouldUpgradeJoinIntent). Every
 *   `joinIntent` sent also goes to OnboardingService.joinIntent (the onboarding funnel's join entry,
 *   docs/TUTORIAL_FUNNEL.md §2). Analytics: `InviteArrival` once per join, `PartyGrouped`.
 * - **Party index** (I6): PartyId per player and its changed signal. A change during the LaunchData wait (the id
 *   came late) re-resolves the arrival; any later change, or a mate joining the party while both are here, is only an
 *   offer (ID4, `partyOffers` -> party invites, `PartyGrouped` "offered").
 * - **Studio only** (INVITE_STUDIO_ATTRIBUTES): KV_FakeLaunchData / KV_FakePartyId (Player, else Workspace) stand in
 *   for LaunchData / PartyId, and a change of either Player attribute acts like a late LaunchData / a PartyId change;
 *   KV_FakeInviteEligible (Workspace boolean) forces the eligibility answer; KV_FakeInviteRecipients acts as the
 *   prompt closing with those ids.
 */
@Service({})
export class InviteService implements OnStart {
	private readonly janitor = new Janitor();
	private readonly members = new Map<Player, InviteMember>();
	private readonly promptLimiter = new SlidingWindowLimiter<Player>(
		INVITE_PROMPT_RATE.count,
		INVITE_PROMPT_RATE.windowSeconds,
	);
	private readonly recipientsLimiter = new SlidingWindowLimiter<Player>(
		INVITE_RECIPIENTS_RATE.count,
		INVITE_RECIPIENTS_RATE.windowSeconds,
	);
	private readonly eligibilityLimiter = new SlidingWindowLimiter<Player>(
		INVITE_ELIGIBILITY_RATE.count,
		INVITE_ELIGIBILITY_RATE.windowSeconds,
	);
	/** Party id -> UserIds in accept order (successful GetPartyAsync answers only; a failure is retried next time). */
	private readonly partyOrders = new Map<string, ReadonlyArray<number>>();
	/** Party id -> the GetPartyAsync in flight. */
	private readonly partyFetches = new Map<string, PartyFetch>();
	private joinSeq = 0;

	constructor(
		private readonly lobbyService: LobbyService,
		private readonly telemetry: TelemetryService,
		private readonly onboarding: OnboardingService,
	) {}

	onStart(): void {
		this.janitor.Add(
			Events.invitePrompt.connect((player, request) => {
				if (player.Parent !== undefined) this.prompt(player, request);
			}),
		);
		this.janitor.Add(
			Events.inviteRecipients.connect((player, userIds) => {
				if (player.Parent === undefined) return;
				if (!this.recipientsLimiter.tryAcquire(player, os.clock())) {
					log.info("RECIPIENTS_RATE_LIMITED", `${player.UserId}`);
					return;
				}
				this.recipients(player, userIds, "client");
			}),
		);
		this.janitor.Add(
			Events.inviteEligibility.connect((player) => {
				if (player.Parent === undefined) return;
				if (!this.eligibilityLimiter.tryAcquire(player, os.clock())) return;
				this.eligibility(player);
			}),
		);
		this.janitor.Add(Players.PlayerAdded.Connect((player) => this.playerAdded(player)));
		for (const player of Players.GetPlayers()) this.playerAdded(player);
		this.janitor.Add(Players.PlayerRemoving.Connect((player) => this.playerRemoving(player)));
		this.janitor.Add(() => {
			for (const [, m] of this.members) {
				m.janitor.Destroy();
				m.options?.Destroy();
			}
			this.members.clear();
		}, true);
		// Last, and guarded: a platform without the signal must not take the rest of the service down.
		const [okClosed, closed] = pcall(() =>
			SocialService.GameInvitePromptClosed.Connect((sender, recipientIds) => {
				const m = this.members.get(sender);
				if (m === undefined) return;
				m.options?.Destroy();
				m.options = undefined;
				this.recipients(sender, recipientIds, "server");
			}),
		);
		if (okClosed) this.janitor.Add(closed);
		else log.warn("PROMPT_CLOSED_UNAVAILABLE", tostring(closed));
	}

	// ---------------------------------------------------------------------------------------------
	// Prompt and recipients

	private prompt(player: Player, request: InvitePromptRequest): void {
		const m = this.members.get(player);
		if (m === undefined) return;
		const userId = player.UserId;
		if (!this.promptLimiter.tryAcquire(player, os.clock())) {
			return this.refuse(userId, "rateLimited", RATE_LIMITED_REASON);
		}
		if (!typeIs(request, "table") || !typeIs(request.withLobby, "boolean")) {
			return this.refuse(userId, "badRequest", BAD_REQUEST_REASON);
		}
		let launch: InviteLaunch = { kind: "game", fromUserId: userId };
		if (request.withLobby) {
			const lobby = this.lobbyService.lobbyOf(userId);
			if (lobby === undefined) return this.refuse(userId, "notMember", NOT_MEMBER_REASON);
			if (lobby.phase === "inRun") return this.refuse(userId, "inRun", IN_RUN_REASON);
			launch = { kind: "lobby", lobbyId: lobby.lobbyId, fromUserId: userId };
		}
		const [encoded, launchData] = pcall(() => encodeInviteLaunch(launch, { allowNegativeUserIds: isStudio() }));
		if (!encoded) {
			log.warn("PROMPT_ENCODE_FAILED", `${userId}: ${tostring(launchData)}`);
			return;
		}
		m.prompt = { lobbyId: launch.kind === "lobby" ? launch.lobbyId : undefined, at: os.clock() };
		const options: InvitePromptOptions = {
			launchData,
			inviteMessageId: INVITE.notificationStringIds.get(game.GameId),
		};
		log.info("PROMPT", `${userId} (${INVITE.promptSide}) LaunchData ${launchData}`);
		if (INVITE.promptSide === "client") Events.invitePromptOnClient.fire(player, options);
		else this.promptOnServer(m, options);
		if (isStudio()) {
			const fake = parseFakeRecipients(studioAttribute(player, INVITE_STUDIO_ATTRIBUTES.fakeInviteRecipients));
			if (fake !== undefined) this.recipients(player, fake, "studio");
		}
	}

	/**
	 * PromptGameInvite here, the options kept until the prompt closes (or INVITE.promptOptionsSeconds). A failure falls
	 * back to the client path with the same options, so the button works whichever side I0 says is right.
	 */
	private promptOnServer(m: InviteMember, prompt: InvitePromptOptions): void {
		const player = m.player;
		m.options?.Destroy();
		const options = new Instance("ExperienceInviteOptions");
		options.LaunchData = prompt.launchData;
		if (prompt.inviteMessageId !== undefined) options.InviteMessageId = prompt.inviteMessageId;
		m.options = options;
		task.delay(INVITE.promptOptionsSeconds, () => {
			if (m.options === options) m.options = undefined;
			options.Destroy();
		});
		// PromptGameInvite returns at once (the prompt's outcome is GameInvitePromptClosed).
		const [ok, err] = pcall(() => SocialService.PromptGameInvite(player, options));
		if (ok) return;
		log.warn("PROMPT_FAILED", `${player.UserId}: ${tostring(err)}; falling back to the client prompt`);
		if (m.options === options) m.options = undefined;
		options.Destroy();
		if (player.Parent !== undefined) Events.invitePromptOnClient.fire(player, prompt);
	}

	private refuse(userId: number, code: LobbyRefusal, reason: string): void {
		this.lobbyService.notify(userId, { kind: "refused", requestKind: "invitePrompt", code, reason });
	}

	/** The sender's prompt record, unless it is older than INVITE.promptRecordSeconds (then it is dropped). */
	private livePrompt(m: InviteMember): PromptRecord | undefined {
		const prompt = m.prompt;
		if (prompt !== undefined && os.clock() - prompt.at > INVITE.promptRecordSeconds) m.prompt = undefined;
		return m.prompt;
	}

	/** The friends picked in the sender's last prompt (see the class comment). */
	private recipients(player: Player, userIds: unknown, via: "server" | "client" | "studio"): void {
		const m = this.members.get(player);
		if (m === undefined) return;
		const prompt = this.livePrompt(m);
		if (prompt === undefined) return; // no live prompt of ours, or this one was already reported
		const ids = inviteRecipientList(userIds, LOBBY.maxPlatformInvitesPerMember);
		if (ids === undefined) {
			log.warn(
				"RECIPIENTS_BAD",
				`${player.UserId} (${via}): not a list of at most ${LOBBY.maxPlatformInvitesPerMember} UserIds`,
			);
			return;
		}
		m.prompt = undefined; // one report per prompt: a second (server signal + client relay) finds nothing
		if (ids.size() === 0) return;
		log.info("RECIPIENTS", `${player.UserId} (${via}): ${ids.size()} for ${prompt.lobbyId ?? "the game"}`);
		if (prompt.lobbyId === undefined) {
			this.track(player, analyticsForInviteSent("platform", ids.size()));
			return;
		}
		if (this.lobbyService.lobbyOf(player.UserId)?.lobbyId !== prompt.lobbyId) {
			log.info("RECIPIENTS_STALE", `${player.UserId} is no longer in lobby ${prompt.lobbyId}`);
			return;
		}
		this.lobbyService.platformInvites(player.UserId, ids);
	}

	// ---------------------------------------------------------------------------------------------
	// Eligibility

	private eligibility(player: Player): void {
		const m = this.members.get(player);
		if (m === undefined) return;
		if (m.intent !== undefined) this.sendJoinIntent(player, m.intent);
		if (isStudio()) {
			const forced = Workspace.GetAttribute(INVITE_STUDIO_ATTRIBUTES.fakeInviteEligible);
			if (typeIs(forced, "boolean")) {
				Events.inviteEligible.fire(player, { canSend: forced });
				return;
			}
		}
		const cached = m.eligibility;
		if (cached !== undefined && os.clock() - cached.at < INVITE.eligibilityCacheSeconds) {
			Events.inviteEligible.fire(player, { canSend: cached.canSend });
			return;
		}
		if (m.eligibilityPending) return; // the call in flight answers
		m.eligibilityPending = true;
		task.spawn(() => {
			const [ok, result] = pcall(() => SocialService.CanSendGameInviteAsync(player));
			m.eligibilityPending = false;
			const canSend = ok && result === true;
			if (!ok) log.warn("ELIGIBILITY_FAILED", `${player.UserId}: ${tostring(result)}`);
			m.eligibility = { canSend, at: os.clock() };
			if (player.Parent !== undefined) Events.inviteEligible.fire(player, { canSend });
		});
	}

	// ---------------------------------------------------------------------------------------------
	// Arrival

	private playerAdded(player: Player): void {
		if (this.members.has(player)) return;
		this.joinSeq += 1;
		const m: InviteMember = {
			player,
			janitor: new Janitor(),
			joinSeq: this.joinSeq,
			addedAt: os.clock(),
			partyId: partyIdOf(player),
			launchSeen: false,
			waitingForLaunch: false,
			arrivalLogged: false,
			resolving: false,
			resolveAgain: false,
			eligibilityPending: false,
		};
		this.members.set(player, m);
		if (isStudio()) {
			m.janitor.Add(
				player
					.GetAttributeChangedSignal(INVITE_STUDIO_ATTRIBUTES.fakePartyId)
					.Connect(() => this.partyChanged(m)),
			);
			m.janitor.Add(
				player
					.GetAttributeChangedSignal(INVITE_STUDIO_ATTRIBUTES.fakeLaunchData)
					.Connect(() => this.spawnFor(m, () => this.lateLaunch(m))),
			);
		} else {
			const [ok, signal] = pcall(() => player.GetPropertyChangedSignal("PartyId"));
			if (ok) m.janitor.Add(signal.Connect(() => this.partyChanged(m)));
			else log.warn("PARTY_SIGNAL_FAILED", `${player.UserId}: ${tostring(signal)}`);
		}
		this.spawnFor(m, () => this.arrive(m));
	}

	private playerRemoving(player: Player): void {
		const m = this.members.get(player);
		this.promptLimiter.forget(player);
		this.recipientsLimiter.forget(player);
		this.eligibilityLimiter.forget(player);
		if (m === undefined) return;
		this.members.delete(player);
		m.janitor.Destroy();
		m.options?.Destroy();
		const partyId = m.partyId;
		if (partyId !== undefined && !this.partyHere(partyId)) this.partyOrders.delete(partyId);
	}

	private partyHere(partyId: string): boolean {
		for (const [, other] of this.members) if (other.partyId === partyId) return true;
		return false;
	}

	private present(m: InviteMember): boolean {
		return m.player.Parent !== undefined && this.members.get(m.player) === m;
	}

	/** Runs `job` on its own thread, cancelled when the player leaves. */
	private spawnFor(m: InviteMember, job: () => void): void {
		const thread = task.spawn(job);
		m.janitor.Add(() => {
			if (coroutine.status(thread) === "suspended") task.cancel(thread);
		}, true);
	}

	private arrive(m: InviteMember): void {
		const player = m.player;
		const userId = player.UserId;
		const text = launchText(player);
		m.launchSeen = text !== "";
		m.launch = this.decode(text);
		this.resolve(m);
		if (!this.present(m)) return;
		m.intent = joinIntentNow(this.lobbyService.lobbyOf(userId) !== undefined, m.placement);
		this.sendJoinIntent(player, m.intent);
		log.info("ARRIVAL", `${userId}: joinIntent ${m.intent}`);
		if (m.launchSeen || m.intent !== "none") return this.arrivalSettled(m);

		m.waitingForLaunch = true;
		const polls = math.floor(INVITE.launchDataWaitSeconds / INVITE.launchDataPollSeconds);
		for (let i = 0; i < polls; i++) {
			task.wait(INVITE.launchDataPollSeconds);
			if (!this.present(m) || !m.waitingForLaunch) break;
			if (this.lobbyService.lobbyOf(userId) !== undefined) break; // placed meanwhile (a party arrival, ...)
			const late = launchText(player);
			if (late === "") continue;
			m.launchSeen = true;
			m.launch = this.decode(late);
			m.waitingForLaunch = false;
			this.resolve(m);
			break;
		}
		m.waitingForLaunch = false;
		if (this.present(m)) this.arrivalSettled(m);
	}

	/** The arrival window closed: `noData` when Roblox says someone referred them but no invite ever showed. */
	private arrivalSettled(m: InviteMember): void {
		if (m.arrivalLogged) return;
		const referrer = referrerOf(m.player);
		if (referrer === undefined) return;
		m.arrivalLogged = true;
		this.logArrival(m.player, "noData", "game");
	}

	/** Studio: KV_FakeLaunchData changed; resolved like a late LaunchData (toasts if the player is busy / placed). */
	private lateLaunch(m: InviteMember): void {
		if (m.intent === undefined) return; // the arrival's own resolve reads it
		m.waitingForLaunch = false;
		const text = launchText(m.player);
		m.launchSeen = text !== "";
		m.launch = this.decode(text);
		if (m.launch !== undefined) this.resolve(m);
	}

	private decode(text: string): InviteLaunch | undefined {
		if (text === "") return undefined;
		const launch = decodeInviteLaunch(text, { allowNegativeUserIds: isStudio() });
		if (launch === undefined) log.info("LAUNCH_DATA_IGNORED", `not an invite LaunchData (${text.size()} chars)`);
		return launch;
	}

	/**
	 * Resolves this player's arrival with their latest facts, at most one resolve in flight per player: a request while
	 * one runs makes it loop once more (on its thread), and returns at once. Errors are logged, never left latched.
	 */
	private resolve(m: InviteMember): void {
		if (m.resolving) {
			m.resolveAgain = true;
			return;
		}
		m.resolving = true;
		const [ok, err] = pcall(() => {
			do {
				m.resolveAgain = false;
				this.resolveOnce(m);
			} while (m.resolveAgain && this.present(m));
		});
		m.resolving = false;
		if (!ok) log.warn("RESOLVE_FAILED", `${m.player.UserId}: ${tostring(err)}`);
	}

	/**
	 * One resolve: gathers the facts (the yields first: party accept order, a `friends` lobby host's friendship), then
	 * resolves and applies without yielding, records who was placed (and upgrades their `joinIntent`), and logs the
	 * analytics.
	 */
	private resolveOnce(m: InviteMember): void {
		const player = m.player;
		const userId = player.UserId;
		const launch = m.launch;
		const mates = this.matesOf(m);
		const acceptOrder = m.partyId !== undefined && mates.size() > 0 ? this.acceptOrder(m.partyId) : undefined;
		const knownFriends: number[] = [];
		if (launch !== undefined && launch.kind === "lobby") {
			const lobby = this.lobbyService.arrivalFacts(userId).lobbyById(launch.lobbyId);
			if (lobby !== undefined && lobby.visibility === "friends" && lobby.hostId !== userId) {
				if (this.lobbyService.fetchFriendship(lobby.hostId, userId)) knownFriends.push(lobby.hostId);
			}
		}
		if (!this.present(m)) return;

		const facts = this.lobbyService.arrivalFacts(userId, knownFriends);
		const input: ArrivalInput = {
			userId,
			now: facts.now,
			launch,
			invites: facts.invitesFor(userId),
			lobbyById: facts.lobbyById,
			lobbyOfUser: facts.lobbyOfUser,
			canAccess: facts.canAccess,
			isBusy: facts.isBusy,
			party: m.partyId !== undefined ? { mates: this.matesOf(m), acceptOrder } : undefined,
		};
		const actions = resolveArrival(input);
		const result = this.lobbyService.applyArrival(userId, actions, knownFriends);
		log.info("RESOLVED", `${userId}: ${actions.map((a) => a.kind).join(", ")} -> ${result.lobbyId ?? "no lobby"}`);

		// Who is in a lobby now because of it, and their join intent.
		for (const [id, how] of arrivalPlacements(userId, actions)) {
			const target = Players.GetPlayerByUserId(id);
			const member = target !== undefined ? this.members.get(target) : undefined;
			if (member === undefined || this.lobbyService.lobbyOf(id) === undefined) continue;
			member.placement = how;
			this.upgradeIntent(member);
		}

		// InviteArrival: once per join, when a LaunchData or a platform invite was involved.
		let platformInvite = false;
		for (const inv of input.invites) if (inv.source === "platform") platformInvite = true;
		if (!m.arrivalLogged && (launch !== undefined || platformInvite)) {
			let outcome = inviteArrivalOutcome(userId, actions, result.refusal);
			// Party grouping won: what the invite alone would have done.
			if (outcome === undefined)
				outcome = inviteArrivalOutcome(userId, resolveArrival({ ...input, party: undefined }));
			if (outcome !== undefined) {
				m.arrivalLogged = true;
				this.logArrival(player, outcome, launch?.kind ?? "lobby");
			}
		}
		// PartyGrouped: the party moved the arrival into a lobby.
		for (const a of actions) {
			const how: PartyGroupedHow | undefined =
				a.kind === "partyJoin" ? "joined" : a.kind === "makePartyLobby" ? "created" : undefined;
			if (how !== undefined && result.lobbyId !== undefined) {
				this.track(player, analyticsForPartyGrouped(this.partyInLobby(m, result.lobbyId), how));
			}
		}
	}

	/** A fresh `joinIntent` when the one sent said "none" and the player was placed within the window (ID6). */
	private upgradeIntent(m: InviteMember): void {
		if (m.intent === undefined) return; // the first one is computed from the state when it goes out
		const userId = m.player.UserId;
		const current = joinIntentNow(this.lobbyService.lobbyOf(userId) !== undefined, m.placement);
		if (!shouldUpgradeJoinIntent(m.intent, current, os.clock() - m.addedAt)) return;
		m.intent = current;
		log.info("JOIN_INTENT_UPGRADED", `${userId}: ${current}`);
		this.sendJoinIntent(m.player, current);
	}

	/**
	 * Sends `joinIntent` and tells OnboardingService (the onboarding funnel's join entry, docs/TUTORIAL_FUNNEL.md §2).
	 * Never yields.
	 */
	private sendJoinIntent(player: Player, intent: ArrivalJoinIntent): void {
		Events.joinIntent.fire(player, { kind: intent });
		const [ok, err] = pcall(() => this.onboarding.joinIntent(player, intent));
		if (!ok) log.warn("ONBOARDING_INTENT_FAILED", `${player.UserId}: ${tostring(err)}`);
	}

	private logArrival(player: Player, outcome: InviteArrivalOutcome, kind: "lobby" | "game"): void {
		log.info("INVITE_ARRIVAL", `${player.UserId}: ${outcome} (${kind})`);
		this.track(player, analyticsForInviteArrival(outcome, kind));
	}

	// ---------------------------------------------------------------------------------------------
	// Party index (I6)

	/** The player's party mates in this server (never the player), in server join order. */
	private matesOf(m: InviteMember): number[] {
		const partyId = m.partyId;
		if (partyId === undefined) return [];
		const rows: InviteMember[] = [];
		for (const [, other] of this.members) {
			if (other !== m && other.partyId === partyId && other.player.Parent !== undefined) rows.push(other);
		}
		rows.sort((a, b) => a.joinSeq < b.joinSeq);
		const out: number[] = [];
		for (const row of rows) out.push(row.player.UserId);
		return out;
	}

	/** Party members (the player and their mates here) in `lobbyId`. */
	private partyInLobby(m: InviteMember, lobbyId: string): number {
		let n = 0;
		for (const id of [m.player.UserId, ...this.matesOf(m)]) {
			if (this.lobbyService.lobbyOf(id)?.lobbyId === lobbyId) n += 1;
		}
		return n;
	}

	/**
	 * YIELDS: the party's accept order, from one pcall'd GetPartyAsync per party. The call runs on a thread of its own
	 * (no player's janitor can cancel it) and always ends by dropping the in-flight entry and resuming every waiter
	 * (deferred, one after another). Undefined when it failed (then join order), and always in Studio (fake party ids).
	 */
	private acceptOrder(partyId: string): ReadonlyArray<number> | undefined {
		if (isStudio()) return undefined;
		const known = this.partyOrders.get(partyId);
		if (known !== undefined) return known;
		let fetch = this.partyFetches.get(partyId);
		if (fetch === undefined) {
			const created: PartyFetch = { waiters: [] };
			fetch = created;
			this.partyFetches.set(partyId, created);
			task.spawn(() => this.fetchPartyOrder(partyId, created));
		}
		// A fetch that finished without yielding has already dropped its entry: nothing to wait for.
		if (this.partyFetches.get(partyId) === fetch) {
			fetch.waiters.push(coroutine.running());
			coroutine.yield();
		}
		return this.partyOrders.get(partyId);
	}

	private fetchPartyOrder(partyId: string, fetch: PartyFetch): void {
		const [ok, order] = pcall(() => partyAcceptOrder(SocialService.GetPartyAsync(partyId)));
		if (ok && order !== undefined) {
			if (this.partyHere(partyId)) this.partyOrders.set(partyId, order);
		} else {
			log.warn("PARTY_ORDER_FAILED", `${partyId}: ${ok ? "unexpected entries" : tostring(order)}`);
		}
		if (this.partyFetches.get(partyId) === fetch) this.partyFetches.delete(partyId);
		for (const waiter of fetch.waiters) {
			task.defer(() => {
				if (coroutine.status(waiter) === "suspended") task.spawn(waiter);
			});
		}
	}

	/** PartyId (Studio: KV_FakePartyId) changed. */
	private partyChanged(m: InviteMember): void {
		const before = m.partyId;
		m.partyId = partyIdOf(m.player);
		if (m.partyId === before) return;
		log.info("PARTY_CHANGED", `${m.player.UserId}: ${before ?? "none"} -> ${m.partyId ?? "none"}`);
		if (m.partyId === undefined) return;
		if (m.intent === undefined) return; // the arrival's first resolve reads the new id
		if (m.waitingForLaunch && this.lobbyService.lobbyOf(m.player.UserId) === undefined) {
			// The id came late, while the arrival is still open: party grouping on arrival (ID4).
			this.spawnFor(m, () => this.resolve(m));
			return;
		}
		this.offerParty(m);
	}

	/** ID4: mid-session grouping is an offer (a party invite), never a move. */
	private offerParty(m: InviteMember): void {
		const userId = m.player.UserId;
		const facts = this.lobbyService.arrivalFacts(userId);
		for (const offer of partyOffers(userId, this.matesOf(m), facts)) {
			if (!this.lobbyService.partyInviteOffer(offer.fromUserId, offer.toUserId)) continue;
			const target = Players.GetPlayerByUserId(offer.toUserId);
			const lobby = this.lobbyService.lobbyOf(offer.fromUserId);
			if (target === undefined || lobby === undefined) continue;
			const targetMember = this.members.get(target);
			const size = targetMember !== undefined ? this.partyInLobby(targetMember, lobby.lobbyId) + 1 : 1;
			this.track(target, analyticsForPartyGrouped(size, "offered"));
		}
	}

	private track(player: Player, spec: AnalyticsEventSpec): void {
		if (player.Parent !== undefined) this.telemetry.logEvents(player, [spec]);
	}
}

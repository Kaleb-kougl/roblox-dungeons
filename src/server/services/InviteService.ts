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
	arrivalJoinIntent,
	decodeInviteLaunch,
	encodeInviteLaunch,
	inviteArrivalOutcome,
	inviteRecipientList,
	parseFakeRecipients,
	partyAcceptOrder,
	partyOffers,
	resolveArrival,
	type ArrivalAction,
	type ArrivalInput,
	type ArrivalJoinIntent,
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
import type { InvitePromptRequest } from "shared/network";
import { SlidingWindowLimiter, type AnalyticsEventSpec } from "shared/run";
import { LobbyService } from "./LobbyService";
import { TelemetryService } from "./TelemetryService";

const log = serverLogger("Invite");

const RATE_LIMITED_REASON = "too many invite prompts; try again later";
const NOT_MEMBER_REASON = "not in a lobby";
const IN_RUN_REASON = "the lobby is in a run";
const BAD_REQUEST_REASON = "request must be { withLobby: boolean }";

/** The lobby (or none: a menu invite) one `invitePrompt` was for, and the recipients already recorded for it. */
interface PromptRecord {
	readonly lobbyId?: string;
	readonly recorded: Set<number>;
}

/** InviteService's per-player state; `janitor` holds the arrival thread and the PartyId watches. */
interface InviteMember {
	readonly player: Player;
	readonly janitor: Janitor;
	/** Server join order (party fallback order). */
	readonly joinSeq: number;
	partyId?: string;
	/** Set once the first arrival resolve is done (then `joinIntent` has been sent). */
	intent?: ArrivalJoinIntent;
	/** True while the arrival may still change the placement: the LaunchData wait is running. */
	waitingForLaunch: boolean;
	/** InviteArrival logged (at most once per join). */
	arrivalLogged: boolean;
	prompt?: PromptRecord;
	/** The server-side prompt's options, kept until the prompt closes. */
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
 *   for this `game.GameId`. INVITE.promptSide "server": `SocialService:PromptGameInvite` here (pcall); "client":
 *   `invitePromptOnClient` with the options. The prompt is remembered per player (which lobby, or none).
 * - **Recipients**: `SocialService.GameInvitePromptClosed` and the client relay `inviteRecipients`
 *   (INVITE_RECIPIENTS_RATE) feed one handler: a valid list (inviteRecipientList, LOBBY.maxPlatformInvitesPerMember)
 *   for a prompt whose lobby the sender is still in becomes platform invites; a menu prompt only logs
 *   `LobbyInviteSent` (platform). Ids already recorded for that prompt are skipped, so a double report is harmless.
 * - **Eligibility** (`inviteEligibility`, INVITE_ELIGIBILITY_RATE): one pcall'd `CanSendGameInviteAsync` per player
 *   per INVITE.eligibilityCacheSeconds -> `inviteEligible` (false on error). It also re-sends `joinIntent` once the
 *   arrival is resolved (the client asks at startup, in case it missed the first push).
 * - **Arrival** (PlayerAdded, and players here at start): `resolveArrival` on the live invites, the LaunchData and
 *   the party mates here (accept order from one pcall'd `GetPartyAsync` per party, else join order), applied through
 *   LobbyService; `joinIntent` right after the first resolve. Nothing placed them and no LaunchData yet: it is polled
 *   every INVITE.launchDataPollSeconds for INVITE.launchDataWaitSeconds and a late one is resolved again (the resolver
 *   turns a move of a busy / placed player into a toast). Analytics: `InviteArrival` once per join, `PartyGrouped`.
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
	/** Party id -> threads waiting for the GetPartyAsync in flight. */
	private readonly partyFetches = new Map<string, thread[]>();
	private joinSeq = 0;

	constructor(private readonly lobbyService: LobbyService, private readonly telemetry: TelemetryService) {}

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
			SocialService.GameInvitePromptClosed.Connect((sender, recipientIds) => {
				const m = this.members.get(sender);
				if (m === undefined) return;
				m.options?.Destroy();
				m.options = undefined;
				this.recipients(sender, recipientIds, "server");
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
		m.prompt = { lobbyId: launch.kind === "lobby" ? launch.lobbyId : undefined, recorded: new Set() };
		const inviteMessageId = INVITE.notificationStringIds.get(game.GameId);
		log.info("PROMPT", `${userId} (${INVITE.promptSide}) LaunchData ${launchData}`);
		if (INVITE.promptSide === "client") {
			Events.invitePromptOnClient.fire(player, { launchData, inviteMessageId });
		} else {
			m.options?.Destroy();
			const options = new Instance("ExperienceInviteOptions");
			options.LaunchData = launchData;
			if (inviteMessageId !== undefined) options.InviteMessageId = inviteMessageId;
			m.options = options;
			// PromptGameInvite returns at once (the prompt's outcome is GameInvitePromptClosed); an error is logged.
			const [ok, err] = pcall(() => SocialService.PromptGameInvite(player, options));
			if (!ok) log.warn("PROMPT_FAILED", `${userId}: ${tostring(err)}`);
		}
		if (isStudio()) {
			const fake = parseFakeRecipients(studioAttribute(player, INVITE_STUDIO_ATTRIBUTES.fakeInviteRecipients));
			if (fake !== undefined) this.recipients(player, fake, "studio");
		}
	}

	private refuse(userId: number, code: LobbyRefusal, reason: string): void {
		this.lobbyService.notify(userId, { kind: "refused", requestKind: "invitePrompt", code, reason });
	}

	/** The friends picked in the sender's last prompt (see the class comment). */
	private recipients(player: Player, userIds: unknown, via: "server" | "client" | "studio"): void {
		const m = this.members.get(player);
		const prompt = m?.prompt;
		if (m === undefined || prompt === undefined) return; // no prompt of ours (or the player left)
		const ids = inviteRecipientList(userIds, LOBBY.maxPlatformInvitesPerMember);
		if (ids === undefined) {
			log.warn(
				"RECIPIENTS_BAD",
				`${player.UserId} (${via}): not a list of at most ${LOBBY.maxPlatformInvitesPerMember} integers`,
			);
			return;
		}
		const fresh: number[] = [];
		for (const id of ids) {
			if (!prompt.recorded.has(id)) {
				prompt.recorded.add(id);
				fresh.push(id);
			}
		}
		if (fresh.size() === 0) return;
		log.info("RECIPIENTS", `${player.UserId} (${via}): ${fresh.size()} for ${prompt.lobbyId ?? "the game"}`);
		if (prompt.lobbyId === undefined) {
			this.track(player, analyticsForInviteSent("platform", fresh.size()));
			return;
		}
		if (this.lobbyService.lobbyOf(player.UserId)?.lobbyId !== prompt.lobbyId) {
			log.info("RECIPIENTS_STALE", `${player.UserId} is no longer in lobby ${prompt.lobbyId}`);
			return;
		}
		this.lobbyService.platformInvites(player.UserId, fresh);
	}

	// ---------------------------------------------------------------------------------------------
	// Eligibility

	private eligibility(player: Player): void {
		const m = this.members.get(player);
		if (m === undefined) return;
		if (m.intent !== undefined) Events.joinIntent.fire(player, { kind: m.intent });
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
			partyId: partyIdOf(player),
			waitingForLaunch: false,
			arrivalLogged: false,
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
		if (partyId !== undefined) {
			let left = false;
			for (const [, other] of this.members) if (other.partyId === partyId) left = true;
			if (!left) this.partyOrders.delete(partyId);
		}
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
		const text = launchText(player);
		const launch = this.decode(text);
		const actions = this.resolveAndApply(m, launch);
		if (actions === undefined) return; // left meanwhile
		m.intent = arrivalJoinIntent(player.UserId, actions);
		Events.joinIntent.fire(player, { kind: m.intent });
		log.info("ARRIVAL", `${player.UserId}: ${m.intent} (${actions.map((a) => a.kind).join(", ")})`);
		if (text !== "" || m.intent !== "none") return this.arrivalSettled(m);

		m.waitingForLaunch = true;
		const polls = math.floor(INVITE.launchDataWaitSeconds / INVITE.launchDataPollSeconds);
		for (let i = 0; i < polls; i++) {
			task.wait(INVITE.launchDataPollSeconds);
			if (player.Parent === undefined || !m.waitingForLaunch) return;
			const late = launchText(player);
			if (late === "") continue;
			m.waitingForLaunch = false;
			this.resolveAndApply(m, this.decode(late));
			return this.arrivalSettled(m);
		}
		m.waitingForLaunch = false;
		this.arrivalSettled(m);
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
		const launch = this.decode(launchText(m.player));
		if (launch !== undefined) this.resolveAndApply(m, launch);
	}

	private decode(text: string): InviteLaunch | undefined {
		if (text === "") return undefined;
		const launch = decodeInviteLaunch(text, { allowNegativeUserIds: isStudio() });
		if (launch === undefined) log.info("LAUNCH_DATA_IGNORED", `not an invite LaunchData (${text.size()} chars)`);
		return launch;
	}

	/**
	 * One resolve: gathers the facts (the yields first: party accept order, a `friends` lobby host's friendship), then
	 * resolves and applies without yielding, and logs the analytics. Undefined when the player left meanwhile.
	 */
	private resolveAndApply(
		m: InviteMember,
		launch: InviteLaunch | undefined,
	): ReadonlyArray<ArrivalAction> | undefined {
		const player = m.player;
		const userId = player.UserId;
		const mates = this.matesOf(m);
		const acceptOrder = m.partyId !== undefined && mates.size() > 0 ? this.acceptOrder(m.partyId) : undefined;
		const knownFriends: number[] = [];
		if (launch !== undefined && launch.kind === "lobby") {
			const lobby = this.lobbyService.arrivalFacts(userId).lobbyById(launch.lobbyId);
			if (lobby !== undefined && lobby.visibility === "friends" && lobby.hostId !== userId) {
				if (this.lobbyService.fetchFriendship(lobby.hostId, userId)) knownFriends.push(lobby.hostId);
			}
		}
		if (player.Parent === undefined || this.members.get(player) !== m) return undefined;

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
		const result = this.lobbyService.applyArrival(userId, actions);

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
		return actions;
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
	 * YIELDS: the party's accept order, from one pcall'd GetPartyAsync per party (concurrent callers wait for the call
	 * in flight); undefined when it failed (then join order) and always in Studio (fake party ids).
	 */
	private acceptOrder(partyId: string): ReadonlyArray<number> | undefined {
		if (isStudio()) return undefined;
		const known = this.partyOrders.get(partyId);
		if (known !== undefined) return known;
		const waiting = this.partyFetches.get(partyId);
		if (waiting !== undefined) {
			waiting.push(coroutine.running());
			coroutine.yield();
			return this.partyOrders.get(partyId);
		}
		this.partyFetches.set(partyId, []);
		const [ok, entries] = pcall(() => SocialService.GetPartyAsync(partyId));
		const order = ok ? partyAcceptOrder(entries) : undefined;
		if (order !== undefined) this.partyOrders.set(partyId, order);
		else log.warn("PARTY_ORDER_FAILED", `${partyId}: ${ok ? "unexpected entries" : tostring(entries)}`);
		const waiters = this.partyFetches.get(partyId) ?? [];
		this.partyFetches.delete(partyId);
		for (const t of waiters) if (coroutine.status(t) === "suspended") task.spawn(t);
		return order;
	}

	/** PartyId (Studio: KV_FakePartyId) changed. */
	private partyChanged(m: InviteMember): void {
		const before = m.partyId;
		m.partyId = partyIdOf(m.player);
		if (m.partyId === before) return;
		log.info("PARTY_CHANGED", `${m.player.UserId}: ${before ?? "none"} -> ${m.partyId ?? "none"}`);
		if (before !== undefined && m.partyId === undefined) return;
		if (m.intent === undefined) return; // the arrival's first resolve reads the new id
		if (m.waitingForLaunch && this.lobbyService.lobbyOf(m.player.UserId) === undefined) {
			// The id came late, while the arrival is still open: party grouping on arrival (ID4).
			this.spawnFor(m, () => this.resolveAndApply(m, undefined));
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

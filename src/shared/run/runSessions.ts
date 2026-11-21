/**
 * Server-side run sessions (M3): `startRun` creates one, with a seed the SERVER picks, and every segment and the
 * final submit name its runId. Players never choose seeds, and a runId is only good for its owner.
 *
 * Per player: at most one OPEN session (a new start drops the old open one: a restart; a party run the owner left is
 * only detached, never dropped, see `start`), plus up to
 * `maxFinishingPerPlayer` sessions still validating their last segment (one more start answers `busy`). Open
 * sessions expire after `idleSeconds` without a segment or `maxAgeSeconds` in all (`sweep`).
 *
 * Seeds: every world takes `pickSeed()` (random), except the Daily (shared/daily DAILY_WORLD_KIND, docs/DAILY.md):
 * its seed is `dailySeed(dailyDay(ctx.unixNow))`, the same for every start of one UTC day (the injected `dailySeed`
 * holds the server-only secret, DSD8). The session keeps that day and the ruleset (`daily`), so a run started at
 * 23:59:59 belongs to its start day whenever it finishes (DSD5).
 *
 * Characters (docs/ARCHER.md AR5): a solo run is played as the request's `characterId` (default DEFAULT_CHARACTER), a
 * party run as the lobby's member picks in member order (`StartContext.partyCharacters`); the session's setup (what
 * every segment is replayed against) is built with them, so a run uploaded as another character fails validation.
 *
 * Upgrades (docs/SILVER.md SV6): in a world where they apply (worlds.ts upgradesApply: endless and the Daily, solo and
 * co-op) each member's Armory levels come from the wallet at the start (`StartContext.upgrades`; an unknown wallet
 * plays with none and is listed in `upgradesUnknown`), are stored on the session and returned with the start
 * (`StartRunReply.upgrades`, PartyRunStart), and the setup is built with them, so a client that builds other levels
 * fails its first segment.
 *
 * Looks (docs/COSMETICS.md CS4): each member's cosmetics, read from the wallet at the start (`StartContext.equipped`,
 * shared/cosmetics cosmeticLookOf for the character they play; an unknown wallet: the default look), are stored on the
 * session (`looks`) and returned with the start (`StartRunReply.look`, PartyRunStart.looks). Presentation only: never
 * hashed, recorded, validated or part of the setup.
 *
 * The Archer unlock (docs/SILVER.md SV17): in a world that plays characters (worlds.ts charactersApply) every member
 * must own the character they play (`StartContext.ownsCharacter`, the wallet's; the Knight always), else the start is
 * `locked_character`. An old client that sends no `characterId` plays the Knight.
 *
 * Pure and Roblox-API-free: the runId generator, the seed pickers and the clocks are injected (HttpService GUIDs,
 * Random, the secret daily seed, os.clock and os.time on the server; counters in tests). The world comes from the
 * registry (worlds.ts).
 *
 * @module
 */
import {
	DEFAULT_CHARACTER,
	NO_UPGRADES,
	isCharacterId,
	isStarterCharacter,
	readUpgradeLevels,
	type CharacterId,
	type UpgradeLevels,
} from "shared/characters";
import { cosmeticLookOf, type CosmeticLook } from "shared/cosmetics";
import { DAILY, DAILY_WORLD_KIND, dailyDay, type DailyRunKey } from "shared/daily";
import { isValidRunSeed, type RunSetup } from "./config";
import {
	DEFAULT_RUN_SESSION_LIMITS,
	DEFAULT_SEGMENT_LIMITS,
	MAX_CHARACTER_ID_CHARS,
	MAX_WORLD_KIND_CHARS,
	type RunSessionLimits,
	type SegmentLimits,
} from "./limits";
import type { RunScoreReader } from "./score";
import { SegmentedValidator, type SegmentRejectCode, type SegmentedRunResult } from "./segments";
import { errorMessage, isFiniteValue, isWireUserId, truncateReason } from "./validate";
import {
	buildWorldSetup,
	charactersApply,
	isRunWorldKind,
	isServerRunWorld,
	upgradesApply,
	type RunWorldKind,
} from "./worlds";

/** `startRun` (shared/network). */
export interface StartRunRequest {
	/** Echoed in the reply so the client matches it to its request. */
	requestId: number;
	/** A registered world kind (worlds.ts). */
	worldKind: string;
	/** Other party members' UserIds (co-op; omit or empty for solo). Each must be in this server. */
	party?: number[];
	/** Debug start at the boss door (refused unless the limits allow it). */
	atBossDoor?: boolean;
	/**
	 * The character the owner plays (shared/characters CharacterId; docs/ARCHER.md AR5). Optional: absent is
	 * DEFAULT_CHARACTER; an unknown id is `bad_request`. Solo runs only: a party run is played as the lobby's picks
	 * (StartContext.partyCharacters). Stored with leaderboard entries (`classId`).
	 */
	characterId?: string;
}

/**
 * Why a `startRun` was refused (`StartRunReply.code`): a malformed request, a world that is not registered or is played
 * only locally, a boss door start, a bad party or character list, too many of the player's runs still validating
 * (`busy`), a world that could not be built or a seed that could not be picked (`config_error`), the start rate limit,
 * or a character a member does not own.
 */
export type StartRunRejectCode =
	| "bad_request"
	| "unknown_world"
	| "debug_spawn"
	| "bad_party"
	| "busy"
	| "config_error"
	| "rate_limited"
	/** docs/SILVER.md SV17: a member would play a character they do not own (StartContext.ownsCharacter). */
	| "locked_character";

/** `runStarted` (shared/network): the server's answer to `startRun`. */
export interface StartRunReply {
	requestId: number;
	ok: boolean;
	runId?: string;
	seed?: number;
	worldKind?: string;
	atBossDoor?: boolean;
	/** Party members (owner first). */
	members?: number[];
	/** Daily runs (world "daily"): the day (shared/daily dailyDay) and ruleset the run belongs to (DSD5 / DSD11). */
	daily?: DailyRunKey;
	/**
	 * The owner's character the session was built with (RunSession.characters[0]); the client builds its run with it.
	 * Absent for a world without characters (M1's `game`).
	 */
	characterId?: CharacterId;
	/**
	 * docs/SILVER.md SV6: the owner's upgrade levels the session was built with (RunSession.upgrades[0]); the client
	 * builds its run with them (WorldBuildOptions.upgrades). Absent for a world without upgrades (upgradesApply false).
	 */
	upgrades?: UpgradeLevels;
	/**
	 * docs/SILVER.md SV6: true when the owner's wallet was unknown at the start (not loaded this session): the run plays
	 * with no upgrades (`upgrades` is NO_UPGRADES). Absent otherwise.
	 */
	upgradesUnknown?: boolean;
	/**
	 * docs/COSMETICS.md CS4: the owner's look the session stored (RunSession.looks[0]): the cosmetics they wear for the
	 * character they play. Presentation only. Absent on a refused start.
	 */
	look?: CosmeticLook;
	code?: StartRunRejectCode;
	reason?: string;
}

/**
 * One run the server started: its id, the seed the server picked, the world, the owner and members, and what the run is
 * validated with (characters, upgrades, the built setup and its segmented validator). Server only; created by
 * `RunSessions.start` and looked up by run id for every segment and the final submit. The client only ever sees the
 * parts echoed in `StartRunReply`.
 */
export interface RunSession {
	readonly runId: string;
	readonly seed: number;
	readonly worldKind: RunWorldKind;
	readonly ownerId: number;
	/** Owner first; size 1 = solo. */
	readonly members: ReadonlyArray<number>;
	/**
	 * docs/ARCHER.md AR5: each member's character, in member order (setup.characters: defaults filled in), what the
	 * run is validated with. Undefined for a world that plays without characters (M1's `game`): every player carries
	 * both weapons there. A member who leaves keeps their slot and character.
	 */
	readonly characters: ReadonlyArray<CharacterId> | undefined;
	/**
	 * docs/SILVER.md SV6: each member's Armory upgrade levels, in member order, what the run is validated with (read at
	 * the start; a purchase applies from the next run, SVD9). Undefined for a world without upgrades (upgradesApply).
	 */
	readonly upgrades: ReadonlyArray<UpgradeLevels> | undefined;
	/** Members whose wallet was unknown at the start (they play with NO_UPGRADES), in member order. */
	readonly upgradesUnknown: ReadonlyArray<number>;
	/**
	 * docs/COSMETICS.md CS4: each member's look, in member order (sessionLooks: read at the start, a later equip shows
	 * from the next run). Presentation only: never hashed, recorded, validated or part of `setup`.
	 */
	readonly looks: ReadonlyArray<CosmeticLook>;
	readonly atBossDoor: boolean;
	/** Debug limits were in force (debug input or boss door allowed): never posts to a leaderboard. */
	readonly debug: boolean;
	/**
	 * Daily runs only (world "daily"): the UTC day the run started on and the ruleset in force (shared/daily
	 * DailyRunKey). The run's board is that day's even if it finishes after midnight (DSD5). Undefined otherwise.
	 */
	readonly daily: DailyRunKey | undefined;
	/** Session start (the registry's clock, seconds). */
	readonly createdAt: number;
	/** Last segment (or the start). */
	lastActivity: number;
	readonly setup: RunSetup;
	readonly validator: SegmentedValidator;
	/**
	 * Party runs: members no longer in the run (left the server, dropped as stalled). They are free to start or join
	 * another run although this one is still being played (`busyReason`).
	 */
	readonly released: Set<number>;
}

/** What the caller knows about the start that the registry cannot (who is in the server, what is allowed). */
export interface StartContext {
	/** The registry's clock (seconds; os.clock on the server): activity, expiry, the segment clock. */
	readonly now: number;
	/** Wall clock, unix seconds UTC (os.time / DateTime on the server): the Daily's day (shared/daily dailyDay). */
	readonly unixNow: number;
	/** The UserId is a player in this server. */
	readonly isInServer: (userId: number) => boolean;
	readonly allowBossDoorSpawn: boolean;
	/** Debug input allowed for this run (Studio tooling): also marks the session `debug`. */
	readonly allowDebugInput: boolean;
	/**
	 * Co-op consent: the members (owner first) of a lobby whose host pressed Start (shared/lobby). A start
	 * whose party has 2+ members is refused unless its resolved party is exactly this list: a client's `startRun` can
	 * never name a party on its own.
	 */
	readonly partyConsent?: ReadonlyArray<number>;
	/**
	 * docs/ARCHER.md AR5: a lobby party start's member picks, in member order (the lobby's `characters`): the party
	 * run's characters (the request's `characterId` is ignored for a party). Absent: every member DEFAULT_CHARACTER but
	 * the owner, who plays the request's. Each entry must be a character id (else `bad_party`).
	 */
	readonly partyCharacters?: ReadonlyArray<string>;
	/**
	 * docs/SILVER.md SV6: a member's Armory upgrade levels (the server's wallet: SilverAccess.upgradesFor), or undefined
	 * when their wallet is unknown this session (they play with none; the start says so). Read only for a world where
	 * upgrades apply. An answer that is not a valid UpgradeLevels counts as unknown. Absent: nobody has upgrades.
	 */
	readonly upgrades?: (userId: number) => UpgradeLevels | undefined;
	/**
	 * docs/SILVER.md SV17: whether a member owns a character (the server's wallet: SilverAccess.ownsCharacter; an
	 * unknown wallet owns the Knight only). Checked for every member of a world that plays characters
	 * (charactersApply), solo and party: a member playing a character they do not own refuses the start with
	 * `locked_character`. The starter characters (shared/characters STARTER_CHARACTERS) are never asked. Absent:
	 * every character is owned (tests, tools).
	 */
	readonly ownsCharacter?: (userId: number, characterId: CharacterId) => boolean;
	/**
	 * docs/COSMETICS.md CS4: a member's equipped cosmetics (slot -> item id; the server's wallet:
	 * SilverAccess.equippedFor), or undefined when their wallet is unknown (the default look). Absent: nobody wears
	 * anything.
	 */
	readonly equipped?: (userId: number) => ReadonlyMap<string, string> | undefined;
}

/**
 * What `RunSessions.start` returns: the new session, with the open session it replaced when the start was a restart
 * (undefined otherwise, and for a party run that was only detached), or the reject code and a human-readable reason.
 */
export type StartRunResult =
	| { readonly ok: true; readonly session: RunSession; readonly replaced: RunSession | undefined }
	| { readonly ok: false; readonly code: StartRunRejectCode; readonly reason: string };

/**
 * What the server injects into `RunSessions`, so the registry stays pure and headless specs can drive it: the run id
 * and seed sources, the Daily's secret seed, and optional limits and score reader (the live defaults when absent).
 */
export interface RunSessionDeps {
	readonly newRunId: () => string;
	/** A seed in [0, 2^32): every world's seed except the Daily's. */
	readonly pickSeed: () => number;
	/**
	 * The Daily's seed of day `day` (shared/daily dailyDay): the server passes its secret one (src/server/config
	 * daily.ts dailySeed). Absent: a daily start answers `config_error`.
	 */
	readonly dailySeed?: (day: number) => number;
	readonly limits?: RunSessionLimits;
	readonly segmentLimits?: SegmentLimits;
	readonly readScore?: RunScoreReader;
}

/** A party member's UserId: the lobby's wire rule (Studio's negative test players allowed). */
function isUserId(v: unknown): v is number {
	return isWireUserId(v);
}

/**
 * The party for a start: the owner first, then the requested members (deduplicated, owner skipped). Every member
 * must be a player in this server and the party at most `maxParty`. Returns the members or a reason.
 */
export function resolveParty(
	ownerId: number,
	requested: ReadonlyArray<number> | undefined,
	isInServer: (userId: number) => boolean,
	maxParty: number,
): ReadonlyArray<number> | string {
	const members = [ownerId];
	if (requested === undefined) return members;
	if (!typeIs(requested, "table")) return "party must be an array";
	const list = requested as ReadonlyArray<unknown>;
	if (list.size() > maxParty) return `party over ${maxParty} players`;
	for (let i = 0; i < list.size(); i++) {
		const id = list[i];
		if (!isUserId(id)) return `party member ${i} is not a UserId`;
		if (id === ownerId || members.includes(id)) continue;
		if (!isInServer(id)) return `party member ${id} is not in this server`;
		members.push(id);
	}
	if (members.size() > maxParty) return `party over ${maxParty} players`;
	return members;
}

/** The run's party is exactly the invite's members, in order (what RunSessionRegistry.start checks). */
export function sameParty(a: ReadonlyArray<number>, b: ReadonlyArray<number>): boolean {
	if (a.size() !== b.size()) return false;
	for (let i = 0; i < a.size(); i++) if (a[i] !== b[i]) return false;
	return true;
}

function requestShape(r: StartRunRequest): string | undefined {
	if (!typeIs(r, "table")) return "request is not an object";
	if (!isFiniteValue(r.requestId)) return "requestId must be a number";
	if (!typeIs(r.worldKind, "string") || r.worldKind.size() === 0 || r.worldKind.size() > MAX_WORLD_KIND_CHARS) {
		return "worldKind must be a short string";
	}
	if (r.atBossDoor !== undefined && !typeIs(r.atBossDoor, "boolean")) return "atBossDoor must be a boolean";
	const c = r.characterId;
	if (c !== undefined && (!typeIs(c, "string") || c.size() > MAX_CHARACTER_ID_CHARS)) {
		return "characterId must be a short string";
	}
	if (c !== undefined && !isCharacterId(c)) return `unknown character ${c}`;
	return undefined;
}

/**
 * The run's characters, one per member (docs/ARCHER.md AR5): solo the request's (default DEFAULT_CHARACTER); a party
 * the lobby's picks (`partyCharacters`, each checked; missing entries DEFAULT_CHARACTER), or without them the owner's
 * request and DEFAULT_CHARACTER for the others. A message when a pick is not a character id.
 */
export function sessionCharacters(
	request: Readonly<StartRunRequest>,
	partySize: number,
	partyCharacters: ReadonlyArray<string> | undefined,
): CharacterId[] | string {
	const owner =
		request.characterId !== undefined && isCharacterId(request.characterId)
			? request.characterId
			: DEFAULT_CHARACTER;
	const out: CharacterId[] = [];
	for (let i = 0; i < partySize; i++) {
		if (partySize > 1 && partyCharacters !== undefined) {
			const c = partyCharacters[i];
			if (c !== undefined && !isCharacterId(c)) return `unknown character for party member ${i}`;
			out.push(c ?? DEFAULT_CHARACTER);
		} else {
			out.push(i === 0 ? owner : DEFAULT_CHARACTER);
		}
	}
	return out;
}

/**
 * Each member's look for a start (docs/COSMETICS.md CS4), in member order: cosmeticLookOf(lookup(id), their character)
 * (`characters[i]`, DEFAULT_CHARACTER for a world without characters, whose players draw as the Knight). No lookup, or an
 * unknown wallet: the default look. Never refuses a start.
 */
export function sessionLooks(
	members: ReadonlyArray<number>,
	characters: ReadonlyArray<CharacterId> | undefined,
	lookup: ((userId: number) => ReadonlyMap<string, string> | undefined) | undefined,
): CosmeticLook[] {
	const out: CosmeticLook[] = [];
	for (let i = 0; i < members.size(); i++) {
		const character = characters?.[i] ?? DEFAULT_CHARACTER;
		out.push(lookup !== undefined ? cosmeticLookOf(lookup(members[i]), character) : {});
	}
	return out;
}

/**
 * Each member's upgrade levels for a start (docs/SILVER.md SV6), in member order: `lookup(id)` checked with
 * readUpgradeLevels, NO_UPGRADES for a member whose answer is undefined or invalid (listed in `unknown`). Without a
 * lookup every member has NO_UPGRADES and none is unknown.
 */
export function sessionUpgrades(
	members: ReadonlyArray<number>,
	lookup: ((userId: number) => UpgradeLevels | undefined) | undefined,
): { readonly levels: UpgradeLevels[]; readonly unknown: number[] } {
	const levels: UpgradeLevels[] = [];
	const unknown: number[] = [];
	for (const id of members) {
		if (lookup === undefined) {
			levels.push(NO_UPGRADES);
			continue;
		}
		const levelsOf = readUpgradeLevels(lookup(id));
		if (levelsOf === undefined) unknown.push(id);
		levels.push(levelsOf ?? NO_UPGRADES);
	}
	return { levels, unknown };
}

/**
 * docs/SILVER.md SV17: the first member (member order) who would play a character they do not own, as a refusal
 * reason, or undefined when every member owns their pick. Starter characters always pass; without a predicate every
 * character does.
 */
export function lockedCharacterReason(
	members: ReadonlyArray<number>,
	characters: ReadonlyArray<CharacterId>,
	ownsCharacter: ((userId: number, characterId: CharacterId) => boolean) | undefined,
): string | undefined {
	if (ownsCharacter === undefined) return undefined;
	for (let i = 0; i < members.size(); i++) {
		const c = characters[i] ?? DEFAULT_CHARACTER;
		if (isStarterCharacter(c)) continue;
		if (ownsCharacter(members[i], c) !== true) return `player ${members[i]} has not unlocked ${c}`;
	}
	return undefined;
}

/** A party run (2+ members) still being played or decided: never replaced by its owner's new start. */
function isUnconcludedParty(s: RunSession): boolean {
	if (s.members.size() < 2) return false;
	const status = s.validator.getStatus();
	return status === "open" || status === "finishing";
}

/** All run sessions of one server (see the file comment). */
export class RunSessionRegistry {
	private readonly byId = new Map<string, RunSession>();
	/** Each player's open session. */
	private readonly openByOwner = new Map<number, RunSession>();
	private readonly limits: RunSessionLimits;
	private readonly segmentLimits: SegmentLimits;

	constructor(private readonly deps: RunSessionDeps) {
		this.limits = deps.limits ?? DEFAULT_RUN_SESSION_LIMITS;
		this.segmentLimits = deps.segmentLimits ?? DEFAULT_SEGMENT_LIMITS;
	}

	/**
	 * Creates a session for `ownerId`: request shape, world kind (registered, not SERVER_REFUSED_WORLDS), debug
	 * spawn, party, `busy`, then the world (built from a server-picked seed). Replaces (and returns) the owner's open
	 * solo session, which is aborted as `abandoned`; an unconcluded party run the owner was released from is detached
	 * instead (not returned).
	 */
	start(ownerId: number, request: StartRunRequest, ctx: StartContext): StartRunResult {
		const shape = requestShape(request);
		if (shape !== undefined) return { ok: false, code: "bad_request", reason: `bad request: ${shape}` };
		if (!isRunWorldKind(request.worldKind)) {
			return { ok: false, code: "unknown_world", reason: `unknown world kind ${request.worldKind}` };
		}
		if (!isServerRunWorld(request.worldKind)) {
			return { ok: false, code: "unknown_world", reason: `world ${request.worldKind} is played locally only` };
		}
		const atBossDoor = request.atBossDoor === true;
		if (atBossDoor && !ctx.allowBossDoorSpawn) {
			return { ok: false, code: "debug_spawn", reason: "debug spawn: runs from the boss door are not accepted" };
		}
		const party = resolveParty(ownerId, request.party, ctx.isInServer, this.limits.maxPartySize);
		if (typeIs(party, "string")) return { ok: false, code: "bad_party", reason: `bad party: ${party}` };
		if (party.size() > 1 && (ctx.partyConsent === undefined || !sameParty(ctx.partyConsent, party))) {
			return {
				ok: false,
				code: "bad_party",
				reason: "bad party: a party run starts only from an invite every member accepted",
			};
		}
		// Nobody may be in an unconcluded party run (the owner's own included: a restart while the party's verdict is
		// still being decided would leave its lockstep session without a run).
		for (const id of party) {
			const busy = this.busyReason(id);
			if (busy !== undefined) return { ok: false, code: "busy", reason: busy };
		}
		if (this.finishingCount(ownerId) >= this.limits.maxFinishingPerPlayer) {
			return { ok: false, code: "busy", reason: "previous runs are still being checked" };
		}
		const characters = sessionCharacters(request, party.size(), ctx.partyCharacters);
		if (typeIs(characters, "string")) return { ok: false, code: "bad_party", reason: `bad party: ${characters}` };
		// docs/SILVER.md SV17: every member owns the character they would play (a party start re-checks the lobby's
		// picks here too: a wallet can turn unknown between the Ready and the start).
		if (charactersApply(request.worldKind)) {
			const locked = lockedCharacterReason(party, characters, ctx.ownsCharacter);
			if (locked !== undefined) return { ok: false, code: "locked_character", reason: `locked: ${locked}` };
		}
		// docs/SILVER.md SV6: the members' upgrade levels, read now (a purchase applies from the next run).
		const upgrades = upgradesApply(request.worldKind) ? sessionUpgrades(party, ctx.upgrades) : undefined;

		const picked = this.pickSeed(request.worldKind, ctx.unixNow);
		if (typeIs(picked, "string")) return { ok: false, code: "config_error", reason: `config error: ${picked}` };
		const { seed, daily } = picked;
		if (!isValidRunSeed(seed)) return { ok: false, code: "config_error", reason: "config error: bad seed picked" };
		// Co-op (M4): the world is built for the whole party (enemy hp / room budgets scale with its size), each player
		// with their character's loadout and roll (docs/ARCHER.md AR5; worlds without characters ignore them).
		const [built, setupOrErr] = pcall(() =>
			buildWorldSetup(request.worldKind, seed, {
				atBossDoor,
				partySize: party.size(),
				characters,
				upgrades: upgrades?.levels,
			}),
		);
		if (!built) {
			return {
				ok: false,
				code: "config_error",
				reason: truncateReason(`config error: ${errorMessage(setupOrErr)}`),
			};
		}
		const setup = setupOrErr as RunSetup;
		const runId = this.deps.newRunId();
		const segmentLimits: SegmentLimits = ctx.allowDebugInput
			? { ...this.segmentLimits, allowDebugInput: true }
			: this.segmentLimits;
		const session: RunSession = {
			runId,
			seed,
			worldKind: request.worldKind,
			ownerId,
			members: party,
			characters: setup.characters,
			upgrades: upgrades?.levels,
			upgradesUnknown: upgrades?.unknown ?? [],
			// docs/COSMETICS.md CS4: what each member wears, for the character the setup gives them.
			looks: sessionLooks(party, setup.characters, ctx.equipped),
			atBossDoor,
			debug: ctx.allowDebugInput || atBossDoor,
			daily,
			createdAt: ctx.now,
			lastActivity: ctx.now,
			setup,
			released: new Set(),
			validator: new SegmentedValidator({
				runId,
				seed,
				worldKind: request.worldKind,
				setup,
				createdAt: ctx.now,
				limits: segmentLimits,
				readScore: this.deps.readScore,
			}),
		};
		// The owner's open session: a solo one is replaced (a restart, aborted as `abandoned`). A party run still being
		// played or decided is never replaced: its owner can only get here released from it (left it, or stalled; else
		// `busy` above), and the others play on. It is only detached (no longer the owner's open session); its
		// lockstep session concludes it.
		const previous = this.openByOwner.get(ownerId);
		const replaced = previous !== undefined && !isUnconcludedParty(previous) ? previous : undefined;
		if (replaced !== undefined) this.close(replaced, "abandoned", "a new run started");
		this.byId.set(runId, session);
		this.openByOwner.set(ownerId, session);
		return { ok: true, session, replaced };
	}

	/**
	 * The run seed of a start in `worldKind` at wall time `unixNow`: the Daily's seed of that UTC day (with the day and
	 * ruleset), else `pickSeed()`. A message when the Daily has no seed source.
	 */
	private pickSeed(
		worldKind: RunWorldKind,
		unixNow: number,
	): { readonly seed: number; readonly daily: DailyRunKey | undefined } | string {
		if (worldKind !== DAILY_WORLD_KIND) return { seed: this.deps.pickSeed(), daily: undefined };
		const dailySeed = this.deps.dailySeed;
		if (dailySeed === undefined) return "no daily seed on this server";
		if (!isFiniteValue(unixNow)) return "no wall clock for the daily day";
		const day = dailyDay(unixNow);
		return { seed: dailySeed(day), daily: { day, ruleset: DAILY.ruleset } };
	}

	/** The session `runId` if `ownerId` owns it. */
	get(runId: string, ownerId: number): RunSession | undefined {
		const s = typeIs(runId, "string") ? this.byId.get(runId) : undefined;
		return s !== undefined && s.ownerId === ownerId ? s : undefined;
	}

	/** The owner's open session, if any. */
	openSession(ownerId: number): RunSession | undefined {
		return this.openByOwner.get(ownerId);
	}

	/**
	 * Why `userId` cannot start or join a run now: they are a member (not released) of a party run that is still
	 * being played or decided (its validator has not accepted / rejected it yet). Undefined when free. A solo open
	 * session is not "busy": a new start replaces it (a restart).
	 */
	busyReason(userId: number): string | undefined {
		for (const [, s] of this.byId) {
			if (s.members.size() < 2 || !s.members.includes(userId) || s.released.has(userId)) continue;
			const status = s.validator.getStatus();
			if (status === "open" || status === "finishing") {
				return `player ${userId} is in party run ${s.runId} (not concluded yet)`;
			}
		}
		return undefined;
	}

	/** A party member is out of the run (left / stalled): busyReason no longer counts them. */
	releaseMember(session: RunSession, userId: number): void {
		if (session.members.includes(userId)) session.released.add(userId);
	}

	/** The player left the server: released from every party run they are in. */
	releaseFromParties(userId: number): void {
		for (const [, s] of this.byId) if (s.members.size() > 1) this.releaseMember(s, userId);
	}

	/**
	 * The owner's sessions that finished and are still validating. A party run its owner was released from (left)
	 * does not count: they are out of it, as free as the other leavers.
	 */
	finishingCount(ownerId: number): number {
		let n = 0;
		for (const [, s] of this.byId) {
			if (s.ownerId !== ownerId || s.released.has(ownerId)) continue;
			if (s.validator.getStatus() === "finishing") n++;
		}
		return n;
	}

	/** Records activity (a segment arrived). */
	touch(session: RunSession, now: number): void {
		session.lastActivity = now;
	}

	/** The session's final arrived: it is no longer the owner's open session (a new start will not replace it). */
	markFinishing(session: RunSession): void {
		if (this.openByOwner.get(session.ownerId) === session) this.openByOwner.delete(session.ownerId);
	}

	/** Forgets a decided session. */
	remove(session: RunSession): void {
		this.byId.delete(session.runId);
		if (this.openByOwner.get(session.ownerId) === session) this.openByOwner.delete(session.ownerId);
	}

	/** Aborts (if undecided) and forgets a session. */
	close(session: RunSession, code: SegmentRejectCode, reason: string): SegmentedRunResult {
		const result = session.validator.abort(code, reason);
		this.remove(session);
		return result;
	}

	/** Expires open sessions idle or too old at `now`; returns them with their (expired) results. */
	sweep(now: number): Array<{ session: RunSession; result: SegmentedRunResult }> {
		const out: Array<{ session: RunSession; result: SegmentedRunResult }> = [];
		const expired: RunSession[] = [];
		for (const [, s] of this.byId) {
			if (s.validator.getStatus() !== "open") continue;
			if (now - s.lastActivity > this.limits.idleSeconds || now - s.createdAt > this.limits.maxAgeSeconds) {
				expired.push(s);
			}
		}
		for (const s of expired) {
			const idle = now - s.lastActivity > this.limits.idleSeconds;
			out.push({
				session: s,
				result: this.close(s, "expired", idle ? "expired: no segment for too long" : "expired: run too old"),
			});
		}
		return out;
	}

	/** The owner left: their open session is dropped (`abandoned`); finishing ones keep validating. */
	dropOpen(ownerId: number): RunSession | undefined {
		const s = this.openByOwner.get(ownerId);
		if (s !== undefined) this.close(s, "abandoned", "player left");
		return s;
	}

	/** Sessions tracked (open + finishing). */
	size(): number {
		return this.byId.size();
	}
}

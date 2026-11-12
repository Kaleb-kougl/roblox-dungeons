import { OnStart, Service } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { Players, RunService, Workspace } from "@rbxts/services";
import { serverLogger } from "server/log";
import { Events } from "server/network";
import {
	CODEX,
	CODEX_CODEC,
	CODEX_FAKE_ATTRIBUTE,
	CODEX_RETRY,
	codexClaimUpdate,
	codexDay,
	codexStatusOf,
	codexViewedUpdate,
	codexWritesAllowed,
	mergeStoredCodex,
	parseFakeCodex,
	seedCodexDoc,
	type CodexDoc,
	type CodexStatus,
	type CodexUpdate,
	type FakeCodex,
} from "shared/codex";
import { seenOf } from "shared/onboarding";
import { SlidingWindowLimiter } from "shared/run";
import { PlayerDocCache, playerDataKey, type KeyValueStore } from "shared/settings";
import { MergeKeyValue } from "./data/MergeKeyValue";
import { OnboardingService } from "./OnboardingService";

const log = serverLogger("Codex");

/** A player's Studio fake Codex (KV_FakeCodex) for this session; claims and views apply to `doc`. */
interface FakeEntry {
	readonly source: string;
	readonly loaded: boolean;
	doc: CodexDoc;
}

/**
 * The Codex, server side (claude/codex-plan.md "Codex data (server)", docs/SERVER.md "Codex"): each player's catalog
 * of seen / found entries and NEW dots. Every rule is pure in shared/codex (doc.ts, status.ts); this service only loads,
 * gates, stores and sends.
 *
 * Persistence is RecordsService's pattern on DataStore CODEX.dataStore (`KV_Codex_v1`, key playerDataKey): loaded on
 * join (CODEX_RETRY) into a PlayerDocCache, `codexStatus` sent once the join load and the one-time seed ended (`ready`),
 * saved when dirty every CODEX.autosaveSeconds, on leave and on BindToClose (plus once right after a seed). Every write
 * is a MERGE inside UpdateAsync (MergeKeyValue + mergeStoredCodex: tiers only rise, the earliest found day wins), so two
 * servers (a teleport, a rejoin) never lose an entry. A FAILED join load sends `{ loaded: false }` for the session, never
 * touches the cache entry (nothing is ever saved from it) and ignores claims and views.
 *
 * Remotes (shapes guarded by Flamework, values re-checked in shared/codex): `codexClaim(items)` -> codexClaimUpdate
 * (decodeCodexClaims, applyClaims on the server's codexDay(os.time()), rises marked unread), `codexViewed(ids)` ->
 * codexViewedUpdate (decodeCodexViewed, markViewed); both change only the session cache (written by the next save) and
 * are ignored before `ready` (logged once per player); `requestCodex` answers with `codexStatus` once ready (an earlier
 * one is answered by the join-end push, so the client never sees a pre-seed status). Each remote has its own per-player
 * limiter at CODEX.claimRate; a call over it is dropped unanswered. Drop warnings (over the rate, a bad payload) are
 * throttled to CODEX.warnRate per player.
 *
 * Rejoin to the same server while the last session's leave save is writing (PlayerDocCache would hand the new join the
 * cached entry that the release then deletes): the service tracks each UserId's release in flight and the new join
 * load waits for it (at most CODEX.rejoinWaitSeconds), so it reads the stored doc fresh. Each cache entry has one owning
 * Player (the session that loaded it); only the owner's leave releases it. Should the wait time out, the release, once
 * done, starts a fresh load for the newer session.
 *
 * Seed (CXD5, R13): once, after a successful load of a doc without `seeded`: waits (at most CODEX.seedWaitSeconds) for
 * OnboardingService's join load; when it finished OK its cached doc's `seen` list becomes seen entries without NEW dots
 * (seedCodexDoc) and the doc is marked `seeded`. An onboarding load that failed or did not end in time leaves the
 * marker unset (retried on the next join); the Codex works meanwhile. No extra DataStore read.
 *
 * Studio: writes are no-ops unless codexWritesAllowed (CODEX.writeFromStudio); claims still update the session cache.
 * Workspace attribute CODEX_FAKE_ATTRIBUTE (`KV_FakeCodex`, parseFakeCodex; Studio only) replaces the loaded doc for
 * the session: claims and views apply to the fake, nothing is written and no seed runs; changing the attribute resets
 * the fake at the next send or claim. A player who left while the join load or the seed yielded is dropped.
 */
@Service({})
export class CodexService implements OnStart {
	private readonly janitor = new Janitor();
	private readonly cache: PlayerDocCache<CodexDoc>;
	private readonly requestLimiter = new SlidingWindowLimiter<Player>(
		CODEX.claimRate.count,
		CODEX.claimRate.windowSeconds,
	);
	private readonly claimLimiter = new SlidingWindowLimiter<Player>(
		CODEX.claimRate.count,
		CODEX.claimRate.windowSeconds,
	);
	private readonly viewedLimiter = new SlidingWindowLimiter<Player>(
		CODEX.claimRate.count,
		CODEX.claimRate.windowSeconds,
	);
	/** One drop warning per player per CODEX.warnRate window. */
	private readonly warnLimiter = new SlidingWindowLimiter<Player>(CODEX.warnRate.count, CODEX.warnRate.windowSeconds);
	/** Players whose `notReady` refusal was logged (once per player). */
	private readonly notReadyLogged = new Set<Player>();
	/** UserIds whose cache entry is being released (the leave save is writing): a rejoin's load waits for it. */
	private readonly releasing = new Set<number>();
	/** The Player whose session owns each UserId's cache entry (set before its join load). */
	private readonly owners = new Map<number, Player>();
	private readonly fakes = new Map<Player, FakeEntry>();
	/** Players whose join load and seed have finished: only they are sent `codexStatus` and may change their doc. */
	private readonly ready = new Set<Player>();
	private closing = false;

	constructor(private readonly onboarding: OnboardingService) {
		this.cache = new PlayerDocCache(
			this.createStore(),
			CODEX_CODEC,
			CODEX_RETRY,
			(s) => task.wait(s),
			(waiter) => task.spawn(waiter),
		);
	}

	onStart(): void {
		this.janitor.Add(Players.PlayerAdded.Connect((player) => this.loadAndSend(player)));
		for (const player of Players.GetPlayers()) task.spawn(() => this.loadAndSend(player));
		this.janitor.Add(Players.PlayerRemoving.Connect((player) => this.release(player)));

		this.janitor.Add(
			Events.requestCodex.connect((player) => {
				if (player.Parent === undefined) return;
				if (!this.requestLimiter.tryAcquire(player, this.now())) {
					this.warnDropped(player, "RATE_LIMITED", "requestCodex dropped");
					return;
				}
				// Before the join load and seed end, the join-end push answers instead (send skips players not ready).
				this.send(player);
			}),
		);
		this.janitor.Add(
			Events.codexClaim.connect((player, items) => {
				if (player.Parent === undefined) return;
				const within = this.claimLimiter.tryAcquire(player, this.now());
				this.apply(player, "codexClaim", codexClaimUpdate(this.target(player), items, this.day(), within));
			}),
		);
		this.janitor.Add(
			Events.codexViewed.connect((player, ids) => {
				if (player.Parent === undefined) return;
				const within = this.viewedLimiter.tryAcquire(player, this.now());
				this.apply(player, "codexViewed", codexViewedUpdate(this.target(player), ids, within));
			}),
		);

		const autosave = task.spawn(() => {
			for (;;) {
				task.wait(CODEX.autosaveSeconds);
				if (this.closing) return;
				for (const key of this.cache.keys()) if (this.cache.isDirty(key)) this.saveKey(key);
			}
		});
		this.janitor.Add(() => task.cancel(autosave));
		game.BindToClose(() => this.saveAllOnClose());
	}

	/** This player's cached Codex doc, or undefined before it is loaded (or after a failed load). Never yields. */
	getDoc(player: Player): Readonly<CodexDoc> | undefined {
		const key = playerDataKey(player.UserId);
		return this.cache.loadFailed(key) ? undefined : this.cache.get(key);
	}

	/** The store (a seam: a test or tool can subclass the service with an in-memory KeyValueStore). */
	protected createStore(): KeyValueStore {
		return new MergeKeyValue(
			CODEX.dataStore,
			(stored, incoming) => mergeStoredCodex(stored, CODEX_CODEC.decode(incoming)),
			() => this.writesAllowed(),
		);
	}

	protected now(): number {
		return os.clock();
	}

	/** The `day` stamp of a found entry: the server's UTC day, never the client's. */
	private day(): number {
		return codexDay(os.time());
	}

	private writesAllowed(): boolean {
		return codexWritesAllowed(RunService.IsStudio());
	}

	/** The Studio fake in force, or undefined (live servers, attribute unset or unparsable). */
	private fakeCodex(): FakeCodex | undefined {
		if (!RunService.IsStudio()) return undefined;
		const raw = Workspace.GetAttribute(CODEX_FAKE_ATTRIBUTE);
		if (raw === undefined) return undefined;
		const fake = parseFakeCodex(raw);
		if (fake === undefined) log.warn("BAD_FAKE", `${CODEX_FAKE_ATTRIBUTE} = ${tostring(raw)} ignored`);
		return fake;
	}

	/** The player's session copy of the fake, reset when the attribute changed. */
	private fakeEntry(player: Player, fake: FakeCodex): FakeEntry {
		const source = tostring(Workspace.GetAttribute(CODEX_FAKE_ATTRIBUTE));
		let entry = this.fakes.get(player);
		if (entry === undefined || entry.source !== source) {
			entry = { source, loaded: fake.loaded, doc: fake.doc };
			this.fakes.set(player, entry);
		}
		return entry;
	}

	/**
	 * The doc a claim or view changes: undefined before `ready`, after a failed load, or under the fake `unknown` (the
	 * shared rules then refuse it as `notReady`).
	 */
	private target(player: Player): CodexDoc | undefined {
		if (!this.ready.has(player)) return undefined;
		const fake = this.fakeCodex();
		if (fake !== undefined) {
			const entry = this.fakeEntry(player, fake);
			return entry.loaded ? entry.doc : undefined;
		}
		const key = playerDataKey(player.UserId);
		return this.cache.loadFailed(key) ? undefined : this.cache.get(key);
	}

	/** A drop warning, at most CODEX.warnRate per player. */
	private warnDropped(player: Player, code: string, message: string): void {
		if (this.warnLimiter.tryAcquire(player, this.now())) log.warn(code, `${player.UserId}: ${message}`);
	}

	/** Keeps an accepted update's doc where target() read it (the fake or the cache: saved when dirty). */
	private apply(player: Player, what: string, update: CodexUpdate): void {
		if (update.refused !== undefined) {
			if (update.refused === "notReady") {
				// Before the load (or after a failed one) the client is expected to wait: logged once per player.
				if (!this.notReadyLogged.has(player)) {
					this.notReadyLogged.add(player);
					log.info(
						"NOT_READY",
						`${player.UserId}: ${what} before the codex was ready (ignored; logged once)`,
					);
				}
			} else this.warnDropped(player, "DROPPED", `${what} ${update.refused}`);
			return;
		}
		if (!update.changed) return;
		const fake = this.fakeCodex();
		if (fake !== undefined) {
			this.fakeEntry(player, fake).doc = update.doc;
			return;
		}
		this.cache.set(playerDataKey(player.UserId), update.doc);
	}

	private loadAndSend(player: Player): void {
		const userId = player.UserId;
		const key = playerDataKey(userId);
		this.waitForRelease(player);
		if (player.Parent === undefined) {
			this.release(player);
			return;
		}
		this.owners.set(userId, player);
		this.cache.load(key, [userId]);
		if (player.Parent === undefined) {
			this.release(player);
			return;
		}
		if (this.cache.loadFailed(key)) {
			log.warn("LOAD_FAILED", `${player.UserId}: codex unavailable this session`);
		} else if (this.cache.get(key)?.seeded !== true && this.fakeCodex() === undefined) {
			this.seed(player, key);
			if (player.Parent === undefined) {
				this.release(player);
				return;
			}
		}
		this.ready.add(player);
		this.send(player);
	}

	/**
	 * A rejoin while this UserId's last session is still being released (its leave save writing): waits until that
	 * release ended (bounded by CODEX.rejoinWaitSeconds; logged past it), or the player left again.
	 */
	private waitForRelease(player: Player): void {
		const userId = player.UserId;
		if (!this.releasing.has(userId)) return;
		const deadline = this.now() + CODEX.rejoinWaitSeconds;
		while (this.releasing.has(userId) && player.Parent !== undefined && this.now() < deadline) {
			task.wait(CODEX.rejoinPollSeconds);
		}
		if (this.releasing.has(userId) && player.Parent !== undefined) {
			log.warn("REJOIN_WAIT_TIMEOUT", `${userId}: the last session's save is still writing; loading anyway`);
		}
	}

	/**
	 * The one-time seed from the onboarding sightings (may yield while OnboardingService's join load runs). Nothing
	 * changes when that load failed or did not end within CODEX.seedWaitSeconds (the next join retries), or the player
	 * left. The doc is read right before the set, with no yield in between.
	 */
	private seed(player: Player, key: string): void {
		const userId = player.UserId;
		const deadline = this.now() + CODEX.seedWaitSeconds;
		let state = this.onboarding.joinLoadState(player);
		while (state === "pending" && player.Parent !== undefined && this.now() < deadline) {
			task.wait(CODEX.seedPollSeconds);
			state = this.onboarding.joinLoadState(player);
		}
		if (player.Parent === undefined) return;
		if (state !== "loaded") {
			const why = state === "failed" ? "onboarding load failed" : "onboarding load still pending";
			log.warn("SEED_SKIPPED", `${userId}: ${why} (seeded on a later join)`);
			return;
		}
		const current = this.cache.get(key);
		if (current === undefined || this.cache.loadFailed(key) || current.seeded === true) return;
		const seen = seenOf(this.onboarding.getDoc(player));
		this.cache.set(key, seedCodexDoc(current, seen, this.day()));
		log.info("SEEDED", `${userId}: ${seen.size()} sightings`);
		task.spawn(() => this.saveKey(key));
	}

	private status(player: Player): CodexStatus {
		const fake = this.fakeCodex();
		if (fake !== undefined) {
			const entry = this.fakeEntry(player, fake);
			return codexStatusOf(entry.doc, entry.loaded);
		}
		const key = playerDataKey(player.UserId);
		return codexStatusOf(this.cache.get(key), !this.cache.loadFailed(key));
	}

	/**
	 * Sends the player's status, only once their join load and seed ended (loadAndSend sends then), and never from a
	 * missing cache entry (a release dropped it: the fresh load it started sends instead).
	 */
	private send(player: Player): void {
		if (player.Parent === undefined || !this.ready.has(player)) return;
		if (this.fakeCodex() === undefined && this.cache.get(playerDataKey(player.UserId)) === undefined) return;
		Events.codexStatus.fire(player, this.status(player));
	}

	/**
	 * A player left (PlayerRemoving, or loadAndSend once a yield ended after the leave). Releases the cache entry only
	 * when this player's session owns it and its load ended (a leave during the join load: loadAndSend calls this again
	 * after it). While the release saves, a rejoin's load waits (waitForRelease); a newer session that stopped waiting
	 * gets a fresh load once the release is done.
	 */
	private release(player: Player): void {
		this.requestLimiter.forget(player);
		this.claimLimiter.forget(player);
		this.viewedLimiter.forget(player);
		this.warnLimiter.forget(player);
		this.notReadyLogged.delete(player);
		this.fakes.delete(player);
		this.ready.delete(player);
		const userId = player.UserId;
		const key = playerDataKey(userId);
		if (this.owners.get(userId) !== player || this.cache.get(key) === undefined) return;
		this.owners.delete(userId);
		this.releasing.add(userId);
		const outcome = this.cache.release(key);
		this.releasing.delete(userId);
		if (outcome === "failed") log.warn("SAVE_FAILED", `${userId}: codex not saved on leave`);
		const newer = this.owners.get(userId);
		if (newer !== undefined && newer.Parent !== undefined) {
			// A rejoin that stopped waiting loaded the entry this release just dropped: load it again, fresh.
			this.owners.delete(userId);
			this.ready.delete(newer);
			task.spawn(() => this.loadAndSend(newer));
		}
	}

	private saveKey(key: string): void {
		if (this.cache.save(key) === "failed") log.warn("SAVE_FAILED", `${key}: will retry on autosave / leave`);
	}

	/** Saves every dirty player in parallel and waits (bounded) for the writes. */
	private saveAllOnClose(): void {
		this.closing = true;
		let pending = 0;
		for (const key of this.cache.keys()) {
			if (!this.cache.isDirty(key)) continue;
			pending++;
			task.spawn(() => {
				this.saveKey(key);
				pending--;
			});
		}
		const deadline = this.now() + CODEX.shutdownSaveSeconds;
		while (pending > 0 && this.now() < deadline) task.wait(CODEX.shutdownPollSeconds);
		if (pending > 0) log.warn("SHUTDOWN_SAVE_TIMEOUT", `${pending} codex saves still pending`);
	}
}

import { OnStart, Service } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { Players, RunService, Workspace } from "@rbxts/services";
import { serverLogger } from "server/log";
import { Events } from "server/network";
import { LEADERBOARD_DETAILS_STORE, boardForParty, detailsKey } from "shared/leaderboard";
import {
	RECORDS_AUTOSAVE_SECONDS,
	RECORDS_CODEC,
	RECORDS_DATASTORE_NAME,
	RECORDS_FAKE_ATTRIBUTE,
	RECORDS_POLICY,
	RECORDS_REQUEST_RATE,
	RECORDS_RETRY,
	RECORDS_SEED_RETRY,
	docOfRun,
	encodeRecordsDoc,
	isEmptyRecords,
	mergeRecordDocs,
	mergeRecords,
	mergeStoredRecords,
	parseFakeRecords,
	recordsEligibility,
	recordsStatusOf,
	runRecordsResult,
	seedFromDetails,
	type FakeRecords,
	type RecordRun,
	type RecordsDoc,
	type RecordsStatus,
	type RunRecordsResult,
} from "shared/records";
import { SlidingWindowLimiter } from "shared/run";
import { PlayerDocCache, playerDataKey, withRetries, type KeyValueStore } from "shared/settings";
import { DataStoreKeyValue } from "./data/DataStoreKeyValue";
import { MergeKeyValue } from "./data/MergeKeyValue";

const log = serverLogger("Records");

/** BindToClose: give up waiting for the last saves after this many seconds (Roblox allows about 30). */
const SHUTDOWN_SAVE_TIMEOUT_SECONDS = 25;
const SHUTDOWN_POLL_SECONDS = 0.1;

/** An accepted run as RunSessionService hands it over (score and floor from the server's replay). */
export interface RecordsRunSubmission {
	readonly runId: string;
	readonly worldKind: string;
	/** The credited members' UserIds (party runs: partyContributors only). */
	readonly memberIds: ReadonlyArray<number>;
	/** The run's party size (the board follows it). */
	readonly partySize: number;
	readonly score: number;
	readonly floor: number;
	/** Unix seconds. */
	readonly at: number;
	readonly debug: boolean;
	readonly died: boolean;
	readonly bossDefeated: boolean;
}

/** A player's Studio fake records (KV_FakeRecords) for this session; verdicts merge into `doc`. */
interface FakeEntry {
	readonly source: string;
	readonly loaded: boolean;
	doc: RecordsDoc;
}

/**
 * Personal records (docs/NEW_BEST.md "Personal records (server)", docs/SERVER.md "Personal records"): each player's
 * best score and deepest floor per board (solo / coop), pure rules in shared/records.
 *
 * Persistence is SettingsService's pattern on DataStore RECORDS_DATASTORE_NAME (`KV_Records_v1`, key playerDataKey):
 * loaded on join (with retries) into a PlayerDocCache, `records` sent once the join load (and the seed) ended, saved
 * when dirty right after a verdict raised a record, on leave, on BindToClose and every RECORDS_AUTOSAVE_SECONDS. Every
 * write is a MERGE inside UpdateAsync (MergeKeyValue + mergeStoredRecords, max per field), so concurrent servers never
 * lower a record. A FAILED join load sends `{ loaded: false }` for the session and never touches the cache entry (it
 * stays failed: nothing is saved from it); a verdict for such a player writes the run alone through the merge store
 * (safe: it can only raise), without a `records` result.
 *
 * Seed (NBD2): after a successful load of a doc WITHOUT the `seeded` marker (shared/records; old docs, and a merge
 * write of a run alone, have none), the player's leaderboard bests (`LB_Details_v1`, solo and coop detailsKey) are
 * read and max-merged in (seedFromDetails, safe on a non-empty doc), the doc is marked seeded (also when both boards
 * read nothing: no leaderboard entry) and saved. A FAILED read leaves the marker absent, so the seed is retried on the
 * next join, and the session's records count as unknown: `{ loaded: false }` (no target rather than a false one) and
 * a verdict writes the run alone, without a `records` result, as for a failed load.
 *
 * Verdicts: RunSessionService calls `applyRun` for every ACCEPTED run (never rejected or expired ones), next to the
 * leaderboard post. RECORDS_POLICY decides (endless only; deaths and abandoned runs; private servers yes; Studio no
 * unless `writeFromStudio`; never debug runs; party size and contributors as on the leaderboard). Each credited member
 * in the server with a loaded doc gets a merge (mergeRecords on the party's board) and their own RunRecordsResult; a
 * credited member who left, or whose records are unknown, gets a merge write of the run alone. It never yields
 * (RunSessionService.conclude may run on Heartbeat): saves and sends are spawned / deferred.
 *
 * Studio only: Workspace attribute RECORDS_FAKE_ATTRIBUTE (`KV_FakeRecords`, shared/records parseFakeRecords) replaces
 * what is sent; verdicts of eligible runs (Studio allowed) merge into the fake for the session; nothing is written and
 * no seed runs. Changing the attribute resets the fake at the next send or verdict.
 *
 * Nothing is sent before the join load and the seed have finished (`ready`): a `requestRecords` that arrives earlier
 * is not answered (the join-end push answers it), so the client never sees a pre-seed status. `requestRecords` is
 * rate limited per player (RECORDS_REQUEST_RATE); a dropped request still answers when ready. A player who left while
 * the join load yielded is dropped, not cached.
 */
@Service({})
export class RecordsService implements OnStart {
	private readonly janitor = new Janitor();
	private readonly store: KeyValueStore;
	private readonly cache: PlayerDocCache<RecordsDoc>;
	private readonly details = new DataStoreKeyValue(LEADERBOARD_DETAILS_STORE);
	private readonly limiter = new SlidingWindowLimiter<Player>(
		RECORDS_REQUEST_RATE.count,
		RECORDS_REQUEST_RATE.windowSeconds,
	);
	private readonly fakes = new Map<Player, FakeEntry>();
	/** Players whose join load and seed have finished: only they are sent `records`. */
	private readonly ready = new Set<Player>();
	/** Players whose seed failed this session: their records are unknown (`loaded: false`, verdicts write directly). */
	private readonly seedFailed = new Set<Player>();
	/** Merge writes for players without a loaded doc, still writing (BindToClose waits for them). */
	private directWrites = 0;
	/** RunSessionService: runs still validating whose verdict may write records (BindToClose waits for them). */
	private pendingRuns: () => number = () => 0;
	private closing = false;

	constructor() {
		this.store = this.createStore();
		this.cache = new PlayerDocCache(
			this.store,
			RECORDS_CODEC,
			RECORDS_RETRY,
			(s) => task.wait(s),
			(waiter) => task.spawn(waiter),
		);
	}

	onStart(): void {
		this.janitor.Add(Players.PlayerAdded.Connect((player) => this.loadAndSend(player)));
		for (const player of Players.GetPlayers()) task.spawn(() => this.loadAndSend(player));
		this.janitor.Add(Players.PlayerRemoving.Connect((player) => this.release(player)));

		this.janitor.Add(
			Events.requestRecords.connect((player) => {
				if (player.Parent === undefined) return;
				if (!this.limiter.tryAcquire(player, this.now())) {
					log.warn("RATE_LIMITED", `${player.UserId}: requestRecords dropped`);
				}
				// Before the join load and seed end, the join-end push answers instead (send skips players not ready).
				this.send(player);
			}),
		);

		const autosave = task.spawn(() => {
			for (;;) {
				task.wait(RECORDS_AUTOSAVE_SECONDS);
				if (this.closing) return;
				for (const key of this.cache.keys()) if (this.cache.isDirty(key)) this.saveKey(key);
			}
		});
		this.janitor.Add(() => task.cancel(autosave));
		game.BindToClose(() => this.saveAllOnClose());
	}

	/** RunSessionService: how many of its runs may still produce a verdict (BindToClose waits for them first). */
	setPendingRuns(count: () => number): void {
		this.pendingRuns = count;
	}

	/** This player's cached records doc, or undefined before it is loaded. */
	getDoc(player: Player): Readonly<RecordsDoc> | undefined {
		return this.cache.get(playerDataKey(player.UserId));
	}

	/**
	 * An ACCEPTED run's records (see the class comment). Returns each credited member's result by UserId (only members
	 * in the server whose records are known; empty when the run does not count). Never yields.
	 */
	applyRun(run: RecordsRunSubmission): Map<number, RunRecordsResult> {
		const results = new Map<number, RunRecordsResult>();
		const fake = this.fakeRecords();
		const studio = RunService.IsStudio();
		const reason = recordsEligibility({
			worldKind: run.worldKind,
			partySize: run.partySize,
			contributors: run.memberIds.size(),
			debug: run.debug,
			// The Studio fake is the explicit Studio test path: it counts, and writes nowhere.
			studio: studio && fake === undefined,
			privateServer: this.isPrivateServer(),
			died: run.died,
			bossDefeated: run.bossDefeated,
		});
		if (reason !== undefined) {
			log.info("INELIGIBLE", `run ${run.runId}: ${reason}`);
			return results;
		}
		const board = boardForParty(run.partySize);
		const recordRun: RecordRun = { score: run.score, floor: run.floor, at: run.at, runId: run.runId };
		for (const userId of run.memberIds) {
			const player = Players.GetPlayerByUserId(userId);
			if (fake !== undefined) {
				if (player === undefined) continue;
				const entry = this.fakeEntry(player, fake);
				if (!entry.loaded) continue;
				const merged = mergeRecords(entry.doc, board, recordRun);
				entry.doc = merged.doc;
				results.set(userId, runRecordsResult(board, merged));
				if (merged.scoreImproved || merged.floorImproved) this.sendLater(player);
				continue;
			}
			const key = playerDataKey(userId);
			const doc = player !== undefined ? this.cache.get(key) : undefined;
			const known = player !== undefined && !this.cache.loadFailed(key) && !this.seedFailed.has(player);
			if (player !== undefined && doc !== undefined && known) {
				const merged = mergeRecords(doc, board, recordRun);
				results.set(userId, runRecordsResult(board, merged));
				if (merged.doc !== doc) {
					this.cache.set(key, merged.doc);
					task.spawn(() => this.saveKey(key));
					this.sendLater(player);
					log.info(
						"RECORD",
						`${userId} ${board}: score ${merged.previous.score} -> ${
							merged.scoreImproved ? run.score : merged.previous.score
						}, floor ${merged.previous.floor} -> ${
							merged.floorImproved ? run.floor : merged.previous.floor
						}`,
					);
				}
				continue;
			}
			// Left, still loading, or records unknown (load or seed failed): a merge write of the run alone (it can only
			// raise; it carries no `seeded` marker, so a later join still seeds).
			this.writeDirect(userId, docOfRun(board, recordRun));
		}
		return results;
	}

	/** The store (a seam: a test or tool can subclass the service with an in-memory KeyValueStore). */
	protected createStore(): KeyValueStore {
		return new MergeKeyValue(
			RECORDS_DATASTORE_NAME,
			(stored, incoming) => mergeStoredRecords(stored, RECORDS_CODEC.decode(incoming)),
			() => this.writesAllowed(),
		);
	}

	protected now(): number {
		return os.clock();
	}

	/** Studio writes nothing unless RECORDS_POLICY.writeFromStudio (seeds included). */
	private writesAllowed(): boolean {
		return RECORDS_POLICY.writeFromStudio || !RunService.IsStudio();
	}

	private isPrivateServer(): boolean {
		return game.PrivateServerId !== "" && game.PrivateServerOwnerId !== 0;
	}

	/** The Studio fake in force, or undefined (live servers, attribute unset or unparsable). */
	private fakeRecords(): FakeRecords | undefined {
		if (!RunService.IsStudio()) return undefined;
		const raw = Workspace.GetAttribute(RECORDS_FAKE_ATTRIBUTE);
		if (raw === undefined) return undefined;
		const fake = parseFakeRecords(raw);
		if (fake === undefined) log.warn("BAD_FAKE", `${RECORDS_FAKE_ATTRIBUTE} = ${tostring(raw)} ignored`);
		return fake;
	}

	/** The player's session copy of the fake, reset when the attribute changed. */
	private fakeEntry(player: Player, fake: FakeRecords): FakeEntry {
		const source = tostring(Workspace.GetAttribute(RECORDS_FAKE_ATTRIBUTE));
		let entry = this.fakes.get(player);
		if (entry === undefined || entry.source !== source) {
			entry = { source, loaded: fake.loaded, doc: fake.doc };
			this.fakes.set(player, entry);
		}
		return entry;
	}

	private loadAndSend(player: Player): void {
		const doc = this.loadFor(player);
		if (doc === undefined) return;
		const key = playerDataKey(player.UserId);
		if (this.cache.loadFailed(key)) {
			log.warn("LOAD_FAILED", `${player.UserId}: records unknown this session`);
		} else if (doc.seeded !== true && this.fakeRecords() === undefined) {
			const ok = this.seed(player, key);
			if (player.Parent === undefined) {
				this.release(player);
				return;
			}
			if (!ok) this.seedFailed.add(player);
		}
		this.ready.add(player);
		this.send(player);
	}

	/**
	 * The player's doc, loading it if needed (may yield). Undefined when the player left while it yielded: their entry
	 * is dropped then.
	 */
	private loadFor(player: Player): RecordsDoc | undefined {
		const doc = this.cache.load(playerDataKey(player.UserId), [player.UserId]);
		if (player.Parent === undefined) {
			this.release(player);
			return undefined;
		}
		return doc;
	}

	/**
	 * The one-time seed from the leaderboard details (yields). Max-merged with the `seeded` marker, so a verdict
	 * meanwhile and records already in the doc are kept. False when a board read failed (nothing changes; the marker
	 * stays absent, so the next join retries).
	 */
	private seed(player: Player, key: string): boolean {
		const userId = player.UserId;
		const r = withRetries(
			() => ({
				solo: this.details.get(detailsKey("solo", userId)),
				coop: this.details.get(detailsKey("coop", userId)),
			}),
			RECORDS_SEED_RETRY,
			(s) => task.wait(s),
		);
		if (!r.ok) {
			log.warn("SEED_FAILED", `${userId}: ${r.error} (records unknown this session, retried on the next join)`);
			return false;
		}
		if (player.Parent === undefined) return true;
		const current = this.cache.get(key);
		if (current === undefined || this.cache.loadFailed(key)) return false;
		const seeded = seedFromDetails(r.value);
		this.cache.set(key, mergeRecordDocs(current, seeded));
		if (!isEmptyRecords(seeded)) log.info("SEEDED", `${userId}: from ${LEADERBOARD_DETAILS_STORE}`);
		task.spawn(() => this.saveKey(key));
		return true;
	}

	/** A merge write of `doc` for a player whose cached doc cannot be used (spawned; BindToClose waits for it). */
	private writeDirect(userId: number, doc: RecordsDoc): void {
		if (isEmptyRecords(doc)) return;
		this.directWrites++;
		task.spawn(() => {
			const key = playerDataKey(userId);
			const r = withRetries(
				() => this.store.set(key, encodeRecordsDoc(doc), [userId]),
				RECORDS_RETRY,
				(s) => task.wait(s),
			);
			this.directWrites--;
			if (!r.ok) log.warn("WRITE_FAILED", `${userId}: ${r.error}`);
		});
	}

	private status(player: Player): RecordsStatus {
		const fake = this.fakeRecords();
		if (fake !== undefined) {
			const entry = this.fakeEntry(player, fake);
			return recordsStatusOf(entry.doc, entry.loaded);
		}
		const key = playerDataKey(player.UserId);
		const doc = this.cache.get(key);
		const known = doc !== undefined && !this.cache.loadFailed(key) && !this.seedFailed.has(player);
		return recordsStatusOf(doc, known);
	}

	/** Sends the player's status, only once their join load and seed ended (loadAndSend sends then). */
	private send(player: Player): void {
		if (player.Parent !== undefined && this.ready.has(player)) Events.records.fire(player, this.status(player));
	}

	/** Sends after the current frame's work (a verdict's `runFinished` goes out first). */
	private sendLater(player: Player): void {
		task.defer(() => this.send(player));
	}

	private release(player: Player): void {
		this.limiter.forget(player);
		this.fakes.delete(player);
		this.ready.delete(player);
		this.seedFailed.delete(player);
		const key = playerDataKey(player.UserId);
		if (this.cache.get(key) === undefined) return;
		const outcome = this.cache.release(key);
		if (outcome === "failed") log.warn("SAVE_FAILED", `${player.UserId}: records not saved on leave`);
	}

	private saveKey(key: string): void {
		if (this.cache.save(key) === "failed") log.warn("SAVE_FAILED", `${key}: will retry on autosave / leave`);
	}

	/** Waits (bounded) for runs still validating, then saves every dirty player in parallel and waits for the writes. */
	private saveAllOnClose(): void {
		const deadline = this.now() + SHUTDOWN_SAVE_TIMEOUT_SECONDS;
		while (this.pendingRuns() > 0 && this.now() < deadline) task.wait(SHUTDOWN_POLL_SECONDS);
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
		while ((pending > 0 || this.directWrites > 0) && this.now() < deadline) task.wait(SHUTDOWN_POLL_SECONDS);
		if (pending > 0 || this.directWrites > 0) {
			log.warn("SHUTDOWN_SAVE_TIMEOUT", `${pending} saves and ${this.directWrites} writes still pending`);
		}
	}
}

# Server census: what the server trusts, writes and tests

A census of `src/server` (30 files, 7,455 lines) taken on 2026-11-21 at base commit `d4936547`, for the staff
presentation plan (tasks SE1, SE3, SE4). For every service: what it accepts from a client and how each argument is
checked, what it writes, which `src/shared` module holds its rules and whether that module has a spec, and which pure
logic still lives in the service. Only `src/shared/**/*.spec.ts` runs headlessly, so "tested" here means "the rule is
in `src/shared` and a spec asserts it"; nothing in `src/server` itself runs outside Studio. The companion of
`docs/SERVER.md` (which describes the flows); this file only counts.

## Result

The claim "the server is untested" is wrong. The services are engine wiring around rules that live in `src/shared` and
are spec'd there:

- The server imports **275** value names from `src/shared`. **196** of them appear in at least one spec. Of the other
  79, **64** are data (rate budgets, store names, retry tables, attribute names), 2 are `GlobalEvents` and a type, and
  **13** are functions: 6 belong to the off-by-default invite spike (`shared/spikes`), 5 are small leaderboard helpers
  that spec'd functions call (`addCounts`, `boardTotal`, `entryValue`, `jobBoard`, `mineFromOrderedValue`), and 2 are
  formatters (`describeEconomyEvent`, `walletPurchaseNotice`).
- Every client-to-server remote (48) is rate limited per player, and every argument that reaches a rule is re-read by
  a shared function with a spec (table below). The exceptions are listed under Findings.
- The pure logic that was still inline in a service and decided something came to **about 60 lines in 5 places**
  (list below). All five are moved and spec'd now (SE3). What is left inline is orchestration: sequences of calls into
  shared objects between engine reads, yields and remote fires. It is listed under "Left in the services".

Spec files per domain at the base commit (modules / specs): wallet 14 / 13, silver 4 / 2, records 7 / 2, leaderboard
15 / 5, run 26 / 77, daily 5 / 1, codex 9 / 6, invite 5 / 3, lobby 7 / 5, onboarding 11 / 7, settings 8 / 1, lockstep
14 / 10, cosmetics 3 / 1, devmode 2 / 0 (`devModeAllowed` is asserted in `shared/run/dev.spec.ts`).

## Remotes: the type guard and the re-read

`src/shared/network.ts` builds the remotes with `Networking.createEvent`, so Flamework's generated guard drops a
payload of the wrong static shape before any handler. The guard does not bound values: a `number` may be NaN or
fractional, a `string` or array any length. The column "Re-read by" names the shared function that bounds them.
`src/server/network.ts` only calls `GlobalEvents.createServer({})`.

## Services

DataStore names are the constants' values. No service uses MemoryStore, MessagingService, TeleportService or HTTP.

| Service (lines) | Client remotes -> re-read by | Writes | Rules in shared (spec) | Pure logic inline at the base commit |
| --- | --- | --- | --- | --- |
| `WalletService` (481) | `requestWallet` (no argument); `walletBuy(itemId)` -> `WalletBook.buy` -> `applyBuy` (catalogue lookup, `typeIs` string); `walletEquip(slot, itemId)` -> `WalletBook.equip` -> `applyEquip`. One limiter each at `WALLET.requestRate`; one request in flight per player (`busy`); refused before the load (`notLoaded`) | `KV_Wallet_v1` key `u_<UserId>`, one UpdateAsync per change through `data/WalletTransactions` (never a whole-doc save); Studio: memory store only. Fires `wallet` | `shared/wallet` `book.ts` (`book.spec`, `shopBook.spec`), `transforms.ts` (`transforms.spec`), `doc.ts` (`doc.spec`, `docCompat.spec`), `grants.ts` (`grants.spec`), `fake.ts` (`fake.spec`), `analytics.ts` (`analytics.spec`) | `owns` (`own.get(itemId) >= 1`, one line); the grant retry rule in `runGrant` (`tries < WALLET.grantRetryMax`: queue, else `GRANT_LOST`) |
| `SilverShopService` (200) | `silverShopReport(report)` -> `readSilverShopReport`; `silverShopFakeBuy(packId)` (Studio only) -> `fakeSilverReceipt`. Both at `SILVER_SHOP.reportRate`. Receipts come from Roblox (`BindReceiptHandler`), not a client -> `silverReceiptPlan` -> `readSilverReceipt` | The wallet through `WalletService.purchaseSilver` (the receipt ring in the same write); `KV_Purchases_v1` audit entry (best effort, never in Studio) | `shared/wallet` `shop.ts` (`shop.spec`), `shopServer.ts` (`shopServer.spec`), `shopAnalytics.ts` (`shopAnalytics.spec`), `WalletBook.purchase` (`shopBook.spec`) | None (the `"Processed"` -> enum mapping) |
| `CosmeticPassService` (122) | `cosmeticPassFakeBuy(itemId)` (Studio only, `COSMETIC_PASS.fakeRate`) -> `armoryItem` + `isRobuxItem`. Purchases come from `PromptGamePassPurchaseFinished` and are confirmed with `UserOwnsGamePassAsync` | The wallet through `WalletService.grantPass` | `shared/wallet` `passes.ts` (`passes.spec`), `applyPassGrant` (`transforms.spec`, `book.spec`) | None |
| `SilverAccessService` (75) | None | Nothing | `shared/run` `silverAccess.ts` (`upgrades.spec`, `archerUnlock.spec`), `shared/cosmetics` `cosmeticLookOf` (spec) | None |
| `RunValidationService` (396) | `submitRun(submission)` -> `validateRun` (shape, size before decoding, limits). Busy check (`RUN_PENDING_PER_PLAYER`) before the limiter (`RUN_SUBMIT_RATE`); the claimed hash echo is cut to 8 characters | `Runs` DataStore only when `RUNS_DATASTORE_ENABLED` (false). Fires `runVerdict` | `shared/run` `validate.ts` (`validate.spec`), `replay.ts`, `queue.ts` (`queue.spec`), `rateLimit.ts` (`rateLimit.spec`) | **`limits()`: the Studio relaxations** (debug input, boss-door spawn, world); **`gateVerdict`**; the `Runs` list cap in `storeRun` (store disabled) |
| `RunSessionService` (951) | `startRun(request)` -> `RunSessionRegistry.start`; `submitSegment(segment)` -> owner check `registry.get(runId, userId)`, `SegmentedValidator.offer`; `finishRun(final)` -> `SegmentedValidator.finish` (`runFinalProblem`); `lockstepInput(runId, firstTick, data)` -> `LockstepSession.submitInput` (`decodeInputBatch`); `lockstepHash(runId, ticks, hashes)` -> `reportHashes`; `lockstepFinal(final)` -> `reportFinal` (`runFinalProblem`); `lockstepLeave(runId)` -> membership check in `leaveParty`. One limiter per remote | Nothing itself: hands accepted runs to `LeaderboardService.post`, `RecordsService.applyRun`, `WalletService.grantRun`. Fires `runStarted`, `segmentVerdict`, `runFinished`, `partyRunStarted`, `lobbyRunStart`, `lockstepFrames` | `shared/run` `runSessions.ts` (`runSessions.spec`), `segments.ts` (`segments.spec`, `segmentsSilver.spec`), `shared/lockstep` (10 specs), `shared/lobby` `runTracker.ts` (`runTracker.spec`), `shared/wallet` `planRunGrants` (`grants.spec`), `shared/leaderboard` `partyContributors` (`leaderboard.spec`) | **The credited members in `conclude`** (who gets the board post, the records and the Silver); **`forRecipient`** (which recipient's verdict carries which records / daily / Silver part) |
| `LeaderboardService` (687) | `getLeaderboard(request)` -> `parseLeaderboardRequest` (before the limiter, `LEADERBOARD_REQUEST_RATE`), `resolveBoardRequest` | Ordered stores per board and scope (`orderedStoreOf`, UpdateAsync personal best through `postPersonalBest`), `LB_Details_v1`, `LB_Daily_Hist_v1` (this server's shard). Fires `leaderboard` | `shared/leaderboard` (`leaderboard.spec`, `dailyBoards.spec`, `histogram.spec`, `podium.spec`, `friends.spec`) | `viewHeader`, `unavailable`, the daily `view` composition, `cacheFor` (a past day's board is "settled"), the entry kept in `dailyWritten` (`improved ? value : previous`) |
| `DailyFriendsService` (238) | None of its own (serves `getLeaderboard` with `friends: true`) | Nothing (reads through `LeaderboardService`). Fires `leaderboard` | `shared/leaderboard` `friends.ts` (`friends.spec`) | The friends `build` composition; the watch push pacing in `pump` |
| `RecordsService` (558) | `requestRecords` (no argument; `RECORDS_REQUEST_RATE`, see Findings) | `KV_Records_v1` key `u_<UserId>`: whole-doc max-merge saves (`MergeKeyValue` + `mergeStoredRecords`) and daily deltas (`mergeStoredDailyDelta`); reads `LB_Details_v1` for the seed. Fires `records` | `shared/records` `doc.ts`, `policy.ts`, `fake.ts` (`records.spec`), `daily.ts`, `dailyLedger.ts` (`daily.spec`), `shared/settings` `PlayerDocCache` (`settings.spec`) | The per-member branch of `applyRun` (known doc: merge and save; otherwise a merge write of the run alone); `studio && fake === undefined` |
| `DailyService` (175) | `requestDaily` (no argument; `DAILY_REQUEST_RATE`) | Nothing. Fires `dailyStatus` | `shared/daily` (`daily.spec`), `shared/leaderboard` `dailyMineFrom` (`dailyBoards.spec`) | `statusFor` (today's status plus the parts read for the same day) |
| `CodexService` (390) | `requestCodex`; `codexClaim(items)` -> `codexClaimUpdate` -> `decodeCodexClaims` (at most `CODEX.claimMaxItems`, catalogue ids, tier 1 or 2); `codexViewed(ids)` -> `codexViewedUpdate` -> `decodeCodexViewed`. One limiter each at `CODEX.claimRate` | `KV_Codex_v1` (max-merge, `mergeStoredCodex`). Fires `codexStatus` | `shared/codex` (6 specs) | None (`target` picks the doc a claim changes) |
| `SettingsService` (210) | `requestSettings`, `resetSettings` (no argument); `updateSettings(patch)` -> `applySettingsPatch` (sanitizes every group). One limiter (`SETTINGS_REQUEST_RATE`) | `PlayerSettings` (SetAsync through `PlayerDocCache`). Fires `settingsChanged` | `shared/settings` (`settings.spec`) | None |
| `OnboardingService` (600) | `requestOnboarding`; `tutorialStarted(info)` -> `PlayerTutorialTelemetry.start` (`readTutorialStartInfo`); `tutorialStep(step)` -> `isTutorialStepNumber`; `tutorialLesson(report)` / `tutorialStuck(report)` / `onboardingReport(report)` -> the tracker's readers; `tutorialFinished(info)` -> `PlayerTutorialTelemetry.finish`; `bestiarySeen(id)` -> `isSightingId`. Six limiters | `KV_Onboarding_v1` (SetAsync through `PlayerDocCache`). Fires `onboardingStatus` | `shared/onboarding` (7 specs) | The new-player day `math.floor(os.time() / SECONDS_PER_DAY)`; the `fresh` / `done` flags handed to `tracker.join` |
| `TelemetryService` (258) | `runRecap(report)` -> `readRunRecapReport`, then `RunRecapGate.take` (one per run session issued to this player); `RUN_RECAP_RATE` | AnalyticsService events only | `shared/run` `analytics.ts`, `recapAnalytics.ts`, `telemetry.ts`, `session.ts` (specs) | `customFields` (reads `Enum` names) |
| `LobbyService` (683) | `lobbyCreate(request)`, `lobbyJoin(lobbyId)`, `lobbyLeave`, `lobbyKick(userId)`, `lobbySetVisibility`, `lobbySetName`, `lobbySetWorld`, `lobbyTransferHost(userId)`, `lobbyInvite(userId)`, `lobbyAnswerInvite(inviteId, accept)`, `lobbySetReady(ready, characterId)`, `lobbyStart`, `lobbyRequestList` -> the `Lobbies` method of the same name (`isUserId`, `isLobbyIdShape`, `isLobbyVisibility`, `isLobbyWorld`, `isCharacterId`; a malformed argument is a `badRequest` refusal). `LOBBY_REQUEST_RATE`, `LOBBY_INVITE_RATE`, `LOBBY_LIST_REQUEST_RATE` | Nothing (memory only). Fires `lobbyState`, `lobbyList`, `lobbyInvites`, `lobbyNotice` | `shared/lobby` `lobbies.ts` (`lobbies.spec`, `lobbies.unlock.spec`), `outbox.ts` (`outbox.spec`), `friendCache.ts` (`friendCache.spec`), `analytics.ts` | **`areFriends`** (a friendship just confirmed with Roblox counts before the cache knows it); the arrival orchestration `applyArrival` / `partyJoin` / `makePartyLobby` (about 110 lines of calls into `Lobbies` and the outbox) |
| `InviteService` (702) | `invitePrompt(request)` -> inline `typeIs(request.withLobby, "boolean")`; `inviteRecipients(userIds)` -> `inviteRecipientList` (at most `LOBBY.maxPlatformInvitesPerMember` ids), and only while a prompt this server opened is live; `inviteEligibility` (no argument). Three limiters. LaunchData -> `decodeInviteLaunch` | Nothing. Fires `joinIntent`, `invitePromptOnClient`, `inviteEligible` | `shared/invite` (`launchData.spec`, `serviceRules.spec`, `arrival` spec) | The prompt record's expiry (`livePrompt`), `matesOf` (party mates by join order) |
| `DevModeService` (35) | None | A Player attribute | `shared/devmode` `devModeAllowed` (`run/dev.spec`) | None |
| `spikes/InviteSpikeService` (417), `spikeFlags` (20) | A spike RemoteEvent of its own, only while `KV_InviteSpike` is on (off by default) | Nothing | `shared/spikes` (no spec) | Not counted: a measurement spike |
| `data/DataStoreKeyValue`, `MergeKeyValue`, `OrderedDataStoreScores`, `WalletTransactions` (144) | None | The only code that calls `DataStoreService` (`GetAsync`, `SetAsync`, `UpdateAsync`, `GetSortedAsync`) | The in-memory fakes of the same interfaces drive the specs (`MemoryWalletStore`, the specs' `KeyValueStore` / `OrderedScoreStore` fakes) | None |
| `config/daily.ts` (35) | None | Nothing | `shared/daily` `dailySeedFrom` (`daily.spec`); the key itself never leaves the server | None |

## Untested pure logic (base commit), by priority

1. **Who is credited with an accepted run** (wallet, records, boards). `RunSessionService.conclude` built the list
   inline from the relay's leave ticks (`-1` = never left) and `partyContributors`; the leaderboard post, the personal
   records and the Silver grant all take it. 11 lines.
2. **The Studio relaxations of run validation.** `RunValidationService.limits()`: `KV_AllowDebugRuns` (exactly `true`)
   allows debug input and boss-door starts, `KV_RunValidationWorld` picks one of four worlds. 9 lines.
3. **The verdict of a submission that was never replayed** (`busy`, `rate_limited`): `RunValidationService.gateVerdict`.
4. **One recipient's copy of a run's verdict**: `forRecipient` in `RunSessionService.ts` (each member's own records,
   daily and Silver parts; nobody else's).
5. **Friendship for a `friends` lobby on arrival**: `LobbyService.areFriends` (a pair just confirmed with Roblox counts
   even on a cache miss).

Asserted in shared already, checked one by one for SE4:

| Behaviour | Where it is asserted |
| --- | --- |
| A purchase receipt processed twice changes the wallet once | `wallet/shop.spec` "grants once per PurchaseId", "a granted receipt writes; a duplicate writes nothing"; `wallet/shopBook.spec` "a redelivery of a granted receipt is Processed and pays nothing", "commit then crash: the redelivery finds the id and pays once" |
| A transaction that would take the balance negative is refused | `wallet/transforms.spec` "refuses poor / maxed / unknown", `wallet/doc.spec` "the balance is earned - spent, never below 0"; the exact price boundary and the store transform: `wallet/trustBoundary.spec` (new) |
| The PurchaseId ring's bound | `wallet/shop.spec` "the ring drops the oldest past SILVER_SHOP.receiptRing" (128); what the bound means for an evicted id and across encode / decode: `wallet/trustBoundary.spec` (new) |
| A forged or over-budget run is rejected | `run/validate.spec` (forged hash, summary lie, edited frames, wrong seed / spawn, too long, too large, run-length bomb, debug input, wrong shape); `run/segments.spec` (edited frame, forged end hash, lying final claim, oversized, clock ahead); `run/runSessions.spec` (the request cannot choose the seed) |
| A record that does not beat the stored one is not written | `records/records.spec` "neither, a tie or lower never wins and returns the same doc", "never lowers a stored record and skips writes that change nothing"; `leaderboard/leaderboard.spec` "only a higher value replaces it", "never lowers a best another server wrote meanwhile" |
| A malformed remote payload is rejected | Per reader: `lobby/lobbies.spec` (NaN, fractions, 1e300, strings), `codex/doc.spec`, `onboarding/funnelReports.spec`, `onboarding/onboardingFunnel.spec`, `invite/serviceRules.spec`, `invite/launchData.spec`, `leaderboard/dailyBoards.spec` "validates requests", `settings/settings.spec`, `wallet/shopAnalytics.spec`, `run/validate.spec`, `run/segments.spec`, `lockstep` specs; wallet ids of any size or type: `wallet/trustBoundary.spec` (new) |

## Moved and spec'd (SE3 / SE4)

| Was | Now | Spec |
| --- | --- | --- |
| `RunSessionService.conclude`, the credited block; `NOT_LEFT` | `shared/leaderboard` `posting.ts` `creditedPartyMembers`, `PARTY_NOT_LEFT` | `leaderboard/credit.spec.ts` (7 cases) |
| `RunValidationService.limits()` body; `STUDIO_WORLDS` | `shared/run` `serviceRules.ts` `studioRunLimits`, `STUDIO_RUN_WORLDS`. The service keeps the one line that decides a live server never reads the attributes (`if (!RunService.IsStudio()) return LIVE_RUN_LIMITS`) | `run/serviceRules.spec.ts` |
| `RunValidationService.gateVerdict` (private method) | `shared/run` `serviceRules.ts` `gateVerdict` | `run/serviceRules.spec.ts` |
| `forRecipient` (top of `RunSessionService.ts`) | `shared/run` `serviceRules.ts` `forRecipient` | `run/serviceRules.spec.ts` |
| `LobbyService.areFriends` body | `shared/lobby` `friendCache.ts` `friendsWithConfirmed`, `ConfirmedFriends` | `lobby/friendCache.spec.ts` (4 new cases) |
| Not moved: asserted at the boundary | The wallet's price boundary, ids of any size or type, Roblox's receipt with non-finite numbers, the ring's bound | `wallet/trustBoundary.spec.ts` (13 cases) |

The bodies are the services' own lines; the services call the shared functions and keep their public shape.

## Left in the services

Not pure enough to move without a refactor, or deciding nothing that is trusted. In priority order for a later pass:

- `RecordsService.applyRun`: the per-member branch (loaded and known: `mergeRecords` into the cache, save, send;
  otherwise `writeDirect(docOfRun(...))`). Both ends are spec'd (`mergeRecords`, `mergeStoredRecords`); the choice
  between them reads the Player, the cache and the fake.
- `WalletService.runGrant`: the retry rule (queue up to `WALLET.grantRetryMax`, then `GRANT_LOST`, one more try at
  shutdown). Safe to retry because the run-id ring refuses a second grant (`transforms.spec` "is idempotent per run
  id").
- `LeaderboardService`: `view` / `viewHeader` / `unavailable` / `cacheFor`, `DailyFriendsService.build`,
  `DailyService.statusFor`: view composition over cached reads.
- `LobbyService.applyArrival` / `partyJoin` / `makePartyLobby`: about 110 lines ordering `Lobbies` and outbox calls for
  an arriving player. The decisions are `resolveArrival`'s (spec'd); the application is not.
- `InviteService`: the arrival state machine (LaunchData polling, the resolve loop, intent upgrades) is yields and
  signals around `resolveArrival`, `joinIntentNow`, `shouldUpgradeJoinIntent` (spec'd).
- Shutdown waits (`waitOnClose`, `saveAllOnClose`, `flush`) and the join-load sequences (`loadAndSend`, `seed`,
  `release`, `holdUntilIdle`): yields, ordering and Player lifetime. Studio only.

## Findings

None lets a client gain Silver, a record or a board entry. Nothing below was changed (each would be a behaviour
change for the owner to approve).

1. **`walletBuy` / `walletEquip` echo and log the item id unbounded.** A wrong id is refused by the catalogue lookup,
   but `WalletBook.request` puts the client's string, whatever its length, into `WalletActionResult.itemId` (sent back
   to that client) and `WalletService.afterRequest` prints it (`REFUSED`). The rate-limited branch in the service
   echoes it too. Each refused request is also one UpdateAsync on the wallet store (the transform runs on the stored
   doc before it can refuse). Bounded by `WALLET.requestRate` (5 per 10 s per remote per player). A cheap fix: refuse
   an id that is not a string of at most `WALLET.maxIdChars` or not in the catalogue before the transaction, and echo
   `""` for it.
2. **`submitSegment` and `finishRun` answer an unknown run before any rate limit.** `RunSessionService.submitSegment`
   fires `segmentVerdict` (`unknown_run`) and `finish` fires `runFinished` when `registry.get` finds nothing; the
   segment limiter is only reached for a known run, and `finishRun` has no limiter at all. No store, no replay: one
   small remote back to the sender per call. The comment in `shared/network.ts` ("every client -> server event is rate
   limited") does not hold for these two paths.
3. **`requestRecords` is not limited in effect.** `RecordsService` logs `RATE_LIMITED` and then sends the status
   anyway (the class comment says so: "a dropped request still answers when ready"). The send is a cache read, no
   store call.
4. **`lockstepInput`, `lockstepHash`, `lockstepFinal` do not check `player.Parent`.** Every other handler drops a
   remote that arrives after PlayerRemoving so that the limiter entry `forget` just removed is not recreated
   (`RunValidationService` says why). These three acquire their limiter first, so a late remote leaves one limiter
   entry (holding the Player) for the life of the server.
5. **`getLeaderboard` parses before it limits.** An invalid request is dropped without using the budget or a log line
   (`parseLeaderboardRequest` is a few comparisons; nothing is read).
6. **`tutorialStarted` over its budget still opens an attempt** (unlogged), so the player counts as in the tutorial
   for lobbies. Documented in the handler; noted because it is the one remote whose effect survives its rate limit.
7. **The PurchaseId ring is 128 ids** (`SILVER_SHOP.receiptRing`). A receipt redelivered after 128 later purchases by
   the same player would grant again (`wallet/trustBoundary.spec` pins this). Roblox only redelivers receipts that were
   never answered `PurchaseGranted`, and the handler answers it only after the write committed, so this needs 128
   purchases to land between a committed write and its lost acknowledgement.

# Server findings

Close the ten findings docs/PRESENTATION.md left for the owner ("Findings left for the owner"; seven of them from
docs/SERVER_CENSUS.md "Findings"), so that every sentence the README and `ARCHITECTURE.md` say about the server is
true as written. No gameplay change: no sim, hash group, wire format, ruleset or fixture is touched, and server
behaviour changes only for requests an honest client never sends.

**Status: built 2026-11-21 on branch `server-findings` (from `presentation` @ `600bf9c4`). Not merged; the owner's
Studio check (SF12) is open.**

## Findings and what became of each

Numbered as in docs/PRESENTATION.md.

| # | Finding | State | How |
|---|---|---|---|
| 1 | `walletBuy` / `walletEquip` echo and log an id of any length; a refused request still costs one `UpdateAsync` | Fixed | SFD5, SF9 |
| 2 | `submitSegment` and `finishRun` answer an unknown run before any rate limit; `finishRun` has no limiter | Fixed | SFD4, SF6 |
| 3 | `requestRecords` logs `RATE_LIMITED` and then answers | Fixed | SFD6, SF8 |
| 4 | `lockstepInput` / `lockstepHash` / `lockstepFinal` lack the `player.Parent` guard | Fixed | SF5 |
| 5 | `getLeaderboard` parses before it limits | Fixed | SFD4, SF7 |
| 6 | `tutorialStarted` over budget still opens an attempt | Accepted | SFD7 |
| 7 | The `PurchaseId` ring is 128: an id evicted by 128 later purchases would grant again if redelivered | Stated | SFD1, SF1 |
| 8 | `KV_InviteSpike` is read on the server without a gate | Fixed | SFD2, SFD3, SF2-SF4 |
| 9 | Client switches whose comments say "Studio" are read anywhere | Relabelled | SFD8, SF10 |
| 10 | Sixteen pending notes in docs/DECISIONS.md are half stale | Moved | SFD10 |

Reading the code changed two of them:

- **Finding 8 could not be a Studio gate.** Spike I0 measures APIs that only work in a published place. And the
  spike did more than create a remote: every server line went to every client (`FireAllClients`), including other
  players' `GetJoinData()` fields, referrer ids and party ids.
- **Finding 7 is not profitable and not in the player's hands.** A second grant needs the wallet write to commit,
  Roblox to miss the `Processed` answer (a server crash between the two), and then 128 more purchases by the same
  player before the receipt is delivered again. At the default prices that is at least 128 x 20 = 2,560 Robux
  spent to regain at most one Hoard (2,500 Silver, 265 Robux).

## Decisions

- **SFD1. The ring's bound is stated, not removed** (owner, 2026-11-21). The README, `ARCHITECTURE.md`, decision
  record 0006 and docs/SILVER_SHOP.md SHD2 say exactly what holds: a receipt is applied once while its id is among
  the player's last 128 granted purchases. The ring stays 128 (a larger ring on some servers would be trimmed by
  the servers still at 128: `decodeWalletDoc` trims to `receiptRing`). Not built: an exact ring, where an id
  leaves only after it is written to a per-id store that a miss looks up. It would put a two-step purchase path
  into the wallet, where a mistake costs players currency, for a case that loses the player Robux.
- **SFD2. A spike's server half runs in Studio or in a named test place, nowhere else.** `shared/spikes`
  `serverSpikeAllowed(studio, placeId)`: true in Studio, or when `game.PlaceId` is in `SPIKE_TEST_PLACES`
  (`shared/config/spikes.ts`). `isServerSpikeEnabled` asks it before it reads the attribute or `SPIKE_DEFAULTS`.
  **The list ships empty** (owner, 2026-11-21: no test place id yet), so outside Studio no server spike runs.
- **SFD3. The invite spike talks only to players developer mode would let in.** `spikeViewerAllowed` (the
  `devModeAllowed` rule with the master switch ignored): everyone in Studio, `DEV_MODE.allowedUserIds` and the
  place's creator in a test place. The session sends its lines to those players and drops a request from anyone
  else. The server output is unchanged.
- **SFD4. A client remote's handler takes its limiter first**: the `player.Parent` guard, then the limiter, then
  the parse, any lookup and any reply. `submitRun` answers `busy` without charging `RUN_SUBMIT_RATE` (a submission
  that cannot run must not use up the budget), so it gets a second, looser limiter in front: `RUN_SUBMIT_GATE_RATE`
  (30 per 60 s), over which a call is dropped unanswered (owner, 2026-11-22). Two handlers read one piece of server
  state before their limiter, each on purpose, and stay as they are:
  - `tutorialStarted` ignores a player in a party run first, and over budget still opens the attempt (SFD7);
  - `invitePrompt` drops a player the service has no member record for.
- **SFD5. A wallet request the catalogue can refuse never reaches the store and never echoes the client's string.**
  `WalletBook.request` refuses a buy of an unknown id (`unknown`) and an equip into a slot no item has (`badSlot`)
  or of an unknown id (`unknown`) before `transact`: the same answers `applyBuy` / `applyEquip` gave, without the
  `UpdateAsync`. `walletEchoId` is what an answer or a log line may carry: a catalogue id, or `""`.
  `notLoaded` and `busy` are still checked first, as before.
- **SFD6. `requestRecords` over budget is dropped.** The log line was already there; the client asks once on start
  and the join-end push answers a request that came too early.
- **SFD7. Finding 6 is accepted.** Dropping a `tutorialStarted` would leave a player who is in the tutorial open to
  a lobby pull. The handler's comment already says so.
- **SFD8. Finding 9 is fixed in the words, not the readers** (owner, 2026-11-21). The registry already listed
  these switches as read "wherever it is set" (docs/DEBUG_SWITCHES.md); the source comments that said "Studio" or
  "dev only" now say the client reads them anywhere, with local effect only. A phone test in the published place
  works on any account.
- **SFD9. Log text is frozen** (docs/PRESENTATION.md SED11). No existing line changed. One new line:
  `[RunSession] FINISH_DROPPED`.
- **SFD10. Finding 10 is closed in the task triage, not here** (owner, 2026-11-21). The sixteen half-stale pending
  notes are among the 68 that docs/OPEN_TASKS_TRIAGE.md lists; they close when the owner works that doc
  (docs/PRESENTATION.md SE9a).

## Open owner call

- **OC1. The test place for spike I0.** Not known yet. Its place id (the number in the place's URL, or
  `game.PlaceId` printed from its server console) goes in `SPIKE_TEST_PLACES`; until then docs/INVITES.md I0 is
  blocked on it.

## As built

| Task | Result |
|---|---|
| SF0 baseline | `out:digest` 1,813 modules at `600bf9c4` |
| SF1 the bound in words | `README.md` "A server that trusts nothing"; `ARCHITECTURE.md` "Trust boundary", the wallet row; `docs/decisions/0006` "Consequences"; docs/SILVER_SHOP.md SHD2 and "Lost or double Silver" |
| SF2 the gate | `shared/spikes/access.ts` `serverSpikeAllowed`, `shared/config/spikes.ts` `SPIKE_TEST_PLACES` (empty), `server/services/spikes/spikeFlags.ts`; `spikes/access.spec.ts` (6 cases) |
| SF3 the lines | `spikeViewerAllowed`; `InviteSpikeSession.viewer` / `broadcast`; `request` drops a non-viewer |
| SF4 registry and docs | A new gate `studio-or-test-place` in `scripts/check-kv-names.js` for `KV_InviteSpike`, `KV_InviteSpikeRecipient`, `KV_InviteSpikeMessageId`; docs/DEBUG_SWITCHES.md regenerated; docs/SPIKES.md "Turning it on"; docs/INVITES.md I0 |
| SF5 guards | `RunSessionService`: `player.Parent` before the limiter on the three lockstep remotes |
| SF6 segments and finish | `submitSegment` takes `segmentLimiter` before `registry.get`: over it, the player's own solo run is rejected as before, a party-run segment or a segment for no run is dropped unanswered. `finish` takes a new `finishLimiter` (`RUN_FINISH_RATE`, 20 per 60 s, `shared/run/limits.ts`) first and logs `FINISH_DROPPED`; forgotten on `PlayerRemoving` with the other six |
| SF7 leaderboard | `tryAcquire` before `parseLeaderboardRequest` |
| SF8 records | `return` after the `RATE_LIMITED` line; the class comment and docs/SERVER.md corrected |
| SF9 wallet ids | `shared/wallet/book.ts` `walletEchoId`, `refusedUnread`; `WalletService`'s rate-limited answers echo through `walletEchoId`. `wallet/trustBoundary.spec.ts`: four new cases on a store that counts its transactions (junk ids and slots: zero; every catalogue item: one per buy, per equip, per emptied slot) |
| SF6b `submitRun` | `RunValidationService`: `gateLimiter` (`RUN_SUBMIT_GATE_RATE`, `shared/run/limits.ts`) before `submit`, forgotten on `PlayerRemoving`. The `busy` check and `RUN_SUBMIT_RATE` are unchanged behind it |
| SF10 the record | docs/SERVER_CENSUS.md and docs/PRESENTATION.md say where each finding went. Finding 9: comments in `shared/play/config.ts`, `shared/settings/config.ts`, `shared/view/decor/config.ts`, five `shared/view` configs and three client controllers |
| SF11 close | This doc, the docs/DECISIONS.md entry, the `CLAUDE.md` row and two convention lines, the `docs/README.md` line, `shared/network.ts`'s comment (it now names every run and lockstep limit), docs/SERVER.md's rate rows |

What an honest client can notice: nothing. Each changed path needs an id the catalogue does not have, a run that
does not exist, more than 30 `submitRun` calls a minute (the submission budget is 6), more than 20 `finishRun` calls a minute (a client sends one per run and can start 10 runs a
minute), more than 10 `requestRecords` in 10 s (a client sends one per session), or a malformed leaderboard
request.

## Checks

On a 4-core Linux arm64 VM with 3.9 GB of memory (Lune 0.11.0, Node 22), each `verify` step run on its own:

- typecheck, whole-tree ESLint at zero warnings, `format:check`, `check:docs`, `docs:check`, `check:assets`,
  `check:autolocalize`, `check:kvnames`, build (rbxtsc), `check:locals`, `facts:check`: pass;
- `test:checks` 68 of 68, `test:art` 364 of 364, `test:l10n`: pass;
- headless specs, **the domains the changed modules belong to or are imported by, not the whole suite**: 79 spec
  files, 1,202 tests, all passing (`wallet/`, `spikes/`, `lockstep/`, `lobby/`, `records/`, `leaderboard/`,
  `settings/`, `codex/`, `onboarding/`, `invite/`, `daily/`, `cosmetics/`, `silver/`, and of `run/`:
  `runSessions`, `segments`, `rateLimit`, `validate`, `serviceRules`, `queue`).

`out:digest`: 1,815 modules against 1,813 at `600bf9c4`. Two are new (`shared/spikes/access`, its spec). Twelve
differ because they were edited: `shared/spikes/init`, `shared/config/spikes`, `shared/run/limits`,
`shared/wallet/book`, `shared/wallet/trustBoundary.spec`, `server/services/spikes/spikeFlags`,
`server/services/spikes/InviteSpikeService`, and the services `RunSessionService`, `RunValidationService`,
`LeaderboardService`, `RecordsService`, `WalletService`. `client/network` and `server/network` differ only in the order of the literals
inside Flamework's generated type guards, which also differs between two builds of the base commit (checked by
building it twice). Every other module is identical, the relabelled ones (SF10) included.

Not run: the whole spec suite (637 files; one `verify:specs` does not fit this machine's 3-minute command limit,
CI runs it in 12 shards on both architectures), `npm run verify` as one command, Roblox Studio, two clients. The
handlers changed in SF5 to SF8 are engine wiring with no spec (README, "What no automated test covers"): SF12 is
their check.

## Tasks

- [x] SF0-SF11.
- [ ] SF12. [owner] Studio check. Solo: buy and equip in the Armory, one endless run to a verdict, the leaderboard
  and the records panel open. Two clients: one co-op run to a verdict; one client leaves mid-run. Workspace
  attribute `KV_InviteSpike` = true in Studio still starts the spike (`[InviteSpike] ON`, the HUD lists server
  lines).
- [ ] SF13. [owner] `npm run verify` as one command on the Mac; the pull request's CI run.
- [ ] SF14. [owner] OC1: the test place id into `SPIKE_TEST_PLACES`, then docs/INVITES.md I0.

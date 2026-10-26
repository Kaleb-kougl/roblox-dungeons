# Server (task 9): run validation, telemetry, settings

Single-player first (PLAN.md): the client runs the deterministic sim and the server never simulates live. The server
checks **finished** runs by replaying them, derives telemetry from its own replay, and stores per-player settings
(juice, key bindings, audio, display: the settings document v2).

| Piece | Where | Tested |
| --- | --- | --- |
| Run config from a seed (App.tsx's M1 run) | `src/shared/run/config.ts` `buildRunConfig` | headless |
| Validation by replay | `src/shared/run/validate.ts` `validateRun` | headless |
| Binary recording codec (the wire format) | `src/shared/sim/recordingCodec.ts` | headless |
| Replay time budget, server-wide replay queue | `src/shared/run/replay.ts` `ReplayBudget`, `queue.ts` `WorkQueue` | headless |
| Client submit rules (short abandons, caps) | `src/shared/play/submitPolicy.ts` | headless |
| Telemetry from the replay (port of the web playtest telemetry) | `src/shared/run/telemetry.ts`, `session.ts` | headless |
| AnalyticsService mapping | `src/shared/run/analytics.ts` | headless |
| Rate limiter | `src/shared/run/rateLimit.ts` | headless |
| Settings schema, stored document, retrying session cache (load / save sharing) | `src/shared/settings/` | headless |
| World registry (world kind -> RunSetup) | `src/shared/run/worlds.ts` | headless |
| Run sessions: server-picked seeds, party, expiry (M3) | `src/shared/run/runSessions.ts` | headless |
| Segment protocol + `SegmentedValidator` (M3) | `src/shared/run/segments.ts` | headless |
| Score reader (`state.score.total`, `state.endless.floor`) | `src/shared/run/score.ts` | headless |
| Client segment cutting | `src/shared/play/liveRun.ts` `SegmentCutter`, `LiveRun.cutSegment` | headless |
| Leaderboards: ordered value, PB rules, write queue, read cache, view (M5) | `src/shared/leaderboard/` | headless |
| Same-server lobbies: model, who-hears-what outbox, friend cache, lobby run tracker, analytics (L2) | `src/shared/lobby/` | headless |
| Onboarding doc codec, done rule, tutorial funnel filter | `src/shared/onboarding/` | headless |
| Remotes | `src/shared/network.ts`, `src/server/network.ts` | Studio |
| Services | `src/server/services/{RunValidation,RunSession,Leaderboard,Telemetry,Settings,Lobby,Onboarding}Service.ts`, `data/` | Studio |

M3 / M5 (sections "Segmented runs" and "Leaderboards" below) add the ranked path: the server picks the seed, the
client uploads its recording in segments while it plays, and the server keeps its own SimState per run and replays
each segment as it arrives. The whole-run `submitRun` path below is unchanged and still used for unranked runs.

**The vertical slice** (all of it wired together, `src/shared/run/slice.spec.ts`): a ranked run is an **endless** run
(`RANKED_WORLD_KIND = "endless"`), always **scored** (M2: `buildEndlessRunConfig` sets `scoring: ENDLESS_SCORING`,
party size 1, on client and server alike), cut into **one segment per floor** (SimController's
`segmentCutAfterTick: (s) => s.events.floorChanged !== 0`, plus the 5-minute fallback), validated segment by segment,
and posted to the boards with the score and floor of the server's replay (`readRunScore`). M2 in-run progression
(boon drafts, relics, curses) is part of every endless run's sim state (the hash's "run" group): the server replays it
from the input like everything else, so nothing about it is trusted from the client. Unranked endless runs
(no server answer) go through `submitRun` and are scored in the replay too. The M1 "game" world stays unscored
(fixtures, `validateRun` defaults); a client run with `KV_Scoring` on an M1 world is never submitted (`scored`). The floor-clear bonus pays by the share of the floor's enemy rooms cleared
(floor(1000 x floor x cleared / rooms with enemies) before the multipliers; the boss is one more room on a boss floor;
a floor without enemy rooms pays the full bonus), so sprinting to the always-open stairwell past every room earns no
floor bonus (sim README "Endless mode").

## Flow

```
client (live sim)                                   server
  run ends (death / victory / restart)
  short abandon? not sent (submitPolicy)
  over the caps? not sent, local too_large
  submitRun({ seed, atBossDoor, recording,  ───────►  RunValidationService
              claimedHash, claimed })                   player gone? ignored
    recording = encodeRecording(...) (buffer)           RUN_PENDING_PER_PLAYER pending? busy (not charged)
                                                        rate limit (RUN_SUBMIT_RATE)
                                                        replay queue (REPLAY_CONCURRENCY at once, FIFO)
                                                        validateRun(submission, DEFAULT_RUN_LIMITS):
                                                          shape -> byte cap -> tick bound -> decode -> seed
                                                          -> debug bits -> boss-door flag -> buildRunConfig(seed)
                                                          -> spawn -> replay (yield when 4 ms of CPU piled up)
                                                          -> hashState == claim? -> recomputed summary == claim?
                                                        accepted: keep in memory (+ "Runs" DataStore if enabled),
                                                                  fire onRunAccepted (TelemetryService; rewards later)
                                                        rejected: log, fire onRunRejected (TelemetryService)
  runVerdict({ ok, code?, reason?,          ◄───────
               serverHash, summary, runId? })
```

- **Endless mode** (shared/config `PLAY_MODE`, default `"endless"`): live servers validate with `LIVE_RUN_LIMITS`
  (`DEFAULT_RUN_LIMITS` in world `"endless"`): `buildRunConfig(seed, { world: "endless" })` =
  `buildEndlessRunConfig(seed)` rebuilds every floor from the run seed (floors cached per config, dungeons in a
  server-wide LRU of `ENDLESS_DUNGEON_CACHE_SIZE`; solid pillars and the `actorSteerMover` are part of every endless
  floor, so client and server agree). The endless debug floor skip (N, `DEBUG_FLOOR_BUTTON`) is a debug
  bit like K / J (`debug_input` unless `allowDebugInput`, also in segments). `PLAY_MODE = "m1"` brings back the M1
  run below. Endless configs are scored (`ENDLESS_SCORING`), so the replayed hash includes the `score` group.
- The **world is rebuilt from the seed alone** (`buildRunConfig`): the Dungeon Forge floor (cached per seed, LRU of
  `DUNGEON_CACHE_SIZE`), `circleMover` / `bulletBlocker` / `actorMover`, `placeEncounter(d, DEFAULT_ENCOUNTER)`, the
  default loadout, no stress. The client must build its live run with the same function.
- The spawn is not trusted either: the recording's spawn must equal `runSpawn(dungeon, atBossDoor)` exactly.
- The summary the server reports (ticks, kills, boss defeated, died) is recomputed from the replay's own events. The
  client's claim is only compared (a mismatch rejects the run as `summary_mismatch`).
- `validateRun` never throws: an error inside the sim becomes
  `{ ok: false, code: "replay_error", reason: "replay error: ..." }`. Every reject reason is cut to
  `MAX_REJECT_REASON_CHARS` (200) in one place (`truncateReason`, also used for the service's internal-error path),
  because reasons can quote sim errors and go to the server log, analytics and the client.

## The wire format: binary recordings (`src/shared/sim/recordingCodec.ts`)

The recording travels as a Luau `buffer` (`encodeRecording` / `decodeRecording`). The JSON form
(`serializeRecording` / `deserializeRecording`) stays the fixtures' format and the tests' input; the server only
accepts the binary form (a string `recording` is `bad_submission`).

Layout (little-endian): version byte, seed u32, spawn x / z as f64 (exact), varint frame count, then runs until they
cover exactly that count. A run is one tag byte (bits 0-4: which of moveX, moveZ, aimX, aimZ, buttons differ from the
previous run's frame; bits 5-7: run length 1..7, or 7 = 8 + a varint) followed by one varint per changed field: a
zigzag delta for an axis, the XOR for the buttons. Varints are LEB128, at most 4 bytes, minimal.

Why this scheme: aim (mouse or stick) changes almost every tick but by small steps, so a delta is one byte; held keys
and buttons cost nothing until they change; identical frames collapse into runs. A linear predictor
(`2 * prev - prevprev`) was measured too: it only wins on the scripted bot's perfectly smooth sweeps (run-boss 3.8 vs
5.1 bytes per tick) and loses on every other fixture.

Measured (the codec spec prints these):

| Recording | Ticks | JSON (chars) | Binary (bytes) | Bytes / tick |
| --- | --- | --- | --- | --- |
| `run-player` | 996 | 968 | 280 | 0.28 |
| `run-player-dungeon-1337` | 600 | 2,361 | 467 | 0.78 |
| `run-bullets` | 499 | 348 | 135 | 0.27 |
| `run-full-1337` | 3,600 | 12,802 | 4,132 | **1.15** |
| `run-boss-1337` | 1,800 | 38,808 | 9,138 | **5.08** (a bot moving and aiming on every tick: the worst case on record) |

A typical keyboard-and-mouse run (aim changing every tick, keys held) is ~3 bytes per tick: ~32 KB for 3 minutes.

Decoding is written for hostile input and never throws (fuzzed in the spec: every truncation of a real encoding,
3,000 random / mutated buffers): the byte cap is checked before reading, the frame count is checked against
`maxTicks` before a single frame is built, a run may never cover more frames than the count, every read is
bounds-checked, overlong / over-4-byte varints, out-of-range axes, unknown button bits, non-finite spawns and trailing
bytes are `malformed`. The encoding is canonical (one encoding per recording; a flagged field must change, a run must
differ from the previous one), so anything the decoder accepts re-encodes to the same bytes. Frames of one run share
one frozen table.

Button bits: `RECORDED_BUTTONS` = `SIM_BUTTONS` plus 16384, in both variants: a party stream's `PARTY_LEFT_BUTTON`
(the relay's leave mark), a solo stream's `FORFEIT_BUTTON` (the same bit: "Leave run", L6a). The sim kills a solo
player on a tick whose input carries it (`forfeitSoloRun`: the lethal-hit death bookkeeping, no hit), so a forfeited
run replays to `died = true` and the endless board posts it like any death. It is not a debug bit (`debug_input`
ignores it) and needs no trust: it can only end the submitter's own run early. Allowing it changed no existing
encoding (every fixture recording encodes to the same bytes).

Flamework's generated guard checks the field as `t.typeof("buffer")` (`out/server/network.luau`); `validateRun`
checks `typeIs(recording, "buffer")` again.

## Network contract (`src/shared/network.ts`)

Event pairs, like the user's other Flamework project. Flamework generates a runtime type guard for every parameter
(visible in `out/server/network.luau`); values (string length, NaN, ranges) are re-checked by the server.

| Direction | Event | Payload | Reply |
| --- | --- | --- | --- |
| client -> server | `submitRun` | `RunSubmission { seed, atBossDoor, recording: buffer, claimedHash, claimed: RunSummary }` | `runVerdict` (none if the player already left) |
| client -> server | `requestSettings` | none | `settingsChanged` (every group) |
| client -> server | `updateSettings` | `SettingsOverrides { juice?, controls?, audio?, display? }`: each group present REPLACES the stored one (`{}` clears it), sanitized by `applySettingsPatch` | `settingsChanged` (also when rate limited: the stored overrides) |
| client -> server | `resetSettings` | none (every group back to the defaults) | `settingsChanged` (also when rate limited: the stored overrides) |
| server -> client | `runVerdict` | `RunVerdict { ok, claimedHash, code?, reason?, serverHash, summary, runId? }` | |
| server -> client | `settingsChanged` | `SettingsOverrides` (only what the player changed; sent once after join too) | |
| client -> server | `startRun` | `StartRunRequest { requestId, worldKind, party?, atBossDoor?, classId? }` | `runStarted` (`StartRunReply`) |
| client -> server | `submitSegment` | `RunSegment { runId, index, startTick, recording: buffer, claimedEndHash, checkpointHashes }` | `segmentVerdict` (`SegmentVerdict`) once replayed |
| client -> server | `finishRun` | `RunFinal { runId, finalTick, claimedHash, claimed: FinalRunSummary }` | `runFinished` (`RunFinishVerdict`) |
| client -> server | `getLeaderboard` | `"solo" \| "coop"` | `leaderboard` (`LeaderboardView`) |
| client -> server | `lobbyCreate` / `lobbyJoin` / `lobbyLeave` / `lobbyKick` / `lobbySetVisibility` / `lobbySetName` / `lobbyTransferHost` / `lobbyInvite` / `lobbyAnswerInvite` / `lobbySetReady` / `lobbyStart` | see "Lobbies" | the state they change (`lobbyState`, `lobbyInvites`, `lobbyList`) or `lobbyNotice { kind: "refused", requestKind, code, reason }` |
| client -> server | `lobbyRequestList` | none | `lobbyList`, `lobbyState`, `lobbyInvites` (the current state) |
| server -> client | `lobbyRunStart` | `LobbySoloRunStart { lobbyId, kind: "solo" }` | the client starts a ranked solo run (`startRun`) |
| server -> client | `partyRunStarted` | `PartyRunStart { runId, seed, worldKind, members, lobbyId }` | |
| client -> server | `lockstepInput` / `lockstepHash` / `lockstepFinal` | inputs; `runId, ticks[], hashes[]` (batched, resent until acknowledged); `RunFinal` | `lockstepFrames(runId, firstTick, data, hashAck)` |
| client -> server | `lockstepLeave` | `runId` | none (the leaver's frames carry the leave bit from the next tick; `runFinished` still comes) |
| client -> server | `requestOnboarding` / `tutorialStarted` / `tutorialStep` / `tutorialFinished` | see "Onboarding (tutorial)" | `onboardingStatus` (request, finished) |
| server -> client | `onboardingStatus` | `OnboardingStatus { loaded, tutorialDone }` (sent once after join too) | |

The M4 invite flow (`partyInvite` / `partyRespond` / `partyInviteUpdate`, `shared/run` `PartyInvites`) was removed in
task L7: lobbies replace it.

The client side is `src/client/network.ts` (`GlobalEvents.createClient`); `SimController` submits each finished run once and shows the verdict, and `SettingsController` syncs the settings document (juice, controls, audio, display; see `docs/CLIENT.md`).

## Limits (data: `src/shared/run/limits.ts`, `src/shared/settings/config.ts`)

| Limit | Value | Why |
| --- | --- | --- |
| `MAX_RUN_TICKS` | 72,000 (20 min) | Bounds replay CPU. Checked on the frame count **before** a frame is built (a 30-byte buffer can claim 268 million frames). |
| `MAX_RECORDING_BYTES` | 432,021 bytes | Header (21) + `MAX_RUN_TICKS` x `RECORDING_BYTES_PER_TICK_BUDGET` (6) = 21 + 72,000 x 6. 6 bytes per tick is ~18 % over the worst measured recording (run-boss, 5.08); only pathological input (every axis jumping 64+ units on every tick) needs more (up to 11). Checked before decoding, and by the client before sending (it keeps the run and shows `too_large`, reason `not sent: recording over cap`). The old JSON cap (200,000 chars) rejected any real run over ~2.5 min. |
| `MAX_REJECT_REASON_CHARS` | 200 | Reject reasons are cut here (`truncateReason`). |
| `RUN_SUBMIT_RATE` | 6 per 60 s per player (sliding window) | Each submission costs a replay. Was 4: every R restart submitted, so restarts dropped legit runs. The client now skips abandoned runs under 10 s (except the retry right after a death), so honest play stays under 6 a minute. |
| `RUN_PENDING_PER_PLAYER` | 2 | Submissions per player validating or queued at once (a long run's replay can outlast a short next run). A third answers `busy`; `busy` is checked **before** the rate limit, so it costs nothing. |
| `REPLAY_BUDGET_SECONDS` | 4 ms | The replay yields (`task.wait()`) whenever 4 ms of `os.clock()` work piled up since the last yield (was: every 2,000 ticks, ~160 ms blocks). The check runs in the replay's `onCheckpoint` hook (`ReplayBudget`, clock injected), so validate.ts and the sim never read a clock. At ~80 us per tick (an M1 floor) a 20-minute run takes ~25 s of wall time; deep endless floors cost far more per tick ("Replay capacity" below). Segmented replays check it every `SEGMENT_BUDGET_CHECK_TICKS` = 4 ticks (was 16: at ~1.1 ms per tick a check could overshoot by ~18 ms). |
| `REPLAY_CONCURRENCY` | 1 | Server-wide replay queue (`WorkQueue`, FIFO): concurrent players' replays run one after another instead of stacking CPU time on the same frames. The log line shows the queue wait. |
| `SETTINGS_REQUEST_RATE` | 20 per 10 s per player | Settings remotes. |
| `ONBOARDING_REQUEST_RATE` / `TUTORIAL_STEP_RATE` | 10 / 30 per 10 s per player | Onboarding remotes (`shared/onboarding/config.ts`). |
| Seeds | integers in [0, 2^32) | What the web build's `seedFromQuery` produces. |
| Debug input (`DEBUG_HIT`, `DEBUG_BOSS` bits) | rejected (`debug_input`) | K / J are debug keys. The boost debug drop (M, `DEBUG_DROP_BUTTON`, docs/BOOSTS.md) is a `PORT_BUTTONS` bit and is rejected the same way. |
| Boss-door start | rejected (`debug_spawn`) | The web build's `?spawn=boss` is debug only. |
| Stress mode | never accepted | `buildRunConfig` never sets `stress`, so a stress recording fails the hash. |

Studio only (ignored on live servers): the Workspace attribute `KV_AllowDebugRuns = true` accepts debug input and
boss-door starts; `KV_RunValidationWorld = "dungeonNoEncounter" | "greybox"` validates in a test world (see Testing).

Reject codes (`RunRejectCode`, also the analytics breakdown): `bad_submission`, `too_large`, `too_long`, `malformed`,
`seed_mismatch`, `debug_input`, `debug_spawn`, `config_error`, `spawn_mismatch`, `replay_error`, `hash_mismatch`,
`summary_mismatch`; before validation: `busy` (checked first, free), `rate_limited`.

## Players leaving mid-validation

- `submitRun` from a player who is no longer parented to Players is ignored (no limiter entry is recreated after
  leave). The same holds for the settings remotes.
- A validation still queued or running when its player leaves finishes: the run is logged, its listeners fire (it
  counts for the session), no `runVerdict` is sent and it is not kept in the in-memory accepted list.
- TelemetryService holds the leaving player's session summary until `RunValidationService.waitUntilIdle(player)`
  returns (no submission of theirs validating or queued), so late runs are folded into the session events
  (`SessionEnded`, `SessionRuns`, ...); then it drops the player. Nothing is retained for a departed player afterwards.

## Client submit rules (`src/shared/play/submitPolicy.ts`, SimController)

- Deaths and victories are always submitted. An abandoned run (R) is submitted only when it lasted at least
  `MIN_ABANDONED_SUBMIT_TICKS` (10 s of sim time) or when it is the first run after a submitted death. The exception
  keeps the session's retry signal: "died, pressed R, restarted again after 3 s" still counts the death as retried.
  Skipped runs show `not submitted (short)`.
- Effect on the session numbers (`summarizeRunSession`): an abandoned run under 10 s that is not the first after a
  death is not a run (not in `SessionRuns`, its seconds not in `aliveSeconds`). A death followed only by such quick
  restarts and then a quit still counts as retried, because the first restart after it was sent. (Leaving mid-run
  never submitted anything, as before.)
- A submission over `MAX_RECORDING_BYTES` or `MAX_RUN_TICKS` is not sent: the verdict line shows it rejected locally
  (`too_large` / `too_long`, reason `not sent: ...`).

## What replay validation does and does not prevent

It proves: **this outcome follows from these inputs, on the world this seed generates, under the shipped sim.** So a
client cannot claim kills, a boss kill, a survival or a run length it did not simulate; cannot edit its state (hearts,
positions, boss hp), skip ticks, spawn elsewhere, change the loadout or use the debug keys; and cannot send telemetry
(there is no telemetry remote; every analytics event is derived from the server's replay).

It does NOT prevent:

- **Input bots / assisted play.** A bot (or a human with a script) that plays through the real input path produces a
  valid recording. The web build's own test bots (`run-full-1337`, `run-boss-1337`) are exactly that. Detecting them
  would need behavioural heuristics (reaction times, input entropy), not replay.
- **Offline search / tool-assisted runs.** The sim is deterministic and ships to the client: anyone can replay
  candidate inputs locally until a perfect run comes out, then submit it. It is a legitimate recording.
- **Seed shopping.** Today any valid seed is accepted, so a player can pick an easy floor. When rewards exist, the
  server should hand out the seed (and a nonce) at run start and only accept that seed once.
- **Replayed submissions.** The same recording can be submitted twice (each is accepted). Rewards should key on the
  server-issued run nonce; `runId` is generated per acceptance.
- **Irrelevant edits.** An input edit that changes nothing in the simulation (e.g. pressing FLASK at full hearts)
  replays to the same hash and is accepted: it IS the same run (test: "an edit the sim ignores").
- **Pause / timing.** Recordings contain ticks, not wall time: slowing the game down (lag switch, pause abuse) is not
  visible to the server.
- **Code version skew.** A replay only matches the same sim code. Old clients after an update will fail validation;
  version the submission once clients outlive deploys (`buildVersion` in the web build). There is no ruleset version in
  recordings, segments or board entries today: a recording is replayed once, live, by the server build that received
  it, and nothing stored is ever re-validated, so a rules change needs no bump to stay consistent. It does leave the
  boards mixed: entries posted before a rules change (e.g. solid pillars on endless floors, 2026-10-25) stay on
  `LB_Solo_v1` / `LB_Coop_v1`. Renaming the stores (`_v2`) is how to start fresh boards if that matters.

## Segmented runs (M3)

Endless runs outlast `MAX_RUN_TICKS`, and a leaderboard must only show what the server reproduced. So a ranked run is
validated in **segments** while it is played; the server keeps one live `SimState` per active run and only ever steps
it forward (`cloneSimState` throws once bullets exist, so it can never rewind).

```
client                                                server (RunSessionService)
  run start: startRun({ requestId, worldKind,  ───────►  rate limit (RUN_START_RATE) -> RunSessionRegistry.start:
             party?, atBossDoor?, classId? })            shape, world kind (registry), debug spawn, party, busy,
                                                         SEED PICKED BY THE SERVER, world built (worlds.ts),
                                                         the player's open session replaced ("abandoned")
  runStarted({ requestId, ok, runId, seed,     ◄───────
               worldKind, members, code? })
  (no answer in RUN_START_TIMEOUT_SECONDS or refused: an unranked run on the local seed, old submitRun path)
  play; LiveRun cuts a segment on a floor change (hook) or every SEGMENT_FALLBACK_TICKS
  submitSegment({ runId, index, startTick,     ───────►  owner check -> rate limit (SEGMENT_SUBMIT_RATE) ->
                  recording, claimedEndHash,             validator.offer (cheap checks, queued) -> pump: replay
                  checkpointHashes })                    through RunValidationService's replay queue (replayTurn:
                                                         at most one segment and REPLAY_TURN_MAX_TICKS per queue
                                                         turn), ReplayBudget yields
  segmentVerdict({ runId, index, ok, code?,    ◄───────
                   startTick, endTick, serverHash, matchedThroughTick?, mismatchAtTick? })
  death / victory / R: last segment, then
  finishRun({ runId, finalTick, claimedHash,   ───────►  validator.finish -> decided after the last segment's replay:
              claimed: { ticks, kills,                   final tick, hash, summary (recomputed), score (readRunScore
              bossDefeated, died, score, floor } })      on the SERVER's state) -> telemetry listeners, leaderboards
  runFinished({ runId, ok, code?, reason?,     ◄───────  (also sent when a segment rejects the run or it expires)
                failedSegment?, matchedThroughTick?, mismatchAtTick?, verifiedTicks, serverHash, summary, score,
                leaderboard? })
```

- **Segment encoding**: an ordinary binary recording (`encodeRecording`) of the run's seed and spawn plus the frames of
  ticks `[startTick, endTick)`; the delta coding restarts at every segment. Same decoder, same hostile-input safety.
- **Checkpoint hashes**: `hashState` after every tick `T` with `startTick < T < endTick` and
  `T % SEGMENT_CHECKPOINT_TICKS === 0` (10 s), exactly that many (`checkpointCount`). A mismatch is then located to a
  10 s window: `matchedThroughTick` (last tick known good) .. `mismatchAtTick` (first known bad).
- **Order of checks on arrival** (`offer`; each failure rejects the whole run with its code): status (`run_rejected`,
  `run_closed` - these two do not change the run), shape (`bad_segment`), runId, `out_of_order` (index !== expected),
  `tick_gap` (startTick !== previous end), decode (`segment_too_large`, `segment_too_long`, `malformed`),
  `empty_segment`, `seed_mismatch`, `spawn_mismatch`, `run_too_long` (MAX_SEGMENTED_RUN_TICKS), `debug_input`,
  `clock_ahead` (the run's ticks / 60 exceed the session's wall-clock age + SEGMENT_CLOCK_SLACK_SECONDS), checkpoint
  count (`bad_segment`), `backlog_full` (MAX_PENDING_SEGMENT_TICKS received but not replayed).
- **Replay** (`advance`): `replay_error` (the sim threw), `hash_mismatch` (a checkpoint or the end hash).
- **Final** (`finish` / after the last replay): `bad_final`, `final_tick_mismatch`, `empty_run`, `clock_ahead`,
  `hash_mismatch`, `summary_mismatch`, `score_mismatch`.
- **Session**: `unknown_run` (no such run for this player), `expired` (no segment for RUN_SESSION_IDLE_SECONDS or older
  than RUN_SESSION_MAX_AGE_SECONDS), `abandoned` (a new start replaced it, or the player left; not reported to
  analytics), `rate_limited`.
- **Start codes** (`runStarted.code`): `bad_request`, `unknown_world` (also: a registered world the server never runs,
  `SERVER_REFUSED_WORLDS` in `shared/run/worlds.ts`: the local-only `tutorial`; party invites refuse it the same
  way), `debug_spawn`, `bad_party` (also: a party
  without every member's accepted invite, see "Co-op lockstep"), `busy` (the player already has RUN_PENDING_PER_PLAYER
  finished runs still validating, or a member - the owner included - is in a party run that is not concluded yet:
  `RunSessionRegistry.busyReason`), `config_error`, `rate_limited`. The client retries `busy` a few times
  (`RUN_START_BUSY_RETRY_SECONDS`) before playing unranked.

| Limit (`src/shared/run/limits.ts`) | Value |
| --- | --- |
| `MAX_SEGMENT_TICKS` / `MAX_SEGMENT_BYTES` | 36,000 (10 min) / 216,021 bytes (header + 6 B per tick) |
| `MAX_SEGMENTED_RUN_TICKS` | 1,296,000 (6 h) |
| `SEGMENT_FALLBACK_TICKS` (client) | 18,000 (5 min) |
| `SEGMENT_CHECKPOINT_TICKS` | 600 (10 s) |
| `MAX_PENDING_SEGMENT_TICKS` | 72,000 |
| `SEGMENT_CLOCK_SLACK_SECONDS` | 30 |
| `RUN_SESSION_IDLE_SECONDS` / `RUN_SESSION_MAX_AGE_SECONDS` | 30 min / 8 h (open sessions only; a finished one validates to the end) |
| `RUN_START_RATE` / `SEGMENT_SUBMIT_RATE` | 10 / 30 per 60 s per player |
| `REPLAY_TURN_MAX_TICKS` | 1,800 (30 s of play) replayed per queue turn at most; a longer segment resumes on the session's next turn |
| `MAX_PARTY_SIZE` | 8 |
| `LOBBY_REQUEST_RATE` / `LOBBY_INVITE_RATE` / `LOBBY_LIST_REQUEST_RATE` (shared/lobby) | 20 lobby requests per 10 s / 10 `lobbyInvite` per 60 s / 10 `lobbyRequestList` per 10 s per player |
| `LOCKSTEP_LEAVE_RATE` (shared/lockstep) | 4 `lockstepLeave` per 10 s per player |

Players and sessions: one OPEN session per player (a new start replaces it, concluded as `abandoned` with a
`runFinished` the client does not show); after `finishRun` it keeps validating
even if the player leaves (counted by `RunValidationService.trackExternal`, so TelemetryService's session summary
waits for it) and fires the same accepted / rejected listeners as `submitRun` (`reportAccepted` / `reportRejected`).
A party of 2+ starts only from a lobby's Start ("Lobbies" below), all in the same server; it plays ONE lockstep sim
validated from the server's own merged log ("Co-op lockstep (M4)" below), and the members who contributed get credit
on the co-op board. A party run that is not concluded (still played, or its final still replaying) makes its members
`busy`: neither the owner's restart nor anyone's new start or lobby can replace it, so a LockstepSession never keeps
running without its run session, and every member gets the run's `runFinished`. A member who left it (the owner
included) is free to start another run; the party run goes on without them.

**World registry** (`worlds.ts`): `registerRunWorld(kind, (seed, { atBossDoor }) => RunSetup)`; "game",
"dungeonNoEncounter", "greybox" and "endless" (`buildEndlessRunConfig`, which ignores the boss door) are built in. A
new world is one line in `registerBuiltinWorlds`. The client builds its live run with the same builder
(`SimController.makeRun` -> `buildWorldSetup`; an endless setup also hands out `endlessFloor` for the views). Ranked
runs ask for `RANKED_WORLD_KIND` (shared/play config.ts): `"endless"`.

**Score** (`score.ts`): `readRunScore(state) -> { score, floor }` = `{ state.score?.total ?? 0, state.endless?.floor
?? 1 }` (`stateRunScore`, the DEFAULT reader, so no load order can leave a side on a placeholder; `setRunScoreReader`
remains for tests). Used by the client for its claim and by the server on its replayed state; only the server's goes
anywhere. An unscored M1 run scores 0 on floor 1.

**Client recording trim**: once `segmentVerdict` says a segment is ok, the client drops the frames before its end tick
(`LiveRun.releaseVerifiedFrames`), so a long endless run's recording stays bounded. Only on ranked runs (they never
fall back to `submitRun`) and not with `KV_Debug` (F8's replay check needs the whole recording).

## Co-op lockstep (M4)

A party run (2..8 players) is ONE deterministic sim that every member steps from the same merged input log. Pure
logic in `src/shared/lockstep/` (headless specs drive it with simulated clients); `RunSessionService` and
`SimController` only wire remotes and clocks.

**Start: a lobby's Start is the consent** ("Lobbies" below). When a lobby of 2+ finishes its countdown, LobbyService
calls `RunSessionService.startLobbyRun({ kind: "party", lobbyId, members })`: `RunSessionRegistry.start` for the
first member (join order) with `partyConsent` = the lobby's members, in the ranked world (`RANKED_WORLD_KIND`). The
registry refuses any party (2+ members) whose resolved party is not exactly that list, so a client's `startRun` can
never name a party on its own (members in this server, at most 8, nobody `busy`). Each member's open SOLO session is
then concluded (`abandoned`, they chose to leave it), the registry builds the world for the party
(`buildWorldSetup(kind, seed, { partySize })`: endless scales enemy hp and room budgets with it), the service creates
a `LockstepSession` and fires `partyRunStarted { runId, seed, worldKind, members, lobbyId }` to
every member. A client switches to a party run only when `lobbyId` is the lobby it is in: an unsolicited
`partyRunStarted` is ignored. A client's player index is its place in `members` (owner = 0). No drop-in mid-run.
(The M4 invite flow, `partyInvite` / `partyRespond`, was removed in task L7.)

**Leaving a party run** (`lockstepLeave(runId)`, rate limited by `LOCKSTEP_LEAVE_RATE`): only a member of that live
party run; it does for that run what PlayerRemoving does (`LockstepSession.leave`: the leave bit from the next tick,
dead for the rest of the run; `registry.releaseMember`: no longer `busy`) while the player stays in the server and in
their lobby (still `inRun` until the run concludes). Idempotent (a second call, or a call after a stall drop, does
nothing; a call from a player already leaving the server is dropped). They still get the run's `runFinished`. The
OWNER may leave too: their next `startRun` (Leave run -> main menu -> Play solo) never replaces the party run
(`RunSessionRegistry.start` only closes a solo open session; an unconcluded party run the owner was released from is
just detached from them, and its LockstepSession concludes it for the others), and a party run its owner left does
not count toward their `maxFinishingPerPlayer`.

**Relay** (`relay.ts`, tunables in `config.ts`). The server clock finalizes tick T once real time reaches it (at most
`MAX_SERVER_TICKS_PER_STEP` per Heartbeat). Each player's frame for T is the input they sent for T, else (missed
deadline) a REPEAT of their last finalized frame. Inputs for finalized ticks are late (dropped); further than
`MAX_INPUT_AHEAD_TICKS` ahead, refused; debug bits are stripped unless the session is a debug one. A player who leaves
(or stalls, below) sends `PARTY_LEFT_BUTTON` alone from the next tick on: the sim marks them `left` (dead, never
revived). The server's merged log is the authority: it is what every client steps and what the server validates.

**Clients** (`client.ts`). The sim steps ONLY with merged frames (`lockstepFrames`, delta-coded per player in
`wire.ts`; ~1-4 bytes per player per tick), at most `MAX_CATCHUP_TICKS_PER_FRAME` per rendered frame. After
stepping tick T a client samples its input once and sends it for T + lead (`lockstepInput`, 10 bytes per frame); the
lead starts at `INPUT_DELAY_TICKS` = 3 and grows by one on every missed deadline (seen as its own frame not being what
the server finalized), shrinking again after 10 s without misses; measured in the specs: ~15 ticks at 20-120 ms
one-way, ~25 at 0-200 ms. No pause, no hitstop pacing (`simPacerFor`: hitstop is view-only in co-op), no restart
until the party is down. Not done: visual prediction of the local character (it is drawn at the merged state).

**Desync detection** (`ledger.ts`). Every client reports `hashState` after each tick that is a multiple of
`HASH_REPORT_EVERY_TICKS` (60). Reports are reliable without trusting the transport: the client keeps every report
until the server ACKS it (`lockstepFrames`' `hashAck` = the highest tick the ledger decided) and sends them batched,
ONE `lockstepHash(runId, ticks, hashes)` call per pump at most (`MAX_HASH_BATCH` = 32, oldest first), at most one call
per `HASH_SEND_MIN_SECONDS` (0.25 s) however fast it steps, and resends the unacknowledged ones every
`HASH_RESEND_SECONDS` (2 s): a dropped call (a limiter, a lost packet) is recovered by the next resend, and resends
of decided ticks are harmless. Ticks are decided in order once every present player reported: all
equal = agreed (its consensus hash), any differ = DESYNC (logged `DESYNC run <id> tick <T>: p0=.. p1=.. (diverged:
pN)`; the odd ones out are the minority). Policy: the run ends **unranked** at once (validator aborted with code
`desync`, `runFinished` to every member). A player silent for `HASH_REPORT_TIMEOUT_TICKS` (20 s) past a tick is
dropped from the run like a leaver; stall detection runs on the real server clock even after a final claim, so a
member silent below the claimed final tick is dropped too (marked left from the current tick, past the final: the
claimed run is unchanged). A divergence that heals before the next report (e.g. a 1e-6 drift clamped away
by a wall) is never seen; only lasting differences matter, and those are caught at the next report.

**Validation.** Every `PARTY_SEGMENT_TICKS` (5 min) of AGREED ticks the session offers its own log's slice to the
run's `SegmentedValidator` as a segment (party codec variant, one stream per player) whose claimed end and checkpoint
hashes are the consensus hashes: the server's replay of its own log must reproduce what the clients agreed on
(otherwise `hash_mismatch`). Clients' `submitSegment` / `finishRun` are ignored for party runs.

**The end.** When a client's sim shows the whole party down (`isPartyWiped`) it stops and sends its `RunFinal`
(`lockstepFinal`). Once EVERY present member claimed the identical final (tick, hash, summary, score, floor), the last
slice and the final go to the validator; its verdict (the server's replayed score) posts to the **Co-op** board with
the members who contributed (`LeaderboardService`, `boardForParty`, below). Differing claims, a member who does not
claim within `FINAL_CLAIM_TIMEOUT_TICKS` (the relay keeps running meanwhile, so a lying claimant cannot freeze the
others), or no consensus on every checkpoint below the final within `FINAL_CHECKPOINT_TIMEOUT_TICKS` (40 s after the
first claim; logged `no hash consensus below the final tick ...`, instead of waiting for the 30-minute session expiry)
end the run unranked (`desync`). A malformed claim (`runFinalProblem`: NaN / fractional / negative ticks, a bad hash,
any claimed number not a non-negative integer) is refused before it is recorded, so it can neither open the claim
window nor turn into a `bad_final` verdict for the party. Everyone gone: `abandoned`. One griefing member can always
force a run unranked; nobody can make the server post a score it did not replay.

**Co-op credit** (`shared/leaderboard` `partyContributors`). A member CONTRIBUTED when their merged frames never
carried the leave bit before the run's final tick (they were in it until the wipe), or only after the run's first
floor change (they played at least one full floor; the server's replay records that tick,
`SegmentedRunResult.firstFloorChangeTick`). Leavers and stalled players before that are not credited. Only
contributors are written to the Co-op board (the entry's details keep the party size); a party run with fewer than
two contributors is not a co-op post at all (`ineligible:contributors`).

**Combo in co-op.** The score's hit cut divides by the players PRESENT (not left) at the tick of the hit (`max(2, n)`,
sim `presentPlayerCount`; `party.left` is hashed), so a party that lost members is cut as the smaller party it now is.
Solo is unchanged (d = 2).

**In-run progression in co-op** (M2 x M4, `src/shared/sim/README.md` "Co-op"): every member has their own boons,
relics and curses (`run.players[i]`, hashed in the "run" group before "party"). After every floor change each member
still in the run drafts from their OWN three offers with their own input, and the world stays frozen until all of them
have confirmed; the merged log simply carries those draft frames (the stick and a FIRE press), so the server's replay
reproduces every pick and nothing is trusted from a client. A member who leaves mid-draft (`PARTY_LEFT_BUTTON`) has
their draft closed without a pick, so a leaver never holds the party. Relics go to whoever reaches the pedestal first
(player index order on a tie), a shrine's curse to the member who presses SKILL1 in it. Personal effects use that
member's modifiers (their bullets' damage, their i-frames, their Second Wind); the combo window, the hit cut and the
world curses (enemy bullet speed, combo decay) are team-wide and never stack. Not handled: a member who stays connected
but never confirms keeps the world frozen (their repeated frames never press FIRE); there is no draft timeout yet.

**Wire format** (`recordingCodec.ts`): version byte 2 = party recording: byte 1 the player count, then the solo
header fields, the frame count, and one solo-format run stream per player, back to back. A solo recording is still
version 1, byte for byte as before.

**Rates.** Per player: `lockstepInput` `LOCKSTEP_INPUT_RATE` (180 / s); `lockstepHash` `LOCKSTEP_HASH_RATE`
(60 / 10 s: the client sends at most 4 batched calls a second, catch-up at `MAX_CATCHUP_TICKS_PER_FRAME` included,
so 1.5x headroom; a dropped batch is resent anyway); `lockstepFinal` its own `LOCKSTEP_FINAL_RATE` (4 / 10 s: an honest
client sends one per run, so hash traffic can never starve it; a dropped final is logged `FINAL_DROPPED`, a duplicate
is ignored quietly). Measured in the specs: a client frozen for 15 s catches up (8 ticks per frame) and the run
validates ranked with no call refused by any limiter. Bandwidth: 8 players moving cost ~30 bytes per tick down
(~1.8 KB/s per client) and 10 bytes per tick up.

## Lobbies (L2)

Same-server lobbies are how players group up for a run; they replace the M4 invite flow. The model is pure
(`src/shared/lobby/lobbies.ts` `Lobbies`, its header has the rules: visibility open / friends / closed, joins,
invites, host-only kick / visibility / name / transfer / start, ready + countdown, host migration, kick cooldown);
`LobbyService` (`src/server/services/LobbyService.ts`) owns one per server and only wires it:

- **Requests.** Every `lobby*` remote goes straight into `Lobbies` (it shape-checks every client value), per player
  rate limited: `LOBBY_REQUEST_RATE` for all of them except `lobbyInvite` (`LOBBY_INVITE_RATE`) and
  `lobbyRequestList` (`LOBBY_LIST_REQUEST_RATE`, extra calls dropped quietly). A refusal (or a spent budget, code
  `rateLimited`) is a `lobbyNotice { kind: "refused", requestKind: "<remote name>", code, reason }` to the requester.
  `lobbyInvite` also refuses a player who is not in this server (`badRequest`). `lobbyAnswerInvite(id, true)` joins
  the invite's lobby (the join consumes it); `false` declines.
- **Pushes** (`src/shared/lobby/outbox.ts` `LobbyOutbox`, specced: who hears what). After every request, tick and run
  end the service flushes: `lobbyState` (a `LobbyView`: `countdownIn` = seconds left, `invited` = the live invites to
  the lobby) to every member of a changed lobby and `{}` to a leaver; `lobbyInvites` (the full list) to each player
  whose received invites changed; `lobbyNotice` for kicks, host changes (`hostChanged` to the new host), countdown
  cancels (a member left / un-readied / became busy / the run could not start, with the reason), invites dropped with
  a lobby (`inviteDropped`) or expired (`inviteExpired`); invites a player dropped by joining or creating a lobby
  themselves are silent. `lobbyList` (per viewer `summariesFor`, never closed lobbies) goes to EVERY player, coalesced
  behind a dirty flag to one round per `LOBBY_SERVICE.listPushSeconds` (0.5 s). PlayerAdded and `lobbyRequestList` get
  the current list, state and invites at once.
- **Clock.** Heartbeat runs `Lobbies.tick` every `LOBBY_SERVICE.tickSeconds` (0.25 s): due countdowns, invite expiry,
  kick cooldowns.
- **Friends** (`src/shared/lobby/friendCache.ts` `FriendCache`, specced with an injected fetcher). `areFriends(a, b)`
  answers from a per-pair cache and never waits: a miss is false and schedules `Player:IsFriendsWithAsync` in the
  background (pcall; at most `FRIEND_CACHE.maxConcurrentFetches` at once; a failure counts as not friends and is
  retried after `retrySeconds`; a known answer is refreshed after `refreshSeconds`). A landed answer that changed marks
  the lists dirty. Pairs with a new player are prefetched on PlayerAdded and forgotten on PlayerRemoving.
- **Busy** = `RunSessionService.busyReason` (a member of an unconcluded party run, or playing the first-run tutorial:
  "Onboarding (tutorial)" below). A player in a solo run is NOT busy:
  they can be invited and join (their client shows a badge); a party start abandons their solo run.
- **Run handoff.** A due countdown hands the run to `RunSessionService.startLobbyRun(start)`. Party: the run is created
  and announced (`partyRunStarted` with `lobbyId`, "Co-op lockstep" above). Solo (one member): the client gets
  `lobbyRunStart { lobbyId, kind: "solo" }` and starts a ranked run itself (`startRun`); the server binds that player's
  NEXT ranked session start to the lobby (`src/shared/lobby/runTracker.ts` `LobbyRunTracker`). A refused start
  (a member left, `busy`, ...) sends the lobby straight back to `forming` with a countdownCancelled notice.
- **Run end.** `RunSessionService.onLobbyRunEnded(lobbyId)` fires when the lobby's run is over and LobbyService calls
  `Lobbies.runEnded` (back to `forming`, Ready cleared): the run session concluded with ANY outcome (accepted, rejected,
  desync, expired, a solo restart's `abandoned`); for a solo lobby run also when the player leaves the server, or when
  no ranked start came within `LOBBY_SERVICE.soloStartTimeoutSeconds` (30 s). A party run goes on when members leave
  (the server or the run, `lockstepLeave`); the lobby stays `inRun` until it concludes.
- **Leaving the server**: `Lobbies.playerRemoving` (leaves the lobby, drops the invites they received; the ones they
  sent stay) and the pushes it causes.

Not done yet: the `followed` notice (a friend followed a player into a closed lobby).

## Leaderboards (M5)

Two all-time boards, **Solo** (party of 1) and **Co-op** (party of 2..8). Only runs ACCEPTED by segmented validation
post, with the score and floor of the server's replay (`LeaderboardService.post`, rules in `shared/leaderboard`).

Eligibility (`leaderboardEligibility`, `LEADERBOARD_POLICY`): world kind in `LEADERBOARD_ELIGIBLE_WORLDS`
(`["endless"]`: the unscored M1 run never posts), not a debug session (Studio debug attributes / boss door), not Studio
(`postFromStudio: false`), not a VIP server (`PrivateServerOwnerId !== 0`; reserved servers may post), and the run
ended (`postAbandoned: false`): in `deathOnlyWorlds` (`["endless"]`) only a death (the whole party wiped) ends a run -
a boss kill there is one floor of the descent, so R after a boss is an abandoned run and never posts; in other worlds a
death or the boss kill. "Leave run" in a solo run is a death (L6a: `LiveRun.requestForfeit()` records one tick with
`FORFEIT_BUTTON`, the replay kills the player there), so it posts; a run simply dropped without it stays abandoned. A party run also needs 2+ contributors (`ineligible:contributors`, "Co-op credit" above). The
verdict's `leaderboard` field says `queued` or `ineligible:<reason>`.

**Ordered value** (`orderedValue.ts`, layout `ORDERED_VALUE_LAYOUT`): one integer per entry, higher ranks first:

```
value = (score * 2^10 + floor) * 2^16 + (2^16 - 1 - timeSlot)      timeSlot = floor((at - 2026-01-01Z) / 7200 s)
         27 bits      10 bits    16 bits                           53 bits in all: exact in a double, < 2^53
```

So score first, then the deeper floor, then the EARLIER submission (inverted time); runs in the same 2-hour slot with
equal score and floor tie by key. Each field clamps (score < 134,217,728, floor < 1,024, slots until ~2041), never
overflowing into its neighbour. Rebalance the bits in `ORDERED_VALUE_LAYOUT` once scoring exists (old entries would
need re-encoding: bump the store names).

**Personal best** (`postPersonalBest`): one entry per player per board, replaced only by a strictly higher ordered
value (higher score; equal score and deeper floor; never a later equal run). A co-op run queues one write per member
to the co-op board. Both checks run inside UpdateAsync, so two servers never lower a best; a retry after a half-done
write (ordered written, details failed) still writes the details.

| DataStore | Kind | Key | Value |
| --- | --- | --- | --- |
| `LB_Solo_v1`, `LB_Coop_v1` | OrderedDataStore | `u_<UserId>` | the ordered value (no userIds tag: ordered stores take none; the key names the player) |
| `LB_Details_v1` | DataStore | `solo_u_<UserId>`, `coop_u_<UserId>` | `{ v: 1, value, score, floor, partySize, members: [{ userId, name, classId? }], at, runId, worldKind }`, tagged `[UserId]` |

Budgets: writes go through `LeaderboardWriteQueue` (at most `LEADERBOARD_WRITE_RATE` = 20 jobs per 60 s per server,
coalesced per player + board keeping the best, failed writes retried with backoff 2 s doubling to 60 s, 5 tries).
BindToClose (`flushOnShutdown`, pure, tested against a fake clock): for up to `LEADERBOARD_SHUTDOWN_FLUSH_SECONDS`
(20 s) in all it waits for runs still validating that may post (RunSessionService's finals replaying and party runs
collecting claims, `setPendingPosts`) and drains the queue in a loop (rate and backoff ignored, failed writes retried)
until nothing is queued, in flight or validating, so posts that arrive during the flush are written too; what the
deadline cuts off is logged (`FLUSH_INCOMPLETE` with counts). Reads: the top 100 per board with one `GetSortedAsync` per board per
`LEADERBOARD_CACHE_SECONDS` (60 s), shared by concurrent callers (`SharedTtlCache`), names via
`UserService:GetUserInfosByUserIdsAsync` (cached for the server's life); score and floor are decoded from the ordered
value, so rows cost no details reads. The caller's own best is one details `GetAsync` (cached 60 s, dropped when they
post: an invalidate during a load in flight wins - a generation counter keeps that load's value from being cached as
fresh, so the next read fetches again). A failed read serves the last one marked stale.

Rank: shown when the player is in the top 100. OrderedDataStore has no rank-of-key query, so "around me" would mean
paging the whole board; not offered.

Client: B (`LEADERBOARD_KEY`; N is the endless debug floor skip, L / F8 the debug replay check, O the settings) or
Leaderboards in the pause overlay opens the panel
(Solo / Co-op tabs, top 100, my best); the run pauses while it is open (`LeaderboardController`,
`client/ui/hud/LeaderboardPanel.tsx`).

## Replay capacity (`src/shared/run/replay.bench.spec.ts`)

The server replays every live ranked run in real time (one live SimState per run, segment by segment), so the replay's
cost per tick bounds how many live players one server can verify. The bench measures one replayed tick (stepRecorded's
work: `step` / `stepParty` + `RunTelemetry.observe`, plus `hashState` at every 600-tick checkpoint) on endless floor
15 at Depth 3, players standing in the floor's busiest room while its enemies fight at full strength (nobody killed,
hearts topped up), headless under Lune (a pessimistic host: no Luau fast paths or native codegen in the sandbox, see
`bench.spec.ts`). Three runs of each case on the build machine (ranges):

| Case | Actors | Enemy bullets | ms per replayed tick | ms of replay per second of play |
| --- | --- | --- | --- | --- |
| solo, one room (the typical fight) | 16 | 50 | 0.19-0.21 | ~12 |
| 8 players, one room | 17 | 107 | 0.54-0.60 (0.07 per player) | ~34 per party (~4 per player) |
| solo, whole floor entered (64 = MAX_ACTORS) | 64 | 73 | 0.72-0.77 | ~44 |
| 8 players, whole floor entered | 64 | 111 | 0.98-1.17 (0.12-0.15 per player) | ~65 per party (~8 per player) |

`hashState` itself costs 2-8 ms per checkpoint (amortized ~0.01 ms per tick).

Boost drops (docs/BOOSTS.md B4, measured on a slower host than the table above, with / without drops): solo one room
0.28-0.33 / 0.27-0.30, 8 players one room 0.59-0.74 / 0.60-0.76, solo whole floor 0.37-0.41 / 0.39-0.41, 8 players
whole floor 1.06-1.14 / 1.08-1.20 ms per tick: no measurable cost (the bench kills nothing, so it covers the per-tick
step and the hash group; a kill adds at most two rng draws).

**Capacity estimate.** Replays share ONE queue (`REPLAY_CONCURRENCY` = 1) whose holder yields after every 4 ms of work
(`REPLAY_BUDGET_SECONDS`), i.e. at most ~4 ms per 60 Hz frame = ~240 ms of replay per second of wall time. With the
headless numbers that verifies, in real time:

- solo players in typical fights: 240 / 12 = **~20 live players**; all on fully entered deep floors: 240 / 44 = **~5**
- 8-player parties: 240 / 34 = **~7 parties (~56 players)** in typical fights; 240 / 65 = **~3.5 parties (~28)** worst

Roblox runs the same bytecode with the builtin fast paths on (~1.8x faster than this host, bench.spec.ts), so expect
roughly 35 solo players typical / 10 worst per server. Past that the replay falls behind: segments queue up, verdicts
arrive later, and a run whose unreplayed backlog reaches `MAX_PENDING_SEGMENT_TICKS` (20 min of play) is rejected
(`backlog_full`). Raising `REPLAY_BUDGET_SECONDS` buys capacity at the cost of server frame time; party runs are the
cheapest per player.

**Fairness.** A queue turn replays at most one segment and at most `REPLAY_TURN_MAX_TICKS` (1,800 ticks = 30 s of play:
~0.4-2 s of CPU at these costs, spread over frames by the budget) of it (`replayTurn`); a longer segment (up to 10 min
for a solo fallback cut, 5 min for party slices) resumes on the session's next turn, behind the runs that queued
meanwhile, so one long segment no longer holds every other player's verdicts for its whole replay.

## Telemetry (AnalyticsService)

Derived server-side from each **accepted** run's replay (`RunTelemetry` observes every tick: the web build's
`PlaytestTelemetry.observeTick` + `DEFAULT_TAPS`), so a client cannot forge it. Rejected runs only log `RunRejected`.
Per player, the session's accepted runs are summarized on leave (`summarizeRunSession`, the web build's
`aggregate.mjs` loop: a death followed by another run counts as a retry).

Funnel (`LogFunnelStepEvent`, funnel session id = the run's server-generated `runId`), only the steps reached:

| Funnel | Step | Name | Reached when |
| --- | --- | --- | --- |
| `M1Run` | 1 | `RunStarted` | always |
| `M1Run` | 2 | `FirstKill` | first `enemiesKilled` event |
| `M1Run` | 3 | `BossEngaged` | `bossEngaged` |
| `M1Run` | 4 | `BossPhase2` | boss phase 2 seen |
| `M1Run` | 5 | `BossPhase3` | boss phase 3 seen |
| `M1Run` | 6 | `BossDefeated` | `bossDefeated` |

Roblox treats skipped intermediate steps as completed (a run that reaches the boss without a kill counts `FirstKill`).

Progression (`LogProgressionEvent`): path `ActI`, level 1 `MotherBramble`: `Start` on the first boss engage, `Complete`
on the boss kill, `Fail` (field 1 = death cause) when the player died after engaging.

Custom events (`LogCustomEvent`; fields are `CustomField01..03`):

| Event | Value | Field 01 | Field 02 | Field 03 | When |
| --- | --- | --- | --- | --- | --- |
| `RunEnded` | seconds alive | end reason (`death` / `victory` / `abandoned`) | `phase0`..`phase3` (highest boss phase) | death cause (archetype id, `unknown`, `none`) | every accepted run |
| `RunDuration` | seconds of sim time (incl. after death) | | | | every accepted run |
| `PlayerDeath` | seconds survived | death cause (archetype of the last hit) | `boss` / `rooms` | | the player died |
| `RunKills` | kills | | | | every accepted run |
| `HitsTaken` | hits from that source | source archetype id (or `unknown`) | | | one per source hit by |
| `HeartsLost` | half hearts lost | | | | every accepted run |
| `WeaponSwaps` | swaps | | | | every accepted run |
| `FlasksUsed` | flasks | | | | every accepted run |
| `EmbersUsed` | Embers | | | | every accepted run |
| `RollsStarted` | rolls | | | | every accepted run |
| `BossAttempt` | boss engages | outcome (`victory` / `death` / `abandoned`) | | | boss engaged |
| `RunRejected` | 1 | reject code | | | a rejected submission |
| `SessionEnded` | seconds alive in the session | `retried` / `quitAfterDeath` / `noDeaths` | | | player leaves after >= 1 run |
| `SessionRuns` | runs | | | | player leaves |
| `SessionRetriesAfterDeath` | deaths followed by another run | | | | player leaves |
| `SessionLongestRetryStreak` | longest died -> retried streak | | | | player leaves |
| `LobbyCreated` | 1 | visibility (`open` / `friends` / `closed`) | | | a lobby is created (host) |
| `LobbyStarted` | lobby size | `solo` / `party` | | | a countdown ends and the run is handed off (host) |
| `LobbyInviteSent` | 1 | | | | a lobby invite is sent (sender) |
| `LobbyInviteAnswered` | 1 | `accept` / `decline` / `expire` | | | an invite is accepted (joined), declined or expires (invitee) |

Lobby events come from `src/shared/lobby/analytics.ts`, logged through `TelemetryService.logEvents(player, specs)`.

Every field value comes from a small fixed set (Roblox: 8,000 combinations, 100 custom event names, 10 funnels).
The web build's per-run markers (`boss.phase`, `boss.engaged`, `boss.defeated`, `player.death`, `run.victory`) and
`event.<field>` counters are kept on `RunTelemetryRecord` for future sinks; they are not all sent.

Not ported (no Roblox counterpart): the post-run screen, the "Fight it again?" answer, retry delay (wall clock), the
JSON session files and F9 export.

## Onboarding (tutorial)

`OnboardingService` (pure parts in `src/shared/onboarding/`; plan in `docs/TUTORIAL.md` §5-6) remembers whether a
player has done the first-run tutorial ("Practice Descent"), logs its funnel, and marks players in it as busy for
lobbies. The client side (TutorialController, T6) only talks to it through these remotes:

| Direction | Event | Payload | Server does | Reply |
| --- | --- | --- | --- | --- |
| server -> client | `onboardingStatus` | `{ loaded: boolean, tutorialDone: boolean }` | sent once the join load ends (success or failure) | |
| client -> server | `requestOnboarding` | none | loads if needed (shares the join read) | `onboardingStatus` |
| client -> server | `tutorialStarted` | none | opens a new funnel attempt (server GUID = funnel session id); `isInTutorial` = true. Ignored from a member of an unconcluded party run (a late message) | none |
| client -> server | `tutorialStep` | `step: number` | integer 1..`TUTORIAL_FUNNEL_MAX_STEP` (16, = shared/tutorial `TUTORIAL_STEP_COUNT`), strictly above the attempt's last. The funnel step name is the server's: that step's id in the shared step list (`tutorialStepName`), never a client string | none |
| client -> server | `tutorialFinished` | `"completed" \| "skipped"` | closes the attempt (`isInTutorial` = false), writes the doc. The client sends `completed` the moment the run freezes (before the outro beat) | `onboardingStatus` |

Every value is re-checked on the server (Flamework's guard checks only the shape), and the remotes are rate limited
per player: `ONBOARDING_REQUEST_RATE` (10 per 10 s for request / started together), `TUTORIAL_FINISH_RATE` (10 per
10 s, its own budget so other traffic never drops the finish) and `TUTORIAL_STEP_RATE` (30 per 10 s). A dropped
request or finish still answers with the cached status; a dropped finish still closes the attempt (not recorded).

**Doc** (DataStore `KV_Onboarding_v1`, key `u_<UserId>`, `PlayerDocCache` like settings: load on join with 3 retries,
save when dirty on leave / `BindToClose` / every 120 s, writes tagged with the UserId):
`{ v: 1, tutorialVersion, outcome, at }`. `tutorialDone = tutorialVersion >= ONBOARDING_TUTORIAL_VERSION` (1; bump it
to offer a rewritten tutorial again). `tutorialFinished` writes `{ tutorialVersion: ONBOARDING_TUTORIAL_VERSION,
outcome, at: os.time() }` (a replay overwrites outcome and time). Anything missing or malformed decodes as the empty
doc (`tutorialVersion: 0`: never played); a bad `at` alone decodes as 0.

**Failure rule.** A failed join load sends `{ loaded: false, tutorialDone: false }`: the client then plays a normal run
and keeps the Tutorial button in the pause menu (a DataStore outage never forces a veteran through the tutorial). The
stored value is never overwritten because of the failure; only a `tutorialFinished` in that session writes (the same
rule as a settings change), after which `loaded` reads true once that save succeeded.

**Trust.** Completion only skips a practice mode and the tutorial is never submitted, so the server records what the
client says; the funnel is the one piece of telemetry taken from the client (bounded as above).

**Funnel** `tutorial` (`LogFunnelStepEvent`, session id = the attempt id): steps 1..16 are the lessons, named by
their ids in `shared/tutorial` `TUTORIAL_STEPS` (objective, move, flask, attack, hits, boost, roll, guard, bow, ember,
relic, curse, stairwell, draft, boss, finish; the client sends only the number), step 17 is `completed`. **Renumbered
2026-10-26**: the `boost` step was inserted as step 6 (docs/BOOSTS.md B9), so roll..finish moved from 6..15 to 7..16 and
`completed` from 16 to 17; funnel data recorded before that is not comparable past step 5 (docs/TUTORIAL.md §6). Each `tutorialStarted` (first run, Restart tutorial, a replay) is a new attempt
counting from 1, so a restart never repeats steps inside one funnel session; steps outside an attempt are dropped. A
**skip is not a funnel step** (Roblox counts every lower step number as reached, which would credit a skipper with
every lesson): it logs the custom event `TutorialSkipped` (value = last lesson step reached in the attempt) and the
funnel shows the drop-off where they stopped. The client reports only leading lessons it PRACTISED (`TutorialDirector`
`funnelStepReached`: done and not skipped), so a lesson left behind (its floor left early) stops the attempt's funnel
there for good; only `completed` (logged on a completed finish) then counts the rest. `TUTORIAL_FUNNEL_MAX_STEP` is the tutorial's step count
(`TUTORIAL_STEP_COUNT`), so a new step moves `completed` with it; never rename or reorder shipped step ids, or the
dashboard funnel splits (inserting a step, as `boost` was, shifts every later number: note the date).

**Lobbies busy.** While `isInTutorial`, the player is busy for lobbies: `RunSessionService.busyReason` (what
LobbyService passes to `Lobbies` as `busyReason`) adds `tutorialBusyReason` to the registry's (an unconcluded party
run), so the same `busy` refusals apply as for a party member: they cannot create or join a lobby or be invited
(`lobby.err.busy`), the host's Start is refused while they are in its lobby, and a countdown whose member started
the tutorial since is cancelled when it ends (`Lobbies.tick`; countdownCancelled notice with the reason).
`startLobbyRun` re-checks every member for the tutorial before the handoff (party and solo), so a lobby never pulls a
player out of it. A player already in a lobby who starts the tutorial (main menu -> Tutorial) stays a member; the
lobby just cannot start until they finished or skipped. A party run that does start ends every member's tutorial
attempt (`leaveTutorial`, unlogged: their clients switched runs), and a late `tutorialStarted` from a member of an
unconcluded party run is ignored (`setPartyRunCheck`), so nobody stays busy by mistake. The tutorial world itself is
in `SERVER_REFUSED_WORLDS`: every `RunSessionRegistry.start` (ranked `startRun`, lobby party and solo starts) answers
`unknown_world` for it.

**Studio only:** the Workspace attribute `KV_ResetOnboarding = true` resets each joining player's loaded doc to empty
(logged `[Onboarding] RESET`; saved like any change, never after a failed load), so every Studio join is a first join.
Without API access the load fails (`[Onboarding] LOAD_FAILED`) and the tutorial is not forced.

## DataStores

| DataStore | Key | Value | Written |
| --- | --- | --- | --- |
| `PlayerSettings` | `u_<UserId>` | settings document v2 `{ v: 2, juice, controls, audio, display }` (only what the player changed; v1 `{ v: 1, juice }` migrates on read) | when dirty: on leave, on `BindToClose` (parallel, 25 s budget), every 120 s |
| `KV_Onboarding_v1` | `u_<UserId>` | `{ v: 1, tutorialVersion, outcome: "completed" \| "skipped", at }` (see "Onboarding (tutorial)") | when dirty: on leave, on `BindToClose`, every 120 s |
| `Runs` (off: `RUNS_DATASTORE_ENABLED = false`) | `u_<UserId>` | the last 50 accepted runs `{ id, seed, hash, ticks, kills, boss, died, at }` (UpdateAsync) | on each accepted run |

Every write is tagged with the owner's UserId (`SetAsync`'s `userIds`, UpdateAsync's second return value), for
erasure requests: the cache passes the `userIds` given to `load(key, userIds)`; the Runs store passes `[userId]`.

Every call retries 3 times with backoff (1 s, 2 s) (`withRetries`). Settings are cached for the session; if the load
fails the session runs on defaults and the stored value is not overwritten unless the player changes something. Last
write wins (no session lock: settings are low value). Settings never reach the sim (key bindings only change which
device inputs make the InputFrame).

Concurrency in `PlayerDocCache`: a `load` while the same key is loading waits for that read (the join load and an
early `requestSettings` make one `GetAsync`); a `save` while the same key is saving waits for it and writes only if
the document is still dirty (the leave save and the `BindToClose` save never both write). Waiters are resumed with
`task.spawn`. After any yield, a settings handler drops the player's entry instead of using it if they left meanwhile.

Juice settings semantics are the web build's (`src/fx/settings.ts`): defaults `healthBars: onDamage`,
`damageNumbers: true`, `freezeFrame: true`, `particles: normal`, `reducedMotion: <system>`. The client resolves the
stored overrides with `resolveJuiceSettings(overrides.juice, GuiService.ReducedMotionEnabled)`; reset clears them
(back to the system setting).

### Settings document v2 (task L4, `src/shared/settings/doc.ts`)

`{ v: 2, juice, controls, audio, display }`, every group overrides-only (an empty group is stored as `{}`):

| Group | Type | Sanitized by | Holds |
| --- | --- | --- | --- |
| `juice` | `JuiceOverrides` | `sanitizeJuiceOverrides` | as v1 |
| `controls` | `ControlsOverrides` (shared/play bindings.ts) | `sanitizeControlsOverrides` | per device, the actions whose inputs differ from `DEFAULT_BINDINGS`; unknown / reserved inputs, unknown actions, values equal to the default and any override that would bind an input twice are dropped, so applying it always gives a valid layout |
| `audio` | `AudioOverrides` | `sanitizeAudioOverrides` | `master` / `music` / `sfx`, whole percents 0..100 (default 100) |
| `display` | `DisplayOverrides` | `sanitizeDisplayOverrides` | `hudScale`, one of `HUD_SCALE_PERCENTS` (80 / 90 / 100 / 110 / 125, default 100) |

Versions (`decodeSettingsDoc`): **v1** `{ v: 1, juice }` migrates (its juice kept, the other groups empty; anything
else in it is ignored); it stays v1 in the DataStore until the player changes something (a clean document is not
written), then it is written as v2. **v2** reads as is (sanitized). **Any other version** (a newer server's document,
a missing `v`, garbage) reads as no overrides, as before; if that player then changes something, the document is
overwritten as v2 (last write wins, unchanged from v1). Patches (`applySettingsPatch`): each group present replaces the
stored group after sanitizing; absent groups are kept. The Flamework guard checks the payload's shape (every group and
field optional, slots as 1- or 2-string tuples); the sanitizers check values.

## Testing

Headless (`npm test`): `src/shared/run/*.spec.ts`, `src/shared/sim/recordingCodec.spec.ts`,
`src/shared/play/submitPolicy.spec.ts` and `src/shared/settings/settings.spec.ts`.

- The slice (`src/shared/run/slice.spec.ts`, on the recorded seed-1337 endless run of `shared/run/testing`): the
  scored run replays twice to the live hash and score; floor(1000 x floor x rooms cleared / enemy rooms) per floor
  cleared (the boss counting as a room on a boss floor) at the Depth in force; the boss
  kill scored at Depth 1 (5000 x combo, no-hit bonus rule) with Depth 2 after it; a ranked LiveRun cutting a segment
  per floor validates through `SegmentedValidator` (debug input allowed) to the same final hash with
  `readRunScore` = the replayed score, trimming verified frames as it goes; an edited frame in the floor-6 segment
  rejects the run at that segment (`hash_mismatch`, located to its checkpoint window).

- Every run fixture round-trips through the binary codec exactly (frames, seed, spawn; re-encodes byte for byte) and
  validates over the binary path with its fixture hash: `run-player`, `run-player-dungeon-1337`, `run-full-1337`,
  `run-boss-1337` through `validateRun`, `run-bullets` (greybox + stress, which `buildRunConfig` never builds) through
  `runReplay` of the decoded recording.

- `run-player.json` (greybox, dev limits because its schedule presses `DEBUG_HIT`) validates with the web build's
  final hash `03c59442`; under live limits it is rejected as `debug_input`.
- `run-player-dungeon-1337.json` validates under live limits on the seed-1337 floor (`11838a2d`).
- Tampering: a flipped button bit (SWAP, ROLL) or a nudged move axis on one frame, a forged hash, a lying summary, a
  wrong seed (`seed_mismatch`, or `spawn_mismatch` / `hash_mismatch` when re-seeded consistently), a moved spawn,
  oversize (`too_large`, `too_long`, an RLE bomb), debug bits, a boss-door start, malformed buffers, a JSON string:
  each rejected with its code and reason.
- The replay budget (`ReplayBudget` with a fake clock), the queue (`WorkQueue` driven with coroutines: order, limit,
  errors), the submit rules, and the cache's load / save sharing (coroutine-driven store that yields like a DataStore).
- Telemetry is checked against the web build's recorded event streams of all four run fixtures (totals, hits by source,
  death / engage / phase ticks), and the server replay of `run-player.json` gives the same record.

Studio (needs the engine; not covered headlessly): remotes and their Flamework guards (including a `buffer` crossing
the remote), the services' wiring, DataStore calls (`userIds`), BindToClose, AnalyticsService (including events for a
player who left while their run validated), yielding replays and the queue under several players.

1. Game Settings > Security: enable **Studio Access to API Services** (DataStores; without it the settings load fails
   and the session runs on defaults, logged as `[Settings] LOAD_FAILED`).
2. Push a fixture through the real service (Play, switch the command bar to the Server, one player in game). This
   example uses the player-only world (Studio-only attribute); drop the attribute and use `run-full-1337` for the
   full game:

   ```lua
   workspace:SetAttribute("KV_RunValidationWorld", "dungeonNoEncounter")
   local Flamework = require(game.ReplicatedStorage.rbxts_include.node_modules["@flamework"].core.out).Flamework
   local svc = Flamework.resolveDependency("server/services/RunValidationService@RunValidationService")
   local fx = require(game.ReplicatedStorage.TS["fixtures-generated"]["run-player-dungeon-1337"]).default
   local sim = require(game.ReplicatedStorage.TS.sim)
   local sub = { seed = fx.seed, atBossDoor = false,
                 recording = sim.encodeRecording(sim.deserializeRecording(fx.recording)),
                 claimedHash = fx.finalHash, claimed = { ticks = fx.ticks, kills = 0, bossDefeated = false, died = false } }
   local v = svc:submit(game.Players:GetPlayers()[1], sub)
   print(v.ok, v.code, v.reason, v.serverHash)          --> true nil nil 11838a2d
   sub.claimedHash = "deadbeef"; print(svc:submit(game.Players:GetPlayers()[1], sub).code)  --> hash_mismatch
   ```

   The output shows `[RunValidation] ACCEPTED ...` / `REJECTED ...`, and accepted runs log their analytics events.
   A seventh call within a minute answers `rate_limited`. Remove the attribute afterwards (live servers ignore it).
   (Fixtures are only in the test place; `npm run build:place` leaves them out.)
3. Debug runs (K / J, boss door) need the Workspace attribute `KV_AllowDebugRuns = true` (Studio only).
4. Once task 8 builds the client's network module, play a run and check the client receives `runVerdict` with
   `ok = true`; then edit one recorded frame before sending and check `hash_mismatch`.
5. AnalyticsService events from Studio sessions are not recorded; check them in the Creator Hub analytics of a
   published place (custom events appear after a delay). In Studio, a failing call logs `[Telemetry] ANALYTICS_FAILED`.
6. Settings: fire `updateSettings`, leave, rejoin: `settingsChanged` brings the change back. Stop the server with a
   dirty setting to exercise `BindToClose`. v1 migration: with Studio API access, write a v1 value from the command
   bar (`game:GetService("DataStoreService"):GetDataStore("PlayerSettings"):SetAsync("u_<your UserId>", { v = 1,
   juice = { particles = "low" } })`), join: Options > Juice shows Particles Low; rebind a key, leave: the stored
   value is now `{ v = 2, juice = { particles = "low" }, controls = { kbm = { ... } }, audio = {}, display = {} }`.

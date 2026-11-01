# Tutorial analytics funnel: plan

Goal: see **where new players drop out between joining and their first real run, and why**: not just which lesson
they last finished, but how long each lesson took, where they got stuck, whether they quit the game or skipped, and
whether finishing the tutorial makes them more likely to play a ranked run and come back.

Work it task by task, like `PLAN.md`; each task ends with a **Verify**. Decisions TFD1-TFD10 are proposed defaults
for the owner to confirm.

**What changes where.** Telemetry only: no sim, dungeon, lockstep, hash, replay or fixture change. Server
(OnboardingService, TelemetryService, two new hooks on run starts / accepted runs), pure shared code
(`shared/onboarding`, `shared/tutorial`), a few remote payloads and client calls in TutorialController. Three optional
fields join the onboarding doc (no version bump, like `seen`).

## Status (2026-11-01)

**Plan only.** Nothing built. TF0 (published-place spike) gates the onboarding funnel call's exact signature.

## What the code gives us today (read on `main` @ `62b5263`)

| Fact | Where | Consequence |
|---|---|---|
| A recurring funnel `tutorial` (`LogFunnelStepEvent`, session id = a server GUID per attempt), steps 1..16 = lessons, 17 = `completed` | `shared/onboarding` `funnel.ts` `TutorialFunnelTracker`, `TelemetryService.logTutorial` | Per-lesson drop-off exists, but see the gaps below |
| The client reports only leading lessons it **practised** (`TutorialDirector.funnelStepReached`); the server re-names steps from `TUTORIAL_STEPS` and keeps them strictly increasing per attempt | `shared/tutorial` director, `OnboardingService` | Keep: it is the right trust model for a practice mode |
| A skip logs custom `TutorialSkipped` (value = last step) instead of a funnel step | `funnel.ts` | Keep the idea; add fields |
| Every attempt (first join, Restart tutorial, a menu replay, Play again) is the same funnel | `tutorialStarted()` has no payload | First-time players and veterans replaying are mixed in one chart |
| A player who **leaves the game** mid-tutorial: the attempt is cleared silently (`release` -> `clear()`) | `OnboardingService`, `TutorialFunnelTracker.clear` | Quitting the game and closing the tab look the same as "still in step N" |
| Step 1 is `objective` = the objective card **dismissed** | `TUTORIAL_STEPS` | A player who joins and leaves on the loading screen or the card never enters the funnel: the worst drop-off is invisible |
| The first-join gate decides tutorial / normal (KV_Tutorial, onboarding status, timeout, invite / party `joinIntent`) on the client and logs nothing | `shared/view/menu` `firstJoin.ts`, `TutorialController` | We cannot tell how many new players were routed past the tutorial, or why |
| Run telemetry is server-derived from the validated replay (`analyticsForRun`), per run, not per player history | `shared/run` `analytics.ts`, `TelemetryService` | The "did the tutorial convert" question needs a per-player new-player window |
| Roblox: **onboarding funnels** (`LogOnboardingFunnelStepEvent`) count once per user; recurring funnels need a session id and only the 10 most recent session ids per user count | create.roblox.com funnel events | First-time experience belongs in the onboarding funnel; attempts in a recurring one |
| Roblox: logging step N **auto-completes every lower step**; a repeated step counts only its first instance | same | Never put a step after the tutorial that skippers and invitees can reach (it would credit them with every lesson) |
| Roblox: funnel **filters apply to step 1 only**; breakdowns by age, gender, platform, OS and custom fields | same | Everything we want to segment by (entry, revision) goes on step 1's custom fields |
| Roblox limits: 10 funnels, 100 steps per funnel, 100 custom event names, 3 custom fields (strings), 8,000 field values before "Other", `120 + 20 x CCU` requests per minute game-wide; server only, published places only; charts after ~24 h | event-types, custom-fields docs | A name / field budget spec (TF1) and a debug echo for Studio (TF8) |

## Questions this answers (and the chart that answers them)

| Question | Chart (Creator Hub) |
|---|---|
| Of new players who join, how many start the tutorial, finish it, quit mid-way, skip? | Onboarding funnel, filter `entry = organic` |
| Which lesson loses the most new players? | Onboarding funnel steps 4-19 (step-to-step conversion) |
| How long does each lesson take? Which run long? | `TutorialLessonTime`, Average value, breakdown field01 (lesson) |
| Where do players get stuck (prompt shown, nothing happening)? | `TutorialStuck`, Count unique user + Average value by field01 |
| Do players struggle in a lesson (many harmless hits)? | `TutorialLessonHits`, Average value by field01 |
| Where do players skip vs quit the game? | `TutorialSkipped` / `TutorialAbandoned`, Count by field01 (step) |
| Is the tutorial worse on touch / gamepad? | Onboarding funnel breakdown by platform; lesson events by field03 (device) |
| How many new players were routed past the tutorial, and why? | `OnboardingGate`, Count by field01 |
| After the outro, do they start a run, replay, or leave? | `TutorialOutroChoice` by field01 |
| Do finishers play more ranked runs and come back more than skippers? | `NewPlayerRun` / `NewPlayerReturned` by field01 (tutorial outcome) |
| Did a tutorial rewrite help? | Onboarding funnel filtered by field02 (revision) |

## Design

### 1. Three layers

```
Onboarding funnel (once per user, first-join only)   Joined -> Loaded -> TutorialStarted -> 16 lessons -> Completed
Attempt funnel  `TutorialAttempt` (every attempt)    started -> 16 lessons -> completed           (replaces `tutorial`)
Custom events                                        lesson time / hits / stuck, skip, abandon, restart, outro,
                                                     gate, new-player runs and return
```

The onboarding funnel is **the** new-player chart. The attempt funnel keeps per-attempt detail for restarts and
replays. Custom events carry the "why" (time, struggle, exit kind) and the post-tutorial conversion, which can never
be funnel steps (auto-complete, TFD4).

### 2. Onboarding funnel (`LogOnboardingFunnelStepEvent`)

Steps (`ONBOARDING_FUNNEL_STEPS` in `shared/onboarding`; names <= 32 chars):

| # | Name | Source | Logged when |
|---|---|---|---|
| 1 | `Joined` | server | a **fresh** player (onboarding doc loaded, empty: TFD2) joined, once the server knows the entry (`joinIntent` resolved, or the player left first: `unknown`). Fields below |
| 2 | `Loaded` | client report | the join loading screen released (`LoadingController`: core tier, Skip or timeout) |
| 3 | `TutorialStarted` | server | `tutorialStarted({ entry: "firstJoin" })` while the doc is not done |
| 4-19 | the 16 lesson ids (`objective` .. `finish`) | client report (as today) | lesson step n reached = onboarding step n + 3 |
| 20 | `Completed` | server | `tutorialFinished("completed")` while the doc is not done |

- **Open while not done.** Steps 2-20 are logged only while the player's doc says the tutorial is not done (the same
  test as the gate). A skip or a completion closes it for good; a leave does not (they get the tutorial again next
  join, and that session keeps filling the same once-per-user funnel; repeated steps count once). A later replay from
  the main menu never touches it.
- **Step 1 fields** (filters only work on step 1): field01 `entry` = `organic` / `invited` / `party` / `unknown`
  (from the server's `joinIntent`), field02 `revision` = `t<ONBOARDING_TUTORIAL_VERSION>r<TUTORIAL_FUNNEL_REVISION>`
  (a new constant bumped whenever lesson steps are added, removed or reordered: filter by it instead of reading dates,
  the `boost` renumbering problem), field03 reserved for an experiment arm (`none` until one exists).
- **Bypassed players** (invited / party arrivals, TFD3) log `Joined` only. Their gate reason goes to `OnboardingGate`.
  Filter `entry = organic` for the clean tutorial funnel.
- **Failed load**: nothing (we do not know if they are new).

### 3. Attempt funnel `TutorialAttempt` (replaces `tutorial`, TFD5)

`LogFunnelStepEvent`, session id = the attempt GUID (as today). Step 1 `started` (server, on `tutorialStarted`), steps
2-17 the lessons, 18 `completed`. Step 1 fields: field01 `entry` = `firstJoin` / `restart` / `menu` / `again`
(the outro's Play again), field02 `revision`, field03 `device` (`keyboard` / `gamepad` / `touch`, the
`InputDeviceKind` at start). `TutorialFunnelTracker` keeps its filter; it gains the step offset and the start fields.
The old `tutorial` funnel stops logging (its tab can be removed; history stays 90 days).

### 4. Custom events

Every field value comes from a fixed set (TF1 checks it). Step ids are the `TUTORIAL_STEPS` ids; `entry` is the
attempt entry; `device` the attempt's device.

| Event | Value | Field01 | Field02 | Field03 | When / source |
|---|---|---|---|---|---|
| `TutorialLessonTime` | seconds the step was current until done, real time, pause excluded, clamped 0..900 | step id | entry | device | each lesson done (client report, once per step per attempt) |
| `TutorialLessonHits` | harmless hits taken while the step was current | step id | entry | device | same report, only when > 0 |
| `TutorialStuck` | seconds on one prompt with no progress (>= `TUTORIAL_FUNNEL.stuckSeconds`, 20) | prompt id (`guardHold`, `follow`, lesson prompts) | entry | device | at most once per prompt per attempt (client report) |
| `TutorialSkipped` (kept) | last step reached | current step id when skipped | entry | device | skip (server, on `tutorialFinished("skipped")`) |
| `TutorialAbandoned` | last step reached | current step id | entry | `leave` / `partyRun` | the attempt was open when the player left the game, or a party run took it over (`leaveTutorial`) (server) |
| `TutorialRestarted` | last step reached | current step id | | | `tutorialStarted({ entry: "restart" })` while an attempt is open (server) |
| `TutorialOutroChoice` | seconds on the outro: a choice uses the client's seconds the card was open (clamped 0..3600); `left` uses the server's time from the `completed` finish, which includes the outro beat before the card, so a `left` can fire before the card was seen | `firstRun` / `again` / `menu` / `left` (left the game on the outro) | entry | | the outro closed (client report; `left` server-side on leave) |
| `OnboardingGate` | 1 | `tutorial` / `invited` / `party` / `done` / `loadFailed` / `timeout` / `forced` | | | the first-join choice dispatched, once per session (client report; reason checked against the server's own doc and intent where it can) |
| `NewPlayerRun` | run number (1..`NEW_PLAYER.runs`, 3) | tutorial outcome (`completed` / `skipped` / `none`) | run end (`death` / `abandoned` / `victory`) | floor bucket (the Daily's: `1` / `2-4` / `5-9` / `10-14` / `15-19` / `20+`) | an accepted ranked run of a player still in the new-player window (server-derived, TFD8) |
| `NewPlayerRunStarted` | run number | tutorial outcome | | | a ranked session start in that window (server; catches runs that never validate) |
| `NewPlayerReturned` | whole days since first join (1..7) | tutorial outcome | | | the first join on a later UTC day, within 7 days (server, once per player) |

"Current step id" is the director's current step (`TutorialView.stepId`), sent with the finish / lesson reports and
kept on the server's attempt; the server only accepts ids from `TUTORIAL_STEPS`.

### 5. Client: `TutorialMetrics` (pure, `shared/tutorial`)

Fed by the director each frame (same inputs; `dt` is the real frame time, not called while paused). Per step: the
seconds it was current, harmless hits while current (`state.tutorial.harmlessHits` deltas), and a stuck clock that
resets on any progress fact (a lesson done, a room entered, a kill, a flask, a guard cancel; the director already reads
them). Output: `newLessonReports[]` and `newStuckReports[]` per frame, like `newFunnelSteps`. Deterministic for a frame
sequence, so the tutorial bot pins the numbers (fixed dt).

### 6. Remotes (`shared/network.ts`) and server

| Direction | Event | Payload | Server does |
|---|---|---|---|
| client -> server | `tutorialStarted` (changed) | `{ entry, device }` | as today, plus the attempt's entry / device; `restart` with an open attempt logs `TutorialRestarted` first; `firstJoin` while not done logs onboarding 3 |
| client -> server | `tutorialStep` (unchanged) | `step` | attempt funnel step + 1; onboarding step + 3 while open |
| client -> server | `tutorialLesson` (new) | `{ step, seconds, hits }` | once per step per attempt; integers, clamped; logs the two lesson events |
| client -> server | `tutorialStuck` (new) | `{ prompt, seconds }` | prompt id from the shared prompt list, once per prompt per attempt |
| client -> server | `tutorialFinished` (changed) | `{ outcome, stepId }` | as today, plus the skip / completed events |
| client -> server | `onboardingReport` (new) | `{ kind: "loaded" }` / `{ kind: "gate", reason }` / `{ kind: "outro", choice, seconds }` | once each per session (outro once per attempt) |

The reports share a new `TUTORIAL_REPORT_RATE` (40 per 10 s) apart from the finish budget; `tutorialStarted` has its
own `TUTORIAL_START_RATE` (3 per 10 s: over it the attempt still opens, unlogged, so the player stays busy for
lobbies). Trust (TFD7): the server records what the client says within these bounds, as the funnel does today;
nothing here touches rewards or boards. Lesson reports are taken once per step per attempt in any order (lessons finish
out of order, and the attempt funnel stops at the first skipped lesson, so a "step already reached" rule would drop
honest reports).

Per-player events per first attempt: about 20 onboarding + 18 attempt + ~25 lesson / stuck + 3 = ~66 over ~5 min.
The game-wide budget is `120 + 20 x CCU` per minute, so ~13 per player-minute uses two thirds of one player's share
for those 5 minutes, and run telemetry only fires at run end. TF1's spec caps one attempt at
`TUTORIAL_TELEMETRY.maxEventsPerAttempt` (80). That cap resets with every attempt, so a client looping restarts could
still log hundreds a minute: per player per server session only the first `maxAttemptsLoggedPerSession` (3) attempts
are logged and all attempt events together stay within `maxEventsPerSession` (240, the exit reserve kept); later
attempts open and close unlogged (the once-per-user onboarding funnel, bounded by its once-each rule, still takes their
steps).

### 7. New-player window (server-derived)

Onboarding doc (`KV_Onboarding_v1`, still v1) gains optional `firstDay` (UTC day of the first fresh join),
`newRuns` (ranked runs seen, capped at `NEW_PLAYER.runs`) and `returned` (boolean). Set by OnboardingService;
`NewPlayerRunStarted` from RunSessionService's session start (ranked and daily worlds, solo and party, per member),
`NewPlayerRun` from `RunValidationService.onRunAccepted` (per credited member). Studio and debug runs never count
(`unsubmittedReason`, as the records do). A player who joined before `firstDay` existed has none and is never in the
window.

## Tasks

- [ ] **TF0. Spike (published place).** `LogOnboardingFunnelStepEvent(player, step, name, customFields)`: does it take
  custom fields, do they filter, does the onboarding tab show; `View Events` shows each kind. Record in docs/SPIKES.md.
  -> Verify: one fresh alt account's events in View Events; the signature written down. If custom fields are refused,
  step 1's segmentation falls back to an `OnboardingEntry` custom event (TFD3 note).
- [ ] **TF1. Event catalog.** `shared/onboarding` `analyticsCatalog.ts`: every funnel name, onboarding / attempt step
  list, custom event name and field value set, plus a registry of the existing run / lobby / invite / daily names.
  -> Verify: spec: <= 100 custom event names game-wide, <= 10 funnels, step names <= 32 chars and unique, every field
  value set bounded and the product of every event's sets <= 8,000, the tutorial bot's attempt <= 80 events.
- [ ] **TF2. Doc fields.** `firstDay` / `newRuns` / `returned` in the onboarding codec. -> Verify: codec spec (old docs
  decode, a malformed field decodes empty, round trip).
- [ ] **TF3. Trackers (pure).** `OnboardingFunnelTracker` (open-while-not-done, step offsets, step-1 fields, once per
  session for Joined / Loaded / gate) and `TutorialFunnelTracker` with entry / device / current step / per-step report
  dedupe, plus the event builders. -> Verify: specs: restart inside the first session, a leave and rejoin, a skip
  closes, a menu replay never logs onboarding steps, bypassed players stop at step 1, out-of-range payloads drop.
- [ ] **TF4. TutorialMetrics.** Per-step seconds, hits, stuck clock in `shared/tutorial`. -> Verify: bot spec (in order
  and out of order) pins every lesson's seconds and hits at fixed dt; a pause frame adds nothing; `guardLate` reports a
  `guardHold` stuck when held past the threshold.
- [ ] **TF5. Server wiring.** Remotes, validation, `TUTORIAL_REPORT_RATE`, OnboardingService -> TelemetryService
  (`logOnboarding` via `LogOnboardingFunnelStepEvent`, the attempt funnel rename), abandon on leave and `leaveTutorial`,
  Joined after the intent, docs/SERVER.md rows. -> Verify: `npm run verify`; Studio with `KV_AnalyticsDebug` (TF8)
  shows the expected sequence for a fresh player, a skip, a restart and a leave.
- [ ] **TF6. Client wiring.** TutorialController sends entry / device / lesson / stuck / outro reports and the gate
  reason; LoadingController's release sends `loaded`. -> Verify: Studio, same four paths; nothing sent outside a
  tutorial except `loaded` / `gate`.
- [ ] **TF7. New-player runs.** RunSessionService / RunValidationService hooks, the window, the two events and
  `NewPlayerReturned`. -> Verify: spec on the window rule (pure); Studio with `KV_ResetOnboarding`: three runs log
  1, 2, 3 and a fourth logs nothing.
- [ ] **TF8. Debug echo.** Workspace `KV_AnalyticsDebug` (off by default): TelemetryService prints every spec it would
  send (Studio sends nothing). -> Verify: Output lists each event with fields.
- [ ] **TF9. Dashboard and first read.** Publish, play 3-5 fresh accounts (keyboard, gamepad, phone), build the charts
  in "Questions this answers", write a "Reading the dashboard" section here (sample sizes, the 24 h delay, cohorting).
  -> Verify: every chart shows data.

Critical path: TF0 -> TF3 -> TF5 -> TF6 -> TF9. TF1, TF2, TF4, TF8 run alongside.

## Edge cases

- **Joined before the intent.** A player who leaves during the LaunchData wait still logs `Joined` with `unknown`.
- **KV_Tutorial / dev runs.** A forced tutorial in Studio logs nothing (Studio); in a published place a forced
  first-join run counts as `firstJoin` with gate reason `forced`.
- **Tutorial version bump.** Veterans with an older `tutorialVersion` are not fresh (TFD2): the rewrite is measured on
  new players, filtered by revision; replays show in the attempt funnel's `menu` entry.
- **Lessons out of order.** Unchanged: the funnel only credits leading practised lessons; lesson time / hits are
  reported for every lesson done, in any order.
- **A lesson skipped by leaving its floor** gets no time report; the skip shows as the funnel stopping there.
- **Party run takeover** (a lobby start after the outro is not one: the attempt is closed): `TutorialAbandoned` with
  `partyRun`.
- **Renumbering.** Inserting a lesson bumps `TUTORIAL_FUNNEL_REVISION`; never rename a shipped step id.

## Decisions (proposed defaults, owner to confirm)

1. **TFD1. Onboarding funnel = the first-join tutorial, every lesson in it.** Not a short macro funnel: 20 steps is far
   under 100 and the per-lesson drop-off is the main question.
2. **TFD2. Fresh = onboarding doc loaded and empty** (`tutorialVersion` 0). Not also "no personal record": simpler, and
   every pre-tutorial account is already past onboarding in practice.
3. **TFD3. Invited / party arrivals log `Joined` only** (entry field), not a separate funnel.
4. **TFD4. Post-tutorial conversion is custom events, not funnel steps.** A "first run" step would auto-complete every
   lesson for skippers and invitees.
5. **TFD5. Replace `tutorial` with `TutorialAttempt`** (step 1 `started`) rather than keep the old numbering. Cheap now:
   the tutorial has little published traffic.
6. **TFD6. No sim change.** Struggle is harmless hits, not "half hearts it would have cost" (that needs a hashed field).
7. **TFD7. Client reports are trusted within bounds** (as today's funnel). Nothing here feeds rewards or boards.
8. **TFD8. New-player window: first 3 ranked runs, return within 7 days.**
9. **TFD9. Device = the last-used input device at attempt start**; platform comes from Roblox's own breakdown.
10. **TFD10. Lesson time is real seconds with pause excluded**, clamped at 900.

## Risks

- **Small numbers.** Per-lesson conversion needs a few hundred new players to read; until then read counts, not rates.
- **Rate limit** at very low CCU with many joins at once (a burst after a feature): events drop silently. TF1's cap and
  TF8's echo keep the count known.
- **Client spam.** Bounded by rate limits, once-per-step dedupe and fixed field sets; worst case is noise in practice
  telemetry.
- **TF0 surprises** (no custom fields on onboarding steps): the fallback event keeps segmentation.

## Out of scope

- A/B testing of tutorial variants (field03 is reserved for the arm).
- An external analytics sink (HttpService to our own backend), heatmaps of hit positions.
- Replays of tutorial runs for analysis (never submitted, by design).

# New-best celebration (plan, as built)

Status (2026-10-31): **built** (branch `new-best`, NB1-NB9 and NB11, plus a review-fix pass); headless checks green
(typecheck, lint, asset ids, build, the records / view/hud / view/audio / theme specs, `build:place`). **Pending:** NB10,
the owner's Studio check (none of the UI, sound or DataStore behaviour has run in Studio yet; see "As built" for what to
check first) and the two sounds' audition / `audio:lock` / `audio:build` / upload (ids into `packs/vale/assetIds.ts`;
both are SILENT until then and fall back to the PERFECT / game-over jingles). Owner answers (2026-10-31): NBD3 (deepest
floor), NBD4 (quit runs count), NBD5 (first record quiet mid-run, loud at the end), NBD6 (Ninja Adventure sounds). NBD8
(confetti) built as proposed.

Goal: give every endless run a target and a payoff. Today a player's best lives only on the leaderboard panel (B), as
the score of their best leaderboard run; nothing in a run says how close they are, and the run they finally beat it in
ends with the same game-over jingle as every other death. After this plan:

- **During the run** the score panel says how far the best is (`12,340 TO BEST`), and gets warmer as it closes in.
- **The moment the score passes the best** (as the number on screen rolls past it) a distinct **fanfare** plays, the
  score panel flares gold, `NEW BEST!` slams into the label row and is shouted on the floor, and short gold confetti
  falls at the screen edges. From then on the row counts up the margin (`NEW BEST +3,120`).
- **The first floor deeper than your deepest** gets the same fanfare at the stairwell card's reveal: `Floor 10 · NEW
  DEEPEST`. Before that the card says `Deepest: floor 9 · 2 to go`.
- **Run over on a record run** swaps the game-over jingle for a longer **record fanfare**, rolls old -> new
  (`48,210 -> 61,930  +13,720`), throws full-screen confetti, and shows `Saved` once the server confirms.

**No sim, dungeon, lockstep, hash, replay or fixture change.** Comparisons read `state.score.total` and
`state.endless.floor`. New: one server-owned DataStore doc (personal records), two remotes, theme strings, one colour
role, two port audio IDs.

## What already exists (and is reused)

| Piece | Today | Where |
|---|---|---|
| Personal best (leaderboard) | One entry per player per board (`solo` / `coop`), ordered by score, then floor, then older time; details doc (score, floor, partySize, at, runId). Written only from **server-validated endless runs that died**, never from Studio, private servers or abandoned runs (`LEADERBOARD_POLICY`). The client reads it only when the leaderboard panel opens (`LeaderboardView.mine`) | shared/leaderboard (posting.ts, view.ts, config.ts), server LeaderboardService, client LeaderboardController |
| "Best depth" | **Not stored.** The leaderboard's floor is the floor of the best-*score* run, not the deepest run | - |
| Run verdict | `runFinished(RunFinishVerdict)`: the server's own replay summary, score and floor, plus `leaderboard` post status | shared/network.ts, RunValidationService |
| Per-player docs | `PlayerDocCache` + `DataStoreKeyValue` (SettingsService, OnboardingService: load on join with retries, save on leave / BindToClose / autosave, a failed load never overwrites) | shared/settings, server services |
| Score panel | Rows: label `SCORE` (16 px), the number (`ROOM_CLEAR_UI.scoreText`, a per-frame binding fed by `ScoreRoller`), combo row, combo meter, the floor line. **158 of 160 px** (`scoreEstimate`, `HUD_FOOTPRINT.score`); touch width 120 | client/ui/hud/ScorePanel.tsx, shared/view/hud/footprint.ts |
| Score roller | The shown score lags the true score (kill roll, room bonus held until it lands: Room clear RCD7) | shared/view/fx/roomClearSequence.ts `ScoreRoller` |
| Floor shout | Combo tier-up text painted on the floor under every bullet, <= 55 % opaque, ducking near enemy bullets (Combo CD9) | ComboController, shared/view/hud comboDraw.ts |
| Stage card | Run start and every floor change are covered by `StageCard` (`stage.floorCard` "Floor {floor}") with a reveal | client StageController, docs/STAGE_LOADER.md |
| Jingles | Ninja Adventure: in use Success1-3, LevelUp1, Secret1-4, GameOver/3. **Unused as primary:** LevelUp2, LevelUp3, Success4 (alternates only), GameOver2/4. Jingles duck the music (`DUCKING_SFX`). Run over plays `sfx.jingle.gameover` | art/audio.json, shared/view/audio/cues.ts |
| Score tick / land | `sfx.score.tick` / `sfx.score.land` (Room clear tally) | cues.ts |
| Clear zone | `HUD_CLEAR_ZONE` (the centre 50 % x 56 % of the screen) | footprint.ts |

Two facts shape the design:

1. **The best must be known before the run starts and must not move during it.** A baseline is captured at run start
   from the client's copy of the records; the server's records only change at the verdict.
2. **The client's live numbers are a claim.** They match the server's replay unless the run is rejected, so the
   mid-run celebration is safe to play; only the server's verdict *saves* a record, and the run-over panel says so.

## Player experience (target)

### The target line (score panel row 1)

Row 1 today is the right-aligned `SCORE` label. It becomes two slots on one line (no new row: 158 of 160 px stays):
left the target, right `SCORE`.

| State | Left slot | Colour |
|---|---|---|
| No baseline (first run on this board, best under `NEW_BEST.minScore`, records unknown, unranked world) | empty | - |
| Chasing | `12,340 TO BEST` | `uiTextDim` |
| Within reach (gap <= `NEW_BEST.reachFraction` 10 % of the best) | `1,240 TO BEST`, the number counting down per frame with the roller, 1 Hz pulse | `ember` |
| Passed | `NEW BEST +3,120` | `newBest` gold |

The gap follows the **shown** score (the roller), not the sim's, so the line and the big number always agree.
Touch (120 px wide): the compact `-12,340` / `NEW BEST` strings.

### The crossing (mid-run, once per run)

Fires on the frame the shown score first exceeds the baseline best (a room bonus landing counts: the bonus roll
crossing the best is the best possible moment).

| t (s) | What happens |
|---|---|
| 0 | `sfx.best.new` (short fanfare, ~1.2 s, a jingle: ducks the music). The score number flashes white -> `newBest` gold and holds gold for the rest of the run; a shine sweeps it |
| 0 | `NEW BEST!` slams into row 1's left slot (1.6x -> 1x, 0.12 s, ease out back); the margin starts counting up |
| 0 | Floor shout `NEW BEST!` near the view player: the combo shout's slot and construction (under every bullet, <= 55 % opaque, ducks near enemy bullets). It **replaces** a showing tier shout; a tier-up during it is shown in the panel only |
| 0-1.2 | Gold confetti falls from the top corners, **only outside `HUD_CLEAR_ZONE`** (never over the fight), 40 pieces, UI layer |
| 1.2 | Settled: gold number, `NEW BEST +n` row |

No slow motion, no freeze, no camera kick: this usually happens mid-fight.

### The deepest floor

- Stairwell card on floors up to the record: a second line `Deepest: floor 9 · 2 to go` (`1 to go` / `record floor`).
- **The first floor past the record:** the card reads `Floor 10` and `NEW DEEPEST` in gold; at the reveal
  `sfx.best.new` plays (instead of `sfx.floor.enter`) with the edge confetti. The floor enter is the calm moment, so
  this is the bigger of the two in-run beats.
- Later floors in the same run: `Deepest yet` in gold on the card, normal floor sound.

### Run over on a record run

| t (s) | What happens |
|---|---|
| 0 | `sfx.jingle.record` replaces `sfx.jingle.gameover` (a death on a record run sounds like a win). A gold ribbon `NEW BEST!` across the panel's header |
| 0.3 | Record rows roll: `Score 48,210 -> 61,930 (+13,720)` and/or `Deepest floor 9 -> 11 (+2)`, with `sfx.score.tick`, landing with `sfx.score.land` |
| 0.3-2.5 | Full-screen confetti (the run is over: nothing to hide) |
| verdict | `Saved` chip when the server's verdict reports the record (below); `Not saved: run not verified` when it is rejected; nothing while waiting |

A run with no record keeps today's panel plus one dim line: `Best 48,210 · floor 9` (the target for next time).

**First record on a board** (no baseline): no mid-run beats; run over shows `FIRST RECORD` with the record fanfare.

### Rules

- **Endless runs only** (the ranked world). The tutorial, M1 (even under `KV_Scoring`) and debug runs show nothing.
- **Boards:** a solo run compares with your solo records, a party run with your co-op records (the leaderboard's tabs).
- **Co-op:** each client compares the team score with its own co-op best, so teammates celebrate at their own
  moments; a dead player spectating still celebrates (the team score is theirs).
- **Stage cover / run over:** a crossing under the cover plays at the reveal; after run over the run-over panel owns it.
- **Reduced motion:** no slam, shine, confetti or shout slide (the shout fades in place). Colours, text, sounds stay.
- **HUD fade:** the corner may be faded under the action; the shout, confetti and fanfare carry the moment.

## Personal records (server)

The leaderboard entry cannot serve: it has no deepest floor, and it never exists for Studio, private-server or
abandoned runs. So a small **records doc** joins the per-player docs.

- DataStore `KV_Records_v1`, key `playerDataKey(userId)`:
  `{ v: 1, endless: { solo?: Rec, coop?: Rec } }`, `Rec = { score, scoreAt, scoreRunId, floor, floorAt, floorRunId }`.
  Best score and deepest floor are independent (different runs may hold them).
- **Written only by the server, from its own replay**, when a run's `runFinished` verdict is accepted
  (`RECORDS_POLICY`: endless; death **and** abandoned runs (NBD4); private servers yes; Studio no unless
  `writeFromStudio`). One `UpdateAsync` per credited member (`partyContributors`), max-merge inside the transform
  (concurrent servers never lower a record).
- **Seeded from the leaderboard** the first time a player's doc is empty: their `LB_Details_v1` solo / coop entries
  give score and floor, so veterans do not get a `FIRST RECORD` (two GetAsync, once per player ever).
- **To the client:** `requestRecords()` -> `records(RecordsStatus)` once after join (`{ loaded: false }` on a failed
  load: the client then shows no target, never a false celebration), and again after each verdict that changed them.
  `RunFinishVerdict` gains `records?: { board, scoreImproved, floorImproved, previous: { score, floor } }`.
- Budget: +1 GetAsync per join (+2 once for the seed), +1 UpdateAsync per finished ranked run per member.

## Design (summary)

| Piece | Where | Step |
|---|---|---|
| `RecordsDoc` codec, `mergeRecords` (max per field), `seedFromDetails`, `RECORDS_POLICY`, `RECORDS_DATASTORE_NAME` | shared/records (new) | NB1 |
| `RecordsService`: load / cache / save (PlayerDocCache), seed, update on accepted verdicts (hook in RunValidationService next to the leaderboard post), `requestRecords` / `records` remotes, `RunFinishVerdict.records` | server, shared/network.ts | NB2 |
| `NEW_BEST` tunables (minScore, reachFraction, pulse Hz, slam, confetti count / life, roll timings); `RunBaseline` (board, best score, best floor, or none) captured at run start; `NewBestTracker`: per frame from the shown score and floor -> target-line state, crossing / deepest edges (once per run, deferred under the stage cover, none after run over), reduced motion | shared/view/hud newBest.ts, newBestConfig.ts | NB3 |
| Theme: colour role `newBest` (+ `newBestReport`: >= 3:1 on `uiPanel`, >= 25 CIE76 from `ember` and the combo tiers, >= 40 from enemy-bullet roles and `telegraph` since the shout is drawn on the floor); strings `NEW_BEST_STRING_KEYS`; `sfx.best.new` / `sfx.jingle.record` in `PORT_AUDIO_EVENTS` (SILENT in the placeholder; `sfx.jingle.record` falls back to `sfx.jingle.gameover`, `sfx.best.new` to `sfx.room.perfect`), both in `DUCKING_SFX` | shared/theme, packs | NB4 |
| Audio: cue mapper plays `sfx.best.new` on the edges and swaps the run-over jingle; `art/audio.json` entries (audition: LevelUp2 / LevelUp3 / Success4 for the in-run fanfare; GameOver2 is wrong in tone, so the record fanfare is LevelUp3 layered, or an owner clip in `art/vendor/pixabay/`, NBD6) | shared/view/audio, art | NB5 |
| Score panel row 1 split (`BestTargetRow`, per-frame bindings `NEW_BEST_UI`), gold number + shine; `footprint.spec` (desktop + touch) unchanged | client/ui/hud, shared/view/hud layout | NB6 |
| `NewBestController`: baseline at run start (records from the store; KV debug override), steps the tracker each frame after RoomClearController's roller, writes bindings, the floor shout (asks ComboController's shout slot, priority newBest > tier), edge confetti (ScreenGui, outside the clear zone) | client/controllers/fx | NB7 |
| Stage card second line + NEW DEEPEST / Deepest yet; deferred crossing at reveal | client StageController / StageCard | NB8 |
| Run-over: ribbon, record rows roll, confetti, Saved / Not saved from the verdict, the dim "Best" line; pause overlay `Best 48,210 · floor 9`; main menu Play button subtitle `Best 48,210 · floor 9` | client/ui/hud RunOverPanel, PauseOverlay, menu | NB9 |

### Not changed

- **The sim, scoring, the leaderboard** and its posting rules (the leaderboard still ranks death-ended runs only).
- **The score panel's rows** (158 of 160 px): the target shares the label row.
- **The combo shout** rules, except that a new-best shout outranks it.

## Tasks

Each step is a commit. Specs next to the code; `npm run verify` before each.

- [ ] **NB0. Owner decisions.** Answered 2026-10-31: NBD3, NBD4, NBD5, NBD6 (all as proposed). Open: NBD8 (confetti).
- [x] **NB1. Records core.** shared/records + spec: codec round trip and junk input, `mergeRecords` (score only, floor
  only, both, neither, lower never wins), seed from details (solo only, both, malformed), policy (endless death /
  abandoned, M1, tutorial, Studio, private).
- [x] **NB2. RecordsService.** Load / seed / save, update on accepted verdicts only (rejected, expired and ineligible
  never write), party contributors, the two remotes and `RunFinishVerdict.records`. docs/SERVER.md section. Studio fakes:
  `KV_FakeRecords` (`"solo:48210:9,coop:0:0"`).
- [x] **NB3. Tracker.** Pure + spec: no baseline -> nothing; chasing / reach / passed thresholds; crossing fires once,
  on the shown score (a held room bonus crosses when it lands, not when the sim awards it); a crossing under the stage
  cover fires at the reveal; none after run over; deepest edge on the first floor past the record only; co-op uses the
  coop baseline; a mid-run records update does not move the baseline.
- [x] **NB4. Theme.** Role + report, strings, audio IDs, fallbacks; contract / placeholder / vale specs. Check
  contract.luau / validate.luau stay under Luau's 200 top-level locals (both are near it: CLAUDE.md).
- [x] **NB5. Audio.** Mapper spec cases (crossing cue, deepest cue replaces floor enter, run-over swap on a record run
  only, silent IDs fall back). `art/audio.json` entries, `audio:lock` / `audio:build` left to NB10 (the vendor packs are
  on the owner's Mac).
- [x] **NB6. Score panel.** Row 1 split, bindings, gold number; footprint spec green at 100 % and 70 %, touch.
- [x] **NB7. NewBestController.** Wires tracker, shout, confetti; `npm run build:place` builds.
- [x] **NB8. Stage card.**
- [x] **NB9. Run-over, pause, menu.**
- [ ] **NB10. [owner] Studio check and sounds.** Audition, lock, build, upload, ids into `packs/vale/assetIds.ts`.
  `KV_NewBestDebug` (Workspace string: `score:500`, `floor:2`, `first`, `unknown`) forces the run's baseline.
- [x] **NB11. Docs.** Status and as-built notes here, docs/CLIENT.md, docs/SERVER.md, the CLAUDE.md decision log.

## Studio check

1. `KV_NewBestDebug = "score:2000"`, endless floor 1: the row reads `2,000 TO BEST`, turns ember and pulses near
   1,800, and the fanfare, gold flare, slam, shout and edge confetti fire as the **shown** number passes 2,000 (try it on
   a room bonus landing). The row then counts `NEW BEST +n`.
2. The shout in a dense ring: bullets draw over it, it ducks; confetti never enters the centre.
3. `floor:2`: floor 2's card says `record floor`, floor 3's `NEW DEEPEST` with the fanfare at the reveal, floor 4's
   `Deepest yet`, no fanfare.
4. Die after both: the record fanfare instead of the game-over jingle, the rolls, confetti, `Saved` after the verdict
   (published place with `KV_FakeRecords` off: the doc really updates; rejoin and the target is the new best).
5. A run below the best: today's panel + the dim `Best` line, the game-over jingle.
6. Co-op with different bests: each client celebrates at its own crossing; spectating still celebrates.
7. Reduced motion; Screen shake off; touch (compact strings); HUD 70 %; `unknown` and `first` baselines.
8. Risks to check first: the fanfare on the same frame as `sfx.room.clear` / `sfx.room.perfect` (both jingles; NBD7),
   the label row's fit with long numbers and translations, how often the in-run crossing happens late in a run (most
   records are set near death: the run-over beat may carry most of the payoff).

## Decisions

NBD3, NBD4, NBD5 and NBD6 are the owner's answers (2026-10-31); the rest are proposed.

- **NBD1. No sim change.** Read `state.score` / `state.endless`; records live server-side, from the server's replay.
- **NBD2. A records doc, not the leaderboard entry.** The leaderboard has no deepest floor and skips Studio, private and
  abandoned runs; it stays as it is. Seeded from it once.
- **NBD3. "Depth" = deepest floor reached** (owner, 2026-10-31) (the leaderboard's floor), not the boss Depth counter: it moves every floor,
  so the chase has a beat every few minutes (Depth moves every `BOSS_FLOOR_EVERY` 5 floors).
- **NBD4. Abandoned (quit) runs count toward records** when validated (owner, 2026-10-31). The celebration already played mid-run; losing
  it on Leave run would feel like a bug. Records may then sit above the leaderboard entry (which counts deaths only).
- **NBD5. First record is quiet mid-run, loud at the end** (owner, 2026-10-31). With no baseline every point is a best, so the in-run beats
  wait for one; run over says `FIRST RECORD` with the fanfare. Bests under `NEW_BEST.minScore` (1,000) count as none.
- **NBD6. Two sounds, both Ninja Adventure** (owner, 2026-10-31). `sfx.best.new` (in-run, ~1.2 s, distinct from room
  clear's Success1 and perfect's Success2: audition LevelUp2 / LevelUp3 / Success4) and `sfx.jingle.record` (run over,
  2-3 s; LevelUp3 + Success4 layered via `mix`, tuned at the audition). No owner clip needed.
- **NBD7. The fanfare outranks room-clear jingles on the same frame** (priority above `sfx.room.perfect`; the clear
  jingle is dropped that frame, the stamp still shows).
- **NBD8. Confetti** at the screen edges in-run (outside `HUD_CLEAR_ZONE`), full screen at run over.
- **NBD9. Per board, per client.** Solo vs co-op records, like the leaderboard tabs; each client celebrates its own best.
- **NBD10. The baseline is frozen at run start**; an unknown baseline shows nothing in-run (never a false celebration),
  and the run-over can still celebrate from the verdict's `records`.
- **NBD11. No setting.** Rare by nature; Reduced motion and the SFX volume cover it.

## As built (2026-10-31)

| Piece | Where |
|---|---|
| `RecordsDoc` `{ v: 1, endless: { solo?, coop? }, seeded? }` (`RecordEntry` score / floor each with its time and runId), codec (`RECORDS_CODEC`, decoding never throws), `mergeRecords` / `mergeRecordDocs` / `mergeStoredRecords` (max per board per field, ties keep the stored run, cancel over a newer version), `seedFromDetails` (carries `seeded`), `recordsStatusOf`, `runRecordsResult`, `RECORDS_POLICY` / `recordsEligibility`, `parseFakeRecords`, tunables (`KV_Records_v1`, retries, autosave, request rate, `KV_FakeRecords`) | shared/records (doc.ts, policy.ts, fake.ts, config.ts) |
| `RecordsService` (PlayerDocCache load on join, seed from `LB_Details_v1` while the doc is unseeded, `applyRun` on accepted runs, direct merge writes for unknown / absent members, `ready` gate, BindToClose waits for validating runs); `MergeKeyValue` (UpdateAsync with a merge transform; no-op writes in Studio); `RunSessionService.conclude` calls `applyRun` next to the leaderboard post and fires each recipient's verdict `withRecords` | server/services, server/services/data/MergeKeyValue.ts |
| Remotes `requestRecords` / `records(RecordsStatus)`; `RunFinishVerdict.records?: RunRecordsResult` (per recipient) | shared/network.ts |
| `RunBaseline` (`unranked` / `unknown` / `none` / `known`), `baselineFrom`, `withPendingRuns` (`PendingRunClaim`), `parseNewBestDebug` / `debugBaseline`, `NewBestTracker` (target row, crossing / deepest / deeper-yet edges held under the cover, none after run over, slam / pulse / gold / flash / shine / confetti timelines, `recordRun`), text helpers (`newBestRowText`, `stageBestLine`, `recordRowText`, `runOverRibbonKey`, `recordSavedKey`, `bestText`), `runOverRecords`, `recordRollValue` / `recordRollEdges`, `confettiPieceAt`; `NEW_BEST` / `NEW_BEST_DRAW` / `NEW_BEST_ROLE`; `NEW_BEST_STRINGS` | shared/view/hud/newBest.ts, newBestConfig.ts, newBestStrings.ts |
| Theme: role `newBest` `#ffd700` (`newBestReport` / `NEW_BEST_COLOR_RULES` / `newBestColorProblems`: >= 3:1 on `uiPanel`, >= 25 CIE76 from `ember` and the combo tiers, >= 40 from the enemy-bullet roles and `telegraph`); 18 required strings `NEW_BEST_STRING_KEYS` (`hud.best.*`, `stage.best.*`, `run.best.*`, `menu.best`); `sfx.best.new` / `sfx.jingle.record` in `PORT_AUDIO_EVENTS` (SILENT in the placeholder); `REQUIRED_ASSET_IDS` built inside a function and minimapReport's two role constants made local, so `contract.luau` / `validate.luau` sit at 179 / 199 of Luau's 200 top-level locals (counted on out/) | shared/theme (newBest.ts, newBestColors.ts, contract.ts, types.ts, validate.ts, placeholder manifest) |
| Cue mapper: 11th parameter `newBest: NewBestCueSource` (default `NO_NEW_BEST_CUES`): `sfx.best.new` on `fanfare` (priority 74, above the room clear jingles; fallback `sfx.room.perfect`), the floor enter dropped on the first floor past the record while the fanfare can play, `runOverJingle` (`sfx.jingle.record`, priority 92, fallback `sfx.jingle.gameover`); both in `DUCKING_SFX`; `art/audio.json` entries (LevelUp2; LevelUp3 + Success4 `mix`), unconfirmed | shared/view/audio/cues.ts, art/audio.json |
| Frame order: `FX_FRAME_PHASE` (`scoreRoll` -1 < `normal` 0) on `FxTrackerController.onFrame`; `RoomClearController` runs in `scoreRoll`, `onShownScore` hands the shown score to subscribers before its sounds, `dropClearJingle` (NBD7); `AudioController.setNewBestCues` | client/controllers/fx, client/controllers/audio |
| `NewBestController` (records listener + `requestRecords` on start, baseline per run over `SimController.pendingRunClaims`, the tracker in `onShownScore`, `NEW_BEST_UI` writes, the shout through `ComboController.requestShout`, the confetti ScreenGui `KV_NewBestConfetti` at HUD + 1 hidden under menus, the run-over roll / sounds / confetti) | client/controllers/fx/NewBestController.ts, SimController (`pendingRunClaims`) |
| `ComboController.requestShout` (priority shout in the tier shout's slot, held under the cover until it lifts) | client/controllers/fx/ComboController.ts |
| Store `records` slice (`status`, frozen `baseline` + `baselineRun`, `selectSoloBest`); `VerdictView.records` / `serverScore` / `serverFloor`; stage slice `best` line | client/store |
| `NEW_BEST_UI` bindings, `BestTargetRow` (score panel row 1 split; the gold number + shine), `ScorePanel`, `TouchStrip` (`BestCompactLine` under the combo line), `runOverBest` | client/ui/hud (BestTargetRow.tsx, ScorePanel.tsx, TouchStrip.tsx, newBestUi.ts, newBestRunOver.ts) |
| Stage card second line (`StageController.bestLine`, `StageCard`) | client/controllers/game/StageController.tsx, client/ui/loading/StageCard.tsx |
| `RunOverPanel` (ribbon, record rows, Saved / Not saved chip, the dim `Best` line), `PauseOverlay` (`Best ...` under the buttons), `MainMenu` (`menu.best` under Play solo) | client/ui/hud, client/ui/menu |

Changes from the plan, found while building (the last five came from an independent review pass, *review*):

- **Four baseline kinds**, not three: `unranked` (not the ranked world, the tutorial, M1 even under `KV_Scoring`, an
  unscored run, a local-seed run) draws nothing anywhere, apart from `unknown` (records not loaded: nothing in-run, the
  run over can still celebrate from the verdict's records). **Ranked** = the run has a server `runId`, is not the
  tutorial and is scored.
- **Policy as the leaderboard's where the plan was silent**: debug runs never count; a party run needs >= 2
  contributors (`partyContributors`), credited members only.
- **A first record hides the 0 -> n rows**: the ribbon says `FIRST RECORD`; old -> new rows only when there was a record.
- **Touch**: the ScorePanel is not drawn on touch, so the compact target line hangs under the TouchStrip's combo line
  (no size change), not in a 120 px score panel.
- **No thousands separators**: no number formatter exists in the HUD; text helpers take an optional formatter, the
  client passes plain digits (`12340 TO BEST`).
- **Save chip colours**: `Saved` in `newBest` gold, `Not saved: run not verified` in `uiHealth`.
- **`newBest` is `#ffd700`**, not the plan's `#ffd75e`: that was 14.8 CIE76 from the placeholder `ember` (`#ffd27a`),
  under the 25 bar.
- **Seeded marker** (*review*): the plan seeded "the first time a player's doc is empty". A failed seed read, or a
  failed join load followed by a verdict's direct write, made the doc non-empty without the seed, so a veteran would
  have stayed below their leaderboard best for good (a false FIRST RECORD at once). The doc now stores `seeded: true`
  (still v1; old docs decode unseeded; every merge keeps it once either side has it); the service seeds whenever it is
  absent (a max-merge: safe on a non-empty doc), marks it only after both board reads succeeded (no leaderboard entry
  is seeded too), and on a failed seed sends `{ loaded: false }` for the session (no target rather than a false one),
  writes verdicts directly, and retries on the next join. Nothing is sent before the join load and seed end, so an
  early `requestRecords` never gets a pre-seed status (the join-end push answers it).
- **Pending runs fold into the baseline** (*review*): the server pushes new records only after a verdict, so an
  R-restart (the old run is submitted and counts), a quick Again or Leave run then Play froze a baseline missing the
  record just set (a false NEW BEST at the old number). `SimController.pendingRunClaims` lists earlier ranked runs of
  the session still in flight (the client's final score and floor while the verdict is pending; the server's numbers
  once accepted with a records result, until the push; never debug, rejected or non-counting runs) and
  `withPendingRuns` folds them in, max per field, same board. A pending run later rejected leaves the frozen baseline
  alone (at worst one run aims too high).
- **The shout at a reveal** (*review*): the tracker fires on the reveal's first frame (`coverLifting`), but
  ComboController still saw the input cover through the 0.25 s fade and dropped the request. A priority shout now waits
  under the cover until it lifts (dropped only on run over / run exit); the tier shout is unchanged.
- **Confetti under menus** (*review*): the confetti ScreenGui sits at HUD + 1, under the menu dim and layer, so in-run
  confetti hung behind the pause dim. It now hides while the solo pause, the party overlay, a menu screen, options or
  leaderboards are up; run-over confetti is unchanged.

Studio assumptions to check first (none can be checked headlessly): the UIScale slam on the TextScaled target slot and
the gold number, and nothing clipped by the corner panel's CanvasGroup (HUD fade); the UIGradient shine on the score
text; the confetti's display order against the pause overlay (now hidden) and the stage card (the deepest fanfare's
confetti starts at the reveal); the touch compact line against the chips line; a verdict arriving after the run-over
roll finished (the rows and chip re-derive from the server's records; check nothing replays oddly); `KV_FakeRecords`
(`solo:48210:9`, `none`, `unknown`) and `KV_NewBestDebug` (`score:2000`, `floor:2`, `first`, `unknown`) as the Studio
check below uses them, and a published-place pass with both off (the doc really updates and seeds).

## Later (not in this plan)

- Rank-up callouts (`You passed Ana: #14 on Solo`) from the leaderboard top rows.
- Per-floor ghost splits (score at each floor vs the record run's) for a "ahead / behind" pace line.
- A teammate's record chip in co-op (`Ana: NEW BEST`).
- Weekly / seasonal bests (a second record set reset on a schedule).

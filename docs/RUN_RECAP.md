# Run-over recap and co-op moments (plan)

Status (2026-11-03): **built** (branch `run-recap`: RR0-RR7, RR9, RR11 and CM1-CM6; headless checks only, nothing has
run in Studio). Pending: **RR8** (measure press -> control in a published place, then the levers it points to; "How to
measure" under RR8) and **RR10** (the owner's Studio check and tuning). CM7's vale sounds were uploaded 2026-11-03 (not yet
confirmed by ear). Supersedes the first draft in the project (`claude/run-recap-plan.md`,
written without the repo): this version was checked against the code at `82c2af6`, and three of that draft's
assumptions were wrong (see "What the code says"). Owner answers (2026-11-03): RRD6 (0.6 s arm) and RRD8 (thresholds)
confirmed; everything else is proposed.

Goal: more "one more run". Two parts:

- **Part A: the run-over screen.** It says *how close you came* (one honest near-miss line), *what you did well* (up to
  four highlights that count up with the room-clear tally's sounds) and gets you back in with *one press* that starts
  fast.
- **Part B: co-op shared moments.** A synced **TEAM PERFECT** when no one got hit, a **SYNC!** callout when two
  players' parries land close together, and a reserved slot for a revive moment (revives stay out of scope).

**Sim impact: none.** Every number comes from the final `state.score` / `state.builds` / `state.endless`, new best's
frozen baseline, or view-side collectors over feeds that already exist (`ScoreEvents`, `RoomClearEvents`, the
`NearMissDirector`'s parry groups). No sim field, hash group, replay, fixture, score or leaderboard change. Co-op stays
in sync for free: lockstep means every client steps the same ticks, so every client derives the same moments.

## What the code says (checked 2026-11-03)

| Fact | Where | Consequence |
|---|---|---|
| Run-over panel: header, ribbon (NB), main line, alt key line, stats **Time / Hits / Kills**, BestBlock or the dim `Best` line, DailyResultBlock, DailyPassedRow, the **score breakdown with the Build list beside it**, verdict, RunInfoLine, exits. Three layouts: wide, `compact` (phone landscape, 2-3 columns), `narrow` (portrait, one column) | client/ui/hud/RunOverPanel.tsx | The recap fits into three layouts; the breakdown has a home already |
| Gamepad already focuses the first button (Again) on open; keyboard / mouse do not | RunOverPanel `useEffect` -> `GuiService.SelectedObject` | RR7 only adds keyboard focus and the arm guard |
| **A party run has no Again**: R and the button go back to the lobby once the verdict is in | `runOverExits(info.coop, ...)` | Co-op "one press" means Back to lobby (+ the existing Auto-ready); no co-op retry in this plan |
| Again -> `actions.restart()` -> `handleReset` -> (forfeit if live) -> `beginRun` -> `Events.startRun` -> wait for `runStarted` -> forge floor 1 behind the stage cover (the roster line's `rosterStartSec` hold; `minStartSec` is 0, RR0 5) | SimController.ts 849-900, 1544-1576 | The retry wait is: server round trip + floor generation + the cover's roster hold and fade. RR8 measures each |
| **The stairwell is open from the start on every non-boss floor** (`stairsOpen: world.bossFloor ? 0 : 1`); only a boss floor's opens on the boss's death. The floor clear pays by the *share* of rooms cleared | sim/endless.ts 183, 247; score.ts `awardFloorClear` | The first draft's `2 rooms from floor 9` is **not true** (rooms never gate the stairs). Replaced by distance to the stairs and "rooms from a full clear" |
| `ScoreState.maxCombo` (run peak, tenths) | score.ts | Best combo highlight reads it directly |
| `hitsTaken` sums `events.playerHits` of **the whole party**; PERFECT = no hit since the room engaged (score.ts 916). An Aegis / armor absorb still counts as a hit | score.ts, player.ts `damagePlayer` | **TEAM PERFECT is already what the sim scores in co-op** (RCD2). Part B only presents it |
| Boss no-hit: a second `BOSS` award (+2500) when no hit landed in the final phase | score.ts 654 | `counts[BOSS]` = boss kills + no-hit awards; boss kills = Depth gained, so no-hits = `counts[BOSS] - (depth - startDepth)` (RR0 2; points cannot split them) |
| Score sources: KILLS, GRAZES, GUARD (bullets erased), ROOMS, PERFECT, FAST, FLOORS, BOSS, BREAKABLES; JACKPOT (builds runs); PELLETS, SWEEP (pellet runs) | scoreData.ts `ScoreSource` | Highlights read counts; GUARD is bullets, not parries |
| Parries are grouped per player already: one group per guard, `SWORD_DATA.guardTicks` (18) from its first erase; one parry cue per group | shared/view/fx/nearMissRules.ts | Parry counts and the SYNC rule reuse these groups; no new grouping |
| `ScoreEvents.guardPlayer` / `grazePlayer` per bullet (co-op: the guarding / nearest player) | score.ts | Per-player rows in co-op |
| Room clear in co-op: no slow motion, a 0.2 s kill hold on every client, the full stamp near the room, a corner chip when > `nearTiles` away (RCD12) | docs/ROOM_CLEAR.md | TEAM PERFECT rides the stamp and the chip |
| Silent sounds fall back (`SFX_FALLBACK`) | shared/view/audio/cues.ts | New port audio IDs can ship silent and still sound |

### RR0 findings (read from the code at `bb0ba92`, 2026-11-03; nothing measured, no Studio)

1. **Boss hp at the death tick: yes.** The run stops stepping at the party wipe, so the final state is the death
   tick's. `HudSnapshot` (shared/play snapshot.ts, built from that state through `findBoss`) carries `bossVisible`
   (= a boss present, alive and `phase > 0`: engaged), `bossId`, `bossHp` (rounded UP to 0.1 hp, `HP_DECIMALS`) and
   `bossHpMax`; the fraction is shared/view/hud `bossFraction(s.bossHp, s.bossHpMax)`, the boss bar's own. With
   `bossVisible` false the snapshot zeroes hp (hpMax 1), so "engaged and alive" is exactly `bossVisible`. Name:
   theme string `<bossId>.name` (BossBar's).
2. **No-hit awards vs boss kills.** Both go through the full multiplier (`award(..., BOSS, ...)`: combo x Depth x
   curses), so `points[BOSS]` cannot be split exactly. `counts[BOSS]` = boss kills + no-hit awards, and every boss kill
   raises Depth by one (sim/endless.ts step 1, `events.bossDefeated` from the boss's `onDeath`), so
   **boss kills = `depth - startDepth`** (`startDepth` = ENDLESS_FIRST_DEPTH 1, or a dev run's `EndlessConfig.startDepth`)
   and **no-hit awards = `counts[BOSS] - (depth - startDepth)`** (`bossNoHitAwards` in recap.ts). This replaces "tells
   them apart by points".
3. **FAST: one award per room under par.** `clearRoom` awards FAST once per cleared room when `par - clear time > 0`
   (two rooms clearing on one tick get two awards), so `counts[FAST]` = rooms cleared under par and `points[FAST]` =
   the ticks beaten, through the multipliers. Highlight 11's ">= 3 rooms under par" reads `counts[FAST] >= 3`.
4. **Telemetry budget.** Custom event names live in shared/run analytics.ts `ANALYTICS_EVENT` (PascalCase,
   e.g. `RunEnded`; the daily ones `daily_*`), shared/lobby `LOBBY_ANALYTICS_EVENT` and shared/onboarding
   `TUTORIAL_ANALYTICS_EVENT`, gathered in shared/onboarding analyticsCatalog.ts, whose spec pins **36 custom event
   names (Roblox limit 100)**, 3 funnels (limit 10) and the field-combination total (limit 8,000). Every event is
   logged by the server's TelemetryService from its own replay, never from the client: a `run_retry` with "seconds on
   panel / near-miss kind" is client knowledge, so RR9 needs a remote (or folds into the existing `SessionEnded`
   `retried` / `SessionRetriesAfterDeath`, which already count retries after a death). One more name fits easily.
5. **Press -> control today (Again on a dead solo endless / daily run).** `actions.restart()` -> `handleReset`: the run
   is over, so no forfeit (`restartForfeits` is ranked AND playing only) and `submit` is a no-op (the death was
   submitted on the death frame) -> `beginRun` the same frame. Then: (a) forfeit / submit: **0** after a death (a
   forfeit only for R during a live ranked run: one forfeit tick, the submit, `beginRun` on the next frame);
   (b) `startRun` -> `runStarted`: one remote round trip plus the server's `registry.start` (rate limit
   `RUN_START_RATE` 10 / 60 s, then it builds floor 1's world itself); answered `busy` when
   `RUN_PENDING_PER_PLAYER` 2 earlier runs are still validating (retried every `RUN_START_BUSY_RETRY_SECONDS` 2 s, up
   to `RUN_START_BUSY_RETRIES` 15), no answer in `RUN_START_TIMEOUT_SECONDS` 5 s plays unranked; (c) forge: the stage
   cover's covered work runs one item per frame after `coverDrawFrames` 1 drawn frame: `forge` (makeRun, floor 1),
   then `notify` (listeners, view rebuild), then `pregen` (floor 2) = at least 3 frames plus their costs; then the
   assets wait (floor 1's beds, already loaded on a retry; cap `assetCapSec` 3 s) and `settleFrames` 2; (d) the
   minimum and fade: **`minStartSec` is 0**, but every endless / daily start shows floor 1's roster line, which holds
   the cover **`rosterStartSec` 1 s from the server's answer** (`holdAtLeast`), then `fadeSec` 0.25 s (input blocked
   through the fade). So today's floor is about 1.25 s + round trip + ~6 frames of work; the roster hold is the largest
   fixed wait, and the first lever for RR8 (`RECAP.retryStartSec` would lower `rosterStartSec` on a retry, not
   `minStartSec`).

## Part A: the run-over screen

### Layout (wide; compact / narrow below)

| Block | Owner | Shown |
|---|---|---|
| Header (GAME OVER) or the `NEW BEST!` / `FIRST RECORD` ribbon | NB | always |
| Main line, alt key line | existing | always |
| **Near-miss line** (one) | **RR** | when a candidate applies; on a record run a dim sub-line about the *other* record, or nothing |
| Stats Time / Hits / Kills | existing | always |
| Record rows (old -> new) or the dim `Best` line | NB | ranked runs; the dim line is dropped when the near-miss line shows (it says the same thing, closer) |
| **Highlights** (2 x 2, max 4) | **RR** | scored runs |
| Daily block, friends passed | DS | daily runs |
| Score breakdown + Build list | existing | **behind Details** (RRD5), one press to open, one to close |
| Verdict, info line | existing | as today |
| Exits: **Again** (focused) · Main menu · **Details** | RR | party runs: Back to lobby (unchanged) |

Compact (phone landscape): the near-miss line under the main line in the left column; the highlights take the right
column's top (where the breakdown was), Details swaps them. Narrow (portrait): one column, highlights as 2 x 2.

### Timeline

Real seconds from the run-over frame. Any confirm / FIRE press before `RECAP.retryArmSec` skips the timeline to its
settled state instead of retrying (the draft reveal's rule, DRD6).

| t (s) | Non-record run | Record run |
|---|---|---|
| 0 | game-over jingle, header, main line | record jingle, ribbon (NB) |
| 0.3 | **Near-miss line** fades up; its number counts over 0.3 s with `sfx.score.tick`, lands with `sfx.score.land` | NB's rows roll (to ~1.3 s) |
| 0.6 | Again armed (focus ring brightens) | Again armed |
| 0.7 / rows + 0.2 | **Highlights** one every 0.15 s, each counting over 0.25 s (at most one tick sound a frame), each landing with `sfx.score.land` | same after NB's rows; the dim sub-line with the first highlight |
| settled | ~1.4 s (4 highlights) | ~2.2 s (rows to ~1.3 s) |

### The near-miss line ("so close")

At most one headline per run; the first candidate that applies wins. Each is true at the moment of death and framed as
the next target, never as failure.

| # | Candidate | Applies when | Text |
|---|---|---|---|
| 1 | Boss nearly down | boss floor, boss engaged and alive at <= `bossHpFraction` 25 % | `{boss} had {pct}% left` |
| 2 | Score just short | baseline `known`, gap to best <= `nearScoreFraction` 15 % of best | `{gap} short of your best` |
| 3 | One floor from a record | died on your deepest floor (the open stairs were a new deepest) | `One more floor for a new deepest` |
| 4 | Stairs were close | non-boss floor, the open stairwell within `stairsNearTiles` 10 tiles **by walking path** (one BFS over the floor grid at run over) | `{tiles} tiles from floor {next}` |
| 5 | Nearly a full clear | non-boss floor, 1-`roomsLeftMax` 2 rooms uncleared, at least one cleared | `{rooms} rooms from a full clear` (`1 room`) |
| 6 | Next boss | died on the floor before a boss floor | `1 floor from {boss}` (the floor's seeded pick, `bossKindFor`) |
| - | none | | NB's dim `Best 48,210 · floor 9`, as today |

- Candidate 4 replaces the draft's "rooms from floor N": rooms never gate the stairs, distance does.
- Record runs drop the candidates about the record just set (score record: 2; deepest: 3) and show the first remaining
  one dim under NB's rows; `FIRST RECORD` shows none.
- Daily runs compare 2 with best today; ranks stay in `DailyResultBlock`. Dev runs: no near-miss.
- Colour `ember` (warm, not alarm); no new sound.

### Highlights

A fixed priority list; each has a *notable* test. Show the notable ones in order, up to 4; fill to 2 with Kills / Rooms
cleared so a short run never has an empty grid.

| P | Highlight | Source | Notable when |
|---|---|---|---|
| 1 | `Boss felled · no hits` / `Bosses felled 2` | `counts[BOSS]` and Depth gained (RR0 2) | >= 1 |
| 2 | `Best combo x4.2 DOMINATING` (tier colour) | `score.maxCombo` | >= x2 (RAMPAGE) |
| 3 | `PERFECT rooms 7 of 11` (co-op: `TEAM PERFECT rooms`) | `counts[PERFECT]` / `counts[ROOMS]` | >= 3, or >= 50 % |
| 4 | `Best team streak x4` (co-op only, Part B) | `TeamMoments` | >= 2 |
| 5 | `Duos 2` / `Evolved 3` | `state.builds` (view player) | >= 1 |
| 6 | `Parries 14` | parry groups (`RecapTally`) | >= 5 |
| 7 | `Sync parries 3` (co-op only, Part B) | `TeamMoments` | >= 1 |
| 8 | `Sweeps 3` | `counts[SWEEP]` (pellet runs) | >= 1 |
| 9 | `Grazes 120` | `counts[GRAZES]` (co-op: per player from `grazePlayer`) | >= 50 |
| 10 | `Jackpots 3` | `counts[JACKPOT]` | >= 1 |
| 11 | `Speed bonus 1,240` | `points[FAST]` | >= 3 rooms under par (`counts[FAST]`, RR0 3) |
| fill | `Kills 214`, `Rooms cleared 11` | sim | - |

Thresholds are `RECAP_HIGHLIGHTS` tunables, tuned in RR10. Co-op labels team values `Team` and the view player's own
(parries, grazes, duos) `You`. Reserved slots: `Chests opened` (treasure rooms plan), a codex line (codex plan).

### Again in one press, fast

- **Focus:** Again is focused for keyboard (Enter / Space) and gamepad (already); touch: the largest button. The bound
  `restart` key (R / D-pad down) works as today.
- **Arm guard (RRD6):** confirm / FIRE before 0.6 s skips the timeline; after it, retries. The bound `restart` key is
  deliberate and retries at once.
- **Fast start (RR8):** measure press -> first controllable tick in a published place, split into (a) forfeit /
  submit, (b) `startRun` -> `runStarted` round trip, (c) floor 1 forge, (d) the cover's `minStartSec` and fade. Target
  <= 1.5 s. Levers, used only where the measurement points: forge floor 1 the moment `runStarted` lands (already
  deferred one item per frame: check nothing waits on a frame it need not); lower the roster line's `rosterStartSec`
  hold (1 s; `minStartSec` is already 0, RR0 5) for a retry (`RECAP.retryStartSec`) when the core preload is done; behind `RECAP.prefetchSession`, request the next solo session
  when the panel opens and use it on Again (the server expires it unused).
- **Party runs:** unchanged (Back to lobby, `Auto-ready on run end`). Daily: Retry Daily, same focus and arm.

### Rules

- Worlds: endless and daily get the full recap; dev runs highlights only; tutorial and M1 unchanged.
- Verdict pending: draw from the client's final state at once; an accepted verdict with different numbers re-derives
  silently (no replayed timeline); a rejected one keeps the highlights and NB's `Not saved` chip.
- Reduced motion: no count-up, values fade in final, one `sfx.score.land`.
- Strings: every line a theme string with variables, sized for translation (`TextScaled` cells with a minimum size).

## Part B: co-op shared moments

### B1. TEAM PERFECT (synced)

The sim already awards PERFECT only when no one in the party got hit since the room engaged. Part B makes the co-op
version feel shared:

- **Stamp text:** in a party run (`score.partySize >= 2`) the stamp reads `TEAM PERFECT` (`room.clear.teamPerfect`);
  the far client's corner chip reads `TEAM PERFECT +{bonus}`.
- **Synced:** every client sees it on the same sim tick (lockstep), so the stamp and the chip fire together within one
  input-delay frame. No server message.
- **Team pulse:** at the clear, a gold spark ring on **every living party member** (the existing spark ring, one per
  player), so each player sees their teammates light up too, near or far (when on screen).
- **Streak:** consecutive team perfects (by clear order, reset by any non-perfect clear) add `x{n}` to the stamp from 2
  (`TEAM PERFECT x3`); the best streak feeds the recap highlight.
- **Sound:** a new optional port audio ID `sfx.room.teamperfect` (falls back to `sfx.room.perfect`), played on every
  client; the far client hears it at the chip's volume.
- A dead teammate does not stop it (the dead cannot be hit); the label stays TEAM while the party started with >= 2.

### B2. SYNC! parries

- **Rule:** two parry groups (the existing per-player grouping) by **different players** that start within
  `syncWindowTicks` 12 (0.2 s) of each other. A third player inside the same window makes it `SYNC x3`.
- **Callout:** `SYNC!` floor text on the combo shout's construction (under every bullet, <= 55 % opaque, ducking near
  enemy bullets) at the midpoint of the two parry points, with a bright tether between them for 0.25 s when they are
  within `tetherMaxTiles` 10; farther apart, a small `SYNC!` at each.
- **Sound:** the parry cue again at +5 semitones, or a new optional `sfx.player.syncparry` (falls back to that).
- **No freeze** (co-op has none). At most one callout per `syncCooldownSec` 1.0, so a dense wave never spams.
- Deterministic on every client (same guard events), counted in `TeamMoments` for the recap.

### B3. Revives (out of scope, reserved)

No revive mechanic exists (a dead player spectates, docs/SPECTATE.md). A revive would be gameplay (hashed state, a
lockstep input, scoring rules) and needs its own plan. This plan only leaves a `revive` kind in `TeamMomentKind` and a
highlight slot (`Revives 2`), both unused.

### B4. Co-op run-over

Every client shows the team's numbers: TEAM PERFECT rooms, best team streak, sync parries, plus `You` rows (parries,
grazes, duos). Exit stays Back to lobby.

## Design

| Piece | Where | Step |
|---|---|---|
| `RecapTally`: parries per player (the director's grouping, `parryStartsGroup`), grazes per player; on `RunView.recapTally` (LiveRun, LockstepClient), collected every tick, never reset per frame (a new run is a new view) | shared/view/fx/recapTally.ts | RR1 |
| `RECAP` / `RECAP_HIGHLIGHTS` tunables; `RunRecapInput`; `nearMissFor(input)`; `pickHighlights(input)`; `RecapTimeline` (rows, counted values, sound edges, `skip()`, `armed`); `stairsPathTiles({ dungeon, stairX, stairZ, stairsOpen, blocked? }, x, z)` (BFS, run over only); `RECAP_STRINGS`; `bossNoHitAwards` | shared/view/hud/recap.ts, recapConfig.ts | RR2 |
| Strings `RECAP_STRING_KEYS` (`run.recap.*`), `room.clear.teamPerfect` / `.teamStreak`, `fx.parry.sync`, `fx.parry.syncCount`; context entries in `l10n/context.json`; lists built inside functions (contract.luau / validate.luau near Luau's 200 locals) | shared/theme, packs, l10n | RR3 / CM3 |
| Cue mapper: recap ticks / land via `sfx.score.tick` / `land`; `sfx.room.teamperfect`, `sfx.player.syncparry` with fallbacks | shared/view/audio/cues.ts | RR4 / CM4 |
| `NearMissLine`, `HighlightGrid`, `DetailsToggle` (breakdown + Build list behind it), three layouts | client/ui/hud/RunOverPanel.tsx + new files | RR5 |
| `RecapController`: builds the input after NewBestController freezes its result, steps the timeline, writes bindings, re-derives on the verdict | client/controllers/fx | RR6 |
| Again focus (keyboard), arm guard, skip | RunOverPanel, input layer | RR7 |
| Retry timing and levers | SimController, StageController, server RunSessionService | RR8 |
| `TeamMoments` (pure): TEAM PERFECT flag + streak from `RoomClearEvents`, sync parries from the director's parry groups; `syncParry` records on the `NearMissDirector`'s frame output | shared/view/fx/teamMoments.ts, nearMissRules.ts | CM1 |
| Stamp / chip text and streak, team pulse rings | roomClearSequence, RoomClearStamp / Chips, ParticleController | CM2 |
| `SYNC!` floor text and tether | SyncCalloutController (the PARRY! flash's construction, fxHelpers `floorText`) | CM5 |
| Telemetry: one event `RunRecap` (as built; the draft's `RunRetry` would misname an exit): close rows (seconds on the panel; retry / exit / lobby; near-miss kind; record x skipped) and, for a party run, team rows on the same event (no party run-end event exists, and the moments are client facts); remote `runRecap` to the server's TelemetryService (RR0 4) | shared/run recapAnalytics.ts, analytics.ts, shared/onboarding analyticsCatalog.ts, shared/network, TelemetryService, RecapController | RR9 |

## Tasks

Each step is a commit; `npm run verify` before each.

### Part A

- [x] **RR0. Remaining facts.** Boss hp readable at the death tick from the snapshot (`bossFraction`); telling the
  no-hit award from boss kills in `counts[BOSS]`; FAST counts per room; the custom-event budget for `run_retry`; press
  -> control time today, split (a)-(d). -> Verify: each written here.
- [x] **RR1. Tally.** `RecapTally` + spec: one guard erasing 5 bullets = 1 parry; two guards = 2; per player; reset on
  a new run. Every golden / replay / hash spec unchanged.
- [x] **RR2. Recap core.** Pure + spec: each candidate at its edge (25 / 26 % boss, 15 % gap, deepest floor, 10 / 11
  path tiles, 2 / 3 rooms left, pre-boss floor), order, record-run drops and the dim line, FIRST RECORD none,
  `unknown` / `unranked`, daily best today; highlights: priority, cap 4, fill to 2, Team / You; timeline, skip before
  arm, reduced motion; verdict re-derive.
- [x] **RR3. Theme strings** (contract, placeholder, vale, l10n context); contract / validate specs and Luau locals.
  As built: `RECAP_STRING_KEYS` (28: `run.recap.near.*`, `run.recap.hl.*`, the Team / You tags, the Details toggle)
  and `TEAM_MOMENT_STRING_KEYS` (CM3) in shared/theme runRecap.ts, written out inside `REQUIRED_STRING_KEYS` (no new
  top-level local); placeholder English as worded here (vale clones it), an `l10n/context.json` entry per key, the
  PERFECT glossary term covers TEAM PERFECT; runRecap.spec. contract.luau / validate.luau stay at 186 / 196 top-level
  locals (counted on out/ after the RR9 build).
- [x] **RR4. Audio mapper** spec: tick cap per frame, one land, reduced motion. As built: not in the cue mapper's
  frame (the recap runs on the panel's real clock, not sim events): shared/view/audio `recapCue(edges, jingleFrame)`
  turns the timeline's edges into at most ONE sound a frame (a landing wins: one `sfx.score.land` however many rows
  landed, else one `sfx.score.tick`), nothing on the run-over jingle's frame, at `RECAP_AUDIO` volumes (tick 0.6, land
  0.85) and SFX_PRIORITY's ranks (60 / 30, under the jingles); RecapController forwards it to `AudioController.play`
  (silent IDs fall back). Spec `recapCues.spec.ts` (60 / 5 fps, reduced motion one land, skip one land).
- [x] **RR5. Panel.** Blocks, Details toggle, three layouts; fit at 1080p, phone landscape, portrait, HUD 70 %
  (fit.spec.ts); `npm run build:place`. As built: client/ui/hud RecapBlocks.tsx `NearMissLine` (ember, TextScaled
  20 / min 12; the record run's dim sub-line 16 / min 10 at `dimTransparency` under BestBlock's rows; it hides
  BestBlock's dim `Best ...` line, `recapHidesBestLine`, while the daily block still treats that line as drawn),
  `HighlightGrid` (UIGridLayout 2 x 155 x 48 = the breakdown's 316 width; label TextScaled 14 / min 9, value RichText 24
  / min 12 with the combo tier's name tinted, `Team` / `You` chip), `DetailsToggle` (exits row, `Details` /
  `Highlights`). Layout numbers `RECAP_UI` (shared/view/hud recapUi.ts, with `recapNearMissText`,
  `recapHighlightValue`, `recapRowTransparency`, `recapRecordRowsSec`, `recapExitSizes`). Wide: near-miss under the
  main line, highlights in the breakdown's slot (now before the daily block); compact: near-miss in the left column,
  the dim one / grid in the right column, the Build list's third column only behind Details; narrow: one column.
  Exits with a recap: Again 260 / 176 / 196 wide, the others 200 / 106 / 120 at text 20 / 16 / 16. Store slice
  `recap` (run, nearMiss, highlights, details, armed); per-frame texts / fades `RECAP_BINDINGS`. Runs without a recap
  (tutorial, M1, unscored): exactly the old panel. Fit (shared/view/menu fit.spec.ts): the record daily worst case
  fits every landscape phone (compact) and portrait phone (narrow) at 100 % and 70 %, and is no taller than today's
  record daily panel on desktop; a plain run's recap fits every desktop at full size. Known: on desktop 720 p
  equivalents a record DAILY run (with or without the recap) is taller than the room, as before (MenuFit is the
  identity off touch).
- [x] **RR6. RecapController** wiring, after NewBestController. As built: client/controllers/fx RecapController, an
  `FX_FRAME_PHASE.normal` frame handler (after RoomClearController's scoreRoll phase where NewBestController steps).
  Opens when the snapshot's outcome leaves "playing" (RunOverPanel's test) and builds `RunRecapInput` once: world from
  the run's world kind (endless / daily / dev; tutorial and others: no recap), the boss from the snapshot
  (`bossVisible` / `bossId` / `bossFraction`), the next boss `bossKindFor(floorSeed(seed, floor + 1))`, the stairs'
  path from the floor's cached world and the view player's position (once a run over; breakables not blocked), rooms
  `floorRoomTally`, the view player's duos / boons at BOON_MAX_LEVEL, baseline / records from the store and
  `runOverBest` (the panel's own), a daily run's best today from an accepted verdict's `daily.previous`,
  `RunView.recapTally`, and Part B's moments through `setTeamMomentsProvider(provider: RecapTeamMomentsProvider |
  undefined)`, `RecapTeamMomentsProvider = (ctx: RunContext) => RecapTeamInput` (none: NO_TEAM_MOMENTS). A record run's timeline starts after NB's rows
  (`recapRecordRowsSec`). The clock holds under the stage cover; a new verdict / final numbers re-derive (new timeline
  at the old clock, settled stays settled) only when the content's signature differs; a run start / exit resets.
- [x] **RR7. Again**: keyboard focus, arm guard, skip, touch; Retry Daily. As built: shared/play `RunOverRetryGate`
  (spec): Again (`HudActions.again`), Enter / Space on a keyboard (a ContextActionService binding above the input
  sink, only while the panel is up with nothing over it; a key bound to `restart` is left to it) and FIRE press edges
  (SimController.getFrameButtons; not a press that began over a GUI; a FIRE held at the open must be released first)
  go through `RecapTimeline.press()`: before 0.6 s skip, after it restart (`SimController.requestRestart`), once per
  run over. The bound `restart` key is unchanged (SimController's driver action, at once). Keyboard focus: Again draws
  `active` once armed (the pad's selection starts on it as before); touch: Again is the largest exit. Party runs: a
  press only skips (Back to lobby unchanged). Retry Daily is the same button.
- [ ] **RR8. Faster retry.** Levers only where RR0's split points. -> Verify: before / after times written here.
  **How to measure** (a published place, solo endless, die, press Again after the arm; five tries; F9 client log):
  set the Workspace attribute `KV_RetryTiming = true` (RECAP_DEBUG.retryTimingAttribute, client only, read at the
  press, nothing connected; off by default): RecapController prints `[Recap] retry: press -> control <s> s (run <n>)`
  on the next run's first frame that takes input (the stage cover and its fade gone: `SimController.isInputCovered` /
  `isHeldByLoader` false). The split comes from the stage loader's own line, printed on every run start:
  `[Stage] run <n>: forged in <ms> ms, built in <ms> ms, revealed at <s> s` (the cover went up on the press, so
  `revealed at` = (b) round trip + (c) forge / build / assets / settle + (d) the roster hold, and press -> control minus
  `revealed at` = the 0.25 s fade); (b) alone is `revealed at` minus the roster hold (`rosterStartSec` 1 s from the
  answer) when the forge and build finish under it. `KV_Debug` adds the per-listener `[Stage] listeners (...)` line.
  Write the five times here before choosing a lever (`RECAP.retryStartSec`, `RECAP.prefetchSession`).
- [x] **RR9. Telemetry** spec. As built (the smallest honest addition): **one** new custom event name `RunRecap`
  (`ANALYTICS_EVENT.runRecap`; the catalog spec now pins 37 of Roblox's 100, field combinations 2599 of 8,000; no
  funnel). `SessionEnded` "retried" / `SessionRetriesAfterDeath` keep counting retries from the server's replays;
  `RunRecap` splits run-over closes by what the panel showed. Rows (shared/run recapAnalytics.ts
  `analyticsForRunRecap`): a **close row** per report, value = seconds the panel was open (0..600, tenths), field01
  `retry` (Again / Retry Daily / the restart key) / `exit` (Main menu) / `lobby` (any close of a party run), field02 the
  near-miss kind shown (`RUN_RECAP_NEAR_MISS_KINDS`, pinned by spec to `RECAP_NEAR_MISS_ORDER`, or `none`), field03
  `plain` / `plainSkipped` / `record` / `recordSkipped` (new best's record run x a press skipped the timeline first);
  a `lobby` report adds three **team rows** on the same event, field01 `teamPerfects` / `bestTeamStreak` /
  `syncParries`, value = the total (each member's report; there is no party run-end event to extend: RunEnded is the
  owner's and server-derived). Remote `runRecap(report: RunRecapReport)` (shared/network: runId, close, seconds,
  nearMiss, record, skipped, team?). Server (TelemetryService): `RUN_RECAP_RATE` 10 / 60 s, `readRunRecapReport`
  (types, finite numbers, seconds clamped and rounded, counts non-negative integers clamped to 999 with the streak <=
  the perfects, kinds from the list, run id 1..64 chars; a team on a solo close dropped, a malformed one rejects),
  then `RunRecapGate`: one report per run session the server issued to that player (RunSessionService `createSession`
  -> `TelemetryService.runIssued(runId, members)`, the last 4 remembered, so a report that lands after the next start
  still counts; forged / repeated ids are dropped). Logged through `logAll` (the `KV_AnalyticsDebug` echo included);
  read by nothing else. Client (RecapController): once per run over with a recap, ranked runs only (a `runId`; dev /
  unranked send nothing), at the moment the panel is left: our own retry (before `requestRestart`), the run context
  dropping under a ranked restart (the restart key's path), the next run starting (unranked), or the run exit (`exit`,
  `lobby` for a party run, which waits for the party's verdict, so its seconds include that wait); seconds from the
  panel's open (os.clock), the near-miss kind as last derived, the record flag and team totals as last derived, skipped
  = a `RunOverRetryGate` "skip" in this run over. Not sent: a player who quits the game on the panel. Specs:
  shared/run recapAnalytics.spec.ts (accept / clamp / reject cases, kinds = RECAP_NEAR_MISS_ORDER, solo and party rows,
  the gate), analyticsCatalog.spec.ts (37 names, every RunRecap row in the catalog's sets, the entry's 240
  combinations). docs/SERVER.md lists the event.

### Part B

- [x] **CM1. TeamMoments core.** Pure + spec: TEAM PERFECT only when the sim awarded perfect and party >= 2; streak
  order and reset; sync window 12 / 13 ticks; same player twice is not a sync; three players = x3; cooldown; identical
  output from two clients stepping the same log.
- [x] **CM2. TEAM PERFECT presentation.** Stamp / chip text and streak, pulse rings on every living member.
  As built: client `TeamMomentsController` owns the ONE `TeamMoments` and steps it in two halves
  (`clearsFrame` / `parriesFrame`, same result as `frame`): the clears in a new `FX_FRAME_PHASE.teamMoments` (-2, before
  RoomClearController's `scoreRoll`), the parry groups on the first `syncs()` call of a NearMissController frame (or its
  own near-miss subscriber); `totals(): TeamMomentTotals` (a copy) for the recap. `RoomClearSequence.start(..., team)`
  (`RoomClearTeam`: streak / showStreak) sets `look.team` / `teamStreak` and the chip's `team`;
  `roomClearStampText(perfect, rooms, s, team, teamStreak)` reads `room.clear.teamPerfect` / `.teamStreak` (the
  streak's form replaces "x{rooms}"; a chip shows no streak). The pulse: `teamPulsePlayers` (every living member) ->
  `ParticleController.teamPulse`, the room clear's spark ring in `newBest` gold (the kill's own PERFECT ring stays
  `ember`), seed salt 19 (`TEAM_MOMENTS_VIEW.pulse`). Stamp and chip labels are TextScaled under their old text size
  (a long translation or `TEAM PERFECT x3` shrinks instead of overflowing). Debug `KV_TeamMomentsDebug = "perfect[:n]"`
  (the next PERFECT clear, solo too, is a team perfect with streak n; never in the totals).
- [x] **CM3. Strings** (built with RR3: `TEAM_MOMENT_STRING_KEYS` in shared/theme/runRecap.ts).
- [x] **CM4. Sounds.** Two port audio IDs, SILENT in the placeholder, fallbacks; mapper spec.
  As built (IDs lowercase: asset ID segments are): `sfx.room.teamperfect` / `sfx.player.syncparry` registered in the
  first half. Playback: TEAM PERFECT is RoomClearController's, not a mapper cue (it already plays the room clear's
  jingles): `roomClearStampJingle(perfect, team)` on the stamp at full volume, `roomClearChipJingle(teamChipsStarted)` on
  a far client's chip at `ROOM_CLEAR.chip.jingleVolume` (CMD2), both through `AudioController.play` (one fallback step:
  silent -> `sfx.room.perfect`, both silent -> nothing; the new-best fanfare still drops it, NBD7). SYNC! is the mapper's
  (`frame(..., syncs)`, the last parameter: `TeamMomentsController.syncs()` of the same near-miss frame): one cue per
  formed sync (a `grew` record plays nothing more; the joining player's parry plays), full volume when the view player is
  in it, else teammate volume and `TEAMMATE_PRIORITY_DROP` lower, rank 58; silent it resolves to `sfx.player.parry` at
  +`TEAM_MOMENTS_VIEW.syncAudio.fallbackSemitones` (5), merged with the frame's parry cue into one higher sound; both
  silent: nothing. Caps / jingle / interval rules as every cue. Spec: teamMomentCues.spec.ts.
- [x] **CM5. SYNC! callout.** Floor text, tether, ducking, cooldown.
  As built: client `SyncCalloutController` (a NearMissController subscriber reading `TeamMomentsController.syncs()`)
  on the PARRY! flash's construction, now shared as fxHelpers `floorText` / `floorTextTopStuds` (ParryFlashController
  uses them too): a SurfaceGui on a thin floor Part at the combo shout's layer, under every bullet, capped at
  `COMBO_SHOUT.maxOpacity` (55 %) x the fade and ducking per text through `ShoutDuck` / `shoutDucked` (CD9). Pure
  timeline shared/view/fx `SyncCallout` (`syncCalloutPop` / `Fade`, `syncTetherFade` / `Width`; a new or grown sync
  restarts it), drawing pieces shared/view/hud syncCallout.ts (`syncCalloutLabel`: `fx.parry.sync`, `fx.parry.syncCount`
  from 3 players; `syncCalloutSize`; `syncTetherOpacity`). Tethered: one text at the points' mean plus ONE pooled Neon
  bar between the first and latest points for 0.25 s (snaps 0.3 -> 0.1 tiles over 0.08 s, fades over the last 0.12 s,
  at most 85 % opaque); untethered: a small text at each point. Reduced motion: no pop, no snap (thin bar), both fade.
  No freeze. Cooldown is TeamMoments' (1 s). Tunables `TEAM_MOMENTS_VIEW.callout` / `.tether` (role `nearMiss.parry`).
  Debug `KV_TeamMomentsDebug = "sync"` / `"sync:far"` / `"sync:3"` (a fake SYNC! at the view player, with its sound).
- [x] **CM6. Recap rows** (team highlights 4 and 7). As built: `pickHighlights` reads `RunRecapInput.team`;
  RecapController's provider is `TeamMomentsController.totals()` (set in its onStart).
- [x] **CM7. [owner] Vale sounds** for the two IDs (audition, lock, upload). As built: `sfx.room.teamperfect` =
  Success2 with Bonus/Gold1 layered (`mix`), `sfx.player.syncparry` = Bonus/Bonus3 (art/audio.json, not confirmed by
  ear; alternates listed for the audition), built with ffmpeg 6.1.1 and uploaded 2026-11-03 6:33 PM
  (packs/vale/assetIds.ts).

### Both

- [ ] **RR10. [owner] Studio check and tuning** (below); tune `RECAP`, `RECAP_HIGHLIGHTS`, `syncWindowTicks` from five
  solo and three co-op runs.
- [x] **RR11. Docs.** As-built here, docs/CLIENT.md, ROOM_CLEAR.md / GRAZE_PARRY.md cross-links, the CLAUDE.md row and
  decision log entry. As built: this Status line and RR3 / RR9; docs/CLIENT.md's controller map (RecapController,
  TeamMomentsController, SyncCalloutController) and a "Run-over recap and co-op moments" juice section; one cross-link
  line each in docs/ROOM_CLEAR.md (TEAM PERFECT on the stamp / chip, RCD12 kept) and docs/GRAZE_PARRY.md (the
  director's `parryGroups`, SYNC!); docs/SERVER.md's `RunRecap` row; the CLAUDE.md decision log entry (the docs table
  row was already there).

## Studio check

1. Die with the stairs ~8 tiles away on floor 4: `8 tiles from floor 5`; highlights count up; settled by ~1.4 s.
2. `KV_NewBestDebug = "score:5000"`, die near 4,500: `500 short of your best` replaces the dim Best line.
3. Die to the Demon Lord at low hp: `The Demon Lord had 9% left` beats everything.
4. Record run: NB's ribbon and rows first, at most one dim sub-line, highlights after.
5. Mash attack through the death: skips to settled, no new run; press after 0.6 s: new run; R: new run at once. Time
   press -> control.
6. Details opens the breakdown and Build list; closing returns the highlights.
7. Co-op (2 clients): clear a room with no hits: `TEAM PERFECT` on both screens on the same tick (one near as a stamp,
   one far as a chip), rings on both players, streak on the next; a hit resets it.
8. Co-op: both guard into one wave: `SYNC!` and the tether on both screens; guards 0.5 s apart: nothing.
9. Daily, reduced motion, touch landscape and portrait, HUD 70 %, a long translation (`en-XA`).
10. Risks first: the panel's height on a record daily run, a near-miss that nags after many deaths, the arm delay
    feeling slow, SYNC! hiding bullets in a dense wave.

## Decisions

RRD6 and RRD8 are the owner's (2026-11-03); the rest are proposed, recommendation first.

- **RRD1. Presentation only** (final state, NB's baseline, view collectors).
- **RRD2. One near-miss headline**, fixed order boss > score > record floor > stairs close > full clear > next boss.
- **RRD3. Record runs:** NB owns the moment; at most one dim sub-line; nothing on FIRST RECORD.
- **RRD4. Highlights:** max 4, notable-first, filled to 2; fixed thresholds (stat bests are Later).
- **RRD5. Breakdown and Build list behind Details**, not deleted. Alternative: keep them and shrink the highlights to
  one row.
- **RRD6. Again focused; confirm / FIRE armed at 0.6 s** (owner); the `restart` key retries at once.
- **RRD7. Faster retry is measured first**; session prefetch is flagged and used only if the round trip is the gap.
- **RRD8. Thresholds:** boss <= 25 %, score gap <= 15 %, <= 2 rooms (owner). Added: stairs <= 10 path tiles.
- **RRD9. No new colour role**; recap sounds reuse the tally's.
- **RRD10. Stairs, not rooms (new).** Rooms never gate a non-boss floor's stairs, so `{rooms} rooms from floor {n}`
  would be false; the line uses path distance to the open stairwell instead.
- **RRD11. Daily:** near-miss against best today; rank stays in the daily block.
- **CMD1. TEAM PERFECT is the sim's PERFECT relabelled** in party runs; no view rule of its own (as RCD2).
- **CMD2. Far clients get the chip, the sound and the rings, not the stamp** (keeps RCD12: the far player may be
  fighting). Alternative: the full stamp on every screen.
- **CMD3. Streaks count clear order**, reset by any non-perfect clear (a far room counts too).
- **CMD4. SYNC is time only** (0.2 s), distance only decides the tether. Alternative: also require <= 10 tiles.
- **CMD5. Two optional port audio IDs** with fallbacks, so nothing waits on art.
- **CMD6. No co-op retry button** (party runs return to the lobby); a party "run it back" vote is Later.
- **CMD7. Revives out of scope**; a reserved kind and highlight slot only.

## Risks

- **Wall of text.** One line + four cells + Details; RR10 checks the record daily co-op worst case.
- **Nagging.** If near-misses read as guilt, drop candidates 5 and 6 first; RR9's telemetry shows whether they move
  retries.
- **Accidental vs sluggish retries.** The arm guard trades one for the other; tune by feel.
- **Callout clutter in co-op.** SYNC! sits under bullets, ducks, and has a cooldown; TEAM PERFECT reuses the stamp's
  slot.

## Later

- Stat bests in the records doc (`NEW: most parries` badges).
- A party "run it back" vote on the run-over screen (lobby ready-up in one press).
- Revives (own plan) and their moment.
- Endless rank rung on run over (`312 from #14`); per-floor ghost splits; a shareable recap card; co-op MVP rows.

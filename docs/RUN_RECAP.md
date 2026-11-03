# Run-over recap and co-op moments (plan)

Status (2026-11-03): **proposed**. Nothing built. Supersedes the first draft in the project (`claude/run-recap-plan.md`,
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
| Again -> `actions.restart()` -> `handleReset` -> (forfeit if live) -> `beginRun` -> `Events.startRun` -> wait for `runStarted` -> forge floor 1 behind the stage cover (`minStartSec`) | SimController.ts 849-900, 1544-1576 | The retry wait is: server round trip + floor generation + the cover's minimum. RR8 measures each |
| **The stairwell is open from the start on every non-boss floor** (`stairsOpen: world.bossFloor ? 0 : 1`); only a boss floor's opens on the boss's death. The floor clear pays by the *share* of rooms cleared | sim/endless.ts 183, 247; score.ts `awardFloorClear` | The first draft's `2 rooms from floor 9` is **not true** (rooms never gate the stairs). Replaced by distance to the stairs and "rooms from a full clear" |
| `ScoreState.maxCombo` (run peak, tenths) | score.ts | Best combo highlight reads it directly |
| `hitsTaken` sums `events.playerHits` of **the whole party**; PERFECT = no hit since the room engaged (score.ts 916). An Aegis / armor absorb still counts as a hit | score.ts, player.ts `damagePlayer` | **TEAM PERFECT is already what the sim scores in co-op** (RCD2). Part B only presents it |
| Boss no-hit: a second `BOSS` award (+2500) when no hit landed in the final phase | score.ts 654 | `counts[BOSS]` = boss kills + no-hit awards; the recap tells them apart by points (RR0) |
| Score sources: KILLS, GRAZES, GUARD (bullets erased), ROOMS, PERFECT, FAST, FLOORS, BOSS, BREAKABLES; JACKPOT (builds runs); PELLETS, SWEEP (pellet runs) | scoreData.ts `ScoreSource` | Highlights read counts; GUARD is bullets, not parries |
| Parries are grouped per player already: one group per guard, `SWORD_DATA.guardTicks` (18) from its first erase; one parry cue per group | shared/view/fx/nearMissRules.ts | Parry counts and the SYNC rule reuse these groups; no new grouping |
| `ScoreEvents.guardPlayer` / `grazePlayer` per bullet (co-op: the guarding / nearest player) | score.ts | Per-player rows in co-op |
| Room clear in co-op: no slow motion, a 0.2 s kill hold on every client, the full stamp near the room, a corner chip when > `nearTiles` away (RCD12) | docs/ROOM_CLEAR.md | TEAM PERFECT rides the stamp and the chip |
| Silent sounds fall back (`SFX_FALLBACK`) | shared/view/audio/cues.ts | New port audio IDs can ship silent and still sound |

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
| 0.7 / rows + 0.2 | **Highlights** one every 0.15 s, each counting over 0.25 s (at most one tick sound a frame), the last landing with `sfx.score.land` | same after NB's rows; the dim sub-line with the first highlight |
| settled | ~1.6 s | ~2.3 s |

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
| 1 | `Boss felled · no hits` / `Bosses felled 2` | `counts` / `points[BOSS]` | >= 1 |
| 2 | `Best combo x4.2 DOMINATING` (tier colour) | `score.maxCombo` | >= x2 (RAMPAGE) |
| 3 | `PERFECT rooms 7 of 11` (co-op: `TEAM PERFECT rooms`) | `counts[PERFECT]` / `counts[ROOMS]` | >= 3, or >= 50 % |
| 4 | `Best team streak x4` (co-op only, Part B) | `TeamMoments` | >= 2 |
| 5 | `Duos 2` / `Evolved 3` | `state.builds` (view player) | >= 1 |
| 6 | `Parries 14` | parry groups (`RecapTally`) | >= 5 |
| 7 | `Sync parries 3` (co-op only, Part B) | `TeamMoments` | >= 1 |
| 8 | `Sweeps 3` | `counts[SWEEP]` (pellet runs) | >= 1 |
| 9 | `Grazes 120` | `counts[GRAZES]` (co-op: per player from `grazePlayer`) | >= 50 |
| 10 | `Jackpots 3` | `counts[JACKPOT]` | >= 1 |
| 11 | `Speed bonus 1,240` | `points[FAST]` | >= 3 rooms under par |
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
  deferred one item per frame: check nothing waits on a frame it need not); lower `minStartSec` for a retry
  (`RECAP.retryStartSec`) when the core preload is done; behind `RECAP.prefetchSession`, request the next solo session
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
- **Sound:** a new optional port audio ID `sfx.room.teamPerfect` (falls back to `sfx.room.perfect`), played on every
  client; the far client hears it at the chip's volume.
- A dead teammate does not stop it (the dead cannot be hit); the label stays TEAM while the party started with >= 2.

### B2. SYNC! parries

- **Rule:** two parry groups (the existing per-player grouping) by **different players** that start within
  `syncWindowTicks` 12 (0.2 s) of each other. A third player inside the same window makes it `SYNC x3`.
- **Callout:** `SYNC!` floor text on the combo shout's construction (under every bullet, <= 55 % opaque, ducking near
  enemy bullets) at the midpoint of the two parry points, with a bright tether between them for 0.25 s when they are
  within `tetherMaxTiles` 10; farther apart, a small `SYNC!` at each.
- **Sound:** the parry cue again at +5 semitones, or a new optional `sfx.player.syncParry` (falls back to that).
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
| `RecapTally`: parries per player (from the director's groups), grazes per player; reset on run start | shared/view/fx/recapTally.ts | RR1 |
| `RECAP` / `RECAP_HIGHLIGHTS` tunables; `RunRecapInput`; `nearMissFor(input)`; `pickHighlights(input)`; `RecapTimeline` (rows, counted values, sound edges, `skip()`, `armed`); `stairsPathTiles(world, x, z)` (BFS, run over only) | shared/view/hud/recap.ts, recapConfig.ts | RR2 |
| Strings `RECAP_STRING_KEYS` (`run.recap.*`), `room.clear.teamPerfect` / `.teamStreak`, `fx.parry.sync`, `fx.parry.syncCount`; context entries in `l10n/context.json`; lists built inside functions (contract.luau / validate.luau near Luau's 200 locals) | shared/theme, packs, l10n | RR3 / CM3 |
| Cue mapper: recap ticks / land via `sfx.score.tick` / `land`; `sfx.room.teamPerfect`, `sfx.player.syncParry` with fallbacks | shared/view/audio/cues.ts | RR4 / CM4 |
| `NearMissLine`, `HighlightGrid`, `DetailsToggle` (breakdown + Build list behind it), three layouts | client/ui/hud/RunOverPanel.tsx + new files | RR5 |
| `RecapController`: builds the input after NewBestController freezes its result, steps the timeline, writes bindings, re-derives on the verdict | client/controllers/fx | RR6 |
| Again focus (keyboard), arm guard, skip | RunOverPanel, input layer | RR7 |
| Retry timing and levers | SimController, StageController, server RunSessionService | RR8 |
| `TeamMoments` (pure): TEAM PERFECT flag + streak from `RoomClearEvents`, sync parries from the director's parry groups; `syncParry` records on the `NearMissDirector`'s frame output | shared/view/fx/teamMoments.ts, nearMissRules.ts | CM1 |
| Stamp / chip text and streak, team pulse rings | roomClearSequence, RoomClearStamp / Chips, ParticleController | CM2 |
| `SYNC!` floor text and tether | ParryFlashController (shared construction with the combo shout) | CM5 |
| Telemetry: `run_retry` (seconds on panel, near-miss kind, record run) and co-op fields (team perfects, best streak, sync parries) on the party run-end event | shared/run/analytics.ts | RR9 |

## Tasks

Each step is a commit; `npm run verify` before each.

### Part A

- [ ] **RR0. Remaining facts.** Boss hp readable at the death tick from the snapshot (`bossFraction`); telling the
  no-hit award from boss kills in `counts[BOSS]`; FAST counts per room; the custom-event budget for `run_retry`; press
  -> control time today, split (a)-(d). -> Verify: each written here.
- [ ] **RR1. Tally.** `RecapTally` + spec: one guard erasing 5 bullets = 1 parry; two guards = 2; per player; reset on
  a new run. Every golden / replay / hash spec unchanged.
- [ ] **RR2. Recap core.** Pure + spec: each candidate at its edge (25 / 26 % boss, 15 % gap, deepest floor, 10 / 11
  path tiles, 2 / 3 rooms left, pre-boss floor), order, record-run drops and the dim line, FIRST RECORD none,
  `unknown` / `unranked`, daily best today; highlights: priority, cap 4, fill to 2, Team / You; timeline, skip before
  arm, reduced motion; verdict re-derive.
- [ ] **RR3. Theme strings** (contract, placeholder, vale, l10n context); contract / validate specs and Luau locals.
- [ ] **RR4. Audio mapper** spec: tick cap per frame, one land, reduced motion.
- [ ] **RR5. Panel.** Blocks, Details toggle, three layouts; fit at 1080p, phone landscape, portrait, HUD 70 %
  (fit.spec.ts); `npm run build:place`.
- [ ] **RR6. RecapController** wiring, after NewBestController.
- [ ] **RR7. Again**: keyboard focus, arm guard, skip, touch; Retry Daily.
- [ ] **RR8. Faster retry.** Levers only where RR0's split points. -> Verify: before / after times written here.
- [ ] **RR9. Telemetry** spec.

### Part B

- [ ] **CM1. TeamMoments core.** Pure + spec: TEAM PERFECT only when the sim awarded perfect and party >= 2; streak
  order and reset; sync window 12 / 13 ticks; same player twice is not a sync; three players = x3; cooldown; identical
  output from two clients stepping the same log.
- [ ] **CM2. TEAM PERFECT presentation.** Stamp / chip text and streak, pulse rings on every living member.
- [ ] **CM3. Strings** (with RR3 if built together).
- [ ] **CM4. Sounds.** Two port audio IDs, SILENT in the placeholder, fallbacks; mapper spec.
- [ ] **CM5. SYNC! callout.** Floor text, tether, ducking, cooldown.
- [ ] **CM6. Recap rows** (team highlights 4 and 7).
- [ ] **CM7. [owner] Vale sounds** for the two IDs (audition, lock, upload).

### Both

- [ ] **RR10. [owner] Studio check and tuning** (below); tune `RECAP`, `RECAP_HIGHLIGHTS`, `syncWindowTicks` from five
  solo and three co-op runs.
- [ ] **RR11. Docs.** As-built here, docs/CLIENT.md, ROOM_CLEAR.md / GRAZE_PARRY.md cross-links, the CLAUDE.md row and
  decision log entry.

## Studio check

1. Die with the stairs ~8 tiles away on floor 4: `8 tiles from floor 5`; highlights count up; settled by ~1.6 s.
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

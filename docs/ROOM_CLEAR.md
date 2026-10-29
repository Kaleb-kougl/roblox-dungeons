# Room clear celebration (plan)

Status (2026-10-29): **plan ready, nothing built.** Drafted from `main` @ `d6eb9d4`. Owner answers (2026-10-29):
RCD10-RCD13 (1.5 s, 0.5x slow motion, a corner chip for a far-away clear in co-op, an On / Off setting). RCD1-RCD9 and
the implementation refinements RCD14-RCD18 are proposed and stand unless the owner changes them. The step-by-step build
is **`docs/ROOM_CLEAR_IMPL.md`** (RC1-RC9, then the owner's RC10); RC1 is next.

Goal: make clearing a room the best moment of the loop. On the last kill the game eases into slow motion, a **CLEAR**
stamp (or **PERFECT**, when the room was cleared without a hit) slams onto the screen, then the room's points count up
segment by segment under it and the bonus flies into the score panel, which rolls up to its new total. **1.5 s** from
the last kill to a clean screen, and input is never blocked.

**Presentation only:** no sim, dungeon, lockstep, hash, replay or fixture change. Everything is read from the score
records the sim already keeps. Theme additions: three port audio IDs and the stamp / tally / chip strings (no new
colour role: RCD14). One Juice setting, `roomClear` (On / Off, stored as an override only; the settings doc stays v2).

## What already exists (and is reused)

| Piece | Today | Where |
|---|---|---|
| Room records | Every encounter room with members has a `RoomScore` (bounds, `parTicks`, `engageTick`, `hitsAtEngage`, `cleared`). `clearRoom` awards **rooms** (250), **perfect** (500, no hit since engagement) and **fast** (1 per tick under par), each x combo x depth x curse | shared/sim/score/score.ts `clearRoom`, `stepScore` |
| Which runs | Endless (always scored), the tutorial, M1 with `KV_Scoring`. Boss rooms and empty rooms have no record (the boss death keeps its own sequence) | score.ts, docs/ROOM_EDGES.md |
| Room clear edge | `StateWatch.roomCleared` (the cleared count rose on the same floor) plays `sfx.room.clear` (Ninja Adventure `Success1.wav`, a 0.4 s jingle) | shared/view/watch.ts, audio/cues.ts |
| Slow motion | `HitstopClock.requestSlowMo(ms, fromScale, settings)`: a smoothstep ramp back to 1x after any pending freeze; solo only (`simPacerFor` returns no pacer in co-op); off under Freeze frame off or reduced motion (`freezeFrameOn`). Used only by the boss death (0.3x over 500 ms) | shared/view/fx/hitstop.ts, freezeRules.ts |
| Kill freeze | 50 ms (80 ms heavy / elite) on every kill, then the 150 ms per 1 s cap | freezeRules.ts |
| Per-tick collection | LiveRun and LockstepClient collect each tick's score pops and boost events (`BoostFrameEvents`: `reset` per frame, `collect` per tick) | shared/play/liveRun.ts, shared/lockstep/client.ts, shared/view/boosts/events.ts |
| Score panel | Top right, from the ~10 Hz Reflex snapshot: the score jumps, never counts | client/ui/hud/ScorePanel.tsx |
| Per-frame HUD writes | Module-level React bindings written from a controller (no re-render) | client/ui/hud/cornerFade.ts |
| Kill hold, sparks | `HitReactSlots` holds a killed actor's sprite; ParticleController's chip bursts | shared/view/fx/hitReact.ts, ParticleController |

So the sim already decides CLEAR vs PERFECT and the exact bonus points. This plan is a view-side collector, a
timeline, and the pieces that draw it.

## Player experience (target)

### The full sequence (solo; co-op when the view player is at the room)

Times are real seconds from the frame the room cleared, settings at default:

| t (s) | What happens |
|---|---|
| 0 | The last kill's freeze (50 / 80 ms, as today), then **slow motion** (solo): 0.5x easing back to 1x over 0.5 s (PERFECT: over 0.7 s). A ring of sparks bursts from the last kill (`uiAccent`; PERFECT `ember`) |
| 0.06 | **The stamp** drops in at the top centre, in the boss bar's slot: scale 2.0 -> 1.0 in 0.10 s (ease out back). CLEAR in `uiText`; PERFECT in `ember` gold, 10 % larger, with a shine sweeping across the letters |
| 0.16 | The stamp **lands**: `sfx.room.clear` (or the new `sfx.room.perfect`), a 1-texel camera kick down |
| 0.30 | **The tally row** under the stamp: segments appear every 0.12 s, each counting up over 0.2 s with a tick: `Kills 1240   Clear +250   No hits +500   Speed +87   = 2077` (*No hits* only for PERFECT, *Speed* only under par, *Kills* = points earned in the room before its bonuses). Done at 0.86 |
| 0.95 | The bonus (clear + perfect + speed) **flies** as a `+2077`-style chip to the score panel in 0.2 s; it lands, `sfx.score.land`, and the panel rolls up over 0.3 s |
| 1.2 - 1.5 | Stamp and tally fade out |

### The corner chip (co-op, a clear away from the view player)

When a teammate clears a room the view player is not at (outside the room's bounds grown by `ROOM_CLEAR.nearTiles`,
4 tiles, at the clear; while spectating, the watched teammate's position), a small chip slides in **under the score
panel** instead: `PERFECT +1250`. No slow motion, no kick, no tally, no sparks; the jingle plays at half volume. It
slides in over 0.12 s, merges into the score at 0.9 s (the same roll and `sfx.score.land`) and is gone by 1.5 s. At
most two chips; a third merges the oldest at once. A full sequence and chips may show together.

### Rules for both

- **Never in the way.** Nothing blocks input. If the view player is hurt, another room engages, the stage loader covers
  the screen, or the run ends, a full sequence **collapses**: the bonus lands at once and everything fades in 0.15 s.
  A second clear during a sequence releases the first one's bonus and plays its own.
- **The score panel never runs ahead**: while a sequence or chip holds a bonus, the panel shows the score without it;
  kill points roll over 0.15 s instead of jumping.
- **Co-op.** No slow motion (the server paces the sim). The last killed enemy's sprite holds for 0.2 s on every client
  instead (with Freeze frame on). PERFECT is the party's: no hit on anyone since the room engaged, as the sim scores it.
- **Tutorial.** Shown (it teaches the perfect bonus); the stamp sits above the tutorial prompt on touch.
- **Settings.** Options > Juice gains **Room clear**: On (default) / Off (only today's jingle). Freeze frame Off removes
  the slow motion and the co-op hold. Reduced motion: no slow motion, no slam (the stamp fades in), no kick, no flying
  chip (the bonus still lands at the same moment), the corner chip fades instead of sliding; the counting stays.

## Design (summary; code in docs/ROOM_CLEAR_IMPL.md)

| Piece | Where | Step |
|---|---|---|
| `RoomClearEvents`: per tick, diffs `state.score` (cleared flips, engagement latches, per-source point deltas, the last killed member by smallest `deadTicks`); `RunView.roomClears` | shared/view/fx/roomClears.ts, LiveRun, LockstepClient | RC1 |
| `ROOM_CLEAR` tunables; `roomClearStyle`; `RoomClearSequence` (one full sequence + 2 chips, every bonus released exactly once); `ScoreRoller` | shared/view/fx/roomClearConfig.ts, roomClearSequence.ts | RC2 |
| `JuiceSettings.roomClear`; `ROOM_CLEAR_STRINGS` / contract `ROOM_CLEAR_STRING_KEYS`; `ROOM_CLEAR_VIEW` and the stamp / tally text builders | shared/settings, shared/view/hud/roomClear.ts, theme contract + placeholder manifest | RC3 |
| `sfx.room.perfect` / `sfx.score.tick` / `sfx.score.land` (port IDs, SILENT in the placeholder, `art/audio.json`); the cue mapper leaves the jingle to the celebration while it is On | theme, shared/view/audio/cues.ts, AudioController | RC4 |
| `applyRoomClearSlowMo`, `stampNudgeFor`, the `stamp` nudge; `HitReactSlots.hold`, `ActorRenderController.holdActor`, `ParticleController.roomClearBurst`, `FreezeFrameController.requestNudge` | shared/view/fx/roomClearRules.ts, freezeRules.ts, hitReact.ts, client | RC5 |
| Transient boxes `roomClear` (top centre, boss bar slot, above the toasts and the touch tutorial prompt) and `roomClearChip` (under the score box; new `topRight` anchor) | shared/view/hud/footprint.ts | RC6 |
| `ROOM_CLEAR_UI` bindings, `RoomClearStamp`, `RoomClearChips`, `Text` takes a binding, ScorePanel shows the rolled score | client/ui/hud | RC7 |
| `RoomClearController`: collapse rules, starts, slow motion / hold / sparks, sounds, kick, roller, bindings | client/controllers/fx | RC8 |

### Not changed

- **The sim and the score rules.** No new hashed field, no new award. Every number on screen is read from the records.
- **Enemy bullets** left in flight are not cleared or faded: what can hurt you stays drawn as it is (FEEL JD3).
- **No camera zoom**: it would break the texel snap (FEEL JD4).
- **Boss deaths** keep their own sequence (freeze 250 ms, 0.3x slow motion, death nudge). Boss rooms have no record.
- **Unscored M1** shows nothing new (no records, no points to count).
- **The toasts, the room edges and the score panel's layout** are untouched (RCD15, RCD16).

## Tasks

Each step is a commit; the details, code and specs are in `docs/ROOM_CLEAR_IMPL.md`.

- [x] **RC0. Owner decisions.** Answered 2026-10-29: RCD10-RCD13.
- [ ] **RC1. Collector.** `roomClears.ts` + spec, on `RunView` (LiveRun, LockstepClient). Golden / replay specs unchanged.
- [ ] **RC2. Tunables, style, sequence, roller.** Pure + spec (timeline, collapse, chips, reduced motion, roller).
- [ ] **RC3. Setting, strings, HUD numbers.** `roomClear` setting, required strings, `ROOM_CLEAR_VIEW`, text builders.
- [ ] **RC4. Sounds.** Three port audio IDs, cue mapper hand-off, `art/audio.json` entries (lock / build).
- [ ] **RC5. Effect hooks.** Slow-motion rule, `stamp` nudge, co-op hold, spark ring.
- [ ] **RC6. HUD footprint.** The two transient boxes and their specs (desktop and touch).
- [ ] **RC7. HUD components.** Bindings, stamp + tally + flying bonus, corner chips, rolling score.
- [ ] **RC8. RoomClearController.** Wires everything; `npm run build:place` still builds.
- [ ] **RC9. Docs.** This doc's status and as-built notes, docs/CLIENT.md, the CLAUDE.md decision log.
- [ ] **RC10. [owner] Studio check and sounds.** The check below; audition (`npm run audio:audition`), upload, ids into
  `packs/vale/assetIds.ts`; tune `ROOM_CLEAR` inside the 1.5 s.

## Studio check

1. Solo, a normal room: kill freeze then 0.5x slow motion, the stamp lands with the jingle and the kick, the tally
   counts in order, the screen clean by 1.5 s, the score panel ends on the true total.
2. A room with a hit taken on the engagement tick: CLEAR, not PERFECT. A no-hit room under par: PERFECT with *Speed*.
3. Hurt mid-tally, walking into the next room mid-tally, the last room of a floor into the stairwell card: each
   collapses and the bonus lands once.
4. Co-op: no slow motion, the 0.2 s hold on every client; the player at the room gets the stamp, the one across the map
   a chip under the score panel; spectating follows the watched teammate; two rooms on one tick read x2.
5. Room clear Off, Freeze frame Off, reduced motion on; the tutorial (desktop and touch).
6. Risks to check first: `sfx.room.clear` and `sfx.stairwell.open` on the same frame (jingle overlap), the slam's
   `UIScale` with the HUD scale on 70 % and the touch floor, the gradient shine on long localised words, the stamp over
   a bright biome floor, the tally row readable at its TextScaled size on a phone, the chip under the score panel on the
   narrowest touch viewport, a boost toast arriving during a stamp (they sit apart, but check it reads).

## Decisions

RCD1-RCD9 and RCD14-RCD18 are proposed (not yet confirmed by the owner); RCD10-RCD13 are the owner's answers.

- **RCD1. Presentation only.** Every value comes from score's records and per-source points; no sim field, hash group,
  award or fixture changes.
- **RCD2. The stamp is the sim's verdict.** PERFECT exactly when the sim awarded the perfect bonus (party-wide in
  co-op); no view-side rule of its own.
- **RCD3. Room points** are everything the team scored from the room's engagement to its clear (kills, grazes, guard
  cancels, breakables, then the bonuses). Overlapping live rooms can count the same kill in both; accepted.
- **RCD4. Slow motion is solo only**; co-op gets the local kill hold instead.
- **RCD5. Never blocking.** Input always live; any danger or transition collapses the sequence; the bonus lands once.
- **RCD6. Text stamp in v1.** No image asset; a stamp graphic (`ui.stamp.clear` / `.perfect`, optional slot) only if
  the playtest asks.
- **RCD7. The score panel waits for the chip.** The held bonus is hidden until it lands; kill points roll, never jump.
- **RCD8. Every clear in co-op is celebrated on every screen**: in full near the room, as a chip elsewhere (RCD12).
- **RCD9. Scored runs only.** Unscored M1 gets nothing new.
- **RCD10. 1.5 s** (owner, 2026-10-29): from the last kill to a clean screen, for the full sequence and the chip.
- **RCD11. 0.5x slow motion** (owner, 2026-10-29): CLEAR and PERFECT both start at 0.5x; PERFECT eases back over a
  longer ramp (0.7 s vs 0.5 s).
- **RCD12. A far-away clear is a corner chip** (owner, 2026-10-29): co-op, the view player more than `nearTiles` outside
  the room: a small chip under the score panel, no tally, no slow motion, no kick.
- **RCD13. On / Off setting** (owner, 2026-10-29): Options > Juice > Room clear, default On; Off keeps today's jingle.

Implementation refinements (2026-10-29, from mapping the plan onto the code; proposed):

- **RCD14. No new colour roles.** CLEAR is `uiText`, PERFECT `ember` (the HUD's gold), the flying bonus and CLEAR's
  sparks `uiAccent` (the score pops' colour). Saves a contract change, two pack values and a validator.
- **RCD15. One tally row in the boss bar's slot.** Four stacked lines under the stamp would reach the toasts (top centre
  at 96 reference px) and the middle of the screen; the stamp (36 px) plus one TextScaled row (16 px max) is 64 px tall
  and ends above both the toasts and the touch tutorial prompt, so no other panel moves.
- **RCD16. No edge wash, no score-panel pop** in v1: the room edges already fade live -> safe, and a pop inside the
  panel's list layout would shift its rows. Both can come back after the playtest.
- **RCD17. The tick does not rise in pitch**: `AudioController.play` has no pitch argument; one tick per segment.
- **RCD18. The chips and the flying bonus have no backing panel**: stroked text like the score pops.

## Later (not in this plan)

- **Perfect streak**: PERFECT x2, x3 ... across consecutive rooms on a floor, with a rising jingle pitch.
- **Floor clear stamp** for the floor bonus (`awardFloorClear`) before the stairwell card.
- **A results line** for perfect rooms (perfect / cleared) on the run-over panel.
- The edge wash and the score-panel pop (RCD16), a stamp graphic (RCD6).

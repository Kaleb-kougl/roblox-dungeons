# Combo you chase (plan)

Status (2026-10-29): **plan ready, nothing built.** Drafted from `main` @ `1dbc97f` (Room clear RC2; RC3 is in the
working tree). Owner answers (2026-10-29): CD2 (the names, plus an x4 tier), CD3 (break vs lapse), CD9 (the shout,
which must never hide a bullet), CD11 (no setting), CD12 (the owner's glass clip). The rest are proposed and stand
unless the owner changes them. Build after Room clear RC7 / RC8: both plans change `ScorePanel.tsx`, and this one
reuses RC7's bindings pattern. CB1 is next.

Goal: make the combo something the player chases and hates to lose. Today the multiplier climbs from x1.0 to x5.0 but
it is a small gold `x1.3` over a 6 px bar, refreshed at ~10 Hz, and it drops back to x1.0 without a sound. After this
plan the combo has **named tiers** (x2 **Rampage**, x3 **Carnage**, x4 **Dominating**, x5 **Unstoppable**), a **meter that changes colour**
per tier, a **kill sound that climbs in pitch** with every kill in the streak, a **tier-up sting**, and a **break you
feel**: a shatter sound, the meter shattering and going grey, the lost multiplier shown greyed out.

**Presentation only:** no sim, dungeon, lockstep, hash, replay or fixture change, and no change to how points are
scored (a tier is a name and a colour; the multiplier is still the sim's tenths). Theme additions: five colour roles,
six strings, two port audio IDs. No new setting (CD11).

## What already exists (and is reused)

| Piece | Today | Where |
|---|---|---|
| The combo | Tenths in [10, 50]. Every kill or graze adds 1 (`COMBO_STEP`) after its own award and refills the timer (`COMBO_WINDOW_TICKS` 180 = 3 s; Lingering +1.5 s, Impatience -1 s, team-wide). The timer runs out -> back to 10. A landed hit cuts it to `max(10, floor(c (d-1)/d))`, d = max(2, party size) (x2 Composure). Shared by the whole party. Frozen during a boon draft (the world is frozen) | shared/sim/score/scoreData.ts, score.ts `feedCombo`, `cutCombo`, `stepScore` |
| Per-tick combo events | `ScoreEvents.comboChanged`, `comboBroken` (the timer reset a combo above x1.0), `comboCut` (hits that cut it), `comboStart`, `comboFed`; cleared every tick, not hashed. **No view reads them yet** | score.ts `ScoreEvents` |
| Score panel | Top right, scored runs: SCORE label, total, `x1.3` (`titleText` 24, `ember`), a 6 px meter (`comboBarHeight`, `ember` fill), the endless floor line. Reads the ~10 Hz Reflex snapshot (`combo`, `comboTicks`, `comboWindowTicks`) | client/ui/hud/ScorePanel.tsx, shared/play/snapshot.ts |
| Footprint | `HUD_FOOTPRINT.score` 200 x 160; `scoreEstimate()` is **154**. One more text row (+26) would break `footprint.spec.ts` and the cover cap (`maxCoverShare` 0.145) | shared/view/hud/footprint.ts |
| Kill sound | `sfx.enemy.death` (Ninja Adventure Impact2-4, volume 0.5, jitter [0.95, 1.05]) once per frame, `SFX_MIN_INTERVAL` 0.04 s, priority 35 (dropped before swings and shots on a busy frame). `AudioCueList` carries id + volume only; `AudioController.play(id, scale)` sets `PlaybackSpeed` from the jitter alone (Room clear RCD17: no pitch argument) | shared/view/audio/cues.ts, voices.ts, client/controllers/audio/AudioController.ts |
| Per-tick collection | LiveRun and LockstepClient `reset` per frame and `collect` per tick (`BoostFrameEvents`, `RoomClearEvents`) | shared/play/liveRun.ts, shared/lockstep/client.ts, shared/view/fx/roomClears.ts |
| "A fight is on" | Room edges: a score record with `engageTick >= 0` and `cleared === 0` is LIVE; the boss room is LIVE while a living boss has phase > 0 | shared/view/roomEdgeState.ts |
| Per-frame HUD writes | Module-level React bindings written from a controller, no re-render | client/ui/hud/cornerFade.ts (Room clear RC7 adds `ROOM_CLEAR_UI`) |
| World text | Score pops: stroked world-space text, pooled | client/controllers/fx/ScorePopController.ts |
| Run-over | "Best combo x3.4" in the breakdown | client/ui/hud/RunOverPanel.tsx |

Two facts shape the design:

1. **x5 is 40 kills or grazes in a row**, each within 3 s of the last. x2 is 10, x3 is 20, x4 is 30. A milestone
   every 10 steps (the x4 tier fills the gap between x3 and the cap). Grazes count, so a bullet-dancing player climbs
   between kills.
2. **The timer runs out after almost every room**: the walk to the next room takes longer than 3 s. A shatter there
   would play after every clear, which is noise, not loss. So a reset **during a fight** is a *break* (shatter), and a
   reset with **no fight on** is a *lapse* (a quiet cash-out). CD3.

## Player experience (target)

### The tiers

| Combo | Tier | Meter + multiplier colour | Multiplier pop on each feed | Extra |
|---|---|---|---|---|
| x1.0 - x1.9 | (none) | `ember` (today's gold) | 1.15x -> 1x, 0.10 s | - |
| x2.0 - x2.9 | **RAMPAGE** | `combo.rampage` (coral) | 1.20x | - |
| x3.0 - x3.9 | **CARNAGE** | `combo.carnage` (crimson) | 1.25x | the meter pulses gently (1 Hz, 10 % brighter) |
| x4.0 - x4.9 | **DOMINATING** | `combo.dominating` (magenta) | 1.25x | the pulse quickens (1.5 Hz) |
| x5.0 | **UNSTOPPABLE** | `combo.unstoppable` (violet) | 1.30x | a shine sweeps the multiplier row every 1.5 s |

Colours are starting values; the validator (CB3) decides. The tier name is the colour's twin, so the colour never
carries meaning alone.

### Climbing (every kill or graze)

- The multiplier ticks up and **pops** (UIScale inside a fixed-size slot, so no row moves: Room clear RCD16).
- The **kill sound climbs**: each step of the combo raises `sfx.enemy.death` by a fraction of a semitone, fast at the
  start, slower near the cap (+5 semitones at x2, +8 at x3, +10 at x4, +12 at x5; CD5). A graze climbs the ladder silently; the
  next kill is heard higher. Several kills on one frame play one sound at the frame's final pitch.
- The meter refills to full and now drains **per frame** (smooth), not at the snapshot's 10 Hz.
- **Draining warning:** in the last 25 % of the window the fill blinks at 4 Hz. One more kill saves it.

### Tier up (x2, x3, x4, x5)

| t (s) | What happens |
|---|---|
| 0 | `sfx.combo.tier` (one clip, pitched up per tier: 0 / +3 / +5 / +7 semitones). The tier name **slams** into the multiplier row (1.6x -> 1x in 0.12 s, ease out back) in its colour; the meter flashes white for 0.08 s, then takes the new colour |
| 0 | A **floor shout** near the view player: `RAMPAGE!` painted on the floor in the tier colour, sliding 0.5 tile up-screen and fading over 0.6 s (below). It is what you see when the score corner is faded under the action |
| 0.12 | The name settles; the row carries it until the tier changes |

### The floor shout never hides a bullet (CD9)

The score pops are BillboardGuis with `AlwaysOnTop`, drawn over everything; the shout must not be. It follows the
sprite effects' rule instead (`FX_VIEW.placement` "floor", docs/FX_AUDIO.md): an effect that loses every overlap.

1. **Under every bullet, by construction.** The shout is a SurfaceGui on a thin floor Part at `FX_VIEW.liftStuds`
   (its own layer in the effects' layer stack), under the floor markings at `MARKING_VIEW.liftTiles` and every bullet
   at `BULLET_Y`. Bullets, telegraphs, the aim line and every body draw over it, so no draw order can put it in front.
2. **Translucent.** Peak opacity `COMBO_SHOUT.maxOpacity` 0.55 (fill and stroke), so a bullet's floor contrast drops
   by at most about half where they cross. The tier colours are held >= 40 CIE76 from every enemy-bullet role and
   `telegraph` (CB3), so a bullet over the shout still reads as a bullet.
3. **It ducks.** Each frame the shout's opacity falls to `COMBO_SHOUT.duckOpacity` 0.15 (over 0.05 s) while any enemy
   bullet is inside its box grown by `COMBO_SHOUT.duckMarginTiles` 1, and comes back when the box is clear. One
   pass over the bullet sim's live slots per frame, only while a shout shows.
4. **Out of the way.** Placed `COMBO_SHOUT.offsetTiles` 2.5 tiles up-screen from the player's feet (clear of the
   player's own sprite, outline and roll), short (0.6 s), and one at a time (a second tier-up replaces it).
5. **Reduced motion:** no slide, a plain fade. Co-op: over the view player only (spectating: the watched teammate).

Re-earning a tier after a cut plays it again (re-earning is a reward); `sfx.combo.tier` has a 0.5 s minimum interval.

### Hit cut (a crack)

A landed hit cuts the combo (to half, solo). On the cut frame: the meter flashes `uiHealth` for 0.25 s, the
multiplier row shakes 3 px left-right twice, and a small `-x1.2` drops from the multiplier and fades (0.5 s). If the cut
crosses a tier down, the name fades to the lower one (or out). **No extra sound**: the hurt sound plays on that frame
and a second one would mud it (CD4). The kill ladder drops with the combo, so the next kill is heard lower: the loss is
audible.

### Break (the timer ran out during a fight)

| t (s) | What happens |
|---|---|
| 0 | `sfx.combo.break` (a shatter). The meter's fill **shatters**: 6 shards of the fill fly out and fall (0.4 s). The meter and multiplier turn `combo.broken` grey; the multiplier shows the lost value struck through (`x3.4`); the tier slot reads **COMBO LOST** |
| 0.08 | A 1-texel camera kick down (a new `comboBreak` nudge at the `heavy` nudge's strength, below `hurt` in priority; off with Screen shake) |
| 1.2 | Back to normal: `x1.0` in `ember`, the meter empty |

A break below x2 (x1.1 - x1.9) is a small break: the grey and the struck-through value, no shards, no kick, the sound
at half volume (`COMBO_VIEW.smallBreakVolume`). Losing x1.4 should sting, not punish.

### Lapse (the timer ran out with no fight on)

The usual end of a streak, on the walk out of a cleared room. No sound, no shards: the meter drains to grey over
0.3 s and the tier slot shows **BEST x3.4** (the value the streak reached) for 1.2 s, then x1.0. It reads as cashing
out, not failing.

### Rules

- **Scored runs only** (endless, the tutorial, M1 under `KV_Scoring`). Unscored M1 shows nothing new.
- **Co-op:** the combo is the team's, so every client sees the same tiers, cracks and breaks. The floor shout is near the
  view player (spectating: the watched teammate). The kill ladder is the team's combo, so a teammate's kill climbs it
  too.
- **Room clear:** a tier-up on the last kill of a room plays with the CLEAR stamp (the sting is not a jingle, so both
  sound); the shout is on the floor near the player, the stamp at top centre. The room's slow motion does not touch audio pitch.
- **Floor change / stage cover:** the combo carries over floors. A break or lapse under the stage cover is not shown
  (the panel shows the plain result after the reveal). Run over: no break or lapse, the run-over panel takes it.
- **Reduced motion:** no pops, slam, shake, shards, shout slide (the shout fades in place) or kick; the blink becomes a
  steady dim. Colours, names, struck-through value and every sound stay.
- **HUD fade** (`hudFade`): unchanged; the score corner still fades under the action. The shout and the sounds carry the
  moments while it is faded (CD8).

## Design (summary)

| Piece | Where | Step |
|---|---|---|
| `ComboEvents`: per tick, from `state.score.events` and the combo: feeds (kills, grazes), cuts (before / after), a reset (`comboBroken`: the value lost, the streak's peak, `fight`: a room LIVE or a boss in phase > 0, the room edges' rule moved to a shared helper `fightOn(state)`); `RunView.combo` | shared/view/fx/comboEvents.ts, roomEdgeState.ts, LiveRun, LockstepClient | CB1 |
| `COMBO_TIERS` (tenths 20 / 30 / 40 / 50, string key, colour role, pop scale, sting semitones), `comboTier(tenths)`; `COMBO_VIEW` (meter 10 px, warn fraction 0.25, blink 4 Hz, crack / break / lapse timings, shard count, small-break volume); `COMBO_SHOUT` (offset, slide, life, max / duck opacity, duck margin); `KILL_PITCH` (segments: 0.5 st per step to x2, 0.3 to x3, 0.2 to x5; cap 12); `killPitchSpeed(tenths)`; `ComboDisplay`: per-frame state machine (tier, edges, crack / break / lapse timers, warn, reduced motion); `shoutDucked(box, bullets)` | shared/view/hud/combo.ts, comboConfig.ts | CB2 |
| Colour roles `COMBO_ROLES` (`combo.rampage` / `.carnage` / `.dominating` / `.unstoppable` / `.broken`) + `comboReport`; strings `COMBO_STRING_KEYS` (`hud.combo.rampage` / `.carnage` / `.dominating` / `.unstoppable` / `.lost` / `.best`); `sfx.combo.tier` / `sfx.combo.break` in `PORT_AUDIO_EVENTS` (SILENT in the placeholder); placeholder + vale values | shared/theme contract, validate, packs | CB3 |
| `AudioCueList` gains a speed per cue; the mapper ladders `sfx.enemy.death` from the frame's final combo (no pack jitter while above x1.0), raises its priority to `COMBO_KILL_PRIORITY` (55, over swings and shots) in a streak, cues the sting and the break; `AudioController.play(id, scale, speed = 1)` multiplies the speed in | shared/view/audio/cues.ts, client AudioController | CB4 |
| `comboBarHeight` 6 -> 10; the tier name shares the multiplier row (`scoreEstimate` 154 -> 158, under 160); touch the same | shared/view/hud/layout.ts, footprint.ts | CB5 |
| `COMBO_UI` bindings; `ComboRow` (tier slot + multiplier, pop / slam / shake / shine), `ComboMeter` (fill colour, blink, flash, grey, shards drawn in an overlay outside the layout); RunOverPanel: "Best combo x3.4 CARNAGE" | client/ui/hud | CB6 |
| `ComboController`: per frame, reads `runView.combo` and `state.score`, steps `ComboDisplay`, writes `COMBO_UI`, the meter fill (from `comboTimer` / `comboWindowTicks`), the floor shout (one SurfaceGui on a floor Part, FxSpriteController's placement and layers; ducked by `shoutDucked`), the break kick | client/controllers/fx | CB7 |

### Not changed

- **The sim and the score rules.** No new hashed field, no award, no tier bonus. Every number is read from `state.score`.
- **The combo rules** (step, window, cut, boons and curses). Making the window pause between rooms would make the
  break rarer and fairer, but it changes scores and replays: out of scope (Later).
- **The score panel's rows.** Same five rows; only the meter is 4 px taller (CD8).
- **Breakables** never feed the combo; their sounds are unchanged. **Boss kills** keep `sfx.boss.death`, unladdered.

## Tasks

Each step is a commit. Specs next to the code; `npm run verify` before each.

- [x] **CB0. Owner decisions.** Answered 2026-10-29: CD2, CD3, CD9, CD11, CD12.
- [ ] **CB1. Collector.** `comboEvents.ts` + spec (a feed, two feeds on one tick, a cut that crosses a tier, a break in
  a live room, a lapse after a clear, a boss fight, a break under a frozen draft never fires, co-op cut divisor). Wired
  into both run views. Golden / replay specs unchanged.
- [ ] **CB2. Tiers, pitch, display.** Pure + spec: tier boundaries (19 / 20 / 29 / 30 / 39 / 40 / 49 / 50),
  `killPitchSpeed` at 10 / 20 / 30 / 40 / 50 (+0 / +5 / +8 / +10 / +12 semitones) and monotonic, `ComboDisplay`
  timelines (tier up, re-earn, crack, break, small break, lapse, reduced motion, a break under the stage cover, run
  over), `shoutDucked` (a bullet inside / on / outside the grown box; player bullets ignored).
- [ ] **CB3. Theme.** Roles + `comboReport` (each tier >= 3:1 on `uiPanel`; ember -> rampage -> carnage -> dominating ->
  unstoppable >= 25 CIE76 apart step to step; `combo.broken` low chroma and >= 40 CIE76 from every tier; the tier roles >= 40 CIE76
  from the enemy-bullet roles and `telegraph`, since the shout is drawn in the world), strings, the two audio IDs;
  contract / placeholder / vale specs.
- [ ] **CB4. Audio.** Cue speed through the mapper and controller; mapper spec cases (a kill per frame climbing, three
  kills on one frame = one cue at the final pitch, a cut lowers it, a break resets it, a boss kill unladdered, a teammate
  kill climbs it, the sting's interval, the small break's volume, silent IDs fall to nothing). `art/audio.json` entries
  (CD12: the glass clip from `art/vendor/pixabay/`, trim `[0, 1.2]`), `audio:lock`, `audio:build`; the clip's row in
  `THIRD_PARTY_NOTICES.md` and where to get it in `art/README.md`.
- [ ] **CB5. Footprint.** `comboBarHeight` 10; `scoreEstimate` and `footprint.spec.ts` (desktop and touch) still pass.
- [ ] **CB6. HUD components.** Bindings, `ComboRow`, `ComboMeter`, the run-over line.
- [ ] **CB7. ComboController.** Wires everything; `npm run build:place` still builds.
- [ ] **CB8. Docs.** This doc's status and as-built notes, docs/CLIENT.md, the CLAUDE.md decision log.
- [ ] **CB9. [owner] Studio check and sounds.** The check below; `npm run audio:audition`, upload, ids into
  `packs/vale/assetIds.ts`; tune `KILL_PITCH` and `COMBO_VIEW` by ear and eye.

## Studio check

1. Solo, endless floor 1: kill 10 in a chain; hear the kill sound climb, see RAMPAGE slam in with the sting and the
   shout, the meter turn coral. Push to x3 (CARNAGE, the pulse), x4 (DOMINATING) and, on a later floor, x5
   (UNSTOPPABLE, the shine).
2. **The shout and bullets:** trigger a tier-up in a dense ring (debug: a Demon Lord hellfire ring): every bullet draws
   over the shout, the shout ducks to 0.15 while a bullet crosses it, and a bullet over it is as easy to read as one on
   the bare floor. Check on the brightest and darkest biome floors.
3. Let the timer run out mid-fight (stand in a live room, stop killing): the blink, then the shatter, shards, grey,
   struck-through value, COMBO LOST, back to x1.0 at 1.2 s. Clear a room and walk out: the quiet lapse with BEST.
4. Take a hit at x3.2: the crack (red flash, shake, `-x1.6`), CARNAGE fades to none; the next kill is heard lower.
5. Co-op (two clients): a teammate's kills climb your ladder and tiers; a break shows on both; spectating, the shout
   is painted near the watched teammate.
6. Reduced motion on; Screen shake off; the tutorial; touch (the row at the touch HUD floor scale); HUD scale 70 %.
7. Risks to check first: whether x5 is reached at all in a normal endless run (note the best combo over five runs; the
   tier thresholds are presentation-only and free to move), the ladder grating at the top (cap +12 at a 0.27 s impact),
   the sting on the same frame as `sfx.room.clear`, the shout's SurfaceGui text crispness at the camera's zoom,
   `UNSTOPPABLE` / `DOMINATING` and their translations fitting the row beside `x5.0` at 70 %.

## Decisions

CD2, CD3, CD9, CD11 and CD12 are the owner's answers (2026-10-29); the rest are proposed.

- **CD1. Presentation only.** Read from `state.score` and its per-tick events; no sim field, hash group, award or
  fixture change. Tiers do not change scoring.
- **CD2. Tiers x2 RAMPAGE, x3 CARNAGE, x4 DOMINATING, x5 UNSTOPPABLE** (owner, 2026-10-29: the names, and an x4 tier so
  x3 -> x5 is not 20 steps without a milestone; "Dominating" is a proposed name, "Frenzy" is taken by a boost). Theme
  strings, so a pack can rename them.
- **CD3. Break vs lapse** (owner, 2026-10-29). The shatter plays only when the combo resets while a fight is on (a room LIVE by the room
  edges' rule, or a boss in phase > 0); otherwise the reset is a quiet lapse. Without this, a shatter plays after
  nearly every room clear (the 3 s window always runs out on the walk).
- **CD4. A cut is a crack, visual only.** The hurt sound already plays on that frame.
- **CD5. The ladder follows the combo value**, not a separate kill count: grazes raise it silently, a cut lowers it, a
  reset zeroes it. Piecewise steps (0.5 / 0.3 / 0.2 semitones per step through x2 / x3 / x5, cap +12) so the early
  climb is clear and the top does not squeal. The pack's random jitter is off above x1.0 (it would mask a step).
- **CD6. The kill sound outranks swings and shots in a streak** (priority 55 above x1.0, 35 otherwise), so a busy
  frame never drops the one sound that carries the ladder.
- **CD7. One sting ID pitched per tier** (0 / +3 / +5 / +7 semitones) through the same per-cue speed; not a jingle.
- **CD8. No new panel rows.** The footprint has 6 px to spare (154 of 160), so the tier name shares the multiplier row
  and only the meter grows (6 -> 10). Pops and slams are UIScale inside fixed slots. The occlusion fade is left alone;
  the shout and sounds carry the moment while the corner is faded.
- **CD9. A floor shout on tier-up that never hides a bullet** (owner, 2026-10-29: keep it, but bullets stay readable).
  Drawn on the floor under every bullet, telegraph and body (the sprite effects' "floor" placement), at most 55 %
  opaque, ducking to 15 % while an enemy bullet crosses it, 2.5 tiles up-screen of the player, 0.6 s, one at a time.
  Not an `AlwaysOnTop` billboard like the score pops.
- **CD10. New colour roles** (unlike Room clear RCD14): four distinct states need four colours, validated like the room
  edges' roles.
- **CD11. No new setting** (owner, 2026-10-29). Reduced motion and Screen shake cover the motion; the SFX volume covers
  the sounds.
- **CD12. Sounds** (owner, 2026-10-29). The break is the owner's clip `dragon-studio-glass-breaking-504033.mp3`
  (Pixabay, "Glass breaking" by DRAGON-STUDIO, Pixabay Content License: commercial use, no attribution, no
  redistribution of the raw file), kept in gitignored `art/vendor/pixabay/` like the other packs and uploaded only as a
  built OGG. Measured: 3.12 s, 48 kHz stereo MP3; 85 ms lead (the build's silence trim takes it), the crash 0.1 - 1.0 s
  (RMS -9 to -31 dB), a stray tinkle at 1.9 - 2.05 s, silence after. `audio.json` trims it to `[0, 1.2]`: a ~1.1 s
  shatter that ends with the break's 1.2 s greyed state; category `sfx` (mono). The sting stays Ninja Adventure
  `Bonus/Bonus2.wav` or `Bonus3.wav` (unused today), picked at the audition.
- **CD13. Co-op shows the team's combo on every screen**; the shout follows the view player.
- **CD14. A small break below x2** (no shards, no kick, half volume).
- **CD15. Scored runs only.**
- **CD16. The run-over best combo carries its tier name.**

## Later (not in this plan)

- **Pause the combo window between rooms** (a sim change: scores and replays change) so every reset is a real break.
- **Tier rewards** (a tier bonus, a boost at x5): sim changes.
- **A tier music layer** (a percussion stem that joins at CARNAGE) once the music has stems.
- A combo-meter graphic instead of the flat bar; a stamp graphic for the floor shout.
